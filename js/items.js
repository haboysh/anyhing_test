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

  // ----- 4. 테마 6개 × 부위 7개 = 42종 (구글 시트 '시스템표' 아이템 탭, 2026-11-05) -----
  // 종류 id = 부위 + 테마 번호(1~6). 예전 1~3번(keyboard1~3)은 id 그대로 → 세이브 안전
  // subs = 서브 2개 (테마가 정함, 시트 K·L열). 주 능력치와 겹치는 9칸은 시트대로 겹침(그 능력치 몰아주기) [⚖]
  const THEMES = [
    { key: 'saver', name: '짠돌이', subs: ['gold', 'offline'], tip: '재산·방치' },
    { key: 'ergo', name: '인체공학', subs: ['hp', 'regen'], tip: '버티기' },
    { key: 'gaming', name: '게이밍', subs: ['aspd', 'critRate'], tip: '빠른 처리' },
    { key: 'luxury', name: '고오급', subs: ['critDmg', 'gold'], tip: '치명타 한 방' },
    { key: 'power', name: '권력이 최고', subs: ['boss', 'atk'], tip: '보스전' },
    { key: 'overtime', name: '야근 전문가', subs: ['cdr', 'offline'], tip: '방치·스킬' },
  ];
  // [이름, 한 줄 설명] — 테마 순서 (시트 F·G열)
  const TYPE_TEXT = {
    keyboard: [
      ['찌든 멤브레인', '언제부터 쓰던건지 모르겠는 키보드다..'],
      ['인체공학의 끝판왕', '왠지 손목이 건강해질거같다.'],
      ['시끄러운 청축', '소리가 커서 눈치보이지만....난 mz인걸?'],
      ['금색 키캡의 키보드', '황금 코팅 덕분에 타건감이 묵직해'],
      ['최종 결재 버튼', '키보드 옆에 결재 버튼이 있네?'],
      ['무소음 키보드', '새벽에 쳐도 아무도 깨지 않는 키보드'],
    ],
    mouse: [
      ['다있소 마우스', '다있소에서 3천원에 파는 마우스'],
      ['옆으로 버티컬', '손목 터널 증후군은 안생길듯..'],
      ['페익허 마우스', '움직이는 속도와 클릭속도가 굉장하다'],
      ['다이아 휠 마우스', '휠을 돌릴 때마다 보석이 반짝이며 영롱해요'],
      ['지시용 포인터', '마우스가 가는 곳에 모든 인력이 투입 !'],
      ['무소음 마우스', '클릭 했게~? 안했게~?'],
    ],
    monitor: [
      ['고장난 모니터', '모니터의 절반이 안보인다..'],
      ['높낮이 조절 모니터', '화면을 눈높이에 맞춰 거북목을 막아요'],
      ['165Hz 디스플레이', '움직임이 너무 매끄러워 눈이 즐거운 화면'],
      ['주식 고수의 모니터', '화면 4개로 주식을 하면 나도 부자가 될까..?'],
      ['전용 관제탑', '전 사원의 업무 현황을 한눈에 감시 가능'],
      ['각성 블루라이트', '밤새 봐도 눈이 아프지 않아'],
    ],
    chair: [
      ['접이식 철제 의자', '30분만 앉아도 허리가 끊어질 듯한 철제 의자'],
      ['척추 지킴이 의자', '나의 허리 중요하지...바른 자세 !'],
      ['화려한 레이싱 의자', '서킷을 달리는 기분으로 업무를 질주해요'],
      ['명품 디자이너 의자', '앉아만 있어도 성공한 기분이 드는 의자'],
      ['임원의 가죽의자', '앉기만 해도 절로 어깨에 힘이 들어가는 가죽 의자'],
      ['간이 침대 의자', '등받이가 완전히 펴져 사무실 숙박에 최적'],
    ],
    badge: [
      ['땟물 사원증', '줄이 때 타고 때론 문도 잘 안 열리는 사원증'],
      ['솜털 스트랩', '목에 닿는 느낌이 부드러워 안 찬 것 같아요'],
      ['RGB 사원증', "멀리서 누가봐도 '나'"],
      ['금빛 사원증', '케이스에 금을 넣었는지 너무 빤딱거린다'],
      ['임원실 출입증', '임원실에 들어갈 수 있을것같이 생겼다'],
      ['자정 통과증', '자정이 넘어도 경보음이 안 울리는 카드'],
    ],
    watch: [
      ['수능 시계', '시계는 시간만 알면 되지'],
      ['심박 측정기', '업무 스트레스로 뛰는 심장을 실시간 감시'],
      ['게이머 워치', '업무 완료까지 남은 시간을 초 단위로 표시'],
      ['성공의 시침', '금빛 찬란하여 퇴근 시간을 당겨줄 것 같은 시계.'],
      ['금통 시계', '금통 시계... 나도 성공 했나..?'],
      ['퇴근불능 시계', '왜 5시 59분에 멈춰있지..?'],
    ],
    ring: [
      ['평범한 은반지', '평범한 은 반지이다'],
      ['지압 반지', '손가락을 꾹꾹 눌러 혈액순환을 돕는 반지'],
      ['무한 클릭 반지', '클릭 효율을 극대화해주는 게이머의 유산'],
      ['반짝이는 금 반지', '금값이 얼마더라..?'],
      ['권력의 결정체', '도장을 찍을 때 엄청난 위압감을 주는 왕반지'],
      ['전기 충격 방지', "졸면 전기충격이 가해진다...'찌릿 ! '"],
    ],
  };
  // TYPES[slot] = [{ id: 'keyboard1', slot, theme: 0~5, name, desc, subs }, ...] (테마 순서)
  const TYPES = {};
  const TYPE_BY_ID = {};
  for (const slot of SLOT_KEYS) {
    TYPES[slot] = TYPE_TEXT[slot].map(([name, desc], i) => {
      const t = { id: slot + (i + 1), slot, theme: i, name, desc, subs: THEMES[i].subs.slice() };
      TYPE_BY_ID[t.id] = t;
      return t;
    });
  }

  // 서브 '가치 예산' [⚖ 임시]: 서브 값(%) = MAIN_BASE[등급] × (1 + MAIN_PLUS_STEP × 강화) × SUB_K[능력치]
  // → 모든 서브가 주 능력치처럼 등급·강화 따라 커짐 (예전 보스·체력 회복·방치는 등급이 올라도 거의 그대로였음)
  // 딜 서브(공격·공속·치확·치뎀·쿨감·보스)는 그 부위 주 값의 약 10%, 재산·체력 서브는 25~30%, 회복·방치는 넉넉히
  const SUB_K = {
    atk: 0.10, // 신화 +20% (키보드 주 200%)
    aspd: 0.03, // 신화 +6% (마우스 주 60%)
    critRate: 0.01, // 신화 +2%p (모니터 주 20%p)
    critDmg: 0.12, // 신화 +24%p (반지 주 200%p)
    cdr: 0.015, // 신화 +3%p (시계 주 20%p)
    boss: 0.04, // 신화 +8%
    hp: 0.25, // 신화 +50% (의자 주 200%)
    gold: 0.15, // 신화 +30% (사원증 주 100%)
    regen: 0.10, // 신화 +20%
    offline: 0.05, // 신화 +10% (장비 합계 상한 100%)
  };

  // 세트 효과 [⚖ 임시]: 같은 테마를 4개·7개 장착하면 (7개면 4개 효과 + 7개 효과 둘 다). 값은 %(치확·쿨감은 %p)
  // 테마마다 강한 상황이 다르게: 짠돌이 재산·방치 / 인체공학 버티기 / 게이밍 일반 층(빠른 처리) / 고오급 치명타 / 권력 보스전 / 야근 전문가 방치·스킬
  const SET = {
    counts: [4, 7],
    effects: [
      [{ gold: 15 }, { gold: 40, offline: 20 }],
      [{ hp: 15, regen: 20 }, { hp: 40, regen: 50 }],
      [{ aspd: 10 }, { aspd: 20, critRate: 5 }],
      [{ critDmg: 30 }, { critDmg: 80, critRate: 3 }],
      [{ boss: 20 }, { boss: 60 }],
      [{ offline: 20, cdr: 2 }, { offline: 40, cdr: 5 }],
    ],
  };

  // 장비 프리셋: 착용 1 + 교체용 1 (2026-11-05 결정)
  const PRESETS = 2;

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
  const CODEX_SIZE = SLOT_KEYS.reduce((n, s) => n + TYPES[s].length, 0) * GRADES.length; // 252
  // 테마 도감 [⚖ 임시]: 한 테마의 7부위를 (등급 상관없이) 다 등록하면 영구 능력치 — 모든 테마 같은 크기
  const THEME_CODEX = { stat: 'atk', pct: 3 };

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
    THEMES, TYPES, TYPE_BY_ID, SUB_K, SET, PRESETS, THEME_CODEX,
    POTENTIAL, FLAT_BASE, FLAT_MIN, COST_BASE_KILLS, COST_K, APPRAISE, ENHANCE, MERGE, DISMANTLE,
    BAG_SIZE, BAG, MARKET, STAMP, DROP, CODEX, CODEX_SIZE,
  };
})(globalThis.Game = globalThis.Game || {});
