// 게임에 적용된 레시피에서 흙 공정 전체의 정수 비율과 분기 수지를 검증한다.
// node scripts/audit-soil-chain.mjs
import assert from 'node:assert/strict';
import { RECIPES } from '../src/data/recipes.ts';
import { BUILDINGS } from '../src/data/buildings.ts';

const input = (r, item) => (r.inputs.find(s => s.item === item)?.count ?? 0) * 60 / r.time;
const output = (r, item) => (r.outputs.find(s => s.item === item)?.count ?? 0) * 60 / r.time;
const near = (a, b) => Math.abs(a - b) < 1e-8;
const clean = n => Number(n.toFixed(8));
const internal = ['dirt', 'gravel', 'sand', 'water', 'mud', 'mineral-dust', 'iron-concentrate', 'copper-concentrate', 'slag'];

function machines(recipes, washers) {
  const r = recipes;
  const dust = output(r.wash, 'mineral-dust') * washers;
  const separator = dust / input(r.separate, 'mineral-dust');
  const concrete = output(r.separate, 'slag') * separator / input(r.concrete, 'slag');
  const gravelForConcrete = input(r.concrete, 'gravel') * concrete;
  const sand = input(r.wash, 'sand') * washers;
  const gravelYield = output(r['crush-gravel'], 'sand') / input(r['crush-gravel'], 'gravel');
  const dirtCrusher = (sand + gravelForConcrete * gravelYield) /
    (output(r['crush-dirt'], 'sand') + output(r['crush-dirt'], 'gravel') * gravelYield);
  return {
    miner: dirtCrusher * input(r['crush-dirt'], 'dirt') / (60 * BUILDINGS.miner.speed),
    'crush-dirt': dirtCrusher,
    'crush-gravel': (dirtCrusher * output(r['crush-dirt'], 'gravel') - gravelForConcrete) / input(r['crush-gravel'], 'gravel'),
    pump: washers * input(r.wash, 'water') / (60 * BUILDINGS.pump.speed),
    wash: washers,
    separate: separator,
    'iron-plate-c': separator * output(r.separate, 'iron-concentrate') / input(r['iron-plate-c'], 'iron-concentrate'),
    'copper-plate-c': separator * output(r.separate, 'copper-concentrate') / input(r['copper-plate-c'], 'copper-concentrate'),
    brick: washers * output(r.wash, 'mud') / input(r.brick, 'mud'),
    concrete,
  };
}

function audit(recipes) {
  let counts;
  // 세척기는 적어도 1대. 다른 설비 수는 모든 중간재를 내부에서 정확히 소모한다는 식으로 결정된다.
  for (let washers = 1; washers <= 1000; washers++) {
    const candidate = machines(recipes, washers);
    if (Object.values(candidate).every(n => n > 0 && near(n, Math.round(n)))) {
      counts = Object.fromEntries(Object.entries(candidate).map(([key, n]) => [key, Math.round(n)]));
      break;
    }
  }
  assert.ok(counts, '1000대 이하 세척기에서 정수 해를 찾지 못함');
  const made = {}, used = {}, rows = [];
  let power = 0;
  const add = (map, item, n) => { map[item] = (map[item] ?? 0) + n; };
  for (const [id, n] of Object.entries(counts)) {
    const recipe = recipes[id];
    const building = BUILDINGS[recipe?.machine ?? id];
    const ins = recipe ? recipe.inputs.map(s => [s.item, clean(input(recipe, s.item) * n)]) : [];
    const outs = recipe ? recipe.outputs.map(s => [s.item, clean(output(recipe, s.item) * n)])
      : [[id === 'miner' ? 'dirt' : 'water', n * building.speed * 60]];
    for (const [item, k] of ins) add(used, item, k);
    for (const [item, k] of outs) add(made, item, k);
    power += n * building.power;
    rows.push({ id, count: n, input: Object.fromEntries(ins), output: Object.fromEntries(outs) });
  }
  const balances = Object.fromEntries([...new Set([...Object.keys(made), ...Object.keys(used)])]
    .map(item => [item, { made: clean(made[item] ?? 0), used: clean(used[item] ?? 0), export: clean((made[item] ?? 0) - (used[item] ?? 0)) }]));
  for (const item of internal) assert.ok(near(balances[item]?.export ?? 0, 0), `${item} 내부 수지 불일치`);
  for (const [item, row] of Object.entries(balances)) assert.ok(row.export >= 0, `${item} 공급 부족`);
  return { machineCount: Object.values(counts).reduce((sum, n) => sum + n, 0), power, rows, balances };
}

const current = audit(RECIPES);
assert.equal(current.machineCount, 40);
assert.equal(current.power, 5205);
assert.deepEqual(Object.fromEntries(current.rows.map(row => [row.id, row.count])), {
  miner: 6, 'crush-dirt': 6, 'crush-gravel': 4, pump: 1, wash: 5, separate: 5,
  'iron-plate-c': 7, 'copper-plate-c': 2, brick: 3, concrete: 1,
});
assert.deepEqual(Object.fromEntries(Object.entries(current.balances).filter(([, v]) => v.export).map(([k, v]) => [k, v.export])),
  { 'iron-plate': 210, 'copper-plate': 60, brick: 60, concrete: 30 });

const extraWater = ['paper', 'plastic', 'aluminum-plate', 'sulfuric-acid', 'acid-wash', 'lithium']
  .map(id => ({ recipe: id, perMinute: input(RECIPES[id], 'water') }));
const acidNeeded = input(RECIPES['acid-wash'], 'sulfuric-acid');
const acidWater = input(RECIPES['acid-wash'], 'water') +
  acidNeeded / output(RECIPES['sulfuric-acid'], 'sulfuric-acid') * input(RECIPES['sulfuric-acid'], 'water');
assert.equal(acidWater, 45);
// 별도 양수기1대로 제지1·플라스틱2·알루미늄1·황산1·리튬1을 함께 공급하는 예.
assert.equal(input(RECIPES.paper, 'water') + 2 * input(RECIPES.plastic, 'water') +
  input(RECIPES['aluminum-plate'], 'water') + input(RECIPES['sulfuric-acid'], 'water') + input(RECIPES.lithium, 'water'),
  BUILDINGS.pump.speed * 60);
console.log(JSON.stringify({ current, extraWater, acidWaterIncludingAcidProduction: acidWater }, null, 2));
