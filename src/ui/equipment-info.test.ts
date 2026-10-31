import { describe, expect, it } from 'vitest';
import { ITEM_IDS } from '../data/items';
import { Vehicle } from '../sim/vehicle';
import { DT, World } from '../sim/world';
import { chargerInfo, unloaderInfo } from './equipment-info';

function setup() {
  const w = new World(40, 30); w.rules = 'regional-v1'; w.createHub(0, 0);
  for (const t of w.techs) w.applyTech(t.id);
  for (const item of ITEM_IDS) w.stock.set(item, 1000);
  return w;
}

describe('설비 UI는 실제 충전·하역 대상을 읽는다', () => {
  it('전체 전력 비율이나 충전기 정격 대신 실제로 받은 전기를 표시하고 대기 차량을 구분한다', () => {
    const w = setup(), b = w.place('charger', 10, 10, 0)!;
    w.place('road', 11, 10, 0); w.place('road', 10, 11, 0);
    const a = new Vehicle(1, w.idx(11, 10), w.width), c = new Vehicle(2, w.idx(10, 11), w.width);
    a.charger = c.charger = true;
    a.receivedCharge = 73 * DT; c.receivedCharge = 0;
    w.vehicles.set(a.id, a); w.vehicles.set(c.id, c);
    w.power.satisfaction = .1;
    const snapshot = w.snapshot(), hash = w.checksum();
    expect(chargerInfo(w, b)).toEqual({ roads: 2, active: 1, waiting: 1, kw: 73 });
    expect(w.checksum()).toBe(hash); expect(w.snapshot()).toEqual(snapshot);
  });

  it('한 도로 옆에 충전기가 여럿이면 실제 충전원 한 곳에만 차량과 전력을 집계한다', () => {
    const w = setup(), a = w.place('charger', 10, 10, 0)!, b = w.place('charger', 12, 10, 0)!;
    w.place('road', 11, 10, 0);
    const v = new Vehicle(1, w.idx(11, 10), w.width); v.charger = true; v.receivedCharge = 20 * DT;
    w.vehicles.set(v.id, v);
    expect(w.chargeSpot(v)?.id).toBe(a.id);
    expect(chargerInfo(w, a)).toMatchObject({ active: 1, kw: 20 });
    expect(chargerInfo(w, b)).toEqual({ roads: 1, active: 0, waiting: 0, kw: 0 });
  });

  it('맵 왼쪽 바깥을 이전 행의 오른쪽 도로로 잘못 세지 않는다', () => {
    const w = setup(), edge = w.place('charger', 0, 10, 0)!;
    w.place('charger', 38, 9, 0); w.place('road', 39, 9, 0);
    expect(w.chargerTiles().has(w.idx(39, 9))).toBe(true);
    expect(chargerInfo(w, edge).roads).toBe(0);
  });

  it('다른 벨트와 겹친 회수 더미를 실제 하역기처럼 출처로 인식한다', () => {
    const w = setup(); w.place('belt', 10, 10, 1);
    const b = w.place('unloader', 11, 10, 1)!, out = w.place('belt', 12, 10, 1)!;
    const tile = w.idx(10, 10); w.piles.push({ tile, item: 'iron-plate', n: 7, ev: 1, why: 'remove' });
    const hash = w.checksum();
    expect(unloaderInfo(w, b)).toEqual({ source: '회수 더미', maximum: 240 });
    expect(w.checksum()).toBe(hash);
    b.progress = .5 - DT; w.tick();
    expect(w.pileCount(tile, 'iron-plate')).toBeLessThan(7);
    expect(out.items.some((i) => i.item === 'iron-plate')).toBe(true);
  });

  it('더미와 창고가 겹치면 실제 하역기의 창고 우선 규칙을 표시하고 없는 출처는 없음으로 둔다', () => {
    const w = setup(), storage = w.place('storage', 10, 10, 0)!;
    const b = w.place('unloader', 12, 10, 1)!, out = w.place('belt', 13, 10, 1)!;
    storage.inBuf.set('copper-plate', 5);
    const tile = w.idx(11, 10); w.piles.push({ tile, item: 'iron-plate', n: 7, ev: 1, why: 'remove' });
    expect(unloaderInfo(w, b).source).toBe('창고');
    b.progress = .5 - DT; w.tick();
    expect(w.pileCount(tile, 'iron-plate')).toBe(7);
    expect(out.items.every((i) => i.item === 'copper-plate')).toBe(true);
    const other = w.place('unloader', 20, 20, 1)!;
    expect(unloaderInfo(w, other).source).toBeNull();
  });
});
