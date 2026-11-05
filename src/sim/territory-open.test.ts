import { describe, expect, it } from 'vitest';
import { ITEM_IDS } from '../data/items';
import { TerritoryHost } from '../net/territory-host';
import { applyCommand } from './commands';
import { evaluateGoals } from './goals';
import { TERRITORY_START_OPEN, generateTerritoryWorld } from './territory-map';
import { TERRITORY_TASKS, currentTerritoryTask } from './territory-goals';
import { World } from './world';

const world = () => {
  const w = generateTerritoryWorld(4);
  for (const t of w.techs) w.applyTech(t.id);
  for (const item of ITEM_IDS) w.stock.set(item, 10000);
  return w;
};

/** 산지 id 안의 빈 칸 */
function spot(w: World, id: number): [number, number] {
  for (let i = 0; i < w.territory!.length; i++) {
    if (w.territory![i] === id && !w.resItem[i] && !w.occ[i]) return [i % w.width, Math.floor(i / w.width)];
  }
  throw new Error('빈 칸 없음');
}

describe('산지 점점 열기', () => {
  it('허브 둘레는 모두 광장이라, 허브에서 꺼내는 하역기·정류장은 광장에만 놓인다', () => {
    const w = world();
    const h = w.hub!;
    for (let y = h.y - 3; y < h.y + h.size + 3; y++) for (let x = h.x - 3; x < h.x + h.size + 3; x++) expect(w.territory![w.idx(x, y)]).toBe(0);
  });

  it('처음에는 자원마다 하나씩 네 곳만 열려 있고, 닫힌 산지에는 아무도 짓지 못한다', () => {
    const w = world();
    expect(w.territories.filter((t) => t.open).map((t) => t.item)).toEqual(['iron-ore', 'coal', 'copper-ore', 'stone']);
    expect(TERRITORY_START_OPEN).toBe(4);
    const [x, y] = spot(w, 5);
    const r = applyCommand(w, 0, { t: 'place', tool: 'belt', x, y, dir: 0, initial: true, setting: null });
    expect(r).toMatchObject({ ok: false, reason: '아직 열리지 않은 철 산지예요 (산지 과제를 이루면 열려요)' });
  });

  it('산지 과제를 차례로 이루면 닫힌 산지가 하나씩 열리고, 지역 과제는 판정하지 않는다', () => {
    const w = world();
    expect(currentTerritoryTask(w)?.id).toBe('T1');
    for (const item of ['iron-plate', 'coal', 'copper-plate', 'stone'] as const) w.stats.hubIn.set(item, 50);
    const got = evaluateGoals(w);
    expect(got).toContain('T1');
    expect(got).toContain('open:5');
    expect(w.territories[4].open).toBe(true);
    expect(currentTerritoryTask(w)?.id).toBe('T2');
    expect([...w.challenges].some((c) => c.startsWith('R'))).toBe(false);
    // 같은 틱에 다음 과제를 건너뛰지 않는다
    for (const t of TERRITORY_TASKS) for (const [, , need, hint] of t.checks(w)) if (hint?.item) w.stats.hubIn.set(hint.item, need);
    evaluateGoals(w); evaluateGoals(w); evaluateGoals(w);
    expect(w.territories.every((t) => t.open)).toBe(true);
    expect(TERRITORY_TASKS.every((t) => w.challenges.has(t.id))).toBe(true);
  });

  it('혼자면 새로 열린 산지도 내 땅이 되고, 사람이 열린 곳보다 많으면 방장이 사람 수만큼 연다', () => {
    const w = world();
    const host = new TerritoryHost(() => w, (cmd) => applyCommand(w, 0, cmd), () => 0);
    host.adopt();
    w.openNextTerritory();
    host.tick();
    expect(w.territories[4]).toMatchObject({ open: true, owner: 0 });
    for (const [p, key] of [[1, 'a'], [2, 'b'], [3, 'c'], [4, 'd'], [5, 'e']] as const) host.joined(p, key);
    expect(w.territories.filter((t) => t.open).length).toBe(6);
    for (let p = 0; p <= 5; p++) expect(w.territories.some((t) => t.owner === p)).toBe(true);
  });

  it('열림 상태는 저장·체크섬에 남고, 손님이 산지를 열 수는 없다', () => {
    const w = world();
    w.openNextTerritory();
    const loaded = World.deserialize(JSON.parse(JSON.stringify(w.serialize())));
    expect(loaded.territories.map((t) => t.open)).toEqual(w.territories.map((t) => t.open));
    expect(loaded.checksum()).toBe(w.checksum());
    const owners = w.territories.map((t) => t.owner), keys = w.territories.map((t) => t.key);
    expect(applyCommand(w, 3, { t: 'territories', owners, keys, open: w.territories.map(() => true) })).toBe(false);
    expect(w.territories.filter((t) => t.open).length).toBe(5);
  });
});
