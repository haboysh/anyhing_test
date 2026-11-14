// 오프라인에서도 열리도록 캐시 (항상 최신 버전 우선)
const CACHE = 'overtime-v31';
self.addEventListener('install', (e) => self.skipWaiting());
// 예전 버전 캐시 지우기 (버전마다 그림·글꼴 전체가 따로 쌓여 폰 저장 공간을 계속 차지했음)
self.addEventListener('activate', (e) => e.waitUntil(
  caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith('overtime-') && k !== CACHE).map((k) => caches.delete(k))))
    .catch(() => {})
    .then(() => self.clients.claim())
));
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  if (new URL(e.request.url).origin !== self.location.origin) return; // 서버 API·로그인은 캐시 안 함
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res.ok) { // 오류 응답(404 등)은 캐시에 안 넣음
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {}); // 저장 공간 부족 등은 무시
        }
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});
