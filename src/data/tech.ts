import type { BuildingType } from './buildings';
import type { ItemStack } from './items';

/** 연구 창의 탭 */
export type TechCategory = 'production' | 'logistics' | 'power' | 'resources';

export const TECH_CATEGORIES: { id: TechCategory; name: string; icon: string }[] = [
  { id: 'production', name: '생산', icon: '⚙️' },
  { id: 'logistics', name: '물류', icon: '🚚' },
  { id: 'power', name: '전력', icon: '⚡' },
  { id: 'resources', name: '자원', icon: '⛏️' },
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
