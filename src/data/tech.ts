import type { BuildingType } from './buildings';
import type { ItemStack } from './items';

/** 연구 창의 탭 (endless = 끝없는 연구, TECHS가 아니라 ENDLESS_TECHS) */
export type TechCategory = 'production' | 'logistics' | 'power' | 'resources' | 'endless';

export const TECH_CATEGORIES: { id: TechCategory; name: string; icon: string }[] = [
  { id: 'production', name: '생산', icon: '⚙️' },
  { id: 'logistics', name: '물류', icon: '🚚' },
  { id: 'power', name: '전력', icon: '⚡' },
  { id: 'resources', name: '자원', icon: '⛏️' },
  { id: 'endless', name: '끝없는', icon: '📈' },
];

export interface Tech {
  id: string;
  name: string;
  /** 연구 카드에 붙는 이모지 */
  icon: string;
  category: TechCategory;
  description: string;
  cost: ItemStack[];
  requires: string[];
  unlockBuildings?: BuildingType[];
  unlockRecipes?: string[];
  /** 채굴기를 광맥이 없는 빈 땅에 놓으면 흙을 캔다 */
  dirtMining?: boolean;
}

export const INITIAL_BUILDINGS: BuildingType[] = ['belt', 'underground', 'miner', 'smelter', 'splitter', 'merger'];
export const INITIAL_RECIPES: string[] = ['iron-plate', 'copper-plate'];

export const TECHS: Tech[] = [
  {
    id: 'automation',
    icon: '⚙️',
    category: 'production',
    name: '조립 자동화',
    description: '조립기와 기어 레시피',
    cost: [{ item: 'iron-plate', count: 40 }],
    requires: [],
    unlockBuildings: ['assembler'],
    unlockRecipes: ['gear'],
  },
  {
    id: 'logistics',
    icon: '🔀',
    category: 'logistics',
    name: '물류',
    description: '우선 분배기 (잉여를 옆으로 넘기기), 스마트 분류기 (섞인 아이템 나누기)',
    cost: [
      { item: 'iron-plate', count: 100 },
      { item: 'gear', count: 50 },
    ],
    requires: ['automation'],
    unlockBuildings: ['overflow', 'sorter'],
  },
  {
    id: 'storage',
    icon: '📦',
    category: 'logistics',
    name: '보관',
    description: '창고와 하역기 (허브·창고에서 아이템 꺼내기)',
    cost: [
      { item: 'iron-plate', count: 150 },
      { item: 'gear', count: 60 },
    ],
    requires: ['automation'],
    unlockBuildings: ['storage', 'unloader'],
  },
  {
    id: 'copper-working',
    icon: '🧵',
    category: 'production',
    name: '구리 가공',
    description: '구리선 레시피',
    cost: [{ item: 'copper-plate', count: 150 }],
    requires: ['automation'],
    unlockRecipes: ['copper-wire'],
  },
  {
    id: 'power',
    icon: '🔥',
    category: 'power',
    name: '석탄 발전',
    description: '석탄 발전기',
    cost: [
      { item: 'iron-plate', count: 250 },
      { item: 'gear', count: 80 },
      { item: 'copper-plate', count: 150 },
    ],
    requires: ['automation'],
    unlockBuildings: ['generator'],
  },
  {
    id: 'steel',
    icon: '🔩',
    category: 'production',
    name: '강철 제련',
    description: '강철 레시피 (철판 + 석탄)',
    cost: [
      { item: 'iron-plate', count: 400 },
      { item: 'coal', count: 200 },
    ],
    requires: ['power'],
    unlockRecipes: ['steel'],
  },
  {
    id: 'electronics',
    icon: '🔌',
    category: 'production',
    name: '전자 공학',
    description: '회로 레시피',
    cost: [
      { item: 'copper-wire', count: 400 },
      { item: 'gear', count: 150 },
    ],
    requires: ['copper-working'],
    unlockRecipes: ['circuit'],
  },
  {
    id: 'fast-belt',
    icon: '⏩',
    category: 'logistics',
    name: '고속 컨베이어',
    description: '고속 컨베이어 (속도 1.5배, 일반 컨베이어 위로 드래그해서 교체)',
    cost: [
      { item: 'steel', count: 150 },
      { item: 'gear', count: 250 },
    ],
    requires: ['steel'],
    unlockBuildings: ['fast-belt'],
  },
  {
    id: 'mining-productivity',
    icon: '⛏️',
    category: 'resources',
    name: '고급 채굴',
    description: '고급 채굴기 (채굴 속도 2배, 전력 2배)',
    cost: [
      { item: 'steel', count: 200 },
      { item: 'circuit', count: 200 },
    ],
    requires: ['steel', 'electronics'],
    unlockBuildings: ['miner-2'],
  },
  {
    id: 'vehicles',
    icon: '🚚',
    category: 'logistics',
    name: '차량 운송',
    description: '도로·정류장·트럭. 먼 광맥을 긴 컨베이어 없이 트럭으로 실어 온다',
    cost: [
      { item: 'steel', count: 200 },
      { item: 'gear', count: 200 },
      { item: 'circuit', count: 100 },
    ],
    requires: ['steel', 'electronics'],
    unlockBuildings: ['road', 'station'],
  },
  {
    id: 'battery',
    icon: '🔋',
    category: 'logistics',
    name: '고용량 배터리',
    description: '트럭 배터리 1.5배 (120 → 180칸), 정류장 충전 1.5배 빠르게. 충전기: 길 중간에서 배터리가 모자란 트럭을 빠르게 충전',
    cost: [
      { item: 'copper-plate', count: 300 },
      { item: 'circuit', count: 200 },
      { item: 'steel', count: 100 },
    ],
    requires: ['vehicles'],
    unlockBuildings: ['charger'],
  },

  // ───── M7: 광맥 독립 ─────
  {
    id: 'soil-refining',
    icon: '🪨',
    category: 'resources',
    name: '흙 정제',
    description: '빈 땅에서 흙 채굴, 분쇄기·세척기·양수기, 진흙 → 벽돌',
    cost: [
      { item: 'steel', count: 250 },
      { item: 'circuit', count: 200 },
    ],
    requires: ['steel', 'electronics'],
    unlockBuildings: ['crusher', 'washer', 'pump'],
    unlockRecipes: ['crush-dirt', 'crush-gravel', 'crush-stone', 'wash', 'brick'],
    dirtMining: true,
  },
  {
    id: 'separation',
    icon: '🧲',
    category: 'resources',
    name: '광물 분리',
    description: '분리기, 정광 → 철판·구리판, 슬래그 → 콘크리트',
    cost: [
      { item: 'brick', count: 120 },
      { item: 'circuit', count: 150 },
    ],
    requires: ['soil-refining'],
    unlockBuildings: ['separator'],
    unlockRecipes: ['separate', 'iron-plate-c', 'copper-plate-c', 'concrete'],
  },
  // 석탄 독립: 석탄 광맥이 바닥나도 전력과 강철을 얻는다
  {
    id: 'renewables',
    icon: '☀️',
    category: 'power',
    name: '재생 에너지',
    description: '태양광 패널 (늘 100kW), 수력 발전기 (물로 최대 600kW). 석탄 없이 전기를 만든다',
    cost: [
      { item: 'brick', count: 100 },
      { item: 'circuit', count: 120 },
    ],
    requires: ['soil-refining'],
    unlockBuildings: ['solar', 'hydro'],
  },
  {
    id: 'electric-steel',
    icon: '🏭',
    category: 'production',
    name: '전기 제강',
    description: '전기로: 석탄 없이 전기로 철판 → 강철',
    cost: [
      { item: 'brick', count: 120 },
      { item: 'circuit', count: 150 },
    ],
    requires: ['soil-refining'],
    unlockBuildings: ['electric-furnace'],
    unlockRecipes: ['steel-e'],
  },
  {
    id: 'ore-independence',
    icon: '🏆',
    category: 'resources',
    name: '광맥 독립',
    description: '흙·물만으로 철·구리·강철·전기를 얻을 수 있다는 증표 (최종 목표)',
    cost: [
      { item: 'concrete', count: 30 },
      { item: 'brick', count: 200 },
      { item: 'iron-plate', count: 500 },
      { item: 'steel', count: 200 },
    ],
    requires: ['separation', 'renewables', 'electric-steel'],
  },
];

export const TECH_BY_ID: Record<string, Tech> = Object.fromEntries(TECHS.map((t) => [t.id, t]));

/**
 * 끝없는 연구: 최종 목표(광맥 독립)를 마친 뒤 단계마다 올리는 연구. 끝이 없다.
 * 단계마다 효과가 step만큼 더해지고(+10%), 다음 단계 비용은 1.5배.
 */
export interface EndlessTech {
  id: string;
  name: string;
  icon: string;
  description: string;
  /** 1단계 비용 */
  base: ItemStack[];
  /** 단계당 효과 (0.1 = 10% 빨라짐) */
  step: number;
}

export const ENDLESS_REQUIRES = 'ore-independence';
export const ENDLESS_GROWTH = 1.5;

export const ENDLESS_TECHS: EndlessTech[] = [
  {
    id: 'endless-mining',
    icon: '⛏️',
    name: '채굴 속도',
    description: '모든 채굴기·고급 채굴기·양수기가 단계마다 10% 빨라져요. 광맥은 그만큼 빨리 줄어요.',
    base: [
      { item: 'steel', count: 100 },
      { item: 'circuit', count: 100 },
      { item: 'concrete', count: 20 },
    ],
    step: 0.1,
  },
  {
    id: 'endless-crafting',
    icon: '⚙️',
    name: '기계 속도',
    description: '제련로·조립기·분쇄기 같은 모든 기계가 단계마다 10% 빨라져요. 전력은 그대로예요.',
    base: [
      { item: 'brick', count: 100 },
      { item: 'circuit', count: 150 },
      { item: 'concrete', count: 20 },
    ],
    step: 0.1,
  },
  {
    id: 'endless-belt',
    icon: '⏩',
    name: '컨베이어 속도',
    description: '모든 컨베이어(고속·지하 포함)가 단계마다 10% 빨라져요. 한 줄로 더 많이 나를 수 있어요.',
    base: [
      { item: 'steel', count: 100 },
      { item: 'gear', count: 200 },
      { item: 'circuit', count: 100 },
    ],
    step: 0.1,
  },
  {
    id: 'endless-truck',
    icon: '🚚',
    name: '트럭 성능',
    description: '트럭이 단계마다 10% 빨라지고 배터리도 10% 커져요. 칸당 드는 전기와 충전 속도는 그대로예요.',
    base: [
      { item: 'steel', count: 150 },
      { item: 'gear', count: 100 },
      { item: 'circuit', count: 100 },
    ],
    step: 0.1,
  },
];

export const ENDLESS_BY_ID: Record<string, EndlessTech> = Object.fromEntries(ENDLESS_TECHS.map((t) => [t.id, t]));

/** level 단계로 올리는 비용 (level = 1부터) */
export function endlessCost(t: EndlessTech, level: number): ItemStack[] {
  const k = ENDLESS_GROWTH ** (level - 1);
  return t.base.map((c) => ({ item: c.item, count: Math.ceil(c.count * k) }));
}
