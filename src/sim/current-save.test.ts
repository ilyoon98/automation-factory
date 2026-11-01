import { describe, expect, it } from 'vitest';
import { World } from './world';
import { CURRENT_SAVE_KEY, PREVIOUS_SAVE_KEY, loadCurrentSave } from './current-save';

function saved(regional: boolean, seed: number) {
  const w = new World(10, 10); w.createHub(0, 0); w.seed = seed;
  if (regional) w.rules = 'regional-v1';
  return JSON.stringify(w.serialize());
}
function storage(entries: Record<string, string>) { return { getItem: (k: string) => entries[k] ?? null }; }

describe('신맵 자동 이어하기', () => {
  it('구맵 저장은 자동으로 열지 않고 원본을 변경하지 않는다', () => {
    const data = { [PREVIOUS_SAVE_KEY]: saved(false, 3) };
    const before = { ...data };
    expect(loadCurrentSave(storage(data))).toBeNull();
    expect(data).toEqual(before);
  });
  it('이전 버전으로 저장한 신맵 공장은 이어서 한다', () => {
    expect(loadCurrentSave(storage({ [PREVIOUS_SAVE_KEY]: saved(true, 4) }))?.seed).toBe(4);
  });
  it('신규 슬롯에 저장한 신맵을 이전 저장보다 우선한다', () => {
    expect(loadCurrentSave(storage({ [CURRENT_SAVE_KEY]: saved(true, 5), [PREVIOUS_SAVE_KEY]: saved(true, 4) }))?.seed).toBe(5);
  });
  it('새 슬롯이 손상돼도 이전 신맵 저장을 찾는다', () => {
    expect(loadCurrentSave(storage({ [CURRENT_SAVE_KEY]: '{', [PREVIOUS_SAVE_KEY]: saved(true, 4) }))?.seed).toBe(4);
  });
});
