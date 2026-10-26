import { describe, expect, it } from 'vitest';
import { SOLAR_POWER, WIND_POWER, FOREST } from '../data/buildings';
import { DESERT, GRASS, GROUNDS, SNOW } from '../data/ground';
import { TECHS } from '../data/tech';
import { addGround, generateWorld } from './mapgen';
import { TICK_RATE, World } from './world';

/** 30×30 빈 맵, 모든 연구, 재고 넉넉. 땅은 처음엔 모두 초원 */
function makeWorld(): World {
  const w = new World(30, 30);
  w.createHub(0, 9);
  for (const t of TECHS) w.applyTech(t.id);
  for (const item of ['iron-plate', 'gear', 'stone', 'wood', 'brick', 'circuit'] as const) w.stock.set(item, 1000);
  return w;
}

/** (x, y)부터 size×size를 땅 kind로 */
function paint(w: World, x: number, y: number, size: number, kind: number) {
  for (let dy = 0; dy < size; dy++) for (let dx = 0; dx < size; dx++) w.ground[w.idx(x + dx, y + dy)] = kind;
}

describe('땅 종류', () => {
  it('새 맵: 초원 50 · 사막 25 · 눈밭 25%, 허브 둘레는 초원, 사막과 눈밭은 맞닿지 않는다', () => {
    for (const seed of [1, 42, 9999]) {
      const w = generateWorld(seed);
      const count = [0, 0, 0];
      for (const g of w.ground) count[g]++;
      const n = w.ground.length;
      expect(count[DESERT] / n).toBeCloseTo(0.25, 1);
      expect(count[SNOW] / n).toBeCloseTo(0.25, 1);
      const c = w.width / 2;
      for (let y = 0; y < w.height; y++)
        for (let x = 0; x < w.width; x++) if (Math.hypot(x - c, y - c) <= 18) expect(w.ground[w.idx(x, y)]).toBe(GRASS);
      // 사막 바로 옆(가로)에 눈밭은 거의 없다 (칸마다 조금 흔들어서 아주 가끔은 있을 수 있다)
      let touch = 0;
      for (let y = 0; y < w.height; y++)
        for (let x = 0; x + 1 < w.width; x++) {
          const a = w.ground[w.idx(x, y)];
          const b = w.ground[w.idx(x + 1, y)];
          if ((a === DESERT && b === SNOW) || (a === SNOW && b === DESERT)) touch++;
        }
      expect(touch).toBeLessThan(5);
    }
  });

  it('씨앗이 같으면 같은 땅 (예전 저장에 더할 때도 같다)', () => {
    const a = generateWorld(77);
    const b = new World(a.width, a.height);
    addGround(b, 77);
    expect(b.ground).toEqual(a.ground);
  });

  it('사막에는 호수·자연 숲이 없다', () => {
    const w = generateWorld(5);
    for (let i = 0; i < w.ground.length; i++) {
      if (w.ground[i] !== DESERT) continue;
      expect(w.resItem[i]).not.toBe('water');
      expect(w.tree[i]).toBe(0);
    }
  });

  it('땅 종류는 저장에 남는다. 없던 저장은 표시해 둔다', () => {
    const w = generateWorld(3);
    const data = JSON.parse(JSON.stringify(w.serialize()));
    expect(data.ground.length).toBeLessThan(w.ground.length);
    const copy = World.deserialize(data);
    expect(copy.ground).toEqual(w.ground);
    expect(copy.groundLoaded).toBe(true);
    delete data.ground;
    expect(World.deserialize(data).groundLoaded).toBe(false);
  });

  it('사막 태양광 1.5배, 눈밭 태양광 0.75배 · 풍력 1.3배', () => {
    const w = makeWorld();
    paint(w, 10, 10, 4, DESERT);
    paint(w, 20, 10, 4, SNOW);
    const grassSolar = w.place('solar', 10, 20, 0)!;
    const desertSolar = w.place('solar', 10, 10, 0)!;
    const snowSolar = w.place('solar', 20, 10, 0)!;
    const grassWind = w.place('wind', 14, 20, 0)!;
    const snowWind = w.place('wind', 22, 12, 0)!;
    // 맑은 첫 아침
    w.time = 0;
    w.tick();
    expect(grassSolar.load).toBe(SOLAR_POWER);
    expect(desertSolar.load).toBeCloseTo(SOLAR_POWER * 1.5, 6);
    expect(snowSolar.load).toBeCloseTo(SOLAR_POWER * 0.75, 6);
    expect(grassWind.load).toBe(WIND_POWER.clear);
    expect(snowWind.load).toBeCloseTo(WIND_POWER.clear * 1.3, 6);
  });

  it('사막에는 나무를 심을 수 없고, 눈밭에서는 2배 느리게 자란다', () => {
    const w = makeWorld();
    paint(w, 10, 10, 2, DESERT);
    paint(w, 20, 20, 2, SNOW);
    expect(w.canPlant(w.idx(10, 10))).toBe(false);
    expect(w.canPlant(w.idx(20, 20))).toBe(true);
    w.setTree(20, 20, 0.001);
    w.setTree(5, 20, 0.001);
    for (let i = 0; i < (FOREST.grow / 2) * TICK_RATE; i++) w.tick();
    // 연구를 다 해서 "숲 가꾸기"만큼 더 빠르다
    const grown = 0.5 * w.treeGrowth();
    expect(w.tree[w.idx(5, 20)]).toBeCloseTo(0.001 + grown, 2);
    expect(w.tree[w.idx(20, 20)]).toBeCloseTo(0.001 + grown / 2, 2);
    expect(GROUNDS[SNOW].treeGrow).toBe(0.5);
  });
});
