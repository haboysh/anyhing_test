// 출석·미션·야근 타워 규칙 (명세 docs/impl-spec-m2.md 10~12절). DOM·저장 모름, 시간은 인자로 받음.
// 상태 객체를 받아 직접 고치고, 지급할 보상을 돌려줌. 보상 지급(재화 증가)은 엔진이 함.
(function (G) {
  'use strict';

  // ----- 시간 (한국 시간 기준) -----
  const DAY = 86400000;
  const KST = 9 * 3600000;
  const dayNum = (ms) => Math.floor((ms + KST) / DAY);
  const weekNum = (ms) => { const d = dayNum(ms); return d - ((d + 3) % 7); }; // 그 주 월요일의 dayNum
  const monthKey = (ms) => { const t = new Date(ms + KST); return t.getUTCFullYear() * 100 + t.getUTCMonth() + 1; };

  // ----- 출석 (30칸 주기) -----
  const ATT = {
    days: 30,
    maxFills: 5,
    reward(day) {
      if (day === 30) return { bonus: 5000, box: { kind: 'accessory', grade: 4 }, stamps: 200 }; // 전설 장신구 상자
      if (day === 7 || day === 14 || day === 21) return { bonus: 1000, box: { kind: 'equip', grade: 3 }, stamps: 50, kaltoe: 5 }; // 영웅 장비 상자 + 칼퇴권 [임시 ⚖]
      return { bonus: 300, stamps: 10 };
    },
    fillCost: (day) => (day === 7 || day === 14 || day === 21 ? 500 : 100), // 법카 [임시: 큰 보상일]
  };
  const attFresh = () => ({ start: null, claimed: [], fills: 0 });
  // 오늘 기준으로 주기 맞추기 → 오늘 칸 index (0~29)
  function attSync(att, ms) {
    const today = dayNum(ms);
    if (att.start === null || !(today - att.start < ATT.days) || today < att.start) {
      att.start = today; att.claimed = new Array(ATT.days).fill(false); att.fills = 0;
    }
    return today - att.start;
  }
  function attStatus(att, ms) {
    const idx = attSync(att, ms);
    return {
      today: idx + 1,
      days: att.claimed.map((c, i) => ({ day: i + 1, claimed: c, missed: !c && i < idx, today: i === idx, reward: ATT.reward(i + 1), fillCost: ATT.fillCost(i + 1) })),
      fillsLeft: ATT.maxFills - att.fills,
      canClaim: !att.claimed[idx],
    };
  }
  function attClaim(att, ms) {
    const idx = attSync(att, ms);
    if (att.claimed[idx]) return null;
    att.claimed[idx] = true;
    return { day: idx + 1, ...ATT.reward(idx + 1) };
  }
  // 빠진 날 채우기 → { day, cost(법카), reward } 또는 이유 문자열
  function attFill(att, ms, day) {
    const idx = attSync(att, ms);
    const i = day - 1;
    if (!Number.isInteger(day) || i < 0 || i >= idx) return '채울 수 없는 날이에요';
    if (att.claimed[i]) return '이미 받은 날이에요';
    if (att.fills >= ATT.maxFills) return `한 주기에 ${ATT.maxFills}번까지만 채울 수 있어요`;
    return { day, cost: ATT.fillCost(day), reward: ATT.reward(day), commit() { att.claimed[i] = true; att.fills++; } };
  }

  // ----- 미션 -----
  const MIS = {
    unlock: 5, // 최고 층
    reward: { daily: 100, weekly: 400 },
    allReward: { daily: 500, weekly: 1200 },
    allTickets: { daily: { pass: 6 }, weekly: { kaltoe: 10 } }, // 전부 완료: 출입증·칼퇴권 [임시 ⚖]
    defs: [
      { id: 'd_login', scope: 'daily', ev: 'login', need: 1, name: '출근 도장', done: '오늘도 지각은 없다!' },
      { id: 'd_offline', scope: 'daily', ev: 'offline', need: 1, name: '꿀잠 정산', done: '두둑한 방치 보상' },
      { id: 'd_kill', scope: 'daily', ev: 'kill', need: 300, name: '서류 정리', done: '책상이 깨끗해졌다' },
      { id: 'd_enhance', scope: 'daily', ev: 'enhance', need: 3, name: '장비 정비', done: '반짝반짝 빛난다' },
      { id: 'd_pull', scope: 'daily', ev: 'pull', need: 10, name: '지갑 털기', done: '성과급 탕진 완료!' },
      { id: 'w_kill', scope: 'weekly', ev: 'kill', need: 3000, name: '열정 페이', done: '일주일 동안 불태웠어' },
      { id: 'w_boss', scope: 'weekly', ev: 'boss', need: 20, name: '보스 박살', done: '모든 팀장을 굴복시켰다' },
      { id: 'w_coffee', scope: 'weekly', ev: 'coffee', need: 30, name: '카페인 중독', done: '피 대신 아아가 흐른다' },
      { id: 'w_night', scope: 'weekly', ev: 'night', need: 20, name: '철야의 제왕', done: '밤샘 야근 마스터 달성' },
      { id: 'w_upgrade', scope: 'weekly', ev: 'upgrade', need: 200, name: '폭풍 성장', done: '인간계의 한계를 넘어섰다' },
      { id: 'w_pull', scope: 'weekly', ev: 'pull', need: 70, name: '재물운 폭발', done: '성과급 탕진의 재미' },
      { id: 'w_floor', scope: 'weekly', ev: 'floor', need: 100, name: '탑 등반가', done: '구름 위를 걷는 기분' },
    ],
  };
  const misFresh = () => ({ day: null, week: null, prog: {}, claimed: {}, all: {} });
  function misSync(m, ms) {
    const d = dayNum(ms);
    const w = weekNum(ms);
    const resetScope = (scope) => {
      for (const def of MIS.defs) if (def.scope === scope) { delete m.prog[def.id]; delete m.claimed[def.id]; }
      delete m.all[scope];
    };
    if (m.day !== d) { resetScope('daily'); m.day = d; }
    if (m.week !== w) { resetScope('weekly'); m.week = w; }
  }
  function misTrack(m, ms, ev, n = 1) {
    misSync(m, ms);
    for (const def of MIS.defs) {
      if (def.ev !== ev || m.claimed[def.id]) continue;
      m.prog[def.id] = Math.min(def.need, (m.prog[def.id] || 0) + n);
    }
  }
  function misStatus(m, ms) {
    misSync(m, ms);
    const list = MIS.defs.map((def) => ({ ...def, prog: m.prog[def.id] || 0, claimed: !!m.claimed[def.id], ready: (m.prog[def.id] || 0) >= def.need && !m.claimed[def.id] }));
    const allDone = (scope) => list.filter((x) => x.scope === scope).every((x) => x.claimed);
    return { list, all: { daily: { done: allDone('daily'), claimed: !!m.all.daily }, weekly: { done: allDone('weekly'), claimed: !!m.all.weekly } } };
  }
  // 미션 하나 또는 'all:daily' / 'all:weekly' 받기 → 성과급 양 또는 이유
  function misClaim(m, ms, id) {
    misSync(m, ms);
    if (id === 'all:daily' || id === 'all:weekly') {
      const scope = id.slice(4);
      const st = misStatus(m, ms).all[scope];
      if (st.claimed) return '이미 받았어요';
      if (!st.done) return '미션을 모두 완료해야 해요';
      m.all[scope] = true;
      return { bonus: MIS.allReward[scope] };
    }
    const def = MIS.defs.find((d) => d.id === id);
    if (!def) return '없는 미션이에요';
    if (m.claimed[id]) return '이미 받았어요';
    if ((m.prog[id] || 0) < def.need) return '아직 완료하지 않았어요';
    m.claimed[id] = true;
    return { bonus: MIS.reward[def.scope] };
  }

  // ----- 야근 타워 -----
  const TOWER = {
    unlock: 121, // 평생 최고 층
    mainFloor: (n) => 20 + 2 * n, // 타워 n층 = 메인 유효 (20 + 2n)층 보스
    time: 30,
    failsPerDay: 3,
    floorBonus: 100, monthCap: 12000, floorJjam: 2, floorStamps: 3,
    sweepRatio: 0.5,
    // 역대 최고 10층마다 하나씩, 이 순서로 반복
    buffs: [
      { stat: 'atk', per: 1, cap: 20, name: '업무력' },
      { stat: 'hp', per: 1, cap: 20, name: '체력' },
      { stat: 'gold', per: 2, cap: 30, name: '재산 획득' },
      { stat: 'boss', per: 2, cap: 30, name: '보스 데미지' },
      { stat: 'critDmg', per: 2, cap: 30, name: '치명타 데미지' },
      { stat: 'regen', per: 2, cap: 30, name: '체력 회복' },
      { stat: 'offline', per: 1, cap: 15, name: '방치 보상' },
    ],
  };
  const towerFresh = () => ({ month: null, cur: 0, best: 0, bonusMonth: 0, failDay: null, fails: 0 });
  // 달이 바뀌었으면 초기화 + 지난달 최고의 50%까지 소탕 → 소탕 보상 {floors, bonus, jjam}
  function towerSync(t, ms) {
    const mk = monthKey(ms);
    const d = dayNum(ms);
    if (t.failDay !== d) { t.failDay = d; t.fails = 0; }
    if (t.month === mk) return null;
    const first = t.month === null;
    const last = t.cur;
    t.month = mk; t.cur = 0; t.bonusMonth = 0;
    if (first) return null;
    const floors = Math.floor(last * TOWER.sweepRatio);
    let bonus = 0; let jjam = 0; let stamps = 0;
    for (let i = 1; i <= floors; i++) { const r = towerFloorReward(t, i); bonus += r.bonus; jjam += r.jjam; stamps += r.stamps; }
    t.cur = floors;
    return floors > 0 ? { floors, bonus, jjam, stamps } : null;
  }
  // n층을 이번 달 처음 깼을 때 보상 (월 상한 반영, t.bonusMonth 갱신)
  function towerFloorReward(t, n) {
    const bonus = Math.max(0, Math.min(TOWER.floorBonus, TOWER.monthCap - t.bonusMonth));
    t.bonusMonth += bonus;
    if (n > t.best) t.best = n;
    return { bonus, jjam: TOWER.floorJjam, stamps: TOWER.floorStamps };
  }
  // 역대 최고 기록 → 영구 버프 {stat: %}
  function towerBuffs(best) {
    const out = {};
    const n = Math.floor(Math.max(0, best) / 10);
    for (let i = 0; i < n; i++) {
      const b = TOWER.buffs[i % TOWER.buffs.length];
      out[b.stat] = Math.min(b.cap, (out[b.stat] || 0) + b.per);
    }
    return out;
  }

  // ----- 튜토리얼 "사수의 포스트잇" (가이드 퀘스트, 명세 docs/impl-spec-m4.md ①) -----
  // 1~20단계를 순서대로, 그 뒤로는 층 미션(10층마다)이 끝없이. k = 받을 단계 번호 (받은 단계 + 1)
  // val(S) = 지금 값 (기기가 보여주는 진행도). server = 서버가 직접 확인하는 조건 (floor: 서버 진행 장부 최고 층, dept: 서버 부서 장악 기록, prestige: 서버 이직 횟수)
  // 그 밖의 조건(레벨·횟수·장착)도 서버 기록으로 만든 상태(progress.js guideState: 서버 카운터·근로 강화 레벨·장착 칸·장비 뽑기 수)에 같은 val을 돌려 확인 (설계서 5단계)
  const sv = (S, k) => (S && S.stats && typeof S.stats[k] === 'number' ? S.stats[k] : 0);
  const cnt = (o) => (o && typeof o === 'object' ? Object.values(o).filter((v) => v !== null && v !== undefined && v !== false).length : 0);
  const GUIDE = {
    steps: [
      { text: '업무 10개 처리하기', need: 10, val: (S) => sv(S, 'kill'), bonus: 50, go: 'battle' },
      { text: '업무력 Lv.5 만들기', need: 5, val: (S) => S.lv.atk, bonus: 50, go: 'grow' },
      { text: '3층까지 올라가기', need: 3, val: (S) => S.maxStage, bonus: 50, server: 'floor', go: 'battle' },
      { text: '체력 Lv.5 만들기', need: 5, val: (S) => S.lv.hp, bonus: 50, go: 'grow' },
      { text: '아아 수혈 1번 쓰기', need: 1, val: (S) => sv(S, 'skill_coffee'), bonus: 50, go: 'battle' },
      { text: '장비 1개 장착하기', need: 1, val: (S) => cnt(S.equipped), bonus: 100, go: 'equip' },
      { text: '10층 보스 잡고 11층 가기', need: 11, val: (S) => S.maxStage, bonus: 100, server: 'floor', go: 'battle' },
      { text: '출석 도장 받기', need: 1, val: (S) => Math.max(sv(S, 'att'), S.att && Array.isArray(S.att.claimed) && S.att.claimed.some(Boolean) ? 1 : 0), bonus: 100, go: 'att' },
      { text: '장비 뽑기 1번 하기', need: 1, val: (S) => (S.gacha && S.gacha.equip ? S.gacha.equip.count : 0), bonus: 100, go: 'shop' },
      { text: '미션 보상 1번 받기', need: 1, val: (S) => sv(S, 'mis_claim'), bonus: 100, go: 'mis' },
      { text: '장비 강화 1번 하기', need: 1, val: (S) => Math.max(sv(S, 'enhance'), (S.items || []).some((it) => it.plus > 0) ? 1 : 0), bonus: 100, go: 'equip' },
      { text: '멘탈 Lv.1 만들기', need: 1, val: (S) => S.lv.mental, bonus: 100, go: 'grow' },
      { text: '야근 모드 1번 쓰기', need: 1, val: (S) => sv(S, 'skill_night'), bonus: 100, go: 'battle' },
      { text: '20층까지 올라가기', need: 20, val: (S) => S.maxStage, bonus: 150, server: 'floor', go: 'battle' },
      { text: '업무 스킬 1개 장착하기', need: 1, val: (S) => cnt(S.skills && S.skills.slots), bonus: 150, go: 'skill' },
      { text: '장비 합성 1번 하기', need: 1, val: (S) => sv(S, 'merge'), bonus: 150, go: 'equip' },
      { text: '퇴근 후 정산 1번 받기', need: 1, val: (S) => sv(S, 'offline'), bonus: 150, go: 'battle' },
      { text: '30층 장악전 이기기', need: 1, val: (S) => (S.dept ? S.dept.conquered : 0), bonus: 200, pass: 3, server: 'dept', go: 'office' },
      { text: '외부 미팅 1번 하기', need: 1, val: (S) => sv(S, 'meeting'), bonus: 200, go: 'office' },
      { text: '이직 1번 하기', need: 1, val: (S) => S.prestiges, bonus: 300, server: 'prestige', go: 'quit' },
    ],
    floorEvery: 10, // 20단계 뒤: 층 미션 (10층마다)
    floorBonus: (f) => 50 + Math.floor(f / 2), // [임시 ⚖]
    maxK: 20 + 2000, // 층 미션 2만 층까지
  };
  // k단계 정의 → {k, text, need, val, bonus, pass, server, go, ref, floor?}. 없는 k면 null
  function guideDef(k) {
    if (!Number.isInteger(k) || k < 1 || k > GUIDE.maxK) return null;
    const n = GUIDE.steps.length;
    if (k <= n) return { k, pass: 0, ...GUIDE.steps[k - 1], ref: `guide:${k}` };
    const floor = GUIDE.floorEvery * (k - n);
    return { k, text: `${floor}층까지 올라가기`, need: floor, val: (S) => S.maxStage, bonus: GUIDE.floorBonus(floor), pass: 0, server: 'floor', go: 'battle', ref: `floor:${floor}`, floor };
  }
  // 기기 진행도 → {cur, done}
  function guideProgress(S, k) {
    const d = guideDef(k);
    if (!d) return null;
    let cur = 0;
    try { cur = Number(d.val(S)) || 0; } catch (e) { cur = 0; }
    return { cur: Math.min(cur, d.need), done: cur >= d.need };
  }
  // 서버 확인: ctx = {savedMax, conquered, prestiges, S?} (서버 기록). S = 서버 기록으로 만든 상태 → 나머지 조건(레벨·횟수·장착)도 같은 val로 확인.
  // 통과면 null, 아니면 오류 코드
  function guideServerCheck(k, ctx) {
    const d = guideDef(k);
    if (!d) return 'bad_step';
    const num = (v) => (Number.isFinite(v) ? v : 0);
    if (d.server === 'floor' && num(ctx.savedMax) < d.need) return 'not_reached';
    if (d.server === 'dept' && num(ctx.conquered) < 1) return 'not_reached';
    if (d.server === 'prestige' && num(ctx.prestiges) < 1) return 'not_reached';
    if (!d.server && ctx.S && !guideProgress(ctx.S, k).done) return 'not_reached';
    return null;
  }

  G.Meta = {
    dayNum, weekNum, monthKey,
    GUIDE, guideDef, guideProgress, guideServerCheck,
    ATT, attFresh, attSync, attStatus, attClaim, attFill,
    MIS, misFresh, misSync, misTrack, misStatus, misClaim,
    TOWER, towerFresh, towerSync, towerFloorReward, towerBuffs,
  };
})(globalThis.Game = globalThis.Game || {});
