// 성과급 추가 수입원: 광고 보기, 이직 보상, 신기록 보스, 업적 (2026-10-23 사용자 결정, 수치는 밸런스팀 제안)
// DOM·저장 모름. 서버(Edge Function)도 같은 표로 금액을 계산함 → npm run sync:server
(function (G) {
  'use strict';

  const REW = {
    // 광고 1회 성과급 200, 하루 5회. gapSec = 서버가 보는 최소 간격 (실제 광고 SDK 전 임시 확인, 설계서 5단계 — SDK를 붙이면 서버 확인(SSV)으로)
    ad: { bonus: 200, perDay: 5, gapSec: 30 },
    prestige: { byGrade: [100, 150, 200, 250, 300, 350, 400], perDay: 3 }, // 이직 합격 시 새 회사 등급별, 하루 3회
    boss: { perFloor: 2 }, // 평생 처음 잡은 보스 층(유효 층) × 2
  };

  // 업적 30개 (content/achievements.json). stat = 엔진이 세는 기록, need = 목표, bonus = 성과급
  const ACH = [
    ['a_night1', '성장', '첫 야근', '야근 모드 1회 사용', 'skill_night', 1, 100],
    ['a_coffee100', '성장', '아아 매니아', '아아 수혈 100회 사용', 'skill_coffee', 100, 200],
    ['a_spd50', '성장', '손가락은 눈보다 빠르다', '타자 속도 Lv.50', 'lv_spd', 50, 100],
    ['a_crit100', '성장', '눈치 100단', '눈치 Lv.100', 'lv_crit', 100, 200],
    ['a_hp200', '성장', '체력왕', '체력 Lv.200', 'lv_hp', 200, 300],
    ['a_atk500', '성장', '월급루팡의 전설', '업무력 Lv.500', 'lv_atk', 500, 500],
    ['a_excel100', '전투', '엑셀은 가볍게', '엑셀 지옥 100회 처치', 'kill_excel', 100, 100],
    ['a_chat500', '전투', '단톡방 탈출', '단톡방 알림 300+ 500회 처치', 'kill_chat', 500, 200],
    ['a_lead10', '전투', '꼰대 격파왕', '꼰대 팀장 10회 처치', 'boss_teamLead', 10, 200],
    ['a_clock50', '전투', '밤샘 마감 참교육', '철야 마감 50회 처치', 'boss_clock', 50, 300],
    ['a_audit100', '전투', '감사 나오셨습니까', '사내 감사 100회 처치', 'boss_audit', 100, 500],
    ['a_chairman1', '전투', '회장님 고개 숙이다', '회장님 방문 1회 처치', 'boss_chairman', 1, 300],
    ['a_kill10k', '전투', '업무의 신', '일반 업무 10,000회 처치', 'kill', 10000, 300],
    ['a_desk4', '장비', '풀옵션 책상', '키보드·마우스·모니터·의자 모두 장착', 'eq_full4', 1, 100],
    ['a_badge', '장비', '사원증 목에 걸고', '사원증 첫 장착', 'eq_badge', 1, 100],
    ['a_epic7', '장비', '찬란한 책상', '7칸 모두 영웅 이상 장착', 'eq_epic7', 1, 500],
    ['a_mythic', '장비', '종결자의 장비', '신화 장비 장착', 'eq_mythic', 1, 500],
    ['a_dis100', '장비', '장비 분해 전문', '분해 100개', 'dismantle', 100, 200],
    ['a_pull50', '뽑기', '법카 슬래시', '뽑기 50회', 'pull', 50, 100],
    ['a_spend10k', '뽑기', '성과급 탕진잼', '성과급 10,000 사용', 'bonus_spent', 10000, 300],
    ['a_common10', '뽑기', '꽝도 뭉치면 먼지', '뽑기 일반 등급 연속 10회', 'common_streak', 10, 100],
    ['a_jotup', '이직', '좋소 탈출 성공', '좋소기업에서 더 좋은 회사로 첫 이직', 'escape_jot', 1, 200],
    ['a_pres5', '이직', '이직의 귀재', '이직 5회', 'prestige', 5, 300],
    ['a_bigco', '이직', '네임드 직장인', '대기업 이상 입사', 'co_grade', 3, 300],
    ['a_unicorn', '이직', '꿈의 유니콘', '유니콘 이상 입사', 'co_grade', 5, 500],
    ['a_career1k', '이직', '점프업의 달인', '경력 누적 1,000 획득', 'career_gain', 1000, 300],
    ['a_off1', '방치', '주말 잘 쉬셨나요', '퇴근 후 정산 1회', 'offline', 1, 100],
    ['a_off12', '방치', '주말 내내 뒹굴뒹굴', '12시간 이상 방치 후 정산', 'offline_hours', 12, 200],
    ['a_burn10', '기타', '번아웃 단골', '번아웃 10회', 'burnout', 10, 100],
    ['a_jjam500', '기타', '짬에서 나오는 바이브', '강화 실패로 짬 500 모으기', 'jjam_fail', 500, 200],
  ].map(([id, kind, name, cond, stat, need, bonus]) => ({ id, kind, name, cond, stat, need, bonus }));
  const ACH_BY_ID = Object.fromEntries(ACH.map((a) => [a.id, a]));

  // 서버가 직접 세는 평생 기록 (설계서 5단계): 업적 조건 전부 + 포스트잇 조건. true = 최댓값 기록 (나머지는 누적)
  //   서버(progress.js)·폰(engine setCounters) 모두 이 표로. 적 종류별 처치는 data.js 적 목록에서
  let serverStats = null;
  function SERVER_STATS() {
    if (serverStats) return serverStats;
    const D = G.Data;
    const out = {};
    for (const a of ACH) out[a.stat] = false;
    for (const k of ['att', 'mis_claim', 'enhance', 'merge', 'meeting', 'kill', 'skill_coffee', 'skill_night', 'offline']) out[k] = false;
    for (const k of Object.keys(D.UPGRADES)) out['lv_' + k] = true;
    for (const [k] of D.ENEMIES) out['kill_' + k] = false; // 같은 종류가 두 번 있어도 키는 하나
    for (const [k] of D.BOSSES) out['boss_' + k] = false;
    for (const k of ['co_grade', 'common_streak', 'offline_hours', 'eq_full4', 'eq_badge', 'eq_epic7', 'eq_mythic']) out[k] = true;
    serverStats = out;
    return out;
  }

  const prestigeBonus = (grade) => REW.prestige.byGrade[Math.max(0, Math.min(REW.prestige.byGrade.length - 1, grade | 0))];
  const bossBonus = (effFloor) => Math.max(0, Math.floor(effFloor)) * REW.boss.perFloor;

  G.Rewards = { REW, ACH, ACH_BY_ID, SERVER_STATS, prestigeBonus, bossBonus };
})(globalThis.Game = globalThis.Game || {});
