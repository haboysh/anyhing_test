// 장신구 뽑기 규칙: 뽑기 레벨별 확률표, 30회마다 확률업, 신화 천장.
// DOM·저장·시간을 모르고 난수는 인자로 받은 rng()만 씀 → 테스트·서버 검증에 그대로 재사용.
// 등급(0 일반 ~ 5 신화)만 정함. 부위·종류·층은 엔진이 정함.
(function (G) {
  'use strict';

  // 수치는 전부 여기. 확률은 %, 내부 계산은 0.001% 단위 정수라 합이 정확히 100.
  const CONFIG = {
    PRICES: { 1: 100, 11: 1000, 35: 3000 }, // 뽑기 횟수: 성과급 (35회는 할인)
    LEVELS: [50, 150, 300, 500, 750, 1100, 1600, 2300, 3200, 4500], // Lv1~Lv10 도달 누적 횟수
    RATES_LV0: [59.339, 29.667, 9.889, 0.988, 0.108, 0.010], // Lv0 확률 (일반→신화, %)
    RATES_MAX: [16.227, 16.228, 48.685, 17.851, 0.989, 0.030], // 최고 레벨 확률 (%)
    FIX_GRADE: 0, // 합 100% 보정은 일반에서
    SCALE: 1000, // 확률 정밀도: 1% = 1000 (0.001% 단위)
    BOOST_EVERY: 30, // 누적 횟수가 이 수의 배수가 되는 뽑기가 확률업
    BOOST_MULT: 10,
    BOOST_GRADES: [4, 5], // 전설, 신화
    DEDUCT_ORDER: [0, 1, 2], // 확률업으로 넘친 만큼 일반→고급→희귀 순 차감
    PITY: 2500, // 신화 없이 이 횟수째 뽑기면 확정
    PITY_GRADE: 5, // 신화
    LEVEL_ATK: [0, 1, 2, 4, 7, 12, 20, 32, 50, 75, 100], // 뽑기 레벨별 최종 업무력 +% (종류마다 따로, 서로 곱함) [⚖ 2026-11-05: 많이 뽑을수록 크게]
    LEVEL_KINDS: ['equip', 'acc', 'skill', 'pet'], // 뽑기 레벨 업무력 보너스가 붙는 뽑기 종류
  };

  // 업무 스킬 뽑기: 장신구 표에서 신화만 0.049%(Lv0) → 0.081%(Lv10), 차이는 일반에서 (명세 ③ 15절)
  const SKILL = { ...CONFIG, RATES_LV0: [59.300, 29.667, 9.889, 0.988, 0.108, 0.049], RATES_MAX: [16.176, 16.228, 48.685, 17.851, 0.989, 0.081] };
  // 반려 뽑기: 장신구 표 그대로 (명세 ④ 28절). 뽑기 레벨 보너스(업무력)는 안 줌 (35절 #10)
  // 장비·장신구 뽑기: 30일쯤 처치 드롭(200층대)보다 못해서 성과급을 써도 거의 안 세지던 것 → 영웅 이상을 올림 (2026-11-06 봇 군집 점검, 1안)
  // 무과금 30일 층은 그대로, 소·중·고과금 +3~7% (docs/balance-check-2026-11-06.md 3차)
  const EQUIP = { ...CONFIG, RATES_LV0: [50, 32, 14, 3, 0.9, 0.1], RATES_MAX: [12, 20, 45, 19, 3.6, 0.4] };
  const BY_KIND = { acc: EQUIP, equip: EQUIP, skill: SKILL, pet: CONFIG };
  const configFor = (kind) => BY_KIND[kind] || CONFIG;

  const sum = (a) => a.reduce((x, y) => x + y, 0);
  const toInt = (v) => (typeof v === 'number' && isFinite(v) && v >= 0 ? Math.floor(v) : 0);

  // 누적 횟수 → 뽑기 레벨 (0~10)
  function levelFor(count, c = CONFIG) {
    const n = toInt(count);
    let lv = 0;
    while (lv < c.LEVELS.length && n >= c.LEVELS[lv]) lv++;
    return lv;
  }

  // 다음 레벨이 되는 누적 횟수 (최고 레벨이면 null)
  function nextLevelAt(count, c = CONFIG) {
    const lv = levelFor(count, c);
    return lv < c.LEVELS.length ? c.LEVELS[lv] : null;
  }

  // 레벨별 가중치 (0.001% 단위 정수, 합 = 100 × SCALE)
  function weights(level, boosted, c = CONFIG) {
    const max = c.LEVELS.length;
    const L = Math.min(max, toInt(level));
    const total = 100 * c.SCALE;
    const lo = c.RATES_LV0.map((p) => Math.round(p * c.SCALE));
    const hi = c.RATES_MAX.map((p) => Math.round(p * c.SCALE));
    // 중간 레벨은 선형 보간
    const w = lo.map((a, i) => (max > 0 ? Math.round((a * (max - L) + hi[i] * L) / max) : a));
    w[c.FIX_GRADE] = 0;
    w[c.FIX_GRADE] = total - sum(w);
    if (boosted) {
      for (const g of c.BOOST_GRADES) w[g] *= c.BOOST_MULT;
      // 넘친 만큼 차감. 정해진 순서로 모자라면 나머지 등급(낮은 것부터)에서
      const order = [...c.DEDUCT_ORDER, ...w.map((_, i) => i).filter((i) => !c.DEDUCT_ORDER.includes(i))];
      let over = sum(w) - total;
      for (const i of order) {
        if (over <= 0) break;
        const t = Math.min(over, w[i]);
        w[i] -= t;
        over -= t;
      }
    }
    return w;
  }

  // 레벨별 확률표 (%, 소수 3자리)
  function rates(level, boosted, c = CONFIG) {
    return weights(level, boosted, c).map((x) => x / c.SCALE);
  }

  // 누적 count회 뽑은 상태에서 다음 뽑기가 확률업인지
  const isBoostPull = (count, c = CONFIG) => (toInt(count) + 1) % c.BOOST_EVERY === 0;

  // 가중치에서 등급 하나 (r: 0≤r<1)
  function pick(w, r) {
    const x = r * sum(w);
    let acc = 0;
    for (let i = 0; i < w.length; i++) {
      acc += w[i];
      if (x < acc) return i;
    }
    // 부동소수점 대비: 확률이 있는 가장 높은 등급
    for (let i = w.length - 1; i >= 0; i--) if (w[i] > 0) return i;
    return 0;
  }

  const fresh = () => ({ count: 0, sinceBoost: 0, sincePity: 0 });

  // 망가진 값은 0. sinceBoost는 누적 횟수에서 계산(확률업은 누적 카운터 기준)
  function norm(g) {
    const s = g && typeof g === 'object' ? g : {};
    const count = toInt(s.count);
    return { count, sinceBoost: count % CONFIG.BOOST_EVERY, sincePity: toInt(s.sincePity) };
  }

  // 1회 뽑기. 입력은 안 바꾸고 새 상태를 state로 돌려줌. rng()는 정확히 1번 씀.
  function pull(gstate, rng, c = CONFIG) {
    const s = norm(gstate);
    const level = levelFor(s.count, c);
    const boosted = isBoostPull(s.count, c);
    let grade = pick(weights(level, boosted, c), rng());
    // 신화 없이 2500번째 뽑기면 확정
    const pity = s.sincePity + 1 >= CONFIG.PITY;
    if (pity) grade = CONFIG.PITY_GRADE;
    const count = s.count + 1;
    const state = {
      count,
      sinceBoost: count % CONFIG.BOOST_EVERY,
      sincePity: grade >= CONFIG.PITY_GRADE ? 0 : s.sincePity + 1,
    };
    return { grade, boosted, pity, level, state };
  }

  // n회 연속 뽑기 (중간에 레벨이 오르면 그 다음 뽑기부터 반영)
  function pullMany(gstate, rng, n, c = CONFIG) {
    let state = norm(gstate);
    const results = [];
    for (let i = 0; i < toInt(n); i++) {
      const r = pull(state, rng, c);
      state = r.state;
      results.push({ grade: r.grade, boosted: r.boosted, pity: r.pity, level: r.level });
    }
    return { results, state };
  }

  // 뽑기 n회 가격 (성과급). 없는 묶음이면 null
  function costFor(n) {
    return Number.isInteger(n) && Object.prototype.hasOwnProperty.call(CONFIG.PRICES, n) ? CONFIG.PRICES[n] : null;
  }

  // 화면 표시용 진행도
  function status(gstate) {
    const s = norm(gstate);
    const next = nextLevelAt(s.count);
    return {
      level: levelFor(s.count),
      maxLevel: CONFIG.LEVELS.length,
      nextLevelAt: next,
      toNextLevel: next === null ? null : next - s.count,
      toBoost: CONFIG.BOOST_EVERY - s.sinceBoost, // 확률업 뽑기까지 남은 횟수 (그 뽑기 포함)
      toPity: Math.max(1, CONFIG.PITY - s.sincePity), // 천장 뽑기까지 남은 횟수 (그 뽑기 포함)
    };
  }

  G.Gacha = { CONFIG, SKILL, configFor, fresh, levelFor, nextLevelAt, weights, rates, isBoostPull, pull, pullMany, costFor, status };
})(globalThis.Game = globalThis.Game || {});
