// 저장소 연결부. 게임은 이 load/save/clear만 씀.
// 나중에 앱 전용 저장소(Capacitor Preferences)나 클라우드 저장(로그인 연동)으로
// 바꿀 때 이 파일만 교체하면 됨.
(function (G) {
  'use strict';

  const KEY = 'overtime-idle-save-v1';

  const LocalStorage = {
    load() {
      try {
        const raw = globalThis.localStorage && localStorage.getItem(KEY);
        return raw ? JSON.parse(raw) : null;
      } catch (e) {
        return null;
      }
    },
    save(data) {
      try { localStorage.setItem(KEY, JSON.stringify(data)); return true; } catch (e) { return false; }
    },
    clear() {
      try { localStorage.removeItem(KEY); } catch (e) { /* 무시 */ }
    },
  };

  G.Storage = LocalStorage;
})(globalThis.Game = globalThis.Game || {});
