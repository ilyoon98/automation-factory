import { describe, expect, it } from 'vitest';
import { BUILDINGS } from '../data/buildings';
import { ITEM_IDS } from '../data/items';
import { RECIPES } from '../data/recipes';
import { TICK_RATE, World } from './world';

function setup() {
  const w = new World(40, 40); w.rules = 'regional-v1'; w.createHub(0, 0);
  for (const tech of w.techs) if (tech.id !== 'lithium-storage' && tech.id !== 'advanced-vehicle' && tech.id !== 'integrated-automation') w.applyTech(tech.id);
  for (const item of ITEM_IDS) w.stock.set(item, 1000);
  return w;
}
function run(w: World, seconds: number) { for (let i = 0; i < seconds * TICK_RATE; i++) w.tick(); }

describe('후반 전력 회로와 배터리 생산', () => {
  it('리튬 연구에서 열리고 회로→전력 회로→배터리를 실제 재료로 제작한다', () => {
    const w = setup(), a = w.place('assembler', 6, 6, 0)!, b = w.place('assembler', 9, 6, 0)!;
    expect(w.setRecipe(a, 'power-circuit')).toBe(false);
    w.applyTech('lithium-storage');
    expect(w.setRecipe(a, 'power-circuit')).toBe(true);
    expect(w.setRecipe(b, 'battery-pack')).toBe(true);
    a.inBuf.set('circuit', 1); a.inBuf.set('tin-plate', 2); a.inBuf.set('plastic', 1);
    b.inBuf.set('lithium', 2); b.inBuf.set('copper-plate', 2);
    run(w, 6.1);
    expect(a.outBuf.get('power-circuit')).toBe(1);
    expect(b.outBuf.get('battery-pack') ?? 0).toBe(0);
    a.outBuf.clear(); b.inBuf.set('power-circuit', 1);
    run(w, 6.1);
    expect(b.outBuf.get('battery-pack')).toBe(1);
    expect([...a.inBuf.values()].every(n => n === 0)).toBe(true);
    expect(RECIPES.circuit.inputs).toEqual([{ item: 'iron-plate', count: 1 }, { item: 'copper-wire', count: 3 }]);
  });

  it.each([false, true])('옛 배터리 제작중=%s의 재료·완제품을 보존하고 새 연구 레시피를 복원한다', crafting => {
    const w = setup(); w.applyTech('lithium-storage');
    const a = w.place('assembler', 6, 6, 0)!; w.setRecipe(a, 'battery-pack');
    a.crafting = crafting; a.progress = crafting ? 2 : 0;
    a.inBuf.set('circuit', 3); a.outBuf.set('battery-pack', 1);
    const save = w.serialize(); save.rev = 3;
    const loaded = World.deserialize(save), b = loaded.buildings.get(a.id)!;
    expect(loaded.unlockedRecipes.has('power-circuit')).toBe(true);
    expect(b.crafting).toBe(false); expect(b.progress).toBe(0);
    expect(b.inBuf.get('circuit')).toBe(crafting ? 4 : 3);
    expect(b.inBuf.get('lithium') ?? 0).toBe(crafting ? 2 : 0);
    expect(b.inBuf.get('copper-plate') ?? 0).toBe(crafting ? 2 : 0);
    expect(b.inBuf.get('plastic') ?? 0).toBe(crafting ? 1 : 0);
    expect(b.inBuf.get('power-circuit') ?? 0).toBe(0);
    expect(b.outBuf.get('battery-pack')).toBe(1);
    expect(World.deserialize(loaded.serialize()).buildings.get(a.id)!.inBuf).toEqual(b.inBuf);
    expect(World.fromSnapshot(loaded.snapshot()).buildings.get(a.id)!.inBuf).toEqual(b.inBuf);
  });

  it('새 배치의 저장·스냅샷은 같은 재료 소비와 생산 결과를 낸다', () => {
    const w = setup(); w.applyTech('lithium-storage');
    const a = w.place('assembler', 6, 6, 0)!; w.setRecipe(a, 'battery-pack');
    for (const input of RECIPES['battery-pack'].inputs) a.inBuf.set(input.item, input.count);
    run(w, 2);
    for (const copy of [World.deserialize(w.serialize()), World.fromSnapshot(w.snapshot())]) {
      expect(copy.buildings.get(a.id)!.progress).toBe(a.progress);
      expect(copy.buildings.get(a.id)!.inBuf).toEqual(a.inBuf);
      run(copy, 4.1);
      expect(copy.buildings.get(a.id)!.outBuf.get('battery-pack')).toBe(1);
    }
  });

  it('취소된 옛 배터리 작업의 모듈 분리 예약을 한 번만 처리한다', () => {
    const w = setup(); w.applyTech('lithium-storage');
    const a = w.place('assembler', 6, 6, 0)!; w.setRecipe(a, 'battery-pack');
    a.crafting = true; a.module = { from: 0 }; a.modBatch = true; a.detach = true;
    const save = w.serialize(); save.rev = 3;
    save.piles = [[4, ITEM_IDS.indexOf('coal'), 5, 30, 'remove']];
    const loaded = World.deserialize(save), b = loaded.buildings.get(a.id)!;
    expect(b.module).toBeNull(); expect(b.detach).toBe(false);
    expect(loaded.piles.filter(p => p.item === 'module')).toEqual([{ tile: loaded.idx(6, 6), item: 'module', n: 1, ev: 31, why: 'module' }]);
    expect(World.deserialize(loaded.serialize()).piles).toEqual(loaded.piles);
  });

  it('축전기는 전력 회로를 실제로 소비하며 철거 시 같은 재료를 반환한다', () => {
    const w = setup(); w.applyTech('lithium-storage');
    const before = w.stockOf('power-circuit');
    const a = w.place('accumulator', 6, 6, 0)!;
    expect(w.stockOf('power-circuit')).toBe(before - 2);
    w.remove(a); expect(w.stockOf('power-circuit')).toBe(before);
    expect(BUILDINGS.accumulator.cost).toEqual([{ item: 'battery-pack', count: 4 }, { item: 'steel', count: 4 }, { item: 'power-circuit', count: 2 }]);
  });

  it('옛 축전기는 충전량과 옛 철거 재료를 저장·스냅샷·철거 취소까지 보존한다', () => {
    const w = setup(); w.applyTech('lithium-storage');
    const a = w.place('accumulator', 6, 6, 0)!; a.energy = 1234;
    const save = w.serialize(); save.rev = 3;
    const loaded = World.deserialize(save);
    for (const copy of [loaded, World.deserialize(loaded.serialize()), World.fromSnapshot(loaded.snapshot())]) {
      const b = copy.buildings.get(a.id)!;
      expect(b.energy).toBe(1234); expect(b.legacyAccumulator).toBe(true);
      const tinCircuits = copy.stockOf('power-circuit'), controllers = copy.stockOf('controller');
      copy.edit(() => copy.remove(b));
      expect(copy.stockOf('power-circuit')).toBe(tinCircuits);
      expect(copy.stockOf('controller')).toBe(controllers + 1);
      expect(copy.undo()?.skipped).toBe(0);
      const restored = copy.buildingAt(6, 6)!;
      expect(restored.legacyAccumulator).toBe(true);
      expect(copy.stockOf('power-circuit')).toBe(tinCircuits);
      expect(copy.stockOf('controller')).toBe(controllers);
      copy.redo(); expect(copy.stockOf('power-circuit')).toBe(tinCircuits);
      expect(copy.stockOf('controller')).toBe(controllers + 1);
    }
  });
});
