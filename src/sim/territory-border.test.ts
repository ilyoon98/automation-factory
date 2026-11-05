import { describe, expect, it } from 'vitest';
import { ITEM_IDS } from '../data/items';
import { TerritoryHost, AWAY_GRACE_MS } from '../net/territory-host';
import { applyCommand } from './commands';
import { DX, DY, type Dir } from './dir';
import { generateTerritoryWorld } from './territory-map';
import { Vehicle } from './vehicle';
import { World } from './world';

function world() {
  const w = generateTerritoryWorld(9);
  for (const t of w.techs) w.applyTech(t.id);
  for (const item of ITEM_IDS) w.stock.set(item, 100000);
  w.territories[0].owner = 0;
  w.territories[1].owner = 3; w.territories[1].key = 'k3';
  return w;
}

const free = (w: World, x: number, y: number) => w.inBounds(x, y) && !w.resItem[w.idx(x, y)] && !w.occ[w.idx(x, y)];
const land = (w: World, x: number, y: number) => (w.inBounds(x, y) ? w.territory![w.idx(x, y)] : -1);
const far = (w: World, x: number, y: number) => Math.hypot(x - w.width / 2, y - w.height / 2) > 70;

/** 산지 1 칸에서 dir 방향으로 gap칸 떨어진 곳이 산지 2인 자리 (사이 칸은 모두 비어 있음) */
function across(w: World, gap: number): [number, number, Dir] {
  for (let y = 4; y < w.height - 4; y++) {
    for (let x = 4; x < w.width - 4; x++) {
      if (land(w, x, y) !== 1 || !far(w, x, y)) continue;
      for (const d of [0, 1, 2, 3] as Dir[]) {
        const ex = x + DX[d] * gap, ey = y + DY[d] * gap;
        if (land(w, ex, ey) !== 2) continue;
        let ok = true;
        for (let k = 0; k <= gap; k++) if (!free(w, x + DX[d] * k, y + DY[d] * k)) ok = false;
        if (ok) return [x, y, d];
      }
    }
  }
  throw new Error('경계 자리 없음');
}

describe('경계 잇기', () => {
  it('지하 컨베이어는 남의 땅을 끼고 짝을 짓지 않고, 내 땅 안에서는 그대로 짝을 짓는다', () => {
    const w = world();
    const [x, y, d] = across(w, 3);
    const a = applyCommand(w, 0, { t: 'place', tool: 'underground', x, y, dir: d, initial: true, setting: null }).building!;
    const b = applyCommand(w, 3, { t: 'place', tool: 'underground', x: x + DX[d] * 3, y: y + DY[d] * 3, dir: d, initial: true, setting: null }).building!;
    expect(a && b).toBeTruthy();
    expect(w.partnerOf(a)).toBeNull();
    expect(w.partnerOf(b)).toBeNull();
    // 같은 땅 안 (산지 1 깊숙이)
    for (let y2 = 4; y2 < w.height - 4; y2++) {
      for (let x2 = 4; x2 < w.width - 4; x2++) {
        if (![0, 1, 2, 3].every((k) => land(w, x2 + k, y2) === 1 && free(w, x2 + k, y2))) continue;
        const i = applyCommand(w, 0, { t: 'place', tool: 'underground', x: x2, y: y2, dir: 1, initial: true, setting: null }).building!;
        const o = applyCommand(w, 0, { t: 'place', tool: 'underground', x: x2 + 3, y: y2, dir: 1, initial: true, setting: null }).building!;
        expect(w.partnerOf(i)?.id).toBe(o.id);
        return;
      }
    }
    throw new Error('같은 땅 자리 없음');
  });

  it('기계는 남의 땅 전봇대에서 전기를 끌어오지 않고, 내 땅 전봇대가 생기면 거기에 붙는다', () => {
    const w = world();
    // 내 땅(산지 1) 2×2 제련로 자리, 바로 옆 남의 땅(산지 2)에 전봇대, 반대쪽 내 땅에 전봇대 자리
    for (let y = 4; y < w.height - 4; y++) {
      for (let x = 6; x < w.width - 8; x++) {
        for (const s of [1, -1]) {
          const box = [[0, 0], [1, 0], [0, 1], [1, 1]].map(([dx, dy]) => [x + dx, y + dy]);
          const foreign = [s > 0 ? x + 4 : x - 3, y], own = [s > 0 ? x - 2 : x + 3, y];
          if (!far(w, x, y) || !box.every(([bx, by]) => land(w, bx, by) === 1 && free(w, bx, by))) continue;
          if (land(w, foreign[0], foreign[1]) !== 2 || !free(w, foreign[0], foreign[1])) continue;
          if (land(w, own[0], own[1]) !== 1 || !free(w, own[0], own[1])) continue;
          const smelter = applyCommand(w, 0, { t: 'place', tool: 'smelter', x, y, dir: 0, initial: true, setting: null }).building!;
          const theirs = applyCommand(w, 3, { t: 'place', tool: 'pole', x: foreign[0], y: foreign[1], dir: 0, initial: true, setting: null }).building!;
          expect(smelter && theirs).toBeTruthy();
          w.netOf(smelter);
          expect(smelter.node).not.toBe(theirs.id);
          const mine = applyCommand(w, 0, { t: 'place', tool: 'pole', x: own[0], y: own[1], dir: 0, initial: true, setting: null }).building!;
          w.netOf(smelter);
          expect(smelter.node).toBe(mine.id);
          return;
        }
      }
    }
    throw new Error('자리 없음');
  });
});

describe('트럭 주인', () => {
  const truck = (w: World, owner: number, key: string) => {
    const v = new Vehicle(w.nextVehicleId++, w.idx(w.width / 2 + 3, w.height / 2 + 3), w.width);
    v.owner = owner; v.ownerKey = key;
    w.vehicles.set(v.id, v);
    return v;
  };

  it('만든 사람만 이름·노선·철거를 바꾸고, 저장·불러오기에 주인이 남는다', () => {
    const w = world();
    const v = truck(w, 3, 'k3');
    expect(applyCommand(w, 0, { t: 'truck-name', id: v.id, name: '훔친 트럭' })).toBe(false);
    expect(applyCommand(w, 0, { t: 'remove-truck', id: v.id })).toBe(false);
    expect(w.vehicles.has(v.id)).toBe(true);
    expect(applyCommand(w, 3, { t: 'truck-name', id: v.id, name: '석탄차' })).toBe(true);
    const loaded = World.deserialize(JSON.parse(JSON.stringify(w.serialize())));
    expect(loaded.vehicles.get(v.id)).toMatchObject({ owner: 3, ownerKey: 'k3', name: '석탄차' });
    expect(loaded.checksum()).toBe(World.deserialize(JSON.parse(JSON.stringify(w.serialize()))).checksum());
    expect(applyCommand(w, 3, { t: 'remove-truck', id: v.id })).toBe(true);
  });

  it('떠난 사람의 트럭은 2분 뒤 방장에게, 같은 키로 돌아오면 새 번호로 이어받는다', () => {
    const w = world();
    let now = 0;
    const host = new TerritoryHost(() => w, (cmd) => applyCommand(w, 0, cmd), () => now);
    host.joined(3, 'k3');
    const a = truck(w, 3, 'k3');
    host.left(3);
    now += AWAY_GRACE_MS - 1; host.tick();
    expect(a.owner).toBe(3);
    host.joined(8, 'k3');
    expect(a).toMatchObject({ owner: 8, ownerKey: 'k3' });
    host.left(8);
    now += AWAY_GRACE_MS + 1; host.tick();
    expect(a).toMatchObject({ owner: 0, ownerKey: '' });
  });

  it('산지 없는 세계의 트럭은 누구나 고친다 (지금처럼)', () => {
    const w = new World(40, 30); w.rules = 'regional-v1'; w.createHub(0, 0);
    const v = truck(w, 3, 'k3');
    expect(applyCommand(w, 0, { t: 'truck-name', id: v.id, name: '공용' })).toBe(true);
  });
});
