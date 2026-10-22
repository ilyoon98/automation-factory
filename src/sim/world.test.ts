import { describe, expect, it } from 'vitest';
import { TRUCK } from '../data/buildings';
import { ENDLESS_BY_ID, TECHS, endlessCost } from '../data/tech';
import { copyArea, pasteBlueprint } from './blueprint';
import { applyCommand } from './commands';
import type { Dir } from './dir';
import { STARTING_STOCK, generateWorld } from './mapgen';
import { BELT_SPACING, TICK_RATE, World, patchAlert } from './world';

/** 모든 건물·레시피 해금 */
function unlockAll(w: World) {
  for (const t of TECHS) w.applyTech(t.id);
}

/** 30×30 빈 맵. 허브는 (0,9)~(2,11). 모든 연구 완료, 재고 넉넉. */
function makeWorld(): World {
  const w = new World(30, 30);
  w.createHub(0, 9);
  unlockAll(w);
  w.stock.set('iron-plate', 1000);
  w.stock.set('gear', 1000);
  w.stock.set('stone', 1000);
  return w;
}

function ore(w: World, x: number, y: number, size = 2, amount = 1000, item: 'iron-ore' | 'coal' = 'iron-ore') {
  for (let dy = 0; dy < size; dy++) for (let dx = 0; dx < size; dx++) w.setResource(x + dx, y + dy, item, amount);
}

/** (x1,y) → (x2,y) 가로 컨베이어 줄 */
function beltRow(w: World, x1: number, x2: number, y: number, dir: Dir) {
  const step = x2 >= x1 ? 1 : -1;
  for (let x = x1; x !== x2 + step; x += step) expect(w.place('belt', x, y, dir)).not.toBeNull();
}

function run(w: World, seconds: number) {
  for (let i = 0; i < seconds * TICK_RATE; i++) w.tick();
}

/** 컨베이어 위 아이템 개수 (한 칸에 쌓인 것까지) */
function beltItemCount(w: World): number {
  let n = 0;
  for (const b of w.buildings.values()) for (const it of b.items) n += it.n;
  return n;
}

describe('채굴 → 컨베이어 → 허브', () => {
  it('채굴기가 1초에 1개씩 허브로 보낸다', () => {
    const w = makeWorld();
    ore(w, 10, 10);
    w.place('miner', 10, 10, 3);
    beltRow(w, 9, 3, 10, 3);
    run(w, 30);
    const got = w.stockOf('iron-ore');
    expect(got).toBeGreaterThanOrEqual(22);
    expect(got).toBeLessThanOrEqual(30);
  });

  it('광맥이 고갈되면 멈춘다', () => {
    const w = makeWorld();
    ore(w, 10, 10, 2, 1);
    const m = w.place('miner', 10, 10, 3)!;
    beltRow(w, 9, 3, 10, 3);
    run(w, 20);
    expect(w.stockOf('iron-ore')).toBe(4);
    expect(m.status).toBe('depleted');
  });
});

describe('광맥 전체에서 캐기', () => {
  /** (10,10)~(15,15) 6×6 철광맥, 칸당 5개 (합 180). 채굴기는 모서리 (10,10)에 놓고 허브로 보낸다 */
  function patchWorld() {
    const w = makeWorld();
    ore(w, 10, 10, 6, 5);
    const m = w.place('miner', 10, 10, 3)!;
    beltRow(w, 9, 3, 10, 3);
    return { w, m };
  }
  const total = (w: World) => {
    let s = 0;
    for (let y = 10; y < 16; y++) for (let x = 10; x < 16; x++) s += w.resAmount[w.idx(x, y)];
    return s;
  };

  it('자기 밑 4칸(20개)을 다 캐도 멈추지 않고 광맥 전체에서 계속 캔다', () => {
    const { w, m } = patchWorld();
    run(w, 60);
    expect(180 - total(w)).toBeGreaterThan(40);
    expect(m.status).not.toBe('depleted');
    expect(w.mineRemaining(m)).toBe(total(w));
  });

  it('바깥 칸부터 사라지고, 채굴기가 깔고 있는 칸은 맨 나중에 사라진다', () => {
    const { w } = patchWorld();
    run(w, 60);
    // 채굴기 밑 칸은 그대로
    for (const [x, y] of [[10, 10], [11, 10], [10, 11], [11, 11]]) expect(w.resAmount[w.idx(x, y)]).toBe(5);
    // 사라진 칸은 전부 가장자리, 안쪽(13,13)은 남아 있다
    let gone = 0;
    for (let y = 10; y < 16; y++) {
      for (let x = 10; x < 16; x++) {
        if (w.resItem[w.idx(x, y)] !== null) continue;
        gone++;
        expect(x === 10 || x === 15 || y === 10 || y === 15).toBe(true);
      }
    }
    expect(gone).toBeGreaterThan(5);
    expect(w.resAmount[w.idx(13, 13)]).toBe(5);
  });

  it('광맥을 다 캐면 모든 칸이 사라지고 채굴기가 멈춘다', () => {
    const { w, m } = patchWorld();
    run(w, 200);
    expect(total(w)).toBe(0);
    expect(m.status).toBe('depleted');
    expect(w.stockOf('iron-ore')).toBe(180);
  });

  it('한 광맥에 채굴기 두 대면 같이 나눠 캐서 두 배로 줄어든다', () => {
    const { w } = patchWorld();
    w.place('miner', 14, 14, 0);
    w.place('belt', 14, 13, 0); // 막다른 길이지만 몇 개는 캔다
    run(w, 3);
    expect(180 - total(w)).toBeGreaterThanOrEqual(4);
  });

  it('저장·불러오기 뒤에도 같은 광맥에서 이어서 캔다 (사라진 칸 위 채굴기 포함)', () => {
    const { w } = patchWorld();
    run(w, 100);
    const left = total(w);
    const copy = World.deserialize(JSON.parse(JSON.stringify(w.serialize())));
    const m2 = copy.buildingAt(10, 10)!;
    expect(copy.mineRemaining(m2)).toBe(left);
    run(copy, 200);
    let after = 0;
    for (let y = 10; y < 16; y++) for (let x = 10; x < 16; x++) after += copy.resAmount[copy.idx(x, y)];
    expect(after).toBe(0);
    expect(copy.stockOf('iron-ore')).toBe(180);
  });

  it('광맥을 줄이기 전 저장은 먼 광맥만 1/4로 줄인다', () => {
    const w = generateWorld(5);
    const data = JSON.parse(JSON.stringify(w.serialize()));
    delete data.rev;
    delete data.patches;
    // 가까운 칸 하나, 먼 칸 하나 골라서 비교
    const c = w.width / 2;
    let near = -1;
    let far = -1;
    for (let i = 0; i < w.resItem.length; i++) {
      const it = w.resItem[i];
      if (!it || it === 'water' || it === 'stone') continue;
      const x = i % w.width;
      const d = Math.hypot(x + 0.5 - c, (i - x) / w.width + 0.5 - c);
      if (d < 15 && near < 0) near = i;
      if (d > 30 && far < 0) far = i;
    }
    const loaded = World.deserialize(data);
    expect(loaded.resAmount[near]).toBe(w.resAmount[near]);
    expect(loaded.resAmount[far]).toBe(Math.max(1, Math.round(w.resAmount[far] * 0.25)));
  });
});

describe('광맥 고갈 알림', () => {
  /** (10,10)~(15,15) 6×6 철광맥, 칸당 5개 (합 180). 채굴기 한 대가 허브로 보낸다 */
  function patchWorld(amount = 5) {
    const w = makeWorld();
    ore(w, 10, 10, 6, amount);
    const m = w.place('miner', 10, 10, 3)!;
    beltRow(w, 9, 3, 10, 3);
    return { w, m };
  }

  it('남은 양·처음 양·분당 속도·바닥까지 남은 분을 알려 준다', () => {
    const { w, m } = patchWorld();
    run(w, 30);
    const list = w.patchReports();
    expect(list).toHaveLength(1);
    const r = list[0];
    expect(r.item).toBe('iron-ore');
    expect(r.initial).toBe(180);
    expect(r.remaining).toBe(w.mineRemaining(m));
    expect(r.perMin).toBeGreaterThan(50);
    expect(r.perMin).toBeLessThanOrEqual(60);
    expect(r.etaMin).toBeCloseTo(r.remaining / r.perMin);
    expect(r.miners).toEqual([m]);
    expect(patchAlert(r)).toBe('low'); // 150개 남짓 ÷ 분당 60 = 3분이 안 됨
  });

  it('같은 광맥 채굴기들의 속도를 모두 더한다', () => {
    const { w } = patchWorld(100);
    w.place('miner', 14, 14, 1);
    beltRow(w, 16, 29, 14, 1); // 막다른 길이지만 30초 동안은 넉넉하다
    run(w, 30);
    const [r] = w.patchReports();
    expect(r.miners).toHaveLength(2);
    expect(r.perMin).toBeGreaterThan(100);
    expect(patchAlert(r)).toBeNull(); // 3,600개 ÷ 분당 120 = 30분
  });

  it('바닥나면 0분이고, 위에 채굴기가 남아 있는 동안 계속 알린다', () => {
    const { w, m } = patchWorld();
    run(w, 200);
    const [r] = w.patchReports();
    expect(r.remaining).toBe(0);
    expect(r.etaMin).toBe(0);
    expect(patchAlert(r)).toBe('empty');
    expect(r.miners).toEqual([m]);
    w.remove(m);
    expect(w.patchReports()).toHaveLength(0);
  });

  it('불러온 뒤에도 처음 양과 광석 종류를 기억한다 (칸이 다 사라진 광맥 포함)', () => {
    const { w } = patchWorld();
    run(w, 200);
    const copy = World.deserialize(JSON.parse(JSON.stringify(w.serialize())));
    const [r] = copy.patchReports();
    expect(r.item).toBe('iron-ore');
    expect(r.initial).toBe(180);
    expect(r.remaining).toBe(0);
  });

  it('무한 광맥(돌)과 흙 채굴기는 알리지 않는다', () => {
    const w = makeWorld();
    for (let y = 10; y < 12; y++) for (let x = 10; x < 12; x++) w.setResource(x, y, 'stone', Infinity);
    w.place('miner', 10, 10, 3);
    beltRow(w, 9, 3, 10, 3);
    w.place('miner', 20, 20, 0);
    run(w, 5);
    expect(w.patchReports()).toHaveLength(0);
  });
});

describe('컨베이어', () => {
  it('막힌 줄에서도 아이템 간격을 지키고 개수가 보존된다', () => {
    const w = makeWorld();
    // 채굴기 4대가 막다른 컨베이어 한 줄에 쏟아붓는다
    for (let i = 0; i < 4; i++) {
      ore(w, 10 + i * 2, 3);
      w.place('miner', 10 + i * 2, 3, 2);
    }
    beltRow(w, 10, 19, 5, 1); // 오른쪽으로 흐르고 끝은 막혀 있음
    run(w, 60);
    for (const b of w.buildings.values()) {
      if (b.type !== 'belt') continue;
      for (let i = 1; i < b.items.length; i++) {
        expect(b.items[i - 1].pos - b.items[i].pos).toBeGreaterThanOrEqual(BELT_SPACING - 1e-6);
      }
    }
    let mined = 0;
    for (let i = 0; i < 4; i++) for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) mined += 1000 - w.resAmount[w.idx(10 + i * 2 + dx, 3 + dy)];
    let buffered = 0;
    for (const b of w.buildings.values()) for (const n of b.outBuf.values()) buffered += n;
    expect(beltItemCount(w) + buffered).toBe(mined);
    expect(beltItemCount(w)).toBeGreaterThan(30);
  });

  it('기계가 옆에서 내보내는 출발 칸은 기계 쪽에서 굽어 나오고, 아이템이 칸 처음(0)부터 들어간다', () => {
    const w = makeWorld();
    ore(w, 10, 5);
    w.place('miner', 10, 5, 2); // 출구 아래
    beltRow(w, 11, 3, 7, 3); // 채굴기 밑을 지나 왼쪽 허브 방향
    run(w, 0.1);
    const start = w.buildingAt(11, 7)!; // 채굴기 아래 오른쪽 칸 = 출발 칸 (뒤가 비어 있음)
    const next = w.buildingAt(10, 7)!; // 뒤에서 컨베이어가 들어오는 칸
    expect(start.curveFrom).toBe(0); // 위(채굴기 쪽)에서 굽어 들어옴
    expect(next.curveFrom).toBeNull(); // 뒤에서 이어지는 칸은 그대로 일자 (옆에서 합류)
    run(w, 1.2);
    expect(start.items.length + next.items.length).toBeGreaterThan(0);
  });

  it('연결된 컨베이어 경계에서 아이템이 겹치지 않는다', () => {
    const w = makeWorld();
    for (let i = 0; i < 4; i++) {
      ore(w, 10 + i * 2, 3);
      w.place('miner', 10 + i * 2, 3, 2);
    }
    beltRow(w, 10, 19, 5, 1);
    run(w, 60);
    // 이웃한 두 컨베이어: 앞 컨베이어 맨 끝 아이템과 다음 컨베이어 맨 뒤 아이템 거리
    for (let x = 10; x < 19; x++) {
      const a = w.buildingAt(x, 5)!;
      const b = w.buildingAt(x + 1, 5)!;
      if (!a.items.length || !b.items.length) continue;
      const gap = 1 - a.items[0].pos + b.items[b.items.length - 1].pos;
      expect(gap).toBeGreaterThanOrEqual(BELT_SPACING - 1e-6);
    }
  });
});

describe('제련로', () => {
  it('철광석을 2초에 철판 1개로 만든다', () => {
    const w = makeWorld();
    ore(w, 10, 10);
    w.place('miner', 10, 10, 3);
    beltRow(w, 9, 8, 10, 3);
    const s = w.place('smelter', 6, 10, 3)!;
    beltRow(w, 5, 3, 10, 3);
    const before = w.stockOf('iron-plate');
    run(w, 60);
    expect(s.recipe).toBe('iron-plate');
    const plates = w.stockOf('iron-plate') - before;
    expect(plates).toBeGreaterThanOrEqual(25);
    expect(plates).toBeLessThanOrEqual(30);
  });
});

describe('기계별 생산 현황', () => {
  it('채굴기 1대(분당 60) → 제련로 1대(분당 30): 제련로는 꽉 차게, 채굴기는 절반은 막혀서 논다', () => {
    const w = makeWorld();
    ore(w, 10, 10);
    const m = w.place('miner', 10, 10, 3)!;
    beltRow(w, 9, 8, 10, 3);
    const s = w.place('smelter', 6, 10, 3)!;
    beltRow(w, 5, 3, 10, 3);
    run(w, 90);

    const ms = w.machineStats(s)!;
    expect(ms.maxOut).toEqual([{ item: 'iron-plate', count: 30 }]);
    expect(ms.maxIn).toEqual([{ item: 'iron-ore', count: 30 }]);
    expect(ms.util).toBeGreaterThan(0.95);

    const mm = w.machineStats(m)!;
    expect(mm.maxOut).toEqual([{ item: 'iron-ore', count: 60 }]);
    expect(mm.util).toBeCloseTo(0.5, 1);
    expect(mm.blocked).toBeCloseTo(0.5, 1);
    expect(mm.measuring).toBe(false);
  });

  it('전력이 모자라면 가동률이 그만큼 떨어지고 전력 부족으로 표시된다', () => {
    const w = new World(20, 20);
    w.createHub(5, 5);
    w.stock.set('iron-plate', 1000);
    w.stock.set('gear', 1000);
    const miners = [[8, 5, 3], [3, 5, 1], [5, 8, 0], [5, 3, 2]] as const;
    for (const [x, y, d] of miners) {
      ore(w, x, y);
      w.place('miner', x, y, d);
    }
    run(w, 60);
    const st = w.machineStats(w.buildingAt(8, 5)!)!;
    expect(st.util).toBeCloseTo(300 / 360, 2);
    expect(st.lowPower).toBeCloseTo(1 - 300 / 360, 2);
  });

  it('레시피가 없으면 현황도 없다', () => {
    const w = makeWorld();
    const a = w.place('assembler', 10, 10, 1)!;
    run(w, 1);
    expect(w.machineStats(a)).toBeNull();
  });
});

describe('전력', () => {
  function minersAroundHub() {
    const w = new World(20, 20);
    w.createHub(5, 5);
    w.stock.set('iron-plate', 1000);
    w.stock.set('gear', 1000);
    w.stock.set('stone', 1000);
    unlockAll(w);
    // 네 채굴기 모두 허브를 향한다
    for (const [x, y, d] of [[8, 5, 3], [3, 5, 1], [5, 8, 0], [5, 3, 2]] as const) {
      ore(w, x, y);
      w.place('miner', x, y, d);
    }
    return w;
  }

  it('수요가 공급보다 크면 모든 기계가 같은 비율로 느려진다', () => {
    const w = minersAroundHub();
    run(w, 60);
    expect(w.power.demand).toBe(360);
    expect(w.power.satisfaction).toBeCloseTo(300 / 360, 5);
    const got = w.stockOf('iron-ore');
    expect(got).toBeGreaterThanOrEqual(195);
    expect(got).toBeLessThanOrEqual(201);
  });

  it('발전기가 연료를 태워 부족분을 채운다', () => {
    const w = minersAroundHub();
    const g = w.place('generator', 15, 15, 0)!;
    g.fuel = 2;
    run(w, 10);
    expect(w.power.satisfaction).toBe(1);
    expect(g.load).toBeCloseTo(60, 5);
    // 60kW × 10초 = 600kJ 소모, 석탄 1개(4000kJ) 개봉
    expect(g.fuel).toBe(1);
    expect(g.energy).toBeCloseTo(4000 - 600, 0);
  });
});

describe('석탄 독립: 태양광·수력·전기로', () => {
  /** 새 건물 재료(벽돌·회로)까지 넉넉한 맵 */
  function coalFreeWorld() {
    const w = makeWorld();
    w.stock.set('brick', 100);
    w.stock.set('circuit', 100);
    return w;
  }

  it('태양광 패널은 아무것도 넣지 않아도 100kW를 더한다', () => {
    const w = coalFreeWorld();
    w.place('solar', 20, 20, 0);
    w.tick();
    expect(w.power.capacity).toBe(300 + 100);
  });

  it('수력 발전기는 물로 모자란 만큼만 돌고, 석탄 발전기보다 먼저 쓴다', () => {
    const w = coalFreeWorld();
    // 수요 450kW (전기로 1대): 허브 300 + 수력 150, 석탄은 그대로
    const f = w.place('electric-furnace', 10, 10, 1)!;
    w.setRecipe(f, 'steel-e');
    f.inBuf.set('iron-plate', 4);
    const h = w.place('hydro', 15, 15, 0)!;
    h.fuel = 10;
    const g = w.place('generator', 20, 20, 0)!;
    g.fuel = 5;
    run(w, 4);
    expect(w.power.satisfaction).toBe(1);
    expect(h.load).toBeCloseTo(150, 5);
    // 석탄 발전기는 놀고 있다 (발전기는 연료 하나를 미리 열어 두지만 쓰지는 않는다)
    expect(g.load).toBe(0);
    expect(g.fuel * 4000 + g.energy).toBe(5 * 4000);
    // 150kW × 4초 = 600kJ = 물 2개 분량
    expect(h.fuel * 300 + h.energy).toBeCloseTo(10 * 300 - 600, 5);
  });

  it('물이 떨어지면 "물 없음", 컨베이어로 물을 받는다', () => {
    const w = coalFreeWorld();
    const h = w.place('hydro', 10, 10, 0)!;
    w.tick();
    expect(h.status).toBe('no-water');
    const belt = w.place('belt', 9, 10, 1)!; // 오른쪽(수력 발전기)으로
    belt.items.push({ item: 'water', pos: 0.9, n: 1 }, { item: 'coal', pos: 0.4, n: 1 });
    run(w, 1);
    expect(h.fuel * 300 + h.energy).toBe(300); // 물 1개를 받았다
    expect(h.status).not.toBe('no-water');
    expect(belt.items.map((i) => i.item)).toEqual(['coal']); // 석탄은 안 받는다
  });

  it('전기로는 석탄 없이 철판 2개로 강철 1개를 만든다', () => {
    const w = coalFreeWorld();
    const f = w.place('electric-furnace', 10, 10, 1)!;
    const belt = w.place('belt', 9, 10, 1)!;
    belt.items.push({ item: 'iron-plate', pos: 0.9, n: 1 }, { item: 'iron-plate', pos: 0.6, n: 1 });
    beltRow(w, 12, 20, 10, 1);
    run(w, 8);
    expect(f.recipe).toBe('steel-e'); // 철판이 들어오면 레시피를 스스로 고른다
    let steel = 0;
    for (const b of w.buildings.values()) steel += b.items.filter((i) => i.item === 'steel').length + (b.outBuf.get('steel') ?? 0);
    expect(steel).toBe(1);
  });

  it('수력 발전기를 철거하면 쌓인 물은 물로 돌려준다 (석탄이 아니라)', () => {
    const w = coalFreeWorld();
    const h = w.place('hydro', 10, 10, 0)!;
    h.fuel = 4;
    w.remove(h);
    expect(w.stockOf('water')).toBe(4);
    expect(w.stockOf('coal')).toBe(0);
  });

  it('광맥 독립(최종 목표)은 재생 에너지와 전기 제강까지 해야 열린다', () => {
    const t = TECHS.find((x) => x.id === 'ore-independence')!;
    expect(t.requires).toEqual(expect.arrayContaining(['separation', 'renewables', 'electric-steel']));
  });
});

describe('분배기', () => {
  function feed(w: World, type: 'splitter' | 'overflow') {
    // 허브에서 꺼낼 수 없으니 컨베이어에 직접 올린다
    w.place('belt', 9, 10, 1);
    const s = w.place(type, 10, 10, 1)!;
    w.place('belt', 11, 10, 1); // 앞 (막다른 길)
    w.place('belt', 10, 9, 0); // 왼쪽 (위)
    w.place('belt', 10, 8, 0);
    w.place('belt', 10, 11, 2); // 오른쪽 (아래)
    w.place('belt', 10, 12, 2);
    return s;
  }

  it('일반 분배기는 출구에 고르게 나눈다', () => {
    const w = makeWorld();
    feed(w, 'splitter');
    const src = w.buildingAt(9, 10)!;
    for (let k = 0; k < 9; k++) {
      src.items.push({ item: 'iron-ore', pos: 0, n: 1 });
      run(w, 0.5);
    }
    run(w, 5);
    const front = w.buildingAt(11, 10)!.items.length;
    const up = w.buildingAt(10, 9)!.items.length + w.buildingAt(10, 8)!.items.length;
    const down = w.buildingAt(10, 11)!.items.length + w.buildingAt(10, 12)!.items.length;
    expect(front + up + down).toBe(9);
    expect([front, up, down]).toEqual([3, 3, 3]);
  });

  it('우선 분배기는 앞이 막힐 때만 옆으로 보낸다', () => {
    const w = makeWorld();
    feed(w, 'overflow');
    const src = w.buildingAt(9, 10)!;
    for (let k = 0; k < 10; k++) {
      src.items.push({ item: 'iron-ore', pos: 0, n: 1 });
      run(w, 0.5);
    }
    run(w, 5);
    const front = w.buildingAt(11, 10)!.items.length;
    const sides =
      w.buildingAt(10, 9)!.items.length +
      w.buildingAt(10, 8)!.items.length +
      w.buildingAt(10, 11)!.items.length +
      w.buildingAt(10, 12)!.items.length;
    expect(front).toBeGreaterThanOrEqual(4);
    expect(front + sides).toBe(10);
    expect(sides).toBeGreaterThan(0);
  });
});

describe('병합기', () => {
  /** 본선과 옆줄을 꽉 채운 채로 오래 돌려서 끝에서 각각 몇 개 나오는지 센다 */
  function merge(useMerger: boolean) {
    const w = makeWorld();
    for (let x = 5; x <= 25; x++) {
      if (useMerger && x === 10) w.place('merger', x, 10, 1);
      else w.place('belt', x, 10, 1);
    }
    for (let y = 3; y <= 9; y++) w.place('belt', 10, y, 2); // 위에서 합류
    const main = w.buildingAt(5, 10)!;
    const side = w.buildingAt(10, 3)!;
    const sink = w.buildingAt(25, 10)!;
    const out = { main: 0, side: 0 };
    for (let i = 0; i < 60 * 50; i++) {
      if (!main.items.some((it) => it.pos < 0.25)) main.items.push({ item: 'iron-ore', pos: 0, n: 1 });
      if (!side.items.some((it) => it.pos < 0.25)) side.items.push({ item: 'coal', pos: 0, n: 1 });
      w.tick();
      // 옆줄이 도착하기 전에 지나간 아이템이 출구 쪽 15칸을 다 빠져나갈 때까지(약 15초)는 세지 않는다
      if (i === 60 * 20) out.main = out.side = 0;
      while (sink.items.length && sink.items[0].pos >= 1) {
        out[sink.items.shift()!.item === 'coal' ? 'side' : 'main']++;
      }
    }
    return out;
  }

  it('컨베이어 옆구리 합류는 본선이 꽉 차면 옆줄이 거의 못 들어간다 (병합기가 필요한 이유)', () => {
    const { main, side } = merge(false);
    expect(side).toBeLessThan(main / 5);
  });

  it('병합기는 꽉 찬 두 줄을 번갈아 받는다', () => {
    const { main, side } = merge(true);
    expect(Math.abs(main - side)).toBeLessThanOrEqual(2);
    expect(main + side).toBeGreaterThan(40);
  });

  it('한 줄만 들어오면 기다리지 않고 그대로 통과시킨다', () => {
    const w = makeWorld();
    w.place('belt', 9, 10, 1);
    w.place('merger', 10, 10, 1);
    for (let x = 11; x <= 25; x++) w.place('belt', x, 10, 1);
    const src = w.buildingAt(9, 10)!;
    for (let k = 0; k < 10; k++) {
      src.items.push({ item: 'iron-ore', pos: 0, n: 1 });
      run(w, 0.25);
    }
    run(w, 3);
    const passed = [...Array(15).keys()].reduce((s, i) => s + w.buildingAt(11 + i, 10)!.items.length, 0);
    expect(passed).toBe(10);
  });

  it('앞(출구)으로는 받지 않는다', () => {
    const w = makeWorld();
    w.place('merger', 10, 10, 1);
    const belt = w.place('belt', 11, 10, 3)!; // 앞에서 병합기를 향함
    belt.items.push({ item: 'coal', pos: 0.9, n: 1 });
    run(w, 1);
    expect(belt.items).toHaveLength(1);
  });
});

describe('스마트 분류기', () => {
  function sortLine(w: World, filter: 'coal' | null) {
    w.place('belt', 9, 10, 1);
    const s = w.place('sorter', 10, 10, 1)!; // 입구 왼쪽, 앞 = 오른쪽
    w.setFilter(s, filter);
    w.place('belt', 11, 10, 1); // 앞 (막다른 길)
    w.place('belt', 12, 10, 1);
    w.place('belt', 10, 9, 0); // 옆 (위)
    w.place('belt', 10, 8, 0);
    w.place('belt', 10, 11, 2); // 옆 (아래)
    w.place('belt', 10, 12, 2);
    const src = w.buildingAt(9, 10)!;
    for (let k = 0; k < 8; k++) {
      src.items.push({ item: k % 2 ? 'coal' : 'iron-ore', pos: 0, n: 1 });
      run(w, 0.5);
    }
    run(w, 5);
    const on = (xs: [number, number][]) => xs.flatMap(([x, y]) => w.buildingAt(x, y)!.items.map((i) => i.item));
    return {
      front: on([[11, 10], [12, 10]]),
      up: on([[10, 9], [10, 8]]),
      down: on([[10, 11], [10, 12]]),
      sides: on([[10, 9], [10, 8], [10, 11], [10, 12]]),
    };
  }

  it('고른 아이템은 앞으로, 나머지는 양옆에 번갈아 보낸다', () => {
    const { front, up, down } = sortLine(makeWorld(), 'coal');
    expect(front).toEqual(['coal', 'coal', 'coal', 'coal']);
    // 섞여 들어와도 양옆 차례가 꼬이지 않는다
    expect(up).toEqual(['iron-ore', 'iron-ore']);
    expect(down).toEqual(['iron-ore', 'iron-ore']);
  });

  it('아이템을 안 고르면 전부 양옆으로 간다', () => {
    const { front, sides } = sortLine(makeWorld(), null);
    expect(front).toHaveLength(0);
    expect(sides).toHaveLength(8);
  });

  it('줄을 거꾸로 따라가 들어올 수 있는 아이템만 찾는다 (분쇄기 → 자갈·모래)', () => {
    const w = makeWorld();
    w.stock.set('steel', 100);
    const c = w.place('crusher', 10, 10, 1)!; // 출구 오른쪽
    w.setRecipe(c, 'crush-dirt');
    w.place('belt', 12, 10, 1);
    w.place('belt', 13, 10, 1);
    const s = w.place('sorter', 14, 10, 1)!;
    const up = w.upstream(s);
    expect(up.items).toEqual(['gravel', 'sand']);
    expect(up.sources.map((b) => b.type)).toEqual(['crusher']);
  });

  it('병합기·지하 컨베이어를 지나 여러 기계를 찾는다', () => {
    const w = makeWorld();
    ore(w, 4, 4);
    w.place('miner', 4, 4, 1); // 철광석, 출구 오른쪽 → (6,4)
    ore(w, 4, 14, 2, 1000, 'coal');
    w.place('miner', 4, 14, 0); // 석탄, 출구 위 → (4,13)
    w.place('belt', 6, 4, 1);
    w.place('underground', 7, 4, 1);
    w.place('underground', 10, 4, 1); // 땅속으로 (8,4)~(9,4) 건넘
    w.place('belt', 11, 4, 2);
    w.place('belt', 11, 5, 2);
    w.place('merger', 11, 6, 2); // 위(뒤)에서 철, 왼쪽(옆)에서 석탄
    for (let y = 13; y >= 6; y--) w.place('belt', 4, y, y === 6 ? 1 : 0); // 위로 올라가 (4,6)에서 오른쪽
    for (let x = 5; x <= 10; x++) w.place('belt', x, 6, 1);
    w.place('belt', 11, 7, 2);
    const s = w.place('sorter', 11, 8, 2)!;
    const up = w.upstream(s);
    expect(up.items).toEqual(['iron-ore', 'coal']);
    expect(up.sources.map((b) => b.type).sort()).toEqual(['miner', 'miner']);
  });

  it('레시피를 안 정한 제련로는 만들 수 있는 것 전부, 아무것도 없으면 빈 목록', () => {
    const w = makeWorld();
    w.place('smelter', 10, 10, 1);
    w.place('belt', 12, 10, 1);
    const s = w.place('sorter', 13, 10, 1)!;
    expect(w.upstream(s).items).toEqual(expect.arrayContaining(['iron-plate', 'copper-plate', 'steel']));
    const lone = w.place('sorter', 20, 20, 1)!;
    expect(w.upstream(lone).items).toEqual([]);
  });

  it('고른 아이템을 저장하고 불러온다', () => {
    const w = makeWorld();
    const s = w.place('sorter', 10, 10, 1)!;
    w.setFilter(s, 'steel');
    const copy = World.deserialize(JSON.parse(JSON.stringify(w.serialize())));
    expect(copy.buildingAt(10, 10)!.filter).toBe('steel');
  });
});

describe('고속 컨베이어와 고급 채굴기', () => {
  it('연구는 전체 속도를 올리지 않고 건물만 해금한다', () => {
    const w = generateWorld(1);
    w.stock.set('steel', 1000);
    w.stock.set('gear', 1000);
    for (const id of ['automation', 'power', 'steel']) w.applyTech(id);
    expect(w.unlockedBuildings.has('fast-belt')).toBe(false);
    expect(w.research('fast-belt')).toBe(true);
    expect(w.unlockedBuildings.has('fast-belt')).toBe(true);
  });

  it('고속 컨베이어는 1.5배 빠르게 옮긴다', () => {
    const travel = (type: 'belt' | 'fast-belt') => {
      const w = makeWorld();
      for (let x = 5; x <= 20; x++) w.place(type, x, 10, 1);
      const first = w.buildingAt(5, 10)!;
      first.items.push({ item: 'coal', pos: 0, n: 1 });
      let ticks = 0;
      while (!w.buildingAt(20, 10)!.items.length) {
        w.tick();
        ticks++;
      }
      return ticks;
    };
    expect(travel('belt') / travel('fast-belt')).toBeCloseTo(1.5, 1);
  });

  it('일반 컨베이어를 고속으로 바꿔도 위에 있던 아이템과 연결이 유지된다', () => {
    const w = makeWorld();
    beltRow(w, 5, 9, 10, 1);
    const mid = w.buildingAt(7, 10)!;
    mid.items.push({ item: 'coal', pos: 0.4, n: 1 });
    const plates = w.stockOf('iron-plate');
    const fast = w.replaceBelt(mid, 'fast-belt', 1)!;
    expect(fast.type).toBe('fast-belt');
    expect(fast.items).toEqual([{ item: 'coal', pos: 0.4, n: 1 }]);
    expect(w.stockOf('iron-plate')).toBe(plates + 1 - 1); // 일반 1 돌려받고 고속 1 냄
    run(w, 5);
    expect(w.buildingAt(9, 10)!.items).toHaveLength(1); // 끝까지 흘러감
  });

  it('고급 채굴기는 1초에 2개를 캔다', () => {
    const w = makeWorld();
    w.stock.set('steel', 100);
    w.stock.set('circuit', 100);
    ore(w, 5, 10);
    w.place('miner-2', 5, 10, 3);
    w.place('belt', 4, 10, 3);
    w.place('belt', 3, 10, 3); // 허브로
    const before = w.stockOf('iron-ore');
    run(w, 20);
    const got = w.stockOf('iron-ore') - before;
    expect(got).toBeGreaterThanOrEqual(37);
    expect(got).toBeLessThanOrEqual(40);
  });

  it('기계 출구에 지하 컨베이어 입구를 바로 붙일 수 있다', () => {
    const w = makeWorld();
    ore(w, 10, 10);
    w.place('miner', 10, 10, 3); // 출구 왼쪽
    w.place('underground', 9, 10, 3);
    w.place('underground', 5, 10, 3);
    beltRow(w, 4, 3, 10, 3);
    const before = w.stockOf('iron-ore');
    run(w, 15);
    expect(w.stockOf('iron-ore') - before).toBeGreaterThanOrEqual(8);
  });
});

describe('창고와 하역기', () => {
  it('하역기가 허브에서 고른 아이템을 0.5초마다 한 칸(일반 컨베이어 2개)씩 꺼낸다', () => {
    const w = makeWorld(); // 허브 (0,9)~(2,11)
    w.stock.set('coal', 50);
    const u = w.place('unloader', 3, 10, 1)!; // 뒤 = 허브, 앞 = 오른쪽
    w.setFilter(u, 'coal');
    for (let x = 4; x <= 20; x++) w.place('belt', x, 10, 1);
    run(w, 5);
    const onBelts = beltItemCount(w);
    expect(onBelts).toBeGreaterThanOrEqual(18);
    expect(onBelts).toBeLessThanOrEqual(20);
    expect(w.stockOf('coal')).toBe(50 - onBelts);
    expect(w.buildingAt(10, 10)!.items.every((it) => it.n === 2)).toBe(true);
  });

  it('하역기는 창고·허브 옆 어느 쪽에 놓든 뒤가 그쪽을 향하는 방향을 고른다', () => {
    const w = makeWorld();
    w.place('storage', 10, 10, 0); // (10,10)~(11,11)
    expect(w.unloaderDir(12, 10, 1)).toBe(1); // 오른쪽에 놓으면 앞이 오른쪽 (원하던 방향 그대로)
    expect(w.unloaderDir(10, 9, 1)).toBe(0); // 위에 놓으면 앞이 위
    expect(w.unloaderDir(9, 11, 1)).toBe(3); // 왼쪽에 놓으면 앞이 왼쪽
    expect(w.unloaderDir(11, 12, 1)).toBe(2); // 아래에 놓으면 앞이 아래
    expect(w.unloaderDir(20, 20, 1)).toBeNull(); // 옆에 아무것도 없음
    expect(w.unloaderDir(3, 10, 0)).toBe(1); // 허브 (0,9)~(2,11) 오른쪽
  });

  it('아이템을 안 고르면 든 것을 종류별로 번갈아 전부 꺼내고, 고른 게 없으면 멈춘다', () => {
    const w = makeWorld(); // 허브 재고: 철판·기어·돌
    const u = w.place('unloader', 3, 10, 1)!;
    for (let x = 4; x <= 12; x++) w.place('belt', x, 10, 1);
    run(w, 2);
    expect(u.status).toBe('working');
    const kinds = new Set<string>();
    for (const b of w.buildings.values()) for (const it of b.items) kinds.add(it.item);
    expect([...kinds].sort()).toEqual(['gear', 'iron-plate', 'stone']);
    const u2 = w.place('unloader', 1, 12, 2)!; // 허브 아래
    w.setFilter(u2, 'steel');
    w.place('belt', 1, 13, 2);
    run(w, 2);
    expect(u2.status).toBe('no-input');
    expect(w.buildingAt(1, 13)!.items).toHaveLength(0);
  });

  it('창고는 200개까지 받고, 하역기로 다시 꺼낼 수 있고, 철거하면 내용물을 돌려준다', () => {
    const w = makeWorld();
    const s = w.place('storage', 10, 10, 0)!;
    w.place('belt', 9, 10, 1); // 창고로 들어가는 컨베이어
    const src = w.buildingAt(9, 10)!;
    for (let k = 0; k < 5; k++) {
      src.items.push({ item: 'iron-ore', pos: 0, n: 1 });
      run(w, 0.3);
    }
    run(w, 2);
    expect(s.inBuf.get('iron-ore')).toBe(5);
    s.inBuf.set('iron-ore', 200);
    src.items.push({ item: 'iron-ore', pos: 0.9, n: 1 });
    run(w, 1);
    expect(src.items).toHaveLength(1); // 가득 차서 못 들어감

    src.items = [];
    const u = w.place('unloader', 12, 10, 1)!; // 뒤 = 창고
    w.setFilter(u, 'iron-ore');
    w.place('belt', 13, 10, 1);
    w.place('belt', 14, 10, 1);
    run(w, 2.1);
    expect(s.inBuf.get('iron-ore')).toBe(192); // 0.5초마다 2개씩 4번

    const before = w.stockOf('iron-ore');
    const inside = s.inBuf.get('iron-ore')!;
    w.remove(s);
    expect(w.stockOf('iron-ore')).toBe(before + inside);
  });
});

describe('컨베이어 한 칸에 쌓기', () => {
  it('밀린 결과물은 한 칸에 쌓아 내보낸다 (일반 2개, 고속 4개)', () => {
    const w = makeWorld();
    w.stock.set('steel', 100);
    const a = w.place('smelter', 10, 10, 1)!;
    w.setRecipe(a, 'iron-plate');
    a.outBuf.set('iron-plate', 6);
    w.place('belt', 12, 10, 1);
    const b = w.place('smelter', 10, 14, 1)!;
    w.setRecipe(b, 'iron-plate');
    b.outBuf.set('iron-plate', 6);
    w.applyTech('fast-belt');
    w.place('fast-belt', 12, 14, 1);
    w.tick();
    expect(w.buildingAt(12, 10)!.items.map((i) => i.n)).toEqual([2]);
    expect(w.buildingAt(12, 14)!.items.map((i) => i.n)).toEqual([4]);
    expect(a.outBuf.get('iron-plate')).toBe(4);
  });

  it('고속에서 일반 컨베이어로 넘어가면 한 칸에 2개씩 나눠서, 개수는 그대로', () => {
    const w = makeWorld();
    w.applyTech('fast-belt');
    w.place('fast-belt', 5, 5, 1);
    for (let x = 6; x <= 12; x++) w.place('belt', x, 5, 1);
    w.buildingAt(5, 5)!.items.push({ item: 'coal', pos: 0.9, n: 4 }, { item: 'coal', pos: 0.4, n: 4 });
    run(w, 3);
    expect(beltItemCount(w)).toBe(8);
    for (let x = 6; x <= 12; x++) for (const it of w.buildingAt(x, 5)!.items) expect(it.n).toBeLessThanOrEqual(2);
  });

  it('분배기·병합기는 한 칸을 통째로 넘기고, 끝까지 개수가 그대로다', () => {
    const w = makeWorld();
    w.place('belt', 9, 10, 1);
    w.place('splitter', 10, 10, 1);
    for (let x = 11; x <= 16; x++) w.place('belt', x, 10, 1); // 앞
    for (let y = 9; y >= 5; y--) w.place('belt', 10, y, 0); // 왼쪽(위)
    const src = w.buildingAt(9, 10)!;
    for (let k = 0; k < 4; k++) {
      src.items.push({ item: 'coal', pos: 0, n: 2 });
      run(w, 0.4);
    }
    run(w, 3);
    expect(beltItemCount(w)).toBe(8);
  });

  it('저장·불러오기에서 쌓인 개수가 남는다', () => {
    const w = makeWorld();
    w.place('belt', 5, 5, 1)!.items.push({ item: 'coal', pos: 0.5, n: 2 });
    const copy = World.deserialize(JSON.parse(JSON.stringify(w.serialize())));
    expect(copy.buildingAt(5, 5)!.items[0].n).toBe(2);
  });
});

describe('창고 합치기', () => {
  /** (x0, y0)부터 cols×rows로 창고를 놓는다 (창고 하나 2×2) */
  function grid(w: World, x0: number, y0: number, cols: number, rows: number) {
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) w.place('storage', x0 + i * 2, y0 + j * 2, 0);
  }
  const sizes = (w: World) => {
    const seen = new Set<number>();
    const out: number[] = [];
    for (const b of w.buildings.values()) {
      if (b.type !== 'storage' || seen.has(b.id)) continue;
      const g = w.storageGroup(b);
      g.forEach((s) => seen.add(s.id));
      out.push(g.length);
    }
    return out.sort((a, b) => b - a);
  };

  it('빈틈없는 직사각형으로 붙이면 한 창고가 되고, 아무 칸에 넣고 아무 칸에서 꺼낸다', () => {
    const w = makeWorld();
    grid(w, 10, 10, 2, 2);
    expect(sizes(w)).toEqual([4]);
    const [a, , , d] = w.storageGroup(w.buildingAt(10, 10)!);
    expect(w.storageCapacity(a)).toBe(800);
    a.inBuf.set('coal', 300); // 한 칸이 200을 넘어도 묶음 전체 800까지는 받는다
    w.place('belt', 9, 10, 1)!.items.push({ item: 'coal', pos: 0.9, n: 1 });
    run(w, 1);
    expect(w.storageTotal(d)).toBe(301);
    // 아래 오른쪽 창고 옆 하역기로 위 왼쪽 창고에 든 석탄을 꺼낸다
    const u = w.place('unloader', 14, 13, 1)!;
    w.setFilter(u, 'coal');
    for (let x = 15; x <= 18; x++) w.place('belt', x, 13, 1);
    run(w, 1.1);
    expect(w.storageCount(d, 'coal')).toBe(297);
  });

  it('튀어나온 창고(2+3)는 따로 놀고, 최대 3×4까지만 합쳐진다', () => {
    const w = makeWorld();
    grid(w, 4, 2, 2, 1); // 위 줄 2개
    grid(w, 4, 4, 3, 1); // 아래 줄 3개 → 2×2 + 1
    expect(sizes(w)).toEqual([4, 1]);
    const big = makeWorld();
    grid(big, 4, 4, 4, 4); // 4×4 = 16 → 4×3(12) + 남은 한 줄(4)
    expect(sizes(big)).toEqual([12, 4]);
  });

  it('칸이 어긋나게 붙으면 합쳐지지 않고, 하나를 철거하면 다시 묶는다', () => {
    const w = makeWorld();
    w.place('storage', 10, 10, 0);
    w.place('storage', 12, 11, 0); // 한 칸 어긋남
    expect(sizes(w)).toEqual([1, 1]);
    const v = makeWorld();
    grid(v, 10, 10, 2, 2);
    v.remove(v.buildingAt(12, 12)!);
    expect(sizes(v)).toEqual([2, 1]);
  });
});

describe('입구와 출구', () => {
  it('제련로 옆에 붙은 분배기로 결과물이 새지 않는다 (앞면으로만 출력)', () => {
    const w = makeWorld();
    w.place('belt', 9, 10, 1);
    const sp = w.place('splitter', 10, 10, 1)!; // 뒤(왼쪽)가 입구, 앞이 제련로
    const sm = w.place('smelter', 11, 10, 0)!; // 출구는 위
    w.place('belt', 11, 9, 0);
    w.place('belt', 11, 8, 0);
    const src = w.buildingAt(9, 10)!;
    let leaked = false;
    for (let k = 0; k < 6; k++) {
      src.items.push({ item: 'iron-ore', pos: 0, n: 1 });
      for (let t = 0; t < 30; t++) {
        w.tick();
        if (sp.held === 'iron-plate') leaked = true;
      }
    }
    run(w, 15);
    expect(leaked).toBe(false);
    const plates = w.buildingAt(11, 9)!.items.length + w.buildingAt(11, 8)!.items.length;
    expect(plates + (sm.outBuf.get('iron-plate') ?? 0)).toBe(6);
  });

  it('기계 앞면(출구)으로 들어오는 컨베이어는 받지 않는다', () => {
    const w = makeWorld();
    w.place('smelter', 10, 10, 3); // 출구는 왼쪽
    const belt = w.place('belt', 9, 10, 1)!; // 왼쪽에서 제련로를 향함
    belt.items.push({ item: 'iron-ore', pos: 0.9, n: 1 });
    run(w, 2);
    expect(belt.items).toHaveLength(1);
  });

  it('채굴기 → 제련로 → 허브를 컨베이어 없이 바로 이을 수 있다', () => {
    const w = makeWorld(); // 허브 (0,9)~(2,11)
    w.place('smelter', 3, 10, 3);
    ore(w, 5, 10);
    w.place('miner', 5, 10, 3);
    const before = w.stockOf('iron-plate');
    run(w, 30);
    const got = w.stockOf('iron-plate') - before;
    expect(got).toBeGreaterThanOrEqual(13);
    expect(got).toBeLessThanOrEqual(15);
  });

  it('분배기는 뒤쪽 입구로만 받는다', () => {
    const w = makeWorld();
    w.place('splitter', 10, 10, 1); // 입구는 왼쪽
    const side = w.place('belt', 10, 9, 2)!; // 위에서 분배기 옆면을 향함
    side.items.push({ item: 'iron-ore', pos: 0.9, n: 1 });
    run(w, 2);
    expect(side.items).toHaveLength(1);
  });
});

describe('컨베이어 위에 짓기', () => {
  it('제련로를 컨베이어 줄 위에 놓으면 그 칸을 지우고 흐름 방향으로 끼워 넣는다', () => {
    const w = makeWorld();
    ore(w, 10, 10);
    w.place('miner', 10, 10, 3);
    beltRow(w, 9, 3, 10, 3); // 채굴기 → 허브 (왼쪽으로)
    run(w, 5);
    const platesBefore = w.stockOf('iron-plate');
    const oreBefore = w.stockOf('iron-ore');
    const onBelts = w.buildingAt(6, 10)!.items.length + w.buildingAt(7, 10)!.items.length;

    expect(w.flowDirUnder('smelter', 6, 10, 6, 10)).toBe(3);
    expect(w.canPlace('smelter', 6, 10).ok).toBe(false);
    expect(w.canPlace('smelter', 6, 10, true).ok).toBe(true);
    const s = w.place('smelter', 6, 10, 3, false, true)!;
    expect(s.dir).toBe(3);
    // 컨베이어 2칸 비용과 그 위 광석을 돌려받는다
    expect(w.stockOf('iron-plate')).toBe(platesBefore + 2);
    expect(w.stockOf('iron-ore')).toBe(oreBefore + onBelts);

    run(w, 30);
    expect(w.stockOf('iron-plate') - (platesBefore + 2)).toBeGreaterThanOrEqual(10);
  });

  it('컨베이어가 아닌 건물은 덮어쓰지 않는다', () => {
    const w = makeWorld();
    w.place('belt', 10, 10, 1);
    w.place('splitter', 11, 11, 1);
    expect(w.canPlace('smelter', 10, 10, true).reason).toBe('이미 건물이 있음');
  });

  it('돌려받을 컨베이어 재료까지 쳐서 비용을 따진다', () => {
    const w = makeWorld();
    w.place('belt', 10, 10, 1);
    w.stock.set('iron-plate', 3); // 분배기는 철판 4 필요
    expect(w.canPlace('splitter', 10, 10, true).ok).toBe(true);
    expect(w.place('splitter', 10, 10, 1, false, true)).not.toBeNull();
    expect(w.stockOf('iron-plate')).toBe(0);
  });
});

describe('지하 컨베이어', () => {
  it('같은 방향으로 최대 4칸 건너 놓으면 입구-출구 짝이 된다', () => {
    const w = makeWorld();
    const a = w.place('underground', 10, 10, 1)!;
    const b = w.place('underground', 15, 10, 1)!; // 사이 4칸
    expect([a.ugMode, b.ugMode]).toEqual(['in', 'out']);
    expect([a.partner, b.partner]).toEqual([b.id, a.id]);
    // 너무 멀면 새 입구
    const c = w.place('underground', 21, 10, 1)!;
    expect(c.ugMode).toBe('in');
    expect(c.partner).toBe(0);
    // 방향이 다르면 짝이 안 된다
    const d = w.place('underground', 23, 10, 3)!;
    expect(d.ugMode).toBe('in');
  });

  it('다른 컨베이어 줄 아래로 교차해서 두 줄 모두 허브에 도착한다', () => {
    const w = makeWorld(); // 허브 (0,9)~(2,11)
    // 가로 줄: 채굴기 → 왼쪽으로 허브 (y=10). 중간 x=6에서 세로 줄 아래로 지나간다
    ore(w, 12, 10);
    w.place('miner', 12, 10, 3);
    beltRow(w, 11, 8, 10, 3);
    w.place('underground', 7, 10, 3);
    w.place('underground', 5, 10, 3);
    beltRow(w, 4, 3, 10, 3);
    // 세로 줄: x=6, 위에서 아래로 내려와 y=12에서 허브로 꺾인다 (가로 줄 위를 지나감)
    ore(w, 6, 3, 2, 1000, 'coal');
    w.place('miner', 6, 3, 2);
    for (let y = 5; y <= 11; y++) w.place('belt', 6, y, 2);
    w.place('belt', 6, 12, 3);
    for (let x = 5; x >= 3; x--) w.place('belt', x, 12, 3);
    w.place('belt', 2, 12, 0); // 허브 아래칸에서 위로
    run(w, 40);
    expect(w.stockOf('iron-ore')).toBeGreaterThanOrEqual(25);
    expect(w.stockOf('coal')).toBeGreaterThanOrEqual(25);
  });

  it('출구를 철거하면 땅속 아이템을 돌려주고 입구는 짝을 잃는다', () => {
    const w = makeWorld();
    const a = w.place('underground', 10, 10, 1)!;
    const b = w.place('underground', 13, 10, 1)!;
    a.items.push({ item: 'coal', pos: 2, n: 1 });
    w.remove(b);
    expect(a.partner).toBe(0);
    expect(a.items).toHaveLength(0);
    expect(w.stockOf('coal')).toBe(1);
    // 다시 놓으면 다시 짝이 된다
    const c = w.place('underground', 12, 10, 1)!;
    expect(c.ugMode).toBe('out');
    expect(a.partner).toBe(c.id);
  });

  it('저장/불러오기 후에도 짝과 땅속 아이템이 유지된다', () => {
    const w = makeWorld();
    const a = w.place('underground', 10, 10, 1)!;
    w.place('underground', 14, 10, 1);
    a.items.push({ item: 'coal', pos: 3.2, n: 1 });
    const copy = World.deserialize(JSON.parse(JSON.stringify(w.serialize())));
    const a2 = copy.buildingAt(10, 10)!;
    expect(a2.ugMode).toBe('in');
    expect(copy.partnerOf(a2)!.x).toBe(14);
    expect(a2.items[0].pos).toBeCloseTo(3.2);
  });
});

describe('철거', () => {
  it('건설 비용과 안에 든 아이템을 모두 돌려준다', () => {
    const w = makeWorld();
    const before = w.stockOf('iron-plate');
    const b = w.place('belt', 10, 10, 1)!;
    b.items.push({ item: 'coal', pos: 0.5, n: 1 });
    expect(w.stockOf('iron-plate')).toBe(before - 1);
    w.remove(b);
    expect(w.stockOf('iron-plate')).toBe(before);
    expect(w.stockOf('coal')).toBe(1);
    expect(w.buildingAt(10, 10)).toBeNull();
  });

  it('허브는 철거할 수 없다', () => {
    const w = makeWorld();
    expect(w.remove(w.hub!)).toBe(false);
  });
});

describe('연구', () => {
  it('재료를 내고 건물을 해금한다', () => {
    const w = generateWorld(1);
    expect(w.unlockedBuildings.has('assembler')).toBe(false);
    expect(w.canPlace('assembler', 0, 0).ok).toBe(false);
    expect(w.research('automation')).toBe(true);
    expect(w.unlockedBuildings.has('assembler')).toBe(true);
    expect(w.stockOf('iron-plate')).toBe(80);
    expect(w.research('automation')).toBe(false);
  });

  it('선행 연구가 없으면 못 한다', () => {
    const w = generateWorld(1);
    w.stock.set('iron-plate', 1000);
    w.stock.set('coal', 1000);
    expect(w.canResearch('steel').ok).toBe(false);
  });

  it('시작 재고만으로 첫 라인을 짓고, 그 라인으로 물류 연구까지 갈 수 있다 (막히지 않음)', () => {
    // 새 게임처럼: 시작 재고만, 허브 옆에 철광맥과 돌 광맥
    const w = new World(30, 30);
    w.createHub(0, 9);
    for (const s of STARTING_STOCK) w.stock.set(s.item, s.count);
    ore(w, 10, 10, 3, 700);
    // 채굴기 → 컨베이어 → 제련로(컨베이어 위에 끼우기) → 허브
    expect(applyCommand(w, 0, { t: 'place', tool: 'miner', x: 10, y: 10, dir: 3, initial: true, setting: null }).ok).toBe(true);
    for (let x = 9; x >= 3; x--) applyCommand(w, 0, { t: 'place', tool: 'belt', x, y: 10, dir: 3, initial: x === 9, setting: null });
    expect(applyCommand(w, 0, { t: 'place', tool: 'smelter', x: 6, y: 10, dir: 3, initial: true, setting: null }).ok).toBe(true);
    run(w, 120);
    expect(w.research('automation')).toBe(true);
    // 다음 단계인 조립기도 남은 시작 재고(기어)로 지을 수 있다
    expect(w.canPlace('assembler', 20, 20).ok).toBe(true);
    // 물류(철판 100 + 기어 50): 제련로 1대(분당 30)로도 몇 분이면 철판이 모인다
    run(w, 300);
    expect(w.stockOf('iron-plate')).toBeGreaterThanOrEqual(100);
  });

  describe('끝없는 연구', () => {
    const rich = () => {
      const w = generateWorld(1);
      for (const it of ['steel', 'circuit', 'concrete', 'brick'] as const) w.stock.set(it, 100000);
      return w;
    };

    it('광맥 독립 뒤에만 열리고, 단계마다 비용이 1.5배로 오른다', () => {
      const w = rich();
      expect(w.canResearch('endless-mining').reason).toBe('광맥 독립 뒤에 열려요');
      w.applyTech('ore-independence');
      const steel = w.stockOf('steel');
      expect(w.research('endless-mining')).toBe(true);
      expect(w.research('endless-mining')).toBe(true);
      expect(w.research('endless-mining')).toBe(true);
      expect(w.endlessLevel('endless-mining')).toBe(3);
      // 100 + 150 + 225
      expect(steel - w.stockOf('steel')).toBe(475);
      expect(endlessCost(ENDLESS_BY_ID['endless-mining'], 4)[0].count).toBe(338);
    });

    it('채굴기와 기계가 단계마다 10%씩 빨라진다 (생산 현황 최대치도)', () => {
      const w = makeWorld(); // 모든 연구 완료
      for (const it of ['steel', 'circuit', 'concrete', 'brick'] as const) w.stock.set(it, 100000);
      ore(w, 10, 10, 2, 500);
      const miner = w.place('miner', 10, 10, 0)!;
      const smelter = w.place('smelter', 20, 20, 0)!;
      smelter.recipe = 'iron-plate';
      const mine0 = w.craftTime(miner);
      const smelt0 = w.craftTime(smelter);
      w.research('endless-mining');
      w.research('endless-mining');
      w.research('endless-crafting');
      expect(w.craftTime(miner)).toBeCloseTo(mine0 / 1.2, 9);
      expect(w.craftTime(smelter)).toBeCloseTo(smelt0 / 1.1, 9);
    });

    it('컨베이어 속도: 단계마다 컨베이어 위 아이템이 10% 빨리 간다', () => {
      const speedAfter = (levels: number) => {
        const w = makeWorld();
        for (const it of ['steel', 'circuit', 'gear'] as const) w.stock.set(it, 100000);
        for (let i = 0; i < levels; i++) expect(w.research('endless-belt')).toBe(true);
        const belt = w.place('belt', 15, 15, 0)!;
        belt.items.push({ item: 'iron-ore', pos: 0, n: 1 });
        run(w, 0.25);
        return belt.items[0].pos;
      };
      const base = speedAfter(0);
      expect(base).toBeGreaterThan(0);
      expect(speedAfter(2)).toBeCloseTo(base * 1.2, 6);
    });

    it('트럭 성능: 단계마다 트럭이 10% 빨라지고 배터리도 10% 커진다 (칸당 전기는 그대로)', () => {
      const w = makeWorld();
      for (const it of ['steel', 'circuit', 'gear'] as const) w.stock.set(it, 100000);
      w.stock.set('iron-ore', 0);
      const a = w.place('station', 20, 4, 0)!;
      const b = w.place('station', 3, 10, 3)!;
      w.setStationMode(b, 'unload');
      for (let x = 5; x <= 21; x++) w.place('road', x, 6, 0);
      for (let y = 7; y <= 10; y++) w.place('road', 5, y, 0);
      const old = w.buildTruck(a)!;
      expect(w.research('endless-truck')).toBe(true);
      expect(w.research('endless-truck')).toBe(true);
      expect(w.truckBattery()).toBeCloseTo(TRUCK.battery * 1.2, 9);
      expect(w.truckSpeed()).toBeCloseTo(TRUCK.speed * 1.2, 9);
      // 새 트럭은 커진 배터리가 가득, 먼저 있던 트럭은 정류장에서 마저 채운다
      const v = w.buildTruck(a)!;
      expect(v.battery).toBeCloseTo(TRUCK.battery * 1.2, 9);
      expect(old.battery).toBe(TRUCK.battery);
      a.inBuf.set('iron-ore', 100);
      for (let i = 0; i < 60 * 30 && v.state !== 'to-unload'; i++) w.tick();
      run(w, 0.5);
      const x0 = v.x;
      const b0 = v.battery;
      run(w, 1);
      expect(Math.abs(x0 - v.x)).toBeCloseTo(TRUCK.speed * 1.2, 6);
      expect(b0 - v.battery).toBeCloseTo(TRUCK.speed * 1.2 * (TRUCK.drive / TRUCK.speed), 6);
    });

    it('저장·불러오기와 체크섬에 단계가 들어간다', () => {
      const w = rich();
      w.applyTech('ore-independence');
      const before = w.checksum();
      w.research('endless-crafting');
      expect(w.checksum()).not.toBe(before);
      const copy = World.deserialize(JSON.parse(JSON.stringify(w.serialize())));
      expect(copy.endlessLevel('endless-crafting')).toBe(1);
      expect(copy.boost('endless-crafting')).toBeCloseTo(1.1, 9);
    });
  });
});

describe('저장/불러오기', () => {
  it('불러온 월드가 원본과 똑같이 진행된다', () => {
    const w = makeWorld();
    ore(w, 10, 10);
    w.place('miner', 10, 10, 3);
    beltRow(w, 9, 8, 10, 3);
    w.place('smelter', 6, 10, 3);
    beltRow(w, 5, 3, 10, 3);
    run(w, 17.3);

    const copy = World.deserialize(JSON.parse(JSON.stringify(w.serialize())));
    run(w, 20);
    run(copy, 20);
    expect([...copy.stock].sort()).toEqual([...w.stock].sort());
    expect(beltItemCount(copy)).toBe(beltItemCount(w));
  });

  it('입출구 규칙 이전(v1) 저장은 이어진 컨베이어를 보고 방향을 맞춘다', () => {
    const w = makeWorld();
    ore(w, 10, 10);
    w.place('miner', 10, 10, 0); // 예전에는 방향이 상관없었다
    beltRow(w, 9, 8, 10, 3);
    w.place('smelter', 6, 10, 0);
    beltRow(w, 5, 3, 10, 3);
    w.place('belt', 20, 10, 1);
    w.place('splitter', 21, 10, 0);
    const data = JSON.parse(JSON.stringify(w.serialize()));
    data.v = 1;
    const loaded = World.deserialize(data);
    expect(loaded.buildingAt(10, 10)!.dir).toBe(3);
    expect(loaded.buildingAt(6, 10)!.dir).toBe(3);
    expect(loaded.buildingAt(21, 10)!.dir).toBe(1);
    const before = loaded.stockOf('iron-plate');
    run(loaded, 30);
    expect(loaded.stockOf('iron-plate')).toBeGreaterThan(before + 5);
  });

  it('무한 광맥을 보존한다', () => {
    const w = generateWorld(7);
    const copy = World.deserialize(JSON.parse(JSON.stringify(w.serialize())));
    let inf = 0;
    for (let i = 0; i < copy.resAmount.length; i++) if (copy.resAmount[i] === Infinity) inf++;
    expect(inf).toBeGreaterThan(0);
  });
});

describe('복사/붙여넣기', () => {
  it('영역 안 건물을 방향·레시피까지 복사해 붙여넣고 비용을 낸다', () => {
    const w = makeWorld();
    w.place('belt', 10, 10, 2);
    const a = w.place('assembler', 11, 10, 0)!;
    w.setRecipe(a, 'gear');
    const bp = copyArea(w, 12, 11, 10, 10)!; // 거꾸로 드래그해도 된다
    expect(bp.entries).toHaveLength(2);
    expect([bp.w, bp.h]).toEqual([3, 2]);

    const plates = w.stockOf('iron-plate');
    expect(pasteBlueprint(w, bp, 20, 20)).toEqual({ placed: 2, skipped: 0 });
    expect(w.buildingAt(20, 20)!.dir).toBe(2);
    expect(w.buildingAt(21, 20)!.recipe).toBe('gear');
    expect(w.stockOf('iron-plate')).toBe(plates - 1 - 10);

    // 같은 자리에 또 붙이면 겹쳐서 모두 건너뛴다
    expect(pasteBlueprint(w, bp, 20, 20)).toEqual({ placed: 0, skipped: 2 });
  });

  it('허브와 영역에 걸친 건물은 복사하지 않는다', () => {
    const w = makeWorld();
    w.place('assembler', 10, 10, 0);
    expect(copyArea(w, 0, 9, 10, 10)).toBeNull();
  });
});

describe('M7: 흙에서 금속 얻기', () => {
  /** 30×30, 허브 (0,9)~(2,11), 흙 정제 전까지만 연구, 재고 넉넉 */
  function m7World(refined = true) {
    const w = new World(30, 30);
    w.createHub(0, 9);
    for (const t of TECHS) if (refined || !['soil-refining', 'separation', 'ore-independence'].includes(t.id)) w.applyTech(t.id);
    for (const item of ['iron-plate', 'gear', 'stone', 'steel', 'circuit', 'brick'] as const) w.stock.set(item, 1000);
    return w;
  }

  it('흙 정제 전에는 빈 땅에 채굴기를 못 놓고, 후에는 흙을 캔다', () => {
    const before = m7World(false);
    expect(before.canPlace('miner', 10, 10).ok).toBe(false);

    const w = m7World();
    const m = w.place('miner', 10, 10, 3)!;
    expect(m.mineDirt).toBe(true);
    beltRow(w, 9, 3, 10, 3);
    run(w, 10);
    expect(w.stockOf('dirt')).toBeGreaterThanOrEqual(5);
    expect(m.status).not.toBe('depleted'); // 흙은 무한
  });

  it('광맥 위에 놓은 채굴기는 흙이 아니라 광맥을 캔다', () => {
    const w = m7World();
    ore(w, 10, 10);
    const m = w.place('miner', 10, 10, 3)!;
    expect(m.mineDirt).toBe(false);
  });

  it('양수기는 호수 위에만, 다른 건물은 호수 위에 못 짓는다', () => {
    const w = m7World();
    for (let y = 20; y < 24; y++) for (let x = 20; x < 24; x++) w.setResource(x, y, 'water', Infinity);
    expect(w.canPlace('belt', 21, 21).reason).toBe('물 위에는 지을 수 없음');
    expect(w.canPlace('pump', 10, 10).reason).toBe('호수 위에 놓아야 함');
    const p = w.place('pump', 20, 20, 3)!;
    w.place('belt', 19, 20, 3);
    run(w, 3);
    expect(w.buildingAt(19, 20)!.items.every((i) => i.item === 'water')).toBe(true);
    expect(w.machineStats(p)!.maxOut).toEqual([{ item: 'water', count: 120 }]);
  });

  it('분쇄기는 흙 2로 자갈 1 + 모래 1을 만들고 레시피를 스스로 고른다', () => {
    const w = m7World();
    const c = w.place('crusher', 10, 10, 3)!;
    c.inBuf.set('dirt', 4);
    for (let x = 9; x >= 3; x--) w.place('belt', x, 10, 3);
    run(w, 0.1);
    expect(c.recipe).toBeNull(); // 재료를 직접 넣었으니 아직 모름
    w.setRecipe(c, null);
    // 컨베이어로 흙이 들어오면 스스로 고른다
    const src = w.place('belt', 12, 10, 3)!;
    src.items.push({ item: 'dirt', pos: 0.9, n: 1 });
    run(w, 6);
    expect(c.recipe).toBe('crush-dirt');
  });

  it('세척기: 모래 3 + 물 2 → 광물 가루 1 + 진흙 1', () => {
    const w = m7World();
    const wsh = w.place('washer', 10, 10, 3)!;
    w.setRecipe(wsh, 'wash');
    wsh.inBuf.set('sand', 3);
    wsh.inBuf.set('water', 2);
    run(w, 3.1);
    expect(Object.fromEntries(wsh.outBuf)).toEqual({ 'mineral-dust': 1, mud: 1 });
  });

  it('분리기는 10개마다 정확히 철 정광 7 · 구리 정광 2 · 슬래그 1', () => {
    const w = m7World();
    const s = w.place('separator', 10, 10, 3)!;
    w.setRecipe(s, 'separate');
    const counts: Record<string, number> = {};
    for (let k = 0; k < 20; k++) {
      s.inBuf.set('mineral-dust', 2);
      run(w, 4.05);
      for (const [item, n] of s.outBuf) counts[item] = (counts[item] ?? 0) + n;
      s.outBuf.clear();
    }
    expect(counts).toEqual({ 'iron-concentrate': 14, 'copper-concentrate': 4, slag: 2 });
  });

  it('정광과 진흙은 제련로가 알아서 철판·구리판·벽돌로 만든다', () => {
    const w = m7World();
    for (const [item, out] of [
      ['iron-concentrate', 'iron-plate'],
      ['copper-concentrate', 'copper-plate'],
      ['mud', 'brick'],
    ] as const) {
      const s = w.place('smelter', 10, 10, 3)!;
      w.place('belt', 12, 10, 3);
      w.buildingAt(12, 10)!.items.push({ item, pos: 0.9, n: 1 });
      w.buildingAt(12, 10)!.items.push({ item, pos: 0.4, n: 1 });
      run(w, 5);
      expect([...s.outBuf.keys(), ...w.stock.keys()]).toContain(out);
      expect(s.recipe).not.toBeNull();
      w.remove(s);
      w.remove(w.buildingAt(12, 10)!);
    }
  });

  it('흙 채굴기·분리기 차례가 저장/불러오기 후에도 유지된다', () => {
    const w = m7World();
    w.place('miner', 10, 10, 3);
    const s = w.place('separator', 20, 10, 3)!;
    s.cycle = 7;
    const copy = World.deserialize(JSON.parse(JSON.stringify(w.serialize())));
    expect(copy.buildingAt(10, 10)!.mineDirt).toBe(true);
    expect(copy.buildingAt(20, 10)!.cycle).toBe(7);
    expect(copy.dirtMining).toBe(true);
  });
});

describe('차량 운송', () => {
  /**
   * 싣기 정류장 A (20,4)~(21,5) 에 철광석 100개.
   * 도로: (5,6)~(21,6) 가로, (5,7)~(5,10) 세로. 내리기 정류장 B (3,10)~(4,11) 는 앞(왼쪽)이 허브.
   */
  function roadWorld(ore = 100) {
    const w = makeWorld();
    w.stock.set('steel', 100);
    w.stock.set('circuit', 100);
    const a = w.place('station', 20, 4, 0)!;
    const b = w.place('station', 3, 10, 3)!;
    w.setStationMode(b, 'unload');
    for (let x = 5; x <= 21; x++) w.place('road', x, 6, 0);
    for (let y = 7; y <= 10; y++) w.place('road', 5, y, 0);
    a.inBuf.set('iron-ore', ore);
    return { w, a, b };
  }
  const everywhere = (w: World, a: ReturnType<typeof roadWorld>['a'], b: ReturnType<typeof roadWorld>['b']) => {
    let cargo = 0;
    for (const v of w.vehicles.values()) cargo += v.cargo.get('iron-ore') ?? 0;
    return (a.inBuf.get('iron-ore') ?? 0) + cargo + (b.outBuf.get('iron-ore') ?? 0) + w.stockOf('iron-ore');
  };

  it('정류장마다 번호가 붙고, 트럭은 싣기 정류장 옆 도로에서 가장 가까운 내리기 정류장을 짝으로 잡는다', () => {
    const { w, a, b } = roadWorld();
    expect([a.stationNo, b.stationNo]).toEqual([1, 2]);
    const steel = w.stockOf('steel');
    const v = w.buildTruck(a)!;
    expect(v).not.toBeNull();
    expect([v.loadId, v.unloadId]).toEqual([a.id, b.id]);
    expect(w.stationStops(a)).toContain(v.tile);
    expect(w.stockOf('steel')).toBe(steel - 10);
  });

  it('트럭이 싣고 달려가 내리면 내리기 정류장이 앞(허브)으로 내보낸다. 개수는 그대로', () => {
    const { w, a, b } = roadWorld();
    const v = w.buildTruck(a)!;
    run(w, 25);
    expect(w.stockOf('iron-ore')).toBe(50); // 50개 싣고 한 번 다녀옴
    expect(everywhere(w, a, b)).toBe(100);
    run(w, 40);
    expect(w.stockOf('iron-ore')).toBe(100);
    // 두 번 내려서 한 바퀴 기록이 생긴다: 50개 / 약 20초
    expect(v.perMinute).toBeGreaterThan(100);
    expect(v.perMinute).toBeLessThan(200);
  });

  it('덜 찼어도 잠깐 새 짐이 없으면 있는 만큼 싣고 출발한다', () => {
    const { w, a } = roadWorld(10);
    const v = w.buildTruck(a)!;
    run(w, 3);
    expect(v.state).toBe('loading');
    run(w, 4);
    expect(v.state).toBe('to-unload');
    expect(v.load).toBe(10);
  });

  it('길이 끊기면 기다리다가, 다시 이으면 간다', () => {
    const { w, a, b } = roadWorld();
    const v = w.buildTruck(a)!;
    w.remove(w.buildingAt(12, 6)!);
    run(w, 8);
    expect(v.status).toBe('no-route');
    expect(v.load).toBe(50);
    w.place('road', 12, 6, 0);
    run(w, 15);
    expect(w.stockOf('iron-ore')).toBe(50);
    expect(everywhere(w, a, b)).toBe(100);
  });

  it('달리는 도중 밑의 도로가 사라져도 옆 도로로 빠져나간다', () => {
    const { w, a } = roadWorld();
    const v = w.buildTruck(a)!;
    run(w, 7); // 싣고 출발해서 가로 도로 위
    const tx = v.tile % w.width;
    const ty = Math.floor(v.tile / w.width);
    expect(ty).toBe(6);
    expect(tx).toBeLessThan(20);
    w.remove(w.buildingAt(tx, ty)!);
    run(w, 15);
    expect(w.stockOf('iron-ore')).toBe(50);
  });

  it('컨베이어는 싣기 정류장에만 넣을 수 있다', () => {
    const { w, a, b } = roadWorld(0);
    const beltA = w.place('belt', 19, 4, 1)!; // 오른쪽(A)으로
    beltA.items.push({ item: 'coal', pos: 0.9, n: 1 });
    const beltB = w.place('belt', 3, 12, 0)!; // 위(B)로
    beltB.items.push({ item: 'coal', pos: 0.9, n: 1 });
    run(w, 1);
    expect(a.inBuf.get('coal')).toBe(1);
    expect(b.inBuf.size + b.outBuf.size).toBe(0);
    expect(beltB.items).toHaveLength(1);
  });

  it('싣기 정류장에 내리면 다른 트럭이 실어 갈 수 있게 쌓인다 (갈아싣기)', () => {
    const { w, a, b } = roadWorld();
    w.setStationMode(b, 'load');
    const v = w.buildTruck(a)!;
    w.setRoute(v, a.id, b.id);
    run(w, 18);
    expect(b.inBuf.get('iron-ore')).toBe(50);
    expect(w.stockOf('iron-ore')).toBe(0);
  });

  it('도로가 없으면 트럭을 못 만들고, 철거하면 재료와 짐을 돌려받는다', () => {
    const { w, a, b } = roadWorld();
    const lone = w.place('station', 24, 20, 0)!;
    expect(w.canBuildTruck(lone).ok).toBe(false);
    const v = w.buildTruck(a)!;
    run(w, 6);
    expect(v.load).toBe(50);
    const steel = w.stockOf('steel');
    w.removeVehicle(v);
    expect(w.vehicles.size).toBe(0);
    expect(w.stockOf('steel')).toBe(steel + 10);
    expect(everywhere(w, a, b)).toBe(100);
  });

  it('같은 길로 한 대 더: 두 정류장이 같은 트럭을 하나 더 만든다', () => {
    const { w, a, b } = roadWorld();
    const v = w.buildTruck(a)!;
    w.setRoute(v, a.id, b.id);
    const t = w.cloneTruck(v)!;
    expect([t.loadId, t.unloadId]).toEqual([a.id, b.id]);
    expect(t.id).not.toBe(v.id);
    expect(w.trucksOf(a)).toHaveLength(2);
  });

  it('한 싣기 정류장에 트럭이 여럿이면 먼저 온 트럭부터 가득 채워 보낸다', () => {
    const { w, a } = roadWorld(60);
    const v1 = w.buildTruck(a)!;
    const v2 = w.cloneTruck(v1)!;
    run(w, 5.5);
    expect(v1.state).toBe('to-unload');
    expect(v1.load).toBe(50);
    expect(v2.status).not.toBe('queued');
    run(w, 1);
    expect(v2.load).toBe(10);
  });

  it('허브·창고에 붙는 정류장 자리는 그쪽 면을 알려 준다 (내리기 정류장으로 만들 때 씀)', () => {
    const w = makeWorld(); // 허브 (0,9)~(2,11)
    expect(w.stationFacing(3, 10)).toBe(3); // 허브 오른쪽에 붙음 → 왼쪽이 앞
    expect(w.stationFacing(1, 12)).toBe(0); // 허브 아래에 붙음 → 위가 앞
    expect(w.stationFacing(10, 10)).toBeNull();
  });

  it('정류장이 없어지면 멈추고, 저장·불러오기 뒤에도 하던 일을 이어서 한다', () => {
    const { w, a, b } = roadWorld();
    const v = w.buildTruck(a)!;
    run(w, 8);
    const copy = World.deserialize(JSON.parse(JSON.stringify(w.serialize())));
    const v2 = copy.vehicles.get(v.id)!;
    expect(v2.load).toBe(v.load);
    expect(v2.state).toBe(v.state);
    expect(copy.buildingAt(3, 10)!.stationMode).toBe('unload');
    run(copy, 20);
    expect(copy.stockOf('iron-ore')).toBe(50);

    w.remove(b);
    run(w, 1);
    expect(v.status).toBe('no-station');
  });

  it('두 정류장 사이 길 길이를 알려 주고, 도로가 끊기면 null', () => {
    const { w, a, b } = roadWorld();
    const len = w.routeLength(a.id, b.id)!;
    expect(len).toBeGreaterThan(15);
    expect(len).toBeLessThan(30);
    w.remove(w.buildingAt(12, 6)!);
    expect(w.routeLength(a.id, b.id)).toBeNull();
    w.place('road', 12, 6, 0);
    expect(w.routeLength(a.id, b.id)).toBe(len);
  });

  it('싣는 짐을 고르면 그 아이템만 싣고, 서로 다른 짐을 싣는 트럭끼리는 차례를 기다리지 않는다', () => {
    const { w, a } = roadWorld(40);
    a.inBuf.set('copper-ore', 40);
    const iron = w.buildTruck(a)!;
    const copper = w.cloneTruck(iron)!;
    applyCommand(w, 0, { t: 'truck-filter', id: iron.id, item: 'iron-ore' });
    applyCommand(w, 0, { t: 'truck-filter', id: copper.id, item: 'copper-ore' });
    run(w, 3);
    // 둘 다 동시에 싣는 중 (한 대가 다른 한 대를 기다리지 않음)
    expect(iron.cargo.get('iron-ore')).toBeGreaterThan(10);
    expect(copper.cargo.get('copper-ore')).toBeGreaterThan(10);
    expect(iron.cargo.get('copper-ore') ?? 0).toBe(0);
    expect(copper.cargo.get('iron-ore') ?? 0).toBe(0);
    // 같은 길로 한 대 더 만들면 싣는 짐도 따라간다
    expect(w.cloneTruck(copper)!.filter).toBe('copper-ore');
    // 저장·불러오기
    const copy = World.deserialize(JSON.parse(JSON.stringify(w.serialize())));
    expect(copy.vehicles.get(iron.id)!.filter).toBe('iron-ore');
  });

  describe('배터리 (전기 트럭)', () => {
    /** cond가 될 때까지 한 틱씩 (최대 sec초) */
    const until = (w: World, cond: () => boolean, sec = 60) => {
      for (let i = 0; i < sec * 60 && !cond(); i++) w.tick();
      expect(cond()).toBe(true);
    };
    const perTile = TRUCK.drive / TRUCK.speed;

    it('달린 칸 수만큼 배터리가 줄고, 정류장에 서 있으면 공장 전력으로 충전한다 (그만큼 전력을 더 쓴다)', () => {
      const { w, a } = roadWorld();
      const v = w.buildTruck(a)!;
      until(w, () => v.state === 'to-unload');
      const x0 = v.x;
      run(w, 2);
      expect(v.battery).toBeCloseTo(TRUCK.battery - Math.abs(x0 - v.x) * perTile, 6);

      until(w, () => v.state === 'unloading');
      w.tick();
      expect(w.power.charge).toBe(TRUCK.charge);
      expect(w.power.demand).toBeGreaterThanOrEqual(TRUCK.charge);
      run(w, 4);
      expect(v.battery).toBe(TRUCK.battery);
      expect(w.power.charge).toBe(0);
    });

    it('떠날 때가 돼도 배터리가 다 찰 때까지 충전한 뒤 떠난다 (그동안 짐은 계속 싣는다)', () => {
      const { w, a } = roadWorld();
      const v = w.buildTruck(a)!;
      v.battery = 0;
      run(w, 6); // 50개는 5초면 다 싣지만, 빈 배터리는 9초 걸린다
      expect(v.load).toBe(TRUCK.capacity);
      expect(v.state).toBe('loading');
      expect(v.status).toBe('charging');
      expect(v.battery).toBeGreaterThan(1000);
      run(w, 4);
      expect(v.state).toBe('to-unload');
    });

    it('충전하는 트럭이 많아 전력이 모자라면 기계처럼 같은 비율로 느리게 충전한다', () => {
      const { w, a } = roadWorld();
      const v1 = w.buildTruck(a)!;
      const v2 = w.cloneTruck(v1)!;
      v1.battery = 0;
      v2.battery = 0;
      run(w, 1);
      // 허브 300kW에 트럭 둘이 200kW씩 → 75%
      expect(w.power.charge).toBe(2 * TRUCK.charge);
      expect(w.power.satisfaction).toBeCloseTo(0.75, 6);
      // 첫 틱은 정류장에 닿기만 하고, 그다음부터 150kW씩
      expect(v1.battery).toBeCloseTo(TRUCK.charge * 0.75 * (1 - 1 / 60), 3);
      expect(v2.battery).toBeCloseTo(v1.battery, 6);
    });

    it('배터리가 떨어지면 멈추지 않고 천천히 간다', () => {
      const { w, a } = roadWorld();
      const v = w.buildTruck(a)!;
      until(w, () => v.state === 'to-unload');
      run(w, 0.5);
      v.battery = 0;
      const x0 = v.x;
      run(w, 1);
      expect(v.status).toBe('no-battery');
      expect(Math.abs(x0 - v.x)).toBeCloseTo(TRUCK.speed * TRUCK.emptySpeed, 6);
      // 내리는 곳에 닿으면 다시 충전해서 가득 찬 뒤 돌아간다
      until(w, () => v.state === 'to-load', 120);
      expect(v.battery).toBe(TRUCK.battery);
    });

    it('저장·불러오기에 배터리가 남고, 배터리가 없던 예전 저장은 가득 찬 채로 불러온다', () => {
      const { w, a } = roadWorld();
      const v = w.buildTruck(a)!;
      v.battery = 777;
      const data = JSON.parse(JSON.stringify(w.serialize()));
      expect(World.deserialize(data).vehicles.get(v.id)!.battery).toBe(777);
      delete data.vehicles[0].battery;
      expect(World.deserialize(data).vehicles.get(v.id)!.battery).toBe(TRUCK.battery);
    });
  });
});

describe('목표 진행 저장', () => {
  it('이룬 목표는 저장·불러오기 뒤에도 남는다', () => {
    const w = makeWorld();
    w.guideDone.add('채굴기 놓기');
    const copy = World.deserialize(JSON.parse(JSON.stringify(w.serialize())));
    expect([...copy.guideDone]).toEqual(['채굴기 놓기']);
  });
});

describe('공장 통계', () => {
  it('기계마다 생산·소비를 아이템별로 더한다 (지금 / 100%일 때)', () => {
    const w = makeWorld();
    ore(w, 10, 10);
    w.place('miner', 10, 10, 3);
    w.place('smelter', 8, 10, 3); // 채굴기 출구 바로 앞
    w.place('smelter', 20, 20, 3); // 재료 없는 제련로
    w.setRecipe(w.buildingAt(20, 20)!, 'iron-plate');
    beltRow(w, 7, 3, 10, 3);
    run(w, 30);
    const f = w.factoryFlows();
    const ore_ = f.get('iron-ore')!;
    expect(ore_.makers).toBe(1);
    expect(ore_.madeMax).toBe(60);
    expect(ore_.users).toBe(2);
    expect(ore_.usedMax).toBe(60); // 제련로 2대 × 30
    // 채굴기는 분당 60을 캐지만 제련로 한 대가 30만 먹어서 막힌다
    expect(ore_.used).toBeGreaterThan(20);
    expect(ore_.used).toBeLessThan(35);
    expect(f.get('iron-plate')!.madeMax).toBe(60);
  });

  it('발전기가 태우는 석탄을 소비로 친다', () => {
    const w = makeWorld();
    w.place('generator', 5, 5, 0);
    const f = w.factoryFlows().get('coal')!;
    expect(f.users).toBe(1);
    expect(f.usedMax).toBeCloseTo((900 / 4000) * 60);
  });
});

describe('되돌리기', () => {
  it('드래그 한 번(한 단계)에 지은 것을 한꺼번에 치우고 환급한다. 다시 하기로 되살린다', () => {
    const w = makeWorld();
    const plates = w.stockOf('iron-plate');
    w.edit(() => beltRow(w, 5, 14, 20, 1));
    expect(w.stockOf('iron-plate')).toBe(plates - 10);
    const r = w.undo()!;
    expect(r.ops).toHaveLength(10);
    expect(r.skipped).toBe(0);
    expect(w.buildingAt(5, 20)).toBeNull();
    expect(w.stockOf('iron-plate')).toBe(plates);
    expect(w.canUndo).toBe(false);
    w.redo();
    expect(w.buildingAt(14, 20)?.dir).toBe(1);
    expect(w.stockOf('iron-plate')).toBe(plates - 10);
  });

  it('철거를 되돌리면 같은 자리에 같은 방향·레시피로 다시 짓는다', () => {
    const w = makeWorld();
    const a = w.place('assembler', 10, 10, 2)!;
    w.setRecipe(a, 'gear');
    w.edit(() => w.remove(a));
    expect(w.buildingAt(10, 10)).toBeNull();
    w.undo();
    const back = w.buildingAt(10, 10)!;
    expect(back.type).toBe('assembler');
    expect(back.dir).toBe(2);
    expect(back.recipe).toBe('gear');
  });

  it('컨베이어 위에 지은 기계를 되돌리면 컨베이어가 돌아온다', () => {
    const w = makeWorld();
    beltRow(w, 5, 12, 20, 1);
    w.edit(() => w.place('smelter', 8, 20, 1, false, true));
    expect(w.buildingAt(8, 20)?.type).toBe('smelter');
    w.undo();
    for (let x = 5; x <= 12; x++) {
      expect(w.buildingAt(x, 20)?.type).toBe('belt');
      expect(w.buildingAt(x, 20)?.dir).toBe(1);
    }
  });

  it('회전·분류기 아이템·정류장 종류 바꾸기도 되돌린다', () => {
    const w = makeWorld();
    w.stock.set('steel', 100);
    const s = w.place('sorter', 5, 5, 1)!;
    const st = w.place('station', 10, 10, 0)!;
    w.edit(() => {
      w.rotate(s, 2);
      w.setFilter(s, 'coal');
      w.setStationMode(st, 'unload');
    });
    w.undo();
    expect(s.dir).toBe(1);
    expect(s.filter).toBeNull();
    expect(st.stationMode).toBe('load');
  });

  it('지하 컨베이어 한 쌍을 지웠다 되돌리면 입구·출구 짝이 그대로다', () => {
    const w = makeWorld();
    const a = w.place('underground', 5, 5, 1)!;
    const b = w.place('underground', 8, 5, 1)!;
    expect([a.ugMode, b.ugMode]).toEqual(['in', 'out']);
    w.edit(() => {
      w.remove(a);
      w.remove(b);
    });
    w.undo();
    const a2 = w.buildingAt(5, 5)!;
    const b2 = w.buildingAt(8, 5)!;
    expect([a2.ugMode, b2.ugMode]).toEqual(['in', 'out']);
    expect(w.partnerOf(a2)).toBe(b2);
  });

  it('정류장 철거를 되돌리면 번호가 그대로고 오가던 트럭이 다시 이어진다', () => {
    const w = makeWorld();
    w.stock.set('steel', 100);
    w.stock.set('circuit', 100);
    const a = w.place('station', 10, 4, 0)!;
    const b = w.place('station', 10, 10, 0)!;
    for (let y = 6; y <= 9; y++) w.place('road', 10, y, 0);
    const v = w.buildTruck(a)!;
    expect(v.unloadId).toBe(b.id);
    w.edit(() => w.remove(b));
    w.undo();
    const b2 = w.buildingAt(10, 10)!;
    expect(b2.stationNo).toBe(2);
    expect(v.unloadId).toBe(b2.id);
    expect(w.nextStationNo).toBe(3);
  });

  it('정류장 짓기를 되돌렸다가 다시 하면 번호와 트럭 연결이 그대로다', () => {
    const w = makeWorld();
    w.stock.set('steel', 100);
    w.stock.set('circuit', 100);
    const a = w.place('station', 10, 4, 0)!;
    for (let y = 6; y <= 9; y++) w.place('road', 10, y, 0);
    w.edit(() => w.place('station', 10, 10, 0));
    const v = w.buildTruck(a)!;
    w.undo();
    expect(w.buildingAt(10, 10)).toBeNull();
    w.redo();
    const b = w.buildingAt(10, 10)!;
    expect(b.stationNo).toBe(2);
    expect(v.unloadId).toBe(b.id);
  });

  it('트럭 만들기·철거도 되돌린다 (같은 자리에 같은 길로 다시 만든다)', () => {
    const w = makeWorld();
    w.stock.set('steel', 100);
    w.stock.set('circuit', 100);
    const a = w.place('station', 10, 4, 0)!;
    const b = w.place('station', 10, 10, 0)!;
    for (let y = 6; y <= 9; y++) w.place('road', 10, y, 0);
    const v = w.edit(() => w.buildTruck(a))!;
    const steel = w.stockOf('steel');
    w.edit(() => w.removeVehicle(v));
    expect(w.vehicles.size).toBe(0);
    w.undo(); // 철거 되돌리기 → 다시 생김
    const back = [...w.vehicles.values()][0];
    expect([back.loadId, back.unloadId]).toEqual([a.id, b.id]);
    expect(back.tile).toBe(v.tile);
    expect(w.stockOf('steel')).toBe(steel);
    w.undo(); // 만들기 되돌리기 → 없어짐
    expect(w.vehicles.size).toBe(0);
    w.redo();
    w.redo();
    expect(w.vehicles.size).toBe(0);
  });

  it('재료가 모자라거나 자리가 막히면 그 부분만 건너뛴다', () => {
    const w = makeWorld();
    w.edit(() => {
      w.remove(w.place('belt', 5, 5, 1)!);
      w.remove(w.place('belt', 6, 5, 1)!);
    });
    w.place('splitter', 5, 5, 1); // 자리를 막는다
    const r = w.undo()!;
    expect(r.skipped).toBeGreaterThan(0);
    expect(w.buildingAt(5, 5)?.type).toBe('splitter');
  });

  it('새로 무언가 하면 다시 하기는 사라진다. 기록 밖에서 한 일(시뮬레이션·맵 생성)은 기록하지 않는다', () => {
    const w = makeWorld();
    w.place('belt', 1, 1, 1); // 기록 밖
    expect(w.canUndo).toBe(false);
    w.edit(() => w.place('belt', 2, 2, 1));
    w.undo();
    expect(w.canRedo).toBe(true);
    w.edit(() => w.place('belt', 3, 3, 1));
    expect(w.canRedo).toBe(false);
  });

  it('영역 철거: 사각형에 걸친 건물(허브 제외)을 찾는다', () => {
    const w = makeWorld();
    w.place('belt', 5, 5, 1);
    w.place('assembler', 7, 7, 1); // (7,7)~(8,8)
    w.place('belt', 12, 12, 1);
    const hit = w.buildingsIn(8, 8, 4, 4).map((b) => b.type).sort();
    expect(hit).toEqual(['assembler', 'belt']);
    expect(w.buildingsIn(0, 9, 3, 11)).toHaveLength(0); // 허브만 있는 곳
  });
});

describe('맵 생성: 광맥 양', () => {
  it('먼 광맥은 허브 근처 시작 광맥의 몇 배 수준이다 (예전엔 40배 넘음)', () => {
    for (const seed of [1, 2, 3]) {
      const w = generateWorld(seed);
      let near = 0;
      let far = 0;
      for (let i = 0; i < w.resItem.length; i++) {
        if (w.resItem[i] !== 'iron-ore') continue;
        const x = i % w.width;
        const d = Math.hypot(x - 64, (i - x) / w.width - 64);
        if (d < 16) near += w.resAmount[i];
        else far += w.resAmount[i];
      }
      expect(far / near).toBeLessThan(20);
    }
  });
});

describe('맵 생성', () => {
  it('허브 주변 가까운 곳에 시작 광맥 4종이 있다', () => {
    for (const seed of [1, 2, 3, 42, 1234]) {
      const w = generateWorld(seed);
      const found = new Set<string>();
      for (let y = 64 - 16; y < 64 + 16; y++) {
        for (let x = 64 - 16; x < 64 + 16; x++) {
          const item = w.resItem[w.idx(x, y)];
          if (item && item !== 'water') found.add(item);
        }
      }
      expect([...found].sort()).toEqual(['coal', 'copper-ore', 'iron-ore', 'stone']);
    }
  });
});
