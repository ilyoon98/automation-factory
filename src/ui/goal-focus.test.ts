import { describe, expect, it } from 'vitest';
import { MAIN_GOAL_BY_ID } from '../sim/goals';
import { generateRegionalWorld } from '../sim/regional-map';
import { goalFocus } from './goal-focus';
import { findTarget } from './guide';
import { World } from '../sim/world';

describe('메인 목표의 다음 할 일 반짝임', () => {
  it('신맵의 첫 목표는 철광맥, 채굴기 설치 뒤에는 허브를 안내한다', () => {
    const w = generateRegionalWorld(3);
    expect(goalFocus(w, MAIN_GOAL_BY_ID.MG01)).toEqual({ build: 'miner', target: 'iron-ore' });
    const mark = findTarget(w, 'iron-ore')!;
    expect(mark).not.toBeNull();
    let built = false;
    for (const dx of [-1, 0]) for (const dy of [-1, 0]) {
      if (!built) built = !!w.place('miner', Math.floor(mark.x) + dx, Math.floor(mark.y) + dy, 0);
    }
    expect(built).toBe(true);
    expect(goalFocus(w, MAIN_GOAL_BY_ID.MG01)).toEqual({ build: 'belt', target: 'hub' });
  });

  it('숨겨진 자원과 고갈된 자원을 안내 위치로 쓰지 않는다', () => {
    const w = new World(20, 20); w.createHub(0, 0);
    w.revealed = new Uint8Array(400);
    w.setResource(5, 5, 'iron-ore', 0); w.revealed[w.idx(5, 5)] = 1;
    w.setResource(6, 6, 'iron-ore', 100);
    expect(findTarget(w, 'iron-ore')).toBeNull();
    w.revealed[w.idx(6, 6)] = 1;
    expect(findTarget(w, 'iron-ore')).toMatchObject({ x: 6.5, y: 6.5 });
  });
  it('MG03: 연구 전에는 그 연구, 연구 뒤 조립기가 없으면 조립기, 조립기가 있으면 없음', () => {
    const w = generateRegionalWorld(3);
    const g = MAIN_GOAL_BY_ID.MG03;
    expect(goalFocus(w, g)).toEqual({ research: 'automation' });
    w.applyTech('automation');
    expect(goalFocus(w, g)).toEqual({ build: 'assembler' });
    w.stock.set('iron-plate', 100);
    const [hx, hy] = w.sites.A;
    let placed = false;
    for (let r = 4; r < 30 && !placed; r++) for (let dx = -r; dx <= r && !placed; dx++) placed = !!w.place('assembler', hx + dx, hy + r, 0);
    expect(placed).toBe(true);
    expect(goalFocus(w, g)).toBeNull();
  });
});
