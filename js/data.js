// 게임 데이터: 밸런스 공식, 강화·스킬·적 목록. 밸런스는 이 파일만 고치면 됨.
(function (G) {
  'use strict';
  const fmt = G.fmt;

  const RANKS = ['인턴', '사원', '주임', '대리', '과장', '차장', '부장', '이사', '상무', '전무', '부사장', '사장', '회장'];
  const COMPANIES = ['좋소기업', '중소기업', '중견기업', '대기업', '외국계', '유니콘', '글로벌 탑티어'];

  const F = {
    KILLS_PER_STAGE: 8,
    BOSS_TIME: 30, // 보스 제한시간(초)
    ENEMY_HIT_GAP: 1.1, ENEMY_HIT_GAP_BOSS: 0.85, // 적이 때리는 간격(초) — 그동안의 피해를 한 번에 (2026-10-27)
    SPAWN_DELAY: 0.05, // 처치 후 다음 적까지(초) — 뒤에 줄 선 적이 바로 한 발 나옴 (0.25 → 0.05, 2026-10-26 사용자: 딜 손해 줄이기)
    REST_MIN: 2, // 번아웃 휴식 최소(초)
    REST_BASE: 2, // 휴식 = max(MIN, (BASE + SPAN/(1 + R/2)) × 멘탈 × 꿀잠), R = 최대 체력 ÷ (적 DPS × 10)
    REST_SPAN: 6,
    REST_MENTAL: 0.5, // 멘탈(후퇴 방지 %)이 휴식을 줄이는 비율
    HP_REGEN: 0.02, // 초당 최대 체력의 2% 회복
    PROMO_MULT: 1.05, // 승진(직급 단계)마다 업무력·체력 ×1.05
    CRIT_MULT: 2.5,
    OFFLINE_MAX_SEC: 8 * 3600,
    OFFLINE_RATE: 0.5, // 방치 보상은 실제 플레이의 50%
    PRESTIGE_MIN_STAGE: 25,
    PRESTIGE_CLIMB: 10, // 이직 후 시작 층에서 이만큼은 올라가야 다시 지원 (바로 재이직으로 경력 쌓기 방지, 2026-10-27)
    CAREER_GAP: 0, // 이번 회차 최고 유효 층이 평생 최고 유효 층 − 이 값보다 낮으면 경력 0. 0 = 평생 최고에 닿아야 경력 (짧은 이직 반복 방지, 2026-10-28 도입 −10층 → 2026-10-29 사용자 확정 0)
    isBoss: (s) => s % 10 === 0,
    // f = 유효 층(층 + 회사 보정), boss = 보스 여부 (생략하면 f로 판단)
    enemyHp: (f, boss = F.isBoss(f)) => 8 * Math.pow(1.14, f - 1) * (boss ? 6 : 1),
    enemyDps: (f, boss = F.isBoss(f)) => 1.2 * Math.pow(1.125, f - 1) * (boss ? 1.8 : 1),
    goldPerKill: (f, boss = F.isBoss(f)) => 2 * Math.pow(1.135, f - 1) * (boss ? 8 : 1),
    careerFor: (maxStage) => (maxStage < F.PRESTIGE_MIN_STAGE ? 0 : Math.floor(Math.pow(maxStage / 10, 2))),
    // 직급 단계 (이번 회차 최고 층 기준, 10층마다 1). 회장(12) 이후도 계속 올라감
    rankLevel: (runMax) => Math.max(0, Math.floor((Math.max(1, runMax) - 1) / 10)),
    rankName: (n) => (n < RANKS.length ? RANKS[n] : `회장 ${n - RANKS.length + 2}연임`),
    rankFor: (runMax) => F.rankName(F.rankLevel(runMax)),
  };

  const UPGRADES = {
    atk: {
      name: '업무력', desc: '업무 처리 데미지',
      value: (l) => (3 + 2 * l) * Math.pow(2, Math.floor(l / 25)),
      cost: (l) => 5 * Math.pow(1.085, l),
      fmt: (v) => fmt(v),
    },
    hp: {
      name: '체력', desc: '야근을 버티는 힘',
      value: (l) => (30 + 12 * l) * Math.pow(2, Math.floor(l / 25)),
      cost: (l) => 8 * Math.pow(1.09, l),
      fmt: (v) => fmt(v),
    },
    spd: {
      name: '타자 속도', desc: '초당 처리 횟수', max: 500,
      value: (l) => 1 + 0.008 * l,
      cost: (l) => 30 * Math.pow(1.027, l),
      fmt: (v) => v.toFixed(3) + '/초', // 레벨당 +0.006이라 셋째 자리까지 (둘째 자리면 어떤 레벨은 안 변해 보임)
    },
    crit: {
      name: '눈치', desc: `치명타 확률 (${F.CRIT_MULT}배)`, max: 500,
      value: (l) => 0.05 + 0.0009 * l,
      cost: (l) => 25 * Math.pow(1.027, l),
      fmt: (v) => (v * 100).toFixed(1) + '%',
    },
    mental: {
      name: '멘탈', desc: '번아웃 때 층이 안 내려갈 확률', max: 500, unlock: 10,
      value: (l) => 0.001 * l,
      cost: (l) => 40 * Math.pow(1.027, l),
      fmt: (v) => (v * 100).toFixed(1) + '%',
    },
    sleep: {
      name: '꿀잠', desc: '번아웃 휴식 시간 감소', max: 500, unlock: 20,
      value: (l) => 0.0012 * l, // 감소율
      cost: (l) => 30 * Math.pow(1.027, l),
      fmt: (v) => '-' + (v * 100).toFixed(1) + '%',
    },
  };

  // 회사 등급 (이직 지원). offset = 유효 층 보정, premium = 경력 웃돈
  const COMPANY_GRADES = [
    { name: '좋소기업', offset: 0, premium: 0 },
    { name: '중소기업', offset: 5, premium: 0.03 },
    { name: '중견기업', offset: 10, premium: 0.06 },
    { name: '대기업', offset: 20, premium: 0.10 },
    { name: '외국계', offset: 30, premium: 0.15 },
    { name: '유니콘', offset: 45, premium: 0.20 },
    { name: '글로벌 탑티어', offset: 60, premium: 0.25 },
  ];

  const PERKS = {
    dmg: { name: '학벌', desc: '데미지 x1.25 (곱연산)', icon: 'dmg', value: (l) => Math.pow(1.25, l) },
    gold: { name: '연봉협상', desc: '월급 x1.25 (곱연산)', icon: 'gold', value: (l) => Math.pow(1.25, l) },
    hp: { name: '강철 체력', desc: '체력 x1.25 (곱연산)', icon: 'hpPerk', value: (l) => Math.pow(1.25, l) },
    start: { name: '낙하산', desc: '시작 스테이지 +5', icon: 'start', max: 10, value: (l) => 1 + 5 * l },
  };
  const perkCost = (l) => (l + 1) * (l + 1); // 레벨이 오를수록 제곱으로 비싸짐 (밸런스팀 D안)

  const SKILLS = {
    coffee: { name: '아아 수혈', dur: 10, cd: 40, unlock: 1, desc: '10초간 타자속도 2배' },
    night: { name: '야근 모드', dur: 12, cd: 90, unlock: 15, desc: '12초간 데미지 3배' },
  };

  // [그림 키, 이름]
  const ENEMIES = [
    ['mail', '메일 폭탄'], ['excel', '엑셀 지옥'], ['report', '보고서_최종'], ['phone', '거래처 전화'],
    ['folders', '서류 더미'], ['chat', '단톡방 알림 300+'], ['printer', '고장난 프린터'], ['calendar', '회의 소집'],
    ['mail', '전체회신 메일'], ['report', '보고서_최최종'], ['excel', '피벗 테이블'], ['bug', '긴급 버그'],
  ];
  const BOSSES = [
    ['teamLead', '꼰대 팀장'], ['chart', '분기 실적'], ['clock', '철야 마감'], ['client', '갑질 거래처'],
    ['director', '본부장 보고'], ['audit', '사내 감사'], ['chairman', '회장님 방문'],
  ];

  const companyName = (prestiges) => COMPANIES[Math.min(COMPANIES.length - 1, prestiges)] +
    (prestiges >= COMPANIES.length ? ` ${prestiges - COMPANIES.length + 2}회차` : '');

  G.Data = { F, UPGRADES, PERKS, perkCost, SKILLS, ENEMIES, BOSSES, RANKS, COMPANIES, COMPANY_GRADES, companyName };
})(globalThis.Game = globalThis.Game || {});
