// 정격 생산, 속도 연구·모듈 없음. 재료 수지를 실제 레시피에서 펼친다.
import assert from 'node:assert/strict';
import { RECIPES } from '../src/data/recipes.ts';
import { BUILDINGS } from '../src/data/buildings.ts';

const old = { ...RECIPES, 'battery-pack': { ...RECIPES['battery-pack'], inputs: [
  { item: 'lithium', count: 2 }, { item: 'copper-plate', count: 2 },
  { item: 'circuit', count: 1 }, { item: 'plastic', count: 1 },
] } };
function tin(item, recipes, path = []) {
  if (item === 'tin-plate') return 1;
  assert.ok(!path.includes(item), `재료 순환: ${[...path, item]}`);
  const r = Object.values(recipes).find(r => r.outputs[0].item === item);
  return r ? r.inputs.reduce((sum, input) => sum + input.count * tin(input.item, recipes, [...path, item]), 0) / r.outputs[0].count : 0;
}
const rows = ['battery-pack', 'truck-kit', 'module'].map(item => {
  const before = tin(item, old), after = tin(item, RECIPES);
  const rate = 60 / RECIPES[item].time;
  return { item, before, after, increase: after - before, beforePerMinute: before * rate, afterPerMinute: after * rate };
});
assert.deepEqual(rows.map(r => [r.before, r.after]), [[0, 2], [7, 15], [8, 12]]);
const accumulatorBefore = 4 * tin('battery-pack', old) + tin('controller', old);
const accumulatorAfter = BUILDINGS.accumulator.cost.reduce((sum, input) => sum + input.count * tin(input.item, RECIPES), 0);
assert.equal(accumulatorBefore, 2.5); assert.equal(accumulatorAfter, 12);
assert.deepEqual(RECIPES.circuit.inputs, [{ item: 'iron-plate', count: 1 }, { item: 'copper-wire', count: 3 }]);
console.log(JSON.stringify({ rows, accumulator: { before: accumulatorBefore, after: accumulatorAfter },
  final50Modules: { before: 50 * tin('module', old), after: 50 * tin('module', RECIPES) },
  powerCircuitTinPerMinute: 60 / RECIPES['power-circuit'].time * tin('power-circuit', RECIPES),
}, null, 2));
