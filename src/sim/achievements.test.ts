import { describe, expect, it } from 'vitest';
import { ACHIEVEMENTS, achProgress, activeAchievements, sustainedSecs, ACH_BY_ID } from './achievements';
import { TICK_RATE, World } from './world';

/** 업적 1차 85종 (최초 42 · 심화 27 · 숨은 16) */

function run(w: World, seconds: number) {
  for (let i = 0; i < Math.round(seconds * TICK_RATE); i++) w.tick();
}

function legacy(): World {
  const w = new World(40, 30);
  w.createHub(0, 9);
  for (const item of ['iron-plate', 'gear', 'stone'] as const) w.stock.set(item, 1000);
  return w;
}

function regional(): World {
  const w = legacy();
  w.rules = 'regional-v1';
  w.zones = [];
  w.createHub(0, 9);
  return w;
}

describe('업적 목록', () => {
  it('최초 42 · 심화 27 · 숨은 16, id가 겹치지 않고 탐사(D24)는 없다', () => {
    expect(ACHIEVEMENTS.filter((a) => a.kind === 'first')).toHaveLength(42);
    expect(ACHIEVEMENTS.filter((a) => a.kind === 'deep')).toHaveLength(27);
    expect(ACHIEVEMENTS.filter((a) => a.kind === 'hidden')).toHaveLength(16);
    expect(new Set(ACHIEVEMENTS.map((a) => a.id)).size).toBe(85);
    expect(ACH_BY_ID.D24).toBeUndefined();
    for (const a of ACHIEVEMENTS.filter((x) => x.kind === 'deep')) {
      expect(a.tiers, a.id).toHaveLength(4);
      for (let i = 1; i < 4; i++) expect(a.tiers![i], a.id).toBeGreaterThan(a.tiers![i - 1]);
    }
    for (const a of ACHIEVEMENTS.filter((x) => x.kind === 'hidden')) expect(a.hint, a.id).toBeTruthy();
  });

  it('예전 세계는 기본 기능 업적만, 확장 세계는 85종 모두', () => {
    const l = activeAchievements(legacy());
    expect(l.length).toBeGreaterThan(20);
    expect(l.every((a) => a.needs.every((n) => n === 'K'))).toBe(true);
    expect(activeAchievements(regional())).toHaveLength(85);
  });
});

describe('판정', () => {
  it('시작 재고는 업적이 아니고, 실제로 녹인 철판 1개에 "뜨거운 첫 판"', () => {
    const w = legacy();
    w.stock.set('iron-plate', 999);
    run(w, 1);
    expect(w.ach.done.has('F02')).toBe(false);
    const s = w.place('smelter', 10, 10, 0)!;
    w.setRecipe(s, 'iron-plate');
    s.inBuf.set('iron-ore', 2);
    run(w, 3);
    expect(w.ach.done.has('F02')).toBe(true);
    expect(w.ach.done.has('F01')).toBe(false);
  });

  it('허브 밖 석탄 발전이 실제 수요에 1MJ를 대면 "스스로 켠 불" (발전기 용량만으로는 아님)', () => {
    const w = legacy();
    w.stock.set('coal', 100);
    for (const t of w.techs) w.applyTech(t.id);
    const g = w.place('generator', 20, 20, 0)!;
    g.fuel = 5;
    run(w, 5);
    expect(w.ach.done.has('F09')).toBe(false); // 수요가 없으면 공급도 없다
    const list = [0, 1, 2, 3, 4, 5].map((k) => {
      const m = w.place('smelter', 4 + k * 3, 16, 0)!;
      w.setRecipe(m, 'iron-plate');
      return m;
    });
    for (let s = 0; s < 20 && !w.ach.done.has('F09'); s++) {
      for (const m of list) {
        m.inBuf.set('iron-ore', 2);
        m.outBuf.clear();
      }
      g.fuel = 5;
      run(w, 1);
    }
    expect(w.ach.get('e:coal')).toBeGreaterThan(1000);
    expect(w.ach.done.has('F09')).toBe(true);
  });

  it('심화 메달: 기준에 닿으면 단계가 오르고, 여러 단계를 한꺼번에 넘을 수도 있다', () => {
    const w = legacy();
    w.stats.delivered = 99;
    run(w, 1);
    expect(w.ach.medals.get('D13') ?? 0).toBe(0);
    w.stats.delivered = 1000;
    run(w, 1);
    expect(w.ach.medals.get('D13')).toBe(2);
    expect(achProgress(w)[0]).toBeGreaterThanOrEqual(2);
  });

  it('"조건 충족 누적 180초"는 멈춰도 보존되고 이어서 채운다 (179초 + 1초)', () => {
    const w = legacy();
    const a = ACH_BY_ID.D01;
    const feed = () => {
      for (const item of ['iron-plate', 'gear', 'copper-wire', 'steel'] as const) w.stats.made.set(item, 1), w.ach.addWin(`m:${item}`, 10, w.time);
    };
    for (let s = 0; s < 179; s++) {
      feed();
      run(w, 1);
    }
    expect(sustainedSecs(w, a)).toBe(179);
    expect(w.ach.medals.get('D01') ?? 0).toBe(0);
    w.ach.win.clear(); // 생산이 멈춘 지 60초가 지난 것처럼 (최근 60초 창이 비었다)
    run(w, 120); // 조건이 깨진 동안 누적은 그대로
    expect(sustainedSecs(w, a)).toBe(179);
    feed();
    run(w, 1);
    expect(w.ach.medals.get('D01')).toBe(1);
  });

  it('숨은 업적: 화산에 태양광을 지으면 "여기는 햇빛 휴무" (달성 전에는 힌트만)', () => {
    const w = regional();
    w.terrain = new Uint8Array(w.width * w.height).fill(6); // 모두 화산
    w.zones = [];
    w.createHub(0, 9);
    for (const t of w.techs) w.applyTech(t.id);
    w.stock.set('circuit', 100);
    w.stock.set('brick', 100);
    expect(w.place('solar', 6, 6, 0)).not.toBeNull();
    run(w, 2);
    expect(w.ach.done.has('H08')).toBe(true);
  });

  it('업적 상태는 저장·중간 참가 뒤에도 같다', () => {
    const w = legacy();
    const s = w.place('smelter', 10, 10, 0)!;
    s.inBuf.set('iron-ore', 4);
    run(w, 5);
    const g = World.fromSnapshot(JSON.parse(JSON.stringify(w.snapshot())));
    expect(g.checksum()).toBe(w.checksum());
    for (let i = 0; i < 30; i++) {
      run(w, 1);
      run(g, 1);
      expect(g.checksum()).toBe(w.checksum());
    }
    const back = World.deserialize(JSON.parse(JSON.stringify(w.serialize())));
    expect([...back.ach.done.keys()]).toEqual([...w.ach.done.keys()]);
  });
});
