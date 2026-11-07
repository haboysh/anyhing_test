// 사내 게시판: 공지 종류·테스트판 고정 공지·업데이트 내역·빨간 점 판단 (명세 docs/impl-spec-m4.md ②). 화면 모름.
// 정식판 공지는 서버 notices 표에서 옴 (op board). 확률표는 rates.js
(function (G) {
  'use strict';

  const KINDS = { notice: '공지', maint: '점검', event: '이벤트', update: '업데이트' };

  // 서버 없는 테스트판 공지 (content/notices.json과 같게 — 테스트가 확인)
  const LOCAL = [
    { id: 3, kind: 'notice', pinned: true, at: '2026-10-28', title: '야근 직장인 키우기에 오신 걸 환영해요', body: '업무를 처리하며 층을 오르고, 장비를 모으고, 더 좋은 회사로 이직하세요.\n막히면 전투 화면의 노란 포스트잇(사수 김대리 메모)을 따라가 보세요.' },
    { id: 2, kind: 'update', pinned: false, at: '2026-10-28', title: '확률 공개를 시작했어요', body: '뽑기·강화·합성·감정·드롭 확률을 [확률 공개] 탭에서 볼 수 있어요.\n표는 게임 규칙에서 바로 만들어서, 실제로 쓰는 숫자와 같아요. 바뀌면 미리 공지할게요.' },
    { id: 1, kind: 'maint', pinned: false, at: '2026-10-28', title: '지금은 테스트판이에요', body: '이 판은 서버 없이 이 기기에만 저장돼요. 기기를 바꾸거나 저장을 지우면 처음부터예요.' },
  ];

  // 업데이트 내역 (새 순서). 확률표가 바뀌는 업데이트는 rates: true → 그 판의 확률표 버전을 같이 보여줌
  const UPDATES = [
    { at: '2026-11-06', lines: [
      '장비·장신구 뽑기 확률 상향: 영웅 1%→3%, 전설 0.108%→0.9%, 신화 0.01%→0.1% (뽑기 레벨이 오를수록 더 올라요). 반려·스킬 뽑기는 그대로',
      '타자 속도: 레벨당 +0.006 → +0.008 (최대 4.0 → 5.0회/초), 화면에 소수 셋째 자리까지',
      '짬 쓰는 곳: 강화 성공 보정이 짬 1개당 +0.1%p → +0.3%p · 재감정은 고급부터 짬을 써요 (모자라면 성과급으로)',
      '업적 [모두 받기] · 업적을 받아도 목록 위치 그대로 · 뽑기 누르면 바로 "뽑는 중" 표시하고 더 빨라짐 · 가방 120칸씩 [더 보기]',
      '인맥 효과가 장비 %와 따로 곱해져요 (사이를 올리면 확 세져요) · 인맥 관리에 명함 상점 (명함 1장 = 성과급 50, 하루 20장)',
      '고침: 화면이 느릴 때 공격이 몰아서 나가던 것 · 이직 직후 높은 층에서 빠르게 처리하면 서버가 거절하던 것',
    ], rates: true },
    { at: '2026-11-05', lines: [
      '장비 개편: 테마 6개(짠돌이·인체공학·게이밍·고오급·권력이 최고·야근 전문가) × 부위 7개 = 42종, 새 이름·그림·설명. 서브 능력치는 테마가 정해요 (기존 장비도 새 이름·서브로 바뀜)',
      '세트 효과: 같은 테마 4개·7개를 끼면 효과, 세트 장비 등급이 높을수록 커져요 · 테마 도감: 한 테마 7종을 모으면 업무력 +3%',
      '장비 프리셋 2개 (교체용 장비는 합성·분해에서 보호) · 합성할 때 결과가 고른 장비 종류로 나와요',
      '반려·업무 스킬 보유 효과는 이제 업무력에 따로 곱해져요 · 전설·신화 반려·스킬 보유 효과 상향',
      '뽑기 레벨 보너스: 장비·장신구·스킬·반려 뽑기 모두에 붙고, 많이 뽑을수록 크게 (Lv10 +100%)',
      '야근 패스(구독)에 매일 출석 때 성과급 +500 · 새 상품 월급날 월정액 (바로 법카 500 + 30일 매일 성과급 1,000)',
      '체력 막대 숫자·휴식 표시 다듬기, 위 아이콘 줄 얇게',
    ], rates: true },
    { at: '2026-10-28', lines: ['책상 반려 (장비 탭 [반려]): 최고 40층에서 열림, 반려선인장 1마리 지급 · 반려 12종 · 같은 단계 5개 합치기 · 책상에 올리면 능력치, 모으면 업무력', '상점에 반려 뽑기 (장신구 뽑기와 같은 확률·가격)'], rates: true },
    { at: '2026-10-28', lines: ['인맥 관리 (사내 탭): 첫 부서 장악 때 열림, 명함으로 친분 쌓기 · 성과급으로 사이 올리기 → 업무력·체력·재산·보스 데미지'] },
    { at: '2026-10-28', lines: ['사내 게시판: 공지 · 확률 공개 · 업데이트 내역', '튜토리얼: 입사 첫날 안내, 사수의 포스트잇 20단계 + 10층마다 층 미션, 기능이 열릴 때 사수 한마디'], rates: true },
    { at: '2026-10-27', lines: ['색감 "야근 결재판"', '낮은 층 드롭 감소 (이번 회차 최고 층 −5층까지 100%)', '업무 스킬 17종 · 스킬 뽑기'] },
    { at: '2026-10-26', lines: ['부서 장악 · 외부 미팅 · 특근', '새 그림체 (주인공·적·보스)'] },
  ];

  // 날짜 글자 'YYYY-MM-DD' (서버 시각은 한국 시간으로)
  function kstDate(at) {
    if (typeof at !== 'string') return '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(at)) return at;
    const t = Date.parse(at);
    return isFinite(t) ? new Date(t + 9 * 3600000).toISOString().slice(0, 10) : '';
  }
  // 서버·로컬 공지 정리 (모르는 종류·빈 제목 제거, 고정 먼저 → 새 id 먼저)
  function clean(list) {
    if (!Array.isArray(list)) return [];
    return list
      .filter((n) => n && Number.isInteger(n.id) && KINDS[n.kind] && typeof n.title === 'string' && n.title)
      .map((n) => ({ id: n.id, kind: n.kind, pinned: n.pinned === true, at: kstDate(n.at), title: n.title.slice(0, 80), body: typeof n.body === 'string' ? n.body.slice(0, 2000) : '' }))
      .sort((a, b) => (b.pinned - a.pinned) || (b.id - a.id));
  }
  const latestId = (list) => list.reduce((m, n) => Math.max(m, n.id), 0);

  // 빨간 점: 새 공지 또는 바뀐 확률표 → {notice, rates}
  function unread(board, latest, ratesVer) {
    return { notice: latest > (board.seenId | 0), rates: board.seenRates !== ratesVer };
  }

  G.Board = { KINDS, LOCAL, UPDATES, clean, latestId, unread };
})(globalThis.Game = globalThis.Game || {});
