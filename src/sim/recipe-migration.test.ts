import { describe, expect, it } from 'vitest';
import { ITEM_IDS, type ItemId } from '../data/items';
import { RECIPES } from '../data/recipes';
import { TICK_RATE, World } from './world';

function oldSave(recipe: 'wash' | 'concrete' | 'acid-wash', rev: number, crafting = true) {
  const w = new World(40, 30);
  w.createHub(0, 0);
  for (const tech of w.techs) w.applyTech(tech.id);
  for (const item of ITEM_IDS) w.stock.set(item, 1000);
  w.unlockedRecipes.add(recipe);
  const b = w.place(RECIPES[recipe].machine, 12, 10, 0)!;
  w.setRecipe(b, recipe);
  const save = w.serialize(); save.rev = rev;
  const old = save.buildings.find(s => s.id === b.id)!;
  old.crafting = crafting; old.progress = crafting ? 0.5 : 0;
  old.inBuf = recipe === 'concrete' ? [['slag', 1], ['gravel', 1]] : [['sand', 1], ['water', 1]];
  old.outBuf = [[RECIPES[recipe].outputs[0].item, 1]];
  return { w, save, old, id: b.id };
}

describe('세척·콘크리트 레시피 저장 이행', () => {
  const cases: { recipe: 'wash' | 'concrete' | 'acid-wash'; rev: number; refund: [ItemId, number][] }[] = [
    { recipe: 'wash', rev: 1, refund: [['sand', 3], ['water', 2]] },
    { recipe: 'wash', rev: 2, refund: [['sand', 2], ['water', 1]] },
    { recipe: 'concrete', rev: 1, refund: [['slag', 2], ['gravel', 1]] },
    { recipe: 'concrete', rev: 2, refund: [['slag', 2], ['gravel', 1]] },
    { recipe: 'acid-wash', rev: 1, refund: [['sand', 3], ['water', 2], ['sulfuric-acid', 1]] },
  ];

  it.each(cases)('$recipe rev$rev는 구 배치에 실제로 쓴 재료만 반환하고 중복 환불하지 않는다', ({ recipe, rev, refund }) => {
    const { save, old, id } = oldSave(recipe, rev);
    const expected = new Map(old.inBuf);
    for (const [item, n] of refund) expected.set(item, (expected.get(item) ?? 0) + n);
    const loaded = World.deserialize(JSON.parse(JSON.stringify(save)));
    const b = loaded.buildings.get(id)!;
    expect(b.inBuf).toEqual(expected); expect([...b.outBuf]).toEqual(old.outBuf);
    expect(b.crafting).toBe(false); expect(b.progress).toBe(0); expect(b.modBatch).toBe(false);
    expect(loaded.stock).toEqual(new Map(save.stock));
    expect(loaded.serialize().rev).toBe(4);
    for (const again of [World.deserialize(loaded.serialize()), World.fromSnapshot(loaded.snapshot())]) {
      expect(again.buildings.get(id)!.inBuf).toEqual(expected);
      expect(again.buildings.get(id)!.outBuf).toEqual(b.outBuf);
    }
  });

  it.each(['wash', 'concrete'] as const)('쉬고 있던 %s의 입출고 재고는 늘리지 않는다', recipe => {
    const { save, old, id } = oldSave(recipe, 2, false);
    const b = World.deserialize(save).buildings.get(id)!;
    expect([...b.inBuf]).toEqual(old.inBuf); expect([...b.outBuf]).toEqual(old.outBuf);
  });

  it('이미 새 방식인 rev2 황산 세척은 진행도를 보존한다', () => {
    const { save, old, id } = oldSave('acid-wash', 2);
    const b = World.deserialize(save).buildings.get(id)!;
    expect(b.crafting).toBe(true); expect(b.progress).toBe(old.progress);
    expect([...b.inBuf]).toEqual(old.inBuf); expect([...b.outBuf]).toEqual(old.outBuf);
  });

  it('취소된 구 배치의 모듈 분리 예약과 기존 더미를 보존한다', () => {
    const { save, old, id } = oldSave('concrete', 2);
    old.mod = 0; old.modBatch = true; old.detach = true;
    save.piles = [[4, ITEM_IDS.indexOf('coal'), 5, 30, 'remove']];
    const loaded = World.deserialize(save), b = loaded.buildings.get(id)!;
    expect(b.module).toBeNull(); expect(b.detach).toBe(false);
    expect(Object.fromEntries(b.inBuf)).toEqual({ slag: 3, gravel: 2 });
    expect(loaded.piles).toEqual([
      { tile: 4, item: 'coal', n: 5, ev: 30, why: 'remove' },
      { tile: loaded.idx(b.x, b.y), item: 'module', n: 1, ev: 31, why: 'module' },
    ]);
    expect(World.deserialize(loaded.serialize()).piles).toEqual(loaded.piles);
  });

  it.each(['wash', 'concrete'] as const)('새 %s 배치는 저장·스냅샷 뒤에도 재료 환불 없이 끝까지 같은 결과를 낸다', recipe => {
    const { w, id } = oldSave(recipe, 3);
    const b = w.buildings.get(id)!;
    for (const input of RECIPES[recipe].inputs) b.inBuf.set(input.item, input.count);
    for (let tick = 0; tick < TICK_RATE; tick++) w.tick();
    expect(b.crafting).toBe(true);
    const copies = [World.deserialize(w.serialize()), World.fromSnapshot(w.snapshot())];
    for (const copy of copies) {
      expect(copy.buildings.get(id)!.progress).toBe(b.progress);
      expect(copy.buildings.get(id)!.inBuf).toEqual(b.inBuf);
    }
    for (const world of [w, ...copies]) {
      for (let tick = 0; tick < 6 * TICK_RATE; tick++) world.tick();
      expect(Object.fromEntries(world.buildings.get(id)!.outBuf)).toEqual(Object.fromEntries(RECIPES[recipe].outputs.map(s => [s.item, s.count])));
      expect(world.stats.recipeDone.get(recipe)).toBe(1);
    }
  });
});
