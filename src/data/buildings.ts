import type { ItemStack } from './items';

export type BuildingType =
  | 'hub'
  | 'belt'
  | 'fast-belt'
  | 'underground'
  | 'miner'
  | 'miner-2'
  | 'smelter'
  | 'assembler'
  | 'splitter'
  | 'overflow'
  | 'sorter'
  | 'merger'
  | 'generator'
  | 'storage'
  | 'unloader'
  | 'crusher'
  | 'washer'
  | 'separator'
  | 'pump'
  | 'road'
  | 'station'
  | 'solar'
  | 'hydro'
  | 'electric-furnace';

export type Category = 'logistics' | 'production' | 'power' | 'storage' | 'transport';

/**
 * 하단 툴바 카테고리. key로 탭을 바꾸고, 숫자 1~9로 items의 순서대로 고른다.
 * 순서가 곧 단축키 번호라 바꾸면 손에 익은 번호가 달라진다.
 */
export const CATEGORIES: { id: Category; name: string; key: string; items: BuildingType[] }[] = [
  {
    id: 'logistics',
    name: '물류',
    key: 'z',
    items: ['belt', 'fast-belt', 'underground', 'splitter', 'overflow', 'sorter', 'merger'],
  },
  {
    id: 'production',
    name: '생산',
    key: 'x',
    items: ['miner', 'smelter', 'assembler', 'miner-2', 'crusher', 'washer', 'separator', 'pump', 'electric-furnace'],
  },
  { id: 'power', name: '전력', key: 'c', items: ['generator', 'solar', 'hydro'] },
  { id: 'storage', name: '보관', key: 'v', items: ['storage', 'unloader'] },
  { id: 'transport', name: '운송', key: 'b', items: ['road', 'station'] },
];

export interface BuildingDef {
  type: BuildingType;
  name: string;
  /** 정사각형 한 변 타일 수 */
  size: number;
  cost: ItemStack[];
  /** 작동 중 전력 소비 (kW). 0이면 전력이 필요 없다. */
  power: number;
  color: string;
  description: string;
  /** 툴바에 나오는지 (허브는 맵에 하나뿐이라 직접 배치 불가) */
  placeable: boolean;
  /** 컨베이어: 칸/초, 채굴기: 개/초 */
  speed?: number;
  /** 컨베이어 한 칸에 쌓을 수 있는 개수 */
  stack?: number;
}

export const BUILDINGS: Record<BuildingType, BuildingDef> = {
  hub: {
    type: 'hub',
    name: '허브',
    size: 3,
    cost: [],
    power: 0,
    color: '#5b6cff',
    description: '창고. 들어온 아이템을 보관하고, 건설 재료로 쓴다. 기본 전력 300kW 제공.',
    placeable: false,
  },
  belt: {
    type: 'belt',
    name: '컨베이어',
    size: 1,
    cost: [{ item: 'iron-plate', count: 1 }],
    power: 0,
    color: '#3b3f47',
    description: '아이템을 화살표 방향으로 운반한다. 드래그로 연속 배치. 초당 1.5칸, 한 칸에 2개까지 쌓는다.',
    placeable: true,
    speed: 1.5,
    stack: 2,
  },
  'fast-belt': {
    type: 'fast-belt',
    name: '고속 컨베이어',
    size: 1,
    cost: [
      { item: 'iron-plate', count: 1 },
      { item: 'gear', count: 2 },
    ],
    power: 0,
    color: '#3f6fa8',
    description: '일반 컨베이어보다 1.5배 빠르고 (초당 2.25칸) 한 칸에 4개까지 쌓는다. 일반 컨베이어 위로 드래그하면 바로 교체된다.',
    placeable: true,
    speed: 2.25,
    stack: 4,
  },
  underground: {
    type: 'underground',
    name: '지하 컨베이어',
    size: 1,
    cost: [
      { item: 'iron-plate', count: 4 },
      { item: 'gear', count: 1 },
    ],
    power: 0,
    color: '#b5813a',
    description: '처음 놓은 것이 입구, 같은 방향으로 최대 4칸 건너 놓은 것이 출구. 그 사이를 땅속으로 지나가서 다른 컨베이어와 교차할 수 있다.',
    placeable: true,
    speed: 1.5,
    stack: 2,
  },
  miner: {
    type: 'miner',
    name: '채굴기',
    size: 2,
    cost: [
      { item: 'iron-plate', count: 8 },
      { item: 'gear', count: 4 },
    ],
    power: 90,
    color: '#b08a3e',
    description: '아래 광맥에서 1초에 1개 채굴. 노란 화살표(출구) 쪽으로만 내보낸다.',
    placeable: true,
    speed: 1,
  },
  'miner-2': {
    type: 'miner-2',
    name: '고급 채굴기',
    size: 2,
    cost: [
      { item: 'steel', count: 10 },
      { item: 'circuit', count: 5 },
      { item: 'gear', count: 10 },
    ],
    power: 180,
    color: '#d9b24a',
    description: '1초에 2개 채굴 (일반 채굴기의 2배). 전력도 2배를 쓴다.',
    placeable: true,
    speed: 2,
  },
  smelter: {
    type: 'smelter',
    name: '제련로',
    size: 2,
    cost: [{ item: 'stone', count: 10 }],
    power: 90,
    color: '#a5523a',
    description: '광석을 판으로 제련한다. 출구(노란 화살표)를 뺀 나머지 면으로 재료를 받는다. 처음 들어온 재료로 레시피를 자동 선택.',
    placeable: true,
  },
  assembler: {
    type: 'assembler',
    name: '조립기',
    size: 2,
    cost: [
      { item: 'iron-plate', count: 10 },
      { item: 'gear', count: 6 },
    ],
    power: 75,
    color: '#3f7fa5',
    description: '부품을 조립한다. 클릭해서 레시피를 고른다. 출구(노란 화살표)를 뺀 나머지 면으로 재료를 받는다.',
    placeable: true,
  },
  splitter: {
    type: 'splitter',
    name: '분배기',
    size: 1,
    cost: [
      { item: 'iron-plate', count: 4 },
      { item: 'gear', count: 2 },
    ],
    power: 0,
    color: '#7a5aa8',
    description: '뒤쪽 입구(흰 화살표)로 받아 앞·양옆 출구(노란 화살표)에 번갈아 나눠 준다.',
    placeable: true,
  },
  overflow: {
    type: 'overflow',
    name: '우선 분배기',
    size: 1,
    cost: [
      { item: 'iron-plate', count: 4 },
      { item: 'gear', count: 2 },
    ],
    power: 0,
    color: '#a85a8a',
    description: '뒤쪽 입구로 받아 앞쪽 출구로 먼저 보내고, 앞이 막히면 양옆으로 넘긴다. 잉여 처리용.',
    placeable: true,
  },
  sorter: {
    type: 'sorter',
    name: '스마트 분류기',
    size: 1,
    cost: [
      { item: 'iron-plate', count: 6 },
      { item: 'gear', count: 3 },
    ],
    power: 0,
    color: '#3aa58a',
    description: '뒤쪽 입구로 받아, 정한 아이템은 앞으로, 나머지는 양옆으로 보낸다. 클릭해서 아이템을 고른다.',
    placeable: true,
  },
  merger: {
    type: 'merger',
    name: '병합기',
    size: 1,
    cost: [
      { item: 'iron-plate', count: 4 },
      { item: 'gear', count: 2 },
    ],
    power: 0,
    color: '#5a8fa8',
    description: '뒤·왼쪽·오른쪽(흰 화살표)으로 받아 앞(노란 화살표)으로 내보낸다. 여러 줄이 기다리면 한 개씩 번갈아 받아서 한쪽이 굶지 않는다.',
    placeable: true,
  },
  generator: {
    type: 'generator',
    name: '석탄 발전기',
    size: 2,
    cost: [
      { item: 'iron-plate', count: 15 },
      { item: 'gear', count: 6 },
      { item: 'stone', count: 10 },
    ],
    power: 0,
    color: '#4f8a52',
    description: '석탄을 태워 최대 900kW를 만든다. 석탄 1개 = 4000kJ.',
    placeable: true,
  },
  storage: {
    type: 'storage',
    name: '창고',
    size: 2,
    cost: [
      { item: 'iron-plate', count: 20 },
      { item: 'stone', count: 10 },
    ],
    power: 0,
    color: '#9a7b4f',
    description:
      '아무 면으로나 아이템을 받아 최대 200개까지 쌓아 둔다. 빈틈없는 직사각형으로 붙여 놓으면 한 창고로 합쳐진다 (최대 3×4개 = 2,400개). 꺼낼 때는 하역기를 붙인다.',
    placeable: true,
  },
  unloader: {
    type: 'unloader',
    name: '하역기',
    size: 1,
    cost: [
      { item: 'iron-plate', count: 10 },
      { item: 'gear', count: 5 },
    ],
    power: 0,
    color: '#c9803a',
    description:
      '뒤(흰 화살표)에 붙은 허브나 창고에서 0.5초마다 앞 컨베이어 한 칸만큼(일반 2개, 고속 4개)씩 꺼내 앞(노란 화살표)으로 내보낸다. 아이템을 안 고르면 든 것을 종류별로 번갈아 전부 꺼낸다.',
    placeable: true,
  },

  // ───── M7: 흙에서 금속 얻기 ─────
  crusher: {
    type: 'crusher',
    name: '분쇄기',
    size: 2,
    cost: [
      { item: 'steel', count: 5 },
      { item: 'gear', count: 10 },
      { item: 'stone', count: 20 },
    ],
    power: 120,
    color: '#8f7d5c',
    description: '흙을 자갈과 모래로, 자갈을 모래로, 돌을 자갈로 부순다. 처음 들어온 재료로 레시피를 고른다. 흙을 부수면 자갈과 모래가 한 줄로 섞여 나온다.',
    placeable: true,
  },
  washer: {
    type: 'washer',
    name: '세척기',
    size: 2,
    cost: [
      { item: 'steel', count: 5 },
      { item: 'gear', count: 10 },
      { item: 'iron-plate', count: 10 },
    ],
    power: 150,
    color: '#3f86a8',
    description: '모래 3 + 물 2 → 광물 가루 1 + 진흙 1. 진흙은 제련로에서 벽돌이 된다.',
    placeable: true,
  },
  separator: {
    type: 'separator',
    name: '분리기',
    size: 2,
    cost: [
      { item: 'steel', count: 10 },
      { item: 'circuit', count: 10 },
      { item: 'brick', count: 10 },
    ],
    power: 300,
    color: '#9a6ab8',
    description: '광물 가루를 철 정광·구리 정광·슬래그로 나눈다. 10개마다 정확히 7·2·1개씩, 한 줄로 섞여 나온다.',
    placeable: true,
  },
  pump: {
    type: 'pump',
    name: '양수기',
    size: 2,
    cost: [
      { item: 'iron-plate', count: 10 },
      { item: 'gear', count: 5 },
      { item: 'steel', count: 2 },
    ],
    power: 60,
    color: '#2f6fae',
    description: '호수 위에 놓으면 물을 1초에 2개 퍼 올려 출구로 내보낸다.',
    placeable: true,
    speed: 2,
  },

  // ───── 차량 운송 ─────
  road: {
    type: 'road',
    name: '도로',
    size: 1,
    cost: [{ item: 'stone', count: 1 }],
    power: 0,
    color: '#5a5f69',
    description: '트럭이 다니는 길. 드래그로 연속 배치. 방향이 없어서 양쪽으로 다닌다. 컨베이어와 엇갈릴 때는 지하 컨베이어로 밑을 지나가게 한다.',
    placeable: true,
  },
  station: {
    type: 'station',
    name: '정류장',
    size: 2,
    cost: [
      { item: 'iron-plate', count: 20 },
      { item: 'gear', count: 10 },
      { item: 'steel', count: 5 },
    ],
    power: 0,
    color: '#c99a2e',
    description:
      '도로 옆에 지으면 트럭이 선다. 싣기 정류장은 컨베이어로 받은 아이템을 트럭에 싣고, 내리기 정류장은 트럭이 내린 아이템을 노란 화살표(앞)로 내보낸다. 트럭은 정류장 정보창에서 만든다.',
    placeable: true,
  },

  // ───── 석탄 독립: 석탄 없이 전력과 강철 ─────
  solar: {
    type: 'solar',
    name: '태양광 패널',
    size: 2,
    cost: [
      { item: 'iron-plate', count: 10 },
      { item: 'circuit', count: 5 },
      { item: 'brick', count: 5 },
    ],
    power: 0,
    color: '#3d6fb0',
    description: '아무것도 넣지 않아도 늘 100kW를 만든다. 약하지만 끝이 없어서, 넓게 깔수록 전력이 늘어난다.',
    placeable: true,
  },
  hydro: {
    type: 'hydro',
    name: '수력 발전기',
    size: 2,
    cost: [
      { item: 'iron-plate', count: 15 },
      { item: 'gear', count: 10 },
      { item: 'brick', count: 10 },
    ],
    power: 0,
    color: '#2f8fae',
    description:
      '양수기로 퍼 온 물을 넣으면 최대 600kW를 만든다. 물 1개 = 300kJ라 최대로 돌면 초당 물 2개 (양수기 1대 분량). 아무 면으로나 받는다.',
    placeable: true,
  },
  'electric-furnace': {
    type: 'electric-furnace',
    name: '전기로',
    size: 2,
    cost: [
      { item: 'iron-plate', count: 20 },
      { item: 'circuit', count: 10 },
      { item: 'brick', count: 20 },
    ],
    power: 450,
    color: '#5b7fc0',
    description:
      '석탄 없이 전기만으로 철판을 강철로 만든다 (철판 2 → 강철 1). 대신 전력을 많이 쓴다. 출구(노란 화살표)를 뺀 나머지 면으로 받는다.',
    placeable: true,
  },
};

/** 정류장 하나에 쌓아 두는 아이템 수 */
export const STATION_CAPACITY = 200;

/** 트럭: 정류장 정보창에서 만든다 (건물이 아니라 도로 위를 달리는 차) */
export const TRUCK = {
  cost: [
    { item: 'steel', count: 10 },
    { item: 'gear', count: 10 },
    { item: 'circuit', count: 5 },
  ] as ItemStack[],
  /** 한 번에 싣는 개수 */
  capacity: 50,
  /** 칸/초 */
  speed: 4,
  /** 싣고 내리는 속도 (개/초) */
  transfer: 10,
  /** 덜 찼어도 이만큼(초) 새 짐이 없으면 출발한다 */
  wait: 5,
};

/** 지하 컨베이어 입구와 출구 사이에 둘 수 있는 최대 칸 수 */
export const UNDERGROUND_MAX_GAP = 4;
/** 창고 하나에 쌓을 수 있는 아이템 수 */
export const STORAGE_CAPACITY = 200;
/** 창고는 빈틈없는 직사각형으로 붙으면 합쳐진다. 가로·세로 최대 개수 (어느 방향이든 3×4까지) */
export const STORAGE_GROUP_MAX = { short: 3, long: 4 };
/** 하역기가 아이템 하나를 꺼내는 간격 (초) */
export const UNLOADER_INTERVAL = 0.5;

export const isBeltType = (t: BuildingType) => t === 'belt' || t === 'fast-belt';
/** 컨베이어를 도로에, 또는 도로를 컨베이어에 놓으려는지 (둘은 겹칠 수 없고 지하 컨베이어로 엇갈린다) */
export const crossesRoad = (tool: BuildingType, there: BuildingType) =>
  (isBeltType(tool) && there === 'road') || (tool === 'road' && (isBeltType(there) || there === 'underground'));
/** 땅(광맥·흙·물)에서 뽑아내는 건물 */
export const isMinerType = (t: BuildingType) => t === 'miner' || t === 'miner-2' || t === 'pump';
/** 레시피로 재료를 결과물로 바꾸는 건물 */
export const RECIPE_MACHINES: BuildingType[] = ['smelter', 'assembler', 'crusher', 'washer', 'separator', 'electric-furnace'];
export const isRecipeMachine = (t: BuildingType) => RECIPE_MACHINES.includes(t);

export const HUB_BASE_POWER = 300;
export const GENERATOR_POWER = 900;
export const COAL_ENERGY = 4000;
/** 태양광 패널 한 대 (늘 이만큼) */
export const SOLAR_POWER = 100;
/** 수력 발전기 한 대 최대 출력과 물 1개의 에너지 (kJ). 최대로 돌면 초당 물 2개 = 양수기 1대 */
export const HYDRO_POWER = 600;
export const WATER_ENERGY = 300;
