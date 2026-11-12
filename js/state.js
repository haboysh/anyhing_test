// 저장되는 진행 상황(세이브 데이터)의 모양과 버전 관리
(function (G) {
  'use strict';

  const SAVE_VERSION = 5;
  const I = G.Items;

  // 회차 표시: 'r' + 영문·숫자 (서버가 이 값이 바뀌면 새 회차로 봄)
  const RUN_ID_RE = /^r[0-9a-z]{4,24}$/;
  const newRunId = () => 'r' + Math.random().toString(36).slice(2, 12).padEnd(6, '0');

  function freshState(now = Date.now()) {
    return {
      v: SAVE_VERSION,
      gold: 0, stage: 1, kill: 0, maxStage: 1, runMax: 1, runStart: 1, autoAdvance: true,
      lv: { atk: 1, hp: 1, spd: 0, crit: 0, mental: 0, sleep: 0 },
      perk: { dmg: 0, gold: 0, hp: 0, start: 0 },
      career: 0, prestiges: 0, autoSkill: false, buyMode: 1,
      speedOn: true, // 구독 중일 때 2배속을 쓸지 (끄고 싶을 수도 있으니)
      cd: Object.fromEntries(Object.keys(G.Data.SKILLS).map((k) => [k, 0])),
      lastSave: now,
      // v2: 장비·장신구·뽑기 (이직해도 유지)
      items: [], nextItemId: 1,
      equipped: Object.fromEntries(I.SLOT_KEYS.map((k) => [k, null])),
      preset: 0, presetAlt: Object.fromEntries(I.SLOT_KEYS.map((k) => [k, null])), // 장비 프리셋: 지금 번호(0·1) + 교체용 장착
      bonus: 0, corp: 0, jjam: 0, shards: 0, // 성과급, 법카, 짬, 장신구 조각
      codex: {},
      gacha: { acc: gachaFresh(), equip: gachaFresh(), skill: gachaFresh(), pet: gachaFresh() },
      mergeFail: I.GRADES.map(() => 0), // 등급별 합성 연속 실패
      autoAppraise: true,
      // v3
      company: { id: null, grade: 0 }, // 지금 회사 (id null = 첫 회사, 특성 없음)
      lastKillStage: 1, // 퇴근 후 정산 기준 층
      bagBuys: 0,
      apply: applyFresh(), // 이직 지원 진행 상황
      probation: { burnouts: 0, failed: false }, // 수습: 이직 후 시작 층 +10층 안에서 번아웃 5번이면 수습 탈락 (2026-10-27)
      runId: newRunId(), // 이번 회차 표시 (이직·처음부터 다시 때마다 새로). 서버가 회차별 최고 층·새로고침 횟수를 따로 셈
      unlocked: {}, // 해금 알림을 이미 보여준 것
      settings: { lowPower: false, shake: true, dmgNumbers: true, fx: true },
      att: G.Meta.attFresh(), mis: G.Meta.misFresh(), tower: G.Meta.towerFresh(),
      // 추가 수입원·업적
      rew: rewFresh(), stats: {}, ach: {}, achReady: {},
      market: { list: [], seq: 1, day: null, earned: 0, pending: 0 }, // 양파나라 (판매소)
      stamps: 0, stampShop: { day: null, bought: 0 }, // 결재 도장
      // v4: 부서 장악 묶음 (서버 모드에선 서버 기록의 복사본)
      dept: G.Depts.fresh(), pass: 0, kaltoe: 0, namecard: 0, // 출입증, 칼퇴권, 명함
      petticket: 0, pethero: 0, starter: false, // 반려 뽑기권, 영웅 이상 반려 뽑기권, 첫 결제 패키지 산 적 있는지 (서버 모드면 서버 지갑 복사본)
      skills: G.Skills.fresh(), // 업무 스킬 (보유·숙련·칸·쿨타임, 이직해도 유지)
      // v5 (docs/impl-spec-m4.md 0-4절): 튜토리얼·게시판·인맥·반려. 이직해도 유지
      tut: tutFresh(), // step = 받은 포스트잇 단계 수(서버 모드에선 서버 기록 복사본), intro = 입사 첫날 안내 끝, seen = 본 사수 한마디 키
      board: boardFresh(), // 게시판 빨간 점: seenId = 마지막으로 본 공지 id, seenRates = 본 확률표 버전
      net: G.Net.fresh(), // 인맥: 친분 lv·사이 rank (서버 모드에선 서버 기록 meta_states.net의 복사본)
      pet: petFresh(), // 반려: own·codex·granted는 서버 기록(meta_states.pet) 복사본, out = 책상에 올린 반려 키 (폰)
      progEpoch: '', // 정식판: 서버 진행 장부(progress.js)의 판. 다르면 진행(층·재산·근로 강화·이직·특전)을 한 번 처음부터
    };
  }
  function petFresh() { return { ...G.Pets.fresh(), out: null }; }
  function tutFresh() { return { step: 0, intro: false, seen: {} }; }
  function boardFresh() { return { seenId: 0, seenRates: '' }; }
  function rewFresh() { return { adDay: null, ads: 0, presDay: null, pres: 0, bossRec: 0, commonRun: 0 }; }
  function gachaFresh() { return { count: 0, sinceBoost: 0, sincePity: 0 }; }
  function applyFresh() { return { cards: null, refreshes: 0, rejected: [], fails: 0, lockUntil: 0 }; }

  const num = (v, d) => (typeof v === 'number' && isFinite(v) && v >= 0 ? v : d);
  const int = (v, d) => Math.floor(num(v, d));
  const isInt = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;

  const cleanItem = (it) => G.Equipment.cleanItem(it);

  // 출석·미션·타워: 기본 모양 위에 올바른 타입 값만 덮어씀
  function cleanMeta(v, base) {
    if (!v || typeof v !== 'object') return base;
    const out = { ...base };
    for (const k of Object.keys(base)) {
      const b = base[k];
      const x = v[k];
      if (b === null) out[k] = typeof x === 'number' && isFinite(x) ? x : null;
      else if (Array.isArray(b)) out[k] = Array.isArray(x) ? x.slice() : b;
      else if (typeof b === 'object') out[k] = x && typeof x === 'object' && !Array.isArray(x) ? JSON.parse(JSON.stringify(x)) : b;
      else if (typeof b === typeof x) out[k] = x;
    }
    return out;
  }

  // 예전 세이브를 현재 모양으로 맞춤. 버전이 올라가면 여기에 변환을 추가.
  function migrate(raw) {
    const base = freshState();
    if (!raw || typeof raw !== 'object') return base;
    const oldV = typeof raw.v === 'number' ? raw.v : 1;
    if (oldV < 3 && raw.lv && typeof raw.lv === 'object') {
      // 타자 속도·눈치: 같은 효과가 되도록 레벨 환산 (예전 +0.1회/초, +1.5%p → 지금 +0.006, +0.09%p)
      const lv = { ...raw.lv };
      if (typeof lv.spd === 'number') lv.spd = Math.round(lv.spd * 0.1 / 0.006);
      if (typeof lv.crit === 'number') lv.crit = Math.round(lv.crit * 1.5 / 0.09);
      raw = { ...raw, lv };
    }
    const s = {
      ...base, ...raw,
      lv: { ...base.lv, ...raw.lv },
      perk: { ...base.perk, ...raw.perk },
      cd: { ...base.cd, ...raw.cd },
    };
    for (const k of ['gold', 'stage', 'kill', 'maxStage', 'runMax', 'runStart', 'career', 'prestiges', 'lastSave']) s[k] = num(s[k], base[k]);
    for (const group of ['lv', 'perk', 'cd']) {
      for (const k of Object.keys(s[group])) {
        if (!(k in base[group])) delete s[group][k];
        else s[group][k] = num(s[group][k], base[group][k]);
      }
    }
    for (const k of ['lv', 'perk']) for (const j in s[k]) s[k][j] = Math.floor(s[k][j]);
    for (const k in G.Data.UPGRADES) { const m = G.Data.UPGRADES[k].max; if (m !== undefined) s.lv[k] = Math.min(m, s.lv[k]); }
    if (s.stage < 1) s.stage = 1;
    if (![1, 10, 'max'].includes(s.buyMode)) s.buyMode = 1;
    s.autoAdvance = s.autoAdvance !== false;
    s.autoSkill = s.autoSkill === true;
    s.speedOn = s.speedOn !== false;

    // ----- v2 필드 -----
    for (const k of ['bonus', 'corp', 'jjam', 'shards']) s[k] = int(s[k], 0);
    const seen = new Set();
    s.items = (Array.isArray(raw.items) ? raw.items : []).map(cleanItem).filter((it) => {
      if (!it || seen.has(it.id)) return false; // 잘못된 항목·중복 id 제거
      seen.add(it.id);
      return true;
    });
    const maxId = s.items.reduce((m, it) => Math.max(m, it.id), 0);
    s.nextItemId = Math.max(int(s.nextItemId, 1), maxId + 1, 1);
    // 장착: 없는 id·다른 부위 아이템이면 null
    const eq = raw.equipped && typeof raw.equipped === 'object' ? raw.equipped : {};
    const byId = new Map(s.items.map((it) => [it.id, it]));
    s.equipped = {};
    for (const slot of I.SLOT_KEYS) {
      const it = byId.get(eq[slot]);
      s.equipped[slot] = it && it.slot === slot ? it.id : null;
    }
    const alt = raw.presetAlt && typeof raw.presetAlt === 'object' ? raw.presetAlt : {};
    s.presetAlt = {};
    for (const slot of I.SLOT_KEYS) {
      const it = byId.get(alt[slot]);
      s.presetAlt[slot] = it && it.slot === slot ? it.id : null;
    }
    s.preset = raw.preset === 1 ? 1 : 0;
    // 도감: 올바른 키만 true로
    const codex = raw.codex && typeof raw.codex === 'object' ? raw.codex : {};
    s.codex = {};
    for (const k of Object.keys(codex)) {
      const [type, g] = k.split(':');
      // 정규 키(`종류:등급`)만. 'keyboard1:05'·'ring1:2:x' 같은 키가 도감 보너스를 부풀리지 않게
      if (codex[k] && I.TYPE_BY_ID[type] && /^\d+$/.test(g) && +g < I.GRADES.length && k === `${type}:${+g}`) s.codex[k] = true;
    }
    const gc = (o) => (o && typeof o === 'object' ? { count: int(o.count, 0), sinceBoost: int(o.sinceBoost, 0), sincePity: int(o.sincePity, 0) } : gachaFresh());
    s.gacha = { acc: gc(raw.gacha && raw.gacha.acc), equip: gc(raw.gacha && raw.gacha.equip), skill: gc(raw.gacha && raw.gacha.skill), pet: gc(raw.gacha && raw.gacha.pet) };
    const mf = Array.isArray(raw.mergeFail) ? raw.mergeFail : [];
    s.mergeFail = base.mergeFail.map((d, i) => int(mf[i], d));
    s.autoAppraise = s.autoAppraise !== false;

    // ----- v3 필드 -----
    const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);
    const co = obj(raw.company);
    const comp = co && G.Companies.find((c) => c.id === co.id);
    s.company = comp ? { id: comp.id, grade: comp.grade } : { id: null, grade: 0 };
    s.lastKillStage = Math.max(1, int(raw.lastKillStage, s.stage));
    s.bagBuys = Math.min(I.BAG.maxBuys, int(raw.bagBuys, 0));
    const pb = obj(raw.probation) || {};
    s.probation = { burnouts: Math.min(99, int(pb.burnouts, 0)), failed: pb.failed === true };
    if (s.probation.failed && s.runMax >= s.runStart + 10) s.probation.failed = false; // 수습 범위를 넘게 올라갔으면 해제 (engine PROBATION.floors)
    s.runId = typeof raw.runId === 'string' && RUN_ID_RE.test(raw.runId) ? raw.runId : base.runId;
    s.apply = cleanApply(raw.apply);
    s.unlocked = {};
    for (const k of Object.keys(obj(raw.unlocked) || {})) if (raw.unlocked[k] === true) s.unlocked[k] = true;
    const st = obj(raw.settings) || {};
    s.settings = {};
    for (const k of Object.keys(base.settings)) s.settings[k] = typeof st[k] === 'boolean' ? st[k] : base.settings[k];
    s.att = cleanMeta(raw.att, G.Meta.attFresh());
    if (!Array.isArray(s.att.claimed)) s.att.claimed = [];
    s.att.claimed = s.att.claimed.slice(0, G.Meta.ATT.days).map((x) => x === true);
    s.att.fills = int(s.att.fills, 0);
    s.mis = cleanMeta(raw.mis, G.Meta.misFresh());
    for (const k of ['prog', 'claimed', 'all']) if (!obj(s.mis[k])) s.mis[k] = {};
    s.tower = cleanMeta(raw.tower, G.Meta.towerFresh());
    for (const k of ['cur', 'best', 'bonusMonth', 'fails']) s.tower[k] = int(s.tower[k], 0);
    s.rew = cleanMeta(raw.rew, rewFresh());
    for (const k of ['ads', 'pres', 'bossRec', 'commonRun']) s.rew[k] = int(s.rew[k], 0);
    if (!raw.rew) s.rew.bossRec = Math.max(0, (s.maxStage | 0) - 1); // 예전 세이브: 이미 지난 층은 신기록 아님
    const flags = (v) => { const o = {}; for (const k of Object.keys(obj(v) || {})) if (v[k] === true && G.Rewards.ACH_BY_ID[k]) o[k] = true; return o; };
    s.ach = flags(raw.ach);
    s.achReady = flags(raw.achReady);
    s.stats = {};
    for (const k of Object.keys(obj(raw.stats) || {})) if (typeof raw.stats[k] === 'number' && isFinite(raw.stats[k]) && raw.stats[k] >= 0) s.stats[k] = raw.stats[k];
    const mk = obj(raw.market) || {};
    s.market = {
      list: (Array.isArray(mk.list) ? mk.list : []).filter((r) => r && typeof r.lid === 'string' && isInt(r.grade, 0, I.GRADES.length - 1) && typeof r.done === 'number' && isFinite(r.done))
        .slice(0, I.MARKET.slots).map((r) => ({ lid: r.lid, grade: r.grade, type: String(r.type || ''), plus: int(r.plus, 0), at: num(r.at, 0), done: r.done })),
      seq: Math.max(1, int(mk.seq, 1)),
      day: typeof mk.day === 'number' ? mk.day : null,
      earned: int(mk.earned, 0),
      pending: int(mk.pending, 0),
    };
    s.stamps = int(raw.stamps, 0);
    // ----- v4 필드 -----
    s.dept = G.Depts.clean(raw.dept, Date.now());
    for (const k of ['pass', 'kaltoe', 'namecard', 'petticket', 'pethero']) s[k] = int(raw[k], 0);
    s.starter = raw.starter === true;
    const ss = obj(raw.stampShop) || {};
    s.stampShop = { day: typeof ss.day === 'number' ? ss.day : null, bought: int(ss.bought, 0) };
    s.skills = G.Skills.clean(raw.skills, s.maxStage);
    // ----- v5 필드 -----
    const tu = obj(raw.tut);
    s.tut = {
      step: Math.min(G.Meta.GUIDE.maxK, int(tu && tu.step, 0)),
      // 예전 세이브(진행 있음)는 입사 첫날 안내를 건너뜀
      intro: tu ? tu.intro === true : (s.maxStage > 1 || s.prestiges > 0),
      seen: {},
    };
    for (const k of Object.keys(obj(tu && tu.seen) || {})) if (tu.seen[k] === true && /^[a-z0-9_-]{1,24}$/.test(k)) s.tut.seen[k] = true;
    const bo = obj(raw.board) || {};
    s.board = { seenId: int(bo.seenId, 0), seenRates: typeof bo.seenRates === 'string' ? bo.seenRates.slice(0, 32) : '' };
    s.net = G.Net.clean(raw.net);
    s.pet = cleanPet(raw.pet);
    s.progEpoch = typeof raw.progEpoch === 'string' ? raw.progEpoch.slice(0, 16) : '';
    s.v = SAVE_VERSION;
    return s;
  }

  // ----- 클라우드 세이브 = 설정·표시용만 (설계서 6단계) -----
  // 층·재산·근로 강화·이직·특전·아이템·재화·스킬·반려·인맥·부서·출석·미션·업적·타워·포스트잇 단계는 서버 기록이 원본이라 세이브에 안 넣음
  // (폰은 보낼 때 이 모양으로 줄이고, 서버 save op도 저장하기 전에 같은 함수로 거름 → 세이브를 고쳐 바꿀 수 있는 진행 0)
  // 기기 저장(localStorage)은 그대로 전체 (앱 켤 때 바로 그리기용, 접속하면 서버 값으로 덮음)
  const CLOUD_FLAGS = ['autoAdvance', 'autoSkill', 'speedOn', 'autoAppraise'];
  function cloudSave(raw) {
    const r = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);
    const out = { v: SAVE_VERSION, cloud: 1 };
    const st = obj(r.settings);
    if (st) {
      out.settings = {};
      for (const k of ['lowPower', 'shake', 'dmgNumbers', 'fx']) if (typeof st[k] === 'boolean') out.settings[k] = st[k];
    }
    if ([1, 10, 'max'].includes(r.buyMode)) out.buyMode = r.buyMode;
    for (const k of CLOUD_FLAGS) if (typeof r[k] === 'boolean') out[k] = r[k];
    const flags = (v, re, max) => { const o = {}; for (const k of Object.keys(obj(v) || {}).slice(0, max)) if (v[k] === true && re.test(k)) o[k] = true; return o; };
    out.unlocked = flags(r.unlocked, /^[a-z]{1,16}$/, 32);
    const tu = obj(r.tut);
    out.tut = { intro: !!(tu && tu.intro === true), seen: flags(tu && tu.seen, /^[a-z0-9_-]{1,24}$/, 200) };
    const bo = obj(r.board);
    if (bo) out.board = { seenId: Number.isInteger(bo.seenId) && bo.seenId >= 0 ? bo.seenId : 0, seenRates: typeof bo.seenRates === 'string' ? bo.seenRates.slice(0, 32) : '' };
    const eq = obj(r.equipped);
    if (eq) { out.equipped = {}; for (const slot of I.SLOT_KEYS) out.equipped[slot] = Number.isInteger(eq[slot]) && eq[slot] > 0 ? eq[slot] : null; }
    const pa = obj(r.presetAlt);
    if (pa) { out.presetAlt = {}; for (const slot of I.SLOT_KEYS) out.presetAlt[slot] = Number.isInteger(pa[slot]) && pa[slot] > 0 ? pa[slot] : null; }
    if (r.preset === 0 || r.preset === 1) out.preset = r.preset;
    const sk = obj(r.skills);
    if (sk && Array.isArray(sk.slots)) out.skills = { slots: sk.slots.slice(0, 8).map((k) => (typeof k === 'string' && G.Skills.BY_KEY[k] ? k : null)) };
    const pe = obj(r.pet);
    if (pe) out.pet = { out: typeof pe.out === 'string' && pe.out.length <= 32 ? pe.out : null };
    return out;
  }

  // 반려 정리 + 책상 위 반려가 보유 중이 아니면 비움
  // 이직 지원 진행 (세이브·서버 진행 장부 progress.js가 같이 씀): 카드는 있는 회사만(등급은 회사 표), 숫자는 0 이상 정수
  function cleanApply(raw) {
    const ap = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    const int = (v, d) => (Number.isInteger(v) && v >= 0 ? v : d);
    const cards = Array.isArray(ap.cards) && ap.cards.length ? ap.cards.slice(0, 8).filter((c) => c && G.Companies.some((x) => x.id === c.companyId))
      .map((c) => ({ companyId: c.companyId, grade: G.Companies.find((x) => x.id === c.companyId).grade, safe: c.safe === true })) : null;
    return {
      cards: cards && cards.length ? cards : null,
      refreshes: Math.min(99, int(ap.refreshes, 0)),
      rejected: Array.isArray(ap.rejected) ? ap.rejected.filter(Number.isInteger).slice(0, 8) : [],
      fails: Math.min(99, int(ap.fails, 0)),
      lockUntil: int(ap.lockUntil, 0),
    };
  }

  function cleanPet(raw) {
    const p = { ...G.Pets.clean(raw), out: null };
    const out = raw && typeof raw === 'object' ? raw.out : null;
    if (typeof out === 'string' && G.Pets.owned(p, out)) p.out = out;
    return p;
  }

  G.State = { SAVE_VERSION, RUN_ID_RE, newRunId, freshState, migrate, cleanPet, cleanApply, cloudSave };
})(globalThis.Game = globalThis.Game || {});
