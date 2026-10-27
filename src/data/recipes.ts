import type { ItemId, ItemStack } from './items';

/** 레시피를 쓰는 기계 */
export type MachineKind =
  | 'smelter'
  | 'assembler'
  | 'crusher'
  | 'washer'
  | 'separator'
  | 'electric-furnace'
  | 'sawmill'
  | 'chem-reactor'
  | 'refinery'
  | 'electrolyzer'
  | 'large-assembler';

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
  paper: {
    id: 'paper',
    name: '종이',
    machine: 'washer',
    time: 2,
    inputs: [
      { item: 'sawdust', count: 2 },
      { item: 'water', count: 1 },
    ],
    outputs: [{ item: 'paper', count: 1 }],
  },

  // ───── 지역 생산망 확장 P01~P23 (regional-v1 연구로만 열린다) ─────
  'tin-plate': r('tin-plate', '주석판', 'smelter', 2, { 'tin-ore': 1 }, { 'tin-plate': 1 }),
  bronze: r('bronze', '청동', 'smelter', 4, { 'copper-plate': 3, 'tin-plate': 1 }, { bronze: 4 }),
  'bronze-drive': r('bronze-drive', '청동 구동부', 'assembler', 3, { bronze: 2, gear: 1 }, { 'bronze-drive': 1 }),
  rubber: r('rubber', '고무', 'chem-reactor', 3, { sap: 2 }, { rubber: 1 }),
  'insulated-wire': r('insulated-wire', '절연 전선', 'assembler', 2, { 'copper-wire': 2, rubber: 1 }, { 'insulated-wire': 2 }),
  motor: r('motor', '절연 모터', 'assembler', 6, { 'bronze-drive': 1, 'insulated-wire': 4, 'iron-plate': 2 }, { motor: 1 }),
  plastic: r('plastic', '플라스틱', 'refinery', 4, { 'crude-oil': 3, water: 1 }, { plastic: 2 }),
  'adv-circuit': r('adv-circuit', '고급 회로', 'assembler', 6, { circuit: 2, plastic: 2, 'tin-plate': 1 }, { 'adv-circuit': 1 }),
  controller: r('controller', '산업 제어기', 'assembler', 8, { 'adv-circuit': 2, 'insulated-wire': 4, 'bronze-drive': 1 }, { controller: 1 }),
  'aluminum-plate': r('aluminum-plate', '알루미늄판', 'electrolyzer', 6, { bauxite: 2, water: 1 }, { 'aluminum-plate': 1 }),
  frame: r('frame', '경량 프레임', 'assembler', 6, { 'aluminum-plate': 4, steel: 2, bronze: 2 }, { frame: 1 }),
  'hardened-rubber': r('hardened-rubber', '강화 고무', 'chem-reactor', 4, { rubber: 3, sulfur: 1 }, { 'hardened-rubber': 3 }),
  tire: r('tire', '강화 타이어', 'assembler', 4, { 'hardened-rubber': 2, steel: 1 }, { tire: 2 }),
  'sulfuric-acid': r('sulfuric-acid', '황산', 'chem-reactor', 4, { sulfur: 1, water: 2 }, { 'sulfuric-acid': 2 }),
  'acid-wash': r('acid-wash', '고효율 모래 세척', 'washer', 4, { sand: 3, water: 2, 'sulfuric-acid': 1 }, { 'mineral-dust': 2, mud: 1 }),
  lithium: r('lithium', '리튬', 'electrolyzer', 6, { brine: 4, water: 2 }, { lithium: 1 }),
  'battery-pack': r('battery-pack', '배터리 팩', 'assembler', 6, { lithium: 2, 'copper-plate': 2, circuit: 1, plastic: 1 }, { 'battery-pack': 1 }),
  'hc-cable': r('hc-cable', '고용량 케이블', 'assembler', 4, { 'aluminum-plate': 2, 'insulated-wire': 2, 'hardened-rubber': 1 }, { 'hc-cable': 2 }),
  lubricant: r('lubricant', '윤활유', 'refinery', 3, { 'crude-oil': 2 }, { lubricant: 1 }),
  fuel: r('fuel', '정유 연료', 'refinery', 3, { 'crude-oil': 2 }, { fuel: 2 }),
  'adv-lubricant': r('adv-lubricant', '고급 윤활제', 'chem-reactor', 6, { lubricant: 2, lithium: 1 }, { 'adv-lubricant': 3 }),
  'truck-kit': r(
    'truck-kit',
    '고급 트럭 조립품',
    'large-assembler',
    20,
    { frame: 2, motor: 2, tire: 4, 'battery-pack': 4, controller: 2 },
    { 'truck-kit': 1 },
  ),
  module: r(
    'module',
    '자동화 설비 모듈',
    'large-assembler',
    30,
    { frame: 2, motor: 4, controller: 2, 'hc-cable': 4, 'battery-pack': 2, 'adv-lubricant': 2 },
    { module: 1 },
  ),
};

/** 레시피를 짧게 적는다 (재료·결과를 { 아이템: 개수 }로) */
function r(
  id: string,
  name: string,
  machine: MachineKind,
  time: number,
  inputs: Partial<Record<ItemId, number>>,
  outputs: Partial<Record<ItemId, number>>,
): Recipe {
  const stacks = (o: Partial<Record<ItemId, number>>) => Object.entries(o).map(([item, count]) => ({ item: item as ItemId, count: count! }));
  return { id, name, machine, time, inputs: stacks(inputs), outputs: stacks(outputs) };
}

export function recipesFor(machine: MachineKind): Recipe[] {
  return Object.values(RECIPES).filter((r) => r.machine === machine);
}
