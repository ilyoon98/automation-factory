import { describe, expect, it } from 'vitest';
import { MAIN_GOALS, MAIN_GOAL_BY_ID, PROJECT_GOAL, currentGoal, evaluateGoals } from './goals';
import { applyCommand } from './commands';
import { TICK_RATE, World } from './world';

/** 메인 목표 36개와 허브 프로젝트 (docs/목표-진행-상세기획.md) */

function run(w: World, seconds: number) {
  for (let i = 0; i < Math.round(seconds * TICK_RATE); i++) w.tick();
}

function regional(): World {
  const w = new World(60, 40);
  w.rules = 'regional-v1';
  w.createHub(0, 9);
  w.stock.set('iron-plate', 500);
  w.stock.set('gear', 200);
  w.stock.set('stone', 200);
  return w;
}

describe('메인 목표', () => {
  it('36개, 선행은 모두 있는 목표이고 순환이 없으며 MG36에서 모두 이어진다', () => {
    expect(MAIN_GOALS).toHaveLength(36);
    for (const g of MAIN_GOALS) for (const r of g.requires) expect(MAIN_GOAL_BY_ID[r], `${g.id} ← ${r}`).toBeDefined();
    const seen = new Set<string>();
    const visit = (id: string, path: string[]) => {
      expect(path.includes(id), `순환 ${path.join('>')}>${id}`).toBe(false);
      seen.add(id);
      for (const r of MAIN_GOAL_BY_ID[id].requires) visit(r, [...path, id]);
    };
    visit('MG36', []);
    expect(seen.size).toBe(36);
  });

  it('시작 재고는 생산 실적이 아니고, 실제로 캐고 녹인 것만 센다', () => {
    const w = regional();
    expect(currentGoal(w)?.id).toBe('MG01');
    evaluateGoals(w);
    expect(w.goals.size).toBe(0);
    for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) w.setResource(10 + dx, 10 + dy, 'iron-ore', 1000);
    w.place('miner', 10, 10, 3);
    for (let x = 9; x >= 3; x--) w.place('belt', x, 10, 3);
    run(w, 25);
    expect(w.goals.has('MG01')).toBe(true);
    expect(currentGoal(w)?.id).toBe('MG02');
  });

  it('한 번 이룬 목표는 저장·불러오기 뒤에도 남는다 (예전 세계는 판정하지 않는다)', () => {
    const w = regional();
    w.stats.made.set('iron-ore', 10);
    w.stats.hubIn.set('iron-ore', 10);
    run(w, 1);
    expect(w.goals.has('MG01')).toBe(true);
    const back = World.deserialize(JSON.parse(JSON.stringify(w.serialize())));
    expect(back.goals.has('MG01')).toBe(true);
    expect(back.stats.made.get('iron-ore')).toBe(10);
    const legacy = new World(20, 20);
    legacy.createHub(0, 0);
    legacy.stats.made.set('iron-ore', 99);
    run(legacy, 1);
    expect(legacy.goals.size).toBe(0);
  });

  it('채굴기→제련로→허브로 철판을 바로 보내도 첫 목표와 다음 철판 목표를 인정한다', () => {
    const w = regional();
    for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) w.setResource(10 + dx, 10 + dy, 'iron-ore', 1000);
    expect(w.place('miner', 10, 10, 3)).not.toBeNull();
    expect(w.place('smelter', 5, 10, 3)).not.toBeNull();
    for (const x of [9, 8, 7, 4, 3]) expect(w.place('belt', x, 10, 3)).not.toBeNull();
    run(w, 60);
    expect(w.stats.hubIn.get('iron-ore') ?? 0).toBe(0);
    expect(w.stats.hubIn.get('iron-plate')).toBeGreaterThanOrEqual(20);
    expect(w.goals.has('MG01')).toBe(true);
    expect(w.goals.has('MG02')).toBe(true);
    expect(World.deserialize(w.serialize()).goals.has('MG01')).toBe(true);
  });

  it('첫 반입은 철광석/철판 합계로 세고 시작 재고의 재순환만으로는 완료하지 않는다', () => {
    const w = regional();
    w.stats.hubIn.set('iron-plate', 10);
    evaluateGoals(w);
    expect(w.goals.has('MG01')).toBe(false);
    w.stats.made.set('iron-plate', 9);
    evaluateGoals(w);
    expect(w.goals.has('MG01')).toBe(false);
    w.stats.made.set('iron-plate', 10);
    w.stats.hubIn.set('iron-ore', 4); w.stats.hubIn.set('iron-plate', 6);
    evaluateGoals(w);
    expect(w.goals.has('MG01')).toBe(true);
  });
});

describe('지역 과제', () => {
  it('지열이 기계를 돌리면 실적이 쌓이고, 화산·염호 지역에서 조건이 차면 과제 기록 (메인 진행과 별개)', () => {
    const w = regional();
    for (const t of w.techs) w.applyTech(t.id);
    for (const item of ['steel', 'bronze', 'motor', 'controller', 'concrete'] as const) w.stock.set(item, 100);
    w.vents.push(w.idx(41, 21));
    expect(w.place('geothermal', 40, 20, 0)).not.toBeNull();
    const m = w.place('smelter', 44, 20, 0)!;
    w.setRecipe(m, 'iron-plate');
    for (let i = 0; i < 20 * TICK_RATE; i++) {
      m.inBuf.set('iron-ore', 2);
      m.outBuf.clear();
      w.tick();
    }
    expect(w.stats.geoWork).toBeGreaterThan(90 * 19);
    // 앞 지역 넷을 마친 상태로 (지역은 차례대로만 판정)
    for (const id of ['R1a', 'R1b', 'R2a', 'R2b', 'R3a', 'R3b', 'R4a', 'R4b']) w.challenges.add(id);
    run(w, 1);
    expect(w.challenges.has('R5b')).toBe(true);
    expect(w.goals.has('R5b')).toBe(false);
    const back = World.deserialize(JSON.parse(JSON.stringify(w.serialize())));
    expect(back.challenges.has('R5b')).toBe(true);
  });
});

describe('허브 프로젝트', () => {
  it('통합 자동화 뒤에 켜면 허브에 실제로 도착한 모듈만 50개까지 납품, 넘는 건 허브 재고로', () => {
    const w = regional();
    expect(applyCommand(w, 0, { t: 'project', on: true })).toBe(false);
    for (const t of w.techs) w.applyTech(t.id);
    w.stock.set('module', 7); // 이미 허브에 있던 모듈은 소급하지 않는다
    expect(applyCommand(w, 0, { t: 'project', on: true })).toBe(true);
    const belt = w.place('belt', 3, 10, 3)!;
    let fed = 0;
    const feed = (n: number) => {
      for (let i = 0; i < n * 60 && fed < n; i++) {
        if (!belt.items.length) {
          belt.items.push({ item: 'module', pos: 1, n: 1 });
          fed++;
        }
        w.tick();
      }
      run(w, 1);
    };
    feed(49);
    expect(w.stats.projectDelivered).toBe(49);
    expect(w.stockOf('module')).toBe(7);
    // 49/50에서 저장 → 마지막 1개
    const back = World.deserialize(JSON.parse(JSON.stringify(w.serialize())));
    const b2 = back.buildings.get(belt.id)!;
    b2.items.push({ item: 'module', pos: 1, n: 1 });
    run(back, 2);
    expect(back.stats.projectDelivered).toBe(PROJECT_GOAL);
    b2.items.push({ item: 'module', pos: 1, n: 1 });
    run(back, 2);
    expect(back.stats.projectDelivered).toBe(PROJECT_GOAL);
    expect(back.stockOf('module')).toBe(8);
    // MG36 확인 항목은 채워졌다 (선행이 남아 있으면 기록은 선행을 마친 뒤)
    expect(MAIN_GOAL_BY_ID.MG36.checks(back)[0]).toEqual(['설비 모듈 허브 납품', 50, 50]);
  });
});
