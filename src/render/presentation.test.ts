import { describe, expect, it } from 'vitest';
import { ITEM_IDS } from '../data/items';
import { Vehicle } from '../sim/vehicle';
import type { Activity } from '../sim/activity';
import { DT, World, type Wire } from '../sim/world';
import { ActivityPhases, cargoFrame } from './activity';
import { representativeWires, wireKey } from './wires';

function factory() {
  const w = new World(90, 45); w.rules = 'regional-v1'; w.createHub(0, 9);
  for (const t of w.techs) w.applyTech(t.id);
  for (const i of ITEM_IDS) w.stock.set(i, 5000);
  return w;
}

describe('작업 사실과 개인 화면의 위상', () => {
  it('실제 전력 비율과 제작 속도만 누적하고, 공급 0에서는 움직이지 않는다', () => {
    const w = factory(), phase = new ActivityPhases();
    w.onActivity = (e) => phase.record(e);
    const machines = Array.from({ length: 12 }, (_, i) => {
      const b = w.place('smelter', 5 + i % 6 * 3, 14 + Math.floor(i / 6) * 3, 0)!;
      w.setRecipe(b, 'iron-plate'); b.inBuf.set('iron-ore', 1000); return b;
    });
    let expected = 0;
    for (let tick = 0; tick < 120; tick++) {
      for (const b of machines) b.outBuf.clear();
      w.tick(); expected += DT * w.satOf(machines[0]) / w.craftTime(machines[0]);
    }
    expect(w.satOf(machines[0])).toBeGreaterThan(0);
    expect(w.satOf(machines[0])).toBeLessThan(1);
    expect(phase.work.get(machines[0].id)).toBeCloseTo(expected, 10);
    const p = w.place('pole', 13, 10, 0)!; w.place('pole', 25, 10, 0);
    const far = w.place('smelter', 30, 10, 0)!; w.setRecipe(far, 'iron-plate'); far.inBuf.set('iron-ore', 1000);
    w.tick(); const before = phase.work.get(far.id)!; expect(before).toBeGreaterThan(0);
    w.remove(p);
    for (let i = 0; i < 60; i++) w.tick();
    expect(w.satOf(far)).toBe(0); expect(phase.work.get(far.id)).toBe(before);
    // 정지는 틱 없음, 배속은 더 많은 동일한 틱. 실제 시각×현재 배율을 쓰지 않는다.
    phase.record({ kind: 'work', id: far.id, cycles: 0.25 });
    expect(phase.work.get(far.id)).toBe(before + 0.25);
  });

  it('관찰 유무와 화면 위상은 재고·저장·체크섬·네트워크 재개를 바꾸지 않는다', () => {
    const a = factory(); const m = a.place('smelter', 8, 10, 0)!;
    a.setRecipe(m, 'iron-plate'); m.inBuf.set('iron-ore', 1000);
    const b = World.fromSnapshot(a.snapshot());
    const phases = new ActivityPhases(); a.onActivity = (e) => phases.record(e);
    for (let i = 0; i < 1200; i++) {
      if (i % 30 === 0) { a.buildings.get(m.id)!.outBuf.clear(); b.buildings.get(m.id)!.outBuf.clear(); }
      a.tick(); b.tick();
    }
    expect(phases.work.get(m.id)).toBeGreaterThan(0);
    expect(a.checksum()).toBe(b.checksum()); expect(a.serialize()).toEqual(b.serialize());
    const resumed = World.fromSnapshot(a.snapshot());
    expect(resumed.onActivity).toBeUndefined(); expect(resumed.checksum()).toBe(a.checksum());
  });

  it('기본·고급 차량의 절반 적재는 각자의 실제 용량을 기준으로 부분 그림이다', () => {
    const w = factory(); const basic = new Vehicle(1, 1, 1), advanced = new Vehicle(2, 1, 1);
    advanced.kind = 'advanced';
    expect(w.truckCapacity(advanced)).toBeGreaterThan(w.truckCapacity(basic));
    for (const v of [basic, advanced]) {
      const cap = w.truckCapacity(v);
      expect(cargoFrame(0, cap)).toBe(0); expect(cargoFrame(cap / 2, cap)).toBe(1); expect(cargoFrame(cap - 1, cap)).toBe(1); expect(cargoFrame(cap, cap)).toBe(2);
    }
  });

  it('차량 예약·재고 없음·하역 실패·충전 0에서 가짜 이동 사실을 내지 않는다', () => {
    const w = factory(); for (let x = 8; x <= 28; x++) w.place('road', x, 12, 0);
    const a = w.place('station', 10, 10, 0)!, b = w.place('station', 24, 10, 0)!; w.setStationMode(b, 'unload');
    const v = w.buildTruck(a)!; w.setRoute(v, a.id, b.id);
    const events: Activity[] = []; w.onActivity = (e) => events.push(e);
    v.battery = 0;
    for (let i = 0; i < 60 && v.receivedCharge <= 0; i++) w.tick();
    expect(v.receivedCharge).toBeGreaterThan(0);
    expect(events.some((e) => e.kind === 'charge' && e.amount > 0)).toBe(true);
    for (let i = 0; i < 120; i++) w.tick();
    expect(events.filter((e) => e.kind === 'cargo')).toEqual([]);
    events.length = 0; a.inBuf.set('iron-plate', 5);
    for (let i = 0; i < 120; i++) w.tick();
    expect(events.filter((e) => e.kind === 'cargo' && e.loading)).toHaveLength(5);
    expect(v.load).toBe(5);
    // 도착지 공간 없음: 실제 버퍼 삽입이 실패하므로 cargo 통지가 없다.
    v.state = 'unloading'; v.stop = 1; v.x = b.x + 1; v.y = 12.5; v.tile = w.idx(25, 12);
    b.outBuf.set('stone', 100000); events.length = 0;
    for (let i = 0; i < 30; i++) w.tick();
    expect(events.filter((e) => e.kind === 'cargo')).toEqual([]);
    expect(v.load).toBe(5);
    // 허브 공급 범위 밖에 있는 노선 없는 차량: 충전 대기 상태여도 받은 전기는 0.
    const st = w.place('station', 60, 10, 0)!; w.place('road', 60, 12, 0);
    const stranded = w.buildTruck(st)!; stranded.battery = 0; events.length = 0;
    for (let i = 0; i < 60; i++) w.tick();
    expect(events.filter((e) => e.kind === 'charge' && e.id === stranded.id)).toEqual([]);
    expect(stranded.receivedCharge).toBe(0);
  });
});

describe('표시 전선만 축약', () => {
  it('고리·발전기 전용 망을 포함해 실제 연결 성분을 보존하고 기존 대표선을 유지한다', () => {
    const edges: Wire[] = [[0, 0, 4, 0, 3], [4, 0, 4, 4, 3], [4, 4, 0, 0, 3], [30, 0, 34, 0, 0], [34, 0, 38, 0, 0]];
    const chosen = representativeWires(edges);
    expect(chosen.size).toBe(4);
    expect(chosen.has(wireKey(edges[3]))).toBe(true); expect(chosen.has(wireKey(edges[4]))).toBe(true);
    const extra: Wire = [0, 0, 1, 0, 3];
    const extended = representativeWires([...edges, extra], chosen);
    for (const key of chosen) expect(extended.has(key)).toBe(true);
    expect(extended.size).toBe(5);
    const removed = representativeWires(edges.filter((e) => wireKey(e) !== [...chosen][0]), chosen);
    expect(removed.size).toBe(4); // 실제 대체 간선으로 연결 유지
  });

  it('실제 발전기만 연결된 고리의 전체 간선을 노출하고 철거 판정은 그대로다', () => {
    const w = factory();
    const gens = [[50, 10], [56, 10], [53, 16]].map(([x, y]) => w.place('generator', x, y, 0)!);
    const nodes = new Set(gens.map((b) => `${b.x + 1},${b.y + 1}`));
    const edges = w.powerWires().filter((e) => nodes.has(`${e[0]},${e[1]}`) && nodes.has(`${e[2]},${e[3]}`));
    expect(edges).toHaveLength(3); expect(representativeWires(edges).size).toBe(2);
    const before = w.removalPreview(gens[0]);
    representativeWires(w.powerWires());
    expect(w.removalPreview(gens[0])).toEqual(before); expect(before?.split).toBe(1);
  });
});
