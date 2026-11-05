// 반려 "책상 반려" 규칙 (명세 docs/impl-spec-m4.md ④). 뽑기 결과 → 보유 개수, 5개 합치기, 책상에 올리기(소환) 효과, 보유 효과, 도감.
// 폰(서버 없을 때)과 서버가 같은 함수를 실행. DOM·저장·전투를 모름. 수치는 [임시 ⚖] = 밸런스팀 검토 전.
// st = 상태 (세이브 또는 서버가 만든 것): pet {own, codex, granted}, bonus(성과급), gold(재산), maxStage(평생 최고 층 — 서버는 클라우드 세이브)
// h = inventory.js와 같은 연결부 {rng, now, emit, stat, track, onCreate}
// 그림: www/img/pets/<key>.png (Gemini 시트 art/gemini/sheet-pets-1·2.png에서 잘라 128px 투명 PNG)
//   화면은 ui.js petFace() (단계별 그림은 2차: <key>_<D|C|B|A>.png)
(function (G) {
  'use strict';
  const ok = (o = {}) => ({ ok: true, ...o });
  const no = (reason) => ({ ok: false, reason });

  // 12종 (명세 25절 표, 등급당 2종). stat = 이미 있는 능력치 키, 'rest' = 번아웃 휴식 감소(새 효과, 멘탈 케어)
  // line = 소개 (content/pets.json intro)
  const LIST = [
    { key: 'cactus', grade: 0, name: '반려선인장', stats: ['hp'], line: '말없이 내 곁을 지켜주는 친구' },
    { key: 'marimo', grade: 0, name: '마리모대장', stats: ['gold'], line: '기분 좋으면 위로 떠오른대요' },
    { key: 'duck', grade: 1, name: '종이컵오리', stats: ['critRate'], line: '탕비실에서 주워온 보물' },
    { key: 'fan', grade: 1, name: '미니선풍기', stats: ['aspd'], line: '내 얼굴을 향해 시원한 바람을!' },
    { key: 'panda', grade: 2, name: '팬더지우개', stats: ['regen'], line: '틀린 실수를 다 지워줘요' },
    { key: 'puppy', grade: 2, name: '멍멍문진', stats: ['offline'], line: '절대 짖지 않는 든든한 경비견' },
    { key: 'coffee', grade: 3, name: '커피오뚝이', stats: ['cdr'], line: '절대 넘어지지 않는 카페인 힘!' },
    { key: 'owl', grade: 3, name: '졸린부엉이', stats: ['critDmg'], line: '밤샘 야근을 지켜보는 눈' },
    { key: 'robot', grade: 4, name: '꼬마로봇', stats: ['atk'], line: '내 대신 키보드를 쳐주는 분신' },
    { key: 'cloud', grade: 4, name: '구름스펀지', stats: ['rest'], line: '스트레스를 꾹 누르면 해소돼요' },
    { key: 'star', grade: 5, name: '네온별사탕', stats: ['atk', 'hp'], line: '어두운 야근 방을 비추는 빛' },
    { key: 'turtle', grade: 5, name: '노트북거북이', stats: ['boss'], line: '느리지만 끈기 있게 일합니다' },
  ];
  const BY_KEY = Object.fromEntries(LIST.map((p, i) => [p.key, { ...p, n: i }]));
  const KEYS = LIST.map((p) => p.key);
  const TIERS = ['D', 'C', 'B', 'A'];
  const STAT_NAME = { rest: '번아웃 휴식' };

  const CFG = {
    unlock: 40, // 평생 최고 층 (35절 #3 추천안) [임시 ⚖]
    starter: 'cactus', // 해금 때 D 1마리 + 책상에 올림
    tierRates: [40, 30, 20, 10], // 뽑을 때 D/C/B/A % [악]
    mergeNeed: 5, // 같은 반려·같은 단계 5개 → 다음 단계 1개 확정 [악]
    // 합치기 재산 = 이번 회차 최고 유효 층 일반 처치 보상(재산 보너스 포함, 엔진이 넘김) × 2 × [등급 배율] (업무 스킬 숙련과 같은 방식, 2026-10-28 사용자)
    mergeCostKills: 2,
    mergeCostMult: [1, 1.5, 2, 3, 4, 6],
    summonPct: [2, 4, 7, 12, 20, 35], // 책상에 올렸을 때 능력치 % (등급별) [임시 ⚖]
    tierMult: [1, 1.5, 2, 3], // D/C/B/A 배율 [임시 ⚖]
    statMult: { cdr: 0.2, critRate: 0.2, rest: 0.5 }, // 이 능력치는 값이 커서 줄임
    holdAtk: [0.2, 0.4, 0.8, 2.4, 8, 20], // 보유 효과: 반려마다 가장 높은 단계 1개만, 업무력 % × (단계+1) — 전체 공격력에 따로 곱함 [⚖ 2026-11-05 봇 240판: 전설·신화를 크게]
    codexBonus: [10, 20, 40, 80, 160, 320], // 도감: 반려×단계 처음 얻을 때 성과급 [⚖]
    maxCount: 999999, // 한 칸 최대 개수 (조작·넘침 방지)
    bulkMax: 10000, // 한 번에 합칠 수 있는 최대 횟수
  };
  const GRADE_COUNT = CFG.summonPct.length;

  const fresh = () => ({ own: {}, codex: {}, granted: false });
  const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
  const toInt = (v) => (Number.isInteger(v) && v >= 0 ? Math.min(v, CFG.maxCount) : 0);
  const codexKey = (key, tier) => `${key}:${TIERS[tier]}`;
  const CODEX_KEYS = KEYS.flatMap((k) => TIERS.map((_, t) => codexKey(k, t)));

  // 세이브·서버 값 정리 (모르는 키 제거, 개수는 0 이상 정수, 빈 반려는 지움)
  function clean(raw) {
    const r = obj(raw);
    const d = fresh();
    const own = obj(r.own);
    for (const k of KEYS) {
      const a = Array.isArray(own[k]) ? own[k] : [];
      const c = TIERS.map((_, t) => toInt(a[t]));
      if (c.some((x) => x > 0)) d.own[k] = c;
    }
    const cx = obj(r.codex);
    for (const k of CODEX_KEYS) if (cx[k] === true) d.codex[k] = true;
    d.granted = r.granted === true;
    return d;
  }

  const isOpen = (maxStage) => Number.isFinite(maxStage) && maxStage >= CFG.unlock;
  const countsOf = (pet, key) => pet.own[key] || [0, 0, 0, 0];
  const owned = (pet, key) => countsOf(pet, key).some((x) => x > 0);
  // 가장 높은 단계 (없으면 -1)
  function bestTier(pet, key) {
    const c = countsOf(pet, key);
    for (let t = TIERS.length - 1; t >= 0; t--) if (c[t] > 0) return t;
    return -1;
  }
  // base = 이번 회차 최고 유효 층 일반 처치 보상 (폰이 계산, 서버는 최소값만 확인). 정수로 올림
  const mergeCost = (grade, base) => Math.ceil(Math.max(1, base || 0) * CFG.mergeCostKills * CFG.mergeCostMult[grade]);
  // 책상에 올렸을 때 능력치 {stat: %} (단계 tier)
  function summonStats(key, tier) {
    const p = BY_KEY[key];
    if (!p || tier < 0) return {};
    const out = {};
    for (const s of p.stats) out[s] = CFG.summonPct[p.grade] * CFG.tierMult[tier] * (CFG.statMult[s] || 1);
    return out;
  }
  const holdPct = (key, tier) => (tier < 0 ? 0 : CFG.holdAtk[BY_KEY[key].grade] * (tier + 1));

  // 능력치 합계 {stat: %}: 책상 위 반려(가장 높은 단계) + 보유 효과(업무력). 'rest'는 엔진 휴식 공식이 따로 씀
  // 안 열렸으면(최고 층 미달) 0 — 세이브를 조작해도 효과 없음
  function bonus(pet, out, maxStage = Infinity) {
    const res = {};
    if (!isOpen(maxStage)) return res;
    const add = (k, v) => { if (v) res[k] = (res[k] || 0) + v; };
    for (const k of KEYS) add('atk', holdPct(k, bestTier(pet, k)));
    if (out && owned(pet, out)) { const s = summonStats(out, bestTier(pet, out)); for (const k of Object.keys(s)) add(k, s[k]); }
    return res;
  }
  // 책상 효과만 (보유 효과 공격력은 엔진이 따로 곱함: E.petHoldMult)
  function deskBonus(pet, out, maxStage = Infinity) {
    if (!isOpen(maxStage) || !out || !owned(pet, out)) return {};
    return { ...summonStats(out, bestTier(pet, out)) };
  }
  const holdTotal = (pet) => KEYS.reduce((s, k) => s + holdPct(k, bestTier(pet, k)), 0);

  // 한 반려 화면 정보
  function info(pet, key, out, base) {
    const p = BY_KEY[key];
    const c = countsOf(pet, key).slice();
    const best = bestTier(pet, key);
    const nextGrade = p.grade + 1 < GRADE_COUNT ? p.grade + 1 : null;
    return {
      key, name: p.name, grade: p.grade, stats: p.stats, line: p.line, counts: c, best, owned: best >= 0, out: out === key,
      summon: summonStats(key, Math.max(0, best)), hold: holdPct(key, best),
      mergeCost: mergeCost(p.grade, base),
      canMerge: c.map((n, t) => n >= CFG.mergeNeed && (t < TIERS.length - 1 || nextGrade !== null)),
      nextGrade,
    };
  }
  const list = (pet, out, base) => KEYS.map((k) => info(pet, k, out, base));

  // 등급 → 그 등급 반려 중 균등 (r: 0≤r<1)
  function pickKey(grade, r) {
    const pool = LIST.filter((p) => p.grade === grade);
    return pool[Math.min(pool.length - 1, Math.floor(r * pool.length))].key;
  }
  // 단계 D/C/B/A = 40/30/20/10% (r: 0≤r<1)
  function pickTier(r) {
    const total = CFG.tierRates.reduce((a, b) => a + b, 0);
    let x = r * total;
    for (let t = 0; t < CFG.tierRates.length; t++) { if (x < CFG.tierRates[t]) return t; x -= CFG.tierRates[t]; }
    return 0;
  }

  // 한 마리 얻기 (+ 도감: 반려×단계 처음이면 성과급). 반환 {isNew, codex(받은 성과급)}
  function gain(st, h, key, tier, n = 1) {
    const pet = st.pet;
    const c = countsOf(pet, key).slice();
    const isNew = c.every((x) => x === 0);
    c[tier] = Math.min(CFG.maxCount, c[tier] + n);
    pet.own[key] = c;
    let codex = 0;
    const ck = codexKey(key, tier);
    if (!pet.codex[ck]) {
      pet.codex[ck] = true;
      codex = CFG.codexBonus[BY_KEY[key].grade];
      st.bonus += codex;
      h.emit('petCodex', { key, tier, bonus: codex });
    }
    h.emit('petGain', { key, tier, isNew });
    return { isNew, codex };
  }
  function take(pet, key, tier, n) {
    const c = countsOf(pet, key).slice();
    c[tier] -= n;
    if (c.some((x) => x > 0)) pet.own[key] = c; else delete pet.own[key];
  }

  // ----- 해금 지급: 반려선인장 D 1마리 (한 번만) -----
  function start(st, h) {
    if (!isOpen(st.maxStage)) return no(`최고 ${CFG.unlock}층에서 열려요`);
    if (st.pet.granted) return no('이미 받았어요');
    st.pet.granted = true;
    const g = gain(st, h, CFG.starter, 0);
    return ok({ key: CFG.starter, tier: 0, codex: g.codex });
  }

  // 뽑기 결과 한 칸 (gacha.js 등급 → 반려·단계). rng 2번 사용
  function pullOne(st, h, grade) {
    const key = pickKey(grade, h.rng());
    const tier = pickTier(h.rng());
    const g = gain(st, h, key, tier);
    return { pet: key, tier, isNew: g.isNew, codex: g.codex };
  }

  // ----- 합치기: 같은 반려·같은 단계 5개 + 재산 → 다음 단계 1개. A 5개 → 다음 등급 반려 중 무작위 1개 D (35절 #4) -----
  // n = 몇 번 합칠지 (재산·개수가 되는 만큼, 0이면 거절). base = 재산 기준 (mergeCost)
  function merge(st, h, key, tier, n = 1, base) {
    const p = BY_KEY[key];
    if (!p) return no('없는 반려예요');
    if (!isOpen(st.maxStage)) return no(`최고 ${CFG.unlock}층에서 열려요`);
    if (!Number.isInteger(tier) || tier < 0 || tier >= TIERS.length) return no('단계가 올바르지 않아요');
    if (!Number.isInteger(n) || n < 1) return no('횟수가 올바르지 않아요');
    if (tier === TIERS.length - 1 && p.grade + 1 >= GRADE_COUNT) return no('신화 A는 더 합칠 수 없어요');
    const have = countsOf(st.pet, key)[tier];
    if (have < CFG.mergeNeed) return no(`${TIERS[tier]} ${CFG.mergeNeed}개가 필요해요 (지금 ${have}개)`);
    const each = mergeCost(p.grade, base);
    const k = Math.min(n, Math.floor(have / CFG.mergeNeed), CFG.bulkMax, Math.floor(st.gold / each));
    if (k < 1) return no('재산이 부족해요');
    take(st.pet, key, tier, k * CFG.mergeNeed);
    st.gold -= k * each;
    const got = [];
    if (tier < TIERS.length - 1) {
      const g = gain(st, h, key, tier + 1, k);
      got.push({ pet: key, tier: tier + 1, n: k, isNew: g.isNew, codex: g.codex });
    } else {
      for (let i = 0; i < k; i++) {
        const nk = pickKey(p.grade + 1, h.rng());
        const g = gain(st, h, nk, 0);
        const same = got.find((x) => x.pet === nk);
        if (same) { same.n++; same.codex += g.codex; } else got.push({ pet: nk, tier: 0, n: 1, isNew: g.isNew, codex: g.codex });
      }
    }
    h.stat('pet_merge', k);
    h.emit('petMerge', { key, tier, n: k });
    return ok({ key, tier, n: k, cost: k * each, got });
  }

  // ----- 일괄 합치기: 낮은 등급·단계부터 되는 만큼 (재산이 되는 만큼). A는 반려가 없어지지 않게 1개 남김 -----
  function mergeAll(st, h, base) {
    if (!isOpen(st.maxStage)) return no(`최고 ${CFG.unlock}층에서 열려요`);
    let times = 0;
    let cost = 0;
    const got = {};
    for (let grade = 0; grade < GRADE_COUNT; grade++) {
      for (const p of LIST.filter((x) => x.grade === grade)) {
        for (let t = 0; t < TIERS.length; t++) {
          if (t === TIERS.length - 1 && grade + 1 >= GRADE_COUNT) continue;
          const have = countsOf(st.pet, p.key)[t];
          const keep = t === TIERS.length - 1 ? 1 : 0;
          const can = Math.min(Math.floor((have - keep) / CFG.mergeNeed), Math.floor(st.gold / mergeCost(grade, base)));
          if (can < 1) continue;
          const r = merge(st, h, p.key, t, can, base);
          if (!r.ok) continue;
          times += r.n;
          cost += r.cost;
          for (const x of r.got) {
            const k = codexKey(x.pet, x.tier);
            got[k] = (got[k] || 0) + x.n;
          }
        }
      }
    }
    if (!times) {
      const any = KEYS.some((k) => countsOf(st.pet, k).some((c, t) => c >= CFG.mergeNeed + (t === TIERS.length - 1 ? 1 : 0) && !(t === TIERS.length - 1 && BY_KEY[k].grade + 1 >= GRADE_COUNT)));
      return no(any ? '재산이 부족해요' : `합칠 수 있는 반려가 없어요 (같은 단계 ${CFG.mergeNeed}개)`);
    }
    return ok({ n: times, cost, got });
  }

  G.Pets = {
    LIST, BY_KEY, KEYS, TIERS, STAT_NAME, CFG, CODEX_KEYS, codexKey,
    fresh, clean, isOpen, countsOf, owned, bestTier, mergeCost, summonStats, holdPct, holdTotal, bonus, deskBonus, info, list,
    pickKey, pickTier, gain, start, pullOne, merge, mergeAll,
  };
})(globalThis.Game = globalThis.Game || {});
