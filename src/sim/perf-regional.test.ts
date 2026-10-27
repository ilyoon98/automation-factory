import { describe, expect, it } from 'vitest';
import type { Building } from './building';
import { applyCommand } from './commands';
import { generateRegionalWorld } from './regional-map';
import { TICK_RATE } from './world';

/**
 * 확장 지도 성능 측정 (docs/지형-운송-전력-상세기획.md §15: 256×256에서 기계 1,000대·차량 64대).
 * 오래 걸려 평소 테스트에서는 건너뛴다. 재려면: PERF=1 npx vitest run src/sim/perf-regional.test.ts
 */
/** node 형식 정의 없이 환경 변수·표준 출력 쓰기 */
const nodeProcess = (globalThis as { process?: { env: Record<string, string | undefined>; stdout: { write(s: string): void } } }).process;

describe.skipIf(!nodeProcess?.env.PERF)('확장 지도 성능', () => {
  it('기계 1,000대·트럭 64대가 도는 256×256 지도에서 틱 시간', () => {
    const w = generateRegionalWorld(2026);
    w.revealForGoal('MG32');
    for (const t of w.techs) w.applyTech(t.id);
    for (const item of ['iron-plate', 'gear', 'stone', 'steel', 'circuit', 'coal', 'wood', 'copper-wire'] as const) w.stock.set(item, 1e9);
    // 발전: 지도 곳곳 석탄 발전기 (구역이 여럿 생긴다)
    const machines: Building[] = [];
    for (let y = 4; y < 250 && machines.length < 1000; y += 3) {
      for (let x = 4; x < 250 && machines.length < 1000; x += 3) {
        if ((x + y) % 30 === 2) {
          const g = w.place('generator', x, y, 0);
          if (g) g.fuel = 5;
          continue;
        }
        const m = w.place('smelter', x, y, 0);
        if (!m) continue;
        w.setRecipe(m, 'iron-plate');
        m.inBuf.set('iron-ore', 1e6);
        machines.push(m);
      }
    }
    // 트럭 64대: 긴 도로 위 정류장 두 곳씩 32쌍
    const hub = w.hub!;
    let trucks = 0;
    for (let k = 0; k < 40 && trucks < 64; k++) {
      const y = 5 + k * 6;
      for (let x = 2; x < 254; x++) if (w.canPlace('road', x, y).ok) w.place('road', x, y, 0);
      const a = w.place('station', 20, y - 2, 0);
      const b = w.place('station', 220, y - 2, 0);
      if (!a || !b) continue;
      w.setStationMode(b, 'unload');
      a.inBuf.set('stone', 200);
      for (let n = 0; n < 2; n++) {
        const v = applyCommand(w, 0, { t: 'build-truck', station: a.id });
        if (v) trucks++;
      }
    }
    expect(hub).toBeTruthy();
    const N = 6 * TICK_RATE;
    const working = () => machines.filter((m) => m.crafting).length;
    for (let i = 0; i < TICK_RATE; i++) w.tick();
    const t0 = performance.now();
    for (let i = 0; i < N; i++) {
      for (const m of machines) m.outBuf.clear();
      w.tick();
    }
    const tick = (performance.now() - t0) / N;
    const c0 = performance.now();
    w.checksum();
    const sum = performance.now() - c0;
    const s0 = performance.now();
    const size = JSON.stringify(w.serialize()).length;
    const save = performance.now() - s0;
    nodeProcess?.stdout.write(
      `기계 ${machines.length}대 (작업 중 ${working()}) · 트럭 ${trucks}대 · 건물 ${w.buildings.size}개 · 구역 ${w.zones.length}곳\n` +
        `틱 평균 ${tick.toFixed(2)}ms (60틱/초면 ${(tick * 60).toFixed(0)}ms/초) · 해시 ${sum.toFixed(1)}ms · 저장 ${save.toFixed(1)}ms (${(size / 1024).toFixed(0)}KB)
`,
    );
    expect(machines.length).toBeGreaterThanOrEqual(1000);
  }, 120_000);
});
