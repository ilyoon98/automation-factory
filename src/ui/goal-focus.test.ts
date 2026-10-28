import { describe, expect, it } from 'vitest';
import { MAIN_GOAL_BY_ID } from '../sim/goals';
import { generateRegionalWorld } from '../sim/regional-map';
import { goalFocus } from './goal-focus';

describe('메인 목표의 다음 할 일 반짝임', () => {
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
