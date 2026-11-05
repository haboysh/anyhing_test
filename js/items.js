// 장비·장신구 데이터 표 (명세 docs/impl-spec-m1.md 2~11절). 로직 없음, 숫자만.
// 밸런스·시트 값이 바뀌면 이 파일만 고치면 됨. [임시] = 사용자 확인 전 임시값.
(function (G) {
  'use strict';

  // ----- 1. 등급 (index 0~5) -----
  const GRADES = [
    { key: 'common', name: '일반', color: '#9aa0a6' },
    { key: 'uncommon', name: '고급', color: '#4caf50' },
    { key: 'rare', name: '희귀', color: '#3d8bff' },
    { key: 'epic', name: '영웅', color: '#a259ff' },
    { key: 'legendary', name: '전설', color: '#ff9f1c' },
    { key: 'mythic', name: '신화', color: '#ff4d4f' },
  ];

  // ----- 2. 능력치 (flat: 깡수치 가능) -----
  const STATS = {
    atk: { name: '공격력', unit: '%', flat: true },
    aspd: { name: '공격 속도', unit: '%', flat: false },
    critRate: { name: '치명타 확률', unit: '%p', flat: false },
    critDmg: { name: '치명타 데미지', unit: '%p', flat: false },
    hp: { name: '체력', unit: '%', flat: true },
    regen: { name: '체력 회복', unit: '%', flat: false },
    gold: { name: '재산 획득', unit: '%', flat: true },
    offline: { name: '방치 보상', unit: '%', flat: false },
    cdr: { name: '스킬 쿨타임 감소', unit: '%p', flat: false },
    boss: { name: '보스 데미지', unit: '%', flat: false },
  };
  const STAT_KEYS = Object.keys(STATS);

  // 상한 (% 합계). final: 엔진이 기본값을 더한 최종값에도 다시 적용
  const CAPS = {
    critRate: { max: 100, final: true },
    cdr: { max: 50, final: true },
    aspd: { max: 150, final: false }, // 장비 합계
    offline: { max: 100, final: false }, // 장비 합계
  };

  // ----- 3. 부위 (7칸). mainMult [임시] -----
  const SLOTS = {
    keyboard: { name: '키보드', body: '왼손', kind: 'equip', main: 'atk', mainMult: 1 },
    mouse: { name: '마우스', body: '오른손', kind: 'equip', main: 'aspd', mainMult: 0.3 },
    monitor: { name: '모니터', body: '머리', kind: 'equip', main: 'critRate', mainMult: 0.1 },
    chair: { name: '의자', body: '몸통', kind: 'equip', main: 'hp', mainMult: 1 },
    badge: { name: '사원증', body: '목걸이', kind: 'accessory', main: 'gold', mainMult: 0.5 },
    watch: { name: '시계', body: '시계', kind: 'accessory', main: 'cdr', mainMult: 0.1 },
    ring: { name: '반지', body: '반지', kind: 'accessory', main: 'critDmg', mainMult: 1 },
  };
  const SLOT_KEYS = Object.keys(SLOTS);

  // 주 능력치 값(%) = MAIN_BASE[등급] × 부위 mainMult × (1 + MAIN_PLUS_STEP × 강화) [임시]
  const MAIN_BASE = [5, 12, 25, 50, 100, 200];
  const MAIN_PLUS_STEP = 0.1;

  // ----- 4. 종류 (부위당 3종) [임시 이름]. subs = 서브 능력치 2개 -----
  const TYPE_SUBS = {
    keyboard: [['critRate', 'aspd'], ['hp', 'regen'], ['boss', 'critDmg']],
    mouse: [['atk', 'critRate'], ['cdr', 'regen'], ['gold', 'offline']],
    monitor: [['critDmg', 'atk'], ['hp', 'cdr'], ['boss', 'aspd']],
    chair: [['atk', 'boss'], ['regen', 'offline'], ['gold', 'critDmg']],
    badge: [['atk', 'critDmg'], ['offline', 'hp'], ['boss', 'aspd']],
    watch: [['aspd', 'critRate'], ['regen', 'offline'], ['boss', 'gold']],
    ring: [['critRate', 'atk'], ['hp', 'regen'], ['boss', 'gold']],
  };
  // TYPES[slot] = [{ id: 'keyboard1', slot, name: '키보드1', subs }, ...]
  const TYPES = {};
  const TYPE_BY_ID = {};
  for (const slot of SLOT_KEYS) {
    TYPES[slot] = TYPE_SUBS[slot].map((subs, i) => {
      const t = { id: slot + (i + 1), slot, name: SLOTS[slot].name + (i + 1), subs };
      TYPE_BY_ID[t.id] = t;
      return t;
    });
  }

  // 서브 값 = 그 능력치가 주인 부위의 같은 등급·강화 주 값 × SUB_RATIO
  const SUB_RATIO = 0.15;
  // 주인 부위가 없는 능력치: 표[등급] × SUB_SPECIAL_GROWTH^강화 (일반→신화, %)
  const SUB_SPECIAL = {
    regen: [2, 3, 4, 6, 8, 10],
    offline: [1, 2, 3, 4, 6, 8],
    boss: [1, 2, 3, 4, 5, 6],
  };
  const SUB_SPECIAL_GROWTH = 1.06;

  // ----- 6. 잠재능력 -----
  // values[stat][등급]: null = 줄 없음, { flat: n } = n × 깡수치 기준값,
  // { fixed: n } = 고정 %, { min, max } = 범위 균등 후 unit으로 반올림
  const POTENTIAL = {
    lines: [0, 1, 2, 3, 4, 4], // 등급별 줄 수
    maxSame: 2, // 같은 능력치 최대 줄 수 (잠긴 줄 포함)
    weights: { atk: 10, aspd: 8, critRate: 8, critDmg: 10, hp: 12, regen: 14, gold: 12, offline: 12, cdr: 6, boss: 8 },
    units: { atk: 0.5, aspd: 0.1, critRate: 0.1, critDmg: 0.5, hp: 0.5, regen: 0.5, gold: 0.5, offline: 0.5, cdr: 0.1, boss: 0.5 },
    values: {
      atk: [null, { flat: 1 }, { flat: 2 }, { min: 2, max: 5 }, { min: 5, max: 10 }, { min: 10, max: 25 }],
      aspd: [null, { fixed: 1 }, { fixed: 2 }, { min: 1, max: 3 }, { min: 3, max: 6 }, { min: 6, max: 12 }],
      critRate: [null, { fixed: 0.5 }, { fixed: 1 }, { min: 1, max: 2 }, { min: 2, max: 4 }, { min: 4, max: 8 }],
      critDmg: [null, { fixed: 5 }, { fixed: 10 }, { min: 5, max: 12 }, { min: 12, max: 25 }, { min: 25, max: 50 }],
      hp: [null, { flat: 1 }, { flat: 2 }, { min: 3, max: 6 }, { min: 6, max: 12 }, { min: 12, max: 25 }],
      regen: [null, { fixed: 5 }, { fixed: 10 }, { min: 5, max: 10 }, { min: 10, max: 20 }, { min: 20, max: 40 }],
      gold: [null, { flat: 1 }, { flat: 2 }, { min: 3, max: 6 }, { min: 6, max: 12 }, { min: 12, max: 25 }],
      offline: [null, { fixed: 3 }, { fixed: 6 }, { min: 4, max: 8 }, { min: 8, max: 15 }, { min: 15, max: 30 }],
      cdr: [null, { fixed: 0.5 }, { fixed: 1 }, { min: 1, max: 2 }, { min: 2, max: 4 }, { min: 4, max: 6 }],
      boss: [null, { fixed: 3 }, { fixed: 6 }, { min: 4, max: 8 }, { min: 8, max: 16 }, { min: 16, max: 32 }],
    },
  };

  // 깡수치 기준값 = max(FLAT_MIN, ceil(coef × growth^(층−1))), 층 = 아이템 floor
  const FLAT_BASE = {
    atk: { coef: 0.05, growth: 1.14 }, // B공
    hp: { coef: 0.5, growth: 1.125 }, // B멘
    gold: { coef: 0.06, growth: 1.135 }, // B원
  };
  const FLAT_MIN = 1;

  // K(강화 기준값) = 최고 층 일반 업무 처치 보상 × COST_BASE_KILLS (엔진이 계산해서 넘김)
  const COST_BASE_KILLS = 60; // (예전 방식, 안 씀) 최고 층 처치 보상 × 이 수
  // 아이템 비용 기준 K (재산): 층과 상관없이 고정 (2026-10-23 사용자 결정). 감정·재감정·강화·흔적 복구·분해 값 = K × 표의 배율
  const COST_K = 100;

  // 감정·재감정·잠금 비용 (등급 index 0~5)
  const APPRAISE = {
    costMult: [0, 0.5, 1, 2, 4, 8], // 감정 원 = K × 배율
    rerollMult: [0, 0.5, 1, 2, 4, 8], // 재감정 원 = K × 배율
    rerollJjam: [0, 0, 0, 0, 1, 2], // 재감정 짬
    maxLocks: [0, 0, 0, 2, 3, 3], // 잠글 수 있는 줄
    lockBonus: [[], [], [], [20, 60], [50, 150, 500], [100, 300, 1000]], // 잠금 성과급 (1/2/3줄)
    jjamToBonus: 30, // 짬 부족분 1 = 성과급 30
    autoGrades: [1, 2], // 자동 감정 대상 (고급·희귀)
  };

  // ----- 7. 강화 (docs/enhance-table.md) -----
  // rows[현재 강화] = [성공, 유지, 강등, 파괴] (합 1)
  const ENHANCE = {
    max: 15,
    rows: [
      [1, 0, 0, 0], [1, 0, 0, 0], [1, 0, 0, 0], [1, 0, 0, 0], [1, 0, 0, 0],
      [0.90, 0.10, 0, 0], [0.80, 0.20, 0, 0], [0.70, 0.30, 0, 0], [0.60, 0.40, 0, 0], [0.50, 0.50, 0, 0],
      [0.35, 0.55, 0.10, 0], [0.25, 0.65, 0.10, 0],
      [0.15, 0.60, 0.10, 0.15], [0.10, 0.60, 0.10, 0.20], [0.07, 0.53, 0.10, 0.30],
    ],
    costMult: [1.0, 1.2, 1.4, 1.6, 1.8, 2.0], // 등급별
    costGrowth: 1.4, // +10까지 단계마다
    costGrowthHigh: 1.25, // +10 이후 단계마다
    costHighFrom: 10,
    failJjam: 1, // 유지·강등
    breakJjam: 10, // 파괴
    downPity: 2, // 연속 강등 이 횟수면 다음 시도 100%
    boost: { from: 10, max: 30, per: 0.001 }, // 짬 성공 보정: +10부터, 최대 30개, 1개당 +0.1%p
    protect: { from: 12, max: 10, per: 0.01 }, // 짬 파괴 방지: 1개당 파괴 −1%p → 유지
    ruinGrades: [4, 5], // 파괴 시 흔적이 남는 등급 (전설·신화)
    restorePlus: 10, // 흔적 복구 단계
  };

  // ----- 8. 합성 -----
  const MERGE = {
    count: 4, // 같은 부위·등급 재료 수
    baseRate: 0.15,
    stepRate: 0.05, // 연속 실패 1회당
    maxRate: 0.5,
    failJjam: 3,
  };

  // ----- 9. 분해 -----
  const DISMANTLE = { mult: [0.1, 0.2, 0.4, 0.8, 1.6, 3.2] }; // 원 환급 = K × 배율

  // ----- 10. 획득 (드롭) [임시] -----
  const BAG_SIZE = 300; // 기본 칸 수
  // 양파나라 (중고거래 판매소, 시스템 손님이 사감) — docs/balance-devil-pass.md 3절
  // 가격(성과급) = base[등급] × plusMult[강화], 판매 시간은 등급별. 제한은 10칸 + 판매 시간뿐
  // (아이템을 서버가 관리하면서 하루 상한 2,000 없앰, 2026-10-25 사용자 결정)
  const MARKET = {
    slots: 10,
    hours: [0.5, 1, 1.5, 2, 4, 8], // 기준 판매 시간 — 실제는 ×randMin~×randMax 사이 랜덤, 화면엔 남은 시간 안 보여줌
    randMin: 0.5, randMax: 1.5,
    base: [3, 6, 12, 30, 100, 300],
    plusMult: [1, 1.2, 1.4, 1.6, 1.8, 2, 2.5, 3, 3.5, 4, 5, 7, 10, 13, 16, 20],
  };
  MARKET.priceOf = (grade, plus = 0) => Math.round(MARKET.base[grade] * MARKET.plusMult[Math.max(0, Math.min(15, plus | 0))]);

  // 결재 도장 (악마왕 강화석) — docs/balance-devil-pass.md 1절
  const STAMP = {
    per: [0, 0, 0, 0, 0, 8, 10, 13, 17, 21, 25, 30, 40, 50, 60], // 강화 1회 도장 (일반 기준, 단계 = 지금 강화)
    restoreMult: 2, // 흔적 복구 = +10→11 1회 × 2
    shop: { killsPer: 20, tiers: [40, 40, 40], mult: [1, 2, 4], step: 10 }, // 1개 = 처치 보상 20번어치, 하루 40개씩 ×1→×2→×4
    free: { offlinePerHour: 2, killRate: 0.002, bossRate: 0.15, missionAll: { daily: 20, weekly: 100 }, towerFloor: 3 },
  };
  const BAG = { base: 300, step: 100, maxBuys: 7, price: (n) => 300 + 100 * n }; // 확장 n번째 가격(성과급 또는 법카)
  const DROP = {
    normal: { equipRate: 0.02, shardRate: 0.03 }, // 일반 업무 처치
    boss: { equip: 1, shards: 3, bracketUp: 1 }, // 보스: 장비 확정, 확률표 한 구간 위
    // 낮은 층 드롭 감소 (2026-10-27 사용자): 이번 회차 최고 유효 층 −free층까지 100%, 그 아래 층마다 ×per, 최저 min. 장비·조각·도장(보스 포함)
    lowFloor: { free: 5, per: 1 / 1.135, min: 0.05 },
    shardsPerBox: 20, // 장신구 조각 → 장신구 상자 1개
    offline: { secPerItem: 1800, maxItems: 16 }, // 퇴근 후 정산
    // 층 구간별 등급 확률 (%, 일반→신화). minFloor 이상부터 적용 (유효 층 기준)
    gradeTable: [
      { minFloor: 1, rates: [70, 25, 5, 0, 0, 0] },
      { minFloor: 50, rates: [55, 33, 11, 1, 0, 0] },
      { minFloor: 100, rates: [45, 35, 18, 1.9, 0.1, 0] },
      { minFloor: 200, rates: [38, 35, 24, 2.7, 0.298, 0.002] },
      { minFloor: 300, rates: [34, 35, 27, 3.6, 0.396, 0.004] },
    ],
    // 장신구 상자 전용 표 (처음 값은 같게, 따로 조정 가능)
    boxTable: [
      { minFloor: 1, rates: [70, 25, 5, 0, 0, 0] },
      { minFloor: 50, rates: [55, 33, 11, 1, 0, 0] },
      { minFloor: 100, rates: [45, 35, 18, 1.9, 0.1, 0] },
      { minFloor: 200, rates: [38, 35, 24, 2.7, 0.298, 0.002] },
      { minFloor: 300, rates: [34, 35, 27, 3.6, 0.396, 0.004] },
    ],
    // 300층 이후 영웅·전설·신화 배율 = min(cap, 1 + k·log2(층/from)), 늘어난 만큼 일반에서 뺌
    late: { from: 300, k: 0.3, cap: 1.5, grades: [3, 4, 5] },
  };

  // ----- 11. 도감 [임시] -----
  // 키 `${type}:${grade}` 처음 얻으면 등록 → 보상
  const CODEX = { stat: 'atk', pct: 0.5, bonus: 10 }; // 공격력 +0.5% (영구, 합산) + 성과급 10
  const CODEX_SIZE = SLOT_KEYS.reduce((n, s) => n + TYPES[s].length, 0) * GRADES.length; // 126

  // 장비 업적 조건 (eq = {부위: 아이템|null}) → {eq_full4, eq_badge, eq_epic7, eq_mythic} 중 이룬 것만 1. 폰 엔진·서버 진행 장부(progress.js)가 같이 씀
  function equipAch(eq) {
    const e = eq || {};
    const out = {};
    if (SLOT_KEYS.filter((k) => SLOTS[k].kind === 'equip').every((k) => e[k])) out.eq_full4 = 1;
    if (e.badge) out.eq_badge = 1;
    if (SLOT_KEYS.every((k) => e[k] && e[k].grade >= 3)) out.eq_epic7 = 1;
    if (SLOT_KEYS.some((k) => e[k] && e[k].grade >= 5)) out.eq_mythic = 1;
    return out;
  }

  G.Items = {
    GRADES, STATS, STAT_KEYS, CAPS, SLOTS, SLOT_KEYS, MAIN_BASE, MAIN_PLUS_STEP, equipAch,
    TYPES, TYPE_BY_ID, SUB_RATIO, SUB_SPECIAL, SUB_SPECIAL_GROWTH,
    POTENTIAL, FLAT_BASE, FLAT_MIN, COST_BASE_KILLS, COST_K, APPRAISE, ENHANCE, MERGE, DISMANTLE,
    BAG_SIZE, BAG, MARKET, STAMP, DROP, CODEX, CODEX_SIZE,
  };
})(globalThis.Game = globalThis.Game || {});
