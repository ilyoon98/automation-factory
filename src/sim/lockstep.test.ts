import { describe, expect, it } from 'vitest';
import { TECHS } from '../data/tech';
import { applyCommand, type Command } from './commands';
import { TICK_RATE, World } from './world';

/**
 * 같이 하기(락스텝)는 "같은 월드 + 같은 명령을 같은 틱에 = 같은 결과"에 기댄다.
 * 스냅샷으로 넘겨받은 월드가 호스트와 한 틱도 다르지 않게 진행되는지 확인한다.
 */

function makeWorld(): World {
  const w = new World(40, 30);
  w.createHub(0, 9);
  for (const t of TECHS) w.applyTech(t.id);
  for (const item of ['iron-plate', 'gear', 'stone', 'steel', 'circuit', 'copper-plate'] as const) w.stock.set(item, 5000);
  return w;
}

/** JSON으로 오간 것처럼 (네트워크로 보낸 스냅샷) */
function viaNet(w: World): World {
  return World.fromSnapshot(JSON.parse(JSON.stringify(w.snapshot())));
}

function ticks(w: World, n: number) {
  for (let i = 0; i < n; i++) w.tick();
}

/** 채굴 → 제련 → 병합기 → 허브, 분배기, 도로와 트럭 두 대가 도는 공장 */
function busyFactory(): World {
  const w = makeWorld();
  const cmds: Command[] = [];
  for (let dy = 0; dy < 2; dy++)
    for (let dx = 0; dx < 2; dx++) {
      w.setResource(12 + dx, 8 + dy, 'iron-ore', 400);
      w.setResource(12 + dx, 12 + dy, 'iron-ore', 400);
    }
  const put = (tool: Extract<Command, { t: 'place' }>['tool'], x: number, y: number, dir: 0 | 1 | 2 | 3, setting: string | null = null) =>
    cmds.push({ t: 'place', tool, x, y, dir, initial: true, setting });
  put('miner', 12, 8, 3);
  put('miner', 12, 12, 3);
  for (let x = 11; x >= 8; x--) put('belt', x, 8, 3);
  for (let x = 11; x >= 8; x--) put('belt', x, 12, 3);
  put('belt', 7, 8, 2);
  put('belt', 7, 9, 2);
  put('belt', 7, 12, 0);
  put('belt', 7, 11, 0);
  put('merger', 7, 10, 3);
  put('smelter', 5, 10, 3, 'iron-plate');
  put('belt', 4, 10, 3);
  put('belt', 3, 10, 3);
  // 도로와 정류장 두 개, 트럭 두 대
  for (let x = 5; x <= 21; x++) put('road', x, 26, 0);
  put('station', 20, 24, 0);
  put('station', 5, 24, 0);
  for (const c of cmds) applyCommand(w, 0, c);
  const [a, b] = w.stations();
  applyCommand(w, 0, { t: 'config', id: b.id, key: 'mode', value: 'unload' });
  a.inBuf.set('stone', 200);
  applyCommand(w, 0, { t: 'build-truck', station: a.id });
  applyCommand(w, 0, { t: 'build-truck', station: a.id });
  return w;
}

describe('같이 하기: 스냅샷', () => {
  it('넘겨받은 월드가 호스트와 매 틱 똑같이 진행된다 (컨베이어·병합기·트럭)', () => {
    const host = busyFactory();
    expect(host.vehicles.size).toBe(2);
    const plates = host.stockOf('iron-plate');
    ticks(host, Math.round(17.3 * TICK_RATE));
    const guest = viaNet(host);
    expect(guest.checksum()).toBe(host.checksum());
    for (let s = 0; s < 60; s++) {
      ticks(host, TICK_RATE);
      ticks(guest, TICK_RATE);
      expect(guest.checksum(), `${s + 1}초 뒤`).toBe(host.checksum());
    }
    // 정말 돌고 있는 공장이었는지: 철판이 늘고, 트럭이 돌을 날라 왔다
    expect(guest.stockOf('iron-plate')).toBeGreaterThan(plates + 20);
    expect(guest.stations()[1].outBuf.get('stone')).toBeGreaterThan(20);
    expect([...guest.vehicles.values()].some((v) => v.lastTrip > 0)).toBe(true);
    expect(JSON.stringify(guest.serialize())).toBe(JSON.stringify(host.serialize()));
  });

  it('체크섬은 아이템 하나 위치만 달라도 바뀐다', () => {
    const w = busyFactory();
    ticks(w, 300);
    const before = w.checksum();
    const belt = [...w.buildings.values()].find((b) => b.items.length)!;
    belt.items[0].pos += 1e-9;
    expect(w.checksum()).not.toBe(before);
  });
});

describe('같이 하기: 명령', () => {
  it('두 사람의 명령을 같은 틱에 적용하면 두 월드가 같고, 되돌리기는 각자 자기 것만', () => {
    const host = busyFactory();
    ticks(host, 120);
    const guest = viaNet(host);
    // (틱, 플레이어, 명령) — 호스트가 정한 순서 그대로 모두가 적용한다
    const log: [number, number, Command][] = [
      [130, 0, { t: 'begin' }],
      [130, 0, { t: 'place', tool: 'belt', x: 20, y: 2, dir: 1, initial: true, setting: null }],
      [131, 2, { t: 'begin' }],
      [131, 2, { t: 'place', tool: 'storage', x: 25, y: 5, dir: 0, initial: true, setting: null }],
      [132, 0, { t: 'place', tool: 'belt', x: 21, y: 2, dir: 1, initial: false, setting: null }],
      [133, 2, { t: 'end' }],
      [140, 0, { t: 'end' }],
      [150, 2, { t: 'undo' }],
    ];
    for (const w of [host, guest]) {
      for (const [tick, p, cmd] of log) {
        ticks(w, tick - w.tickCount);
        applyCommand(w, p, cmd);
      }
      ticks(w, 600);
    }
    expect(guest.checksum()).toBe(host.checksum());
    // 플레이어 2의 창고만 되돌려졌고 플레이어 0의 컨베이어는 남아 있다
    expect(host.buildingAt(25, 5)).toBeNull();
    expect(host.buildingAt(20, 2)?.type).toBe('belt');
    expect(host.buildingAt(21, 2)?.type).toBe('belt');
    expect(host.nextEdit(false, 0)).toHaveLength(2);
    expect(host.nextEdit(false, 2)).toBeNull();
    expect(host.nextEdit(true, 2)).toHaveLength(1);
  });

  it('누가 드래그하는 도중에 들어와도 그 사람의 되돌리기 단계가 같게 이어진다', () => {
    const host = busyFactory();
    applyCommand(host, 0, { t: 'begin' });
    applyCommand(host, 0, { t: 'place', tool: 'belt', x: 20, y: 2, dir: 1, initial: true, setting: null });
    const guest = viaNet(host);
    for (const w of [host, guest]) {
      applyCommand(w, 0, { t: 'place', tool: 'belt', x: 21, y: 2, dir: 1, initial: false, setting: null });
      applyCommand(w, 0, { t: 'end' });
      applyCommand(w, 0, { t: 'undo' });
      ticks(w, 60);
    }
    expect(guest.buildingAt(20, 2)).toBeNull();
    expect(guest.buildingAt(21, 2)).toBeNull();
    expect(guest.checksum()).toBe(host.checksum());
  });

  it('스냅샷 뒤 철거·새로 짓기에서도 건물 id가 같게 매겨진다', () => {
    const host = busyFactory();
    // 마지막에 지은 건물을 철거해서 nextId가 (가장 큰 id + 1)보다 커진 상태
    const last = Math.max(...host.buildings.keys());
    applyCommand(host, 0, { t: 'remove', id: last });
    const guest = viaNet(host);
    for (const w of [host, guest]) applyCommand(w, 0, { t: 'place', tool: 'storage', x: 25, y: 5, dir: 0, initial: true, setting: null });
    expect(guest.buildingAt(25, 5)!.id).toBe(host.buildingAt(25, 5)!.id);
  });
});
