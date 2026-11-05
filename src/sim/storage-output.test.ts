import { describe, expect, it } from 'vitest';
import { ITEM_IDS } from '../data/items';
import { TICK_RATE, World } from './world';

function setup() {
  const w = new World(40, 30); w.rules = 'regional-v1'; w.createHub(0, 0);
  for (const t of w.techs) w.applyTech(t.id);
  for (const item of ITEM_IDS) w.stock.set(item, 1000);
  const storage = w.place('storage', 10, 10, 0)!; // (10,10)~(11,11)
  storage.inBuf.set('iron-plate', 5); storage.inBuf.set('coal', 5);
  return { w, storage };
}

const run = (w: World, seconds: number) => { for (let i = 0; i < seconds * TICK_RATE; i++) w.tick(); };
const onBelts = (w: World) => {
  const all = new Map<string, number>();
  for (const b of w.buildings.values()) for (const it of b.items) all.set(it.item, (all.get(it.item) ?? 0) + it.n);
  return all;
};

describe('창고 옆 바깥쪽 컨베이어로 바로 내보내기', () => {
  it('창고를 등진 컨베이어가 출구가 되어 종류별로 번갈아 내보낸다', () => {
    const { w, storage } = setup();
    for (let x = 12; x <= 18; x++) w.place('belt', x, 10, 1); // 오른쪽으로 나가는 줄
    expect(w.storageExits(storage).map(b => [b.x, b.y])).toEqual([[12, 10]]);
    run(w, 3);
    const out = onBelts(w);
    expect(out.get('iron-plate')).toBeGreaterThan(0);
    expect(out.get('coal')).toBeGreaterThan(0);
    expect(w.storageTotal(storage) + (out.get('iron-plate') ?? 0) + (out.get('coal') ?? 0)).toBe(10);
  });

  it('창고를 향하거나 옆을 스쳐 가는 컨베이어는 출구가 아니다', () => {
    const { w, storage } = setup();
    w.place('belt', 12, 10, 2); // 창고 오른쪽을 아래로 지나감
    w.place('belt', 12, 11, 3); // 창고로 들어가는 쪽
    w.place('belt', 10, 9, 3); // 창고 위를 왼쪽으로 지나감
    expect(w.storageExits(storage)).toEqual([]);
    run(w, 3);
    expect(w.storageTotal(storage)).toBe(10);
    expect(onBelts(w).size).toBe(0);
  });

  it('합쳐진 창고는 다른 칸의 내용물도 어느 출구로든 내보낸다', () => {
    const { w, storage } = setup();
    const right = w.place('storage', 12, 10, 0)!;
    expect(w.storageGroup(storage)).toHaveLength(2);
    for (let x = 14; x <= 18; x++) w.place('belt', x, 11, 1);
    expect(w.storageExits(storage).map(b => [b.x, b.y])).toEqual([[14, 11]]);
    run(w, 3);
    expect(w.storageTotal(right)).toBeLessThan(10);
    expect(storage.inBuf.get('iron-plate') ?? 0).toBeLessThan(5);
  });

  it('저장해서 이어 해도 같은 순서로 내보낸다', () => {
    const { w } = setup();
    for (let x = 12; x <= 18; x++) w.place('belt', x, 10, 1);
    run(w, 0.7);
    const copy = World.fromSnapshot(JSON.parse(JSON.stringify(w.snapshot())));
    run(w, 2); run(copy, 2);
    expect(copy.checksum()).toBe(w.checksum());
  });
});
