import { describe, expect, it } from 'vitest';
import { ITEM_IDS } from '../data/items';
import type { Status } from '../sim/building';
import { TICK_RATE, World } from '../sim/world';
import { getProductionDiagnostic } from './production-diagnostics';

function setup() {
  const w = new World(40, 40);
  w.createHub(0, 0);
  for (const item of ITEM_IDS) w.stock.set(item, 1000);
  w.applyTech('forestry');
  return w;
}

describe('산림 생산 원인 표시', () => {
  it('심을 땅과 나무가 없는 빈 숲을 구분하고 실제 묘목 부족만 경고한다', () => {
    const w = setup();
    const planter = w.place('planter', 15, 15, 0)!;
    w.tick();
    expect(planter.status).toBe('no-input');
    expect(getProductionDiagnostic(w, planter)).toMatchObject({ label: '묘목 부족', item: 'sapling', severity: 'warning' });

    const tile = planter.mineTiles[0];
    w.setTree(tile % w.width, Math.floor(tile / w.width), 0.2);
    expect(getProductionDiagnostic(w, planter)).toMatchObject({ label: '묘목 대기', severity: 'waiting' });

    for (const i of planter.mineTiles) w.setTree(i % w.width, Math.floor(i / w.width), 0.2);
    expect(getProductionDiagnostic(w, planter)).toEqual({ label: '숲 성장 대기', severity: 'waiting' });
    for (const i of planter.mineTiles) w.tree[i] = 1;
    expect(getProductionDiagnostic(w, planter)).toEqual({ label: '벌목 대기', severity: 'waiting' });
  });

  it('건물·광맥 때문에 심을 땅이 없는 경우는 묘목 부족으로 안내하지 않는다', () => {
    const w = setup();
    const planter = w.place('planter', 15, 15, 0)!;
    for (const i of planter.mineTiles) w.setResource(i % w.width, Math.floor(i / w.width), 'iron-ore', 100);
    w.tick();
    expect(getProductionDiagnostic(w, planter)).toEqual({ label: '심을 땅 없음', severity: 'waiting' });
  });

  it.each<Status>(['working', 'low-power', 'no-power', 'idle'])('묘목이 없어도 %s 상태를 덮어쓰지 않는다', status => {
    const w = setup();
    const planter = w.place('planter', 15, 15, 0)!;
    planter.status = status;
    expect(getProductionDiagnostic(w, planter)).toBeNull();
  });

  it('묘목을 방금 보충한 뒤에는 이전 부족 상태로 경고하지 않는다', () => {
    const w = setup();
    const planter = w.place('planter', 15, 15, 0)!;
    w.tick();
    planter.inBuf.set('sapling', 1);
    expect(getProductionDiagnostic(w, planter)).toBeNull();
  });

  it.each([
    { drain: 'wood', label: '톱밥 적체', item: 'sawdust' },
    { drain: 'sawdust', label: '목재 적체', item: 'wood' },
    { drain: null, label: '목재·톱밥 적체', item: undefined },
  ] as const)('제재소 출력에서 실제로 막힌 품목을 표시한다: $label', ({ drain, label, item }) => {
    const w = setup();
    const mill = w.place('sawmill', 15, 15, 0)!;
    expect(w.setRecipe(mill, 'saw')).toBe(true);
    mill.inBuf.set('log', 5);
    for (let i = 0; i < 5 * TICK_RATE; i++) {
      if (drain) mill.outBuf.delete(drain);
      w.tick();
    }
    expect(mill.status).toBe('output-full');
    expect(getProductionDiagnostic(w, mill)).toMatchObject({ label, item, severity: 'warning' });
    const before = w.stats.made.get('wood');
    // 두 산출물 모두 비우면 다음 제작을 시작하므로, 예전 적체 표시도 즉시 해제한다.
    mill.outBuf.clear();
    expect(getProductionDiagnostic(w, mill)).toBeNull();
    for (let i = 0; i < 2.1 * TICK_RATE; i++) w.tick();
    expect(w.stats.made.get('wood')).toBeGreaterThan(before!);
  });

  it('톱밥이 있어도 작업 중이거나 전력이 없으면 적체를 원인으로 지목하지 않는다', () => {
    const w = setup();
    const mill = w.place('sawmill', 15, 15, 0)!;
    expect(w.setRecipe(mill, 'saw')).toBe(true);
    mill.outBuf.set('sawdust', 2);
    for (const status of ['working', 'no-power', 'low-power'] as const) {
      mill.status = status;
      expect(getProductionDiagnostic(w, mill)).toBeNull();
    }
  });
});
