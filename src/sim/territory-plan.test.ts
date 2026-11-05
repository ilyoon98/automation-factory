import { describe, expect, it } from 'vitest';
import { generateTerritoryWorld } from './territory-map';
import { TERRITORY_SCORE, planOwners, scoresOf } from './territory-plan';
import type { Territory } from './world';

/** 시험용 산지들: 기본은 여덟 곳 모두 연다 */
const fresh = (open = 8): Territory[] => generateTerritoryWorld(3).territories.map((t, k) => ({ ...t, open: k < open, owner: -1 }));
const apply = (ts: Territory[], owners: number[]) => ts.forEach((t, k) => (t.owner = owners[k]));
const itemsOf = (ts: Territory[], owners: number[], p: number) => new Set(ts.filter((_, k) => owners[k] === p).map((t) => t.item));

describe('산지 나누기', () => {
  it('열린 여덟 곳을 1~8명에게: 모두 나누고, 둘 이상이면 혼자 네 자원을 다 갖지 않으며 점수 차가 작다', () => {
    for (let n = 1; n <= 8; n++) {
      const ts = fresh();
      const players = Array.from({ length: n }, (_, i) => i * 10);
      const owners = planOwners(ts, players);
      expect(owners.every((o) => players.includes(o))).toBe(true);
      for (const p of players) expect(owners.includes(p)).toBe(true);
      if (n >= 2) for (const p of players) expect(itemsOf(ts, owners, p).size).toBeLessThan(4);
      const scores = [...scoresOf(ts, owners).values()];
      if (n >= 2) expect(Math.max(...scores) - Math.min(...scores)).toBeLessThanOrEqual(2);
    }
  });

  it('2명이면 서로 다른 두 자원씩, 점수 낮은 자원을 맡은 사람은 산지를 더 많이 받는다', () => {
    const ts = fresh();
    const two = planOwners(ts, [0, 5]);
    const a = itemsOf(ts, two, 0), b = itemsOf(ts, two, 5);
    expect(a.size).toBe(2); expect(b.size).toBe(2);
    expect([...a].some((i) => b.has(i))).toBe(false);
    const three = planOwners(ts, [0, 5, 6]);
    // 산지가 가장 많은 사람의 평균 점수가 가장 낮다
    const avg = (p: number) => {
      const mine = ts.filter((_, k) => three[k] === p);
      return { n: mine.length, avg: mine.reduce((s, t) => s + TERRITORY_SCORE[t.item]!, 0) / mine.length };
    };
    const all = [0, 5, 6].map(avg).sort((x, y) => y.n - x.n);
    expect(all[0].avg).toBeLessThanOrEqual(all[all.length - 1].avg);
  });

  it('닫힌 산지는 나누지 않고, 열린 곳보다 사람이 많으면 넘는 사람은 산지가 없다', () => {
    const ts = fresh(4);
    const owners = planOwners(ts, [0, 5, 6, 7, 8]);
    expect(owners.slice(4)).toEqual([-1, -1, -1, -1]);
    expect(new Set(owners.slice(0, 4)).size).toBe(4);
    expect(owners.includes(8)).toBe(false);
    expect(planOwners(ts, [])).toEqual(Array(8).fill(-1));
  });

  it('사람이 들어오고 나가도 지금 주인을 최대한 남긴다', () => {
    const ts = fresh();
    apply(ts, planOwners(ts, [0, 5, 6, 7]));
    const before = ts.map((t) => t.owner);
    const five = planOwners(ts, [0, 5, 6, 7, 8]);
    expect(five.filter((o, k) => o === before[k]).length).toBeGreaterThanOrEqual(4);
    apply(ts, five);
    const back = planOwners(ts, [0, 5, 6, 7]);
    expect(back.filter((o, k) => o === five[k]).length).toBeGreaterThanOrEqual(5);
  });

  it('새 산지가 열리면 기존 주인은 그대로 두고 새 산지만 누군가에게 붙인다 (혼자면 나에게)', () => {
    const solo = fresh(4);
    apply(solo, planOwners(solo, [0]));
    solo[4].open = true;
    expect(planOwners(solo, [0])).toEqual([0, 0, 0, 0, 0, -1, -1, -1]);
  });
});
