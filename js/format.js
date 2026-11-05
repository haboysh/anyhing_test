// 숫자 표시 (한국식 단위, 위의 두 단위까지: 3223억4949만)
// 무량대수(10^68) 다음은 알파벳 단위, 4자리마다 하나: 1A = 10^72, 1B = 10^76 … 1Z = 10^172,
// 그다음 AA, AB … AZ, BA … ZZ (엑셀 열 이름 방식). double 최대(약 1.8×10^308)는 BH 단위 안 (2026-10-28 사용자 확정)
(function (G) {
  'use strict';

  const UNITS = ['', '만', '억', '조', '경', '해', '자', '양', '구', '간', '정', '재', '극', '항하사', '아승기', '나유타', '불가사의', '무량대수'];
  // k번째 알파벳 단위 (1부터): 1 → A, 26 → Z, 27 → AA, 702 → ZZ
  const alpha = (k) => { let s = ''; for (; k > 0; k = Math.floor((k - 1) / 26)) s = String.fromCharCode(65 + ((k - 1) % 26)) + s; return s; };
  // 한국 단위 + 알파벳 단위 (10^320까지 — double 범위를 덮음)
  const ALL = UNITS.concat(Array.from({ length: 80 - UNITS.length + 1 }, (_, j) => alpha(j + 1)));

  function fmt(n) {
    if (Number.isNaN(n)) return '?'; // 계산 오류가 ∞로 숨지 않게
    if (!isFinite(n)) return '∞';
    if (n < 0) return n > -1 ? '0' : '-' + fmt(-n);
    if (n < 10000) return Math.floor(n).toLocaleString('ko-KR');
    let i = Math.min(ALL.length - 1, Math.floor(Math.log10(n) / 4));
    // 아랫단위 개수(정수)로 바꿔서 자리 계산 — 부동소수점 오차로 1이 모자라지 않게 아주 살짝 올림
    let v = Math.floor((n / Math.pow(10, (i - 1) * 4)) * (1 + 1e-12));
    if (v < 10000 && i > 1) { i--; v = Math.floor((n / Math.pow(10, (i - 1) * 4)) * (1 + 1e-12)); }
    let top = Math.floor(v / 10000);
    const rest = v % 10000;
    // log10 오차로 한 단위 낮게 잡힌 경우 한 단위 올려서 표시
    if (top >= 10000 && i < ALL.length - 1) {
      const t2 = Math.floor(top / 10000), r2 = top % 10000;
      return t2 + ALL[i + 1] + (r2 > 0 ? r2 + ALL[i] : '');
    }
    return top + ALL[i] + (rest > 0 ? rest + ALL[i - 1] : '');
  }

  // 짧게: 맨 위 단위까지만 (3223억4949만 → 3223억). 여러 글자 단위(무량대수·AA)도 통째로
  function fmtShort(n) {
    const t = fmt(n);
    const m = t.match(/^[\d,]+[^\d,]+/);
    return m ? m[0] : t;
  }

  G.fmt = fmt;
  G.fmtShort = fmtShort;
  G.UNITS = UNITS;
  G.UNITS_ALL = ALL;
  G.unitAlpha = alpha;
})(globalThis.Game = globalThis.Game || {});
