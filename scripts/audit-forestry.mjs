// 실제 제작·성장 틱으로 산림의 지속 생산량을 비교한다. 게임 규칙 파일은 바꾸지 않는다.
// node scripts/audit-forestry.mjs
// oracle 설비 측정: 고정 맑음·충분한 전력, 순간 운송, 유한한 초기 묘목만 재활용.
import assert from 'node:assert/strict';
import { createServer } from 'vite';

const server = await createServer({ server: { middlewareMode: true, hmr: false } });
try {
  const { World, TICK_RATE } = await server.ssrLoadModule('/src/sim/world.ts');
  const { ITEM_IDS } = await server.ssrLoadModule('/src/data/items.ts');
  const { FOREST } = await server.ssrLoadModule('/src/data/buildings.ts');
  const WARMUP = 600, MEASURE = 3600;

  function probe({ name, cutters, planters = [[0, 0]], care = false, terrain = 'grass', initialSeeds = 100, range = FOREST.lumberjackRange, blockers = [] }) {
    const w = new World(44, 44);
    w.createHub(0, 0);
    for (const item of ITEM_IDS) w.stock.set(item, 10000);
    w.applyTech('forestry');
    if (care) w.applyTech('forest-care');
    w.terrain = new Uint8Array(w.width * w.height).fill(terrain === 'forest' ? 1 : 0);
    const ps = planters.map(([dx, dy]) => {
      const p = w.place('planter', 20 + dx, 20 + dy, 0);
      assert.ok(p);
      return p;
    });
    const cs = cutters.map(([dx, dy]) => {
      const c = w.place('lumberjack', 20 + dx, 20 + dy, 0);
      assert.ok(c);
      if (range !== FOREST.lumberjackRange) {
        // 비교용 옛 0.8.3 범위만 이 측정에 주입한다. current 행은 현재 게임의 범위를 그대로 쓴다.
        c.mineTiles = [];
        for (let y = c.y - range; y < c.y + c.size + range; y++)
          for (let x = c.x - range; x < c.x + c.size + range; x++)
            if (w.inBounds(x, y) && !c.contains(x, y)) c.mineTiles.push(w.idx(x, y));
      }
      return c;
    });
    for (const [dx, dy] of blockers) assert.ok(w.place('belt', 20 + dx, 20 + dy, 0));
    const plantable = [...new Set(ps.flatMap(p => p.mineTiles))].filter(i => w.canPlant(i));
    const harvestable = new Set(cs.flatMap(c => c.mineTiles));
    const shared = plantable.filter(i => harvestable.has(i));
    let seeds = initialSeeds, demand = 0, before = 0;
    const statuses = cs.map(() => ({}));
    const snapshots = [];
    function seedCount() {
      return seeds + ps.reduce((n, p) => n + (p.inBuf.get('sapling') ?? 0), 0) + cs.reduce((n, c) => n + (c.outBuf.get('sapling') ?? 0), 0) + w.treeCount().grown + w.treeCount().growing;
    }
    for (let n = 0; n < (WARMUP + MEASURE) * TICK_RATE; n++) {
      for (const c of cs) {
        seeds += c.outBuf.get('sapling') ?? 0;
        c.outBuf.delete('sapling');
        c.outBuf.delete('log');
      }
      for (const p of ps) {
        const feed = Math.min(seeds, FOREST.planterCap - (p.inBuf.get('sapling') ?? 0));
        if (feed > 0) { seeds -= feed; p.inBuf.set('sapling', (p.inBuf.get('sapling') ?? 0) + feed); }
      }
      if (n === WARMUP * TICK_RATE) before = w.stats.made.get('log') ?? 0;
      w.tick();
      assert.equal(w.power.satisfaction, 1);
      if (n >= WARMUP * TICK_RATE) {
        demand += w.power.demand;
        for (let k = 0; k < cs.length; k++) statuses[k][cs[k].status] = (statuses[k][cs[k].status] ?? 0) + 1;
      }
      if ((n + 1) % (60 * TICK_RATE) === 0) {
        assert.equal(seedCount(), initialSeeds, '묘목·나무의 실물이 보존되어야 한다');
        if (n >= WARMUP * TICK_RATE) snapshots.push(w.stats.made.get('log') ?? 0);
      }
    }
    const logs = (w.stats.made.get('log') ?? 0) - before;
    const perMinute = snapshots.map((v, i) => v - (i === 0 ? before : snapshots[i - 1]));
    return { name, profile: 'oracle-throughput', terrain, care, initialSeeds, planterCount: ps.length, cutterCount: cs.length, cutterRange: range,
      plantableCells: plantable.length, sharedCells: shared.length, strandedCells: plantable.length - shared.length,
      logsPerMinute: logs * 60 / MEASURE, perMinute,
      avgPowerKW: Number((demand / (MEASURE * TICK_RATE)).toFixed(2)),
      trees: w.treeCount(), seedReserve: seedCount() - w.treeCount().grown - w.treeCount().growing,
      cutterStatuses: statuses.map(row => Object.fromEntries(Object.entries(row).map(([k, v]) => [k, Number((v / (MEASURE * TICK_RATE)).toFixed(4))]))) };
  }

  const layouts = [
    { name: 'baseline-v0.8.3-one-adjacent', cutters: [[2, 0]], range: 3 },
    { name: 'baseline-v0.8.3-two-adjacent', cutters: [[-2, 0], [2, 0]], range: 3 },
    { name: 'baseline-v0.8.3-two-offset4', cutters: [[-4, 0], [4, 0]], range: 3 },
    { name: 'current-one-adjacent', cutters: [[2, 0]] },
  ];
  const rows = [];
  const record = config => { if (!process.argv[2] || config.name.includes(process.argv[2])) rows.push(probe(config)); };
  for (const terrain of ['grass', 'forest']) for (const care of [false, true])
    for (const layout of layouts) record({ ...layout, terrain, care });
  for (const terrain of ['grass', 'forest']) for (const care of [false, true])
    record({ name: 'baseline-v0.8.3-two-offset4-three-belt-cells', cutters: [[-4, 0], [4, 0]], range: 3, terrain, care, blockers: [[0, -3], [0, -2], [0, -1]] });
  for (const terrain of ['grass', 'forest']) for (const care of [false, true])
    record({ name: 'current-three-belt-cells', cutters: [[2, 0]], terrain, care, blockers: [[0, -3], [0, -2], [0, -1]] });
  for (const terrain of ['grass', 'forest']) for (const care of [false, true])
    record({ name: 'baseline-v0.8.3-two-planters-one-cutter', planters: [[-4, 0], [4, 0]], cutters: [[0, 0]], range: 3, initialSeeds: 200, terrain, care });
  record({ name: 'baseline-v0.8.3-two-planters-one-cutter-100seeds', planters: [[-4, 0], [4, 0]], cutters: [[0, 0]], range: 3, initialSeeds: 100 });
  record({ name: 'baseline-v0.8.3-one-right-five-seeds', cutters: [[2, 0]], range: 3, initialSeeds: 5 });
  record({ name: 'baseline-v0.8.3-one-left-five-seeds', cutters: [[-2, 0]], range: 3, initialSeeds: 5 });
  record({ name: 'baseline-v0.8.3-one-bottom-five-seeds', cutters: [[0, 2]], range: 3, initialSeeds: 5 });
  record({ name: 'current-five-seeds', cutters: [[2, 0]], initialSeeds: 5 });
  console.log(JSON.stringify({ protocol: { warmupSeconds: WARMUP, measureSeconds: MEASURE, tickRate: TICK_RATE,
    weather: 'clear', initialTrees: 0, endlessResearch: 0, transport: 'instant, conserved, planter input capped at 5',
    limitations: 'Instant transport; three-cell belt cases reserve land only. No complete logistics or power-grid layout; not a play difficulty or global optimum verdict.' }, rows }, null, 2));
} finally {
  await server.close();
}
