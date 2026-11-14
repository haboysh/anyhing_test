// 시작점: 세이브 불러오기 → 엔진·화면 연결 → 게임 루프 · 자동 저장
(function (G) {
  'use strict';

  // 간단한 이벤트 전달 통로 (엔진 → 화면)
  function createBus() {
    const handlers = {};
    return {
      on(name, fn) { (handlers[name] = handlers[name] || []).push(fn); },
      emit(name, data) { (handlers[name] || []).forEach((fn) => fn(data)); },
    };
  }

  function boot() {
    const bus = createBus();
    const state = G.State.migrate(G.Storage.load());
    const engine = G.createEngine({ state, emit: bus.emit });

    function save() {
      engine.S.lastSave = Date.now();
      G.Storage.save(engine.S);
    }
    bus.on('save', save);

    const Sub = G.Subscription;
    // 구독 중이고 2배속을 켜뒀으면 게임 속도 2배
    function applySpeed() {
      engine.setTimeScale(Sub.isActive() && engine.S.speedOn ? Sub.BENEFITS.speed : 1);
    }
    applySpeed();

    // 구독 중이면 방치 보상 상한 +4시간
    const SUB_OFFLINE_EXTRA_SEC = 4 * 3600;
    const offlineOpts = (elapsedSec) => ({
      elapsedSec: typeof elapsedSec === 'number' ? elapsedSec : undefined,
      extraMaxSec: Sub.isActive() ? SUB_OFFLINE_EXTRA_SEC : 0,
    });

    // 서버 (설정이 비어 있으면 기기 저장만)
    const cloud = G.createCloud({ config: G.Config });
    let ui = null;
    const sync = G.createSync({
      engine, storage: G.Storage, cloud,
      onChange: () => ui && ui.markDirty(),
    });
    bus.on('towerClear', ({ floor }) => sync.towerClear(floor));
    // 이직·이직 보상은 정식판에선 서버가 합격 때 바로 정함 (sync.js applyTo, op career)
    bus.on('bossRecord', ({ floor }) => sync.bossRecord(floor));

    // 효과음 (기기 설정, 저전력이면 중요한 소리만)
    const sound = G.Sound ? G.Sound.attach(G.Sound.createSound({ isLowPower: () => engine.S.settings.lowPower === true }), bus, engine) : null;

    ui = G.createUI(engine, bus, {
      sound,
      isSubscribed: () => Sub.isActive(),
      setSubscribedForTest(on) { return sync.subTest(on).then((r) => { applySpeed(); return r; }); },
      applySpeed,
      sync,
      onReset() {
        // 정식판(서버 모드)은 진행이 서버 장부라 [처음부터 다시]가 없음 (사용자 확정 2026-10-29). 처음부터 하려면 [계정 삭제]
        if (sync.online) return;
        G.Storage.clear();
        engine.reset(G.State.freshState());
        save();
        // 서버 모드: 아이템·재화·스킬·반려·인맥·포스트잇은 서버 기록이라 안 지워짐 → 새 세이브를 올린 뒤 서버 값을 다시 받음
        // (예전엔 다음 접속 전까지 가방·재화가 0으로 보이고 그 상태로 버튼이 서버에 보내졌음, 2026-10-29)
        Promise.resolve(sync.push()).then(() => (sync.online ? sync.hello() : null)).then(() => ui.renderPanel()).catch(() => {});
      },
    });

    ui.initVisuals();
    engine.start();
    ui.renderPanel();

    // 온라인 전용 (2026-10-27 사용자): 서버가 설정된 정식판은 연결돼야만 플레이. 끊기면 막는 화면.
    // 서버 설정이 없는 테스트판(Claude 링크)은 개발 확인용이라 지금처럼 기기에서 돔
    const requireOnline = cloud.status !== 'off';
    let netOk = !requireOnline;
    const gate = document.getElementById('net-gate');
    function setNet(ok, msg) {
      netOk = ok || !requireOnline;
      if (!requireOnline) return;
      gate.hidden = netOk;
      if (!netOk) document.getElementById('net-msg').textContent = msg || '서버에 연결할 수 없어요. 인터넷 연결을 확인해 주세요.';
    }
    if (requireOnline) setNet(false, '서버에 연결하는 중…');
    document.getElementById('net-retry').addEventListener('click', () => { setNet(false, '서버에 연결하는 중…'); claimOffline(); });
    window.addEventListener('offline', () => setNet(false));
    window.addEventListener('online', () => claimOffline());

    // 방치 보상: 서버가 있으면 서버 시계 기준 (기기 시계 조작 방지). 연결 실패면 기기 시계(테스트판만)
    let offlineBusy = false;
    async function claimOffline() {
      if (offlineBusy) return;
      offlineBusy = true;
      // 기기 시계 경과 시간은 기다리기 전에 재둠 (기다리는 동안 자동 저장이 기준 시각을 바꿈)
      let elapsed = (Date.now() - engine.S.lastSave) / 1000;
      if (requireOnline) {
        try {
          const server = await sync.hello();
          if (typeof server === 'number') elapsed = server;
          applySpeed(); // 구독은 서버 기록을 따름
          setNet(true);
        } catch (e) {
          setNet(false);
          offlineBusy = false;
          return; // 연결 안 되면 보상도 플레이도 없음
        }
      }
      // 재산은 기기, 장비·결재 도장은 서버 모드면 서버가 정함
      try { ui.showOffline(await sync.claimOffline(offlineOpts(elapsed))); } catch (e) { /* 표시 실패 */ }
      ui.renderPanel();
      offlineBusy = false;
    }
    claimOffline();

    let last = performance.now();
    let saveTimer = 0;
    let uiTimer = 0;
    // 게임 계산 최대 초당 60번 (120Hz 폰도 60, 사용자 2026-11-14) · 저전력 모드는 초당 약 30번, 화면 숫자 갱신 0.5초마다(보통 0.1초), CSS 움직임 끔 (body.low-power)
    const FRAME_MS = 1000 / 60;
    let due = 0; // 다음 계산 예정 시각: 90Hz·120Hz 화면도 평균 초당 60번 (예정 시각보다 2ms 일찍까지 허용)
    const LOW_FRAME_MS = 25; // 25ms 기다린 뒤 다음 화면 갱신(60Hz면 33ms 뒤) → 초당 약 30번
    const lowPower = () => engine.S.settings.lowPower === true;
    function next() {
      if (lowPower()) setTimeout(() => requestAnimationFrame(loop), LOW_FRAME_MS);
      else requestAnimationFrame(loop);
    }
    function loop(t) {
      if (!lowPower()) {
        if (t < due - 2) { requestAnimationFrame(loop); return; } // 90·120Hz 화면: 프레임 건너뜀
        due = Math.max(due, t - FRAME_MS) + FRAME_MS;
      }
      const dt = Math.max(0, Math.min(0.25, (t - last) / 1000)); // 앱을 다시 열면 last가 이번 프레임 시각보다 뒤일 수 있음 → 음수 막음
      last = t;
      document.body.classList.toggle('low-power', lowPower());
      if (requireOnline && netOk && cloud.status === 'offline') setNet(false);
      if (!netOk) { next(); return; } // 연결이 끊기면 멈춤
      engine.update(dt);
      uiTimer += dt;
      if (uiTimer > (lowPower() ? 0.5 : 0.1)) { uiTimer = 0; ui.tick(); }
      saveTimer += dt;
      // 5초마다: 저장 + 구독 2배속 다시 확인 (켜 둔 채 구독이 끝나면 2배속이 남아 서버가 처치를 거절하던 것, 2026-11-12)
      if (saveTimer > 5) { saveTimer = 0; save(); sync.maybePush(); applySpeed(); }
      next();
    }
    requestAnimationFrame(loop);

    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        if (engine.side) engine.sideExit(); // 앱을 내리면 장악전·특근 취소 (재화는 그대로)
        save(); sync.push();
        if (sync.flushKills) sync.flushKills(); // 처치 묶음은 10초마다 → 앱 내릴 때 바로 (사용자 확정)
      } else {
        claimOffline();
        last = performance.now();
      }
    });

    // 오프라인 캐시 (막힌 환경에선 조용히 건너뜀)
    try {
      if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
    } catch (e) { /* 쓸 수 없는 환경 */ }

    // 개발용: 내 컴퓨터에서 띄울 때만 콘솔에서 엔진 접근 허용
    if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') G.debug = { engine, bus, sync, cloud };
  }

  window.addEventListener('DOMContentLoaded', boot);
})(globalThis.Game = globalThis.Game || {});
