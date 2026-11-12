// 사내 게시판: 공지 종류·테스트판 고정 공지·업데이트 내역·빨간 점 판단 (명세 docs/impl-spec-m4.md ②). 화면 모름.
// 정식판 공지는 서버 notices 표에서 옴 (op board). 확률표는 rates.js
(function (G) {
  'use strict';

  const KINDS = { notice: '공지', maint: '점검', event: '이벤트', update: '업데이트' };

  // 서버 없는 테스트판 공지 (content/notices.json과 같게 — 테스트가 확인)
  const LOCAL = [
    { id: 3, kind: 'notice', pinned: true, at: '2026-10-28', title: '야근 직장인 키우기에 오신 걸 환영해요', body: '업무를 처리하며 층을 오르고, 장비를 모으고, 더 좋은 회사로 이직하세요.\n막히면 전투 화면의 노란 포스트잇(사수 김대리 메모)을 따라가 보세요.' },
    { id: 1, kind: 'maint', pinned: false, at: '2026-10-28', title: '지금은 테스트판이에요', body: '이 판은 서버 없이 이 기기에만 저장돼요. 기기를 바꾸거나 저장을 지우면 처음부터예요.' },
  ];

  // 업데이트 내역 (새 순서). 확률표가 바뀌는 업데이트는 rates: true → 그 판의 확률표 버전을 같이 보여줌
  // 출시 전 기록은 쓰지 않음 (사용자 2026-11-10) — 출시 후부터 새 순서로 {at, lines, rates?}
  const UPDATES = [];

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
