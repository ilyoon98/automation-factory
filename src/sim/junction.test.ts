import { describe, expect, it } from 'vitest';
import { TECHS } from '../data/tech';
import type { ItemId } from '../data/items';
import { applyCommand } from './commands';
import { copyArea, pasteBlueprint } from './blueprint';
import { acceptsFrom, TICK_RATE, World } from './world';
import { validJunctionPorts } from './junction';

function world() {
  const w = new World(30, 30);
  w.createHub(0, 0);
  for (const t of TECHS) w.applyTech(t.id);
  for (const i of ['iron-plate', 'gear', 'stone'] as const) w.stock.set(i, 10000);
  return w;
}
function run(w: World, seconds = 2) { for (let i = 0; i < seconds * TICK_RATE; i++) w.tick(); }

describe('방향을 설정한 물류 접속', () => {
  it('옆으로 붙인 분류기가 각각 선택 자원만 위로 빼고 나머지는 끝으로 보낸다', () => {
    const w = world();
    const src = w.place('belt', 9, 10, 1)!;
    const filters: ItemId[] = ['iron-ore', 'copper-ore', 'coal'];
    for (let k = 0; k < 3; k++) {
      const b = w.place('sorter', 10 + k, 10, 0)!;
      w.setFilter(b, filters[k]);
      expect(w.setJunction(b, { inputs: 8, outputs: 3 })).toBe(true);
      w.place('belt', 10 + k, 9, 0);
      w.place('belt', 10 + k, 8, 0);
    }
    w.place('belt', 13, 10, 1);
    w.place('belt', 14, 10, 1);
    for (const item of [...filters, 'stone', ...filters, 'stone'] as ItemId[]) {
      src.items.push({ item, n: 1, pos: 0 });
      run(w, 1);
    }
    run(w);
    for (let k = 0; k < 3; k++) {
      const items = [8, 9].flatMap(y => w.buildingAt(10 + k, y)!.items);
      expect(items.map(i => i.item)).toEqual([filters[k], filters[k]]);
    }
    expect([13, 14].flatMap(x => w.buildingAt(x, 10)!.items).map(i => i.item)).toEqual(['stone', 'stone']);
  });

  it('선택 자원 출구가 없으면 다른 출구로 새지 않고 기다린다', () => {
    const w = world();
    const b = w.place('sorter', 10, 10, 0)!;
    w.setFilter(b, 'iron-ore');
    w.setJunction(b, { inputs: 8, outputs: 3 });
    const src = w.place('belt', 9, 10, 1)!;
    const out = w.place('belt', 11, 10, 1)!;
    src.items.push({ item: 'iron-ore', n: 1, pos: 0 });
    run(w);
    expect(b.held).toBe('iron-ore');
    expect(out.items).toEqual([]);
  });

  it.each(['splitter', 'overflow'] as const)('%s도 옆 입력과 닫은 출구를 적용한다', type => {
    const w = world();
    const b = w.place(type, 10, 10, 0)!;
    w.setJunction(b, { inputs: 8, outputs: 1 });
    const src = w.place('belt', 9, 10, 1)!;
    const out = w.place('belt', 10, 9, 0)!;
    const closed = w.place('belt', 11, 10, 1)!;
    src.items.push({ item: 'coal', n: 1, pos: 0 });
    run(w);
    expect(out.items.map(i => i.item)).toEqual(['coal']);
    expect(closed.items).toEqual([]);
  });

  it('병합기는 허용한 입구로만 받고 회전하면 입구도 같이 돌아간다', () => {
    const w = world();
    const b = w.place('merger', 10, 10, 1)!;
    w.setJunction(b, { inputs: 4, outputs: 1 });
    expect(acceptsFrom(b, 3)).toBe(true);
    expect(acceptsFrom(b, 0)).toBe(false);
    const src = w.place('belt', 9, 10, 1)!;
    const out = w.place('belt', 11, 10, 1)!;
    src.items.push({ item: 'coal', n: 1, pos: 0 });
    run(w);
    expect(out.items.map(i => i.item)).toEqual(['coal']);
    w.rotate(b, 0);
    expect(acceptsFrom(b, 2)).toBe(true);
    expect(acceptsFrom(b, 3)).toBe(false);
  });

  it('방향 설정은 명령·되돌리기·철거 복원·저장·스냅샷·청사진으로 보존한다', () => {
    const w = world();
    const b = w.place('sorter', 10, 10, 0)!;
    const ports = { inputs: 8, outputs: 3 };
    expect(applyCommand(w, 0, { t: 'junction', id: b.id, ports })).toBe(true);
    w.undo(); expect(b.junction).toBeNull();
    w.redo(); expect(b.junction).toEqual(ports);
    const bp = copyArea(w, 10, 10, 10, 10)!;
    pasteBlueprint(w, bp, 15, 10);
    expect(w.buildingAt(15, 10)!.junction).toEqual(ports);
    w.edit(() => w.remove(b)); w.undo();
    expect(w.buildingAt(10, 10)!.junction).toEqual(ports);
    const restored = World.deserialize(JSON.parse(JSON.stringify(w.serialize())));
    expect(restored.buildingAt(10, 10)!.junction).toEqual(ports);
    const guest = World.fromSnapshot(JSON.parse(JSON.stringify(w.snapshot())));
    expect(guest.checksum()).toBe(w.checksum());
    for (let i = 0; i < 120; i++) { w.tick(); guest.tick(); }
    expect(guest.checksum()).toBe(w.checksum());
    guest.setJunction(guest.buildingAt(10, 10)!, null);
    expect(guest.checksum()).not.toBe(w.checksum());
  });

  it('설정하지 않은 장치는 기존 방향을 유지하고 잘못된 설정은 거절한다', () => {
    const w = world();
    const b = w.place('sorter', 10, 10, 0)!;
    expect(acceptsFrom(b, 2)).toBe(true);
    expect(acceptsFrom(b, 3)).toBe(false);
    for (const p of [{ inputs: 3, outputs: 5 }, { inputs: 8, outputs: 1 }, { inputs: 8, outputs: 8 }, { inputs: 16, outputs: 1 }]) {
      expect(w.setJunction(b, p)).toBe(false);
    }
    expect(validJunctionPorts('belt', { inputs: 4, outputs: 11 })).toBe(false);
  });
});
