import { describe, expect, it } from 'vitest';
import { ITEM_IDS } from '../data/items';
import { TECHS } from '../data/tech';
import { TICK_RATE, World } from './world';

function oldSave(crafting = true) {
  const w = new World(40, 30);
  w.createHub(0, 0);
  for (const tech of TECHS) w.applyTech(tech.id);
  for (const item of ITEM_IDS) w.stock.set(item, 1000);
  const b = w.place('separator', 15, 10, 0)!;
  w.setRecipe(b, 'separate');
  const save = w.serialize();
  save.rev = 1;
  const old = save.buildings.find(s => s.id === b.id)!;
  old.crafting = crafting;
  old.progress = crafting ? 0.5 : 0;
  old.cycle = 7;
  old.inBuf = [['mineral-dust', 2]];
  old.outBuf = [['iron-concentrate', 3], ['copper-concentrate', 1], ['slag', 1]];
  return { save, old, id: b.id };
}

describe('분리기 동시 산출 저장 이행', () => {
  it('구 배치가 이미 쓴 가루1개만 반환하고, 입출고 실물은 보존하며 다시 불러와도 중복 환불하지 않는다', () => {
    const { save, id } = oldSave();
    const loaded = World.deserialize(JSON.parse(JSON.stringify(save)));
    const b = loaded.buildings.get(id)!;
    expect(b.inBuf.get('mineral-dust')).toBe(3);
    expect([...b.outBuf]).toEqual([['iron-concentrate', 3], ['copper-concentrate', 1], ['slag', 1]]);
    expect(b.crafting).toBe(false); expect(b.progress).toBe(0); expect(b.cycle).toBe(0);
    expect(loaded.stock).toEqual(new Map(save.stock));
    expect(loaded.serialize().rev).toBe(4);
    for (const next of [World.deserialize(loaded.serialize()), World.fromSnapshot(loaded.snapshot())]) {
      expect(next.buildings.get(id)!.inBuf.get('mineral-dust')).toBe(3);
      expect(next.buildings.get(id)!.outBuf).toEqual(b.outBuf);
    }
    // 예전 1개 투입 상태를 새 10개 배치의 완제품으로 바꿔 주지 않는다.
    for (let i = 0; i < 11 * TICK_RATE; i++) loaded.tick();
    expect(b.crafting).toBe(false); expect(b.inBuf.get('mineral-dust')).toBe(3);
    expect(b.outBuf.get('iron-concentrate')).toBe(3);
    b.inBuf.set('mineral-dust', 10);
    for (let i = 0; i <= 10 * TICK_RATE; i++) loaded.tick();
    expect(Object.fromEntries(b.outBuf)).toEqual({ 'iron-concentrate': 10, 'copper-concentrate': 3, slag: 2 });
    expect(b.inBuf.get('mineral-dust') ?? 0).toBe(0);
  });

  it('쉬고 있던 구 분리기에는 재료를 만들어 넣지 않는다', () => {
    const { save, id } = oldSave(false);
    const loaded = World.deserialize(save);
    expect(loaded.buildings.get(id)!.inBuf.get('mineral-dust')).toBe(2);
  });

  it('구 배치의 모듈 분리 예약은 기존 더미를 보존하며 한 번만 완료한다', () => {
    const { save, old, id } = oldSave();
    old.mod = 0; old.modBatch = true; old.detach = true;
    save.piles = [[4, ITEM_IDS.indexOf('coal'), 5, 20, 'remove']];
    const loaded = World.deserialize(save);
    const b = loaded.buildings.get(id)!;
    expect(b.module).toBeNull(); expect(b.detach).toBe(false); expect(b.modBatch).toBe(false);
    expect(b.inBuf.get('mineral-dust')).toBe(3);
    expect(loaded.piles.find(p => p.item === 'coal')).toMatchObject({ tile: 4, n: 5, ev: 20 });
    expect(loaded.piles.filter(p => p.item === 'module')).toEqual([
      { tile: loaded.idx(b.x, b.y), item: 'module', n: 1, ev: 21, why: 'module' },
    ]);
    expect(World.deserialize(loaded.serialize()).piles).toEqual(loaded.piles);
  });
});
