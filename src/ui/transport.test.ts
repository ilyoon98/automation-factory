import { describe, expect, it } from 'vitest';
import { World } from '../sim/world';
import { ITEM_IDS } from '../data/items';
import { Vehicle } from '../sim/vehicle';
import { focusRouteStation, reachableStations, refreshTransportItemSelect, sourceItemGroups, stationMapButton, transportItemOptions } from './transport';

function setup() {
  const w = new World(40, 30);
  w.createHub(0, 0);
  for (const t of w.techs) w.applyTech(t.id);
  for (const item of ['iron-plate', 'gear', 'stone', 'wood', 'steel', 'circuit'] as const) w.stock.set(item, 10000);
  const a = w.place('station', 3, 4, 0)!;
  const b = w.place('station', 15, 4, 0)!;
  const island = w.place('station', 26, 4, 0)!;
  const unconnected = w.place('station', 30, 10, 0)!;
  for (let x = 3; x <= 17; x++) w.place('road', x, 6, 0);
  for (let x = 25; x <= 29; x++) w.place('road', x, 6, 0);
  return { w, a, b, island, unconnected, from: w.idx(3, 6) };
}

describe('운송 정류장 목록의 도로 연결', () => {
  it('접도만 한 다른 도로망과 미접도 정류장을 제외하며 실제 경로 탐색과 일치한다', () => {
    const { w, a, b, from } = setup();
    const hash = w.checksum(), save = w.serialize();
    expect(reachableStations(w, from).map((s) => s.id)).toEqual([a.id, b.id]);
    expect(reachableStations(w, from)).toEqual(w.stations().filter((s) => w.findPath(from, new Set(w.stationStops(s))) !== null));
    expect(w.checksum()).toBe(hash); expect(w.serialize()).toEqual(save);
  });

  it('도로 철거·재연결·되돌리기를 즉시 반영하고 저장에서 캐시를 재사용하지 않는다', () => {
    const { w, b, from } = setup();
    expect(reachableStations(w, from)).toContain(b);
    w.beginEdit(); w.remove(w.buildingAt(10, 6)!); w.endEdit();
    expect(reachableStations(w, from)).not.toContain(b);
    w.undo();
    expect(reachableStations(w, from)).toContain(b);
    const loaded = World.deserialize(w.serialize());
    expect(reachableStations(loaded, from).map((s) => s.id)).toEqual(reachableStations(w, from).map((s) => s.id));
  });

  it('정류장이 서로 다른 두 도로에 닿아도 그 정류장을 경유해 다른 도로로 갈 수 있다고 표시하지 않는다', () => {
    const { w, b, island, from } = setup();
    for (let x = 16; x <= 28; x++) w.place('road', x, 3, 0);
    w.place('road', 28, 4, 0); w.place('road', 28, 5, 0);
    expect(w.stationStops(b).length).toBeGreaterThan(1);
    expect(reachableStations(w, from)).toContain(b);
    expect(reachableStations(w, from)).not.toContain(island);
  });

  it('차 밑 도로가 사라진 경우에도 인접 도로에서 출발하는 기존 규칙을 유지한다', () => {
    const { w, b, from } = setup();
    w.remove(w.buildingAt(3, 6)!);
    expect(reachableStations(w, from)).toContain(b);
    w.remove(w.buildingAt(4, 6)!);
    expect(reachableStations(w, from)).toEqual([]);
  });
});

describe('운송 출발지 품목과 지도 이동', () => {
  it('일반 노선은 정류장 적재함, 계획 운송은 연결 창고까지 있는 품목을 우선하고 전체 품목을 보존한다', () => {
    const { w, a } = setup(); w.rules = 'regional-v1';
    const store = w.place('storage', 1, 4, 0)!;
    expect(w.setDock(a, store.id)).toBe(true);
    a.inBuf.set('coal', 3); a.outBuf.set('water', 4); store.inBuf.set('tin-ore', 5);
    expect(sourceItemGroups(w, a.id).stocked).toEqual(['coal']);
    const planned = sourceItemGroups(w, a.id, true);
    expect(planned.stocked).toHaveLength(3);
    expect(planned.stocked).toEqual(expect.arrayContaining(['coal', 'water', 'tin-ore']));
    expect(new Set([...planned.stocked, ...planned.other]).size).toBe(ITEM_IDS.length);
    expect([...planned.stocked, ...planned.other]).toHaveLength(ITEM_IDS.length);
  });

  it('재고 없는 기존 품목도 선택을 유지하고, 서로 다른 싣는 정류장의 품목은 섞지 않는다', () => {
    const { w, a, b, from } = setup();
    a.inBuf.set('coal', 2); b.inBuf.set('water', 5);
    const v = new Vehicle(1, from, w.width); v.stops = [{ id: a.id, act: 'load' }, { id: b.id, act: 'load' }];
    const select = { dataset: { act: 'stop-item', i: '1' }, value: 'tin-ore', innerHTML: '' } as unknown as HTMLSelectElement;
    const hash = w.checksum(), route = JSON.stringify(v.stops);
    refreshTransportItemSelect(w, v, select);
    expect(select.value).toBe('tin-ore');
    const firstGroup = select.innerHTML.match(/<optgroup label="출발지에 있음">(.*?)<\/optgroup>/)?.[1];
    expect(firstGroup).toContain('value="water"'); expect(firstGroup).not.toContain('value="coal"');
    expect(select.innerHTML).toContain('value="tin-ore" selected');
    expect((select.innerHTML.match(/<option /g) ?? []).length).toBe(ITEM_IDS.length + 1);
    expect(w.checksum()).toBe(hash);
    b.inBuf.clear(); const changedHash = w.checksum(); refreshTransportItemSelect(w, v, select);
    expect(select.value).toBe('tin-ore'); expect(select.innerHTML).toContain('label="전체 품목"');
    expect(w.checksum()).toBe(changedHash);
    expect(JSON.stringify(v.stops)).toBe(route);
  });

  it('재고 순서 갱신은 작성 중인 계획/주기/상한/선택값과 게임 상태를 변경하지 않는다', () => {
    const { w, a, from } = setup();
    const v = new Vehicle(1, from, w.width); v.stops[0].id = a.id;
    v.plan = [{ item: 'tin-ore', cap: 7 }]; v.period = 120;
    const select = { dataset: { planItem: '0' }, value: 'tin-ore', innerHTML: '' } as unknown as HTMLSelectElement;
    const plan = JSON.stringify(v.plan), hash = w.checksum(), saved = w.serialize();
    refreshTransportItemSelect(w, v, select);
    expect(select.value).toBe('tin-ore'); expect(JSON.stringify(v.plan)).toBe(plan); expect(v.period).toBe(120);
    expect(w.checksum()).toBe(hash); expect(w.serialize()).toEqual(saved);
    expect(transportItemOptions(w, 0, 'water')).toContain('value="water" selected');
  });

  it('각 정류장 중심으로 화면만 이동하고 끊긴 도로의 정류장도 볼 수 있다', () => {
    const { w, a, island } = setup();
    const stops = [{ id: a.id, act: 'load' as const }, { id: island.id, act: 'unload' as const }];
    const route = JSON.stringify(stops), saved = w.serialize(), calls: number[][] = [];
    expect(focusRouteStation(w, stops, 1, (x, y) => calls.push([x, y]))).toBe(true);
    expect(calls).toEqual([[island.x + island.size / 2, island.y + island.size / 2]]);
    expect(stationMapButton(w, island.id, 1)).toContain('data-i="1"');
    expect(stationMapButton(w, island.id, 1)).not.toContain('disabled');
    expect(JSON.stringify(stops)).toBe(route); expect(w.serialize()).toEqual(saved);
    w.remove(island);
    expect(focusRouteStation(w, stops, 1, () => { throw Error('삭제된 위치로 이동'); })).toBe(false);
    expect(stationMapButton(w, island.id, 1)).toContain('disabled');
    w.revealed = new Uint8Array(w.width * w.height);
    expect(focusRouteStation(w, stops, 0, () => { throw Error('미공개 위치로 이동'); })).toBe(false);
    expect(focusRouteStation(w, stops, Number.NaN, () => {})).toBe(false);
  });
});
