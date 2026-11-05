// 픽셀아트 스프라이트 (코드로 그림 → 캔버스 → 이미지)
'use strict';

const PAL = {
  k: '#1a1c2c', // 외곽선
  s: '#f4c29c', S: '#d9966e', // 피부
  h: '#3b2a20', H: '#5e4232', // 머리
  w: '#f2f4f8', W: '#c4c9d8', // 흰색
  n: '#34417a', N: '#232c58', // 정장
  r: '#e0434f', R: '#a02838', // 빨강
  b: '#f59a9a', // 볼터치
  u: '#9b7bb5', // 다크서클
  y: '#ffd166', o: '#f4a93c', O: '#c46a1c', // 노랑/주황
  c: '#8fd3ff', C: '#3a6ad0', // 파랑
  G: '#5fd38d', d: '#2a8a5a', // 초록
  p: '#fbfbf2', P: '#d8d8c8', // 종이
  x: '#8a90a8', X: '#555a70', // 회색
  m: '#f08aa8', // 분홍
  D: '#5a3a28', L: '#8a5a3a', // 갈색(나무)
  g: '#b8bccb', // 은발
  v: '#7a3ab0', // 보라
  A: '#ff3d3d', // 분노
};

// ----- 그리기 도구 -----
const grid = (w, h) => Array.from({ length: h }, () => Array(w).fill('.'));
const fromRows = (rows) => {
  const w = Math.max(...rows.map((r) => r.length));
  return rows.map((r) => r.padEnd(w, '.').split(''));
};
function px(g, x, y, c) { if (g[y] && x >= 0 && x < g[y].length) g[y][x] = c; }
function rect(g, x, y, w, h, c) { for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) px(g, x + i, y + j, c); }
function box(g, x, y, w, h, fill, line = 'k') {
  rect(g, x, y, w, h, line);
  rect(g, x + 1, y + 1, w - 2, h - 2, fill);
}
function line(g, x0, y0, x1, y1, c) {
  const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    px(g, x0, y0, c);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
  }
}
function disk(g, cx, cy, r, fill, edge = 'k') {
  for (let y = -r - 1; y <= r + 1; y++) for (let x = -r - 1; x <= r + 1; x++) {
    const d = Math.sqrt(x * x + y * y);
    if (d <= r - 0.5) px(g, cx + x, cy + y, fill);
    else if (d <= r + 0.5 && edge) px(g, cx + x, cy + y, edge);
  }
}
function stamp(g, x, y, rows) {
  rows.forEach((row, j) => row.split('').forEach((c, i) => { if (c !== '.') px(g, x + i, y + j, c); }));
}
// 표정 (2배 해상도, 16x12) — 저해상도 좌표에 위치만 기록해두고 확대 후 찍음
const FACES = {
  angry: [
    'kkk..........kkk',
    '..kkk......kkk..',
    '................',
    '.kkkk......kkkk.',
    'kwwwkk....kkwwwk',
    'kwwkkk....kkkwwk',
    '.kkkk......kkkk.',
    '................',
    '....kkkkkkkk....',
    '...kwkwwwwkwk...',
    '....kkkkkkkk....',
  ],
  shout: [
    'kkk..........kkk',
    '..kkk......kkk..',
    '................',
    '.kkkk......kkkk.',
    'kwwwkk....kkwwwk',
    'kwwkkk....kkkwwk',
    '.kkkk......kkkk.',
    '.....kkkkkk.....',
    '....kRRRRRRk....',
    '....kRRmmRRk....',
    '....kRmmmmRk....',
    '.....kkkkkk.....',
  ],
  smug: [
    '................',
    '.kkkkk....kkkkk.',
    '................',
    '.kkkkk....kkkkk.',
    '.kwwkk....kwwkk.',
    '..kkk......kkk..',
    '................',
    '................',
    '...........kk...',
    '...kkkkkkkkk....',
    '....kwwwwwk.....',
    '.....kkkkk......',
  ],
  dizzy: [
    '................',
    '................',
    '.k...k....k...k.',
    '..k.k......k.k..',
    '...k........k...',
    '..k.k......k.k..',
    '.k...k....k...k.',
    '................',
    '................',
    '...k.k.k.k.k....',
    '..k.k.k.k.k.k...',
    '................',
  ],
  sleepy: [
    '................',
    '................',
    '................',
    '................',
    '.kkkkk....kkkkk.',
    '..kkk......kkk..',
    '................',
    '..uuuu....uuuu..',
    '................',
    '......kkkk......',
    '.....k....k.....',
    '......kkkk......',
  ],
  crazy: [
    '..kkkk....kkkk..',
    '.kwwwwk..kwwwwk.',
    'kwwwwwwkkwwwwwwk',
    'kwwkkwwkkwwkkwwk',
    'kwwkkwwkkwwkkwwk',
    '.kwwwwk..kwwwwk.',
    '..kkkk....kkkk..',
    '................',
    '.kkkkkkkkkkkkkk.',
    '.kwwkwwkwwkwwwk.',
    '..kRRRRRRRRRRk..',
    '...kkkkkkkkkk...',
  ],
};
function face(g, x, y, type = 'angry') { (g.faces = g.faces || []).push({ x, y, type }); }

// 2배 확대 + 바깥 외곽선 1픽셀로 얇게
function upscale(g) {
  const out = [];
  g.forEach((row) => {
    const r = [];
    row.forEach((c) => r.push(c, c));
    out.push(r, r.slice());
  });
  return out;
}
function isOuter(g, x, y) {
  if (!g[y] || g[y][x] !== 'k') return false;
  return [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => {
    const r = g[y + dy];
    return !r || r[x + dx] === undefined || r[x + dx] === '.';
  });
}
function thin(g) {
  const H = g.length, W = g[0].length;
  const out = g.map((r) => r.slice());
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (g[y][x] !== 'k' || isOuter(g, x, y)) continue;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const f = g[y + dy] && g[y + dy][x + dx];
      if (f && f !== 'k' && f !== '.' && isOuter(g, x - dx, y - dy)) { out[y][x] = f; break; }
    }
  }
  return out;
}
function hires(g) {
  const big = thin(upscale(g));
  (g.faces || []).forEach((f) => stamp(big, f.x * 2, f.y * 2, FACES[f.type]));
  return big;
}

// ----- 주인공 -----
const PLAYER = [
  '....kkkkkkkk....',
  '...khhhhhhhhk...',
  '..khhHHhhhhhhk..',
  '..khHhhhhhhhhk..',
  '..khssshhssshk..',
  '..kssssssssssk..',
  '.kSssksssskssSk.',
  '.kSssksssskssSk.',
  '..kssussssussk..',
  '..ksbssmmssbsk..',
  '...kSssssssSk...',
  '...knwwsswwnk...',
  '..knnwwrrwwnnk..',
  '.knnnnwrrwnnnnk.',
  'knnnnnwrrwnnnnnk',
  'knnNnnwrrwnnNnnk',
  'knnNnnnwwnnnNnnk',
  'knnNnnnnnnnnNnnk',
];
const PLAYER_FACE = [
  '..kkkk........kkkk..',
  '....................',
  '....kk........kk....',
  '...kwkk......kwkk...',
  '...kkkk......kkkk...',
  '....kk........kk....',
  '...uuuu......uuuu...',
  '.bb..............bb.',
  '........kkkk........',
];
const PLAYER_FACE_TIRED = [
  '....kkk......kkk....',
  '..kk..........kk....',
  '...k..k......k..k...',
  '....kk........kk....',
  '....kk........kk....',
  '...k..k......k..k...',
  '...c..........c.....',
  '...c....kkkk..c.....',
  '...c...kmmmmk.c.....',
  '........kkkk........',
];
function player(tired) {
  const g = fromRows(PLAYER);
  if (tired) { px(g, 14, 3, 'c'); px(g, 14, 4, 'c'); px(g, 13, 4, 'c'); }
  const big = thin(upscale(g));
  rect(big, 6, 10, 20, 10, 's');
  stamp(big, 6, 10, tired ? PLAYER_FACE_TIRED : PLAYER_FACE);
  return big;
}
const PLAYER_PAL_TIRED = { s: '#c9d0e0', S: '#9aa2bd' };

// 책상 + 노트북 + 커피 (54x19)
function desk() {
  const g = grid(54, 19);
  box(g, 2, 8, 11, 5, 'p'); box(g, 4, 6, 11, 5, 'p'); rect(g, 6, 8, 6, 1, 'x');
  box(g, 15, 0, 24, 14, 'x');
  rect(g, 16, 1, 22, 1, 'g'); rect(g, 16, 12, 22, 1, 'X');
  disk(g, 27, 6, 3, 'w', 'W');
  box(g, 42, 6, 7, 8, 'w'); rect(g, 43, 7, 5, 1, 'D');
  px(g, 49, 8, 'k'); px(g, 50, 9, 'k'); px(g, 50, 10, 'k'); px(g, 49, 11, 'k');
  px(g, 44, 4, 'W'); px(g, 45, 3, 'W'); px(g, 46, 4, 'W'); px(g, 45, 2, 'W');
  rect(g, 0, 13, 54, 1, 'k');
  rect(g, 0, 14, 54, 1, 'L');
  rect(g, 0, 15, 54, 3, 'D');
  rect(g, 0, 18, 54, 1, 'k');
  return g;
}

// ----- 일반 업무 몬스터 (16x16) -----
const ENEMY_SPRITES = {
  mail() {
    const g = grid(16, 16);
    box(g, 1, 1, 14, 14, 'p');
    line(g, 2, 2, 7, 6, 'k'); line(g, 13, 2, 8, 6, 'k');
    rect(g, 2, 13, 12, 1, 'P');
    px(g, 14, 0, 'X'); px(g, 15, 0, 'o'); px(g, 15, 1, 'y'); px(g, 14, -1, 'y');
    face(g, 4, 7, 'angry'); return g;
  },
  excel() {
    const g = grid(16, 16);
    box(g, 1, 1, 14, 14, 'w');
    rect(g, 2, 2, 12, 2, 'd');
    stamp(g, 3, 2, ['w.w', '.w.']);
    for (let y = 6; y < 14; y += 3) rect(g, 2, y, 12, 1, 'G');
    rect(g, 5, 4, 1, 10, 'G'); rect(g, 10, 4, 1, 10, 'G');
    face(g, 4, 7); return g;
  },
  report() {
    const g = grid(16, 16);
    box(g, 2, 0, 12, 16, 'p');
    rect(g, 11, 0, 3, 3, '.'); line(g, 11, 0, 13, 2, 'k'); px(g, 11, 1, 'P'); px(g, 11, 2, 'P'); px(g, 12, 2, 'P'); px(g, 13, 3, 'k');
    rect(g, 4, 2, 5, 1, 'x'); rect(g, 4, 4, 7, 1, 'x');
    box(g, 9, 12, 4, 3, 'r', 'R');
    face(g, 4, 6, 'smug'); return g;
  },
  phone() {
    const g = grid(16, 16);
    box(g, 0, 1, 16, 4, 'R'); rect(g, 0, 1, 1, 1, '.'); rect(g, 15, 1, 1, 1, '.');
    rect(g, 2, 2, 12, 1, 'r');
    box(g, 2, 5, 12, 10, 'r');
    rect(g, 3, 13, 10, 1, 'R');
    face(g, 4, 7, 'shout'); return g;
  },
  folders() {
    const g = grid(16, 16);
    box(g, 2, 0, 5, 3, 'O'); box(g, 1, 2, 14, 6, 'O');
    box(g, 9, 2, 5, 3, 'o'); box(g, 2, 4, 13, 6, 'o');
    box(g, 1, 6, 5, 3, 'y'); box(g, 0, 7, 16, 9, 'y');
    rect(g, 1, 14, 14, 1, 'o');
    face(g, 4, 9, 'sleepy'); return g;
  },
  chat() {
    const g = grid(16, 16);
    box(g, 0, 2, 15, 10, 'y');
    rect(g, 0, 2, 1, 1, '.'); rect(g, 14, 2, 1, 1, '.'); rect(g, 0, 11, 1, 1, '.'); rect(g, 14, 11, 1, 1, '.');
    stamp(g, 2, 11, ['kyyk', 'kyk.', 'kk..']);
    disk(g, 13, 2, 2, 'r');
    px(g, 13, 2, 'w');
    face(g, 3, 4, 'shout'); return g;
  },
  printer() {
    const g = grid(16, 16);
    box(g, 4, 0, 8, 8, 'p'); rect(g, 5, 2, 6, 1, 'x'); rect(g, 5, 4, 4, 1, 'x');
    box(g, 1, 6, 14, 9, 'x');
    rect(g, 2, 7, 12, 1, 'g');
    rect(g, 3, 6, 10, 1, 'X');
    px(g, 13, 9, 'r');
    rect(g, 2, 13, 12, 1, 'X');
    face(g, 4, 8, 'dizzy'); return g;
  },
  calendar() {
    const g = grid(16, 16);
    box(g, 1, 2, 14, 13, 'w');
    rect(g, 2, 3, 12, 3, 'r');
    rect(g, 4, 0, 1, 4, 'X'); rect(g, 11, 0, 1, 4, 'X');
    face(g, 4, 7); return g;
  },
  bug() {
    const g = grid(16, 16);
    line(g, 6, 2, 4, 0, 'k'); line(g, 9, 2, 11, 0, 'k');
    for (const y of [7, 10, 13]) { line(g, 3, y, 0, y - 1, 'k'); line(g, 12, y, 15, y - 1, 'k'); }
    disk(g, 7, 9, 6, 'G'); px(g, 15, 9, '.');
    disk(g, 7, 3, 2, 'd');
    rect(g, 7, 13, 1, 2, 'd');
    face(g, 3, 6, 'crazy'); return g;
  },
};
const ENEMY_KEYS = ['mail', 'excel', 'report', 'phone', 'folders', 'chat', 'printer', 'calendar', 'mail', 'report', 'excel', 'bug'];

// ----- 보스 (사람형 템플릿 20x24) -----
const BOSS_MAN = [
  '......kkkkkkkk......',
  '.....kHHHHHHHHk.....',
  '....kHHHHHHHHHHk....',
  '...kHHHHHHHHHHHHk...',
  '...kHssssssssssHk...',
  '...kssssssssssssk...',
  '..kSskksssssskksSk..',
  '..kSsssksssskssSSk..',
  '...ksskksssskkssk...',
  '...ksssssSSsssssk...',
  '...ksbbssssssbbsk...',
  '...kssssskkssssssk..',
  '....ksssksskssssk...',
  '.....kSssssssSk.....',
  '.....kwwsssswwk.....',
  '...kkcwwwrrwwwckk...',
  '..kccccccwrrwccccck.',
  '.kccccccwrrwccccccck',
  'kcCcccccwrrwcccccCck',
  'kcCcccccwwwwcccccCck',
];
function bossMan(opt) {
  const g = fromRows(['', '', '', '', ...BOSS_MAN]);
  px(g, 8, 16, 's'); px(g, 11, 16, 's');
  if (opt.extra) opt.extra(g);
  const big = thin(upscale(g));
  rect(big, 8, 20, 24, 12, 's');
  stamp(big, 8, 20, opt.face);
  if (opt.after) opt.after(big);
  return big;
}
const BOSS_FACES = {
  teamLead: [
    'kkkk................kkkk',
    '.kkkkk............kkkkk.',
    '....kkkk........kkkk....',
    '........................',
    '..kkkkk..........kkkkk..',
    '.kwwwwkk........kkwwwwk.',
    '.kwwwkkk........kkkwwwk.',
    '..kkkkk....SS....kkkkk..',
    '.bbb......SSSS......bbb.',
    '.......kkkkkkkkkk.......',
    '......kRwwwwwwwwRk......',
    '......kRRRRmmRRRRk......',
    '.......kkkkkkkkkk.......',
  ],
  client: [
    '........................',
    '..kkkkkk........kkkkkk..',
    '........................',
    '.kkkkkkkkkkkkkkkkkkkkkk.',
    '.kXXwXXXkk....kkXXwXXXk.',
    '.kXwXXXXk......kXwXXXXk.',
    '..kkkkkk........kkkkkk..',
    '...........SS...........',
    '..bb......SSSS......bb..',
    '...............kk.......',
    '.......kkkkkkkkkwk......',
    '........kwwwywwwk.......',
    '.........kkkkkkk........',
  ],
  director: [
    '........................',
    '...kkkkkk......kkkkkk...',
    '........k......k........',
    '..kkkkkkkk....kkkkkkkk..',
    '..kwwkkwwkkkkkkwwkkwwk..',
    '..kwwwwwwk....kwwwwwwk..',
    '..kkkkkkkk....kkkkkkkk..',
    '...........SS...........',
    '..........SSSS..........',
    '.......gggggggggg.......',
    '......gggg....gggg......',
    '..........kkkk..........',
    '.........k....k.........',
  ],
  chairman: [
    'WWWW................WWWW',
    '.WWWWWW..........WWWWWW.',
    '....WWWW........WWWW....',
    '........................',
    '...kkkk..........kkkk...',
    '..kwwkkk........kkkwwk..',
    '...kkkk..........kkkk...',
    '...........SS...........',
    '..WW......SSSS......WW..',
    '.WWWW....kkkkkk....WWWW.',
    '.WWWWWWWkRRRRRRkWWWWWWW.',
    '..WWWWWWWkkkkkkWWWWWWW..',
    '...WWWWWWWWWWWWWWWWWW...',
  ],
};
const CHAIRMAN_BEARD = ['....WWWWWWWWWWWWWWWW....', '......WWWWWWWWWWWW......', '........WWWWWWWW........', '..........WWWW..........'];
const BOSS_SPRITES = {
  teamLead: () => bossMan({
    face: BOSS_FACES.teamLead,
    extra(g) {
      rect(g, 4, 6, 12, 2, 's'); // 대머리
      px(g, 8, 6, 'w'); px(g, 9, 6, 'w'); px(g, 7, 7, 'w');
      rect(g, 3, 8, 1, 3, 'g'); rect(g, 16, 8, 1, 3, 'g'); px(g, 4, 8, 'g'); px(g, 15, 8, 'g');
      stamp(g, 14, 2, ['.A.A', 'A.A.', '.A.A']); // 분노 마크
    },
  }),
  client: () => bossMan({
    face: BOSS_FACES.client,
    extra(g) {
      stamp(g, 6, 19, ['y.....y', '.y...y.', '..yyy..']);
    },
  }),
  director: () => bossMan({ face: BOSS_FACES.director }),
  chairman: () => bossMan({
    extra(g) {
      stamp(g, 5, 0, ['y..y..y..y', 'yy.yy.yy.y', 'yyyyyyyyyy', 'yrryyyyrry']);
      rect(g, 5, 4, 10, 1, 'k');
    },
    face: BOSS_FACES.chairman,
    after(big) { stamp(big, 8, 33, CHAIRMAN_BEARD); },
  }),
  chart() {
    const g = grid(22, 24);
    rect(g, 4, 18, 2, 6, 'X'); rect(g, 16, 18, 2, 6, 'X');
    box(g, 0, 0, 22, 19, 'w');
    rect(g, 1, 1, 20, 1, 'W');
    line(g, 3, 4, 7, 7, 'R'); line(g, 7, 7, 11, 5, 'R'); line(g, 11, 5, 18, 15, 'R');
    line(g, 3, 3, 7, 6, 'r'); line(g, 7, 6, 11, 4, 'r'); line(g, 11, 4, 18, 14, 'r');
    stamp(g, 16, 13, ['..r', '..r', 'rrr']);
    face(g, 3, 10, 'shout'); return g;
  },
  clock() {
    const g = grid(22, 24);
    disk(g, 4, 4, 3, 'y'); disk(g, 17, 4, 3, 'y');
    line(g, 5, 20, 3, 23, 'k'); line(g, 16, 20, 18, 23, 'k');
    disk(g, 11, 13, 9, 'r');
    disk(g, 11, 13, 7, 'w', 'R');
    px(g, 11, 7, 'k'); px(g, 17, 13, 'k'); px(g, 5, 13, 'k'); px(g, 11, 19, 'k');
    face(g, 7, 10, 'angry'); return g;
  },
  audit() {
    const g = grid(24, 24);
    for (let i = 0; i < 3; i++) line(g, 14 + i, 15, 21 + i, 22, i === 1 ? 'L' : 'D');
    disk(g, 10, 10, 9, 'X');
    disk(g, 10, 10, 7, 'c', 'k');
    stamp(g, 3, 6, ['kk..........kk', '..kk......kk..']);
    disk(g, 10, 11, 4, 'w');
    disk(g, 10, 11, 2, 'k', 'k');
    px(g, 9, 10, 'w');
    stamp(g, 7, 16, ['kkkkkk']);
    rect(g, 5, 5, 2, 1, 'w');
    return g;
  },
};
const BOSS_PALS = {
  teamLead: { s: '#f2a080', S: '#d0765a', H: '#f2a080', c: '#6a4a3a', C: '#4a3226', r: '#3a6ad0' },
  client: { h: '#1a1c2c', H: '#2a2c44', c: '#7a3ab0', C: '#552880', r: '#ffd166' },
  director: { H: '#b8bccb', c: '#2a2f4a', C: '#1a1e33', r: '#a02838' },
  chairman: { H: '#f2f4f8', c: '#7a2030', C: '#561522', r: '#ffd166' },
};
const BOSS_KEYS = ['teamLead', 'chart', 'clock', 'client', 'director', 'audit', 'chairman'];

// ----- UI 아이콘 (12x12) -----
const ICONS = {
  atk: ['', '', 'kkkkkkkkkkkk', 'kxwxwxwxwxwk', 'kxxxxxxxxxxk', 'kxwxwxwxwxwk', 'kxxxxxxxxxxk', 'kxxwwwwwwxxk', 'kkkkkkkkkkkk'],
  hp: ['', '...kkkkk....', '..kmmkmmkk..', '.kmmmkmmmmk.', 'kmmkmmmkmmmk', 'kmmmkmmmkmmk', 'kmkmmmkmmmmk', 'kmmmmkmmmkmk', '.kmmmkmmmkk.', '..kkkkkkkk..', '....kSSk....', '....kkkk....'],
  spd: ['......kkkkk.', '.....kyyyk..', '....kyyyk...', '...kyyyk....', '..kyyyykkkk.', '.kyyyyyyyyk.', '.kkkkyyyyk..', '....kyyyk...', '...kyyyk....', '..kyyk......', '.kyk........', '.kk.........'],
  crit: ['', '', '...kkkkkk...', '.kkwwwwwwkk.', 'kwwwkkkkwwwk', 'kwwkkwkkkwwk', 'kwwkkkkkkwwk', 'kwwwkkkkwwwk', '.kkwwwwwwkk.', '...kkkkkk...'],
  coffee: ['......kk....', '.....kwk....', '.kkkkwkkkkk.', '.kwwwwwwwwk.', '..kDcDDcDk..', '..kDDcDDDk..', '..kcDDDcDk..', '..kDDDDDDk..', '...kDDDDk...', '...kDDDDk...', '...kkkkkk...'],
  night: ['.....k......', '....kok.....', '...kook..k..', '...koook.kk.', '..koooookok.', '.kooyoooook.', '.kooyyooook.', '.koyyyyoook.', '.koyyyyyook.', '.kooyyyyook.', '..koooooook.', '...kkkkkkk..'],
  dmg: ['', '.....kk.....', '...kkCCkk...', '.kkCcCCCCkk.', 'kCCCCCCCCCCk', '.kkCCCCCCkky', '...kCCCCk..y', '...kCCCCk..y', '....kkkk..yy'],
  gold: ['...kk..kk...', '....kkkk....', '....kook....', '...kooook...', '..koooyooo k', '.kooyyyyook.', '.kooyooooook', '.koooyyyook.', '.kooooooyok.', '.kooyyyyook.', '..koooyoook.', '...kkkkkkk..'],
  hpPerk: ['', '.kkk...kkk..', 'kmmmk.kmmmk.', 'kmwmmkmmmmk.', 'kmmmmmmmmmk.', '.kmmmmmmmk..', '..kmmmmmk...', '...kmmmk....', '....kmk.....', '.....k......'],
  start: ['...kkkkkk...', '.kkcwcwcwkk.', 'kcwcwcwcwcwk', 'kkkkkkkkkkkk', '.k...kk...k.', '..k..kk..k..', '...k.kk.k...', '....kkkk....', '....knnk....', '....knnk....', '....kkkk....'],
  coin: ['...kkkkkk...', '..kyyyyyyk..', '.kyywwyyyok.', 'kyywyyyyyyok', 'kyyyykkyyyok', 'kyyyykkyyyok', 'kyyyykkyyyok', 'kyyyyyyyyyok', '.kyyyyyyyok.', '..koooooook.', '...kkkkkkk..'],
  career: ['...kkkkkk...', '..kccccccck.', '.kcwwcccccCk', '.kcwccccccCk', 'kkkkkkkkkkkk', 'kxXXXwwXXXxk', 'kxXXXwwXXXxk', 'kxXXXXXXXXxk', 'kxXXXXXXXXxk', 'kkkkkkkkkkkk'],
};

// ----- 사무실 배경 (부드러운 일러스트, 화면 크기에 맞춰 그림) -----
// 색: 야근 결재판 테마 (밤 사무실 녹회색, 2026-10-27)
function officeBackground(W, H, dpr = 2) {
  const cv = document.createElement('canvas');
  cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
  const ctx = cv.getContext('2d');
  ctx.scale(dpr, dpr);
  let seed = 11;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const rr = (x, y, w, h, r, fill) => { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); ctx.fillStyle = fill; ctx.fill(); };
  const lin = (x0, y0, x1, y1, stops) => { const gr = ctx.createLinearGradient(x0, y0, x1, y1); stops.forEach(([o, c]) => gr.addColorStop(o, c)); return gr; };
  const floorY = H - 118;

  // 벽
  ctx.fillStyle = lin(0, 0, 0, floorY, [[0, '#28322e'], [1, '#323d38']]);
  ctx.fillRect(0, 0, W, floorY);
  for (let x = 12; x < W; x += 28) { ctx.fillStyle = 'rgba(255,255,255,0.025)'; ctx.fillRect(x, 0, 12, floorY); }

  // 창문
  const wx = 64, wy = 22, ww = W - 128, wh = Math.max(60, floorY - 96);
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.35)'; ctx.shadowBlur = 16; ctx.shadowOffsetY = 6;
  rr(wx - 8, wy - 8, ww + 16, wh + 16, 14, '#59635f');
  ctx.restore();
  rr(wx - 8, wy - 8, ww + 16, wh + 16, 14, lin(0, wy, 0, wy + wh, [[0, '#6e7a75'], [1, '#4a5450']]));
  ctx.save();
  ctx.beginPath(); ctx.roundRect(wx, wy, ww, wh, 8); ctx.clip();
  ctx.fillStyle = lin(0, wy, 0, wy + wh, [[0, '#0a0f30'], [0.6, '#17264a'], [1, '#24365a']]);
  ctx.fillRect(wx, wy, ww, wh);
  for (let i = 0; i < 40; i++) {
    ctx.globalAlpha = 0.3 + rnd() * 0.7;
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(wx + rnd() * ww, wy + rnd() * wh * 0.45, rnd() * 1.2 + 0.3, 0, Math.PI * 2); ctx.fill();
  }
  ctx.globalAlpha = 1;
  // 달
  const mx = wx + ww - 40, my = wy + 30;
  const glow = ctx.createRadialGradient(mx, my, 4, mx, my, 50);
  glow.addColorStop(0, 'rgba(255,233,168,0.45)'); glow.addColorStop(1, 'rgba(255,233,168,0)');
  ctx.fillStyle = glow; ctx.fillRect(mx - 50, my - 50, 100, 100);
  ctx.fillStyle = '#fff1c4'; ctx.beginPath(); ctx.arc(mx, my, 13, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#ffe39a'; ctx.beginPath(); ctx.arc(mx + 4, my + 3, 4, 0, Math.PI * 2); ctx.fill();
  // 빌딩 (뒷줄은 흐리게)
  [[0.55, '#16203a', 0.35], [0.8, '#0f1628', 0.6]].forEach(([hMax, col, lit]) => {
    let x = wx - 6;
    while (x < wx + ww) {
      const bw = 22 + rnd() * 34;
      const bh = wh * (0.25 + rnd() * hMax);
      const by = wy + wh - bh;
      ctx.fillStyle = col; ctx.fillRect(x, by, bw, bh);
      if (rnd() > 0.6) ctx.fillRect(x + bw / 2 - 1, by - 10, 2, 10);
      for (let yy = by + 6; yy < wy + wh - 4; yy += 9) for (let xx = x + 4; xx < x + bw - 6; xx += 8) {
        const r = rnd();
        if (r < lit * 0.6) {
          ctx.fillStyle = r < lit * 0.12 ? '#9ad7ff' : '#ffd477';
          ctx.shadowColor = ctx.fillStyle; ctx.shadowBlur = 6;
          ctx.fillRect(xx, yy, 4, 5);
          ctx.shadowBlur = 0;
        }
      }
      x += bw + 2;
    }
  });
  // 유리 반사
  ctx.fillStyle = 'rgba(255,255,255,0.06)';
  ctx.beginPath(); ctx.moveTo(wx + 20, wy); ctx.lineTo(wx + 70, wy); ctx.lineTo(wx + 10, wy + wh); ctx.lineTo(wx - 40, wy + wh); ctx.fill();
  ctx.restore();
  rr(wx + ww / 2 - 4, wy, 8, wh, 2, '#59635f');
  rr(wx - 16, wy + wh + 8, ww + 32, 10, 5, lin(0, wy + wh + 8, 0, wy + wh + 18, [[0, '#7c8783'], [1, '#4a5450']]));

  // 시계
  ctx.save(); ctx.shadowColor = 'rgba(0,0,0,0.3)'; ctx.shadowBlur = 8; ctx.shadowOffsetY = 3;
  ctx.fillStyle = '#e6e8e3'; ctx.beginPath(); ctx.arc(32, 46, 19, 0, Math.PI * 2); ctx.fill(); ctx.restore();
  ctx.strokeStyle = '#3a4440'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(32, 46, 19, 0, Math.PI * 2); ctx.stroke();
  ctx.lineCap = 'round'; ctx.strokeStyle = '#1c2220';
  ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(32, 46); ctx.lineTo(29, 36); ctx.stroke();
  ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(32, 46); ctx.lineTo(31, 31); ctx.stroke();
  ctx.fillStyle = '#ef5a6f'; ctx.beginPath(); ctx.arc(32, 46, 2.5, 0, Math.PI * 2); ctx.fill();

  // 포스터
  ctx.save(); ctx.translate(W - 34, 50); ctx.rotate(0.05);
  ctx.shadowColor = 'rgba(0,0,0,0.3)'; ctx.shadowBlur = 8; ctx.shadowOffsetY = 3;
  rr(-18, -26, 36, 50, 4, lin(0, -26, 0, 24, [[0, '#ff6b7f'], [1, '#d93d5a']]));
  ctx.shadowBlur = 0;
  ctx.fillStyle = '#fff'; ctx.font = '800 9px Pretendard, sans-serif'; ctx.textAlign = 'center';
  ctx.fillText('야근은', 0, -6); ctx.fillText('사랑', 0, 6);
  ctx.fillStyle = '#ffd477'; ctx.beginPath(); ctx.arc(0, 15, 3, 0, Math.PI * 2); ctx.fill();
  ctx.restore();

  // 걸레받이 + 바닥
  ctx.fillStyle = '#3a4540'; ctx.fillRect(0, floorY - 14, W, 14);
  ctx.fillStyle = '#4b5752'; ctx.fillRect(0, floorY - 14, W, 3);
  ctx.fillStyle = lin(0, floorY, 0, H, [[0, '#2c3531'], [1, '#222a27']]);
  ctx.fillRect(0, floorY, W, H - floorY);
  const pool = ctx.createRadialGradient(W / 2, floorY + 30, 10, W / 2, floorY + 30, W * 0.6);
  pool.addColorStop(0, 'rgba(255,214,140,0.12)'); pool.addColorStop(1, 'rgba(255,214,140,0)');
  ctx.fillStyle = pool; ctx.fillRect(0, floorY, W, H - floorY);
  ctx.strokeStyle = 'rgba(255,255,255,0.035)'; ctx.lineWidth = 1;
  for (let i = -10; i < 20; i++) { ctx.beginPath(); ctx.moveTo(W / 2 + i * 40, floorY); ctx.lineTo(W / 2 + i * 90, H); ctx.stroke(); }

  // 서류 캐비닛
  const cx = 10, cy = floorY - 82;
  ctx.save(); ctx.shadowColor = 'rgba(0,0,0,0.35)'; ctx.shadowBlur = 10; ctx.shadowOffsetY = 4;
  rr(cx, cy, 44, 82, 6, lin(cx, 0, cx + 44, 0, [[0, '#a6aca9'], [1, '#7c8380']])); ctx.restore();
  [0, 27, 54].forEach((d) => {
    rr(cx + 4, cy + 4 + d, 36, 23, 4, lin(0, cy + d, 0, cy + d + 23, [[0, '#b9bfbc'], [1, '#939a97']]));
    rr(cx + 15, cy + 12 + d, 14, 4, 2, '#5d6562');
  });
  rr(cx + 6, cy - 9, 26, 9, 2, '#f4f1e6'); rr(cx + 10, cy - 14, 24, 7, 2, '#e5e0cf');

  // 화분
  const px0 = W - 52, py0 = floorY - 40;
  ctx.fillStyle = '#2f9e6a';
  [[-0.5, 46], [0, 54], [0.45, 44], [-0.9, 34], [0.9, 32]].forEach(([ang, len]) => {
    ctx.save(); ctx.translate(px0 + 20, py0 + 4); ctx.rotate(ang);
    ctx.fillStyle = lin(0, -len, 0, 0, [[0, '#6fe0a0'], [1, '#2a8a5a']]);
    ctx.beginPath(); ctx.ellipse(0, -len / 2, 7, len / 2, 0, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  });
  ctx.save(); ctx.shadowColor = 'rgba(0,0,0,0.35)'; ctx.shadowBlur = 8; ctx.shadowOffsetY = 3;
  ctx.fillStyle = lin(px0, 0, px0 + 40, 0, [[0, '#c27a4c'], [1, '#8a5232']]);
  ctx.beginPath(); ctx.moveTo(px0, py0); ctx.lineTo(px0 + 40, py0); ctx.lineTo(px0 + 34, py0 + 40); ctx.lineTo(px0 + 6, py0 + 40); ctx.fill();
  ctx.restore();
  rr(px0 - 3, py0 - 4, 46, 9, 3, '#d38a5a');
  return cv;
}

// ----- 렌더링 -----
const cache = {};
function shadeColor(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const f = (v) => Math.max(0, Math.min(255, Math.round(amt > 0 ? v + (255 - v) * amt : v * (1 + amt))));
  return '#' + [n >> 16, (n >> 8) & 255, n & 255].map((v) => f(v).toString(16).padStart(2, '0')).join('');
}
// 두 색 섞기
function mix(a, b, t) {
  const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
  const ch = (n, s) => (n >> s) & 255;
  return '#' + [16, 8, 0].map((sh) => Math.round(ch(pa, sh) * (1 - t) + ch(pb, sh) * t).toString(16).padStart(2, '0')).join('');
}

// Scale2x: 계단 같은 대각선을 매끄럽게 다듬으며 2배 확대
function scale2x(g) {
  const H = g.length, W = g[0].length;
  const out = grid(W * 2, H * 2);
  const at = (x, y) => (g[y] && g[y][x] !== undefined ? g[y][x] : '.');
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const P = at(x, y), A = at(x, y - 1), B = at(x + 1, y), C = at(x - 1, y), D = at(x, y + 1);
    out[y * 2][x * 2] = C === A && C !== D && A !== B ? A : P;
    out[y * 2][x * 2 + 1] = A === B && A !== C && B !== D ? B : P;
    out[y * 2 + 1][x * 2] = D === C && D !== B && C !== A ? C : P;
    out[y * 2 + 1][x * 2 + 1] = B === D && B !== A && D !== C ? D : P;
  }
  return out;
}

// 같은 색 영역마다 위→아래 그라데이션, 바깥 외곽선은 검정 대신 주변색의 어두운 톤
const INK = '#2b2340';
function paint(g, pal) {
  const H = g.length, W = g[0].length;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');
  const colorOf = (c) => pal[c] || PAL[c] || '#ff00ff';
  // 영역 나누기
  const comp = Array.from({ length: H }, () => new Int32Array(W).fill(-1));
  const boxes = [];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const c = g[y][x];
    if (c === '.' || c === 'k' || comp[y][x] >= 0) continue;
    const id = boxes.length;
    const bx = { minY: y, maxY: y, minX: x, maxX: x, n: 0 };
    const stack = [[x, y]];
    comp[y][x] = id;
    while (stack.length) {
      const [cx, cy] = stack.pop();
      bx.n++;
      if (cy < bx.minY) bx.minY = cy; if (cy > bx.maxY) bx.maxY = cy;
      if (cx < bx.minX) bx.minX = cx; if (cx > bx.maxX) bx.maxX = cx;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = cx + dx, ny = cy + dy;
        if (ny >= 0 && ny < H && nx >= 0 && nx < W && comp[ny][nx] < 0 && g[ny][nx] === c) { comp[ny][nx] = id; stack.push([nx, ny]); }
      }
    }
    boxes.push(bx);
  }
  const outer = (x, y) => isOuter(g, x, y);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const c = g[y][x];
    if (c === '.') continue;
    let col;
    if (c === 'k') {
      if (outer(x, y)) {
        // 주변 채움색을 찾아 어둡게
        let near = null;
        for (let r = 1; r <= 3 && !near; r++) for (let dy = -r; dy <= r && !near; dy++) for (let dx = -r; dx <= r && !near; dx++) {
          const n = g[y + dy] && g[y + dy][x + dx];
          if (n && n !== 'k' && n !== '.') near = n;
        }
        col = near ? mix(shadeColor(colorOf(near), -0.55), INK, 0.35) : INK;
      } else col = INK;
    } else {
      col = colorOf(c);
      const b = boxes[comp[y][x]];
      if (b.n > 20) {
        const h = Math.max(1, b.maxY - b.minY);
        const t = (y - b.minY) / h;
        col = t < 0.5 ? shadeColor(col, 0.16 * (1 - t * 2)) : shadeColor(col, -0.2 * (t - 0.5) * 2);
      }
      // 윗면 하이라이트 / 아랫면 그늘
      if (outer(x, y - 1) || outer(x, y - 2)) col = shadeColor(col, 0.25);
      else if (outer(x, y + 1)) col = shadeColor(col, -0.15);
    }
    ctx.fillStyle = col;
    ctx.fillRect(x, y, 1, 1);
  }
  return cv;
}

// 새 그림체 (SpriteCook, art/spritecook) — 그림 파일이 있으면 도트 코드 대신 사용
// [파일, 화면 크기(ui.js가 ×3), 원본 크기] — 원본이 화면보다 크면 부드럽게 줄임
const ART = { player: ["pose0.png", 145 / 3, 290, 97 / 3] }; // 몸만, 공격 자세 pose1·2·4 (무기는 index.html #wpn-kb·#wpn-mouse, 자세 바꾸기는 ui.js heroAttack)
for (const [k, px] of Object.entries({ mail: 74, excel: 78, report: 98, phone: 72, folders: 102, chat: 98, printer: 80, calendar: 84, bug: 270 })) ART["enemy:" + k] = ["enemy-" + k + ".png", 38, px];
for (const [k, px] of Object.entries({ teamLead: 66, chart: 200, clock: 100, client: 94, director: 102, audit: 88, chairman: 200 })) ART["boss:" + k] = ["boss-" + k + ".png", 48, px];
ART.playerTired = ART.player;
function artURL(key) {
  const a = ART[key];
  return a && { url: "img/chars/" + a[0], w: a[3] || a[1], h: a[1], smooth: a[2] > a[1] * 3, art: true };
}

function spriteURL(key) {
  if (cache[key]) return cache[key];
  const art = artURL(key);
  if (art) return (cache[key] = art);
  let g, pal = PAL, ups = 1;
  if (key === 'player') g = player(false);
  else if (key === 'playerTired') { g = player(true); pal = { ...PAL, ...PLAYER_PAL_TIRED }; }
  else if (key === 'desk') g = desk();
  else if (key.startsWith('enemy:')) g = hires(ENEMY_SPRITES[key.slice(6)]());
  else if (key.startsWith('boss:')) {
    const k = key.slice(5);
    const raw = BOSS_SPRITES[k]();
    g = raw.faces || raw.length < 30 ? hires(raw) : raw;
    pal = { ...PAL, ...(BOSS_PALS[k] || {}) };
  } else if (key.startsWith('icon:')) { g = scale2x(fromRows(ICONS[key.slice(5)])); ups = 2; }
  g = scale2x(g); ups *= 2;
  const cv = paint(g, pal);
  // w/h는 확대 전 크기 (기존 배율 그대로 쓰기 위해)
  cache[key] = { url: cv.toDataURL(), w: cv.width / ups, h: cv.height / ups };
  return cache[key];
}
// 이미지 태그 생성 (scale배 확대)
function spriteImg(key, scale, cls = '') {
  const s = spriteURL(key);
  return `<img class="sp ${cls}${s.smooth ? " smooth" : ""}" src="${s.url}" width="${s.w * scale}" height="${s.h * scale}" alt="">`;
}

(globalThis.Game = globalThis.Game || {}).Sprites = { spriteURL, spriteImg, officeBackground, ENEMY_KEYS, BOSS_KEYS };
