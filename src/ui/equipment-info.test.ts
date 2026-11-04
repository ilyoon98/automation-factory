import { describe, expect, it } from 'vitest';
import { ITEM_IDS } from '../data/items';
import { DT, World } from '../sim/world';
import { powerUsage, unloaderInfo } from './equipment-info';

describe('전력 막대의 사용률과 실제 부족량', () => {
  it.each([[1750, 2500, 70], [315, 960, 33], [270, 360, 75]])('수요 %i / 공급 용량 %i는 충족 100%%여도 사용 %i%%로 표시한다', (demand, capacity, percent) => {
    const usage = powerUsage(demand, capacity, 1);
    expect(usage.percent).toBe(percent);
    expect(usage.fill).toBeCloseTo(demand / capacity * 100);
    expect(usage.shortfall).toBe(0);
  });

  it('초과 수요는 100%보다 큰 숫자로 남기고 막대는 넘치지 않는다', () => {
    expect(powerUsage(1200, 1000, 1000 / 1200)).toMatchObject({ percent: 120, fill: 100, color: '#c0392b' });
    expect(powerUsage(1200, 1000, 1000 / 1200).shortfall).toBeCloseTo(200);
  });

  it('수요와 용량이 없으면 0%, 수요만 있으면 공급 없음과 부족량으로 구분한다', () => {
    expect(powerUsage(0, 0, 1)).toMatchObject({ percent: 0, fill: 0, shortfall: 0 });
    expect(powerUsage(300, 0, 0)).toMatchObject({ percent: null, fill: 100, shortfall: 300 });
  });

  it('축전 고갈 등으로 용량보다 적게 받아도 실제 부족을 숨기지 않는다', () => {
    expect(powerUsage(800, 1000, 0.5)).toMatchObject({ percent: 80, fill: 80, shortfall: 400, color: '#c0392b' });
  });
});

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
