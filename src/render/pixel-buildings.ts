import { PAL, Pen, define, hash, tone } from './pixel';

/**
 * 건물 그림 (픽셀아트). 몸체는 돌리지 않는다: 빛은 늘 왼쪽 위에서 오고, 방향은 입출구 화살표로 보여 준다.
 * 2×2 기계는 위쪽이 윗면, 아래 10줄이 앞면 (3/4 시점). 앞면 왼쪽에는 만드는 아이템을 그릴 이름표가 있다.
 * 프레임 0 = 멈춤, 1~4 = 일할 때 애니메이션 (허브는 늘 움직이는 4프레임).
 */

type Ramp = { hi: string; mid: string; lo: string };
const ramp = (c: string, k = 0.3): Ramp => ({ hi: tone(c, k), mid: c, lo: tone(c, -k) });

const IRON: Ramp = { hi: PAL.metal.mid, mid: PAL.metal.lo, lo: PAL.metal.dark };
const STONE: Ramp = { hi: '#ddd3bf', mid: '#b5a990', lo: '#877b66' };
const DARK_WOOD: Ramp = { hi: PAL.wood.lo, mid: PAL.wood.dark, lo: '#3f2712' };
const HOLE = '#2a1a10';
const CREAM = '#f3e7c9';
/** 나뭇잎 (pixel.ts의 TREE_LEAF와 같은 색) */
const TREE_LEAF_HI = '#86c06a';
const TREE_LEAF_MID = '#5f9a4e';
const TAU = Math.PI * 2;

/**
 * 2×2 기계의 덧그림 자리 (그림 픽셀, 건물 왼쪽 위 기준).
 * plate: 이름표 안쪽 8×8 (아이템), bar: 진행 막대 틀 (안쪽 2줄이 채워진다), fuel: 발전기 석탄 칸
 */
export const MACHINE = {
  plate: { x: 4, y: 20 },
  bar: { x: 14, y: 25, w: 15 },
  fuel: { x: 15, y: 21, step: 3, w: 2, h: 3, n: 5 },
  /** 정류장 번호 (num2 글자) 가운데와 윗줄 */
  stationNo: { cx: 16, y: 6 },
  /** 앞면 오른쪽 빈자리 (정류장 글씨) */
  faceText: { x: 14, y: 20, w: 15, h: 5 },
};

// ───────────────────────── 붓 도우미 ─────────────────────────

/**
 * 모양 채우기: fill(x, y)가 돌려준 색으로 찍고, 바깥 둘레에 잉크 테두리.
 * x, y는 픽셀 가운데 좌표. 'none'은 칠하지 않지만 모양 안으로 친다 (테두리 없이 뚫린 곳)
 */
function shape(
  p: Pen,
  x0: number,
  y0: number,
  w: number,
  h: number,
  fill: (x: number, y: number) => string | null,
  ink: string | null = PAL.ink,
): void {
  const grid: (string | null)[] = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) grid.push(fill(x0 + x + 0.5, y0 + y + 0.5));
  const at = (x: number, y: number) => (x >= 0 && y >= 0 && x < w && y < h ? grid[y * w + x] : null);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const c = at(x, y);
      if (c) {
        if (c !== 'none') p.px(x0 + x, y0 + y, c);
      } else if (ink && (at(x - 1, y) || at(x + 1, y) || at(x, y - 1) || at(x, y + 1))) p.px(x0 + x, y0 + y, ink);
    }
  }
}

/** 가운데 (cx, cy), 반지름 r 안쪽 모양 (테두리 여유 1픽셀 포함) */
function shapeAround(p: Pen, cx: number, cy: number, r: number, fill: (x: number, y: number) => string | null, ink: string | null = PAL.ink): void {
  const x0 = Math.floor(cx - r - 1);
  const y0 = Math.floor(cy - r - 1);
  shape(p, x0, y0, Math.ceil(cx + r + 1) - x0, Math.ceil(cy + r + 1) - y0, fill, ink);
}

/** 반지름 r 둘레 한 줄 */
function ring(p: Pen, cx: number, cy: number, r: number, c: string): void {
  for (let y = Math.floor(cy - r - 1); y <= Math.ceil(cy + r + 1); y++) {
    for (let x = Math.floor(cx - r - 1); x <= Math.ceil(cx + r + 1); x++) {
      if (Math.abs(Math.hypot(x + 0.5 - cx, y + 0.5 - cy) - r) < 0.55) p.px(x, y, c);
    }
  }
}

/** 빛 방향(왼쪽 위)에 따라 hi / mid / lo */
function lit(dx: number, dy: number, c: Ramp, k = 0.4): string {
  const l = -(dx + dy) / (Math.hypot(dx, dy) || 1);
  return l > k ? c.hi : l < -k ? c.lo : c.mid;
}

/** 각도 t 방향으로 중심에서 뻗은 막대 위인지 (두께 half) */
function onSpoke(dx: number, dy: number, t: number, half: number, both = false): boolean {
  const along = dx * Math.cos(t) + dy * Math.sin(t);
  const across = Math.abs(-dx * Math.sin(t) + dy * Math.cos(t));
  return (both || along > 0) && across < half;
}

/**
 * 상자 몸체: 그림자, 잉크 테두리, 위·왼쪽이 밝은 윗면, 아래 fh줄은 앞면.
 * 그림자는 오른쪽·아래로 1픽셀
 */
function block(p: Pen, x: number, y: number, w: number, h: number, top: Ramp, face: Ramp, fh: number): void {
  p.rect(x + 1, y + 1, w, h, PAL.shadow);
  p.rect(x, y, w, h, PAL.ink);
  const th = h - 2 - fh;
  p.rect(x + 1, y + 1, w - 2, th, top.mid);
  p.rect(x + 1, y + 1, w - 2, 1, top.hi);
  p.rect(x + 1, y + 2, 1, th - 1, top.hi);
  p.rect(x + w - 2, y + 2, 1, th - 1, top.lo);
  p.rect(x + 2, y + th, w - 3, 1, top.lo);
  const fy = y + 1 + th;
  p.rect(x + 1, fy, w - 2, fh, face.mid);
  p.rect(x + 1, fy, w - 2, 1, face.hi);
  p.rect(x + 1, y + h - 2, w - 2, 1, face.lo);
}

/** 2×2 기계 몸체 (윗면 x 2~29, y 2~18 / 앞면 y 19~28) + 앞면 왼쪽 이름표 */
function machine(p: Pen, top: Ramp, face: Ramp, plate = true): void {
  block(p, 1, 1, 30, 29, top, face, 10);
  if (!plate) return;
  p.rect(3, 19, 10, 10, PAL.ink);
  p.rect(4, 20, 8, 8, CREAM);
  p.rect(4, 27, 8, 1, '#ddcca6');
}

function bolt(p: Pen, x: number, y: number, c: Ramp = PAL.brass): void {
  p.px(x, y, c.hi);
  p.px(x + 1, y, c.mid);
  p.px(x, y + 1, c.mid);
  p.px(x + 1, y + 1, c.lo);
}

/** 가로 널빤지: 4줄마다 이음매, 널마다 엇갈린 세로 이음매 */
function planks(p: Pen, x: number, y: number, w: number, h: number, c: Ramp, seed: number): void {
  for (let r = 3; r < h; r += 4) p.rect(x, y + r, w, 1, c.lo);
  for (let k = 0; k * 4 < h; k++) {
    const sx = 3 + (hash(seed * 17 + k) % 9);
    for (let xx = sx; xx < w; xx += 11) p.rect(x + xx, y + k * 4, 1, Math.min(3, h - k * 4), c.lo);
    p.rect(x, y + k * 4, w, 1, tone(c.mid, 0.12));
  }
}

/** 벽돌 무늬 (6×4 벽돌, 줄마다 엇갈림) */
function bricks(p: Pen, x: number, y: number, w: number, h: number, c: Ramp): void {
  p.rect(x, y, w, h, c.mid);
  for (let r = 0; r < h; r++) {
    if (r % 4 === 3) {
      p.rect(x, y + r, w, 1, c.lo);
      continue;
    }
    const off = Math.floor(r / 4) % 2 ? 3 : 0;
    for (let xx = off; xx < w; xx += 6) p.px(x + xx, y + r, c.lo);
    if (r % 4 === 0) for (let xx = off + 1; xx < w; xx += 6) p.rect(x + xx, y + r, Math.min(3, w - xx), 1, c.hi);
  }
}

/** 아궁이 (위 모서리가 둥근 구멍). f > 0이면 불꽃이 일렁인다 */
function mouth(p: Pen, x: number, y: number, w: number, h: number, f: number, fire: readonly string[]): void {
  p.rect(x + 1, y, w - 2, h, PAL.ink);
  p.rect(x, y + 1, w, h - 1, PAL.ink);
  p.rect(x + 1, y + 1, w - 2, h - 1, HOLE);
  if (!f) {
    p.px(x + 2, y + h - 1, '#6a2c16');
    p.px(x + w - 4, y + h - 1, '#6a2c16');
    return;
  }
  for (let i = 0; i < w - 2; i++) {
    const fh = 1 + (hash(i * 7 + f * 13) % (h - 1));
    for (let k = 0; k < fh; k++) p.px(x + 1 + i, y + h - 1 - k, k === 0 ? fire[0] : k === fh - 1 ? fire[2] : fire[1]);
  }
}

/** 톱니바퀴 (a = 돌아간 각도) */
function gearFill(cx: number, cy: number, r: number, teeth: number, a: number, c: Ramp) {
  const body = r - 1.6;
  return (x: number, y: number): string | null => {
    const dx = x - cx;
    const dy = y - cy;
    const d = Math.hypot(dx, dy);
    if (d > r || d < Math.max(1.2, r * 0.22)) return null;
    if (d > body) {
      const t = ((((Math.atan2(dy, dx) - a) / TAU) * teeth) % 1 + 1) % 1;
      if (t > 0.5) return null;
    }
    return lit(dx, dy, c, 0.45);
  };
}

/** 바큇살 바퀴 (테 + 살 + 축). 살 사이는 gap 색 ('none'이면 뚫려 보인다) */
function wheelFill(cx: number, cy: number, r: number, spokes: number, a: number, rim: Ramp, spoke: string, gap = 'none', paddles = false) {
  return (x: number, y: number): string | null => {
    const dx = x - cx;
    const dy = y - cy;
    const d = Math.hypot(dx, dy);
    if (paddles && d <= r + 1.6 && d > r - 0.5) {
      for (let k = 0; k < spokes; k++) if (onSpoke(dx, dy, a + (k * TAU) / spokes, 1.1)) return rim.lo;
    }
    if (d > r) return null;
    if (d > r - 1.6) return lit(dx, dy, rim, 0.3);
    if (d < 1.8) return rim.hi;
    for (let k = 0; k < spokes; k++) if (onSpoke(dx, dy, a + (k * TAU) / spokes, 0.65)) return spoke;
    return gap;
  };
}

/** 일하는 프레임(1~4)의 진행 정도 0, 0.25, 0.5, 0.75 (멈춤 = 0) */
const turn = (f: number) => (f ? (f - 1) / 4 : 0);

// ───────────────────────── 허브 (48×48) ─────────────────────────

define('hub', 48, 48, 4, (p, f) => {
  const roof = ramp('#a8643a', 0.25);
  const wall: Ramp = { hi: '#f6ead0', mid: '#e6d3a9', lo: '#c4ab7c' };
  block(p, 1, 1, 46, 45, roof, wall, 14);
  // 지붕 너와: 3줄마다 엇갈린 조각
  for (let r = 0; r < 27; r++) {
    const y = 3 + r;
    if (r % 3 === 2) p.rect(3, y, 42, 1, roof.lo);
    else {
      const off = Math.floor(r / 3) % 2 ? 2 : 5;
      for (let x = off; x < 42; x += 6) p.px(3 + x, y, roof.lo);
    }
  }
  p.rect(2, 2, 44, 1, roof.hi);
  // 지붕 가운데 놋쇠 톱니 문장
  p.disc(24, 15.5, 9.5, PAL.ink);
  p.disc(24, 15.5, 8.5, roof.lo);
  shapeAround(p, 24, 15.5, 7.5, gearFill(24, 15.5, 7.5, 10, 0.15, PAL.brass));
  // 굴뚝과 연기
  p.rect(36, 6, 7, 11, PAL.ink);
  p.rect(37, 7, 5, 9, PAL.brick.mid);
  p.rect(37, 7, 1, 9, PAL.brick.hi);
  p.rect(37, 10, 5, 1, PAL.brick.lo);
  p.rect(37, 13, 5, 1, PAL.brick.lo);
  p.rect(37, 7, 5, 2, HOLE);
  for (let k = 0; k < 3; k++) {
    const t = (f + k * 1.33) % 4;
    const yy = 5 - t * 1.2;
    if (yy < 0) continue;
    p.disc(39.5 - t * 1.5 + k, yy, 1.4 + t * 0.3, k === 0 ? '#f6eed8' : '#e2d6bd');
  }
  // 앞벽: 회벽 + 나무 기둥, 창문 둘, 가운데 문
  for (const bx of [2, 16, 31, 44]) p.rect(bx, 32, 2, 13, PAL.wood.lo);
  p.rect(2, 32, 44, 1, PAL.wood.lo);
  p.rect(2, 44, 44, 1, PAL.wood.dark);
  for (const wx of [7, 34]) {
    p.rect(wx, 34, 8, 7, PAL.ink);
    p.rect(wx + 1, 35, 6, 5, '#ffd97a');
    p.rect(wx + 1, 35, 6, 1, '#fff0b8');
    p.rect(wx + 4, 35, 1, 5, PAL.ink);
    p.rect(wx + 1, 37, 6, 1, PAL.ink);
  }
  p.rect(19, 33, 10, 13, PAL.ink);
  p.rect(20, 34, 8, 11, PAL.wood.mid);
  p.rect(20, 34, 8, 1, PAL.wood.hi);
  p.rect(23, 34, 1, 11, PAL.wood.lo);
  p.px(26, 39, PAL.brass.hi);
  // 문 위 간판
  p.rect(17, 30, 14, 4, PAL.ink);
  p.rect(18, 31, 12, 2, PAL.brass.mid);
  p.rect(18, 31, 12, 1, PAL.brass.hi);
});

// ───────────────────────── 채굴기 (32×32) ─────────────────────────

function miner(p: Pen, f: number, tier: 1 | 2): void {
  const top = tier === 1 ? PAL.wood : PAL.brass;
  const face = tier === 1 ? DARK_WOOD : IRON;
  machine(p, top, face);
  if (tier === 1) {
    planks(p, 3, 3, 26, 15, top, 3);
    for (let x = 16; x < 29; x += 4) p.rect(x, 20, 1, 4, face.lo);
  } else {
    for (const [x, y] of [[3, 3], [27, 3], [3, 16], [27, 16]]) bolt(p, x, y, IRON);
    for (let x = 16; x < 29; x += 4) {
      p.px(x, 21, face.hi);
      p.px(x, 23, face.lo);
    }
  }
  // 구덩이
  const cx = 16;
  const cy = 10.5;
  p.disc(cx, cy, 8, PAL.ink);
  if (tier === 2) ring(p, cx, cy, 7, PAL.brass.lo);
  p.disc(cx, cy, 6.6, '#4a3220');
  p.disc(cx + 0.8, cy + 0.8, 5.4, '#5c4029');
  // 도는 드릴 날 (1단 3날, 2단 4날)
  const blades = tier === 1 ? 3 : 4;
  const a = turn(f) * (TAU / blades) + 0.3;
  shapeAround(p, cx, cy, 6, (x, y) => {
    const dx = x - cx;
    const dy = y - cy;
    const d = Math.hypot(dx, dy);
    if (d <= 1.9) return tier === 1 ? PAL.brass.mid : PAL.brass.hi;
    if (d > 5.8) return null;
    for (let k = 0; k < blades; k++) if (onSpoke(dx, dy, a + (k * TAU) / blades, 0.95)) return d > 3.5 ? PAL.metal.hi : PAL.metal.mid;
    return null;
  });
}
define('miner', 32, 32, 5, (p, f) => miner(p, f, 1));
define('miner-2', 32, 32, 5, (p, f) => miner(p, f, 2));

// ───────────────────────── 생산 기계 (32×32) ─────────────────────────

define('smelter', 32, 32, 5, (p, f) => {
  const face: Ramp = { hi: PAL.brick.lo, mid: '#6e3220', lo: '#4f2216' };
  machine(p, PAL.brick, face);
  bricks(p, 3, 3, 26, 15, PAL.brick);
  // 도가니: 일하면 쇳물이 끓는다
  p.disc(13, 10.5, 6, PAL.ink);
  p.disc(13, 10.5, 5, PAL.metal.lo);
  p.disc(13, 10.5, 3.6, f ? PAL.fire[2] : '#3a2416');
  if (f) {
    p.px(11 + (f % 3), 9, PAL.fire[1]);
    p.px(13 + ((f >> 1) & 1), 11, PAL.fire[0]);
    p.px(12, 12 - (f % 2), PAL.fire[1]);
  }
  // 굴뚝
  p.rect(22, 3, 6, 10, PAL.ink);
  p.rect(23, 4, 4, 8, IRON.mid);
  p.rect(23, 4, 1, 8, IRON.hi);
  p.rect(23, 4, 4, 2, HOLE);
  // 아궁이
  mouth(p, 16, 20, 12, 5, f, PAL.fire);
});

define('assembler', 32, 32, 5, (p, f) => {
  const top = ramp('#6e9cba');
  machine(p, top, PAL.wood);
  for (const [x, y] of [[3, 3], [27, 3], [27, 16]]) bolt(p, x, y, IRON);
  const t = turn(f);
  shapeAround(p, 11.5, 10.5, 6.5, gearFill(11.5, 10.5, 6.5, 8, (t * TAU) / 8, PAL.brass));
  shapeAround(p, 21.5, 10, 5.5, gearFill(21.5, 10, 5.5, 7, (-t * TAU) / 7 + 0.22, PAL.metal));
  // 서랍
  for (const x of [15, 22]) {
    p.rect(x, 20, 6, 4, PAL.ink);
    p.rect(x + 1, 21, 4, 2, PAL.wood.hi);
    p.px(x + 2, 22, PAL.brass.lo);
    p.px(x + 3, 22, PAL.brass.lo);
  }
});

define('crusher', 32, 32, 5, (p, f) => {
  const c = ramp('#9c8a66');
  machine(p, c, IRON);
  // 깔때기 속 두 롤러: 서로 반대로 돈다
  p.rect(4, 3, 24, 15, PAL.ink);
  p.rect(5, 4, 22, 13, HOLE);
  const t = f ? f - 1 : 0;
  for (const [y, dir] of [
    [5, 1],
    [11, -1],
  ] as const) {
    p.rect(6, y, 20, 1, PAL.metal.hi);
    p.rect(6, y + 1, 20, 2, PAL.metal.mid);
    p.rect(6, y + 3, 20, 1, PAL.metal.lo);
    for (let x = (((t * dir) % 4) + 4) % 4; x < 20; x += 4) p.rect(6 + x, y, 1, 4, PAL.metal.dark);
  }
  if (f) for (let k = 0; k < 4; k++) p.px(7 + (hash(f * 5 + k) % 18), 9 + (k % 2), STONE.hi);
  // 배출구
  p.rect(17, 20, 9, 4, PAL.ink);
  p.rect(18, 21, 7, 3, HOLE);
  if (f) p.px(19 + (f % 4), 22, STONE.mid);
  for (const x of [15, 27]) bolt(p, x, 21, IRON);
});

// ───── 숲: 벌목기·식목기·제재소 ─────

/** 둥근 톱날 (f로 돈다): 톱니 8개, 안쪽 홈 한 줄, 가운데 놋쇠 축 */
function sawBlade(p: Pen, cx: number, cy: number, r: number, f: number): void {
  const a = (f ? f - 1 : 0) * (TAU / 32);
  shapeAround(p, cx, cy, r, (x, y) => {
    const dx = x - cx;
    const dy = y - cy;
    const d = Math.hypot(dx, dy);
    if (d > r) return null;
    // 톱니: 바깥 1.4픽셀은 각도에 따라 들쭉날쭉
    if (d > r - 1.4 && Math.floor(((Math.atan2(dy, dx) - a + TAU) % TAU) / (TAU / 16)) % 2) return null;
    if (d < 1.5) return PAL.brass.mid;
    if (Math.abs(d - (r - 2.3)) < 0.5) return PAL.metal.lo;
    return lit(dx, dy, { hi: PAL.metal.hi, mid: PAL.metal.mid, lo: PAL.metal.lo });
  });
}

/** 통나무 마구리 4×4 (잉크 테두리, 모서리는 둥글게 비움, 가운데 나이테) */
function logEnd(p: Pen, x: number, y: number): void {
  p.rect(x + 1, y, 2, 4, PAL.ink);
  p.rect(x, y + 1, 4, 2, PAL.ink);
  p.rect(x + 1, y + 1, 2, 2, PAL.wood.hi);
  p.px(x + 2, y + 2, PAL.wood.mid);
}

/** 손잡이 끝에 날이 달린 도끼. 손잡이는 (px, py)에서 각도 a로 len만큼 */
function axe(p: Pen, px: number, py: number, a: number, len: number): void {
  const hx = px + Math.cos(a) * len;
  const hy = py + Math.sin(a) * len;
  const x0 = Math.floor(Math.min(px, hx) - 5);
  const y0 = Math.floor(Math.min(py, hy) - 5);
  const w = Math.ceil(Math.max(px, hx) + 5) - x0;
  const h = Math.ceil(Math.max(py, hy) + 5) - y0;
  shape(p, x0, y0, w, h, (x, y) => {
    // 손잡이 방향 u, 날 쪽(내려찍는 쪽) v
    const u = (x - px) * Math.cos(a) + (y - py) * Math.sin(a);
    const v = (x - px) * Math.sin(a) - (y - py) * Math.cos(a);
    // 날: 손잡이 끝에 붙은 쐐기. 날끝은 밝게, 등은 어둡게
    if (u > len - 2.6 && u < len + 0.6 && v > -1 && v < 3.4 - Math.max(0, len - 1 - u) * 0.6) {
      return v > 2.2 ? PAL.metal.hi : v < 0.3 ? PAL.metal.lo : PAL.metal.mid;
    }
    return u > 0 && u < len && Math.abs(v) < 0.75 ? PAL.wood.mid : null;
  });
}

/** 벌목기 도끼 각도: 0 = 그루터기에 박힌 채 쉼, 1 들기, 2 휘두르기, 3 내려찍기, 4 뽑기 */
const AXE_SWING = [-2.62, -1.7, -2.15, -2.62, -2.35];

define('lumberjack', 32, 32, 5, (p, f) => {
  const grass = ramp('#7a9a48');
  machine(p, grass, DARK_WOOD);
  // 윗면: 풀밭 (풀포기 몇 개)
  for (const [x, y] of [[5, 5], [24, 4], [4, 15], [20, 16], [27, 11]]) {
    p.px(x, y, grass.lo);
    p.px(x + 1, y - 1, grass.hi);
    p.px(x + 2, y, grass.lo);
  }
  // 그루터기: 껍질 옆면 + 나이테가 보이는 윗면
  p.rect(7, 10, 11, 7, PAL.ink);
  p.rect(8, 11, 9, 5, PAL.wood.lo);
  for (const x of [9, 12, 15]) p.rect(x, 12, 1, 4, PAL.wood.dark);
  p.rect(8, 11, 1, 5, PAL.wood.mid);
  shapeAround(p, 12.5, 9.5, 4.6, (x, y) => {
    const d = Math.hypot((x - 12.5) / 4.6, (y - 9.5) / 2.4);
    if (d > 1) return null;
    // 껍질 테두리, 나이테 한 줄, 가운데 심
    return d > 0.78 ? PAL.wood.lo : (d > 0.42 && d < 0.6) || d < 0.18 ? PAL.wood.mid : PAL.wood.hi;
  });
  // 도끼: 오른쪽 아래를 축으로 들었다 내려찍는다. 찍는 순간 나무 조각이 튄다
  axe(p, 25, 15, AXE_SWING[f], 11);
  if (f === 3) for (const [x, y] of [[8, 6], [11, 5], [17, 6], [16, 4]]) p.px(x, y, PAL.wood.hi);
  // 앞면 오른쪽: 쌓아 둔 통나무 마구리
  for (const x of [15, 19, 23]) logEnd(p, x, 20);
  p.rect(27, 21, 2, 3, DARK_WOOD.lo);
});

define('planter', 32, 32, 5, (p, f) => {
  machine(p, ramp('#8a6a44'), DARK_WOOD);
  // 윗면: 나무틀 화단 + 고랑마다 새싹
  p.rect(3, 3, 26, 15, PAL.ink);
  p.rect(4, 4, 24, 13, PAL.wood.mid);
  p.rect(4, 4, 24, 1, PAL.wood.hi);
  p.rect(5, 6, 22, 10, '#6a4a2c');
  for (let r = 0; r < 3; r++) {
    const y = 8 + r * 3;
    // 고랑: 볼록한 흙 위쪽은 밝게
    p.rect(5, y - 1, 22, 1, '#82603a');
    p.rect(5, y + 1, 22, 1, '#553a22');
    for (let k = 0; k < 4; k++) {
      const x = 7 + k * 6 + (r % 2) * 2;
      // 식목기가 지나가며 하나씩 고개를 드는 새싹
      const up = f && (k + r * 2) % 4 === f - 1 ? 1 : 0;
      p.px(x, y - 1 - up, TREE_LEAF_MID);
      p.px(x - 1, y - 2 - up, TREE_LEAF_MID);
      p.px(x + 1, y - 2 - up, TREE_LEAF_HI);
    }
  }
  // 위쪽 틀을 따라 오가는 놋쇠 씨앗 통 (일할 때)
  const cx = 6 + (f ? (f - 1) * 6 : 0);
  p.rect(cx - 1, 2, 5, 4, PAL.ink);
  p.rect(cx, 3, 3, 2, PAL.brass.mid);
  p.px(cx, 3, PAL.brass.hi);
  p.px(cx + 1, 6, PAL.ink);
  // 앞면 오른쪽: 묘목 상자 (위로 잎이 삐죽)
  p.rect(16, 21, 12, 4, PAL.ink);
  p.rect(17, 22, 10, 2, PAL.wood.mid);
  p.rect(17, 22, 10, 1, PAL.wood.hi);
  for (const x of [21, 24]) p.rect(x, 22, 1, 2, PAL.wood.lo);
  for (const x of [18, 22, 26]) {
    p.px(x - 1, 20, PAL.ink);
    p.px(x, 20, TREE_LEAF_HI);
    p.px(x + 1, 20, TREE_LEAF_MID);
    p.px(x + 2, 20, PAL.ink);
  }
});

define('sawmill', 32, 32, 5, (p, f) => {
  machine(p, PAL.wood, DARK_WOOD);
  for (const [x, y] of [[3, 3], [27, 3]]) bolt(p, x, y, IRON);
  // 윗면: 작업대. 왼쪽에서 통나무가 들어와 톱날을 지나 오른쪽으로 판자가 되어 나간다
  p.rect(2, 9, 28, 8, PAL.ink);
  p.rect(3, 10, 26, 6, DARK_WOOD.mid);
  p.rect(3, 15, 26, 1, DARK_WOOD.lo);
  const shift = f ? f - 1 : 0;
  // 통나무: 왼쪽 끝은 나이테가 보이는 마구리, 껍질 결이 일할 때 한 픽셀씩 흐른다
  p.rect(3, 10, 12, 5, PAL.ink);
  p.rect(4, 11, 10, 3, PAL.wood.mid);
  p.rect(4, 11, 10, 1, PAL.wood.hi);
  for (let x = 6 + shift; x < 14; x += 4) p.rect(x, 12, 2, 1, PAL.wood.lo);
  p.rect(4, 11, 2, 3, PAL.wood.hi);
  p.px(5, 12, PAL.wood.mid);
  // 판자
  p.rect(17, 11, 12, 4, PAL.ink);
  p.rect(17, 12, 12, 2, '#e3b06c');
  p.rect(17, 12, 12, 1, '#f2cf96');
  for (let x = 19 + shift; x < 29; x += 4) p.px(x, 13, PAL.wood.mid);
  sawBlade(p, 16, 9, 5.5, f);
  // 톱밥: 톱날 아래로 흩날린다
  if (f) for (let k = 0; k < 4; k++) p.px(12 + (hash(f * 7 + k) % 9), 16 + (k % 2), '#d9b98a');
  // 앞면 오른쪽: 쌓아 둔 판자
  for (const y of [20, 22]) {
    p.rect(15, y, 14, 3, PAL.ink);
    p.rect(16, y + 1, 12, 1, y === 20 ? '#f2cf96' : '#e3b06c');
    p.px(27, y + 1, PAL.wood.mid);
  }
});

define('washer', 32, 32, 5, (p, f) => {
  machine(p, PAL.wood, DARK_WOOD);
  // 물통
  p.rect(4, 3, 24, 15, PAL.ink);
  p.rect(5, 4, 22, 13, PAL.water.lo);
  p.rect(5, 4, 22, 1, PAL.water.dark);
  for (let k = 0; k < 4; k++) {
    const x = 6 + (hash(k * 11 + f * 3) % 17);
    const y = 6 + (hash(k * 7 + f * 5 + 1) % 9);
    p.rect(x, y, 3, 1, PAL.water.mid);
    p.px(x + 1, y, PAL.water.hi);
  }
  // 휘젓개
  const a = turn(f) * Math.PI;
  shapeAround(p, 16, 10.5, 6, (x, y) => {
    const dx = x - 16;
    const dy = y - 10.5;
    const d = Math.hypot(dx, dy);
    if (d <= 1.6) return PAL.brass.hi;
    return d <= 5.6 && onSpoke(dx, dy, a, 0.9, true) ? PAL.metal.mid : null;
  });
  // 앞면 쇠테
  for (const y of [21, 23]) p.rect(14, y, 15, 1, IRON.mid);
});

define('separator', 32, 32, 5, (p, f) => {
  machine(p, PAL.metal, IRON);
  const glass = ramp('#9a6ab8');
  const a = turn(f) * (TAU / 3) + 0.4;
  shapeAround(p, 16, 10.5, 7.5, (x, y) => {
    const dx = x - 16;
    const dy = y - 10.5;
    const d = Math.hypot(dx, dy);
    if (d > 7.5) return null;
    if (d > 6) return lit(dx, dy, PAL.brass, 0.3);
    if (d < 1.6) return PAL.brass.hi;
    for (let k = 0; k < 3; k++) if (onSpoke(dx, dy, a + (k * TAU) / 3, 0.7)) return PAL.brass.lo;
    return lit(dx, dy, glass, 0.5);
  });
  for (const [x, y] of [[3, 3], [27, 3], [3, 16], [27, 16]]) bolt(p, x, y, IRON);
  // 앞면 환기구
  for (let x = 15; x < 28; x += 3) p.rect(x, 20, 2, 4, PAL.ink);
  p.rect(14, 24, 15, 1, glass.mid);
});

define('electric-furnace', 32, 32, 5, (p, f) => {
  machine(p, PAL.metal, IRON);
  const glow = ['#f2fbff', '#bfe6ff', '#6fb6f2', '#3f7fc4'];
  // 코일 판: 일하면 파랗게 달아오른다
  p.disc(16, 10.5, 7.5, PAL.ink);
  p.disc(16, 10.5, 6.5, IRON.lo);
  for (const r of [5, 3]) ring(p, 16, 10.5, r, f ? glow[(f + r) % 2 ? 1 : 2] : '#c9733f');
  p.disc(16, 10.5, 1.2, f ? glow[0] : '#e8955a');
  for (const [x, y] of [[3, 3], [27, 3], [3, 16], [27, 16]]) bolt(p, x, y, IRON);
  mouth(p, 16, 20, 12, 5, f, glow);
});

define('pump', 32, 32, 5, (p, f) => {
  machine(p, PAL.metal, ramp('#4f7fae'));
  // 우물: 일하면 물결이 퍼진다
  p.disc(11, 10.5, 6.5, PAL.ink);
  p.disc(11, 10.5, 5.5, PAL.water.lo);
  p.px(9, 8, PAL.water.hi);
  if (f) ring(p, 11, 10.5, f, PAL.water.mid);
  // 관과 밸브
  p.rect(17, 8, 11, 5, PAL.ink);
  p.rect(17, 9, 10, 3, PAL.metal.mid);
  p.rect(17, 9, 10, 1, PAL.metal.hi);
  p.rect(17, 11, 10, 1, PAL.metal.lo);
  p.disc(23, 10.5, 3.5, PAL.ink);
  p.disc(23, 10.5, 2.5, PAL.red);
  p.px(22, 9, '#f09a8c');
  p.px(23, 10, PAL.ink);
  // 앞면 출수구: 일하면 물방울
  p.rect(18, 20, 6, 3, PAL.ink);
  p.rect(19, 21, 4, 1, PAL.metal.mid);
  if (f) p.px(20 + (f % 2), 23, PAL.water.mid);
});

// ───────────────────────── 발전 (32×32) ─────────────────────────

define('generator', 32, 32, 5, (p, f) => {
  const green = ramp('#4f8a52');
  machine(p, IRON, green, false);
  // 보일러 통
  p.rect(3, 4, 14, 12, PAL.ink);
  p.rect(4, 5, 12, 10, PAL.metal.mid);
  p.rect(4, 5, 12, 2, PAL.metal.hi);
  p.rect(4, 13, 12, 2, PAL.metal.lo);
  for (const x of [7, 12]) p.rect(x, 5, 1, 10, PAL.brass.mid);
  // 플라이휠
  const a = turn(f) * (TAU / 6);
  shapeAround(p, 23, 10.5, 6.5, wheelFill(23, 10.5, 6.5, 6, a, PAL.brass, PAL.metal.mid, IRON.lo));
  // 앞면: 아궁이 + 석탄 칸 (석탄은 그릴 때 채운다)
  mouth(p, 3, 21, 9, 6, f, PAL.fire);
  const fu = MACHINE.fuel;
  p.rect(fu.x - 1, fu.y - 1, fu.n * fu.step + 1, fu.h + 2, PAL.ink);
  for (let k = 0; k < fu.n; k++) p.rect(fu.x + k * fu.step, fu.y, fu.w, fu.h, HOLE);
});

define('solar', 32, 32, 5, (p, f) => {
  machine(p, PAL.wood, DARK_WOOD, false);
  const cell = '#2b4c7e';
  for (let r = 0; r < 2; r++) {
    for (let c = 0; c < 3; c++) {
      const x = 3 + c * 9;
      const y = 3 + r * 8;
      p.rect(x, y, 8, 7, PAL.ink);
      p.rect(x + 1, y + 1, 6, 5, cell);
      p.rect(x + 1, y + 3, 6, 1, '#3d64a0');
      p.rect(x + 4, y + 1, 1, 5, '#3d64a0');
      p.px(x + 1, y + 1, '#7fa6d9');
      // 반짝임이 비스듬히 지나간다
      if (!f) continue;
      for (let yy = y + 1; yy < y + 6; yy++) {
        for (let xx = x + 1; xx < x + 7; xx++) {
          const d = xx + yy - (f * 11 - 3);
          if (d >= 0 && d <= 1) p.px(xx, yy, '#cfe3ff');
        }
      }
    }
  }
  // 앞면: 해 그림
  p.disc(8, 23.5, 3.2, PAL.ink);
  p.disc(8, 23.5, 2.2, PAL.brass.hi);
  for (const [x, y] of [[8, 19], [8, 27], [3, 23], [12, 23]]) p.px(x, y, PAL.brass.mid);
  for (let x = 16; x < 29; x += 4) p.rect(x, 20, 1, 4, DARK_WOOD.lo);
});

define('hydro', 32, 32, 5, (p, f) => {
  machine(p, STONE, ramp('#6b6458'), false);
  bricks(p, 3, 3, 26, 9, STONE);
  // 물길: 오른쪽으로 흐른다
  p.rect(2, 12, 28, 7, PAL.water.lo);
  p.rect(2, 12, 28, 1, PAL.water.dark);
  for (let k = 0; k < 4; k++) {
    const x = 2 + ((k * 7 + (f ? f - 1 : 0) * 2) % 26);
    p.rect(x, 14 + (k % 3) * 2, 3, 1, PAL.water.mid);
    p.px(x + 1, 14 + (k % 3) * 2, PAL.water.hi);
  }
  // 물레방아
  const a = turn(f) * (TAU / 8);
  shapeAround(p, 16, 9.5, 8.6, wheelFill(16, 9.5, 7, 8, a, PAL.wood, PAL.wood.lo, 'none', true));
  // 앞면 돌 무늬 (물 눈금은 진행 막대 자리에 그릴 때 채운다)
  for (let x = 4; x < 13; x += 4) p.rect(x, 21, 1, 3, '#57514a');
});

define('wind', 32, 32, 5, (p, f) => {
  machine(p, STONE, ramp('#6f8fa6'), false);
  // 기둥
  p.rect(14, 10, 4, 15, PAL.ink);
  p.rect(15, 10, 2, 15, CREAM);
  p.rect(16, 10, 1, 15, '#d8c9a6');
  // 날개 셋: 프레임마다 1/12바퀴 (날개가 셋이라 4프레임 = 1/3바퀴면 처음 모양으로 이어진다)
  const a = -TAU / 4 + turn(f) * (TAU / 3);
  const blade: Ramp = { hi: '#ffffff', mid: CREAM, lo: '#cdbb94' };
  shapeAround(p, 16, 10, 9.5, (x, y) => {
    const dx = x - 16;
    const dy = y - 10;
    const d = Math.hypot(dx, dy);
    if (d < 1.8) return PAL.metal.mid;
    if (d > 9.5) return null;
    // 뿌리 쪽이 굵고 끝으로 갈수록 가늘다
    const half = 1.9 - d * 0.1;
    for (let k = 0; k < 3; k++) if (onSpoke(dx, dy, a + (k * TAU) / 3, half)) return lit(dx, dy, blade, 0.5);
    return null;
  });
  // 앞면: 작은 문과 바람개비 무늬
  p.rect(13, 21, 6, 7, PAL.ink);
  p.rect(14, 22, 4, 6, DARK_WOOD.mid);
  p.px(17, 25, PAL.brass.hi);
  for (const x of [5, 8, 23, 26]) p.rect(x, 22, 1, 4, tone('#6f8fa6', -0.3));
});

// ───────────────────────── 창고 조각 (32×32, 묶음 가장자리 16가지) ─────────────────────────

/** mask: 1 = 위, 2 = 오른쪽, 4 = 아래, 8 = 왼쪽이 묶음 가장자리. 안쪽 변은 널빤지가 이어진다 */
for (let m = 0; m < 16; m++) {
  define(`storage:${m}`, 32, 32, 1, (p) => {
    const T = m & 1;
    const R = m & 2;
    const B = m & 4;
    const L = m & 8;
    const x0 = L ? 1 : 0;
    const y0 = T ? 1 : 0;
    const x1 = R ? 30 : 31;
    const y1 = B ? 29 : 31;
    const wood = PAL.wood;
    // 널빤지 줄은 조각 위치와 상관없이 같은 높이라 위아래로 붙여도 이어진다
    p.rect(0, 0, 32, 32, wood.mid);
    planks(p, 0, 0, 32, 32, wood, 9);
    p.clear(0, 0, 32, y0);
    p.clear(0, y1 + 1, 32, 31 - y1);
    p.clear(0, 0, x0, 32);
    p.clear(x1 + 1, 0, 31 - x1, 32);
    if (R) p.rect(31, y0 + 1, 1, y1 - y0 + 1, PAL.shadow);
    if (B) p.rect(x0 + 1, 30, x1 - x0 + 1, 1, PAL.shadow);
    // 앞면 (묶음 아래쪽)
    if (B) {
      p.rect(x0, 25, x1 - x0 + 1, 4, DARK_WOOD.mid);
      p.rect(x0, 25, x1 - x0 + 1, 1, DARK_WOOD.hi);
      p.rect(x0, 28, x1 - x0 + 1, 1, DARK_WOOD.lo);
    }
    // 바깥 변: 잉크 + 두꺼운 나무틀 (위·왼쪽 밝게, 오른쪽 어둡게)
    const fy1 = B ? 24 : y1;
    if (T) {
      p.rect(x0, 2, x1 - x0 + 1, 1, wood.hi);
      p.rect(x0, 3, x1 - x0 + 1, 1, wood.lo);
    }
    if (L) {
      p.rect(2, y0, 1, fy1 - y0 + 1, wood.hi);
      p.rect(3, y0 + (T ? 2 : 0), 1, fy1 - y0 + 1 - (T ? 2 : 0), wood.lo);
    }
    if (R) {
      p.rect(28, y0 + (T ? 2 : 0), 1, fy1 - y0 + 1 - (T ? 2 : 0), wood.lo);
      p.rect(29, y0, 1, fy1 - y0 + 1, wood.dark);
    }
    if (T) p.rect(x0, 1, x1 - x0 + 1, 1, PAL.ink);
    if (B) p.rect(x0, 29, x1 - x0 + 1, 1, PAL.ink);
    if (L) p.rect(1, y0, 1, y1 - y0 + 1, PAL.ink);
    if (R) p.rect(30, y0, 1, y1 - y0 + 1, PAL.ink);
    // 바깥 모서리 쇠 꺾쇠
    const bracket = (x: number, y: number, sx: number, sy: number) => {
      for (let k = 0; k < 4; k++) {
        p.px(x + k * sx, y, k === 0 ? IRON.hi : IRON.mid);
        p.px(x, y + k * sy, k === 0 ? IRON.hi : IRON.mid);
      }
      p.px(x + sx, y + sy, IRON.lo);
    };
    if (T && L) bracket(2, 2, 1, 1);
    if (T && R) bracket(29, 2, -1, 1);
    if (B && L) bracket(2, 24, 1, -1);
    if (B && R) bracket(29, 24, -1, -1);
  });
}

// ───────────────────────── 정류장 (32×32) ─────────────────────────

/** 싣기 = 초록 차양, 내리기 = 주황 차양. 번호·쌓인 양·글씨는 그릴 때 */
for (const [mode, color] of [
  ['load', PAL.green],
  ['unload', PAL.orange],
] as const) {
  define(`station-${mode}`, 32, 32, 1, (p) => {
    machine(p, PAL.wood, IRON);
    planks(p, 3, 6, 26, 12, PAL.wood, 21);
    const c = ramp(color, 0.25);
    for (let x = 2; x < 30; x++) {
      const stripe = Math.floor((x - 2) / 3) % 2 ? CREAM : c.mid;
      p.rect(x, 2, 1, 3, stripe);
      if ((x - 2) % 3 !== 2) p.px(x, 5, stripe === CREAM ? '#d9c9a3' : c.lo);
    }
    p.rect(2, 2, 28, 1, c.hi);
  });
}

// ───────────────────────── 1칸 물류 상자 (16×16) ─────────────────────────

/** 뚜껑 무늬 6×6 (빈 상자일 때 보인다. 아이템을 들면 가려진다) */
const BOX_GLYPH: Record<string, string[]> = {
  splitter: ['1....1', '.1..1.', '..11..', '..11..', '..11..', '..11..'],
  merger: ['..11..', '..11..', '..11..', '..11..', '.1..1.', '1....1'],
  overflow: ['..11..', '..11..', '..1111', '..11.1', '..11..', '..11..'],
  sorter: ['111111', '.1111.', '..11..', '..11..', '..11..', '......'],
  unloader: ['11.11.', '11.11.', '......', '11.11.', '11.11.', '......'],
  // 번개
  charger: ['...11.', '..11..', '.1111.', '..11..', '.11...', '.1....'],
};
const BOX_COLOR: Record<string, string> = {
  splitter: '#7a5aa8',
  overflow: '#a85a8a',
  sorter: '#3aa58a',
  merger: '#5a8fa8',
  unloader: '#c9803a',
  charger: '#d9b44a',
};
for (const [name, color] of Object.entries(BOX_COLOR)) {
  define(name, 16, 16, 1, (p) => {
    const lid = ramp(color, 0.3);
    block(p, 1, 1, 14, 14, lid, IRON, 3);
    const glyph = tone(color, 0.5);
    BOX_GLYPH[name].forEach((row, y) => [...row].forEach((ch, x) => ch === '1' && p.px(5 + x, 3 + y, glyph)));
  });
}

// ───────────────────────── 트럭 (16×16, 방향 4가지 × 짐 3단계) ─────────────────────────

/**
 * truck:<dir> (0 위, 1 오른쪽, 2 아래, 3 왼쪽). 프레임 0 = 빈 차, 1 = 조금, 2 = 가득.
 * 오른쪽을 보는 차를 그린 뒤 돌려서 찍는다. 그림자는 늘 화면 오른쪽 아래
 */
for (let dir = 0; dir < 4; dir++) {
  define(`truck:${dir}`, 16, 16, 3, (p, f) => {
    const cells: (string | null)[] = new Array(256).fill(null);
    const map = (x: number, y: number): [number, number] =>
      dir === 1 ? [x, y] : dir === 2 ? [15 - y, x] : dir === 3 ? [15 - x, 15 - y] : [y, 15 - x];
    const set = (x: number, y: number, w: number, h: number, c: string) => {
      for (let yy = y; yy < y + h; yy++) {
        for (let xx = x; xx < x + w; xx++) {
          const [X, Y] = map(xx, yy);
          cells[Y * 16 + X] = c;
        }
      }
    };
    // 바퀴
    for (const x of [3, 11]) {
      set(x, 3, 2, 1, '#2b2622');
      set(x, 12, 2, 1, '#2b2622');
    }
    // 짐칸
    set(1, 4, 9, 8, PAL.ink);
    set(2, 5, 7, 6, PAL.wood.lo);
    set(2, 5, 7, 1, PAL.wood.hi);
    set(2, 10, 7, 1, PAL.wood.dark);
    if (f >= 1) {
      set(3, 6, 3, 4, PAL.ink);
      set(4, 7, 1, 2, '#d9b77a');
    }
    if (f >= 2) {
      set(6, 6, 3, 4, PAL.ink);
      set(7, 7, 1, 2, '#d9b77a');
    }
    // 운전석
    set(10, 4, 5, 8, PAL.ink);
    set(11, 5, 3, 6, '#d9a441');
    set(11, 5, 3, 1, '#f2c96a');
    set(13, 6, 1, 4, '#2f4a66');
    set(13, 6, 1, 1, '#8fb3d9');
    set(14, 5, 1, 1, '#fff3c4');
    set(14, 10, 1, 1, '#fff3c4');
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        if (!cells[y * 16 + x] && x > 0 && y > 0 && cells[(y - 1) * 16 + x - 1]) p.px(x, y, PAL.shadow);
      }
    }
    for (let i = 0; i < 256; i++) if (cells[i]) p.px(i % 16, Math.floor(i / 16), cells[i]!);
  });
}
