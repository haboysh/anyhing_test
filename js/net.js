// 인맥 "인맥 관리" 규칙 (명세 docs/impl-spec-m4.md ③). 명함으로 친분 레벨업, 성과급으로 사이(진화) 올리기.
// 폰(서버 없을 때)과 서버가 같은 함수를 실행. DOM·저장·전투를 모름. 수치는 [임시 ⚖] = 밸런스팀 검토 전.
// st = 상태 (세이브 또는 서버가 만든 것): net {lv, rank}, namecard, bonus, dept.conquered
// h = inventory.js와 같은 연결부 {rng, now, emit, stat, track, onCreate}
(function (G) {
  'use strict';
  const ok = (o = {}) => ({ ok: true, ...o });
  const no = (reason) => ({ ok: false, reason });

  // 4명 (equipment-system.md 15절 후보). need = 열리는 부서 장악 수 (35절 #5 추천안: 첫 장악 2명 · 3곳 · 5곳)
  // stat = 이미 있는 능력치 키, per = 친분 1레벨마다 % [임시 ⚖]
  const PEOPLE = [
    { id: 'exlead', name: '전 팀장', line: '이긴 꼰대 팀장이 내 편이 됐어요', stat: 'atk', per: 0.4, need: 1 },
    { id: 'hrmate', name: '인사팀 동기', line: '인사 소식을 미리 귀띔해 줘요', stat: 'hp', per: 0.6, need: 1 },
    { id: 'client', name: '거래처 사장님', line: '계약 따 주면 밥을 사요', stat: 'gold', per: 0.5, need: 3 },
    { id: 'guard', name: '경비실 아저씨', line: '야근할 때 문을 열어 줘요', stat: 'boss', per: 0.5, need: 5 },
  ];
  const BY_ID = Object.fromEntries(PEOPLE.map((p, i) => [p.id, { ...p, n: i }]));
  const IDS = PEOPLE.map((p) => p.id);

  // 사이(진화) 0~10. 이름 [문구 일감: content/net.json]
  const RANKS = ['처음 본 사이', '아는 사이', '명함 교환', '커피 한잔', '점심 메이트', '회식 동지', '술친구', '형님·언니', '경조사 챙기는 사이', '평생 인맥', '은인'];
  const CFG = {
    maxRank: RANKS.length - 1, // 10
    maxLv: 100,
    lvPerRank: 10, // 사이마다 친분 상한 +10
    lvCost: (rank) => 5 + 2 * rank, // 친분 1레벨 명함 [악 5장 시작, 늘어나는 폭 임시 ⚖]
    rankCost: (rank) => 500 * (rank + 1), // 다음 사이 성과급 ✅ 2026-10-28 사용자 확정 — 합계 27,500/명
    rankPct: 2, // 사이 1단계마다 같은 능력치 +2% [임시 ⚖]
    bulkMax: 1000, // 한 번에 올릴 수 있는 최대 레벨 (요청 크기 제한)
    cardShop: { perDay: 20, cost: 50 }, // 명함 상점: 성과급 50 = 명함 1장, 하루 20장 (2026-11-07 사용자 — 인맥이 명함에 막혀 성과급을 더 써도 못 키우던 것)
  };
  // 사이 r일 때 친분 상한 (사이 9 → 100, 사이 10 = 다 키움)
  const lvCap = (rank) => Math.min(CFG.maxLv, rank * CFG.lvPerRank + CFG.lvPerRank);

  const fresh = () => ({ lv: {}, rank: {}, shop: { day: null, n: 0 } });
  const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
  const toInt = (v) => (Number.isInteger(v) && v >= 0 ? v : 0);
  // 세이브·서버 값 정리 (모르는 키 제거, 정수·범위)
  function clean(raw) {
    const r = obj(raw);
    const d = fresh();
    for (const id of IDS) {
      const rank = Math.min(CFG.maxRank, toInt(obj(r.rank)[id]));
      const lv = Math.min(lvCap(rank), toInt(obj(r.lv)[id]));
      if (rank) d.rank[id] = rank;
      if (lv) d.lv[id] = lv;
    }
    const sh = obj(r.shop);
    d.shop = { day: Number.isInteger(sh.day) ? sh.day : null, n: Math.min(CFG.cardShop.perDay, toInt(sh.n)) };
    return d;
  }

  const conqueredOf = (st) => (st.dept && Number.isInteger(st.dept.conquered) ? st.dept.conquered : 0);
  const isOpen = (id, conquered) => !!BY_ID[id] && conquered >= BY_ID[id].need;
  const openCount = (conquered) => PEOPLE.filter((p) => conquered >= p.need).length;
  const lvOf = (net, id) => (net.lv[id] || 0);
  const rankOf = (net, id) => (net.rank[id] || 0);
  const pctOf = (id, lv, rank) => lv * BY_ID[id].per + rank * CFG.rankPct;

  // 한 명 화면 정보
  function info(st, id) {
    const p = BY_ID[id];
    const net = st.net;
    const lv = lvOf(net, id);
    const rank = rankOf(net, id);
    const cap = lvCap(rank);
    const open = isOpen(id, conqueredOf(st));
    const maxed = rank >= CFG.maxRank;
    return {
      id, name: p.name, line: p.line, stat: p.stat, per: p.per, need: p.need, open, lv, rank, cap, maxed,
      rankName: RANKS[rank], nextRankName: maxed ? null : RANKS[rank + 1],
      pct: pctOf(id, lv, rank),
      lvCost: CFG.lvCost(rank), // 친분 1레벨 명함
      canLevel: open && lv < cap, // 상한 전
      atCap: open && lv >= cap && !maxed, // 사이 올리기 차례
      rankCost: maxed ? null : CFG.rankCost(rank),
    };
  }
  const list = (st) => IDS.map((id) => info(st, id));

  // 능력치 합계 {stat: %} (열린 인맥만 — 세이브를 조작해도 안 열린 인맥은 0)
  function bonus(net, conquered = Infinity) {
    const out = {};
    for (const p of PEOPLE) {
      if (conquered < p.need) continue;
      const v = pctOf(p.id, lvOf(net, p.id), rankOf(net, p.id));
      if (v) out[p.stat] = (out[p.stat] || 0) + v;
    }
    return out;
  }

  // ----- 친분 레벨업: 명함 n레벨치 (상한·명함이 되는 만큼, 0이면 거절) -----
  function levelUp(st, h, id, n = 1) {
    if (!BY_ID[id]) return no('없는 인맥이에요');
    if (!isOpen(id, conqueredOf(st))) return no(`부서 ${BY_ID[id].need}곳을 장악하면 열려요`);
    if (!Number.isInteger(n) || n < 1) return no('레벨 수가 올바르지 않아요');
    const net = st.net;
    const lv = lvOf(net, id);
    const rank = rankOf(net, id);
    const cap = lvCap(rank);
    if (lv >= cap) return no(rank >= CFG.maxRank ? '이미 다 키웠어요' : '사이를 먼저 올려야 해요');
    const each = CFG.lvCost(rank);
    const k = Math.min(n, cap - lv, CFG.bulkMax, Math.floor(st.namecard / each));
    if (k < 1) return no(`명함이 부족해요 (${each}장 필요)`);
    const cost = k * each;
    st.namecard -= cost;
    net.lv[id] = lv + k;
    h.stat('net_lv', k);
    h.emit('netLevel', { id, lv: lv + k, n: k });
    return ok({ id, n: k, cost, lv: lv + k });
  }

  // ----- 사이 올리기: 친분이 상한일 때 성과급으로 -----
  function rankUp(st, h, id) {
    if (!BY_ID[id]) return no('없는 인맥이에요');
    if (!isOpen(id, conqueredOf(st))) return no(`부서 ${BY_ID[id].need}곳을 장악하면 열려요`);
    const net = st.net;
    const rank = rankOf(net, id);
    if (rank >= CFG.maxRank) return no('이미 가장 가까운 사이예요');
    if (lvOf(net, id) < lvCap(rank)) return no(`친분 Lv${lvCap(rank)}이 되면 올릴 수 있어요`);
    const cost = CFG.rankCost(rank);
    if (st.bonus < cost) return no('성과급이 부족해요');
    st.bonus -= cost;
    net.rank[id] = rank + 1;
    h.stat('net_rank', rank + 1, true);
    h.emit('netRank', { id, rank: rank + 1 });
    return ok({ id, rank: rank + 1, rankName: RANKS[rank + 1], cost });
  }

  // ----- 일괄 친분: 명함이 되는 만큼 열린 인맥에게 낮은 레벨부터 고르게 (사이 막힘에서 멈춤) -----
  function levelAll(st, h) {
    const net = st.net;
    const conquered = conqueredOf(st);
    const ups = {};
    let cost = 0;
    let total = 0;
    for (let guard = 0; guard < CFG.maxLv * IDS.length; guard++) {
      let pick = null;
      for (const id of IDS) {
        if (!isOpen(id, conquered)) continue;
        const lv = lvOf(net, id);
        const rank = rankOf(net, id);
        if (lv >= lvCap(rank) || st.namecard < CFG.lvCost(rank)) continue;
        if (!pick || lv < lvOf(net, pick)) pick = id;
      }
      if (!pick) break;
      const each = CFG.lvCost(rankOf(net, pick));
      st.namecard -= each;
      net.lv[pick] = lvOf(net, pick) + 1;
      ups[pick] = (ups[pick] || 0) + 1;
      cost += each;
      total++;
    }
    if (!total) {
      const anyOpen = IDS.some((id) => isOpen(id, conquered) && lvOf(net, id) < lvCap(rankOf(net, id)));
      return no(anyOpen ? '명함이 부족해요' : '올릴 수 있는 인맥이 없어요 (사이를 먼저 올려요)');
    }
    h.stat('net_lv', total);
    for (const id of Object.keys(ups)) h.emit('netLevel', { id, lv: lvOf(net, id), n: ups[id] });
    return ok({ n: total, cost, ups });
  }

  // ----- 명함 상점: 성과급으로 명함 (하루 상한, 한국 날짜 기준) -----
  function cardShopLeft(st, now) {
    const shop = st.net.shop || (st.net.shop = { day: null, n: 0 });
    const d = G.Meta.dayNum(now);
    if (shop.day !== d) { shop.day = d; shop.n = 0; }
    return CFG.cardShop.perDay - shop.n;
  }
  function buyCards(st, h0, n = 1) {
    const h = G.Inv.hooks(h0);
    if (!isOpen(IDS[0], conqueredOf(st))) return no('첫 부서 장악 때 열려요');
    if (!Number.isInteger(n) || n < 1) return no('장 수가 올바르지 않아요');
    const left = cardShopLeft(st, h.now());
    if (left <= 0) return no('오늘은 다 샀어요');
    const k = Math.min(n, left, Math.floor(st.bonus / CFG.cardShop.cost));
    if (k < 1) return no('성과급이 부족해요');
    const cost = k * CFG.cardShop.cost;
    st.bonus -= cost;
    st.namecard += k;
    st.net.shop.n += k;
    h.emit('save');
    return ok({ n: k, cost, left: left - k });
  }

  G.Net = { PEOPLE, BY_ID, IDS, RANKS, CFG, lvCap, fresh, clean, isOpen, openCount, info, list, bonus, levelUp, rankUp, levelAll, cardShopLeft, buyCards };
})(globalThis.Game = globalThis.Game || {});
