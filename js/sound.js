// 효과음 (임시): 소리 파일 없이 Web Audio로 직접 합성. 나중에 진짜 음원이 오면 RECIPE 대신 파일 버퍼로 바꿈
// - AudioContext 하나, 첫 터치 때 깨움 (iOS·안드로이드는 터치 전엔 소리 못 냄)
// - 앱을 내리면 멈추고 돌아오면 이어감 (방치 중 소리 X)
// - 설정(켜기·음량)은 이 기기에만 저장 (서버 세이브와 따로 — 기기마다 다를 수 있는 설정)
// - 저전력 모드: 중요한 소리(도장·승진·보스 격파·높은 등급 뽑기 등)만
(function (G) {
  'use strict';

  const KEY = 'overtime-sound';
  const VOLS = [0.25, 0.55, 0.9]; // 작게 · 보통 · 크게
  const VOL_NAMES = ['작게', '보통', '크게'];

  // 소리마다: 최소 간격(초) · 동시 최대 · 중요(저전력 때도 남) · 음높이 흔들기
  const RULE = {
    hit: { gap: 0.045, max: 3, jitter: 0.06 },
    crit: { gap: 0.08, max: 2, jitter: 0.05 },
    kill: { gap: 0.07, max: 2, jitter: 0.05 },
    hurt: { gap: 0.25, max: 1 },
    skill: { gap: 0.15, max: 2, jitter: 0.04 },
    upgrade: { gap: 0.05, max: 2, jitter: 0.03 },
    click: { gap: 0.04, max: 1 },
    coin: { gap: 0.12, max: 2 },
    bossAppear: { gap: 1, max: 1, imp: true },
    bossDown: { gap: 0.6, max: 1, imp: true },
    floor: { gap: 0.5, max: 1 },
    promote: { gap: 1, max: 1, imp: true },
    burnout: { gap: 1, max: 1, imp: true },
    stamp: { gap: 0.3, max: 1, imp: true },
    fail: { gap: 0.2, max: 1, imp: true },
    breakIt: { gap: 0.3, max: 1, imp: true },
    gacha: { gap: 0.3, max: 1 },
    gachaHigh: { gap: 0.5, max: 1, imp: true },
    ding: { gap: 0.3, max: 1, imp: true },
    pass: { gap: 1, max: 1, imp: true },
    reject: { gap: 1, max: 1, imp: true },
  };

  function loadPrefs(store) {
    const base = { on: true, vol: 1 };
    try {
      const v = JSON.parse(store && store.getItem(KEY));
      if (v && typeof v === 'object') {
        if (typeof v.on === 'boolean') base.on = v.on;
        if (Number.isInteger(v.vol) && v.vol >= 0 && v.vol < VOLS.length) base.vol = v.vol;
      }
    } catch (e) { /* 기본값 */ }
    return base;
  }

  function createSound(opts = {}) {
    const W = opts.window || (typeof window !== 'undefined' ? window : null);
    const store = opts.storage !== undefined ? opts.storage : (W && W.localStorage) || null;
    const isLowPower = opts.isLowPower || (() => false);
    const prefs = loadPrefs(store);
    const Ctx = W && (W.AudioContext || W.webkitAudioContext);
    let ctx = null;
    let master = null;
    let noiseBuf = null;
    const last = {};
    const live = {};

    function savePrefs() { try { store && store.setItem(KEY, JSON.stringify(prefs)); } catch (e) { /* 무시 */ } }

    // 첫 터치 때만 만들고 깨움 (터치 밖에서 만들면 iOS가 막음)
    function unlock() {
      if (!Ctx || !prefs.on) return;
      try {
        if (!ctx) {
          ctx = new Ctx();
          const comp = ctx.createDynamicsCompressor();
          master = ctx.createGain();
          master.gain.value = VOLS[prefs.vol];
          master.connect(comp);
          comp.connect(ctx.destination);
          noiseBuf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.5), ctx.sampleRate);
          const d = noiseBuf.getChannelData(0);
          for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
        }
        if (ctx.state === 'suspended' && !(W.document && W.document.hidden)) ctx.resume().catch(() => {});
      } catch (e) { ctx = null; }
    }

    // ----- 합성 도구 -----
    // 음 하나: 파형·시작/끝 주파수·길이·크기
    function tone(t, { type = 'sine', f = 440, f2, dur = 0.1, vol = 0.3, attack = 0.004 }, pitch = 1) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = type;
      o.frequency.setValueAtTime(f * pitch, t);
      if (f2) o.frequency.exponentialRampToValueAtTime(Math.max(20, f2 * pitch), t + dur);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol, t + attack);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g); g.connect(master);
      o.start(t); o.stop(t + dur + 0.02);
      return o;
    }
    // 잡음: 거르기(highpass/bandpass/lowpass)·주파수·길이·크기
    function noise(t, { filter = 'highpass', f = 2000, f2, q = 1, dur = 0.05, vol = 0.3 }, pitch = 1) {
      const s = ctx.createBufferSource();
      const bq = ctx.createBiquadFilter();
      const g = ctx.createGain();
      s.buffer = noiseBuf;
      bq.type = filter;
      bq.frequency.setValueAtTime(f * pitch, t);
      if (f2) bq.frequency.exponentialRampToValueAtTime(f2 * pitch, t + dur);
      bq.Q.value = q;
      g.gain.setValueAtTime(vol, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      s.connect(bq); bq.connect(g); g.connect(master);
      s.start(t); s.stop(t + dur + 0.02);
      return s;
    }
    const arp = (t, notes, step, o, p) => notes.map((f, i) => tone(t + i * step, { ...o, f }, p)).pop();

    // ----- 소리 만드는 법 (밤 사무실: 키보드 타닥·도장 쾅·차임) -----
    const RECIPE = {
      hit: (t, p) => { noise(t, { f: 2500, dur: 0.035, vol: 0.22 }, p); return tone(t, { type: 'square', f: 1800, dur: 0.018, vol: 0.04 }, p); },
      crit: (t, p) => { noise(t, { f: 2200, dur: 0.03, vol: 0.25 }, p); noise(t + 0.035, { f: 3000, dur: 0.04, vol: 0.25 }, p); return tone(t + 0.02, { type: 'triangle', f: 1400, f2: 2100, dur: 0.09, vol: 0.12 }, p); },
      kill: (t, p) => tone(t, { type: 'sine', f: 880, f2: 1320, dur: 0.09, vol: 0.16 }, p),
      hurt: (t) => tone(t, { type: 'sine', f: 170, f2: 70, dur: 0.12, vol: 0.22 }),
      skill: (t, p) => noise(t, { filter: 'bandpass', f: 600, f2: 3200, q: 2, dur: 0.18, vol: 0.3 }, p),
      upgrade: (t, p) => tone(t, { type: 'square', f: 520, f2: 1040, dur: 0.07, vol: 0.06 }, p),
      click: (t) => tone(t, { type: 'sine', f: 1500, dur: 0.02, vol: 0.06 }),
      coin: (t) => { tone(t, { type: 'square', f: 988, dur: 0.07, vol: 0.05 }); return tone(t + 0.06, { type: 'square', f: 1319, dur: 0.16, vol: 0.05 }); },
      bossAppear: (t) => { tone(t, { type: 'sawtooth', f: 110, dur: 0.22, vol: 0.12 }); return tone(t + 0.25, { type: 'sawtooth', f: 104, dur: 0.35, vol: 0.12 }); },
      bossDown: (t) => arp(t, [523, 659, 784, 1047], 0.08, { type: 'triangle', dur: 0.2, vol: 0.18 }),
      floor: (t) => arp(t, [660, 990], 0.07, { type: 'triangle', dur: 0.12, vol: 0.1 }),
      promote: (t) => { arp(t, [523, 659, 784], 0.1, { type: 'square', dur: 0.14, vol: 0.07 }); return tone(t + 0.3, { type: 'square', f: 1047, dur: 0.45, vol: 0.08 }); },
      burnout: (t) => tone(t, { type: 'triangle', f: 440, f2: 110, dur: 0.6, vol: 0.18 }),
      // 결재 도장 "쾅": 낮은 쿵 + 종이 소리
      stamp: (t) => { noise(t, { filter: 'lowpass', f: 900, dur: 0.12, vol: 0.5 }); return tone(t, { type: 'sine', f: 140, f2: 50, dur: 0.18, vol: 0.5 }); },
      fail: (t) => tone(t, { type: 'square', f: 196, f2: 150, dur: 0.22, vol: 0.07 }),
      breakIt: (t) => { noise(t, { filter: 'highpass', f: 1200, dur: 0.35, vol: 0.35 }); return tone(t, { type: 'sawtooth', f: 300, f2: 60, dur: 0.3, vol: 0.1 }); },
      gacha: (t) => arp(t, [784, 988], 0.06, { type: 'triangle', dur: 0.1, vol: 0.12 }),
      gachaHigh: (t) => { arp(t, [784, 988, 1175, 1568, 1976], 0.06, { type: 'triangle', dur: 0.18, vol: 0.14 }); return noise(t + 0.3, { filter: 'highpass', f: 6000, dur: 0.4, vol: 0.12 }); },
      ding: (t) => { tone(t, { type: 'sine', f: 1319, dur: 0.15, vol: 0.18 }); return tone(t + 0.1, { type: 'sine', f: 1760, dur: 0.3, vol: 0.18 }); },
      pass: (t) => { return arp(t + 0.15, [523, 659, 784, 1047], 0.09, { type: 'square', dur: 0.2, vol: 0.07 }); },
      reject: (t) => { tone(t, { type: 'square', f: 220, dur: 0.15, vol: 0.07 }); return tone(t + 0.18, { type: 'square', f: 165, dur: 0.3, vol: 0.07 }); },
    };

    function play(name) {
      if (!prefs.on || !ctx || ctx.state !== 'running' || !RECIPE[name]) return false;
      if (W.document && W.document.hidden) return false;
      const r = RULE[name] || { gap: 0.05, max: 2 };
      if (isLowPower() && !r.imp) return false;
      const t = ctx.currentTime;
      if (t - (name in last ? last[name] : -9) < r.gap || (live[name] || 0) >= r.max) return false;
      last[name] = t;
      const p = r.jitter ? 1 + (Math.random() * 2 - 1) * r.jitter : 1;
      try {
        const node = RECIPE[name](t + 0.005, p);
        live[name] = (live[name] || 0) + 1;
        node.onended = () => { live[name] = Math.max(0, (live[name] || 1) - 1); };
      } catch (e) { return false; }
      return true;
    }

    function setOn(on) {
      prefs.on = !!on;
      savePrefs();
      if (prefs.on) unlock(); // 켜는 버튼을 누른 순간 = 터치 중
      else if (ctx && ctx.state === 'running') ctx.suspend().catch(() => {});
    }
    function cycleVol() {
      prefs.vol = (prefs.vol + 1) % VOLS.length;
      savePrefs();
      if (master) master.gain.value = VOLS[prefs.vol];
      return prefs.vol;
    }

    if (W && W.document) {
      for (const ev of ['pointerdown', 'touchend', 'click', 'keydown']) W.document.addEventListener(ev, unlock, true);
      W.document.addEventListener('visibilitychange', () => {
        if (!ctx) return;
        if (W.document.hidden) { if (ctx.state === 'running') ctx.suspend().catch(() => {}); } else if (prefs.on) ctx.resume().catch(() => {});
      });
    }

    return {
      play, setOn, cycleVol, unlock,
      get on() { return prefs.on; },
      get vol() { return prefs.vol; },
      volName: () => VOL_NAMES[prefs.vol],
      supported: !!Ctx,
      _recipes: Object.keys(RECIPE), _rules: RULE,
    };
  }

  // 엔진 이벤트 → 소리 (화면 버튼 소리는 ui.js에서)
  function attach(snd, bus, E) {
    bus.on('hit', ({ crit }) => snd.play(crit ? 'crit' : 'hit'));
    bus.on('kill', () => snd.play('kill'));
    bus.on('hurt', () => snd.play('hurt'));
    // 새 층으로 올라가면 '띠링' (보스는 등장음). 시작할 때·후퇴는 소리 없음
    let lastStage = E && E.S ? E.S.stage : 0;
    bus.on('spawn', (en) => {
      const st = E && E.S ? E.S.stage : 0;
      if (en && en.boss) snd.play('bossAppear');
      else if (st > lastStage) snd.play('floor');
      lastStage = st;
    });
    bus.on('itemGained', ({ item, source }) => { if ((source === 'kill' || source === 'boss') && item && item.grade >= 2) snd.play('coin'); }); // 희귀 이상 드롭
    bus.on('bossDefeated', () => snd.play('bossDown'));
    bus.on('bossRecord', () => snd.play('coin'));
    bus.on('promote', () => snd.play('promote'));
    bus.on('fail', ({ reason }) => snd.play(reason === 'burnout' ? 'burnout' : 'fail'));
    bus.on('workSkill', () => snd.play('skill'));
    bus.on('skill', () => snd.play('skill'));
    bus.on('achievement', () => snd.play('ding'));
    bus.on('towerClear', () => snd.play('bossDown'));
    bus.on('sideResult', (r) => snd.play(r && r.ok ? 'bossDown' : 'fail'));
    bus.on('enhance', ({ result }) => { if (result !== 'success') snd.play(result === 'break' ? 'breakIt' : 'fail'); }); // 성공은 화면 도장(approveStamp)이 소리 냄
    bus.on('applyResult', ({ accepted }) => snd.play(accepted ? 'pass' : 'reject')); // 합격 "쾅"은 화면 도장이 냄
    bus.on('probationFail', () => snd.play('reject'));
    bus.on('probationClear', () => snd.play('ding'));
    return snd;
  }

  G.Sound = { createSound, attach, KEY, VOLS, VOL_NAMES, loadPrefs };
})(typeof globalThis !== 'undefined' ? (globalThis.Game = globalThis.Game || {}) : {});
