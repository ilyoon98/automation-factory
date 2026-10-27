import type { WeatherKind } from '../sim/sky';
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
  | 'charger'
  | 'lumberjack'
  | 'planter'
  | 'sawmill'
  | 'solar'
  | 'hydro'
  | 'wind'
  | 'electric-furnace'
  // 지역 생산망 확장 (regional-v1): 지정 칸으로만 받고 내보내는 새 생산 설비
  | 'chem-reactor'
  | 'refinery'
  | 'electrolyzer'
  | 'large-assembler'
  | 'sap-extractor'
  | 'drill'
  // 지역 전력 (regional-v1)
  | 'pole'
  | 'substation'
  | 'accumulator'
  | 'fuel-generator'
  | 'geothermal';

export type Category = 'logistics' | 'production' | 'power' | 'storage' | 'transport' | 'forest' | 'industry';

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
  // 기존 발전 4종의 순서·번호는 그대로, 확장 세계에서 발전·전력망·저장을 뒤에 더한다 (별도 배전 탭 없음)
  { id: 'power', name: '전력', key: 'c', items: ['generator', 'solar', 'hydro', 'wind', 'fuel-generator', 'geothermal', 'pole', 'substation', 'accumulator'] },
  { id: 'storage', name: '보관', key: 'v', items: ['storage', 'unloader'] },
  { id: 'transport', name: '운송', key: 'b', items: ['road', 'station', 'charger'] },
  { id: 'forest', name: '숲', key: 'n', items: ['lumberjack', 'planter', 'sawmill'] },
  // regional-v1 세계에서만 탭이 보인다
  { id: 'industry', name: '산업', key: 'l', items: ['sap-extractor', 'drill', 'chem-reactor', 'refinery', 'electrolyzer', 'large-assembler'] },
];

/** 지역 생산망 확장 세계에서만 쓰는 건물 (예전 세계의 탭·도감에는 보이지 않는다) */
export const REGIONAL_ONLY = new Set<BuildingType>([
  ...CATEGORIES.find((c) => c.id === 'industry')!.items,
  'fuel-generator',
  'geothermal',
  'pole',
  'substation',
  'accumulator',
]);

/** 탭의 건물 (숫자 키 순서). 예전 세계는 확장 전용 건물을 뺀다 */
export function categoryItems(id: Category, regional: boolean): BuildingType[] {
  const items = CATEGORIES.find((c) => c.id === id)?.items ?? [];
  return regional ? items : items.filter((t) => !REGIONAL_ONLY.has(t));
}

/** 전력 탭 안의 묶음 (확장 세계): 그 묶음의 첫 건물 앞에 이름을 붙인다 */
export const POWER_GROUP: Partial<Record<BuildingType, string>> = { generator: '발전', pole: '전력망', accumulator: '저장' };

/**
 * 지정 칸 입출구. 앞면이 남쪽(↓)일 때 몸체 왼쪽 위 (0,0) 기준 "몸체 바깥에 벨트를 놓는 칸".
 * 건물을 돌리면 같이 돈다. 여기 없는 칸으로는 받지도 내보내지도 않는다
 */
export interface Ports {
  in: [number, number][];
  out: [number, number][];
}

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
  /** 있으면 면 전체가 아니라 이 칸들로만 입출력 (새 생산 설비) */
  ports?: Ports;
}

export const BUILDINGS: Record<BuildingType, BuildingDef> = {
  hub: {
    type: 'hub',
    name: '허브',
    size: 3,
    cost: [],
    power: 0,
    color: '#5b6cff',
    description: '창고. 들어온 아이템을 보관하고, 건설 재료로 쓴다. 기본 전력 400kW 제공.',
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
    // 기어 없이 철판만: 기어를 다 써도 조립기를 지어 기어를 다시 만들 수 있게 (기어 ↔ 조립기 막다른 길 막기)
    cost: [{ item: 'iron-plate', count: 20 }],
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
  charger: {
    type: 'charger',
    name: '충전기',
    size: 1,
    cost: [
      { item: 'copper-plate', count: 20 },
      { item: 'circuit', count: 10 },
      { item: 'steel', count: 5 },
    ],
    power: 0,
    color: '#d9b44a',
    description:
      '도로 옆에 놓는다. 옆 도로를 지나는 트럭이 남은 길을 갈 배터리가 모자라면 서서 공장 전력으로 빠르게(400kW) 가득 충전하고 간다. 배터리가 넉넉한 트럭은 그냥 지나간다.',
    placeable: true,
  },

  // ───── 숲·나무 ─────
  lumberjack: {
    type: 'lumberjack',
    name: '벌목기',
    size: 2,
    cost: [
      { item: 'iron-plate', count: 20 },
      { item: 'gear', count: 10 },
    ],
    power: 50,
    color: '#6f8f3a',
    description: '둘레 3칸(8×8) 안의 다 자란 나무를 2초에 한 그루 베어 노란 화살표(앞)로 통나무 2 + 묘목 1을 내보낸다.',
    placeable: true,
  },
  planter: {
    type: 'planter',
    name: '식목기',
    size: 2,
    // 목재: 숲을 넓힐수록 목재가 들게 (제재소는 같은 연구, 처음 숲에서 통나무가 나온다)
    cost: [
      { item: 'iron-plate', count: 10 },
      { item: 'gear', count: 10 },
      { item: 'wood', count: 10 },
    ],
    power: 30,
    color: '#5fae5a',
    description: '컨베이어로 묘목을 받아 둘레 3칸(8×8) 안의 빈 땅에 1초에 하나 심는다. 다 캔 광맥 자리에도 심는다. 나무는 2분이면 다 자란다. 아무 면으로나 받는다.',
    placeable: true,
  },
  sawmill: {
    type: 'sawmill',
    name: '제재소',
    size: 2,
    cost: [
      { item: 'iron-plate', count: 20 },
      { item: 'gear', count: 10 },
    ],
    power: 90,
    color: '#b08040',
    description: '통나무를 목재 2 + 톱밥 1로 켠다. 노란 화살표(앞)로 내보내고, 나머지 세 면으로 받는다.',
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
    description: '아무것도 넣지 않아도 해가 있는 동안 전기를 만든다. 맑은 낮 150kW, 흐리면 절반, 비가 오면 4분의 1, 밤에는 0.',
    placeable: true,
  },
  hydro: {
    type: 'hydro',
    name: '수력 발전기',
    size: 2,
    // 나무 물레방아라 목재 (연구 재생 에너지는 산림 뒤)
    cost: [
      { item: 'iron-plate', count: 10 },
      { item: 'gear', count: 10 },
      { item: 'brick', count: 10 },
      { item: 'wood', count: 20 },
    ],
    power: 0,
    color: '#2f8fae',
    description:
      '양수기로 퍼 온 물을 넣으면 최대 600kW를 만든다. 물 1개 = 300kJ라 최대로 돌면 초당 물 2개 (양수기 1대 분량). 아무 면으로나 받는다.',
    placeable: true,
  },
  wind: {
    type: 'wind',
    name: '풍력 발전기',
    size: 2,
    cost: [
      { item: 'iron-plate', count: 20 },
      { item: 'gear', count: 10 },
    ],
    power: 0,
    color: '#8fb3c9',
    description: '아무것도 넣지 않아도 밤낮없이 돈다. 바람은 날씨를 따라서 맑으면 60kW, 흐리면 100kW, 비가 오면 150kW.',
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
  'chem-reactor': {
    type: 'chem-reactor',
    name: '화학 반응기',
    size: 2,
    cost: [
      { item: 'steel', count: 8 },
      { item: 'gear', count: 6 },
      { item: 'circuit', count: 4 },
    ],
    power: 180,
    color: '#5f9a6a',
    description: '수액을 고무로, 황과 물을 황산으로. 레시피를 골라야 한다. 뒤 두 칸과 왼쪽 위 한 칸으로 받고, 앞 오른쪽 한 칸으로 내보낸다.',
    placeable: true,
    ports: {
      in: [
        [0, -1],
        [1, -1],
        [-1, 0],
      ],
      out: [[1, 2]],
    },
  },
  refinery: {
    type: 'refinery',
    name: '정유소',
    size: 3,
    cost: [
      { item: 'steel', count: 20 },
      { item: 'motor', count: 4 },
      { item: 'circuit', count: 12 },
    ],
    power: 240,
    color: '#6a5a4a',
    description: '원유로 플라스틱·윤활유·연료 중 하나를 만든다. 레시피를 골라야 한다. 뒤 양 끝 두 칸으로 받고, 앞 가운데로 내보낸다.',
    placeable: true,
    ports: {
      in: [
        [0, -1],
        [2, -1],
      ],
      out: [[1, 3]],
    },
  },
  electrolyzer: {
    type: 'electrolyzer',
    name: '전해로',
    size: 2,
    cost: [
      { item: 'steel', count: 16 },
      { item: 'bronze', count: 8 },
      { item: 'motor', count: 2 },
      { item: 'brick', count: 12 },
    ],
    power: 500,
    color: '#7a8fb0',
    description: '보크사이트를 알루미늄판으로, 염수를 리튬으로 (물이 함께 필요). 레시피를 골라야 한다. 뒤 두 칸으로 받고, 앞 오른쪽 한 칸으로 내보낸다.',
    placeable: true,
    ports: {
      in: [
        [0, -1],
        [1, -1],
      ],
      out: [[1, 2]],
    },
  },
  'sap-extractor': {
    type: 'sap-extractor',
    name: '수액 채취기',
    size: 2,
    cost: [
      { item: 'iron-plate', count: 12 },
      { item: 'gear', count: 6 },
      { item: 'wood', count: 12 },
    ],
    power: 60,
    color: '#8fae6a',
    description: '몸체가 고무나무 군락에 맞닿게 놓으면 나무를 베지 않고 수액을 받는다 (분당 30개, 군락 하나에 분당 120개까지 나눠 받음). 앞 오른쪽 한 칸으로 내보낸다.',
    placeable: true,
    ports: { in: [], out: [[1, 2]] },
  },
  drill: {
    type: 'drill',
    name: '시추기',
    size: 2,
    cost: [
      { item: 'steel', count: 12 },
      { item: 'motor', count: 2 },
      { item: 'circuit', count: 6 },
    ],
    power: 120,
    color: '#6a6a7a',
    description:
      '오른쪽 아래 칸(기준 칸)을 원유 지점이나 염수 지점 위에 놓는다. 분당 60개. 원유는 "석유와 제어", 염수는 "리튬과 축전" 연구 뒤. 앞 오른쪽 한 칸으로 내보낸다.',
    placeable: true,
    ports: { in: [], out: [[1, 2]] },
  },
  pole: {
    type: 'pole',
    name: '전봇대',
    size: 1,
    cost: [
      { item: 'wood', count: 2 },
      { item: 'copper-wire', count: 4 },
    ],
    power: 0,
    color: '#8f6a3a',
    description: '허브·발전기·변전소·다른 전봇대와 12칸 안이면 전선으로 저절로 이어져 한 전력망이 된다 (전선 비용·손실 없음). 둘레 6칸에 전기를 보낸다.',
    placeable: true,
  },
  substation: {
    type: 'substation',
    name: '변전소',
    size: 2,
    cost: [
      { item: 'steel', count: 8 },
      { item: 'wood', count: 8 },
      { item: 'insulated-wire', count: 8 },
      { item: 'motor', count: 1 },
    ],
    power: 0,
    color: '#5a6a8a',
    description: '둘레 18칸에 전봇대 없이 전기를 보낸다. 12칸 안의 노드와 전선으로 이어진다. 발전량을 늘리지는 않는다.',
    placeable: true,
  },
  accumulator: {
    type: 'accumulator',
    name: '축전기',
    size: 2,
    cost: [
      { item: 'battery-pack', count: 4 },
      { item: 'steel', count: 4 },
      { item: 'controller', count: 1 },
    ],
    power: 0,
    color: '#3f8a6a',
    description: '남는 비연료 전기를 10MJ까지 모았다가(충전 효율 95%) 모자랄 때 내보낸다. 충·방전 최대 200kW, 10%는 남긴다.',
    placeable: true,
  },
  'fuel-generator': {
    type: 'fuel-generator',
    name: '연료 발전기',
    size: 3,
    cost: [
      { item: 'steel', count: 16 },
      { item: 'motor', count: 2 },
      { item: 'controller', count: 1 },
      { item: 'brick', count: 12 },
    ],
    power: 0,
    color: '#a5643a',
    description: '정유 연료를 태워 최대 1.5MW (연료 1개 = 6000kJ). 뒤 가운데 한 칸으로 연료만 받는다 (30개까지).',
    placeable: true,
    ports: { in: [[1, -1]], out: [] },
  },
  geothermal: {
    type: 'geothermal',
    name: '지열 발전소',
    size: 3,
    cost: [
      { item: 'steel', count: 30 },
      { item: 'bronze', count: 12 },
      { item: 'motor', count: 4 },
      { item: 'controller', count: 4 },
      { item: 'concrete', count: 24 },
    ],
    power: 0,
    color: '#9a5a4a',
    description: '가운데 칸을 화산의 지열 분출구 위에 놓는다. 연료 없이 밤낮·날씨와 상관없이 1.8MW.',
    placeable: true,
  },
  'large-assembler': {
    type: 'large-assembler',
    name: '대형 조립소',
    size: 3,
    cost: [
      { item: 'steel', count: 30 },
      { item: 'frame', count: 8 },
      { item: 'motor', count: 4 },
      { item: 'controller', count: 4 },
    ],
    power: 300,
    color: '#8a6fb0',
    description:
      '고급 트럭 조립품·자동화 설비 모듈을 만든다. 레시피를 골라야 한다. 뒤 두 칸·양옆 두 칸씩 여섯 곳으로 받고, 앞 가운데로 내보낸다.',
    placeable: true,
    ports: {
      in: [
        [0, -1],
        [2, -1],
        [-1, 0],
        [-1, 2],
        [3, 0],
        [3, 2],
      ],
      out: [[1, 3]],
    },
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
  /** 배터리 (kJ). 다 차 있으면 battery / drive × speed = 120칸을 달린다 */
  battery: 1800,
  /** 달리는 동안 쓰는 전력 (kW) */
  drive: 60,
  /** 정류장에 서 있는 동안 공장 전력으로 충전하는 속도 (kW). 빈 배터리 → 가득 9초 */
  charge: 200,
  /** 배터리가 떨어지면 이 비율로 천천히 간다 (멈추지는 않는다) */
  emptySpeed: 0.25,
  /** 충전기 앞에 서서 충전하는 속도 (kW). 정류장보다 빠르다 */
  fastCharge: 400,
  /** 연구 "고용량 배터리"를 마치면 배터리 크기와 정류장 충전 속도가 이만큼 */
  batteryTech: 1.5,
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
export const RECIPE_MACHINES: BuildingType[] = [
  'smelter',
  'assembler',
  'crusher',
  'washer',
  'separator',
  'electric-furnace',
  'sawmill',
  'chem-reactor',
  'refinery',
  'electrolyzer',
  'large-assembler',
];
export const isRecipeMachine = (t: BuildingType) => RECIPE_MACHINES.includes(t);
/** 처음 들어온 재료로 정하지 않고 플레이어가 레시피를 골라야 하는 기계 */
export const needsRecipeChoice = (t: BuildingType) =>
  t === 'assembler' || t === 'chem-reactor' || t === 'refinery' || t === 'electrolyzer' || t === 'large-assembler';
/** 자동화 설비 모듈을 설치할 수 있는 레시피 기계 11종 (지금은 RECIPE_MACHINES 전부) */
export const MODULE_MACHINES: BuildingType[] = RECIPE_MACHINES;

/** 자동화 설비 모듈: 모듈을 쓰는 배치의 제작 속도·작업 전력 배율 (연구 적용값에 곱한다) */
export const MODULE = { speed: 1.2, power: 1.25 };

/** 차량 종류 */
export type TruckKind = 'basic' | 'advanced';

/**
 * 고급 트럭: 정류장 현지의 고급 트럭 조립품 1개로 만든다 (허브 비용 없음).
 * 연구 배율은 이 기본값 위에 곱한다. 칸당 전기는 기본 트럭과 같은 15kJ
 */
export const ADVANCED_TRUCK = {
  capacity: 100,
  speed: 5,
  battery: 3600,
  drive: 75,
  charge: 400,
  kit: 'truck-kit' as const,
};
/** 땅에서 뽑지만 채굴기와 다른 규칙인 새 설비 (고무나무 옆 수액 채취기, 원유·염수 지점의 시추기) */
export const isExtractorType = (t: BuildingType) => t === 'sap-extractor' || t === 'drill';
/** 새 채취 설비: 수액 채취기 분당 30개, 고무나무 군락 하나에 분당 120개까지. 시추기 분당 60개 */
export const EXTRACT = { sapTime: 2, groveMax: 4, drillTime: 1 };

/** 지역 전력 (regional-v1, docs/지형-운송-전력-상세기획.md §9~11) */
export const GRID = {
  /** 전력망 노드의 직접 공급 반경 (기준 칸 체비쇼프). 노드끼리는 link칸 안이면 전선으로 저절로 이어진다 */
  hub: { radius: 24 },
  generator: { radius: 10 },
  substation: { radius: 18 },
  pole: { radius: 6, link: 12 },
  /** 거점: 새 허브·발전기·변전소가 기존 거점 기준 칸에서 맨해튼 이만큼 안이면 그 거점에 묶는다 */
  siteJoin: 20,
  /** 거점 차량 충전 예산 기본값 (kW) */
  charge: 400,
  accumulator: { capacity: 10000, rate: 200, efficiency: 0.95, floor: 0.1 },
  fuel: { power: 1500, energy: 6000, cap: 30 },
  geothermal: 1800,
};

/** 전기를 만드는 건물 (놓을 때 공급 범위 밖이면 새 전력 구역을 만든다) */
export const isGeneratorType = (t: BuildingType) =>
  t === 'generator' || t === 'hydro' || t === 'solar' || t === 'wind' || t === 'fuel-generator' || t === 'geothermal';

/** 둘레의 나무를 다루는 건물 (벌목기·식목기) */
export const isForestType = (t: BuildingType) => t === 'lumberjack' || t === 'planter';

/** 숲·나무 */
export const FOREST = {
  /** 묘목이 다 자란 나무가 되는 시간 (초) */
  grow: 120,
  /** 벌목기·식목기가 다루는 범위: 건물 둘레 이만큼 (2×2 + 둘레 3칸 = 8×8) */
  range: 3,
  /** 벌목기가 한 그루 베는 시간, 식목기가 하나 심는 시간 (초) */
  cut: 2,
  plant: 1,
  /** 다 자란 나무 한 그루 = 통나무 몇 개 (벌목기는 묘목 1도) */
  logs: 2,
  /** 식목기에 쌓아 두는 묘목 수 */
  planterCap: 5,
  /** 연구 "숲 가꾸기": 나무가 이만큼 빨리 자란다 */
  care: 1.5,
  /** 목표 "숲 되살리기": 다 캔 광맥 자리에 다 자란 나무 이만큼 */
  revive: 50,
};

export const HUB_BASE_POWER = 400;
export const GENERATOR_POWER = 900;
export const COAL_ENERGY = 4000;
/** 숯 1개의 에너지 (석탄의 2/3쯤): 끝없이 얻지만 약한 땔감 */
export const CHARCOAL_ENERGY = 2500;
/** 태양광 패널 한 대가 맑은 낮에 내는 전력. 밤에는 0, 해 질 녘·해 뜰 녘에는 서서히 */
export const SOLAR_POWER = 150;
/** 날씨에 따라 태양광이 내는 비율 */
export const SOLAR_WEATHER: Record<WeatherKind, number> = { clear: 1, cloudy: 0.5, rain: 0.25 };
/** 풍력 발전기 한 대가 날씨마다 내는 전력 (밤낮 상관없이) */
export const WIND_POWER: Record<WeatherKind, number> = { clear: 60, cloudy: 100, rain: 150 };
/** 수력 발전기 한 대 최대 출력과 물 1개의 에너지 (kJ). 최대로 돌면 초당 물 2개 = 양수기 1대 */
export const HYDRO_POWER = 600;
export const WATER_ENERGY = 300;
