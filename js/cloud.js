// 서버 통신·로그인 (Supabase). 게임 규칙은 모름 — 요청 보내고 결과만 돌려줌.
// 처음 실행하면 게스트(익명) 계정이 자동으로 만들어지고, 나중에 Google·Apple로 연결하면 같은 진행을 이어감.
(function (G) {
  'use strict';

  const META_KEY = 'overtime-cloud-meta'; // { uid, rev } : 마지막으로 맞춘 서버 세이브 번호

  class CloudError extends Error {
    constructor(code, extra) { super(code); this.code = code; this.extra = extra || {}; }
  }

  function requestId() {
    try { return crypto.randomUUID().replace(/-/g, ''); } catch (e) {
      return Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
    }
  }

  function createCloud({ config, sdk = globalThis.supabase, storage = globalThis.localStorage } = {}) {
    let client = null;
    let user = null;
    const C = {
      status: 'off', // off(서버 미설정) · connecting · online · offline(연결 실패)
      CloudError,
      requestId,
    };
    if (!config || !config.serverEnabled() || !sdk) return C;
    C.status = 'connecting';

    client = sdk.createClient(config.supabaseUrl, config.supabaseAnonKey, {
      auth: { persistSession: true, autoRefreshToken: true, storageKey: 'overtime-auth', detectSessionInUrl: true },
    });

    C.meta = function () {
      try { const m = JSON.parse(storage.getItem(META_KEY) || 'null'); return m && typeof m === 'object' ? m : {}; } catch (e) { return {}; }
    };
    C.setMeta = function (m) { try { storage.setItem(META_KEY, JSON.stringify(m)); } catch (e) { /* 저장소 막힘 */ } };
    C.clearMeta = function () { try { storage.removeItem(META_KEY); } catch (e) { /* */ } };

    C.uid = () => (user ? user.id : null);
    C.isGuest = () => !user || user.is_anonymous === true;
    // 연결된 로그인 수단 (google, apple …)
    C.providers = () => (user && Array.isArray(user.identities) ? user.identities.map((i) => i.provider).filter((p) => p !== 'anonymous') : []);

    // 로그인 (저장된 세션 → 없으면 게스트 계정 만들기)
    C.connect = async function () {
      C.status = 'connecting';
      try {
        const { data } = await client.auth.getSession();
        if (data && data.session) user = data.session.user;
        else {
          const { data: d, error } = await client.auth.signInAnonymously();
          if (error) throw error;
          user = d.user;
        }
        const { data: u } = await client.auth.getUser();
        if (u && u.user) user = u.user;
        C.status = 'online';
        return user.id;
      } catch (e) {
        C.status = 'offline';
        throw new CloudError('network');
      }
    };

    // API 호출. 실패하면 CloudError(code)
    async function call(op, body = {}) {
      if (!user) await C.connect();
      let res;
      try {
        res = await client.functions.invoke('api', { body: { op, ...body } });
      } catch (e) {
        C.status = 'offline';
        throw new CloudError('network');
      }
      if (res.error) {
        let payload = null;
        try { payload = res.error.context && (await res.error.context.json()); } catch (e) { /* 본문 없음 */ }
        if (!payload) { C.status = 'offline'; throw new CloudError('network'); }
        C.status = 'online';
        throw new CloudError(payload.error || 'server_error', payload);
      }
      C.status = 'online';
      return res.data;
    }
    // 같은 요청 ID로 네트워크 실패 시 재시도 (서버가 중복을 알아보므로 두 번 처리되지 않음)
    async function callRetry(op, body, tries = 3) {
      for (let i = 0; ; i++) {
        try { return await call(op, body); } catch (e) {
          if (e.code !== 'network' || i >= tries - 1) throw e;
          await new Promise((r) => setTimeout(r, 400 * 2 ** i));
        }
      }
    }

    C.hello = () => call('hello');
    C.save = (data, baseRev) => call('save', { data, baseRev });
    // 아이템 버튼 작업 (같은 요청 ID로 재시도 → 서버가 한 번만 처리). body = {action, gold, equipped, auto, ...}
    C.inv = (body) => callRetry('inv', { ...body, requestId: requestId() });
    // 처치 보고: 요청 ID는 sync가 정함 (실패하면 같은 ID로 다시 보냄)
    C.kills = (body) => call('kills', body);
    C.offline = (body) => callRetry('offline', { ...body, requestId: requestId() });
    C.devGrant = (body) => call('devGrant', { ...body, requestId: requestId() });
    // 부서 장악 묶음 작업 (같은 요청 ID로 재시도). body = {action, ...}
    C.dept = (body) => callRetry('dept', { ...body, requestId: requestId() });
    C.net = (body) => callRetry('net', { ...body, requestId: requestId() });
    C.pet = (body) => callRetry('pet', { ...body, requestId: requestId() });
    C.skill = (body) => callRetry('skill', { ...body, requestId: requestId() });
    C.career = (body) => callRetry('career', { ...body, requestId: requestId() }); // 이직·특전 (같은 요청 ID로 재전송 → 같은 결과, 합격 난수 다시 안 굴림)
    C.subTest = (on) => call('subTest', { on });
    C.attendance = (action, day, floor) => call('attendance', { action, day, floor });
    C.mission = (id) => call('mission', { id });
    C.guide = (k) => call('guide', { k });
    C.board = () => call('board');
    C.tower = (floor) => call('tower', floor === undefined ? {} : { floor });
    C.shop = (body) => call('shop', body);
    C.reward = (body) => call('reward', body);
    C.swap = (corp) => callRetry('swap', { corp, requestId: requestId() });
    C.purchaseTest = (productId) => callRetry('purchaseTest', { productId, orderId: requestId() });

    // Google·Apple 연결: 게스트 계정에 로그인 수단을 붙임 (진행 그대로). 서버에 공급자 설정이 있어야 동작
    C.link = async function (provider) {
      const { error } = await client.auth.linkIdentity({ provider, options: { redirectTo: location.href.split('#')[0] } });
      if (error) throw new CloudError(/not enabled|unsupported|disabled/i.test(error.message) ? 'provider_disabled' : 'link_failed');
    };

    // 계정 삭제: 서버 데이터 전부 삭제 → 로그아웃
    C.deleteAccount = async function () {
      await call('deleteAccount');
      try { await client.auth.signOut({ scope: 'local' }); } catch (e) { /* 이미 삭제됨 */ }
      user = null;
      C.clearMeta();
    };

    return C;
  }

  G.createCloud = createCloud;
  G.CloudError = CloudError;
})(globalThis.Game = globalThis.Game || {});
