import { describe, expect, it } from 'vitest';
import { GRID } from '../data/buildings';
import { applyCommand } from './commands';
import { TICK_RATE, World } from './world';

/** 지역 전력 (docs/지형-운송-전력-상세기획.md §9~11) */

function makeWorld(width = 200, height = 60): World {
  const w = new World(width, height);
  w.rules = 'regional-v1';
  w.createHub(0, 9);
  for (const t of w.techs) w.applyTech(t.id);
  for (const item of ['iron-plate', 'gear', 'stone', 'steel', 'circuit', 'wood', 'copper-wire', 'motor', 'insulated-wire', 'aluminum-plate', 'hc-cable', 'controller', 'battery-pack', 'brick', 'coal', 'bronze', 'concrete'] as const) {
    w.stock.set(item, 5000);
  }
  return w;
}

function run(w: World, seconds: number) {
  for (let i = 0; i < Math.round(seconds * TICK_RATE); i++) w.tick();
}

/** 계속 도는 제련로 (철광석을 넉넉히 넣고 출력은 매번 비운다) */
function busySmelter(w: World, x: number, y: number) {
  const b = w.place('smelter', x, y, 0)!;
  w.setRecipe(b, 'iron-plate');
  b.inBuf.set('iron-ore', 10000);
  return b;
}

function runBusy(w: World, list: ReturnType<typeof busySmelter>[], seconds: number) {
  for (let i = 0; i < Math.round(seconds * TICK_RATE); i++) {
    for (const b of list) {
      b.outBuf.clear();
      b.inBuf.set('iron-ore', 100);
    }
    w.tick();
  }
}

describe('전력 구역과 배전', () => {
  it('허브 구역은 반경 24칸: 밖의 기계는 전력이 없어 멈춘다', () => {
    const w = makeWorld();
    expect(w.zones).toHaveLength(1);
    const near = busySmelter(w, 20, 10);
    const far = busySmelter(w, 30, 10);
    runBusy(w, [near, far], 3);
    expect(w.zoneOf(near)?.hub).toBe(true);
    expect(w.zoneOf(far)).toBeNull();
    expect(near.status).toBe('working');
    expect(far.status).toBe('no-power');
    expect(far.stats.age).toBeGreaterThan(0);
  });

  it('전봇대는 12칸씩 이어서 둘레 6칸에, 허브 중심 40칸(확장 한계)까지만', () => {
    const w = makeWorld();
    for (const x of [13, 25, 37]) expect(w.place('pole', x, 10, 0)).not.toBeNull();
    const a = busySmelter(w, 38, 12); // 기준 칸 (39,13): 허브(1,10)에서 38칸
    const b = busySmelter(w, 42, 12); // 42칸: 한계 밖
    expect(w.zoneOf(a)?.hub).toBe(true);
    expect(w.zoneOf(b)).toBeNull();
    // 이어지지 않은 전봇대 (마지막 노드에서 12칸 넘게)는 공급하지 않는다
    const lone = w.place('pole', 60, 30, 0)!;
    expect(lone.zone).toBe(0);
  });

  it('공급 범위 밖에 놓은 발전기는 새 구역을 만들고, 철거해도 구역 중심·id는 남는다', () => {
    const w = makeWorld();
    const g = w.place('generator', 80, 10, 0)!;
    expect(w.zones).toHaveLength(2);
    const z = w.zones[1];
    expect([z.x, z.y, z.creator]).toEqual([81, 11, g.id]);
    const g2 = w.place('generator', 84, 10, 0)!;
    expect(g2.zone).toBe(z.id); // 범위 안이면 그 구역에 붙는다
    w.remove(g);
    expect(w.zones.find((x) => x.id === z.id)).toBeDefined();
  });

  it('구역끼리는 따로: 허브 구역이 과부하여도 석탄 구역 기계는 제 속도', () => {
    const w = makeWorld();
    const hubMachines = [0, 1, 2, 3, 4, 5].map((k) => busySmelter(w, 5 + k * 3, 15)); // 6 × 90 = 540 > 400
    const g = w.place('generator', 80, 10, 0)!;
    g.fuel = 5;
    const m = busySmelter(w, 84, 14);
    runBusy(w, [...hubMachines, m], 2);
    g.fuel = 5;
    const hubZone = w.zoneState.get(w.zoneOf(hubMachines[0])!.id)!;
    expect(hubZone.satisfaction).toBeCloseTo(400 / 540, 2);
    expect(w.zoneState.get(w.zoneOf(m)!.id)!.satisfaction).toBe(1);
    expect(m.status).toBe('working');
  });

  it('변전소로 정식 구역: 처리 6MW, 확장 한계 36칸', () => {
    const w = makeWorld();
    w.place('generator', 80, 10, 0);
    const z = w.zones[1];
    expect(w.zoneCap(z)).toBe(GRID.local.cap);
    expect(w.zoneLimit(z)).toBe(28);
    const s = w.place('substation', 86, 10, 0)!;
    expect(s.zone).toBe(z.id);
    expect(w.zoneCap(z)).toBe(GRID.formal.cap);
    expect(w.zoneLimit(z)).toBe(36);
  });
});

describe('차량 충전 예산', () => {
  it('구역 기본 400kW: 고급 트럭 두 대면 먼저 온 한 대만, 예산을 올리면 둘 다', () => {
    const w = makeWorld();
    w.researched.delete('battery');
    for (let x = 4; x <= 14; x++) w.place('road', x, 20, 0);
    const st = w.place('station', 8, 18, 0)!;
    st.inBuf.set('truck-kit', 2);
    const a = w.vehicles.get(applyCommand(w, 0, { t: 'build-adv-truck', rid: 'a', station: st.id, key: '' }).vehicle!)!;
    const b = w.vehicles.get(applyCommand(w, 0, { t: 'build-adv-truck', rid: 'b', station: st.id, key: '' }).vehicle!)!;
    run(w, 1);
    expect(a.battery).toBeCloseTo(400, 0);
    expect(b.battery).toBe(0);
    expect(applyCommand(w, 0, { t: 'zone-budget', zone: w.zones[0].id, kw: 800 })).toBe(true);
    run(w, 1);
    // 예산은 둘 다 받지만 허브 구역 전력이 400kW뿐이라 같은 비율로 200kW씩
    expect(b.battery).toBeCloseTo(200, 0);
    expect(a.battery).toBeCloseTo(600, 0);
  });

  it('공급 범위 밖 정류장에서는 0kJ로 기다린다 (V06: 전력 0에서도 조립은 된다)', () => {
    const w = makeWorld();
    for (let x = 60; x <= 66; x++) w.place('road', x, 20, 0);
    const st = w.place('station', 62, 18, 0)!;
    st.inBuf.set('truck-kit', 1);
    const r = applyCommand(w, 0, { t: 'build-adv-truck', rid: 'x', station: st.id, key: '' });
    expect(r.ok).toBe(true);
    run(w, 3);
    expect(w.vehicles.get(r.vehicle!)!.battery).toBe(0);
  });
});

describe('송전·축전·연료', () => {
  /** 허브 구역(보냄) → 오른쪽 석탄 발전기 구역(받음, 연료 없음) */
  function linked() {
    const w = makeWorld();
    const g = w.place('generator', 80, 10, 0)!; // 연료 없는 발전기: 구역만 만든다
    const send = w.place('terminal', 10, 20, 0)!;
    const recv = w.place('terminal', 82, 14, 0)!;
    const m = busySmelter(w, 84, 10);
    return { w, g, send, recv, m };
  }

  it('보낸 쪽 95% 효율로 받는 쪽 부족분만, 케이블은 거리÷8 올림', () => {
    const { w, send, recv, m } = linked();
    const cables = w.stockOf('hc-cable');
    const r = applyCommand(w, 0, { t: 'power-link', id: send.id, target: recv.id });
    expect(r.ok).toBe(true);
    const dist = Math.abs(83 - 11) + Math.abs(15 - 21);
    expect(w.stockOf('hc-cable')).toBe(cables - Math.ceil(dist / 8));
    runBusy(w, [m], 2);
    const zr = w.zoneState.get(w.zoneOf(recv)!.id)!;
    expect(zr.received).toBeCloseTo(90, 3);
    expect(zr.satisfaction).toBeCloseTo(1, 6);
    expect(w.linkFlow.get(send.id)).toBeCloseTo(90 / 0.95, 3);
    expect(w.zoneState.get(w.zoneOf(send)!.id)!.sent).toBeCloseTo(90 / 0.95, 3);
    expect(m.status).toBe('working');
  });

  it('같은 구역·순환 연결은 막고, 끊거나 철거하면 케이블을 돌려준다', () => {
    const { w, send, recv } = linked();
    const back = w.place('terminal', 86, 14, 0)!;
    const home = w.place('terminal', 14, 20, 0)!;
    expect(applyCommand(w, 0, { t: 'power-link', id: recv.id, target: back.id }).ok).toBe(false); // 같은 구역
    const cables = w.stockOf('hc-cable');
    expect(applyCommand(w, 0, { t: 'power-link', id: send.id, target: recv.id }).ok).toBe(true);
    expect(applyCommand(w, 0, { t: 'power-link', id: back.id, target: home.id }).reason).toContain('돌아서');
    w.remove(send);
    expect(w.stockOf('hc-cable')).toBe(cables + 6); // 이을 때 낸 케이블은 돌려받고, 터미널 건설비 6개도
    expect(recv.partner).toBe(0);
  });

  it('축전기: 남는 비연료 전기로 95% 충전, 모자랄 때 최대 200kW 방전 (10%는 남김)', () => {
    const w = makeWorld();
    const a = w.place('accumulator', 6, 20, 0)!;
    run(w, 10);
    expect(a.energy).toBeCloseTo(200 * 10 * 0.95, -1);
    a.energy = GRID.accumulator.capacity * 0.5;
    const list = [0, 1, 2, 3, 4, 5].map((k) => busySmelter(w, 5 + k * 3, 14)); // 540kW
    runBusy(w, list, 1);
    const zs = w.zoneState.get(w.zones[0].id)!;
    expect(zs.discharge).toBeCloseTo(140, 3);
    expect(zs.satisfaction).toBeCloseTo(1, 6);
    a.energy = GRID.accumulator.capacity * 0.1;
    runBusy(w, list, 0.1);
    expect(w.zoneState.get(w.zones[0].id)!.discharge).toBe(0);
  });

  it('연료 발전기: 뒤 가운데 칸으로 정유 연료만 받고, 부족분만 태운다', () => {
    const w = makeWorld();
    const f = w.place('fuel-generator', 80, 10, 2)!; // 구역을 만든다
    const belt = w.place('belt', 81, 9, 2)!;
    belt.items.push({ item: 'fuel', pos: 1, n: 1 });
    const bad = w.place('belt', 80, 9, 2)!;
    bad.items.push({ item: 'fuel', pos: 1, n: 1 });
    run(w, 1);
    // 들어온 1개는 바로 연소실로 (energy), 지정 칸이 아닌 쪽은 못 넣는다
    expect(f.fuel + (f.energy > 0 ? 1 : 0)).toBe(1);
    expect(bad.items).toHaveLength(1);
    const m = busySmelter(w, 84, 10);
    runBusy(w, [m], 3);
    expect(m.status).toBe('working');
    expect(f.energy).toBeCloseTo(6000 - 90 * 3, -1); // 부족분 90kW만 태운다
    expect(f.load).toBeCloseTo(90, 3);
  });

  it('지열 발전소는 분출구 위에만, 연료 없이 1.8MW', () => {
    const w = makeWorld();
    w.vents.push(w.idx(91, 31));
    expect(w.canPlace('geothermal', 80, 30).ok).toBe(false);
    const g = w.place('geothermal', 90, 30, 0)!;
    run(w, 0.1);
    expect(w.zoneState.get(w.zoneOf(g)!.id)!.nonfuel).toBe(GRID.geothermal);
  });

  it('저장·중간 참가 뒤에도 구역·연결·축전량이 같고 매 틱 해시가 같다', () => {
    const { w, send, recv, m } = linked();
    w.place('accumulator', 6, 24, 0);
    applyCommand(w, 0, { t: 'power-link', id: send.id, target: recv.id });
    runBusy(w, [m], 3);
    const g = World.fromSnapshot(JSON.parse(JSON.stringify(w.snapshot())));
    expect(g.checksum()).toBe(w.checksum());
    const gm = g.buildings.get(m.id)!;
    for (let s = 0; s < 120; s++) {
      for (const [world, b] of [
        [w, m],
        [g, gm],
      ] as const) {
        b.inBuf.set('iron-ore', 100);
        b.outBuf.clear();
        world.tick();
      }
      expect(g.checksum(), `${s}`).toBe(w.checksum());
    }
    const loaded = World.deserialize(JSON.parse(JSON.stringify(w.serialize())));
    expect(loaded.zones).toEqual(w.zones);
    expect(loaded.buildings.get(send.id)!.partner).toBe(recv.id);
  });

  it('예전 세계는 구역 없이 공장 전체 전력 (그대로)', () => {
    const w = new World(60, 30);
    w.createHub(0, 9);
    w.stock.set('stone', 100);
    expect(w.zones).toHaveLength(0);
    const m = busySmelter(w, 40, 10); // 허브에서 멀어도 돈다
    for (const t of w.techs) w.applyTech(t.id);
    runBusy(w, [m], 1);
    expect(m.status).toBe('working');
  });
});
