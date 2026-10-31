import { describe, expect, it } from 'vitest';
import type { ItemId } from '../data/items';
import { countOf, type Building } from './building';
import { applyCommand } from './commands';
import { TICK_RATE, World, groupKey } from './world';

/** 정류장 연결 창고와 다품목 예약 운송 (docs/물류-회수-운영규칙.md §4~10) */

function run(w: World, seconds: number) {
  for (let i = 0; i < Math.round(seconds * TICK_RATE); i++) w.tick();
}

/**
 * 허브 구역 안: 싣기 정류장 A (10,10) + 오른쪽 창고(연결), 내리기 정류장 B (24,10) + 오른쪽 창고(연결).
 * 아래 y=12 도로로 잇고 기본 트럭 1대 (A → B)
 */
function yard() {
  const w = new World(40, 30);
  w.rules = 'regional-v1';
  w.createHub(0, 0);
  for (const t of w.techs) w.applyTech(t.id);
  for (const item of ['iron-plate', 'gear', 'stone', 'steel', 'circuit'] as const) w.stock.set(item, 5000);
  for (let x = 8; x <= 28; x++) w.place('road', x, 12, 0);
  const a = w.place('station', 10, 10, 0)!;
  const sa = w.place('storage', 12, 10, 0)!;
  const b = w.place('station', 24, 10, 0)!;
  const sb = w.place('storage', 26, 10, 0)!;
  w.setStationMode(b, 'unload');
  expect(applyCommand(w, 0, { t: 'station-dock', id: a.id, storage: sa.id })).toBe(true);
  expect(applyCommand(w, 0, { t: 'station-dock', id: b.id, storage: sb.id })).toBe(true);
  const v = w.buildTruck(a)!;
  applyCommand(w, 0, { t: 'route', id: v.id, stops: [{ id: a.id, act: 'load' }, { id: b.id, act: 'unload' }] });
  return { w, a, sa, b, sb, v };
}

/** cond가 참이 될 때까지 (최대 seconds초) */
function runUntil(w: World, cond: () => boolean, seconds = 60) {
  for (let i = 0; i < seconds * TICK_RATE && !cond(); i++) w.tick();
  expect(cond()).toBe(true);
}

/** 풀(정류장 + 연결 창고)의 개수 */
const pool = (w: World, st: Building, item: ItemId) => w.poolCount(st, item);

describe('연결 창고와 계획 적재', () => {
  it('한 품목이 모자라도 나머지는 상한대로: 모터 6 + 케이블 20 + 배터리 10 = 36개를 싣고 떠난다', () => {
    const { w, a, sa, b, v } = yard();
    sa.inBuf.set('motor', 6);
    sa.inBuf.set('hc-cable', 30);
    a.inBuf.set('battery-pack', 30);
    expect(
      applyCommand(w, 0, {
        t: 'truck-plan',
        id: v.id,
        plan: [
          { item: 'motor', cap: 20 },
          { item: 'hc-cable', cap: 20 },
          { item: 'battery-pack', cap: 10 },
        ],
        period: 0,
        early: false,
      }),
    ).toBe(true);
    runUntil(w, () => v.stop === 1);
    expect([countOf(v.cargo, 'motor'), countOf(v.cargo, 'hc-cable'), countOf(v.cargo, 'battery-pack')]).toEqual([6, 20, 10]);
    expect(pool(w, a, 'hc-cable')).toBe(10);
    // 실은 만큼 목적지 입고 예약, 출고 예약은 끝
    expect(w.inReserved(b)).toBe(36);
    expect(w.reservations.filter((r) => r.dir === 'out')).toEqual([]);
    // 다 내리고 돌아서면 (다음 편은 남은 재고로 또 간다)
    runUntil(w, () => v.stop === 0);
    expect(pool(w, b, 'motor') + pool(w, b, 'hc-cable') + pool(w, b, 'battery-pack')).toBe(36);
    expect(w.inReserved(b)).toBe(0);
  });

  it('상한 합계가 적재량을 넘는 계획은 받지 않는다', () => {
    const { w, v } = yard();
    expect(
      applyCommand(w, 0, { t: 'truck-plan', id: v.id, plan: [{ item: 'motor', cap: 40 }, { item: 'tire', cap: 20 }], period: 0, early: false }),
    ).toBe(false);
  });

  it.each([
    [{ item: 'motor', cap: 0 }],
    [{ item: 'motor', cap: -1 }],
    [{ item: 'motor', cap: 1.5 }],
    [{ item: 'motor', cap: 10 }, { item: 'unknown', cap: 1 }],
    [{ item: 'motor', cap: 10 }, { item: 'motor', cap: 10 }],
  ])('잘못된 계획 %j는 일부만 적용하지 않고 기존 계획과 예약을 그대로 둔다', (...entries) => {
    const { w, a, v } = yard();
    a.inBuf.set('motor', 30);
    w.setPlan(v, [{ item: 'motor', cap: 20 }], 60, true);
    runUntil(w, () => v.load > 0);
    const before = w.serialize(), hash = w.checksum();
    expect(applyCommand(w, 0, { t: 'truck-plan', id: v.id, plan: entries as {item: ItemId; cap: number}[], period: 0, early: false })).toBe(false);
    expect(w.serialize()).toEqual(before);
    expect(w.checksum()).toBe(hash);
  });

  it('적재 중 계획을 바꿔도 실은 화물과 남은 출고량이 목적지 입고 예정에 정확히 포함된다', () => {
    const { w, a, b, v } = yard();
    a.inBuf.set('motor', 40);
    w.setTarget(b, 'motor', 40);
    w.setPlan(v, [{ item: 'motor', cap: 40 }], 0, false);
    runUntil(w, () => v.load >= 5);
    w.setPlan(v, [{ item: 'motor', cap: 40 }], 0, false);
    expect(w.inReserved(b, 'motor')).toBe(v.load);
    w.tick();
    const pending = w.reservations.filter(r => r.v === v.id && r.dir === 'out' && r.item === 'motor').reduce((n,r) => n+r.n,0);
    expect(w.inReserved(b, 'motor')).toBe(v.load + pending);
    expect(w.requestOf(b, 'motor')).toBe(0);
    runUntil(w, () => v.stop === 1);
    expect(v.load).toBe(40);
    expect(w.inReserved(b, 'motor')).toBe(40);
  });

  it('계획 재예약 뒤 다른 트럭이 같은 목적지 요청을 중복 예약하지 않는다', () => {
    const { w, a, b, v } = yard();
    a.inBuf.set('motor', 80);
    w.setTarget(b, 'motor', 40);
    w.setPlan(v, [{ item: 'motor', cap: 40 }], 0, false);
    runUntil(w, () => v.load >= 5);
    w.setPlan(v, [{ item: 'motor', cap: 40 }], 0, false);
    const other = w.buildTruck(a)!;
    w.setStops(other, [{ id: a.id, act: 'load' }, { id: b.id, act: 'unload' }]);
    w.setPlan(other, [{ item: 'motor', cap: 40 }], 0, false);
    run(w, 2);
    expect(w.inReserved(b, 'motor')).toBe(40);
    expect(other.load).toBe(0);
    const loaded = v.load, reserved = w.inReserved(b, 'motor');
    const copy = World.fromSnapshot(w.snapshot());
    expect(copy.inReserved(copy.buildings.get(b.id)!, 'motor')).toBe(reserved);
    expect(copy.vehicles.get(v.id)!.load).toBe(loaded);
    runUntil(w, () => pool(w, b, 'motor') === 40);
    expect(pool(w, b, 'motor') + w.inReserved(b, 'motor')).toBe(40);
  });

  it('계획을 끄면 미적재 물량의 입고·출고 예약을 즉시 풀고 실제 화물은 보존한다', () => {
    const { w, a, b, v } = yard();
    a.inBuf.set('motor', 40);
    w.setPlan(v, [{ item: 'motor', cap: 40 }], 0, false);
    runUntil(w, () => v.load >= 5);
    const cargo = [...v.cargo];
    expect(w.inReserved(b)).toBe(40);
    expect(w.setPlan(v, [], 0, false)).toBe(true);
    expect(w.reservations.filter(r => r.v === v.id)).toEqual([]);
    expect([...v.cargo]).toEqual(cargo);
  });

  it('목적지 요청 = 목표 - 실물 - 입고 예정: 목표 40·실물 20이면 20만 싣는다', () => {
    const { w, a, b, sb, v } = yard();
    a.inBuf.set('motor', 50);
    sb.inBuf.set('motor', 20);
    applyCommand(w, 0, { t: 'station-target', id: b.id, item: 'motor', n: 40 });
    applyCommand(w, 0, { t: 'truck-plan', id: v.id, plan: [{ item: 'motor', cap: 40 }], period: 0, early: false });
    expect(w.requestOf(b, 'motor')).toBe(20);
    runUntil(w, () => v.stop === 1);
    expect(countOf(v.cargo, 'motor')).toBe(20);
    expect(w.requestOf(b, 'motor')).toBe(0);
  });

  it('목표를 이미 채웠으면 빈 편을 생략하고 출발하지 않는다', () => {
    const { w, a, b, sb, v } = yard();
    a.inBuf.set('motor', 50);
    sb.inBuf.set('motor', 40);
    applyCommand(w, 0, { t: 'station-target', id: b.id, item: 'motor', n: 40 });
    applyCommand(w, 0, { t: 'truck-plan', id: v.id, plan: [{ item: 'motor', cap: 40 }], period: 120, early: false });
    for (let i = 0; i < 3 * TICK_RATE && v.status !== 'satisfied'; i++) w.tick();
    expect(v.status).toBe('satisfied');
    run(w, 3);
    expect(v.status).toBe('scheduled');
    expect(v.load).toBe(0);
    expect(v.stop).toBe(0);
  });

  it('두 트럭이 같은 마지막 재고를 예약해도 실물보다 많이 잡지 않는다', () => {
    const { w, a, b, v } = yard();
    const v2 = w.buildTruck(a)!;
    applyCommand(w, 0, { t: 'route', id: v2.id, stops: [{ id: a.id, act: 'load' }, { id: b.id, act: 'unload' }] });
    a.inBuf.set('motor', 25);
    for (const t of [v, v2]) applyCommand(w, 0, { t: 'truck-plan', id: t.id, plan: [{ item: 'motor', cap: 20 }], period: 0, early: false });
    run(w, 1);
    const out = w.reservations.filter((r) => r.dir === 'out').reduce((n, r) => n + r.n, 0);
    expect(out + v.load + v2.load).toBeLessThanOrEqual(25);
    run(w, 10);
    expect(v.load + v2.load + pool(w, a, 'motor') + pool(w, b, 'motor')).toBe(25);
  });

  it('예약한 몫은 하역기·모듈 설치가 가져가지 않는다', () => {
    const { w, a, sa, v } = yard();
    sa.inBuf.set('module', 1);
    applyCommand(w, 0, { t: 'truck-plan', id: v.id, plan: [{ item: 'module', cap: 1 }], period: 0, early: false });
    // 트럭이 도착해 예약하기 직전까지
    for (let i = 0; i < 400 && !w.reservations.length; i++) w.tick();
    expect(w.reservedAt(sa, 'module')).toBe(1);
    const m = w.place('smelter', 12, 8, 0)!; // 창고 위에 맞닿음
    const r = applyCommand(w, 0, { t: 'module-install', rid: 'r1', id: m.id, storage: sa.id, key: groupKey(w.storageGroup(sa)) });
    expect(r.ok).toBe(false);
    expect(countOf(sa.inBuf, 'module') + v.load).toBe(1);
    expect(a).toBeDefined();
  });

  it('목적지가 꽉 차면 내릴 수 있는 만큼만 내리고 나머지는 출발 정류장으로 반송한다', () => {
    const { w, a, b, sb, v } = yard();
    a.inBuf.set('motor', 30);
    applyCommand(w, 0, { t: 'truck-plan', id: v.id, plan: [{ item: 'motor', cap: 30 }], period: 0, early: false });
    runUntil(w, () => v.stop === 1);
    expect(v.load).toBe(30);
    // 싣고 떠난 뒤 목적지 공간이 사라짐 (예약하지 않은 벨트 입고 등)
    b.outBuf.set('stone', 195);
    sb.inBuf.set('stone', 200);
    run(w, 40);
    const delivered = pool(w, b, 'motor');
    expect(delivered).toBe(5);
    expect(v.returning || v.stop === 0).toBe(true);
    run(w, 30);
    expect(v.returning).toBe(false);
    expect(v.load + pool(w, a, 'motor') + delivered + w.pileCount(w.idx(a.x, a.y), 'motor')).toBe(30);
    expect(w.reservations).toEqual([]);
  });

  it('가는 도중 목적지 정류장을 철거하면 실은 화물을 출발지로 반송한다 (배송 실적 없음)', () => {
    const { w, a, b, v } = yard();
    a.inBuf.set('motor', 20);
    applyCommand(w, 0, { t: 'truck-plan', id: v.id, plan: [{ item: 'motor', cap: 20 }], period: 0, early: false });
    runUntil(w, () => v.stop === 1);
    run(w, 0.5);
    w.remove(b);
    expect(w.reservations.filter((r) => r.dir === 'in')).toEqual([]);
    runUntil(w, () => v.load === 0, 30);
    expect(pool(w, a, 'motor')).toBe(20);
    expect(w.stats.delivered).toBe(0);
    expect(v.returning).toBe(false);
  });

  it('목적지를 싣기 정류장으로 바꾸면 계약이 끝나고 반송한다', () => {
    const { w, a, b, v } = yard();
    a.inBuf.set('motor', 20);
    applyCommand(w, 0, { t: 'truck-plan', id: v.id, plan: [{ item: 'motor', cap: 20 }], period: 0, early: false });
    runUntil(w, () => v.stop === 1);
    w.setStationMode(b, 'load');
    runUntil(w, () => v.load === 0 && v.stop === 0, 40);
    expect(pool(w, a, 'motor')).toBe(20);
    expect(countOf(b.inBuf, 'motor')).toBe(0);
  });

  it('일시정지: 실은 화물은 한 번 배송하고, 그다음은 빈 차로 기다린다', () => {
    const { w, a, b, v } = yard();
    a.inBuf.set('motor', 100);
    applyCommand(w, 0, { t: 'truck-plan', id: v.id, plan: [{ item: 'motor', cap: 20 }], period: 0, early: false });
    runUntil(w, () => v.stop === 1);
    expect(applyCommand(w, 0, { t: 'truck-pause', id: v.id, on: true })).toBe(true);
    run(w, 40);
    expect(pool(w, b, 'motor')).toBe(20);
    expect(v.load).toBe(0);
    expect(v.status).toBe('paused');
    expect(w.reservations).toEqual([]);
    applyCommand(w, 0, { t: 'truck-pause', id: v.id, on: false });
    runUntil(w, () => v.load > 0, 20);
  });

  it('화물 내려놓기: 지금 칸의 회수 더미로, 예약은 끝', () => {
    const { w, a, v } = yard();
    a.inBuf.set('motor', 20);
    applyCommand(w, 0, { t: 'truck-plan', id: v.id, plan: [{ item: 'motor', cap: 20 }], period: 0, early: false });
    runUntil(w, () => v.stop === 1);
    run(w, 1);
    const tile = v.tile;
    expect(applyCommand(w, 0, { t: 'truck-dump', id: v.id })).toBe(true);
    expect(v.load).toBe(0);
    expect(w.pileCount(tile, 'motor')).toBe(20);
    expect(w.reservations).toEqual([]);
  });

  it('길이 끊기면 목적지 입고 예약을 풀어 공간을 잠그지 않는다', () => {
    const { w, a, b, v } = yard();
    a.inBuf.set('motor', 20);
    applyCommand(w, 0, { t: 'truck-plan', id: v.id, plan: [{ item: 'motor', cap: 20 }], period: 0, early: false });
    runUntil(w, () => v.stop === 1);
    expect(w.inReserved(b)).toBe(20);
    for (let x = 17; x <= 19; x++) w.remove(w.buildingAt(x, 12)!);
    run(w, 3);
    expect(v.status).toBe('no-route');
    expect(w.inReserved(b)).toBe(0);
    expect(v.load).toBe(20);
  });

  it('정기편 120초: 예정 시각 10초 전부터 싣고, 예정 시각에 떠난다', () => {
    const { w, a, v } = yard();
    a.inBuf.set('motor', 100);
    applyCommand(w, 0, { t: 'truck-plan', id: v.id, plan: [{ item: 'motor', cap: 20 }], period: 120, early: false });
    v.nextDue = w.time + 30;
    run(w, 15);
    expect(v.status).toBe('scheduled');
    expect(v.load).toBe(0);
    run(w, 10);
    expect(v.load).toBe(20);
    expect(v.stop).toBe(0);
    run(w, 6);
    expect(v.stop).toBe(1);
  });

  it('저장·중간 참가 뒤에도 예약·계획·해시가 같다', () => {
    const { w, a, sa, v } = yard();
    a.inBuf.set('motor', 40);
    sa.inBuf.set('tire', 40);
    applyCommand(w, 0, { t: 'truck-plan', id: v.id, plan: [{ item: 'motor', cap: 20 }, { item: 'tire', cap: 20 }], period: 120, early: true });
    run(w, 5.5);
    const g = World.fromSnapshot(JSON.parse(JSON.stringify(w.snapshot())));
    expect(g.checksum()).toBe(w.checksum());
    for (let s = 0; s < 60; s++) {
      run(w, 1);
      run(g, 1);
      expect(g.checksum(), `${s}`).toBe(w.checksum());
    }
    const loaded = World.deserialize(JSON.parse(JSON.stringify(w.serialize())));
    expect(loaded.reservations).toEqual(w.reservations);
    expect(loaded.vehicles.get(v.id)!.plan).toEqual(v.plan);
    expect(loaded.buildings.get(a.id)!.dock).toBe(sa.id);
  });
});
