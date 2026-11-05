// 게임 엔진: 전투·성장·이직 규칙. 화면(DOM)을 전혀 모름 → 테스트·서버 검증에 그대로 재사용 가능.
// 일어난 일은 emit(이벤트이름, 데이터)로 알리고, 화면은 그걸 받아서 그림.
// 명세: docs/impl-spec-m1.md(장비), docs/impl-spec-m2.md(M2 규칙)
(function (G) {
  'use strict';
  const { F, UPGRADES, PERKS, perkCost, SKILLS, ENEMIES, BOSSES, COMPANY_GRADES } = G.Data;
  const I = G.Items;
  const Eq = G.Equipment;
  const C = G.Career;
  const M = G.Meta;

  // 엔진 쪽 경제 수치 (items.js에 없는 것만)
  const ECON = {
    corpToBonus: 1, // 법카 1 = 성과급 1
    mentalCap: 0.9, // 멘탈(후퇴 방지) 최종 상한
    shopBagCurrencies: ['bonus', 'corp'],
  };
  // 해금 알림 (최고 층 기준)
  const UNLOCKS = [
    { key: 'mission', at: M.MIS.unlock, name: '미션' },
    { key: 'mental', at: UPGRADES.mental.unlock, name: '멘탈 강화' },
    { key: 'sleep', at: UPGRADES.sleep.unlock, name: '꿀잠 강화' },
    { key: 'tower', at: M.TOWER.unlock, name: '야근 타워', lifetime: true },
    { key: 'dept', at: 30, name: '부서 장악 (사내 탭)' },
    { key: 'skills', at: G.Skills.CFG.unlock, name: '업무 스킬 (스킬 탭)' },
    { key: 'pet', at: G.Pets.CFG.unlock, name: '책상 반려 (장비 탭)' },
  ];

  function createEngine(opts) {
    const rng = opts.rng || Math.random;
    const now = opts.now || Date.now;
    const emit = opts.emit || (() => {});

    const E = {
      S: opts.state, // 저장되는 진행 상황
      enemy: null,
      hp: 0,
      bossTimer: 0,
      attackTimer: 0,
      enemyHitT: 0,
      restTimer: 0,
      restTotal: 0,
      spawnDelay: 0,
      mode: 'main', // 'main' | 'tower' | 'conquest' | 'meeting' | 'dungeon'
      side: null, // 장악전·외부 미팅·특근 진행 {kind, floor, waves, wave, left, timer, boss, dept, args}
      tower: null, // 타워 도전 중 {floor, timer}
      active: Object.fromEntries(Object.keys(SKILLS).map((k) => [k, 0])), // 켜져 있는 스킬의 남은 시간
    };

    const clearActive = () => { for (const k in E.active) E.active[k] = 0; };
    const ok = (extra) => ({ ok: true, ...extra });
    const no = (reason) => ({ ok: false, reason });
    const track = (ev, n = 1) => M.misTrack(E.S.mis, now(), ev, n);
    // 업적용 누적 기록. max=true면 최댓값만 남김
    function stat(name, v = 1, max = false) {
      const st = E.S.stats;
      const before = st[name] || 0;
      st[name] = max ? Math.max(before, v) : before + v;
      if (st[name] !== before) checkAch(name);
    }
    function checkAch(name) {
      for (const a of G.Rewards.ACH) {
        if (a.stat !== name || E.S.ach[a.id] || E.S.achReady[a.id]) continue;
        if ((E.S.stats[name] || 0) >= a.need) { E.S.achReady[a.id] = true; emit('achievement', { id: a.id, name: a.name, bonus: a.bonus }); }
      }
    }
    E.stat = stat;

    // ----- 회사·유효 층 -----
    E.company = () => (E.S.company && E.S.company.id !== null ? C.company(E.S.company.id) : null);
    E.companyGrade = () => (E.S.company ? E.S.company.grade | 0 : 0);
    E.companyName = () => { const c = E.company(); return c ? c.name : COMPANY_GRADES[E.companyGrade()].name; };
    E.offset = () => COMPANY_GRADES[E.companyGrade()].offset;
    E.eff = (s = E.S.stage) => s + E.offset();
    E.effRunMax = () => E.eff(E.S.runMax);
    let traitCache = null;
    let traitFor = null;
    E.traits = function () {
      const key = E.S.company ? E.S.company.id : null;
      if (!traitCache || traitFor !== key) { traitCache = C.traitMods(E.company()); traitFor = key; }
      return traitCache;
    };
    const T = (k) => E.traits()[k];

    // ----- 장비 보너스 (캐시) -----
    let bonusCache = null;
    let bonusFor = null; // 캐시를 만든 세이브 (reset으로 바뀌면 다시 계산)
    E.equippedItems = function () {
      const out = {};
      for (const slot of I.SLOT_KEYS) {
        const id = E.S.equipped[slot];
        out[slot] = id === null || id === undefined ? null : E.item(id);
      }
      return out;
    };
    // 도감 + 인맥 + 반려 (장비 %와 같은 칸, 상한 규칙 그대로 — 명세 m4 19·27절). 반려 'rest'(휴식 감소)는 restTime이 따로 씀
    E.extraBonuses = function () {
      const out = Eq.codexBonus(E.S.codex);
      const add = (b) => { for (const k of Object.keys(b)) if (I.STATS[k]) out[k] = { pct: ((out[k] && out[k].pct) || 0) + b[k], flat: (out[k] && out[k].flat) || 0 }; };
      add(G.Net.bonus(E.S.net, E.S.dept.conquered));
      add(E.petBonus());
      return out;
    };
    E.petBonus = () => G.Pets.bonus(E.S.pet, E.S.pet.out, E.S.maxStage);
    E.petRestCut = () => Math.min(0.9, (E.petBonus().rest || 0) / 100);
    E.bonuses = function () {
      if (!bonusCache || bonusFor !== E.S) {
        bonusCache = Eq.computeBonuses(E.equippedItems(), E.extraBonuses());
        bonusFor = E.S;
      }
      return bonusCache;
    };
    E.invalidateBonuses = () => { bonusCache = null; };
    const pct = (stat) => E.bonuses().capped[stat].pct / 100;
    const flat = (stat) => E.bonuses().capped[stat].flat;
    const capOf = (stat) => I.CAPS[stat].max / 100;
    // 야근 타워 영구 버프 (%) → 비율
    E.towerBuffs = () => M.towerBuffs(E.S.tower.best);
    const tb = (stat) => (E.towerBuffs()[stat] || 0) / 100;

    // ----- 스탯 -----
    E.rankLevel = () => F.rankLevel(E.S.runMax);
    E.rankName = () => F.rankName(E.rankLevel());
    E.promoMult = () => Math.pow(F.PROMO_MULT, E.rankLevel());
    // 스킬 없이 (방치 보상·전투력 계산용)
    // 뽑기 레벨 보너스: 장비·장신구 뽑기 레벨마다 최종 업무력 +% (서로 곱함)
    E.gachaAtkMult = () => ['equip', 'acc'].reduce((m, k) => m * (1 + G.Gacha.CONFIG.LEVEL_ATK[G.Gacha.levelFor(E.S.gacha[k].count)] / 100), 1);
    const atkBase = () => UPGRADES.atk.value(E.S.lv.atk) * PERKS.dmg.value(E.S.perk.dmg) * E.promoMult() * T('atk') * E.gachaAtkMult();
    // 업무 스킬 보유 효과도 업무력 %에 더함
    const withAtk = (base) => base * (1 + pct('atk') + tb('atk') + G.Skills.holdAtkPct(E.S.skills) / 100) + flat('atk');
    const withAps = (base) => base * (1 + pct('aspd')) * T('aspd');
    E.atkNoSkill = () => withAtk(atkBase());
    // 야근 모드: 장비 깡수치까지 포함한 최종 공격력의 3배
    E.atk = () => E.atkNoSkill() * (E.active.night > 0 ? 3 : 1);
    E.maxHp = () => UPGRADES.hp.value(E.S.lv.hp) * PERKS.hp.value(E.S.perk.hp) * E.promoMult() * T('hp') *
      (1 + pct('hp') + tb('hp')) + flat('hp');
    E.apsNoSkill = () => withAps(UPGRADES.spd.value(E.S.lv.spd));
    E.aps = () => E.apsNoSkill() * (E.active.coffee > 0 ? 2 : 1);
    E.critChance = () => Math.min(capOf('critRate'), UPGRADES.crit.value(E.S.lv.crit) + pct('critRate') + T('critRate'));
    E.critMult = () => F.CRIT_MULT + pct('critDmg') + tb('critDmg') + T('critDmg');
    E.hpRegen = () => F.HP_REGEN * (1 + pct('regen') + tb('regen')) * T('regen');
    E.bossDmgMult = () => (1 + pct('boss') + tb('boss')) * T('bossDmg');
    E.goldMult = () => PERKS.gold.value(E.S.perk.gold) * (1 + pct('gold') + tb('gold')) * T('gold');
    E.goldFlat = () => flat('gold');
    E.goldPerKill = (f, boss) => F.goldPerKill(f, boss) * E.goldMult() + E.goldFlat();
    E.offlineMult = () => (1 + pct('offline') + tb('offline')) * T('offline');
    E.cdrRate = () => Math.min(capOf('cdr'), pct('cdr'));
    E.skillCd = (k) => SKILLS[k].cd * (1 - E.cdrRate()) * T('skillCd');
    E.skillDur = (k) => SKILLS[k].dur * T(k === 'coffee' ? 'coffeeDur' : 'nightDur');
    E.mentalChance = () => Math.min(ECON.mentalCap, UPGRADES.mental.value(E.S.lv.mental) + T('mental'));
    E.sleepCut = () => UPGRADES.sleep.value(E.S.lv.sleep);
    E.isResting = () => E.restTimer > 0;
    E.skillLocked = (k) => E.S.runMax < SKILLS[k].unlock;
    E.upgradeLocked = (k) => UPGRADES[k].unlock !== undefined && E.S.maxStage < UPGRADES[k].unlock;
    // 1초당 기대 데미지 (스킬 제외, 치명타 기대값 포함)
    E.dps = () => E.atkNoSkill() * E.apsNoSkill() * (1 + E.critChance() * (E.critMult() - 1));
    E.power = () => C.power({ dps: E.dps(), maxHp: E.maxHp(), mental: E.mentalChance(), sleep: E.sleepCut() });
    // 적 수치 (유효 층·회사 특성 반영)
    E.enemyHpAt = (f, boss) => F.enemyHp(f, boss) * T('enemyHp') * (boss ? T('bossHp') : 1);
    E.enemyDpsAt = (f, boss) => F.enemyDps(f, boss) * T('enemyAtk');
    E.bossTime = () => F.BOSS_TIME * T('bossTime');
    // 번아웃 휴식(초) = max(2, (2 + 6/(1 + R/2)) × (1 − 0.5×멘탈) × (1 − 꿀잠) × 회사)
    E.restTime = function (f = E.eff(), boss = F.isBoss(E.S.stage)) {
      const R = E.maxHp() / (E.enemyDpsAt(f, boss) * 10);
      const t = (F.REST_BASE + F.REST_SPAN / (1 + R / 2)) * (1 - F.REST_MENTAL * E.mentalChance()) * (1 - E.sleepCut()) * (1 - E.petRestCut()) * T('rest');
      return Math.max(F.REST_MIN, t);
    };

    // 스탯 창 (장비 탭 [스탯])
    E.statSheet = function () {
      return [
        ['전투력', E.power()], ['업무력', E.atkNoSkill()], ['체력', E.maxHp()], ['타자 속도', E.apsNoSkill()],
        ['치명타 확률', E.critChance()], ['치명타 데미지', E.critMult()], ['체력 회복(초당)', E.hpRegen()],
        ['보스 데미지', E.bossDmgMult()], ['재산 획득', E.goldMult()], ['방치 보상', E.offlineMult()],
        ['스킬 쿨타임 감소', E.cdrRate()], ['멘탈(후퇴 방지)', E.mentalChance()], ['꿀잠(휴식 감소)', E.sleepCut()],
        ['직급 보너스', E.promoMult()],
      ].map(([name, value]) => ({ name, value }));
    };

    // 스탯 설명 창: 무엇인지 + 어떻게 계산되는지 (k: 'x' 곱하기 · '+' 더하기 · '%' 퍼센트 더하기 · '=' 결과)
    E.statInfo = function (name) {
      const P = (v) => ['%', v * 100];
      const atkPct = pct('atk') + tb('atk') + G.Skills.holdAtkPct(E.S.skills) / 100;
      const hpPct = pct('hp') + tb('hp');
      const INFO = {
        '전투력': { desc: '이직 합격 확률과 회사 요구 전투력을 비교할 때 쓰는 종합 점수예요.',
          formula: '(10 × 초당 기대 데미지 + 2 × 체력) × (1 + 0.5 × 멘탈 + 0.2 × 꿀잠)',
          parts: [['초당 기대 데미지', 'n', E.dps()], ['체력', 'n', E.maxHp()], ['멘탈', ...P(E.mentalChance())], ['꿀잠', ...P(E.sleepCut())]] },
        '업무력': { desc: '한 번 칠 때 적에게 주는 기본 데미지예요. (공격력)',
          formula: '근로 강화 × 학벌 × 직급 보너스 × 사풍 × 뽑기 레벨 × (1 + 장비·인맥·반려·도감·타워·스킬 보유 %) + 장비 깡수치',
          parts: [['근로 강화 (Lv.' + E.S.lv.atk + ')', 'n', UPGRADES.atk.value(E.S.lv.atk)], ['학벌 특전', 'x', PERKS.dmg.value(E.S.perk.dmg)], ['직급 보너스', 'x', E.promoMult()],
            ['사풍', 'x', T('atk')], ['뽑기 레벨', 'x', E.gachaAtkMult()], ['장비·인맥·반려·도감', '%', pct('atk') * 100], ['야근 타워', '%', tb('atk') * 100],
            ['업무 스킬 보유', '%', G.Skills.holdAtkPct(E.S.skills)], ['장비 깡수치', '+', flat('atk')]], total: E.atkNoSkill(), extra: atkPct },
        '체력': { desc: '적에게 맞으면 줄어들고, 0이 되면 번아웃(휴식)이에요.',
          formula: '근로 강화 × 강철 체력 × 직급 보너스 × 사풍 × (1 + 장비·인맥·반려·도감·타워 %) + 장비 깡수치',
          parts: [['근로 강화 (Lv.' + E.S.lv.hp + ')', 'n', UPGRADES.hp.value(E.S.lv.hp)], ['강철 체력 특전', 'x', PERKS.hp.value(E.S.perk.hp)], ['직급 보너스', 'x', E.promoMult()],
            ['사풍', 'x', T('hp')], ['장비·인맥·반려·도감', '%', pct('hp') * 100], ['야근 타워', '%', tb('hp') * 100], ['장비 깡수치', '+', flat('hp')]], total: E.maxHp(), extra: hpPct },
        '타자 속도': { desc: '1초에 몇 번 치는지예요. 높을수록 빨리 처리해요.', formula: '근로 강화 × (1 + 장비 %) × 사풍',
          parts: [['근로 강화 (Lv.' + E.S.lv.spd + ')', 'n', UPGRADES.spd.value(E.S.lv.spd)], ['장비', '%', pct('aspd') * 100], ['사풍', 'x', T('aspd')]], total: E.apsNoSkill() },
        '치명타 확률': { desc: '한 번 칠 때 치명타가 터질 확률이에요.', formula: `눈치 강화 + 장비 % + 사풍 (최대 ${Math.round(capOf('critRate') * 100)}%)`,
          parts: [['눈치 강화 (Lv.' + E.S.lv.crit + ')', ...P(UPGRADES.crit.value(E.S.lv.crit))], ['장비·인맥·반려', ...P(pct('critRate'))], ['사풍', ...P(T('critRate'))]], total: E.critChance(), totalPct: true },
        '치명타 데미지': { desc: '치명타가 터지면 데미지가 몇 배가 되는지예요.', formula: `기본 ${F.CRIT_MULT}배 + 장비 + 야근 타워 + 사풍`,
          parts: [['기본', 'n', F.CRIT_MULT], ['장비·인맥·반려', 'n', pct('critDmg')], ['야근 타워', 'n', tb('critDmg')], ['사풍', 'n', T('critDmg')]], total: E.critMult(), totalMul: true },
        '체력 회복(초당)': { desc: '1초마다 최대 체력의 몇 %를 회복하는지예요.', formula: `기본 ${F.HP_REGEN * 100}% × (1 + 장비 + 타워 %) × 사풍`,
          parts: [['기본', ...P(F.HP_REGEN)], ['장비·인맥·반려', ...P(pct('regen'))], ['야근 타워', ...P(tb('regen'))], ['사풍', 'x', T('regen')]], total: E.hpRegen(), totalPct: true },
        '보스 데미지': { desc: '보스에게 주는 데미지 배율이에요.', formula: '(1 + 장비 + 타워 %) × 사풍',
          parts: [['장비·인맥·반려', ...P(pct('boss'))], ['야근 타워', ...P(tb('boss'))], ['사풍', 'x', T('bossDmg')]], total: E.bossDmgMult(), totalMul: true },
        '재산 획득': { desc: '적을 처치할 때 받는 재산(원) 배율이에요.', formula: '연봉협상 × (1 + 장비 + 타워 %) × 사풍',
          parts: [['연봉협상 특전', 'x', PERKS.gold.value(E.S.perk.gold)], ['장비·인맥·반려', ...P(pct('gold'))], ['야근 타워', ...P(tb('gold'))], ['사풍', 'x', T('gold')]], total: E.goldMult(), totalMul: true },
        '방치 보상': { desc: '앱을 꺼 둔 동안 받는 퇴근 후 정산 배율이에요.', formula: '(1 + 장비 + 타워 %) × 사풍',
          parts: [['장비·인맥·반려', ...P(pct('offline'))], ['야근 타워', ...P(tb('offline'))], ['사풍', 'x', T('offline')]], total: E.offlineMult(), totalMul: true },
        '스킬 쿨타임 감소': { desc: '아아·야근·업무 스킬의 대기 시간이 줄어드는 비율이에요.', formula: `장비 % (최대 ${Math.round(capOf('cdr') * 100)}%)`,
          parts: [['장비·인맥·반려', ...P(pct('cdr'))]], total: E.cdrRate(), totalPct: true },
        '멘탈(후퇴 방지)': { desc: '번아웃이 나도 층이 안 내려갈 확률이에요.', formula: '멘탈 강화 + 사풍',
          parts: [['멘탈 강화 (Lv.' + E.S.lv.mental + ')', ...P(UPGRADES.mental.value(E.S.lv.mental))], ['사풍', ...P(T('mental'))]], total: E.mentalChance(), totalPct: true },
        '꿀잠(휴식 감소)': { desc: '번아웃 휴식 시간이 줄어드는 비율이에요.', formula: '꿀잠 강화',
          parts: [['꿀잠 강화 (Lv.' + E.S.lv.sleep + ')', ...P(UPGRADES.sleep.value(E.S.lv.sleep))]], total: E.sleepCut(), totalPct: true },
        '직급 보너스': { desc: '승진(10층마다 직급 한 단계)할 때마다 업무력·체력이 오르는 배율이에요.', formula: `${F.PROMO_MULT} ^ 직급 단계`,
          parts: [['직급 단계 (' + E.rankName() + ')', 'n', E.rankLevel()]], total: E.promoMult(), totalMul: true },
      };
      return INFO[name] || null;
    };

    // ----- 해금 알림 -----
    function checkUnlocks() {
      for (const u of UNLOCKS) {
        if (E.S.unlocked[u.key]) continue;
        if (E.S.maxStage >= u.at) { E.S.unlocked[u.key] = true; emit('unlock', { key: u.key, name: u.name }); }
      }
      ensureStarter();
      ensurePetStarter();
      checkNetUnlock();
    }
    // 인맥은 층이 아니라 부서 장악 수로 열림 (첫 장악 2명 · 3곳 · 5곳, 명세 m4 18절)
    function checkNetUnlock() {
      const c = E.S.dept.conquered;
      for (const p of G.Net.PEOPLE) {
        const key = p.need === 1 ? 'net' : 'net_' + p.id; // 첫 장악 두 명은 'net' 하나로 알림
        if (E.S.unlocked[key] || c < p.need) continue;
        E.S.unlocked[key] = true;
        emit('unlock', { key, name: p.need === 1 ? '인맥 (사내 탭)' : `인맥 · ${p.name}` });
      }
    }
    E.isUnlocked = (key) => { const u = UNLOCKS.find((x) => x.key === key); return !u || E.S.maxStage >= u.at; };

    // ----- 적 -----
    // 일반 적은 미리 줄을 세워 둠 (화면에서 지금 적 뒤에 다음 2마리가 보임)
    E.line = [];
    function nextInLine() {
      while (E.line.length < 3) E.line.push(ENEMIES[Math.floor(rng() * ENEMIES.length)]);
      const e = E.line.shift();
      E.line.push(ENEMIES[Math.floor(rng() * ENEMIES.length)]);
      return e;
    }
    // 화면용: 다음에 나올 일반 적 (보스·타워·부서 전투 중이면 없음)
    E.upcoming = () => (E.mode === "tower" || E.side || (E.enemy && E.enemy.boss) ? [] : E.line.slice(0, 2));
    function spawn() {
      E.enemyHitT = 0;
      if (E.mode === 'tower') return spawnTower();
      if (E.side) return spawnSide();
      const s = E.S.stage;
      const boss = F.isBoss(s);
      const list = boss ? BOSSES : ENEMIES;
      const [key, name] = boss ? list[(s / 10 - 1) % list.length] : nextInLine();
      const f = E.eff(s);
      const hp = E.enemyHpAt(f, boss);
      E.enemy = { key, name, hp, maxHp: hp, boss, dps: E.enemyDpsAt(f, boss) };
      E.bossTimer = boss ? E.bossTime() : 0;
      E.spawnDelay = 0;
      emit('spawn', E.enemy);
    }

    // ----- 전투 -----
    function hit(source) {
      if (!E.enemy) return;
      const crit = rng() < E.critChance();
      const dmg = E.atk() * (crit ? E.critMult() : 1) * (E.enemy.boss ? E.bossDmgMult() : 1);
      applyDamage(dmg, crit, source);
    }
    function applyDamage(dmg, crit, source, skill) {
      E.enemy.hp -= dmg;
      emit('hit', { dmg, crit, source, skill });
      if (E.enemy.hp <= 0) (E.mode === 'tower' ? onTowerKill : E.side ? onSideKill : onKill)();
    }

    // ----- 업무 스킬 (명세 ③): 칸 순서대로 자동 사용 -----
    const SK = G.Skills;
    E.fx = { stun: 0, guard: 0, guardCut: 0, invuln: 0, dots: [] }; // 스킬 효과 남은 시간
    E.skillGapT = 0;
    E.workSkillCd = (key) => SK.BY_KEY[key].cd * (1 - E.cdrRate()) * T('skillCd');
    E.skillHoldPct = () => SK.holdAtkPct(E.S.skills); // 보유 효과 (업무력 %)
    // 지금 층 드롭 배율 (화면 "드롭 n%"): 이번 회차 최고 유효 층보다 많이 낮으면 줄어듦
    E.dropRateAt = (s = E.S.stage) => G.Drops.lowFloorMult(E.eff(s), E.effRunMax());
    // 이번 회차 최고 유효 층 일반 처치 보상 (재산 보너스 포함) = 숙련·결재 도장 상점 공통 기준
    E.runKillGold = () => E.goldPerKill(Math.max(1, E.effRunMax()), false);
    E.skillCostBase = () => E.runKillGold();
    E.skillCost = (key, lv) => SK.levelCost(key, lv, E.skillCostBase());
    // 보유·레벨·카드·교환권은 규칙 skills.js (서버도 같은 코드). 서버 모드면 sync.js가 서버로 보내고, 응답의 복사본을 씀
    // 장착 칸·쿨타임만 폰이 정함 (서버에 없는 스킬을 칸에 넣어도 정리 때 빠짐)
    E.serverSkills = false; // sync.js가 서버 모드에서 켬 → 첫 지급도 서버가
    const skillDone = (r) => {
      if (r && r.ok) { E.invalidateBonuses(); emit('save'); }
      return r;
    };
    // 처음 열릴 때 "메일 회신" 1장 + 칸이 비어 있으면 1번 칸에
    E.skillStart = () => E.skillStarted(SK.start(E.S, H));
    E.skillStarted = function (r) {
      const sk = E.S.skills;
      if (r && r.ok && sk.owned[r.key] && sk.slots.every((k) => !k)) sk.slots[0] = r.key;
      return skillDone(r);
    };
    function ensureStarter() {
      if (E.serverSkills || E.S.skills.granted || !SK.isOpen(E.S.maxStage)) return;
      E.skillStart();
    }
    E.ensureStarter = ensureStarter;
    // 서버 기록(보유·레벨·카드·교환권·첫 지급) 반영 → 칸·쿨타임은 폰 값, 서버에 없는 스킬은 칸에서 빠짐
    E.setSkills = function (v) {
      if (!v || typeof v !== 'object') return;
      const sk = E.S.skills;
      E.S.skills = SK.clean({ owned: v.owned, tickets: v.tickets, granted: v.granted === true, slots: sk.slots, cd: sk.cd }, E.S.maxStage);
      E.S.skills.granted = v.granted === true; // 서버 값 그대로 (예전 세이브 보정은 안 씀)
      E.invalidateBonuses();
    };
    function skillBase(boss, bonusPct) {
      return E.atk() * (boss ? E.bossDmgMult() * (1 + (bonusPct || 0) / 100) : 1);
    }
    function castWorkSkill(key) {
      const def = SK.BY_KEY[key];
      const lv = E.S.skills.owned[key].lv;
      const m = SK.lvMult(lv);
      const e = def.e;
      emit('workSkill', { key, name: def.name, grade: def.grade });
      stat('wskill');
      const boss = E.enemy.boss;
      if (e.execute && E.mode === 'main' && !E.side && !boss) executeStage(key);
      else if (e.hit) {
        for (let i = 0; i < e.hit.n && E.enemy; i++) {
          const crit = rng() < Math.min(1, E.critChance() + (e.crit || 0) / 100);
          applyDamage(skillBase(E.enemy.boss, e.boss) * e.hit.pct / 100 * m * (crit ? E.critMult() : 1), crit, 'skill', key);
        }
      }
      if (e.heal) E.hp = Math.min(E.maxHp(), E.hp + E.maxHp() * e.heal / 100);
      if (e.stun) E.fx.stun = Math.max(E.fx.stun, e.stun);
      if (e.guard) { E.fx.guard = Math.max(E.fx.guard, e.guard.sec); E.fx.guardCut = e.guard.cut; }
      if (e.invuln) E.fx.invuln = Math.max(E.fx.invuln, e.invuln);
      if (e.gold && E.mode === 'main' && !E.side) {
        const g = E.goldPerKill(E.eff(), false) * e.gold;
        E.S.gold += g;
        if (E.goldSink) E.goldSink(E.eff(), e.gold, g); // 서버 모드: 묶음에 실어 보냄 (서버가 쿨타임 상한으로 확인)
      }
      if (e.dot) E.fx.dots.push({ left: e.dot.sec, t: 0, pct: e.dot.pct * m, key });
      if (e.refresh) for (const k in E.S.cd) E.S.cd[k] = 0;
    }
    // 칼퇴 선언: 이 층 남은 일반 업무를 모두 처리 (처치 보상 그대로)
    function executeStage(key) {
      const stage = E.S.stage;
      for (let guard = 0; guard < 50 && E.enemy && !E.enemy.boss; guard++) {
        applyDamage(Math.max(E.enemy.hp, 1), false, 'skill', key);
        if (E.S.stage !== stage || E.S.kill === 0 || E.mode !== 'main' || E.side) break;
        spawn();
      }
    }
    // 쿨타임·효과 시간은 적이 없어도 흐름
    function tickSkillTimers(dt) {
      const sk = E.S.skills;
      for (const k in sk.cd) { sk.cd[k] -= dt; if (sk.cd[k] <= 0) delete sk.cd[k]; }
      for (const k of ['stun', 'guard', 'invuln']) E.fx[k] = Math.max(0, E.fx[k] - dt);
    }
    function tickWorkSkills(dt) {
      const sk = E.S.skills;
      if (!E.enemy || E.restTimer > 0) return;
      // 재택근무 같은 지속 피해: 1초마다
      for (const d of E.fx.dots) {
        d.t += dt;
        while (d.t >= 1 && d.left > 0 && E.enemy) { d.t -= 1; d.left--; applyDamage(skillBase(E.enemy.boss) * d.pct / 100, false, 'skill', d.key); }
      }
      E.fx.dots = E.fx.dots.filter((d) => d.left > 0);
      E.skillGapT -= dt;
      if (E.skillGapT > 0 || !E.enemy) return;
      for (const key of sk.slots) {
        if (!key || !sk.owned[key] || sk.cd[key] > 0) continue;
        sk.cd[key] = E.workSkillCd(key);
        E.skillGapT = SK.CFG.castGap;
        castWorkSkill(key);
        break;
      }
    }
    // 화면용: 스킬 목록 (보유·레벨·카드·다음 숙련 비용·장착 칸)
    E.skillInfo = function () {
      const sk = E.S.skills;
      const slots = sk.slots.map((key, i) => ({ i, key, open: SK.slotOpen(i, E.S.maxStage), at: SK.CFG.slotFloors[i], cd: key ? sk.cd[key] || 0 : 0 }));
      const list = SK.LIST.map((d) => {
        const o = sk.owned[d.key];
        const cost = o && o.lv < SK.CFG.maxLv ? E.skillCost(d.key, o.lv) : null;
        return { ...d, owned: !!o, lv: o ? o.lv : 0, cards: o ? o.cards : 0, cost, canLevel: !!cost && o.cards >= cost.cards && E.S.gold >= cost.gold,
          slot: sk.slots.indexOf(d.key), mult: o ? SK.lvMult(o.lv) : 1 };
      });
      return { unlocked: E.S.maxStage >= SK.CFG.unlock, slots, list, holdPct: E.skillHoldPct(), tickets: sk.tickets.slice(), maxedGrades: SK.maxedGrades(sk) };
    };
    E.skillEquip = function (key, i) {
      const sk = E.S.skills;
      if (!sk.owned[key]) return no('없는 스킬이에요');
      if (!SK.slotOpen(i, E.S.maxStage)) return no(`최고 ${SK.CFG.slotFloors[i]}층부터 열려요`);
      const was = sk.slots.indexOf(key);
      if (was >= 0) sk.slots[was] = sk.slots[i]; // 이미 다른 칸에 있으면 자리 바꾸기
      sk.slots[i] = key;
      emit('save');
      return ok({});
    };
    E.skillUnequip = function (i) {
      if (!E.S.skills.slots[i]) return no('빈 칸이에요');
      E.S.skills.slots[i] = null;
      emit('save');
      return ok({});
    };
    E.skillLevelUp = (key) => skillDone(SK.levelUp(E.S, H, key, E.skillCostBase()));
    // 교환권(같은 등급 조각 3개) → 원하는 스킬 카드 1장
    E.skillExchange = (key) => skillDone(SK.useTicket(E.S, H, key));
    // 일괄 숙련: 가능한 것 모두 (재산이 모자라면 거기서 멈춤)
    E.skillLevelUpAll = () => skillDone(SK.levelAll(E.S, H, E.skillCostBase()));

    function onKill() {
      const f = E.eff();
      const wasBoss = E.enemy.boss;
      const gold = E.goldPerKill(f, wasBoss);
      E.S.gold += gold;
      E.S.lastKillStage = E.S.stage;
      const ekey = E.enemy.key;
      E.enemy = null;
      E.spawnDelay = F.SPAWN_DELAY;
      emit('kill', { gold, boss: wasBoss });
      track('kill');
      if (wasBoss) {
        track('boss');
        stat('boss_' + ekey);
        // 신기록 보스: 평생 처음 잡은 (유효) 보스 층 → 성과급 층×2
        if (f > E.S.rew.bossRec) {
          E.S.rew.bossRec = f;
          const b = G.Rewards.bossBonus(f);
          E.S.bonus += b;
          emit('bossRecord', { floor: f, bonus: b });
        }
      } else { stat('kill'); stat('kill_' + ekey); }
      // 드롭 (유효 층 기준). 회사 드롭 배율: 1보다 크면 그만큼 한 번 더 굴릴 확률
      // 서버 모드면 서버에 보고 (서버가 드롭·도장·조각과 낮은 층 감소 기준 층을 정함), 아니면 기기에서 굴림
      if (E.dropSink) E.dropSink(f, wasBoss, gold, ekey); // ekey: 적 종류 (업적 "엑셀 지옥 100회" 등, 서버는 인정한 처치 수 안에서만 셈)
      else Inv.kill(E.S, H, f, wasBoss, T('drop'), E.effRunMax());
      if (wasBoss) {
        emit('bossDefeated', { stage: E.S.stage });
        advance();
      } else {
        E.S.kill++;
        if (E.S.kill >= F.KILLS_PER_STAGE) {
          E.S.kill = 0;
          if (E.S.autoAdvance) advance();
        }
      }
    }

    function advance() {
      const oldLv = E.rankLevel();
      E.S.stage++;
      E.S.kill = 0;
      const newRun = E.S.stage > E.S.runMax;
      const wasShort = E.mode === 'main' && E.S.prestiges > 0 && E.careerShort();
      E.S.runMax = Math.max(E.S.runMax, E.S.stage);
      E.S.maxStage = Math.max(E.S.maxStage, E.eff());
      if (newRun) track('floor');
      // 수습 범위(시작 층 +10층)를 넘게 올라가면 수습 탈락 해제 → 평소처럼 경력·이직 보상·층 조건 (2026-10-27 사용자)
      if (E.S.probation.failed && E.S.runMax >= E.S.runStart + PROBATION.floors) {
        E.S.probation.failed = false;
        Object.assign(AP(), { cards: null, rejected: [], fails: 0, lockUntil: 0 }); // 버틸 수 있는 회사 카드는 수습 탈락용 → 새로 뽑음
        emit('probationClear', { floor: E.S.runMax, short: E.careerShort() });
      }
      if (wasShort && !E.careerShort()) emit('careerReady', { floor: E.S.runMax }); // 평생 최고(− CAREER_GAP) 도달 → 이제 경력 받음
      const lv = E.rankLevel();
      if (lv > oldLv) {
        E.hp = E.maxHp(); // 승진: 체력 전부 회복
        emit('promote', { rank: E.rankName(), level: lv });
      }
      checkUnlocks();
      emit('save');
    }

    function fail(reason) {
      const f = E.eff();
      const boss = E.enemy ? E.enemy.boss : F.isBoss(E.S.stage);
      // 번아웃: 멘탈 확률로 후퇴 없음. 마감 초과(보스 시간 초과)는 항상 후퇴
      const retreated = reason === 'deadline' || !(rng() < E.mentalChance());
      if (reason === 'burnout') stat('burnout');
      if (reason === 'burnout' && E.mode === 'main' && E.burnSink) E.burnSink(); // 서버 모드: 번아웃 보고 (서버가 수습 탈락을 셈)
      // 수습: 이직 직후 시작 층 +10층 안에서 번아웃이 쌓이면 수습 탈락 → 조건 없이 재지원 (갇힘 방지)
      const pb = E.S.probation;
      if (reason === 'burnout' && E.mode === 'main' && E.S.prestiges > 0 && !pb.failed && E.S.runMax < E.S.runStart + PROBATION.floors) {
        pb.burnouts++;
        if (pb.burnouts >= PROBATION.burnouts) {
          pb.failed = true;
          Object.assign(AP(), { cards: null, rejected: [], fails: 0, lockUntil: 0 });
          emit('probationFail', {});
        }
      }
      if (retreated) {
        E.S.stage = Math.max(1, E.S.stage - 1);
        E.S.autoAdvance = false;
      }
      E.S.kill = 0;
      E.enemy = null;
      E.spawnDelay = 0;
      E.restTotal = E.restTime(f, boss);
      E.restTimer = E.restTotal;
      emit('fail', { reason, retreated, rest: E.restTotal });
      emit('save');
    }

    // ----- 매 프레임 -----
    // 게임 속도 배율 (구독 혜택 등). 1 = 보통, 2 = 2배속
    E.timeScale = 1;
    E.setTimeScale = function (x) { E.timeScale = x > 0 ? x : 1; };

    E.update = function (realDt) {
      const dt = realDt * E.timeScale;
      for (const k in E.active) E.active[k] = Math.max(0, E.active[k] - dt);
      for (const k in E.S.cd) E.S.cd[k] = Math.max(0, E.S.cd[k] - dt);
      tickSkillTimers(dt);
      if (E.S.autoSkill) for (const k in SKILLS) if (E.S.cd[k] <= 0) E.useSkill(k);

      const mm = E.maxHp();
      if (E.restTimer > 0) {
        E.restTimer -= dt;
        E.hp = Math.min(mm, E.hp + mm * dt / Math.max(0.001, E.restTotal));
        if (E.restTimer <= 0) {
          E.restTimer = 0;
          E.hp = mm;
          emit('recover');
          spawn();
        }
        return;
      }
      E.hp = Math.min(mm, E.hp + mm * E.hpRegen() * dt);

      if (!E.enemy) {
        E.spawnDelay -= dt;
        if (E.spawnDelay <= 0) spawn();
        return;
      }

      // 적 공격: 일정 간격마다 그 간격만큼의 피해를 한 번에 (화면에서 때리는 것처럼 보이게, 총 피해는 같음)
      const hitGap = E.enemy.boss ? F.ENEMY_HIT_GAP_BOSS : F.ENEMY_HIT_GAP;
      E.enemyHitT += dt;
      while (E.enemyHitT >= hitGap) {
        E.enemyHitT -= hitGap;
        if (E.fx.stun > 0) continue; // 메신저 잠수: 적 공격 멈춤
        const d = E.fx.invuln > 0 ? 0 : E.enemy.dps * hitGap * (E.fx.guard > 0 ? 1 - E.fx.guardCut : 1);
        E.hp -= d;
        emit('hurt', { dmg: d });
      }
      if (E.side) {
        E.side.timer -= dt;
        if (E.hp <= 0 || E.side.timer <= 0) { E.hp = Math.max(0, E.hp); sideFail(E.hp <= 0 ? 'burnout' : 'deadline'); return; }
      } else if (E.mode === 'tower') {
        E.tower.timer -= dt;
        if (E.hp <= 0 || E.tower.timer <= 0) { E.hp = Math.max(0, E.hp); towerFail(E.hp <= 0 ? 'burnout' : 'deadline'); return; }
      } else {
        if (E.hp <= 0) { E.hp = 0; fail('burnout'); return; }
        if (E.enemy.boss) {
          E.bossTimer -= dt;
          if (E.bossTimer <= 0) { fail('deadline'); return; }
        }
      }
      tickWorkSkills(dt);
      if (!E.enemy) return;
      E.attackTimer += dt;
      const interval = 1 / E.aps();
      while (E.attackTimer >= interval && E.enemy) {
        E.attackTimer -= interval;
        hit('auto');
      }
    };

    // ----- 플레이어 조작 -----
    E.taps = 0; // 서버 모드: 처치 묶음에 실어 보냄 (서버가 초당 50번까지만 인정)
    E.tap = function () {
      if (E.enemy && E.restTimer <= 0) { E.taps++; hit('tap'); }
    };

    // 자동 진행 켜기/끄기. 꺼져 있을 때 누르면 바로 다음 층 도전.
    E.toggleAdvance = function () {
      if (E.mode !== 'main') return;
      if (E.S.autoAdvance) { E.S.autoAdvance = false; return; }
      E.S.autoAdvance = true;
      advance();
      // 번아웃 휴식 중이면 휴식이 끝날 때 새 층의 적이 나옴
      if (!E.isResting()) spawn();
    };

    E.useSkill = function (key) {
      const sk = SKILLS[key];
      if (E.skillLocked(key) || E.S.cd[key] > 0) return false;
      E.active[key] = E.skillDur(key);
      E.S.cd[key] = E.skillCd(key);
      emit('skill', { key, name: sk.name });
      track(key);
      stat('skill_' + key);
      if (E.skillSink) E.skillSink(key); // 서버 모드: 사용 수 보고 (서버가 쿨타임 상한 안에서 미션·업적에 셈)
      return true;
    };

    E.setAutoSkill = function (on) { E.S.autoSkill = !!on; };
    E.setBuyMode = function (mode) { E.S.buyMode = mode === 'max' ? 'max' : Number(mode) || 1; };

    // ----- 근로 강화 -----
    E.isMaxed = (key) => UPGRADES[key].max !== undefined && E.S.lv[key] >= UPGRADES[key].max;

    // 현재 구매 단위(x1/x10/MAX)로 몇 레벨을 얼마에 살 수 있는지
    E.buyInfo = function (key, modeArg) {
      const u = UPGRADES[key];
      const mode = modeArg === undefined ? E.S.buyMode : modeArg;
      let l = E.S.lv[key];
      let total = 0;
      let n = 0;
      const want = mode === 'max' ? Infinity : mode;
      while (n < want && (u.max === undefined || l < u.max)) {
        const c = u.cost(l);
        if (mode === 'max' && total + c > E.S.gold) break;
        total += c;
        l++;
        n++;
      }
      // MAX인데 하나도 못 사면 다음 1레벨 가격을 보여줌
      if (n === 0 && mode === 'max' && !E.isMaxed(key)) return { n: 1, total: u.cost(E.S.lv[key]) };
      return { n, total };
    };

    E.buy = function (key, mode) {
      if (!UPGRADES[key] || E.upgradeLocked(key)) return false;
      const { n, total } = E.buyInfo(key, mode);
      if (n === 0 || total > E.S.gold) return false;
      const before = E.maxHp();
      E.S.gold -= total;
      E.S.lv[key] += n;
      if (key === 'hp') E.hp += E.maxHp() - before;
      if (E.upSink) E.upSink(key, n, total); // 서버 모드: 바로 보여주고 묶음으로 서버 확정 (거절되면 서버 값으로 되돌림)
      track('upgrade', n);
      stat('lv_' + key, E.S.lv[key], true);
      return true;
    };

    E.perkCost = (key) => perkCost(E.S.perk[key]);
    E.perkMaxed = (key) => PERKS[key].max !== undefined && E.S.perk[key] >= PERKS[key].max;
    E.buyPerk = function (key) {
      if (E.perkMaxed(key)) return false;
      const c = E.perkCost(key);
      if (E.S.career < c) return false;
      E.S.career -= c;
      E.S.perk[key]++;
      emit('save');
      return true;
    };

    // ===== 이직 (지원 → 합격하면 환생) =====
    const AP = () => E.S.apply;
    const PROBATION = { floors: 10, burnouts: 5 };
    E.PROBATION = PROBATION;
    E.probationFailed = () => E.S.probation.failed === true && E.S.runMax < E.S.runStart + PROBATION.floors;
    // 짧은 이직 반복 방지 (docs/balance-check-longterm.md #1, 2026-10-29 사용자 확정 CAREER_GAP 0):
    // 이번 회차 최고 유효 층 < 평생 최고 유효 층(maxStage) − CAREER_GAP이면 경력 0. 이직 자체는 가능 (갇힘 없음)
    // 첫 회차·기록 경신 중인 회차는 maxStage = 이번 회차 최고라 항상 통과 → 따로 예외 없음
    E.careerNeed = () => Math.max(F.PRESTIGE_MIN_STAGE, (E.S.maxStage | 0) - F.CAREER_GAP); // 경력 받는 최소 유효 층
    E.careerNeedStage = () => E.careerNeed() - E.offset(); // 위를 지금 회사의 층 번호로
    E.careerShort = () => !E.probationFailed() && E.effRunMax() < E.careerNeed();
    E.careerGain = (grade = E.companyGrade()) => E.probationFailed() || E.careerShort() ? 0 : // 수습 탈락 / 평생 최고(− CAREER_GAP) 아래: 경력 없음
      Math.floor(F.careerFor(E.effRunMax()) * (1 + COMPANY_GRADES[grade].premium) * T('career'));
    // 이직 탭·지원 창 안내 (경력 0인 이유). 수습 탈락이 먼저 (수습 통과 뒤에도 평생 최고 아래면 그 안내)
    E.careerHint = () => E.probationFailed() ? null : E.careerShort()
      ? `지금 이직하면 경력 0 — 최고 ${E.careerNeedStage()}층까지 가면 경력 받아요 (${F.CAREER_GAP ? `평생 최고 유효 ${E.S.maxStage}층 − ${F.CAREER_GAP}층` : `평생 최고 유효 ${E.S.maxStage}층`})` : null;
    // 지원 가능 여부 → null(가능) 또는 이유
    E.applyBlock = function () {
      if (E.mode !== 'main') return '도전 중에는 지원할 수 없어요';
      if (E.probationFailed()) return null; // 수습 탈락: 층 조건 없이 바로 재지원
      if (E.effRunMax() < F.PRESTIGE_MIN_STAGE) return `이번 회차 ${F.PRESTIGE_MIN_STAGE}층부터 지원할 수 있어요`;
      if (E.S.runMax < E.S.runStart + F.PRESTIGE_CLIMB) return `입사한 층에서 ${F.PRESTIGE_CLIMB}층 더 올라가야 지원할 수 있어요 (${E.S.runStart + F.PRESTIGE_CLIMB}층)`;
      if (AP().lockUntil && E.effRunMax() < AP().lockUntil) return `최고 ${AP().lockUntil}층을 넘으면 다시 지원할 수 있어요`;
      return null;
    };
    E.canPrestige = () => E.applyBlock() === null;
    E.maxApplyRank = () => C.maxRankFor(E.S.prestiges, E.S.runMax);
    // 회사 카드 4장 (없으면 새로 뽑음)
    E.applyCards = function () {
      if (E.applyBlock()) return null;
      if (!AP().cards) {
        if (E.serverCareer) return null; // 정식판: 카드는 서버가 뽑음 (sync.js loadCards)
        AP().cards = C.makeCards(E.S.prestiges, E.companyGrade(), rng);
        if (E.probationFailed()) AP().cards[0] = survivableCard(AP().cards);
        AP().rejected = [];
        AP().fails = 0;
        emit('save');
      }
      const power = E.power();
      return AP().cards.map((c, i) => {
        const co = C.company(c.companyId);
        const rejected = AP().rejected.includes(c.companyId);
        const ranks = [];
        for (let r = 0; r <= E.maxApplyRank(); r++) ranks.push({ rank: r, name: F.rankName(r), chance: E.applyChance(i, r) });
        return { index: i, company: co, grade: c.grade, gradeName: COMPANY_GRADES[c.grade].name, safe: c.safe, rejected, ranks,
          required: E.requiredPower(c.grade, 0), power };
      });
    };
    // 수습 탈락 후 카드 1장: 입사 직후 전투력(인턴)으로 버틸 수 있는 가장 높은 등급 회사
    // cards = 지금 뽑힌 카드 (0번 자리를 바꿈 → 나머지 카드와 같은 회사는 피함). 회사마다 사풍이 달라서 회사별로 확인
    function survivableCard(cards) {
      const used = new Set(cards.slice(1).map((c) => c.companyId));
      let pool = [];
      for (let g = 0; g < COMPANY_GRADES.length; g++) {
        const ok = G.Companies.filter((x) => x.grade === g && !used.has(x.id) && (g === 0 || E.postPower(0, x.id, g) >= E.requiredPower(g, 0)));
        if (!ok.length) { if (g === 0) continue; break; }
        pool = ok;
      }
      if (!pool.length) return { ...cards[0], safe: true };
      const pick = pool[Math.min(pool.length - 1, Math.floor(rng() * pool.length))];
      return { companyId: pick.id, grade: pick.grade, safe: true };
    }
    // 입사해도 버티기 어려운지 (입사 직후 전투력 < 그 회사·직급 요구 전투력) → 지원 전 경고
    E.applyRisky = function (index, rank) {
      const c = AP().cards && AP().cards[index];
      return !!c && E.postPower(rank, c.companyId, c.grade) < E.requiredPower(c.grade, rank);
    };
    // 입사할 때 실제 시작 층 (직급 시작과 낙하산 중 큰 쪽 — doPrestige와 같은 규칙)
    E.startFloorFor = (rank) => Math.max(C.startFloor(rank), PERKS.start.value(E.S.perk.start));
    // 요구 전투력: 실제 시작 층 기준 (낙하산을 키우면 더 높은 층에서 시작하므로 요구도 올라감)
    E.requiredPower = (grade, rank) => C.requiredPower(grade, rank, E.startFloorFor(rank));
    // 입사 직후 전투력: 근로 강화 0레벨, 그 직급 시작 층·승진 보너스, 새 회사 사풍 (특전·장비·타워 버프는 유지)
    E.postPower = function (rank, companyId, grade) {
      const S = E.S;
      const keep = { lv: S.lv, runMax: S.runMax, stage: S.stage, company: S.company };
      S.lv = G.State.freshState().lv;
      S.runMax = E.startFloorFor(rank);
      S.stage = S.runMax;
      S.company = { id: companyId, grade };
      traitCache = null;
      const p = E.power();
      Object.assign(S, keep);
      traitCache = null;
      return p;
    };
    E.applyChance = function (index, rank) {
      const c = AP().cards && AP().cards[index];
      if (!c) return 0;
      return C.acceptChance({ playerPower: E.postPower(rank, c.companyId, c.grade), grade: c.grade, rank, curGrade: E.companyGrade(),
        prestiges: E.S.prestiges, fails: AP().fails, safe: c.safe, start: E.startFloorFor(rank) });
    };
    E.refreshCost = () => (AP().refreshes < C.CFG.refreshMax ? C.CFG.refreshCost[AP().refreshes] : null);
    // 카드 새로고침 (성과급). 서버 모드면 paid=true로 호출 (서버가 이미 차감)
    E.refreshCards = function (paid = false) {
      if (E.applyBlock()) return no(E.applyBlock());
      const cost = E.refreshCost();
      if (cost === null) return no(`새로고침은 ${C.CFG.refreshMax}번까지예요`);
      if (!paid && E.S.bonus < cost) return no('성과급이 부족해요');
      if (!paid) E.S.bonus -= cost;
      stat('bonus_spent', cost);
      AP().refreshes++;
      AP().cards = null;
      E.applyCards();
      emit('save');
      return ok({ cost });
    };
    // index번 회사에 rank 직급으로 지원
    E.applyTo = function (index, rank) {
      const block = E.applyBlock();
      if (block) return no(block);
      if (!AP().cards) E.applyCards();
      const c = AP().cards[index];
      if (!c) return no('없는 회사예요');
      if (AP().rejected.includes(c.companyId)) return no('이번 이직에서는 다시 지원할 수 없어요');
      if (!Number.isInteger(rank) || rank < 0 || rank > E.maxApplyRank()) return no('지원할 수 없는 직급이에요');
      const chance = E.applyChance(index, rank);
      const accepted = rng() < chance;
      if (!accepted) {
        AP().rejected.push(c.companyId);
        AP().fails++;
        const allOut = AP().cards.every((x) => AP().rejected.includes(x.companyId));
        if (allOut) {
          AP().lockUntil = E.effRunMax() + C.CFG.lockFloors;
          // 새로고침 횟수는 그대로 (회차마다 2번, 서버와 같음 — 2026-10-29 사용자)
          AP().cards = null; AP().rejected = []; AP().fails = 0;
        }
        emit('applyResult', { accepted, company: C.company(c.companyId), chance, allOut });
        emit('save');
        return ok({ accepted, chance, allOut });
      }
      const gain = doPrestige(c.companyId, c.grade, rank);
      emit('applyResult', { accepted, company: C.company(c.companyId), chance, gain });
      return ok({ accepted, chance, gain });
    };

    E.onNewRun = null; // sync.js: 이직 직전 재산·레벨 대기 기록 비움
    E.skillSink = null; // sync.js: 아아·야근 사용 기록 (서버 모드, 미션·업적 카운터)
    E.upSink = null; // sync.js: 근로 강화 기록 (서버 모드)
    E.goldSink = null; // sync.js: 법인카드 찬스 재산 기록 (서버 모드)
    E.burnSink = null; // sync.js: 번아웃 기록 (서버 모드, 수습)
    // srv = 정식판 서버 결과 {gain, failed, runId, start(유효 층), bonus, c(경력·특전·이직 횟수)} — 경력·이직 횟수·회차·시작 층·보상은 서버 값 (4단계)
    function doPrestige(companyId, grade, rank, srv) {
      if (E.onNewRun) E.onNewRun();
      const gain = srv ? srv.gain : E.careerGain();
      const S = E.S;
      const fresh = G.State.freshState();
      const oldGrade = E.companyGrade();
      const failed = srv ? srv.failed : E.probationFailed();
      let presBonus = 0;
      if (srv) presBonus = srv.bonus; // 경력·이직 횟수·업적 기록·지갑은 아래 setCareer·서버 지갑으로
      else {
        S.career += gain;
        // 수습 탈락 후 이직은 이직 횟수·이직 업적에 안 셈 (합격 확률·카드 등급·직급 상한 꼼수 방지, 2026-10-27 사용자)
        if (!failed) { S.prestiges++; stat('prestige'); }
        stat('career_gain', gain);
        stat('co_grade', grade, true);
        if (oldGrade === 0 && grade > 0) stat('escape_jot');
        // 이직 보상 성과급 (새 회사 등급별, 하루 3회)
        const d = M.dayNum(now());
        if (S.rew.presDay !== d) { S.rew.presDay = d; S.rew.pres = 0; }
        if (!failed && S.rew.pres < G.Rewards.REW.prestige.perDay) { S.rew.pres++; presBonus = G.Rewards.prestigeBonus(grade); S.bonus += presBonus; }
      }
      S.company = { id: companyId, grade };
      S.gold = 0;
      S.lv = fresh.lv;
      S.stage = srv ? Math.max(1, srv.start - COMPANY_GRADES[grade].offset) : Math.max(C.startFloor(rank), PERKS.start.value(S.perk.start)); // 직급 시작과 낙하산 중 큰 쪽
      S.runMax = S.stage;
      S.runStart = S.stage; // 이번 회차 시작 층 (재지원 조건)
      S.lastKillStage = S.stage;
      S.kill = 0;
      S.autoAdvance = true;
      S.cd = fresh.cd;
      S.skills.cd = {}; // 업무 스킬: 보유·레벨·칸은 유지, 쿨타임만 초기화
      S.apply = fresh.apply;
      S.probation = fresh.probation;
      S.runId = srv ? srv.runId : fresh.runId; // 새 회차 (정식판은 서버가 만든 회차 표시)
      traitCache = null;
      if (srv) E.setCareer(srv.c, true);
      S.maxStage = Math.max(S.maxStage, E.eff());
      clearActive();
      E.fx = { stun: 0, guard: 0, guardCut: 0, invuln: 0, dots: [] }; // 업무 스킬 효과(지속 피해 등)도 새 회차엔 없음
      if (E.isResting()) { E.restTimer = 0; emit('recover'); }
      E.hp = E.maxHp();
      emit('prestige', { gain, company: E.companyName(), rank: E.rankName(), bonus: presBonus, grade, probation: failed });
      emit('save');
      spawn();
      return gain;
    }

    // ----- 정식판: 이직·경력·특전은 서버 장부 (progress.js careerOp, 4단계) -----
    E.serverCareer = false; // true면 카드를 기기에서 뽑지 않음 (sync.js가 서버 카드를 받아 옴)
    // c = progress.js careerView {career, perk, pres, st, ap, pb} → 서버 값으로. 이직 업적 기록도 서버 값 (모자라면 더해서 업적 알림)
    E.setCareer = function (c, quiet) {
      if (!c || typeof c !== 'object') return;
      const S = E.S;
      const int = (v) => Number.isInteger(v) && v >= 0;
      if (typeof c.career === 'number' && isFinite(c.career) && c.career >= 0) S.career = c.career;
      if (c.perk && typeof c.perk === 'object') for (const k of Object.keys(S.perk)) if (int(c.perk[k])) S.perk[k] = c.perk[k];
      if (int(c.pres)) S.prestiges = c.pres;
      if (c.ap && typeof c.ap === 'object') S.apply = G.State.cleanApply(c.ap);
      if (c.pb && typeof c.pb === 'object') S.probation = { burnouts: int(c.pb.burnouts) ? Math.min(99, c.pb.burnouts) : 0, failed: c.pb.failed === true };
      if (c.st && typeof c.st === 'object') {
        for (const [k, max] of [['prestige', false], ['career_gain', false], ['co_grade', true], ['escape_jot', false]]) {
          const v = typeof c.st[k] === 'number' && isFinite(c.st[k]) && c.st[k] >= 0 ? c.st[k] : 0;
          const cur = S.stats[k] || 0;
          if (v > cur) stat(k, max ? v : v - cur, max); else if (v < cur) S.stats[k] = v;
        }
      }
      E.invalidateBonuses();
      traitCache = null;
      if (!quiet) emit('save');
    };
    // 서버 지원 결과(progress.js careerOp ret) → 화면. 합격이면 서버 회차로 이직, 아니면 서버 카드·불합격 기록
    E.applyServerResult = function (index, rank, r) {
      const c = AP().cards && AP().cards[index];
      if (!r || typeof r !== 'object' || !r.progress || !r.progress.run) return no('서버 오류가 났어요');
      if (!r.accepted) {
        E.setCareer(r.c);
        emit('applyResult', { accepted: false, company: c ? C.company(c.companyId) : null, chance: r.chance, allOut: r.allOut });
        return ok({ accepted: false, chance: r.chance, allOut: r.allOut });
      }
      const run = r.progress.run;
      const co = C.company(run.co);
      const grade = co ? co.grade : 0;
      const failed = E.probationFailed();
      const gain = doPrestige(co ? co.id : null, grade, rank, { gain: r.gain, failed, runId: run.id, start: run.start, bonus: r.bonus || 0, c: r.c });
      emit('applyResult', { accepted: true, company: co, chance: r.chance, gain });
      return ok({ accepted: true, chance: r.chance, gain });
    };

    // ----- 처음부터 다시 -----
    E.reset = function (fresh) {
      E.S = fresh;
      E.invalidateBonuses();
      traitCache = null;
      clearActive();
      E.mode = 'main';
      E.tower = null;
      E.side = null;
      E.restTimer = 0;
      E.attackTimer = 0;
      E.fx = { stun: 0, guard: 0, guardCut: 0, invuln: 0, dots: [] };
      ensureStarter();
      E.hp = E.maxHp();
      emit('reset');
      spawn();
    };

    // ----- 서버 진행 장부 (정식판, progress.js): 최고 층·이번 회차 최고 층·신기록 보스 층은 서버 값 -----
    // 장부가 생긴 판(epoch)이 세이브와 다르면 진행을 한 번 처음부터 (사용자 확정: 아이템·재화·스킬·반려·인맥은 서버라 그대로)
    const PROGRESS_KEYS = ['gold', 'stage', 'kill', 'maxStage', 'runMax', 'runStart', 'lv', 'perk', 'career', 'prestiges', 'company', 'apply', 'probation', 'runId', 'lastKillStage', 'autoAdvance', 'cd'];
    E.resetProgress = function (epoch) {
      const fresh = G.State.freshState(now());
      const S = E.S;
      for (const k of PROGRESS_KEYS) S[k] = fresh[k];
      S.rew.bossRec = 0;
      S.skills.cd = {};
      S.progEpoch = epoch;
      E.reset(S);
      emit('save');
    };
    // 서버 재산·근로 강화 레벨로 맞춤 (sync.js가 "서버 값 + 아직 확정 안 된 내 기록"을 계산해서 넘김). 레벨이 내려가면 true
    E.setEconomy = function (gold, lv) {
      const S = E.S;
      if (typeof gold === 'number' && isFinite(gold)) S.gold = Math.max(0, gold);
      if (!lv || typeof lv !== 'object') return false;
      let down = false;
      let changed = false;
      const before = E.maxHp();
      for (const k of Object.keys(S.lv)) {
        const v = lv[k];
        if (!Number.isInteger(v) || v < 0 || v === S.lv[k]) continue;
        if (v < S.lv[k]) down = true;
        S.lv[k] = v;
        changed = true;
      }
      if (changed) {
        E.invalidateBonuses();
        const hp = E.maxHp();
        E.hp = Math.min(hp, Math.max(0, E.hp + Math.max(0, hp - before)));
        emit('save');
      }
      return down;
    };
    // 서버가 근로 강화 기록을 거절해 되돌렸을 때 알림 (ui 토스트)
    E.emitFix = (kind) => emit('econFixed', { kind });
    // 서버 값으로 맞춤. mode 'hello' = 접속 때 그대로 맞춤, 'fix' = 서버가 처치를 거절했을 때 (폰이 앞서 있으면 서버 값으로 내림)
    // p = progress.js view {max, bossRec, run: {id, co, o, start, top, prog}} → 바뀌었으면 true
    E.applyProgress = function (p, mode = 'fix') {
      if (!p || typeof p !== 'object' || !p.run) return false;
      const S = E.S;
      const int = (v) => Number.isInteger(v) && v >= 0;
      const before = JSON.stringify([S.stage, S.runMax, S.maxStage, S.runId, S.rew.bossRec]);
      if (int(p.bossRec)) S.rew.bossRec = mode === 'hello' ? p.bossRec : Math.max(S.rew.bossRec, p.bossRec);
      const r = p.run;
      // 서버 회차가 폰과 다르면(다른 기기에서 이직·옛 세이브 등) 서버 회차를 따름 — 새 회차는 서버만 만듦 (4단계)
      let adopted = false;
      if (typeof r.id === 'string' && r.id !== S.runId && G.State.RUN_ID_RE.test(r.id)) {
        const co = C.company(r.co);
        S.runId = r.id;
        S.company = co ? { id: co.id, grade: co.grade } : { id: null, grade: 0 };
        traitCache = null;
        S.runStart = Math.max(1, r.start - E.offset());
        S.runMax = S.stage = S.lastKillStage = S.runStart;
        S.kill = 0;
        adopted = true;
      }
      if (r.id === S.runId && int(r.top)) {
        const top = Math.max(1, r.top - E.offset());
        if (mode === 'hello' || adopted) S.runMax = top; else S.runMax = Math.min(S.runMax, top);
        if (adopted) { S.stage = S.runMax; if (E.mode === 'main' && !E.side) { E.enemy = null; E.spawnDelay = 0; } }
        if (S.stage > S.runMax) {
          S.stage = S.runMax;
          S.kill = 0;
          if (E.mode === 'main' && !E.side) { E.enemy = null; E.spawnDelay = 0; }
        }
      }
      if (int(p.max)) S.maxStage = mode === 'hello' ? Math.max(1, p.max) : Math.max(1, Math.min(S.maxStage, Math.max(p.max, E.eff(S.runMax))));
      const changed = JSON.stringify([S.stage, S.runMax, S.maxStage, S.runId, S.rew.bossRec]) !== before;
      if (changed) { E.invalidateBonuses(); traitCache = null; emit('save'); if (mode === 'fix') emit('progressFixed', { stage: S.stage }); }
      return changed;
    };
    // 서버 도감(서버가 만든 아이템 키) = 능력치의 도감 보너스 (서버도 같은 값으로 계산)
    E.setCodex = function (keys) {
      if (!Array.isArray(keys)) return;
      E.S.codex = {};
      for (const k of keys) if (typeof k === 'string' && /^[a-z0-9]+:\d+$/.test(k)) E.S.codex[k] = true;
      for (const it of E.S.items) E.S.codex[Eq.codexKey(it)] = true;
      E.invalidateBonuses();
    };

    // ----- 방치 보상 (퇴근 후 정산) -----
    // 마지막 저장 시각부터 지금까지 번 돈을 지급. 1분 미만이면 없음.
    // 기준 층 = 마지막으로 처치에 성공한 층. 게임 속도 배율(구독 2배속)·스킬은 적용하지 않음.
    // o.elapsedSec: 서버 시계로 잰 경과 시간 (있으면 기기 시계 대신 사용 → 시계 조작 방지)
    // o.extraMaxSec: 상한 추가 (구독 +4시간)
    // o.serverDrops: 장비·결재 도장은 서버가 정함 (기기는 재산만). 돌려주는 f = 기준 유효 층
    // 방치 기준 층 = 마지막으로 처치에 성공한 층 (보스 층이면 한 층 아래)
    function offlineFloor() {
      let s = Math.max(1, Math.min(E.S.stage, E.S.lastKillStage || E.S.stage));
      if (F.isBoss(s)) s = Math.max(1, s - 1);
      return E.eff(s);
    }
    function offlineGoldPerSec(f) {
      const killTime = Math.max(0.3, E.enemyHpAt(f, false) / (E.atkNoSkill() * E.apsNoSkill())) + F.SPAWN_DELAY;
      return E.goldPerKill(f, false) * F.OFFLINE_RATE * E.offlineMult() / killTime;
    }
    E.offlineGoldPerSec = offlineGoldPerSec; // 서버 진행 장부(progress.js)가 같은 식으로 재산 추정
    // 부서 생산·재산 특근 재산: r.goldHours = 지금 회차 방치 몇 시간치
    E.deptGold = (r) => (r && r.goldHours ? r.goldHours * 3600 * offlineGoldPerSec(offlineFloor()) : 0);
    E.claimOffline = function (o = {}) {
      const local = (now() - E.S.lastSave) / 1000;
      const elapsed = typeof o.elapsedSec === 'number' && isFinite(o.elapsedSec) ? o.elapsedSec : local;
      const extra = typeof o.extraMaxSec === 'number' && o.extraMaxSec > 0 ? o.extraMaxSec : 0;
      const sec = Math.min(F.OFFLINE_MAX_SEC + extra, elapsed);
      if (!(sec >= 60)) return null;
      const f = offlineFloor();
      // o.serverGold: 재산도 서버가 계산 (정식판, 3단계) → 여기선 안 더함 (sync가 서버 값을 넣음)
      const gold = o.serverGold ? 0 : sec * offlineGoldPerSec(f);
      E.S.gold += gold;
      E.S.lastSave = now();
      // 장비(가방 빈칸만큼)·결재 도장
      const drops = o.serverDrops ? { items: [], stamps: 0 } : Inv.offline(E.S, H, sec, f, E.eff());
      track('offline');
      stat('offline');
      stat('offline_hours', Math.floor(sec / 3600), true);
      return { sec, gold, f, itemFloor: E.eff(), items: drops.items, stamps: drops.stamps };
    };

    // ===== 장비·장신구 (규칙은 inventory.js — 서버도 같은 코드를 씀) =====
    const Inv = G.Inv;
    // inventory.js 연결부. 도감 등록(공격력 보너스)은 기기에서
    const H = { rng, now, emit, stat, track, onCreate: (item) => registerCodex(item) };
    // 서버가 아이템을 관리하면 처치 드롭을 기기에서 굴리지 않고 여기로 보고 (sync.js가 연결): (유효 층, 보스 여부)
    E.dropSink = null;
    E.item = (id) => Inv.find(E.S, id);
    E.isEquipped = (id) => I.SLOT_KEYS.some((slot) => E.S.equipped[slot] === id);
    E.bagSize = () => Inv.bagSize(E.S);
    E.bagFree = () => Inv.bagFree(E.S);
    E.bagPrice = () => (E.S.bagBuys < I.BAG.maxBuys ? I.BAG.price(E.S.bagBuys) : null);
    // 가방 확장 (성과급 또는 법카 1:1). paid=true면 서버가 이미 차감
    E.buyBag = function (currency = 'bonus', paid = false) {
      if (!ECON.shopBagCurrencies.includes(currency)) return no('결제 수단이 올바르지 않아요');
      const price = E.bagPrice();
      if (price === null) return no('가방을 더 늘릴 수 없어요');
      if (!paid && E.S[currency] < price) return no(currency === 'corp' ? '법카가 부족해요' : '성과급이 부족해요');
      if (!paid) E.S[currency] -= price;
      E.S.bagBuys++;
      emit('save');
      return ok({ price, size: E.bagSize() });
    };
    // 아이템 비용 기준값 K: 층과 상관없이 고정 (감정·재감정·강화·흔적 복구·분해)
    E.costBase = () => I.COST_K;

    // 장비가 바뀌면 보너스 다시 계산, 최대 체력이 늘면 그만큼 채워줌
    function gearChanged() {
      const before = E.maxHp();
      E.invalidateBonuses();
      for (const k of Object.keys(I.equipAch(E.equippedItems()))) stat(k, 1, true); // 장비 업적 (서버도 같은 규칙)
      const mm = E.maxHp();
      if (mm > before) E.hp += mm - before;
      E.hp = Math.min(mm, E.hp);
    }

    function registerCodex(item) {
      const key = Eq.codexKey(item);
      if (E.S.codex[key]) return;
      E.S.codex[key] = true;
      E.S.bonus += I.CODEX.bonus;
      E.invalidateBonuses();
      emit('codexNew', { key });
    }

    E.equip = function (id) {
      const item = E.item(id);
      if (!item) return no('없는 아이템이에요');
      if (item.ruined) return no('흔적은 복구한 뒤 장착할 수 있어요');
      const prev = E.S.equipped[item.slot];
      if (prev === id) return no('이미 장착 중이에요');
      E.S.equipped[item.slot] = id;
      gearChanged();
      emit('save');
      return ok({ item, prev: prev === null || prev === undefined ? null : prev });
    };

    // 장비 프리셋 바꾸기: 지금 장착 ↔ 교체용 (없어진 장비·흔적 칸은 비움)
    E.isKept = (id) => E.isEquipped(id) || I.SLOT_KEYS.some((slot) => E.S.presetAlt[slot] === id);
    E.presetSwap = function () {
      const next = {};
      let missing = 0;
      for (const slot of I.SLOT_KEYS) {
        const id = E.S.presetAlt[slot];
        const it = id === null || id === undefined ? null : E.item(id);
        if (id !== null && id !== undefined && (!it || it.ruined || it.slot !== slot)) missing++;
        next[slot] = it && !it.ruined && it.slot === slot ? it.id : null;
      }
      E.S.presetAlt = { ...E.S.equipped };
      E.S.equipped = next;
      E.S.preset = E.S.preset === 1 ? 0 : 1;
      gearChanged();
      emit('save');
      return ok({ preset: E.S.preset, missing });
    };

    E.unequip = function (slot) {
      if (!(slot in I.SLOTS)) return no('없는 부위예요');
      const id = E.S.equipped[slot];
      if (id === null || id === undefined) return no('장착한 아이템이 없어요');
      E.S.equipped[slot] = null;
      gearChanged();
      emit('save');
      return ok({ id });
    };

    // ----- 강화 (docs/enhance-table.md) -----
    E.enhanceOdds = function (id, o = {}) {
      const item = E.item(id);
      return item ? Eq.enhanceOdds(item.plus, item.downs, o) : null;
    };
    // 장착 중인 장비 강화: 자동으로 해제 → 강화 → 다시 장착 (규칙상 장착 중 강화는 안 되므로 버튼 하나로 처리)
    // 파괴되면(소멸·흔적) 장착이 풀림
    function withUnequip(item, fn) {
      const slot = I.SLOT_KEYS.find((k) => E.S.equipped[k] === item.id) || null;
      if (slot) E.S.equipped[slot] = null;
      const out = fn();
      if (slot && E.item(item.id) && !item.ruined) E.S.equipped[slot] = item.id;
      if (slot) gearChanged();
      return out;
    }
    E.enhance = function (id, o = {}) {
      const item = E.item(id);
      const err = Inv.enhanceError(item);
      if (err) return no(err);
      return withUnequip(item, () => Inv.enhance(E.S, H, id, o));
    };
    E.restoreCost = (id) => Inv.restoreCost(E.S, id);
    E.restore = (id) => Inv.restore(E.S, H, id);
    // 자동 강화. o = {target, boost, protect, stopAt12, stopOnDown, maxTries}
    E.autoEnhance = function (id, o = {}) {
      const item = E.item(id);
      const err = Inv.enhanceError(item);
      if (err) return no(err);
      return withUnequip(item, () => Inv.autoEnhance(E.S, H, id, o));
    };
    // 일괄 강화 (+10까지). scope: 'equipped' | 'all'
    E.ENHANCE_ALL_MAX = Inv.ENHANCE_ALL_MAX;
    E.enhanceAll = function (o = {}) {
      const r = Inv.enhanceAll(E.S, H, o);
      if (r.ok) gearChanged();
      return r;
    };
    // ===== 추천 장착: 부위마다 주 능력치가 가장 높은 것 (같으면 등급·강화 높은 것) =====
    const recScore = (it) => Eq.mainValue(it);
    E.bestFor = function (slot) {
      let best = null;
      for (const it of E.S.items) {
        if (it.slot !== slot || it.ruined) continue;
        if (!best || recScore(it) > recScore(best) || (recScore(it) === recScore(best) && (it.grade > best.grade || (it.grade === best.grade && it.plus > best.plus)))) best = it;
      }
      return best;
    };
    // 지금 장착한 것보다 좋은지 (가방 ▲ 표시)
    E.isUpgrade = function (it) {
      if (it.ruined) return false;
      const cur = E.item(E.S.equipped[it.slot]);
      return !cur || recScore(it) > recScore(cur);
    };
    E.recommendEquip = function () {
      const changes = [];
      for (const slot of I.SLOT_KEYS) {
        const best = E.bestFor(slot);
        const cur = E.S.equipped[slot];
        if (best && best.id !== cur && (!E.item(cur) || recScore(best) > recScore(E.item(cur)))) {
          changes.push({ slot, from: cur === null || cur === undefined ? null : cur, to: best.id });
          E.S.equipped[slot] = best.id;
        }
      }
      if (!changes.length) return no('이미 가장 좋은 장비를 끼고 있어요');
      gearChanged();
      emit('save');
      return ok({ changes });
    };

    // ===== 양파나라 (중고거래 판매소): 올려두면 시간이 지나 성과급으로 팔림 =====
    E.marketSlotsFree = () => Inv.marketSlotsFree(E.S);
    E.marketList = (ids) => Inv.marketList(E.S, H, ids);
    E.marketStatus = () => Inv.marketStatus(E.S, now());
    E.marketClaim = () => Inv.marketClaim(E.S, H);

    E.appraise = function (id) {
      const r = Inv.appraise(E.S, H, id);
      if (r.ok) gearChanged();
      return r;
    };
    // 재감정: lockIdx 줄은 유지. 짬이 모자라면 짬 1 = 성과급 30으로 대신 냄
    E.reappraise = function (id, lockIdx = []) {
      const r = Inv.reappraise(E.S, H, id, lockIdx);
      if (r.ok) gearChanged();
      return r;
    };

    // 합성 (같은 부위·등급 4개 → 다음 등급) · 일괄 합성 · 분해 · 보호
    E.merge = (ids) => Inv.merge(E.S, H, ids);
    E.mergeAll = (maxGrade) => Inv.mergeAll(E.S, H, maxGrade);
    E.mergeCount = (maxGrade) => Inv.mergeCount(E.S, maxGrade);
    E.dismantle = (ids) => Inv.dismantle(E.S, H, ids);
    E.dismantleBelow = (grade) => Inv.dismantleBelow(E.S, H, grade);
    E.toggleProtect = (id) => Inv.toggleProtect(E.S, H, id);

    // 장신구 조각 20개 → 장신구 1개 (상자 확률표)
    E.openShardBox = () => Inv.shardBox(E.S, H, E.eff());
    // 등급이 정해진 상자 (출석 보상) → 그 등급 장비/장신구 1개
    const openGradeBox = (box) => Inv.gradeBox(E.S, H, box, E.S.maxStage);

    // 뽑기 n회 (1/11/35). kind = 'acc'(장신구) | 'equip'(장비). 아이템 층 = 최고 층(유효)
    E.gachaFloor = () => Math.max(1, E.S.maxStage);
    E.gachaPull = function (n, kind = 'acc') {
      const r = Inv.gacha(E.S, H, n, kind, E.gachaFloor());
      if (r.ok) gachaStats(r.results, r.cost);
      return r;
    };
    // 뽑기 기록 (업적·미션). 서버 뽑기 결과에도 씀
    function gachaStats(results, cost) {
      // 업무 스킬 보유 반영(카드·교환권 조각·짬)은 뽑기 규칙(inventory.js)이 함 — 서버 모드면 응답의 skills 복사본
      if (results.some((r) => r.skill)) E.invalidateBonuses();
      track('pull', results.length);
      stat('pull', results.length);
      stat('bonus_spent', cost);
      for (const r of results) {
        E.S.rew.commonRun = r.grade === 0 ? E.S.rew.commonRun + 1 : 0;
        stat('common_streak', E.S.rew.commonRun, true);
      }
    }
    E.gachaStats = gachaStats;

    // ===== 결재 도장 상점: 1개 = 처치 보상 20번어치 (이번 회차 최고 유효 층, 재산 보너스 포함), 하루 40개씩 ×1→×2→×4 =====
    E.stampBase = () => I.STAMP.shop.killsPer * E.runKillGold();
    E.stampShop = function () {
      const sh = Inv.stampShopToday(E.S, now());
      const SP = I.STAMP.shop;
      const max = Inv.stampShopMax();
      let acc = 0; let tier = -1;
      for (let i = 0; i < SP.tiers.length; i++) { acc += SP.tiers[i]; if (sh.bought < acc) { tier = i; break; } }
      return { bought: sh.bought, max, tier, unit: tier < 0 ? null : E.stampBase() * SP.mult[tier], step: SP.step, left: max - sh.bought };
    };
    E.stampPrice = (n) => Inv.stampPrice(E.S, now(), n, E.stampBase());
    // 10개 단위로 구매 (단계 경계를 넘으면 그 안에서 나눠 계산)
    E.buyStamps = (n = I.STAMP.shop.step) => Inv.stampBuy(E.S, H, n, E.stampBase());
    // ===== 광고·업적 =====
    E.adsLeft = function () {
      const d = M.dayNum(now());
      if (E.S.rew.adDay !== d) { E.S.rew.adDay = d; E.S.rew.ads = 0; }
      return G.Rewards.REW.ad.perDay - E.S.rew.ads;
    };
    // 광고 1회 보상 (광고 SDK 연결 전: 버튼 누르면 바로). paid=true면 서버가 이미 지급
    E.watchAd = function (paid = false) {
      if (E.adsLeft() <= 0) return no('오늘 광고는 다 봤어요');
      E.S.rew.ads++;
      const bonus = G.Rewards.REW.ad.bonus;
      if (!paid) E.S.bonus += bonus;
      emit('save');
      return ok({ bonus, left: E.adsLeft() });
    };
    // ----- 정식판: 미션·업적 카운터는 서버가 원본 (설계서 5단계) -----
    // c = 서버 countersView {st: 평생 기록, mis: 이번 기간 미션 {day, week, prog, claimed, all}, ach: 받은 업적 id}
    // 서버가 세는 기록(rewards.js SERVER_STATS)·미션·받은 업적을 서버 값으로. 달성 표시는 다시 계산 (알림은 안 띄움)
    E.setCounters = function (c) {
      if (!c || typeof c !== 'object') return;
      const S = E.S;
      const st = c.st && typeof c.st === 'object' ? c.st : {};
      for (const k of Object.keys(G.Rewards.SERVER_STATS())) {
        const v = typeof st[k] === 'number' && isFinite(st[k]) && st[k] > 0 ? st[k] : 0;
        if (v > 0) S.stats[k] = v; else delete S.stats[k];
      }
      if (Array.isArray(c.ach)) {
        S.ach = {};
        for (const id of c.ach) if (typeof id === 'string' && G.Rewards.ACH_BY_ID[id]) S.ach[id] = true;
      }
      S.achReady = {};
      for (const a of G.Rewards.ACH) if (!S.ach[a.id] && (S.stats[a.stat] || 0) >= a.need) S.achReady[a.id] = true;
      const m = c.mis && typeof c.mis === 'object' ? c.mis : null;
      if (m) {
        const o = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
        const mis = { ...M.misFresh(), day: Number.isInteger(m.day) ? m.day : null, week: Number.isInteger(m.week) ? m.week : null };
        for (const d of M.MIS.defs) {
          const v = o(m.prog)[d.id];
          if (Number.isInteger(v) && v > 0) mis.prog[d.id] = Math.min(d.need, v);
          if (o(m.claimed)[d.id] === true) mis.claimed[d.id] = true;
        }
        for (const sc of ['daily', 'weekly']) if (o(m.all)[sc] === true) mis.all[sc] = true;
        S.mis = mis;
      }
      emit('save');
    };
    // 다른 기기가 올린 클라우드 세이브(설정·표시용만, state.js cloudSave) → 이 기기에 합침 (설계서 6단계: 진행 고르기 창 없음)
    // 진행·재화·아이템·미션·업적은 서버 값이라 여기서 안 건드림. 본 안내·해금 알림은 합치고(한쪽이라도 봤으면 봄), 설정·장착은 클라우드 값
    E.applyCloudPrefs = function (raw) {
      const p = G.State.cloudSave(raw);
      const S = E.S;
      if (p.settings) S.settings = { ...S.settings, ...p.settings };
      for (const k of ['buyMode', 'autoAdvance', 'autoSkill', 'speedOn', 'autoAppraise']) if (p[k] !== undefined) S[k] = p[k];
      for (const k of Object.keys(p.unlocked || {})) S.unlocked[k] = true;
      if (p.tut) {
        S.tut.intro = S.tut.intro || p.tut.intro === true;
        for (const k of Object.keys(p.tut.seen || {})) S.tut.seen[k] = true;
      }
      if (p.board && p.board.seenId > S.board.seenId) S.board = { ...p.board };
      if (p.equipped) for (const slot of I.SLOT_KEYS) S.equipped[slot] = Number.isInteger(p.equipped[slot]) ? p.equipped[slot] : null;
      if (p.presetAlt) for (const slot of I.SLOT_KEYS) S.presetAlt[slot] = Number.isInteger(p.presetAlt[slot]) ? p.presetAlt[slot] : null;
      if (p.preset !== undefined) S.preset = p.preset;
      if (p.skills && Array.isArray(p.skills.slots)) S.skills.slots = SK.clean({ ...S.skills, slots: p.skills.slots }, S.maxStage).slots; // 가진 스킬·열린 칸만
      if (p.pet && p.pet.out !== undefined) S.pet.out = typeof p.pet.out === 'string' && G.Pets.owned(S.pet, p.pet.out) ? p.pet.out : S.pet.out;
      cleanEquipped();
      E.invalidateBonuses();
      emit('save');
    };
    E.achievements = () => G.Rewards.ACH.map((a) => ({ ...a, prog: Math.min(a.need, E.S.stats[a.stat] || 0),
      claimed: !!E.S.ach[a.id], ready: !!E.S.achReady[a.id] && !E.S.ach[a.id] }));
    E.claimAchievement = function (id, paid = false) {
      const a = G.Rewards.ACH_BY_ID[id];
      if (!a) return no('없는 업적이에요');
      if (E.S.ach[id]) return no('이미 받았어요');
      if (!E.S.achReady[id]) return no('아직 달성하지 않았어요');
      E.S.ach[id] = true;
      if (!paid) E.S.bonus += a.bonus;
      emit('save');
      return ok({ id, bonus: a.bonus });
    };

    // ----- 서버 모드: 성과급·법카·재료(짬·도장·조각)·아이템은 서버가 정하고 기기는 결과만 반영 -----
    const cleanCount = (v) => (Number.isInteger(v) && v >= 0 ? v : null);
    let walletVer = -1; // 늦게 도착한 옛 지갑 응답은 무시
    E.setWallet = function (w) {
      if (!w) return;
      if (Number.isInteger(w.ver)) {
        if (w.ver < walletVer) return;
        walletVer = w.ver;
      }
      for (const k of ['bonus', 'corp', 'jjam', 'stamps', 'shards', 'pass', 'kaltoe', 'namecard']) {
        const v = cleanCount(w[k]);
        if (v !== null) E.S[k] = v;
      }
    };
    E.resetWalletVer = () => { walletVer = -1; };
    E.setGachaState = function (st, kind = 'acc') {
      if (!st || !Inv.GACHA_KIND[kind]) return;
      const n = (v) => cleanCount(v) ?? 0;
      E.S.gacha[kind] = { count: n(st.count), sinceBoost: n(st.sinceBoost), sincePity: n(st.sincePity) };
    };

    // 장착 칸 정리: 없어진 아이템·흔적은 해제
    function cleanEquipped() {
      for (const slot of I.SLOT_KEYS) {
        const it = E.item(E.S.equipped[slot]);
        if (!it || it.ruined || it.slot !== slot) E.S.equipped[slot] = null;
        const a = E.item(E.S.presetAlt[slot]);
        if (!a || a.slot !== slot) E.S.presetAlt[slot] = null;
      }
    }
    // 서버 응답의 아이템 사본 → 기기 아이템 객체 (화면이 들고 있는 참조가 그대로 이어지게)
    function localItem(x) {
      return x && typeof x === 'object' && Number.isInteger(x.id) ? E.item(x.id) || x : x;
    }
    E.localize = function (v) {
      if (!v || typeof v !== 'object' || Array.isArray(v)) return v;
      const out = { ...v };
      if (out.item) out.item = localItem(out.item);
      if (Array.isArray(out.items)) out.items = out.items.map(localItem);
      if (Array.isArray(out.results)) out.results = out.results.map((r) => (r && r.item ? { ...r, item: localItem(r.item) } : r));
      return out;
    };
    // 서버 아이템·진행 상태 반영 (전체 또는 일부)
    function applyInvState(v) {
      if (Array.isArray(v.mergeFail)) E.S.mergeFail = I.GRADES.map((_, i) => cleanCount(v.mergeFail[i]) ?? 0);
      if (v.market && typeof v.market === 'object') E.S.market = Inv.cleanMarket(v.market);
      if (v.stampShop && typeof v.stampShop === 'object') {
        E.S.stampShop = { day: typeof v.stampShop.day === 'number' ? v.stampShop.day : null, bought: cleanCount(v.stampShop.bought) ?? 0 };
      }
      if (v.gacha) for (const k of Object.keys(Inv.GACHA_KIND)) if (v.gacha[k]) E.setGachaState(v.gacha[k], k);
      if (Number.isInteger(v.nextItemId)) E.S.nextItemId = Math.max(E.S.nextItemId, v.nextItemId);
      if (v.dept && typeof v.dept === 'object') E.S.dept = D.clean(v.dept, now());
      if (v.net && typeof v.net === 'object') { E.S.net = G.Net.clean(v.net); E.invalidateBonuses(); }
      if (v.pet && typeof v.pet === 'object') { E.S.pet = G.State.cleanPet({ ...v.pet, out: E.S.pet.out }); E.invalidateBonuses(); }
      if (v.skills && typeof v.skills === 'object') E.setSkills(v.skills);
      E.setWallet(v.wallet);
    }
    // 서버 아이템 전체로 바꾸기 (접속 때). 도감은 조용히 등록 (서버가 보상을 이미 줌)
    E.setInventory = function (inv) {
      if (!inv || !Array.isArray(inv.items)) return;
      const seen = new Set();
      E.S.items = inv.items.map(Eq.cleanItem).filter((it) => it && !seen.has(it.id) && seen.add(it.id));
      E.S.nextItemId = Math.max(1, E.S.items.reduce((m, it) => Math.max(m, it.id + 1), 1), cleanCount(inv.nextItemId) || 1);
      for (const it of E.S.items) E.S.codex[Eq.codexKey(it)] = true;
      applyInvState(inv);
      cleanEquipped();
      gearChanged();
      emit('save');
    };
    // 서버가 정한 변화 반영. d = {put, del, created, gold(재산 증감), wallet, events, mergeFail, market, stampShop, gacha, nextItemId}
    E.applyServer = function (d) {
      if (!d || typeof d !== 'object') return;
      for (const raw of Array.isArray(d.put) ? d.put : []) {
        const it = Eq.cleanItem(raw);
        if (!it) continue;
        const cur = E.item(it.id);
        if (cur) Object.assign(cur, it); else E.S.items.push(it);
        E.S.nextItemId = Math.max(E.S.nextItemId, it.id + 1);
      }
      const del = new Set(Array.isArray(d.del) ? d.del : []);
      if (del.size) E.S.items = E.S.items.filter((it) => !del.has(it.id));
      if (typeof d.gold === 'number' && isFinite(d.gold)) E.S.gold = Math.max(0, E.S.gold + d.gold);
      for (const id of Array.isArray(d.created) ? d.created : []) { const it = E.item(id); if (it) registerCodex(it); }
      applyInvState(d);
      cleanEquipped();
      // 서버에서 일어난 일(업적 기록·미션·알림)을 기기에서 다시 실행
      for (const ev of Array.isArray(d.events) ? d.events : []) {
        if (!Array.isArray(ev)) continue;
        const [kind, name, v, max] = ev;
        if (kind === 's' && typeof v === 'number') stat(name, v, max === true);
        else if (kind === 't' && typeof v === 'number') track(name, v);
        else if (kind === 'e' && typeof name === 'string') emit(name, E.localize(v));
      }
      checkNetUnlock();
      gearChanged();
      emit('save');
    };
    // 법카 → 성과급 (결제는 아직 테스트 버튼)
    E.buyBonusWithCorp = function (n) {
      if (!Number.isInteger(n) || n <= 0) return no('개수가 올바르지 않아요');
      if (E.S.corp < n) return no('법카가 부족해요');
      E.S.corp -= n;
      E.S.bonus += n * ECON.corpToBonus;
      emit('save');
      return ok({ bonus: n * ECON.corpToBonus });
    };

    // ===== 출석 =====
    // 보상 지급 (성과급·도장·상자). paid=true면 서버가 이미 모두 지급 (상자 아이템은 sync가 반영)
    function giveReward(rw, paid) {
      if (paid) return null;
      E.S.bonus += rw.bonus || 0;
      E.S.stamps += rw.stamps || 0;
      E.S.kaltoe += rw.kaltoe || 0;
      return rw.box ? openGradeBox(rw.box) : null;
    }
    E.attendance = () => M.attStatus(E.S.att, now());
    E.claimAttendance = function (bonusPaid = false) {
      const r = M.attClaim(E.S.att, now());
      if (!r) return no('오늘은 이미 받았어요');
      const item = giveReward(r, bonusPaid);
      stat('att');
      emit('attendance', { ...r, item });
      emit('save');
      return ok({ ...r, item });
    };
    E.fillAttendance = function (day, paid = false) {
      const r = M.attFill(E.S.att, now(), day);
      if (typeof r === 'string') return no(r);
      if (!paid && E.S.corp < r.cost) return no('법카가 부족해요');
      if (!paid) E.S.corp -= r.cost;
      r.commit();
      const item = giveReward(r.reward, paid);
      stat('att');
      emit('attendance', { day, ...r.reward, item, filled: true });
      emit('save');
      return ok({ day, cost: r.cost, ...r.reward, item });
    };

    // ===== 미션 =====
    E.missions = () => M.misStatus(E.S.mis, now());
    E.claimMission = function (id, bonusPaid = false) {
      if (!E.isUnlocked('mission')) return no(`최고 ${M.MIS.unlock}층부터 열려요`);
      const r = M.misClaim(E.S.mis, now(), id);
      if (typeof r === 'string') return no(r);
      if (!bonusPaid) E.S.bonus += r.bonus;
      if (!bonusPaid && (id === 'all:daily' || id === 'all:weekly')) {
        E.S.stamps += I.STAMP.free.missionAll[id.slice(4)];
        const tk = M.MIS.allTickets[id.slice(4)];
        for (const k of Object.keys(tk)) E.S[k] += tk[k];
      }
      stat('mis_claim');
      emit('mission', { id, bonus: r.bonus });
      emit('save');
      return ok({ id, bonus: r.bonus });
    };

    // ===== 튜토리얼: 사수의 포스트잇 (규칙 meta.js GUIDE — 서버도 같은 표) =====
    // S.tut.step = 받은 단계 수. 서버 모드에선 서버 기록(meta_states.guide)의 복사본
    E.guideInfo = function () {
      const k = E.S.tut.step + 1;
      const d = M.guideDef(k);
      if (!d) return null;
      const p = M.guideProgress(E.S, k);
      return { k, text: d.text, need: d.need, cur: p.cur, done: p.done, bonus: d.bonus, pass: d.pass, go: d.go, server: d.server || null, floor: d.floor || null };
    };
    // 지금 단계 보상 받기. paid=true면 서버가 이미 지급 (지갑은 sync가 맞춤)
    E.guideClaim = function (paid = false) {
      const g = E.guideInfo();
      if (!g) return no('더 받을 포스트잇이 없어요');
      if (!g.done && !paid) return no('아직 다 하지 않았어요');
      E.S.tut.step = g.k;
      if (!paid) { E.S.bonus += g.bonus; E.S.pass += g.pass; }
      emit('guide', { k: g.k, bonus: g.bonus, pass: g.pass });
      emit('save');
      return ok({ k: g.k, bonus: g.bonus, pass: g.pass });
    };
    // 서버 기록으로 맞춤 (접속 때)
    E.setGuideStep = function (n) { if (Number.isInteger(n) && n >= 0 && n <= M.GUIDE.maxK) E.S.tut.step = n; };

    // ===== 부서 장악 묶음: 장악전·외부 미팅·특근 (규칙은 depts.js — 서버도 같은 코드) =====
    const D = G.Depts;
    // 서버 모드면 승리·받기를 서버에 보냄 (sync.js가 연결): (kind, args) → Promise. 없으면 기기에서 바로 지급
    E.sideSink = null;
    E.sideReady = null; // 서버 모드: 서버와 맞춘 뒤에만 도전 (sync.js가 연결)
    E.deptInfo = (sub = false) => ({ list: D.preview(E.S, now(), sub), cap: D.storeCap(sub), conquest: D.conquestInfo(E.S, E.S.maxStage),
      meetings: D.meetingInfo(E.S, now()), pass: E.S.pass, kaltoe: E.S.kaltoe, namecard: E.S.namecard, passShopLeft: D.passShopLeft(E.S, now()) });
    E.dungeonInfo = () => Object.keys(E.S.dept.owned).map((id) => {
      const best = E.S.dept.dungeon.best[id] || 0;
      return { id, name: D.BY_ID[id].dungeon.name, best, next: best + 1, error: D.dungeonError(E.S, id, best + 1, E.S.maxStage), reward: D.stepReward(id, Math.max(1, best)) };
    });
    function sideStart(kind, args, err) {
      if (err) return no(err);
      if (E.mode !== 'main') return no('이미 도전 중이에요');
      if (E.sideReady && !E.sideReady()) return no('서버와 맞추는 중이에요. 잠시 후 다시 해주세요');
      const b = D.battle(kind, args);
      E.mode = kind;
      E.side = { ...b, args, wave: 0, left: typeof b.waves[0] === 'number' ? b.waves[0] : 1, timer: b.time };
      E.restTimer = 0;
      clearActive();
      E.hp = E.maxHp();
      E.enemy = null;
      E.attackTimer = 0;
      emit('sideStart', { kind, floor: b.floor, boss: b.boss, dept: b.dept, time: b.time, waves: b.waves.length });
      spawn();
      return ok({ kind, floor: b.floor });
    }
    function spawnSide() {
      const s = E.side;
      const boss = s.waves[s.wave] === 'boss';
      const f = s.floor;
      let key; let name;
      if (boss) { key = BOSSES[(D.BY_ID[s.dept].n - 1) % BOSSES.length][0]; name = s.boss; }
      else [key, name] = ENEMIES[Math.floor(rng() * ENEMIES.length)];
      const hp = E.enemyHpAt(f, boss) * (boss ? s.bossHp : 1);
      E.enemy = { key, name, hp, maxHp: hp, boss, dps: E.enemyDpsAt(f, boss), side: s.kind };
      E.spawnDelay = 0;
      emit('spawn', E.enemy);
    }
    function sideEnd() {
      E.mode = 'main';
      E.side = null;
      E.enemy = null;
      E.hp = E.maxHp();
      E.spawnDelay = F.SPAWN_DELAY;
    }
    function onSideKill() {
      const s = E.side;
      E.enemy = null;
      E.spawnDelay = F.SPAWN_DELAY;
      if (--s.left > 0) return;
      s.wave++;
      if (s.wave >= s.waves.length) { sideWin(); return; }
      s.left = typeof s.waves[s.wave] === 'number' ? s.waves[s.wave] : 1;
      emit('sideWave', { wave: s.wave + 1, of: s.waves.length });
    }
    // 실패: 벌칙 없음, 메인 층·처치 수 그대로, 출입증·미팅 횟수 안 씀
    function sideFail(reason) {
      const kind = E.side.kind;
      sideEnd();
      emit('sideEnd', { kind, win: false, reason });
      emit('save');
    }
    // 기기에서 바로 지급 (서버 없을 때)
    function sideLocal(kind, a) {
      let r;
      if (kind === 'conquest') r = D.conquer(E.S, H, a.n, E.S.maxStage);
      else if (kind === 'meeting') r = D.meeting(E.S, H, a.id, false);
      else r = D.dungeonWin(E.S, H, a.id, a.k, E.S.maxStage);
      if (kind === 'conquest') { checkNetUnlock(); gearChanged(); } // 장악 수로 인맥이 열리면 능력치도 바뀜
      return E.withDeptGold(r);
    }
    function sideWin() {
      const { kind, args } = E.side;
      sideEnd();
      if (E.sideSink) {
        emit('sideEnd', { kind, win: true, pending: true });
        Promise.resolve().then(() => E.sideSink(kind, args))
          .catch(() => ({ ok: false, reason: '서버에 연결할 수 없어요' }))
          .then((r) => emit('sideResult', { kind, args, ...r }));
      } else {
        const r = sideLocal(kind, args);
        emit('sideEnd', { kind, win: true });
        emit('sideResult', { kind, args, ...r });
      }
      emit('save');
    }
    E.conquestStart = function () {
      const c = D.conquestInfo(E.S, E.S.maxStage);
      return sideStart('conquest', { n: c.n }, c.open ? null : `최고 ${c.floor}층부터 도전할 수 있어요`);
    };
    E.meetingStart = (id) => sideStart('meeting', { id }, D.meetingError(E.S, id, now()));
    E.dungeonStart = (id, k) => sideStart('dungeon', { id, k }, D.dungeonError(E.S, id, k, E.S.maxStage));
    E.sideExit = function () {
      if (!E.side) return no('도전 중이 아니에요');
      sideFail('quit');
      return ok({});
    };
    // 받기·한 번에 처리·소탕·출입증 구매 (서버 없을 때. 서버 모드는 sync.js가 서버로)
    // 부서 생산·특근 결과의 원(몇 시간치·몇 마리치)을 재산에 더함. 폰·서버 모드 공용
    E.withDeptGold = (r) => { if (r && r.ok !== false) { const g = E.deptGold(r); if (g) { E.S.gold += g; r.gold = g; } } return r; };
    const withGold = E.withDeptGold;
    E.deptFloor = () => Math.max(1, E.S.maxStage);
    E.deptClaim = (sub = false) => withGold(D.claim(E.S, H, sub, E.deptFloor()));
    E.meetingQuick = (id) => D.meeting(E.S, H, id, true);
    E.dungeonSweep = (id, n = 1) => withGold(D.sweep(E.S, H, id, n));
    E.buyPass = () => D.buyPass(E.S, H);

    // ===== 인맥 (규칙은 net.js — 서버도 같은 코드). 서버 모드면 sync.js가 서버로, 결과 net은 서버 기록 복사본 =====
    const NT = G.Net;
    E.netInfo = () => ({ list: NT.list(E.S), namecard: E.S.namecard, bonus: E.S.bonus, conquered: E.S.dept.conquered, open: E.S.dept.conquered >= 1 });
    // 능력치가 바뀌면 최대 체력 등 다시 계산
    const netDone = (r) => { if (r && r.ok) { gearChanged(); emit('save'); } return r; };
    E.netLevelUp = (id, n = 1) => netDone(NT.levelUp(E.S, H, id, n));
    E.netRankUp = (id) => netDone(NT.rankUp(E.S, H, id));
    E.netLevelAll = () => netDone(NT.levelAll(E.S, H));

    // ===== 책상 반려 (규칙은 pets.js — 서버도 같은 코드). 서버 모드면 sync.js가 서버로, own·codex는 서버 기록 복사본 =====
    // 책상에 올리기(out)만 폰이 정함 (장비 장착과 같은 원칙)
    const PT = G.Pets;
    E.serverPets = false; // sync.js가 서버 모드에서 켬 → 해금 지급도 서버가 (E.petStart를 기기에서 안 부름)
    E.petInfo = () => ({ list: PT.list(E.S.pet, E.S.pet.out, E.petCostBase()), out: E.S.pet.out, open: PT.isOpen(E.S.maxStage), bonus: E.petBonus(), hold: PT.holdTotal(E.S.pet), gold: E.S.gold });
    const petDone = (r) => {
      if (r && r.ok) {
        if (E.S.pet.out && !PT.owned(E.S.pet, E.S.pet.out)) E.S.pet.out = null;
        gearChanged(); emit('save');
      }
      return r;
    };
    E.petSummon = function (key) {
      if (key !== null && !PT.owned(E.S.pet, key)) return no('없는 반려예요');
      E.S.pet.out = key;
      return petDone(ok({ key }));
    };
    // 합치기 재산 기준 = 이번 회차 최고 유효 층 일반 처치 보상 (업무 스킬 숙련과 같음)
    E.petCostBase = () => E.runKillGold();
    E.petMerge = (key, tier, n = 1) => petDone(PT.merge(E.S, H, key, tier, n, E.petCostBase()));
    E.petMergeAll = () => petDone(PT.mergeAll(E.S, H, E.petCostBase()));
    // 해금 지급 (반려선인장 D) + 책상이 비어 있으면 올림
    E.petStart = () => E.petStarted(PT.start(E.S, H));
    E.petStarted = function (r) {
      if (r && r.ok && !E.S.pet.out && PT.owned(E.S.pet, r.key)) E.S.pet.out = r.key;
      return petDone(r);
    };
    function ensurePetStarter() {
      if (E.serverPets || E.S.pet.granted || !PT.isOpen(E.S.maxStage)) return;
      E.petStart();
    }

    // ===== 야근 타워 =====
    // 월이 바뀌었으면 소탕 보상 (bonusPaid=true면 서버가 이미 넣음)
    E.towerSync = function (bonusPaid = false) {
      const sweep = M.towerSync(E.S.tower, now());
      if (sweep) {
        if (!bonusPaid) E.S.bonus += sweep.bonus;
        E.S.jjam += sweep.jjam;
        E.S.stamps += sweep.stamps || 0;
        emit('towerSweep', sweep);
        emit('save');
      }
      return sweep;
    };
    // 서버 타워 기록(meta_states.tower)으로 맞춤 (접속·보고 응답 때). 이번 달·층·월 성과급은 서버가 원본,
    // 역대 최고(버프)는 큰 쪽, 하루 실패 횟수는 폰. 도전 중엔 안 바꿈 (끝나고 다음 접속·보고 때)
    // (2026-10-29 버그: 폰·서버 층이 어긋나면 그 뒤 보고가 계속 bad_floor로 거절되던 것)
    E.setTowerServer = function (t) {
      if (!t || typeof t !== 'object' || Array.isArray(t) || E.mode === 'tower') return false;
      const st = { ...M.towerFresh(), ...t };
      const int0 = (v) => Number.isInteger(v) && v >= 0;
      if (!int0(st.cur) || !int0(st.bonusMonth) || !int0(st.best) || !(st.month === null || Number.isInteger(st.month))) return false;
      const s = E.S.tower;
      const fails = { failDay: s.failDay, fails: s.fails };
      M.towerSync(s, now()); // 폰 기록도 이번 달로 (지갑은 서버 값을 따름)
      M.towerSync(st, now()); // 서버가 다음 보고 때 할 월 초기화·소탕을 미리
      s.month = st.month; s.cur = st.cur; s.bonusMonth = st.bonusMonth;
      s.best = Math.max(s.best, st.best);
      Object.assign(s, fails);
      E.invalidateBonuses();
      return true;
    };
    E.towerInfo = function () {
      E.towerSync();
      const t = E.S.tower;
      return { unlocked: E.isUnlocked('tower'), cur: t.cur, best: t.best, failsLeft: Math.max(0, M.TOWER.failsPerDay - t.fails),
        bonusMonth: t.bonusMonth, bonusCap: M.TOWER.monthCap, buffs: E.towerBuffs(), active: E.mode === 'tower' };
    };
    E.towerStart = function () {
      if (!E.isUnlocked('tower')) return no(`평생 최고 ${M.TOWER.unlock}층부터 열려요`);
      if (E.mode !== 'main') return no('이미 도전 중이에요');
      E.towerSync();
      if (E.S.tower.fails >= M.TOWER.failsPerDay) return no('오늘 도전 횟수를 다 썼어요');
      E.mode = 'tower';
      E.tower = { floor: E.S.tower.cur + 1, timer: M.TOWER.time };
      E.restTimer = 0;
      clearActive();
      E.hp = E.maxHp();
      E.enemy = null;
      E.attackTimer = 0;
      emit('towerStart', { floor: E.tower.floor });
      spawn();
      return ok({ floor: E.tower.floor });
    };
    function spawnTower() {
      const n = E.tower.floor;
      const f = M.TOWER.mainFloor(n);
      const [key, name] = BOSSES[(n - 1) % BOSSES.length];
      const hp = E.enemyHpAt(f, true);
      E.enemy = { key, name, hp, maxHp: hp, boss: true, dps: E.enemyDpsAt(f, true), tower: n };
      E.tower.timer = M.TOWER.time;
      E.spawnDelay = 0;
      emit('spawn', E.enemy);
    }
    function onTowerKill() {
      const n = E.tower.floor;
      const t = E.S.tower;
      let reward = { bonus: 0, jjam: 0 };
      if (n > t.cur) {
        reward = M.towerFloorReward(t, n);
        t.cur = n;
        E.S.bonus += reward.bonus;
        E.S.jjam += reward.jjam;
        E.S.stamps += reward.stamps || 0;
      }
      E.enemy = null;
      E.tower.floor = n + 1;
      E.hp = E.maxHp();
      E.spawnDelay = F.SPAWN_DELAY;
      emit('towerClear', { floor: n, ...reward });
      emit('save');
    }
    function towerFail(reason) {
      E.S.tower.fails++;
      const floor = E.tower.floor;
      emit('towerEnd', { floor, reason, cleared: E.S.tower.cur });
      E.towerExit();
    }
    E.towerExit = function () {
      if (E.mode !== 'tower') return no('도전 중이 아니에요');
      E.mode = 'main';
      E.tower = null;
      E.enemy = null;
      E.hp = E.maxHp();
      E.spawnDelay = F.SPAWN_DELAY;
      emit('save');
      return ok({});
    };

    // ===== 설정 =====
    E.setSetting = function (key, val) {
      if (!(key in E.S.settings)) return no('없는 설정이에요');
      if (key !== 'lowPower' && E.S.settings.lowPower) return no('저전력 모드를 먼저 꺼 주세요');
      E.S.settings[key] = !!val;
      emit('save');
      return ok({ settings: E.S.settings });
    };
    // 실제로 켜져 있는지 (저전력 모드면 연출은 전부 꺼짐)
    E.fxOn = (key) => !E.S.settings.lowPower && !!E.S.settings[key];

    // 개발용 재화 지급
    E.devGrant = function (g = {}) {
      const add = (v) => (typeof v === 'number' && isFinite(v) && v > 0 ? v : 0);
      E.S.bonus += Math.floor(add(g.bonus));
      E.S.corp += Math.floor(add(g.corp));
      E.S.jjam += Math.floor(add(g.jjam));
      E.S.stamps += Math.floor(add(g.stamps));
      E.S.pass += Math.floor(add(g.pass));
      E.S.kaltoe += Math.floor(add(g.kaltoe));
      E.S.gold += add(g.gold);
      emit('save');
      return ok({});
    };

    E.setAutoAppraise = function (on) {
      E.S.autoAppraise = !!on;
      return ok({ autoAppraise: E.S.autoAppraise });
    };

    E.start = function () {
      E.hp = E.maxHp();
      E.S.maxStage = Math.max(E.S.maxStage, E.eff());
      track('login');
      checkUnlocks();
      spawn();
    };

    return E;
  }

  G.createEngine = createEngine;
})(globalThis.Game = globalThis.Game || {});
