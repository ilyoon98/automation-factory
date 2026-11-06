import { describe, expect, it } from 'vitest';
import { BUILDINGS, type BuildingType } from '../data/buildings';
import { ITEM_IDS, type ItemId } from '../data/items';
import { RECIPES } from '../data/recipes';
import { TECHS } from '../data/tech';
import { addTo, countOf, type Building } from './building';
import { TICK_RATE, World } from './world';

type Groups = Record<string, number[]>;
const products = { iron: 'iron-plate', copper: 'copper-plate', brick: 'brick', concrete: 'concrete' } as const;
type ProductGroup = keyof typeof products;
const intermediates: ItemId[] = ['dirt', 'gravel', 'sand', 'water', 'mineral-dust', 'mud', 'iron-concentrate', 'copper-concentrate', 'slag'];

/** 평시 기본 공정 40대. 발전기는 별도이며 물류 이동 시간만 제외한다. */
function setup() {
  const w = new World(60, 50);
  w.createHub(0, 0);
  for (const t of TECHS) w.applyTech(t.id);
  for (const item of ITEM_IDS) w.stock.set(item, 10000);
  const ids: Groups = {};
  let slot = 0;
  const group = (name: string, type: BuildingType, count: number, recipe?: string) => {
    ids[name] = [];
    for (let i = 0; i < count; i++, slot++) {
      const x = 10 + slot % 8 * 4, y = 10 + Math.floor(slot / 8) * 4;
      if (type === 'pump') for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) w.setResource(x + dx, y + dy, 'water', Infinity);
      const b = w.place(type, x, y, 0)!;
      expect(b).not.toBeNull();
      if (recipe) expect(w.setRecipe(b, recipe)).toBe(true);
      ids[name].push(b.id);
    }
  };
  group('miner', 'miner', 6);
  group('dirt', 'crusher', 6, 'crush-dirt');
  group('gravel', 'crusher', 4, 'crush-gravel');
  group('pump', 'pump', 1);
  group('wash', 'washer', 5, 'wash');
  group('separate', 'separator', 5, 'separate');
  group('iron', 'smelter', 7, 'iron-plate-c');
  group('copper', 'smelter', 2, 'copper-plate-c');
  group('brick', 'smelter', 3, 'brick');
  group('concrete', 'assembler', 1, 'concrete');
  for (let i = 0; i < 6; i++) w.place('generator', 5 + i * 4, 40, 0)!.fuel = 10000;
  return { w, ids };
}

const members = (w: World, ids: Groups, group: string) => ids[group].map(id => w.buildings.get(id)!);

/** 실제 2회분 입고 한도 안에서 분배한다. 중간재를 추가하거나 삭제하지 않는다. */
function transfer(from: Building[], to: Building[], item: ItemId) {
  const limit = RECIPES[to[0].recipe!].inputs.find(input => input.item === item)!.count * 2;
  for (const source of from) {
    while (countOf(source.outBuf, item) > 0) {
      let target: Building | undefined;
      for (const b of to) if (countOf(b.inBuf, item) < limit && (!target || countOf(b.inBuf, item) < countOf(target.inBuf, item))) target = b;
      if (!target) break;
      addTo(source.outBuf, item, -1);
      addTo(target.inBuf, item, 1);
    }
  }
}

function tick(w: World, ids: Groups, blocked?: ProductGroup) {
  const b = (group: string) => members(w, ids, group);
  transfer(b('miner'), b('dirt'), 'dirt');
  // 자갈 180/분 중 콘크리트가 60/분을 사용하고, 남은 120/분만 분쇄한다.
  transfer(b('dirt'), b('concrete'), 'gravel');
  transfer(b('dirt'), b('gravel'), 'gravel');
  transfer([...b('dirt'), ...b('gravel')], b('wash'), 'sand');
  transfer(b('pump'), b('wash'), 'water');
  transfer(b('wash'), b('separate'), 'mineral-dust');
  transfer(b('wash'), b('brick'), 'mud');
  transfer(b('separate'), b('iron'), 'iron-concentrate');
  transfer(b('separate'), b('copper'), 'copper-concentrate');
  transfer(b('separate'), b('concrete'), 'slag');
  for (const [name, item] of Object.entries(products)) {
    if (name === blocked) continue;
    for (const holder of b(name)) {
      const n = countOf(holder.outBuf, item);
      if (n > 0) { addTo(w.stock, item, n); addTo(holder.outBuf, item, -n); }
    }
  }
  w.tick();
}

function run(w: World, ids: Groups, seconds: number, blocked?: ProductGroup) {
  let demand = 0;
  for (let i = 0; i < seconds * TICK_RATE; i++) {
    tick(w, ids, blocked);
    if (w.power.satisfaction !== 1) throw new Error('공정 검증용 전력이 부족합니다.');
    demand += w.power.demand;
  }
  return demand / (seconds * TICK_RATE);
}

/** 투입 직후 제작기에 예약된 재료까지 포함해 중간재 잔고를 비교한다. */
function inventory(w: World, ids: Groups) {
  const totals = new Map<ItemId, number>(intermediates.map(item => [item, 0]));
  for (const id of Object.values(ids).flat()) {
    const b = w.buildings.get(id)!;
    for (const item of intermediates) addTo(totals, item, countOf(b.inBuf, item) + countOf(b.outBuf, item));
    if (b.crafting && b.recipe) for (const input of RECIPES[b.recipe].inputs) addTo(totals, input.item, input.count);
  }
  return Object.fromEntries(totals);
}

describe('흙 전체 공정 밸런스', () => {
  it('40대가 부산물을 모두 소비하며 분당 철210·구리60·벽돌60·콘크리트30을 생산한다', () => {
    const { w, ids } = setup();
    const middleStock = intermediates.map(item => countOf(w.stock, item));
    run(w, ids, 180);
    const before = new Map(w.stats.made);
    const balance = inventory(w, ids);
    const demand = run(w, ids, 300);
    const made = (item: ItemId) => countOf(w.stats.made, item) - countOf(before, item);
    expect(Object.fromEntries((['iron-plate', 'copper-plate', 'brick', 'concrete', 'dirt', 'gravel', 'sand', 'water', 'mineral-dust', 'mud', 'slag'] as ItemId[]).map(item => [item, made(item)]))).toEqual({
      'iron-plate': 1050, 'copper-plate': 300, brick: 300, concrete: 150,
      dirt: 1800, gravel: 900, sand: 1500, water: 600, 'mineral-dust': 1500, mud: 600, slag: 150,
    });
    expect(inventory(w, ids)).toEqual(balance);
    expect(intermediates.map(item => countOf(w.stock, item))).toEqual(middleStock);
    expect(Object.values(ids).flat()).toHaveLength(40);
    expect(Object.values(ids).flat().reduce((sum, id) => sum + w.buildings.get(id)!.def.power, 0)).toBe(5205);
    expect(demand).toBeCloseTo(5205, 0);
  });

  it.each<ProductGroup>(['brick', 'concrete'])('%s 출구가 막히면 생산이 멈추고 다시 열면 같은 설비로 회복한다', blocked => {
    const { w, ids } = setup();
    run(w, ids, 180);
    run(w, ids, 180, blocked);
    const stopped = countOf(w.stats.made, 'iron-plate');
    run(w, ids, 60, blocked);
    expect(countOf(w.stats.made, 'iron-plate')).toBe(stopped);
    expect(members(w, ids, blocked).every(b => b.status === 'output-full')).toBe(true);
    run(w, ids, 180);
    const before = new Map(w.stats.made);
    run(w, ids, 60);
    expect(Object.fromEntries(Object.values(products).map(item => [item, countOf(w.stats.made, item) - countOf(before, item)]))).toEqual({ 'iron-plate': 210, 'copper-plate': 60, brick: 60, concrete: 30 });
  });

  it('제작 중 저장·재개 후에도 전체 공정의 진행도·생산량·중간재가 이어진다', () => {
    const { w, ids } = setup();
    run(w, ids, 187);
    const loaded = World.deserialize(JSON.parse(JSON.stringify(w.serialize())));
    run(w, ids, 60);
    run(loaded, ids, 60);
    expect([...loaded.stats.made]).toEqual([...w.stats.made]);
    expect([...loaded.stock]).toEqual([...w.stock]);
    expect(inventory(loaded, ids)).toEqual(inventory(w, ids));
    for (const id of Object.values(ids).flat()) {
      const a = w.buildings.get(id)!, b = loaded.buildings.get(id)!;
      expect([...b.inBuf]).toEqual([...a.inBuf]);
      expect([...b.outBuf]).toEqual([...a.outBuf]);
      expect(b.progress).toBeCloseTo(a.progress, 8);
    }
  });

  it('황산 세척은 모래60·물30·황산15로 분당 가루120·진흙30을 만든다', () => {
    const { w, ids } = setup();
    const washer = members(w, ids, 'wash')[0];
    w.unlockedRecipes.add('acid-wash');
    expect(w.setRecipe(washer, 'acid-wash')).toBe(true);
    const r = RECIPES['acid-wash'];
    const used = new Map<ItemId, number>();
    const produced = new Map<ItemId, number>();
    for (let i = 0; i <= 60 * TICK_RATE; i++) {
      for (const input of r.inputs) {
        const n = input.count * 2 - countOf(washer.inBuf, input.item);
        addTo(washer.inBuf, input.item, n);
        addTo(used, input.item, n);
      }
      w.tick();
      for (const [item, n] of washer.outBuf) addTo(produced, item, n);
      washer.outBuf.clear();
    }
    for (const input of r.inputs) addTo(used, input.item, -countOf(washer.inBuf, input.item) - (washer.crafting ? input.count : 0));
    expect(Object.fromEntries(used)).toEqual({ sand: 60, water: 30, 'sulfuric-acid': 15 });
    expect(Object.fromEntries(produced)).toEqual({ 'mineral-dust': 120, mud: 30 });
    expect(produced.get('mineral-dust')).toBe(2 * 60 / RECIPES.separate.time * RECIPES.separate.inputs[0].count);
    expect(BUILDINGS.washer.power).toBe(150);
  });
});
