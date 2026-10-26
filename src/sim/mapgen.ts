import { DESERT, GRASS, GROUNDS, SNOW } from '../data/ground';
import type { ItemId, ItemStack } from '../data/items';
import { createRng } from './rng';
import { World } from './world';

export const MAP_SIZE = 128;

export const STARTING_STOCK: ItemStack[] = [
  { item: 'iron-plate', count: 120 },
  { item: 'gear', count: 40 },
  { item: 'stone', count: 40 },
];

/** 새 게임 맵. 허브는 가운데, 시작 광맥 4종은 허브 주변에 고정 배치. */
export function generateWorld(seed: number, size = MAP_SIZE): World {
  const w = new World(size, size);
  w.seed = seed;
  const rng = createRng(seed);
  const c = Math.floor(size / 2);
  addGround(w, seed);

  // 시작 광맥: 허브 주변 네 방향에 하나씩 (순서는 시드로 섞는다)
  const starters: [ItemId, number, number, number][] = [
    ['iron-ore', 9, 4.2, 700],
    ['copper-ore', 10, 3.6, 600],
    ['coal', 10, 3.2, 600],
    ['stone', 9, 3, Infinity],
  ];
  shuffle(starters, rng);
  const baseAngle = rng() * Math.PI * 2;
  starters.forEach(([item, dist, radius, amount], i) => {
    const a = baseAngle + (i * Math.PI) / 2 + (rng() - 0.5) * 0.5;
    blob(w, c + Math.cos(a) * dist, c + Math.sin(a) * dist, radius, item, amount, rng);
  });

  // 먼 광맥: 멀수록 크고 풍부하다.
  // 예전(28개, 칸당 800 + 거리×40)엔 시작 광맥의 40배가 넘어 바닥날 일이 없었다 → 개수·양을 줄였다.
  // 비는 자리는 나중에 석유 같은 새 자원을 놓을 곳.
  // 종류는 비율대로 고르게 나눠서 섞는다 (무작위로 뽑으면 한 종류가 몰리는 맵이 생긴다)
  const farTypes: ItemId[] = ['iron-ore', 'iron-ore', 'copper-ore', 'copper-ore', 'coal', 'stone'];
  const far = Array.from({ length: 20 }, (_, k) => farTypes[k % farTypes.length]);
  shuffle(far, rng);
  for (const item of far) {
    const a = rng() * Math.PI * 2;
    const dist = 22 + rng() * (size / 2 - 28);
    const radius = 3 + rng() * 3 + dist / 25;
    const amount = item === 'stone' ? Infinity : 300 + dist * 8;
    blob(w, c + Math.cos(a) * dist, c + Math.sin(a) * dist, radius, item, amount, rng);
  }

  addLakes(w, seed);
  w.createHub(c - 1, c - 1);
  addForests(w, seed);
  for (const s of STARTING_STOCK) w.stock.set(s.item, s.count);
  return w;
}

/**
 * 자연 숲(다 자란 나무 군락)을 만든다. 하나는 허브에서 조금 떨어진 곳(첫 통나무·묘목), 나머지는 멀리.
 * 광맥·물·건물이 있는 칸은 건너뛴다 (숲이 생기기 전 저장에 더할 때도 쓴다. 랜덤은 칸 모양에만 써서 어디든 같은 숲).
 */
export function addForests(w: World, seed: number): void {
  const rng = createRng((seed ^ 0x7a3e91) >>> 0);
  const c = Math.floor(w.width / 2);
  const groves: [number, number][] = [[12 + rng() * 4, 2.8]];
  for (let k = 0; k < 6; k++) groves.push([24 + rng() * (w.width / 2 - 32), 3 + rng() * 2.5]);
  for (const [dist, r] of groves) {
    const a = rng() * Math.PI * 2;
    const cx = c + Math.cos(a) * dist;
    const cy = c + Math.sin(a) * dist;
    const R = Math.ceil(r + 1);
    for (let dy = -R; dy <= R; dy++) {
      for (let dx = -R; dx <= R; dx++) {
        const x = Math.round(cx + dx);
        const y = Math.round(cy + dy);
        const d = Math.hypot(dx, dy);
        if (d > r) continue;
        // 가장자리로 갈수록 듬성듬성
        if (rng() > 0.95 - (d / r) * 0.45) continue;
        if (!w.inBounds(x, y) || !w.canPlant(w.idx(x, y))) continue;
        w.setTree(x, y, 1);
      }
    }
  }
}

/**
 * 호수(물 칸)를 만든다. 하나는 허브에서 조금 떨어진 곳, 나머지는 멀리.
 * 광맥이나 건물이 있는 칸은 건너뛴다 (예전 저장에 호수를 더할 때도 쓴다).
 */
export function addLakes(w: World, seed: number): void {
  const rng = createRng((seed ^ 0x51ed27) >>> 0);
  const c = Math.floor(w.width / 2);
  const lakes: [number, number][] = [[18 + rng() * 4, 3 + rng()]];
  for (let k = 0; k < 6; k++) lakes.push([26 + rng() * (w.width / 2 - 32), 3 + rng() * 2.5]);
  for (const [dist, r] of lakes) {
    const a = rng() * Math.PI * 2;
    const cx = c + Math.cos(a) * dist;
    const cy = c + Math.sin(a) * dist;
    const R = Math.ceil(r + 1);
    for (let dy = -R; dy <= R; dy++) {
      for (let dx = -R; dx <= R; dx++) {
        const x = Math.round(cx + dx);
        const y = Math.round(cy + dy);
        if (!w.inBounds(x, y)) continue;
        if (Math.hypot(dx, dy) > r * (0.85 + rng() * 0.3)) continue;
        const i = w.idx(x, y);
        // 사막에는 호수가 없다
        if (w.resItem[i] || w.occ[i] || w.ground[i] === DESERT) continue;
        w.setResource(x, y, 'water', Infinity);
      }
    }
  }
}

/** 허브에서 이만큼(칸)은 늘 초원, 그 뒤 HUB_BLEND칸에 걸쳐 서서히 다른 땅이 나온다 */
const HUB_GRASS = 20;
const HUB_BLEND = 14;

/**
 * 땅 종류(초원·사막·눈밭)를 정한다. 부드러운 잡음으로 "기온"을 만들어 높으면 사막, 낮으면 눈밭.
 * 기온이 이어져 있어서 사막과 눈밭 사이에는 늘 초원이 끼고, 허브 둘레는 가운데 기온(초원)으로 누른다.
 * 비율은 기온 순위로 끊어서 맵마다 GROUNDS의 share대로 나온다.
 * 예전 저장에 땅을 더할 때도 쓴다 (씨앗만으로 정해서 어디서든 같은 땅).
 */
export function addGround(w: World, seed: number): void {
  const rng = createRng((seed ^ 0x3c6ef372) >>> 0);
  // 큰 덩어리 + 작은 굴곡
  const layers = [
    { cell: 24, amp: 1 },
    { cell: 9, amp: 0.3 },
  ].map((l) => {
    const cols = Math.ceil(w.width / l.cell) + 2;
    const rows = Math.ceil(w.height / l.cell) + 2;
    return { ...l, cols, v: Array.from({ length: cols * rows }, () => rng()) };
  });
  const ease = (t: number) => t * t * (3 - 2 * t);
  const c = Math.floor(w.width / 2);
  const n = w.width * w.height;
  const temp = new Float64Array(n);
  for (let y = 0; y < w.height; y++) {
    for (let x = 0; x < w.width; x++) {
      let t = 0;
      let sum = 0;
      for (const l of layers) {
        const fx = x / l.cell;
        const fy = y / l.cell;
        const ix = Math.floor(fx);
        const iy = Math.floor(fy);
        const sx = ease(fx - ix);
        const sy = ease(fy - iy);
        const at = (a: number, b: number) => l.v[(iy + b) * l.cols + ix + a];
        const top = at(0, 0) + (at(1, 0) - at(0, 0)) * sx;
        const bottom = at(0, 1) + (at(1, 1) - at(0, 1)) * sx;
        t += (top + (bottom - top) * sy) * l.amp;
        sum += l.amp;
      }
      t /= sum;
      // 경계가 자로 그은 듯 매끈하지 않게 칸마다 조금 흔든다
      t += (rng() - 0.5) * 0.02;
      const d = Math.hypot(x - c, y - c);
      const k = ease(Math.min(1, Math.max(0, (d - HUB_GRASS) / HUB_BLEND)));
      temp[y * w.width + x] = 0.5 + (t - 0.5) * k;
    }
  }
  const sorted = Float64Array.from(temp).sort();
  const cold = sorted[Math.floor(n * GROUNDS[SNOW].share)];
  const hot = sorted[Math.floor(n * (1 - GROUNDS[DESERT].share))];
  for (let i = 0; i < n; i++) {
    const x = i % w.width;
    const y = Math.floor(i / w.width);
    const t = temp[i];
    w.ground[i] = Math.hypot(x - c, y - c) <= HUB_GRASS ? GRASS : t < cold ? SNOW : t >= hot ? DESERT : GRASS;
  }
}

function blob(
  w: World,
  cx: number,
  cy: number,
  r: number,
  item: ItemId,
  amount: number,
  rng: () => number,
): void {
  const R = Math.ceil(r + 1);
  for (let dy = -R; dy <= R; dy++) {
    for (let dx = -R; dx <= R; dx++) {
      const x = Math.round(cx + dx);
      const y = Math.round(cy + dy);
      if (!w.inBounds(x, y)) continue;
      const d = Math.hypot(dx, dy);
      if (d > r * (0.8 + rng() * 0.35)) continue;
      if (w.resItem[w.idx(x, y)]) continue;
      const rich = 1 - (d / (r + 1)) * 0.6;
      const a = amount === Infinity ? Infinity : Math.round(amount * rich * (0.8 + rng() * 0.4));
      w.setResource(x, y, item, a);
    }
  }
}

function shuffle<T>(arr: T[], rng: () => number): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}
