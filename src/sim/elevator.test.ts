import { describe, expect, it } from 'vitest';
import { ITEM_IDS, type ItemId } from '../data/items';
import { TerritoryHost } from '../net/territory-host';
import { applyCommand } from './commands';
import { ELEVATOR_SIZE, ELEVATOR_STAGES, stageNeed } from './elevator';
import { generateTerritoryWorld } from './territory-map';
import type { Building } from './building';
import { World } from './world';

const world = () => {
  const w = generateTerritoryWorld(6);
  for (const t of w.techs) w.applyTech(t.id);
  for (const item of ITEM_IDS) w.stock.set(item, 10000);
  return w;
};

/** 허브에 실제로 하나 넣기 (컨베이어가 허브에 넣는 것과 같은 길) */
const toHub = (w: World, item: ItemId, n = 1) => {
  const accept = (w as unknown as { acceptItem(b: Building, i: ItemId, src: Building, side: number): boolean }).acceptItem.bind(w);
  for (let k = 0; k < n; k++) accept(w.hub!, item, w.hub!, 0);
};

describe('우주 엘리베이터', () => {
  it('광장 안 허브 옆에 부지가 있고, 그 자리에는 아무것도 짓지 못한다', () => {
    const w = world();
    const e = w.elevator!;
    for (let j = 0; j < ELEVATOR_SIZE; j++) for (let i = 0; i < ELEVATOR_SIZE; i++) expect(w.territory![w.idx(e.x + i, e.y + j)]).toBe(0);
    expect(applyCommand(w, 0, { t: 'place', tool: 'belt', x: e.x + 1, y: e.y + 1, dir: 0, initial: true, setting: null })).toMatchObject({ ok: false, reason: '우주 엘리베이터 부지예요' });
  });

  it('허브에 들어온 물건 중 지금 단계에 필요한 만큼만 엘리베이터로 가고, 나머지와 다른 품목은 허브 재고로', () => {
    const w = world();
    const e = w.elevator!;
    e.scale = 0.001; // 콘크리트·벽돌 각 3개
    const stock = (i: ItemId) => w.stockOf(i);
    const before = stock('concrete');
    toHub(w, 'concrete', 5);
    expect(e.delivered.get('concrete')).toBe(3);
    expect(stock('concrete')).toBe(before + 2);
    toHub(w, 'iron-plate', 2);
    expect(e.delivered.has('iron-plate')).toBe(false);
    toHub(w, 'brick', 3);
    expect(e.stage).toBe(1);
    expect(e.delivered.size).toBe(0);
  });

  it('납품을 끄면 모두 허브 재고로 가고, 네 단계를 마치면 완공 시각이 남는다', () => {
    const w = world();
    const e = w.elevator!;
    e.scale = 0.001;
    applyCommand(w, 3, { t: 'elevator', on: false });
    toHub(w, 'concrete', 3);
    expect(e.delivered.size).toBe(0);
    applyCommand(w, 0, { t: 'elevator', on: true });
    for (const s of ELEVATOR_STAGES) for (const [item] of s.items) toHub(w, item, stageNeed(e, item));
    expect(e.stage).toBe(ELEVATOR_STAGES.length);
    expect(e.doneAt).toBe(w.time);
    toHub(w, 'steel', 1);
    expect(e.stage).toBe(ELEVATOR_STAGES.length);
  });

  it('납품량은 4명 기준: 혼자면 그대로, 2명이면 절반 (방장이 정한다)', () => {
    const w = world();
    const host = new TerritoryHost(() => w, (cmd) => applyCommand(w, 0, cmd), () => 0);
    host.adopt();
    expect(stageNeed(w.elevator!, 'concrete')).toBe(3000);
    host.joined(5, 'k5');
    expect(w.elevator!.scale).toBe(0.5);
    expect(stageNeed(w.elevator!, 'concrete')).toBe(1500);
    expect(applyCommand(w, 5, { t: 'territories', owners: w.territories.map((t) => t.owner), keys: w.territories.map((t) => t.key), scale: 2 })).toBe(false);
    expect(w.elevator!.scale).toBe(0.5);
  });

  it('저장·불러오기·체크섬에 단계와 납품이 남는다', () => {
    const w = world();
    w.elevator!.scale = 0.001;
    toHub(w, 'concrete', 2);
    const loaded = World.deserialize(JSON.parse(JSON.stringify(w.serialize())));
    expect(loaded.elevator).toMatchObject({ stage: 0, on: true, x: w.elevator!.x, y: w.elevator!.y });
    expect(loaded.elevator!.delivered.get('concrete')).toBe(2);
    expect(loaded.checksum()).toBe(w.checksum());
  });
});

describe('사람별 기여', () => {
  it('지은 건물은 지은 사람, 산지에서 만든 것은 그 땅 주인에게 적고 저장에 남긴다', () => {
    const w = world();
    w.territories[1].owner = 4; w.territories[1].key = 'k4';
    // 산지 2(석탄) 안 빈 칸
    let at: [number, number] | null = null;
    for (let i = 0; i < w.territory!.length && !at; i++) if (w.territory![i] === 2 && !w.resItem[i] && !w.occ[i]) at = [i % w.width, Math.floor(i / w.width)];
    const r = applyCommand(w, 4, { t: 'place', tool: 'belt', x: at![0], y: at![1], dir: 0, initial: true, setting: null });
    expect(r.ok).toBe(true);
    expect(w.contrib.get('k4')?.built).toBe(1);
    const c = w.width / 2;
    applyCommand(w, 0, { t: 'place', tool: 'belt', x: c + 4, y: c + 4, dir: 0, initial: true, setting: null });
    expect(w.contrib.get('#0')?.built).toBe(1);
    // 생산: 그 땅에 놓인 설비가 만든 개수
    const produce = (w as unknown as { produce(b: Building, i: ItemId, n: number): void }).produce.bind(w);
    produce(r.building!, 'coal', 7);
    expect(w.contrib.get('k4')?.made).toBe(7);
    const loaded = World.deserialize(JSON.parse(JSON.stringify(w.serialize())));
    expect(loaded.contrib.get('k4')).toEqual({ made: 7, built: 1, hauled: 0 });
    expect(loaded.checksum()).toBe(w.checksum());
  });
});
