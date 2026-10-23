import { describe, expect, it } from 'vitest';
import type { Blueprint } from '../sim/blueprint';
import { blueprintCode, parseBlueprintCode } from './blueprints';

describe('청사진 공유 코드', () => {
  const bp: Blueprint = {
    w: 6,
    h: 4,
    entries: [
      { type: 'assembler', dx: 0, dy: 0, dir: 1, recipe: 'gear', filter: null },
      { type: 'sorter', dx: 3, dy: 0, dir: 2, recipe: null, filter: 'coal' },
      { type: 'station', dx: 0, dy: 3, dir: 0, recipe: null, filter: null, mode: 'unload' },
      { type: 'belt', dx: 1, dy: 3, dir: 1, recipe: null, filter: null },
    ],
  };

  it('코드로 바꿨다 되돌리면 이름·건물·방향·레시피·아이템·정류장 종류가 그대로', async () => {
    const code = await blueprintCode('기어 공장', bp);
    expect(code.startsWith('AF1.')).toBe(true);
    expect(code).not.toMatch(/[\s+/=]/);
    const got = await parseBlueprintCode(`  ${code}\n`);
    expect(got).toEqual({ name: '기어 공장', bp });
  });

  it('코드가 아니거나 잘렸으면 null, 모르는 건물은 뺀다', async () => {
    expect(await parseBlueprintCode('안녕')).toBeNull();
    const code = await blueprintCode('x', bp);
    expect(await parseBlueprintCode(code.slice(0, 20))).toBeNull();
    const odd = await blueprintCode('x', { w: 2, h: 2, entries: [{ ...bp.entries[0], type: 'rocket' as never }, bp.entries[3]] });
    expect((await parseBlueprintCode(odd))!.bp.entries.map((e) => e.type)).toEqual(['belt']);
  });
});