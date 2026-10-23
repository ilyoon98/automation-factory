import type { ItemId, ItemStack } from './items';

/** 레시피를 쓰는 기계 */
export type MachineKind = 'smelter' | 'assembler' | 'crusher' | 'washer' | 'separator' | 'electric-furnace' | 'sawmill';

export interface Recipe {
  id: string;
  name: string;
  machine: MachineKind;
  /** 1회 제작 시간 (초) */
  time: number;
  inputs: ItemStack[];
  /** 1회 제작 결과. pattern이 있으면 1회당 평균 개수 (예: 0.7) */
  outputs: ItemStack[];
  /** 있으면 제작할 때마다 이 순서대로 하나씩 나온다 (분리기) */
  pattern?: ItemId[];
}

export const RECIPES: Record<string, Recipe> = {
  'iron-plate': {
    id: 'iron-plate',
    name: '철판',
    machine: 'smelter',
    time: 2,
    inputs: [{ item: 'iron-ore', count: 1 }],
    outputs: [{ item: 'iron-plate', count: 1 }],
  },
  'copper-plate': {
    id: 'copper-plate',
    name: '구리판',
    machine: 'smelter',
    time: 2,
    inputs: [{ item: 'copper-ore', count: 1 }],
    outputs: [{ item: 'copper-plate', count: 1 }],
  },
  steel: {
    id: 'steel',
    name: '강철',
    machine: 'smelter',
    time: 5,
    inputs: [
      { item: 'iron-plate', count: 2 },
      { item: 'coal', count: 1 },
    ],
    outputs: [{ item: 'steel', count: 1 }],
  },
  gear: {
    id: 'gear',
    name: '기어',
    machine: 'assembler',
    time: 3,
    inputs: [{ item: 'iron-plate', count: 2 }],
    outputs: [{ item: 'gear', count: 1 }],
  },
  'copper-wire': {
    id: 'copper-wire',
    name: '구리선',
    machine: 'assembler',
    time: 1.5,
    inputs: [{ item: 'copper-plate', count: 1 }],
    outputs: [{ item: 'copper-wire', count: 2 }],
  },
  circuit: {
    id: 'circuit',
    name: '회로',
    machine: 'assembler',
    time: 4,
    inputs: [
      { item: 'iron-plate', count: 1 },
      { item: 'copper-wire', count: 3 },
    ],
    outputs: [{ item: 'circuit', count: 1 }],
  },

  // ───── M7: 흙에서 금속 얻기 ─────
  'crush-dirt': {
    id: 'crush-dirt',
    name: '흙 분쇄',
    machine: 'crusher',
    time: 2,
    inputs: [{ item: 'dirt', count: 2 }],
    outputs: [
      { item: 'gravel', count: 1 },
      { item: 'sand', count: 1 },
    ],
  },
  'crush-gravel': {
    id: 'crush-gravel',
    name: '자갈 분쇄',
    machine: 'crusher',
    time: 1.5,
    inputs: [{ item: 'gravel', count: 1 }],
    outputs: [{ item: 'sand', count: 1 }],
  },
  'crush-stone': {
    id: 'crush-stone',
    name: '돌 분쇄',
    machine: 'crusher',
    time: 2,
    inputs: [{ item: 'stone', count: 1 }],
    outputs: [{ item: 'gravel', count: 2 }],
  },
  wash: {
    id: 'wash',
    name: '모래 세척',
    machine: 'washer',
    time: 3,
    inputs: [
      { item: 'sand', count: 3 },
      { item: 'water', count: 2 },
    ],
    outputs: [
      { item: 'mineral-dust', count: 1 },
      { item: 'mud', count: 1 },
    ],
  },
  separate: {
    id: 'separate',
    name: '광물 분리',
    machine: 'separator',
    time: 4,
    inputs: [{ item: 'mineral-dust', count: 1 }],
    outputs: [
      { item: 'iron-concentrate', count: 0.7 },
      { item: 'copper-concentrate', count: 0.2 },
      { item: 'slag', count: 0.1 },
    ],
    // 10개마다 철 7 · 구리 2 · 슬래그 1, 한쪽으로 몰리지 않게 섞은 순서
    pattern: [
      'iron-concentrate',
      'iron-concentrate',
      'copper-concentrate',
      'iron-concentrate',
      'iron-concentrate',
      'slag',
      'iron-concentrate',
      'copper-concentrate',
      'iron-concentrate',
      'iron-concentrate',
    ],
  },
  'iron-plate-c': {
    id: 'iron-plate-c',
    name: '철판 (정광)',
    machine: 'smelter',
    time: 2,
    inputs: [{ item: 'iron-concentrate', count: 1 }],
    outputs: [{ item: 'iron-plate', count: 1 }],
  },
  'copper-plate-c': {
    id: 'copper-plate-c',
    name: '구리판 (정광)',
    machine: 'smelter',
    time: 2,
    inputs: [{ item: 'copper-concentrate', count: 1 }],
    outputs: [{ item: 'copper-plate', count: 1 }],
  },
  brick: {
    id: 'brick',
    name: '벽돌',
    machine: 'smelter',
    time: 3,
    inputs: [{ item: 'mud', count: 2 }],
    outputs: [{ item: 'brick', count: 1 }],
  },
  concrete: {
    id: 'concrete',
    name: '콘크리트',
    machine: 'assembler',
    time: 3,
    inputs: [
      { item: 'slag', count: 2 },
      { item: 'gravel', count: 1 },
    ],
    outputs: [{ item: 'concrete', count: 1 }],
  },

  // ───── 석탄 독립 ─────
  'steel-e': {
    id: 'steel-e',
    name: '강철 (전기로)',
    machine: 'electric-furnace',
    time: 5,
    inputs: [{ item: 'iron-plate', count: 2 }],
    outputs: [{ item: 'steel', count: 1 }],
  },

  // ───── 숲·나무 ─────
  saw: {
    id: 'saw',
    name: '목재',
    machine: 'sawmill',
    time: 2,
    inputs: [{ item: 'log', count: 1 }],
    outputs: [
      { item: 'wood', count: 2 },
      { item: 'sawdust', count: 1 },
    ],
  },
  charcoal: {
    id: 'charcoal',
    name: '숯',
    machine: 'smelter',
    time: 3,
    inputs: [{ item: 'log', count: 2 }],
    outputs: [{ item: 'charcoal', count: 1 }],
  },
  'steel-charcoal': {
    id: 'steel-charcoal',
    name: '강철 (숯)',
    machine: 'smelter',
    time: 5,
    inputs: [
      { item: 'iron-plate', count: 2 },
      { item: 'charcoal', count: 1 },
    ],
    outputs: [{ item: 'steel', count: 1 }],
  },
};

export function recipesFor(machine: MachineKind): Recipe[] {
  return Object.values(RECIPES).filter((r) => r.machine === machine);
}
