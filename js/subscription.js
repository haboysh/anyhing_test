// 구독(유료 혜택) 상태. 게임 세이브와 따로 관리함.
// 서버가 있으면 서버 기록이 원본 (서버가 혜택도 직접 적용). 서버가 없을 때만 기기 테스트 켜기/끄기.
(function (G) {
  'use strict';

  const KEY = 'overtime-sub-test';

  let server = null; // 서버가 알려준 {until} (서버 모드)
  let monthly = null; // 월정액 {until} (서버 기록)
  const Subscription = {
    // 구독 혜택: 게임 속도 2배 (방치 보상·부서 적재 +4시간은 서버가 적용)
    BENEFITS: { speed: 2 },
    setServer(sub) { server = sub && typeof sub === 'object' ? { until: typeof sub.until === 'number' ? sub.until : null } : null; },
    isActive() {
      if (server) return server.until !== null && server.until > Date.now();
      try { return globalThis.localStorage && localStorage.getItem(KEY) === '1'; } catch (e) { return false; }
    },
    // 서버 없는 테스트판: 기기에만 30일 (출석 보상 확인용)
    setMonthlyForTest(days) { monthly = { until: Math.max(monthly && monthly.until > Date.now() ? monthly.until : Date.now(), Date.now()) + days * 86400000 }; },
    setMonthly(m) { monthly = m && typeof m === 'object' && typeof m.until === 'number' ? { until: m.until } : null; },
    monthlyUntil() { return monthly && monthly.until > Date.now() ? monthly.until : null; },
    setActiveForTest(on) {
      try { if (on) localStorage.setItem(KEY, '1'); else localStorage.removeItem(KEY); } catch (e) { /* 무시 */ }
    },
  };

  G.Subscription = Subscription;
})(globalThis.Game = globalThis.Game || {});
