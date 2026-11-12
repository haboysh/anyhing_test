// 게임 ↔ 서버 연결: 세이브 동기화(설정·표시용만), 재화(뽑기·교환·충전), 아이템·재료(서버가 원본), 진행·미션·업적 카운터(서버가 원본), 방치 보상 시간, 계정.
// 서버가 없으면(설정 비어 있음) 지금처럼 기기 안에서 모두 처리.
(function (G) {
  'use strict';

  const SAVE_EVERY_MS = 60 * 1000; // 클라우드 저장 주기 (기기 저장은 5초마다 따로)
  const HELLO_TIMEOUT_MS = 6000;
  const KILL_RETRY_MS = 3000; // 처치 보고 실패 시 다시 보내기까지
  const KILL_BATCH_MS = 10000; // 처치 보고 묶음 주기 (사용자 확정 10초, 앱 내릴 때·층이 필요한 버튼 전엔 바로)
  const KILL_QUEUE_MAX = 20000; // 연결이 끊긴 동안 모아둘 최대 처치 수 (서버 한도보다 넉넉히)
  const QUEUE_ENTRIES_MAX = 300; // 묶음 기록(처치·근로 강화·법인카드) 수가 이만큼 쌓이면 10초를 안 기다리고 보냄 (서버 한도 2000)

  const ERR = {
    network: '서버에 연결할 수 없어요. 잠시 후 다시 해주세요',
    insufficient_bonus: '성과급이 부족해요',
    insufficient_corp: '법카가 부족해요',
    insufficient_jjam: '짬이 부족해요',
    insufficient_stamps: '결재 도장이 부족해요',
    insufficient_shards: '장신구 조각이 부족해요',
    provider_disabled: '아직 준비 중인 로그인이에요',
    link_failed: '계정 연결에 실패했어요',
    test_purchases_disabled: '테스트 충전이 꺼져 있어요',
    already_claimed: '이미 받았어요',
    not_all_done: '미션을 모두 완료해야 해요',
    fill_limit: '한 주기에 5번까지만 채울 수 있어요',
    bag_max: '가방을 더 늘릴 수 없어요',
    bag_full: '가방이 가득 찼어요',
    refresh_max: '새로고침은 2번까지예요',
    ad_limit: '오늘 광고는 다 봤어요',
    inv_not_ready: '서버와 아이템을 맞추는 중이에요. 잠시 후 다시 해주세요',
    inv_busy: '잠시 후 다시 해주세요',
    rate_limited: '요청이 너무 많아요. 잠시 후 다시 해주세요',
    not_reached: '서버 기록으로는 아직이에요. 잠시 후 다시 눌러 주세요',
    bad_step: '받을 수 없는 포스트잇이에요',
    insufficient_namecard: '명함이 부족해요',
    bad_net: '없는 인맥이에요',
    bad_pet: '없는 반려예요',
    bad_skill: '없는 스킬이에요',
    bad_skill_move: '스킬 기록을 옮길 수 없어요',
    skill_move_over: '스킬 기록을 옮길 수 없어요 (뽑기 기록보다 많아요)',
    bad_round: '서버 기록으로는 아직이에요. 잠시 후 다시 눌러 주세요',
    bad_floor: '서버 기록으로는 아직이에요. 잠시 후 다시 눌러 주세요',
    tower_locked: '서버 기록으로는 아직이에요. 잠시 후 다시 눌러 주세요',
    ad_wait: `광고는 ${(G.Rewards && G.Rewards.REW.ad.gapSec) || 30}초 뒤에 다시 볼 수 있어요`,
    bad_mission: '없는 미션이에요',
    already_bought: '이미 산 상품이에요 (1회 한정)',
    insufficient_petticket: '반려 뽑기권이 부족해요',
    insufficient_pethero: '영웅 이상 뽑기권이 없어요',
    bad_product: '없는 상품이에요',
  };
  // 서버가 규칙상 거절하면(rejected) 그 이유(한국어)를 그대로
  const msg = (e) => (e && e.extra && typeof e.extra.reason === 'string' && e.extra.reason) || ERR[e && e.code] || '서버 오류가 났어요';
  // 다시 보내면 되는 실패 (처치 보고)
  const RETRYABLE = new Set(['network', 'inv_busy', 'inv_not_ready', 'server_error', 'db_error', 'rate_limited']);

  function withTimeout(p, ms) {
    return Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new G.CloudError('network')), ms))]);
  }

  // engine: 게임 엔진 / storage: 기기 저장 / cloud: createCloud 결과
  // timers: 테스트용 setTimeout 대체
  // (예전 ask = "클라우드 / 이 기기 진행 고르기" 창 — 진행이 서버 하나뿐이라 없앰, 설계서 6단계)
  function createSync({ engine, storage, cloud, onChange = () => {}, timers = { setTimeout: (f, ms) => setTimeout(f, ms) }, helloTimeoutMs = HELLO_TIMEOUT_MS }) {
    const E = engine;
    const online = cloud.status !== 'off';
    let rev = 0; // 내가 알고 있는 서버 세이브 번호
    let saving = false;
    let lastPush = 0;
    let invReady = false; // 서버 아이템을 받아왔는지 (그 전엔 아이템 작업을 막음)

    const Y = {
      online,
      status: () => cloud.status,
      lastSyncAt: 0,
      invReady: () => !online || invReady,
    };

    async function guard(fn) {
      try { return await fn(); } catch (e) { onChange(); return { ok: false, reason: msg(e) }; }
    }
    const local = (r) => Promise.resolve(r);
    const notReady = () => local({ ok: false, reason: ERR.inv_not_ready });

    // ----- 아이템·재료 작업: 서버 모드면 서버가 판정 (같은 inventory.js 규칙), 아니면 기기 엔진 -----
    const equippedIds = () => Object.values(E.S.equipped).filter((x) => Number.isInteger(x));
    // 재산(원)은 서버 진행 장부가 원본 (3단계) → 보내지 않음. 응답의 prog(서버 재산·레벨)로 맞춤
    // 교체용 프리셋 장비는 따로 (서버: 보호만, 일괄 강화 '장착 중만'엔 안 들어감)
    const altIds = () => Object.values(E.S.presetAlt || {}).filter((x) => Number.isInteger(x) && !equippedIds().includes(x));
    const invBody = (extra) => ({ equipped: equippedIds(), kept: altIds(), auto: E.S.autoAppraise, ...extra });
    // 서버 응답 반영: 아이템·재화 + 재산·근로 강화는 서버 값(prog) + 아직 확정 안 된 내 기록 (r.gold 증감은 안 씀)
    function applyR(r) {
      if (!r || typeof r !== 'object') return;
      E.applyServer({ ...r, gold: undefined });
      econ(r.prog);
    }
    // 버튼을 빨리 여러 번 눌러도 서버 작업은 하나씩
    let chain = Promise.resolve();
    function serial(fn) {
      const p = chain.then(fn, fn);
      chain = p.catch(() => {});
      return p;
    }
    // 재산을 쓰는 작업 전엔 쌓인 처치·근로 강화 기록을 먼저 보냄 (서버 재산 = 폰이 보는 재산, 순서도 폰과 같게)
    // (뽑기·상자도: 자동 감정이 재산을 씀)
    const SPEND = new Set(['enhance', 'autoEnhance', 'enhanceAll', 'restore', 'appraise', 'reappraise', 'stampBuy', 'levelUp', 'levelAll', 'merge', 'mergeAll', 'gacha', 'shardBox']);
    async function settle(action) {
      if (SPEND.has(action) && Y.pendingKills() > 0) await Y.flushKills();
    }
    function invAction(action, args, after, noSettle = false) {
      if (!invReady) return notReady();
      return (noSettle ? Promise.resolve() : settle(action)).then(() => serial(() => guard(async () => {
        const r = await cloud.inv({ action, ...invBody(args) });
        applyR(r);
        const ret = E.localize(r.ret || { ok: true });
        if (after) after(ret);
        onChange();
        return ret;
      })));
    }
    // 기기 함수 이름 → 서버 작업 (online이 아니면 기기 엔진이 그대로 처리)
    const run = (localFn, action, args, after) => (online ? invAction(action, args, after) : local(localFn()));

    Y.enhance = (id, o = {}) => run(() => E.enhance(id, o), 'enhance', { id, boost: o.boost, protect: o.protect });
    Y.autoEnhance = (id, o = {}) => run(() => E.autoEnhance(id, o), 'autoEnhance', { id, ...o });
    Y.enhanceAll = (o = {}) => run(() => E.enhanceAll(o), 'enhanceAll', { target: o.target, scope: o.scope });
    Y.restore = (id) => run(() => E.restore(id), 'restore', { id });
    Y.appraise = (id) => run(() => E.appraise(id), 'appraise', { id });
    Y.reappraise = (id, locks = []) => run(() => E.reappraise(id, locks), 'reappraise', { id, locks });
    Y.merge = (ids, type) => run(() => E.merge(ids, type), 'merge', { ids, type });
    Y.mergeAll = (grade) => run(() => E.mergeAll(grade), 'mergeAll', { grade });
    Y.dismantle = (ids) => run(() => E.dismantle(ids), 'dismantle', { ids });
    Y.dismantleBelow = (grade) => run(() => E.dismantleBelow(grade), 'dismantleBelow', { grade });
    Y.toggleProtect = (id) => run(() => E.toggleProtect(id), 'protect', { id });
    Y.openShardBox = () => run(() => E.openShardBox(), 'shardBox', { floor: E.eff() });
    Y.marketList = (ids) => run(() => E.marketList(ids), 'marketList', { ids });
    Y.marketClaim = () => run(() => E.marketClaim(), 'marketClaim', {});
    Y.buyStamps = (n) => run(() => E.buyStamps(n), 'stampBuy', { n });
    // 뽑기: 가방·성과급 부족은 서버에 보내지 않음
    // pay = 'ticket': 반려 뽑기권 / 'hero': 영웅 이상 반려 뽑기권 (서버가 차감·판정)
    Y.pull = (n, kind = 'acc', pay) => {
      if (!online) return local(E.gachaPull(n, kind, pay));
      const cost = G.Gacha.costFor(n);
      if (cost === null) return local({ ok: false, reason: '없는 뽑기 횟수예요' });
      if (kind !== 'skill' && kind !== 'pet' && E.bagFree() < n) return local({ ok: false, reason: `가방 공간이 부족해요 (${n}칸 필요)` });
      if (pay === 'ticket' || pay === 'hero') {
        if (kind !== 'pet') return local({ ok: false, reason: '뽑기권은 반려 뽑기에만 써요' });
        if (pay === 'hero' && ((E.S.pethero | 0) < 1 || n !== 1)) return local({ ok: false, reason: '영웅 이상 뽑기권이 없어요' });
        if (pay === 'ticket' && (E.S.petticket | 0) < n) return local({ ok: false, reason: '반려 뽑기권이 부족해요' });
        return invAction('gacha', { n, kind, pay, floor: E.gachaFloor() }, (ret) => { if (ret.ok) E.gachaStats(ret.results, ret.cost); }, false);
      }
      if (E.S.bonus < cost) return local({ ok: false, reason: '성과급이 부족해요' });
      // 재산을 안 쓰는 뽑기는 쌓인 처치 기록을 먼저 보내지 않음 (서버 왕복 1번 줄임).
      // 스킬: 재산·가방 안 씀. 장비·장신구: 자동 감정이 꺼져 있고 가방이 넉넉할 때만 (처치 드롭과 순서가 바뀌어도 가방이 안 넘치게).
      // 반려는 해금 층(서버 최고 층)이 걸려 있어 그대로 먼저 보냄
      const quick = kind === 'skill' || (kind !== 'pet' && !E.S.autoAppraise && E.bagFree() - n >= 20);
      return invAction('gacha', { n, kind, floor: E.gachaFloor() }, (ret) => { if (ret.ok) E.gachaStats(ret.results, ret.cost); }, quick);
    };

    // ----- 부서 장악 묶음: 승리·받기·한 번에 처리·소탕·출입증 구매는 서버가 판정 (규칙은 depts.js) -----
    const Sub = G.Subscription;
    const subOn = () => !!(Sub && Sub.isActive());
    // 서버 응답 반영. 재산 생산·재산 특근(원)도 서버가 계산해 서버 재산에 더함 (ret.gold = 더한 양)
    function deptDone(r) {
      applyR(r);
      const ret = E.localize(r.ret || { ok: true });
      onChange();
      return ret;
    }
    function deptAction(action, args) {
      if (!invReady) return notReady();
      return serial(() => guard(async () => deptDone(await cloud.dept({ action, ...invBody(args) }))));
    }
    Y.deptClaim = () => (online ? deptAction('claim', { floor: E.deptFloor() }) : local(E.deptClaim(subOn())));
    Y.meetingQuick = (id) => (online ? deptAction('meetingQuick', { id }) : local(E.meetingQuick(id)));
    Y.dungeonSweep = (id, n = 1) => (online ? deptAction('sweep', { id, n }) : local(E.dungeonSweep(id, n)));
    Y.buyPass = () => (online ? deptAction('passBuy', {}) : local(E.buyPass()));
    // ----- 인맥: 명함·성과급 차감과 친분·사이는 서버가 판정 (규칙은 net.js). 폰은 응답의 net 복사본으로 능력치 계산 -----
    function netAction(action, args) {
      if (!invReady) return notReady();
      return serial(() => guard(async () => {
        const r = await cloud.net({ action, ...args });
        applyR(r);
        onChange();
        return r.ret || { ok: true };
      }));
    }
    Y.netLevelUp = (id, n = 1) => (online ? netAction('levelUp', { id, n }) : local(E.netLevelUp(id, n)));
    Y.netRankUp = (id) => (online ? netAction('rankUp', { id }) : local(E.netRankUp(id)));
    Y.netLevelAll = () => (online ? netAction('levelAll', {}) : local(E.netLevelAll()));
    Y.netBuyCards = (n) => (online ? netAction('buyCards', { n }) : local(E.netBuyCards(n)));
    // ----- 책상 반려: 뽑기(위 Y.pull kind 'pet')·합치기·해금 지급은 서버가 판정 (규칙은 pets.js). 책상에 올리기는 폰 -----
    if (online) E.serverPets = true;
    function petAction(action, args) {
      if (!invReady) return notReady();
      return settle(action).then(() => serial(() => guard(async () => {
        const r = await cloud.pet({ action, ...invBody(args) });
        applyR(r);
        onChange();
        return r.ret || { ok: true };
      })));
    }
    Y.petMerge = (key, tier, n = 1) => (online ? petAction('merge', { key, tier, n }) : local(E.petMerge(key, tier, n)));
    Y.petMergeAll = () => (online ? petAction('mergeAll', {}) : local(E.petMergeAll()));
    Y.petSummon = (key) => local(E.petSummon(key));
    // 해금 지급: 서버가 진행 장부 최고 층으로 확인하므로 쌓인 처치를 먼저 보냄
    let petStartAt = 0;
    Y.petStart = async () => {
      if (!online) return E.petStart();
      petStartAt = Date.now();
      await Y.flushKills();
      return E.petStarted(await petAction('start', {}));
    };
    const petStartDue = () => online && invReady && !E.S.pet.granted && G.Pets.isOpen(E.S.maxStage) && Date.now() - petStartAt >= 30000;
    // ----- 업무 스킬: 보유·레벨·카드·교환권은 서버가 판정 (규칙은 skills.js, 뽑기는 위 Y.pull kind 'skill'). 장착 칸은 폰 -----
    if (online) E.serverSkills = true;
    function skillAction(action, args) {
      if (!invReady) return notReady();
      return settle(action).then(() => serial(() => guard(async () => {
        const r = await cloud.skill({ action, ...invBody(args) });
        applyR(r);
        onChange();
        return r.ret || { ok: true };
      })));
    }
    Y.skillLevelUp = (key) => (online ? skillAction('levelUp', { key }) : local(E.skillLevelUp(key)));
    Y.skillLevelUpAll = () => (online ? skillAction('levelAll', {}) : local(E.skillLevelUpAll()));
    Y.skillExchange = (key) => (online ? skillAction('exchange', { key }) : local(E.skillExchange(key)));
    Y.skillEquip = (key, i) => local(E.skillEquip(key, i));
    Y.skillUnequip = (i) => local(E.skillUnequip(i));
    // 첫 지급: 서버가 진행 장부 최고 층으로 확인하므로 쌓인 처치를 먼저 보냄
    let skillStartAt = 0;
    Y.skillStart = async () => {
      if (!online) return E.skillStart();
      skillStartAt = Date.now();
      await Y.flushKills();
      return E.skillStarted(await skillAction('start', {}));
    };
    const skillStartDue = () => online && invReady && !E.S.skills.granted && G.Skills.isOpen(E.S.maxStage) && Date.now() - skillStartAt >= 30000;
    // 장악전·미팅·특근 승리 보고. 장악전·특근은 서버가 진행 장부 최고 층으로 확인하므로 쌓인 처치를 먼저 보냄
    if (online) {
      E.sideReady = () => invReady;
      E.sideSink = async (kind, args) => {
        if (kind !== 'meeting') await Y.flushKills();
        const action = kind === 'conquest' ? 'conquer' : kind;
        const r = await deptAction(action, args);
        return r;
      };
    }
    // 테스트 구독 켜기/끄기 (서버 모드: 서버 기록, 테스트 결제가 켜진 서버에서만)
    Y.subTest = (on) => {
      if (!online) { Sub.setActiveForTest(on); return local({ ok: true }); }
      return guard(async () => { const r = await cloud.subTest(on); Sub.setServer(r.sub); onChange(); return { ok: true }; });
    };

    // ----- 처치·근로 강화 보고: 10초마다 묶어서 (앱 내릴 때·층이나 재산이 필요한 버튼 전엔 바로). 서버가 처치 인정·층·재산·근로 강화의 원본 (progress.js) -----
    // 서버는 서버 능력치로 낼 수 있는 데미지 예산 안에서만 처치를 인정 → 인정한 처치로 층·최고 층·신기록 보스·재산을 정함
    // 근로 강화는 "먼저 보여주고, 서버가 확정, 틀리면 되돌림" (설계서 3절): 폰은 바로 레벨·재산을 바꾸고, 같은 묶음에 일어난 순서대로 실어 보냄.
    // 화면 재산·레벨 = 서버 값 + 아직 확정 안 된 내 기록(보내는 중 b* + 쌓이는 중 q*). 서버가 거절하면 그만큼 서버 값으로 돌아감
    let killQ = []; // 일어난 순서대로: 처치 {f, b, n, r} · 근로 강화 {u, n, r} · 법인카드 {g, f, r} (같은 기록이 이어지면 합침)
    let killQN = 0; // 쌓인 처치 수
    let killBatch = null; // 보내는 중인 묶음 (실패하면 같은 요청 ID로 다시)
    let killBody = null;
    let killReq = null;
    let killBusy = false;
    let killTimer = false; // 다시 보내기 기다리는 중
    let killWait = null; // 다음 묶음 시각 타이머
    let killWaiters = []; // [{need: 이 번호 묶음까지 끝나면, done}]
    let batchSeq = 0; // 만든 묶음 번호
    let doneSeq = 0; // 끝난(서버 확정·버림) 묶음 번호
    // 아직 서버가 확정 안 한 재산·레벨 변화 (지금 회차 몫만. 이직하면 비움 — 새 회차는 0원·처음 레벨에서 시작)
    let qG = 0;
    let qLv = {};
    let bG = 0;
    let bLv = {};
    let qEk = {}; // 쌓이는 묶음의 적 종류별 일반 처치 수 (업적, 서버는 인정한 처치 수 안에서만)
    const clearPending = () => { qG = 0; qLv = {}; bG = 0; bLv = {}; qEk = {}; };
    function schedule() {
      if (killQ.length >= QUEUE_ENTRIES_MAX && !killBusy && !killTimer) { if (killWait) killWait = null; flushKills(); return; }
      if (!killWait && !killBusy && !killTimer) killWait = timers.setTimeout(() => { killWait = null; flushKills(); }, KILL_BATCH_MS);
    }
    // 장착(장비·스킬 칸·책상 반려)이 바뀌면 기록 사이에 {k} — 서버가 그 뒤부터 새 장착으로 계산 (재산 장비를 묶음 끝에만 끼는 것 방지)
    const kitNow = () => ({ equipped: equippedIds(), slots: E.S.skills.slots.slice(), out: E.S.pet.out });
    let qKitSig = null; // 쌓이는 중인 기록 끝의 장착
    let qKit0 = null; // 지금 쌓이는 묶음이 시작할 때 장착 (서버 kit0)
    // 마지막 기록과 같은 종류면 합침 (순서는 그대로)
    function push(e, same, add) {
      const k = kitNow();
      const sig = JSON.stringify(k);
      if (sig !== qKitSig) {
        if (qKitSig === null && !killQ.length) qKit0 = k; else killQ.push({ k });
        qKitSig = sig;
      }
      const last = killQ[killQ.length - 1];
      if (last && same(last)) add(last); else killQ.push(e);
      schedule();
    }
    function reportKill(f, boss, gold, key) {
      if (killQN >= KILL_QUEUE_MAX) return;
      const r = E.S.runId;
      const b = boss ? 1 : 0;
      killQN++;
      if (typeof gold === 'number' && isFinite(gold)) qG += gold;
      if (!boss && typeof key === 'string') qEk[key] = (qEk[key] || 0) + 1;
      push({ f, b, n: 1, r }, (x) => x.f === f && x.b === b && x.r === r && x.u === undefined && x.g === undefined, (x) => { x.n++; });
    }
    function reportUp(key, n, cost) {
      const r = E.S.runId;
      qG -= cost;
      qLv[key] = (qLv[key] || 0) + n;
      push({ u: key, n, r }, (x) => x.u === key && x.r === r, (x) => { x.n += n; });
    }
    // 번아웃 (수습 탈락은 서버가 셈, 4단계). f = 쓰러진 유효 층 (서버가 그 층 보스를 한 번 더 인정할지 봄)
    function reportBurn(f) {
      const r = E.S.runId;
      push({ o: 1, f, r }, (x) => x.o !== undefined && x.f === f && x.r === r, (x) => { x.o++; });
    }
    // 아아·야근 사용 (미션·업적, 서버는 쿨타임 상한 안에서만 셈 — 5단계)
    function reportSkill(key) {
      push({ s: key, n: 1 }, (x) => x.s === key, (x) => { x.n++; });
    }
    function reportCast(f, m, gold) {
      const r = E.S.runId;
      qG += gold;
      push({ g: m, f, r }, (x) => x.g !== undefined && x.f === f && x.r === r, (x) => { x.g += m; });
    }
    // 서버 재산·레벨(p = {id, gold, lv}) + 확정 안 된 내 기록 → 화면. 서버가 아직 내 새 회차를 모르면 0원·처음 레벨에서
    function econ(p) {
      if (!p || typeof p !== 'object' || typeof p.gold !== 'number' || !p.lv || typeof p.lv !== 'object') return;
      const same = p.id === E.S.runId;
      const base = same ? p.lv : G.State.freshState(0).lv;
      const lv = {};
      for (const k of Object.keys(E.S.lv)) lv[k] = (Number.isInteger(base[k]) ? base[k] : 0) + (bLv[k] || 0) + (qLv[k] || 0);
      return E.setEconomy((same ? p.gold : 0) + bG + qG, lv);
    }
    // 이직(새 회차)은 서버가 만듦 (careerOp). 옛 회차 대기 기록은 서버가 버림(stale) → 재산·레벨 대기분만 비움
    E.onNewRun = () => { clearPending(); };
    // 묶음 몸통: 회차 표시(서버는 첫 회차만 이 값으로 시작)·탭·장착. 특전·회사·시작 층은 서버 장부 값이라 안 보냄 (4단계)
    const killBodyNow = () => ({
      run: { id: E.S.runId },
      taps: E.taps, slots: E.S.skills.slots.slice(), out: E.S.pet.out, ...invBody({}),
    });
    // 기다리는 버튼: 부른 때까지 쌓인 기록이 든 묶음이 끝나면 (그 사이 새로 쌓인 처치는 안 기다림 — 전투 중에도 버튼이 늦지 않게)
    const settleWaiters = () => {
      const left = [];
      for (const w of killWaiters) if (w.need <= doneSeq) w.done(); else left.push(w);
      killWaiters = left;
    };
    let forceNext = false; // 빈 묶음이라도 한 번 보냄 (지금 장착을 서버에 알림 — 장착 조건 포스트잇·장비 업적 받기 전)
    async function flushKills() {
      if (killBusy || killTimer || !invReady) return;
      if (!killBatch) {
        if (!killQ.length && !forceNext) { settleWaiters(); return; }
        forceNext = false;
        killBatch = killQ;
        batchSeq++;
        killBody = { ...killBodyNow(), ...(qKit0 ? { kit0: qKit0 } : {}), ...(Object.keys(qEk).length ? { ek: qEk } : {}) };
        qEk = {};
        qKit0 = qKitSig ? JSON.parse(qKitSig) : null;
        E.taps = 0;
        killReq = cloud.requestId();
        killQ = [];
        killQN = 0;
        bG += qG; qG = 0;
        for (const k in qLv) bLv[k] = (bLv[k] || 0) + qLv[k];
        qLv = {};
      }
      killBusy = true;
      let retry = false;
      let resync = false;
      try {
        // 버튼 작업과 한 줄로: 둘이 같은 재산을 동시에 쓰지 않게
        await serial(async () => {
          const r = await cloud.kills({ requestId: killReq, kills: killBatch, ...killBody });
          bG = 0; bLv = {}; // 이 묶음은 서버가 확정 (서버 값에 들어감)
          if (r.replay) await refreshInventory(); // 예전 응답 재전송 → 그 사이 바뀐 서버 아이템·재산으로 다시 맞춤
          else { E.applyServer({ ...r, gold: undefined }); progressDone(r.ret, r.prog); }
        });
        killBatch = null;
        doneSeq = batchSeq;
        onChange();
      } catch (e) {
        if (RETRYABLE.has(e && e.code)) retry = true;
        else { killBatch = null; doneSeq = batchSeq; bG = 0; bLv = {}; resync = true; } // 규칙상 거절이면 버리고 서버 값으로 다시 맞춤
      } finally {
        killBusy = false;
      }
      if (resync) { try { await refreshInventory(); } catch (e) { /* 다음 접속 때 */ } onChange(); }
      if (retry) {
        killTimer = true;
        timers.setTimeout(() => { killTimer = false; flushKills(); }, KILL_RETRY_MS);
      } else if (killQ.length >= QUEUE_ENTRIES_MAX || killWaiters.some((w) => w.need > doneSeq)) flushKills(); // 기다리는 버튼이 있으면 바로 다음 묶음
      else if (killQ.length && !killWait) killWait = timers.setTimeout(() => { killWait = null; flushKills(); }, KILL_BATCH_MS);
      settleWaiters();
    }
    // 서버 진행 결과: 거절된 처치가 있으면(조작·끊김·버그) 폰 층을 서버 값으로 맞추고 알림. 재산·근로 강화는 서버 값 + 쌓이는 중인 기록
    function progressDone(ret, prog) {
      if (!ret || !ret.progress) { econ(prog); return; }
      if (ret.rejected > 0) {
        E.applyProgress(ret.progress, 'fix'); // 바뀌면 엔진이 'progressFixed' 알림 → 토스트
        const top = ret.progress.run && ret.progress.run.top;
        // 서버 최고 층보다 높은 층의 쌓인 처치는 어차피 거절 → 버림
        if (Number.isInteger(top)) {
          killQ = killQ.filter((k) => k.f === undefined || k.g !== undefined || !(k.f > top));
          killQN = killQ.reduce((a, k) => a + (k.f !== undefined && k.g === undefined ? k.n : 0), 0);
        }
      } else if (Number.isInteger(ret.progress.bossRec)) E.S.rew.bossRec = Math.max(E.S.rew.bossRec, ret.progress.bossRec);
      const down = econ(prog || (ret.progress.run && { id: ret.progress.run.id, gold: ret.progress.run.gold, lv: ret.progress.run.lv }));
      if (ret.upRejected > 0 || down) E.emitFix('upgrade');
    }
    // 쌓인 기록을 지금 보내고 끝날 때까지 기다림 (서버 최고 층·재산·카운터가 필요한 버튼 전 · 앱 내릴 때). 실패해도 그냥 끝
    // force = 쌓인 게 없어도 빈 묶음을 보냄 (서버가 지금 장착을 알게)
    Y.flushKills = function (force = false) {
      if (!online || !invReady) return Promise.resolve();
      killWait = null; // 기다리던 타이머는 나중에 울려도 빈 묶음이라 그냥 끝
      if (force && !killQ.length) forceNext = true;
      const need = killQ.length || forceNext ? batchSeq + 1 : killBatch ? batchSeq : doneSeq;
      if (need <= doneSeq) return Promise.resolve();
      return new Promise((resolve) => {
        let done = false;
        const fin = () => { if (!done) { done = true; resolve(); } };
        killWaiters.push({ need, done: fin });
        timers.setTimeout(fin, 8000); // 끊겨도 버튼이 영원히 멈추지 않게
        flushKills();
      });
    };
    // 서버 아이템·지갑·진행·재산 전체를 다시 받아 맞춤
    async function refreshInventory() {
      const h = await cloud.hello();
      E.setWallet(h.wallet);
      if (h.inv) E.setInventory(h.inv);
      if (h.progress) { E.applyProgress(h.progress, 'fix'); econ(h.progress.run); E.setCareer(h.progress.c); }
      if (h.counters) E.setCounters(h.counters);
    }
    // 아직 서버가 확정 안 한 기록 수 (처치 + 근로 강화·법인카드·번아웃 기록)
    Y.pendingKills = () => killQN + killQ.filter((k) => k.u !== undefined || k.g !== undefined || k.o !== undefined || k.s !== undefined).length + (killBatch ? killBatch.length : 0);
    if (online) {
      E.dropSink = reportKill;
      E.skillSink = reportSkill;
      E.upSink = reportUp;
      E.goldSink = reportCast;
      E.burnSink = reportBurn;
      E.serverCareer = true;
    }

    // ----- 이직·경력·특전 (4단계): 서버가 카드 뽑기·합격 판정(서버 난수)·경력·특전·이직 보상을 정함. 테스트판은 기기 엔진 -----
    // 서버 층·번아웃이 폰과 같게 쌓인 기록을 먼저 보내고 → op career. 규칙상 거절이면 서버 값(접속 정보)으로 다시 맞춤
    async function careerCall(args) {
      await Y.flushKills();
      return serial(() => guard(async () => {
        let r;
        try { r = await cloud.career(args); } catch (e) {
          if (!RETRYABLE.has(e && e.code)) { try { await refreshInventory(); } catch (e2) { /* 다음 접속 때 */ } }
          throw e;
        }
        applyR(r); // 지갑(이직 보상·새로고침 성과급)·업적 기록
        return { ok: true, r: r.ret || {} };
      }));
    }
    // 지원 창을 열 때: 서버 카드가 없으면 받아 옴
    Y.loadCards = () => {
      if (!online) return local({ ok: true });
      if (E.S.apply.cards) return local({ ok: true });
      const block = E.applyBlock();
      if (block) return local({ ok: false, reason: block });
      return careerCall({ action: 'cards' }).then((x) => {
        if (!x.ok) return x;
        E.setCareer(x.r.c);
        onChange();
        return E.S.apply.cards ? { ok: true } : { ok: false, reason: ERR.inv_busy };
      });
    };
    // index번 카드에 rank 직급으로 지원 → {ok, accepted, chance, allOut, gain} (E.applyTo와 같은 모양)
    Y.applyTo = (index, rank) => {
      if (!online) return local(E.applyTo(index, rank));
      const c = E.S.apply.cards && E.S.apply.cards[index];
      if (!c) return local({ ok: false, reason: '없는 회사예요' });
      return careerCall({ action: 'apply', index, rank, co: c.companyId }).then((x) => {
        if (!x.ok) return x;
        const res = E.applyServerResult(index, rank, x.r);
        onChange();
        return res;
      });
    };
    // 특전 사기: 서버 경력에서 차감 (드물게 누름 → 바로 서버 확정)
    Y.buyPerk = (key) => {
      if (!online) return local({ ok: E.buyPerk(key) });
      return careerCall({ action: 'perk', key }).then((x) => {
        if (!x.ok) return x;
        E.setCareer(x.r.c);
        onChange();
        return { ok: true };
      });
    };

    // ----- 퇴근 후 정산: 재산·장비·결재 도장 모두 서버 (서버가 접속 때 잰 시간 × 서버 능력치) -----
    Y.claimOffline = async (opts = {}) => {
      if (!online) return E.claimOffline(opts);
      const info = E.claimOffline({ ...opts, serverDrops: true, serverGold: true });
      if (!info || !invReady) return info;
      try {
        const r = await serial(() => cloud.offline({ sec: Math.floor(info.sec), f: info.f, itemFloor: info.itemFloor, ...invBody({}) }));
        applyR(r);
        const ret = E.localize(r.ret || {});
        info.gold = typeof ret.gold === 'number' && isFinite(ret.gold) ? ret.gold : 0;
        info.items = (ret.items || []).filter(Boolean);
        info.stamps = ret.stamps || 0;
      } catch (e) { /* 못 받음 (서버가 정산 시간을 기억하고 있어 다음에 다시) */ }
      onChange();
      return info;
    };

    // 가방 확장 (성과급/법카)
    Y.buyBag = (currency) => {
      if (!online) return local(E.buyBag(currency));
      const price = E.bagPrice();
      if (price === null) return local({ ok: false, reason: '가방을 더 늘릴 수 없어요' });
      return guard(async () => {
        const r = await cloud.shop({ item: 'bag', currency });
        E.setWallet(r.wallet);
        E.S.bagBuys = r.bagBuys - 1;
        const res = E.buyBag(currency, true);
        onChange();
        return res;
      });
    };
    // 이직 카드 새로고침: 서버가 성과급 차감·횟수(회차마다 2번)·새 카드 (op career refresh)
    Y.refreshCards = () => {
      if (!online) return local(E.refreshCards());
      const block = E.applyBlock();
      if (block) return local({ ok: false, reason: block });
      if (E.refreshCost() === null) return local({ ok: false, reason: '새로고침은 2번까지예요' });
      return careerCall({ action: 'refresh' }).then((x) => {
        if (!x.ok) return x;
        E.setCareer(x.r.c);
        onChange();
        return { ok: true, cost: x.r.cost };
      });
    };
    // 출석 받기 / 빠진 날 채우기 (성과급·도장·상자 아이템 모두 서버가 지급)
    function attendanceDone(r, res) {
      if (r.inv) applyR(r.inv);
      E.setWallet(r.wallet);
      const item = r.inv && r.inv.ret ? E.localize(r.inv.ret).item || null : null;
      onChange();
      const pass = typeof r.pass === 'number' ? r.pass : 0; // 구독·월정액 매일 성과급 (서버)
      return res.ok ? { ...res, item, pass } : { ok: true, ...r.reward, day: r.day, item, pass };
    }
    Y.claimAttendance = () => {
      if (!online) {
        // 서버 없는 테스트판: 구독·월정액 매일 성과급도 기기에서 (정식판은 서버가 기간 확인)
        const r = E.claimAttendance();
        const pass = r.ok ? G.Meta.PASS.bonus(!!(Sub && Sub.isActive()), !!(Sub && Sub.monthlyUntil && Sub.monthlyUntil())) : 0;
        if (pass) { E.S.bonus += pass; onChange(); }
        return local(r.ok ? { ...r, pass } : r);
      }
      if (!invReady) return notReady();
      return guard(async () => {
        const r = await cloud.attendance('claim', undefined, E.gachaFloor());
        return attendanceDone(r, E.claimAttendance(true));
      });
    };
    Y.fillAttendance = (day) => {
      if (!online) return local(E.fillAttendance(day));
      if (!invReady) return notReady();
      return guard(async () => {
        const r = await cloud.attendance('fill', day, E.gachaFloor());
        return attendanceDone(r, E.fillAttendance(day, true));
      });
    };
    // 미션·업적 받기 (5단계): 서버 카운터로 확인 → 쌓인 처치·근로 강화·스킬 사용 기록을 먼저 보내 서버 카운터를 폰과 같게.
    // 서버가 "아직"(not_reached)·"이미"(already_claimed)라고 하면 서버 카운터로 다시 맞춤 (폰 화면이 서버보다 앞서 있던 것)
    async function counterClaim(call, force) {
      await Y.flushKills(force);
      try { return await call(); } catch (e) {
        if (e && (e.code === 'not_reached' || e.code === 'already_claimed')) { try { await refreshInventory(); } catch (e2) { /* 다음 접속 때 */ } }
        throw e;
      }
    }
    Y.claimMission = (id) => {
      if (!online) return local(E.claimMission(id));
      const st = E.missions();
      const m = st.list.find((x) => x.id === id);
      if (m && !m.ready) return local({ ok: false, reason: m.claimed ? '이미 받았어요' : '아직 완료하지 않았어요' });
      return guard(async () => {
        const r = await counterClaim(() => cloud.mission(id));
        const res = E.claimMission(id, true);
        E.setWallet(r.wallet);
        onChange();
        return res.ok ? res : { ok: true, id, bonus: r.bonus };
      });
    };
    // 광고 보기 (광고 SDK 연결 전: 바로 지급). 서버가 하루 5번·간격 30초를 확인 (SDK를 붙이면 서버 확인으로)
    let lastAdAt = 0;
    Y.watchAd = () => {
      if (!online) return local(E.watchAd());
      if (E.adsLeft() <= 0) return local({ ok: false, reason: '오늘 광고는 다 봤어요' });
      if (Date.now() - lastAdAt < G.Rewards.REW.ad.gapSec * 1000) return local({ ok: false, reason: ERR.ad_wait });
      return guard(async () => {
        const r = await cloud.reward({ kind: 'ad' });
        lastAdAt = Date.now();
        const res = E.watchAd(true);
        E.setWallet(r.wallet);
        onChange();
        return res;
      });
    };
    Y.claimAchievement = (id) => {
      if (!online) return local(E.claimAchievement(id));
      const a = E.achievements().find((x) => x.id === id);
      if (!a || !a.ready) return local({ ok: false, reason: a && a.claimed ? '이미 받았어요' : '아직 달성하지 않았어요' });
      const eqAch = a.stat.startsWith('eq_'); // 장비 업적: 지금 장착을 같이 보냄 (서버 아이템인지 서버가 확인)
      return guard(async () => {
        const r = await counterClaim(() => cloud.reward({ kind: 'ach', id, ...(eqAch ? { equipped: equippedIds() } : {}) }));
        const res = E.claimAchievement(id, true);
        E.setWallet(r.wallet);
        onChange();
        return res;
      });
    };

    // ----- 튜토리얼 포스트잇: 서버 모드면 서버가 순서·층 조건을 확인하고 지급 (원장 ref guide:k / floor:N) -----
    Y.guideClaim = () => {
      if (!online) return local(E.guideClaim());
      const g = E.guideInfo();
      if (!g) return local({ ok: false, reason: '더 받을 포스트잇이 없어요' });
      if (!g.done) return local({ ok: false, reason: '아직 다 하지 않았어요' });
      // 서버가 진행 장부(최고 층·카운터·근로 강화 레벨·장착 칸)로 확인 → 쌓인 기록 + 지금 장착을 먼저 보냄 (장착 조건이면 빈 묶음이라도)
      const force = !g.server && /장착/.test(g.text || '');
      return Y.flushKills(force).then(() => serial(() => guard(async () => {
        let r;
        try { r = await cloud.guide(g.k); } catch (e) {
          if (e.code === 'already_claimed' && e.extra && Number.isInteger(e.extra.step)) { E.setGuideStep(e.extra.step); onChange(); }
          if (e.code === 'not_reached') { try { await refreshInventory(); } catch (e2) { /* 다음 접속 때 */ } }
          throw e;
        }
        const res = E.guideClaim(true);
        if (Number.isInteger(r.step)) E.setGuideStep(r.step);
        E.setWallet(r.wallet);
        onChange();
        return res.ok ? res : { ok: true, k: g.k, bonus: r.bonus, pass: r.pass };
      })));
    };

    // ----- 사내 게시판: 공지는 서버 표(정식판) 또는 고정 공지(테스트판). 확률표는 기기가 규칙 파일로 만듦 -----
    let boardLatest = 0; // 서버의 가장 최근 공지 id (빨간 점)
    let serverRatesVer = null; // 서버 규칙 파일로 만든 확률표 버전
    Y.board = {
      latest: () => (online ? boardLatest : G.Board.latestId(G.Board.LOCAL)),
      // 폰이 옛 버전이라 서버와 확률표가 다르면 true → "앱을 업데이트해 주세요"
      outdated: () => online && typeof serverRatesVer === 'string' && serverRatesVer !== G.Rates.version(),
      list: () => (online ? guard(async () => {
        const r = await cloud.board();
        const list = G.Board.clean(r.notices);
        boardLatest = Math.max(boardLatest, G.Board.latestId(list));
        if (typeof r.ratesVer === 'string') serverRatesVer = r.ratesVer;
        return { ok: true, list };
      }) : local({ ok: true, list: G.Board.clean(G.Board.LOCAL) })),
    };

    // 이직 보상은 서버가 합격 때 바로 지급 (op career apply, 지갑은 그 응답으로)
    // 신기록 보스: 서버 모드에선 처치 묶음을 서버가 인정할 때 서버가 바로 지급 (지갑은 그 응답으로 맞춤) → 따로 안 보냄
    Y.bossRecord = () => {};

    // 타워 층 클리어 보상(성과급·짬·도장)은 서버가 기록 (기기에서 미리 더한 값은 서버 값으로 맞춤)
    // 서버는 열림·층을 진행 장부 최고 층으로 확인 → 처치 보고가 늦어 막히면 쌓인 처치를 보내고 한 번 더
    // 서버 층이 폰보다 뒤면(앞 층 보고가 끊김 등) 서버가 아는 다음 층부터 차례로 다시 보냄 → 그 뒤 보상이 계속 막히지 않게 (2026-10-29 버그)
    let towerChain = Promise.resolve();
    async function towerSend(floor) {
      let n = floor;
      let pushed = false;
      for (let i = 0; i < 200; i++) {
        try {
          const r = await cloud.tower(n);
          E.setWallet(r.wallet);
          E.setTowerServer(r.tower);
          if (n >= floor) break;
          n++;
        } catch (e) {
          const x = (e && e.extra) || {};
          if (x.wallet) E.setWallet(x.wallet);
          if ((e.code === 'tower_locked' || e.code === 'not_reached') && !pushed) { pushed = true; await Y.flushKills(); continue; }
          const cur = x.tower && Number.isInteger(x.tower.cur) ? x.tower.cur : null;
          if (e.code === 'bad_floor' && cur !== null && cur < floor && cur + 1 !== n) { n = cur + 1; continue; }
          if (x.tower) E.setTowerServer(x.tower);
          break;
        }
      }
      onChange();
    }
    Y.towerClear = (floor) => {
      if (!online || !cloud.uid()) return Promise.resolve();
      towerChain = towerChain.then(() => towerSend(floor)).catch(() => onChange());
      return towerChain;
    };
    Y.swapAll = () => {
      const n = E.S.corp;
      if (!online) return Promise.resolve(E.buyBonusWithCorp(n));
      if (!(n > 0)) return Promise.resolve({ ok: false, reason: '법카가 부족해요' });
      return guard(async () => {
        const before = E.S.bonus;
        const r = await cloud.swap(n);
        E.setWallet(r.wallet);
        onChange();
        return { ok: true, bonus: E.S.bonus - before };
      });
    };
    // 법카 구매 (실결제 연결 전: 테스트 결제). productId = 서버 PRODUCTS 키
    Y.testCorp = (amount, productId = 'corp_1000') => {
      if (!online) {
        if (productId === G.Meta.STARTER.id) return Promise.resolve(E.buyStarter());
        if (productId === 'monthly_30' && Sub && Sub.setMonthlyForTest) Sub.setMonthlyForTest(G.Meta.PASS.monthlyDays);
        return Promise.resolve(E.devGrant({ corp: amount }));
      }
      return guard(async () => {
        const r = await cloud.purchaseTest(productId);
        E.setWallet(r.wallet);
        if (r.monthly && Sub && Sub.setMonthly) Sub.setMonthly({ until: r.monthly });
        onChange();
        return { ok: true };
      });
    };
    // 개발용 지급: 재산(서버 진행 장부)·짬·도장·조각 모두 서버 (테스트 결제가 켜져 있을 때만)
    Y.devGrant = (g = {}) => {
      if (!online) return local(E.devGrant(g));
      if (!g.gold && !g.jjam && !g.stamps && !g.shards && !g.pass && !g.kaltoe) return local({ ok: true });
      return serial(() => guard(async () => {
        const r = await cloud.devGrant({ gold: g.gold, jjam: g.jjam, stamps: g.stamps, shards: g.shards, pass: g.pass, kaltoe: g.kaltoe });
        E.setWallet(r.wallet);
        econ(r.prog);
        onChange();
        return { ok: true };
      }));
    };
    Y.claimCodex = () => {}; // 도감 보상은 서버가 아이템을 만들 때 지급

    if (!online) {
      Y.hello = async () => null;
      Y.push = async () => {};
      Y.maybePush = () => {};
      Y.towerClear = () => {};
      return Y;
    }

    // ----- 서버 아이템 받아오기: 서버가 원본 (기기 아이템은 옮기지 않음) -----
    // 기존 폰 스킬 한 번 옮기기 (사용자 2026-10-29): 서버 스킬 기록이 완전히 비어 있고({}) 폰에 스킬이 있으면 보유·레벨·카드·조각을 보냄.
    // 서버가 검사하고 한 번만 받음 (그 뒤엔 무시). 연결 실패면 접속을 실패로 → 다음 접속 때 다시 (폰 스킬을 빈 서버 값으로 덮지 않게).
    // 규칙상 거절(조작·이상한 값)이면 서버 값(빈 상태)을 따름
    const skillMoveDue = (inv) => inv.skills && typeof inv.skills === 'object' && Object.keys(inv.skills).length === 0 &&
      (Object.keys(E.S.skills.owned).length > 0 || E.S.skills.tickets.some((t) => t > 0));
    async function moveSkills(inv) {
      if (!skillMoveDue(inv)) return inv;
      try {
        const r = await cloud.skill({ action: 'move', skills: G.Skills.own(E.S.skills) });
        return r && r.ret && r.ret.skills ? { ...inv, skills: r.ret.skills } : inv;
      } catch (e) {
        if (RETRYABLE.has(e && e.code)) throw e;
        return inv;
      }
    }
    async function syncInventory(h) {
      E.setInventory(await moveSkills(h.inv || { items: [] }));
      if (h.inv && Array.isArray(h.inv.codex)) E.setCodex(h.inv.codex); // 도감 보너스도 서버 기록 (서버 능력치와 같게)
      invReady = true;
      flushKills();
    }

    // ----- 세이브 동기화 (설계서 6단계): 클라우드 세이브는 설정·표시용만 (G.State.cloudSave) -----
    // 진행·재화·아이템·미션·업적은 서버 기록이 원본이라 "클라우드 / 이 기기 진행 고르기" 창이 없음.
    // 다른 기기가 먼저 저장했으면(rev 충돌) 그쪽 설정을 합치고 그 rev 위에 다시 저장
    Y.push = async function (retried = false) {
      if (saving || !cloud.uid()) return;
      saving = true;
      let conflict = null;
      try {
        const r = await cloud.save(G.State.cloudSave(E.S), rev);
        rev = r.rev;
        cloud.setMeta({ uid: cloud.uid(), rev });
        lastPush = Date.now();
        Y.lastSyncAt = lastPush;
      } catch (e) {
        if (e.code === 'save_conflict' && e.extra && e.extra.server) conflict = e.extra.server;
      } finally {
        saving = false;
      }
      if (conflict) {
        if (conflict.data) E.applyCloudPrefs(conflict.data);
        rev = conflict.rev;
        cloud.setMeta({ uid: cloud.uid(), rev });
        if (!retried) await Y.push(true);
      }
      onChange();
    };
    let lastHelloTry = 0;
    Y.maybePush = function () {
      // 접속이 실패했으면 아이템을 받아올 때까지 30초마다 다시 시도
      if (!invReady && !helloBusy && Date.now() - lastHelloTry >= 30000) { lastHelloTry = Date.now(); Y.hello().catch(() => {}); return; }
      if (petStartDue()) { Y.petStart().then(() => onChange()); return; }
      if (skillStartDue()) { Y.skillStart().then(() => onChange()); return; }
      if (Date.now() - lastPush >= SAVE_EVERY_MS) Y.push();
    };

    // 접속: 로그인 → 서버 세이브와 맞추기 → 지갑·뽑기·아이템 반영. 서버 기준 경과 시간(초) 반환(없으면 null)
    let helloBusy = false;
    Y.hello = async function () {
      // 시간 제한은 서버 통신에만 (다른 기기 진행 고르기 창을 기다리는 시간은 빼고 — 예전엔 6초 안에 못 고르면
      // "연결할 수 없어요" 화면이 고르기 창 위에 떠서 막혔음, 2026-10-29)
      const net = (p) => withTimeout(p, helloTimeoutMs);
      const run1 = async () => {
        if (!cloud.uid()) await net(cloud.connect());
        if (invReady && Y.pendingKills()) await Y.flushKills(); // 다시 접속: 쌓인 처치를 먼저 보내야 서버 층이 폰과 같음
        const h = await net(cloud.hello());
        const meta = cloud.meta();
        const sameUser = meta.uid === cloud.uid();
        // 다른 기기가 마지막으로 저장했으면 그 설정·본 안내를 합침 (진행은 아래 서버 값, 고르기 창 없음 — 6단계). 장착·스킬 칸은 서버 아이템을 받은 뒤에
        let prefs = null;
        if (h.save) {
          if (!(sameUser && (meta.rev === h.save.rev || rev === h.save.rev))) prefs = h.save.data;
          rev = h.save.rev;
        } else rev = 0;
        cloud.setMeta({ uid: cloud.uid(), rev });
        if (h.sub && Sub) Sub.setServer(h.sub);
        if (Sub && Sub.setMonthly) Sub.setMonthly(h.monthly);
        E.setWallet(h.wallet);
        E.setGachaState(h.gacha && h.gacha.acc, 'acc');
        E.setGachaState(h.gacha && h.gacha.equip, 'equip');
        E.setGachaState(h.gacha && h.gacha.skill, 'skill');
        E.setGachaState(h.gacha && h.gacha.pet, 'pet');
        // 출석·가방: 서버 기록이 원본
        if (h.meta) {
          if (h.meta.att && typeof h.meta.att.start === 'number') {
            E.S.att.start = h.meta.att.start;
            E.S.att.claimed = h.meta.att.claimed.slice();
          }
          if (Number.isInteger(h.meta.bagBuys)) E.S.bagBuys = Math.max(E.S.bagBuys, h.meta.bagBuys);
          if (Number.isInteger(h.meta.guide)) E.setGuideStep(h.meta.guide); // 포스트잇 단계: 서버 기록이 원본
          if (h.meta.tower) E.setTowerServer(h.meta.tower); // 야근 타워 층: 서버 기록이 원본 (어긋나면 보상이 계속 거절되던 것)
        }
        if (h.board) {
          if (Number.isInteger(h.board.latest)) boardLatest = h.board.latest;
          if (typeof h.board.ratesVer === 'string') serverRatesVer = h.board.ratesVer;
        }
        // 진행(층): 서버 장부가 원본. 장부 판(epoch)이 세이브와 다르면 한 번 처음부터 (아이템·재화는 서버라 그대로, 사용자 확정)
        if (h.progress && typeof h.progress.epoch === 'string') {
          if (E.S.progEpoch !== h.progress.epoch) {
            E.resetProgress(h.progress.epoch);
            killQ = []; killQN = 0; killBatch = null; E.taps = 0; clearPending(); qKitSig = null; qKit0 = null; // 처음부터 전의 처치는 버림
          }
          E.applyProgress(h.progress, 'hello');
          econ(h.progress.run); // 재산·근로 강화: 서버 값 (+ 아직 못 보낸 내 기록)
          E.setCareer(h.progress.c); // 이직 횟수·경력·특전·지원 카드·수습: 서버 값
        }
        if (h.counters) E.setCounters(h.counters); // 미션·업적 카운터·받은 업적: 서버 값 (5단계)
        await net(syncInventory(h));
        if (prefs) E.applyCloudPrefs(prefs);
        Y.lastSyncAt = Date.now();
        onChange();
        Y.push();
        return h.elapsedSec;
      };
      helloBusy = true;
      try {
        return await run1();
      } catch (e) {
        onChange();
        throw e;
      } finally {
        helloBusy = false;
      }
    };

    // ----- 계정 -----
    Y.account = {
      uid: () => cloud.uid(),
      isGuest: () => cloud.isGuest(),
      providers: () => cloud.providers(),
      link: (p) => guard(async () => { await cloud.link(p); return { ok: true }; }),
      saveNow: () => guard(async () => { lastPush = 0; await Y.push(); return { ok: cloud.status === 'online' }; }),
      // 서버 계정 삭제 → 기기 진행도 초기화 → 새 게스트로 시작
      remove: () => guard(async () => {
        await cloud.deleteAccount();
        storage.clear();
        E.reset(G.State.freshState());
        E.resetWalletVer();
        invReady = false;
        killQ = []; killQN = 0; killBatch = null; E.taps = 0; clearPending(); qKitSig = null; qKit0 = null;
        rev = 0;
        await cloud.connect();
        await Y.hello();
        return { ok: true };
      }),
    };

    return Y;
  }

  G.createSync = createSync;
})(globalThis.Game = globalThis.Game || {});
