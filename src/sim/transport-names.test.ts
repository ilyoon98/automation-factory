import { expect, it } from 'vitest';
import { World } from './world';
import { applyCommand } from './commands';

function setup() {
  const w = new World(40, 30); w.createHub(0, 0);
  for (const t of w.techs) w.applyTech(t.id);
  for (const item of ['iron-plate', 'gear', 'stone', 'steel', 'circuit'] as const) w.stock.set(item, 10000);
  const a = w.place('station', 3, 4, 0)!;
  for (let x = 3; x < 20; x++) w.place('road', x, 6, 0);
  const v = w.buildTruck(a)!;
  return { w, a, v };
}

it('이름 명령은 저장·스냅샷·체크섬에 유지되며 예전 저장은 기본 이름을 쓴다', () => {
  const { w, a, v } = setup(); const old = w.serialize(), before = w.checksum();
  expect(applyCommand(w, 0, { t: 'truck-name', id: v.id, name: '  철판 운반  ' })).toBe(true);
  expect(applyCommand(w, 0, { t: 'station-name', id: a.id, name: '제철소' })).toBe(true);
  expect(v.name).toBe('철판 운반'); expect(a.stationLabel).toContain('제철소'); expect(w.checksum()).not.toBe(before);
  for (const copy of [World.deserialize(JSON.parse(JSON.stringify(w.serialize()))), World.fromSnapshot(JSON.parse(JSON.stringify(w.snapshot())))]) {
    expect(copy.vehicles.get(v.id)!.name).toBe('철판 운반');
    expect(copy.buildings.get(a.id)!.stationName).toBe('제철소');
  }
  const guest = World.fromSnapshot(JSON.parse(JSON.stringify(w.snapshot())));
  expect(guest.checksum()).toBe(w.checksum());
  for (let i = 0; i < 60; i++) { w.tick(); guest.tick(); }
  expect(guest.checksum()).toBe(w.checksum());
  expect(World.deserialize(old).vehicles.get(v.id)!.name).toBe('');
});

it('이름 수정과 철거 복원을 되돌리고 다시 실행해도 이름을 지킨다', () => {
  const { w, a, v } = setup();
  applyCommand(w, 0, { t: 'truck-name', id: v.id, name: '운반차' });
  w.undo(); expect(v.name).toBe(''); w.redo(); expect(v.name).toBe('운반차');
  applyCommand(w, 0, { t: 'station-name', id: a.id, name: '광산' });
  w.undo(); expect(a.stationName).toBe(''); w.redo(); expect(a.stationName).toBe('광산');
  applyCommand(w, 0, { t: 'remove-truck', id: v.id }); w.undo();
  expect([...w.vehicles.values()][0].name).toBe('운반차');
  applyCommand(w, 0, { t: 'remove', id: a.id }); w.undo();
  expect(w.buildingAt(3, 4)!.stationName).toBe('광산');
});

it('빈 이름은 기본 이름으로 돌아가고 긴 이름·제어문자를 정리한다', () => {
  const { w, a, v } = setup();
  w.renameTruck(v, '🚛'.repeat(40)); expect([...v.name]).toHaveLength(32);
  w.renameStation(a, '\n 제철소\t'); expect(a.stationName).toBe('제철소');
  w.renameTruck(v, ' '); expect(v.label).toBe(`트럭 ${v.id}`);
  expect(w.renameStation(w.hub!, '실패')).toBe(false);
  w.renameTruck(v, '철판차');
  expect(w.cloneTruck(v)!.name).toBe('');
});
