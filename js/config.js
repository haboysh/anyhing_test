// 서버 접속 설정. 비어 있으면 서버 없이(기기 저장만) 동작.
// 실제 서비스: Supabase 프로젝트의 URL과 anon(공개) 키를 넣으면 됨 — 공개돼도 되는 키. 서비스 키는 절대 넣지 말 것.
(function (G) {
  'use strict';

  const Config = {
    // 정식 서버 (2026-11-05, 프로젝트 overtime-idle). anon 키는 공개용 (서비스 키 아님)
    supabaseUrl: 'https://twejuirodqosordbrqad.supabase.co',
    supabaseAnonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR3ZWp1aXJvZHFvc29yZGJycWFkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTM4NDkwMzYsImV4cCI6MjEwOTQyNTAzNn0.gow7H0kOz3V3D9JAoX-ne-BfFznZL_NKVeQQSBRI1Wo',
  };

  // 개발용: 내 컴퓨터에서 ?server=local 로 열면 로컬 Supabase(npx supabase start)에 접속
  const LOCAL = {
    supabaseUrl: 'http://127.0.0.1:54321',
    // Supabase CLI 기본 로컬 데모 키 (로컬 전용, 공개된 값)
    supabaseAnonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0',
  };
  try {
    const host = location.hostname;
    if ((host === 'localhost' || host === '127.0.0.1') && new URLSearchParams(location.search).get('server') === 'local') Object.assign(Config, LOCAL);
  } catch (e) { /* Node 등 location 없음 */ }

  Config.serverEnabled = () => !!(Config.supabaseUrl && Config.supabaseAnonKey);
  G.Config = Config;
})(globalThis.Game = globalThis.Game || {});
