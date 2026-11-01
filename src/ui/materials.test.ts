import { expect, it } from 'vitest';
import { Building } from '../sim/building';
import { RECIPES } from '../data/recipes';
import { materialReadiness } from './materials';

it('철판이 없고 구리선이 대기할 때 철판만 부족으로 구분한다', () => {
  const b = new Building(1, 'assembler', 0, 0, 0);
  b.inBuf.set('copper-wire', 6);
  expect(materialReadiness(b, RECIPES.circuit.inputs)).toEqual([
    { item: 'iron-plate', count: 1, stored: 0, missing: 1 },
    { item: 'copper-wire', count: 3, stored: 6, missing: 0 },
  ]);
});

it('제작 중 재료는 이미 소비됐으므로 다음 제작의 준비량만 계산한다', () => {
  const b = new Building(1, 'assembler', 0, 0, 0);
  b.crafting = true;
  b.inBuf.set('iron-plate', 1);
  b.inBuf.set('copper-wire', 2);
  expect(materialReadiness(b, RECIPES.circuit.inputs).map(i => i.missing)).toEqual([0, 1]);
});
