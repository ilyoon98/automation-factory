import { describe, expect, it } from 'vitest';
import { World } from '../sim/world';
import { GUIDE, findTarget } from './guide';

describe('목표 따라하기', () => {
  it('목표마다 반짝일 대상이 있고, 제목은 겹치지 않는다', () => {
    expect(GUIDE.every((s) => s.focus)).toBe(true);
    expect(new Set(GUIDE.map((s) => s.title)).size).toBe(GUIDE.length);
  });

  it('놓을 곳: 허브에서 가장 가까운 빈 광맥 칸 (건물이 깔린 칸은 빼고), 없으면 null', () => {
    const w = new World(30, 30);
    w.createHub(0, 9);
    expect(findTarget(w, 'coal')).toBeNull();
    w.setResource(20, 10, 'iron-ore', 100);
    w.setResource(6, 10, 'iron-ore', 100);
    expect(findTarget(w, 'iron-ore')).toMatchObject({ x: 6.5, y: 10.5, label: '철광맥' });
    w.place('miner', 6, 10, 1, true);
    expect(findTarget(w, 'iron-ore')).toMatchObject({ x: 20.5, y: 10.5 });
    expect(findTarget(w, 'hub')).toMatchObject({ x: 1.5, y: 10.5 });
  });
});
