import type { BuildingType } from './buildings';
import type { ItemId, ItemStack } from './items';

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
      { item: 'iron-plate', count: 120 },
      { item: 'gear', count: 40 },
    ],
    requires: ['automation'],
    unlockBuildings: ['generator'],
  },
  {
    id: 'wind',
    icon: '🌬️',
    category: 'power',
    name: '풍력 발전',
    description: '풍력 발전기 (연료 없이 밤낮없이, 날씨가 궂을수록 세게)',
    cost: [
      { item: 'iron-plate', count: 80 },
      { item: 'gear', count: 30 },
    ],
    requires: ['automation'],
    unlockBuildings: ['wind'],
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
    id: 'forestry',
    icon: '🌲',
    category: 'resources',
    name: '산림',
    description: '벌목기·식목기·제재소. 나무를 베고 다시 심는 끝없는 자원, 통나무 → 목재·숯 (숯은 석탄 대신 땔감·강철)',
    cost: [
      { item: 'iron-plate', count: 300 },
      { item: 'gear', count: 150 },
    ],
    requires: ['steel'],
    unlockBuildings: ['lumberjack', 'planter', 'sawmill'],
    unlockRecipes: ['saw', 'charcoal', 'steel-charcoal'],
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
    description: '태양광 패널 (맑은 낮 150kW, 밤 0), 수력 발전기 (물로 최대 600kW). 석탄 없이 전기를 만든다',
    cost: [
      { item: 'brick', count: 100 },
      { item: 'circuit', count: 120 },
    ],
    // 수력 발전기에 목재가 들어서 산림 뒤
    requires: ['soil-refining', 'forestry'],
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
  // 숲 2차: 톱밥 → 종이 → 나무가 빨리 자라기
  {
    id: 'paper-making',
    icon: '📜',
    category: 'resources',
    name: '제지',
    description: '세척기에 톱밥 2 + 물 1을 넣으면 종이. 제재소에서 남던 톱밥을 쓴다',
    cost: [
      { item: 'wood', count: 200 },
      { item: 'circuit', count: 100 },
    ],
    requires: ['forestry', 'soil-refining'],
    unlockRecipes: ['paper'],
  },
  {
    id: 'forest-care',
    icon: '🌱',
    category: 'resources',
    name: '숲 가꾸기',
    description: '나무가 1.5배 빨리 자란다 (2분 → 80초). 숲 하나에서 통나무가 더 많이 나온다',
    cost: [
      { item: 'paper', count: 100 },
      { item: 'wood', count: 300 },
    ],
    requires: ['paper-making'],
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
 * 세계마다 정해지는 규칙 프로필. 저장에 남고 같이 하는 사람 모두 같은 것을 쓴다.
 * - legacy-v042: 지금까지의 세계 (기존 저장은 모두 이것으로 읽는다. 자동으로 바꾸지 않는다)
 * - regional-v1: 지역 생산망 확장 세계. 기존 연구 20종의 새 비용 + 산업 연구 T01~T08
 */
export type RuleProfile = 'legacy-v042' | 'regional-v1';
export const RULE_PROFILES: RuleProfile[] = ['legacy-v042', 'regional-v1'];

const stacks = (o: Partial<Record<ItemId, number>>): ItemStack[] =>
  Object.entries(o).map(([item, count]) => ({ item: item as ItemId, count: count! }));

/** regional-v1의 기존 연구 20종 비용 (선행 관계·효과는 그대로) */
const REGIONAL_COSTS: Record<string, ItemStack[]> = {
  automation: stacks({ 'iron-plate': 20 }),
  logistics: stacks({ 'iron-plate': 30, gear: 15 }),
  storage: stacks({ 'iron-plate': 40, gear: 20 }),
  'copper-working': stacks({ 'copper-plate': 40 }),
  power: stacks({ 'iron-plate': 40, gear: 15 }),
  wind: stacks({ 'iron-plate': 40, gear: 15 }),
  steel: stacks({ 'iron-plate': 100, coal: 50 }),
  forestry: stacks({ 'iron-plate': 80, gear: 40 }),
  electronics: stacks({ 'copper-wire': 100, gear: 40 }),
  'fast-belt': stacks({ steel: 50, gear: 80 }),
  'mining-productivity': stacks({ steel: 80, circuit: 60 }),
  vehicles: stacks({ steel: 80, gear: 60, circuit: 30 }),
  battery: stacks({ 'copper-plate': 100, circuit: 60, steel: 40 }),
  'soil-refining': stacks({ steel: 80, circuit: 50 }),
  separation: stacks({ brick: 60, circuit: 40 }),
  renewables: stacks({ brick: 50, circuit: 40 }),
  'electric-steel': stacks({ brick: 60, circuit: 50 }),
  'paper-making': stacks({ wood: 80, circuit: 40 }),
  'forest-care': stacks({ paper: 50, wood: 120 }),
  'ore-independence': stacks({ concrete: 30, brick: 100, 'iron-plate': 200, steel: 80 }),
};

/**
 * 산업 연구 T01~T08 (regional-v1에서만). 주석·보크사이트·황 채굴과 원유·염수 시추는 World.oreLock이 연구로 막는다
 */
export const REGIONAL_TECHS: Tech[] = [
  {
    id: 'alloy',
    icon: '🥉',
    category: 'production',
    name: '합금 가공',
    description: '주석광석 채굴, 주석판·청동·청동 구동부 레시피',
    cost: stacks({ steel: 40, circuit: 20 }),
    requires: ['vehicles'],
    unlockRecipes: ['tin-plate', 'bronze', 'bronze-drive'],
  },
  {
    id: 'industrial-motor',
    icon: '🌀',
    category: 'production',
    name: '산업 전동기',
    description: '수액 채취기·화학 반응기·변전소, 고무·절연 전선·절연 모터 레시피',
    cost: stacks({ 'bronze-drive': 20, circuit: 30, wood: 60 }),
    requires: ['alloy', 'forestry'],
    unlockBuildings: ['sap-extractor', 'chem-reactor', 'substation'],
    unlockRecipes: ['rubber', 'insulated-wire', 'motor'],
  },
  {
    id: 'oil-control',
    icon: '🛢️',
    category: 'production',
    name: '석유와 제어',
    description: '시추기(원유)·정유소·연료 발전기, 플라스틱·고급 회로·산업 제어기·윤활유·정유 연료 레시피',
    cost: stacks({ motor: 8, steel: 40, circuit: 30 }),
    requires: ['industrial-motor', 'electronics', 'soil-refining'],
    unlockBuildings: ['drill', 'refinery', 'fuel-generator'],
    unlockRecipes: ['plastic', 'adv-circuit', 'controller', 'lubricant', 'fuel'],
  },
  {
    id: 'electro-metal',
    icon: '🔋',
    category: 'production',
    name: '전해 금속',
    description: '보크사이트 채굴, 전해로, 알루미늄판·경량 프레임 레시피',
    cost: stacks({ motor: 8, bronze: 20, brick: 40 }),
    requires: ['industrial-motor', 'soil-refining'],
    unlockBuildings: ['electrolyzer'],
    unlockRecipes: ['aluminum-plate', 'frame'],
  },
  {
    id: 'sulfur-chem',
    icon: '🌋',
    category: 'production',
    name: '황 화학',
    description: '황 채굴, 지열 발전소, 강화 고무·강화 타이어·황산·고효율 모래 세척·고용량 케이블 레시피',
    cost: stacks({ controller: 8, motor: 8, steel: 40 }),
    requires: ['oil-control', 'electro-metal'],
    unlockBuildings: ['geothermal'],
    unlockRecipes: ['hardened-rubber', 'tire', 'sulfuric-acid', 'acid-wash', 'hc-cable'],
  },
  {
    id: 'lithium-storage',
    icon: '🧪',
    category: 'production',
    name: '리튬과 축전',
    description: '염수 시추, 축전기, 리튬·배터리 팩·고급 윤활제 레시피',
    cost: stacks({ frame: 10, controller: 10, plastic: 40 }),
    requires: ['oil-control', 'electro-metal'],
    unlockBuildings: ['accumulator'],
    unlockRecipes: ['lithium', 'battery-pack', 'adv-lubricant'],
  },
  {
    id: 'advanced-vehicle',
    icon: '🚛',
    category: 'logistics',
    name: '상위 차량 조립',
    description: '대형 조립소와 고급 트럭 조립품. 정류장에서 현지 조립품 1개로 고급 트럭을 만들어요',
    cost: stacks({ tire: 20, 'battery-pack': 10, controller: 10 }),
    requires: ['sulfur-chem', 'lithium-storage'],
    unlockBuildings: ['large-assembler'],
    unlockRecipes: ['truck-kit'],
  },
  {
    id: 'integrated-automation',
    icon: '🧩',
    category: 'production',
    name: '통합 자동화',
    description: '자동화 설비 모듈 레시피와 설비 슬롯. 인접 창고의 모듈 1개를 레시피 기계에 설치해요 (속도 ×1.2, 작업 전력 ×1.25)',
    cost: stacks({ frame: 16, 'hc-cable': 24, controller: 16, paper: 60 }),
    requires: ['advanced-vehicle', 'paper-making'],
    unlockRecipes: ['module'],
  },
];

/** 고급 트럭 조립을 여는 연구 (T07) */
export const TECH_ADVANCED_TRUCK = 'advanced-vehicle';
/** 설비 모듈 설치를 여는 연구 (T08) */
export const TECH_MODULE_SLOTS = 'integrated-automation';

const LEGACY_LIST = TECHS;
/** regional-v1에서 기존 연구가 더 여는 건물 (기본 전봇대는 차량 운송과 함께) */
const REGIONAL_EXTRA_UNLOCK: Record<string, BuildingType[]> = { vehicles: ['pole'] };
const REGIONAL_LIST: Tech[] = [
  ...TECHS.map((t) => {
    const extra = REGIONAL_EXTRA_UNLOCK[t.id];
    return {
      ...t,
      cost: REGIONAL_COSTS[t.id] ?? t.cost,
      ...(extra ? { unlockBuildings: [...(t.unlockBuildings ?? []), ...extra], description: `${t.description}, 전봇대` } : {}),
    };
  }),
  ...REGIONAL_TECHS,
];
const LEGACY_BY_ID = TECH_BY_ID;
const REGIONAL_BY_ID: Record<string, Tech> = Object.fromEntries(REGIONAL_LIST.map((t) => [t.id, t]));

/** 이 규칙의 연구 목록 (연구 창 순서) */
export function techsFor(rules: RuleProfile): Tech[] {
  return rules === 'regional-v1' ? REGIONAL_LIST : LEGACY_LIST;
}

/** 이 규칙의 연구 하나 (없으면 undefined) */
export function techFor(rules: RuleProfile, id: string): Tech | undefined {
  return (rules === 'regional-v1' ? REGIONAL_BY_ID : LEGACY_BY_ID)[id];
}

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
      // 종이를 만들수록 쌓이는 목재를 끝없이 쓰는 곳
      { item: 'wood', count: 100 },
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
      { item: 'wood', count: 100 },
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
  {
    id: 'endless-forest',
    icon: '🌲',
    name: '나무 자라기',
    description: '모든 나무가 단계마다 10% 빨리 자라요. 숲 가꾸기와 겹쳐서 더 빨라져요.',
    base: [
      { item: 'paper', count: 100 },
      { item: 'wood', count: 200 },
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
