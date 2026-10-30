import { describe, expect, it } from 'vitest';
import { ITEM_IDS } from '../data/items';
import type { Building } from './building';
import { applyCommand } from './commands';
import { DX, DY } from './dir';
import { buildRoad, planRoad, type RoadPlan } from './road-plan';
import { World } from './world';
import { MAIN_GOAL_BY_ID } from './goals';

function setup(bx = 20, by = 5, width = 32, height = 24) {
  const w = new World(width, height); w.rules = 'regional-v1'; w.createHub(0, 0);
  for (const t of w.techs) w.applyTech(t.id);
  for (const item of ITEM_IDS) w.stock.set(item, 10000);
  const a = w.place('station', 4, 5, 0)!, b = w.place('station', bx, by, 0)!;
  return { w, a, b };
}

function plan(w: World, a: Building, b: Building): RoadPlan {
  const result = planRoad(w, a.id, b.id); expect(result.ok).toBe(true);
  if (!result.ok) throw Error(result.reason);
  return result;
}

function command(p: RoadPlan) {
  return { t: 'road-build', from: p.from, to: p.to, path: p.path, newTiles: p.newTiles } as const;
}

/** 비교용 작은 지도 탐색: 방향을 포함한 상태를 거리/꺾임/건설 수로 정렬해 직접 탐색한다. */
function reference(w: World, a: Building, b: Building): number[] | null {
  const edge = (s: Building) => {
    const out: number[] = [];
    for (let y = 0; y < w.height; y++) for (let x = 0; x < w.width; x++) {
      if (((x >= s.x && x < s.x + s.size) && (y === s.y - 1 || y === s.y + s.size)) ||
          ((y >= s.y && y < s.y + s.size) && (x === s.x - 1 || x === s.x + s.size))) out.push(w.idx(x, y));
    }
    return out;
  };
  const open = (t: number) => w.isRevealed(t) && (w.isRoad(t) || w.canPlace('road', t % w.width, Math.floor(t / w.width)).ok);
  const ends = new Set(edge(b).filter(open));
  type Entry = { tile: number; dir: number; score: number[] };
  const cmp = (a: number[], b: number[]) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
  const queue: Entry[] = edge(a).filter(open).map((tile) => ({ tile, dir: 4, score: [1, 0, w.isRoad(tile) ? 0 : 1] }));
  const seen = new Set<string>();
  while (queue.length) {
    queue.sort((a, b) => cmp(a.score, b.score));
    const cur = queue.shift()!, key = `${cur.tile}:${cur.dir}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (ends.has(cur.tile)) return cur.score;
    const x = cur.tile % w.width, y = Math.floor(cur.tile / w.width);
    for (let d = 0; d < 4; d++) {
      const nx = x + DX[d], ny = y + DY[d]; if (!w.inBounds(nx, ny)) continue;
      const tile = w.idx(nx, ny); if (!open(tile)) continue;
      queue.push({ tile, dir: d, score: [cur.score[0] + 1, cur.score[1] + (cur.dir === 4 || cur.dir === d ? 0 : 1), cur.score[2] + (w.isRoad(tile) ? 0 : 1)] });
    }
  }
  return null;
}

describe('정류장 사이 도로 계획', () => {
  it('정류장 몸체가 아닌 정차 칸을 연결하며 같은 높이는 직선, 엇갈린 곳은 한 번만 꺾는다', () => {
    const { w, a, b } = setup();
    const before = w.serialize(), hash = w.checksum();
    const p = plan(w, a, b);
    expect(p.path).toHaveLength(14); expect(p.turns).toBe(0);
    expect(p.newTiles).toHaveLength(14); expect(p.cost).toEqual([{ item: 'stone', count: 14 }]);
    expect(w.serialize()).toEqual(before); expect(w.checksum()).toBe(hash);
    const other = setup(20, 14);
    const corner = plan(other.w, other.a, other.b);
    expect(corner.path).toHaveLength(22); expect(corner.turns).toBe(1);
    expect(new Set(corner.path).size).toBe(corner.path.length);
  });

  it('기존 도로는 같은 거리·꺾임이면 우선 활용하고 비용은 새 구간만 계산한다', () => {
    const { w, a, b } = setup(20, 14);
    const initial = plan(w, a, b);
    for (const t of initial.path.filter((_, i) => i % 2 === 0)) w.place('road', t % w.width, Math.floor(t / w.width), 0);
    const p = plan(w, a, b);
    expect([p.path.length, p.turns]).toEqual([initial.path.length, initial.turns]);
    expect(p.newTiles.length).toBeLessThan(p.path.length);
    const stone = w.stockOf('stone');
    expect(applyCommand(w, 2, command(p))).toMatchObject({ ok: true, placed: p.newTiles.length });
    expect(w.stockOf('stone')).toBe(stone - p.newTiles.length);
    expect(w.stationStops(a)).toContain(p.path[0]); expect(w.stationStops(b)).toContain(p.path.at(-1));
    expect(w.findPath(p.path[0], new Set(w.stationStops(b)))).not.toBeNull();
    const again = plan(w, a, b); expect(again.newTiles).toHaveLength(0);
    const hash = w.checksum(); expect(applyCommand(w, 2, command(again)).ok).toBe(false); expect(w.checksum()).toBe(hash);
  });

  it('건물·컨베이어·호수·고무나무·미공개 칸을 피하고 지도와 재고를 미리보기에서 변경하지 않는다', () => {
    const { w, a, b } = setup(20, 14);
    w.place('storage', 12, 8, 0); w.place('belt', 14, 10, 0);
    w.setResource(9, 8, 'water', Infinity); w.setResource(10, 8, 'sap', Infinity);
    w.revealed = new Uint8Array(w.width * w.height).fill(1); w.revealed[w.idx(11, 8)] = 0;
    const saved = w.serialize(), hash = w.checksum();
    const p = plan(w, a, b);
    for (const t of p.path) expect(w.isRevealed(t) && (w.isRoad(t) || w.canPlace('road', t % w.width, Math.floor(t / w.width)).ok)).toBe(true);
    expect(w.serialize()).toEqual(saved); expect(w.checksum()).toBe(hash);
    expect([p.path.length, p.turns, p.newTiles.length]).toEqual(reference(w, a, b));
  });

  it.each([1, 7, 19, 31, 57, 89])('작은 장애물 지도 %i에서 독립 탐색의 거리·최소 꺾임·신규 개수와 일치한다', (seed) => {
    const { w, a, b } = setup(12, 11, 17, 16);
    let n = seed;
    for (let y = 2; y < 15; y++) for (let x = 7; x < 12; x++) {
      n = (n * 1664525 + 1013904223) >>> 0;
      if (n % 6 === 0) w.setResource(x, y, 'water', Infinity);
      else if (n % 7 === 0) w.place('road', x, y, 0);
    }
    const expected = reference(w, a, b), actual = planRoad(w, a.id, b.id);
    if (!expected) expect(actual.ok).toBe(false);
    else {
      expect(actual.ok).toBe(true);
      if (actual.ok) expect([actual.path.length, actual.turns, actual.newTiles.length]).toEqual(expected);
    }
  });

  it('행을 가로막은 호수·숨은 정류장·같은 정류장·연구 잠김을 이유와 함께 거부한다', () => {
    const { w, a, b } = setup(20, 14);
    for (let x = 0; x < w.width; x++) w.setResource(x, 10, 'water', Infinity);
    expect(planRoad(w, a.id, b.id)).toMatchObject({ ok: false });
    expect(planRoad(w, a.id, a.id)).toMatchObject({ ok: false });
    w.revealed = new Uint8Array(w.width * w.height).fill(1); w.revealed[w.idx(b.x, b.y)] = 0;
    expect(planRoad(w, a.id, b.id)).toMatchObject({ ok: false, reason: '공개된 정류장만 연결할 수 있어요' });
    w.unlockedBuildings.delete('road'); expect(planRoad(w, a.id, b.id).ok).toBe(false);
  });

  it('재료가 모자라도 경로·총비용은 보여주되 건설 시 일부 설치나 소비 없이 실패한다', () => {
    const { w, a, b } = setup(); w.stock.set('stone', 2);
    const p = plan(w, a, b); expect(p.cost).toEqual([{ item: 'stone', count: 14 }]);
    const hash = w.checksum(), saved = w.serialize();
    expect(applyCommand(w, 0, command(p)).ok).toBe(false);
    expect(w.checksum()).toBe(hash); expect(w.serialize()).toEqual(saved);
  });

  it('미리보기 후 장애물·기존 도로 비용이 바뀌면 다른 경로를 몰래 짓지 않는다', () => {
    const { w, a, b } = setup(), p = plan(w, a, b), t = p.path[5];
    w.place('belt', t % w.width, Math.floor(t / w.width), 0);
    const hash = w.checksum(); expect(applyCommand(w, 0, command(p)).ok).toBe(false); expect(w.checksum()).toBe(hash);
    const fresh = plan(w, a, b), one = fresh.newTiles[0];
    w.place('road', one % w.width, Math.floor(one / w.width), 0);
    const after = w.checksum(); expect(applyCommand(w, 0, command(fresh)).ok).toBe(false); expect(w.checksum()).toBe(after);
  });

  it('정류장 삭제·변조된 요청·중복 요청을 거부하고 플레이어별 한 단계 되돌리기·다시 실행을 지원한다', () => {
    const { w, a, b } = setup(), p = plan(w, a, b), cost = w.stockOf('stone');
    expect(buildRoad(w, a.id, b.id, [p.path[0], p.path.at(-1)!], p.newTiles).ok).toBe(false);
    expect(applyCommand(w, 4, command(p)).ok).toBe(true);
    const built = w.checksum(); expect(applyCommand(w, 4, command(p)).ok).toBe(false); expect(w.checksum()).toBe(built);
    expect(applyCommand(w, 0, { t: 'undo' })).toBeNull();
    expect(applyCommand(w, 4, { t: 'undo' })).not.toBeNull();
    expect(p.newTiles.every((t) => !w.isRoad(t))).toBe(true); expect(w.stockOf('stone')).toBe(cost);
    expect(applyCommand(w, 4, { t: 'redo' })).not.toBeNull();
    expect(p.newTiles.every((t) => w.isRoad(t))).toBe(true);
    w.remove(b); const hash = w.checksum();
    expect(applyCommand(w, 4, command(p)).ok).toBe(false); expect(w.checksum()).toBe(hash);
  });

  it('참가자들이 같은 계획을 재현하고 스냅샷을 복원해도 같은 상태를 유지한다', () => {
    const { w, a, b } = setup(20, 14), snapshot = JSON.parse(JSON.stringify(w.snapshot()));
    const guest = World.fromSnapshot(snapshot), p = plan(w, a, b);
    const theirs = plan(guest, guest.buildings.get(a.id)!, guest.buildings.get(b.id)!);
    expect(theirs).toEqual(p);
    for (const world of [w, guest]) expect(applyCommand(world, 2, command(p)).ok).toBe(true);
    expect(w.checksum()).toBe(guest.checksum());
    expect(World.fromSnapshot(JSON.parse(JSON.stringify(w.snapshot()))).checksum()).toBe(w.checksum());
  });

  it('한 칸을 함께 정차에 쓰는 정류장과 기존 세계에서도 연결할 수 있다', () => {
    const { w, a, b } = setup(7, 5);
    w.rules = 'legacy-v042';
    const p = plan(w, a, b);
    expect(p.path).toHaveLength(1); expect(p.turns).toBe(0);
    expect(applyCommand(w, 0, command(p))).toMatchObject({ ok: true, placed: 1 });
    expect(w.stationStops(a)).toContain(p.path[0]); expect(w.stationStops(b)).toContain(p.path[0]);
  });

  it.each([false, true])('자동 건설 도로로 주석을 실제 배송한다: 다른 거점=%s', (different) => {
    const w = new World(80, 32); w.rules = 'regional-v1'; w.createHub(0, 9);
    for (const t of w.techs) w.applyTech(t.id);
    for (const item of ITEM_IDS) w.stock.set(item, 1000);
    const a = w.place('station', 6, 10, 0)!;
    if (different) w.place('wind', 50, 10, 0);
    const b = w.place('station', different ? 54 : 15, 10, 0)!;
    w.setStationMode(b, 'unload');
    expect(a.zone !== b.zone).toBe(different);
    const p = plan(w, a, b); expect(applyCommand(w, 0, command(p)).ok).toBe(true);
    a.inBuf.set('tin-ore', 12); a.inBuf.set('tin-plate', 8);
    const v = w.buildTruck(a)!; expect(v).not.toBeNull();
    v.battery = w.truckBattery(v);
    w.setStops(v, [{ id: a.id, act: 'load' }, { id: b.id, act: 'unload' }]);
    for (let tick = 0; tick < 3600 && w.stats.delivered < 20; tick++) w.tick();
    expect(w.stats.delivered).toBe(20);
    const checks = MAIN_GOAL_BY_ID.MG10.checks(w);
    expect(checks[1][1]).toBe(different ? 20 : 0);
    expect(checks[0][1]).toBe(0); // 허브 재고나 배송 자체는 주석판 생산이 아니다.
  });
});
