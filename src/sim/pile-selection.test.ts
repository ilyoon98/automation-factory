import { describe, expect, it } from 'vitest';
import { ITEM_IDS } from '../data/items';
import { applyCommand, type Command } from './commands';
import { World } from './world';

function setup() {
  const w = new World(60, 40); w.rules = 'regional-v1'; w.createHub(0, 0);
  for (const t of w.techs) w.applyTech(t.id);
  for (const item of ITEM_IDS) w.stock.set(item, 1000);
  const storage = w.place('storage', 12, 10, 0)!;
  const station = w.place('station', 35, 10, 0)!; w.setStationMode(station, 'unload');
  const tiles = [w.idx(10, 10), w.idx(36, 12), w.idx(55, 30)];
  for (const tile of tiles) {
    const b = w.place('smelter', tile % w.width, Math.floor(tile / w.width), 0)!;
    b.outBuf.set('iron-plate', 10); w.remove(b);
  }
  const belt = w.place('belt', 10, 10, 1)!;
  belt.items.push({ item: 'copper-plate', n: 1, pos: .5 });
  return { w, storage, station, belt, tiles };
}

describe('선택한 바닥 아이템 일괄 줍기', () => {
  it('각 더미의 가까운 창고·정류장과 먼 더미의 허브 회수를 유지하고 설비·벨트 화물은 보존한다', () => {
    const { w, storage, station, belt, tiles } = setup();
    const hub = w.stockOf('iron-plate'), ids = [...w.buildings.keys()];
    const outside = w.idx(50, 35); w.piles.push({ tile: outside, item: 'coal', n: 7, ev: 4, why: 'remove' });
    const r = applyCommand(w, 0, { t: 'piles-collect', rid: 'batch', tiles: [...tiles, tiles[0]] });
    expect(r).toMatchObject({ ok: true, moved: 30, collected: 3, items: [['iron-plate', 30]] });
    expect(storage.inBuf.get('iron-plate')).toBe(10);
    expect(station.outBuf.get('iron-plate')).toBe(10);
    expect(w.stockOf('iron-plate')).toBe(hub + 10);
    expect(w.pileCount(outside, 'coal')).toBe(7);
    expect([...w.buildings.keys()]).toEqual(ids);
    expect(belt.items).toEqual([{ item: 'copper-plate', n: 1, pos: .5 }]);
  });

  it('창고 공간이 모자라면 남는 몫만 허브로 보내며 선택 순서와 무관하게 같은 결과를 낸다', () => {
    const { w, storage, tiles } = setup(); storage.inBuf.set('stone', 195);
    const near = w.idx(11, 10), extra = w.place('belt', 11, 10, 1)!;
    extra.items.push({ item: 'coal', n: 4, pos: .5 }); w.remove(extra);
    const guest = World.fromSnapshot(JSON.parse(JSON.stringify(w.snapshot())));
    const hub = w.stockOf('iron-plate');
    const a = applyCommand(w, 0, { t: 'piles-collect', rid: 'order', tiles: [near, tiles[0]] });
    const b = applyCommand(guest, 0, { t: 'piles-collect', rid: 'order', tiles: [tiles[0], near] });
    expect(a).toEqual(b); expect(w.checksum()).toBe(guest.checksum());
    expect(storage.inBuf.get('iron-plate')).toBe(5); expect(w.stockOf('iron-plate')).toBe(hub + 5);
    expect(storage.inBuf.get('coal')).toBeUndefined();
  });

  it('먼저 주운 더미는 건너뛰고 실제 옮긴 품목과 수량만 응답한다', () => {
    const { w, tiles } = setup(); w.collectPile(tiles[0]);
    w.piles.push({ tile: tiles[1], item: 'gear', n: 3, ev: 4, why: 'remove' });
    expect(applyCommand(w, 0, { t: 'piles-collect', rid: 'stale', tiles: [tiles[0], tiles[1]] }))
      .toMatchObject({ ok: true, moved: 13, collected: 1, items: [['iron-plate', 10], ['gear', 3]] });
    expect(w.collectPiles([tiles[0], tiles[1]])).toMatchObject({ ok: false });
  });

  it('저장·중간 참가 이후 동일 명령을 재전송해도 새로 생긴 더미를 다시 줍지 않는다', () => {
    const { w, tiles } = setup();
    const cmd: Command = { t: 'piles-collect', rid: 'once', tiles };
    const result = applyCommand(w, 0, cmd);
    w.piles.push({ tile: tiles[0], item: 'iron-plate', n: 9, ev: 5, why: 'remove' });
    for (const copy of [w, World.deserialize(JSON.parse(JSON.stringify(w.serialize()))), World.fromSnapshot(JSON.parse(JSON.stringify(w.snapshot())))]) {
      const hash = copy.checksum();
      expect(applyCommand(copy, 0, cmd)).toEqual(result);
      expect(copy.checksum()).toBe(hash); expect(copy.pileCount(tiles[0], 'iron-plate')).toBe(9);
    }
  });

  it.each([-1, 1.5, NaN, 2400, null, 'wrong'])('잘못된 위치 %j가 섞이면 일부 더미도 회수하지 않는다', bad => {
    const { w, tiles } = setup(); const before = JSON.stringify(w.serialize());
    expect(w.collectPiles([tiles[0], bad] as number[]).ok).toBe(false);
    expect(JSON.stringify(w.serialize())).toBe(before);
  });

  it('미공개 칸이 섞인 요청은 실물 이동 전에 전체 거절한다', () => {
    const { w, tiles } = setup(); w.revealed = new Uint8Array(w.width * w.height); w.revealed[tiles[0]] = 1;
    expect(w.collectPiles(tiles).ok).toBe(false);
    expect(w.pileCount(tiles[0], 'iron-plate')).toBe(10);
  });
});
