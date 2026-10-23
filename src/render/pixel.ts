import { ITEMS, ITEM_IDS, type ItemId, type ItemShape } from '../data/items';

/**
 * 픽셀아트. 1칸 = 16픽셀. 모든 그림을 여기서 코드로 한 점씩 찍어 작은 캔버스에 구워 둔다.
 * 프레임이 여러 장인 그림은 가로로 이어 붙인다 (프레임 i = x 위치 i × w).
 * public/sprites/manifest.json 에 이름이 있으면 public/sprites/<이름>.png 를 대신 쓴다 (직접 그린 그림으로 바꿔 끼우기).
 */
export const TILE = 16;

/** 따뜻한 공방 팔레트 */
export const PAL = {
  ink: '#3b2716',
  ground: ['#e9dab5', '#e7d8b2', '#eadcb7', '#e6d6af'],
  speckDark: '#d4c196',
  speckLight: '#f6eed8',
  shadow: 'rgba(59,39,22,0.28)',
  wood: { hi: '#e3b06c', mid: '#c28747', lo: '#8f5c2c', dark: '#5f3b1b' },
  brass: { hi: '#f6d77e', mid: '#d7a63d', lo: '#9e7526' },
  metal: { hi: '#dde3e9', mid: '#a7b1bc', lo: '#727c88', dark: '#4b535d' },
  brick: { hi: '#d9866a', mid: '#b55c3e', lo: '#853e28' },
  fire: ['#fff0b8', '#ffbd52', '#f2772c', '#c4461e'],
  water: { hi: '#cfe6f7', mid: '#5aa3d9', lo: '#3f86c4', dark: '#2c679f' },
  belt: { rail: '#4c3d31', surf: '#867869', hi: '#9d8f7e', chev: '#e6d7b4' },
  fast: { rail: '#2c4b6e', surf: '#6c88a8', hi: '#8aa4c1', chev: '#e0ecf8' },
  road: { surf: '#8f877a', hi: '#a39b8d', curb: '#6b6458', line: '#f2d27a' },
  out: '#ffd34d',
  in: '#f7f0df',
  green: '#5fae5a',
  orange: '#e8893a',
  red: '#d9534a',
};

/** 작은 캔버스에 점·사각형을 찍는 붓 (좌표는 픽셀) */
export class Pen {
  constructor(
    readonly ctx: CanvasRenderingContext2D,
    /** 프레임마다 x를 밀어 주는 값 */
    public ox = 0,
  ) {}
  px(x: number, y: number, c: string): void {
    this.ctx.fillStyle = c;
    this.ctx.fillRect(this.ox + Math.round(x), Math.round(y), 1, 1);
  }
  rect(x: number, y: number, w: number, h: number, c: string): void {
    if (w <= 0 || h <= 0) return;
    this.ctx.fillStyle = c;
    this.ctx.fillRect(this.ox + Math.round(x), Math.round(y), Math.round(w), Math.round(h));
  }
  /** 투명하게 지우기 */
  clear(x: number, y: number, w: number, h: number): void {
    if (w > 0 && h > 0) this.ctx.clearRect(this.ox + x, y, w, h);
  }
  /** 테두리(ink) + 위·왼쪽 밝은 줄 + 아래·오른쪽 어두운 줄이 있는 상자 */
  box(x: number, y: number, w: number, h: number, c: { hi: string; mid: string; lo: string }, ink = PAL.ink): void {
    this.rect(x, y, w, h, ink);
    this.rect(x + 1, y + 1, w - 2, h - 2, c.mid);
    this.rect(x + 1, y + 1, w - 2, 1, c.hi);
    this.rect(x + 1, y + 1, 1, h - 2, c.hi);
    this.rect(x + 1, y + h - 2, w - 2, 1, c.lo);
    this.rect(x + w - 2, y + 1, 1, h - 2, c.lo);
  }
  /** 채운 원 (가운데 cx, cy는 .5 단위도 된다) */
  disc(cx: number, cy: number, r: number, c: string): void {
    for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) {
      for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
        const dx = x + 0.5 - cx;
        const dy = y + 0.5 - cy;
        if (dx * dx + dy * dy <= r * r) this.px(x, y, c);
      }
    }
  }
  line(x0: number, y0: number, x1: number, y1: number, c: string): void {
    const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
    for (let i = 0; i <= n; i++) this.px(x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n, c);
  }
}

type Painter = (p: Pen, frame: number) => void;

interface SpriteDef {
  w: number;
  h: number;
  frames: number;
  paint: Painter;
}

export interface Sprite {
  img: CanvasImageSource;
  w: number;
  h: number;
  frames: number;
}

const defs = new Map<string, SpriteDef>();
const baked = new Map<string, Sprite>();

/** 그림 하나 등록 (구울 때 paint를 프레임마다 부른다) */
export function define(name: string, w: number, h: number, frames: number, paint: Painter): void {
  defs.set(name, { w, h, frames, paint });
}

/** 이름으로 그림 (처음 부를 때 굽는다). 없는 이름이면 null */
export function sprite(name: string): Sprite | null {
  let s = baked.get(name);
  if (s) return s;
  const d = defs.get(name);
  if (!d) return null;
  const c = document.createElement('canvas');
  c.width = d.w * d.frames;
  c.height = d.h;
  const ctx = c.getContext('2d')!;
  for (let f = 0; f < d.frames; f++) d.paint(new Pen(ctx, f * d.w), f);
  s = { img: c, w: d.w, h: d.h, frames: d.frames };
  baked.set(name, s);
  return s;
}

const halves = new Map<string, Sprite>();

/**
 * 멀리서 볼 때(LOD) 쓰는 절반 크기 그림 (첫 프레임만, 움직이지 않는다).
 * 2×2 픽셀마다 가장 많이 쓴 색 하나로 줄인다. 같으면 진한 색 (잉크 테두리가 남게), 투명은 늘 진다
 */
export function spriteHalf(name: string): Sprite | null {
  const cached = halves.get(name);
  if (cached) return cached;
  const s = sprite(name);
  if (!s) return null;
  const src = document.createElement('canvas');
  src.width = s.w;
  src.height = s.h;
  const sctx = src.getContext('2d')!;
  sctx.drawImage(s.img, 0, 0, s.w, s.h, 0, 0, s.w, s.h);
  const d = sctx.getImageData(0, 0, s.w, s.h).data;
  const w = Math.ceil(s.w / 2);
  const h = Math.ceil(s.h / 2);
  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  const octx = out.getContext('2d')!;
  const img = octx.createImageData(w, h);
  /** 진하기 (작을수록 진함). 투명·반투명은 맨 뒤 */
  const weight = (o: number) => (d[o + 3] < 128 ? 1e9 - d[o + 3] : d[o] * 0.3 + d[o + 1] * 0.59 + d[o + 2] * 0.11);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const counts = new Map<number, { n: number; o: number }>();
      for (let dy = 0; dy < 2; dy++) {
        for (let dx = 0; dx < 2; dx++) {
          const px = x * 2 + dx;
          const py = y * 2 + dy;
          if (px >= s.w || py >= s.h) continue;
          const o = (py * s.w + px) * 4;
          const key = ((d[o] << 24) | (d[o + 1] << 16) | (d[o + 2] << 8) | d[o + 3]) >>> 0;
          const c = counts.get(key);
          if (c) c.n++;
          else counts.set(key, { n: 1, o });
        }
      }
      let best: { n: number; o: number } | null = null;
      for (const c of counts.values()) {
        if (!best || c.n > best.n || (c.n === best.n && weight(c.o) < weight(best.o))) best = c;
      }
      const t = (y * w + x) * 4;
      for (let k = 0; k < 4; k++) img.data[t + k] = d[best!.o + k];
    }
  }
  octx.putImageData(img, 0, 0);
  const half = { img: out, w, h, frames: 1 };
  halves.set(name, half);
  return half;
}

let overrides: Promise<string[]> | null = null;

/** 등록된 그림 이름 전부 (바꿔 끼우기 안내용) */
export function spriteNames(): { name: string; w: number; h: number; frames: number }[] {
  return [...defs].map(([name, d]) => ({ name, w: d.w, h: d.h, frames: d.frames }));
}

/**
 * 직접 그린 PNG로 바꿔 끼우기: public/sprites/manifest.json (["miner", "item:coal", ...]) 에 적힌 이름만
 * public/sprites/<이름>.png 를 불러와 코드 그림 대신 쓴다. 파일 이름에서는 ':'를 '_'로 (item_coal.png).
 * 크기는 코드 그림과 같아야 한다 (프레임은 가로로 이어 붙인다).
 * 맵·UI 아이콘·그림 목록이 각자 불러도 한 번만 받는다.
 */
export function loadSpriteOverrides(): Promise<string[]> {
  overrides ??= fetchSpriteOverrides();
  return overrides;
}

async function fetchSpriteOverrides(): Promise<string[]> {
  let names: string[] = [];
  try {
    const res = await fetch('sprites/manifest.json');
    if (!res.ok) return [];
    names = await res.json();
  } catch {
    return [];
  }
  const loaded: string[] = [];
  await Promise.all(
    names.map(
      (entry) =>
        new Promise<void>((done) => {
          // 이름에는 '_'가 없어서 파일 이름으로 적어도 된다
          const name = String(entry).replace(/_/g, ':');
          const d = defs.get(name);
          if (!d) return done();
          const img = new Image();
          img.onload = () => {
            baked.set(name, { img, w: d.w, h: d.h, frames: Math.max(1, Math.floor(img.width / d.w)) });
            halves.delete(name);
            loaded.push(name);
            done();
          };
          img.onerror = () => done();
          img.src = `sprites/${name.replace(/:/g, '_')}.png`;
        }),
    ),
  );
  return loaded;
}

// ───────────────────────── 색 ─────────────────────────

/** #rrggbb 를 밝게(+) 또는 어둡게(-) */
export function tone(hex: string, amt: number): string {
  const n = parseInt(hex.slice(1), 16);
  const f = (c: number) => Math.round(Math.min(255, Math.max(0, amt < 0 ? c * (1 + amt) : c + (255 - c) * amt)));
  const v = (f(n >> 16) << 16) | (f((n >> 8) & 255) << 8) | f(n & 255);
  return `#${v.toString(16).padStart(6, '0')}`;
}

/** 아이템 색 세 단계 */
function ramp(item: ItemId): { hi: string; mid: string; lo: string } {
  const c = ITEMS[item].color;
  return { hi: tone(c, 0.35), mid: c, lo: tone(c, -0.38) };
}

// ───────────────────────── 아이템 (8×8) ─────────────────────────

const ITEM_PAINT: Record<ItemShape, (p: Pen, c: { hi: string; mid: string; lo: string }, item: ItemId) => void> = {
  ore: (p, c, item) => {
    // 울퉁불퉁한 돌덩이
    p.rect(2, 1, 4, 1, PAL.ink);
    p.rect(1, 2, 6, 4, PAL.ink);
    p.rect(2, 6, 5, 1, PAL.ink);
    p.rect(2, 2, 4, 4, c.mid);
    p.rect(3, 5, 3, 1, c.lo);
    p.rect(5, 3, 1, 2, c.lo);
    p.px(2, 2, c.hi);
    p.px(3, 2, c.hi);
    p.px(2, 3, c.hi);
    if (item === 'coal') p.px(4, 3, '#6d6d78');
  },
  plate: (p, c) => {
    p.rect(1, 2, 6, 4, PAL.ink);
    p.rect(1, 2, 5, 3, c.mid);
    p.rect(1, 2, 5, 1, c.hi);
    p.rect(2, 5, 5, 1, c.lo);
    p.rect(6, 3, 1, 3, c.lo);
  },
  gear: (p, c) => {
    p.rect(3, 0, 2, 8, PAL.ink);
    p.rect(0, 3, 8, 2, PAL.ink);
    p.disc(4, 4, 3, PAL.ink);
    p.disc(4, 4, 2.4, c.mid);
    p.rect(3, 1, 2, 1, c.mid);
    p.rect(1, 3, 1, 2, c.mid);
    p.rect(6, 3, 1, 2, c.lo);
    p.rect(3, 6, 2, 1, c.lo);
    p.px(3, 2, c.hi);
    p.rect(3, 3, 2, 2, PAL.ink);
  },
  wire: (p, c) => {
    p.disc(4, 4, 3.6, PAL.ink);
    p.disc(4, 4, 2.8, c.mid);
    p.disc(4, 4, 1.4, PAL.ink);
    p.px(2, 2, c.hi);
    p.px(3, 1, c.hi);
    p.px(6, 5, c.lo);
  },
  ingot: (p, c) => {
    p.rect(2, 2, 5, 1, PAL.ink);
    p.rect(1, 3, 7, 3, PAL.ink);
    p.rect(2, 3, 5, 2, c.mid);
    p.rect(2, 3, 4, 1, c.hi);
    p.rect(1, 5, 6, 1, c.lo);
  },
  chip: (p, c) => {
    for (const x of [2, 4, 6]) {
      p.px(x - 0.5, 0, PAL.brass.mid);
      p.px(x - 0.5, 7, PAL.brass.mid);
    }
    p.rect(1, 1, 6, 6, PAL.ink);
    p.rect(2, 2, 4, 4, c.mid);
    p.rect(2, 2, 4, 1, c.hi);
    p.rect(3, 3, 2, 2, PAL.brass.hi);
  },
  powder: (p, c) => {
    p.rect(3, 2, 2, 1, PAL.ink);
    p.rect(2, 3, 4, 1, PAL.ink);
    p.rect(1, 4, 6, 3, PAL.ink);
    p.rect(3, 3, 2, 1, c.hi);
    p.rect(2, 4, 4, 2, c.mid);
    p.px(2, 4, c.hi);
    p.rect(2, 5, 5, 1, c.lo);
    p.px(4, 4, c.lo);
  },
  drop: (p, c) => {
    p.rect(3, 0, 2, 2, PAL.ink);
    p.rect(2, 2, 4, 1, PAL.ink);
    p.rect(1, 3, 6, 4, PAL.ink);
    p.rect(2, 7, 4, 1, PAL.ink);
    p.rect(3, 1, 1, 2, c.mid);
    p.rect(2, 3, 4, 4, c.mid);
    p.rect(5, 4, 1, 3, c.lo);
    p.rect(3, 6, 3, 1, c.lo);
    p.px(3, 4, c.hi);
  },
  sapling: (p, c) => {
    // 흙 한 줌에서 돋은 새싹 (잎 두 장)
    p.rect(1, 6, 6, 2, PAL.ink);
    p.rect(2, 6, 4, 1, PAL.wood.mid);
    p.rect(3, 3, 1, 3, PAL.ink);
    p.rect(1, 1, 3, 2, PAL.ink);
    p.rect(4, 2, 3, 2, PAL.ink);
    p.rect(2, 1, 1, 1, c.hi);
    p.rect(1, 2, 2, 1, c.mid);
    p.rect(5, 2, 2, 1, c.mid);
    p.px(4, 3, c.lo);
  },
  log: (p, c) => {
    // 옆으로 누운 통나무, 오른쪽 끝에 나이테
    p.rect(0, 2, 7, 5, PAL.ink);
    p.rect(1, 3, 5, 3, c.mid);
    p.rect(1, 3, 5, 1, c.hi);
    p.rect(1, 5, 5, 1, c.lo);
    p.rect(5, 1, 3, 7, PAL.ink);
    p.rect(6, 2, 1, 5, '#e3b06c');
    p.px(6, 4, c.lo);
  },
  plank: (p, c) => {
    // 판자 두 장
    p.rect(0, 1, 8, 3, PAL.ink);
    p.rect(0, 4, 8, 3, PAL.ink);
    p.rect(1, 2, 6, 1, c.mid);
    p.rect(1, 5, 6, 1, c.mid);
    p.px(2, 2, c.hi);
    p.px(5, 5, c.lo);
  },
};

for (const item of ITEM_IDS) {
  define(`item:${item}`, 8, 8, 1, (p) => ITEM_PAINT[ITEMS[item].shape](p, ramp(item), item));
}

// ───────────────────────── 땅 (16×16) ─────────────────────────

export function hash(n: number): number {
  let h = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

function groundBase(p: Pen, v: number): void {
  p.rect(0, 0, 16, 16, PAL.ground[v % 4]);
  const h = hash(v * 7919 + 13);
  for (let k = 0; k < 5; k++) {
    const x = (h >>> (k * 6)) & 15;
    const y = (hash(h + k) >>> 3) & 15;
    p.px(x, y, k === 0 ? PAL.speckLight : PAL.speckDark);
  }
}

for (let v = 0; v < 8; v++) define(`ground:${v}`, 16, 16, 1, (p) => groundBase(p, v));

/** 광맥 칸: 바닥 위 돌덩이 (rich = 3 큰 돌, 2, 1). 돌 광맥은 회색 바위 */
function oreRock(p: Pen, x: number, y: number, c: { hi: string; mid: string; lo: string }, big: boolean): void {
  if (big) {
    p.rect(x + 1, y, 4, 1, PAL.ink);
    p.rect(x, y + 1, 6, 4, PAL.ink);
    p.rect(x + 1, y + 5, 5, 1, PAL.ink);
    p.rect(x + 1, y + 1, 4, 4, c.mid);
    p.rect(x + 2, y + 4, 3, 1, c.lo);
    p.rect(x + 4, y + 2, 1, 2, c.lo);
    p.px(x + 1, y + 1, c.hi);
    p.px(x + 2, y + 1, c.hi);
  } else {
    p.rect(x, y, 4, 3, PAL.ink);
    p.rect(x + 1, y + 1, 2, 1, c.mid);
    p.px(x + 1, y + 1, c.hi);
  }
}

/** 광맥 칸 바닥색 (광물마다 다른 흙). 멀리서 볼 때는 칸마다 이 색만 칠한다 */
export const ORE_GROUND: Partial<Record<ItemId, string>> = {
  'iron-ore': '#a9b3bb',
  'copper-ore': '#d6a27a',
  coal: '#8a847b',
  stone: '#cdc6b6',
};

const ORE_TILES: ItemId[] = ['iron-ore', 'copper-ore', 'coal', 'stone'];
for (const item of ORE_TILES) {
  for (let rich = 1; rich <= 3; rich++) {
    for (let v = 0; v < 4; v++) {
      define(`ore:${item}:${rich}:${v}`, 16, 16, 1, (p) => {
        // 광맥 바닥: 광물 색 흙 + 밝고 어두운 알갱이
        const base = ORE_GROUND[item]!;
        p.rect(0, 0, 16, 16, base);
        const h = hash(v * 31 + rich);
        for (let k = 0; k < 12; k++) p.px((h >>> k) & 15, (hash(h + k) >>> 2) & 15, k % 3 ? tone(base, -0.1) : tone(base, 0.2));
        const c = item === 'coal' ? { hi: '#77767f', mid: '#3c3b42', lo: '#232227' } : ramp(item);
        const spots: [number, number][] = [
          [2 + (v & 1), 2],
          [9, 7 + ((v >> 1) & 1)],
          [3, 10],
        ];
        spots.forEach(([x, y], k) => {
          if (k < rich) oreRock(p, x, y, c, true);
          else if (k === rich) oreRock(p, x + 1, y + 1, c, false);
        });
      });
    }
  }
}

/** 호수: 물결이 천천히 움직인다 (4프레임) */
for (let v = 0; v < 4; v++) {
  define(`water:${v}`, 16, 16, 4, (p, f) => {
    p.rect(0, 0, 16, 16, PAL.water.lo);
    const h = hash(v * 97 + 5);
    for (let k = 0; k < 3; k++) {
      const x = ((h >>> (k * 5)) & 7) + k * 3;
      const y = (((h >>> (k * 4 + 9)) & 3) * 4 + f) % 16;
      p.rect(x, y, 3, 1, PAL.water.mid);
      p.px(x + 1, y, PAL.water.hi);
    }
    p.px((h >>> 20) & 15, (h >>> 24) & 15, PAL.water.dark);
  });
}

// ───────────────────────── 나무 (16×16) ─────────────────────────

/** 나뭇잎 색 (지도·멀리서 볼 때도) */
export const TREE_LEAF = { hi: '#86c06a', mid: '#5f9a4e', lo: '#3f6f3c' };

/** 둥근 나뭇잎 덩어리: 잉크 테두리, 위·왼쪽 밝게, 아래 그늘 */
function canopy(p: Pen, cx: number, cy: number, r: number): void {
  p.disc(cx, cy, r + 1, PAL.ink);
  p.disc(cx, cy, r, TREE_LEAF.mid);
  p.disc(cx + 0.8, cy + 1.2, r - 1.2, TREE_LEAF.lo);
  p.disc(cx - 0.4, cy - 0.2, r - 1.6, TREE_LEAF.mid);
  p.disc(cx - r * 0.35, cy - r * 0.35, Math.max(1, r * 0.35), TREE_LEAF.hi);
}

/** tree:0 새싹 · tree:1 어린 나무 · tree:2 다 자란 나무 (2프레임: 바람에 윗부분이 한 픽셀 흔들림) */
define('tree:0', 16, 16, 1, (p) => {
  p.rect(5, 11, 6, 2, PAL.shadow);
  p.rect(7, 8, 1, 4, PAL.ink);
  p.rect(5, 6, 3, 2, PAL.ink);
  p.rect(8, 5, 3, 2, PAL.ink);
  p.px(6, 6, TREE_LEAF.hi);
  p.px(9, 5, TREE_LEAF.mid);
  p.px(9, 6, TREE_LEAF.lo);
});
define('tree:1', 16, 16, 1, (p) => {
  p.rect(4, 12, 9, 2, PAL.shadow);
  p.rect(7, 9, 2, 4, PAL.ink);
  p.rect(7, 9, 1, 3, PAL.wood.lo);
  canopy(p, 8, 7, 3.5);
});
define('tree:2', 16, 16, 2, (p, f) => {
  p.rect(2, 13, 13, 2, PAL.shadow);
  p.rect(6, 10, 4, 5, PAL.ink);
  p.rect(7, 10, 2, 4, PAL.wood.lo);
  p.px(7, 10, PAL.wood.mid);
  canopy(p, 8 + (f ? 0.5 : 0), 6.5, 5.6);
});

// ───────────────────────── 컨베이어 (16×16, 오른쪽 기준) ─────────────────────────

type BeltColors = typeof PAL.belt;

/** 오른쪽으로 가는 곧은 컨베이어. 8프레임 동안 화살표가 한 칸(8픽셀)씩 흐른다 */
function straightBelt(p: Pen, c: BeltColors, f: number): void {
  p.rect(0, 1, 16, 1, PAL.shadow);
  p.rect(0, 2, 16, 1, c.rail);
  p.rect(0, 13, 16, 1, c.rail);
  p.rect(0, 3, 16, 10, c.surf);
  p.rect(0, 3, 16, 1, c.hi);
  p.rect(0, 14, 16, 1, PAL.shadow);
  // 가로 이음매 (흐름이 보이게)
  for (let k = 0; k < 2; k++) {
    const x = (k * 8 + f) % 16;
    p.rect(x, 4, 1, 8, tone(c.surf, -0.12));
  }
  for (let k = -1; k < 2; k++) {
    const ax = k * 8 + f + 3;
    for (let i = 0; i < 3; i++) {
      if (ax + i < 0 || ax + i > 15) continue;
      p.px(ax + i, 5 + i, c.chev);
      p.px(ax + i, 10 - i, c.chev);
    }
  }
}

/** 아래에서 들어와 오른쪽으로 나가는 굽은 컨베이어 (오른쪽 기준, 아래 = 오른쪽으로 돌면 들어오는 쪽) */
function curveBelt(p: Pen, c: BeltColors, f: number): void {
  // 바닥 판: 아래쪽 세로 반 + 오른쪽 가로 반
  p.rect(3, 3, 13, 10, c.surf);
  p.rect(3, 3, 10, 13, c.surf);
  p.rect(3, 3, 13, 1, c.hi);
  p.rect(2, 2, 14, 1, c.rail);
  p.rect(2, 2, 1, 14, c.rail);
  p.rect(13, 13, 3, 1, c.rail);
  p.rect(13, 13, 1, 3, c.rail);
  p.rect(14, 14, 2, 1, PAL.shadow);
  // 들어오는 쪽(아래)은 위로, 나가는 쪽(오른쪽)은 오른쪽으로 흐르는 화살표
  const up = (16 - ((f * 2) % 16)) % 16;
  for (let i = 0; i < 2; i++) {
    const y = 9 + ((up + i * 8) % 8);
    if (y < 15) {
      p.px(7, y, c.chev);
      p.px(6, y + 1, c.chev);
      p.px(8, y + 1, c.chev);
    }
  }
  const ax = 9 + (f % 6);
  p.px(ax, 6, c.chev);
  p.px(ax + 1, 7, c.chev);
  p.px(ax, 8, c.chev);
}

define('belt', 16, 16, 8, (p, f) => straightBelt(p, PAL.belt, f));
define('fast-belt', 16, 16, 8, (p, f) => straightBelt(p, PAL.fast, f));
define('belt-curve', 16, 16, 8, (p, f) => curveBelt(p, PAL.belt, f));
define('fast-belt-curve', 16, 16, 8, (p, f) => curveBelt(p, PAL.fast, f));

/** 지하 컨베이어 (오른쪽 기준): in = 왼쪽 반은 컨베이어, 오른쪽 반은 굴로 들어감. out = 반대 */
function underground(p: Pen, inMode: boolean, f: number, broken: boolean): void {
  const c = PAL.belt;
  const beltX = inMode ? 0 : 8;
  p.rect(beltX, 2, 8, 1, c.rail);
  p.rect(beltX, 13, 8, 1, c.rail);
  p.rect(beltX, 3, 8, 10, c.surf);
  p.rect(beltX, 3, 8, 1, c.hi);
  const ax = beltX + ((f % 8) - 1);
  for (let i = 0; i < 3; i++) {
    if (ax + i >= beltX && ax + i < beltX + 8) {
      p.px(ax + i, 5 + i, c.chev);
      p.px(ax + i, 10 - i, c.chev);
    }
  }
  // 굴 입구: 놋쇠 테두리의 어두운 구멍
  const hx = inMode ? 7 : 1;
  const frame = broken ? { hi: '#f09a8c', mid: PAL.red, lo: '#8f2f28' } : PAL.brass;
  p.box(hx, 1, 8, 14, frame);
  p.rect(hx + 2, 3, 4, 10, '#20150c');
  p.rect(hx + 2, 3, 4, 1, '#3a2a1c');
}

for (const mode of ['in', 'out'] as const) {
  define(`underground-${mode}`, 16, 16, 8, (p, f) => underground(p, mode === 'in', f, false));
  define(`underground-${mode}-alone`, 16, 16, 8, (p, f) => underground(p, mode === 'in', f, true));
}

// ───────────────────────── 도로 (16×16, 이웃 4방향 비트로 16가지) ─────────────────────────

/** mask: 1 = 위, 2 = 오른쪽, 4 = 아래, 8 = 왼쪽으로 이어짐 */
for (let mask = 0; mask < 16; mask++) {
  define(`road:${mask}`, 16, 16, 1, (p) => {
    const c = PAL.road;
    p.rect(0, 0, 16, 16, c.surf);
    // 자갈 무늬
    const h = hash(mask * 131 + 7);
    for (let k = 0; k < 6; k++) p.px((h >>> (k * 5)) & 15, (hash(h + k) >>> 4) & 15, k % 2 ? c.hi : tone(c.surf, -0.1));
    // 이어지지 않은 쪽은 연석
    if (!(mask & 1)) p.rect(0, 0, 16, 2, c.curb);
    if (!(mask & 2)) p.rect(14, 0, 2, 16, c.curb);
    if (!(mask & 4)) p.rect(0, 14, 16, 2, c.curb);
    if (!(mask & 8)) p.rect(0, 0, 2, 16, c.curb);
    // 가운데 점선: 이어진 쪽으로
    const dash = (x: number, y: number, w: number, hh: number) => p.rect(x, y, w, hh, c.line);
    if (mask & 1) dash(7, 1, 2, 3);
    if (mask & 4) dash(7, 12, 2, 3);
    if (mask & 8) dash(1, 7, 3, 2);
    if (mask & 2) dash(12, 7, 3, 2);
    if (mask) dash(7, 7, 2, 2);
  });
}

// ───────────────────────── 화살표·표시 ─────────────────────────

/**
 * 출구(노랑)·입구(흰색) 화살표, 위를 가리킨다. 그릴 때 돌린다.
 * 2칸 이상 건물은 8×5, 1칸짜리는 작은 6×4 (-s)
 */
const ARROW_BIG = ['...##...', '..#oo#..', '.#oooo#.', '#oooooo#', '########'];
const ARROW_SMALL = ['..##..', '.#oo#.', '#oooo#', '######'];
for (const [name, color] of [
  ['arrow-out', PAL.out],
  ['arrow-in', PAL.in],
  ['arrow-out-dim', '#b69a45'],
] as const) {
  for (const [suffix, rows] of [
    ['', ARROW_BIG],
    ['-s', ARROW_SMALL],
  ] as const) {
    define(name + suffix, rows[0].length, rows.length, 1, (p) =>
      rows.forEach((row, y) => [...row].forEach((ch, x) => ch !== '.' && p.px(x, y, ch === '#' ? PAL.ink : color))),
    );
  }
}

/** 상태 표시 (9×9 동그라미 + 그림) */
const BADGES: Record<string, { bg: string; glyph: (p: Pen) => void }> = {
  power: { bg: '#f2c94c', glyph: (p) => bolt(p) },
  nofuel: { bg: PAL.red, glyph: (p) => bolt(p) },
  wait: { bg: '#f6eed8', glyph: (p) => [2, 4, 6].forEach((x) => p.px(x, 5, PAL.ink)) },
  full: { bg: PAL.orange, glyph: (p) => p.rect(3, 3, 3, 3, PAL.ink) },
  what: {
    bg: PAL.red,
    glyph: (p) => {
      p.rect(3, 2, 3, 1, PAL.ink);
      p.px(5, 3, PAL.ink);
      p.px(4, 4, PAL.ink);
      p.px(4, 6, PAL.ink);
    },
  },
  empty: {
    bg: '#9a3b3b',
    glyph: (p) => {
      p.line(2, 2, 6, 6, '#f6eed8');
      p.line(6, 2, 2, 6, '#f6eed8');
    },
  },
  nowater: {
    bg: PAL.red,
    glyph: (p) => {
      p.px(4, 2, '#fff');
      p.rect(3, 3, 3, 3, '#fff');
    },
  },
  low: { bg: '#f2c94c', glyph: (p) => bang(p) },
  alert: { bg: PAL.red, glyph: (p) => bang(p) },
  'alert-full': { bg: PAL.orange, glyph: (p) => bang(p) },
};
function bolt(p: Pen): void {
  p.line(5, 2, 3, 5, PAL.ink);
  p.line(3, 5, 6, 4, PAL.ink);
  p.line(6, 4, 4, 7, PAL.ink);
}
function bang(p: Pen): void {
  p.rect(4, 2, 1, 3, PAL.ink);
  p.px(4, 6, PAL.ink);
}
for (const [name, b] of Object.entries(BADGES)) {
  define(`badge:${name}`, 9, 9, 1, (p) => {
    p.disc(4.5, 4.5, 4.5, PAL.ink);
    p.disc(4.5, 4.5, 3.6, b.bg);
    b.glyph(p);
  });
}

// ───────────────────────── 숫자 ─────────────────────────

/** 3×5 숫자 글꼴. num:<글자>는 크림색 + 잉크 테두리 5×7, num2:<글자>는 두 배 굵기 8×12 */
const GLYPHS: Record<string, string> = {
  '0': '111101101101111',
  '1': '010110010010111',
  '2': '111001111100111',
  '3': '111001111001111',
  '4': '101101111001001',
  '5': '111100111001111',
  '6': '111100111101111',
  '7': '111001010010010',
  '8': '111101111101111',
  '9': '111101111001111',
  '?': '111001011000010',
};
/** 숫자를 이어 쓸 때 한 글자 너비 (테두리가 한 줄 겹친다) */
export const NUM_ADVANCE = { num: 4, num2: 7 };

function glyphSprite(name: string, bits: string, k: number, fill: string): void {
  const w = 3 * k + 2;
  const h = 5 * k + 2;
  define(name, w, h, 1, (p) => {
    const on = (x: number, y: number) =>
      x >= 1 && y >= 1 && x < w - 1 && y < h - 1 && bits[Math.floor((y - 1) / k) * 3 + Math.floor((x - 1) / k)] === '1';
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (on(x, y)) p.px(x, y, fill);
        else if ([-1, 0, 1].some((dy) => [-1, 0, 1].some((dx) => on(x + dx, y + dy)))) p.px(x, y, PAL.ink);
      }
    }
  });
}
for (const [ch, bits] of Object.entries(GLYPHS)) {
  const fill = ch === '?' ? PAL.red : '#fbf3df';
  glyphSprite(`num:${ch}`, bits, 1, fill);
  glyphSprite(`num2:${ch}`, bits, 2, fill);
}
