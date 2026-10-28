import { describe, expect, it } from 'vitest';
import { evaluateGoals } from './goals';
import { START_REVEAL, generateRegionalWorld } from './regional-map';
import { World } from './world';

/** 확장 지도의 확인한 땅: 처음엔 허브 둘레만, 목표를 이루면 거점이 길과 함께 열린다 */

/** 확인한 칸만 밟고 a에서 b(둘레 2칸)까지 갈 수 있는지 */
function revealedPath(w: World, a: [number, number], b: [number, number]): boolean {
  const seen = new Uint8Array(w.width * w.height);
  const q = [w.idx(a[0], a[1])];
  seen[q[0]] = 1;
  for (let k = 0; k < q.length; k++) {
    const i = q[k];
    const x = i % w.width;
    const y = Math.floor(i / w.width);
    if (Math.abs(x - b[0]) <= 2 && Math.abs(y - b[1]) <= 2) return true;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      if (!w.inBounds(x + dx, y + dy)) continue;
      const j = w.idx(x + dx, y + dy);
      if (!seen[j] && w.isRevealed(j)) {
        seen[j] = 1;
        q.push(j);
      }
    }
  }
  return false;
}

describe('확인한 땅', () => {
  it('새 확장 지도는 허브 둘레만 보이고, 첫 추가 광맥까지는 들어 있다', () => {
    const w = generateRegionalWorld(7);
    const [ax, ay] = w.sites.A;
    expect(w.isRevealed(w.idx(ax, ay))).toBe(true);
    expect(w.isRevealed(w.idx(ax + START_REVEAL - 2, ay))).toBe(true);
    const [bx, by] = w.sites.B;
    expect(w.isRevealed(w.idx(bx, by))).toBe(false);
    expect(w.revealedCount).toBeLessThan(w.width * w.height * 0.15);
    // 시작 광맥은 모두 보인다
    for (const item of ['iron-ore', 'copper-ore', 'coal', 'stone'] as const) {
      let seen = false;
      for (let i = 0; i < w.resItem.length && !seen; i++) if (w.resItem[i] === item && w.isRevealed(i)) seen = true;
      expect(seen, item).toBe(true);
    }
  });

  it('모르는 땅에는 못 짓고, 가장자리에 지어도 지도는 넓어지지 않는다 (목표로만 열린다)', () => {
    const w = generateRegionalWorld(7);
    w.stock.set('iron-plate', 1000);
    const [ax, ay] = w.sites.A;
    // 확인한 땅 끝에서 도로를 놓을 수 있는 줄을 찾는다 (물·광맥이 아닌 곳)
    let found = false;
    for (let dy = -10; dy <= 10 && !found; dy++) {
      const y = ay + dy;
      let x = ax;
      while (w.isRevealed(w.idx(x + 1, y))) x++;
      if (!w.canPlace('belt', x, y).ok) continue;
      found = true;
      expect(w.canPlace('belt', x + 1, y).reason).toContain('모르는 땅');
      const before = w.revealedCount;
      expect(w.place('belt', x, y, 0)).not.toBeNull();
      expect(w.revealedCount).toBe(before);
      expect(w.canPlace('belt', x + 1, y).reason).toContain('모르는 땅');
    }
    expect(found).toBe(true);
  });

  it('메인 목표는 지도를 열지 않고, 시작 초원의 지역 과제 셋 중 둘을 이루면 눈밭 주석과 조립 부지가 길과 함께 열린다', () => {
    const w = generateRegionalWorld(11);
    const [ax, ay] = w.sites.A;
    const [bx, by] = w.sites.B;
    for (const id of ['MG01', 'MG02', 'MG03', 'MG04', 'MG05', 'MG06']) w.goals.add(id);
    w.stats.delivered = 20;
    const before = w.revealedCount;
    evaluateGoals(w);
    expect(w.goals.has('MG07')).toBe(true);
    expect(w.revealedCount).toBe(before);
    w.stats.made.set('iron-plate', 100);
    evaluateGoals(w);
    expect(w.challenges.has('R1a')).toBe(true);
    expect(w.revealedCount).toBe(before); // 셋 중 하나로는 아직
    w.stats.made.set('log', 50);
    expect(evaluateGoals(w)).toContain('stage:R1');
    expect(w.revealedCount).toBeGreaterThan(before);
    expect(w.isRevealed(w.idx(bx, by))).toBe(true);
    expect(w.isRevealed(w.idx(...w.sites.H))).toBe(true);
    expect(revealedPath(w, [ax, ay], [bx, by])).toBe(true);
    // 아직 모래사막(원유)은 아니다
    expect(w.isRevealed(w.idx(...w.sites.D))).toBe(false);
  });

  it('마지막 지역 과제를 마치면 지도 전체, 지역은 차례대로만 판정한다', () => {
    const w = generateRegionalWorld(3);
    // 아직 시작 초원인데 뒤 지역 과제 조건을 채워도 기록하지 않는다
    w.stats.made.set('sulfur', 100);
    evaluateGoals(w);
    expect(w.challenges.has('R5a')).toBe(false);
    expect(w.revealSites(['*'])).toEqual(['지도 전체']);
    expect(w.revealedCount).toBe(w.width * w.height);
  });

  it('저장·불러오기 뒤에도 같은 땅이 보이고, 예전 지도는 모두 보인다', () => {
    const w = generateRegionalWorld(5);
    w.revealSites(['B', 'H']);
    const back = World.deserialize(JSON.parse(JSON.stringify(w.serialize())));
    expect(back.revealedCount).toBe(w.revealedCount);
    expect([...back.revealed!]).toEqual([...w.revealed!]);
    expect(back.sites).toEqual(w.sites);
    expect(back.checksum()).toBe(w.checksum());
    const legacy = new World(10, 10);
    expect(legacy.isRevealed(0)).toBe(true);
    expect(legacy.revealSites(['B'])).toEqual([]);
  });
});
