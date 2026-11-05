// 아이템·재료 규칙 (드롭·뽑기·상자·감정·강화·합성·분해·보호·양파나라·결재 도장 구매).
// 폰(엔진, 서버 없을 때)과 서버(Edge Function)가 같은 함수를 실행 → 결과 규칙이 한 곳에만 있음.
// DOM·저장·전투를 모름. st = 상태(세이브 E.S 또는 서버가 DB로 만든 것), h = 연결부:
//   h.rng() 난수 · h.now() 시각 · h.emit(이름, 값) · h.stat(이름, 값, 최대) · h.track(이벤트, n) · h.onCreate(아이템, 출처)
// st에서 쓰는 것: items, nextItemId, gold, bonus, jjam, stamps, shards, mergeFail, equipped, bagBuys,
//   autoAppraise, market, stampShop, gacha. (서버 처치 보고처럼 아이템 목록 없이 개수만 알 때는 st.bagUsed)
(function (G) {
  'use strict';
  const I = G.Items;
  const Eq = G.Equipment;
  const dayNum = (t) => G.Meta.dayNum(t); // meta.js는 이 파일보다 늦게 로드됨
  const MK = I.MARKET;

  const ok = (o = {}) => ({ ok: true, ...o });
  const no = (reason) => ({ ok: false, reason });
  const K = () => I.COST_K;
  const noop = () => {};
  // 빠진 연결부는 아무것도 안 함
  const hooks = (h) => ({ rng: Math.random, now: Date.now, emit: noop, stat: noop, track: noop, onCreate: noop, ...h });

  // ----- 가방 -----
  const bagSize = (st) => I.BAG.base + I.BAG.step * Math.min(I.BAG.maxBuys, st.bagBuys | 0);
  const bagUsed = (st) => (typeof st.bagUsed === 'number' ? st.bagUsed : st.items.length);
  const bagFree = (st) => Math.max(0, bagSize(st) - bagUsed(st));
  const find = (st, id) => st.items.find((it) => it.id === id) || null;
  const isEquipped = (st, id) => Object.values(st.equipped || {}).some((x) => x === id);
  function removeIds(st, ids) {
    const del = new Set(ids);
    const before = st.items.length;
    st.items = st.items.filter((it) => !del.has(it.id));
    if (typeof st.bagUsed === 'number') st.bagUsed -= before - st.items.length;
  }

  // ----- 만들기 -----
  // 감정 (재산 차감). 못 하면 이유
  function doAppraise(st, h, item) {
    if (item.appraised) return '이미 감정한 아이템이에요';
    const cost = Eq.appraiseCost(item, K());
    if (st.gold < cost) return '재산이 부족해요';
    st.gold -= cost;
    item.potentials = Eq.rollPotentials(item, h.rng);
    item.appraised = true;
    h.emit('appraise', { item });
    return null;
  }
  function add(st, h, item, source) {
    st.nextItemId = Math.max(st.nextItemId, item.id + 1);
    st.items.push(item);
    if (typeof st.bagUsed === 'number') st.bagUsed++;
    h.onCreate(item, source);
    // 자동 감정 (고급·희귀, 재산이 충분할 때만). 합성 결과는 미감정으로 둠
    if (source !== 'merge' && st.autoAppraise && !item.appraised && I.APPRAISE.autoGrades.includes(item.grade)) doAppraise(st, h, item);
    h.emit('itemGained', { item, source });
    return item;
  }
  // 스펙 {slot, type, grade, plus?} → 아이템. 가방이 가득이면 null + bagFull
  function create(st, h, spec, source, floor) {
    if (bagFree(st) <= 0) { h.emit('bagFull', { source }); return null; }
    const item = Eq.createItem({ id: st.nextItemId, type: spec.type, grade: spec.grade, floor, plus: spec.plus });
    return add(st, h, item, source);
  }

  // ----- 처치 드롭 (f = 유효 층). dropMult = 회사 드롭 배율 (1보다 크면 그만큼 한 번 더 굴릴 확률) -----
  // top = 이번 회차 최고 유효 층 → 낮은 층 드롭 감소 (장비·조각·도장, items.js DROP.lowFloor)
  function kill(st, h0, f, boss, dropMult = 1, top) {
    const h = hooks(h0);
    const low = G.Drops.lowFloorMult(f, top);
    if (h.rng() < (boss ? I.STAMP.free.bossRate : I.STAMP.free.killRate) * low) { st.stamps++; h.emit('stampDrop', { n: 1 }); }
    const drop = G.Drops.rollKill(f, boss, h.rng, low);
    st.shards += drop.shards;
    if (drop.equip) create(st, h, drop.equip, boss ? 'boss' : 'kill', f);
    const extra = dropMult - 1;
    if (!boss && extra > 0 && h.rng() < extra) {
      const d2 = G.Drops.rollKill(f, false, h.rng, low);
      if (d2.equip) create(st, h, d2.equip, 'kill', f);
    }
  }

  // ----- 퇴근 후 정산: 장비(가방 빈칸만큼)·결재 도장 -----
  // f = 확률표 층(마지막 처치 층), itemFloor = 아이템 층(지금 유효 층)
  function offline(st, h0, sec, f, itemFloor = f) {
    const h = hooks(h0);
    const want = G.Drops.offlineEquipCount(sec);
    const specs = G.Drops.rollOffline(sec, f, h.rng, bagFree(st));
    const items = specs.map((sp) => create(st, h, sp, 'offline', itemFloor)).filter(Boolean);
    if (items.length < want) h.emit('bagFull', { source: 'offline', lost: want - items.length });
    const stamps = Math.floor(sec / 3600 * I.STAMP.free.offlinePerHour);
    st.stamps += stamps;
    return { items, stamps };
  }

  // ----- 상자 -----
  // 장신구 조각 20개 → 장신구 1개 (상자 확률표, f = 유효 층)
  function shardBox(st, h0, f) {
    const h = hooks(h0);
    const need = I.DROP.shardsPerBox;
    if (st.shards < need) return no(`장신구 조각이 ${need}개 필요해요`);
    if (bagFree(st) <= 0) { h.emit('bagFull', { source: 'box' }); return no('가방이 가득 찼어요'); }
    st.shards -= need;
    const item = create(st, h, G.Drops.rollShardBox(f, h.rng), 'box', f);
    h.emit('save');
    return ok({ item });
  }
  // 등급이 정해진 상자 (출석 보상) → 그 등급 장비/장신구 1개
  function gradeBox(st, h0, box, floor) {
    const h = hooks(h0);
    const { slot, type } = G.Drops.rollSlotType(box.kind, h.rng);
    return create(st, h, { slot, type, grade: box.grade }, 'box', Math.max(1, floor));
  }

  // ----- 뽑기 n회 (1/11/35). kind = 'acc'(장신구) | 'equip'(장비) | 'skill'(업무 스킬) | 'pet'(반려). floor = 아이템 층 -----
  // 업무 스킬은 가방을 안 씀: 등급 → 스킬 키 → st.skills 보유에 더함 (서버 모드면 meta_states.skill). 그 등급이 전부 만렙이면 짬
  // 반려도 가방을 안 씀: 등급 → 반려·단계(pets.js) → st.pet.own 개수에 더함 (서버 모드면 meta_states.pet, 명세 ④ 31절)
  const GACHA_KIND = { acc: 'accessory', equip: 'equip', skill: 'skill', pet: 'pet' };
  function gacha(st, h0, n, kind, floor) {
    const h = hooks(h0);
    if (!GACHA_KIND[kind]) return no('없는 뽑기예요');
    const cost = G.Gacha.costFor(n);
    if (cost === null) return no('없는 뽑기 횟수예요');
    const isSkill = kind === 'skill';
    const isPet = kind === 'pet';
    if (isPet && !G.Pets.isOpen(st.maxStage)) return no(`반려는 최고 ${G.Pets.CFG.unlock}층에서 열려요`);
    if (!isSkill && !isPet && bagFree(st) < n) return no(`가방 공간이 부족해요 (${n}칸 필요)`);
    if (st.bonus < cost) return no('성과급이 부족해요');
    st.bonus -= cost;
    const gs = st.gacha[kind] || G.Gacha.fresh();
    const start = G.Gacha.pullMany(gs, h.rng, 0).state.count;
    const r = G.Gacha.pullMany(gs, h.rng, n, G.Gacha.configFor(kind));
    st.gacha[kind] = r.state;
    const results = isPet
      ? r.results.map((res, i) => {
        const got = G.Pets.pullOne(st, h, res.grade);
        return { ...res, ...got, slot: 'pet', type: G.Pets.codexKey(got.pet, got.tier), pullNo: start + i + 1 };
      })
      : isSkill
      ? r.results.map((res, i) => {
        const key = G.Skills.pickKey(res.grade, h.rng());
        return { ...res, slot: 'skill', type: key, skill: key, pullNo: start + i + 1, ...G.Skills.pullGain(st, h, res.grade, key) };
      })
      : r.results.map((res, i) => {
      const { slot, type } = G.Drops.rollSlotType(GACHA_KIND[kind], h.rng);
      const item = create(st, h, { slot, type, grade: res.grade }, 'gacha', Math.max(1, floor));
      return { ...res, slot, type, pullNo: start + i + 1, item };
    });
    // 업적·미션 기록(뽑은 수·연속 일반)은 기기 엔진이 결과를 보고 셈
    h.emit('gacha', { results, kind });
    h.emit('save');
    return ok({ results, cost, kind });
  }

  // ----- 감정 -----
  function appraise(st, h0, id) {
    const h = hooks(h0);
    const item = find(st, id);
    if (!item) return no('없는 아이템이에요');
    const err = doAppraise(st, h, item);
    if (err) return no(err);
    h.emit('save');
    return ok({ item });
  }
  // 재감정: lockIdx 줄은 유지. 짬이 모자라면 짬 1 = 성과급 30으로 대신 냄
  function reappraise(st, h0, id, lockIdx = []) {
    const h = hooks(h0);
    const item = find(st, id);
    if (!item) return no('없는 아이템이에요');
    if (!I.POTENTIAL.lines[item.grade]) return no('잠재능력이 없는 아이템이에요');
    if (!item.appraised) return no('먼저 감정해 주세요');
    const n = item.potentials.length;
    const locks = Array.isArray(lockIdx) ? lockIdx : [];
    if (locks.some((i) => !Number.isInteger(i) || i < 0 || i >= n) || new Set(locks).size !== locks.length) {
      return no('잠글 줄이 올바르지 않아요');
    }
    const cost = Eq.reappraiseCost(item, K(), locks.length);
    if (!cost) return no(`이 등급은 최대 ${Eq.maxLocks(item.grade)}줄까지 잠글 수 있어요`);
    const jjamUse = Math.min(st.jjam, cost.jjam);
    const bonusUse = cost.lockBonus + (cost.jjam - jjamUse) * I.APPRAISE.jjamToBonus;
    if (st.gold < cost.won) return no('재산이 부족해요');
    if (st.bonus < bonusUse) return no(cost.jjam > jjamUse ? '짬과 성과급이 부족해요' : '성과급이 부족해요');
    st.gold -= cost.won;
    st.jjam -= jjamUse;
    st.bonus -= bonusUse;
    item.potentials = Eq.rollPotentials(item, h.rng, locks);
    h.emit('appraise', { item });
    h.emit('save');
    return ok({ item, paid: { won: cost.won, jjam: jjamUse, bonus: bonusUse } });
  }

  // ----- 강화 (docs/enhance-table.md) -----
  function enhanceError(item) {
    if (!item) return '없는 아이템이에요';
    if (item.ruined) return '흔적은 먼저 복구해 주세요';
    if (item.plus >= I.ENHANCE.max) return '최대 강화예요';
    return null;
  }
  // 1회 강화. o = {boost: 성공 보정 짬, protect: 파괴 방지 짬}
  function enhanceOnce(st, h, item, o) {
    const cost = Eq.enhanceCost(item, K());
    if (st.gold < cost) return { err: '재산이 부족해요' };
    const odds = Eq.enhanceOdds(item.plus, item.downs, o);
    const jjamUse = odds.boost + odds.protect;
    if (st.jjam < jjamUse) return { err: '짬이 부족해요' };
    const stampUse = Eq.stampCost(item);
    if (st.stamps < stampUse) return { err: '결재 도장이 부족해요' };
    st.gold -= cost;
    st.jjam -= jjamUse;
    st.stamps -= stampUse;
    const from = item.plus;
    const result = Eq.rollEnhance(odds, h.rng);
    let removed = false;
    if (result === 'success') { item.plus++; item.downs = 0; }
    else if (result === 'stay') { item.downs = 0; st.jjam += I.ENHANCE.failJjam; h.stat('jjam_fail', I.ENHANCE.failJjam); }
    else if (result === 'down') { item.plus = Math.max(0, item.plus - 1); item.downs++; st.jjam += I.ENHANCE.failJjam; h.stat('jjam_fail', I.ENHANCE.failJjam); }
    else {
      st.jjam += I.ENHANCE.breakJjam;
      item.downs = 0;
      if (I.ENHANCE.ruinGrades.includes(item.grade)) item.ruined = true;
      else { removeIds(st, [item.id]); removed = true; }
    }
    h.track('enhance');
    h.stat('enhance'); // 평생 기록 (튜토리얼 포스트잇)
    return { result, cost, jjamUse, stampUse, odds, from, to: item.plus, removed };
  }
  function enhance(st, h0, id, o = {}) {
    const h = hooks(h0);
    const item = find(st, id);
    const err = enhanceError(item);
    if (err) return no(err);
    const r = enhanceOnce(st, h, item, o);
    if (r.err) return no(r.err);
    const success = r.result === 'success';
    h.emit('enhance', { item, success, ...r });
    h.emit('save');
    return ok({ item, success, ...r, rate: r.odds.s });
  }
  // 흔적 복구 → +10
  const restoreCost = (st, id) => { const it = find(st, id); return it && it.ruined ? Eq.restoreCost(it, K()) : null; };
  function restore(st, h0, id) {
    const h = hooks(h0);
    const item = find(st, id);
    if (!item) return no('없는 아이템이에요');
    if (!item.ruined) return no('흔적이 아니에요');
    const cost = restoreCost(st, id);
    const stamps = Eq.restoreStamps(item);
    if (st.gold < cost) return no('재산이 부족해요');
    if (st.stamps < stamps) return no(`결재 도장이 부족해요 (${stamps}개 필요)`);
    st.gold -= cost;
    st.stamps -= stamps;
    item.ruined = false;
    item.plus = I.ENHANCE.restorePlus;
    item.downs = 0;
    h.emit('restore', { item });
    h.emit('save');
    return ok({ item, cost });
  }
  // 자동 강화. o = {target, boost, protect, stopAt12, stopOnDown, maxTries}
  const AUTO_MAX_TRIES = 10000;
  function autoEnhance(st, h0, id, o = {}) {
    const h = hooks(h0);
    const item = find(st, id);
    const err = enhanceError(item);
    if (err) return no(err);
    const target = Math.min(I.ENHANCE.max, Number.isInteger(o.target) ? o.target : I.ENHANCE.max);
    if (target <= item.plus) return no('목표 단계가 지금보다 높아야 해요');
    const maxTries = Number.isInteger(o.maxTries) && o.maxTries > 0 ? Math.min(AUTO_MAX_TRIES, o.maxTries) : AUTO_MAX_TRIES;
    const sum = { tries: 0, gold: 0, jjam: 0, stamps: 0, downs: 0, breaks: 0, start: item.plus, end: item.plus, stop: 'target' };
    while (sum.tries < maxTries) {
      if (item.plus >= target) { sum.stop = 'target'; break; }
      const r = enhanceOnce(st, h, item, { boost: o.boost, protect: o.protect });
      if (r.err) { sum.stop = r.err === '짬이 부족해요' ? 'jjam' : r.err === '결재 도장이 부족해요' ? 'stamp' : 'gold'; break; }
      sum.tries++; sum.gold += r.cost; sum.jjam += r.jjamUse; sum.stamps += r.stampUse;
      if (r.result === 'down') sum.downs++;
      if (r.result === 'break') { sum.breaks++; sum.stop = 'break'; break; }
      if (r.result === 'down' && o.stopOnDown) { sum.stop = 'down'; break; }
      if (o.stopAt12 && r.from < 12 && item.plus >= 12) { sum.stop = 'at12'; break; }
      if (sum.tries >= maxTries) sum.stop = 'maxTries';
    }
    sum.end = item.ruined ? null : item.plus;
    sum.removed = !find(st, id);
    h.emit('autoEnhance', { item, summary: sum });
    h.emit('save');
    return ok({ item, summary: sum });
  }
  // 일괄 강화: 고른 아이템들을 목표 단계까지 (최대 +10 = 강등·파괴 없는 구간), 싼 것부터 한 단계씩 고르게
  // scope: 'equipped'(장착 중) | 'all'(보호 제외 전부). 재산이 모자라면 멈춤
  const ENHANCE_ALL_MAX = 10;
  function enhanceAll(st, h0, o = {}) {
    const h = hooks(h0);
    const target = Math.min(ENHANCE_ALL_MAX, Number.isInteger(o.target) ? o.target : ENHANCE_ALL_MAX);
    const pick = (it) => !it.ruined && it.plus < target && (o.scope === 'all' ? !it.protected || isEquipped(st, it.id) : isEquipped(st, it.id));
    const sum = { tries: 0, gold: 0, stamps: 0, ups: 0, items: 0, stop: 'target' };
    const touched = new Set();
    let guard = 0;
    while (guard++ < 100000) {
      const list = st.items.filter(pick);
      if (!list.length) { sum.stop = 'target'; break; }
      list.sort((a, b) => Eq.enhanceCost(a, K()) - Eq.enhanceCost(b, K()));
      const it = list[0];
      const r = enhanceOnce(st, h, it, {});
      if (r.err) { sum.stop = r.err === '결재 도장이 부족해요' ? 'stamp' : 'gold'; break; }
      sum.tries++; sum.gold += r.cost; sum.stamps += r.stampUse;
      if (r.result === 'success') sum.ups++;
      touched.add(it.id);
    }
    sum.items = touched.size;
    if (!sum.tries) return no(sum.stop === 'gold' ? '재산이 부족해요' : sum.stop === 'stamp' ? '결재 도장이 부족해요' : `강화할 장비가 없어요 (목표 +${target})`);
    h.emit('autoEnhance', { summary: sum });
    h.emit('save');
    return ok(sum);
  }

  // ----- 합성: 같은 부위·등급 4개 → 다음 등급. 재료는 성공·실패 모두 소멸 -----
  function merge(st, h0, ids) {
    const h = hooks(h0);
    if (!Array.isArray(ids)) return no(`같은 부위·등급 아이템 ${I.MERGE.count}개가 필요해요`);
    const items = ids.map((id) => find(st, id));
    if (items.some((x) => !x)) return no('없는 아이템이에요');
    const err = Eq.mergeError(items, st.equipped);
    if (err) return no(err);
    const grade = items[0].grade;
    const r = Eq.merge(items, h.rng, st.mergeFail[grade], st.nextItemId);
    removeIds(st, ids);
    st.mergeFail[grade] = r.failStreak;
    st.jjam += r.jjam;
    const item = r.success ? add(st, h, r.item, 'merge') : null;
    h.stat('merge'); // 평생 기록 (튜토리얼 포스트잇)
    h.emit('merge', { success: r.success, item });
    h.emit('save');
    return ok({ success: r.success, item, rate: r.rate, jjam: r.jjam });
  }
  const mergeable = (st, slot, g) => st.items.filter((x) => x.slot === slot && x.grade === g && !x.protected && !x.ruined && !isEquipped(st, x.id));
  // 일괄 합성: maxGrade 등급 이하를 낮은 등급부터, 부위별로 4개씩 (장착·보호·흔적 제외, 강화 낮은 것부터)
  // 낮은 등급 합성 결과가 다시 다음 등급 재료가 될 수 있음
  function mergeAll(st, h0, maxGrade) {
    const h = hooks(h0);
    if (!Number.isInteger(maxGrade) || maxGrade < 0 || maxGrade >= I.GRADES.length - 1) return no('합성할 수 없는 등급이에요');
    const sum = { merges: 0, success: 0, fail: 0, jjam: 0, items: [] };
    for (let g = 0; g <= maxGrade; g++) {
      for (const slot of I.SLOT_KEYS) {
        for (;;) {
          const pool = mergeable(st, slot, g).sort((x, y) => x.plus - y.plus || x.id - y.id);
          if (pool.length < I.MERGE.count) break;
          const r = merge(st, h, pool.slice(0, I.MERGE.count).map((x) => x.id));
          if (!r.ok) break;
          sum.merges++;
          if (r.success) { sum.success++; sum.items.push(r.item); } else { sum.fail++; sum.jjam += r.jjam; }
        }
      }
    }
    if (!sum.merges) return no('합성할 수 있는 묶음이 없어요 (같은 부위·등급 4개)');
    h.emit('save');
    return ok(sum);
  }
  // 일괄 합성 미리보기: 등급 이하에서 지금 바로 만들 수 있는 묶음 수 (연쇄 제외)
  function mergeCount(st, maxGrade) {
    let n = 0;
    for (let g = 0; g <= maxGrade && g < I.GRADES.length - 1; g++) {
      for (const slot of I.SLOT_KEYS) n += Math.floor(mergeable(st, slot, g).length / I.MERGE.count);
    }
    return n;
  }

  // ----- 분해 (재산 환급) -----
  const dismantleError = (st, it) => {
    if (isEquipped(st, it.id)) return '장착 중인 아이템은 먼저 해제해 주세요';
    if (it.protected) return '보호 중인 아이템은 분해할 수 없어요';
    return null;
  };
  function removeForGold(st, h, list) {
    const gold = list.reduce((s, it) => s + Eq.dismantleValue(it, K()), 0);
    removeIds(st, list.map((it) => it.id));
    st.gold += gold;
    h.stat('dismantle', list.length);
    h.emit('save');
    return ok({ count: list.length, gold });
  }
  function dismantle(st, h0, ids) {
    const h = hooks(h0);
    if (!Array.isArray(ids) || ids.length === 0) return no('분해할 아이템을 골라 주세요');
    const list = [...new Set(ids)].map((id) => find(st, id));
    if (list.some((x) => !x)) return no('없는 아이템이에요');
    for (const it of list) {
      const err = dismantleError(st, it);
      if (err) return no(err);
    }
    return removeForGold(st, h, list);
  }
  // 일괄 분해: 고른 등급 이하, 장착·보호 제외
  function dismantleBelow(st, h0, grade) {
    const h = hooks(h0);
    if (!Number.isInteger(grade) || grade < 0 || grade >= I.GRADES.length) return no('없는 등급이에요');
    const list = st.items.filter((it) => it.grade <= grade && !dismantleError(st, it));
    if (list.length === 0) return no('분해할 아이템이 없어요');
    return removeForGold(st, h, list);
  }

  function toggleProtect(st, h0, id) {
    const h = hooks(h0);
    const item = find(st, id);
    if (!item) return no('없는 아이템이에요');
    item.protected = !item.protected;
    h.emit('save');
    return ok({ item, protected: item.protected });
  }

  // ----- 양파나라 (중고거래 판매소): 올려두면 시간이 지나 성과급으로 팔림. 10칸 + 판매 시간만으로 제한 -----
  // 저장·서버 응답의 판매소 기록 정리 (잘못된 줄은 버림)
  function cleanMarket(m) {
    const o = m && typeof m === 'object' ? m : {};
    const n = (v) => (typeof v === 'number' && isFinite(v) && v >= 0 ? v : 0);
    return {
      list: (Array.isArray(o.list) ? o.list : []).filter((r) => r && typeof r.lid === 'string' && Number.isInteger(r.grade) && r.grade >= 0 && r.grade < I.GRADES.length)
        .slice(0, MK.slots).map((r) => ({ lid: r.lid.slice(0, 40), grade: r.grade, type: String(r.type || '').slice(0, 20), plus: Math.min(I.ENHANCE.max, Math.floor(n(r.plus))), at: n(r.at), done: n(r.done) })),
      seq: Math.max(1, Math.floor(n(o.seq)) || 1),
      day: typeof o.day === 'number' ? o.day : null,
      earned: 0,
      pending: Math.floor(n(o.pending)),
    };
  }
  const marketSlotsFree = (st) => MK.slots - st.market.list.length;
  function marketList(st, h0, ids) {
    const h = hooks(h0);
    const at = h.now();
    if (!Array.isArray(ids) || !ids.length) return no('올릴 아이템을 골라 주세요');
    if (new Set(ids).size !== ids.length) return no('같은 아이템을 두 번 올릴 수 없어요');
    if (ids.length > marketSlotsFree(st)) return no(`판매소 자리가 부족해요 (남은 ${marketSlotsFree(st)}칸)`);
    const list = ids.map((id) => find(st, id));
    if (list.some((x) => !x)) return no('없는 아이템이에요');
    for (const it of list) {
      if (isEquipped(st, it.id)) return no('장착 중인 아이템은 올릴 수 없어요');
      if (it.protected) return no('보호 중인 아이템은 올릴 수 없어요');
    }
    removeIds(st, ids);
    const added = list.map((it) => {
      const lid = `${st.market.seq++}-${it.id}`;
      const row = { lid, grade: it.grade, type: it.type, plus: it.plus, at, done: at + MK.hours[it.grade] * (MK.randMin + (MK.randMax - MK.randMin) * h.rng()) * 3600000 }; // 판매 시간 랜덤 (기준 ×0.5~×1.5, 2026-10-27 사용자)
      st.market.list.push(row);
      return row;
    });
    h.emit('marketList', { added });
    h.emit('save');
    return ok({ added });
  }
  function marketStatus(st, t) {
    return {
      list: st.market.list.map((r) => ({ ...r, left: Math.max(0, (r.done - t) / 1000), price: MK.priceOf(r.grade, r.plus) })),
      free: marketSlotsFree(st), pending: st.market.pending || 0,
    };
  }
  // 다 팔린 것 모두 받기 (pending = 예전 하루 상한으로 밀려 있던 몫, 한 번에 지급)
  function marketClaim(st, h0) {
    const h = hooks(h0);
    const s = marketStatus(st, h.now());
    const sold = s.list.filter((r) => r.left <= 0);
    if (!sold.length && !st.market.pending) return no('아직 팔린 게 없어요');
    const bonus = (st.market.pending || 0) + sold.reduce((a, r) => a + r.price, 0);
    st.market.pending = 0;
    const gone = new Set(sold.map((r) => r.lid));
    st.market.list = st.market.list.filter((r) => !gone.has(r.lid));
    st.bonus += bonus;
    h.emit('save');
    return ok({ count: sold.length, bonus, lids: [...gone] });
  }

  // ----- 결재 도장 상점: 하루 40개씩 ×1→×2→×4. 가격(재산)은 처치 보상 기준이라 엔진이 계산해서 넘김 -----
  function stampShopToday(st, t) {
    const d = dayNum(t);
    if (st.stampShop.day !== d) { st.stampShop.day = d; st.stampShop.bought = 0; }
    return st.stampShop;
  }
  const stampShopMax = () => I.STAMP.shop.tiers.reduce((a, b) => a + b, 0);
  // k번째(0부터, 오늘 산 것 포함) 도장의 가격 배율
  function stampTierMult(k) {
    const SP = I.STAMP.shop;
    let acc = 0;
    for (let i = 0; i < SP.tiers.length; i++) { acc += SP.tiers[i]; if (k < acc) return SP.mult[i]; }
    return SP.mult[SP.mult.length - 1];
  }
  // n개 가격 = 단가(base) × 단계 배율 합
  function stampPrice(st, t, n, base) {
    const sh = stampShopToday(st, t);
    let cost = 0;
    for (let k = 0; k < n; k++) cost += base * stampTierMult(sh.bought + k);
    return cost;
  }
  function stampBuy(st, h0, n, base) {
    const h = hooks(h0);
    if (!Number.isInteger(n) || n <= 0) return no('개수가 올바르지 않아요');
    if (!(typeof base === 'number' && isFinite(base) && base >= 0)) return no('가격이 올바르지 않아요');
    const sh = stampShopToday(st, h.now());
    const max = stampShopMax();
    if (sh.bought + n > max) return no(`오늘은 ${max - sh.bought}개까지 살 수 있어요`);
    const cost = stampPrice(st, h.now(), n, base);
    if (st.gold < cost) return no('재산이 부족해요');
    st.gold -= cost;
    sh.bought += n;
    st.stamps += n;
    h.emit('save');
    return ok({ n, cost });
  }

  G.Inv = {
    hooks, bagSize, bagUsed, bagFree, find, isEquipped, create, add,
    kill, offline, shardBox, gradeBox, gacha, GACHA_KIND,
    appraise, reappraise, enhanceError, enhance, restoreCost, restore, autoEnhance, enhanceAll, ENHANCE_ALL_MAX, AUTO_MAX_TRIES,
    merge, mergeAll, mergeCount, dismantle, dismantleBelow, toggleProtect,
    cleanMarket, marketSlotsFree, marketList, marketStatus, marketClaim,
    stampShopToday, stampShopMax, stampTierMult, stampPrice, stampBuy,
  };
})(globalThis.Game = globalThis.Game || {});
