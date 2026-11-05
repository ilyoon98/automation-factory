import { describe, expect, it } from 'vitest';
import { CURRENT_SAVE_KEY, PREVIOUS_SAVE_KEY } from './current-save';
import { SaveSlots } from './save-slots';
import { World } from './world';

function world(seed: number, regional = true) {
  const w = new World(10, 10); w.createHub(0, 0); w.seed = seed;
  if (regional) w.rules = 'regional-v1';
  return w;
}
function store(entries: Record<string, string> = {}) {
  return {
    entries,
    getItem: (k: string) => entries[k] ?? null,
    setItem: (k: string, v: string) => { entries[k] = v; },
    removeItem: (k: string) => { delete entries[k]; },
  };
}
let clock = 1000;
const slots = (s: ReturnType<typeof store>) => new SaveSlots(s, CURRENT_SAVE_KEY, [PREVIOUS_SAVE_KEY], () => ++clock);

describe('여러 공장 저장', () => {
  it('예전 한 칸 저장은 데이터를 옮기지 않고 1번 공장이 된다', () => {
    const s = store({ [CURRENT_SAVE_KEY]: JSON.stringify(world(5).serialize()) });
    const before = s.entries[CURRENT_SAVE_KEY];
    const list = slots(s).list();
    expect(list).toMatchObject([{ id: 1, name: '공장 1', key: CURRENT_SAVE_KEY, day: 1, sites: 1 }]);
    expect(slots(s).loadActive()?.seed).toBe(5);
    expect(s.entries[CURRENT_SAVE_KEY]).toBe(before);
  });

  it('구맵 저장만 있으면 목록에 넣지 않는다', () => {
    const s = store({ [PREVIOUS_SAVE_KEY]: JSON.stringify(world(3, false).serialize()) });
    expect(slots(s).list()).toEqual([]);
    expect(slots(s).loadActive()).toBeNull();
  });

  it('새 공장은 새 칸에 저장하고 이전 공장은 목록에 남는다', () => {
    const s = store({ [CURRENT_SAVE_KEY]: JSON.stringify(world(5).serialize()) });
    const ss = slots(s);
    const made = ss.create();
    expect(made).toMatchObject({ id: 2, name: '공장 2' });
    ss.save(world(9));
    expect(ss.activeId).toBe(2);
    expect(ss.load(1)?.seed).toBe(5);
    expect(ss.load(2)?.seed).toBe(9);
    expect(ss.list().map(x => x.id)).toEqual([2, 1]);
  });

  it('처음 켠 PC는 첫 저장에서 칸을 만든다', () => {
    const s = store();
    const ss = slots(s);
    expect(ss.loadActive()).toBeNull();
    ss.save(world(7));
    expect(ss.list()).toMatchObject([{ id: 1, name: '공장 1', key: CURRENT_SAVE_KEY }]);
    expect(slots(s).loadActive()?.seed).toBe(7);
  });

  it('이름을 바꾸고, 지금 공장이 아닌 공장만 지운다', () => {
    const s = store({ [CURRENT_SAVE_KEY]: JSON.stringify(world(5).serialize()) });
    const ss = slots(s);
    ss.create(); ss.save(world(9));
    ss.rename(1, '  철판 공장  ');
    ss.rename(1, '   ');
    expect(ss.list().find(x => x.id === 1)?.name).toBe('철판 공장');
    expect(ss.remove(2)).toBe(false);
    expect(ss.remove(1)).toBe(true);
    expect(s.entries[CURRENT_SAVE_KEY]).toBeUndefined();
    expect(ss.list().map(x => x.id)).toEqual([2]);
  });

  it('마지막 공장을 못 읽으면 남은 공장 중 최근 것을 이어 한다', () => {
    const s = store({ [CURRENT_SAVE_KEY]: JSON.stringify(world(5).serialize()) });
    const ss = slots(s);
    ss.create(); ss.save(world(9));
    s.entries[`${CURRENT_SAVE_KEY}/slot-2`] = '{';
    expect(ss.loadActive()?.seed).toBe(5);
    expect(ss.activeId).toBe(1);
  });
});
