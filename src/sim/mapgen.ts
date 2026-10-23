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
        if (w.resItem[i] || w.occ[i]) continue;
        w.setResource(x, y, 'water', Infinity);
      }
    }
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
