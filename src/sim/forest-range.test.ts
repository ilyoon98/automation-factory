import { describe, expect, it } from 'vitest';
import { BUILDINGS } from '../data/buildings';
import { ITEM_IDS } from '../data/items';
import { TICK_RATE, World } from './world';

function setup() {
  const w = new World(36, 36);
  w.createHub(0, 0);
  w.applyTech('forestry');
  for (const item of ITEM_IDS) w.stock.set(item, 1000);
  return w;
}

function run(w: World, seconds: number) {
  for (let i = 0; i < Math.round(seconds * TICK_RATE); i++) w.tick();
}

describe('벌목기 12×12 작업 범위', () => {
  it.each([
    [10, 10, 9, 10], [21, 10, 22, 10], [10, 21, 10, 22], [21, 21, 22, 21],
  ])('경계 (%i,%i)는 2초에 베고 밖 (%i,%i)는 남긴다', (x, y, ox, oy) => {
    const w = setup();
    const cutter = w.place('lumberjack', 15, 15, 0)!;
    w.setTree(x, y, 1);
    w.setTree(ox, oy, 1);
    run(w, 1.9);
    expect(cutter.outBuf.get('log') ?? 0).toBe(0);
    expect(w.workPower(cutter)).toBe(50);
    run(w, 0.2);
    expect(cutter.outBuf.get('log')).toBe(2);
    expect(cutter.outBuf.get('sapling')).toBe(1);
    expect(w.tree[w.idx(x, y)]).toBe(0);
    expect(w.tree[w.idx(ox, oy)]).toBe(1);
    expect(w.craftTime(cutter)).toBe(2);
    expect(BUILDINGS.lumberjack.size).toBe(2);
  });

  it('식목기는 8×8을 유지하고 붙여 놓은 벌목기 한 대가 유효 식재 칸을 모두 덮는다', () => {
    const w = setup();
    const planter = w.place('planter', 15, 15, 0)!;
    const cutter = w.place('lumberjack', 17, 15, 1)!;
    expect(planter.mineTiles).toHaveLength(60);
    expect(planter.mineTiles).toContain(w.idx(12, 12));
    expect(planter.mineTiles).toContain(w.idx(19, 19));
    expect(planter.mineTiles).not.toContain(w.idx(11, 12));
    expect(planter.mineTiles).not.toContain(w.idx(20, 19));
    const planting = planter.mineTiles.filter(i => w.canPlant(i));
    expect(planting).toHaveLength(56);
    expect(planting.every(i => cutter.mineTiles.includes(i))).toBe(true);
    expect(cutter.mineTiles).toHaveLength(140);
    for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
      expect(cutter.mineTiles).not.toContain(w.idx(cutter.x + dx, cutter.y + dy));
    }
    expect(w.craftTime(planter)).toBe(1);
    expect(w.workPower(planter)).toBe(30);
  });

  it('지도 가장자리에서는 범위를 잘라 유효한 칸만 다룬다', () => {
    const w = setup();
    const cutter = w.place('lumberjack', 34, 34, 0)!;
    expect(cutter.mineTiles).toHaveLength(45);
    expect(cutter.mineTiles.every(i => i >= 0 && i < w.width * w.height)).toBe(true);
    expect(cutter.mineTiles).toContain(w.idx(29, 29));
    expect(cutter.mineTiles).not.toContain(w.idx(28, 29));
  });

  it('기존 저장과 네트워크 스냅샷을 열면 범위를 재계산하고 제작·재고를 보존한다', () => {
    const w = setup();
    const cutter = w.place('lumberjack', 15, 15, 0)!;
    const planter = w.place('planter', 23, 15, 0)!;
    // 이전 버전에서 계산해 둔 8×8 작업 목록. 목록 자체는 저장 데이터에 들어가지 않는다.
    cutter.mineTiles = w.forestTiles({ type: 'planter', x: 15, y: 15, size: 2 });
    cutter.crafting = true;
    cutter.progress = 0.5;
    cutter.outBuf.set('sapling', 1);
    planter.inBuf.set('sapling', 3);
    w.setTree(14, 14, 1);
    w.setTree(10, 10, 1);
    const save = JSON.parse(JSON.stringify(w.serialize()));
    for (const loaded of [World.deserialize(save), World.fromSnapshot(w.snapshot())]) {
      const restored = loaded.buildings.get(cutter.id)!;
      expect(restored.mineTiles).toHaveLength(140);
      expect(restored.mineTiles).toContain(loaded.idx(10, 10));
      expect(restored.crafting).toBe(true);
      expect(restored.progress).toBe(0.5);
      expect(restored.outBuf.get('sapling')).toBe(1);
      expect(loaded.buildings.get(planter.id)!.mineTiles).toHaveLength(60);
      expect(loaded.buildings.get(planter.id)!.inBuf.get('sapling')).toBe(3);
      expect(loaded.stock).toEqual(w.stock);
      run(loaded, 1.6);
      expect(restored.outBuf.get('log')).toBe(2);
      expect(loaded.tree[loaded.idx(10, 10)]).toBe(0);
    }
  });
});
