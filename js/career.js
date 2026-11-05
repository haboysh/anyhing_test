// 이직 지원 규칙: 회사 카드 뽑기, 합격 확률, 요구 전투력. DOM·저장·시간 모름, 난수는 rng()만.
// 명세 docs/impl-spec-m2.md 6절. 수치 [임시]는 밸런스팀 조정 대상.
(function (G) {
  'use strict';
  const { F, COMPANY_GRADES, RANKS } = G.Data;

  const CFG = {
    cards: 4,
    refreshMax: 2,
    refreshCost: [50, 150], // 성과급
    // 이직 횟수(이번이 몇 번째 이직인지)별 회사 등급 확률 (%, 좋소→탑티어)
    gradeTable: [
      { from: 1, w: [70, 30, 0, 0, 0, 0, 0] },
      { from: 2, w: [40, 40, 20, 0, 0, 0, 0] },
      { from: 4, w: [0, 30, 40, 25, 5, 0, 0] },
      { from: 7, w: [0, 0, 25, 40, 25, 10, 0] },
      { from: 11, w: [0, 0, 0, 25, 40, 28, 7] },
      { from: 21, w: [0, 0, 0, 0, 30, 45, 25] },
    ],
    firstCards: [0, 0, 1, 1], // 첫 이직: 좋소 2 · 중소 2
    firstMaxRank: 1, // 첫 이직: 인턴·사원만
    maxRank: 11, // 지원 가능한 최고 직급 (사장)
    // 합격 확률 [임시 계수]
    base: 0.5, logK: 0.25, perPrestige: 0.02, prestigeCap: 0.2, perDown: 0.15, perFail: 0.05,
    min: 0.05, max: 0.95, safeIntern: 0.95,
    reqMargin: 0, // 요구 전투력 = 시작 유효 층 기준 (밸런스팀 조정 10 → 0)
    lockFloors: 5, // 전부 불합격하면 최고 층 +5 후 재지원
  };

  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const offsetOf = (grade) => COMPANY_GRADES[clamp(grade | 0, 0, COMPANY_GRADES.length - 1)].offset;

  // 일반 업무(보스 아님) 기준 적 수치
  const enemyHpAt = (f) => 8 * Math.pow(1.14, Math.max(1, f) - 1);
  const enemyDpsAt = (f) => 1.2 * Math.pow(1.125, Math.max(1, f) - 1);

  // 전투력 공식 (엔진이 스탯을 넣어 계산): (10 × 초당 기대 데미지 + 2 × 최대 체력) × (1 + 0.5×멘탈 + 0.2×꿀잠)
  const power = ({ dps, maxHp, mental = 0, sleep = 0 }) => (10 * dps + 2 * maxHp) * (1 + 0.5 * mental + 0.2 * sleep);

  // 그 회사·직급으로 입사할 때 시작 층과 요구 전투력
  // start = 실제 시작 층 (낙하산 특전으로 직급 시작 층보다 높을 수 있음, 엔진이 넘김). 없으면 직급 시작 층
  const startFloor = (rank) => 10 * clamp(rank | 0, 0, CFG.maxRank) + 1;
  function requiredPower(grade, rank, start) {
    const st = Math.max(startFloor(rank), Number.isFinite(start) ? Math.floor(start) : 0);
    const f = offsetOf(grade) + st + CFG.reqMargin;
    return power({ dps: enemyHpAt(f), maxHp: enemyDpsAt(f) * 10 });
  }

  // 이번이 n번째 이직일 때 등급 가중치
  function gradeWeights(n) {
    let row = CFG.gradeTable[0];
    for (const r of CFG.gradeTable) if (n >= r.from) row = r;
    return row.w.slice();
  }
  const pickWeighted = (w, rng) => {
    const total = w.reduce((a, b) => a + b, 0);
    let r = rng() * total;
    for (let i = 0; i < w.length; i++) { if (w[i] > 0 && r < w[i]) return i; r -= w[i]; }
    return w.findIndex((x) => x > 0);
  };
  function pickCompany(grade, rng, exclude) {
    let pool = G.Companies.filter((c) => c.grade === grade && !exclude.has(c.id));
    if (!pool.length) pool = G.Companies.filter((c) => c.grade === grade);
    return pool[Math.min(pool.length - 1, Math.floor(rng() * pool.length))];
  }

  // 회사 카드 4장. prestiges = 지금까지 이직 횟수, curGrade = 지금 회사 등급
  function makeCards(prestiges, curGrade, rng) {
    const used = new Set();
    const cards = [];
    const add = (grade, safe) => { const c = pickCompany(grade, rng, used); used.add(c.id); cards.push({ companyId: c.id, grade: c.grade, safe: !!safe }); };
    if (prestiges === 0) {
      for (const g of CFG.firstCards) add(g, g === 0 && !cards.some((c) => c.safe));
      return cards;
    }
    // 안정 카드: 지금 등급 이하
    add(Math.floor(rng() * (clamp(curGrade, 0, 6) + 1)), true);
    const w = gradeWeights(prestiges + 1);
    while (cards.length < CFG.cards) add(pickWeighted(w, rng), false);
    return cards;
  }

  // 지원 가능한 직급 범위 0..maxRankFor
  const maxRankFor = (prestiges, runMax) =>
    prestiges === 0 ? Math.min(CFG.firstMaxRank, F.rankLevel(runMax)) : Math.min(CFG.maxRank, F.rankLevel(runMax));

  // 합격 확률
  function acceptChance({ playerPower, grade, rank, curGrade, prestiges, fails = 0, safe = false, start }) {
    if (safe && rank === 0) return CFG.safeIntern;
    const req = requiredPower(grade, rank, start);
    let p = CFG.base + CFG.logK * Math.log2(Math.max(1e-9, playerPower) / req);
    p += Math.min(CFG.prestigeCap, CFG.perPrestige * prestiges);
    p += CFG.perDown * Math.max(0, curGrade - grade);
    p += CFG.perFail * fails;
    return clamp(p, CFG.min, CFG.max);
  }

  // 사풍 효과 → {키: 값}. mul 효과는 곱(1+v), add 효과는 더하기
  function traitMods(company) {
    const m = { atk: 1, hp: 1, aspd: 1, regen: 1, rest: 1, gold: 1, career: 1, drop: 1, offline: 1,
      coffeeDur: 1, nightDur: 1, skillCd: 1, bossTime: 1, bossHp: 1, bossDmg: 1, enemyAtk: 1, enemyHp: 1,
      critRate: 0, critDmg: 0, mental: 0 };
    for (const e of (company && company.effects) || []) {
      if (!(e.key in m)) continue;
      if (e.kind === 'add') m[e.key] += e.v; else m[e.key] *= 1 + e.v;
    }
    return m;
  }

  const company = (id) => G.Companies.find((c) => c.id === id) || null;
  const rankName = (r) => RANKS[clamp(r | 0, 0, RANKS.length - 1)];

  G.Career = { CFG, offsetOf, power, startFloor, requiredPower, gradeWeights, makeCards, maxRankFor, acceptChance, traitMods, company, rankName };
})(globalThis.Game = globalThis.Game || {});
