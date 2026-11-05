// 장비·장신구 획득(드롭) 규칙: 처치 드롭, 장신구 상자, 퇴근 후 정산.
// DOM·저장·시간을 모르고 난수는 인자로 받은 rng()(0≤x<1)만 씀. 수치는 items.js의 DROP 표.
// 결과는 아이템 "스펙" {slot, type, grade}만 돌려줌. id·floor 부여와 가방 확인은 엔진이 함.
(function (G) {
  'use strict';
  const I = G.Items;
  const DROP = I.DROP;

  // 구분(equip/accessory)별 부위 목록
  const SLOTS_OF = { equip: [], accessory: [] };
  for (const slot of I.SLOT_KEYS) SLOTS_OF[I.SLOTS[slot].kind].push(slot);

  const toInt = (v) => (typeof v === 'number' && isFinite(v) && v > 0 ? Math.floor(v) : 0);
  const pick = (arr, rng) => arr[Math.min(arr.length - 1, Math.floor(rng() * arr.length))];

  // 층 → 확률표 구간 index (minFloor 이하 중 가장 높은 구간)
  function bracketIndex(stage, isBoss, table = DROP.gradeTable) {
    const f = Math.max(1, toInt(stage));
    let idx = 0;
    table.forEach((row, i) => { if (f >= row.minFloor) idx = i; });
    if (isBoss) idx = Math.min(table.length - 1, idx + DROP.boss.bracketUp);
    return idx;
  }

  // 300층 이후 상위 등급 배율 (상한 있음)
  function lateMult(stage) {
    const L = DROP.late;
    const f = toInt(stage);
    if (f <= L.from) return 1;
    return Math.min(L.cap, 1 + L.k * Math.log2(f / L.from));
  }

  // 그 층의 등급 확률표 (%, 일반→신화). 보스는 한 구간 위. table: 'drop'(기본) | 'box'
  function gradeTable(stage, isBoss = false, table = 'drop') {
    const T = table === 'box' ? DROP.boxTable : DROP.gradeTable;
    const rates = T[bracketIndex(stage, isBoss, T)].rates.slice();
    const m = lateMult(stage);
    if (m > 1) {
      let extra = 0;
      for (const g of DROP.late.grades) { extra += rates[g] * (m - 1); rates[g] *= m; }
      rates[0] = Math.max(0, rates[0] - extra);
    }
    return rates;
  }

  // 등급 하나 추첨 (rng 1회)
  function rollGrade(stage, isBoss, rng, table = 'drop') {
    const rates = gradeTable(stage, isBoss, table);
    const total = rates.reduce((a, b) => a + b, 0);
    let r = rng() * total;
    let last = 0;
    for (let g = 0; g < rates.length; g++) {
      if (rates[g] <= 0) continue;
      last = g;
      if (r < rates[g]) return g;
      r -= rates[g];
    }
    return last; // 부동소수점 끝자락
  }

  // 부위·종류 균등 추첨 (rng 2회: 부위, 종류)
  function rollSlotType(kind, rng) {
    const slot = pick(SLOTS_OF[kind], rng);
    const type = pick(I.TYPES[slot], rng).id;
    return { slot, type };
  }

  // 아이템 스펙 (rng 3회: 부위, 종류, 등급)
  function rollSpec(kind, stage, isBoss, rng, table = 'drop') {
    const { slot, type } = rollSlotType(kind, rng);
    return { slot, type, grade: rollGrade(stage, isBoss, rng, table) };
  }

  // 낮은 층 드롭 배율 (0~1): top = 이번 회차 최고 유효 층. 없으면 1
  function lowFloorMult(stage, top) {
    const L = DROP.lowFloor;
    const gap = toInt(top) - toInt(stage) - L.free;
    return gap > 0 ? Math.max(L.min, Math.pow(L.per, gap)) : 1;
  }

  // 처치 1회 드롭 → { equip: 스펙|null, shards }. mult = 낮은 층 드롭 배율 (1이면 난수 사용 횟수도 예전과 같음)
  function rollKill(stage, isBoss, rng, mult = 1) {
    if (isBoss) {
      if (mult >= 1) return { equip: rollSpec('equip', stage, true, rng), shards: DROP.boss.shards };
      const equip = rng() < mult ? rollSpec('equip', stage, true, rng) : null;
      let shards = 0;
      for (let i = 0; i < DROP.boss.shards; i++) if (rng() < mult) shards++;
      return { equip, shards };
    }
    const equip = rng() < DROP.normal.equipRate * mult ? rollSpec('equip', stage, false, rng) : null;
    const shards = rng() < DROP.normal.shardRate * mult ? 1 : 0;
    return { equip, shards };
  }

  // 장신구 상자 1개 → 장신구 스펙 (상자 전용 확률표)
  const rollShardBox = (stage, rng) => rollSpec('accessory', stage, false, rng, 'box');

  // 꺼둔 시간(초) → 장비 개수 (secPerItem마다 1개, 최대 maxCount)
  function offlineEquipCount(sec, maxCount = DROP.offline.maxItems) {
    const n = Math.floor(toInt(sec) / DROP.offline.secPerItem);
    return Math.max(0, Math.min(n, toInt(maxCount)));
  }

  // 퇴근 후 정산 장비 스펙 배열. cap = 추가 상한(예: 가방 빈칸), 생략하면 없음
  function rollOffline(sec, stage, rng, cap) {
    let n = offlineEquipCount(sec);
    if (cap !== undefined && cap !== null) n = Math.min(n, toInt(cap));
    const out = [];
    for (let i = 0; i < n; i++) out.push(rollSpec('equip', stage, false, rng));
    return out;
  }

  G.Drops = {
    SLOTS_OF, bracketIndex, lateMult, gradeTable, rollGrade, rollSlotType, rollSpec,
    lowFloorMult, rollKill, rollShardBox, offlineEquipCount, rollOffline,
  };
})(globalThis.Game = globalThis.Game || {});
