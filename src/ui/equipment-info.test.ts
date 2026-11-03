import { describe, expect, it } from 'vitest';
import { ITEM_IDS } from '../data/items';
import { DT, World } from '../sim/world';
import { unloaderInfo } from './equipment-info';

function setup() {
  const w = new World(40, 30); w.rules = 'regional-v1'; w.createHub(0, 0);
  for (const t of w.techs) w.applyTech(t.id);
  for (const item of ITEM_IDS) w.stock.set(item, 1000);
  return w;
}

describe('설비 UI는 실제 하역 대상을 읽는다', () => {
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
