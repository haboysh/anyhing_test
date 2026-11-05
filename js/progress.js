// 진행(층)·재산 장부 규칙 — 서버가 최고 층·이번 회차 최고 층·지금 층·재산(원)·근로 강화 레벨의 원본 (docs/server-authority-plan.md 1~3단계)
// 폰은 싸우는 화면, 서버는 장부: 폰이 10초마다 보내는 처치 묶음을 서버가 "서버가 아는 능력치로 낼 수 있는 데미지 예산" 안에서만 인정.
//   - 예산 = 누적 통 (최대 초당 데미지 × 여유 1.3, 통 크기 3분 치). 처치마다 그 적 체력만큼 뺌. 단마리 시간 재기는 안 씀 (설계서 1절)
//   - 탭 = 평타 한 대, 폰이 보고한 탭 수를 초당 50번까지만 인정 (사용자 확정)
//   - 층: 처치는 서버 이번 회차 최고 층(top) 이하만. top 층에서 일반 8마리(보스 층은 보스 1번) + 생존 확인(2배 여유) → top+1
//   - 재산(run.gold): 서버가 인정한 처치(서버 능력치의 처치 보상)·법인카드 찬스(쿨타임 상한)·방치·부서 생산·분해로만 늘고,
//     근로 강화(묶음 안의 "샀다" 기록을 순서대로)·장비 강화·감정·도장 구매·스킬 숙련·반려 합치기는 서버 재산에서 뺌 (3단계)
//   - 근로 강화 레벨(run.lv)도 서버 값: 묶음의 {u: 종류, n: 레벨 수} 기록을 순서대로 서버 재산으로 삼. 모자라면 거기서 멈춤(폰은 서버 값으로 되돌림)
//   - 이직·회사·직급 지원·경력·특전·수습·이직 카드·새로고침도 서버 값 (4단계): careerOp — 같은 engine.js 규칙을 서버 장부로 만든 엔진에서 실행,
//     합격 판정·카드 뽑기는 서버 난수. 새 회차는 서버가 만듦 (폰이 보낸 회차 표시로는 새 회차를 시작하지 않음, 첫 회차만 예외)
//   - 미션·업적·포스트잇 카운터도 서버 값 (5단계): 서버가 인정한 처치·보스·층·근로 강화·번아웃·뽑기·강화·정산·출석으로 직접 셈 (st 평생 기록, mis 일일·주간 미션).
//     폰 보고는 둘뿐 — 아아·야근 사용 수(서버 시간 ÷ 쿨타임 통 안에서만)와 적 종류별 처치(그 묶음에서 인정한 일반 처치 수 안에서만)
// 장비·스킬·반려·인맥·부서·타워·도감·뽑기 레벨은 이미 서버 기록. 테스트판(서버 없음)은 이 파일을 안 씀 (기기 엔진 그대로)
// 필요: Game.Data, Items, Equipment, Career, Skills, Pets, Net, Depts, Meta, State, createEngine 이 먼저 로드돼 있어야 함 (서버도 같은 파일)
(function (G) {
  'use strict';
  const D = G.Data;
  const F = D.F;
  const UP = D.UPGRADES;
  const PERKS = D.PERKS;

  const CFG = {
    EPOCH: 'p1', // 이 장부가 생긴 판 (폰 세이브가 이 값이 아니면 진행을 한 번 처음부터 — 아이템·재화는 서버라 그대로, 사용자 확정 "처음부터")
    margin: 1.5, // 데미지 예산 여유 (사용자 확정 1.3 → 2026-11-03 1.5)
    bucketSec: 180, // 통 크기 = 최대 초당 데미지 3분 치 (보스·스킬 몰아 쓰기)
    firstSec: 60, // 새 장부: 60초 전에 시작한 것으로 (첫 묶음 몫. 통을 가득 채워 주지 않음)
    tapMax: 50, // 탭 인정 상한 (초당, 사용자 확정)
    survive: 2, // 생존 확인 여유 (버티는 시간 × 2 ≥ 최소 처치 시간, 처치 속도는 아아·야근이 켜진 순간 최대 — 7단계)
    goldTol: 1e-6, // 근로 강화 살 때 재산 비교 여유 (폰·서버 소수점 차이로 정직한 MAX 구매가 막히지 않게)
    maxKits: 100, // 한 묶음 장착 바꿈 기록 상한
    maxUpN: 100000, // 한 묶음에 살 수 있는 근로 강화 레벨 수 (계산량 상한)
    subSpeed: 2, // 구독 2배속 (서버 기록으로 구독 중일 때만)
    seenRuns: 6, // 기억하는 회차 표시 수 (옛 회차 처치는 거절)
    recentReqs: 8, // 같은 묶음 재전송 확인용 최근 요청 ID
    probation: { floors: 10, burnouts: 5 }, // 수습 (engine PROBATION과 같음, 테스트가 확인)
    burnRest: F.REST_MIN, // 번아웃 보고 상한: 서버 시간 ÷ 최소 휴식(초) + 1
    maxGold: 1e300,
    skillBucketSec: 180, // 아아·야근 사용 보고 통 = 1번 + 3분 치 (쿨타임마다 1번)
    // 처치 수 통 (7단계 보안 점검 S2): 적은 한 번에 한 마리, 처치 뒤 다음 적까지 SPAWN_DELAY(0.05초) → 사람이 아무리 빨라도 게임 1초에 20마리.
    //   데미지 예산만 보면 아주 센 계정은 낮은 층에서 초당 수백만 마리를 우길 수 있었음(재산 5~16배·처치 업적·미션 바로). 칼퇴 선언 몫(x)은 따로
    killRate: 1 / F.SPAWN_DELAY, // 게임 1초에 최대 처치 수
    killMargin: 1.3, // 처치 수 여유 (프레임 끊김·탭 타이밍)
  };
  const RUN_ID_RE = /^r[0-9a-z]{4,24}$/; // state.js와 같음
  const OFFSETS = D.COMPANY_GRADES.map((g) => g.offset);
  // 이직 업적 기록 (서버가 셈 → 업적 받기도 서버 기록으로 확인). true = 최댓값 기록
  const CAREER_STATS = { prestige: false, career_gain: false, co_grade: true, escape_jot: false };
  // 서버가 세는 평생 기록 전체 (업적 조건 + 포스트잇 조건, rewards.js) — 5단계
  const STATS = () => G.Rewards.SERVER_STATS();
  const SKILL_KEYS = Object.keys(D.SKILLS); // 아아·야근 (사용 수 = 폰 보고, 쿨타임 상한)
  const ENEMY_KEYS = [...new Set(D.ENEMIES.map((e) => e[0]))]; // 일반 적 종류 (그림만 다름)

  const isInt = Number.isInteger;
  const num = (v, d = 0) => (typeof v === 'number' && isFinite(v) && v >= 0 ? v : d);
  const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

  // ----- 장부 모양 -----
  const LV0 = () => G.State.freshState(0).lv;
  const PERK0 = () => G.State.freshState(0).perk;
  // pb = 수습 {n: 번아웃 수, f: 탈락}, nw = 서버가 막 만든 회차 (첫 묶음에서 법인카드 쿨타임 초기화)
  const runFresh = () => ({ id: null, co: null, o: 0, start: 1, top: 1, prog: 0, last: 1, gold: 0, lv: LV0(), kit: null, pb: { n: 0, f: false }, nw: 0 });
  // v 2 = 재산·근로 강화 레벨이 서버 원본 (3단계). v 1 장부의 run.gold는 "번 재산 추정"이라 잔액으로 못 씀 → 0원, 레벨은 그때 상한으로 자른 값
  // v 3 = 이직·경력·특전이 서버 원본 (4단계): career(쓸 수 있는 경력), perk(특전 레벨), pres(이직 횟수), st(이직 업적 기록), rw(이직 보상 {d: 날, n: 그날 받은 수}), ap(지원 카드·불합격·잠금·새로고침)
  // v 4 = 미션·업적 카운터 (5단계): st(평생 기록 전체), mis(일일·주간 미션 {day, week, prog, claimed, all}), cs(뽑기 일반 연속), ach(서버가 지급한 업적),
  //   ad(광고 {d: 날, n: 그날 수, t: 마지막 시각}), af(출석 채우기 {s: 주기 시작, n: 채운 수})
  const misFresh = () => ({ day: null, week: null, prog: {}, claimed: {}, all: {} });
  const fresh = () => ({ v: 4, epoch: CFG.EPOCH, max: 1, bossRec: 0, career: 0, perk: PERK0(), pres: 0, st: {}, rw: { d: null, n: 0 }, ap: G.State.cleanApply(null),
    mis: misFresh(), cs: 0, ach: [], ad: { d: null, n: 0, t: 0 }, af: { s: null, n: 0 },
    run: runFresh(), seen: [], b: null, reqs: [] });
  // DB에서 읽은 값 → 올바른 장부 (없거나 이상하면 새 장부)
  function clean(raw) {
    const P = fresh();
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return P;
    const pos = (v, d) => (isInt(v) && v >= 1 ? v : d);
    P.max = pos(raw.max, 1);
    P.bossRec = isInt(raw.bossRec) && raw.bossRec >= 0 ? raw.bossRec : 0;
    const r = raw.run && typeof raw.run === 'object' ? raw.run : {};
    const v1 = raw.v !== 2 && raw.v !== 3 && raw.v !== 4;
    const kit = r.kit && typeof r.kit === 'object' ? r.kit : null;
    if (raw.v === 3 || raw.v === 4) {
      P.career = Math.min(CFG.maxGold, num(raw.career));
      P.perk = cleanPerk(raw.perk);
      P.pres = isInt(raw.pres) && raw.pres >= 0 ? Math.min(raw.pres, 1e6) : 0;
      P.ap = G.State.cleanApply(raw.ap);
    } else {
      // 예전 장부(3단계까지): career는 "받을 수 있었던 경력 상한"의 합 → 서버가 자르던 특전(run.kit.perk)을 그대로 두고 남은 만큼을 잔액으로. 이직 횟수는 서버 기록이 없어 0부터
      const cap = num(raw.career);
      P.perk = scaleDown(cleanPerk(kit && kit.perk), PERK0(), perkSum, cap);
      P.career = Math.max(0, cap - perkSum(P.perk));
    }
    const st = raw.st && typeof raw.st === 'object' ? raw.st : {};
    for (const k of Object.keys(STATS())) if (num(st[k]) > 0) P.st[k] = Math.min(CFG.maxGold, num(st[k]));
    P.mis = cleanMis(raw.mis);
    P.cs = isInt(raw.cs) && raw.cs >= 0 ? Math.min(raw.cs, 1e6) : 0;
    P.ach = Array.isArray(raw.ach) ? [...new Set(raw.ach.filter((id) => typeof id === 'string' && has(G.Rewards.ACH_BY_ID, id)))] : [];
    if (raw.ad && typeof raw.ad === 'object') P.ad = { d: isInt(raw.ad.d) ? raw.ad.d : null, n: isInt(raw.ad.n) && raw.ad.n >= 0 ? Math.min(raw.ad.n, 99) : 0, t: num(raw.ad.t) };
    if (raw.af && typeof raw.af === 'object') P.af = { s: isInt(raw.af.s) ? raw.af.s : null, n: isInt(raw.af.n) && raw.af.n >= 0 ? Math.min(raw.af.n, 99) : 0 };
    if (raw.rw && typeof raw.rw === 'object' && isInt(raw.rw.d)) P.rw = { d: raw.rw.d, n: isInt(raw.rw.n) && raw.rw.n >= 0 ? raw.rw.n : 0 };
    const pb = r.pb && typeof r.pb === 'object' ? r.pb : {};
    P.run = {
      id: typeof r.id === 'string' && RUN_ID_RE.test(r.id) ? r.id : null,
      co: isInt(r.co) && G.Career.company(r.co) ? r.co : null,
      o: 0, start: pos(r.start, 1), top: pos(r.top, 1), prog: isInt(r.prog) && r.prog >= 0 && r.prog < F.KILLS_PER_STAGE ? r.prog : 0,
      last: pos(r.last, 1), gold: v1 ? 0 : Math.min(CFG.maxGold, num(r.gold)),
      lv: v1 ? cleanLv(kit && kit.lv, P.max) : cleanLv(r.lv, P.max), kit,
      pb: { n: isInt(pb.n) && pb.n >= 0 ? Math.min(pb.n, 99) : 0, f: pb.f === true }, nw: r.nw === 1 ? 1 : 0,
    };
    const co = G.Career.company(P.run.co);
    P.run.o = G.Career.offsetOf(co ? co.grade : 0);
    P.seen = Array.isArray(raw.seen) ? raw.seen.filter((x) => typeof x === 'string' && RUN_ID_RE.test(x)).slice(-CFG.seenRuns) : [];
    if (raw.b && typeof raw.b === 'object') {
      const su = raw.b.su && typeof raw.b.su === 'object' ? raw.b.su : {};
      P.b = { t: num(raw.b.t), d: num(raw.b.d), x: num(raw.b.x), g: num(raw.b.g), gk: typeof raw.b.gk === 'string' ? raw.b.gk.slice(0, 200) : '', gt: num(raw.b.gt),
        su: Object.fromEntries(SKILL_KEYS.filter((k) => typeof su[k] === 'number').map((k) => [k, su[k] === -1 ? -1 : Math.min(1e6, num(su[k]))])) };
      if (typeof raw.b.c === 'number') P.b.c = num(raw.b.c); // 처치 수 통 (없으면 begin이 60초 치로 시작)
    }
    P.reqs = Array.isArray(raw.reqs) ? raw.reqs.filter((x) => typeof x === 'string').slice(-CFG.recentReqs) : [];
    return P;
  }
  // 폰에 돌려주는 모양 (c = 이직·경력·특전, 4단계)
  const view = (P) => ({
    epoch: P.epoch, max: P.max, bossRec: P.bossRec,
    run: { id: P.run.id, co: P.run.co, o: P.run.o, start: P.run.start, top: P.run.top, prog: P.run.prog, gold: P.run.gold, lv: { ...P.run.lv } },
    c: careerView(P),
  });
  // 미션 카운터 정리: 있는 미션만, 진행도는 0~목표 정수
  function cleanMis(raw) {
    const m = misFresh();
    if (!raw || typeof raw !== 'object') return m;
    m.day = isInt(raw.day) ? raw.day : null;
    m.week = isInt(raw.week) ? raw.week : null;
    const o = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
    for (const d of G.Meta.MIS.defs) {
      const v = o(raw.prog)[d.id];
      if (isInt(v) && v > 0) m.prog[d.id] = Math.min(d.need, v);
      if (o(raw.claimed)[d.id] === true) m.claimed[d.id] = true;
    }
    for (const sc of ['daily', 'weekly']) if (o(raw.all)[sc] === true) m.all[sc] = true;
    return m;
  }
  // 접속 때 폰에 주는 카운터 (평생 기록·이번 기간 미션·받은 업적). ledger = {ach: 원장에 있는 업적 id, mis: 이번 기간 원장에 있는 미션 id·all:scope}
  function countersView(P, now, ledger) {
    const m = cleanMis(P.mis);
    G.Meta.misSync(m, now);
    const lg = ledger || {};
    for (const id of lg.mis || []) {
      if (id === 'all:daily' || id === 'all:weekly') m.all[id.slice(4)] = true;
      else if (G.Meta.MIS.defs.some((d) => d.id === id)) m.claimed[id] = true;
    }
    return { st: { ...P.st }, mis: m, ach: [...new Set([...P.ach, ...(lg.ach || [])])] };
  }
  // 평생 기록 더하기 (서버가 세는 것만). max = 최댓값 기록
  function addStat(P, k, v = 1, max = false) {
    if (!has(STATS(), k) || typeof v !== 'number' || !isFinite(v) || v <= 0) return;
    const cur = num(P.st[k]);
    P.st[k] = Math.min(CFG.maxGold, max ? Math.max(cur, v) : cur + v);
  }
  // 일일·주간 미션 진행 (서버 시계, 같은 meta.js 규칙)
  const track = (P, ev, n, now) => { if (n > 0) G.Meta.misTrack(P.mis, now, ev, n); };
  // 뽑기 기록 (engine gachaStats와 같게): 뽑기 수·성과급 쓴 양·일반 연속
  function countGacha(P, results, cost, now) {
    const list = Array.isArray(results) ? results : [];
    if (!list.length) return;
    track(P, 'pull', list.length, now);
    addStat(P, 'pull', list.length);
    addStat(P, 'bonus_spent', cost);
    for (const r of list) { P.cs = r && r.grade === 0 ? P.cs + 1 : 0; addStat(P, 'common_streak', P.cs, true); }
  }
  // 장비 업적 (장착 칸 kitEq = {부위: 아이템 id}, 서버 아이템으로만)
  function equipStats(P, items, kitEq) {
    if (!Array.isArray(items) || !kitEq) return;
    const byId = new Map(items.map((it) => [it.id, it]));
    const eq = {};
    for (const slot of G.Items.SLOT_KEYS) { const it = byId.get(kitEq[slot]); eq[slot] = it && it.slot === slot ? it : null; }
    for (const k of Object.keys(G.Items.equipAch(eq))) addStat(P, k, 1, true);
  }
  // 포스트잇 확인용 상태 (meta.js guideServerCheck의 S): 서버 기록만으로. 레벨은 지금 회차와 평생 최고 중 큰 쪽, 장착 칸은 서버가 받은 마지막 장착
  function guideState(P, x = {}) {
    const lv = {};
    for (const k of Object.keys(P.run.lv)) lv[k] = Math.max(P.run.lv[k], num(P.st['lv_' + k]));
    const kit = P.run.kit || {};
    return {
      stats: { ...P.st }, lv, maxStage: P.max, equipped: { ...(kit.eq || {}) }, att: null, items: [],
      gacha: { equip: { count: num(x.equipPulls) } }, skills: { slots: Array.isArray(kit.slots) ? kit.slots.slice() : [] },
      dept: { conquered: num(x.conquered) }, prestiges: P.pres,
    };
  }
  // 미션 받기 확인 (서버 카운터): id = 미션 id 또는 'all:daily'·'all:weekly'. 'all'은 개별 미션을 다 받았는지 원장으로 따로 확인 (index.ts)
  //   → 오류 코드 또는 null. 통과면 P.mis에 받음 표시 (같은 기간 두 번 못 받게 — 동시 요청은 inv_rev로 하나씩)
  function missionClaim(P, id, now) {
    if (P.max < G.Meta.MIS.unlock) return 'not_reached';
    G.Meta.misSync(P.mis, now);
    track(P, 'login', 1, now); // 출근 도장: 오늘 서버에 요청했으면 출근
    if (id === 'all:daily' || id === 'all:weekly') {
      const sc = id.slice(4);
      if (P.mis.all[sc]) return 'already_claimed';
      P.mis.all[sc] = true;
      return null;
    }
    const d = G.Meta.MIS.defs.find((x) => x.id === id);
    if (!d) return 'bad_mission';
    if (P.mis.claimed[id]) return 'already_claimed';
    if (!((P.mis.prog[id] || 0) >= d.need)) return 'not_reached';
    P.mis.claimed[id] = true;
    return null;
  }

  const careerView = (P) => ({
    career: P.career, perk: { ...P.perk }, pres: P.pres, st: { ...P.st },
    ap: { ...P.ap, cards: P.ap.cards ? P.ap.cards.map((c) => ({ ...c })) : null, rejected: P.ap.rejected.slice() },
    pb: { burnouts: P.run.pb.n, failed: P.run.pb.f },
  });

  // ----- 근로 강화 레벨·특전 정리 (둘 다 서버 장부 값) -----
  // 레벨 → 정수·범위·잠금 정리
  function cleanLv(raw, max) {
    const base = LV0();
    const out = {};
    for (const k of Object.keys(base)) {
      let v = raw && isInt(raw[k]) && raw[k] >= base[k] ? raw[k] : base[k];
      if (UP[k].max !== undefined) v = Math.min(v, UP[k].max);
      if (UP[k].unlock !== undefined && max < UP[k].unlock) v = base[k]; // 잠긴 강화 (멘탈 10층·꿀잠 20층, 서버 최고 층)
      out[k] = Math.min(v, 100000);
    }
    return out;
  }
  function lvCost(lv) {
    const base = LV0();
    let c = 0;
    for (const k of Object.keys(base)) for (let l = base[k]; l < lv[k]; l++) { c += UP[k].cost(l); if (c > CFG.maxGold) return Infinity; }
    return c;
  }
  // 살 수 있는 만큼으로 줄임 (모든 강화를 같은 비율로)
  function scaleDown(v, base, costOf, limit) {
    if (costOf(v) <= limit) return v;
    let lo = 0;
    let hi = 1;
    const at = (t) => Object.fromEntries(Object.keys(v).map((k) => [k, Math.max(base[k], Math.floor(base[k] + (v[k] - base[k]) * t))]));
    for (let i = 0; i < 40; i++) { const mid = (lo + hi) / 2; if (costOf(at(mid)) <= limit) lo = mid; else hi = mid; }
    return at(lo);
  }
  function cleanPerk(raw) {
    const base = PERK0();
    const out = {};
    for (const k of Object.keys(base)) {
      let v = raw && isInt(raw[k]) && raw[k] >= 0 ? raw[k] : 0;
      if (PERKS[k].max !== undefined) v = Math.min(v, PERKS[k].max);
      out[k] = Math.min(v, 1000);
    }
    return out;
  }
  const perkSum = (p) => Object.values(p).reduce((a, l) => { let c = 0; for (let i = 0; i < l; i++) c += D.perkCost(i); return a + c; }, 0);

  // ----- 서버가 아는 능력치 (엔진 계산을 그대로: 같은 engine.js) -----
  // c = { kit: {lv, perk, eq: {slot: id}, out, slots}, items(서버 아이템 목록), co, top(유효), max, codex(키 목록), gacha, towerBest, skills, pet, net, dept, now }
  function stateOf(c) {
    const S = G.State.freshState(0);
    const co = G.Career.company(c.co);
    S.company = co ? { id: co.id, grade: co.grade } : { id: null, grade: 0 };
    const o = G.Career.offsetOf(S.company.grade);
    S.lv = c.lv;
    S.perk = c.perk;
    S.runMax = S.stage = S.runStart = S.lastKillStage = Math.max(1, c.top - o);
    S.maxStage = c.max;
    // 장착: 서버 아이템 중 그 부위·가진 것만
    const byId = new Map((c.items || []).map((it) => [it.id, it]));
    const eq = c.eq && typeof c.eq === 'object' ? c.eq : {};
    S.items = [];
    for (const slot of G.Items.SLOT_KEYS) {
      const it = byId.get(eq[slot]);
      if (it && it.slot === slot) { S.equipped[slot] = it.id; S.items.push(it); }
    }
    S.codex = {};
    for (const k of c.codex || []) if (typeof k === 'string') S.codex[k] = true;
    const gc = (k) => ({ count: c.gacha && c.gacha[k] ? num(c.gacha[k].count) : 0, sinceBoost: 0, sincePity: 0 });
    S.gacha = { acc: gc('acc'), equip: gc('equip'), skill: gc('skill'), pet: gc('pet') };
    S.tower = { ...S.tower, best: num(c.towerBest) };
    const sk = c.skills && typeof c.skills === 'object' ? c.skills : {};
    S.skills = G.Skills.clean({ owned: sk.owned, tickets: sk.tickets, granted: sk.granted, slots: c.slots }, S.maxStage);
    S.pet = G.State.cleanPet({ ...G.Pets.clean(c.pet), out: c.out });
    S.net = G.Net.clean(c.net);
    S.dept = G.Depts.clean(c.dept, c.now || 0);
    S.autoSkill = true;
    return S;
  }
  function statsOf(c) {
    const S = stateOf(c);
    const o = G.Career.offsetOf(S.company.grade);
    const E = G.createEngine({ state: S, rng: () => 0.5, now: () => c.now || 0 });
    const atk = E.atkNoSkill();
    const crit = E.critChance();
    const cm = E.critMult();
    const critEV = 1 + crit * (cm - 1);
    // 업무 스킬 (칸에 있는 것, 서버 보유만): 쿨타임마다 한 번씩 쓴다고 보고 초당 데미지(평타 기준 단위)
    let skill = 0;
    let exec = 0; // 칼퇴 선언: 남은 일반 업무를 모두 처리 → 쿨타임마다 8마리까지 예산 없이
    let goldCasts = 0; // 법인카드 찬스: 초당 "처치 보상 몇 번치"
    let goldMax = 0; // 한 번 쓸 때 가장 많은 "처치 보상 몇 번치"
    const goldKeys = [];
    let refreshCd = Infinity; // 주4일제: 아아·야근 쿨타임 초기화
    for (const key of S.skills.slots) {
      if (!key || !S.skills.owned[key]) continue;
      const def = G.Skills.BY_KEY[key];
      const e = def.e;
      const m = G.Skills.lvMult(S.skills.owned[key].lv);
      const cd = Math.max(0.5, E.workSkillCd(key));
      let d = 0;
      if (e.hit) d += e.hit.n * e.hit.pct / 100 * m * (1 + Math.min(1, crit + (e.crit || 0) / 100) * (cm - 1)) * (1 + Math.max(0, e.boss || 0) / 100);
      if (e.dot) d += e.dot.sec * e.dot.pct / 100 * m;
      skill += d * atk / cd;
      if (e.execute) exec += 1 / cd;
      if (e.gold) { goldCasts += e.gold / cd; goldMax = Math.max(goldMax, e.gold); goldKeys.push(key); }
      if (e.refresh) refreshCd = Math.min(refreshCd, cd);
    }
    const up = (k) => (E.skillLocked(k) ? 0 : Math.min(1, E.skillDur(k) / Math.max(0.5, Math.min(E.skillCd(k), refreshCd))));
    const cu = up('coffee');
    const nu = up('night');
    const night = 1 + 2 * nu;
    // 아아(타자 속도 2배)·야근(데미지 3배)이 가장 많이 겹친다고 보고 (둘 다 자동 사용이면 같이 시작)
    const autoMult = 1 + cu + 2 * nu + 2 * Math.min(cu, nu);
    const aps = E.apsNoSkill();
    const rate = atk * critEV * aps * autoMult + skill * night; // 게임 1초당 데미지 (보스 배율 전)
    const tap = atk * critEV * night; // 탭 한 번
    // 순간 최대 (아아·야근이 둘 다 켜진 동안) — 생존 확인용. 이직 직후처럼 쿨타임이 다 찬 채로 높은 층에서 시작하면
    // 정직한 폰은 버프를 켜고 평균보다 2배 넘게 빨리 잡음 (봇: 이직 직후 66층에서 생존 거절 → 7단계에서 고침)
    const cOn = E.skillLocked('coffee') ? 0 : 1;
    const nOn = E.skillLocked('night') ? 0 : 1;
    const nightPeak = 1 + 2 * nOn;
    const ratePeak = atk * critEV * aps * (1 + cOn + 2 * nOn + 2 * Math.min(cOn, nOn)) + skill * nightPeak;
    const tapPeak = atk * critEV * nightPeak;
    return {
      E, o, rate, tap, ratePeak, tapPeak, exec, goldCasts, goldMax, goldKeys: goldKeys.sort().join(','), bossMult: E.bossDmgMult(), hp: E.maxHp(), regen: E.hpRegen(), bossTime: E.bossTime(),
      // 아아·야근 쿨타임 (주4일제 초기화 포함, 잠겼으면 Infinity) — 사용 보고 상한
      skCd: Object.fromEntries(SKILL_KEYS.map((k) => [k, E.skillLocked(k) ? Infinity : Math.max(0.5, Math.min(E.skillCd(k), refreshCd))])),
      hpAt: (f, b) => E.enemyHpAt(f, b), dpsAt: (f, b) => E.enemyDpsAt(f, b), gpk: (f, b) => E.goldPerKill(f, b),
      offGps: (f) => E.offlineGoldPerSec(f),
    };
  }

  // 서버 기록(DB 읽은 값 L)에서 능력치 재료 꺼내기 — invserver.js가 씀. kit = 정리·상한 적용된 폰 장착·레벨
  function ctxOf(P, L, kit, now) {
    return {
      lv: kit.lv, perk: kit.perk, eq: kit.eq, out: kit.out, slots: kit.slots,
      items: itemsOf(L), co: P.run.co, top: P.run.top, max: P.max,
      codex: Array.isArray(L.codex) ? L.codex : [], gacha: L.gacha || {}, towerBest: L.tower && L.tower.best,
      skills: L.skill, pet: L.pet, net: L.net, dept: L.dept, now,
    };
  }
  // 폰이 보낸 장착 → 서버가 믿을 수 있는 만큼 (가진 것만). 근로 강화 레벨·특전은 서버 장부 값(run.lv·perk) — 폰이 보낸 perk는 안 씀 (4단계)
  // 서버 아이템: 전체 목록(L.items) 또는 처치 묶음용 장착 후보만(L.eq_items, inv_load p_eq)
  const itemsOf = (L) => (Array.isArray(L.items) ? L.items : Array.isArray(L.eq_items) ? L.eq_items : []);
  function kitOf(P, L, body) {
    const b = body || {};
    const items = itemsOf(L);
    const byId = new Map(items.map((it) => [it.id, it]));
    const eq = {};
    for (const id of Array.isArray(b.equipped) ? b.equipped.slice(0, 20) : []) {
      const it = isInt(id) ? byId.get(id) : null;
      if (it && !eq[it.slot]) eq[it.slot] = it.id;
    }
    const sk = L.skill && typeof L.skill === 'object' && L.skill.owned && typeof L.skill.owned === 'object' ? L.skill.owned : {};
    const slots = (Array.isArray(b.slots) ? b.slots.slice(0, G.Skills.CFG.slotFloors.length) : []).map((k, i) =>
      (typeof k === 'string' && has(sk, k) && G.Skills.slotOpen(i, P.max) ? k : null));
    const out = typeof b.out === 'string' && G.Pets.owned(G.Pets.clean(L.pet), b.out) ? b.out : null;
    return { lv: P.run.lv, perk: P.perk, eq, out, slots };
  }
  const kitStored = (P) => {
    const k = P.run.kit || {};
    return { lv: P.run.lv, perk: P.perk, eq: k.eq || {}, out: typeof k.out === 'string' ? k.out : null, slots: Array.isArray(k.slots) ? k.slots : [] };
  };
  // 이번 회차 최고 층 처치 보상 (서버 능력치) = 스킬 숙련·반려 합치기·도장 구매 단가 기준 (예전엔 폰이 보낸 base)
  const runKillGold = (P, L, now) => statsOf(ctxOf(P, L, kitStored(P), now)).gpk(P.run.top, false);

  // ----- 새 회차 -----
  // 첫 회차(빈 장부)만 폰의 회차 표시로 시작: 1층·회사 없음 (회사·시작 층은 폰 말을 안 믿음). 그 뒤 새 회차는 careerOp 합격 때 서버가 만듦
  function firstRun(P, id) {
    P.seen = [...P.seen.filter((x) => x !== id), id].slice(-CFG.seenRuns);
    P.run = { ...runFresh(), id };
  }
  // 서버가 만드는 회차 표시 (state.js RUN_ID_RE 모양)
  const newRunId = (rng) => 'r' + Array.from({ length: 12 }, () => '0123456789abcdefghijklmnopqrstuvwxyz'[Math.floor(rng() * 36) % 36]).join('');
  const pbFailed = (P) => P.run.pb.f && P.run.top < P.run.start + CFG.probation.floors;

  // ----- 처치·근로 강화 묶음 한 번 -----
  // P = 장부(clean된 사본, 여기서 고침), L = DB 읽은 값, body = {run: {id}, taps, equipped, slots, out, kit0}, sub = 구독 중
  // 묶음 기록은 폰에서 일어난 순서대로: 처치 {f, b, n, r} → take · 근로 강화 {u: 종류, n: 레벨 수, r} → buy · 법인카드 찬스 재산 {g: 처치 보상 몇 번치, f, r} → cast
  //   · 장착 바꿈 {k} → rekit · 번아웃 {o: 횟수, r} → burn (수습)
  // 이직 직전 회차(서버가 아는 옛 회차) 기록은 거절이 아니라 버림(stale) — 합격 응답을 기다리는 동안 폰이 싸운 몫, 새 회차는 0원부터라 이득 없음
  // → end(): {rejected, reasons, bossRecs, ups(산 레벨 수), upRejected(못 산 레벨 수), stale}
  function begin(P, L, body, now, sub) {
    const b = body || {};
    const want = b.run && typeof b.run === 'object' && typeof b.run.id === 'string' && RUN_ID_RE.test(b.run.id) ? b.run : null;
    // 처음 보는 장부: 폰의 지금 회차 표시로 시작 (1층·회사 없음)
    if (!P.run.id && want && !P.seen.includes(want.id)) firstRun(P, want.id);
    // 묶음 처음 장착: 폰이 보낸 kit0(묶음 시작 때 장착)이 있으면 그것, 없으면 지금 장착. 묶음 안에서 바꾸면 {k} 기록
    const k0 = b.kit0 && typeof b.kit0 === 'object' ? b.kit0 : null;
    let kit = kitOf(P, L, k0 ? { ...b, equipped: k0.equipped, slots: k0.slots, out: k0.out } : b);
    let st = null;
    let survive = new Map();
    // 서버 능력치: 근로 강화를 사거나 승진·회차가 바뀌면 다시 계산
    const stats = () => {
      if (!st) {
        kit = { ...kit, lv: P.run.lv, perk: P.perk };
        st = statsOf(ctxOf(P, L, kit, now));
        survive = new Map();
      }
      return st;
    };
    const restat = () => { st = null; };
    // 통 채우기 (서버 시계)
    const s0 = stats();
    const speed = sub ? CFG.subSpeed : 1;
    const capOf = (s) => CFG.margin * CFG.bucketSec * (s.rate * speed + s.tap * CFG.tapMax);
    const xCapOf = (s) => (s.exec > 0 ? (CFG.bucketSec * s.exec * speed + 1) * F.KILLS_PER_STAGE : 0);
    const gCapOf = (s) => s.goldCasts * CFG.bucketSec * speed + s.goldMax; // 법인카드 찬스: 3분 치 + 한 번
    const B = P.b ? { g: 0, gk: '', ...P.b } : { t: now - CFG.firstSec * 1000, d: 0, x: 0, g: 0, gk: '', c: 0 };
    const t = B.t <= now ? B.t : now;
    const dt = (now - t) / 1000;
    // 처치 수 통: 게임 1초 20마리 × 여유 × 구독 배속, 통 = 3분 치 (능력치와 상관없음 → topUp으로 다시 안 채움)
    const cRate = CFG.killRate * CFG.killMargin * speed;
    if (typeof B.c !== 'number') B.c = CFG.firstSec * cRate; // 예전 장부 (이 통이 생기기 전)
    B.c = Math.min(CFG.bucketSec * cRate, B.c + dt * cRate);
    const taps = Math.min(isInt(b.taps) && b.taps > 0 ? b.taps : 0, CFG.tapMax * dt);
    // 이번 묶음 시간만큼 채움. 묶음 안에서 근로 강화를 사면(빠르게 오르는 구간) 그 능력치로 다시 계산해 모자란 만큼 더 채움 (topUp)
    const refillOf = (s) => CFG.margin * (s.rate * dt * speed + s.tap * taps);
    let gave = refillOf(s0);
    let gaveX = s0.exec * dt * speed * F.KILLS_PER_STAGE;
    let gaveG = s0.goldCasts * dt * speed;
    let capNow = capOf(s0);
    B.d = Math.min(capNow, B.d + gave);
    B.x = Math.min(xCapOf(s0), B.x + gaveX);
    B.g = Math.min(gCapOf(s0), B.g + gaveG);
    // 법인카드 찬스를 새로 칸에 넣었거나(묶음 안 {k} 포함) 새 회차(쿨타임 초기화)면 바로 한 번은 쓸 수 있게.
    // 칸 바꿔 치기로 여러 번 받지 못하게 "새로 넣음" 몫은 쿨타임에 한 번만 (B.gt = 마지막으로 준 서버 시각). 새 회차는 늘 (회차를 바꾸면 재산·레벨이 0부터라 이득 없음)
    // (이번 묶음 시간 몫 gaveG는 바뀐 뒤에 흐른 시간일 수 있어 그 위에 더함 — 많아야 묶음 한 번치 여유)
    const gkCheck = (s, force) => {
      if (!force && s.goldKeys === B.gk) return;
      const cdMs = s.goldCasts > 0 ? (s.goldMax / s.goldCasts) * 1000 / speed : 0;
      if (s.goldMax > 0 && (force || !(now - num(B.gt) < cdMs))) {
        B.g = Math.min(Math.max(B.g, s.goldMax) + gaveG, Math.max(B.g, gCapOf(s)));
        B.gt = now;
      }
      B.gk = s.goldKeys;
    };
    const newRun = P.run.nw === 1;
    gkCheck(s0, newRun); // 서버가 막 만든 회차(이직): 쿨타임 초기화 → 바로 한 번
    P.run.nw = 0;
    B.t = now;
    // 아아·야근 사용 보고 통 (5단계): 쿨타임마다 1번, 통 = 1번 + 3분 치. 잠긴 스킬은 -1 (채우지 않음),
    // 잠겼다가 열리면 바로 1번 (폰은 열리자마자 쿨타임 0이라 바로 씀 — 봇으로 확인)
    const SU = {};
    const givenS = {};
    const suCap = (cd) => 1 + CFG.skillBucketSec / cd;
    for (const k of SKILL_KEYS) {
      const cd = s0.skCd[k];
      let prev = B.su && typeof B.su[k] === 'number' ? B.su[k] : 1;
      if (prev < 0 || newRun) prev = Math.max(prev, 1); // 열림·이직(폰 쿨타임 초기화) → 바로 1번
      givenS[k] = isFinite(cd) ? dt * speed / cd : 0;
      SU[k] = isFinite(cd) ? Math.min(Math.max(prev, suCap(cd)), prev + givenS[k]) : -1;
    }
    // 지금 능력치(이 묶음에서 이미 산 근로 강화까지)로 이번 묶음 시간을 다시 채움 — 빠르게 오르는 구간(10초에 20층 넘게)에서
    // 정직한 플레이가 막히지 않게. 조작으로 얻는 건 "서버 재산으로 산 능력치로 10초 싸운 만큼"까지
    function topUp() {
      const s = stats();
      const want = refillOf(s);
      capNow = Math.max(capNow, capOf(s));
      if (want > gave) { B.d = Math.min(capNow, B.d + want - gave); gave = want; }
      const wantX = s.exec * dt * speed * F.KILLS_PER_STAGE;
      if (wantX > gaveX) { B.x = Math.min(Math.max(xCapOf(s0), xCapOf(s)), B.x + wantX - gaveX); gaveX = wantX; }
      topUpG(s);
    }
    // 법인카드 몫: 묶음 안에서 새로 칸에 넣었으면 그 쿨타임으로 이번 묶음 시간만큼 (묶음 끝에도 한 번 — 다음 묶음으로 이어지게)
    function topUpG(s) {
      const wantG = s.goldCasts * dt * speed;
      if (wantG > gaveG) { B.g = Math.min(Math.max(gCapOf(s0), gCapOf(s)), B.g + wantG - gaveG); gaveG = wantG; }
    }
    const out = { rejected: 0, reasons: {}, bossRecs: [], kills: 0, ups: 0, upRejected: 0, stale: 0, normal: 0, skillRej: 0 };
    const stat = (k, v, max) => addStat(P, k, v, max);
    const mis = (ev, n) => track(P, ev, n, now);
    const rej = (why, n) => { if (n > 0) { out.rejected += n; out.reasons[why] = (out.reasons[why] || 0) + n; } };
    const isBoss = (f) => F.isBoss(f - P.run.o);
    const addGold = (g) => { if (g > 0 && isFinite(g)) P.run.gold = Math.min(CFG.maxGold, P.run.gold + g); };
    // 기록의 회차 표시 r: 지금 회차면 'ok'. 서버가 아는 옛 회차(이직 전)면 'stale'(버림), 모르는 회차는 거절 (새 회차는 careerOp만 만듦)
    function runOk(r, n0) {
      if (r && r === P.run.id) return 'ok';
      if (typeof r === 'string' && P.seen.includes(r)) { out.stale += n0; return 'stale'; }
      rej('run', n0);
      return 'no';
    }
    // 수습 범위(시작 층 +10층)를 넘게 오르면 수습 탈락 해제 + 지원 카드 새로 (engine advance와 같음)
    function probationCheck() {
      if (P.run.pb.f && P.run.top >= P.run.start + CFG.probation.floors) {
        P.run.pb.f = false;
        P.ap = { ...P.ap, cards: null, rejected: [], fails: 0, lockUntil: 0 };
      }
    }
    function canSurvive(s, f, boss) {
      const k = f * 2 + (boss ? 1 : 0);
      if (survive.has(k)) return survive.get(k);
      const killRate = CFG.margin * (s.ratePeak + s.tapPeak * CFG.tapMax) * (boss ? s.bossMult : 1);
      const tk = s.hpAt(f, boss) / Math.max(1e-300, killRate);
      const net = s.dpsAt(f, boss) - s.regen * s.hp;
      const td = net <= 0 ? Infinity : s.hp / net;
      const ok = td * CFG.survive >= tk && (!boss || tk <= s.bossTime);
      survive.set(k, ok);
      return ok;
    }
    function take(k, n0) {
      if (!(n0 > 0)) return 0;
      if (runOk(typeof k.r === 'string' ? k.r : null, n0) !== 'ok') return 0;
      const f = k.f;
      const boss = k.b === 1 || k.b === true;
      if (!isInt(f) || f < 1 + P.run.o || f > P.run.top) { rej('floor', n0); return 0; }
      if (boss !== isBoss(f)) { rej('boss', n0); return 0; }
      let n = 0;
      for (; n < n0; n++) {
        const s = stats();
        if (f === P.run.top && !canSurvive(s, f, boss)) break;
        const cost = s.hpAt(f, boss) / (boss ? s.bossMult : 1);
        if (B.d < cost && !(!boss && B.x >= 1)) topUp();
        if (B.d >= cost && B.c >= 1) { B.d -= cost; B.c -= 1; }
        else if (!boss && B.x >= 1) B.x -= 1; // 칼퇴 선언 (한 번에 남은 일반 업무 전부 — 처치 수 통과 따로)
        else { rej(B.c < 1 ? 'rate' : 'budget', n0 - n); countKills(f, boss, n); return n; }
        addGold(s.gpk(f, boss));
        P.run.last = f;
        if (boss && f > P.bossRec) { P.bossRec = f; out.bossRecs.push(f); }
        if (f === P.run.top) {
          if (!boss) P.run.prog++;
          if (boss || P.run.prog >= F.KILLS_PER_STAGE) {
            P.run.top = f + 1;
            P.run.prog = 0;
            mis('floor', 1);
            P.max = Math.max(P.max, P.run.top);
            probationCheck();
            if (F.rankLevel(P.run.top - P.run.o) !== F.rankLevel(f - P.run.o)) restat(); // 승진 보너스
          }
        }
      }
      if (n < n0) rej('survive', n0 - n);
      countKills(f, boss, n);
      return n;
    }
    // 인정한 처치 → 미션(처치·보스)·평생 기록 (engine onKill과 같게: 일반은 kill, 보스는 그 층 보스 종류)
    function countKills(f, boss, n) {
      if (!(n > 0)) return;
      mis('kill', n);
      if (boss) {
        mis('boss', n);
        const st = f - P.run.o;
        const bk = D.BOSSES[(st / 10 - 1) % D.BOSSES.length];
        if (bk) stat('boss_' + bk[0], n);
      } else { stat('kill', n); out.normal += n; }
    }
    // 근로 강화: 서버 재산으로 한 레벨씩 (같은 UPGRADES.cost). 모자라거나 최대·잠김이면 거기서 멈춤
    let upLeft = CFG.maxUpN;
    function buy(e) {
      const n0 = isInt(e.n) && e.n > 0 ? Math.min(e.n, upLeft) : 0;
      if (isInt(e.n) && e.n > n0) rej('up_many', e.n - n0);
      if (!n0) { if (isInt(e.n) && e.n > 0) out.upRejected += e.n; return 0; }
      const ro = runOk(typeof e.r === 'string' ? e.r : null, n0);
      if (ro !== 'ok') { if (ro === 'no') out.upRejected += n0; return 0; }
      const k = e.u;
      let n = 0;
      if (typeof k !== 'string' || !has(UP, k)) rej('up', n0);
      else if (UP[k].unlock !== undefined && P.max < UP[k].unlock) rej('up_lock', n0); // 멘탈 10층·꿀잠 20층 (서버 최고 층)
      else {
        for (; n < n0; n++) {
          const l = P.run.lv[k];
          if (UP[k].max !== undefined && l >= UP[k].max) { rej('up_max', n0 - n); break; }
          const c = UP[k].cost(l);
          if (!(P.run.gold >= c * (1 - CFG.goldTol))) { rej('gold', n0 - n); break; }
          P.run.gold = Math.max(0, P.run.gold - c);
          P.run.lv[k] = l + 1;
        }
      }
      if (n) { out.ups += n; restat(); mis('upgrade', n); stat('lv_' + k, P.run.lv[k], true); }
      upLeft -= n0;
      out.upRejected += n0 - n + (isInt(e.n) ? e.n - n0 : 0);
      return n;
    }
    // 법인카드 찬스 재산: 칸의 서버 보유 스킬 쿨타임으로 쓸 수 있는 만큼만
    function cast(e) {
      const m = typeof e.g === 'number' && isFinite(e.g) && e.g > 0 ? Math.min(e.g, 1e4) : 0;
      if (!m || runOk(typeof e.r === 'string' ? e.r : null, 1) !== 'ok') return 0;
      const f = e.f;
      if (!isInt(f) || f < 1 + P.run.o || f > P.run.top) { rej('floor', 1); return 0; }
      if (B.g < m) topUp();
      const ok = B.g >= m * (1 - CFG.goldTol) ? m : Math.min(m, B.g); // 쿨타임 경계 소수점 차이 여유
      B.g = Math.max(0, B.g - ok);
      if (ok < m) rej('cast', 1);
      addGold(stats().gpk(f, false) * ok);
      return ok;
    }
    // 장착·특전 바꿈 {k: {equipped, slots, out, perk}}: 그 뒤 기록부터 새 장착으로 계산 (묶음 끝 장착을 묶음 전체에 쓰지 않게 — 재산 장비를 끝에만 끼기 방지)
    let kitLeft = CFG.maxKits;
    function rekit(e) {
      const k = e.k && typeof e.k === 'object' ? e.k : null;
      if (!k || kitLeft <= 0) return 0; // 한 묶음에 장착 바꿈 기록은 상한까지만 (계산량)
      kitLeft--;
      kit = kitOf(P, L, { ...b, equipped: k.equipped, slots: k.slots, out: k.out });
      equipStats(P, itemsOf(L), kit.eq);
      restat();
      gkCheck(stats(), false);
      return 1;
    }
    // 아아·야근 사용 {s: 종류, n}: 폰 보고 → 쿨타임 통 안에서만 미션·업적에 셈 (넘는 보고는 안 셈, 처치 거절과 따로)
    let suTopped = false;
    function use(e) {
      const k = e.s;
      const n0 = isInt(e.n) && e.n > 0 ? Math.min(e.n, 1000) : 0;
      if (!n0 || typeof k !== 'string' || !SKILL_KEYS.includes(k)) return 0;
      if (SU[k] < n0 && !suTopped) {
        // 묶음 안에서 층이 올라 열렸거나(야근 15층) 근로 강화로 쿨타임이 줄었으면 지금 능력치로 다시 채움 (한 묶음에 한 번)
        suTopped = true;
        restat();
        const s = stats();
        for (const j of SKILL_KEYS) {
          const cd = s.skCd[j];
          if (!isFinite(cd)) continue;
          if (SU[j] < 0) SU[j] = 1; // 이 묶음에서 열림
          const want = dt * speed / cd;
          if (want > givenS[j]) { SU[j] = Math.min(Math.max(SU[j], suCap(cd)), SU[j] + want - givenS[j]); givenS[j] = want; }
        }
      }
      const n = Math.max(0, Math.min(n0, Math.floor(SU[k] + 1e-9)));
      if (SU[k] >= 0) SU[k] = Math.max(0, SU[k] - n);
      out.skillRej += n0 - n;
      stat('skill_' + k, n);
      mis(k, n);
      return n;
    }
    // 번아웃 {o: 횟수, r}: 수습(이직한 뒤 시작 층 +10층 안)에서 5번이면 수습 탈락 → 층 조건 없이 재지원·버틸 수 있는 카드 (경력·이직 횟수·보상 없음)
    // 폰 보고라 서버 시간으로 상한 (번아웃마다 최소 휴식 2초, 구독 2배속). 상한을 넘는 보고는 거절로 기록
    let burnLeft = Math.floor(dt * speed / CFG.burnRest) + 1;
    function burn(e) {
      const n0 = isInt(e.o) && e.o > 0 ? Math.min(e.o, 1000) : 0;
      if (!n0 || runOk(typeof e.r === 'string' ? e.r : null, n0) !== 'ok') return 0;
      const n = Math.min(n0, burnLeft);
      burnLeft -= n;
      rej('burn', n0 - n);
      stat('burnout', n);
      // 폰은 번아웃하면 그 층 처치 수를 0으로 되돌림 (후퇴 안 해도) → 서버도 맨 위 층 진행을 0으로 (서버가 폰보다 한 층 앞서가지 않게)
      if (n > 0) P.run.prog = 0;
      const pb = P.run.pb;
      if (P.pres > 0 && !pb.f && P.run.top < P.run.start + CFG.probation.floors) {
        pb.n = Math.min(99, pb.n + n);
        if (pb.n >= CFG.probation.burnouts) {
          pb.f = true;
          P.ap = { ...P.ap, cards: null, rejected: [], fails: 0, lockUntil: 0 };
        }
      }
      return n;
    }
    // 묶음 기록 하나 (모양으로 구분)
    function step(e) {
      if (!e || typeof e !== 'object') return 0;
      if (has(e, 'u')) return buy(e);
      if (has(e, 'g')) return cast(e);
      if (has(e, 'k')) return rekit(e);
      if (has(e, 'o')) return burn(e);
      if (has(e, 's')) return use(e);
      return 0;
    }
    function end() {
      topUpG(stats());
      B.su = SU;
      P.b = B;
      // 다음 묶음·방치·부서 계산용 장착: 서버 회차가 폰 지금 회차면 폰의 지금 값(묶음 끝)
      if (want && want.id === P.run.id) kit = kitOf(P, L, b);
      P.run.kit = { eq: kit.eq, out: kit.out, slots: kit.slots };
      equipStats(P, itemsOf(L), kit.eq);
      // 적 종류별 처치 (그림만 다름): 폰 보고 b.ek = {종류: 수} → 이 묶음에서 인정한 일반 처치 수 안에서만
      const ek = b.ek && typeof b.ek === 'object' && !Array.isArray(b.ek) ? b.ek : {};
      let left = out.normal;
      for (const k of ENEMY_KEYS) {
        const v = isInt(ek[k]) && ek[k] > 0 ? Math.min(ek[k], left) : 0;
        if (v) { stat('kill_' + k, v); left -= v; }
      }
      for (const k of Object.keys(P.run.lv)) stat('lv_' + k, P.run.lv[k], true);
      return out;
    }
    return { take, step, end, stats };
  }

  // ----- 방치·부서 재산 (서버가 계산해 서버 재산에 더함, 폰은 응답 값을 보여줌) -----
  // 퇴근 후 정산: sec(서버가 잰 시간) × 방치 재산 속도(기준 층 f, 서버 이번 회차 최고 층까지)
  function creditOffline(P, L, sec, f, now) {
    if (!(sec > 0)) return 0;
    const s = statsOf(ctxOf(P, L, kitStored(P), now));
    // 기준 층: 폰이 보낸 층(마지막 처치 층)이되 서버가 인정한 마지막 처치 층까지만 (가장 비싼 층을 우겨 넣기 방지)
    const floor = Math.max(1 + P.run.o, Math.min(isInt(f) ? f : P.run.last, P.run.last, P.run.top));
    const g = sec * s.offGps(floor);
    P.run.gold = Math.min(CFG.maxGold, P.run.gold + (isFinite(g) ? g : 0));
    return g;
  }
  // 부서 생산·재산 특근: 방치 몇 시간치 (기준 층 = 마지막 처치 층)
  // 엔진 offlineFloor와 같게: 보스 층이면 한 층 아래
  const creditHours = (P, L, hours, now) => (hours > 0 ? creditOffline(P, L, hours * 3600, isBossAt(P, P.run.last) ? P.run.last - 1 : P.run.last, now) : 0);
  const isBossAt = (P, f) => f - P.run.o > 1 && F.isBoss(f - P.run.o);
  // 아이템 작업으로 생긴 재산 (분해 등) — 서버가 정한 양
  function creditGold(P, g) { if (g > 0 && isFinite(g)) P.run.gold = Math.min(CFG.maxGold, P.run.gold + g); }

  // ----- 이직·경력·특전 (4단계): 서버 장부로 엔진을 만들어 같은 규칙(engine.js applyCards·applyTo·refreshCards·buyPerk)을 서버 난수로 -----
  // 합격 확률은 서버 능력치(서버 아이템·스킬·반려·인맥·특전)로 계산한 입사 직후 전투력 → 폰이 보여준 확률과 조금 다를 수 있음 (서버가 원본)
  function careerEngine(P, L, now, rng) {
    const S = stateOf(ctxOf(P, L, kitStored(P), now));
    const o = G.Career.offsetOf(S.company.grade);
    S.runStart = Math.max(1, P.run.start - o);
    S.runMax = S.stage = S.lastKillStage = Math.max(S.runStart, P.run.top - o);
    S.prestiges = P.pres;
    S.career = P.career;
    S.perk = { ...P.perk };
    S.apply = G.State.cleanApply(P.ap);
    S.probation = { burnouts: P.run.pb.n, failed: P.run.pb.f };
    S.stats = { ...P.st };
    S.bonus = 0; // 이직 보상은 엔진이 S.bonus에 더함 → 원장으로 지급
    S.rew = { ...S.rew, presDay: P.rw.d, pres: P.rw.n };
    return G.createEngine({ state: S, rng, now: () => now });
  }
  // a = {action: cards|refresh|apply|perk, index, rank, co(폰이 본 카드의 회사 id), key, bonus(지갑 성과급)}
  // → {error} | {ret: {ok:false, reason}} | {ret, bonus(이직 보상), cost(새로고침 성과급)}. 성공하면 P를 고침
  function careerOp(P, L, a, now, rng) {
    const E = careerEngine(P, L, now, rng);
    const S = E.S;
    let ret;
    let newRun = false;
    if (a.action === 'cards') {
      if (!E.applyCards()) return { ret: { ok: false, reason: E.applyBlock() } };
      ret = { ok: true };
    } else if (a.action === 'refresh') {
      const block = E.applyBlock();
      if (block) return { ret: { ok: false, reason: block } };
      const cost = E.refreshCost();
      if (cost === null) return { error: 'refresh_max' };
      if (!(a.bonus >= cost)) return { error: 'insufficient_bonus' };
      const r = E.refreshCards(true);
      if (!r.ok) return { ret: r };
      ret = { ok: true, cost };
    } else if (a.action === 'apply') {
      // 폰이 본 카드와 서버 카드가 같아야 (카드 바꿔치기·옛 카드 방지). 합격 여부·확률은 폰 말을 안 씀
      if (!S.apply.cards) return { error: 'no_cards' };
      const c = isInt(a.index) ? S.apply.cards[a.index] : null;
      if (!c || c.companyId !== a.co) return { error: 'bad_card' };
      const r = E.applyTo(a.index, a.rank);
      if (!r.ok) return { ret: r };
      ret = { ok: true, accepted: r.accepted, chance: r.chance, allOut: !!r.allOut, gain: r.gain || 0, bonus: S.bonus };
      newRun = r.accepted;
    } else if (a.action === 'perk') {
      if (typeof a.key !== 'string' || !has(PERKS, a.key)) return { error: 'bad_perk' };
      if (!E.buyPerk(a.key)) return { ret: { ok: false, reason: E.perkMaxed(a.key) ? '이미 최대예요' : '경력이 부족해요' } };
      ret = { ok: true, key: a.key };
    } else return { error: 'bad_action' };
    // 엔진 결과 → 장부
    P.career = Math.min(CFG.maxGold, Math.max(0, S.career));
    P.perk = cleanPerk(S.perk);
    P.pres = S.prestiges;
    // 이직 업적 기록만 엔진 결과로 (나머지 평생 기록은 그대로 — 새로고침 성과급은 invserver가 따로 셈)
    for (const k of Object.keys(CAREER_STATS)) if (num(S.stats[k]) > 0) P.st[k] = num(S.stats[k]);
    if (isInt(S.rew.presDay)) P.rw = { d: S.rew.presDay, n: S.rew.pres | 0 };
    P.ap = G.State.cleanApply(S.apply);
    P.run.pb = { n: S.probation.burnouts | 0, f: S.probation.failed === true };
    if (newRun) {
      // 새 회차: 서버가 회차 표시를 만들고 회사·시작 층(직급 시작과 낙하산 중 큰 쪽 + 회사 보정)을 정함. 재산 0원·근로 강화 처음부터. 평생 최고 층은 깨야 오름
      const co = G.Career.company(S.company.id);
      const o = G.Career.offsetOf(co ? co.grade : 0);
      let id = newRunId(rng);
      while (P.seen.includes(id)) id = newRunId(Math.random);
      const kit = P.run.kit;
      P.seen = [...P.seen, id].slice(-CFG.seenRuns);
      P.run = { ...runFresh(), id, co: co ? co.id : null, o, start: S.stage + o, top: S.stage + o, last: S.stage + o, kit, nw: 1 };
    }
    return { ret: { ...ret, c: careerView(P), progress: view(P) }, bonus: ret.bonus || 0, cost: ret.cost || 0 };
  }

  // 같은 묶음 재전송 확인 (마지막 하나는 invserver가 저장된 응답으로)
  const seenReq = (P, req) => P.reqs.includes(req);
  const markReq = (P, req) => { P.reqs = [...P.reqs.filter((x) => x !== req), req].slice(-CFG.recentReqs); };

  G.Progress = {
    CFG, RUN_ID_RE, OFFSETS, CAREER_STATS, STATS, fresh, clean, view, careerView, cleanLv, lvCost, runKillGold, cleanPerk, perkSum, pbFailed,
    cleanMis, countersView, addStat, track, countGacha, equipStats, guideState, missionClaim, itemsOf,
    stateOf, statsOf, ctxOf, kitOf, kitStored, firstRun, newRunId, begin, careerEngine, careerOp, creditOffline, creditHours, creditGold, seenReq, markReq,
  };
})(globalThis.Game = globalThis.Game || {});
