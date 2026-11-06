import { describe, expect, it } from 'vitest';
import { ChangeFlash } from './ui-motion';

describe('허브 재고 증감 표시 (ChangeFlash)', () => {
  const world = {};

  it('처음 보는 값은 표시하지 않고, 늘면 up·줄면 down을 잠깐 보인다', () => {
    const f = new ChangeFlash<string>();
    expect(f.mark(world, [['iron', 10]], 0, true).size).toBe(0);
    expect(f.mark(world, [['iron', 15]], 100, true).get('iron')).toBe('up');
    expect(f.mark(world, [['iron', 15]], 500, true).get('iron')).toBe('up');
    expect(f.mark(world, [['iron', 15]], 700, true).has('iron')).toBe(false);
  });

  it('계속 바뀌어도 2초에 한 번만 다시 표시한다 (내내 깜빡이지 않게)', () => {
    const f = new ChangeFlash<string>();
    f.mark(world, [['coal', 10]], 0, true);
    expect(f.mark(world, [['coal', 11]], 100, true).get('coal')).toBe('up');
    expect(f.mark(world, [['coal', 12]], 800, true).has('coal')).toBe(false);
    expect(f.mark(world, [['coal', 5]], 1500, true).has('coal')).toBe(false);
    expect(f.mark(world, [['coal', 4]], 2200, true).get('coal')).toBe('down');
  });

  it('효과 줄이기면 표시하지 않고, 다른 공장으로 바뀌면 처음부터 센다', () => {
    const f = new ChangeFlash<string>();
    f.mark(world, [['stone', 10]], 0, false);
    expect(f.mark(world, [['stone', 20]], 100, false).size).toBe(0);
    expect(f.mark({}, [['stone', 99]], 3000, true).size).toBe(0);
  });
});
