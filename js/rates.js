// 사내 게시판 "확률 공개" 표 (명세 docs/impl-spec-m4.md 11절). 손으로 쓴 숫자 없이 규칙 파일에서 바로 만듦.
// 서버도 같은 규칙 파일로 뽑기·강화를 판정하므로 이 표 = 서버가 실제로 쓰는 확률. DOM 모름 → 테스트 가능.
// 필요: Game.Items, Equipment, Gacha, Drops, Skills, Pets, Meta 가 먼저 로드돼 있어야 함.
// 반려 뽑기 등 새 뽑기는 gacha.js BY_KIND에 kind를 넣으면 자동으로 표가 생김 (이름은 GACHA_TITLE에 추가)
(function (G) {
  'use strict';
  const I = G.Items;
  const GA = G.Gacha;
  const GN = I.GRADES.map((g) => g.name);

  const GACHA_TITLE = {
    equip: { title: '장비 뽑기', what: '키보드·마우스·모니터·의자', slotKind: 'equip' },
    acc: { title: '장신구 뽑기', what: '사원증·시계·반지', slotKind: 'accessory' },
    skill: { title: '업무 스킬 뽑기', what: '업무 스킬 카드' },
    pet: { title: '반려 뽑기', what: '책상 반려' },
  };

  // 숫자 글자: %는 소수 3자리까지 (뒤 0 지움)
  const p3 = (x) => String(Math.round(x * 1000) / 1000);
  const pct = (x) => p3(x * 100) + '%';
  const comma = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const names = (gs) => gs.map((g) => GN[g]).join('·');
  const slotNames = (kind) => G.Drops.SLOTS_OF[kind].map((s) => I.SLOTS[s].name);

  // 짧은 해시 (FNV-1a 32비트 → 6글자). 확률표 내용이 바뀌면 달라짐
  function hash(text) {
    let h = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    return h.toString(36).padStart(7, '0').slice(-6);
  }

  // ----- 뽑기 -----
  function gachaSection(kind) {
    const c = GA.configFor(kind);
    const meta = GACHA_TITLE[kind] || { title: `${kind} 뽑기`, what: '' };
    const head = ['레벨', ...GN];
    // 첫 칸 = "레벨\n누적 횟수" (화면은 줄바꿈을 작은 글자로), 확률은 0.001% 단위라 소수 3자리 고정
    const lvRows = (boosted) => Array.from({ length: c.LEVELS.length + 1 }, (_, L) =>
      [`Lv.${L}\n${L === 0 ? 0 : comma(c.LEVELS[L - 1])}회~`, ...GA.rates(L, boosted, c).map((x) => x.toFixed(3))]);
    const tables = [
      { caption: '뽑기 레벨별 등급 확률 (%)', head, rows: lvRows(false) },
      { caption: `${c.BOOST_EVERY}번째마다 확률업 뽑기 실제 확률 (%)`, head, rows: lvRows(true) },
    ];
    const prices = Object.keys(c.PRICES).map(Number).sort((a, b) => a - b);
    const notes = [
      `가격: ${prices.map((n) => `${n}회 성과급 ${comma(c.PRICES[n])}`).join(' · ')}`,
      `뽑기 레벨은 이 뽑기의 누적 횟수로 올라가고 내려가지 않아요. 여러 번 뽑기 중에 레벨이 오르면 바로 다음 뽑기부터 새 확률이에요`,
      `누적 ${c.BOOST_EVERY}·${c.BOOST_EVERY * 2}·${c.BOOST_EVERY * 3}…번째 뽑기는 ${names(c.BOOST_GRADES)} 확률 ×${c.BOOST_MULT}. 늘어난 만큼 ${names(c.DEDUCT_ORDER)} 순서로 빼요`,
      `${GN[GA.CONFIG.PITY_GRADE]} 없이 ${comma(GA.CONFIG.PITY)}번째 뽑기는 ${GN[GA.CONFIG.PITY_GRADE]} 확정 (그 등급이 나오면 처음부터 다시 셈)`,
      `횟수(레벨·확률업·천장)는 뽑기 종류마다 따로 세요`,
    ];
    if (meta.slotKind) {
      const sl = slotNames(meta.slotKind);
      const types = I.TYPES[G.Drops.SLOTS_OF[meta.slotKind][0]].length;
      notes.push(`등급이 정해지면 부위(${sl.join('·')})는 각 1/${sl.length}, 종류는 부위마다 ${types}종 중 각 1/${types}로 똑같아요`);
      notes.push(`뽑기 레벨마다 업무력 +${c.LEVEL_ATK.slice(1).join('/')}% (Lv.1~${c.LEVELS.length}, 뽑기 종류마다 따로, 서로 곱함)`);
    }
    if (kind === 'skill') {
      const SK = G.Skills;
      tables.push({
        caption: '등급 안 스킬 (모두 똑같은 확률)',
        head: ['등급', '스킬', '각각'],
        rows: GN.map((n, g) => {
          const list = SK.LIST.filter((s) => s.grade === g);
          return [n, list.map((s) => s.name).join(', '), list.length ? pct(1 / list.length) : '-'];
        }).filter((r) => r[1]),
      });
      notes.push(`그 등급 스킬이 모두 최대 레벨이면 카드 대신 짬 ${SK.CFG.jjamPerCard.join('/')}개 (${GN[0]}~${GN[GN.length - 1]})`);
    }
    if (kind === 'pet') {
      const P = G.Pets;
      const tot = P.CFG.tierRates.reduce((a, b) => a + b, 0);
      tables.push({
        caption: '등급 안 반려 (모두 똑같은 확률)',
        head: ['등급', '반려', '각각'],
        rows: GN.map((n, g) => {
          const list = P.LIST.filter((p) => p.grade === g);
          return [n, list.map((p) => p.name).join(', '), list.length ? pct(1 / list.length) : '-'];
        }).filter((r) => r[1]),
      });
      tables.push({ caption: '단계 확률 (등급·반려와 따로)', head: ['단계', '확률'], rows: P.TIERS.map((t, i) => [t, pct(P.CFG.tierRates[i] / tot)]) });
      notes.push('반려는 가방을 안 써요. 뽑기 레벨이 올라도 업무력 보너스는 없어요 (장비·장신구 뽑기만)');
      const ST = G.Meta && G.Meta.STARTER;
      if (ST) {
        const g0 = ST.heroMin;
        const at = (lv) => G.Gacha.ratesAtLeast(lv, g0, c).slice(g0).map((p, i) => `${GN[g0 + i]} ${p.toFixed(3)}%`).join(' · ');
        notes.push(`반려 뽑기권(첫 결제 패키지) 1장 = 반려 뽑기 1회, 확률은 성과급 뽑기와 같아요`);
        notes.push(`영웅 이상 반려 뽑기권(첫 결제 패키지, 계정당 1장): ${GN[g0]} 이상만 나와요. 그 안의 비율은 위 표 그대로 — Lv.0 ${at(0)}, Lv.${c.LEVELS.length} ${at(c.LEVELS.length)}. 반려·단계는 위 표 그대로, 뽑기 횟수·확률업·천장엔 안 들어가요`);
      }
    }
    return { key: 'gacha_' + kind, title: meta.title, group: '뽑기', tables, notes };
  }

  // ----- 장비 강화 -----
  function enhanceSection() {
    const E = I.ENHANCE;
    const rows = E.rows.map((r, p) => [`+${p} → +${p + 1}`, ...r.map(pct)]);
    const B = E.boost;
    const P = E.protect;
    return {
      key: 'enhance', title: '장비 강화', group: '장비',
      tables: [{ caption: '단계별 결과 확률', head: ['단계', '성공', '유지', '강등', '파괴'], rows }],
      notes: [
        `연속 ${E.downPity}번 강등되면 다음 강화는 성공 100%`,
        `+${B.from}부터 짬을 넣으면 1개당 성공 +${p3(B.per * 100)}%p (최대 ${B.max}개). 늘어난 만큼 유지에서 빼요`,
        `+${P.from}부터 짬을 넣으면 1개당 파괴 −${p3(P.per * 100)}%p (최대 ${P.max}개). 줄어든 만큼 유지가 돼요`,
        `파괴되면 ${names(E.ruinGrades)} 등급은 흔적이 남아 +${E.restorePlus} 상태로 복구할 수 있고, 그 밖의 등급은 사라져요`,
        `실패(유지·강등)하면 짬 ${E.failJjam}개, 파괴되면 짬 ${E.breakJjam}개를 받아요`,
      ],
    };
  }

  // ----- 합성 -----
  function mergeSection() {
    const M = I.MERGE;
    const rows = [];
    for (let n = 0; ; n++) {
      const r = G.Equipment.mergeRate(n);
      rows.push([`연속 실패 ${n}회`, pct(r)]);
      if (r >= M.maxRate || n > 50) break;
    }
    rows[rows.length - 1][0] += ' 이상';
    return {
      key: 'merge', title: '장비 합성', group: '장비',
      tables: [{ caption: '합성 성공 확률', head: ['상태', '성공'], rows }],
      notes: [
        `같은 부위·등급 ${M.count}개 → 한 등급 위 1개. 연속 실패 횟수는 등급마다 따로 세고, 성공하면 0으로`,
        `성공하면 새 아이템 종류는 재료 ${M.count}개 중 하나(각 1/${M.count}), 강화·층은 재료 중 가장 높은 값`,
        `실패하면 재료는 사라지고 짬 ${M.failJjam}개를 받아요`,
      ],
    };
  }

  // ----- 감정(잠재능력) -----
  function potentialSection() {
    const P = I.POTENTIAL;
    const keys = I.STAT_KEYS.filter((k) => P.weights[k] > 0);
    const total = keys.reduce((s, k) => s + P.weights[k], 0);
    const gs = GN.map((_, g) => g).filter((g) => P.lines[g] > 0);
    const cell = (k, g) => {
      const v = P.values[k][g];
      const u = I.STATS[k].unit;
      if (!v) return '-';
      if (v.flat !== undefined) return `기준값×${v.flat}`;
      if (v.fixed !== undefined) return `${v.fixed}${u}`;
      return `${v.min}~${v.max}${u}`;
    };
    return {
      key: 'potential', title: '감정 (잠재능력)', group: '장비',
      tables: [
        { caption: '등급별 줄 수', head: ['등급', '줄'], rows: GN.map((n, g) => [n, String(P.lines[g])]) },
        { caption: '줄마다 능력치 확률', head: ['능력치', '확률'], rows: keys.map((k) => [I.STATS[k].name, pct(P.weights[k] / total)]) },
        { caption: '값', head: ['능력치', ...gs.map((g) => GN[g])], rows: keys.map((k) => [I.STATS[k].name, ...gs.map((g) => cell(k, g))]) },
      ],
      notes: [
        `같은 능력치는 최대 ${P.maxSame}줄. ${P.maxSame}줄이 된 능력치는 다음 줄에서 빠지고 남은 능력치끼리 위 비율대로 나눠요 (잠근 줄 포함)`,
        `범위 값은 능력치마다 정해진 단위(0.1 또는 0.5)로 고르게 나와요. 양 끝 값은 가운데 값의 절반 확률`,
        `기준값 = 아이템 층에 따라 커지는 깡수치 (${Object.keys(I.FLAT_BASE).map((k) => I.STATS[k].name).join('·')})`,
      ],
    };
  }

  // ----- 반려 합치기 -----
  function petMergeSection() {
    const P = G.Pets;
    const last = P.TIERS.length - 1;
    return {
      key: 'pet_merge', title: '반려 합치기', group: '반려',
      tables: [
        { caption: '합치기 결과', head: ['재료', '결과', '확률'], rows: [
          ...P.TIERS.slice(0, last).map((t, i) => [`같은 반려 ${t} ${P.CFG.mergeNeed}개`, `같은 반려 ${P.TIERS[i + 1]} 1개`, '100%']),
          ...GN.slice(0, GN.length - 1).map((n, g) => [`${n} 반려 ${P.TIERS[last]} ${P.CFG.mergeNeed}개`, `${GN[g + 1]} 반려 ${P.TIERS[0]} 1개 (${P.LIST.filter((p) => p.grade === g + 1).map((p) => p.name).join('·')} 중 각 ${pct(1 / P.LIST.filter((p) => p.grade === g + 1).length)})`, '100%']),
        ] },
        { caption: '합치기 비용 (재산, 1번)', head: ['등급', '재산'], rows: GN.map((n, g) => [n, `처치 보상 ${comma(P.CFG.mergeCostKills * P.CFG.mergeCostMult[g])}번치`]) },
      ],
      notes: [
        `${GN[GN.length - 1]} ${P.TIERS[last]}는 더 합칠 수 없어요`,
        '처치 보상 = 이번 회차 최고 층에서 일반 업무 1개 처리할 때 받는 재산 (재산 보너스 포함)',
        `일괄 합치기는 낮은 등급·단계부터 하고, ${P.TIERS[last]}는 반려가 없어지지 않게 1개 남겨요`,
      ],
    };
  }

  // ----- 처치 드롭·장신구 상자·출석 상자 -----
  function bracketRows(table) {
    return table.map((row, i) => {
      const next = table[i + 1];
      return [next ? `${row.minFloor}~${next.minFloor - 1}층` : `${row.minFloor}층~`, ...row.rates.map(p3)];
    });
  }
  function dropSection() {
    const D = I.DROP;
    const L = D.late;
    const lateRows = [L.from, L.from * 1.5, L.from * 2, L.from * 3].map((f) => [`${f}층`, '×' + p3(G.Drops.lateMult(f))]);
    lateRows.push([`${Math.ceil(L.from * Math.pow(2, (L.cap - 1) / L.k))}층~`, '×' + p3(L.cap)]);
    const lf = D.lowFloor;
    return {
      key: 'drop', title: '처치 드롭', group: '획득',
      tables: [
        { caption: '장비 등급 확률 (%, 유효 층 기준)', head: ['층', ...GN], rows: bracketRows(D.gradeTable) },
        { caption: `${L.from}층 넘으면 ${names(L.grades)} 배율`, head: ['층', '배율'], rows: lateRows },
      ],
      notes: [
        `일반 업무 처치: 장비 ${pct(D.normal.equipRate)}, 장신구 조각 1개 ${pct(D.normal.shardRate)}`,
        `보스 처치: 장비 1개 확정 + 장신구 조각 ${D.boss.shards}개, 등급은 표에서 한 구간 위`,
        `${L.from}층 넘으면 ${names(L.grades)} 확률에 위 배율을 곱하고, 늘어난 만큼 ${GN[0]}에서 빼요`,
        `이번 회차 최고 유효 층보다 ${lf.free}층 넘게 낮은 층은 한 층마다 드롭 확률 ×${p3(lf.per)} (최저 ${pct(lf.min)}). 장비·조각·결재 도장 모두`,
        `퇴근 후 정산: ${D.offline.secPerItem / 60}분마다 장비 1개 (최대 ${D.offline.maxItems}개), 같은 표`,
        `부위·종류는 똑같은 확률 (${slotNames('equip').join('·')})`,
      ],
    };
  }
  function boxSection() {
    return {
      key: 'box', title: '장신구 상자', group: '획득',
      tables: [{ caption: '등급 확률 (%, 지금 유효 층 기준)', head: ['층', ...GN], rows: bracketRows(I.DROP.boxTable) }],
      notes: [
        `장신구 조각 ${I.DROP.shardsPerBox}개 → 상자 1개`,
        `부위(${slotNames('accessory').join('·')})·종류는 똑같은 확률`,
      ],
    };
  }
  function attendanceSection() {
    const M = G.Meta;
    const rows = [];
    for (let d = 1; d <= M.ATT.days; d++) {
      const r = M.ATT.reward(d);
      if (r.box) rows.push([`${d}일`, `${GN[r.box.grade]} ${r.box.kind === 'accessory' ? '장신구' : '장비'}`, '100%']);
    }
    return {
      key: 'att', title: '출석 상자', group: '획득',
      tables: [{ caption: '상자 등급 (정해져 있음)', head: ['날', '내용', '확률'], rows }],
      notes: ['부위·종류는 똑같은 확률, 층은 지금까지 최고 층'],
    };
  }

  // 전체 확률표 → [{key, title, group, tables:[{caption, head, rows}], notes, ver}]
  let cache = null;
  function all(fresh = false) {
    if (cache && !fresh) return cache;
    const kinds = Object.keys(G.Inv ? G.Inv.GACHA_KIND : GACHA_TITLE).filter((k) => GA.configFor(k));
    const order = ['equip', 'acc', 'skill', 'pet'];
    kinds.sort((a, b) => (order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99));
    const list = [...kinds.map(gachaSection), enhanceSection(), mergeSection(), potentialSection(), ...(G.Pets ? [petMergeSection()] : []), dropSection(), boxSection(), attendanceSection()];
    for (const s of list) s.ver = hash(JSON.stringify([s.tables, s.notes]));
    cache = list;
    return list;
  }
  const byKey = (key) => all().find((s) => s.key === key) || null;
  // 전체 버전 (서버 hello가 같은 값을 돌려줌 → 다르면 "앱을 업데이트해 주세요")
  let verCache = null; // 화면이 0.1초마다 물어봄 → 표가 그대로면 다시 해시하지 않음
  const version = (fresh = false) => {
    const list = all(fresh);
    if (!verCache || verCache.list !== list) verCache = { list, v: hash(list.map((s) => s.key + ':' + s.ver).join('|')) };
    return verCache.v;
  };

  G.Rates = { GACHA_TITLE, hash, all, byKey, version };
})(globalThis.Game = globalThis.Game || {});
