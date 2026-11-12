// 화면: 사내 게시판(공지·확률 공개·업데이트 내역) + 튜토리얼 "신입 OJT"(입사 첫날·사수의 포스트잇·사수 한마디·탭 첫 안내)
// 명세 docs/impl-spec-m4.md ①② · 규칙은 meta.js GUIDE·rates.js·board.js, 문구는 guide-text.js. ui.js가 도우미를 넘겨줌
(function (G) {
  'use strict';

  // c = { E, Y, $, showModal, askConfirm, toast, openTab(tab), currentTab(), showAttendance, showMissions, fmt, approveStamp }
  function createGuideUI(c) {
    const { E, Y, $, fmt } = c;
    const T = G.GuideText;
    const R = G.Rates;
    const B = G.Board;
    const GN = G.Items.GRADES.map((g) => g.name);
    const esc = (s) => String(s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
    const reduced = () => window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
    const modalOpen = () => $('modal').classList.contains('show');

    // ================= 사내 게시판 =================
    let bdTab = 'notice';
    let rateKey = 'gacha_equip';
    let notices = null; // null = 아직 안 불러옴
    let loading = false;

    const unread = () => B.unread(E.S.board, Y.board.latest(), R.version());
    function loadNotices() {
      if (loading) return;
      loading = true;
      Y.board.list().then((r) => {
        loading = false;
        notices = r.ok ? r.list : [];
        if (!r.ok) c.toast(r.reason);
        if (bdTab === 'notice') markSeen();
        if (isBoardOpen()) renderBoard();
      });
    }
    function markSeen() {
      if (bdTab === 'notice' && notices) E.S.board.seenId = Math.max(E.S.board.seenId, Y.board.latest(), B.latestId(notices));
      if (bdTab === 'rates') E.S.board.seenRates = R.version();
    }
    const isBoardOpen = () => modalOpen() && $('modal-title').textContent === '사내 게시판';

    // tab: 'notice' | 'rates' | 'updates', key: 확률표 칸 (rates.js key)
    function showBoard(tab, key) {
      if (tab) bdTab = tab;
      if (key && R.byKey(key)) rateKey = key;
      if (notices === null || bdTab === 'notice') loadNotices();
      markSeen();
      renderBoard();
    }

    function renderBoard() {
      const u = unread();
      const tabs = [['notice', '공지', u.notice], ['rates', '확률 공개', u.rates], ['updates', '업데이트 내역', false]];
      const body = bdTab === 'rates' ? ratesHtml() : bdTab === 'updates' ? updatesHtml() : noticeHtml();
      const keep = isBoardOpen() ? $('modal-body').scrollTop : 0;
      c.showModal('사내 게시판', `<div class="bd">
        <div class="seg bd-tabs" role="tablist">${tabs.map(([k, n, dot]) => `<button role="tab" aria-selected="${bdTab === k}" data-bd-tab="${k}" class="${bdTab === k ? 'active' : ''}">${n}${dot && bdTab !== k ? '<i class="dot"></i>' : ''}</button>`).join('')}</div>
        ${Y.board.outdated() ? '<div class="bd-warn">서버의 확률표가 이 앱보다 새로워요. 앱을 업데이트해 주세요.</div>' : ''}
        ${body}</div>`);
      $('modal').classList.add('wide');
      $('modal-ok').textContent = '닫기';
      $('modal-body').scrollTop = keep;
    }

    // ----- 공지 -----
    const dateTxt = (at) => (at ? at.slice(5, 10).replace('-', '.') : '');
    function noticeHtml() {
      if (notices === null) return '<div class="bd-empty">불러오는 중…</div>';
      if (!notices.length) return '<div class="bd-empty">지금 걸린 공지가 없어요.</div>';
      return `<div class="bd-wall">${notices.map((n) => `
        <article class="bd-note k-${n.kind} ${n.pinned ? 'pinned' : ''}">
          ${n.pinned ? '<i class="bd-pin" aria-label="고정"></i>' : ''}
          <header><span class="bd-kind">${B.KINDS[n.kind]}</span><time>${dateTxt(n.at)}</time></header>
          <h4>${esc(n.title)}</h4>
          ${n.body ? `<p>${esc(n.body).replace(/\n/g, '<br>')}</p>` : ''}
        </article>`).join('')}</div>`;
    }

    // ----- 확률 공개 -----
    // 지금 내 상태에 해당하는 줄 (형광펜): 뽑기 = 내 뽑기 레벨, 드롭·상자 = 지금 유효 층 구간
    function myRow(sec, ti) {
      if (sec.key.startsWith('gacha_') && ti < 2) {
        const kind = sec.key.slice(6);
        const gs = E.S.gacha[kind];
        return gs ? G.Gacha.levelFor(gs.count, G.Gacha.configFor(kind)) : -1;
      }
      if ((sec.key === 'drop' || sec.key === 'box') && ti === 0) {
        const tbl = sec.key === 'drop' ? G.Items.DROP.gradeTable : G.Items.DROP.boxTable;
        return G.Drops.bracketIndex(E.eff(), false, tbl);
      }
      return -1;
    }
    function ratesHtml() {
      const all = R.all();
      const groups = [];
      for (const s of all) { let g = groups.find((x) => x[0] === s.group); if (!g) groups.push(g = [s.group, []]); g[1].push(s); }
      const sec = R.byKey(rateKey) || all[0];
      const picker = groups.map(([g, list]) => `<div class="bd-pick"><span>${g}</span>${list.map((s) =>
        `<button class="chip ${s.key === sec.key ? 'on' : ''}" data-bd-rate="${s.key}" aria-pressed="${s.key === sec.key}">${s.title.replace(/ 뽑기$/, '')}</button>`).join('')}</div>`).join('');
      const tables = sec.tables.map((t, ti) => {
        const mine = myRow(sec, ti);
        const num = (v) => /^[\d.,×%~+\-]+%?$/.test(v) ? ' class="n"' : '';
        const rowHead = (v) => { const [a, b] = String(v).split('\n'); return b ? `${a}<small class="sub">${b}</small>` : a; };
        return `<div class="bd-tbl-wrap"><table class="bd-tbl cols-${t.head.length}">
          <caption>${t.caption}${mine >= 0 ? '<span class="cap-me">형광펜 = 지금 내 상태</span>' : ''}</caption>
          <thead><tr>${t.head.map((h) => `<th>${h}</th>`).join('')}</tr></thead>
          <tbody>${t.rows.map((r, i) => `<tr class="${i === mine ? 'me' : ''}">${r.map((v, j) => j === 0 ? `<th scope="row">${rowHead(v)}</th>` : `<td${num(v)}>${v}</td>`).join('')}</tr>`).join('')}</tbody>
        </table></div>`;
      }).join('');
      return `<div class="bd-picker">${picker}</div>
        <section class="bd-doc" aria-label="${sec.title} 확률">
          <div class="bd-docno"><span>확률 공개</span><span>문서번호 ${sec.key}-${sec.ver}</span></div>
          <h4>${sec.title}</h4>
          ${tables}
          <ul class="bd-notes">${sec.notes.map((n) => `<li>${n}</li>`).join('')}</ul>
          <div class="bd-foot">이 표는 게임 규칙 파일에서 바로 만들어요. 서버도 같은 규칙으로 판정해요 · 전체 버전 ${R.version()}</div>
        </section>`;
    }

    // ----- 업데이트 내역 -----
    function updatesHtml() {
      if (!B.UPDATES.length) return '<div class="empty-note">아직 업데이트 내역이 없어요. 출시 후부터 여기에 적어요.</div>';
      let ratesShown = false;
      return `<ol class="bd-log">${B.UPDATES.map((u) => {
        const rv = u.rates && !ratesShown ? (ratesShown = true, `<small>확률표 ${R.version()}</small>`) : '';
        return `<li><time>${u.at}</time><ul>${u.lines.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>${rv}</li>`;
      }).join('')}</ol>`;
    }

    $('modal-body').addEventListener('click', (e) => {
      const t = e.target.closest('button[data-bd-tab], button[data-bd-rate]');
      if (!t || !isBoardOpen()) return;
      if (t.dataset.bdTab) { bdTab = t.dataset.bdTab; if (bdTab === 'notice' && notices === null) loadNotices(); markSeen(); $('modal-body').scrollTop = 0; }
      if (t.dataset.bdRate) rateKey = t.dataset.bdRate;
      renderBoard();
    });

    // ================= 사수의 포스트잇 =================
    let lastPostit = '';
    let claiming = false;
    // 접기 (전투 화면을 가릴 때): 머리줄만 남김. 이 기기에만 기억
    let folded = false;
    try { folded = localStorage.getItem('overtime-postit-fold') === '1'; } catch (e) { /* 저장 안 돼도 됨 */ }
    function setFold(v) {
      folded = v;
      try { localStorage.setItem('overtime-postit-fold', v ? '1' : '0'); } catch (e) { /* 무시 */ }
      renderPostit();
    }
    function renderPostit() {
      const el = $('postit');
      const fb = $('postit-fold');
      const g = E.guideInfo();
      const show = g && E.S.tut.intro && !intro && E.mode === 'main';
      if (!show) { fb.hidden = true; if (!el.hidden) { el.hidden = true; lastPostit = ''; } return; }
      el.classList.toggle('folded', folded);
      fb.hidden = false;
      if (fb.dataset.f !== String(folded)) {
        fb.dataset.f = String(folded);
        fb.textContent = folded ? '+' : '−';
        fb.setAttribute('aria-label', folded ? '사수 메모 펴기' : '사수 메모 접기');
        fb.setAttribute('aria-expanded', String(!folded));
      }
      const total = G.Meta.GUIDE.steps.length;
      const head = g.floor ? '층 미션' : `사수 메모 <b>${g.k}</b>/${total}`;
      const reward = `+${fmt(g.bonus)}${g.pass ? ` 출입증${g.pass}` : ''}`;
      const pct = Math.min(100, 100 * g.cur / g.need);
      const html = `<span class="pi-tape" aria-hidden="true"></span>
        <span class="pi-head"><span>${head}</span><em>${reward}</em></span>
        <span class="pi-text">${g.text}</span>
        ${g.done ? '<span class="pi-done"><i class="pi-stamp">완료</i><em>눌러서 받기</em></span>'
          : `<span class="pi-foot"><span class="pi-bar"><i style="width:${pct}%"></i></span><em>${fmt(g.cur)}/${fmt(g.need)}</em></span>`}`;
      el.hidden = false;
      el.classList.toggle('ready', g.done);
      if (html !== lastPostit) {
        el.innerHTML = html;
        el.setAttribute('aria-label', `사수 메모: ${g.text}. ${g.done ? '완료, 눌러서 보상 받기' : `${g.cur}/${g.need}`}`);
        lastPostit = html;
      }
    }
    // 바로가기: 할 일이 있는 화면으로
    function goTo(where) {
      if (where === 'att') c.showAttendance();
      else if (where === 'mis') { if (E.isUnlocked('mission')) c.showMissions(); else c.toast(`미션은 최고 ${G.Meta.MIS.unlock}층에서 열려요`); }
      else if (where === 'shop') c.openTab('gacha');
      else if (where === 'net') { c.openTab('office'); if (c.showNet) c.showNet(); }
      else if (where === 'pet') { if (c.openPets) c.openPets(); else c.openTab('equip'); }
      else if (where && where !== 'battle') c.openTab(where);
    }
    function onPostit() {
      const g = E.guideInfo();
      if (!g || claiming) return;
      if (folded && !g.done) { setFold(false); return; } // 접힌 메모를 누르면 펴기 (완료면 바로 받기)
      if (!g.done) {
        if (g.go === 'battle') c.toast(g.text);
        goTo(g.go);
        return;
      }
      claiming = true;
      Y.guideClaim().then((r) => {
        claiming = false;
        if (!r.ok) { c.toast(r.reason); return; }
        if (c.snd) c.snd('ding');
        c.toast(`포스트잇 완료 · 성과급 +${fmt(r.bonus)}${r.pass ? ` · 출입증 +${r.pass}` : ''}`);
        const el = $('postit');
        if (!reduced() && E.fxOn('fx')) { el.classList.remove('peel'); void el.offsetWidth; el.classList.add('peel'); setTimeout(() => el.classList.remove('peel'), 520); }
        lastPostit = '';
      });
    }
    $('postit').addEventListener('click', (e) => { e.stopPropagation(); onPostit(); });
    $('postit-fold').addEventListener('click', (e) => { e.stopPropagation(); setFold(!folded); });

    // ================= 입사 첫날 (손가락 3단계) =================
    let intro = null; // {i, lv0}
    const TARGET = { battle: () => $('battle'), atk: () => $('buy-atk-1'), advance: () => $('btn-advance') };
    function introStart() {
      intro = { i: 0, lv0: E.S.lv.atk };
      $('intro').hidden = false;
      introRender();
    }
    function introEnd(skipped) {
      intro = null;
      $('intro').hidden = true;
      E.S.tut.intro = true;
      if (skipped) c.toast('안내를 건너뛰었어요 · 설정에서 다시 볼 수 있어요');
      lastPostit = '';
    }
    function introNext() {
      if (!intro) return;
      intro.i++;
      if (intro.i >= T.INTRO.length) { introEnd(false); return; }
      const st = T.INTRO[intro.i];
      if (st.until === 'atk') { c.openTab('grow'); intro.lv0 = E.S.lv.atk; }
      introRender();
    }
    function introRender() {
      const st = T.INTRO[intro.i];
      $('intro').innerHTML = `<div class="intro-hole" id="intro-hole"></div>
        <div class="intro-bubble" id="intro-bubble" role="dialog" aria-label="입사 첫날 안내">
          <div class="mc-who"><i class="mc-stamp" aria-hidden="true"><img src="img/chars/mentor.png" alt="" draggable="false"></i><span>사수 ${T.MENTOR}</span><em>입사 첫날 ${intro.i + 1}/${T.INTRO.length}</em></div>
          <p>${st.text}</p>
          <div class="intro-act"><button class="intro-skip" data-intro="skip">건너뛰기</button>${st.until === 'ok' ? '<button class="intro-ok" data-intro="ok">알겠어요</button>' : `<span class="intro-hint">${st.until === 'tap' ? '빛나는 곳을 눌러 보세요' : '+1 버튼을 눌러 보세요'}</span>`}</div>
        </div>`;
      introPlace();
    }
    // 비추는 곳·말풍선 위치 (화면 크기·스크롤이 바뀌어도 따라감)
    function introPlace() {
      const st = T.INTRO[intro.i];
      const el = TARGET[st.target] && TARGET[st.target]();
      const hole = $('intro-hole');
      const bub = $('intro-bubble');
      if (!hole || !bub) return;
      const app = $('app').getBoundingClientRect();
      if (!el) { hole.style.display = 'none'; return; }
      if (st.target === 'atk') el.scrollIntoView({ block: 'nearest' });
      const r = el.getBoundingClientRect();
      const pad = st.target === 'battle' ? -8 : 6;
      Object.assign(hole.style, { display: 'block', left: r.left - app.left - pad + 'px', top: r.top - app.top - pad + 'px', width: r.width + pad * 2 + 'px', height: r.height + pad * 2 + 'px' });
      // 비춘 곳이 화면 위쪽이면 말풍선은 그 아래, 아니면 위
      const below = r.top + r.height / 2 - app.top < app.height / 2;
      const bh = bub.offsetHeight;
      let top = below ? r.bottom - app.top + 14 : r.top - app.top - bh - 14;
      top = Math.max(8, Math.min(app.height - bh - 8, top));
      bub.style.top = top + 'px';
    }
    $('intro').addEventListener('click', (e) => {
      const t = e.target.closest('button[data-intro]');
      if (!t) return;
      if (t.dataset.intro === 'skip') introEnd(true); else introNext();
    });
    $('battle').addEventListener('click', (e) => {
      if (intro && T.INTRO[intro.i].until === 'tap' && !e.target.closest('button')) setTimeout(introNext, 250);
    });

    // ================= 사수 한마디 (기능 열릴 때) =================
    const cardQ = [];
    function unlockCard(key, name) {
      const card = T.CARDS[key];
      if (!card) { c.toast(`${name} 해금!`); return; }
      if (!cardQ.includes(key)) cardQ.push(key);
    }
    function showNextCard() {
      if (!cardQ.length || modalOpen() || intro) return;
      const key = cardQ.shift();
      const card = T.CARDS[key];
      E.S.tut.seen['card_' + key] = true;
      c.askConfirm(card.title, `<div class="mentor-card"><div class="mc-who"><i class="mc-stamp" aria-hidden="true"><img src="img/chars/mentor.png" alt="" draggable="false"></i><span>사수 ${T.MENTOR} 한마디</span><em>새 기능</em></div>
        <p>${card.lines.join('<br>')}</p></div>`, '가 보기', () => goTo(card.go));
      $('modal-cancel').textContent = '닫기';
    }

    // ================= 탭 첫 방문 말풍선 =================
    function tabTip(tab) {
      const text = T.TABS[tab];
      if (!text || !E.S.tut.intro || E.S.tut.seen['tab_' + tab]) return '';
      return `<div class="tab-tip" data-tip-tab="${tab}"><i class="mc-stamp" aria-hidden="true"><img src="img/chars/mentor-coffee.png" alt="" draggable="false"></i><p>${text}</p><button data-tip="${tab}" aria-label="알겠어요">알겠어요</button></div>`;
    }
    $('panel-body').addEventListener('click', (e) => {
      const t = e.target.closest('button[data-tip]');
      if (!t) return;
      e.stopPropagation();
      E.S.tut.seen['tab_' + t.dataset.tip] = true;
      const box = t.closest('.tab-tip');
      if (box) box.remove();
    });

    // 설정: 튜토리얼 다시 보기 (보상은 다시 안 줌 — 포스트잇 단계는 그대로)
    function replay() {
      E.S.tut.intro = false;
      E.S.tut.seen = {};
      $('modal').classList.remove('show');
      c.openTab('grow');
    }

    // 서버 연결 중 화면에 팁 한 줄
    function gateTip() {
      const el = $('net-tip');
      if (el) el.textContent = 'TIP · ' + T.TIPS[Math.floor(Math.random() * T.TIPS.length)];
    }
    gateTip();
    setInterval(() => { if (!$('net-gate').hidden) gateTip(); }, 6000);

    // 0.1초마다
    function tick() {
      renderPostit();
      // 입사 첫날 안내가 다른 창(장비 상세·강화·팝업·연결 화면)을 어둡게 덮지 않게: 그 창이 떠 있는 동안 숨김
      // 다른 기기 진행을 불러와 이미 끝난 안내면 닫음 (2026-10-29)
      if (intro && E.S.tut.intro) { intro = null; $('intro').hidden = true; }
      const covered = modalOpen() || $('sheet').classList.contains('show') || $('layer').classList.contains('show') || !$('net-gate').hidden;
      if (intro) $('intro').hidden = covered;
      if (intro && !covered) {
        const st = T.INTRO[intro.i];
        if (st.until === 'atk' && E.S.lv.atk > intro.lv0) introNext();
        else introPlace();
      } else if (!intro && !E.S.tut.intro && !covered) introStart();
      showNextCard();
      const u = unread();
      $('si-board').classList.toggle('has-dot', u.notice || u.rates);
    }

    return { showBoard, unlockCard, tabTip, replay, tick, introOn: () => !!intro };
  }

  G.createGuideUI = createGuideUI;
})(globalThis.Game = globalThis.Game || {});
