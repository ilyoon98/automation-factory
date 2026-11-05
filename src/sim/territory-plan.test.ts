import { describe, expect, it } from 'vitest';
import { generateTerritoryWorld } from './territory-map';
import { planOwners, scoresOf } from './territory-plan';
import type { Territory } from './world';

const fresh = (): Territory[] => generateTerritoryWorld(3).territories.map((t) => ({ ...t }));
const apply = (ts: Territory[], owners: number[]) => ts.forEach((t, k) => (t.owner = owners[k]));
const itemsOf = (ts: Territory[], owners: number[], p: number) => new Set(ts.filter((_, k) => owners[k] === p).map((t) => t.item));

describe('산지 나누기 표', () => {
  it('인원마다 모든 산지를 나누고, 둘 이상이면 혼자서 네 자원을 다 갖지 않으며 점수 차가 작다', () => {
    for (let n = 1; n <= 8; n++) {
      const ts = fresh();
      const players = Array.from({ length: n }, (_, i) => i * 10);
      const owners = planOwners(ts, players);
      expect(owners.every((o) => players.includes(o))).toBe(true);
      for (const p of players) expect(owners.some((o) => o === p)).toBe(true);
      if (n >= 2) for (const p of players) expect(itemsOf(ts, owners, p).size).toBeLessThan(4);
      const scores = [...scoresOf(ts, owners).values()];
      if (n >= 2) expect(Math.max(...scores) - Math.min(...scores)).toBeLessThanOrEqual(2);
    }
  });

  it('2명은 철·구리와 석탄·돌로, 3명은 점수 낮은 구리·돌을 한 사람이 더 많이 갖는다', () => {
    const ts = fresh();
    const two = planOwners(ts, [0, 5]);
    expect([...itemsOf(ts, two, 0)].sort()).toEqual(['copper-ore', 'iron-ore']);
    expect([...itemsOf(ts, two, 5)].sort()).toEqual(['coal', 'stone']);
    const three = planOwners(ts, [0, 5, 6]);
    const counts = [0, 5, 6].map((p) => three.filter((o) => o === p).length).sort();
    expect(counts).toEqual([2, 2, 4]);
  });

  it('사람이 들어오고 나가도 지금 주인을 최대한 남긴다', () => {
    const ts = fresh();
    apply(ts, planOwners(ts, [0, 5, 6, 7]));
    const before = ts.map((t) => t.owner);
    // 한 사람이 더 들어와도 넷 중 대부분은 그대로
    const five = planOwners(ts, [0, 5, 6, 7, 8]);
    expect(five.filter((o, k) => o === before[k]).length).toBeGreaterThanOrEqual(5);
    // 7이 나가면 7의 산지만 남은 사람에게, 나머지 셋은 그대로
    const three = planOwners(ts, [0, 5, 6]);
    for (let k = 0; k < ts.length; k++) if (before[k] !== 7 && before[k] !== 6) expect(three[k]).toBe(before[k]);
  });

  it('여덟 명을 넘으면 넘는 사람은 산지가 없고, 아무도 없으면 주인이 없다', () => {
    const ts = fresh();
    const owners = planOwners(ts, [0, 1, 2, 3, 4, 5, 6, 7, 9]);
    expect(owners.includes(9)).toBe(false);
    expect(planOwners(ts, [])).toEqual(Array(8).fill(-1));
  });
});
