import { describe, expect, it } from 'vitest';
import { GRID } from '../data/buildings';
import { applyCommand } from './commands';
import { TICK_RATE, World, type SaveData } from './world';

/** 지역 전력: 전봇대로 이어진 전력망 (docs/전력망-연결-독립시작-개정.md) */

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

/** 허브(기준 칸 1,10)에서 오른쪽으로 12칸마다 전봇대 */
function poleLine(w: World, to: number, y = 10) {
  const out = [];
  for (let x = 13; x <= to; x += 12) out.push(w.place('pole', x, y, 0)!);
  return out;
}

describe('전봇대 연결 전력망', () => {
  it('허브는 반경 24칸: 밖의 기계는 노드가 없어 멈춘다', () => {
    const w = makeWorld();
    const near = busySmelter(w, 20, 10);
    const far = busySmelter(w, 30, 10);
    runBusy(w, [near, far], 3);
    expect(w.netOf(near)).toBe(w.netOf(w.hub!));
    expect(w.netOf(far)).toBe(0);
    expect(near.status).toBe('working');
    expect(far.status).toBe('no-power');
  });

  it('노드끼리 12칸이면 이어지고 13칸이면 따로 (공급원 없는 망은 공급 0)', () => {
    const w = makeWorld();
    const a = w.place('pole', 13, 10, 0)!; // 허브 기준 칸 (1,10)에서 12칸
    const b = w.place('pole', 14, 30, 0)!; // 어느 노드와도 13칸 넘게
    expect(w.netOf(a)).toBe(w.netOf(w.hub!));
    expect(w.netOf(b)).not.toBe(w.netOf(w.hub!));
    expect(w.netHasSource(w.netOf(b))).toBe(false);
    const m = busySmelter(w, 14, 31); // b 둘레 6칸 안
    runBusy(w, [m], 1);
    expect(w.netOf(m)).toBe(w.netOf(b));
    expect(m.status).toBe('no-power');
    const c = w.place('pole', 26, 10, 0)!; // a에서 13칸: 이어지지 않는다
    expect(w.netOf(c)).not.toBe(w.netOf(a));
  });

  it('총 확장 거리 한도는 없다: 12칸씩 이으면 허브에서 150칸 넘어도 공급된다', () => {
    const w = makeWorld();
    poleLine(w, 157);
    const m = busySmelter(w, 158, 12);
    runBusy(w, [m], 1);
    expect(w.netOf(m)).toBe(w.netOf(w.hub!));
    expect(m.status).toBe('working');
  });

  it('공급 범위만 겹친 망은 합쳐지지 않는다 (노드 사이 거리로만)', () => {
    const w = makeWorld();
    const g = w.place('generator', 40, 10, 0)!; // 기준 칸 (41,11): 허브에서 40칸
    g.fuel = 5;
    const p = w.place('pole', 30, 10, 0)!; // 발전기와 11칸 → 발전기 망, 허브와 29칸
    expect(w.netOf(p)).toBe(w.netOf(g));
    expect(w.netOf(g)).not.toBe(w.netOf(w.hub!));
    // 허브 범위(24칸)와 전봇대 범위(6칸)가 겹치는 칸의 기계는 가까운 노드 하나에만 접속
    const m = busySmelter(w, 24, 10); // 기준 칸 (25,11): 허브 24칸, 전봇대 5칸
    expect(w.netOf(m)).toBe(w.netOf(p));
  });

  it('짓는 순서와 상관없이 이어진다: A → (닿지 않는) C → 사이의 B, B를 철거하면 다시 끊긴다', () => {
    const w = makeWorld();
    w.place('pole', 13, 10, 0)!;
    const c = w.place('pole', 37, 10, 0)!;
    const m = busySmelter(w, 38, 12);
    expect(w.netHasSource(w.netOf(m))).toBe(false);
    const b = w.place('pole', 25, 10, 0)!;
    expect(w.netOf(m)).toBe(w.netOf(w.hub!));
    expect(w.netOf(c)).toBe(w.netOf(w.hub!));
    expect(w.powerWires()).toHaveLength(3); // 허브 - A - B - C
    expect(w.removalPreview(b)).toEqual({ cut: 2, split: 2, lost: 1 });
    w.remove(b);
    expect(w.netHasSource(w.netOf(m))).toBe(false);
    expect(w.powerCover()[w.idx(38, 10)]).toBe(2); // 이어져 있지만 공급원 없음
    expect(w.powerCover()[w.idx(13, 10)]).toBe(1);
  });

  it('고리: 간선 하나를 뜯어도 다른 길이 남아 망이 나뉘지 않는다', () => {
    const w = makeWorld();
    // 허브 → (13,10) → (13,22) → (1,22) → 허브 (사각 고리)
    const a = w.place('pole', 13, 10, 0)!;
    const b = w.place('pole', 13, 22, 0)!;
    const c = w.place('pole', 1, 22, 0)!;
    const far = w.place('pole', 25, 22, 0)!;
    expect(w.netOf(far)).toBe(w.netOf(w.hub!));
    expect(w.removalPreview(a)!.lost).toBe(0);
    w.remove(a);
    expect(w.netOf(b)).toBe(w.netOf(w.hub!));
    expect(w.netOf(c)).toBe(w.netOf(w.hub!));
    expect(w.netOf(far)).toBe(w.netOf(w.hub!));
  });

  it('같은 망은 부족을 함께 겪고, 다른 망은 영향이 없다', () => {
    const w = makeWorld();
    const hubMachines = [0, 1, 2, 3, 4, 5].map((k) => busySmelter(w, 5 + k * 3, 15)); // 6 × 90 = 540 > 400
    const g = w.place('generator', 80, 10, 0)!;
    g.fuel = 5;
    const m = busySmelter(w, 84, 14);
    runBusy(w, [...hubMachines, m], 2);
    expect(w.netState.get(w.netOf(w.hub!))!.satisfaction).toBeCloseTo(400 / 540, 2);
    expect(w.netState.get(w.netOf(m))!.satisfaction).toBe(1);
    expect(m.status).toBe('working');
    // 석탄 발전기 망을 허브 망에 전봇대로 이으면 한 망: 둘 다 제 속도 (석탄이 허브 쪽 부족도 메운다)
    poleLine(w, 73);
    runBusy(w, [...hubMachines, m], 1);
    g.fuel = 5;
    expect(w.netOf(m)).toBe(w.netOf(w.hub!));
    expect(w.netState.get(w.netOf(m))!.satisfaction).toBeCloseTo(1, 6);
    expect(g.load).toBeCloseTo(540 + 90 - 400, 3);
  });

  it('거점과 전력망은 따로: 이어도 거점 수·실적은 그대로, 20칸 안 발전기는 기존 거점에 묶인다', () => {
    const w = makeWorld();
    expect(w.zones).toHaveLength(1);
    const g = w.place('generator', 80, 10, 0)!;
    expect(w.zones).toHaveLength(2);
    const site = w.zones[1];
    expect([site.x, site.y, site.creator]).toEqual([81, 11, g.id]);
    const g2 = w.place('generator', 90, 10, 0)!; // 맨해튼 10칸: 같은 거점
    expect(g2.zone).toBe(site.id);
    const m = busySmelter(w, 84, 14);
    expect(m.zone).toBe(site.id);
    g.fuel = 5;
    runBusy(w, [m], 2);
    const work = w.stats.zoneWork.get(site.id)!;
    expect(work).toBeGreaterThan(0);
    poleLine(w, 73);
    runBusy(w, [m], 1);
    expect(w.zones).toHaveLength(2);
    expect(m.zone).toBe(site.id);
    expect(w.stats.zoneWork.get(site.id)!).toBeGreaterThan(work);
    w.remove(g);
    expect(w.zones.find((x) => x.id === site.id)).toBeDefined(); // 기준 설비를 뜯어도 거점은 남는다
  });

  it('변전소는 전봇대 없이 18칸 공급하고, 발전량은 늘리지 않는다', () => {
    const w = makeWorld();
    const s = w.place('substation', 12, 10, 0)!; // 기준 칸 (13,11): 허브와 12칸
    expect(w.netOf(s)).toBe(w.netOf(w.hub!));
    const m = busySmelter(w, 29, 10); // 기준 칸 (30,11): 변전소에서 17칸, 허브에서 29칸
    runBusy(w, [m], 1);
    expect(w.netOf(m)).toBe(w.netOf(w.hub!));
    expect(m.status).toBe('working');
    expect(w.netState.get(w.netOf(m))!.nonfuel).toBe(400);
    expect(w.stats.formalWork).toBeGreaterThan(0); // MG16: 변전소에 접속한 기계의 작업
  });

  it('접속 노드: 닿는 동안 유지하고, 범위 안 다른 노드로 직접 바꿀 수 있다', () => {
    const w = makeWorld();
    const lone = w.place('generator', 30, 20, 0)!; // 따로 떨어진 석탄 발전기 망 (기준 칸 31,21)
    lone.fuel = 5;
    const m = busySmelter(w, 22, 18); // 기준 칸 (23,19): 허브 22칸, 발전기 8칸 → 가까운 발전기
    expect(w.netOf(m)).toBe(w.netOf(lone)); // 접속 노드는 배치가 바뀐 뒤 처음 물을 때 정한다
    expect(m.node).toBe(lone.id);
    const choices = w.nodeChoices(m).map((c) => c.id);
    expect(choices).toContain(w.hub!.id);
    expect(applyCommand(w, 0, { t: 'power-node', id: m.id, node: w.hub!.id }).ok).toBe(true);
    expect(w.netOf(m)).toBe(w.netOf(w.hub!));
    // 더 가까운 노드가 새로 생겨도 지금 노드가 닿는 동안은 그대로
    w.place('pole', 24, 22, 0);
    expect(w.netOf(m)).toBe(w.netOf(w.hub!));
    expect(m.node).toBe(w.hub!.id);
    expect(applyCommand(w, 0, { t: 'power-node', id: m.id, node: 999 }).ok).toBe(false);
  });

  it('외부 전력 없이 시작: 실물 석탄을 넣은 발전기 하나로 현지 기계가 돈다', () => {
    const w = makeWorld();
    const g = w.place('generator', 120, 30, 0)!;
    const m = busySmelter(w, 124, 33);
    runBusy(w, [m], 1);
    expect(m.status).toBe('low-power'); // 발전기는 있지만 연료가 없으면 공급 0
    g.fuel = 2; // 하역기·벨트로 들어온 실물 석탄
    runBusy(w, [m], 2);
    expect(m.status).toBe('working');
  });
});

describe('차량 충전 예산', () => {
  it('거점 기본 400kW: 고급 트럭 두 대면 먼저 온 한 대만, 예산을 올리면 둘 다', () => {
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
    // 예산은 둘 다 받지만 허브 망 전력이 400kW뿐이라 같은 비율로 200kW씩
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

describe('축전·연료·지열', () => {
  it('축전기: 남는 비연료 전기로 95% 충전, 모자랄 때 최대 200kW 방전 (10%는 남김)', () => {
    const w = makeWorld();
    const a = w.place('accumulator', 6, 20, 0)!;
    run(w, 10);
    expect(a.energy).toBeCloseTo(200 * 10 * 0.95, -1);
    a.energy = GRID.accumulator.capacity * 0.5;
    const list = [0, 1, 2, 3, 4, 5].map((k) => busySmelter(w, 5 + k * 3, 14)); // 540kW
    runBusy(w, list, 1);
    const ns = w.netState.get(w.netOf(w.hub!))!;
    expect(ns.discharge).toBeCloseTo(140, 3);
    expect(ns.satisfaction).toBeCloseTo(1, 6);
    a.energy = GRID.accumulator.capacity * 0.1;
    runBusy(w, list, 0.1);
    expect(w.netState.get(w.netOf(w.hub!))!.discharge).toBe(0);
  });

  it('축전기 두 대는 쓸 수 있는 양 비율로 나눠 방전한다 (한 틱에 한 방향만)', () => {
    const w = makeWorld();
    const a = w.place('accumulator', 6, 20, 0)!;
    const b = w.place('accumulator', 10, 20, 0)!;
    a.energy = GRID.accumulator.capacity;
    b.energy = GRID.accumulator.capacity * 0.1 + 50 * (1 / TICK_RATE);
    const list = [0, 1, 2, 3, 4, 5].map((k) => busySmelter(w, 5 + k * 3, 14)); // 140kW 부족
    runBusy(w, list, 1 / TICK_RATE);
    expect(a.load).toBeLessThan(0);
    expect(b.load).toBeLessThan(0);
    expect(-a.load - b.load).toBeCloseTo(140, 3);
    expect(-a.load / -b.load).toBeCloseTo(200 / 50, 3);
  });

  it('연료 발전기: 뒤 가운데 칸으로 정유 연료만 받고, 부족분만 태운다', () => {
    const w = makeWorld();
    const f = w.place('fuel-generator', 80, 10, 2)!;
    const belt = w.place('belt', 81, 9, 2)!;
    belt.items.push({ item: 'fuel', pos: 1, n: 1 });
    const bad = w.place('belt', 80, 9, 2)!;
    bad.items.push({ item: 'fuel', pos: 1, n: 1 });
    run(w, 1);
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
    expect(w.netState.get(w.netOf(g))!.nonfuel).toBe(GRID.geothermal);
  });

  it('다른 생산 거점(20칸 이상)의 발전원이 준 작업 전기는 거점 간 기여로 센다 (F30·CG03)', () => {
    const w = makeWorld();
    w.vents.push(w.idx(61, 11));
    w.place('geothermal', 60, 10, 0); // 지열 거점 (기준 칸 61,11)
    poleLine(w, 49);
    const m = busySmelter(w, 14, 14); // 허브 거점의 기계 (허브 망 = 지열 망)
    expect(w.netOf(m)).toBe(w.netOf(w.hub!));
    // 허브 거점이 생산 거점이 되도록 (생산 10개·작업 1MJ)
    w.stats.zoneMade.set(m.zone, 10);
    w.stats.zoneWork.set(m.zone, 1000);
    runBusy(w, [m], 2);
    // 허브 400kW와 지열 1.8MW가 함께 90kW를 낸다: 지열 몫 = 90 × 1800/2200
    expect(w.ach.get('e:link')).toBeCloseTo(90 * (1800 / 2200) * 2, -1);
    expect(w.stats.linkWork).toBeCloseTo(90 * (1800 / 2200) * 2, -1);
  });
});

describe('저장·호환', () => {
  it('저장·중간 참가 뒤에도 망·접속·축전량이 같고 매 틱 해시가 같다', () => {
    const w = makeWorld();
    const g = w.place('generator', 80, 10, 0)!;
    g.fuel = 4;
    poleLine(w, 73);
    w.place('accumulator', 6, 24, 0);
    const m = busySmelter(w, 84, 14);
    runBusy(w, [m], 3);
    const c = World.fromSnapshot(JSON.parse(JSON.stringify(w.snapshot())));
    expect(c.checksum()).toBe(w.checksum());
    const cm = c.buildings.get(m.id)!;
    for (let s = 0; s < 120; s++) {
      for (const [world, b] of [
        [w, m],
        [c, cm],
      ] as const) {
        b.inBuf.set('iron-ore', 100);
        b.outBuf.clear();
        world.tick();
      }
      expect(c.checksum(), `${s}`).toBe(w.checksum());
    }
    const loaded = World.deserialize(JSON.parse(JSON.stringify(w.serialize())));
    expect(loaded.zones).toEqual(w.zones);
    expect(loaded.buildings.get(m.id)!.node).toBe(m.node);
    expect(loaded.netOf(loaded.buildings.get(m.id)!)).toBe(w.netOf(m));
    expect(loaded.loadNote).toBe('');
  });

  it('송전 터미널 시제품 저장: 터미널을 걷어 내고 재료를 돌려주며, 그렇게 했다고 알린다', () => {
    const w = makeWorld();
    const m = busySmelter(w, 14, 14);
    const data = JSON.parse(JSON.stringify(w.serialize())) as SaveData;
    delete data.grid;
    for (const b of data.buildings) if (b.id === m.id) delete b.zone;
    data.buildings.push({ ...data.buildings.find((b) => b.id === m.id)!, id: 9999, type: 'terminal' as never, x: 40, y: 40, send: true, cable: 3 });
    const steel = w.stockOf('steel');
    const loaded = World.deserialize(data);
    expect(loaded.buildings.has(9999)).toBe(false);
    expect(loaded.stockOf('steel')).toBe(steel + 16);
    expect(loaded.stockOf('hc-cable')).toBe(w.stockOf('hc-cable') + 6 + 3);
    expect(loaded.loadNote).toContain('송전 터미널 1대');
    expect(loaded.buildings.get(m.id)!.zone).toBe(loaded.zones[0].id);
  });

  it('예전 세계는 망 없이 공장 전체 전력 (그대로)', () => {
    const w = new World(60, 30);
    w.createHub(0, 9);
    w.stock.set('stone', 100);
    expect(w.zones).toHaveLength(0);
    const m = busySmelter(w, 40, 10); // 허브에서 멀어도 돈다
    for (const t of w.techs) w.applyTech(t.id);
    runBusy(w, [m], 1);
    expect(m.status).toBe('working');
    expect(w.serialize().grid).toBeUndefined();
  });
});
