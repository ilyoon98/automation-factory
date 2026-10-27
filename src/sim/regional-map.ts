import type { ItemId } from '../data/items';
import { TERRAIN, TERRAIN_IDS, type TerrainKind } from '../data/terrain';
import { STARTING_STOCK } from './mapgen';
import { createRng } from './rng';
import { World } from './world';

/**
 * 지역 생산망 확장(regional-v1) 새 지도 (docs/지형-운송-전력-상세기획.md §1~3).
 *
 * 256×256, 지형 7종. 기획의 기준 배치(A 시작 공장 ~ H 조립 부지)를 씨앗에 따라 돌리거나 뒤집은
 * "보장 배치 틀"을 바로 쓴다: 필수 자원지·부지·담수·고무 군락·분출구가 늘 같은 거리 관계로 나온다.
 * 지형 경계와 추가 자원·호수·숲은 씨앗으로 흔든다. 같은 씨앗이면 같은 지도.
 */
export const REGIONAL_SIZE = 256;
const C = 128;

/** 기준 배치 (돌리기 전 좌표). 허브 A에서 도로 거리: B 64 · C 50 · D 48 · E 80 · F 86 · G 94 */
export const SITES = {
  A: [128, 128],
  B: [98, 94],
  C: [92, 142],
  D: [174, 126],
  E: [168, 88],
  F: [152, 190],
  G: [188, 162],
  H: [160, 152],
} as const;
export type SiteId = keyof typeof SITES;

/** 처음 보이는 허브 둘레 반경 (첫 추가 광맥 25~36칸까지) */
export const START_REVEAL = 40;

/** 지형 씨앗 [x, y, 지형]. 첫 줄은 기준 배치 거점, 나머지는 두 번째 자원지와 넓이 맞추기용 */
const SEEDS: [number, number, TerrainKind][] = [
  [128, 128, 'grass'],
  [160, 152, 'grass'],
  [98, 94, 'snow'],
  [92, 142, 'forest'],
  [174, 126, 'sand'],
  [168, 88, 'rock'],
  [152, 190, 'volcano'],
  [188, 162, 'salt'],
  [130, 36, 'grass'],
  [28, 160, 'grass'],
  [222, 56, 'grass'],
  [96, 236, 'grass'],
  [58, 206, 'forest'],
  [36, 90, 'forest'],
  [150, 236, 'forest'],
  [56, 40, 'snow'],
  [100, 24, 'snow'],
  [208, 26, 'rock'],
  [234, 104, 'rock'],
  [226, 136, 'sand'],
  [200, 232, 'sand'],
  [232, 206, 'salt'],
  [104, 222, 'volcano'],
];

/** SEEDS 중 두 번째 자원지 자리 (둘레를 그 지형으로 칠한다) */
const SECOND_SEEDS = [12, 15, 17, 19, 21, 22];

/** 두 번째 자원지 (돌리기 전 좌표) */
const SECOND = {
  tin: [56, 40],
  bauxite: [208, 26],
  oil: [226, 136],
  brine: [232, 206],
  sulfur: [104, 222],
  rubber: [58, 206],
} as const;

type P = readonly [number, number];

export function generateRegionalWorld(seed: number): World {
  const w = new World(REGIONAL_SIZE, REGIONAL_SIZE);
  w.seed = seed;
  w.rules = 'regional-v1';
  const rng = createRng((seed ^ 0x2f6a1c3d) >>> 0);
  // 돌리기·뒤집기 8가지 중 하나 (거리 관계는 그대로)
  const sym = Math.floor(rng() * 8);
  const T = ([x, y]: P): [number, number] => {
    let dx = x - C;
    let dy = y - C;
    if (sym >= 4) dx = -dx;
    for (let k = 0; k < sym % 4; k++) [dx, dy] = [-dy, dx];
    return [C + dx, C + dy];
  };
  const reserved = new Uint8Array(w.width * w.height);
  const terrain = makeTerrain(w, SEEDS.map(([x, y, t]) => [...T([x, y]), t] as [number, number, TerrainKind]), seed);
  w.terrain = terrain;

  const site = (s: SiteId) => T(SITES[s]);
  const hub = site('A');
  const free = (x: number, y: number) => w.inBounds(x, y) && !w.resItem[w.idx(x, y)] && !w.occ[w.idx(x, y)];
  const open = (x: number, y: number) => free(x, y) && !reserved[w.idx(x, y)];

  // 1. 허브와 시작 자원 (허브 둘레 반경 18칸은 초원)
  w.createHub(hub[0] - 1, hub[1] - 1);
  const starters: [ItemId, number][] = [
    ['iron-ore', 8000],
    ['copper-ore', 8000],
    ['coal', 6000],
    ['stone', Infinity],
  ];
  shuffle(starters, rng);
  const base = rng() * Math.PI * 2;
  starters.forEach(([item, total], k) => {
    const a = base + (k * Math.PI) / 2;
    patch(w, hub[0] + Math.cos(a) * 11, hub[1] + Math.sin(a) * 11, 3.6, item, total, rng, open);
  });
  const lakeA = base + Math.PI / 4;
  lake(w, hub[0] + Math.cos(lakeA) * 16, hub[1] + Math.sin(lakeA) * 16, 3.6, rng, open);
  const groveA = base + (Math.PI * 5) / 4;
  grove(w, hub[0] + Math.cos(groveA) * 16, hub[1] + Math.sin(groveA) * 16, 5, rng, open);
  // 허브 구역 반경 25~36칸의 첫 추가 광맥
  (['iron-ore', 'copper-ore', 'coal'] as ItemId[]).forEach((item, k) => {
    const a = base + Math.PI / 4 + (k * Math.PI * 2) / 3 + 0.4;
    patch(w, hub[0] + Math.cos(a) * 30, hub[1] + Math.sin(a) * 30, 4, item, item === 'coal' ? 18000 : 24000, rng, open);
  });

  // 2. 지역 거점: 24×24 부지를 먼저 비워 두고 (허브 쪽), 자원지를 거점에 놓는다
  for (const s of ['B', 'C', 'D', 'E', 'F', 'G', 'H'] as SiteId[]) {
    const [x, y] = site(s);
    const d = Math.hypot(hub[0] - x, hub[1] - y) || 1;
    const cx = s === 'H' ? x : Math.round(x + ((hub[0] - x) / d) * 19);
    const cy = s === 'H' ? y : Math.round(y + ((hub[1] - y) / d) * 19);
    for (let j = -12; j < 12; j++) for (let i = -12; i < 12; i++) if (w.inBounds(cx + i, cy + j)) reserved[w.idx(cx + i, cy + j)] = 1;
  }
  const at = (s: SiteId, ox = 0, oy = 0): [number, number] => {
    const [x, y] = site(s);
    return [x + ox, y + oy];
  };
  const [bx, by] = site('B');
  patch(w, bx, by, 4, 'tin-ore', 12000, rng, free);
  const [cx, cy] = site('C');
  rubberGrove(w, cx, cy, rng, free);
  const [dx, dy] = site('D');
  points(w, dx, dy, 'crude-oil', 18000, free);
  patch(w, ...away(at('D'), hub, -10), 3, 'sand', Infinity, rng, free);
  const [ex, ey] = site('E');
  patch(w, ex, ey, 4.4, 'bauxite', 18000, rng, free);
  const [fx, fy] = site('F');
  patch(w, fx, fy, 2.6, 'sulfur', 3000, rng, free);
  vents(w, fx, fy, 3, free);
  const [gx, gy] = site('G');
  points(w, gx, gy, 'brine', 18000, free);
  // 보크사이트·원유·염수 옆 담수 (벨트 24칸 안), 숲에도 수력용 호수
  for (const s of ['D', 'E', 'G', 'C'] as SiteId[]) lake(w, ...side(at(s), hub, 9), 3.2, rng, free);
  // 바위사막의 석탄·돌 (석탄 세 번째 광맥, 돌 두 번째)
  patch(w, ...side(at('E'), hub, -11), 3.6, 'coal', 18000, rng, free);
  patch(w, ...away(at('E'), hub, -12), 3, 'stone', Infinity, rng, free);

  // 3. 두 번째 자원지
  patch(w, ...T(SECOND.tin), 4, 'tin-ore', 12000, rng, free);
  patch(w, ...T(SECOND.bauxite), 4.4, 'bauxite', 18000, rng, free);
  points(w, ...T(SECOND.oil), 'crude-oil', 18000, free);
  points(w, ...T(SECOND.brine), 'brine', 18000, free);
  const s2 = T(SECOND.sulfur);
  patch(w, ...s2, 2.6, 'sulfur', 3000, rng, free);
  vents(w, s2[0], s2[1], 2, free);
  rubberGrove(w, ...T(SECOND.rubber), rng, free);
  patch(w, ...T([200, 232]), 3, 'sand', Infinity, rng, free);
  patch(w, ...T([234, 104]), 4, 'iron-ore', 24000, rng, free);
  patch(w, ...T([36, 90]), 4, 'copper-ore', 24000, rng, free);

  // 4. 그 밖의 호수·숲 (부지는 비운다)
  for (const p of [T([30, 128]), T([128, 230]), T([210, 90])]) lake(w, p[0], p[1], 3 + rng() * 1.5, rng, open);
  let groves = 0;
  for (let tries = 0; groves < 6 && tries < 400; tries++) {
    const x = Math.floor(rng() * w.width);
    const y = Math.floor(rng() * w.height);
    if (TERRAIN_IDS[terrain[w.idx(x, y)]] !== 'forest' || !open(x, y)) continue;
    if (grove(w, x, y, 4.5, rng, open) >= 40) groves++;
  }

  // 5. 허브에서 모든 자원지까지 물에 막히지 않는 길
  for (const s of ['B', 'C', 'D', 'E', 'F', 'G', 'H'] as SiteId[]) carve(w, hub, site(s));
  for (const s of Object.values(SECOND)) carve(w, hub, T(s));

  // 확인한 땅: 처음엔 허브 둘레만 (시작 광맥·첫 추가 광맥·호수·숲까지). 목표를 이루면 거점이 열린다
  for (const s of Object.keys(SITES) as SiteId[]) w.sites[s] = site(s);
  for (const [k, p] of Object.entries(SECOND)) w.sites[`${k}2`] = T(p);
  w.revealed = new Uint8Array(w.width * w.height);
  w.reveal(hub[0], hub[1], START_REVEAL);
  for (const s of STARTING_STOCK) w.stock.set(s.item, s.count);
  return w;
}

/** (x, y)에서 from 반대쪽으로 d칸 (d가 음수면 from 쪽) */
function away([x, y]: [number, number], from: [number, number], d: number): [number, number] {
  const l = Math.hypot(x - from[0], y - from[1]) || 1;
  return [x + ((x - from[0]) / l) * d, y + ((y - from[1]) / l) * d];
}

/** (x, y)에서 from 방향의 옆(직각)으로 d칸 */
function side([x, y]: [number, number], from: [number, number], d: number): [number, number] {
  const l = Math.hypot(x - from[0], y - from[1]) || 1;
  return [x - ((y - from[1]) / l) * d, y + ((x - from[0]) / l) * d];
}

/**
 * 지형: 씨앗까지의 거리(지형별 배율로 나눔) + 부드러운 잡음이 가장 작은 지형.
 * 배율은 목표 넓이 비율에 맞도록 몇 번 고쳐 가며 정한다. 마지막에 거점 둘레(허브 18칸·각 거점 12칸)를 그 지형으로
 */
function makeTerrain(w: World, seeds: [number, number, TerrainKind][], seed: number): Uint8Array {
  const n = w.width * w.height;
  const out = new Uint8Array(n);
  const noise = (x: number, y: number) => valueNoise(seed, x / 22, y / 22) * 14 + valueNoise(seed + 7, x / 7, y / 7) * 4;
  const scale = new Map<TerrainKind, number>(TERRAIN_IDS.map((t) => [t, 1]));
  const kindOf = (x: number, y: number) => {
    let best = 0;
    let bd = Infinity;
    const nz = noise(x, y);
    for (const [sx, sy, t] of seeds) {
      const d = Math.hypot(x - sx, y - sy) / scale.get(t)! + nz * (t === 'grass' ? 0.5 : 1);
      if (d < bd) [bd, best] = [d, TERRAIN_IDS.indexOf(t)];
    }
    return best;
  };
  for (let it = 0; it < 14; it++) {
    const count = new Array(TERRAIN_IDS.length).fill(0);
    for (let y = 0; y < w.height; y += 4) for (let x = 0; x < w.width; x += 4) count[kindOf(x, y)]++;
    const total = count.reduce((a, b) => a + b, 0);
    TERRAIN_IDS.forEach((t, k) => {
      const share = count[k] / total || 0.01;
      scale.set(t, scale.get(t)! * Math.min(1.25, Math.max(0.8, Math.sqrt(TERRAIN[t].share / share))));
    });
  }
  for (let y = 0; y < w.height; y++) for (let x = 0; x < w.width; x++) out[y * w.width + x] = kindOf(x, y);
  // 거점 둘레는 그 지형으로 (시작 18칸, 지역 거점 12칸, 두 번째 자원지 10칸)
  seeds.forEach(([sx, sy, t], k) => {
    const r = k === 0 ? 18 : k < 8 ? 12 : SECOND_SEEDS.includes(k) ? 10 : 0;
    if (!r) return;
    for (let y = Math.floor(sy - r); y <= sy + r; y++) {
      for (let x = Math.floor(sx - r); x <= sx + r; x++) {
        if (w.inBounds(x, y) && Math.hypot(x - sx, y - sy) <= r) out[y * w.width + x] = TERRAIN_IDS.indexOf(t);
      }
    }
  });
  return out;
}

/** 격자 값 잡음 (-0.5 ~ 0.5, 부드럽게 이음) */
function valueNoise(seed: number, x: number, y: number): number {
  const h = (i: number, j: number) => {
    let v = (seed ^ Math.imul(i, 0x27d4eb2d) ^ Math.imul(j, 0x165667b1)) >>> 0;
    v = Math.imul(v ^ (v >>> 15), 0x85ebca6b) >>> 0;
    return ((v ^ (v >>> 13)) >>> 0) / 4294967296 - 0.5;
  };
  const i = Math.floor(x);
  const j = Math.floor(y);
  const fx = x - i;
  const fy = y - j;
  const s = (t: number) => t * t * (3 - 2 * t);
  const a = h(i, j) + (h(i + 1, j) - h(i, j)) * s(fx);
  const b = h(i, j + 1) + (h(i + 1, j + 1) - h(i, j + 1)) * s(fx);
  return a + (b - a) * s(fy);
}

/** 광맥 하나: 둥근 칸들에 total을 나눠 담는다 (가운데가 진하게). 무한(Infinity)이면 칸마다 무한 */
function patch(w: World, cx: number, cy: number, r: number, item: ItemId, total: number, rng: () => number, ok: (x: number, y: number) => boolean): number {
  const tiles: [number, number, number][] = [];
  const R = Math.ceil(r + 1);
  for (let dy = -R; dy <= R; dy++) {
    for (let dx = -R; dx <= R; dx++) {
      const x = Math.round(cx + dx);
      const y = Math.round(cy + dy);
      const d = Math.hypot(dx, dy);
      if (d > r * (0.8 + rng() * 0.35) || !ok(x, y)) continue;
      tiles.push([x, y, 1 - (d / (r + 1)) * 0.6]);
    }
  }
  // 가운데와 이어진 칸만 (가장자리에서 떨어져 나간 칸이 따로 작은 광맥이 되지 않게)
  const key = (x: number, y: number) => `${x},${y}`;
  const chosen = new Map(tiles.map((t) => [key(t[0], t[1]), t]));
  const start = tiles.reduce((a, t) => (Math.hypot(t[0] - cx, t[1] - cy) < Math.hypot(a[0] - cx, a[1] - cy) ? t : a), tiles[0]);
  const keep = new Set<string>();
  const queue = start ? [start] : [];
  if (start) keep.add(key(start[0], start[1]));
  while (queue.length) {
    const [x, y] = queue.pop()!;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const k = key(x + dx, y + dy);
      const t = chosen.get(k);
      if (t && !keep.has(k)) {
        keep.add(k);
        queue.push(t);
      }
    }
  }
  tiles.splice(0, tiles.length, ...tiles.filter((t) => keep.has(key(t[0], t[1]))));
  const sum = tiles.reduce((s, t) => s + t[2], 0);
  let left = total;
  tiles.forEach(([x, y, rich], k) => {
    const a = total === Infinity ? Infinity : k === tiles.length - 1 ? left : Math.round((total * rich) / sum);
    left -= a;
    w.setResource(x, y, item, a);
  });
  return tiles.length;
}

/** 원유·염수 지점 3곳 (지점마다 시추기 한 대, 둘레 2×2를 지을 수 있게 4칸씩 떨어뜨림) */
function points(w: World, cx: number, cy: number, item: ItemId, total: number, ok: (x: number, y: number) => boolean): void {
  const offs = [
    [0, 0],
    [5, 1],
    [1, 5],
  ];
  for (const [ox, oy] of offs) {
    const x = Math.round(cx + ox);
    const y = Math.round(cy + oy);
    // 시추기 몸체 (-1,-1)~(0,0)가 빈 땅이어야 한다
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) if (w.inBounds(x + i, y + j) && w.resItem[w.idx(x + i, y + j)] === 'water') w.setResource(x + i, y + j, null, 0);
    if (ok(x, y) || w.resItem[w.idx(x, y)] === null) w.setResource(x, y, item, Math.round(total / offs.length));
  }
}

/** 지열 분출구 n곳 (3×3 발전소가 겹치지 않게 5칸씩) */
function vents(w: World, cx: number, cy: number, n: number, ok: (x: number, y: number) => boolean): void {
  const offs = [
    [5, -4],
    [8, 1],
    [4, 5],
  ];
  for (const [ox, oy] of offs.slice(0, n)) {
    const x = Math.round(cx + ox);
    const y = Math.round(cy + oy);
    if (!w.inBounds(x - 1, y - 1) || !w.inBounds(x + 1, y + 1)) continue;
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) if (!ok(x + i, y + j)) w.setResource(x + i, y + j, null, 0);
    w.vents.push(w.idx(x, y));
  }
}

/** 고무나무 군락 (수액 칸, 무한·재생). 둘레에 수액 채취기 4대를 놓을 자리를 비워 둔다 */
function rubberGrove(w: World, cx: number, cy: number, rng: () => number, ok: (x: number, y: number) => boolean): void {
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      const x = Math.round(cx + dx);
      const y = Math.round(cy + dy);
      if (Math.abs(dx) === 2 && Math.abs(dy) === 2 && rng() < 0.7) continue;
      if (ok(x, y)) w.setResource(x, y, 'sap', Infinity);
    }
  }
  // 둘레 3칸은 비운다 (채취기 자리)
  for (let dy = -5; dy <= 5; dy++) {
    for (let dx = -5; dx <= 5; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) <= 2) continue;
      const x = Math.round(cx + dx);
      const y = Math.round(cy + dy);
      if (w.inBounds(x, y) && w.resItem[w.idx(x, y)] !== 'sap') w.setResource(x, y, null, 0);
    }
  }
}

function lake(w: World, cx: number, cy: number, r: number, rng: () => number, ok: (x: number, y: number) => boolean): void {
  const R = Math.ceil(r + 1);
  for (let dy = -R; dy <= R; dy++) {
    for (let dx = -R; dx <= R; dx++) {
      const x = Math.round(cx + dx);
      const y = Math.round(cy + dy);
      if (Math.hypot(dx, dy) > r * (0.9 + rng() * 0.25) || !ok(x, y)) continue;
      w.setResource(x, y, 'water', Infinity);
    }
  }
}

/** 일반 나무 군락. 심은 그루 수 */
function grove(w: World, cx: number, cy: number, r: number, rng: () => number, ok: (x: number, y: number) => boolean): number {
  let n = 0;
  const R = Math.ceil(r + 1);
  for (let dy = -R; dy <= R; dy++) {
    for (let dx = -R; dx <= R; dx++) {
      const x = Math.round(cx + dx);
      const y = Math.round(cy + dy);
      const d = Math.hypot(dx, dy);
      if (d > r || rng() > 0.97 - (d / r) * 0.3 || !ok(x, y) || !w.canPlant(w.idx(x, y))) continue;
      w.setTree(x, y, 1);
      n++;
    }
  }
  return n;
}

/** from에서 to까지 물을 피해 갈 수 없으면, 가로·세로 한 줄로 물을 걷어 길을 낸다 */
function carve(w: World, from: [number, number], to: [number, number]): void {
  if (pathExists(w, from, to)) return;
  const [x0, y0] = from.map(Math.round);
  const [x1, y1] = to.map(Math.round);
  const clear = (x: number, y: number) => {
    for (const [i, j] of [
      [0, 0],
      [1, 0],
      [0, 1],
    ]) {
      if (w.inBounds(x + i, y + j) && w.resItem[w.idx(x + i, y + j)] === 'water') w.setResource(x + i, y + j, null, 0);
    }
  };
  for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) clear(x, y0);
  for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) clear(x1, y);
}

/** 물이 아닌 칸만 밟고 from에서 to(둘레 2칸 안)까지 갈 수 있는지 */
export function pathExists(w: World, from: [number, number], to: [number, number]): boolean {
  const seen = new Uint8Array(w.width * w.height);
  const start = w.idx(Math.round(from[0]) + 2, Math.round(from[1]) + 2);
  const queue = [start];
  seen[start] = 1;
  const tx = Math.round(to[0]);
  const ty = Math.round(to[1]);
  for (let q = 0; q < queue.length; q++) {
    const i = queue[q];
    const x = i % w.width;
    const y = Math.floor(i / w.width);
    if (Math.abs(x - tx) <= 2 && Math.abs(y - ty) <= 2) return true;
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const nx = x + dx;
      const ny = y + dy;
      if (!w.inBounds(nx, ny)) continue;
      const j = w.idx(nx, ny);
      if (seen[j] || w.resItem[j] === 'water') continue;
      seen[j] = 1;
      queue.push(j);
    }
  }
  return false;
}

function shuffle<T>(arr: T[], rng: () => number): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}
