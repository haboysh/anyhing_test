// 업무 스킬 규칙 (명세 docs/impl-spec-m3.md ③): 스킬 표, 숙련(같은 스킬 카드로 레벨업), 보유 효과, 칸 해금.
// DOM·저장·시간·Math.random 모름. 폰과 서버(뽑기 결과)가 같은 코드를 씀. 수치 근거: docs/impl-spec-m3.md ③, docs/balance-check-2026-10-27.md
(function (G) {
  'use strict';

  // e = 효과: hit{pct, n} · boss(보스에게 +%) · stun(초) · heal(최대 체력 %) · guard{sec, cut} · invuln(초)
  //           gold(처치 보상 몇 번치) · dot{sec, pct}(1초마다) · execute(일반 업무면 이 층 남은 업무 처리, 아니면 hit) · refresh(버프 쿨 초기화) · crit(이 공격 치명 +%p)
  // 계수는 2026-10-27 밸런스 점검으로 처음 안의 ×0.75 (폭풍 결재 112.5 → 110), docs/balance-check-2026-10-27.md
  const LIST = [
    { key: 'mail', grade: 0, name: '메일 회신', cd: 5, e: { hit: { pct: 225, n: 1 } }, desc: '225% 한 번' },
    { key: 'excel', grade: 0, name: '엑셀 단축키', cd: 6, e: { hit: { pct: 90, n: 3 } }, desc: '90% 세 번' },
    { key: 'postit', grade: 0, name: '포스트잇 투척', cd: 7, e: { hit: { pct: 150, n: 2 } }, desc: '150% 두 번' },
    { key: 'stapler', grade: 0, name: '스테이플러 연타', cd: 8, e: { hit: { pct: 60, n: 6 } }, desc: '60% 여섯 번' },
    { key: 'stamp', grade: 1, name: '폭풍 결재', cd: 8, e: { hit: { pct: 110, n: 5 } }, desc: '110% 다섯 번' },
    { key: 'report', grade: 1, name: '보고서 제출', cd: 10, e: { hit: { pct: 675, n: 1 }, boss: 50 }, desc: '675%, 보스에게 +50%' },
    { key: 'ghost', grade: 1, name: '메신저 잠수', cd: 12, e: { hit: { pct: 300, n: 1 }, stun: 2 }, desc: '300% + 적 공격 2초 멈춤' },
    { key: 'pantry', grade: 2, name: '탕비실 농땡이', cd: 15, e: { hit: { pct: 375, n: 1 }, heal: 20 }, desc: '375% + 체력 20% 회복' },
    { key: 'earphone', grade: 2, name: '귀에 이어폰', cd: 12, e: { hit: { pct: 225, n: 3 }, crit: 30 }, desc: '225% 세 번, 치명타 +30%p' },
    { key: 'sitin', grade: 2, name: '회의실 농성', cd: 18, e: { hit: { pct: 1125, n: 1 }, guard: { sec: 3, cut: 0.5 } }, desc: '1,125% + 3초간 받는 피해 −50%' },
    { key: 'corpcard', grade: 3, name: '법인카드 찬스', cd: 20, e: { hit: { pct: 1875, n: 1 }, gold: 3 }, desc: '1,875% + 처치 보상 3번치 재산' },
    { key: 'leave', grade: 3, name: '급한 연차', cd: 25, e: { hit: { pct: 900, n: 1 }, invuln: 3 }, desc: '900% + 3초 무적' },
    { key: 'replyall', grade: 3, name: '전체 회신 폭탄', cd: 18, e: { hit: { pct: 300, n: 8 } }, desc: '300% 여덟 번' },
    { key: 'wfh', grade: 4, name: '재택근무', cd: 30, e: { dot: { sec: 8, pct: 450 } }, desc: '8초간 1초마다 450%' },
    { key: 'pt', grade: 4, name: '임원 프레젠테이션', cd: 30, e: { hit: { pct: 4500, n: 1 }, boss: 100 }, desc: '4,500%, 보스에게 +100%' },
    { key: 'kaltoe', grade: 5, name: '칼퇴 선언', cd: 60, e: { execute: true, hit: { pct: 11250, n: 1 } }, desc: '이 층 남은 업무 모두 처리 (보스·도전 전투는 11,250%)' },
    { key: 'fourday', grade: 5, name: '주4일제', cd: 60, e: { hit: { pct: 7500, n: 1 }, refresh: true }, desc: '7,500% + 아아·야근 쿨타임 초기화' },
  ];
  const BY_KEY = Object.fromEntries(LIST.map((s) => [s.key, s]));
  const KEYS = LIST.map((s) => s.key);

  const CFG = {
    unlock: 20, // 평생 최고 층 20에서 열림, "메일 회신" 1장 지급
    starter: 'mail',
    slotFloors: [20, 40, 70, 100, 150], // 칸 해금 (평생 최고 층)
    maxLv: 20,
    lvPerStep: 0.10, // 계수 × (1 + 0.10 × (L − 1)) (0.15 → 0.10, 2026-10-27)
    costKills: 2, // 숙련 재산 = 이번 회차 최고 층 일반 처치 보상 × 2 × 등급 배율 × L (2026-10-27)
    costGrade: [1, 1.5, 2, 3, 4, 6],
    holdAtk: [0.1, 0.2, 0.4, 1.2, 4, 10], // 보유 효과: 업무력 +[등급] × L % — 전체 공격력에 따로 곱함 [⚖ 2026-11-05: 전설·신화를 크게]
    castGap: 0.3, // 스킬 사이 최소 간격 (초)
    ticketPieces: 3, // 만렙 스킬 카드 1장 = 그 등급 교환권 1/3 (2026-10-27 사용자)
    jjamPerCard: [1, 1, 2, 3, 5, 10], // 그 등급이 전부 만렙이면 카드 1장 = 짬 (2026-10-27 확정)
  };

  // tickets = 등급별 교환권 조각 수, granted = 첫 "메일 회신" 받음. owned·tickets·granted는 서버 모드면 서버 기록(meta_states.skill) 복사본, slots·cd는 폰
  const fresh = () => ({ owned: {}, slots: [null, null, null, null, null], cd: {}, tickets: [0, 0, 0, 0, 0, 0], granted: false });
  const ok = (o = {}) => ({ ok: true, ...o });
  const no = (reason) => ({ ok: false, reason });
  const toInt = (v, d = 0) => (Number.isInteger(v) && v >= 0 ? v : d);
  // 세이브 정리: 모르는 키 제거, 레벨 범위, 잠긴 칸·없는 스킬·중복 장착 → null
  function clean(raw, maxStage) {
    const r = raw && typeof raw === 'object' ? raw : {};
    const s = fresh();
    const owned = r.owned && typeof r.owned === 'object' ? r.owned : {};
    for (const k of KEYS) {
      const o = owned[k];
      if (!o || typeof o !== 'object') continue;
      s.owned[k] = { lv: Math.min(CFG.maxLv, Math.max(1, toInt(o.lv, 1))), cards: toInt(o.cards) };
    }
    const slots = Array.isArray(r.slots) ? r.slots : [];
    const used = new Set();
    for (let i = 0; i < CFG.slotFloors.length; i++) {
      const k = slots[i];
      if (typeof k === 'string' && Object.prototype.hasOwnProperty.call(s.owned, k) && !used.has(k) && slotOpen(i, maxStage)) { s.slots[i] = k; used.add(k); } // 'constructor' 같은 이름 막음
    }
    const cd = r.cd && typeof r.cd === 'object' ? r.cd : {};
    for (const k of Object.keys(s.owned)) if (typeof cd[k] === 'number' && isFinite(cd[k]) && cd[k] > 0) s.cd[k] = Math.min(cd[k], BY_KEY[k].cd * 2); // 회사 '스킬 쿨타임 증가'면 기본보다 김 (예전엔 기본값으로 잘림, 2026-11-14)
    const t = Array.isArray(r.tickets) ? r.tickets : [];
    s.tickets = s.tickets.map((_, g) => Math.min(9999, toInt(t[g])));
    // 예전 세이브(granted 없음)는 보유가 있으면 받은 것. granted: false가 적혀 있으면 그대로
    // (첫 지급 전에 뽑으면 다시 열 때 첫 지급을 건너뛰던 것, 2026-11-14)
    s.granted = r.granted === true || (r.granted !== false && Object.keys(s.owned).length > 0);
    return s;
  }
  // 서버가 저장하는 부분 (보유·레벨·카드·교환권·첫 지급). 장착 칸·쿨타임은 폰
  const own = (sk) => ({ owned: JSON.parse(JSON.stringify(sk.owned)), tickets: sk.tickets.slice(), granted: sk.granted === true });

  const slotOpen = (i, maxStage) => i >= 0 && i < CFG.slotFloors.length && maxStage >= CFG.slotFloors[i];
  const lvMult = (lv) => 1 + CFG.lvPerStep * (Math.max(1, lv) - 1);
  // 숙련 비용 (L → L+1): 카드 min(10, L)장 + 재산. base = 이번 회차 최고 유효 층 일반 처치 보상 (재산 보너스 포함, 엔진이 넘김)
  const levelCost = (key, lv, base) => ({ cards: Math.min(10, lv), gold: Math.max(1, base || 0) * CFG.costKills * CFG.costGrade[BY_KEY[key].grade] * lv });
  // 보유 효과 합 (업무력 %)
  function holdAtkPct(sk) {
    let p = 0;
    for (const k of Object.keys(sk.owned)) p += CFG.holdAtk[BY_KEY[k].grade] * sk.owned[k].lv;
    return p;
  }
  // 등급 → 그 등급 스킬 중 하나 (r: 0≤r<1)
  function pickKey(grade, r) {
    const pool = LIST.filter((s) => s.grade === grade);
    return pool[Math.min(pool.length - 1, Math.floor(r * pool.length))].key;
  }
  // 그 등급 스킬이 전부 만렙인지 (그러면 카드는 짬으로)
  const gradeAllMax = (sk, grade) => LIST.filter((d) => d.grade === grade).every((d) => sk.owned[d.key] && sk.owned[d.key].lv >= CFG.maxLv);
  const maxedGrades = (sk) => [0, 1, 2, 3, 4, 5].filter((g) => gradeAllMax(sk, g));
  // 뽑기·지급 결과 반영 → { key, isNew } · 만렙이면 { key, ticket: 그 등급 조각 수 }
  function gain(sk, key) {
    if (!BY_KEY[key]) return null;
    const o = sk.owned[key];
    if (!o) { sk.owned[key] = { lv: 1, cards: 0 }; return { key, isNew: true }; }
    if (o.lv >= CFG.maxLv) { const g = BY_KEY[key].grade; sk.tickets[g]++; return { key, ticket: sk.tickets[g] }; }
    o.cards++;
    return { key, isNew: false };
  }
  // 교환권(조각 3개)으로 같은 등급의 원하는 스킬 카드 1장 (만렙 스킬은 못 고름)
  function exchange(sk, key) {
    const d = BY_KEY[key];
    if (!d) return { ok: false, reason: '없는 스킬이에요' };
    if (sk.tickets[d.grade] < CFG.ticketPieces) return { ok: false, reason: `교환권 조각이 ${CFG.ticketPieces}개 필요해요` };
    if (sk.owned[key] && sk.owned[key].lv >= CFG.maxLv) return { ok: false, reason: '이미 최대 레벨이에요' };
    sk.tickets[d.grade] -= CFG.ticketPieces;
    const r = gain(sk, key);
    return { ok: true, key, isNew: r.isNew };
  }

  // ===== 보유를 바꾸는 작업 (폰 = 서버 없을 때, 서버 = op 'skill'). 같은 함수를 실행 =====
  // st = { skills, gold(재산, 폰 재화), maxStage(평생 최고 층 — 서버는 클라우드 세이브) }, h = inventory.js 연결부 {emit, stat}
  // base = 숙련 재산 기준 (이번 회차 최고 유효 층 일반 처치 보상, 재산 보너스 포함 — 폰이 계산, 서버는 최소값만 확인)
  const isOpen = (maxStage) => Number.isFinite(maxStage) && maxStage >= CFG.unlock;
  // 해금 지급: "메일 회신" 1장 (한 번만). 칸에 넣는 건 폰
  function start(st, h) {
    if (!isOpen(st.maxStage)) return no(`최고 ${CFG.unlock}층에서 열려요`);
    if (st.skills.granted) return no('이미 받았어요');
    st.skills.granted = true;
    const g = gain(st.skills, CFG.starter);
    h.emit('skillGain', g);
    return ok({ key: CFG.starter, isNew: g.isNew });
  }
  // 숙련 1번 (L → L+1)
  function levelUp(st, h, key, base) {
    if (!BY_KEY[key]) return no('없는 스킬이에요');
    const o = st.skills.owned[key];
    if (!o) return no('없는 스킬이에요');
    if (o.lv >= CFG.maxLv) return no('최대 레벨이에요');
    const c = levelCost(key, o.lv, base);
    if (o.cards < c.cards) return no(`같은 스킬 카드가 ${c.cards}장 필요해요`);
    if (!(st.gold >= c.gold)) return no('재산이 부족해요');
    o.cards -= c.cards;
    st.gold -= c.gold;
    o.lv++;
    h.emit('skillLevel', { key, lv: o.lv });
    return ok({ key, lv: o.lv, gold: c.gold });
  }
  const canLevel = (st, key, base) => {
    const o = st.skills.owned[key];
    if (!o || o.lv >= CFG.maxLv) return false;
    const c = levelCost(key, o.lv, base);
    return o.cards >= c.cards && st.gold >= c.gold;
  };
  // 일괄 숙련: 표 순서대로 되는 것부터 (재산이 모자라면 거기서 멈춤). 최대 17 × 19번
  function levelAll(st, h, base) {
    let n = 0;
    let gold = 0;
    for (let guard = 0; guard < KEYS.length * CFG.maxLv; guard++) {
      const pick = KEYS.find((k) => canLevel(st, k, base));
      if (!pick) break;
      gold += levelUp(st, h, pick, base).gold;
      n++;
    }
    return n ? ok({ n, gold }) : no('숙련할 수 있는 스킬이 없어요');
  }
  // 교환권 사용 (같은 등급 조각 3개 → 원하는 스킬 카드 1장)
  function useTicket(st, h, key) {
    const r = exchange(st.skills, key);
    if (r.ok) h.emit('skillGain', { key, isNew: r.isNew });
    return r;
  }
  // 뽑기 결과 한 장 반영: 그 등급이 전부 만렙이면 짬(st.jjam), 아니면 카드(만렙 스킬이면 교환권 조각)
  function pullGain(st, h, grade, key) {
    if (gradeAllMax(st.skills, grade)) { const jjam = CFG.jjamPerCard[grade]; st.jjam += jjam; return { jjam }; }
    const g = gain(st.skills, key);
    h.emit('skillGain', g);
    return g.ticket ? { isNew: false, ticket: g.ticket } : { isNew: g.isNew };
  }

  G.Skills = { LIST, BY_KEY, KEYS, CFG, fresh, clean, own, slotOpen, lvMult, levelCost, holdAtkPct, pickKey, gain, exchange, gradeAllMax, maxedGrades,
    isOpen, start, levelUp, levelAll, useTicket, pullGain };
})(globalThis.Game = globalThis.Game || {});
