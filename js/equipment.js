// 장비·장신구 규칙 (순수 함수): 생성·능력치·잠재능력·감정·강화·합성·분해·보너스 합산.
// DOM·저장·시간을 모르고 난수는 인자로 받은 rng()(0≤x<1)만 씀. 수치는 전부 items.js.
(function (G) {
  'use strict';
  const I = G.Items;
  const { GRADES, STAT_KEYS, CAPS, SLOTS, TYPE_BY_ID, POTENTIAL, APPRAISE, ENHANCE, MERGE } = I;

  // 부동소수점 찌꺼기 정리 (1.6500000000000001 → 1.65)
  const clean = (x) => Math.round(x * 1e6) / 1e6;
  const toInt = (v, d = 0) => (typeof v === 'number' && isFinite(v) ? Math.floor(v) : d);
  const isGrade = (g) => Number.isInteger(g) && g >= 0 && g < GRADES.length;

  // ----- 생성 -----
  // slot은 생략 가능(type에서 찾음). plus는 합성 결과용(기본 0)
  function createItem({ id, slot, type, grade, floor, plus = 0 }) {
    const t = TYPE_BY_ID[type];
    if (!t) throw new Error('없는 종류: ' + type);
    if (slot !== undefined && slot !== t.slot) throw new Error(`종류 ${type}는 ${slot} 부위가 아님`);
    if (!isGrade(grade)) throw new Error('없는 등급: ' + grade);
    return {
      id,
      slot: t.slot,
      type,
      grade,
      plus: Math.min(ENHANCE.max, Math.max(0, toInt(plus))),
      floor: Math.max(1, toInt(floor, 1)),
      appraised: POTENTIAL.lines[grade] === 0, // 잠재 0줄(일반)은 바로 감정 완료
      potentials: [],
      protected: false,
      downs: 0, // 연속 강등 횟수
      ruined: false, // 파괴되어 흔적만 남음 (복구 전까지 장착·강화·합성 불가)
    };
  }

  const itemName = (item) => (TYPE_BY_ID[item.type] ? TYPE_BY_ID[item.type].name : '?');
  const mainStat = (item) => SLOTS[item.slot].main;

  // ----- 주·서브 능력치 -----
  const mainAt = (slot, grade, plus) => I.MAIN_BASE[grade] * SLOTS[slot].mainMult * (1 + I.MAIN_PLUS_STEP * plus);

  // 주 능력치 값 (%)
  const mainValue = (item) => clean(mainAt(item.slot, item.grade, item.plus));

  // 서브 2개 [{ stat, value }] = MAIN_BASE[등급] × (1 + 강화 성장) × SUB_K[능력치] (가치 예산, items.js)
  function subValues(item) {
    const scale = I.MAIN_BASE[item.grade] * (1 + I.MAIN_PLUS_STEP * item.plus);
    return TYPE_BY_ID[item.type].subs.map((stat) => ({ stat, value: clean(scale * I.SUB_K[stat]) }));
  }
  const themeOf = (item) => (item && TYPE_BY_ID[item.type] ? TYPE_BY_ID[item.type].theme : -1);

  // ----- 세트 효과 -----
  const listOf = (eq) => (Array.isArray(eq) ? eq : Object.values(eq || {})).filter((it) => it && !it.ruined && TYPE_BY_ID[it.type]);
  // 장착 아이템 → 테마별 개수 [6] (흔적은 안 셈)
  function setCounts(equippedItems) {
    const n = I.THEMES.map(() => 0);
    for (const it of listOf(equippedItems)) n[themeOf(it)]++;
    return n;
  }
  // 켜진 세트 효과 합 {stat: %}. 4개·7개 효과는 겹쳐 받고, 각 효과 × gradeMult[그 세트를 이루는 장비 중 가장 낮은 등급]
  function setBonus(equippedItems) {
    const out = {};
    const grades = I.THEMES.map(() => []);
    for (const it of listOf(equippedItems)) grades[themeOf(it)].push(it.grade);
    grades.forEach((gs, th) => {
      gs.sort((a, b) => b - a);
      I.SET.counts.forEach((need, i) => {
        if (gs.length < need) return;
        const m = I.SET.gradeMult[gs[need - 1]];
        for (const [k, v] of Object.entries(I.SET.effects[th][i])) out[k] = clean((out[k] || 0) + v * m);
      });
    });
    return out;
  }
  // 화면용: 테마 th의 세트 단계별 배율 [4세트, 7세트] (안 켜졌으면 null)
  function setMults(equippedItems, th) {
    const gs = listOf(equippedItems).filter((it) => themeOf(it) === th).map((it) => it.grade).sort((a, b) => b - a);
    return I.SET.counts.map((need) => (gs.length >= need ? I.SET.gradeMult[gs[need - 1]] : null));
  }

  // ----- 잠재능력 -----
  // 깡수치 기준값 (B공·B멘·B원). 깡수치가 없는 능력치는 0
  function flatBase(stat, floor) {
    const c = I.FLAT_BASE[stat];
    if (!c) return 0;
    const f = Math.max(1, toInt(floor, 1));
    return Math.max(I.FLAT_MIN, Math.ceil(c.coef * Math.pow(c.growth, f - 1)));
  }

  // 가중치 추첨. 이미 maxSame줄인 능력치는 빼고 다시 나눔
  function pickStat(rng, count) {
    const pool = STAT_KEYS.filter((k) => POTENTIAL.weights[k] > 0 && (count[k] || 0) < POTENTIAL.maxSame);
    const total = pool.reduce((s, k) => s + POTENTIAL.weights[k], 0);
    let x = rng() * total;
    for (const k of pool) {
      x -= POTENTIAL.weights[k];
      if (x < 0) return k;
    }
    return pool[pool.length - 1];
  }

  // 한 줄 수치. 범위는 min + round(rng × steps) × unit (최댓값 포함)
  function rollLine(stat, grade, floor, rng) {
    const v = POTENTIAL.values[stat][grade];
    if (v.flat !== undefined) return { stat, value: v.flat * flatBase(stat, floor), kind: 'flat', locked: false };
    if (v.fixed !== undefined) return { stat, value: v.fixed, kind: 'pct', locked: false };
    const unit = POTENTIAL.units[stat];
    const steps = Math.round((v.max - v.min) / unit);
    return { stat, value: clean(v.min + Math.round(rng() * steps) * unit), kind: 'pct', locked: false };
  }

  // 잠재능력 새로 뽑기 (아이템은 안 바꾸고 새 배열을 돌려줌).
  // lockedIdx의 줄은 그대로 두고(locked: true), 2줄 상한 계산에 포함
  function rollPotentials(item, rng, lockedIdx = []) {
    const n = POTENTIAL.lines[item.grade];
    const old = Array.isArray(item.potentials) ? item.potentials : [];
    const out = new Array(n).fill(null);
    const count = {};
    for (const i of lockedIdx || []) {
      if (!Number.isInteger(i) || i < 0 || i >= n || !old[i] || out[i]) continue;
      out[i] = { ...old[i], locked: true };
      count[old[i].stat] = (count[old[i].stat] || 0) + 1;
    }
    for (let i = 0; i < n; i++) {
      if (out[i]) continue;
      const stat = pickStat(rng, count);
      count[stat] = (count[stat] || 0) + 1;
      out[i] = rollLine(stat, item.grade, item.floor, rng);
    }
    return out;
  }

  // ----- 감정 비용 (K = 강화 기준값) -----
  const appraiseCost = (item, K) => K * APPRAISE.costMult[item.grade];
  const maxLocks = (grade) => APPRAISE.maxLocks[grade] || 0;

  // 재감정 비용 { won, jjam, lockBonus }. 잠재 없는 등급이거나 잠금 줄 수가 넘치면 null
  function reappraiseCost(item, K, lockCount = 0) {
    if (!POTENTIAL.lines[item.grade]) return null;
    const lc = toInt(lockCount, -1);
    if (lc < 0 || lc > maxLocks(item.grade)) return null;
    return {
      won: K * APPRAISE.rerollMult[item.grade],
      jjam: APPRAISE.rerollJjam[item.grade],
      lockBonus: lc > 0 ? APPRAISE.lockBonus[item.grade][lc - 1] : 0,
    };
  }

  // ----- 강화 (docs/enhance-table.md) -----
  const clampInt = (v, lo, hi) => Math.max(lo, Math.min(hi, toInt(v)));
  // 강화 비용 배율 (현재 단계 기준): +10까지 단계마다 ×1.4, 그 뒤 ×1.25
  function enhanceCostMult(plus) {
    const p = Math.max(0, toInt(plus));
    const lo = Math.min(p, ENHANCE.costHighFrom);
    return Math.pow(ENHANCE.costGrowth, lo) * Math.pow(ENHANCE.costGrowthHigh, p - lo);
  }
  // 강화 비용(원). 최대 강화거나 흔적이면 null
  function enhanceCost(item, K) {
    if (item.ruined || item.plus >= ENHANCE.max) return null;
    return K * ENHANCE.costMult[item.grade] * enhanceCostMult(item.plus);
  }
  // 강화 1회 결재 도장 (등급 배율 곱, 올림)
  const stampCost = (item) => (item.plus >= ENHANCE.max ? 0 : Math.ceil(I.STAMP.per[item.plus] * ENHANCE.costMult[item.grade] - 1e-9));
  const restoreStamps = (item) => Math.ceil(I.STAMP.per[ENHANCE.restorePlus] * ENHANCE.costMult[item.grade] * I.STAMP.restoreMult - 1e-9);
  // 흔적 복구 비용 = +10 강화 1회 값
  const restoreCost = (item, K) => K * ENHANCE.costMult[item.grade] * enhanceCostMult(ENHANCE.restorePlus);

  // 이번 시도 확률 {s 성공, k 유지, d 강등, b 파괴, boost, protect(실제로 쓸 짬)}
  // opts.boost/protect = 넣을 짬 개수 (단계·상한에 맞게 줄여서 씀)
  function enhanceOdds(plus, downs = 0, opts = {}) {
    const p = Math.max(0, toInt(plus));
    if (p >= ENHANCE.max) return null;
    let [s, k, d, b] = ENHANCE.rows[p];
    if (toInt(downs) >= ENHANCE.downPity) return { s: 1, k: 0, d: 0, b: 0, boost: 0, protect: 0, pity: true };
    const B = ENHANCE.boost;
    const P = ENHANCE.protect;
    const boost = p >= B.from ? clampInt(opts.boost, 0, B.max) : 0;
    const add = Math.min(k, boost * B.per);
    s += add; k -= add;
    const protect = p >= P.from && b > 0 ? Math.min(clampInt(opts.protect, 0, P.max), Math.ceil(b / P.per - 1e-9)) : 0;
    const cut = Math.min(b, protect * P.per);
    b -= cut; k += cut;
    return { s: clean(s), k: clean(k), d: clean(d), b: clean(b), boost, protect, pity: false };
  }
  // 하위 호환: 성공률만
  const enhanceRate = (plus) => { const o = enhanceOdds(plus); return o ? o.s : 0; };

  // 강화 1회 결과 (rng 1회). → 'success' | 'stay' | 'down' | 'break'
  function rollEnhance(odds, rng) {
    const r = rng();
    if (r < odds.s) return 'success';
    if (r < odds.s + odds.k) return 'stay';
    if (r < odds.s + odds.k + odds.d) return 'down';
    return odds.b > 0 ? 'break' : 'stay';
  }

  // ----- 합성 -----
  const mergeRate = (failStreak) =>
    clean(Math.min(MERGE.maxRate, MERGE.baseRate + MERGE.stepRate * Math.max(0, toInt(failStreak))));

  // 재료 검사. 문제 있으면 한국어 이유, 없으면 null. equipped = S.equipped ({slot: id})
  function mergeError(items, equipped) {
    if (!Array.isArray(items) || items.length !== MERGE.count || items.some((x) => !x)) {
      return `같은 부위·등급 아이템 ${MERGE.count}개가 필요해요`;
    }
    if (new Set(items.map((x) => x.id)).size !== items.length) return '같은 아이템을 두 번 넣을 수 없어요';
    const { slot, grade } = items[0];
    if (items.some((x) => x.slot !== slot)) return '같은 부위끼리만 합성할 수 있어요';
    if (items.some((x) => x.grade !== grade)) return '같은 등급끼리만 합성할 수 있어요';
    if (grade >= GRADES.length - 1) return `${GRADES[GRADES.length - 1].name} 등급은 합성할 수 없어요`;
    if (items.some((x) => x.protected)) return '보호 중인 아이템은 재료로 쓸 수 없어요';
    if (items.some((x) => x.ruined)) return '파괴된 아이템은 먼저 복구해 주세요';
    if (equipped) {
      const on = new Set(Object.values(equipped));
      if (items.some((x) => on.has(x.id))) return '장착 중인 아이템은 먼저 해제해 주세요';
    }
    return null;
  }

  // 합성 시도. 재료는 성공·실패 모두 소멸(엔진이 처리).
  // → { success, item?, rate, jjam(실패 보상), failStreak(새 연속 실패 수) }. 잘못된 재료면 throw
  // pickType: 결과 종류(테마)를 재료 중에서 고름 (2026-11-05: 세트를 맞출 수단). 재료에 없는 종류면 무시하고 무작위
  function merge(items, rng, failStreak, nextId, pickType) {
    const err = mergeError(items);
    if (err) throw new Error(err);
    const streak = Math.max(0, toInt(failStreak));
    const rate = mergeRate(streak);
    if (!(rng() < rate)) return { success: false, rate, jjam: MERGE.failJjam, failStreak: streak + 1 };
    const rnd = items[Math.min(items.length - 1, Math.floor(rng() * items.length))]; // 난수는 고를 때도 똑같이 씀
    const src = (pickType && items.find((x) => x.type === pickType)) || rnd;
    const item = createItem({
      id: nextId,
      type: src.type,
      grade: src.grade + 1,
      plus: Math.max(...items.map((x) => x.plus || 0)),
      floor: Math.max(...items.map((x) => x.floor || 1)),
    });
    return { success: true, item, rate, jjam: 0, failStreak: 0 };
  }

  // ----- 분해 -----
  const dismantleValue = (item, K) => K * I.DISMANTLE.mult[item.grade];

  // ----- 보너스 합산 -----
  function emptyTotals() {
    const t = {};
    for (const k of STAT_KEYS) t[k] = { pct: 0, flat: 0 };
    return t;
  }
  function cleanTotals(t) {
    for (const k of STAT_KEYS) { t[k].pct = clean(t[k].pct); t[k].flat = clean(t[k].flat); }
    return t;
  }

  // 장착 아이템(배열 또는 {slot: item}) + extra(도감 등: {stat: % 숫자 | {pct, flat}}) 합산.
  // 같은 테마 4·7개면 세트 효과도 더함.
  // → { raw: 상한 전, capped: 상한 후, bySource: {main, sub, potential, set, extra} }, 각 {stat: {pct, flat}}
  function computeBonuses(equippedItems, extra) {
    const list = Array.isArray(equippedItems) ? equippedItems : Object.values(equippedItems || {});
    const src = { main: emptyTotals(), sub: emptyTotals(), potential: emptyTotals(), set: emptyTotals(), extra: emptyTotals() };
    for (const item of list) {
      if (!item || !TYPE_BY_ID[item.type] || item.ruined) continue;
      src.main[mainStat(item)].pct += mainValue(item);
      for (const s of subValues(item)) src.sub[s.stat].pct += s.value;
      if (item.appraised && Array.isArray(item.potentials)) {
        for (const p of item.potentials) {
          if (p && src.potential[p.stat]) src.potential[p.stat][p.kind === 'flat' ? 'flat' : 'pct'] += p.value;
        }
      }
    }
    for (const [k, v] of Object.entries(setBonus(list))) src.set[k].pct += v;
    for (const k of Object.keys(extra || {})) {
      if (!src.extra[k]) continue;
      const v = extra[k];
      if (typeof v === 'number') src.extra[k].pct += v;
      else if (v) { src.extra[k].pct += v.pct || 0; src.extra[k].flat += v.flat || 0; }
    }
    const raw = emptyTotals();
    for (const part of Object.values(src)) {
      for (const k of STAT_KEYS) { raw[k].pct += part[k].pct; raw[k].flat += part[k].flat; }
    }
    cleanTotals(raw);
    for (const part of Object.values(src)) cleanTotals(part);
    const capped = emptyTotals();
    for (const k of STAT_KEYS) {
      capped[k].flat = raw[k].flat;
      capped[k].pct = CAPS[k] ? Math.min(CAPS[k].max, raw[k].pct) : raw[k].pct;
    }
    return { raw, capped, bySource: src };
  }

  // ----- 도감 -----
  const codexKey = (item) => `${item.type}:${item.grade}`;
  // 다 모은 테마 [true/false × 6]: 한 테마의 7부위를 등급 상관없이 하나씩이라도 등록
  function themeCodex(codex) {
    const got = new Set();
    for (const k of Object.keys(codex || {})) if (codex[k]) got.add(k.split(':')[0]);
    return I.THEMES.map((_, th) => I.SLOT_KEYS.every((slot) => got.has(I.TYPES[slot][th].id)));
  }
  // 도감({key: true}) → computeBonuses의 extra 형태 (칸마다 + 다 모은 테마마다)
  function codexBonus(codex) {
    const n = Object.keys(codex || {}).filter((k) => codex[k]).length;
    const out = { [I.CODEX.stat]: { pct: clean(n * I.CODEX.pct), flat: 0 } };
    const th = themeCodex(codex).filter(Boolean).length;
    if (th) {
      const k = I.THEME_CODEX.stat;
      out[k] = { pct: clean(((out[k] && out[k].pct) || 0) + th * I.THEME_CODEX.pct), flat: (out[k] && out[k].flat) || 0 };
    }
    return out;
  }

  // ----- 세이브·서버 입력 검증 -----
  const num = (v, d) => (typeof v === 'number' && isFinite(v) && v >= 0 ? v : d);
  const isInt = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;
  // 잠재 한 줄 (잘못되면 null)
  function cleanPotential(p) {
    if (p && p.stat === 'mental') p = { ...p, stat: 'hp' }; // v2 → v3 이름 변경
    if (!p || typeof p !== 'object' || !Object.prototype.hasOwnProperty.call(I.STATS, p.stat)) return null; // 'constructor' 같은 이름 막음 (2026-11-14)
    if (typeof p.value !== 'number' || !isFinite(p.value)) return null;
    if (p.kind !== 'flat' && p.kind !== 'pct') return null;
    return { stat: p.stat, value: p.value, kind: p.kind, locked: p.locked === true };
  }
  // 아이템 한 개 (잘못되면 null → 제거)
  function cleanItem(it) {
    if (!it || typeof it !== 'object') return null;
    const t = TYPE_BY_ID[it.type];
    if (!t || !isInt(it.id, 1, Number.MAX_SAFE_INTEGER)) return null;
    if (it.slot !== undefined && it.slot !== t.slot) return null;
    if (!isInt(it.grade, 0, GRADES.length - 1)) return null;
    const plus = it.plus === undefined ? 0 : it.plus;
    if (!isInt(plus, 0, ENHANCE.max)) return null;
    const lines = POTENTIAL.lines[it.grade];
    const pots = (Array.isArray(it.potentials) ? it.potentials : []).map(cleanPotential).filter(Boolean).slice(0, lines);
    // 일반은 늘 감정 완료, 줄이 비었으면 미감정으로
    const appraised = lines === 0 || (it.appraised === true && pots.length > 0);
    return {
      id: it.id, slot: t.slot, type: t.id, grade: it.grade, plus,
      floor: Math.max(1, Math.floor(num(it.floor, 1))),
      appraised, potentials: appraised ? pots : [],
      protected: it.protected === true,
      downs: Math.min(ENHANCE.downPity, Math.floor(num(it.downs, 0))),
      ruined: it.ruined === true && ENHANCE.ruinGrades.includes(it.grade),
    };
  }

  G.Equipment = {
    cleanItem, cleanPotential,
    stampCost, restoreStamps,
    createItem, itemName, mainStat, mainValue, subValues, flatBase, rollPotentials,
    appraiseCost, reappraiseCost, maxLocks, enhanceRate, enhanceCost, enhanceCostMult, enhanceOdds, rollEnhance, restoreCost,
    mergeRate, mergeError, merge, dismantleValue, computeBonuses, codexKey, codexBonus,
    themeOf, setCounts, setBonus, setMults, themeCodex,
  };
})(globalThis.Game = globalThis.Game || {});
