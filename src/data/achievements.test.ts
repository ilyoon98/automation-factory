import { describe, expect, it } from 'vitest';
import { TECHS } from './tech';
import { ACHIEVEMENTS, achievementValue, checkAchievements, fmtAchievement, fmtCount, tierOf } from './achievements';
import { TICK_RATE, World } from '../sim/world';

/** 30×30 빈 맵, 허브 (0,9), 모든 연구, (10,10)에 철광맥과 허브로 가는 채굴기 */
function minerWorld(): World {
  const w = new World(30, 30);
  w.createHub(0, 9);
  for (const t of TECHS) w.applyTech(t.id);
  w.stock.set('iron-plate', 1000);
  w.stock.set('gear', 1000);
  w.stock.set('stone', 1000);
  for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) w.setResource(10 + dx, 10 + dy, 'iron-ore', 10_000);
  w.place('miner', 10, 10, 3);
  for (let x = 9; x >= 3; x--) w.place('belt', x, 10, 3);
  return w;
}

function run(w: World, seconds: number) {
  for (let i = 0; i < seconds * TICK_RATE; i++) w.tick();
}

const def = (id: string) => ACHIEVEMENTS.find((a) => a.id === id)!;

describe('업적', () => {
  it('기계가 캔 개수를 센다. 허브에 쌓인 양을 써도 줄지 않는다', () => {
    const w = minerWorld();
    run(w, 30);
    const made = w.madeTotal.get('iron-ore') ?? 0;
    expect(made).toBeGreaterThanOrEqual(28);
    expect(made).toBeLessThanOrEqual(31);
    w.stock.set('iron-ore', 0);
    expect(achievementValue(w, def('made-iron-ore'))).toBe(made);
  });

  it('분당 생산은 1분이 차야 잰다 (막 켠 뒤 숫자가 튀지 않게)', () => {
    const w = minerWorld();
    run(w, 50);
    expect(w.madePerMinute('iron-ore')).toBe(0);
    run(w, 20);
    // 채굴기 한 대 = 1초에 1개
    expect(w.madePerMinute('iron-ore')).toBeGreaterThanOrEqual(59);
    expect(w.madePerMinute('iron-ore')).toBeLessThanOrEqual(62);
  });

  it('단계는 한 번에 여러 칸 오르고, 값이 떨어져도 내려가지 않는다', () => {
    const w = new World(10, 10);
    const a = def('made-iron-plate');
    w.madeTotal.set('iron-plate', 12_000);
    expect(checkAchievements(w)).toEqual([{ def: a, tier: 2 }]);
    expect(checkAchievements(w)).toEqual([]);
    w.madeTotal.set('iron-plate', 0);
    expect(checkAchievements(w)).toEqual([]);
    expect(w.achieved.get(a.id)).toBe(2);
  });

  it('업적·누적 생산·심은 나무는 저장에 남는다', () => {
    const w = minerWorld();
    run(w, 10);
    w.planted = 7;
    w.madeTotal.set('iron-plate', 1_500);
    checkAchievements(w);
    const copy = World.deserialize(JSON.parse(JSON.stringify(w.serialize())));
    expect(copy.madeTotal).toEqual(w.madeTotal);
    expect(copy.planted).toBe(7);
    expect(copy.achieved.get('made-iron-plate')).toBe(1);
    // 같이 하기에 새로 들어온 사람도 같은 총량으로 이어 간다 (체크섬에 들어간다)
    expect(World.fromSnapshot(JSON.parse(JSON.stringify(w.snapshot()))).checksum()).toBe(w.checksum());
  });

  it('단계 기준과 글자', () => {
    const a = def('made-iron-ore');
    expect(tierOf(a, 999)).toBe(0);
    expect(tierOf(a, 1_000)).toBe(1);
    expect(tierOf(a, 5_000_000)).toBe(4);
    expect(fmtCount(1_000)).toBe('1천');
    expect(fmtCount(100_000)).toBe('10만');
    expect(fmtCount(1_500)).toBe('1,500');
    expect(fmtAchievement(def('power'), 20_000)).toBe('20MW');
    expect(fmtAchievement(def('rate-gear'), 150)).toBe('분당 150');
  });

  it('업적 id는 겹치지 않고 단계는 커지는 차례', () => {
    expect(new Set(ACHIEVEMENTS.map((a) => a.id)).size).toBe(ACHIEVEMENTS.length);
    for (const a of ACHIEVEMENTS) for (let i = 1; i < a.tiers.length; i++) expect(a.tiers[i]).toBeGreaterThan(a.tiers[i - 1]);
  });
});
