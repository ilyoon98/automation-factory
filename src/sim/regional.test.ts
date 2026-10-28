import { describe, expect, it } from 'vitest';
import { ADVANCED_TRUCK, BUILDINGS, MODULE, TRUCK } from '../data/buildings';
import { ITEM_IDS } from '../data/items';
import { RECIPES } from '../data/recipes';
import { REGIONAL_TECHS, TECHS, techsFor } from '../data/tech';
import { copyArea, pasteBlueprint } from './blueprint';
import { countOf, type Building } from './building';
import { applyCommand, type Command } from './commands';
import type { Dir } from './dir';
import { TICK_RATE, World, groupKey, portTiles } from './world';

/**
 * 지역 생산망 확장(regional-v1)의 기반 데이터와
 * docs/모듈-장착-트럭생성-상세기획.md §12 검증 시나리오 (M01~M10, V01~V08, S01~S02)
 */

let ridNo = 0;
const rid = () => `t-${++ridNo}`;

/** regional-v1 세계. 허브 (0,9)~(2,11), 모든 연구 완료, 허브 재고 넉넉 */
function makeRegional(): World {
  const w = new World(40, 30);
  w.rules = 'regional-v1';
  w.createHub(0, 9);
  for (const t of w.techs) w.applyTech(t.id);
  for (const item of ['iron-plate', 'gear', 'stone', 'steel', 'circuit', 'copper-plate', 'coal'] as const) w.stock.set(item, 5000);
  for (const item of ['frame', 'motor', 'controller', 'bronze', 'brick'] as const) w.stock.set(item, 100);
  return w;
}

function run(w: World, seconds: number) {
  for (let i = 0; i < Math.round(seconds * TICK_RATE); i++) w.tick();
}

/** 실물 개수: 창고·정류장·기계 버퍼·슬롯·회수 더미·차량(화물+포함 원가)·허브를 한 번씩만 센다 */
function total(w: World, item: 'module' | 'truck-kit' | 'iron-plate' | 'coal'): number {
  let n = w.stockOf(item);
  for (const b of w.buildings.values()) {
    n += countOf(b.inBuf, item) + countOf(b.outBuf, item);
    if (item === 'module' && b.module) n++;
  }
  for (const p of w.piles) if (p.item === item) n += p.n;
  for (const v of w.vehicles.values()) {
    n += countOf(v.cargo, item);
    if (v.kit?.item === item) n++;
  }
  return n;
}

/** 제련로 (10,10)~(11,11), 북쪽 출구. 강철 레시피 (5초) */
function smelterAt(w: World, x = 10, y = 10, dir: Dir = 0): Building {
  const b = w.place('smelter', x, y, dir)!;
  expect(w.setRecipe(b, 'steel')).toBe(true);
  return b;
}

function feed(b: Building) {
  b.inBuf.set('iron-plate', 40);
  b.inBuf.set('coal', 20);
}

function install(w: World, b: Building, storage: Building, key = groupKey(w.storageGroup(storage))) {
  return applyCommand(w, 0, { t: 'module-install', rid: rid(), id: b.id, storage: storage.id, key });
}

function detach(w: World, b: Building, mode: 'normal' | 'cancel-request' | 'force') {
  return applyCommand(w, 0, { t: 'module-detach', rid: rid(), id: b.id, mode });
}

function viaNet(w: World): World {
  return World.fromSnapshot(JSON.parse(JSON.stringify(w.snapshot())));
}

describe('P0: 규칙 프로필과 새 데이터', () => {
  it('아이템 55종 (기존 27 + 신규 28), 기존 아이템 번호는 그대로', () => {
    expect(ITEM_IDS.length).toBe(55);
    expect(ITEM_IDS.indexOf('paper')).toBe(26);
    expect(ITEM_IDS.indexOf('tin-ore')).toBe(27);
    expect(ITEM_IDS.at(-1)).toBe('module');
  });

  it('신규 레시피 23개 (P01~P23)가 있고 재료가 모두 정의된 아이템이다', () => {
    const ids = ['tin-plate', 'bronze', 'bronze-drive', 'rubber', 'insulated-wire', 'motor', 'plastic', 'adv-circuit', 'controller',
      'aluminum-plate', 'frame', 'hardened-rubber', 'tire', 'sulfuric-acid', 'acid-wash', 'lithium', 'battery-pack', 'hc-cable',
      'lubricant', 'fuel', 'adv-lubricant', 'truck-kit', 'module'];
    expect(ids.length).toBe(23);
    for (const id of ids) {
      const r = RECIPES[id];
      expect(r, id).toBeDefined();
      for (const s of [...r.inputs, ...r.outputs]) expect(ITEM_IDS).toContain(s.item);
    }
    expect(RECIPES.module.inputs.reduce((n, s) => n + s.count, 0)).toBe(16);
    expect(RECIPES.module.time).toBe(30);
    expect(RECIPES['truck-kit'].time).toBe(20);
  });

  it('예전 세계의 연구 비용은 그대로, regional-v1은 새 비용 + 산업 연구 8종', () => {
    const legacy = techsFor('legacy-v042');
    const regional = techsFor('regional-v1');
    expect(legacy).toBe(TECHS);
    expect(legacy.length).toBe(20);
    expect(regional.length).toBe(28);
    expect(legacy.find((t) => t.id === 'automation')!.cost).toEqual([{ item: 'iron-plate', count: 40 }]);
    expect(regional.find((t) => t.id === 'automation')!.cost).toEqual([{ item: 'iron-plate', count: 20 }]);
    // 첫 트럭 기준 8종 합계 (경제 기획 §3)
    const first8 = ['automation', 'logistics', 'storage', 'copper-working', 'power', 'steel', 'electronics', 'vehicles'];
    const sum = (item: string) =>
      regional.filter((t) => first8.includes(t.id)).reduce((n, t) => n + (t.cost.find((c) => c.item === item)?.count ?? 0), 0);
    expect([sum('iron-plate'), sum('gear'), sum('copper-plate'), sum('copper-wire'), sum('coal'), sum('steel'), sum('circuit')]).toEqual([
      230, 150, 40, 100, 50, 80, 30,
    ]);
    // 산업 연구의 선행은 모두 있는 연구
    for (const t of REGIONAL_TECHS) for (const r of t.requires) expect(regional.some((x) => x.id === r), `${t.id} ← ${r}`).toBe(true);
  });

  it('예전 세계에서는 산업 연구가 없다', () => {
    const w = new World(10, 10);
    expect(w.canResearch('alloy').ok).toBe(false);
    expect(w.tech('alloy')).toBeUndefined();
  });

  it('기존 저장(규칙 없음)은 legacy-v042로 읽고, 모르는 규칙은 열지 않는다', () => {
    const w = new World(10, 10);
    w.createHub(0, 0);
    const data = JSON.parse(JSON.stringify(w.serialize()));
    expect(data.rules).toBeUndefined();
    expect(World.deserialize(data).rules).toBe('legacy-v042');
    const r = makeRegional();
    expect(World.deserialize(JSON.parse(JSON.stringify(r.serialize()))).rules).toBe('regional-v1');
    expect(() => World.deserialize({ ...data, rules: 'regional-v9' })).toThrow();
  });

  it('기본 트럭 비용·성능, 고급 트럭 수치 (칸당 15kJ 같음)', () => {
    expect(TRUCK.cost).toEqual([
      { item: 'steel', count: 10 },
      { item: 'gear', count: 10 },
      { item: 'circuit', count: 5 },
    ]);
    expect([TRUCK.capacity, TRUCK.speed, TRUCK.battery, TRUCK.charge]).toEqual([50, 4, 1800, 200]);
    expect([ADVANCED_TRUCK.capacity, ADVANCED_TRUCK.speed, ADVANCED_TRUCK.battery, ADVANCED_TRUCK.charge]).toEqual([100, 5, 3600, 400]);
    expect(ADVANCED_TRUCK.drive / ADVANCED_TRUCK.speed).toBe(TRUCK.drive / TRUCK.speed);
  });

  it('대형 조립소: 지정한 여섯 입구 칸으로만 받고, 앞 가운데로만 내보낸다 (돌려도 같이 돈다)', () => {
    const w = makeRegional();
    const la = w.place('large-assembler', 10, 10, 2)!;
    expect(w.setRecipe(la, 'module')).toBe(true);
    expect(portTiles(la, 'out')).toEqual([[11, 13]]);
    expect(portTiles(la, 'in')).toEqual([[10, 9], [12, 9], [9, 10], [9, 12], [13, 10], [13, 12]]);
    // 입구 칸 (10,9)의 컨베이어는 넣고, 입구가 아닌 (11,9)는 못 넣는다
    const good = w.place('belt', 10, 9, 2)!;
    const bad = w.place('belt', 11, 9, 2)!;
    good.items.push({ item: 'frame', pos: 1, n: 1 });
    bad.items.push({ item: 'motor', pos: 1, n: 1 });
    run(w, 1);
    expect(countOf(la.inBuf, 'frame')).toBe(1);
    expect(countOf(la.inBuf, 'motor')).toBe(0);
    // 서쪽을 보게 돌리면 출구는 왼쪽 가운데
    const turned = w.place('large-assembler', 20, 10, 3)!;
    expect(portTiles(turned, 'out')).toEqual([[19, 11]]);
  });

  it('새 설비는 레시피를 직접 골라야 한다 (처음 들어온 재료로 정하지 않는다)', () => {
    const w = makeRegional();
    const cr = w.place('chem-reactor', 10, 10, 2)!;
    const belt = w.place('belt', 10, 9, 2)!;
    belt.items.push({ item: 'sap', pos: 1, n: 1 });
    run(w, 1);
    expect(cr.recipe).toBeNull();
    expect(countOf(cr.inBuf, 'sap')).toBe(0);
    w.setRecipe(cr, 'rubber');
    belt.items.push({ item: 'sap', pos: 1, n: 1 });
    run(w, 1);
    // 기다리던 수액까지 2개가 들어가 고무 제작을 시작했다
    expect(cr.crafting).toBe(true);
    expect(belt.items).toEqual([]);
  });

  it('예전 세계 철거는 내용물을 허브로, regional-v1은 그 자리 회수 더미로 (건설 원가는 둘 다 허브)', () => {
    for (const regional of [false, true]) {
      const w = makeRegional();
      if (!regional) w.rules = 'legacy-v042';
      const b = smelterAt(w);
      b.inBuf.set('coal', 3);
      const coal = w.stockOf('coal');
      const stone = w.stockOf('stone');
      w.remove(b);
      expect(w.stockOf('stone')).toBe(stone + 10);
      expect(w.stockOf('coal')).toBe(regional ? coal : coal + 3);
      expect(w.pileCount(w.idx(10, 10), 'coal')).toBe(regional ? 3 : 0);
    }
  });
});

describe('모듈 설치 (M01~M04)', () => {
  it('M01: 인접 창고의 모듈 1개로 유휴 기계에 설치 → 창고 -1·슬롯 +1, 다음 배치에만 배율', () => {
    const w = makeRegional();
    const b = smelterAt(w);
    const s = w.place('storage', 8, 10, 0)!; // 왼쪽 면에 닿음
    s.inBuf.set('module', 1);
    const r = install(w, b, s);
    expect(r).toMatchObject({ ok: true, from: s.id });
    expect(countOf(s.inBuf, 'module')).toBe(0);
    expect(b.module).toEqual({ from: s.id });
    expect(b.modBatch).toBe(false);
    expect(w.moduleState(b)).toBe('installed');
    feed(b);
    w.tick();
    expect(b.crafting && b.modBatch).toBe(true);
    // 30초·300kW 예시처럼: 5초 레시피 → 5/1.2초, 90kW → 112.5kW
    expect(w.craftTime(b)).toBeCloseTo(5 / MODULE.speed);
    expect(w.workPower(b)).toBeCloseTo(BUILDINGS.smelter.power * MODULE.power);
    expect(total(w, 'module')).toBe(1);
  });

  it('M02: 대각선·한 칸 떨어진 창고·허브에만 모듈이 있으면 실패하고 아무것도 줄지 않는다', () => {
    const w = makeRegional();
    const b = smelterAt(w);
    const diag = w.place('storage', 12, 12, 0)!; // (11,11)과 대각선
    const gap = w.place('storage', 7, 10, 0)!; // (9,10) 한 칸 띄움
    diag.inBuf.set('module', 1);
    gap.inBuf.set('module', 1);
    w.stock.set('module', 5);
    expect(install(w, b, diag).ok).toBe(false);
    expect(install(w, b, gap).ok).toBe(false);
    expect(w.touchingStorageGroups(b)).toEqual([]);
    expect(b.module).toBeNull();
    expect([countOf(diag.inBuf, 'module'), countOf(gap.inBuf, 'module'), w.stockOf('module')]).toEqual([1, 1, 5]);
  });

  it('M03: 같은 군의 여러 동이 닿아도 목록·재고를 한 번만 센다', () => {
    const w = makeRegional();
    const b = smelterAt(w);
    const a = w.place('storage', 9, 12, 0)!;
    const c = w.place('storage', 11, 12, 0)!;
    expect(w.storageGroup(a)).toHaveLength(2);
    a.inBuf.set('module', 1);
    c.inBuf.set('module', 1);
    const groups = w.touchingStorageGroups(b);
    expect(groups).toHaveLength(1);
    expect(w.groupStock(groups[0].group, 'module')).toEqual({ real: 2, reserved: 0, free: 2 });
    // 어느 동을 골라도 같은 군. 차감은 id가 작은 창고에서 한 번
    expect(install(w, b, c)).toMatchObject({ ok: true, from: a.id });
    expect(w.groupStock(groups[0].group, 'module').real).toBe(1);
  });

  it('M04: 모듈 1개에 두 기계가 설치 요청 → 먼저 처리한 한 건만, 하역기 출고와도 겹치지 않는다', () => {
    const w = makeRegional();
    const m1 = smelterAt(w, 10, 10);
    const m2 = smelterAt(w, 10, 14);
    const s = w.place('storage', 10, 12, 0)!; // 위 기계의 아래, 아래 기계의 위
    s.inBuf.set('module', 1);
    // 같은 틱에 두 명령 (두 사람)
    const k = groupKey(w.storageGroup(s));
    const r1 = applyCommand(w, 1, { t: 'module-install', rid: rid(), id: m1.id, storage: s.id, key: k });
    const r2 = applyCommand(w, 2, { t: 'module-install', rid: rid(), id: m2.id, storage: s.id, key: k });
    expect([r1.ok, r2.ok]).toEqual([true, false]);
    expect(r2.reason).toContain('모듈');
    expect(total(w, 'module')).toBe(1);
    // 설치 다음에 하역기가 돌아도 꺼낼 모듈이 없다 (음수 없음)
    s.inBuf.set('module', 1);
    w.place('unloader', 12, 12, 1); // 창고 (10,12)~(11,13) 오른쪽, 뒤가 창고
    w.place('belt', 13, 12, 1);
    const r3 = applyCommand(w, 2, { t: 'module-install', rid: rid(), id: m2.id, storage: s.id, key: k });
    expect(r3.ok).toBe(true);
    run(w, 2);
    expect(countOf(s.inBuf, 'module')).toBe(0);
    expect(total(w, 'module')).toBe(2);
  });

  it('연구 전·예전 세계·지원하지 않는 기계는 설치 실패, 슬롯이 차 있으면 추가 설치 실패', () => {
    const w = makeRegional();
    const b = smelterAt(w);
    const s = w.place('storage', 8, 10, 0)!;
    s.inBuf.set('module', 3);
    w.researched.delete('integrated-automation');
    expect(install(w, b, s).reason).toContain('통합 자동화');
    w.researched.add('integrated-automation');
    const miner = w.place('miner', 8, 12, 0)!;
    expect(install(w, miner, s).ok).toBe(false);
    expect(install(w, b, s).ok).toBe(true);
    expect(install(w, b, s).reason).toBe('이미 설치돼 있어요');
    expect(countOf(s.inBuf, 'module')).toBe(2);
    w.rules = 'legacy-v042';
    const b2 = smelterAt(w, 20, 10);
    w.place('storage', 18, 10, 0)!.inBuf.set('module', 1);
    expect(install(w, b2, w.buildingAt(18, 10)!).ok).toBe(false);
  });

  it('창고군 구조가 바뀐 뒤 옛 구조로 보낸 명령은 실패한다 (다른 군에서 몰래 차감하지 않음)', () => {
    const w = makeRegional();
    const b = smelterAt(w);
    const s = w.place('storage', 8, 10, 0)!;
    s.inBuf.set('module', 1);
    const old = groupKey(w.storageGroup(s));
    w.place('storage', 8, 12, 0); // 군이 2동으로
    expect(install(w, b, s, old).ok).toBe(false);
    expect(countOf(s.inBuf, 'module')).toBe(1);
    expect(install(w, b, s).ok).toBe(true);
  });

  it('전력 부족·레시피 없음이어도 설치는 된다', () => {
    const w = makeRegional();
    const b = w.place('smelter', 10, 10, 0)!;
    const s = w.place('storage', 8, 10, 0)!;
    s.inBuf.set('module', 1);
    expect(b.recipe).toBeNull();
    expect(install(w, b, s).ok).toBe(true);
  });
});

describe('작업 중 설치와 분리 (M05~M09)', () => {
  /** 모듈 없이 돌던 기계 + 닿은 창고에 모듈 1개 */
  function busy() {
    const w = makeRegional();
    const b = smelterAt(w);
    w.place('storage', 10, 8, 0); // 출구 쪽: 만든 강철을 받아 계속 돌게
    const s = w.place('storage', 8, 10, 0)!;
    s.inBuf.set('module', 1);
    feed(b);
    run(w, 1);
    expect(b.crafting).toBe(true);
    return { w, b, s };
  }

  it('M05: 배치 도중 첫 설치 → 그 배치는 기존 배율로 끝나고 기록 없음, 다음 배치부터 적용·완료 때 기록', () => {
    const { w, b, s } = busy();
    expect(install(w, b, s).ok).toBe(true);
    expect(b.modBatch).toBe(false);
    expect(w.moduleState(b)).toBe('next');
    expect(w.craftTime(b)).toBe(5);
    // 첫 배치(5초)가 끝날 때까지 모듈 배치 완료 기록은 없다
    run(w, 3.9);
    expect(w.moduleBatches).toBe(0);
    run(w, 0.2);
    expect(b.modBatch).toBe(true);
    expect(w.moduleBatches).toBe(0);
    run(w, 5 / MODULE.speed);
    expect(w.moduleBatches).toBe(1);
  });

  it('M06: 모듈을 쓰는 배치 중 기본 분리 → 완료까지 슬롯 잠금, 완료 후 한 번 회수, 다음 배치는 효과 없이', () => {
    const { w, b, s } = busy();
    install(w, b, s);
    run(w, 4.2); // 모듈 배치 시작
    expect(b.modBatch).toBe(true);
    const r = detach(w, b, 'normal');
    expect(r).toMatchObject({ ok: true, note: 'scheduled' });
    expect(b.module).not.toBeNull();
    expect(w.moduleState(b)).toBe('detaching');
    expect(detach(w, b, 'normal').ok).toBe(false); // 이미 예약
    run(w, 5 / MODULE.speed);
    expect(w.moduleBatches).toBe(1);
    expect(b.module).toBeNull();
    expect(w.pileCount(w.idx(10, 10), 'module')).toBe(1);
    expect(b.crafting && !b.modBatch).toBe(true);
    expect(total(w, 'module')).toBe(1);
    expect(w.moduleState(b)).toBe('none');
    // 회수 더미의 모듈을 다른 창고로 옮겨 다시 쓸 수 있다
    w.place('unloader', 10, 9, 0)!; // 위: 북쪽을 보면 뒤가 (10,10)
    expect(w.buildingAt(10, 10)).toBe(b);
  });

  it('M07: 분리 대기 중 정지(전력 부족)·재접속 → 예약·진행 보존, 취소는 재료를 옮기지 않는다', () => {
    const { w, b, s } = busy();
    install(w, b, s);
    run(w, 4.2);
    detach(w, b, 'normal');
    const g = viaNet(w);
    const gb = g.buildings.get(b.id)!;
    expect([gb.detach, gb.modBatch, gb.module?.from]).toEqual([true, true, s.id]);
    expect(gb.progress).toBeCloseTo(b.progress);
    expect(g.checksum()).toBe(w.checksum());
    const piles = g.piles.length;
    const r = applyCommand(g, 0, { t: 'module-detach', rid: rid(), id: gb.id, mode: 'cancel-request' });
    expect(r).toMatchObject({ ok: true, note: 'cancelled' });
    expect([gb.detach, !!gb.module, g.piles.length]).toEqual([false, true, piles]);
    run(g, 5);
    expect(gb.module).not.toBeNull();
  });

  it('M08: 작업 취소 후 즉시 분리 → 투입한 원료·모듈만 회수, 버퍼·이미 만든 강철은 남고 새 강철 없음', () => {
    const { w, b, s } = busy();
    install(w, b, s);
    run(w, 4.2);
    expect(b.modBatch).toBe(true);
    const inBuf = new Map(b.inBuf);
    const outBuf = new Map(b.outBuf);
    const batches = w.moduleBatches;
    // 제작 중인 배치에 들어간 재료는 기계 안 어디에도 안 보이므로, 레시피 1회분을 더해 센다
    const plates = total(w, 'iron-plate') + 2;
    const coal = total(w, 'coal') + 1;
    const r = detach(w, b, 'force');
    expect(r.ok).toBe(true);
    const tile = w.idx(10, 10);
    expect(w.pileAt(tile)).toEqual(new Map([['iron-plate', 2], ['coal', 1], ['module', 1]]));
    expect(b.inBuf).toEqual(inBuf);
    expect(b.outBuf).toEqual(outBuf);
    expect([b.crafting, b.progress, b.module, w.moduleBatches]).toEqual([false, 0, null, batches]);
    expect([total(w, 'iron-plate'), total(w, 'coal')]).toEqual([plates, coal]);
  });

  it('M09: 분리 대기 중 레시피 변경·철거 → 슬롯 모듈과 투입 재료를 한 번만 회수', () => {
    for (const how of ['recipe', 'remove'] as const) {
      const { w, b, s } = busy();
      install(w, b, s);
      run(w, 4.2);
      detach(w, b, 'normal');
      const before = total(w, 'module');
      if (how === 'recipe') w.setRecipe(b, 'iron-plate');
      else w.remove(b);
      const tile = w.idx(10, 10);
      expect(w.pileCount(tile, 'module'), how).toBe(1);
      expect(total(w, 'module')).toBe(before);
      if (how === 'recipe') {
        expect([b.module, b.detach, b.crafting]).toEqual([null, false, false]);
        // 다음에 다시 바꿔도 더 나오지 않는다
        w.setRecipe(b, 'steel');
        expect(w.pileCount(tile, 'module')).toBe(1);
      }
      run(w, 6);
      expect(w.pileCount(tile, 'module')).toBe(1);
    }
  });

  it('레시피 변경은 분리 예약이 없으면 모듈을 슬롯에 남긴다, 회전도 그대로', () => {
    const { w, b, s } = busy();
    install(w, b, s);
    w.setRecipe(b, 'iron-plate');
    w.rotate(b, 1);
    expect(b.module).toEqual({ from: s.id });
    expect(w.pileCount(w.idx(10, 10), 'module')).toBe(0);
  });
});

describe('복사·되돌리기 (M10)', () => {
  it('설치 상태를 청사진으로 복사해도 모듈은 복제되지 않는다', () => {
    const w = makeRegional();
    const b = smelterAt(w);
    const s = w.place('storage', 8, 10, 0)!;
    s.inBuf.set('module', 1);
    install(w, b, s);
    const bp = copyArea(w, 10, 10, 11, 11)!;
    pasteBlueprint(w, bp, 20, 20);
    const copy = w.buildingAt(20, 20)!;
    expect(copy.type).toBe('smelter');
    expect(copy.recipe).toBe('steel');
    expect(copy.module).toBeNull();
    expect(total(w, 'module')).toBe(1);
  });

  it('철거 되돌리기는 그 회수분이 그 자리에 남아 있을 때만 모듈을 다시 장착한다', () => {
    for (const taken of [false, true]) {
      const w = makeRegional();
      const b = smelterAt(w);
      const s = w.place('storage', 8, 10, 0)!;
      s.inBuf.set('module', 1);
      install(w, b, s);
      applyCommand(w, 0, { t: 'remove', id: b.id });
      const tile = w.idx(10, 10);
      expect(w.pileCount(tile, 'module')).toBe(1);
      if (taken) {
        // 하역기로 이미 꺼내 갔다 (창고 쪽으로)
        expect(w['takePile'](tile, 'module', 1)).toBe(1);
        s.inBuf.set('module', 1);
      }
      applyCommand(w, 0, { t: 'undo' });
      const back = w.buildingAt(10, 10)!;
      expect(back.type).toBe('smelter');
      expect(!!back.module, `taken=${taken}`).toBe(!taken);
      expect(total(w, 'module')).toBe(1);
    }
  });

  it('설치·분리 명령은 되돌리기 기록에 들어가지 않는다', () => {
    const w = makeRegional();
    const b = smelterAt(w);
    const s = w.place('storage', 8, 10, 0)!;
    s.inBuf.set('module', 1);
    const before = w.nextEdit(false);
    install(w, b, s);
    detach(w, b, 'normal');
    expect(w.nextEdit(false)).toBe(before);
  });

  it('회수 더미의 모듈을 하역기로 꺼내 창고로 옮기면 다시 설치할 수 있다', () => {
    const w = makeRegional();
    const b = smelterAt(w);
    const s = w.place('storage', 8, 10, 0)!;
    s.inBuf.set('module', 1);
    install(w, b, s);
    detach(w, b, 'normal'); // 배치가 없어 바로 분리
    expect(w.pileCount(w.idx(10, 10), 'module')).toBe(1);
    // 기계를 치우고(더미는 남는다) 더미 칸 옆에 하역기 → 창고
    applyCommand(w, 0, { t: 'remove', id: b.id });
    w.place('unloader', 10, 9, 0); // 북쪽을 봄: 뒤 (10,10)이 더미 칸, 앞 (10,8)
    const s2 = w.place('storage', 10, 6, 0)!; // (10,6)~(11,7): 하역기 앞 칸 (10,8)은 아님 → 컨베이어 한 칸
    w.place('belt', 10, 8, 0);
    run(w, 3);
    expect(countOf(s2.inBuf, 'module')).toBe(1);
    expect(w.pileCount(w.idx(10, 10), 'module')).toBe(0);
    expect(total(w, 'module')).toBe(1);
    const m = smelterAt(w, 12, 6);
    expect(install(w, m, s2).ok).toBe(true);
  });
});

describe('고급 트럭 (V01~V08)', () => {
  /** 정류장 (20,10)~(21,11), 아래 (18..24, 12) 도로 */
  function yard(w = makeRegional()) {
    for (let x = 18; x <= 24; x++) w.place('road', x, 12, 0);
    const st = w.place('station', 20, 10, 0)!;
    return { w, st };
  }

  const build = (w: World, st: Building, key = '', copy?: number) =>
    applyCommand(w, 0, { t: 'build-adv-truck', rid: rid(), station: st.id, key, ...(copy ? { copy } : {}) });

  it('V01: 정류장 안의 조립품 또는 직접 붙은 창고의 조립품 1개로 각각 1대, 허브 비용 차감 없음', () => {
    const { w, st } = yard();
    const s = w.place('storage', 22, 10, 0)!; // 정류장 오른쪽에 붙음
    const hub = [...w.stock];
    st.inBuf.set('truck-kit', 1);
    const r1 = build(w, st);
    expect(r1).toMatchObject({ ok: true, from: st.id });
    const v = w.vehicles.get(r1.vehicle!)!;
    expect([v.kind, v.load, v.battery, v.kit?.item, v.home]).toEqual(['advanced', 0, 0, 'truck-kit', st.id]);
    expect(w.routeOk(v)).toBe(false);
    expect(v.tile).toBe(w.idx(20, 12)); // 정류장 옆 도로 중 칸 번호가 가장 작은 곳
    expect(countOf(st.inBuf, 'truck-kit')).toBe(0);
    s.inBuf.set('truck-kit', 1);
    const key = groupKey(w.storageGroup(s));
    const r2 = build(w, st, key);
    expect(r2).toMatchObject({ ok: true, from: s.id });
    expect(countOf(s.inBuf, 'truck-kit')).toBe(0);
    expect([...w.stock]).toEqual(hub);
    expect(w.truckCapacity(v)).toBe(100);
    expect(w.truckBattery(v)).toBe(3600 * 1.5); // 연구 "고용량 배터리" 배율은 종류 기본값 위에
  });

  it('V02: 다른 정류장·먼 창고·허브에만 조립품이 있으면 실패, 재고·id 순서 유지', () => {
    const { w, st } = yard();
    const other = w.place('station', 14, 10, 0)!;
    other.inBuf.set('truck-kit', 1);
    const far = w.place('storage', 26, 10, 0)!;
    far.inBuf.set('truck-kit', 1);
    w.stock.set('truck-kit', 3);
    const id = w.nextVehicleId;
    expect(build(w, st).ok).toBe(false);
    expect(build(w, st, groupKey(w.storageGroup(far))).ok).toBe(false);
    expect([w.nextVehicleId, w.vehicles.size, total(w, 'truck-kit')]).toEqual([id, 0, 5]);
  });

  it('V03: 조립품 1개에 두 조립 요청 → 한 대만', () => {
    const { w, st } = yard();
    st.outBuf.set('truck-kit', 1);
    const a = applyCommand(w, 1, { t: 'build-adv-truck', rid: rid(), station: st.id, key: '' });
    const b = applyCommand(w, 2, { t: 'build-adv-truck', rid: rid(), station: st.id, key: '' });
    expect([a.ok, b.ok]).toEqual([true, false]);
    expect(w.vehicles.size).toBe(1);
    expect(total(w, 'truck-kit')).toBe(1);
  });

  it('V04: 도로 없음·정류장 삭제·창고군 구조 변경 → 실패, 조립품과 id 순서 그대로', () => {
    const w = makeRegional();
    const lone = w.place('station', 30, 20, 0)!;
    lone.inBuf.set('truck-kit', 1);
    const id = w.nextVehicleId;
    expect(build(w, lone).reason).toBe('정류장 옆에 도로가 필요해요');
    const { st } = yard(w);
    const s = w.place('storage', 22, 10, 0)!;
    s.inBuf.set('truck-kit', 1);
    const old = groupKey(w.storageGroup(s));
    w.place('storage', 22, 8, 0); // 군이 바뀐다
    expect(build(w, st, old).ok).toBe(false);
    w.remove(st);
    expect(applyCommand(w, 0, { t: 'build-adv-truck', rid: rid(), station: st.id, key: '' }).reason).toBe('정류장이 없어요');
    expect([w.nextVehicleId, w.vehicles.size, countOf(s.inBuf, 'truck-kit')]).toEqual([id, 0, 1]);
  });

  it('V05: 같은 명령을 다시 받아도 한 번만 (성공·실패 모두 처음 결과)', () => {
    const { w, st } = yard();
    st.inBuf.set('truck-kit', 2);
    const cmd: Command = { t: 'build-adv-truck', rid: 'same', station: st.id, key: '' };
    const a = applyCommand(w, 0, cmd);
    const b = applyCommand(w, 0, cmd);
    expect(b).toEqual(a);
    expect(w.vehicles.size).toBe(1);
    expect(countOf(st.inBuf, 'truck-kit')).toBe(1);
    const fail: Command = { t: 'module-install', rid: 'fail', id: 999, storage: 0, key: '' };
    expect(applyCommand(w, 0, fail).ok).toBe(false);
    expect(applyCommand(w, 0, fail).ok).toBe(false);
    expect(w.doneCmds.size).toBe(2);
  });

  it('V06: 전력과 상관없이 만들어지고 0kJ에서 정류장 전력으로 충전한다 (혼자 400kW면 9초에 가득)', () => {
    const { w, st } = yard();
    w.researched.delete('battery'); // 배율 없이
    st.inBuf.set('truck-kit', 1);
    const v = w.vehicles.get(build(w, st).vehicle!)!;
    expect(v.battery).toBe(0);
    run(w, 1);
    expect(v.status).toBe('charging');
    expect(v.battery).toBeCloseTo(400, 0);
    expect(w.power.charge).toBeGreaterThan(0);
    run(w, 8.1);
    expect(v.battery).toBe(3600);
    expect(v.status).toBe('no-station');
  });

  it('V07: 노선 없이 조립한 정류장에서만 충전, 정류장을 지우면 충전은 멈추고 차량·화물은 남는다', () => {
    const { w, st } = yard();
    st.inBuf.set('truck-kit', 1);
    const v = w.vehicles.get(build(w, st).vehicle!)!;
    v.cargo.set('coal', 7);
    run(w, 1);
    const b1 = v.battery;
    expect(b1).toBeGreaterThan(0);
    w.remove(st);
    run(w, 2);
    expect(v.battery).toBe(b1);
    expect(w.vehicles.has(v.id)).toBe(true);
    expect(countOf(v.cargo, 'coal')).toBe(7);
  });

  it('V08: 같은 노선 고급 트럭 추가는 조립품을 또 쓰고, 철거는 조립품 1개만 현지에 돌려준다 (되돌리기로 안 살아난다)', () => {
    const { w, st } = yard();
    const unload = w.place('station', 16, 10, 0)!;
    w.place('road', 16, 12, 0);
    w.place('road', 17, 12, 0);
    st.inBuf.set('truck-kit', 2);
    const v = w.vehicles.get(build(w, st).vehicle!)!;
    applyCommand(w, 0, { t: 'route', id: v.id, stops: [{ id: st.id, act: 'load' }, { id: unload.id, act: 'unload' }] });
    expect(applyCommand(w, 0, { t: 'clone-truck', id: v.id })).toBeNull(); // 고급은 기본 복제로 늘지 않는다
    const r = build(w, st, '', v.id);
    const v2 = w.vehicles.get(r.vehicle!)!;
    expect(v2.stops).toEqual(v.stops);
    expect(countOf(st.inBuf, 'truck-kit')).toBe(0);
    expect(build(w, st, '', v.id).ok).toBe(false); // 조립품이 없으면 추가도 없다
    v2.cargo.set('coal', 4);
    const hub = [...w.stock];
    const tile = v2.tile;
    applyCommand(w, 0, { t: 'remove-truck', id: v2.id });
    expect(w.pileAt(tile)).toEqual(new Map([['coal', 4], ['truck-kit', 1]]));
    expect([...w.stock]).toEqual(hub);
    applyCommand(w, 0, { t: 'undo' });
    expect(w.vehicles.has(v2.id)).toBe(false);
    expect([...w.vehicles.values()].filter((x) => x.kind === 'advanced')).toHaveLength(1);
    expect(total(w, 'truck-kit')).toBe(2);
  });

  it('기본 트럭은 그대로: 허브 비용·가득 찬 배터리·되돌리기', () => {
    const { w, st } = yard();
    const steel = w.stockOf('steel');
    const v = applyCommand(w, 0, { t: 'build-truck', station: st.id })!;
    expect(v.kind).toBe('basic');
    expect(w.stockOf('steel')).toBe(steel - 10);
    expect(v.battery).toBe(w.truckBattery());
    applyCommand(w, 0, { t: 'undo' });
    expect(w.vehicles.size).toBe(0);
    expect(w.stockOf('steel')).toBe(steel);
  });

  it('고급 트럭은 한 번에 100개를 싣고 실제로 내린 개수를 기록한다', () => {
    const { w, st } = yard();
    const unload = w.place('station', 16, 10, 0)!;
    w.place('road', 16, 12, 0);
    w.place('road', 17, 12, 0);
    w.setStationMode(unload, 'unload');
    st.inBuf.set('truck-kit', 1);
    st.inBuf.set('coal', 150);
    const v = w.vehicles.get(build(w, st).vehicle!)!;
    applyCommand(w, 0, { t: 'route', id: v.id, stops: [{ id: st.id, act: 'load' }, { id: unload.id, act: 'unload' }] });
    run(w, 30);
    expect(w.advDelivered).toBeGreaterThanOrEqual(100);
    expect(total(w, 'coal')).toBe(5000 + 150);
  });
});

/** 회수 더미에 쌓인 순서대로 아이템 */
const w2Piles = (w: World) => w.piles.map((p) => p.item);

describe('저장·같이 하기 (S01~S02)', () => {
  function scene() {
    const w = makeRegional();
    for (let x = 18; x <= 24; x++) w.place('road', x, 12, 0);
    const st = w.place('station', 20, 10, 0)!;
    st.inBuf.set('truck-kit', 1);
    const b = smelterAt(w);
    w.place('storage', 10, 8, 0); // 출구 쪽
    const s = w.place('storage', 8, 10, 0)!;
    s.inBuf.set('module', 2);
    feed(b);
    return { w, st, b, s };
  }

  it('S01: 성공 직전·직후 저장/중간 참가/재전송 → 재고·슬롯·차량·회수·기록이 한 상태', () => {
    const { w, st, b, s } = scene();
    const cmds: Command[] = [
      { t: 'module-install', rid: 'm1', id: b.id, storage: s.id, key: groupKey(w.storageGroup(s)) },
      { t: 'build-adv-truck', rid: 'v1', station: st.id, key: '' },
    ];
    const before = viaNet(w);
    for (const c of cmds) applyCommand(w, 0, c);
    run(w, 7);
    applyCommand(w, 0, { t: 'module-detach', rid: 'd1', id: b.id, mode: 'normal' });
    const after = viaNet(w);
    expect(after.checksum()).toBe(w.checksum());
    // 저장 파일로도 같은 실물
    const loaded = World.deserialize(JSON.parse(JSON.stringify(w.serialize())));
    for (const item of ['module', 'truck-kit'] as const) expect(total(loaded, item)).toBe(total(w, item));
    expect(loaded.buildings.get(b.id)!.module).toEqual(b.module);
    expect([...loaded.vehicles.values()].map((v) => [v.kind, v.kit, v.home])).toEqual([['advanced', { item: 'truck-kit', from: st.id }, st.id]]);
    expect(loaded.moduleBatches).toBe(w.moduleBatches);
    // 재접속 후 같은 명령이 다시 와도 다시 적용하지 않는다
    for (const c of cmds) applyCommand(after, 0, c);
    expect(after.checksum()).toBe(w.checksum());
    expect(after.vehicles.size).toBe(1);
    // 성공 직전 상태는 아직 아무것도 바뀌지 않았다
    expect([before.vehicles.size, total(before, 'module'), before.buildings.get(b.id)!.module]).toEqual([0, 2, null]);
  });

  it('S02: 같은 명령 기록을 두 세계에 재생하면 매 틱 상태 해시가 같다', () => {
    const a = scene();
    const b = viaNet(a.w);
    const script: [number, Command][] = [
      [10, { t: 'module-install', rid: 'i1', id: a.b.id, storage: a.s.id, key: groupKey(a.w.storageGroup(a.s)) }],
      // 노선 없는 고급 트럭의 충전(600kW)이 공장 전력을 나눠 쓰므로 모듈 시험이 끝난 뒤에
      [950, { t: 'build-adv-truck', rid: 'v1', station: a.st.id, key: '' }],
      [400, { t: 'module-detach', rid: 'd1', id: a.b.id, mode: 'normal' }],
      [401, { t: 'module-detach', rid: 'd1', id: a.b.id, mode: 'normal' }],
      [700, { t: 'module-install', rid: 'i2', id: a.b.id, storage: a.s.id, key: groupKey(a.w.storageGroup(a.s)) }],
      [900, { t: 'module-detach', rid: 'd2', id: a.b.id, mode: 'force' }],
    ];
    for (let t = 0; t < 1200; t++) {
      for (const [at, c] of script) {
        if (at !== t) continue;
        const r = applyCommand(a.w, 0, c);
        expect(applyCommand(b, 0, c)).toEqual(r);
        if (at === 10) expect(r, JSON.stringify(r)).toMatchObject({ ok: true });
      }
      a.w.tick();
      b.tick();
      expect(b.checksum(), `틱 ${t}`).toBe(a.w.checksum());
    }
    expect(a.w.moduleBatches).toBe(1);
    expect(w2Piles(a.w)).toEqual(['module', 'iron-plate', 'coal', 'module']);
    expect(total(a.w, 'module')).toBe(2);
  });
});

describe('회수 더미 옮기기', () => {
  /** 제련로를 철거해 (10,10)에 철판 더미를 만든다 */
  function withPile(n = 30) {
    const w = makeRegional();
    const s = w.place('smelter', 10, 10, 0)!;
    s.outBuf.set('iron-plate', n);
    w.remove(s);
    return { w, tile: w.idx(10, 10) };
  }

  it('8칸 안의 가장 가까운 창고로 옮기고, 실물 개수는 그대로', () => {
    const { w, tile } = withPile();
    const far = w.place('storage', 20, 10, 0)!; // 몸체까지 10칸: 닿지 않는다
    const near = w.place('storage', 14, 10, 0)!; // 4칸
    const before = total(w, 'iron-plate');
    expect(w.pileTarget(tile)?.b).toBe(near);
    const r = applyCommand(w, 0, { t: 'pile-collect', rid: 'p1', tile });
    expect(r).toMatchObject({ ok: true, moved: 30, from: near.id });
    expect(countOf(near.inBuf, 'iron-plate')).toBe(30);
    expect(countOf(far.inBuf, 'iron-plate')).toBe(0);
    expect(w.pileAt(tile).size).toBe(0);
    expect(total(w, 'iron-plate')).toBe(before);
    // 같은 명령을 다시 받아도 한 번만
    expect(applyCommand(w, 0, { t: 'pile-collect', rid: 'p1', tile })).toMatchObject({ ok: true, moved: 30 });
    expect(countOf(near.inBuf, 'iron-plate')).toBe(30);
  });

  it('가까운 창고가 없으면 허브로, 창고 자리가 모자라면 나머지는 허브로 (실물 개수는 그대로)', () => {
    const a = withPile(30);
    const hub = a.w.stockOf('iron-plate');
    expect(applyCommand(a.w, 0, { t: 'pile-collect', rid: 'p2', tile: a.tile })).toMatchObject({ ok: true, moved: 30, from: 0 });
    expect(a.w.stockOf('iron-plate')).toBe(hub + 30);
    const { w, tile } = withPile(30);
    const st = w.place('storage', 13, 13, 0)!;
    st.inBuf.set('stone', 190);
    const before = total(w, 'iron-plate');
    expect(applyCommand(w, 0, { t: 'pile-collect', rid: 'p3', tile })).toMatchObject({ ok: true, moved: 30, from: st.id });
    expect(countOf(st.inBuf, 'iron-plate')).toBe(10);
    expect(w.pileAt(tile).size).toBe(0);
    expect(total(w, 'iron-plate')).toBe(before);
  });

  it('버리기: 더미가 없어진다', () => {
    const { w, tile } = withPile(5);
    expect(applyCommand(w, 0, { t: 'pile-discard', rid: 'p5', tile })).toMatchObject({ ok: true, moved: 5 });
    expect(w.pileAt(tile).size).toBe(0);
  });

  it('내리기 정류장은 내보내는 칸으로 넣는다, 저장·중간 참가 해시가 같다', () => {
    const { w, tile } = withPile(5);
    for (let x = 12; x <= 18; x++) w.place('road', x, 14, 0);
    const st = w.place('station', 14, 12, 0)!;
    st.stationMode = 'unload';
    expect(applyCommand(w, 0, { t: 'pile-collect', rid: 'p4', tile }).ok).toBe(true);
    expect(countOf(st.outBuf, 'iron-plate')).toBe(5);
    const g = World.fromSnapshot(JSON.parse(JSON.stringify(w.snapshot())));
    expect(g.checksum()).toBe(w.checksum());
  });
});

describe('컨베이어 줄에서 잘못 들어간 아이템 빼기', () => {
  it('철판 줄에 섞인 구리선만 이어진 줄 전체(옆에서 합류한 줄 포함)에서 빼고, 철판은 그대로', () => {
    const w = makeRegional();
    // (10..14, 15) 오른쪽으로 가는 줄 + (12, 13..14) 아래로 내려와 옆에서 합류
    const line = [10, 11, 12, 13, 14].map((x) => w.place('belt', x, 15, 1)!);
    const side = [13, 14].map((y) => w.place('belt', 12, y, 2)!);
    expect(line.every(Boolean) && side.every(Boolean)).toBe(true);
    line[0].items.push({ item: 'iron-plate', pos: 0.1, n: 1 });
    line[2].items.push({ item: 'copper-wire', pos: 0.1, n: 1 });
    side[0].items.push({ item: 'copper-wire', pos: 0.1, n: 1 });
    const other = w.place('belt', 20, 20, 1)!;
    other.items.push({ item: 'copper-wire', pos: 0.1, n: 1 });
    expect(w.beltLine(line[4]).length).toBe(7);
    expect([...w.lineItems(line[1])]).toEqual([['iron-plate', 1], ['copper-wire', 2]]);
    const hub = w.stockOf('copper-wire');
    expect(applyCommand(w, 0, { t: 'line-take', rid: 'l1', id: line[3].id, item: 'copper-wire' })).toMatchObject({ ok: true, moved: 2 });
    expect(w.stockOf('copper-wire')).toBe(hub + 2);
    expect([...w.lineItems(line[1])]).toEqual([['iron-plate', 1]]);
    expect(other.items).toHaveLength(1); // 이어지지 않은 줄은 그대로
  });
});
