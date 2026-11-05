import type { ItemId } from '../data/items';
import { STARTING_STOCK } from './mapgen';
import { grove, lake, patch } from './regional-map';
import { createRng } from './rng';
import { World } from './world';

/**
 * 산지 협동 모드 지도 (docs/멀티-산지협동-상세기획.md §2).
 *
 * 256×256 고정. 가운데 광장(공동 허브·호수·숲, 누구나 짓는다)과 둘레를 여덟 조각으로 나눈 산지.
 * 산지 하나의 땅에서는 자원 하나만 나온다: 철·석탄·구리·돌이 번갈아 돌아서 같은 자원은 지도 반대편에 있고
 * 이웃 산지는 늘 다른 자원이다. 인원수와 상관없이 같은 지도이고, 누가 어느 산지를 갖는지만 바뀐다.
 */
export const TERRITORY_SIZE = 256;
/** 광장 반경 (칸) */
export const PLAZA_RADIUS = 30;
export const TERRITORY_COUNT = 8;
/** 둘레 순서. 네 칸 건너면 같은 자원 (반대편) */
const ORDER: ItemId[] = ['iron-ore', 'coal', 'copper-ore', 'stone'];
/** 광맥 하나의 매장량 (돌은 끝이 없다) */
const PATCH_TOTAL = 24000;

/** owner = 처음 모든 산지를 가질 플레이어 (혼자·방장 = 0). 나누기는 같이 하기에서 따로 한다 */
export function generateTerritoryWorld(seed: number, owner = 0): World {
  const w = new World(TERRITORY_SIZE, TERRITORY_SIZE);
  w.seed = seed;
  w.rules = 'regional-v1';
  const rng = createRng((seed ^ 0x51ab7e03) >>> 0);
  const c = TERRITORY_SIZE / 2;
  // 산지 경계를 씨앗마다 돌린다 (모양은 같고 방향만 다르다)
  const turn = rng() * Math.PI * 2;
  const n = w.width * w.height;
  w.terrain = new Uint8Array(n);
  w.territory = new Uint8Array(n);
  for (let y = 0; y < w.height; y++) {
    for (let x = 0; x < w.width; x++) {
      const dx = x + 0.5 - c, dy = y + 0.5 - c;
      if (Math.hypot(dx, dy) <= PLAZA_RADIUS) continue;
      const a = (((Math.atan2(dy, dx) - turn) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
      w.territory[w.idx(x, y)] = 1 + Math.min(TERRITORY_COUNT - 1, Math.floor((a / (Math.PI * 2)) * TERRITORY_COUNT));
    }
  }
  w.territories = Array.from({ length: TERRITORY_COUNT }, (_, k) => ({ id: k + 1, item: ORDER[k % ORDER.length], owner }));

  // 광장: 허브, 담수, 나무 (누구나 쓰는 것만 둔다. 광맥은 없다)
  w.createHub(c - 1, c - 1);
  const inPlaza = (x: number, y: number) => w.inBounds(x, y) && w.territory![w.idx(x, y)] === 0 && !w.occ[w.idx(x, y)] && !w.resItem[w.idx(x, y)];
  const side = rng() * Math.PI * 2;
  lake(w, c + Math.cos(side) * 18, c + Math.sin(side) * 18, 4, rng, (x, y) => inPlaza(x, y) && Math.hypot(x - c, y - c) < PLAZA_RADIUS - 3);
  grove(w, c - Math.cos(side) * 19, c - Math.sin(side) * 19, 6, rng, (x, y) => inPlaza(x, y) && Math.hypot(x - c, y - c) < PLAZA_RADIUS - 2);

  // 산지마다 그 자원 광맥 넷: 가운데 줄을 따라 가까운 곳부터, 마지막 둘은 옆으로 벌려서
  for (const t of w.territories) {
    const mid = turn + ((t.id - 0.5) / TERRITORY_COUNT) * Math.PI * 2;
    const own = (x: number, y: number) => w.inBounds(x, y) && w.territory![w.idx(x, y)] === t.id && !w.resItem[w.idx(x, y)];
    const total = t.item === 'stone' ? Infinity : PATCH_TOTAL;
    for (const [r, spread] of [[46, 0], [70, 0], [94, -0.17], [94, 0.17]] as const) {
      const a = mid + spread;
      patch(w, c + Math.cos(a) * r, c + Math.sin(a) * r, 4.2, t.item, total, rng, own);
    }
  }

  for (const s of STARTING_STOCK) w.stock.set(s.item, s.count);
  w.sites = { A: [c, c] };
  return w;
}
