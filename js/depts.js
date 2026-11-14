// 부서 장악 묶음 규칙: 장악전·부서 생산·외부 미팅·특근·출입증/칼퇴권/명함 (명세 docs/impl-spec-m3.md ②).
// 폰(서버 없을 때)과 서버가 같은 함수를 실행. DOM·저장·전투를 모름. 수치는 [임시 ⚖] = 밸런스팀 검토 전.
// st = 상태 (세이브 또는 서버가 만든 것): dept, pass, kaltoe, namecard, bonus, jjam, stamps, shards, + 아이템(inventory.js와 같음)
// h = inventory.js와 같은 연결부 {rng, now, emit, stat, track, onCreate}
// 재산(원)은 폰 재화 → 여기선 "몇 시간치/몇 마리치"만 돌려주고 폰 엔진이 원으로 바꿈
(function (G) {
  'use strict';
  const Inv = G.Inv;
  const dayNum = (t) => G.Meta.dayNum(t);
  const ok = (o = {}) => ({ ok: true, ...o });
  const no = (reason) => ({ ok: false, reason });
  const H_MS = 3600000;

  // ----- 부서 (장악 순서 ✅) -----
  // slots: 시간당 생산 (lv 1). res: gold(재산, 방치 1시간치 × goldHours) · stamps · jjam · bonus · pass · shards · namecard · equip [임시 ⚖]
  const DEPTS = [
    { id: 'finance', name: '재무팀', boss: '예산킬러 마부장', meeting: '깐깐한 감사관 박실장', dungeon: { name: '재산 특근', res: 'gold' },
      slots: [{ res: 'gold', goldHours: 0.2 }, { res: 'stamps', rate: 2 }] }, // 도장 4→2 (2026-10-26 사용자: 부서 도장 하루 약 200)
    { id: 'general', name: '총무팀', boss: '비품왕 나이사', meeting: '콧대높은 협력사 이이사', dungeon: { name: '결재 도장 특근', res: 'stamps' },
      slots: [{ res: 'stamps', rate: 5 }, { res: 'jjam', rate: 0.5 }] }, // 도장 12→5
    { id: 'hr', name: '인사팀', boss: '고과저승사자 오차장', meeting: '악덕 컨설턴트 한고문', dungeon: { name: '짬 특근', res: 'jjam' },
      slots: [{ res: 'bonus', rate: 20 }, { res: 'pass', rate: 0.25 }] }, // 출입증 0.3→0.25 (하루 약 30판)
    { id: 'it', name: '전산팀', boss: '랜선요괴 배팀장', meeting: '변덕쟁이 광고주 정팀장', dungeon: { name: '장비 특근', res: 'equip' },
      slots: [{ res: 'equip', rate: 2 }, { res: 'gold', goldHours: 0.1 }] },
    { id: 'sales', name: '영업팀', boss: '접대의신 강이사', meeting: '갑질 거래처 김대표', dungeon: { name: '장신구 조각 특근', res: 'shards' },
      slots: [{ res: 'shards', rate: 2 }, { res: 'bonus', rate: 10 }] },
    { id: 'plan', name: '기획팀', boss: '수정지옥 공부장', meeting: '까다로운 투자자 최본부장', dungeon: { name: '성과급 특근', res: 'bonus' },
      slots: [{ res: 'namecard', rate: 3 }, { res: 'pass', rate: 0.25 }] },
  ];
  const BY_ID = Object.fromEntries(DEPTS.map((d, i) => [d.id, { ...d, n: i + 1 }]));
  const IDS = DEPTS.map((d) => d.id);
  // 서버 지갑에 바로 들어가는 재화 (원·장비 제외)
  const WALLET_RES = ['bonus', 'jjam', 'stamps', 'shards', 'pass', 'kaltoe', 'namecard'];

  const CFG = {
    every: 30, // 장악전 층 간격 ✅
    storeH: 10, subExtraH: 4, // 적재 상한 ✅
    lvMult: 0.5, // 레벨배율 = 1 + 0.5 × (lv − 1) [임시 ⚖]
    equipHeldMax: 20, // 전산팀 창고 최대치 = 10시간 생산량 [임시 ⚖]
    conquest: { waves: [5, 5], bossHp: 1.5, time: 60, firstBonus: 1000 }, // 첫 승리 1,000 ✅
    meeting: { bossHp: 2, time: 30, namecard: (n) => 5 + n, pass: 1 }, // [임시 ⚖]
    dungeon: { waves: [5, 5], bossHp: 1, time: 45, stepFloors: 10, firstBonus: 20, floorMargin: 20, sweepMax: 50 }, // [임시 ⚖]
    passShop: { perDay: 3, cost: 100, pass: 3 }, // 성과급 100 = 출입증 3장 ✅ (5장이면 성과급 특근으로 성과급이 불어남)
  };

  const fresh = () => ({
    conquered: 0,
    owned: {}, // id → {lv, since, frac: {res: 소수}, held: {equip}}
    meeting: { day: null, done: {} },
    won: {},
    dungeon: { best: {}, first: {} },
    passShop: { day: null, n: 0 },
  });
  const toInt = (v, d = 0) => (Number.isInteger(v) && v >= 0 ? v : d);
  const num = (v, d = 0) => (typeof v === 'number' && isFinite(v) && v >= 0 ? v : d);
  const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
  // 세이브·서버 값 정리 (모르는 부서 키 제거, conquered와 owned 맞추기, 미래 since는 지금으로)
  function clean(raw, now) {
    const r = obj(raw);
    const d = fresh();
    d.conquered = toInt(r.conquered);
    const owned = obj(r.owned);
    const have = Math.min(DEPTS.length, d.conquered);
    for (let i = 0; i < have; i++) {
      const id = IDS[i];
      const o = obj(owned[id]);
      const since = num(o.since, now);
      const frac = {};
      for (const k of Object.keys(obj(o.frac))) if (typeof o.frac[k] === 'number' && isFinite(o.frac[k]) && o.frac[k] >= 0 && o.frac[k] < 1) frac[k] = o.frac[k];
      d.owned[id] = { lv: Math.max(1, toInt(o.lv, 1)), since: Math.min(since, now), frac, held: { equip: Math.min(CFG.equipHeldMax, toInt(obj(o.held).equip)) } };
    }
    const m = obj(r.meeting);
    d.meeting.day = Number.isInteger(m.day) ? m.day : null;
    for (const id of Object.keys(obj(m.done))) if (d.owned[id] && m.done[id] === true) d.meeting.done[id] = true;
    for (const id of Object.keys(obj(r.won))) if (d.owned[id] && r.won[id] === true) d.won[id] = true;
    const dg = obj(r.dungeon);
    for (const id of IDS) {
      if (!d.owned[id]) continue;
      d.dungeon.best[id] = toInt(obj(dg.best)[id]);
      d.dungeon.first[id] = Math.min(d.dungeon.best[id], toInt(obj(dg.first)[id]));
    }
    const ps = obj(r.passShop);
    d.passShop = { day: Number.isInteger(ps.day) ? ps.day : null, n: toInt(ps.n) };
    return d;
  }

  // ----- 장악전·승격전 -----
  // n번째 장악전 (1~6 = 부서, 7~ = 승격전: 부서 1→6 순서로 레벨 +1)
  const conquestFloor = (n) => CFG.every * n;
  const conquestTarget = (n) => IDS[(n - 1) % DEPTS.length];
  const isPromotion = (n) => n > DEPTS.length;
  function conquestInfo(st, maxStage) {
    const n = st.dept.conquered + 1;
    const floor = conquestFloor(n);
    return { n, floor, dept: conquestTarget(n), promotion: isPromotion(n), open: maxStage >= floor };
  }
  // 승리 등록. maxStage = (폰) 최고 층 / (서버) 세이브 최고 층
  function conquer(st, h0, n, maxStage) {
    const h = Inv.hooks(h0);
    const info = conquestInfo(st, maxStage);
    if (n !== info.n) return no('이 장악전은 아직 도전할 수 없어요');
    if (!info.open) return no(`최고 ${info.floor}층부터 도전할 수 있어요`);
    const id = info.dept;
    let first = false;
    if (info.promotion) st.dept.owned[id].lv++;
    else {
      st.dept.owned[id] = { lv: 1, since: h.now(), frac: {}, held: { equip: 0 } };
      st.dept.dungeon.best[id] = 0;
      st.dept.dungeon.first[id] = 0;
      first = true;
      st.bonus += CFG.conquest.firstBonus;
    }
    st.dept.conquered = n;
    h.track('conquest');
    h.emit('conquer', { n, dept: id, promotion: info.promotion, lv: st.dept.owned[id].lv });
    h.emit('save');
    return ok({ n, dept: id, promotion: info.promotion, lv: st.dept.owned[id].lv, bonus: first ? CFG.conquest.firstBonus : 0 });
  }

  // ----- 부서 생산 -----
  const storeCap = (sub) => CFG.storeH + (sub ? CFG.subExtraH : 0);
  const lvMult = (lv) => 1 + CFG.lvMult * (lv - 1);
  // 부서별 쌓인 시간 (h)
  function hoursOf(o, now, sub) {
    return Math.max(0, Math.min(storeCap(sub), (now - o.since) / H_MS));
  }
  // 받기 전 미리보기: [{id, h, full, gains: {res: 양}, goldHours, held}]
  function preview(st, now, sub) {
    return Object.keys(st.dept.owned).map((id) => {
      const o = st.dept.owned[id];
      const hh = hoursOf(o, now, sub);
      const gains = {};
      let goldHours = 0;
      for (const s of BY_ID[id].slots) {
        if (s.res === 'gold') { goldHours += s.goldHours * hh * lvMult(o.lv); continue; }
        gains[s.res] = (gains[s.res] || 0) + s.rate * hh * lvMult(o.lv);
      }
      return { id, h: hh, full: hh >= storeCap(sub), gains, goldHours, held: o.held.equip };
    });
  }
  // 일괄 받기. 장비는 가방 빈칸만큼, 남은 건 부서 창고(최대치까지, 넘치면 생산 멈춤)
  // → { gains: {res: 개수}, goldHours, items, held }
  function claim(st, h0, sub, floor) {
    const h = Inv.hooks(h0);
    const now = h.now();
    const list = preview(st, now, sub);
    if (!list.length) return no('장악한 부서가 없어요');
    const total = {};
    let goldHours = 0;
    const items = [];
    let any = false;
    for (const p of list) {
      const o = st.dept.owned[p.id];
      if (p.h > 0) any = true;
      goldHours += p.goldHours;
      for (const res of Object.keys(p.gains)) {
        const v = p.gains[res] + (o.frac[res] || 0);
        let whole = Math.floor(v + 1e-9);
        o.frac[res] = Math.max(0, v - whole);
        if (res === 'equip') {
          // 창고가 꽉 차면 그만큼은 생산 안 됨 (소수도 버림)
          const room = CFG.equipHeldMax - o.held.equip;
          if (whole > room) { whole = Math.max(0, room); o.frac[res] = 0; }
          o.held.equip += whole;
          continue;
        }
        if (whole > 0) { st[res] += whole; total[res] = (total[res] || 0) + whole; }
      }
      // 창고 장비 → 가방 (빈칸만큼)
      while (o.held.equip > 0 && Inv.bagFree(st) > 0) {
        const it = Inv.create(st, h, G.Drops.rollSpec('equip', floor, false, h.rng), 'dept', floor);
        if (!it) break;
        o.held.equip--;
        items.push(it);
      }
      if (o.held.equip > 0) h.emit('deptHeld', { id: p.id, held: o.held.equip, full: o.held.equip >= CFG.equipHeldMax });
      o.since = now;
    }
    if (!any && !items.length) return no('아직 쌓인 게 없어요');
    h.emit('deptClaim', { gains: total, goldHours, items });
    h.emit('save');
    return ok({ gains: total, goldHours, items, held: Object.fromEntries(Object.keys(st.dept.owned).map((id) => [id, st.dept.owned[id].held.equip])) });
  }

  // ----- 외부 미팅 (하루 1번, 한국 시간 0시 초기화) -----
  function syncDay(st, now) {
    const d = dayNum(now);
    if (st.dept.meeting.day !== d) { st.dept.meeting.day = d; st.dept.meeting.done = {}; }
  }
  function meetingInfo(st, now) {
    syncDay(st, now);
    return Object.keys(st.dept.owned).map((id) => ({ id, name: BY_ID[id].meeting, n: BY_ID[id].n, done: !!st.dept.meeting.done[id], won: !!st.dept.won[id] }));
  }
  function meetingError(st, id, now) {
    if (!st.dept.owned[id]) return '장악한 부서의 거래처만 만날 수 있어요';
    syncDay(st, now);
    if (st.dept.meeting.done[id]) return '오늘은 이미 만났어요';
    return null;
  }
  // 이김(quick=false) 또는 칼퇴권으로 한 번에 처리(quick=true) → 명함·출입증
  function meeting(st, h0, id, quick) {
    const h = Inv.hooks(h0);
    const err = meetingError(st, id, h.now());
    if (err) return no(err);
    if (quick) {
      if (!st.dept.won[id]) return no('한 번 이긴 상대만 한 번에 처리할 수 있어요');
      if (st.kaltoe < 1) return no('칼퇴권이 부족해요');
      st.kaltoe--;
    }
    const n = BY_ID[id].n;
    const namecard = CFG.meeting.namecard(n);
    st.namecard += namecard;
    st.pass += CFG.meeting.pass;
    st.dept.meeting.done[id] = true;
    st.dept.won[id] = true;
    h.track('meeting');
    h.stat('meeting'); // 평생 기록 (튜토리얼 포스트잇)
    h.emit('meetingWin', { id, quick: !!quick });
    h.emit('save');
    return ok({ id, quick: !!quick, namecard, pass: CFG.meeting.pass });
  }

  // ----- 특근 (던전) -----
  const stepFloor = (id, k) => CFG.every * BY_ID[id].n + CFG.dungeon.stepFloors * (k - 1);
  // 단계 k 보상 (원은 방치 몇 시간치로 — 폰이 지금 회차 기준으로 계산)
  function stepReward(id, k) {
    switch (BY_ID[id].dungeon.res) {
      case 'gold': return { goldHours: 1 + 0.05 * k }; // ✅ 지금 회차 방치 (1 + 0.05k)시간치 (이직 직후 폭주 방지, 2026-10-26)
      case 'stamps': return { stamps: 10 + 2 * k }; // ✅ 20+4k → 10+2k
      case 'jjam': return { jjam: 2 + Math.floor(k / 3) };
      case 'equip': return { equip: 1 + Math.floor(k / 10), floor: stepFloor(id, k) };
      case 'shards': return { shards: 4 + k };
      case 'bonus': return { bonus: 10 + k }; // ✅ 10+2k → 10+k
      default: return {};
    }
  }
  function dungeonError(st, id, k, maxStage) {
    if (!st.dept.owned[id]) return '장악한 부서의 특근만 할 수 있어요';
    const best = st.dept.dungeon.best[id] || 0;
    if (!Number.isInteger(k) || k < 1 || k > best + 1) return '아직 열리지 않은 단계예요';
    if (stepFloor(id, k) > maxStage + CFG.dungeon.floorMargin) return `최고 ${stepFloor(id, k) - CFG.dungeon.floorMargin}층부터 도전할 수 있어요`;
    if (st.pass < 1) return '출입증이 부족해요';
    const rw = stepReward(id, k);
    if (rw.equip && Inv.bagFree(st) < rw.equip) return `가방 공간이 부족해요 (${rw.equip}칸 필요)`;
    return null;
  }
  // 보상 지급 (장비는 그 단계 층 드롭표, 보스처럼 한 구간 위). → 원 마리 수·아이템
  function giveStep(st, h, id, k, times) {
    const rw = stepReward(id, k);
    const out = { items: [], goldHours: 0, floor: rw.floor || stepFloor(id, k) };
    for (const res of WALLET_RES) if (rw[res]) { st[res] += rw[res] * times; out[res] = rw[res] * times; }
    if (rw.goldHours) out.goldHours = rw.goldHours * times;
    for (let i = 0; i < (rw.equip || 0) * times; i++) {
      const it = Inv.create(st, h, G.Drops.rollSpec('equip', rw.floor, true, h.rng), 'dungeon', rw.floor);
      if (it) out.items.push(it);
    }
    return out;
  }
  // 이겼을 때만 출입증 1장 ✅
  function dungeonWin(st, h0, id, k, maxStage) {
    const h = Inv.hooks(h0);
    const err = dungeonError(st, id, k, maxStage);
    if (err) return no(err);
    st.pass--;
    const out = giveStep(st, h, id, k, 1);
    let first = 0;
    if (k > (st.dept.dungeon.best[id] || 0)) st.dept.dungeon.best[id] = k;
    if (k > (st.dept.dungeon.first[id] || 0)) { st.dept.dungeon.first[id] = k; first = CFG.dungeon.firstBonus; st.bonus += first; }
    h.track('dungeon');
    h.emit('dungeonClear', { dept: id, step: k, first: first > 0 });
    h.emit('save');
    return ok({ id, k, ...out, first });
  }
  // 소탕 = 출입증 1 + 칼퇴권 1 → 최고 단계 보상 ✅, n번 한 번에
  function sweep(st, h0, id, n) {
    const h = Inv.hooks(h0);
    if (!st.dept.owned[id]) return no('장악한 부서의 특근만 할 수 있어요');
    const best = st.dept.dungeon.best[id] || 0;
    if (best < 1) return no('한 번 깬 특근만 소탕할 수 있어요');
    if (!Number.isInteger(n) || n < 1 || n > CFG.dungeon.sweepMax) return no('횟수가 올바르지 않아요');
    if (st.pass < n) return no('출입증이 부족해요');
    if (st.kaltoe < n) return no('칼퇴권이 부족해요');
    const rw = stepReward(id, best);
    if (rw.equip && Inv.bagFree(st) < rw.equip * n) return no(`가방 공간이 부족해요 (${rw.equip * n}칸 필요)`);
    st.pass -= n;
    st.kaltoe -= n;
    const out = giveStep(st, h, id, best, n);
    h.track('dungeon', n);
    h.emit('save');
    return ok({ id, k: best, n, ...out });
  }

  // ----- 출입증 상점 (성과급, 하루 3번) ✅ -----
  function passShopLeft(st, now) {
    const d = dayNum(now);
    if (st.dept.passShop.day !== d) { st.dept.passShop.day = d; st.dept.passShop.n = 0; }
    return CFG.passShop.perDay - st.dept.passShop.n;
  }
  function buyPass(st, h0) {
    const h = Inv.hooks(h0);
    if (passShopLeft(st, h.now()) <= 0) return no('오늘은 다 샀어요');
    if (st.bonus < CFG.passShop.cost) return no('성과급이 부족해요');
    st.bonus -= CFG.passShop.cost;
    st.pass += CFG.passShop.pass;
    st.dept.passShop.n++;
    h.emit('save');
    return ok({ pass: CFG.passShop.pass, cost: CFG.passShop.cost, left: passShopLeft(st, h.now()) });
  }

  // ----- 전투 정의 (엔진이 씀): 웨이브·적 층·제한시간 -----
  // kind: 'conquest' {n} | 'meeting' {id} | 'dungeon' {id, k}
  function battle(kind, a) {
    if (kind === 'conquest') {
      const id = conquestTarget(a.n);
      return { kind, floor: conquestFloor(a.n), waves: [...CFG.conquest.waves, 'boss'], bossHp: CFG.conquest.bossHp, time: CFG.conquest.time, boss: BY_ID[id].boss, dept: id };
    }
    if (kind === 'meeting') {
      return { kind, floor: CFG.every * BY_ID[a.id].n, waves: ['boss'], bossHp: CFG.meeting.bossHp, time: CFG.meeting.time, boss: BY_ID[a.id].meeting, dept: a.id };
    }
    if (kind === 'dungeon') {
      return { kind, floor: stepFloor(a.id, a.k), waves: [...CFG.dungeon.waves, 'boss'], bossHp: CFG.dungeon.bossHp, time: CFG.dungeon.time, boss: BY_ID[a.id].dungeon.name, dept: a.id, k: a.k };
    }
    return null;
  }

  G.Depts = {
    DEPTS, BY_ID, IDS, CFG, WALLET_RES, fresh, clean,
    conquestFloor, conquestTarget, isPromotion, conquestInfo, conquer,
    storeCap, lvMult, hoursOf, preview, claim,
    meetingInfo, meetingError, meeting,
    stepFloor, stepReward, dungeonError, dungeonWin, sweep,
    passShopLeft, buyPass, battle,
  };
})(globalThis.Game = globalThis.Game || {});
