import { describe, expect, it } from 'vitest';
import { countOf, type Building } from './building';
import { TICK_RATE, World } from './world';

/** 지역 생산망 확장: 새 채취 설비(D04)와 채굴 대상 연구 */

function makeWorld(): World {
  const w = new World(40, 30);
  w.rules = 'regional-v1';
  w.createHub(0, 9);
  for (const t of w.techs) w.applyTech(t.id);
  for (const item of ['iron-plate', 'gear', 'stone', 'steel', 'circuit', 'wood', 'motor'] as const) w.stock.set(item, 5000);
  return w;
}

function run(w: World, seconds: number) {
  for (let i = 0; i < Math.round(seconds * TICK_RATE); i++) w.tick();
}

/** 내보낸 개수 (출력 버퍼를 비우며 센다) */
function drain(w: World, list: (Building | null | undefined)[], seconds: number, item: string): number {
  let n = 0;
  for (let i = 0; i < Math.round(seconds * TICK_RATE); i++) {
    w.tick();
    for (const b of list) {
      n += countOf(b!.outBuf, item as never);
      b!.outBuf.clear();
    }
  }
  return n;
}

describe('수액 채취기', () => {
  it('고무나무 군락에 맞닿아야 놓이고, 한 대 분당 30개', () => {
    const w = makeWorld();
    for (let y = 10; y < 13; y++) for (let x = 20; x < 23; x++) w.setResource(x, y, 'sap', Infinity);
    expect(w.canPlace('sap-extractor', 26, 10).ok).toBe(false);
    expect(w.canPlace('sap-extractor', 21, 11).reason).toBe('고무나무 위에는 지을 수 없음');
    const b = w.place('sap-extractor', 23, 10, 2)!;
    expect(b.minePatches.length).toBe(1);
    const got = drain(w, [b], 60, 'sap');
    expect(got).toBeGreaterThanOrEqual(29);
    expect(got).toBeLessThanOrEqual(31);
  });

  it('군락 하나에 6대를 붙여도 합계는 분당 120개', () => {
    const w = makeWorld();
    for (let y = 10; y < 16; y++) for (let x = 20; x < 26; x++) w.setResource(x, y, 'sap', Infinity);
    const list = [
      w.place('sap-extractor', 26, 10, 1),
      w.place('sap-extractor', 26, 12, 1),
      w.place('sap-extractor', 26, 14, 1),
      w.place('sap-extractor', 18, 10, 3),
      w.place('sap-extractor', 18, 12, 3),
      w.place('sap-extractor', 18, 14, 3),
    ];
    expect(list.every(Boolean)).toBe(true);
    const got = drain(w, list, 60, 'sap');
    expect(got).toBeGreaterThanOrEqual(114);
    expect(got).toBeLessThanOrEqual(126);
  });
});

describe('시추기', () => {
  it('기준 칸이 원유 지점 위여야 하고, 연구 전에는 못 놓는다. 분당 60개, 지점이 줄어든다', () => {
    const w = makeWorld();
    w.setResource(21, 11, 'crude-oil', 100);
    expect(w.canPlace('drill', 21, 11).ok).toBe(false);
    w.researched.delete('oil-control');
    expect(w.canPlace('drill', 20, 10).reason).toContain('석유와 제어');
    w.researched.add('oil-control');
    const b = w.place('drill', 20, 10, 2)!;
    const got = drain(w, [b], 60, 'crude-oil');
    expect(got).toBeGreaterThanOrEqual(59);
    expect(got).toBeLessThanOrEqual(61);
    expect(w.resAmount[w.idx(21, 11)]).toBe(100 - got);
    drain(w, [b], 60, 'crude-oil');
    expect(b.status).toBe('depleted');
  });

  it('염수는 "리튬과 축전" 뒤', () => {
    const w = makeWorld();
    w.setResource(21, 11, 'brine', 100);
    w.researched.delete('lithium-storage');
    expect(w.canPlace('drill', 20, 10).ok).toBe(false);
    w.researched.add('lithium-storage');
    expect(w.canPlace('drill', 20, 10).ok).toBe(true);
  });
});

describe('채굴 대상 연구', () => {
  it('주석광석은 "합금 가공" 전에는 캐지 못한다 (채굴기는 놓을 수 있다)', () => {
    const w = makeWorld();
    w.researched.delete('alloy');
    for (let y = 10; y < 12; y++) for (let x = 20; x < 22; x++) w.setResource(x, y, 'tin-ore', 100);
    const m = w.place('miner', 20, 10, 2)!;
    run(w, 3);
    expect(m.status).toBe('locked');
    expect(countOf(m.outBuf, 'tin-ore')).toBe(0);
    w.researched.add('alloy');
    run(w, 3);
    expect(countOf(m.outBuf, 'tin-ore')).toBeGreaterThan(0);
  });

  it('채굴기는 원유·염수·수액 칸을 캐지 않는다', () => {
    const w = makeWorld();
    for (let y = 10; y < 12; y++) for (let x = 20; x < 22; x++) w.setResource(x, y, 'crude-oil', 100);
    expect(w.canPlace('miner', 20, 10).ok).toBe(false);
  });

  it('예전 세계는 연구 없이도 아무 광석이나 (규칙이 바뀌지 않음)', () => {
    const w = makeWorld();
    w.rules = 'legacy-v042';
    expect(w.oreLock('tin-ore')).toBeNull();
  });
});
