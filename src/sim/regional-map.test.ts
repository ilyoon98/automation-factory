import { describe, expect, it } from 'vitest';
import { TERRAIN, TERRAIN_IDS } from '../data/terrain';
import type { ItemId } from '../data/items';
import { REGIONAL_SIZE, generateRegionalWorld, pathExists } from './regional-map';
import { World } from './world';

/**
 * 확장 지도 생성 보장 (docs/지형-운송-전력-상세기획.md §1~3): 여러 씨앗에서 필수 자원·담수·분출구·길·지형 비율
 */
const SEEDS = [1, 2, 3, 42, 777, 2026, 31337, 123456];

/** 자원별 광맥(이어진 칸 묶음)의 합계 매장량들 */
function deposits(w: World, item: ItemId): number[] {
  const seen = new Uint8Array(w.width * w.height);
  const out: number[] = [];
  for (let i = 0; i < seen.length; i++) {
    if (seen[i] || w.resItem[i] !== item) continue;
    let sum = 0;
    const q = [i];
    seen[i] = 1;
    while (q.length) {
      const j = q.pop()!;
      sum += w.resAmount[j];
      const x = j % w.width;
      const y = Math.floor(j / w.width);
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        if (!w.inBounds(x + dx, y + dy)) continue;
        const k = w.idx(x + dx, y + dy);
        if (!seen[k] && w.resItem[k] === item) {
          seen[k] = 1;
          q.push(k);
        }
      }
    }
    out.push(sum);
  }
  return out;
}

describe('확장 지도 생성', () => {
  for (const seed of SEEDS) {
    it(`씨앗 ${seed}: 필수 자원·담수·분출구·길·지형`, () => {
      const w = generateRegionalWorld(seed);
      expect(w.width).toBe(REGIONAL_SIZE);
      expect(w.rules).toBe('regional-v1');
      const hub = w.hub!;
      const hx = hub.x + 1;
      const hy = hub.y + 1;
      // 허브 둘레 18칸은 초원
      for (let y = hy - 17; y <= hy + 17; y += 3) for (let x = hx - 17; x <= hx + 17; x += 3) if (Math.hypot(x - hx, y - hy) <= 17) expect(w.terrainAt(w.idx(x, y))).toBe('grass');
      // 자원지 수와 매장량
      const need: [ItemId, number, number][] = [
        ['iron-ore', 3, 8000],
        ['copper-ore', 3, 8000],
        ['coal', 3, 6000],
        ['tin-ore', 2, 12000],
        ['bauxite', 2, 18000],
        ['sulfur', 2, 3000],
      ];
      for (const [item, n, min] of need) {
        const d = deposits(w, item).filter((a) => a >= min * 0.98);
        expect(d.length, `${item} ${deposits(w, item)}`).toBeGreaterThanOrEqual(n);
      }
      // 원유·염수: 지점 합계 18,000 × 2곳
      for (const item of ['crude-oil', 'brine'] as ItemId[]) {
        let sum = 0;
        for (let i = 0; i < w.resItem.length; i++) if (w.resItem[i] === item) sum += w.resAmount[i];
        expect(sum, item).toBeGreaterThanOrEqual(36000 * 0.98);
      }
      expect(deposits(w, 'sap').length).toBeGreaterThanOrEqual(2);
      expect(deposits(w, 'stone').length).toBeGreaterThanOrEqual(2);
      expect(deposits(w, 'sand').length).toBeGreaterThanOrEqual(2);
      expect(deposits(w, 'water').length).toBeGreaterThanOrEqual(6);
      expect(w.vents.length).toBeGreaterThanOrEqual(5);
      for (const v of w.vents) expect(w.terrainAt(v)).toBe('volcano');
      // 첫 특화 자원: 허브에서 40~90칸 (황·염수 60~120), 물에 막히지 않는 길
      const nearest = (item: ItemId) => {
        let best = Infinity;
        let at: [number, number] = [0, 0];
        for (let i = 0; i < w.resItem.length; i++) {
          if (w.resItem[i] !== item) continue;
          const x = i % w.width;
          const y = Math.floor(i / w.width);
          const d = Math.abs(x - hx) + Math.abs(y - hy);
          if (d < best) [best, at] = [d, [x, y]];
        }
        return { d: best, at };
      };
      for (const [item, lo, hi] of [
        ['tin-ore', 40, 95],
        ['sap', 40, 95],
        ['crude-oil', 40, 95],
        ['bauxite', 40, 95],
        ['sulfur', 55, 125],
        ['brine', 55, 125],
      ] as [ItemId, number, number][]) {
        const { d, at } = nearest(item);
        expect(d, item).toBeGreaterThanOrEqual(lo);
        expect(d, item).toBeLessThanOrEqual(hi);
        expect(pathExists(w, [hx, hy], at), `${item} 길`).toBe(true);
      }
      // 지형 넓이 비율 (초원·숲 ±6%p, 나머지 ±4%p: 거점 둘레를 강제로 칠한 만큼 여유)
      const count = new Array(TERRAIN_IDS.length).fill(0);
      for (const t of w.terrain!) count[t]++;
      TERRAIN_IDS.forEach((t, k) => {
        const share = count[k] / w.terrain!.length;
        const tol = t === 'grass' || t === 'forest' ? 0.06 : 0.04;
        expect(Math.abs(share - TERRAIN[t].share), `${t} ${share.toFixed(3)}`).toBeLessThanOrEqual(tol);
      });
      // 시작 재고
      expect([w.stockOf('iron-plate'), w.stockOf('gear'), w.stockOf('stone')]).toEqual([120, 40, 40]);
    });
  }

  it('같은 씨앗이면 같은 지도, 저장 후에도 지형·분출구 그대로', () => {
    const a = generateRegionalWorld(99);
    const b = generateRegionalWorld(99);
    expect(b.checksum()).toBe(a.checksum());
    expect([...b.terrain!]).toEqual([...a.terrain!]);
    const c = World.deserialize(JSON.parse(JSON.stringify(a.serialize())));
    expect([...c.terrain!]).toEqual([...a.terrain!]);
    expect(c.vents).toEqual(a.vents);
    expect(c.checksum()).toBe(a.checksum());
  });
});
