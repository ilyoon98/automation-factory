import { describe, expect, it } from 'vitest';
import { PICKUP_DURATION, PICKUP_LIMIT, PickupFeedback, pickupSample } from './pickup-feedback';

describe('회수 아이템 모으기 효과', () => {
  it('회수한 더미당 한 효과만 만들고 대량 회수 장식은 24개 아이콘으로 제한한다', () => {
    const feedback = new PickupFeedback(), world = {};
    feedback.add(world, [{ tile: 0, item: 'iron-plate' }, { tile: 0, item: 'coal' },
      ...Array.from({ length: 1000 }, (_, tile) => ({ tile, item: 'iron-plate' as const }))], 5);
    const effects = feedback.active(world, 5);
    expect(effects).toHaveLength(PICKUP_LIMIT);
    expect(new Set(effects.map(e => e.tile)).size).toBe(PICKUP_LIMIT);
    expect(effects[0].item).toBe('iron-plate');
    expect(effects.flatMap(e => pickupSample(e, 5).offsets)).toHaveLength(24);
  });

  it('실제 시간 0.48초 뒤 만료되며 새 회수에 자리를 내준다', () => {
    const feedback = new PickupFeedback(), world = {};
    feedback.add(world, [{ tile: 3, item: 'coal' }], 0);
    expect(feedback.active(world, PICKUP_DURATION - 0.01)).toHaveLength(1);
    expect(feedback.active(world, PICKUP_DURATION)).toHaveLength(0);
    feedback.add(world, [{ tile: 7, item: 'iron-plate' }], 3);
    expect(feedback.active(world, 3).map(e => e.tile)).toEqual([7]);
  });

  it('공장 전환·탭 복귀 초기화·효과 줄이기로 예전 장식을 재생하지 않는다', () => {
    const feedback = new PickupFeedback(), first = {}, next = {};
    const sources = [{ tile: 3, item: 'coal' as const }];
    feedback.add(first, sources, 0);
    expect(feedback.active(next, 0.1)).toHaveLength(0);
    feedback.add(next, sources, 0.1);
    feedback.clear();
    expect(feedback.active(next, 0.2)).toHaveLength(0);
    feedback.add(next, sources, 0.2, false);
    expect(feedback.active(next, 0.2)).toHaveLength(0);
    feedback.add(next, sources, 0.2);
    expect(feedback.active(next, 0.3, false)).toHaveLength(0);
    expect(feedback.active(next, 0.3, true)).toHaveLength(0);
  });

  it('아이콘이 픽셀 단위로 중심에 모이고 마지막에만 반짝이며 사라진다', () => {
    const effect = { tile: 2, item: 'iron-plate' as const, born: 0 };
    const start = pickupSample(effect, 0), middle = pickupSample(effect, 0.2), end = pickupSample(effect, 0.4);
    expect(start.offsets[0]).toEqual({ x: -6, y: -5 });
    expect(Math.abs(middle.offsets[0].x)).toBeLessThan(Math.abs(start.offsets[0].x));
    expect(end.offsets.every(p => p.x === 0 && p.y === 0)).toBe(true);
    expect(start.sparkle).toBe(false); expect(end.sparkle).toBe(true);
    expect(end.alpha).toBeLessThan(1);
    expect(pickupSample(effect, PICKUP_DURATION).alpha).toBe(0);
  });
});
