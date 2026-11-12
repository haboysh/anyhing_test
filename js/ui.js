// 화면: 엔진 상태를 그리고, 버튼 입력을 엔진에 전달. 게임 규칙은 여기 없음.
(function (G) {
  'use strict';
  const { F, UPGRADES, PERKS, SKILLS, COMPANY_GRADES } = G.Data;
  // 버튼용 짧은 숫자: 가장 큰 단위까지만 (2871만7432 → 2871만)
  const fmtShort = G.fmtShort; // 맨 위 단위까지만 (format.js)
  const BUY_MODES = ['1', '5', 'max']; // 근로 강화 줄마다 버튼
  const UP_IMG = { mental: 'img/ui/up-mental.png', sleep: 'img/ui/up-sleep.png' }; // 근로 강화 그림 아이콘 (없으면 sprites.js 아이콘)
  const fmt = G.fmt;
  const I = G.Items;
  const Eq = G.Equipment;
  const GA = G.Gacha;
  const GR = I.GRADES;

  // 화면 전용 수치 (테스트 버튼·알림 간격)
  const UI_CFG = {
    testCorp: 1000, // 테스트 충전 법카
    // 법카 상품 (서버 supabase/functions/_shared/logic.js PRODUCTS와 같게). 법카 1,000 = ₩1,100
    corpProducts: [
      { id: 'corp_1000', corp: 1000, krw: 1100 },
      { id: 'corp_5000', corp: 5000, krw: 5500 },
      { id: 'corp_10000', corp: 10000, krw: 11000 },
      { id: 'monthly_30', monthly: true, hidden: true }, // 월정액 (monthlyBox에서 팖, 숫자는 meta.js PASS)
    ],
    dev: { bonus: 10000, corp: 10000, goldK: 200, jjam: 100 }, // 개발용 지급 (재산 = K × goldK)
    bagFullToastSec: 8, // 가방 가득 알림 최소 간격
  };

  const FAIL_MSG = {
    burnout: '번아웃! 한 층 아래에서 쉬고 다시 출근...',
    burnoutKeep: '번아웃! 멘탈로 버텼다 · 같은 층 재도전',
    deadline: '마감 초과! 이전 층에서 실력 쌓기',
  };

  function createUI(engine, bus, hooks) {
    const SND = hooks.sound || null;
    const snd = (name) => SND && SND.play(name);
    const E = engine;
    const SP = G.Sprites;
    const $ = (id) => document.getElementById(id);
    // 0.1초마다 그리는 곳: 값이 바뀔 때만 DOM에 씀 (같은 값을 다시 써도 브라우저는 변경으로 처리 → 배터리)
    const setText = (el, v) => { if (el && el.textContent !== v) el.textContent = v; };
    const setHtml = (el, h) => { if (el && el._h !== h) { el._h = h; el.innerHTML = h; } };
    const setDis = (el, d) => { if (el && el.disabled !== d) el.disabled = d; };
    const setStyle = (el, k, v) => { if (el && el.style[k] !== v) el.style[k] = v; };
    let tab = 'grow';
    let hitTimer;
    let toastTimer;
    let modalYes = null;
    let modalNo = null;
    let choice = null; // 열려 있는 선택 팝업 (다른 팝업에 가려지면 닫힌 뒤 다시 띄움)
    let deferred = null;
    let busy = false; // 서버 요청 중 (버튼 연타 방지)
    let pullingN = 0; // 지금 서버 답을 기다리는 뽑기 버튼 (n회)
    let pullingPay = ''; // 그 버튼의 결제: '' 성과급 | 'ticket' 반려 뽑기권 | 'hero' 영웅 이상 뽑기권
    const Y = hooks.sync;
    let GU = null; // 사내 게시판·튜토리얼 화면 (ui-guide.js)
    let lastBuffs = '';
    // 장비 화면 상태
    let dirty = false; // 아이템이 바뀌어서 다시 그려야 함
    let bagSort = 'grade'; // grade | new
    let detailId = null; // 상세 창 아이템
    let lockSel = new Set(); // 재감정 때 잠글 줄
    let mergeOpen = false;
    let mergePick = new Set();
    let enhOpen = false; // 강화 창
    const enhJ = { boost: 0, protect: 0 }; // 넣을 짬
    let enhTarget = 10;
    let enhStop12 = false;
    let enhStopDown = false;
    let autoEnhBusy = false; // 자동 강화 서버 답 기다리는 중 (연타 방지)
    let gachaKind = 'acc'; // 상점 뽑기 종류
    let equipView = 'gear'; // 장비 탭 위 전환: gear(장비) | pet(책상 반려)
    let petBusy = false;
    let bagMode = 'view'; // 가방: view(상세 보기) | merge(골라서 합성) | dis(골라서 분해) | sell(판매소에 올리기)
    let bagFilter = 'all'; // all | equip | accessory | 부위 키
    // 가방은 한 번에 BAG_PAGE칸만 그림 (600칸을 다 그리면 느린 폰에서 탭 열 때 1초 넘게 멈춤)
    const BAG_PAGE = 120;
    let bagShow = BAG_PAGE;
    let toolShow = BAG_PAGE;
    const moreBtn = (left, act) => (left > 0 ? `<button class="bag-more" data-act="${act}">더 보기 <small>${left}개 더</small></button>` : '');
    let bagPick = new Set();
    let lastBagFull = -Infinity;
    let offlineLost = 0;
    const recentNew = new Set(); // 방금 도감에 등록된 키 (NEW 표시용)

    // 주인공 공격 자세: 평타 = 키보드 치켜들기(1) → 내려치기(2), 치명타 = 마우스 돌리기(0) → 앞으로 뻗기(4)
    const POSE_URL = (n) => "img/chars/pose" + n + ".png";
    [1, 2, 4].forEach((n) => { new Image().src = POSE_URL(n); new Image().src = "img/chars/fist" + n + ".png"; });
    let poseTimers = [];
    let poseLock = 0;
    function heroPose(n) {
      $("rig").dataset.pose = n;
      $("player").src = POSE_URL(n);
      $("fist").src = "img/chars/fist" + n + ".png"; // 주먹을 무기 위에 한 번 더 (손에 쥔 것처럼)
    }
    function heroAttack(crit) {
      const now = performance.now();
      if (!$("player").classList.contains("art") || now < poseLock) return;
      if (window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches) return;
      poseTimers.forEach(clearTimeout);
      const m = $("wpn-mouse");
      const later = (ms, fn) => poseTimers.push(setTimeout(fn, ms));
      poseTimers = [];
      // 공속이 빠를수록 동작도 빨라짐: 한 번 휘두르기 = 공격 간격의 85% (0.07~0.32초), 치명타는 1.6배
      const gap = 1000 / Math.max(0.1, E.aps() * (E.timeScale || 1));
      const swing = Math.min(320, Math.max(70, gap * 0.85));
      if (crit) {
        const t = Math.min(520, swing * 1.6);
        poseLock = now + t;
        heroPose(0);
        m.style.animationDuration = t * 0.6 + "ms";
        m.classList.remove("spin"); void m.offsetWidth; m.classList.add("spin");
        later(t * 0.6, () => { m.classList.remove("spin"); m.style.animationDuration = ""; heroPose(4); });
        later(t, () => heroPose(0));
      } else {
        poseLock = now + swing;
        heroPose(1);
        later(swing * 0.4, () => heroPose(2));
        later(swing, () => heroPose(0));
      }
    }

    // 적에게 맞음 (엔진 'hurt': 일정 간격마다 피해를 한 번에): 적이 내 쪽으로 기울고, 주인공이 밀리며 빨갛게 번쩍, 피해 숫자
    function onHurt({ dmg }) {
      hpGhost.hold();
      if (document.hidden || !E.fxOn('fx') || (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches)) return;
      $('enemy').animate([{ translate: '0 0', rotate: '0deg' }, { translate: '-16px 2px', rotate: '-10deg', offset: 0.25 }, { translate: '0 0', rotate: '0deg' }],
        { duration: 320, easing: 'ease-out' });
      $('rig').animate([{ translate: '0 0' }, { translate: '-6px 0', offset: 0.3 }, { translate: '0 0' }], { duration: 260, easing: 'ease-out' });
      $('player').animate([{ filter: 'none' }, { filter: 'sepia(1) saturate(5) hue-rotate(-35deg) brightness(.95)', offset: 0.25 }, { filter: 'none' }], { duration: 260 });
      if (E.fxOn('dmgNumbers')) floatText('-' + fmt(dmg), 'hurt', 'player');
    }

    // 체력 막대 잔상: 맞으면 줄어든 만큼 하늘색으로 잠깐 남았다가 천천히 따라 내려옴 (회복은 바로 따라감). 내 체력·적 체력 둘 다
    function makeGhost(ghostId, fillId) {
      let pct0 = 100;
      let timer = null;
      return {
        hold() {
          clearTimeout(timer);
          timer = setTimeout(() => {
            const g = $(ghostId);
            const pct = parseFloat($(fillId).style.width) || 0;
            g.style.transition = 'width .55s ease-out';
            g.style.width = pct + '%';
            pct0 = pct;
          }, 320);
        },
        follow(pct) {
          if (pct < pct0) return; // 맞은 직후: 잔상이 위에 남아 있음
          pct0 = pct;
          const g = $(ghostId);
          g.style.transition = 'none';
          g.style.width = pct + '%';
        },
        reset() { clearTimeout(timer); pct0 = 0; },
      };
    }
    const hpGhost = makeGhost('mental-ghost', 'mental-fill');
    const enemyGhost = makeGhost('enemy-ghost', 'enemy-fill');

    function setSprite(el, key, scale) {
      const s = SP.spriteURL(key);
      el.src = s.url;
      el.width = s.w * scale;
      el.height = s.h * scale;
      el.classList.toggle("smooth", !!s.smooth);
      el.classList.toggle("art", !!s.art);
      el.classList.toggle("tired", key === "playerTired" && !!s.art);
    }

    // ----- 효과 -----
    function floatText(text, cls, anchorId) {
      const layer = $('fx');
      if (layer.childElementCount > 14) layer.firstChild.remove();
      const el = document.createElement('div');
      el.className = 'float ' + cls;
      el.textContent = text;
      const a = $(anchorId).getBoundingClientRect();
      const b = layer.getBoundingClientRect();
      el.style.left = (a.left - b.left + a.width / 2 + (Math.random() * 40 - 20)) + 'px';
      el.style.top = (a.top - b.top + (Math.random() * 20)) + 'px';
      layer.appendChild(el);
      setTimeout(() => el.remove(), 900);
    }

    function sparks() {
      const layer = $('fx');
      const a = $('enemy').getBoundingClientRect();
      const b = layer.getBoundingClientRect();
      const colors = ['#ffd166', '#f2f4f8', '#e0434f', '#8fd3ff'];
      for (let i = 0; i < 8; i++) {
        const el = document.createElement('div');
        el.className = 'spark';
        el.style.background = colors[i % colors.length];
        el.style.left = (a.left - b.left + a.width / 2) + 'px';
        el.style.top = (a.top - b.top + a.height / 2) + 'px';
        const ang = (i / 8) * Math.PI * 2;
        el.style.setProperty('--dx', Math.round(Math.cos(ang) * 50) + 'px');
        el.style.setProperty('--dy', Math.round(Math.sin(ang) * 50) + 'px');
        layer.appendChild(el);
        setTimeout(() => el.remove(), 520);
      }
    }

    function toast(msg) {
      const el = $('toast');
      el.textContent = msg;
      // 팝업·상세 창이 열려 있으면 제목을 가리지 않게 위로
      el.classList.toggle('high', $('modal').classList.contains('show') || $('sheet').classList.contains('show'));
      el.classList.add('show');
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => el.classList.remove('show'), 1800);
    }

    // 결재 도장 연출: 큰 성공 순간(강화 성공·이직 합격·장악 승리)에 빨간 인주 도장이 쾅 (0.5초, 효과 끄기·동작 줄이기 존중)
    function approveStamp(label) {
      snd('stamp'); // 소리는 연출을 꺼도 남
      if (document.hidden || !E.fxOn('fx') || (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches)) return;
      const old = document.querySelector('.approve-stamp');
      if (old) old.remove();
      const el = document.createElement('div');
      el.className = 'approve-stamp';
      el.setAttribute('aria-hidden', 'true');
      el.innerHTML = `<svg viewBox="0 0 140 140"><defs><filter id="ink-rough"><feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="2" seed="7"/><feDisplacementMap in="SourceGraphic" scale="3.2"/></filter></defs>
        <g filter="url(#ink-rough)" fill="none" stroke="currentColor"><circle cx="70" cy="70" r="62" stroke-width="7"/><circle cx="70" cy="70" r="52" stroke-width="2"/>
        <path d="M24 82h92" stroke-width="2"/></g>
        <g filter="url(#ink-rough)" fill="currentColor" text-anchor="middle" font-family="Galmuri11, sans-serif" font-weight="700">
        <text x="70" y="74" font-size="38">결재</text><text x="70" y="104" font-size="17">${label}</text></g></svg>`;
      $('app').appendChild(el);
      setTimeout(() => el.remove(), 1000);
    }
    // 작은 인라인 아이콘 (이모지 대신)
    const ICON = {
      lock: '<svg class="ic" viewBox="0 0 12 12" aria-hidden="true"><rect x="1.8" y="5.2" width="8.4" height="6" rx="1" fill="currentColor"/><path d="M3.8 5.2V3.9a2.2 2.2 0 0 1 4.4 0v1.3" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>',
      unlock: '<svg class="ic" viewBox="0 0 12 12" aria-hidden="true"><rect x="1.8" y="5.2" width="8.4" height="6" rx="1" fill="currentColor"/><path d="M3.8 5.2V3.9a2.2 2.2 0 0 1 4.3-.7" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>',
      warn: '<svg class="ic" viewBox="0 0 12 12" aria-hidden="true"><path d="M6 .8 11.6 11H.4Z" fill="currentColor"/><path d="M6 4.3v3.4M6 8.8v1" stroke="#fff" stroke-width="1.5"/></svg>',
      check: '<svg class="ic" viewBox="0 0 12 12" aria-hidden="true"><path d="M1.8 6.4 4.7 9.2 10.4 2.8" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="square"/></svg>',
    };

    function showModal(title, html, keepScroll = false) {
      if (choice) { deferred = choice; choice = null; }
      // 다른 창이 열리면 본문 스크롤을 맨 위로 (같은 창 다시 그리기는 위치 유지, 제목 숫자가 바뀌는 창은 keepScroll)
      const fresh = !$('modal').classList.contains('show') || (!keepScroll && title !== $('modal-title').textContent);
      $('modal-title').textContent = title;
      $('modal-body').innerHTML = html;
      $('modal-ok').textContent = '확인';
      $('modal-cancel').hidden = true;
      $('modal-cancel').textContent = '취소';
      modalYes = null;
      modalNo = null;
      $('modal').classList.remove('wide');
      $('modal').classList.add('show');
      if (fresh) $('modal-body').scrollTop = 0;
    }
    // 브라우저 confirm() 대신 게임 안 팝업으로 확인받기
    function askConfirm(title, html, yesLabel, onYes) {
      showModal(title, html);
      $('modal-ok').textContent = yesLabel;
      $('modal-cancel').hidden = false;
      modalYes = onYes;
    }
    // 두 가지 중 고르기 → Promise<true(왼쪽)/false(오른쪽)>
    function openChoice(c) {
      askConfirm(c.title, c.html, c.yesLabel, () => c.resolve(true));
      $('modal-cancel').textContent = c.noLabel;
      modalNo = () => c.resolve(false);
      choice = c;
    }
    function askChoice(title, html, yesLabel, noLabel) {
      return new Promise((resolve) => openChoice({ title, html, yesLabel, noLabel, resolve }));
    }
    // 서버 답이 온 뒤 창 다시 그리기: 그 창(제목이 prefix로 시작)이 아직 떠 있을 때만. orClosed면 아무 창도 없을 때도 다시 띄움 (소탕 확인 뒤 부서 창으로)
    // 답을 기다리는 동안 다른 창을 열었으면 덮지 않음 (예전엔 출석·미션·부서·인맥·이직 창이 다른 창 위로 다시 떴음, 2026-11-12)
    function reshow(prefix, fn, orClosed = false) {
      const open = $('modal').classList.contains('show');
      if (open ? $('modal-title').textContent.startsWith(prefix) : orClosed) fn();
    }
    // 팝업이 닫힌 뒤 가려졌던 선택 팝업 다시 띄우기
    function afterModalClose() {
      choice = null;
      if (deferred && !$('modal').classList.contains('show')) { const c = deferred; deferred = null; openChoice(c); }
    }

    function showOffline(info) {
      if (!info) return;
      const h = Math.floor(info.sec / 3600);
      const m = Math.floor((info.sec % 3600) / 60);
      const items = info.items || [];
      let extra = '';
      if (items.length) {
        extra = `<div class="g-grid">${items.map((it) => itemCard(it)).join('')}</div>`;
        recentNew.clear();
      }
      if (offlineLost > 0) extra += `<div class="warn-line">가방이 가득 차서 장비 ${offlineLost}개를 못 받았어요</div>`;
      offlineLost = 0;
      showModal('퇴근 후 정산', `${h ? h + '시간 ' : ''}${m}분 동안 자동으로 일했어요.<br><b class="gold">재산 +${fmt(info.gold)}원</b>${items.length ? `<br>장비 ${items.length}개 획득` : ''}${info.stamps ? `<br>결재 도장 +${info.stamps}개` : ''}${extra}`);
      if (items.length) dirty = true;
    }

    // ===== 장비·장신구 표시 도우미 =====
    const n2 = (v) => String(Math.round(v * 100) / 100);
    const statName = (k) => I.STATS[k].name;
    // 능력치 값 글자: 깡수치 "+12", %는 "+2.5%"
    const statText = (stat, value, kind) => (kind === 'flat' ? '+' + fmt(value) : '+' + n2(value) + I.STATS[stat].unit);
    const itemName = (it) => Eq.itemName(it);
    const gradeTag = (g) => `<span class="gtag" style="color:${GR[g].color}">${GR[g].name}</span>`;
    const slotGlyph = (slot) => I.SLOTS[slot].name[0];
    // 테마 도장 (인주색) · 세트 효과 글자 "재산 획득 +15%, 방치 보상 +20%"
    const themeStamp = (th) => `<span class="th-stamp">${I.THEMES[th].name}</span>`;
    const effText = (eff, m = 1) => Object.entries(eff).map(([k, v]) => `${statName(k)} +${n2(v * m)}${I.STATS[k].unit}`).join(', ');
    // 테마 한 줄: 4세트·7세트 효과. 켜진 건 형광펜 + 지금 등급 배율 적용 값, 안 켜진 건 일반 등급 기준 값
    const GM = I.SET.gradeMult;
    const setLines = (th) => {
      const ms = Eq.setMults(E.equippedItems(), th);
      return I.SET.counts.map((need, i) => `<div class="set-line ${ms[i] ? 'on' : ''}"><span>${need}세트</span><b>${effText(I.SET.effects[th][i], ms[i] || 1)}${ms[i] ? ` <small>(×${ms[i]})</small>` : ''}</b></div>`).join('') +
        `<div class="set-note">세트 장비 등급이 높을수록 커져요 · 일반 ×${GM[0]} ~ 신화 ×${GM[GM.length - 1]} (세트 중 가장 낮은 등급 기준)</div>`;
    };
    const altPresetHas = (id) => I.SLOT_KEYS.some((slot) => E.S.presetAlt[slot] === id);
    // 아이템 아이콘: 종류 그림(www/img/items/<type>.png) + 등급 색 배경
    function itemIcon(it, opt = {}) {
      const c = GR[it.grade].color;
      return `<div class="it-icon" style="--gc:${c};background:linear-gradient(160deg, ${c}70, ${c}1c 72%), #1d2422">
        <img class="it-img" src="img/items/${it.type}.png" alt="" loading="lazy" onerror="this.remove()">
        ${it.plus ? `<span class="pl">+${it.plus}</span>` : ''}
        ${!it.appraised ? '<span class="q">?</span>' : ''}
        ${it.protected ? `<span class="lk">${ICON.lock}</span>` : ''}
        ${!opt.noEq && E.isEquipped(it.id) ? '<span class="eqb">E</span>' : !opt.noEq && altPresetHas(it.id) ? `<span class="eqb alt">P${2 - E.S.preset}</span>` : ''}</div>`;
    }
    // 결과 카드 (뽑기·정산·합성)
    function itemCard(it, badges = []) {
      if (!it) return '<div class="g-card lost">가방 가득</div>';
      const isNew = recentNew.has(Eq.codexKey(it));
      const tags = [...badges, isNew ? 'NEW' : ''].filter(Boolean);
      return `<div class="g-card ${it.grade >= 3 ? 'hi' : ''}" style="--gc:${GR[it.grade].color}">
        ${itemIcon(it, { noEq: true })}
        <div class="g-name">${itemName(it)}</div>${gradeTag(it.grade)}
        ${tags.length ? `<div class="g-tags">${tags.map((t) => `<i>${t}</i>`).join('')}</div>` : ''}</div>`;
    }
    // 원·성과급 비용 표시 (모자라면 빨간색, 0.1초마다 갱신)
    const wonCost = (v) => `<b class="need" data-won="${v}">재산 ${fmt(v)}원</b>`;
    const bonusCost = (v) => `<b class="need" data-bonus="${v}">성과급 ${fmt(v)}개</b>`;

    // ----- 엔진 이벤트 → 화면 -----
    function renderLine() {
      const next = E.upcoming ? E.upcoming() : [];
      $("enemy-line").querySelectorAll("img").forEach((img, i) => {
        if (next[i]) { setSprite(img, "enemy:" + next[i][0], 3); img.hidden = false; } else img.hidden = true;
      });
    }
    bus.on('spawn', (en) => {
      const el = $('enemy');
      setSprite(el, (en.boss ? 'boss:' : 'enemy:') + en.key, 3);
      renderLine();
      enemyGhost.reset(); // 새 적: 잔상도 꽉 찬 상태로
      el.classList.remove('dead');
      el.classList.add('spawn');
      setTimeout(() => el.classList.remove('spawn'), 300);
      renderHud();
    });
    bus.on('hurt', onHurt);
    bus.on('hit', ({ dmg, crit }) => {
      if (E.fxOn('dmgNumbers')) floatText(fmt(dmg), crit ? 'crit' : '', 'enemy'); // 설정 [데미지 숫자]·저전력 모드면 안 띄움
      enemyGhost.hold();
      if (!E.fxOn('fx')) return; // 효과 끔·저전력: 맞는 모양·공격 자세 생략 (매번 화면 배치를 다시 계산하는 비싼 연출)
      const el = $('enemy');
      el.classList.add('hit');
      clearTimeout(hitTimer);
      hitTimer = setTimeout(() => el.classList.remove('hit'), 60);
      const p = $('player');
      p.classList.remove('type');
      void p.offsetWidth;
      p.classList.add("type");
      heroAttack(crit);
    });
    bus.on('kill', ({ gold }) => {
      if (E.fxOn('dmgNumbers')) floatText('+' + fmt(gold), 'gold', 'enemy');
      $('enemy').classList.add('dead');
      if (E.fxOn('fx')) sparks();
    });
    bus.on('bossDefeated', ({ stage }) => toast(`${stage}층 보스 격파!`));
    // 김대리 한마디: 승진·신기록·번아웃 때 꼭(위 알림이 사라진 뒤), 새 층에선 가끔 (사용자 2026-11-11)
    let sayAt = 0;
    let sayStage = E.S.stage;
    function mentorSay(kind, vars = {}) {
      const T = G.GuideText;
      const pool = ((T && T.SAY && T.SAY[kind]) || []).filter((l) => !/\{(\w+)\}/.test(l) || [...l.matchAll(/\{(\w+)\}/g)].every((m) => vars[m[1]] !== undefined));
      if (!pool.length || document.hidden) return;
      sayAt = performance.now();
      const text = pool[Math.floor(Math.random() * pool.length)].replace(/\{(\w+)\}/g, (_, k) => vars[k]);
      const old = document.querySelector('.mentor-say');
      if (old) old.remove();
      const el = document.createElement('div');
      el.className = 'mentor-say';
      el.innerHTML = '<img src="img/chars/mentor.png" alt=""><span></span>';
      el.querySelector('span').textContent = text;
      $('battle').appendChild(el);
      setTimeout(() => el.remove(), 3500);
    }
    bus.on('spawn', (en) => {
      const up = E.S.stage > sayStage;
      sayStage = E.S.stage;
      if (!up || en.boss || performance.now() - sayAt < 90000 || Math.random() > 0.12) return;
      const h = new Date().getHours();
      mentorSay(h >= 23 || h < 5 ? 'night' : 'normal');
    });
    bus.on('promote', ({ rank }) => setTimeout(() => mentorSay('record', { rank }), 1900));
    bus.on('bossRecord', ({ floor }) => setTimeout(() => mentorSay('record', { floor }), 1900));
    bus.on('promote', ({ rank }) => toast(`${rank}(으)로 승진!`));
    bus.on('fail', ({ reason, retreated }) => {
      setSprite($('player'), 'playerTired', 3);
      toast(FAIL_MSG[reason === 'burnout' && !retreated ? 'burnoutKeep' : reason] || '실패!');
      if (reason === 'burnout') setTimeout(() => mentorSay('burnout'), 1900);
    });
    bus.on('unlock', ({ key, name }) => (GU ? GU.unlockCard(key, name) : toast(`${name} 해금!`)));
    bus.on('probationFail', () => {
      showModal('수습 탈락...', `<div class="verdict-stamp">수습 탈락</div>입사하고 ${E.PROBATION.floors}층 안에서 번아웃 ${E.PROBATION.burnouts}번 — 이 회사는 무리였어요.<br><b>층 조건 없이 바로 다시 지원</b>할 수 있어요 (이번 회사 경력은 없고, 이직 횟수에도 안 세요)<br><small>회사 카드 중 1장은 지금 실력으로 버틸 수 있는 곳이에요 · 버텨서 ${E.S.runStart + E.PROBATION.floors}층까지 올라가면 수습 통과 → 경력 다시 받아요</small>`);
      renderPanel();
    });
    bus.on('probationClear', ({ floor, short }) => { toast(short ? `${floor}층 돌파 — 수습 통과! 경력은 ${E.careerNeedStage()}층부터 받아요` : `${floor}층 돌파 — 수습 통과! 이 회사 경력 다시 쌓여요`); renderPanel(); });
    bus.on('careerReady', ({ floor }) => { toast(`${floor}층 도달 — 이제 이직하면 경력 +${fmt(E.careerGain())}점`); renderPanel(); });
    bus.on('bossRecord', ({ floor, bonus }) => toast(`신기록 보스! ${floor}층 · 성과급 +${bonus}개`));
    // 정식판: 서버가 처치를 인정하지 않아 층을 서버 기록으로 맞춤 (조작·끊김)
    bus.on('progressFixed', ({ stage }) => toast(`서버 기록으로 맞췄어요 (${stage}층)`));
    bus.on('econFixed', () => toast('서버 기록으로 근로 강화·재산을 맞췄어요'));
    bus.on('achievement', ({ name }) => toast(`업적 달성: ${name} (위 업적 아이콘에서 받기)`));
    bus.on('towerClear', ({ floor, bonus }) => toast(`야근 타워 ${floor}층 돌파!${bonus ? ` 성과급 +${bonus}개` : ''}`));
    bus.on('towerEnd', ({ floor, reason }) => { toast(`타워 ${floor}층 ${reason === 'deadline' ? '마감 초과' : '번아웃'} · 도전 끝`); renderPanel(); });
    bus.on('towerSweep', ({ floors, bonus }) => toast(`새 달! 타워 ${floors}층까지 소탕 · 성과급 +${bonus}개`));
    bus.on('recover', () => setSprite($('player'), 'player', 3));
    // ----- 부서 장악: 별도 전투 알림 (docs/ui-spec.md 부서 장악 화면 4·5절) -----
    const SIDE_NAME = { conquest: '장악전', meeting: '외부 미팅', dungeon: '특근' };
    const END_MSG = { deadline: '마감 초과', burnout: '번아웃', quit: '도전 포기' };
    bus.on('sideStart', ({ kind }) => { toast(`${SIDE_NAME[kind]} 시작! 앱을 내리면 취소돼요 (재화는 그대로)`); renderPanel(); });
    bus.on('sideWave', ({ wave, of }) => toast(wave === of ? '부서장 등장!' : `웨이브 ${wave}/${of}`));
    bus.on('sideEnd', ({ kind, win, reason, pending }) => {
      if (!win) toast(`${SIDE_NAME[kind]} ${END_MSG[reason] || '실패'} · 다시 도전할 수 있어요${kind === 'dungeon' ? ' · 출입증은 그대로예요' : ''}`);
      else if (pending) toast('결과 확인 중…');
      renderPanel();
    });
    bus.on('sideResult', (r) => {
      if (!r.ok) { toast(`${r.reason} · 재화는 그대로예요`); return; }
      const name = (id) => G.Depts.BY_ID[id].name;
      if (r.kind === 'conquest') {
        showModal(r.promotion ? `${name(r.dept)} Lv ${r.lv} 승격!` : `${name(r.dept)} 장악!`,
          r.promotion ? '부서 생산량이 늘었어요' : `성과급 +${fmt(r.bonus)}개<br>이제 이 부서가 시간마다 재화를 만들어요.<br>외부 미팅과 특근도 열렸어요`);
        approveStamp(r.promotion ? '승격' : '장악');
      } else if (r.kind === 'meeting') toast(`명함 +${r.namecard}장 · 출입증 +${r.pass}장`);
      else toast(`${r.k}단계 클리어! ${gainText(r)}${r.first ? ` · 성과급 +${r.first}개` : ''}`);
      renderPanel(); renderHud();
    });
    bus.on('deptHeld', ({ id, held, full }) => toast(full ? `${G.Depts.BY_ID[id].name} 창고 가득! 가방을 비워 주세요` : `가방이 꽉 차서 장비 ${held}개를 창고에 맡겼어요`));
    bus.on('skill', ({ name }) => toast(`${name}!`));
    // 업무 스킬: 주인공 머리 위에 스킬 이름
    bus.on('workSkill', ({ key, name, grade }) => {
      if (E.fxOn('dmgNumbers')) floatText(name + '!', 'skname g' + grade, 'player');
      if (!E.fxOn('fx')) return;
      // 스킬 아이콘이 주인공 위에 잠깐 떴다 사라짐
      const layer = $('fx');
      const img = document.createElement('img');
      img.className = 'sk-pop';
      img.src = 'img/skills/' + key + '.png';
      const a = $('player').getBoundingClientRect(); const b = layer.getBoundingClientRect();
      img.style.left = (a.left - b.left + a.width / 2) + 'px';
      img.style.top = (a.top - b.top - 6) + 'px';
      layer.appendChild(img);
      setTimeout(() => img.remove(), 700);
    });
    bus.on('skillGain', ({ key, isNew }) => { if (isNew && E.S.maxStage >= G.Skills.CFG.unlock && Object.keys(E.S.skills.owned).length === 1) toast(`업무 스킬 열림! ${G.Skills.BY_KEY[key].name} 획득 (스킬 탭)`); });
    bus.on('prestige', ({ company, rank, bonus }) => { setSprite($('player'), 'player', 3); toast(`${company} ${rank}(으)로 이직 성공!${bonus ? ` 성과급 +${bonus}개` : ''}`); renderPanel(); });
    bus.on('reset', () => { setSprite($('player'), 'player', 3); closeDetail(); renderPanel(); });

    // 장비 이벤트
    bus.on('codexNew', ({ key }) => { recentNew.add(key); dirty = true; });
    bus.on('itemGained', ({ item, source }) => {
      dirty = true;
      if (source !== 'kill' && source !== 'boss') return; // 뽑기·상자·합성·정산은 결과 창에서 보여줌
      const key = Eq.codexKey(item);
      const isNew = recentNew.delete(key);
      const label = `${GR[item.grade].name} ${itemName(item)}`;
      toast(isNew ? `도감 등록! ${label} · 성과급 +${I.CODEX.bonus}개` : `${label} 획득!`);
    });
    bus.on('bagFull', ({ source, lost }) => {
      if (source === 'offline') { offlineLost += lost || 0; return; }
      const t = performance.now() / 1000;
      if (source === 'box' || t - lastBagFull >= UI_CFG.bagFullToastSec) {
        lastBagFull = t;
        toast('가방이 가득 찼어요');
      }
    });
    const ENH_MSG = { success: (it) => `강화 성공! ${itemName(it)} +${it.plus}`, stay: () => `강화 실패... 짬 +${I.ENHANCE.failJjam}개`,
      down: (it) => `강등... +${it.plus} · 짬 +${I.ENHANCE.failJjam}개`, break: (it) => (it.ruined ? `파괴! 흔적이 남았어요 · 짬 +${I.ENHANCE.breakJjam}개` : `파괴... 사라졌어요 · 짬 +${I.ENHANCE.breakJjam}개`) };
    bus.on('enhance', ({ item, result }) => { toast((ENH_MSG[result] || ENH_MSG.stay)(item)); if (result === 'success') approveStamp('성공'); });
    bus.on('merge', () => { dirty = true; });
    bus.on('appraise', () => { dirty = true; });

    // ----- 상단 + 전투 화면 -----
    // 전투 화면: 책상에 올린 반려를 주인공 발치에 작게 (그림이 오면 petFace 안을 img/pets/<key>.png로)
    let deskPetKey = '';
    function renderDeskPet() {
      const el = $('desk-pet');
      if (!el) return;
      const out = E.S.pet.out;
      const tier = out ? G.Pets.bestTier(E.S.pet, out) : -1;
      const k = out && G.Pets.isOpen(E.S.maxStage) ? out + tier : '';
      if (k === deskPetKey) return;
      deskPetKey = k;
      el.hidden = !k;
      el.innerHTML = k ? petFace(out, tier, 'tiny') : '';
      el.title = k ? G.Pets.BY_KEY[out].name : '';
    }
    function renderHud() {
      const S = E.S;
      renderDeskPet();
      setText($('company'), E.companyName());
      setText($('rank'), E.rankName());
      // 맨 위 재화 줄
      // 재화칸: 숫자 + 단위
      setText($('cur-gold'), fmt(S.gold) + '원');
      setText($('cur-bonus'), fmt(S.bonus) + '개');
      setText($('cur-corp'), fmt(S.corp) + '장');
      setText($('cur-jjam'), fmt(S.jjam) + '개');
      setText($('cur-shards'), fmt(S.shards) + '개');
      setText($('cur-career'), fmt(S.career) + '점');
      setText($('cur-stamps'), fmt(S.stamps) + '개');
      const tw = E.mode === 'tower';
      const sd = E.side;
      const dropRate = sd || tw ? 1 : E.dropRateAt();
      setText($('stage'), sd ? sideTitle(sd) : tw ? `야근 타워 ${E.tower.floor}층` : `${S.stage}층 · 최고 ${S.runMax}층${F.isBoss(S.stage) ? ' · 보스' : ''}${dropRate < 1 ? ` · 드롭 ${Math.round(dropRate * 100)}%` : ''}`);
      const mm = E.maxHp();
      const hpPct = 100 * Math.max(0, E.hp) / mm;
      setStyle($('mental-fill'), 'width', Math.round(hpPct * 10) / 10 + '%');
      hpGhost.follow(hpPct);
      setText($('mental-text'), E.isResting() ? `휴식 ${E.restTimer.toFixed(1)}초` : `${fmt(Math.max(0, E.hp))} / ${fmt(mm)}`);
      $('mental-text').classList.toggle('rest', E.isResting());
      const en = E.enemy;
      if (en) {
        setText($('enemy-name'), en.name);
        const enPct = Math.max(0, 100 * en.hp / en.maxHp);
        setStyle($('enemy-fill'), 'width', Math.round(enPct * 10) / 10 + '%');
        enemyGhost.follow(enPct);
        setText($('enemy-text'), fmt(Math.max(0, en.hp)));
      }
      // 별도 전투(장악전·미팅·특근)는 전체 제한시간이라 늘 표시
      setStyle($('boss-timer'), 'display', sd || (en && en.boss) ? 'block' : 'none');
      if (sd || (en && en.boss)) {
        const left = sd ? Math.max(0, sd.timer) : tw ? E.tower.timer : E.bossTimer;
        const total = sd ? sd.time : tw ? G.Meta.TOWER.time : E.bossTime();
        setStyle($('boss-fill'), 'width', Math.round(1000 * left / total) / 10 + '%');
        setText($('boss-text'), `마감까지 ${left.toFixed(1)}초`);
      }
      const adv = $('btn-advance');
      setText(adv, sd ? '도전 포기' : tw ? '타워 나가기' : S.autoAdvance ? '▶▶ 자동 진행' : '다음 층 도전!');
      adv.classList.toggle('off', !sd && !tw && !S.autoAdvance);
      for (const k in SKILLS) {
        const b = $('skill-' + k);
        const locked = E.skillLocked(k);
        const on = E.active[k] > 0;
        b.classList.toggle('locked', locked);
        b.classList.toggle('on', on);
        setText(b.querySelector('.cd'), locked ? `${SKILLS[k].unlock}층` : on ? Math.ceil(E.active[k]) + 's' : S.cd[k] > 0 ? String(Math.ceil(S.cd[k])) : '');
        b.classList.toggle('cooling', !locked && S.cd[k] > 0 && !on);
      }
      const sub = hooks.isSubscribed();
      const speed = $('btn-speed');
      speed.classList.toggle('locked', !sub);
      speed.classList.toggle('on', sub && S.speedOn);
      const auto = $('btn-autoskill');
      setStyle(auto, 'display', S.prestiges > 0 ? 'block' : 'none');
      auto.classList.toggle('on', S.autoSkill);
      const buffs = (E.active.coffee > 0 ? 'c' : '') + (E.active.night > 0 ? 'n' : '');
      if (buffs !== lastBuffs) {
        lastBuffs = buffs;
        $('player-buffs').innerHTML = (E.active.coffee > 0 ? SP.spriteImg('icon:coffee', 2) : '') + (E.active.night > 0 ? SP.spriteImg('icon:night', 2) : '');
      }
    }

    // ----- 아래 패널 (성장 / 이직 / 정보) -----
    function renderPanel() {
      const S = E.S;
      document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === tab));
      const body = $('panel-body');
      if (tab === 'grow') {
        body.innerHTML = `
          ${Object.keys(UPGRADES).map((k) => `
            <div class="row ${E.upgradeLocked(k) ? 'locked' : ''}">
              <div class="icon">${UP_IMG[k] ? `<img class="up-img" src="${UP_IMG[k]}" width="42" height="42" alt="">` : SP.spriteImg('icon:' + k, 3)}</div>
              <div class="info">
                <div class="name">${UPGRADES[k].name} <span class="lv" id="lv-${k}"></span></div>
                <div class="desc" id="desc-${k}"></div>
              </div>
              <div class="buy3">${BUY_MODES.map((m) => `<button class="buy sm" id="buy-${k}-${m}" data-buy="${k}" data-bm="${m}"></button>`).join('')}</div>
            </div>`).join('')}`;
      } else if (tab === 'quit') {
        const gain = E.careerGain();
        const block = E.applyBlock();
        body.innerHTML = `
          <div class="quit-box resign">
            <div class="rs-head"><b>사직서</b><span>${E.companyName()} 귀중</span></div>
            <dl class="rs-form">
              <div><dt>현 직장</dt><dd>${E.companyName()} <em>${COMPANY_GRADES[E.companyGrade()].name}</em></dd></div>
              <div><dt>유효 최고</dt><dd>${E.effRunMax()}층</dd></div>
              <div><dt>전투력</dt><dd>${fmt(E.power())}</dd></div>
              <div><dt>보유 경력</dt><dd class="pen">${fmt(S.career)}점</dd></div>
            </dl>
            <p class="rs-note">다른 회사에 지원해서 합격하면 이직! 처음부터 다시 시작하지만 <b>경력</b>으로 아래 특전을 영구 강화해요</p>
            ${E.probationFailed() ? `<div class="rs-flag">${ICON.warn} 수습 탈락 중 · ${E.S.runStart + E.PROBATION.floors}층까지 올라가면 수습 통과</div>` : ''}
            ${E.careerHint() ? `<div class="rs-flag">${ICON.warn} ${E.careerHint()}</div>` : ''}
            <button class="quit-btn" id="btn-quit" ${block ? 'disabled' : ''}>
              ${block ? block : `이직 지원하기 <small>경력 +${gain}점</small>`}
            </button>
          </div>
          <div class="perk-head"><b>경력 특전</b><span>이직해도 남아요</span></div>
          ${Object.keys(PERKS).map((k) => {
            const p = PERKS[k];
            const maxed = E.perkMaxed(k);
            const c = E.perkCost(k);
            return `
            <div class="row">
              <div class="icon">${SP.spriteImg('icon:' + p.icon, 3)}</div>
              <div class="info">
                <div class="name">${p.name} <span class="lv">Lv.${S.perk[k]}</span></div>
                <div class="desc">${p.desc}</div>
              </div>
              <button class="buy career-buy" data-perk="${k}" ${maxed || S.career < c ? 'disabled' : ''}>${maxed ? 'MAX' : `경력 ${c}점`}</button>
            </div>`;
          }).join('')}
          <div class="small center">이직 1회 이상 시 스킬 자동 사용 해금</div>`;
      } else if (tab === 'equip') {
        body.innerHTML = equipTab();
      } else if (tab === 'gacha') {
        body.innerHTML = gachaTab();
      } else if (tab === 'skill') {
        body.innerHTML = skillTab();
      } else {
        tab = 'office';
        body.innerHTML = officeTab();
      }
      document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === tab));
      const tip = GU && GU.tabTip(tab); // 탭 첫 방문: 사수 말풍선
      if (tip) body.insertAdjacentHTML('afterbegin', tip);
      dirty = false;
      renderPanelLive();
      if (toolMode) renderTool();
    }

    // ----- 사내 탭: 부서 장악·야근 타워 (도전 콘텐츠) -----
    function officeTab() {
      const card = (act, img, name, desc, unlocked, lockText, dot) => `
        <button class="office-card" data-act="${act}" ${unlocked ? '' : 'disabled'}>
          ${img.startsWith('<') ? img : `<img src="img/ui/${img}.png" alt="">`}
          <span class="oc-text"><b>${name}${dot ? '<i class="dot"></i>' : ''}</b><small>${unlocked ? desc : lockText}</small></span>
        </button>`;
      return `<div class="office-list">
        ${card('dept', 'tab-office', '부서 장악', '부서 생산 받기 · 장악전 · 외부 미팅 · 특근', E.isUnlocked('dept'), `최고 ${G.Depts.CFG.every}층에서 열려요`, deptDot())}
        ${card('net', NET_ICON, '인맥 관리', '명함으로 친분 쌓기 · 업무력·체력·재산·보스 데미지', E.netInfo().open, '첫 부서 장악(30층 장악전) 때 열려요', netDot())}
        ${card('tower', 'achieve', '야근 타워', '한 달 동안 오르는 층 · 영구 버프', E.isUnlocked('tower'), `최고 ${G.Meta.TOWER.unlock}층에서 열려요`, false)}
      </div>`;
    }

    // 효과음 켜기·음량 (이 기기에만 저장)
    function soundBox() {
      if (!SND || !SND.supported) return '';
      return `<div class="set-grid">
          <button class="set-tg ${SND.on ? 'on' : ''}" data-snd="on"><span>효과음</span><b>${SND.on ? 'ON' : 'OFF'}</b></button>
          <button class="set-tg ${SND.on ? 'on' : ''}" data-snd="vol" ${SND.on ? '' : 'disabled'}><span>음량</span><b>${SND.volName()}</b></button>
        </div>${E.S.settings.lowPower && SND.on ? '<div class="small">저전력 모드: 중요한 소리만 나요</div>' : ''}`;
    }
    // ----- 설정 창 (톱니): 설정·계정·기록·장비 보너스 -----
    function showSettings() {
      const S = E.S;
      showModal('설정', `<div class="settings">
          <div class="set-grid">${[['lowPower', '저전력 모드'], ['shake', '화면 흔들림'], ['dmgNumbers', '데미지 숫자'], ['fx', '타격 연출']].map(([k, n]) => {
            const on = E.fxOn(k) || (k === 'lowPower' && S.settings.lowPower);
            return `<button class="set-tg ${on ? 'on' : ''}" data-set="${k}" ${k !== 'lowPower' && S.settings.lowPower ? 'disabled' : ''}><span>${n}</span><b>${on ? 'ON' : 'OFF'}</b></button>`; }).join('')}</div>
          ${soundBox()}
          <div class="stat-line">최고 ${S.maxStage}층 · 이직 ${S.prestiges}회 · 전투력 <b>${fmt(E.power())}</b></div>
          ${accountBox()}
          ${bonusBox()}
          ${isDevHost() ? devBox() : ''}
          <button class="act-btn" data-act="tut-replay">튜토리얼 다시 보기</button>
          ${Y.online ? '' : '<button class="danger" data-set="reset">처음부터 다시하기</button>'}
          <div class="small center">자동 저장됨 · v0.6</div>
        </div>`);
      $('modal').classList.add('wide');
      $('modal-ok').textContent = '닫기';
    }

    // ----- 스킬 탭: 업무 스킬 칸 5개 + 목록·숙련 -----
    let skillPickSlot = null;
    let exchangeGrade = null; // 교환권 쓰는 중인 등급
    const SKG = (g) => GR[g];
    function skillTab() {
      const info = E.skillInfo();
      if (!info.unlocked) return `<div class="empty-note">업무 스킬은 최고 ${G.Skills.CFG.unlock}층에서 열려요.<br>열리면 "메일 회신"을 하나 드려요.</div>`;
      const slots = info.slots.map((s) => {
        const d = s.key && G.Skills.BY_KEY[s.key];
        if (!s.open) return `<button class="sk-slot locked" data-sks="${s.i}" disabled><span>${s.at}층</span></button>`;
        return `<button class="sk-slot ${skillPickSlot === s.i ? 'picking' : ''}" data-sks="${s.i}" style="--gc:${d ? SKG(d.grade).color : 'transparent'}">
          ${d ? `<img src="img/skills/${s.key}.png" alt=""><small>Lv.${E.S.skills.owned[s.key].lv}</small>` : '<span>빈 칸</span>'}</button>`;
      }).join('');
      const rows = info.list.map((s) => {
        const need = s.cost ? s.cost.cards : 0;
        return `<div class="sk-row ${s.owned || exchangeGrade === s.grade ? '' : 'dim'}${s.owned && skillPickSlot !== null ? ' pickable' : ''}" ${s.owned ? `data-key="${s.key}"` : ''} style="--gc:${SKG(s.grade).color}">
          <img class="sk-ic" src="img/skills/${s.key}.png" alt="">
          <button class="sk-main" data-skr="${s.key}" ${s.owned ? '' : 'disabled'}>
            <span class="sk-name">${gradeTag(s.grade)} <b>${s.name}</b>${s.owned ? ` <span class="lv">Lv.${s.lv}</span>` : ''}${s.slot >= 0 ? ' <i class="eqb">장착</i>' : ''}</span>
            <span class="sk-desc">${s.desc} · 쿨 ${s.cd}초</span>
          </button>
          ${exchangeGrade === s.grade && s.lv < G.Skills.CFG.maxLv ? `<button class="buy sk-up" data-skex="${s.key}"><span>교환권</span><b>받기</b></button>` : s.owned ? (s.cost ? `<button class="buy sk-up" data-skup="${s.key}" ${s.canLevel ? '' : 'disabled'}><span>카드 ${s.cards}/${need}</span><b>${fmt(s.cost.gold)}원</b></button>`
            : '<span class="sk-max">최대</span>') : '<span class="sk-max">미보유</span>'}
        </div>`;
      }).join('');
      return `<div class="sk-head"><span>보유 효과 업무력 <b>+${info.holdPct.toFixed(1)}%</b></span>
          <button class="chip-btn" data-act="sk-all">일괄 숙련</button><button class="chip-btn" data-act="sk-shop">스킬 뽑기</button></div>
        ${info.tickets.some((t) => t > 0) ? `<div class="sk-tickets"><span>교환권</span>${info.tickets.map((t, g) => (t > 0 ? `<button class="chip ${exchangeGrade === g ? 'on' : ''}" data-skx="${g}" ${t >= G.Skills.CFG.ticketPieces ? '' : 'disabled'}>${GR[g].name} <b>${t}/${G.Skills.CFG.ticketPieces}</b></button>` : '')).join('')}</div>` : ''}
        ${exchangeGrade !== null ? `<div class="bag-bar"><span>${GR[exchangeGrade].name} 스킬 중 받고 싶은 걸 골라요 (조각 ${G.Skills.CFG.ticketPieces}개 사용)</span><button class="chip-btn" data-skx="cancel">취소</button></div>` : ''}
        <div class="sk-slots">${slots}</div>
        <div class="small">${skillPickSlot === null ? '칸을 누르고 아래 스킬을 누르면 장착해요. 장착한 스킬은 자동으로 써요.' : `${skillPickSlot + 1}번 칸에 넣을 스킬을 눌러요 · 칸을 한 번 더 누르면 비워요`}</div>
        <div class="sk-list">${rows}</div>`;
    }
    function onSkillClick(t) {
      if (t.dataset.skx !== undefined) { exchangeGrade = t.dataset.skx === 'cancel' || exchangeGrade === Number(t.dataset.skx) ? null : Number(t.dataset.skx); renderPanel(); return; }
      if (t.dataset.skex) {
        const key = t.dataset.skex;
        exchangeGrade = null;
        Y.skillExchange(key).then((r) => { toast(r.ok ? `${G.Skills.BY_KEY[key].name} 카드 +1` : r.reason); renderPanel(); });
        return;
      }
      if (t.dataset.sks !== undefined) {
        const i = Number(t.dataset.sks);
        if (skillPickSlot === i) { if (E.S.skills.slots[i]) Y.skillUnequip(i); skillPickSlot = null; } else skillPickSlot = i;
        renderPanel();
      } else if (t.dataset.skr) {
        if (skillPickSlot === null) { toast('먼저 위의 칸을 눌러요'); return; }
        Y.skillEquip(t.dataset.skr, skillPickSlot).then((r) => { if (!r.ok) toast(r.reason); renderPanel(); });
        skillPickSlot = null;
      } else if (t.dataset.skup) {
        const key = t.dataset.skup;
        Y.skillLevelUp(key).then((r) => { toast(r.ok ? `${G.Skills.BY_KEY[key].name} Lv.${r.lv}!` : r.reason); renderPanel(); renderHud(); });
      }
    }

    // ----- 장비 탭 -----
    function sortedItems() {
      const order = Object.fromEntries(I.SLOT_KEYS.map((k, i) => [k, i]));
      const list = E.S.items.slice();
      if (bagSort === 'new') return list.sort((a, b) => b.id - a.id);
      return list.sort((a, b) => b.grade - a.grade || order[a.slot] - order[b.slot] || a.type.localeCompare(b.type) || b.plus - a.plus || b.id - a.id);
    }

    // 장비 탭 맨 위 [장비 | 반려] 전환 (명세 ④ 30절 추천안)
    function equipViewSeg() {
      const open = G.Pets.isOpen(E.S.maxStage);
      return `<div class="seg seg2 eq-view" role="tablist">
        <button data-act="ev-gear" role="tab" aria-selected="${equipView === 'gear'}" class="${equipView === 'gear' ? 'active' : ''}">장비</button>
        <button data-act="ev-pet" role="tab" aria-selected="${equipView === 'pet'}" class="${equipView === 'pet' ? 'active' : ''} ${open ? '' : 'locked'}">${open ? '' : ICON.lock} 반려</button></div>`;
    }
    function equipTab() {
      if (equipView === 'pet' && G.Pets.isOpen(E.S.maxStage)) return equipViewSeg() + petTab();
      equipView = 'gear';
      return equipViewSeg() + gearTab();
    }
    function gearTab() {
      const S = E.S;
      const eqd = E.equippedItems();
      const slots = I.SLOT_KEYS.map((slot) => {
        const it = eqd[slot];
        return `<button class="eq-slot" data-slot="${slot}">
          ${it ? itemIcon(it, { noEq: true }) : `<div class="it-icon empty"><span class="g">${slotGlyph(slot)}</span></div>`}
          <span class="eq-name">${I.SLOTS[slot].name}</span></button>`;
      }).join('');
      const items = sortedItems().filter((it) => bagFilter === 'all' || (I.SLOTS[bagFilter] ? it.slot === bagFilter : I.SLOTS[it.slot].kind === bagFilter));
      const need = I.DROP.shardsPerBox;
      const codexN = Object.keys(S.codex).filter((k) => S.codex[k]).length;
      const mk = E.marketStatus();
      return `
        <div class="buy-mode eq-preset">${[0, 1].map((i) => `<button ${S.preset === i ? 'class="active"' : 'data-act="preset"'}>프리셋 ${i + 1}</button>`).join('')}</div>
        <div class="eq-slots">${slots}</div>
        ${setChips()}
        <div class="eq-tools">
          <button data-act="box" id="btn-box">장신구 상자<small>조각 ${fmt(S.shards)}/${need}</small></button>
          <button data-act="market">양파나라<small>${S.market.list.length}/${I.MARKET.slots}${mk.list.some((r) => r.left <= 0) ? ' · 판매됨' : ''}</small></button>
          <button data-act="codex">도감<small>${codexN}/${I.CODEX_SIZE}</small></button>
          <button data-act="auto" class="${S.autoAppraise ? 'on' : ''}">자동 감정<small>${S.autoAppraise ? '켜짐' : '꺼짐'}</small></button>
          <button data-act="stats">스탯<small>능력치</small></button>
        </div>
        ${bagBar()}
        <div class="bag-head">
          <div>가방 <b class="${items.length >= E.bagSize() ? 'full' : ''}">${S.items.length}</b>/${E.bagSize()}
            ${E.bagPrice() === null ? '' : `<button class="chip-btn" data-act="bag">+${I.BAG.step}칸</button>`}</div>
          <div class="buy-mode">${[['all', '전체'], ['equip', '장비'], ['accessory', '장신구']].map(([k, n]) => `<button data-filter="${k}" class="${bagFilter === k ? 'active' : ''}">${n}</button>`).join('')}
            <button data-filter="slot" class="${I.SLOTS[bagFilter] ? 'active' : ''}">${I.SLOTS[bagFilter] ? I.SLOTS[bagFilter].name : '부위'}</button>
            <button data-sort="${bagSort === 'grade' ? 'new' : 'grade'}">${bagSort === 'grade' ? '등급순' : '최신순'}</button></div>
        </div>
        ${items.length
          ? `<div class="bag-grid">${items.slice(0, bagShow).map((it) => `<button class="bag-cell ${bagPick.has(it.id) ? 'picked' : ''} ${bagMode !== 'view' && !canPick(it) ? 'dim' : ''}" data-item="${it.id}">${itemIcon(it)}${!E.isEquipped(it.id) && E.isUpgrade(it) ? '<i class="up">▲</i>' : ''}</button>`).join('')}</div>${moreBtn(items.length - bagShow, 'bag-more')}`
          : '<div class="empty-note">아직 장비가 없어요.<br>업무를 처리하면 가끔 장비가 나오고, 보스는 꼭 하나 줘요.</div>'}
        <div class="bag-dock">
          <button data-act="rec-equip">추천 장착</button>
          <button data-act="bulk-enh">강화</button>
          <button data-act="tool-merge">합성</button>
          <button data-act="tool-dis">분해</button>
        </div>`;
    }

    // 가방 선택 모드: 고를 수 있는 아이템인지
    function canPick(it) {
      if (E.isKept(it.id) || it.protected) return false;
      if (bagMode === 'sell') return bagPick.has(it.id) || bagPick.size < E.marketSlotsFree();
      if (bagMode === 'merge') {
        if (it.ruined || it.grade >= GR.length - 1) return false;
        const first = bagPick.size ? E.item([...bagPick][0]) : null;
        return !first || bagPick.has(it.id) || (first.slot === it.slot && first.grade === it.grade);
      }
      return true;
    }
    function bagBar() {
      if (bagMode === 'view') return '';
      const list = [...bagPick].map((id) => E.item(id)).filter(Boolean);
      if (bagMode === 'merge') {
        const g = list[0] ? list[0].grade : null;
        const rate = g === null ? null : Eq.mergeRate(E.S.mergeFail[g]);
        return `<div class="bag-bar"><span>${list.length ? `${I.SLOTS[list[0].slot].name}·${GR[g].name} ${list.length}/${I.MERGE.count} · 성공 ${Math.round(rate * 100)}%` : `같은 부위·등급 ${I.MERGE.count}개를 골라요`}</span>
          <button class="chip-btn" data-act="bm-auto">자동 선택</button>
          <button class="chip-btn ready" data-act="bm-go" ${list.length === I.MERGE.count ? '' : 'disabled'}>합성하기</button></div>`;
      }
      if (bagMode === 'sell') {
        const price = list.reduce((a, it) => a + I.MARKET.priceOf(it.grade, it.plus), 0);
        return `<div class="bag-bar"><span>양파나라에 올리기 ${list.length}/${E.marketSlotsFree()} · 성과급 +${price}개</span>
          <button class="chip-btn ready" data-act="bm-go" ${list.length ? '' : 'disabled'}>올리기</button></div>`;
      }
      const gold = list.reduce((a, it) => a + Eq.dismantleValue(it, E.costBase()), 0);
      return `<div class="bag-bar"><span>${list.length}개 선택 · 재산 +${fmt(gold)}원</span>
        <button class="chip-btn ready" data-act="bm-go" ${list.length ? '' : 'disabled'}>분해하기</button></div>`;
    }
    function bagAct(a) {
      if (a === 'bm-merge' || a === 'bm-dis') {
        const m = a === 'bm-merge' ? 'merge' : 'dis';
        bagMode = bagMode === m ? 'view' : m;
        bagPick = new Set();
      } else if (a === 'bm-auto') {
        // 고른 게 있으면 그 부위·등급, 없으면 묶음이 되는 가장 낮은 등급
        const first = bagPick.size ? E.item([...bagPick][0]) : null;
        const ok = (x) => !E.isKept(x.id) && !x.protected && !x.ruined && x.grade < GR.length - 1;
        let pool = [];
        if (first) pool = E.S.items.filter((x) => ok(x) && x.slot === first.slot && x.grade === first.grade);
        else {
          for (let g = 0; g < GR.length - 1 && pool.length < I.MERGE.count; g++) {
            for (const slot of I.SLOT_KEYS) {
              const p = E.S.items.filter((x) => ok(x) && x.slot === slot && x.grade === g);
              if (p.length >= I.MERGE.count) { pool = p; break; }
            }
          }
        }
        pool.sort((x, y) => x.plus - y.plus || x.id - y.id);
        if (first) pool = [first, ...pool.filter((x) => x.id !== first.id)];
        if (pool.length < I.MERGE.count) { toast('같은 부위·등급 4개 묶음이 없어요'); return; }
        bagPick = new Set(pool.slice(0, I.MERGE.count).map((x) => x.id));
      } else if (a === 'bm-go') {
        const ids = [...bagPick];
        if (bagMode === 'sell') {
          Y.marketList(ids).then((r) => { bagPick = new Set(); bagMode = 'view'; toast(r.ok ? `양파나라에 ${r.added.length}개 올렸어요` : r.reason); renderPanel(); });
          return;
        }
        if (bagMode === 'merge') {
          const g = E.item(ids[0]).grade;
          askConfirm('합성할까요?', `성공률 <b class="gold">${Math.round(Eq.mergeRate(E.S.mergeFail[g]) * 100)}%</b><br>성공하면 <b>${itemName(E.item(ids[0]))}</b>(처음 고른 장비 종류)로 나와요<br>실패하면 재료 ${I.MERGE.count}개가 사라지고 짬 +${I.MERGE.failJjam}개`, '합성하기', () => {
            Y.merge(ids, E.item(ids[0]).type).then((r) => {
              bagPick = new Set();
              if (!r.ok) toast(r.reason);
              else if (r.success) { showModal('합성 성공!', `<div class="g-grid one">${itemCard(r.item)}</div>`); recentNew.clear(); }
              else toast(`합성 실패... 짬 +${r.jjam}개`);
              renderPanel();
            });
          });
        } else {
          const gold = ids.reduce((a2, id) => a2 + Eq.dismantleValue(E.item(id), E.costBase()), 0);
          askConfirm('분해할까요?', `${ids.length}개 · <b class="gold">재산 +${fmt(gold)}원</b>`, '분해하기', () => {
            Y.dismantle(ids).then((r) => {
              bagPick = new Set();
              toast(r.ok ? `${r.count}개 분해 · 재산 +${fmt(r.gold)}원` : r.reason);
              renderPanel();
            });
          });
        }
        return;
      } else if (a === 'bulk-merge') { showBulkMerge(); return; }
      else if (a === 'preset') {
        if (bagMode !== 'view') return;
        const r = E.presetSwap();
        toast(`프리셋 ${r.preset + 1}로 바꿨어요${r.missing ? ` · 없어진 장비 ${r.missing}칸은 비웠어요` : ''}`);
      } else if (a === 'rec-equip') {
        const r = E.recommendEquip();
        if (!r.ok) { toast(r.reason); return; }
        showModal('추천 장착', `<div class="small">부위마다 주 능력치가 가장 높은 장비로 바꿨어요</div><div class="g-grid">${r.changes.map((c) => itemCard(E.item(c.to))).join('')}</div>`);
      } else if (a === 'bulk-enh') { showBulkEnhance(); return; }
      else if (a === 'market') { showMarket(); return; }
      else if (a === 'mk-claim') {
        Y.marketClaim().then((r) => {
          const who = BUYERS[Math.floor(Math.random() * BUYERS.length)];
          if (r.ok) snd('coin');
          toast(r.ok ? (r.count ? `${who} 외 ${Math.max(0, r.count - 1)}명이 사갔어요 · 성과급 +${r.bonus}개` : `성과급 +${r.bonus}개`) : r.reason);
          showMarket(); renderPanel(); renderHud();
        });
        return;
      }
      else if (a === 'mk-add') { $('modal').classList.remove('show'); bagMode = 'sell'; bagPick = new Set(); }
      renderPanel();
    }
    // ----- 분해·합성 창 (위에 뜨는 창 안에서 가방을 열고 고르기) -----
    let toolMode = null; // 'dis' | 'merge'
    let toolPick = new Set();
    function toolCan(it) {
      if (E.isKept(it.id) || it.protected) return false;
      if (toolMode === 'merge') {
        if (it.ruined || it.grade >= GR.length - 1) return false;
        const first = toolPick.size ? E.item([...toolPick][0]) : null;
        return !first || toolPick.has(it.id) || (first.slot === it.slot && first.grade === it.grade);
      }
      return true;
    }
    function showTool(mode) {
      toolMode = mode;
      toolShow = BAG_PAGE;
      toolPick = new Set();
      renderTool();
    }
    function closeTool() {
      toolMode = null;
      $('layer').classList.remove('show');
    }
    function renderTool() {
      if (!toolMode) return;
      const items = sortedItems().filter(toolCan);
      const list = [...toolPick].map((id) => E.item(id)).filter(Boolean);
      let info;
      let btns;
      if (toolMode === 'merge') {
        const g = list[0] ? list[0].grade : null;
        info = list.length ? `${I.SLOTS[list[0].slot].name}·${GR[g].name} <b>${list.length}/${I.MERGE.count}</b> · 성공 ${Math.round(Eq.mergeRate(E.S.mergeFail[g]) * 100)}%`
          : `같은 부위·등급 ${I.MERGE.count}개를 골라요`;
        btns = `<button class="act-btn" data-tool="auto">자동 선택</button>
          <button class="act-btn gold-btn" data-tool="go" ${list.length === I.MERGE.count ? '' : 'disabled'}>선택 합성</button>
          <button class="act-btn" data-tool="bulk">일괄 합성</button>`;
      } else {
        const gold = list.reduce((a, it) => a + Eq.dismantleValue(it, E.costBase()), 0);
        info = `<b>${list.length}개</b> 선택 · 재산 +${fmt(gold)}원`;
        btns = `<button class="act-btn gold-btn" data-tool="go" ${list.length ? '' : 'disabled'}>선택 분해</button>
          <button class="act-btn" data-tool="bulk">일괄 분해</button>`;
      }
      $('layer-box').innerHTML = `<div class="layer-head"><div class="it-name">${toolMode === 'merge' ? '합성' : '분해'}</div>
          <button class="sheet-x" data-tool="close" aria-label="닫기">✕</button></div>
        <div class="small">장착·보호 중인 건 빼고 보여요</div>
        <div class="tool-grid">${items.length ? `<div class="bag-grid">${items.slice(0, toolShow).map((it) => `<button class="bag-cell ${toolPick.has(it.id) ? 'picked' : ''}" data-tpick="${it.id}">${itemIcon(it)}</button>`).join('')}</div>${moreBtn(items.length - toolShow, 'tool-more')}`
          : '<div class="empty-note">고를 수 있는 아이템이 없어요</div>'}</div>
        <div class="stat-line">${info}</div>
        <div class="act-row">${btns}</div>`;
      $('layer').classList.add('show');
    }
    function onToolClick(t) {
      if (t.dataset.tpick) {
        const id = Number(t.dataset.tpick);
        if (toolPick.has(id)) toolPick.delete(id);
        else if (toolMode === 'merge' && toolPick.size >= I.MERGE.count) { toast(`${I.MERGE.count}개까지 골라요`); return; }
        else toolPick.add(id);
        renderTool();
        return;
      }
      if (t.dataset.act === 'tool-more') {
        const box = t.closest('.tool-grid');
        const y = box ? box.scrollTop : 0;
        toolShow += BAG_PAGE;
        renderTool();
        const nb = $('layer-box').querySelector('.tool-grid');
        if (nb) nb.scrollTop = y;
        return;
      }
      const a = t.dataset.tool;
      if (a === 'close') closeTool();
      else if (a === 'bulk') { if (toolMode === 'merge') showBulkMerge(); else showBulk(); }
      else if (a === 'auto') {
        const first = toolPick.size ? E.item([...toolPick][0]) : null;
        const ok = (x) => !E.isKept(x.id) && !x.protected && !x.ruined && x.grade < GR.length - 1;
        let pool = [];
        if (first) pool = E.S.items.filter((x) => ok(x) && x.slot === first.slot && x.grade === first.grade);
        else {
          for (let g = 0; g < GR.length - 1 && pool.length < I.MERGE.count; g++) {
            for (const slot of I.SLOT_KEYS) {
              const p = E.S.items.filter((x) => ok(x) && x.slot === slot && x.grade === g);
              if (p.length >= I.MERGE.count) { pool = p; break; }
            }
          }
        }
        pool.sort((x, y) => x.plus - y.plus || x.id - y.id);
        if (first) pool = [first, ...pool.filter((x) => x.id !== first.id)];
        if (pool.length < I.MERGE.count) { toast(`같은 부위·등급 ${I.MERGE.count}개 묶음이 없어요`); return; }
        toolPick = new Set(pool.slice(0, I.MERGE.count).map((x) => x.id));
        renderTool();
      } else if (a === 'go') {
        const ids = [...toolPick];
        if (toolMode === 'merge') {
          const g = E.item(ids[0]).grade;
          askConfirm('합성할까요?', `성공률 <b class="gold">${Math.round(Eq.mergeRate(E.S.mergeFail[g]) * 100)}%</b><br>성공하면 <b>${itemName(E.item(ids[0]))}</b>(처음 고른 장비 종류)로 나와요<br>실패하면 재료 ${I.MERGE.count}개가 사라지고 짬 +${I.MERGE.failJjam}개`, '합성하기', () => {
            Y.merge(ids, E.item(ids[0]).type).then((r) => {
              toolPick = new Set();
              if (!r.ok) toast(r.reason);
              else if (r.success) { showModal('합성 성공!', `<div class="g-grid one">${itemCard(r.item)}</div>`); recentNew.clear(); }
              else toast(`합성 실패... 짬 +${r.jjam}개`);
              renderTool(); renderPanel();
            });
          });
        } else {
          const gold = ids.reduce((s2, id) => s2 + Eq.dismantleValue(E.item(id), E.costBase()), 0);
          askConfirm('분해할까요?', `${ids.length}개 · <b class="gold">재산 +${fmt(gold)}원</b>`, '분해하기', () => {
            Y.dismantle(ids).then((r) => {
              toolPick = new Set();
              toast(r.ok ? `${r.count}개 분해 · 재산 +${fmt(r.gold)}원` : r.reason);
              renderTool(); renderPanel(); renderHud();
            });
          });
        }
      }
    }

    // 일괄 강화: 목표(+1~+10, 강등·파괴 없는 구간)·대상(장착 중 / 전부)
    let bulkEnh = { target: 5, scope: 'equipped' };
    function showBulkEnhance() {
      const max = E.ENHANCE_ALL_MAX;
      showModal('일괄 강화', `<div class="small">+${max}까지는 강등·파괴가 없어요. 싼 것부터 한 단계씩 고르게 올리고, 재산이 모자라면 멈춰요.</div>
        <div class="act-row"><span class="small">목표 <b>+${bulkEnh.target}</b></span>
          <button class="act-btn" data-be="t-">−</button><button class="act-btn" data-be="t+">+</button></div>
        <div class="act-row">
          <button class="act-btn ${bulkEnh.scope === 'equipped' ? 'on' : ''}" data-be="s-eq">장착 중만</button>
          <button class="act-btn ${bulkEnh.scope === 'all' ? 'on' : ''}" data-be="s-all">가방 전부 (보호 제외)</button></div>
        <div class="act-row"><button class="act-btn gold-btn" data-be="go">일괄 강화</button></div>
        <div class="small">+5부터는 결재 도장이 들어요 (보유 ${fmt(E.S.stamps)}개)</div>`);
      $('modal-ok').textContent = '닫기';
    }
    $('modal-body').addEventListener('click', (e) => {
      const t = e.target.closest('button[data-be]');
      if (!t) return;
      const a = t.dataset.be;
      if (a === 't-' || a === 't+') { bulkEnh.target = Math.max(1, Math.min(E.ENHANCE_ALL_MAX, bulkEnh.target + (a === 't+' ? 1 : -1))); showBulkEnhance(); return; }
      if (a === 's-eq' || a === 's-all') { bulkEnh.scope = a === 's-eq' ? 'equipped' : 'all'; showBulkEnhance(); return; }
      Y.enhanceAll(bulkEnh).then((r) => {
        if (!r.ok) { toast(r.reason); return; }
        showModal('일괄 강화 결과', `<div class="stat-line">장비 ${r.items}개 · 시도 ${r.tries}회 · 성공 ${r.ups}회</div>
          <div class="stat-line">재산 ${fmt(r.gold)}원 · 도장 ${r.stamps || 0}개 · ${r.stop === 'gold' ? '재산이 모자라서 멈춤' : r.stop === 'stamp' ? '도장이 모자라서 멈춤' : `목표 +${bulkEnh.target} 도달`}</div>`);
        renderPanel();
      });
    });

    // 가방 확장 창: 막대를 끌어서 몇 칸(100칸 단위) 늘릴지 고르고 한 번에 구매 (2026-10-27 사용자)
    function showBagBuy() {
      const S = E.S;
      const left = I.BAG.maxBuys - S.bagBuys;
      if (left <= 0) { toast('가방을 더 늘릴 수 없어요'); return; }
      const total = (k) => { let c = 0; for (let i = 0; i < k; i++) c += I.BAG.price(S.bagBuys + i); return c; };
      // 한 번 살 때 성과급 또는 법카 한쪽으로만 냄 (성과급이 되면 성과급, 아니면 법카) → 실제 결제 순서대로 따져봄
      const canBuy = (k) => { let b = S.bonus, c = S.corp; for (let i = 0; i < k; i++) { const p = I.BAG.price(S.bagBuys + i); if (b >= p) b -= p; else if (c >= p) c -= p; else return false; } return true; };
      let k = 1;
      while (k < left && canBuy(k + 1)) k++;
      const line = (n) => `<b>+${n * I.BAG.step}칸</b> (${E.bagSize() + n * I.BAG.step}칸) · 성과급·법카 <b class="need${canBuy(n) ? '' : ' short'}">${fmt(total(n))}</b>`;
      askConfirm('가방 늘리기', `<div class="bag-buy">
          <input type="range" id="bag-range" min="1" max="${left}" step="1" value="${k}" aria-label="늘릴 칸 수">
          <div class="bag-ticks">${Array.from({ length: left }, (_, i) => `<span>+${(i + 1) * I.BAG.step}</span>`).join('')}</div>
          <div class="stat-line center" id="bag-line">${line(k)}</div>
          <div class="small center">한 번에 성과급이나 법카 한쪽으로 내요 (성과급 먼저) · 보유 성과급 ${fmt(S.bonus)} · 법카 ${fmt(S.corp)}</div></div>`, '늘리기', async () => {
        const n = k;
        let done = 0;
        let last = null;
        for (let i = 0; i < n; i++) {
          const price = E.bagPrice();
          if (price === null) break;
          last = await Y.buyBag(S.bonus >= price ? 'bonus' : 'corp');
          if (!last.ok) break;
          done++;
        }
        if (done) toast(`가방 ${last && last.size ? last.size : E.bagSize()}칸!`);
        else if (last) toast(last.reason || '살 수 없어요');
        renderPanel(); renderHud();
      });
      $('bag-range').addEventListener('input', (e) => { k = +e.target.value; $('bag-line').innerHTML = line(k); });
    }
    // 양파나라 (중고거래 판매소, 시스템 손님이 사감)
    // 시간(시) → "n분" / "n시간 m분"
    function hoursText(h) {
      const m = Math.round(h * 60);
      if (m < 60) return m + '분';
      return Math.floor(m / 60) + '시간' + (m % 60 ? ` ${m % 60}분` : '');
    }
    const BUYERS = ['거래처 이사님', '사장님 조카', '경비실 아저씨', '야근 동기', '옆 부서 김대리', '퇴사한 박과장', '택배 기사님', '신입 사원 이인턴', '팀장님', '인사팀 주임', '경영지원팀 차장', '재무팀 부장', '마케팅팀 대리', '개발팀 과장', '기획팀 주임', '총무팀 사원', '영업팀 이사', '전산팀 팀장', '홍보팀 대리', '프리랜서', '칼퇴하고싶다', '불꽃개발자', '야근장인', '회사생활3년차', '주말만기다림', '월급받는날', '퇴근길행복', '커피수혈중', '회식은1차만', '야근왕등극', '사무실화분', '월요병환자', '점심뭐먹지', '연차아껴씀', '탕비실요정', '엑셀장인', '출근길만원버스', '금요일5시59분', '재택희망', '정시퇴근러', '키보드수집가', '단톡방눈팅족', '이직준비중', '내일부터운동', '모니터두대', '사직서품은자', '장비덕후', '알람다섯개', '반차쓴날', '결재기다림']; // content/market.json buyers + nicknames
    function showMarket() {
      const st = E.marketStatus();
      const left = (s) => (s <= 0 ? '<b class="gold">팔림</b>' : '손님 기다리는 중'); // 남은 시간은 안 보여줌 (랜덤, 2026-10-27 사용자)
      const rows = st.list.map((r) => `<div class="stat-line">${gradeTag(r.grade)} ${I.TYPE_BY_ID[r.type] ? I.TYPE_BY_ID[r.type].name : ''}${r.plus ? ' +' + r.plus : ''} · 성과급 ${r.price}개 · ${left(r.left)}</div>`).join('');
      showModal(`양파나라 ${st.list.length}/${I.MARKET.slots}`, `<div class="small">안 쓰는 장비를 올려두면 동네 사람들이 사가요. 강화를 많이 할수록 비싸게 팔려요.${st.pending ? ` 밀려 있던 성과급 ${st.pending}개도 같이 받아요.` : ''}</div>
        ${rows || '<div class="small">올린 물건이 없어요</div>'}
        <div class="act-row"><button class="act-btn" data-act="mk-add" ${st.free ? '' : 'disabled'}>올리기 (가방에서 고르기)</button>
        <button class="act-btn gold-btn" data-act="mk-claim" ${st.list.some((r) => r.left <= 0) || st.pending ? '' : 'disabled'}>모두 받기</button></div>
        <div class="small">판매 시간: ${GR.map((g, i) => `${g.name} ${hoursText(I.MARKET.hours[i] * I.MARKET.randMin)}~${hoursText(I.MARKET.hours[i] * I.MARKET.randMax)}`).join(' · ')} 사이 랜덤</div>`);
      $('modal-ok').textContent = '닫기';
    }
    $('modal-body').addEventListener('click', (e) => {
      const t = e.target.closest('button[data-act^="mk-"]');
      if (t && !t.disabled) bagAct(t.dataset.act);
    });

    function showBulkMerge() {
      const btns = GR.slice(0, -1).map((g, gi) => {
        const n = E.mergeCount(gi);
        return `<button class="pick-btn" data-bm="${gi}" ${n ? '' : 'disabled'}>
          <span style="color:${g.color}">${g.name}</span> 이하 <b>${n}묶음</b><small>성공률 ${Math.round(Eq.mergeRate(E.S.mergeFail[gi]) * 100)}%</small></button>`;
      }).join('');
      showModal('일괄 합성', `<div class="small">같은 부위·등급 ${I.MERGE.count}개씩, 낮은 등급부터 합성해요. 장착·보호 중인 건 빼요.<br>합성으로 나온 아이템도 다음 등급 재료로 다시 써요. 실패하면 재료가 사라져요.</div><div class="pick-list">${btns}</div>`);
      $('modal-ok').textContent = '닫기';
    }
    $('modal-body').addEventListener('click', (e) => {
      const t = e.target.closest('button[data-bm]');
      if (!t || t.disabled) return;
      const g = Number(t.dataset.bm);
      askConfirm('일괄 합성할까요?', `${gradeTag(g)} 이하 · 장착·보호 제외<br>실패하면 그 묶음의 재료는 사라져요`, '합성하기', () => {
        Y.mergeAll(g).then((r) => {
          if (!r.ok) { toast(r.reason); return; }
          recentNew.clear();
          const best = r.items.length ? Math.max(...r.items.filter((x) => E.item(x.id)).map((x) => x.grade), 0) : null;
          showModal('일괄 합성 결과', `<div class="stat-line">합성 ${r.merges}번 · 성공 <b>${r.success}</b> · 실패 ${r.fail}</div>
            ${r.fail ? `<div class="stat-line">짬 +${r.jjam}개</div>` : ''}
            ${best !== null && r.items.length ? `<div class="small">가장 높은 결과 ${gradeTag(best)}</div>` : ''}`);
          renderPanel();
        });
      });
    });

    // 장비 탭: 장착한 테마별 개수 (4개 이상이면 도장 찍힘). 누르면 세트 효과 전체
    function setChips() {
      const n = Eq.setCounts(E.equippedItems());
      const list = n.map((c, th) => [c, th]).filter(([c]) => c > 0).sort((a, b) => b[0] - a[0]);
      return `<button class="set-chips" data-act="sets">${list.length
        ? list.map(([c, th]) => `<span class="set-chip ${c >= I.SET.counts[0] ? 'on' : ''}">${I.THEMES[th].name} <b>${c}</b>/${c >= I.SET.counts[0] ? 7 : I.SET.counts[0]}</span>`).join('')
        : '<span class="set-chip">같은 테마 4개·7개를 끼면 세트 효과</span>'}<i>세트 효과</i></button>`;
    }
    function showSets() {
      const n = Eq.setCounts(E.equippedItems());
      showModal('세트 효과', `<div class="small">같은 테마를 4개 끼면 4세트, 7개 모두 끼면 4세트와 7세트 효과를 함께 받아요</div>
        ${I.THEMES.map((th, ti) => `<div class="it-sec set-sec"><div class="it-sec-t">${themeStamp(ti)} ${th.tip} · 지금 ${n[ti]}/7</div>${setLines(ti)}</div>`).join('')}`);
      $('modal-ok').textContent = '닫기';
    }

    // 도감 보기
    function showCodex() {
      const S = E.S;
      const n = Object.keys(S.codex).filter((k) => S.codex[k]).length;
      const done = Eq.themeCodex(S.codex);
      const rows = I.THEMES.map((th, ti) => {
        const types = I.SLOT_KEYS.map((slot) => I.TYPES[slot][ti]);
        const got = types.filter((t) => GR.some((_, gi) => S.codex[`${t.id}:${gi}`])).length;
        return `<div class="cx-theme ${done[ti] ? 'done' : ''}">${themeStamp(ti)}<span>${got}/7 종류</span>
          <b>${done[ti] ? `완성 · ${statName(I.THEME_CODEX.stat)} +${I.THEME_CODEX.pct}%` : `7종 모으면 ${statName(I.THEME_CODEX.stat)} +${I.THEME_CODEX.pct}%`}</b></div>` +
          types.map((t) => `<div class="cx-row"><span class="cx-name">${t.name}</span>${GR.map((g, gi) => {
            const on = S.codex[`${t.id}:${gi}`];
            return `<span class="cx-cell ${on ? 'on' : ''}" style="--gc:${g.color}">${on ? '✓' : ''}</span>`;
          }).join('')}</div>`).join('');
      }).join('');
      showModal(`도감 ${n}/${I.CODEX_SIZE}`, `
        <div class="cx-info">처음 얻을 때마다 ${statName(I.CODEX.stat)} +${I.CODEX.pct}% (영구) · 성과급 +${I.CODEX.bonus}개<br>한 테마 7종을 모두 모으면 ${statName(I.THEME_CODEX.stat)} +${I.THEME_CODEX.pct}% 더<br>지금 도감 보너스: <b>${statName(I.CODEX.stat)} +${n2(Eq.codexBonus(S.codex)[I.CODEX.stat].pct)}%</b></div>
        <div class="cx-head"><span class="cx-name"></span>${GR.map((g) => `<span style="color:${g.color}">${g.name}</span>`).join('')}</div>
        <div class="cx-list">${rows}</div>`);
    }

    // 일괄 분해: 등급 고르기
    function showBulk() {
      const K = E.costBase();
      const can = (it) => !E.isKept(it.id) && !it.protected;
      const btns = GR.map((g, gi) => {
        const list = E.S.items.filter((it) => it.grade <= gi && can(it));
        const gold = list.reduce((s, it) => s + Eq.dismantleValue(it, K), 0);
        return `<button class="pick-btn" data-dis="${gi}" ${list.length ? '' : 'disabled'}>
          <span style="color:${g.color}">${g.name}</span> 이하 <b>${list.length}개</b><small>재산 +${fmt(gold)}원</small></button>`;
      }).join('');
      showModal('일괄 분해', `<div class="small">장착 중·보호 중인 아이템은 빼고 분해해요</div><div class="pick-list">${btns}</div>`);
      $('modal-ok').textContent = '닫기';
    }

    // ----- 아이템 상세 창 -----
    function openDetail(id) {
      detailId = id;
      enhOpen = false;
      const it0 = E.item(id);
      enhTarget = it0 ? Math.min(I.ENHANCE.max, Math.max(10, it0.plus + 1)) : 10;
      lockSel = new Set();
      mergeOpen = false;
      mergePick = new Set();
      renderSheet();
      $('sheet').classList.add('show');
      $('sheet-box').scrollTop = 0;
    }
    function closeDetail() {
      detailId = null;
      $('sheet').classList.remove('show');
      $('layer').classList.remove('show');
    }

    function renderSheet() {
      if (detailId === null) return;
      const it = E.item(detailId);
      if (!it) { closeDetail(); return; }
      const S = E.S;
      const K = E.costBase();
      const g = GR[it.grade];
      const slot = I.SLOTS[it.slot];
      const equipped = E.isEquipped(it.id);
      const main = Eq.mainStat(it);
      const maxed = it.plus >= I.ENHANCE.max || it.ruined;
      const nextMain = maxed ? null : Eq.mainValue({ ...it, plus: it.plus + 1 });
      const lines = I.POTENTIAL.lines[it.grade];
      const maxLocks = Eq.maxLocks(it.grade);

      // 잠재능력
      let pot;
      if (!lines) pot = '<div class="it-none">잠재능력 없음 (일반 등급)</div>';
      else if (!it.appraised) {
        pot = `<div class="it-none">미감정 · 잠재능력 ${lines}줄</div>
          <button class="act-btn wide gold-btn" data-act="appraise">감정하기 <small>${wonCost(Eq.appraiseCost(it, K))}</small></button>`;
      } else {
        const lineHtml = it.potentials.map((p, i) => {
          const on = lockSel.has(i);
          return `<${maxLocks ? `button data-lock="${i}"` : 'div'} class="pot ${on ? 'on' : ''}">
            <span>${statName(p.stat)}</span><b>${statText(p.stat, p.value, p.kind)}</b>${maxLocks ? `<i>${on ? ICON.lock : ICON.unlock}</i>` : ''}</${maxLocks ? 'button' : 'div'}>`;
        }).join('');
        const c = Eq.reappraiseCost(it, K, lockSel.size);
        const jjamUse = Math.min(S.jjam, c.jjam);
        const bonusUse = c.lockBonus + (c.jjam - jjamUse) * I.APPRAISE.jjamToBonus;
        const parts = [wonCost(c.won)];
        if (c.jjam) parts.push(`<b class="${jjamUse < c.jjam ? 'subst' : ''}">짬 ${c.jjam}개</b>`);
        if (bonusUse) parts.push(bonusCost(bonusUse));
        pot = `${lineHtml}
          ${maxLocks ? `<div class="small">줄을 눌러 잠그면 재감정 때 그대로 남아요 (최대 ${maxLocks}줄, 잠금 ${lockSel.size}줄)</div>` : ''}
          ${jjamUse < c.jjam ? `<div class="small">짬이 모자란 만큼 짬 1 = 성과급 ${I.APPRAISE.jjamToBonus}개로 대신 내요</div>` : ''}
          <button class="act-btn wide" data-act="reappraise">재감정 <small>${parts.join(' · ')}</small></button>`;
      }

      // 합성
      let mergeHtml = '';
      if (mergeOpen) {
        const needMore = I.MERGE.count - 1;
        const rate = Eq.mergeRate(S.mergeFail[it.grade]);
        let err = null;
        if (it.grade >= GR.length - 1) err = `${GR[GR.length - 1].name} 등급은 합성할 수 없어요`;
        else if (E.isKept(it.id)) err = equipped ? '장착 중인 아이템은 먼저 해제해 주세요' : '교체용 프리셋에 낀 장비는 재료로 쓸 수 없어요';
        else if (it.protected) err = '보호 중인 아이템은 재료로 쓸 수 없어요';
        const cands = E.S.items.filter((x) => x.id !== it.id && x.slot === it.slot && x.grade === it.grade && !E.isKept(x.id) && !x.protected);
        mergeHtml = `<div class="merge-box">
          <div class="it-sec-t">합성 재료 ${mergePick.size}/${needMore} · 성공률 <b>${Math.round(rate * 100)}%</b>${S.mergeFail[it.grade] ? ` (연속 실패 ${S.mergeFail[it.grade]})` : ''}<button class="rate-link" data-rates="merge">확률</button></div>
          ${err ? `<div class="warn-line">${err}</div>` : cands.length < needMore
            ? `<div class="warn-line">같은 부위·등급(${slot.name}·${g.name}) 아이템이 ${needMore}개 더 필요해요 (지금 ${cands.length}개)</div>`
            : `<div class="bag-grid small">${cands.map((x) => `<button class="bag-cell ${mergePick.has(x.id) ? 'picked' : ''}" data-pick="${x.id}">${itemIcon(x)}</button>`).join('')}</div>
              <div class="act-row"><button class="act-btn" data-act="merge-auto">자동 선택</button>
              <button class="act-btn gold-btn" data-act="merge-go" ${mergePick.size === needMore ? '' : 'disabled'}>합성하기</button></div>`}
          <div class="small">성공: ${GR[Math.min(GR.length - 1, it.grade + 1)].name} 1개 (강화는 재료 중 최고) · 실패: 재료 ${I.MERGE.count}개 소멸, 짬 +${I.MERGE.failJjam}개</div>
        </div>`;
      }

      const canDis = !E.isKept(it.id) && !it.protected;
      $('sheet-box').innerHTML = `
        <button class="sheet-x" data-act="close">✕</button>
        <div class="it-head" style="--gc:${g.color}">
          ${itemIcon(it, { noEq: true })}
          <div class="it-title">
            <div class="it-name">${itemName(it)}${it.plus ? ` <span class="plus">+${it.plus}</span>` : ''}</div>
            <div class="it-meta">${gradeTag(it.grade)} · ${slot.name}(${slot.body}) · ${it.floor}층</div>
            <div class="it-badges">${equipped ? '<i class="on">장착 중</i>' : altPresetHas(it.id) ? `<i>프리셋 ${2 - S.preset} 장착</i>` : ''}${it.protected ? `<i>${ICON.lock} 보호</i>` : ''}</div>
          </div>
        </div>
        ${I.TYPE_BY_ID[it.type].desc ? `<div class="it-desc">${I.TYPE_BY_ID[it.type].desc}</div>` : ''}
        <div class="it-sec">
          <div class="it-sec-t">주 능력치</div>
          <div class="it-line main"><span>${statName(main)}</span><b>${statText(main, Eq.mainValue(it), 'pct')}</b></div>
          ${(() => { const cur = E.item(S.equipped[it.slot]); if (!cur || cur.id === it.id) return ''; const d = Eq.mainValue(it) - Eq.mainValue(cur);
            return `<div class="small">장착 중 ${itemName(cur)}${cur.plus ? ' +' + cur.plus : ''}: ${statText(main, Eq.mainValue(cur), 'pct')} → <b class="${d > 0 ? 'gold' : 'over'}">${d > 0 ? '▲' : '▼'} ${statText(main, Math.abs(d), 'pct')}</b></div>`; })()}
          <div class="it-sec-t">서브 능력치</div>
          ${Eq.subValues(it).map((s) => `<div class="it-line"><span>${statName(s.stat)}</span><b>${statText(s.stat, s.value, 'pct')}</b></div>`).join('')}
        </div>
        ${(() => { const th = Eq.themeOf(it); const n = Eq.setCounts(E.equippedItems())[th];
          return `<div class="it-sec set-sec"><div class="it-sec-t">${themeStamp(th)} 세트 · 지금 ${n}/7 장착</div>${setLines(th)}</div>`; })()}
        <div class="it-sec">
          <div class="it-sec-t">잠재능력</div>
          ${pot}
        </div>
        <div class="act-grid">
          ${equipped
            ? '<button class="act-btn" data-act="unequip">장착 해제</button>'
            : '<button class="act-btn gold-btn" data-act="equip">장착하기</button>'}
          ${it.ruined
            ? `<button class="act-btn gold-btn" data-act="restore">흔적 복구 → +${I.ENHANCE.restorePlus} <small>${wonCost(E.restoreCost(it.id))} · 도장 ${Eq.restoreStamps(it)}개</small></button>`
            : `<button class="act-btn" data-act="enhance-open" ${maxed ? 'disabled' : ''}>${maxed ? '최대 강화' : `강화 +${it.plus}→+${it.plus + 1}`}
            ${maxed ? '' : `<small>${wonCost(Eq.enhanceCost(it, K))} · ${pctTxt(E.enhanceOdds(it.id, jjamUse0()).s)}</small>`}</button>`}
          <button class="act-btn ${mergeOpen ? 'on' : ''}" data-act="merge">합성</button>
          <button class="act-btn" data-act="protect">${it.protected ? '보호 해제' : '보호'}</button>
          <button class="act-btn danger-btn" data-act="dismantle" ${canDis ? '' : 'disabled'}>분해 <small>${canDis ? '재산 +' + fmt(Eq.dismantleValue(it, K)) + '원' : equipped ? '장착 중' : '보호 중'}</small></button>
        </div>
        ${maxed ? '' : `<div class="small center">강화하면 ${statName(main)} ${statText(main, nextMain, 'pct')}</div>`}
`;
      renderLayer(it, maxed, mergeHtml);
      renderCostLive();
    }

    // 강화·합성은 상세 창 아래로 붙이지 않고 위에 뜨는 창으로 (스크롤 없이 한 화면에서)
    function renderLayer(it, maxed, mergeHtml) {
      const body = enhOpen && !maxed ? enhanceBox(it) : mergeOpen ? mergeHtml : '';
      $('layer').classList.toggle('show', !!body);
      if (!body) { $('layer-box').innerHTML = ''; return; }
      $('layer-box').innerHTML = `<div class="layer-head">
          ${itemIcon(it, { noEq: true })}
          <div class="it-name">${itemName(it)}${it.plus ? ` <span class="plus">+${it.plus}</span>` : ''}</div>
          <button class="sheet-x" data-act="layer-close" aria-label="닫기">✕</button>
        </div>${body}`;
    }

    // 강화 창: 짬 사용·자동 강화
    const pctTxt = (p) => (Math.round(p * 1000) / 10) + '%';
    const jjamUse0 = () => ({ boost: enhJ.boost, protect: enhJ.protect });
    function enhanceBox(it) {
      const o = E.enhanceOdds(it.id, jjamUse0());
      const use = o.boost + o.protect;
      const main = Eq.mainStat(it);
      return `<div class="merge-box">
        <div class="it-sec-t">강화 +${it.plus}→+${it.plus + 1}${o.pity ? ' · <b class="hot">연속 강등 보정 100%</b>' : ''}<button class="rate-link" data-rates="enhance">확률</button></div>
        <div class="stat-line">성공하면 ${statName(main)} <b>${statText(main, Eq.mainValue(it), 'pct')}</b> → <b class="gold">${statText(main, Eq.mainValue({ ...it, plus: it.plus + 1 }), 'pct')}</b></div>
        <div class="stat-line">성공 <b>${pctTxt(o.s)}</b> · 유지 ${pctTxt(o.k)} · 강등 ${pctTxt(o.d)} · 파괴 <b class="${o.b ? 'over' : ''}">${pctTxt(o.b)}</b></div>
        <div class="small">1회: 결재 도장 <b class="${E.S.stamps < Eq.stampCost(it) ? 'over' : ''}">${Eq.stampCost(it)}</b>개 (보유 ${fmt(E.S.stamps)}개)</div>
        <div class="act-row"><span class="small">성공 보정 짬 ${enhJ.boost}개 (+10부터, 개당 +0.1%p)</span>
          <button class="act-btn" data-act="jb-">−</button><button class="act-btn" data-act="jb+">+</button></div>
        <div class="act-row"><span class="small">파괴 방지 짬 ${enhJ.protect}개 (+12부터, 개당 −1%p)</span>
          <button class="act-btn" data-act="jp-">−</button><button class="act-btn" data-act="jp+">+</button></div>
        <div class="small">이번에 쓸 짬 ${use}개 / 보유 ${E.S.jjam}개 · 넣은 짬은 결과와 상관없이 사라져요</div>
        <div class="act-row"><button class="act-btn gold-btn" data-act="enhance">강화 1회 <small>${wonCost(Eq.enhanceCost(it, E.costBase()))}</small></button></div>
        <div class="it-sec-t">자동 강화</div>
        <div class="act-row">
          <button class="act-btn" data-act="enh-target">목표 +${enhTarget}</button>
          <button class="act-btn ${enhStop12 ? 'on' : ''}" data-act="enh-stop12">+12 진입 시 멈춤</button>
          <button class="act-btn ${enhStopDown ? 'on' : ''}" data-act="enh-stopdown">강등 시 멈춤</button>
        </div>
        <div class="act-row"><button class="act-btn gold-btn" data-act="auto-enh">자동 강화 시작</button></div>
        <div class="small">목표 도달 · 재산 부족 · 짬 부족 · 파괴되면 항상 멈춰요</div>
      </div>`;
    }

    // 상세 창 버튼
    function onSheetAct(t) {
      const it = E.item(detailId);
      if (!it) { closeDetail(); return; }
      // 결과(또는 서버 응답 Promise)를 받아 알림·다시 그리기
      const after = (p, msg) => Promise.resolve(p).then((r) => {
        if (!r.ok) toast(r.reason);
        else if (msg) toast(msg);
        renderSheet();
        renderPanel();
        return r.ok;
      });
      if (t.dataset.lock !== undefined) {
        const i = Number(t.dataset.lock);
        if (lockSel.has(i)) lockSel.delete(i);
        else if (lockSel.size >= Eq.maxLocks(it.grade)) { toast(`최대 ${Eq.maxLocks(it.grade)}줄까지 잠글 수 있어요`); return; }
        else lockSel.add(i);
        renderSheet();
        return;
      }
      if (t.dataset.pick !== undefined) {
        const id = Number(t.dataset.pick);
        if (mergePick.has(id)) mergePick.delete(id);
        else if (mergePick.size < I.MERGE.count - 1) mergePick.add(id);
        renderSheet();
        return;
      }
      const a = t.dataset.act;
      if (a === 'close') closeDetail();
      else if (a === 'equip') after(E.equip(it.id), `${itemName(it)} 장착!`);
      else if (a === 'unequip') after(E.unequip(it.slot), '장착 해제');
      else if (a === 'enhance-open') { enhOpen = !enhOpen; mergeOpen = false; renderSheet(); }
      else if (a === 'layer-close') { enhOpen = false; mergeOpen = false; renderSheet(); }
      else if (a === 'enhance') after(Y.enhance(it.id, jjamUse0()));
      else if (a === 'restore') after(Y.restore(it.id), `복구 완료! +${I.ENHANCE.restorePlus}`);
      else if (a === 'jb-' || a === 'jb+' || a === 'jp-' || a === 'jp+') {
        const step = a.endsWith('+') ? 1 : -1;
        if (a[1] === 'b') enhJ.boost = Math.max(0, Math.min(I.ENHANCE.boost.max, enhJ.boost + step * 5));
        else enhJ.protect = Math.max(0, Math.min(I.ENHANCE.protect.max, enhJ.protect + step));
        renderSheet();
      } else if (a === 'auto-enh') {
        // 서버 답을 기다리는 동안 다시 누르면 무시 — 연타하면 두 번째가 첫 번째가 멈춘 곳(+12 진입·강등)에서 이어서 강화해
        // "+12 진입 시 멈춤·강등 시 멈춤"을 건너뛰고 파괴 구간까지 갔음 (2026-11-12 코드 검토)
        if (autoEnhBusy) return;
        autoEnhBusy = true;
        Promise.resolve().then(() => Y.autoEnhance(it.id, { target: enhTarget, boost: enhJ.boost, protect: enhJ.protect, stopAt12: enhStop12, stopOnDown: enhStopDown })).finally(() => { autoEnhBusy = false; }).then((r) => {
          if (!r.ok) { toast(r.reason); return; }
          const sm = r.summary;
          const STOP = { target: '목표 도달', gold: '재산 부족', jjam: '짬 부족', stamp: '결재 도장 부족', break: '파괴됨', down: '강등됨', at12: '+12 진입', maxTries: '시도 한도' };
          showModal('자동 강화 결과', `<div class="stat-line">멈춘 이유: <b>${STOP[sm.stop] || sm.stop}</b></div>
            <div class="stat-line">+${sm.start} → <b>${sm.end === null ? (sm.removed ? '소멸' : '흔적') : '+' + sm.end}</b></div>
            <div class="stat-line">시도 ${sm.tries}회 · 재산 ${fmt(sm.gold)}원 · 짬 ${sm.jjam}개</div>
            <div class="stat-line">강등 ${sm.downs}회 · 파괴 ${sm.breaks}회</div>`);
          if (sm.removed) closeDetail(); else renderSheet();
          renderPanel();
        });
      } else if (a === 'enh-target') { enhTarget = enhTarget >= I.ENHANCE.max ? it.plus + 1 : enhTarget + 1; renderSheet(); }
      else if (a === 'enh-stop12') { enhStop12 = !enhStop12; renderSheet(); }
      else if (a === 'enh-stopdown') { enhStopDown = !enhStopDown; renderSheet(); }
      else if (a === 'appraise') after(Y.appraise(it.id), '감정 완료!');
      else if (a === 'reappraise') after(Y.reappraise(it.id, [...lockSel].sort((x, y) => x - y)), '재감정 완료!');
      else if (a === 'protect') {
        const msg = it.protected ? '보호 해제' : '보호 중 (분해·합성 제외)';
        after(Y.toggleProtect(it.id), msg);
      }
      else if (a === 'merge') { mergeOpen = !mergeOpen; enhOpen = false; mergePick = new Set(); renderSheet(); }
      else if (a === 'merge-auto') {
        // 강화 낮은 것부터 자동으로
        const cands = E.S.items.filter((x) => x.id !== it.id && x.slot === it.slot && x.grade === it.grade && !E.isEquipped(x.id) && !x.protected)
          .sort((x, y) => x.plus - y.plus || x.id - y.id);
        mergePick = new Set(cands.slice(0, I.MERGE.count - 1).map((x) => x.id));
        renderSheet();
      } else if (a === 'merge-go') {
        const ids = [it.id, ...mergePick];
        const rate = Eq.mergeRate(E.S.mergeFail[it.grade]);
        askConfirm('합성할까요?', `성공률 <b class="gold">${Math.round(rate * 100)}%</b><br>성공하면 <b>${itemName(it)}</b> 그대로 한 등급 위로 나와요<br>실패하면 재료 ${I.MERGE.count}개가 모두 사라지고 짬 +${I.MERGE.failJjam}개`, '합성하기', () => {
          Y.merge(ids, it.type).then((r) => {
            if (!r.ok) { toast(r.reason); renderSheet(); return; }
            if (r.success) {
              showModal('합성 성공!', `<div class="g-grid one">${itemCard(r.item)}</div>`);
              approveStamp('성공');
              recentNew.clear();
              openDetail(r.item.id);
            } else {
              closeDetail();
              showModal('합성 실패...', `재료 ${I.MERGE.count}개가 사라졌어요<br>짬 +${r.jjam}개 · 다음 성공률 ${Math.round(Eq.mergeRate(E.S.mergeFail[it.grade]) * 100)}%`);
            }
            renderPanel();
          });
        });
      } else if (a === 'dismantle') {
        const gold = Eq.dismantleValue(it, E.costBase());
        askConfirm('분해할까요?', `${gradeTag(it.grade)} ${itemName(it)}${it.plus ? ' +' + it.plus : ''}<br><b class="gold">재산 +${fmt(gold)}원</b>`, '분해하기', () => {
          Y.dismantle([it.id]).then((r) => {
            if (!r.ok) { toast(r.reason); return; }
            toast(`분해 완료 · 재산 +${fmt(r.gold)}원`);
            closeDetail();
            renderPanel();
          });
        });
      }
    }

    // ----- 뽑기 탭 -----
    function gachaTab() {
      const S = E.S;
      const C = GA.configFor(gachaKind);
      const gs = S.gacha[gachaKind] || GA.fresh();
      const st = GA.status(gs);
      const prevAt = st.level > 0 ? C.LEVELS[st.level - 1] : 0;
      const lvPct = st.nextLevelAt === null ? 100 : 100 * (gs.count - prevAt) / (st.nextLevelAt - prevAt);
      const prices = Object.keys(C.PRICES).map(Number).sort((a, b) => a - b);
      const KINDS = [['equip', '장비'], ['acc', '장신구'], ['skill', '업무 스킬'], ['pet', '반려']];
      const sub = { equip: '키보드·마우스·모니터·의자', acc: '사원증·시계·반지', skill: '업무 스킬 17종 · 가방 안 씀', pet: `책상 반려 ${G.Pets.LIST.length}종 · D/C/B/A 단계 · 가방 안 씀` }[gachaKind];
      const skillLocked = gachaLocked();
      return `
        <div class="gacha-box">
          <div class="seg seg4">${KINDS.map(([k, n]) => `<button data-act="gk-${k}" class="${gachaKind === k ? 'active' : ''}">${n}</button>`).join('')}</div>
          <div class="gacha-sub">${skillLocked ? `최고 ${gachaKind === 'pet' ? G.Pets.CFG.unlock : G.Skills.CFG.unlock}층에서 열려요` : sub}<button class="rate-link" data-rates="gacha_${gachaKind}">확률</button></div>
          <div class="pull-row">${prices.map((n) => (n === 1 && heroTicketOn() ? heroBtn(skillLocked) : petTicketOn(n) ? ticketBtn(n, skillLocked)
            : `<button class="buy pull-btn${pullingN === n && !pullingPay ? ' pulling' : ''}" data-pull="${n}" ${skillLocked || pullingN ? 'disabled' : ''}><span>${n}회</span><b>성과급&nbsp;${fmt(C.PRICES[n])}</b></button>`)).join('')}</div>
          ${gachaKind === 'pet' && (E.S.petticket | 0) > 0 ? `<div class="small center">반려 뽑기권 <b>${fmt(E.S.petticket)}장</b> · 있으면 성과급 대신 뽑기권을 써요</div>` : ''}
          <div class="g-prog">
            <span>Lv.<b>${st.level}</b>/${st.maxLevel}</span>
            <div class="bar thin"><div class="lv-fill" style="width:${lvPct}%"></div></div>
            <span>확률업 <b class="${st.toBoost === 1 ? 'hot' : ''}">${st.toBoost === 1 ? '다음!' : st.toBoost + '회'}</b></span>
            <span>천장 <b>${fmt(st.toPity)}회</b></span>
          </div>
        </div>
        ${stampShopBox()}
        <div class="row">
          <div class="info"><div class="name">무료 성과급 <span class="lv">광고</span></div><div class="desc">오늘 ${E.adsLeft()}/${G.Rewards.REW.ad.perDay}번 남음</div></div>
          <button class="buy" data-act="ad" ${E.adsLeft() > 0 ? '' : 'disabled'}><span>광고 보기</span>${E.adsLeft() > 0 ? '받기' : '내일'}</button>
        </div>
        ${starterBox()}
        ${subBox()}
        ${monthlyBox()}
        ${corpShop()}
        <div class="act-row">
          <button class="act-btn" data-act="corp-test">테스트 충전 +${fmt(UI_CFG.testCorp)}장</button>
          <button class="act-btn" data-act="corp-swap" ${S.corp > 0 ? '' : 'disabled'}>법카 → 성과급</button>
        </div>`;
    }

    // 반려 뽑기권 (첫 결제 패키지): 그 횟수만큼 있으면 [n회 성과급] 버튼이 [n회 뽑기권 n장]으로 (사용자 2026-11-10: 칸을 따로 만들지 않음)
    const petTicketOn = (n) => gachaKind === 'pet' && (E.S.petticket | 0) >= n;
    const ticketBtn = (n, locked) => `<button class="buy pull-btn ticket-btn${pullingN === n && pullingPay === 'ticket' ? ' pulling' : ''}" data-tpull="${n}" ${locked || pullingN ? 'disabled' : ''}><span>${n}회</span><b>뽑기권&nbsp;${n}장</b></button>`;
    // 영웅 이상 반려 뽑기권: 가지고 있으면 [1회 성과급 100] 자리에 (다 쓰면 원래 버튼)
    const heroTicketOn = () => gachaKind === 'pet' && (E.S.pethero | 0) > 0;
    function heroBtn(locked) {
      const g = GR[G.Meta.STARTER.heroMin];
      return `<button class="buy pull-btn hero-btn${pullingN === 1 && pullingPay === 'hero' ? ' pulling' : ''}" data-hpull="1" style="--gc:${g.color}" ${locked || pullingN ? 'disabled' : ''}>
        <span>${g.name} 이상 ${fmt(E.S.pethero)}장</span><b>뽑기권&nbsp;사용</b></button>`;
    }
    // 첫 결제 패키지 카드 (계정당 1회). 테스트 결제가 켜진 곳에서만 살 수 있음 (정식판은 실결제 붙일 때)
    function starterBox() {
      const ST = G.Meta.STARTER;
      const done = !!E.S.starter;
      const gname = GR[ST.heroMin].name;
      return `<div class="sub-box starter-box${done ? ' done' : ''}">
          <div class="starter-seal" aria-hidden="true">${done ? '구매<br>완료' : '1회<br>한정'}</div>
          <div class="sub-title">첫 결제 패키지</div>
          <div class="starter-val"><b>${ST.valuePct}%</b><span>같은 값 법카보다</span></div>
          <ul class="starter-list">
            <li>반려 뽑기권 <b>${fmt(ST.tickets)}장</b> <small>(반려 뽑기 ${fmt(ST.tickets)}회)</small></li>
            <li><b style="color:${GR[ST.heroMin].color}">${gname} 이상</b> 반려 뽑기권 <b>${fmt(ST.hero)}장</b> <small>(${gname}·${GR[ST.heroMin + 1].name}·${GR[ST.heroMin + 2].name}만)</small></li>
          </ul>
          <div class="row"><div class="info"><div class="small">계정당 1번만 살 수 있어요${E.S.maxStage < G.Pets.CFG.unlock ? `<br><b>반려는 최고 ${G.Pets.CFG.unlock}층부터 써요</b>` : ''}</div></div>
            ${done ? '<button class="buy" disabled>구매 완료</button>' : `<button class="buy" data-corp="${ST.id}">₩${ST.krw.toLocaleString('ko-KR')}</button>`}</div>
          <div class="small">지금은 테스트 결제라 실제 돈이 나가지 않아요.</div>
        </div>`;
    }

    // 업무 스킬·반려 뽑기는 층 해금 전 잠금
    function gachaLocked() {
      if (gachaKind === 'skill') return E.S.maxStage < G.Skills.CFG.unlock;
      if (gachaKind === 'pet') return !G.Pets.isOpen(E.S.maxStage);
      return false;
    }
    // 결재 도장 상점 (재산)
    function stampShopBox() {
      const sh = E.stampShop();
      const tierName = ['1단계', '2단계 (×2)', '3단계 (×4)'];
      return `<div class="row"><div class="info"><div class="name">결재 도장 <span class="lv">보유 ${fmt(E.S.stamps)}개</span></div>
          <div class="desc">강화에 써요 (+5부터). 오늘 ${sh.bought}/${sh.max}개 · ${sh.tier < 0 ? '오늘은 다 샀어요' : tierName[sh.tier]}</div></div>
          <button class="buy" data-act="stamp-buy" ${sh.tier < 0 || E.S.gold < sh.unit * sh.step ? 'disabled' : ''}><span>+${sh.step}개</span>${sh.tier < 0 ? '—' : '재산 ' + fmt(sh.unit * sh.step)}</button></div>`;
    }

    // 업무 스킬 결과 카드
    function skillCard(key, tags = []) {
      const d = G.Skills.BY_KEY[key];
      const t = tags.filter(Boolean);
      return `<div class="g-card sk-card ${d.grade >= 3 ? 'hi' : ''}" style="--gc:${GR[d.grade].color}">
        ${t.length ? `<div class="g-tags">${t.map((x) => `<i>${x}</i>`).join('')}</div>` : ''}
        <img class="sk-glyph" src="img/skills/${key}.png" alt="">
        <div class="g-name">${d.name}</div>${gradeTag(d.grade)}</div>`;
    }
    function showGachaResult(results) {
      const tags = (r) => [r.pity ? '천장' : '', r.boosted ? 'UP' : '', r.isNew ? 'NEW' : '', r.jjam ? `짬+${r.jjam}` : '', r.ticket ? `교환권 ${r.ticket % G.Skills.CFG.ticketPieces || G.Skills.CFG.ticketPieces}/${G.Skills.CFG.ticketPieces}` : ''];
      const html = `<div class="g-grid ${results.length > 11 ? 'tight' : ''}">${results.map((r) => (r.pet ? petResultCard(r) : r.skill ? skillCard(r.skill, tags(r)) : itemCard(r.item, tags(r)))).join('')}</div>`;
      recentNew.clear();
      const best = Math.max(...results.map((r) => r.grade));
      snd(best >= 3 ? 'gachaHigh' : 'gacha'); // 영웅 이상이면 반짝
      const cnt = GR.map((_, g) => results.filter((r) => r.grade === g).length);
      const sum = `<div class="g-sum">${cnt.map((n, g) => (n ? `<span style="--gc:${GR[g].color}" class="${g === best ? 'best' : ''}"><i></i>${GR[g].name} ${n}</span>` : '')).join('')}</div>`;
      const petCodex = results.reduce((a, r) => a + (r.codex || 0), 0);
      const foot = results.some((r) => r.pet) ? `<div class="pet-res-foot">${petCodex ? `<span>도감 첫 등록 성과급 <b>+${fmt(petCodex)}</b></span>` : ''}<button class="act-btn" data-pgo="1">내 책상 반려 보기</button></div>` : '';
      showModal(`뽑기 ${results.length}회 결과`, `${sum}${html}${foot}`);
      $('modal').classList.add('wide');
    }

    // ----- 스탯 창 -----
    function showStats() {
      const PCT = new Set(['치명타 확률', '스킬 쿨타임 감소', '멘탈(후퇴 방지)', '꿀잠(휴식 감소)', '체력 회복(초당)']);
      const MUL = new Set(['치명타 데미지', '보스 데미지', '재산 획득', '방치 보상', '직급 보너스']);
      const rows = E.statSheet().map(({ name, value }) => `<button class="stat-line stat-btn" data-stat="${name}">${name}: <b>${
        PCT.has(name) ? (value * 100).toFixed(1) + '%' : MUL.has(name) ? '×' + value.toFixed(2) : name === '타자 속도' ? value.toFixed(2) + '/초' : fmt(value)}</b><small>?</small></button>`).join('');
      const tb = E.towerBuffs();
      const tbl = Object.keys(tb).length ? `<div class="small">야근 타워 영구 버프: ${G.Meta.TOWER.buffs.filter((b) => tb[b.stat]).map((b) => `${b.name} +${tb[b.stat]}%`).join(' · ')}</div>` : '';
      const co = E.company();
      showModal('스탯', `${rows}${tbl}${co ? `<div class="small">사풍: ${co.good} / ${co.bad}</div>` : ''}`);
    }

    // 스탯 하나 설명 창: 무엇인지 + 계산식 + 지금 값 내역
    function showStatInfo(name) {
      const d = E.statInfo(name);
      if (!d) return;
      const v = (k, x) => (k === 'x' ? '×' + n2(x) : k === '%' ? (x >= 0 ? '+' : '') + n2(x) + '%' : k === '+' ? '+' + fmt(x) : x < 100 ? n2(x) : fmt(x));
      const tot = d.total === undefined ? '' : `<div class="stat-line">지금 값: <b class="gold">${d.totalPct ? n2(d.total * 100) + '%' : d.totalMul ? '×' + n2(d.total) : fmt(d.total)}</b></div>`;
      showModal(name, `<div class="small">${d.desc}</div>
        <div class="it-sec-t">계산 방법</div><div class="stat-formula">${d.formula}</div>
        <div class="it-sec-t">지금 내 값</div><div class="sf-list">${d.parts.map(([l, k, x]) => `<div class="sf-row"><span>${l}</span><b>${v(k, x)}</b></div>`).join('')}</div>${tot}
        <div class="act-row"><button class="act-btn" data-stat-back="1">← 스탯 목록</button></div>`);
    }
    $('modal-body').addEventListener('click', (e) => {
      const t = e.target.closest('button[data-stat], button[data-stat-back]');
      if (!t) return;
      if (t.dataset.statBack) showStats(); else showStatInfo(t.dataset.stat);
    });

    // ----- 이직 지원 -----
    let applyRank = 0;
    let applyBusy = false; // 정식판: 서버 심사(합격 판정)를 기다리는 중
    function showApply() {
      // 정식판: 카드는 서버가 뽑음 → 없으면 받아 와서 다시 그림
      if (Y.online && !E.S.apply.cards && !E.applyBlock()) {
        Y.loadCards().then((r) => { if (r.ok && E.S.apply.cards) reshow('이직 지원', showApply, true); else toast(r.reason || '잠시 후 다시 해주세요'); });
        return;
      }
      const cards = E.applyCards();
      if (!cards) { toast(E.applyBlock()); return; }
      applyRank = Math.min(applyRank, E.maxApplyRank());
      const rc = E.refreshCost();
      const html = `<div class="ap-rank"><span>지원 직급</span>
          <button class="act-btn" data-ap="rank-" aria-label="직급 낮추기" ${applyRank <= 0 ? 'disabled' : ''}>−</button>
          <b>${F.rankName(applyRank)}<small>시작 ${G.Career.startFloor(applyRank)}층</small></b>
          <button class="act-btn" data-ap="rank+" aria-label="직급 올리기" ${applyRank >= E.maxApplyRank() ? 'disabled' : ''}>+</button></div>
        <div class="ap-list">${cards.map((c) => {
          const risky = !c.rejected && E.applyRisky(c.index, applyRank);
          return `<button class="pick-btn ap-card ${risky ? 'risky' : ''} ${c.rejected ? 'out' : ''}" data-ap="go${c.index}" ${c.rejected ? 'disabled' : ''}>
          <span class="ap-top"><b class="ap-name">${c.company.name}</b><i class="ap-grade">${c.gradeName}</i>${c.safe ? '<i class="ap-safe">안정</i>' : ''}</span>
          <span class="ap-meta">${c.company.industry} · ${c.company.good} / ${c.company.bad}</span>
          <span class="ap-odds">${c.rejected ? '<i class="ap-no">불합격</i>' : `합격<b>${Math.round(c.ranks[applyRank].chance * 100)}%</b>`}</span>
          ${risky ? `<span class="ap-warn">${ICON.warn} 전투력 부족 — 입사해도 버티기 어려워요</span>` : ''}</button>`;
        }).join('')}</div>
        <div class="act-row"><button class="act-btn" data-ap="refresh" ${rc === null ? 'disabled' : ''}>새로고침 ${rc === null ? '(끝)' : `성과급 ${rc}개`}</button></div>
        <div class="small">전투력 ${fmt(E.power())} · 경력 +${E.careerGain()}점 · 불합격한 곳은 이번엔 다시 못 넣어요. 4곳 다 떨어지면 최고 층 +5 뒤 재지원</div>
        ${E.probationFailed() ? `<div class="small">수습 탈락 중: 경력·이직 보상 없고 이직 횟수에도 안 세요 · ${E.S.runStart + E.PROBATION.floors}층까지 올라가면 수습 통과</div>` : ''}
        ${E.careerHint() ? `<div class="small">${ICON.warn} ${E.careerHint()} · 이직은 할 수 있어요</div>` : ''}`;
      showModal('이직 지원', html);
      $('modal').classList.add('wide');
      $('modal-ok').textContent = '닫기';
    }
    $('modal-body').addEventListener('click', (e) => {
      const t = e.target.closest('button[data-ap]');
      if (!t || t.disabled) return;
      const a = t.dataset.ap;
      if (a === 'rank-' || a === 'rank+') { applyRank = Math.max(0, Math.min(E.maxApplyRank(), applyRank + (a === 'rank+' ? 1 : -1))); showApply(); return; }
      // 새로고침도 서버 답을 기다리는 동안 막음 (연타하면 50·150 두 번 다 빠지고 횟수도 다 씀, 새로고침 중 지원하면 옛 카드라 거절 — 2026-11-12 코드 검토)
      if (a === 'refresh') {
        if (applyBusy) return;
        applyBusy = true;
        Y.refreshCards().then((r) => { applyBusy = false; if (!r.ok) toast(r.reason); reshow('이직 지원', showApply); });
        return;
      }
      if (a.startsWith('go')) {
        if (applyBusy) return;
        const idx = Number(a.slice(2));
        // 입사 전 경고: 전투력이 모자라면 한 번 더 확인
        if (E.applyRisky(idx, applyRank) && t.dataset.ok !== '1') {
          toast('전투력이 많이 모자라요. 입사해도 버티기 어려워요 — 한 번 더 누르면 지원');
          t.dataset.ok = '1';
          t.classList.add('armed');
          return;
        }
        const rank = applyRank;
        applyBusy = true;
        if (Y.online) toast('서류 심사 중…');
        Y.applyTo(idx, rank).then((r) => {
          applyBusy = false;
          if (!r.ok) { toast(r.reason); if (Y.online) reshow('이직 지원', showApply); return; }
          if (r.accepted) { $('modal').classList.remove('show'); showModal('합격!', `경력 +${r.gain}점<br>${E.companyName()} ${E.rankName()}(으)로 출근해요`); approveStamp('합격'); }
          else if (r.allOut) { $('modal').classList.remove('show'); showModal('전부 불합격...', '<div class="verdict-stamp">불합격</div>' + (E.probationFailed() ? '이번엔 잔류해요. 수습 탈락 중이라 바로 다시 지원할 수 있어요' : `이번엔 잔류해요. 최고 ${E.S.apply.lockUntil}층을 넘으면 다시 지원할 수 있어요`)); }
          else { toast(`불합격... (합격 확률 ${Math.round(r.chance * 100)}%)`); reshow('이직 지원', showApply); }
          renderPanel();
        });
      }
    });

    // ----- 출석 -----
    let attBusy = false;
    function showAttendance() {
      const st = E.attendance();
      const cells = st.days.map((d) => {
        const cls = d.claimed ? 'claimed' : d.today ? 'today' : d.missed ? 'missed' : 'later';
        const state = d.claimed ? '<i class="ad-stamp">출근</i>' : d.today ? '<em>받기</em>' : d.missed ? `<em>채우기<br>법카 ${d.fillCost}장</em>` : '';
        return `<button class="att-day ${cls} ${d.reward.box ? 'big' : ''}" data-at="${d.day}" ${d.claimed || (!d.today && !d.missed) ? 'disabled' : ''}
          aria-label="${d.day}일 성과급 ${d.reward.bonus}개${d.reward.box ? ' 상자' : ''}">
          <span class="ad-n">${d.day}</span>
          <span class="ad-r">성과급 ${d.reward.bonus}${d.reward.stamps ? `<br>도장 ${d.reward.stamps}` : ''}${d.reward.box ? '<br><b>+상자</b>' : ''}</span>${state}</button>`;
      }).join('');
      showModal(`출석 ${st.today}일차`, `<div class="att-top"><span>출근부</span><small>빠진 날 채우기 ${st.fillsLeft}번 남음</small></div><div class="att-grid">${cells}</div>`);
      $('modal').classList.add('wide');
      $('modal-ok').textContent = '닫기';
    }
    $('modal-body').addEventListener('click', (e) => {
      const t = e.target.closest('button[data-at]');
      if (!t || t.disabled) return;
      if (attBusy) return; // 연타 방지 (두 번째는 서버가 막지만 알림이 두 번 뜸)
      const day = Number(t.dataset.at);
      const st = E.attendance();
      attBusy = true;
      const p = st.today === day ? Y.claimAttendance() : Y.fillAttendance(day);
      p.then((r) => { attBusy = false; if (r.ok) snd('coin'); toast(r.ok ? `출석 ${day}일 · 성과급 +${r.bonus}개${r.pass ? ` · 패스·월정액 +${fmt(r.pass)}개` : ''}${r.item ? ` · ${GR[r.item.grade].name} ${itemName(r.item)}` : ''}` : r.reason); reshow('출석', showAttendance); renderHud(); });
    });

    // 미션·업적 한 줄: 체크 칸 · 이름 · 진행 막대 · 보상 (받을 수 있으면 형광펜)
    function checkRow(o) {
      const pct = o.need ? Math.min(100, 100 * o.prog / o.need) : o.ready || o.claimed ? 100 : 0;
      const state = o.claimed ? '완료' : o.ready ? '받기' : o.need ? `${fmt(o.prog)}/${fmt(o.need)}` : '진행 중';
      return `<button class="pick-btn chk ${o.cls || ''} ${o.claimed ? 'done' : o.ready ? 'ready' : ''}" ${o.attr} ${o.ready ? '' : 'disabled'}>
        <i class="chk-box">${o.claimed ? ICON.check : ''}</i>
        <span class="chk-main"><span class="chk-name">${o.name}</span>${o.desc ? `<span class="chk-desc">${o.desc}</span>` : ''}
          ${o.need ? `<span class="chk-bar"><i style="width:${pct}%"></i></span>` : ''}</span>
        <span class="chk-side"><b>${state}</b><small>${o.reward}</small></span></button>`;
    }

    // ----- 업적 -----
    let achBusy = false; // 업적 받기 중 (모두 받기 연타 방지)
    function showAchievements(keep = false) {
      const list = E.achievements();
      const done = list.filter((a) => a.claimed).length;
      const ready = list.filter((a) => a.ready && !a.claimed);
      const rows = list.map((a) => checkRow({ attr: `data-ac="${a.id}"`, name: a.name, desc: `${a.kind} · ${a.cond}`, claimed: a.claimed, ready: a.ready,
        prog: a.prog, need: a.need, reward: `성과급 ${a.bonus}개` })).join('');
      const allBtn = ready.length ? `<div class="act-row ach-all"><button class="act-btn gold-btn" data-ac-all ${achBusy ? 'disabled' : ''}>${achBusy ? '받는 중…' : `모두 받기 <small>${ready.length}개 · 성과급 ${fmt(ready.reduce((n, a) => n + a.bonus, 0))}</small>`}</button></div>` : '';
      showModal(`업적 ${done}/${list.length}`, `${allBtn}<div class="pick-list chk-list">${rows}</div>`, keep);
      $('modal').classList.add('wide');
      $('modal-ok').textContent = '닫기';
    }
    $('modal-body').addEventListener('click', (e) => {
      const all = e.target.closest('button[data-ac-all]');
      if (all && !all.disabled && !achBusy) { claimAllAchievements(); return; }
      const t = e.target.closest('button[data-ac]');
      if (!t || t.disabled || achBusy) return;
      achBusy = true; // 하나 받는 동안도 연타 막음 (두 번째는 "이미 받았어요" + 서버 다시 맞추기가 한 번 더 일어났음)
      Y.claimAchievement(t.dataset.ac).then((r) => { achBusy = false; if (r.ok) snd('coin'); toast(r.ok ? `성과급 +${r.bonus}개` : r.reason); reshow('업적', () => showAchievements(true)); renderHud(); });
    });

    // 받을 수 있는 업적을 하나씩 차례로 받음 (서버 요청 횟수 제한에 안 걸리게 동시에 보내지 않음)
    async function claimAllAchievements() {
      achBusy = true;
      showAchievements(true);
      let got = 0;
      let n = 0;
      let fail = null;
      for (const a of E.achievements().filter((x) => x.ready && !x.claimed)) {
        const r = await Y.claimAchievement(a.id);
        if (!r.ok) { fail = r.reason; break; }
        got += r.bonus;
        n++;
      }
      achBusy = false;
      if (n) snd('coin');
      toast(n ? `업적 ${n}개 · 성과급 +${fmt(got)}개${fail ? ` (멈춤: ${fail})` : ''}` : fail || '받을 업적이 없어요');
      if ($('modal').classList.contains('show') && $('modal-title').textContent.startsWith('업적')) showAchievements(true);
      renderHud();
    }

    // ----- 미션 -----
    let misBusy = false;
    function showMissions() {
      const st = E.missions();
      const row = (m) => checkRow({ attr: `data-mi="${m.id}"`, name: m.name, claimed: m.claimed, ready: m.ready, prog: m.prog, need: m.need,
        reward: `성과급 ${G.Meta.MIS.reward[m.scope]}개` });
      const all = (sc) => checkRow({ attr: `data-mi="all:${sc}"`, name: '전부 완료 보상', cls: 'all', claimed: st.all[sc].claimed,
        ready: st.all[sc].done && !st.all[sc].claimed, reward: `성과급 ${G.Meta.MIS.allReward[sc]}개` });
      showModal('미션', `<div class="sub-title">일일</div><div class="pick-list chk-list">${st.list.filter((m) => m.scope === 'daily').map(row).join('')}${all('daily')}</div>
        <div class="sub-title">주간</div><div class="pick-list chk-list">${st.list.filter((m) => m.scope === 'weekly').map(row).join('')}${all('weekly')}</div>`);
      $('modal').classList.add('wide');
      $('modal-ok').textContent = '닫기';
    }
    $('modal-body').addEventListener('click', (e) => {
      const t = e.target.closest('button[data-mi]');
      if (!t || t.disabled || misBusy) return;
      misBusy = true; // 연타 방지
      Y.claimMission(t.dataset.mi).then((r) => { misBusy = false; if (r.ok) snd('coin'); toast(r.ok ? `성과급 +${r.bonus}개` : r.reason); reshow('미션', showMissions); renderHud(); });
    });

    // ----- 야근 타워 -----
    function showTower() {
      const t = E.towerInfo();
      const tb = t.buffs;
      showModal('야근 타워', `<div class="stat-line">이번 달 <b>${t.cur}층</b> · 역대 최고 ${t.best}층</div>
        <div class="stat-line">오늘 남은 실패 ${t.failsLeft}회 · 이번 달 성과급 ${fmt(t.bonusMonth)}/${fmt(t.bonusCap)}개</div>
        <div class="small">층마다 보스 1마리 · 제한 ${G.Meta.TOWER.time}초 · 처음 깬 층마다 성과급 ${G.Meta.TOWER.floorBonus}개 + 짬 ${G.Meta.TOWER.floorJjam}개</div>
        <div class="small">영구 버프: ${G.Meta.TOWER.buffs.filter((b) => tb[b.stat]).map((b) => `${b.name} +${tb[b.stat]}%`).join(' · ') || '없음 (10층마다 하나씩)'}</div>
        <div class="act-row"><button class="act-btn gold-btn" data-tw="go" ${t.failsLeft > 0 ? '' : 'disabled'}>${t.cur + 1}층 도전</button></div>`);
      $('modal-ok').textContent = '닫기';
    }
    $('modal-body').addEventListener('click', (e) => {
      const t = e.target.closest('button[data-tw]');
      if (!t || t.disabled) return;
      const r = E.towerStart();
      if (!r.ok) { toast(r.reason); return; }
      $('modal').classList.remove('show');
      toast(`야근 타워 ${r.floor}층 도전!`);
    });

    // ----- 부서 장악 화면 (docs/ui-spec.md 부서 장악 화면) -----
    const DN = G.Depts;
    const RES_NAME = { gold: '원', stamps: '결재 도장', jjam: '짬', bonus: '성과급', pass: '출입증', shards: '장신구 조각', namecard: '명함', kaltoe: '칼퇴권', equip: '장비' };
    const RES_UNIT = { stamps: '개', jjam: '개', bonus: '개', pass: '장', shards: '개', namecard: '장', kaltoe: '장', equip: '개' };
    const sideTitle = (sd) => {
      const d = DN.BY_ID[sd.dept];
      const wave = sd.waves.length > 1 ? ` · 웨이브 ${Math.min(sd.wave + 1, sd.waves.length)}/${sd.waves.length}` : '';
      if (sd.kind === 'conquest') return `장악전 · ${d.name} ${sd.floor}층${wave}`;
      if (sd.kind === 'meeting') return `외부 미팅 · ${d.meeting}`;
      return `${d.dungeon.name} ${sd.k}단계${wave}`;
    };
    // 받은 것 나열 (원·재화·장비)
    function gainText(r) {
      const parts = [];
      if (r.gold) parts.push(`원 +${fmt(r.gold)}`);
      for (const k of ['stamps', 'jjam', 'bonus', 'pass', 'shards', 'namecard']) {
        const v = (r.gains && r.gains[k]) || r[k];
        if (v) parts.push(`${RES_NAME[k]} +${fmt(v)}${RES_UNIT[k]}`);
      }
      if (r.items && r.items.length) parts.push(`장비 +${r.items.length}개`);
      return parts.join(' · ') || '받은 게 없어요';
    }
    // 빨간 점: 가득 찬 부서 또는 오늘 안 만난 미팅
    const deptDot = () => {
      if (!E.S.dept.conquered) return false;
      const info = E.deptInfo(hooks.isSubscribed());
      return info.list.some((x) => x.full) || info.meetings.some((m) => !m.done);
    };
    let deptBusy = false;
    function showDept() {
      const S = E.S;
      const info = E.deptInfo(hooks.isSubscribed());
      const c = info.conquest;
      const lock = E.mode !== 'main' || deptBusy || !Y.invReady() || (Y.sideBusy && Y.sideBusy()) ? 'disabled' : '';
      const target = DN.BY_ID[c.dept];
      const cq = c.promotion
        ? `<div class="dp-title"><b>승격전 ${c.n}</b> · ${target.name} Lv${S.dept.owned[c.dept].lv}→${S.dept.owned[c.dept].lv + 1}</div>`
        : `<div class="dp-title"><b>장악전 ${c.n}</b> · ${target.name}</div>`;
      const conquestHtml = `<div class="dp-card">${cq}
        <div class="small">부서장 ${target.boss} · ${c.floor}층 · 웨이브 3 (일반 5·일반 5·부서장) · ${DN.CFG.conquest.time}초</div>
        ${E.effRunMax() < E.S.maxStage - 10 ? '<div class="small over">이직 직후엔 힘이 약해서 어려워요. 이번 회차에서 층을 더 올린 뒤 도전해 보세요</div>' : ''}
        <button class="act-btn gold-btn wide" data-dp="conquer" ${c.open && !lock ? '' : 'disabled'}>${c.open ? (c.promotion ? '승격전 도전' : '장악전 도전') : `최고 ${c.floor}층 필요`}</button></div>`;
      let body = '<div class="small">장악전에서 이기면 부서가 생겨요. 부서는 시간마다 재화를 만들고, 외부 미팅과 특근이 열려요.</div>';
      if (S.dept.conquered) {
        const prod = info.list.map((p) => {
          const g = Object.keys(p.gains).map((k) => `${RES_NAME[k]} ${fmt(Math.floor(p.gains[k] + (S.dept.owned[p.id].frac[k] || 0)))}`);
          if (p.goldHours) g.unshift('원');
          if (p.held) g.push(`창고 ${p.held}`);
          return `<div class="dp-row"><span>${DN.BY_ID[p.id].name}</span><b class="${p.full ? 'full' : ''}">${p.full ? '가득' : `${p.h.toFixed(1)}시간`}</b><em>${g.join(' · ')}</em></div>`;
        }).join('');
        const anyProd = info.list.some((p) => p.h > 0.01 || p.held);
        const meet = info.meetings.map((m) => `<div class="dp-card">
          <div class="dp-title"><b>${m.name}</b> · ${DN.BY_ID[m.id].name}</div>
          <div class="small">명함 ${DN.CFG.meeting.namecard(m.n)}장 · 출입증 ${DN.CFG.meeting.pass}장 · 하루 1번</div>
          <div class="act-row"><button class="act-btn" data-dp="meet" data-id="${m.id}" ${m.done || lock ? 'disabled' : ''}>${m.done ? `오늘 완료 ${ICON.check}` : '만나기'}</button>
          <button class="act-btn" data-dp="quick" data-id="${m.id}" ${!m.won || m.done || S.kaltoe < 1 || lock ? 'disabled' : ''}>바로 처리 · 칼퇴권 1</button></div></div>`).join('');
        const dg = E.dungeonInfo().map((d) => {
          const most = Math.min(S.pass, S.kaltoe, DN.CFG.dungeon.sweepMax);
          const rw = d.best ? `보상 ${gainText(d.reward.goldHours ? { gold: E.deptGold({ goldHours: d.reward.goldHours }) } : d.reward.equip ? { items: { length: d.reward.equip } } : d.reward)} (${d.best}단계 기준)` : '1단계부터 도전해요';
          return `<div class="dp-card"><div class="dp-title"><b>${d.name}</b> · 최고 ${d.best}단계</div><div class="small">${rw}</div>
            <div class="act-row dp-3"><button class="act-btn gold-btn" data-dp="dungeon" data-id="${d.id}" data-k="${d.next}" ${d.error || lock ? 'disabled' : ''}>${d.next}단계 도전</button>
            <button class="act-btn" data-dp="sweep" data-id="${d.id}" data-n="1" ${d.best < 1 || most < 1 || lock ? 'disabled' : ''}>소탕 1회</button>
            <button class="act-btn" data-dp="sweep" data-id="${d.id}" data-n="${Math.max(1, most)}" ${d.best < 1 || most < 2 || lock ? 'disabled' : ''}>소탕 ${Math.max(2, most)}회</button></div>
            ${d.error ? `<div class="small">${d.error}</div>` : ''}</div>`;
        }).join('');
        body = `<div class="sub-title">부서 생산 <small>최대 ${info.cap}시간</small></div><div class="dp-table">${prod}</div>
          <button class="act-btn gold-btn wide" data-dp="claim" ${anyProd && !lock ? '' : 'disabled'}>모두 받기</button>
          <div class="small">원은 받는 순간의 층 기준이에요 (이직 직후엔 적어요)</div>
          <div class="sub-title">외부 미팅 <small>하루 1번</small></div>${meet}
          <div class="small">명함은 사내 탭 [인맥 관리]에서 친분을 쌓는 데 써요</div>
          <div class="sub-title">특근 <small>출입증 1장 · 이기면 차감</small></div>${dg}`;
      }
      showModal('부서 장악', `<div class="dp-wallet"><span>출입증<b>${fmt(S.pass)}장</b></span><span>칼퇴권<b>${fmt(S.kaltoe)}장</b></span><span>명함<b>${fmt(S.namecard)}장</b></span></div>
        <button class="act-btn wide" data-dp="pass" ${info.passShopLeft > 0 && S.bonus >= DN.CFG.passShop.cost && !lock ? '' : 'disabled'}>출입증 사기 ${DN.CFG.passShop.pass}장 · 성과급 ${DN.CFG.passShop.cost}개 (${info.passShopLeft}/${DN.CFG.passShop.perDay})</button>
        <div class="sub-title">${c.promotion ? '승격전' : '장악전'}</div>${conquestHtml}${body}`);
      $('modal').classList.add('wide');
      $('modal-ok').textContent = '닫기';
    }
    $('modal-body').addEventListener('click', (e) => {
      const t = e.target.closest('button[data-dp]');
      if (!t || t.disabled) return;
      const a = t.dataset.dp;
      const id = t.dataset.id;
      const start = (r) => { if (!r.ok) { toast(r.reason); return; } $('modal').classList.remove('show'); renderHud(); };
      if (a === 'conquer') return start(E.conquestStart());
      if (a === 'meet') return start(E.meetingStart(id));
      if (a === 'dungeon') return start(E.dungeonStart(id, Number(t.dataset.k)));
      const done = (msg) => (r) => { deptBusy = false; toast(r.ok ? msg(r) : r.reason); reshow('부서 장악', showDept, true); renderHud(); };
      // 소탕은 출입증·칼퇴권이 같이 빠지니 한 번 확인 (사용자 2026-11-10)
      if (a === 'sweep') {
        const n = Number(t.dataset.n);
        askConfirm('소탕할까요?', `출입증·칼퇴권 <b>${n}장씩</b> 써서 ${n}번 바로 끝내요<br><small>보유 출입증 ${fmt(E.S.pass)}장 · 칼퇴권 ${fmt(E.S.kaltoe)}장</small>`, '소탕하기', () => {
          deptBusy = true;
          Y.dungeonSweep(id, n).then(done((r) => `칼퇴 성공! 소탕 ${r.n}회 · ${gainText(r)}`));
        });
        modalNo = showDept; // 취소하면 부서 창으로
        return;
      }
      deptBusy = true;
      showDept();
      if (a === 'claim') Y.deptClaim().then(done((r) => `부서들이 열일했어요! ${gainText(r)}`));
      else if (a === 'quick') Y.meetingQuick(id).then(done((r) => `미팅 바로 끝! 명함 +${r.namecard}장 · 출입증 +${r.pass}장`));
      else if (a === 'pass') Y.buyPass().then(done((r) => `출입증 +${r.pass}장`));
      else deptBusy = false;
    });

    // ----- 인맥 관리 (명함첩) — 규칙 net.js, 서버 모드면 서버가 판정 (docs/impl-spec-m4.md ③) -----
    const NT = G.Net;
    const NET_STAT = { atk: '업무력', hp: '체력', gold: '재산 획득', boss: '보스 데미지' };
    const NET_ICON = `<svg class="oc-svg" viewBox="0 0 52 52" aria-hidden="true"><rect x="10" y="9" width="34" height="22" rx="2" fill="#e3e5df" stroke="#23272d" stroke-width="2.5" transform="rotate(-9 27 20)"/>
      <rect x="6" y="20" width="38" height="24" rx="2" fill="#fff" stroke="#23272d" stroke-width="2.5"/><rect x="11" y="26" width="9" height="9" fill="none" stroke="#c3392f" stroke-width="2"/>
      <path d="M24 28h15M24 33h10M11 39h28" stroke="#23272d" stroke-width="2"/></svg>`;
    // 빨간 점: 열린 인맥 중 명함으로 친분을 올릴 수 있거나, 사이를 올릴 수 있으면
    const netDot = () => E.netInfo().list.some((p) => p.open && ((p.canLevel && E.S.namecard >= p.lvCost) || (p.atCap && E.S.bonus >= p.rankCost)));
    let netBusy = false;
    function netCard(p, lock) {
      if (!p.open) {
        return `<div class="nc nc-back"><span class="nc-back-name">${p.name}</span><small>부서 ${p.need}곳을 장악하면 명함을 받아요</small></div>`;
      }
      const ticks = Array.from({ length: NT.CFG.maxRank }, (_, i) => `<i class="${i < p.rank ? 'on' : ''}"></i>`).join('');
      const inBand = p.maxed ? NT.CFG.lvPerRank : p.lv - (p.cap - NT.CFG.lvPerRank);
      const bar = `<span class="nc-bar" aria-hidden="true"><span style="width:${Math.max(0, Math.min(100, (inBand / NT.CFG.lvPerRank) * 100))}%"></span></span>`;
      let act;
      if (p.maxed) act = `<div class="nc-done">${ICON.check} 다 키웠어요</div>`;
      else if (p.atCap) {
        act = `<button class="act-btn gold-btn wide" data-nt="rank" data-id="${p.id}" ${lock || E.S.bonus < p.rankCost ? 'disabled' : ''}>
          사이 올리기 → ${p.nextRankName} · <span class="need" data-bonus="${p.rankCost}">성과급 ${fmt(p.rankCost)}개</span></button>`;
      } else {
        const can = Math.min(p.cap - p.lv, Math.floor(E.S.namecard / p.lvCost));
        act = `<div class="act-row nc-acts"><button class="act-btn" data-nt="lv" data-id="${p.id}" data-n="1" ${lock || can < 1 ? 'disabled' : ''}>친분 +1 · 명함 ${p.lvCost}장</button>
          <button class="act-btn" data-nt="lv" data-id="${p.id}" data-n="${Math.max(1, can)}" ${lock || can < 2 ? 'disabled' : ''}>+${Math.max(2, can)} · 명함 ${fmt(Math.max(2, can) * p.lvCost)}장</button></div>`;
      }
      return `<div class="nc nc-${p.stat}">
        <div class="nc-top"><i class="nc-seal" aria-hidden="true"><img src="img/net/${p.id}.png" alt="" draggable="false"></i>
          <div class="nc-who"><b>${p.name}</b><small>${p.line}</small></div>
          <div class="nc-lv"><small>친분</small><b>Lv${p.lv}</b><small>/ ${p.cap}</small></div></div>
        ${bar}
        <div class="nc-rank"><span class="nc-ticks" aria-label="사이 ${p.rank}/${NT.CFG.maxRank}단계">${ticks}</span><em>${p.rankName}</em></div>
        <div class="nc-eff"><span>${NET_STAT[p.stat]} <b>+${n2(p.pct)}%</b></span><small>친분 1마다 +${p.per}% · 사이 1마다 +${NT.CFG.rankPct}%</small></div>
        ${act}</div>`;
    }
    // 명함 상점: 성과급 → 명함 (하루 상한)
    function cardShopRow(lock) {
      const C = NT.CFG.cardShop;
      const left = E.netCardLeft();
      const can = Math.min(left, Math.floor(E.S.bonus / C.cost));
      return `<div class="nc-shop"><span>명함 상점 <small>1장 성과급 ${C.cost} · 오늘 ${left}/${C.perDay}장 남음</small></span>
        <div class="act-row"><button class="act-btn" data-nt="card" data-n="1" ${lock || can < 1 ? 'disabled' : ''}>1장 · 성과급 ${C.cost}</button>
        <button class="act-btn" data-nt="card" data-n="${Math.max(1, can)}" ${lock || can < 2 ? 'disabled' : ''}>${Math.max(2, can)}장 · 성과급 ${fmt(Math.max(2, can) * C.cost)}</button></div></div>`;
    }
    function showNet() {
      const info = E.netInfo();
      if (!info.open) { toast('첫 부서 장악(30층 장악전) 때 열려요'); return; }
      const lock = netBusy || !Y.invReady() ? 'disabled' : '';
      const tot = NT.bonus(E.S.net, info.conquered);
      const sum = Object.keys(NET_STAT).filter((k) => tot[k]).map((k) => `${NET_STAT[k]} +${n2(tot[k])}%`).join(' · ') || '아직 없어요';
      const anyLv = info.list.some((p) => p.canLevel && E.S.namecard >= p.lvCost);
      showModal('인맥 관리', `<div class="nc-head"><div class="nc-wallet"><span>명함<b>${fmt(E.S.namecard)}장</b></span><span>성과급<b>${fmt(E.S.bonus)}개</b></span></div>
          <div class="nc-sum"><small>인맥 효과 합계</small><b>${sum}</b></div></div>
        <div class="nc-list">${info.list.map((p) => netCard(p, lock)).join('')}</div>
        <button class="act-btn gold-btn wide nc-all" data-nt="all" ${anyLv && !lock ? '' : 'disabled'}>일괄 친분 올리기 · 낮은 레벨부터 고르게</button>
        ${cardShopRow(lock)}
        <div class="small">친분 10레벨마다 사이를 올려야 더 오를 수 있어요 (성과급). 명함은 외부 미팅·기획팀 생산·명함 상점에서 얻어요</div>`);
      $('modal').classList.add('wide');
      $('modal-ok').textContent = '닫기';
    }
    $('modal-body').addEventListener('click', (e) => {
      const t = e.target.closest('button[data-nt]');
      if (!t || t.disabled) return;
      const a = t.dataset.nt;
      const id = t.dataset.id;
      const name = id && NT.BY_ID[id] ? NT.BY_ID[id].name : '';
      netBusy = true;
      showNet();
      const done = (msg) => (r) => { netBusy = false; toast(r.ok ? msg(r) : r.reason); reshow('인맥 관리', showNet); renderHud(); };
      if (a === 'lv') Y.netLevelUp(id, Number(t.dataset.n)).then(done((r) => `${name} 친분 Lv${r.lv} · 명함 −${fmt(r.cost)}장`));
      else if (a === 'rank') Y.netRankUp(id).then(done((r) => `${name}와(과) ${r.rankName}! · 성과급 −${fmt(r.cost)}개`));
      else if (a === 'all') Y.netLevelAll().then(done((r) => `친분 +${r.n} · 명함 −${fmt(r.cost)}장`));
      else if (a === 'card') Y.netBuyCards(Number(t.dataset.n)).then(done((r) => `명함 +${r.n}장 · 성과급 −${fmt(r.cost)}개`));
      else netBusy = false;
    });

    // ----- 책상 반려 (장비 탭 [반려], 명세 ④). 규칙은 pets.js, 판정은 서버 (sync.js) -----
    const PT = G.Pets;
    // 반려 얼굴: 등급색 고무도장 안에 그림(www/img/pets/<key>.png, 128px 투명) + 단계 글자 꼬리표. 없는 반려는 검은 그림자
    function petFace(key, tier, cls = '') {
      const p = G.Pets.BY_KEY[key];
      const has = tier >= 0;
      return `<i class="pet-seal ${cls} ${has ? '' : 'none'}" style="--gc:${GR[p.grade].color}" aria-hidden="true"><img src="img/pets/${key}.png" alt="" draggable="false">${has ? `<em>${G.Pets.TIERS[tier]}</em>` : ''}</i>`;
    }
    const petStatName = (k) => (k === 'rest' ? '번아웃 휴식' : k === 'atk' ? '업무력' : statName(k));
    const petStatText = (k, v) => (k === 'rest' ? `−${n2(v)}%` : `+${n2(v)}${I.STATS[k].unit}`);
    const petFx = (stats) => Object.keys(stats).map((k) => `${petStatName(k)} ${petStatText(k, stats[k])}`).join(' · ');
    function petTab() {
      const info = E.petInfo();
      const out = info.out ? info.list.find((x) => x.key === info.out) : null;
      const ownedN = info.list.filter((x) => x.owned).length;
      const codexN = Object.keys(E.S.pet.codex).length;
      const anyMerge = info.list.some((x) => x.counts.some((c, t) => c >= PT.CFG.mergeNeed + (t === 3 ? 1 : 0) && x.canMerge[t]));
      const desk = out
        ? `<div class="pet-desk">${petFace(out.key, out.best, 'big')}
            <div class="pd-txt"><small>지금 책상 위</small><b>${out.name}</b><span>${GR[out.grade].name} · ${PT.TIERS[out.best]}단계</span>
            <p>${petFx(out.summon)}</p></div></div>`
        : `<div class="pet-desk empty"><i class="pet-seal big none" aria-hidden="true"><b>+</b></i>
            <div class="pd-txt"><small>책상이 비어 있어요</small><b>반려를 골라 올려요</b><span>책상 위 반려 1마리만 능력치를 줘요</span></div></div>`;
      const grades = GR.map((g, gi) => {
        const cards = info.list.filter((x) => x.grade === gi).map((x) => {
          const cells = PT.TIERS.map((t, ti) => `<span class="${x.counts[ti] >= PT.CFG.mergeNeed ? 'full' : ''} ${ti === x.best ? 'best' : ''}"><i>${t}</i><b>${x.counts[ti]}</b></span>`).join('');
          return `<button class="pet-card ${x.owned ? '' : 'off'} ${x.out ? 'on' : ''}" data-pet="${x.key}" style="--gc:${GR[x.grade].color}">
            ${petFace(x.key, x.best)}<span class="pc-name"><span class="pc-n">${x.name}</span>${x.out ? '<small>책상 위</small>' : ''}</span>
            <span class="pc-cells" aria-label="D ${x.counts[0]}개, C ${x.counts[1]}개, B ${x.counts[2]}개, A ${x.counts[3]}개">${cells}</span></button>`;
        }).join('');
        return `<div class="pet-grade"><div class="pg-head" style="--gc:${g.color}"><i></i>${g.name}</div><div class="pet-row">${cards}</div></div>`;
      }).join('');
      return `${desk}
        <div class="pet-sum"><span>보유 효과 <b>업무력 +${n2(info.hold)}%</b></span><span>모은 반려 <b>${ownedN}/${PT.LIST.length}</b></span><span>도감 <b>${codexN}/${PT.CODEX_KEYS.length}</b></span></div>
        ${grades}
        <div class="small pet-note">같은 반려·같은 단계 ${PT.CFG.mergeNeed}개를 합치면 다음 단계 (재산). A ${PT.CFG.mergeNeed}개는 한 등급 위 반려 D로 바뀌어요</div>
        <div class="bag-dock pet-dock">
          <button data-act="pet-all" ${anyMerge && !petBusy && Y.invReady() ? '' : 'disabled'}>일괄 합치기</button>
          <button data-act="pet-shop">반려 뽑기</button>
          <button class="rate-link" data-rates="pet_merge">합치기 확률</button>
        </div>`;
    }
    // 반려 하나 상세 (단계별 개수·합치기·책상에 올리기)
    let petOpen = null;
    function showPet(key) {
      petOpen = key;
      const x = PT.info(E.S.pet, key, E.S.pet.out, E.petCostBase()); // 합치기 재산 = 이번 회차 최고 층 처치 보상 기준 (반려 탭 목록과 같게)
      const lock = petBusy || !Y.invReady();
      const rows = PT.TIERS.map((t, ti) => {
        const n = x.counts[ti];
        const last = ti === PT.TIERS.length - 1;
        const to = last ? (x.nextGrade === null ? null : `${GR[x.nextGrade].name} 반려 D`) : PT.TIERS[ti + 1];
        const can = x.canMerge[ti];
        const times = Math.min(Math.floor(n / PT.CFG.mergeNeed), Math.floor(E.S.gold / x.mergeCost));
        const btn = to === null ? '<span class="pt-end">끝 단계</span>'
          : `<button class="act-btn" data-pm="${ti}" data-n="1" ${lock || !can || times < 1 ? 'disabled' : ''}>→ ${to}<small>재산 ${fmtShort(x.mergeCost)}</small></button>`;
        return `<div class="pt-row ${ti === x.best ? 'best' : ''}">
          <i class="pt-t">${t}</i>
          <div class="pt-mid"><b>${n}<small>/${PT.CFG.mergeNeed}</small></b><span class="pt-bar"><span style="width:${Math.min(100, (100 * n) / PT.CFG.mergeNeed)}%"></span></span>
            <small>${petFx(PT.summonStats(key, ti))}</small></div>${btn}</div>`;
      }).join('');
      const summon = x.owned
        ? `<button class="act-btn ${x.out ? '' : 'gold-btn'} wide" data-pset="${x.out ? '' : key}" ${lock ? 'disabled' : ''}>${x.out ? '책상에서 내리기' : '책상에 올리기'}</button>`
        : `<button class="act-btn wide" data-pgo="shop">반려 뽑기에서 얻어요</button>`;
      showModal(x.name, `<div class="pet-head">${petFace(key, x.best, 'big')}
          <div><span class="gtag-line" style="--gc:${GR[x.grade].color}">${GR[x.grade].name}</span><p>${x.line}</p>
          <div class="pet-fx"><span>책상 효과 <b>${petFx(x.summon)}</b>${x.owned ? '' : ' <small>(D 기준)</small>'}</span>
          <span>보유 효과 <b>업무력 +${n2(x.hold)}%</b></span></div></div></div>
        <div class="pt-list">${rows}</div>
        ${summon}
        <div class="small">단계가 높을수록 책상 효과가 커져요 (D ×1 · C ×1.5 · B ×2 · A ×3). 가장 높은 단계 1개만 쳐요</div>`);
      $('modal').classList.add('wide');
      $('modal-ok').textContent = '닫기';
    }
    function petResultCard(r) {
      const p = PT.BY_KEY[r.pet];
      const tags = [r.hero ? `${GR[G.Meta.STARTER.heroMin].name}+` : '', r.pity ? '천장' : '', r.boosted ? 'UP' : '', r.isNew ? 'NEW' : ''].filter(Boolean);
      return `<div class="g-card pet-g ${p.grade >= 3 ? 'hi' : ''}" style="--gc:${GR[p.grade].color}">
        ${tags.length ? `<div class="g-tags">${tags.map((x) => `<i>${x}</i>`).join('')}</div>` : ''}
        ${petFace(r.pet, r.tier)}
        <div class="g-name">${p.name}</div>${gradeTag(p.grade)}</div>`;
    }
    function petDoneMsg(r) {
      const got = (r.got || []).map((x) => `${PT.BY_KEY[x.pet].name} ${PT.TIERS[x.tier]}${x.n > 1 ? ' ×' + x.n : ''}`);
      return `합치기 ${r.n}번 · ${got.slice(0, 3).join(', ')}${got.length > 3 ? ` 외 ${got.length - 3}` : ''} · 재산 −${fmtShort(r.cost)}`;
    }
    function petAfter(r, msg) {
      petBusy = false;
      toast(r.ok ? msg(r) : r.reason);
      if (petOpen && $('modal').classList.contains('show') && $('modal-title').textContent === PT.BY_KEY[petOpen].name) showPet(petOpen);
      renderPanel();
      renderHud();
    }
    function petMergeAll() {
      if (petBusy) return;
      petBusy = true;
      renderPanel();
      Y.petMergeAll().then((r) => petAfter(r, petDoneMsg));
    }
    $('panel-body').addEventListener('click', (e) => {
      const t = e.target.closest('button[data-pet]');
      if (t) showPet(t.dataset.pet);
    });
    $('modal-body').addEventListener('click', (e) => {
      const t = e.target.closest('button[data-pm], button[data-pset], button[data-pgo]');
      if (!t || t.disabled) return;
      if (t.dataset.pgo !== undefined) {
        $('modal').classList.remove('show');
        if (t.dataset.pgo === 'shop') { tab = 'gacha'; gachaKind = 'pet'; } else { tab = 'equip'; equipView = 'pet'; }
        renderPanel();
        return;
      }
      const key = petOpen;
      if (!key) return;
      if (t.dataset.pset !== undefined) {
        const r = E.petSummon(t.dataset.pset || null);
        toast(r.ok ? (r.key ? `${PT.BY_KEY[r.key].name}을(를) 책상에 올렸어요` : '책상에서 내렸어요') : r.reason);
        showPet(key);
        renderPanel();
        renderHud();
        return;
      }
      petBusy = true;
      showPet(key);
      Y.petMerge(key, Number(t.dataset.pm), Number(t.dataset.n) || 1).then((r) => petAfter(r, petDoneMsg));
    });

    // ----- 설정 창: 장비 보너스 합계 -----
    function bonusBox() {
      const b = E.bonuses();
      const baseCrit = UPGRADES.crit.value(E.S.lv.crit) * 100;
      const lines = I.STAT_KEYS.map((k) => {
        const raw = b.raw[k];
        const cap = I.CAPS[k];
        const parts = [];
        if (raw.pct) parts.push('+' + n2(raw.pct) + I.STATS[k].unit);
        if (raw.flat) parts.push('+' + fmt(raw.flat));
        let note = '';
        if (k === 'critRate') {
          const total = baseCrit + raw.pct;
          note = total > cap.max ? `<em class="over">최종 ${n2(total)}% → 상한 ${cap.max}%</em>` : `<em>최종 ${n2(total)}%</em>`;
        } else if (cap && raw.pct > cap.max) note = `<em class="over">상한 ${cap.max}${I.STATS[k].unit} 초과 (+${n2(raw.pct - cap.max)} 버려짐)</em>`;
        else if (cap) note = `<em>상한 ${cap.max}${I.STATS[k].unit}</em>`;
        return `<div class="bn-row ${parts.length ? '' : 'zero'}"><span>${statName(k)}</span><b>${parts.join(' ') || '—'}</b>${note}</div>`;
      }).join('');
      const cx = b.bySource.extra[I.CODEX.stat].pct;
      return `<div class="bonus-box"><div class="sub-title">장비 보너스 합계</div>${lines}
        <div class="small">도감 ${statName(I.CODEX.stat)} +${n2(cx)}%·인맥 효과 포함 · 장착한 장비의 주·서브·잠재 합산</div></div>`;
    }

    // ----- 설정 창: 계정 -----
    function accountBox() {
      if (!Y.online) {
        return `<div class="acct-box"><div class="sub-title">계정</div>
          <div class="stat-line">서버 없음 · <b>이 기기에만 저장</b></div></div>`;
      }
      const st = Y.status();
      const A = Y.account;
      const prov = A.providers();
      const label = st === 'online' ? (A.isGuest() ? '게스트' : `${prov.map((p) => (p === 'google' ? 'Google' : p === 'apple' ? 'Apple' : p)).join('·')} 연결됨`)
        : st === 'connecting' ? '연결 중…' : '오프라인 (기기에 저장 중)';
      const uid = A.uid();
      const when = Y.lastSyncAt ? new Date(Y.lastSyncAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }) : '—';
      return `<div class="acct-box"><div class="sub-title">계정</div>
        <div class="stat-line">상태: <b>${label}</b></div>
        <div class="small">${uid ? `ID ${uid.slice(0, 8)} · ` : ''}마지막 클라우드 저장 ${when}</div>
        ${A.isGuest() ? `<div class="small">게스트는 앱을 지우면 진행이 사라져요. 계정을 연결하면 다른 기기에서도 이어할 수 있어요.</div>
        <div class="act-row">
          <button class="act-btn" data-act="acct-google">Google로 연결</button>
          <button class="act-btn" data-act="acct-apple">Apple로 연결</button>
        </div>` : ''}
        <div class="act-row">
          <button class="act-btn" data-act="acct-save">지금 저장</button>
          <button class="act-btn danger-lite" data-act="acct-delete" ${uid ? '' : 'disabled'}>계정 삭제</button>
        </div></div>`;
    }

    const isDevHost = () => typeof location !== 'undefined' && (location.hostname === 'localhost' || location.hostname === '127.0.0.1');
    function devBox() {
      const d = UI_CFG.dev;
      return `<div class="dev-box"><div class="sub-title">개발용 (내 컴퓨터에서만 보임)</div>
        <div class="act-row">
          ${Y.online ? '' : `<button class="act-btn" data-act="dev-bonus">성과급 +${fmt(d.bonus)}개</button>
          <button class="act-btn" data-act="dev-corp">법카 +${fmt(d.corp)}장</button>`}
          <button class="act-btn" data-act="dev-gold">재산 +${fmt(E.costBase() * d.goldK)}원</button>
          <button class="act-btn" data-act="dev-jjam">짬 +${d.jjam}개 · 도장 +500 · 출입증 +20 · 칼퇴권 +10</button>
        </div></div>`;
    }

    // 비용 글자 색 (원·성과급이 모자라면 빨강)
    function renderCostLive() {
      const S = E.S;
      document.querySelectorAll('.need').forEach((el) => {
        const short = el.dataset.won !== undefined ? S.gold < Number(el.dataset.won) : S.bonus < Number(el.dataset.bonus);
        el.classList.toggle('short', short);
      });
    }

    // 법카 구매 (구독 아래). 실결제는 출시 때 앱스토어·플레이스토어로
    function corpShop() {
      return `<div class="sub-box">
          <div class="sub-title">법카 구매</div>
          <div class="sub-desc">보유 법카 <b>${fmt(E.S.corp)}장</b> · 가방 확장, 출석 채우기, 성과급 교환에 써요</div>
          ${UI_CFG.corpProducts.filter((p) => !p.hidden).map((p) => `<div class="row"><div class="info"><div class="name">법카 ${fmt(p.corp)}장</div></div>
            <button class="buy" data-corp="${p.id}">₩${p.krw.toLocaleString('ko-KR')}</button></div>`).join('')}
          <div class="small">지금은 테스트 결제라 실제 돈이 나가지 않아요.</div>
        </div>`;
    }

    // 월정액: 즉시 법카 + 30일 동안 매일 출석 때 성과급 (서버가 기간 확인)
    function monthlyBox() {
      const PS = G.Meta.PASS;
      const until = G.Subscription && G.Subscription.monthlyUntil ? G.Subscription.monthlyUntil() : null;
      const left = until ? Math.ceil((until - Date.now()) / 86400000) : 0;
      return `<div class="sub-box">
          <div class="sub-title">월급날 월정액 ${until ? `· ${left}일 남음` : ''}</div>
          <div class="sub-desc">바로 법카 ${fmt(PS.monthlyCorp)}장 + ${PS.monthlyDays}일 동안 매일 출석 때 성과급 +${fmt(PS.monthlyDaily)}개 (모두 ${fmt(PS.monthlyCorp + PS.monthlyDaily * PS.monthlyDays)}개어치)</div>
          <div class="row"><div class="info"><div class="name">월정액 ${PS.monthlyDays}일</div><div class="small">이어서 사면 남은 기간에 더해져요</div></div>
            <button class="buy" data-corp="monthly_30">₩${PS.monthlyKrw.toLocaleString('ko-KR')}</button></div>
          <div class="small">지금은 테스트 결제라 실제 돈이 나가지 않아요.</div>
        </div>`;
    }

    function buyStarter() {
      const ST = G.Meta.STARTER;
      if (busy || E.S.starter) return;
      askConfirm('첫 결제 패키지를 살까요?', `반려 뽑기권 <b class="gold">${fmt(ST.tickets)}장</b> + ${GR[ST.heroMin].name} 이상 반려 뽑기권 <b class="gold">${fmt(ST.hero)}장</b> · ₩${ST.krw.toLocaleString('ko-KR')}<br><span class="small">계정당 1번 · 테스트 결제 (실제 결제 없음)</span>`, '구매', () => {
        busy = true;
        Y.testCorp(0, ST.id).then((r) => { busy = false; toast(r.ok ? `반려 뽑기권 +${fmt(ST.tickets)}장 · ${GR[ST.heroMin].name} 이상 뽑기권 +${fmt(ST.hero)}장` : r.reason); renderPanel(); renderHud(); });
      });
    }

    function subBox() {
      const on = hooks.isSubscribed();
      return `
        <div class="sub-box">
          <div class="sub-title">야근 패스 ${on ? '· 이용 중' : ''}</div>
          <div class="sub-desc">₩5,500 / 30일 · 게임 속도 2배 · 방치 보상 +4시간 · 부서 적재 +4시간 · 매일 출석 때 성과급 +${fmt(G.Meta.PASS.subDaily)}개</div>
          <button class="sub-btn ${on ? 'off' : ''}" id="btn-sub-test">${on ? '테스트 구독 끄기' : '테스트로 구독 켜기'}</button>
          <div class="small">결제는 아직 없어요. 출시 때 앱스토어·플레이스토어 결제로 바뀌어요.</div>
        </div>`;
    }

    // 돈이 바뀔 때마다 갱신되는 부분 (가격, 구매 가능 여부)
    function renderPanelLive() {
      const S = E.S;
      if (tab === 'equip') {
        const box = $('btn-box');
        if (box) box.classList.toggle('ready', S.shards >= I.DROP.shardsPerBox);
      } else if (tab === 'gacha') {
        const lockedSkill = gachaLocked();
        document.querySelectorAll('[data-pull]').forEach((b) => { setDis(b, lockedSkill || S.bonus < GA.costFor(Number(b.dataset.pull))); });
        document.querySelectorAll('[data-tpull]').forEach((b) => { setDis(b, lockedSkill || (S.petticket | 0) < Number(b.dataset.tpull)); });
      }
      if (detailId !== null) renderCostLive();
      if (tab !== 'grow') return;
      for (const k in UPGRADES) {
        const u = UPGRADES[k];
        if (!$('lv-' + k)) continue;
        setText($('lv-' + k), 'Lv.' + S.lv[k] + (u.max ? `/${u.max}` : ''));
        const locked = E.upgradeLocked(k);
        const maxed = E.isMaxed(k);
        if (locked) setText($('desc-' + k), `최고 ${u.unlock}층에서 해금`);
        else if (maxed) setText($('desc-' + k), u.fmt(u.value(S.lv[k])));
        else setText($('desc-' + k), `${u.fmt(u.value(S.lv[k]))} → ${u.fmt(u.value(S.lv[k] + 1))}`);
        for (const m of BUY_MODES) {
          const btn = $(`buy-${k}-${m}`);
          if (locked || maxed) { if (!locked) setText(btn, 'MAX'); else if (!btn.querySelector('.ic')) btn.innerHTML = ICON.lock; setDis(btn, true); continue; }
          const { n, total } = E.buyInfo(k, m === 'max' ? 'max' : Number(m));
          setHtml(btn, `<span>${m === 'max' ? 'MAX' : '+' + m}</span><b>${fmtShort(total)}원</b>`);
          setDis(btn, total > S.gold);
        }
      }

    }

    // ----- 입력 -----
    $('panel-body').addEventListener('click', (e) => {
      // 업무 스킬 장착: 칸을 고른 상태면 스킬 줄 어디를 눌러도 장착 (숙련·교환권 버튼은 제외)
      const skRow = e.target.closest('.sk-row[data-key]');
      if (skRow && skillPickSlot !== null && !e.target.closest('[data-skup],[data-skex]')) { onSkillClick({ dataset: { skr: skRow.dataset.key } }); return; }
      const t = e.target.closest('button');
      if (!t) return;
      if (t.dataset.sks !== undefined || t.dataset.skr || t.dataset.skup || t.dataset.skx !== undefined || t.dataset.skex) { onSkillClick(t); return; }
      if (t.dataset.buy) { const m = t.dataset.bm; if (E.buy(t.dataset.buy, m === 'max' ? 'max' : Number(m) || 1)) { snd('upgrade'); renderPanelLive(); renderHud(); } }
      else if (t.dataset.mode) { E.setBuyMode(t.dataset.mode); renderPanel(); }
      else if (t.dataset.perk) { Y.buyPerk(t.dataset.perk).then((r) => { if (r.ok) renderPanel(); else if (r.reason) toast(r.reason); }); }
      else if (t.dataset.item) {
        const id = Number(t.dataset.item);
        if (bagMode === 'view') openDetail(id);
        else {
          const it = E.item(id);
          if (bagPick.has(id)) bagPick.delete(id);
          else if (!canPick(it)) { toast(E.isEquipped(id) ? '장착 중인 아이템은 못 골라요' : it.protected ? '보호 중인 아이템은 못 골라요' : bagMode === 'merge' ? '같은 부위·등급만 고를 수 있어요' : '고를 수 없어요'); return; }
          else if (bagMode === 'merge' && bagPick.size >= I.MERGE.count) { toast(`${I.MERGE.count}개까지 골라요`); return; }
          else bagPick.add(id);
          renderPanel();
        }
      }
      else if (t.dataset.slot) {
        const id = E.S.equipped[t.dataset.slot];
        if (id === null || id === undefined) toast('가방에서 아이템을 눌러 장착하세요');
        else openDetail(id);
      } else if (t.dataset.sort) { bagSort = t.dataset.sort; bagShow = BAG_PAGE; renderPanel(); }
      else if (t.dataset.filter) {
        if (t.dataset.filter === 'slot') {
          const keys = I.SLOT_KEYS;
          const i = keys.indexOf(bagFilter);
          bagFilter = i < 0 ? keys[0] : i === keys.length - 1 ? 'all' : keys[i + 1];
        } else bagFilter = t.dataset.filter;
        bagShow = BAG_PAGE;
        renderPanel();
      }
      else if (t.dataset.pull || t.dataset.tpull || t.dataset.hpull) {
        if (busy) return;
        busy = true;
        pullingPay = t.dataset.hpull ? 'hero' : t.dataset.tpull ? 'ticket' : '';
        pullingN = Number(t.dataset.pull || t.dataset.tpull || t.dataset.hpull);
        t.classList.add('pulling'); // 서버 답을 기다리는 동안 바로 눌린 티
        Y.pull(pullingN, gachaKind, pullingPay || undefined).then((r) => {
          busy = false;
          pullingN = 0;
          pullingPay = '';
          if (!r.ok) toast(r.reason);
          else showGachaResult(r.results);
          renderPanel();
        });
      } else if (t.dataset.corp) {
        if (t.dataset.corp === G.Meta.STARTER.id) { buyStarter(); return; }
        const p0 = UI_CFG.corpProducts.find((x) => x.id === t.dataset.corp);
        const p = p0 && p0.monthly ? { ...p0, corp: G.Meta.PASS.monthlyCorp, krw: G.Meta.PASS.monthlyKrw } : p0;
        if (!p || busy) return;
        askConfirm(p.monthly ? '월정액을 살까요?' : '법카를 살까요?', `${p.monthly ? `법카 <b class="gold">${fmt(p.corp)}</b> + ${G.Meta.PASS.monthlyDays}일 매일 성과급 ${fmt(G.Meta.PASS.monthlyDaily)}` : `법카 <b class="gold">${fmt(p.corp)}</b>`} · ₩${p.krw.toLocaleString('ko-KR')}<br><span class="small">테스트 결제 (실제 결제 없음)</span>`, '구매', () => {
          busy = true;
          Y.testCorp(p.corp, p.id).then((r) => { busy = false; toast(r.ok ? (p.monthly ? `월정액 시작 · 법카 +${fmt(p.corp)}장` : `법카 +${fmt(p.corp)}장`) : r.reason); renderPanel(); renderHud(); });
        });
      } else if (t.dataset.act) onPanelAct(t.dataset.act);
      else if (t.id === 'btn-quit') showApply(); else if (t.id === 'btn-sub-test') {
        Promise.resolve(hooks.setSubscribedForTest(!hooks.isSubscribed())).then((r) => {
          toast(r && r.ok === false ? r.reason : hooks.isSubscribed() ? '구독 켜짐! (2배속·방치 +4시간·부서 +4시간)' : '구독 꺼짐');
          renderPanel();
          renderHud();
        });
      } else if (t.id === 'btn-reset') {
        if (!Y.online) askConfirm('처음부터 다시 할까요?', '모든 기록이 지워져요', '지우고 다시 시작', () => hooks.onReset());
      }
    });
    // 장비·스킬·사내·상점 탭의 기타 버튼
    function onPanelAct(a) {
      const S = E.S;
      const res = (r, msg) => { if (!r.ok) toast(r.reason); else if (msg) toast(msg); renderPanel(); return r; };
      if (a.startsWith('bm-') || a.startsWith('mk-') || ['bulk-merge', 'preset', 'rec-equip', 'bulk-enh', 'market'].includes(a)) { bagAct(a); return; }
      if (a === 'box') {
        Y.openShardBox().then((r) => {
          if (!r.ok) { toast(r.reason); return; }
          showModal('장신구 상자', `<div class="g-grid one">${itemCard(r.item)}</div><div class="center"><button class="rate-link" data-rates="box">상자 확률 보기</button></div>`);
          recentNew.clear();
          renderPanel();
        });
      } else if (a === 'bag-more') { bagShow += BAG_PAGE; renderPanel(); }
      else if (a === 'codex') showCodex();
      else if (a === 'sets') showSets();
      else if (a === 'bulk') showBulk();
      else if (a === 'auto') {
        const on = !S.autoAppraise;
        res(E.setAutoAppraise(on), on ? '자동 감정 켜짐 (고급·희귀)' : '자동 감정 꺼짐');
      }
      else if (a === 'corp-test' || a === 'corp-swap' || a.startsWith('acct-')) {
        if (busy) return;
        busy = true;
        const done = (r, okMsg) => { busy = false; res(r, r.ok ? okMsg(r) : ''); renderHud(); };
        if (a === 'corp-test') Y.testCorp(UI_CFG.testCorp).then((r) => done(r, () => `법카 +${fmt(UI_CFG.testCorp)}장 (테스트)`));
        else if (a === 'corp-swap') Y.swapAll().then((r) => done(r, (x) => `성과급 +${fmt(x.bonus)}개`));
        else if (a === 'acct-save') Y.account.saveNow().then((r) => done(r.ok ? r : { ok: false, reason: r.reason || '저장 실패 (오프라인)' }, () => '클라우드에 저장했어요'));
        else if (a === 'acct-google' || a === 'acct-apple') Y.account.link(a === 'acct-google' ? 'google' : 'apple').then((r) => done(r, () => '로그인 화면으로 이동해요'));
        else if (a === 'acct-delete') {
          busy = false;
          askConfirm('계정을 삭제할까요?', '층·근로 강화·이직 같은 <b>모든 진행</b>과 아이템·성과급·법카 같은 <b>모든 재화</b>가 지워지고 <b class="over">되돌릴 수 없어요</b>', '다음', () => {
            askConfirm('정말 삭제할까요?', '모든 진행·재화가 지워지고 <b>새 계정으로 1층부터</b> 시작해요', '영구 삭제', () => {
              busy = true;
              Y.account.remove().then((r) => done(r, () => '계정을 삭제했어요'));
            });
          });
        } else busy = false;
      } else if (a === 'dev-bonus') res(E.devGrant({ bonus: UI_CFG.dev.bonus }), '성과급 지급');
      else if (a === 'dev-corp') res(E.devGrant({ corp: UI_CFG.dev.corp }), '법카 지급');
      else if (a === 'dev-gold') { res(E.devGrant({ gold: E.costBase() * UI_CFG.dev.goldK }), '재산 지급'); renderHud(); }
      else if (a === 'dev-jjam') Y.devGrant({ jjam: UI_CFG.dev.jjam, stamps: 500, pass: 20, kaltoe: 10 }).then((r) => { res(r, '짬·도장·출입증·칼퇴권 지급'); renderHud(); });
      else if (a === 'stamp-buy') Y.buyStamps(I.STAMP.shop.step).then((r) => { res(r, `결재 도장 +${I.STAMP.shop.step}개`); renderHud(); });
      else if (a === 'stats') showStats();
      else if (a === 'bag') showBagBuy();
      else if (a === 'gk-acc' || a === 'gk-equip' || a === 'gk-skill' || a === 'gk-pet') { gachaKind = a.slice(3); renderPanel(); }
      else if (a === 'ev-gear') { equipView = 'gear'; renderPanel(); }
      else if (a === 'ev-pet') { if (!G.Pets.isOpen(S.maxStage)) toast(`반려는 최고 ${G.Pets.CFG.unlock}층에서 열려요`); else { equipView = 'pet'; bagMode = 'view'; renderPanel(); } }
      else if (a === 'pet-shop') { tab = 'gacha'; gachaKind = 'pet'; renderPanel(); }
      else if (a === 'pet-all') petMergeAll();
      else if (a === 'sk-all') Y.skillLevelUpAll().then((r) => { res(r, r.ok ? `스킬 ${r.n}번 숙련` : ''); renderHud(); });
      else if (a === 'sk-shop') { tab = 'gacha'; gachaKind = 'skill'; renderPanel(); }
      else if (a === 'tool-dis' || a === 'tool-merge') showTool(a.slice(5));
      else if (a === 'att') showAttendance();
      else if (a === 'ad') Y.watchAd().then((r) => res(r, r.ok ? `광고 보상 성과급 +${r.bonus}개 (테스트)` : ''));
      else if (a === 'ach') showAchievements();
      else if (a === 'mis') showMissions();
      else if (a === 'tower') showTower();
      else if (a === 'dept') showDept();
      else if (a === 'net') showNet();
      else if (a.startsWith('set-')) { res(E.setSetting(a.slice(4), !S.settings[a.slice(4)])); }
    }

    $('sheet').addEventListener('click', (e) => {
      if (e.target.id === 'sheet') { closeDetail(); return; }
      const t = e.target.closest('button');
      if (t && !t.disabled) onSheetAct(t);
    });
    // 상단 재화칸 누르면 얻는 곳 (use는 지금 화면에 안 씀, 2026-10-27 사용자: 쓰는 곳 빼기)
    const LOW_DROP_NOTE = `적 처치 드롭은 이번 회차 최고 층보다 ${G.Items.DROP.lowFloor.free + 1}층 이상 아래면 줄어요`;
    const WALLET_INFO = {
      gold: { name: '재산', get: ['적 처치', '방치 보상', '장비 분해', '부서 장악'], use: ['근로 강화', '장비 강화·감정', '도장 구매', '반려 합치기'], note: '이직하면 0이 돼요' },
      bonus: { name: '성과급', get: ['출석', '미션', '업적', '광고', '보스 신기록', '이직', '도감', '양파나라', '야근 타워', '부서 장악', '법카 교환', '반려 도감'],
        use: ['뽑기', '이직 카드 새로고침', '가방 확장', '재감정 잠금', '출입증 구매'] },
      corp: { name: '법카', get: ['상점 구매'], use: ['가방 확장', '출석 채우기', '성과급 교환'] },
      jjam: { name: '짬', get: ['강화 실패', '합성 실패', '야근 타워', '부서 장악'], use: ['강화 보정', '재감정'] },
      shards: { name: '장신구 조각', get: ['적 처치', '보스 처치', '부서 장악'], use: ['장신구 상자'], note: LOW_DROP_NOTE },
      career: { name: '경력', get: ['이직'], use: ['특전 강화'], note: '이직해도 남아요' },
      namecard: { name: '명함', get: ['외부 미팅', '기획팀 생산', '미팅 바로 처리 (칼퇴권)'], use: ['인맥 친분 올리기'], go: 'net' },
      stamps: { name: '결재 도장', get: ['출석', '미션', '적 처치', '방치 보상', '야근 타워', '상점 구매', '부서 장악'], use: ['장비 강화 (+5부터)', '흔적 복구'], note: LOW_DROP_NOTE },
    };
    function showWalletInfo(key) {
      const w = WALLET_INFO[key];
      if (!w) return;
      const li = (xs) => `<div class="src-list">${xs.map((x) => `<span>${x}</span>`).join('')}</div>`;
      const have = $('cur-' + key) ? $('cur-' + key).textContent : fmt(E.S[key] || 0) + '장';
      // 쓰는 곳 바로가기 (명함 → 인맥 관리). 다른 재화는 얻는 곳만 (2026-10-27 사용자)
      const go = w.go === 'net' ? `<div class="it-sec-t">쓰는 곳</div>${li(w.use)}
        <button class="act-btn wide" data-wgo="net" ${E.netInfo().open ? '' : 'disabled'}>${E.netInfo().open ? '인맥 관리 열기' : '첫 부서 장악 때 열려요'}</button>` : '';
      showModal(w.name, `<div class="stat-line">보유 <b>${have}</b></div>
        <div class="it-sec-t">얻는 곳</div>${li(w.get)}
        ${w.note ? `<div class="small">${w.note}</div>` : ''}${go}`);
    }
    // 재화 전체 보기 (맨 위엔 재산·성과급·법카만, 2026-10-27 사용자)
    function showWalletAll() {
      const S = E.S;
      const rows = [['gold', '재산', fmt(S.gold) + '원'], ['bonus', '성과급', fmt(S.bonus) + '개'], ['corp', '법카', fmt(S.corp) + '장'],
        ['stamps', '결재 도장', fmt(S.stamps) + '개'], ['jjam', '짬', fmt(S.jjam) + '개'], ['shards', '장신구 조각', fmt(S.shards) + '개'],
        ['career', '경력', fmt(S.career) + '점'], ['', '출입증', fmt(S.pass || 0) + '장'], ['', '칼퇴권', fmt(S.kaltoe || 0) + '장'], ['namecard', '명함', fmt(S.namecard || 0) + '장']];
      showModal('내 재화', `<div class="wallet-all">${rows.map(([k, n, v]) => k
        ? `<button class="wa-row" data-wa="${k}"><span>${n}</span><b>${v}</b><small>${WALLET_INFO[k] && WALLET_INFO[k].go ? '얻는 곳·쓰는 곳 ›' : '얻는 곳 ›'}</small></button>`
        : `<div class="wa-row"><span>${n}</span><b>${v}</b><small></small></div>`).join('')}</div>`);
    }
    $('modal-body').addEventListener('click', (e) => {
      const t = e.target.closest('button[data-wa]');
      if (t) showWalletInfo(t.dataset.wa);
      const g = e.target.closest('button[data-wgo]');
      if (g && !g.disabled) showNet();
    });
    $('wallet-all').addEventListener('click', showWalletAll);
    document.querySelectorAll('#wallet .cur').forEach((el) => {
      const key = [...el.classList].find((c) => c.startsWith('c-')).slice(2);
      el.setAttribute('role', 'button');
      el.tabIndex = 0;
      el.setAttribute('aria-label', (WALLET_INFO[key] ? WALLET_INFO[key].name : key) + ' 얻는 곳 보기');
      el.addEventListener('click', () => showWalletInfo(key));
      el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); showWalletInfo(key); } });
    });
    $('layer').addEventListener('click', (e) => {
      if (toolMode) {
        if (e.target.id === 'layer') { closeTool(); return; }
        const t = e.target.closest('button');
        if (t && !t.disabled) onToolClick(t);
        return;
      }
      if (e.target.id === 'layer') { enhOpen = false; mergeOpen = false; renderSheet(); return; }
      const t = e.target.closest('button');
      if (t && !t.disabled) onSheetAct(t);
    });
    // 팝업 안 버튼 (일괄 분해 등급 고르기)
    $('modal-body').addEventListener('click', (e) => {
      const t = e.target.closest('button[data-dis]');
      if (!t || t.disabled) return;
      const g = Number(t.dataset.dis);
      askConfirm('일괄 분해할까요?', `${gradeTag(g)} 이하 · 장착·보호 제외<br>${t.querySelector('b').textContent} <b class="gold">${t.querySelector('small').textContent}</b>`, '분해하기', () => {
        Y.dismantleBelow(g).then((r) => {
          if (!r.ok) toast(r.reason);
          else toast(`${r.count}개 분해 · 재산 +${fmt(r.gold)}원`);
          renderPanel();
        });
      });
    });
    document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => { tab = t.dataset.tab; renderPanel(); $('panel-body').scrollTop = 0; }));
    for (const k in SKILLS) $('skill-' + k).addEventListener('click', () => E.useSkill(k));
    $('btn-autoskill').addEventListener('click', () => { E.setAutoSkill(!E.S.autoSkill); renderHud(); });
    $('btn-speed').addEventListener('click', () => {
      if (!hooks.isSubscribed()) {
        showModal('2배속은 구독 혜택이에요', '야근 패스를 구독하면 게임 속도가 2배가 돼요.<br>상점 탭에서 테스트로 켜볼 수 있어요.');
        return;
      }
      E.S.speedOn = !E.S.speedOn;
      hooks.applySpeed();
      toast(E.S.speedOn ? '2배속 켜짐' : '2배속 꺼짐');
      renderHud();
    });
    $('btn-advance').addEventListener('click', () => {
      if (E.side) E.sideExit(); else if (E.mode === 'tower') E.towerExit(); else E.toggleAdvance();
      renderHud();
    });
    $('battle').addEventListener('click', (e) => {
      // 화면 탭 = 직접 일하기 (보너스 공격)
      if (e.target.closest('button')) return;
      E.tap();
    });
    $('modal-ok').addEventListener('click', () => {
      $('modal').classList.remove('show');
      const fn = modalYes;
      modalYes = null;
      modalNo = null;
      choice = null;
      if (fn) fn();
      afterModalClose();
    });
    // 창 바깥 빈 곳 누르면 닫기 (취소 버튼이 있으면 취소, 없으면 확인과 같음 — 보상 받기 창도 놓치지 않게)
    // 설정 창 안 버튼
    $('modal-body').addEventListener('click', (e) => {
      const sb = e.target.closest('button[data-snd]');
      if (sb && !sb.disabled && SND) {
        if (sb.dataset.snd === 'on') SND.setOn(!SND.on); else SND.cycleVol();
        snd('coin');
        showSettings();
        return;
      }
      const t = e.target.closest('button[data-set], button[data-act^="acct-"], button[data-act^="dev-"], button[data-act^="corp-"], button[data-act="tut-replay"]');
      if (!t || t.disabled) return;
      const k = t.dataset.set;
      if (k === 'reset') { if (!Y.online) askConfirm('처음부터 다시 할까요?', '모든 기록이 지워져요', '지우고 다시 시작', () => hooks.onReset()); return; }
      if (k) { const r = E.setSetting(k, !E.S.settings[k]); if (!r.ok) toast(r.reason); showSettings(); return; }
      if (t.dataset.act === 'tut-replay') { GU.replay(); return; }
      onPanelAct(t.dataset.act);
      setTimeout(() => { if ($('modal').classList.contains('show') && $('modal-title').textContent === '설정') showSettings(); }, 300);
    });
    // 사내 게시판·튜토리얼 (ui-guide.js)
    GU = G.createGuideUI({
      snd,
      E, Y, $, fmt, showModal, askConfirm, toast, showAttendance, showMissions, showNet,
      openTab(t) { $('modal').classList.remove('show'); tab = t; renderPanel(); $('panel-body').scrollTop = 0; },
      openPets() { $('modal').classList.remove('show'); tab = 'equip'; equipView = 'pet'; renderPanel(); $('panel-body').scrollTop = 0; },
    });
    $('si-board').addEventListener('click', () => GU.showBoard());
    // 버튼 누름 소리 (작게 딸깍, 저전력이면 안 남)
    document.addEventListener('click', (e) => { const b = e.target.closest('button'); if (b && !b.disabled) snd('click'); }, true);
    // 어느 창에서든 [확률] → 게시판 확률 공개 해당 칸 (구매·강화 화면에서 바로 확인)
    document.addEventListener('click', (e) => {
      const t = e.target.closest('[data-rates]');
      if (!t) return;
      e.stopPropagation();
      GU.showBoard('rates', t.dataset.rates);
    }, true);
    // 전투 화면 옆 아이콘: 게시판·출석·미션·업적·설정
    $('si-att').addEventListener('click', () => showAttendance());
    $('si-mis').addEventListener('click', () => { if (E.isUnlocked('mission')) showMissions(); else toast(`미션은 최고 ${G.Meta.MIS.unlock}층에서 열려요`); });
    $('si-ach').addEventListener('click', () => showAchievements());
    $('si-set').addEventListener('click', () => showSettings());
    function renderSideDots() {
      $('si-ach').classList.toggle('has-dot', E.achievements().some((a) => a.ready));
      $('si-mis').classList.toggle('locked', !E.isUnlocked('mission'));
    }
    setInterval(renderSideDots, 1000);
    $('modal').addEventListener('click', (e) => {
      if (e.target.id !== 'modal') return;
      $($('modal-cancel').hidden ? 'modal-ok' : 'modal-cancel').click();
    });
    $('modal-cancel').addEventListener('click', () => {
      const fn = modalNo;
      modalYes = null;
      modalNo = null;
      $('modal').classList.remove('show');
      choice = null;
      if (fn) fn();
      afterModalClose();
    });

    // ----- 그림 준비 -----
    function initVisuals() {
      setSprite($('player'), 'player', 3);
      setSprite($('desk'), 'desk', 3);

      for (const k in SKILLS) $('skill-' + k).insertAdjacentHTML('afterbegin', SP.spriteImg('icon:' + k, 3));
      const battle = $('battle');
      let bgKey = '';
      const fitBg = () => {
        const w = battle.clientWidth, h = battle.clientHeight;
        if (!w || !h || w + 'x' + h === bgKey) return;
        bgKey = w + 'x' + h;
        const bg = SP.officeBackground(w, h, Math.min(3, window.devicePixelRatio || 2));
        battle.style.backgroundImage = `url(${bg.toDataURL()})`;
        battle.style.backgroundSize = `${w}px ${h}px`;
      };
      fitBg();
      window.addEventListener('resize', fitBg);
      if (document.fonts) document.fonts.ready.then(() => { bgKey = ''; fitBg(); });
    }

    let lastDirtyRender = 0;
    return {
      initVisuals,
      renderPanel,
      showOffline,
      askChoice,
      markDirty() { dirty = true; },
      // 0.1초마다 호출
      tick() {
        renderHud();
        GU.tick();
        // 처치 드롭 등으로 바뀐 아래 패널: 가방이 크면 통째로 다시 그리는 게 비쌈 → 0.5초(저전력 2초)에 한 번만
        const now = performance.now();
        if (dirty && now - lastDirtyRender >= (E.S.settings.lowPower ? 2000 : 500)) { lastDirtyRender = now; renderPanel(); if (detailId !== null) renderSheet(); }
        renderPanelLive();
      },
    };
  }

  G.createUI = createUI;
})(globalThis.Game = globalThis.Game || {});
