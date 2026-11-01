// 레시피 원본으로 분당 처리량과 소규모 설비 조합의 재료 부족을 다시 계산한다.
// node scripts/audit-production.mjs [보고서 경로]
import { writeFileSync } from 'node:fs';
import { RECIPES } from '../src/data/recipes.ts';
import { ITEMS } from '../src/data/items.ts';
import { BUILDINGS, EXTRACT, FOREST } from '../src/data/buildings.ts';

const fmt = n => Number(n.toFixed(3)).toString();
const name = id => ITEMS[id].name;
const gcd = (a, b) => b ? gcd(b, a % b) : a;
const recipes = Object.values(RECIPES);
const sources = [
  { id: 'miner', name: '채굴기', rate: 60 * BUILDINGS.miner.speed, items: ['iron-ore', 'copper-ore', 'coal', 'stone', 'tin-ore', 'bauxite', 'sulfur', 'dirt'] },
  { id: 'pump', name: '양수기 (날씨 배율 1)', rate: 60 * BUILDINGS.pump.speed, items: ['water'] },
  { id: 'sap-extractor', name: '수액 채취기 (군락당 4대 이하)', rate: 60 / EXTRACT.sapTime, items: ['sap'] },
  { id: 'drill', name: '시추기', rate: 60 / EXTRACT.drillTime, items: ['crude-oil', 'brine'] },
  { id: 'lumberjack', name: '벌목기 (성목 충분)', rate: 60 / FOREST.cut * FOREST.logs, items: ['log'] },
];
const producers = [
  ...recipes.flatMap(r => r.outputs.map(o => ({ id: r.id, name: r.name, item: o.item, rate: 60 / r.time * o.count }))),
  ...sources.flatMap(s => s.items.map(item => ({ ...s, item }))),
];
const edges = [];
for (const consumer of recipes) for (const input of consumer.inputs) {
  const demand = 60 / consumer.time * input.count;
  for (const p of producers.filter(p => p.item === input.item)) {
    // Exact ratio from rational rates, rounded only for the displayed rate.
    const a = Math.round(demand * 1e6), b = Math.round(p.rate * 1e6), d = gcd(a, b);
    const candidates = [];
    for (let np = 1; np <= 3; np++) for (let nc = 1; nc <= 3; nc++) {
      if (gcd(np, nc) !== 1) continue;
      const supply = np * p.rate, need = nc * demand;
      if (supply >= need - 1e-8 || supply < need * 0.8 - 1e-8) continue;
      candidates.push({ np, nc, supply, need, shortage: need - supply, utilization: supply / need });
    }
    candidates.sort((a, b) => a.np + a.nc - b.np - b.nc || b.utilization - a.utilization);
    edges.push({ producer: p.name, consumer: consumer.name, item: name(input.item), supply: p.rate, demand, ratio: `${a / d}:${b / d}`, small: candidates[0] ?? null });
  }
}
const small = edges.filter(e => e.small);
const rows = recipes.map(r => `| ${r.name} | ${r.time} | ${r.inputs.map(i => `${name(i.item)} ${fmt(i.count * 60 / r.time)}`).join(' + ')} | ${r.outputs.map(i => `${name(i.item)} ${fmt(i.count * 60 / r.time)}`).join(' + ')} |`);
const report = [
  '# 생산 비율 전수 계산', '',
  '생성: `node scripts/audit-production.mjs docs/생산비율-계산.md`', '',
  `레시피 ${recipes.length}개, 직접 재료 연결 ${edges.length}개를 계산했다. 전력 100%, 끝없는 연구·설비 모듈 없음, 자원과 운송 공간이 충분한 기준이다. 분리기의 출력은 패턴 평균이며 순간 공급은 고르지 않다.`, '',
  '## 전체 레시피 (개/분)', '',
  '| 레시피 | 초/회 | 소비 | 생산 |', '|---|---:|---|---|', ...rows, '',
  '## 채취 공급 기준', '',
  ...sources.map(s => `- ${s.name}: ${fmt(s.rate)}개/분.`), '',
  '양수기는 날씨, 벌목기는 성목과 재성장, 수액은 군락당 총량, 채취·제작은 전력과 연구 배율의 영향을 받는다. 모듈을 일부 기계에만 설치하면 기본 비율이 달라진다.', '',
  '## 소규모에서 20% 이하로 부족한 연결', '',
  '각 직접 연결마다 공급·소비 설비 1~3대에서 가장 작은 조합 하나를 골랐다. 한 재료만 따로 본 상한이며, 다른 재료와 공유 소비까지 충족한다는 뜻은 아니다. 잉여 처리 가능성만으로 레시피 문제라고 판정하지 않는다.', '',
  '| 공급 → 소비 | 재료 | 설비 수 | 공급 / 필요 | 부족 | 해당 재료로 제한되는 가동률 |',
  '|---|---|---|---:|---:|---:|',
  ...small.map(e => { const s = e.small; return `| ${e.producer} → ${e.consumer} | ${e.item} | ${s.np} → ${s.nc} | ${fmt(s.supply)} / ${fmt(s.need)} | ${fmt(s.shortage)} | ${fmt(s.utilization * 100)}% |`; }), '',
  '## 직접 연결의 정확한 설비 비율', '',
  '공급 설비 : 소비 설비. 다른 재료의 충분한 공급과 부산물 처리가 전제다.', '',
  '| 공급 → 소비 | 재료 | 1대 생산 / 1대 소비 | 정확한 설비 비율 |', '|---|---|---:|---|',
  ...edges.map(e => `| ${e.producer} → ${e.consumer} | ${e.item} | ${fmt(e.supply)} / ${fmt(e.demand)} | ${e.ratio} |`), '',
].join('\n');
if (process.argv[2]) writeFileSync(process.argv[2], report);
console.log(JSON.stringify({ recipes: recipes.length, connections: edges.length, smallShortages: small }, null, 2));
