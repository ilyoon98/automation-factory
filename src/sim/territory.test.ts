import { describe, expect, it } from 'vitest';
import { ITEM_IDS } from '../data/items';
import { applyCommand } from './commands';
import { PLAZA_RADIUS, TERRITORY_COUNT, generateTerritoryWorld } from './territory-map';
import { World } from './world';

const world = (seed = 7) => {
  const w = generateTerritoryWorld(seed);
  for (const t of w.techs) w.applyTech(t.id);
  for (const item of ITEM_IDS) w.stock.set(item, 10000);
  return w;
};

/** 산지 t 안의 빈 칸 하나 (광맥·건물 없는 곳) */
function spot(w: World, id: number): [number, number] {
  for (let i = 0; i < w.width * w.height; i++) {
    const x = i % w.width, y = Math.floor(i / w.width);
    if (w.territory![i] !== id || w.resItem[i] || w.occ[i]) continue;
    if (x < 2 || y < 2 || x > w.width - 3 || y > w.height - 3) continue;
    if ([[1, 0], [0, 1], [1, 1]].every(([dx, dy]) => w.territory![w.idx(x + dx, y + dy)] === id && !w.resItem[w.idx(x + dx, y + dy)])) return [x, y];
  }
  throw new Error('빈 칸 없음');
}

describe('산지 협동 지도', () => {
  it('가운데 광장과 여덟 산지가 있고, 산지마다 자기 자원만 나오며 같은 자원은 반대편이다', () => {
    const w = world();
    const c = w.width / 2;
    expect(w.territory![w.idx(c, c)]).toBe(0);
    expect(w.hub && w.territory![w.idx(w.hub.x, w.hub.y)]).toBe(0);
    expect(w.territories.map((t) => t.item)).toEqual(['iron-ore', 'coal', 'copper-ore', 'stone', 'iron-ore', 'coal', 'copper-ore', 'stone']);
    const found = new Map<number, Set<string>>();
    for (let i = 0; i < w.width * w.height; i++) {
      const item = w.resItem[i];
      if (!item || item === 'water') continue;
      const id = w.territory![i];
      expect(id).toBeGreaterThan(0);
      if (!found.has(id)) found.set(id, new Set());
      found.get(id)!.add(item);
    }
    for (let id = 1; id <= TERRITORY_COUNT; id++) expect([...found.get(id)!]).toEqual([w.territories[id - 1].item]);
    // 광장 안은 광맥 없이 물만
    for (let i = 0; i < w.width * w.height; i++) if (w.territory![i] === 0 && w.resItem[i]) expect(w.resItem[i]).toBe('water');
    expect(PLAZA_RADIUS).toBeGreaterThan(20);
  });

  it('같은 씨앗이면 같은 지도이고, 저장·불러오기와 같이 하기 스냅샷에도 산지가 그대로 남는다', () => {
    const a = world(11), b = world(11);
    expect(a.checksum()).toBe(b.checksum());
    a.territories[2].owner = 5;
    const loaded = World.deserialize(JSON.parse(JSON.stringify(a.serialize())));
    expect([...loaded.territory!]).toEqual([...a.territory!]);
    expect(loaded.territories).toEqual(a.territories);
    const snap = World.fromSnapshot(JSON.parse(JSON.stringify(a.snapshot())));
    expect(snap.checksum()).toBe(a.checksum());
    b.territories[2].owner = 6;
    expect(b.checksum()).not.toBe(a.checksum());
  });
});

describe('내 땅에서만 짓기', () => {
  it('주인은 자기 산지와 광장에 짓고, 다른 사람은 광장에만 짓는다', () => {
    const w = world();
    w.territories[0].owner = 0; w.territories[1].owner = 3;
    const [ax, ay] = spot(w, 1), [bx, by] = spot(w, 2);
    const c = w.width / 2;
    expect(applyCommand(w, 0, { t: 'place', tool: 'storage', x: ax, y: ay, dir: 0, initial: true, setting: null }).ok).toBe(true);
    const denied = applyCommand(w, 0, { t: 'place', tool: 'storage', x: bx, y: by, dir: 0, initial: true, setting: null });
    expect(denied).toMatchObject({ ok: false, reason: '다른 사람의 석탄 산지예요' });
    expect(applyCommand(w, 3, { t: 'place', tool: 'storage', x: bx, y: by, dir: 0, initial: true, setting: null }).ok).toBe(true);
    expect(applyCommand(w, 3, { t: 'place', tool: 'storage', x: c + 6, y: c + 6, dir: 0, initial: true, setting: null }).ok).toBe(true);
    expect(applyCommand(w, 3, { t: 'place', tool: 'storage', x: ax + 4, y: ay, dir: 0, initial: true, setting: null }).ok).toBe(false);
  });

  it('남의 산지 건물은 철거·회전·설정하지 못하고, 영역 철거는 내 것만 지운다', () => {
    const w = world();
    w.territories[0].owner = 0; w.territories[1].owner = 3;
    const [ax, ay] = spot(w, 1);
    const smelter = applyCommand(w, 0, { t: 'place', tool: 'smelter', x: ax, y: ay, dir: 0, initial: true, setting: null }).building!;
    expect(applyCommand(w, 3, { t: 'remove', id: smelter.id })).toBe(false);
    expect(applyCommand(w, 3, { t: 'remove-at', x: smelter.x, y: smelter.y })).toBe(false);
    applyCommand(w, 3, { t: 'rotate', id: smelter.id, dir: 2 });
    expect(smelter.dir).toBe(0);
    expect(applyCommand(w, 3, { t: 'config', id: smelter.id, key: 'recipe', value: 'iron-plate' })).toBe(false);
    expect(applyCommand(w, 3, { t: 'remove-area', x0: smelter.x - 1, y0: smelter.y - 1, x1: smelter.x + 3, y1: smelter.y + 3 })).toBe(0);
    expect(w.buildings.has(smelter.id)).toBe(true);
    expect(applyCommand(w, 0, { t: 'remove', id: smelter.id })).toBe(true);
  });

  it('남의 땅으로 도로를 내거나 청사진을 붙여 넣어도 그 칸은 짓지 않는다', () => {
    const w = world();
    w.territories[1].owner = 3;
    const [bx, by] = spot(w, 2);
    const r = applyCommand(w, 0, { t: 'paste', bp: { w: 1, h: 1, entries: [{ type: 'storage', dx: 0, dy: 0, dir: 0 }] } as never, x: bx, y: by });
    expect(r.placed).toBe(0);
    expect(w.buildingAt(bx, by)).toBeNull();
  });

  it('산지 없는 세계는 지금처럼 어디든 짓는다', () => {
    const w = new World(40, 30); w.rules = 'regional-v1'; w.createHub(0, 0);
    for (const t of w.techs) w.applyTech(t.id);
    for (const item of ITEM_IDS) w.stock.set(item, 1000);
    expect(w.foreignTerritory(9, 10, 10, 2)).toBeNull();
    expect(applyCommand(w, 9, { t: 'place', tool: 'storage', x: 10, y: 10, dir: 0, initial: true, setting: null }).ok).toBe(true);
  });
});
