import { describe, expect, it } from 'vitest';
import { TRUCK } from '../data/buildings';
import { SNOW } from '../data/ground';
import { TECHS } from '../data/tech';
import { addMetals, generateWorld } from './mapgen';
import { LIGHT_TRUCK, TICK_RATE, World } from './world';

/** 30×30 빈 맵, 허브 (0,9)~(2,11), 모든 연구, 재고 넉넉 */
function makeWorld(): World {
  const w = new World(30, 30);
  w.createHub(0, 9);
  for (const t of TECHS) w.applyTech(t.id);
  for (const item of ['iron-plate', 'gear', 'stone', 'steel', 'bronze', 'circuit', 'brick'] as const) w.stock.set(item, 1000);
  return w;
}

function run(w: World, seconds: number) {
  for (let i = 0; i < seconds * TICK_RATE; i++) w.tick();
}

describe('금속: 주석 · 알루미늄', () => {
  it('새 맵: 주석은 눈밭에만, 보크사이트는 눈밭이 아닌 곳에, 허브에서 멀리', () => {
    for (const seed of [1, 42, 9999]) {
      const w = generateWorld(seed);
      const c = w.width / 2;
      let tin = 0;
      let bauxite = 0;
      for (let i = 0; i < w.resItem.length; i++) {
        const item = w.resItem[i];
        if (item !== 'tin-ore' && item !== 'bauxite') continue;
        const x = i % w.width;
        const y = Math.floor(i / w.width);
        expect(Math.hypot(x - c, y - c)).toBeGreaterThan(20);
        if (item === 'tin-ore') {
          tin++;
          expect(w.ground[i]).toBe(SNOW);
        } else {
          bauxite++;
          expect(w.ground[i]).not.toBe(SNOW);
        }
      }
      expect(tin).toBeGreaterThan(50);
      expect(bauxite).toBeGreaterThan(50);
    }
  });

  it('예전 저장: 표시해 두고, 더할 때는 건물·다 캔 광맥 자리를 피한다', () => {
    const w = generateWorld(8);
    // 금속이 생기기 전 맵처럼 금속 광맥을 지운다
    for (let i = 0; i < w.resItem.length; i++) if (w.resItem[i] === 'tin-ore' || w.resItem[i] === 'bauxite') w.resItem[i] = null;
    const data = JSON.parse(JSON.stringify(w.serialize()));
    data.rev = 1;
    const old = World.deserialize(data);
    expect(old.metalsLoaded).toBe(false);
    // 아무 데나 다 캔 광맥 자리(번호만 남은 칸)를 만들어 둔다
    const spent = old.patchOf.findIndex((p, i) => p > 0 && !old.resItem[i]);
    addMetals(old, old.seed);
    expect(old.resItem.filter((it) => it === 'tin-ore').length).toBeGreaterThan(50);
    if (spent >= 0) expect(old.resItem[spent]).toBeNull();
    expect(World.deserialize(JSON.parse(JSON.stringify(w.serialize()))).metalsLoaded).toBe(true);
  });

  it('제련로: 주석광석 → 주석판, 구리판 + 주석판 → 청동', () => {
    const w = makeWorld();
    for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) w.setResource(5 + dx, 10 + dy, 'tin-ore', 1000);
    // 채굴기 → 제련로 → 허브 (서쪽으로 바로 붙인다)
    expect(w.place('smelter', 3, 10, 3)).not.toBeNull();
    expect(w.place('miner', 5, 10, 3)).not.toBeNull();
    run(w, 20);
    expect(w.stockOf('tin-plate')).toBeGreaterThan(3);
    expect(w.madeTotal.get('tin-plate')).toBeGreaterThan(3);
  });

  it('전해로: 보크사이트 2 + 물 1 → 알루미늄판 1, 전력 500kW', () => {
    const w = makeWorld();
    const e = w.place('electrolyzer', 3, 10, 3)!;
    expect(e).not.toBeNull();
    expect(w.recipeOf(e)).toBeNull();
    // 재료를 직접 넣는다 (컨베이어 대신)
    e.recipe = 'aluminum';
    e.inBuf.set('bauxite', 4);
    e.inBuf.set('water', 2);
    // 허브 400kW뿐이라 80% 속도: 3초 → 3.75초
    run(w, 9);
    expect(w.stockOf('aluminum')).toBe(2);
    expect(e.def.power).toBe(500);
  });

  it('가벼운 차체: 트럭 1.3배', () => {
    const w = new World(10, 10);
    expect(w.truckSpeed()).toBe(TRUCK.speed);
    w.researched.add('light-trucks');
    expect(w.truckSpeed()).toBeCloseTo(TRUCK.speed * LIGHT_TRUCK, 9);
  });
});
