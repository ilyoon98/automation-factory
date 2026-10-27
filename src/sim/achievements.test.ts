import { describe, expect, it } from 'vitest';
import { ACHIEVEMENTS, achProgress, activeAchievements, sustainedSecs, ACH_BY_ID } from './achievements';
import { TICK_RATE, World } from './world';
import type { Building } from './building';
import { ITEM_IDS, type ItemId } from '../data/items';

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
    expect(new Set(ACHIEVEMENTS.map((a) => a.id)).size).toBe(115);
    expect(ACH_BY_ID.D24).toBeUndefined();
    for (const a of ACHIEVEMENTS.filter((x) => x.kind === 'deep')) {
      expect(a.tiers, a.id).toHaveLength(4);
      for (let i = 1; i < 4; i++) expect(a.tiers![i], a.id).toBeGreaterThan(a.tiers![i - 1]);
    }
    for (const a of ACHIEVEMENTS.filter((x) => x.kind === 'hidden')) expect(a.hint, a.id).toBeTruthy();
  });

  it('예전 세계는 기본 기능 업적만, 확장 세계는 115종 모두', () => {
    const l = activeAchievements(legacy());
    expect(l.length).toBeGreaterThan(20);
    expect(l.every((a) => a.needs.every((n) => n === 'K'))).toBe(true);
    expect(activeAchievements(regional())).toHaveLength(115);
  });

  it('기록 30종: record-v1 저장 id, 네 메달, 예전 세계 26계열(주석·청동·알루미늄·폭풍 제외)', () => {
    const recs = ACHIEVEMENTS.filter((a) => a.kind === 'record');
    expect(recs).toHaveLength(30);
    expect(recs.map((a) => a.code)).toEqual(Array.from({ length: 30 }, (_, i) => `REC${String(i + 1).padStart(2, '0')}`));
    for (const a of recs) {
      expect(a.id.startsWith('record-v1/'), a.id).toBe(true);
      expect(a.tiers).toHaveLength(4);
    }
    const legacyRecs = activeAchievements(legacy()).filter((a) => a.kind === 'record');
    expect(legacyRecs).toHaveLength(26);
    expect(legacyRecs.map((a) => a.code)).not.toContain('REC26');
    // 공개 완료율 분모: 기록은 계열마다 메달 4개
    const [, legacyAll] = achProgress(legacy());
    const [, regionalAll] = achProgress(regional());
    expect(regionalAll - legacyAll).toBeGreaterThan(0);
  });
});

describe('기록 업적', () => {
  const rec = (code: string) => ACHIEVEMENTS.find((a) => a.code === code)!;
  const medal = (w: World, code: string) => w.ach.medals.get(rec(code).id) ?? 0;
  const produce = (w: World, b: Building, item: ItemId, n: number) => (w as unknown as { produce(b: Building, i: ItemId, n: number): void }).produce(b, item, n);

  it('REC01: 499 → 500에 동, 2,499 → 2,500에 은을 한 번씩. 시작 재고는 세지 않는다', () => {
    const w = legacy();
    w.stock.set('iron-ore', 99999);
    const m = w.place('smelter', 30, 20, 0)!;
    produce(w, m, 'iron-ore', 499);
    run(w, 1);
    expect(medal(w, 'REC01')).toBe(0);
    produce(w, m, 'iron-ore', 1);
    run(w, 1);
    expect(medal(w, 'REC01')).toBe(1);
    produce(w, m, 'iron-ore', 1999);
    run(w, 1);
    expect(medal(w, 'REC01')).toBe(1);
    produce(w, m, 'iron-ore', 1);
    run(w, 1);
    expect(medal(w, 'REC01')).toBe(2);
  });

  it('여러 기준을 한 번에 넘으면 아래 메달까지 모두 (청동 레시피 1회 = 4개)', () => {
    const w = regional();
    const s = w.place('smelter', 10, 10, 0)!;
    produce(w, s, 'bronze', 4);
    expect(w.stats.made.get('bronze')).toBe(4);
    produce(w, s, 'bronze', 1000);
    run(w, 1);
    expect(medal(w, 'REC16')).toBe(2);
  });

  it('Q60: 측정 59초에는 판정하지 않고, 완전한 60초 창부터 (철판 30개 = 동)', () => {
    const w = legacy();
    const s = w.place('smelter', 10, 10, 0)!;
    run(w, 1); // 집계 시작
    produce(w, s, 'iron-plate', 30);
    while (w.ach.q60Measured() < 59) run(w, 1);
    expect(medal(w, 'REC18')).toBe(0);
    run(w, 1);
    expect(w.ach.q60Measured()).toBe(60);
    expect(w.ach.q60Now[0]).toBe(30);
    expect(medal(w, 'REC18')).toBe(1);
    run(w, 61); // 창에서 빠져도 메달·최고는 남는다
    expect(w.ach.q60Now[0]).toBe(0);
    expect(w.ach.q60Best[0]).toBe(30);
    expect(medal(w, 'REC18')).toBe(1);
  });

  it('Q60 창은 저장·중간 참가 뒤에도 같은 시각에 판정한다', () => {
    const w = legacy();
    const s = w.place('smelter', 10, 10, 0)!;
    run(w, 1);
    produce(w, s, 'iron-plate', 30);
    while (w.ach.q60Measured() < 59) run(w, 1);
    expect(medal(w, 'REC18')).toBe(0);
    const g = World.fromSnapshot(JSON.parse(JSON.stringify(w.snapshot())));
    const back = World.deserialize(JSON.parse(JSON.stringify(w.serialize())));
    expect(g.checksum()).toBe(w.checksum());
    for (const x of [w, g, back]) run(x, 1);
    expect(g.checksum()).toBe(w.checksum());
    for (const x of [w, g, back]) expect(medal(x, 'REC18')).toBe(1);
  });

  it('REC24: 한 게임 초에 499,999J는 미달, 500,000J는 동 (1초 평균)', () => {
    const w = legacy();
    run(w, 1);
    const t0 = Math.floor(w.time) + 1;
    w.ach.recWork(499.999, t0 + 0.2);
    w.ach.recRoll(t0 + 1);
    expect(w.ach.workBest).toBeCloseTo(499.999, 6);
    w.ach.recWork(300, t0 + 1.1);
    w.ach.recWork(200, t0 + 1.9); // 전반 300, 후반 200 → 평균 500kW
    w.ach.recRoll(t0 + 2);
    expect(w.ach.workBest).toBe(500);
    expect((rec('REC24').value!(w))).toBe(500);
  });

  it('허브 전기만으로 일하거나 발전기만 지어 두면 REC24·25는 늘지 않는다', () => {
    const w = legacy();
    for (const t of w.techs) w.applyTech(t.id);
    const g = w.place('generator', 20, 20, 0)!;
    g.fuel = 5;
    const s = w.place('smelter', 10, 10, 0)!;
    w.setRecipe(s, 'iron-plate');
    for (let k = 0; k < 3; k++) {
      s.inBuf.set('iron-ore', 4);
      run(w, 1);
    }
    expect(w.ach.workBest).toBe(0); // 90kW 작업은 허브 400kW 안에서
    expect(w.ach.get('r:night')).toBe(0);
  });

  it('허브 밖 발전이 작업에 준 몫은 실제 출력 비율로 나눈다 (밤이면 REC25에도)', () => {
    const w = legacy();
    for (const t of w.techs) w.applyTech(t.id);
    const g = w.place('generator', 30, 20, 0)!;
    w.time = 504; // 한밤 시작 (하루 720초의 [504, 648))
    const list = [0, 1, 2, 3, 4, 5].map((k) => {
      const m = w.place('smelter', 4 + k * 3, 16, 0)!;
      w.setRecipe(m, 'iron-plate');
      return m;
    }); // 540kW: 허브 400 + 석탄 140
    for (let k = 0; k < 3; k++) {
      for (const m of list) {
        m.inBuf.set('iron-ore', 4);
        m.outBuf.clear();
      }
      g.fuel = 5;
      run(w, 1);
    }
    expect(w.ach.workBest).toBeCloseTo(140, 0);
    expect(w.ach.get('r:night')).toBeCloseTo(140 * 3, -1);
  });

  it('REC27: 벨트·도로·전봇대·허브는 세지 않고, 지금 있는 설비만 (9대 반복으로는 동 없음)', () => {
    const w = legacy();
    for (const t of w.techs) w.applyTech(t.id);
    for (let x = 2; x < 40; x++) w.place('belt', x, 25, 0);
    run(w, 1);
    expect(rec('REC27').value!(w)).toBe(0);
    const list = Array.from({ length: 9 }, (_, k) => w.place('storage', 4 + k * 3, 20, 0)!);
    expect(list.every(Boolean)).toBe(true);
    run(w, 1);
    for (let r = 0; r < 3; r++) {
      w.remove(list[0]);
      list[0] = w.place('storage', 4, 20, 0)!;
      run(w, 1);
    }
    expect(medal(w, 'REC27')).toBe(0);
    expect(w.place('storage', 32, 16, 0)).not.toBeNull();
    run(w, 1);
    expect(medal(w, 'REC27')).toBe(1);
    w.remove(list[1]);
    run(w, 1);
    expect(medal(w, 'REC27')).toBe(1); // 철거해도 메달은 남는다
  });

  it('REC30: 끝없는 연구를 재료를 내고 올린 단계만, 불러오기로는 늘지 않는다', () => {
    const w = legacy();
    for (const t of w.techs) w.applyTech(t.id);
    for (const item of ITEM_IDS) w.stock.set(item, 100000);
    expect(w.research('endless-mining')).toBe(true);
    expect(w.research('endless-belt')).toBe(true);
    run(w, 1);
    expect(w.ach.get('r:endless')).toBe(2);
    expect(medal(w, 'REC30')).toBe(1);
    const back = World.deserialize(JSON.parse(JSON.stringify(w.serialize())));
    run(back, 1);
    expect(back.ach.get('r:endless')).toBe(2);
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
