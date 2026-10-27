import {
  ADVANCED_TRUCK,
  BUILDINGS,
  CHARCOAL_ENERGY,
  COAL_ENERGY,
  FOREST,
  GENERATOR_POWER,
  HUB_BASE_POWER,
  HYDRO_POWER,
  MODULE,
  MODULE_MACHINES,
  SOLAR_POWER,
  SOLAR_WEATHER,
  STATION_CAPACITY,
  STORAGE_CAPACITY,
  STORAGE_GROUP_MAX,
  TRUCK,
  UNDERGROUND_MAX_GAP,
  UNLOADER_INTERVAL,
  WATER_ENERGY,
  WIND_POWER,
  isBeltType,
  isForestType,
  isMinerType,
  isRecipeMachine,
  isExtractorType,
  isGeneratorType,
  EXTRACT,
  GRID,
  needsRecipeChoice,
  type BuildingType,
  type Ports,
  type TruckKind,
} from '../data/buildings';
import { ITEM_IDS, type ItemId, type ItemStack } from '../data/items';
import { RECIPES, type MachineKind, type Recipe } from '../data/recipes';
import {
  ENDLESS_BY_ID,
  ENDLESS_REQUIRES,
  INITIAL_BUILDINGS,
  INITIAL_RECIPES,
  RULE_PROFILES,
  TECH_ADVANCED_TRUCK,
  TECH_MODULE_SLOTS,
  endlessCost,
  techFor,
  techsFor,
  type RuleProfile,
  type Tech,
} from '../data/tech';
import { Building, addTo, countOf, type BeltItem, type StationMode } from './building';
import { DX, DY, opposite, rotateCW, type Dir } from './dir';
import { DAY_SEC, darkness, dayPhase, weatherAt, weatherMix } from './sky';
import { ROUTE_MIN, Vehicle, type RouteStop, type VehicleState } from './vehicle';
import { TERRAIN, TERRAIN_IDS, type TerrainKind } from '../data/terrain';
import { WEATHER_FX, localWeather, type LocalWeather, type WeatherFx } from './weather-v1';
import { PROJECT_GOAL, evaluateGoals } from './goals';
import { AchState, SPECIALTY, evaluateAchievements } from './achievements';

export const TICK_RATE = 60;
export const DT = 1 / TICK_RATE;
/** 컨베이어 기본 속도 (칸/초) */
export const BELT_SPEED = 1.5;
/** 같은 컨베이어 위 아이템 최소 간격 (칸). 한 칸에 최대 4개 */
export const BELT_SPACING = 0.25;
const MINER_OUT_CAP = 2;
/** 벌목기가 쌓아 두는 통나무·묘목 (두 그루분) */
const LUMBER_OUT_CAP = 6;
/** 기계 입력/출력 버퍼: 레시피 몇 회분까지 쌓아 두는지 */
const MACHINE_BUFFER_CRAFTS = 2;
const GENERATOR_FUEL_CAP = 5;
/** 수력 발전기가 쌓아 두는 물 (최대로 돌면 5초 분량) */
const HYDRO_WATER_CAP = 10;

export interface PlaceCheck {
  ok: boolean;
  reason?: string;
}

/** 아이템을 내보낼 수 있는 이웃. fromSide = 받는 쪽에서 본 보내는 쪽 방향 */
interface OutTarget {
  b: Building;
  fromSide: Dir;
  /** 보내는 쪽에서 본 받는 쪽 방향 */
  out: Dir;
}

export interface PowerState {
  demand: number;
  capacity: number;
  supply: number;
  satisfaction: number;
  /** demand 중 트럭 충전 몫 (kW) */
  charge: number;
}

/** 저장 파일의 콘텐츠 개정. 1: 먼 광맥을 줄였다 */
const CONTENT_REV = 1;

/** 가동 기록을 평균 내는 시간 (초). 이만큼 지난 일은 점점 잊는다. */
export const STATS_TAU = 15;

/**
 * 되돌리기 한 단계 안에서 바뀐 것 하나. 건물은 id가 아니라 자리(왼쪽 위 칸)로 찾는다
 * (철거했다가 되돌려 다시 지으면 id가 바뀌므로).
 */
export type EditOp =
  | {
      kind: 'place';
      type: BuildingType;
      x: number;
      y: number;
      dir: Dir;
      /** 되돌려서 치웠을 때의 id·정류장 번호 (다시 하기에서 트럭을 잇고 번호를 지키려고) */
      id?: number;
      no?: number;
    }
  | {
      kind: 'remove';
      type: BuildingType;
      x: number;
      y: number;
      dir: Dir;
      recipe: string | null;
      filter: ItemId | null;
      mode: StationMode;
      no: number;
      ug: 'in' | 'out' | null;
      /** 철거될 때의 id. 정류장을 되돌리면 이 id를 오가던 트럭을 새 정류장에 다시 잇는다 */
      id: number;
      /** 장착돼 있던 모듈을 내려놓은 회수 사건 번호. 되돌릴 때 그 회수분이 그 자리에 남아 있으면 다시 장착한다 */
      mod?: number;
    }
  | { kind: 'rotate'; x: number; y: number; from: Dir; to: Dir }
  | { kind: 'recipe'; x: number; y: number; from: string | null; to: string | null }
  | { kind: 'filter'; x: number; y: number; from: ItemId | null; to: ItemId | null }
  | { kind: 'mode'; x: number; y: number; from: StationMode; to: StationMode }
  | ({ kind: 'truck-add' } & TruckEdit)
  | ({ kind: 'truck-remove' } & TruckEdit)
  /** 트럭 노선 바꾸기 (정류장 더하기·빼기·순서·싣기/내리기·실을 짐) */
  | { kind: 'route'; id: number; from: RouteStop[]; to: RouteStop[] };

/** 트럭 만들기·철거. 되돌려 다시 만들면 id가 바뀌므로 id는 그때그때 고친다. 실었던 짐은 돌아오지 않는다 */
interface TruckEdit {
  id: number;
  tile: number;
  stops: RouteStop[];
}

/**
 * 현지 회수 더미의 한 덩어리 (regional-v1). 철거·레시피 변경·모듈 분리 등으로 실제 물건이 있던 칸에 남는다.
 * 같은 칸·아이템이라도 회수 사건(ev)마다 따로 기록하고, 꺼낼 때는 먼저 생긴 사건부터 줄인다.
 * 칸을 막지 않으며 벨트·트럭으로 넣을 수 없다. 하역기로만 꺼낸다
 */
/** 지역 전력 구역. 중심(x, y)은 처음 만든 노드 자리이고, 그 발전기를 철거해도 바뀌지 않는다 */
/** 전선 한 가닥: 이어 준 노드 x, y, 반경(전봇대면 GRID.pole.radius) → 전봇대 x, y */
export type Wire = [number, number, number, number, number];

export interface Zone {
  id: number;
  x: number;
  y: number;
  hub: boolean;
  /** 구역을 만든 건물 (허브 또는 첫 발전기) */
  creator: number;
  /** 차량 충전 예산 (kW) */
  budget: number;
}

/** 구역의 이번 틱 전력 (kW, 저장은 kJ) */
export interface ZoneState {
  demand: number;
  charge: number;
  nonfuel: number;
  received: number;
  sent: number;
  discharge: number;
  fuel: number;
  stored: number;
  storeMax: number;
  capacity: number;
  cap: number;
  satisfaction: number;
  request: number;
}

/** 운송 예약 한 줄: 트럭 v가 holder에서 item n개를 실기로(out) / 목적지 풀 holder로 n개를 가져오기로(in) */
export interface Reservation {
  v: number;
  holder: number;
  item: ItemId;
  n: number;
  dir: 'in' | 'out';
}

/** 공장 실적. 시작 재고·환급·창고 이동은 생산으로 세지 않는다 */
export interface FactoryStats {
  /** 제작·채굴·채취 완료 누적 */
  made: Map<ItemId, number>;
  /** 허브로 들어온 누적 */
  hubIn: Map<ItemId, number>;
  /** 허브 밖 발전원이 기계 작업에 준 전기, 변전소로 정식화한 구역의 작업 전기 (kJ) */
  genWork: number;
  formalWork: number;
  /** 트럭이 실은 곳이 아닌 정류장에 내린 화물, 그중 정기편 계획 운송 */
  delivered: number;
  scheduledDelivered: number;
  /** 다른 구역으로 배송한 품목별 개수 */
  itemDelivered: Map<ItemId, number>;
  /** 구역 사이 배송 "출발>도착": 개수와 품목 */
  pairs: Map<string, { n: number; items: Set<ItemId> }>;
  /** 구역별 생산 수, 작업 전기 (kJ), 제작에 실제로 쓴 재료 */
  zoneMade: Map<number, number>;
  zoneWork: Map<number, number>;
  zoneUsed: Map<number, Set<ItemId>>;
  largeStarted: boolean;
  /** 허브 프로젝트: 납품을 켰는지, 누적 납품 모듈 */
  projectOn: boolean;
  projectDelivered: number;
  /** 선택 도전용: 심은 나무가 다 자란 수, 레시피별 완료 수, 지열·수전·한밤 축전이 작업에 준 전기, 현지 날씨별 작업 전기 (kJ) */
  treesMatured: number;
  recipeDone: Map<string, number>;
  geoWork: number;
  linkWork: number;
  nightStorage: number;
  weatherWork: Map<string, number>;
}

export function newStats(): FactoryStats {
  return {
    made: new Map(),
    hubIn: new Map(),
    genWork: 0,
    formalWork: 0,
    delivered: 0,
    scheduledDelivered: 0,
    itemDelivered: new Map(),
    pairs: new Map(),
    zoneMade: new Map(),
    zoneWork: new Map(),
    zoneUsed: new Map(),
    largeStarted: false,
    projectOn: false,
    projectDelivered: 0,
    treesMatured: 0,
    recipeDone: new Map(),
    geoWork: 0,
    linkWork: 0,
    nightStorage: 0,
    weatherWork: new Map(),
  };
}

export interface PileEntry {
  tile: number;
  item: ItemId;
  n: number;
  ev: number;
  why: PileReason;
}

export type PileReason = 'remove' | 'recipe' | 'mode' | 'module' | 'cancel' | 'truck';

export const PILE_REASON_LABEL: Record<PileReason, string> = {
  remove: '철거',
  recipe: '레시피 변경',
  mode: '싣기/내리기 변경',
  module: '모듈 분리',
  cancel: '작업 취소',
  truck: '차량 철거',
};

/**
 * 현지 실물을 쓰는 명령(모듈 설치·분리, 고급 트럭 조립)의 결과. 저장해 두고, 같은 rid가 다시 오면 다시 실행하지 않고 이 결과만 돌려준다
 */
export interface UseResult {
  ok: boolean;
  /** 실패 이유 (화면 안내용) */
  reason?: string;
  /** 'scheduled' = 제작 완료 후 분리로 예약됨 */
  note?: 'scheduled' | 'cancelled';
  /** 만든 고급 트럭 id */
  vehicle?: number;
  /** 실제로 차감한 보관물 (정류장·창고 건물 id) */
  from?: number;
}

/** 채굴·채취에 연구가 필요한 자원 (regional-v1). 원유·염수는 시추기, 수액은 수액 채취기 */
const ORE_TECH: Partial<Record<ItemId, string>> = {
  'tin-ore': 'alloy',
  bauxite: 'electro-metal',
  sulfur: 'sulfur-chem',
  'crude-oil': 'oil-control',
  brine: 'lithium-storage',
  sap: 'industrial-motor',
};

/** 메인 목표를 이루면 열리는 거점 ('*' = 지도 전체) */
const REVEAL_ON_GOAL: Record<string, string[]> = {
  MG07: ['B', 'H'],
  MG11: ['C'],
  MG14: ['D', 'E'],
  MG19: ['F'],
  MG20: ['G'],
  MG28: ['tin2', 'bauxite2', 'oil2', 'brine2', 'sulfur2', 'rubber2'],
  MG32: ['*'],
};

const SITE_LABEL: Record<string, string> = {
  B: '눈밭 (주석)',
  C: '숲 (고무나무)',
  D: '모래사막 (원유)',
  E: '바위사막 (보크사이트)',
  F: '화산 (황·지열)',
  G: '염호 (염수)',
  H: '조립 부지',
  tin2: '두 번째 주석',
  bauxite2: '두 번째 보크사이트',
  oil2: '두 번째 원유',
  brine2: '두 번째 염수',
  sulfur2: '두 번째 황·지열',
  rubber2: '두 번째 고무나무',
};

/** 이 목표를 이루면 지도에 열리는 곳 이름들 (화면 안내용) */
export function revealPreview(id: string): string[] {
  const list = REVEAL_ON_GOAL[id];
  if (!list) return [];
  return list[0] === '*' ? ['지도 전체'] : list.map((k) => SITE_LABEL[k] ?? k);
}

/** 확인한 땅 가장자리에 지으면 둘레 이만큼 더 보인다 */
const REVEAL_BUILD = 6;

/** 채굴기로는 캐지 않는 자원 칸 (시추기·수액 채취기 전용) */
export const NOT_MINED: ItemId[] = ['water', 'sap', 'crude-oil', 'brine'];

/** 저장해 두는 처리한 명령 결과 수 (오래된 것부터 잊는다) */
const DONE_CMDS_MAX = 512;

/**
 * 현지 실물 명령을 한 번만 적용한다. 같은 rid를 다시 받으면(재전송·재접속) 다시 실행하지 않고 처음 결과를 돌려준다.
 * 실패한 명령도 결과를 남긴다: 다시 하려면 최신 상태를 보고 새 rid로 보낸다
 */
export function applyOnce(w: World, rid: unknown, run: () => UseResult): UseResult {
  if (typeof rid !== 'string' || !rid || rid.length > 64) return { ok: false, reason: '잘못된 명령이에요' };
  const done = w.doneCmds.get(rid);
  if (done) return done;
  const r = run();
  w.doneCmds.set(rid, r);
  if (w.doneCmds.size > DONE_CMDS_MAX) w.doneCmds.delete(w.doneCmds.keys().next().value!);
  return r;
}

/** 플레이어 한 사람의 되돌리기 기록 */
interface EditHistory {
  undo: EditOp[][];
  redo: EditOp[][];
  /** 지금 기록 중인 단계 (beginEdit ~ endEdit 사이에만 기록) */
  batch: EditOp[] | null;
  depth: number;
}

/** 되돌리기 한 단계를 짧게: "짓기 12개, 회전·설정 1개" */
export function describeEdit(ops: EditOp[]): string {
  const count = (...kinds: EditOp['kind'][]) => ops.filter((o) => kinds.includes(o.kind)).length;
  const placed = count('place');
  const removed = count('remove');
  const trucks = count('truck-add', 'truck-remove');
  const routes = count('route');
  const other = ops.length - placed - removed - trucks - routes;
  return [
    placed && `짓기 ${placed}개`,
    removed && `철거 ${removed}개`,
    trucks && `트럭 ${trucks}대`,
    routes && `노선 ${routes}번`,
    other && `회전·설정 ${other}개`,
  ]
    .filter(Boolean)
    .join(', ');
}

/** 되돌리기를 몇 단계까지 기억하는지 */
const UNDO_LIMIT = 100;

/** 지금 속도로 이 시간(분) 안에 바닥날 광맥은 "곧 바닥"으로 알린다 */
export const PATCH_LOW_MIN = 10;

/** 채굴기가 캐고 있는 광맥 하나의 현황 */
export interface PatchReport {
  id: number;
  item: ItemId;
  remaining: number;
  /** 처음 매장량 (남은 비율을 보여 주려고) */
  initial: number;
  /** 이 광맥을 캐는 채굴기 전부의 지금 속도 합 (분당) */
  perMin: number;
  /** 지금 속도로 바닥날 때까지 남은 시간 (분). 바닥났으면 0, 안 캐고 있으면 Infinity */
  etaMin: number;
  /** 이 광맥 위에 놓인 채굴기 */
  miners: Building[];
  /** 광맥 가운데 (칸 좌표, 화면 이동용) */
  x: number;
  y: number;
}

/** 공장 전체에서 아이템 하나가 만들어지고 쓰이는 양 (분당) */
export interface ItemFlow {
  /** 지금 (기계마다 최근 15초 평균을 더한 것) */
  made: number;
  used: number;
  /** 모든 기계가 100%로 돌면 */
  madeMax: number;
  usedMax: number;
  /** 만드는 기계 수, 쓰는 기계 수 (발전기 포함) */
  makers: number;
  users: number;
}

/** 바닥났으면 'empty', 곧 바닥나면 'low', 아니면 null */
export function patchAlert(r: PatchReport): 'empty' | 'low' | null {
  if (r.remaining <= 0) return 'empty';
  return r.etaMin <= PATCH_LOW_MIN ? 'low' : null;
}

/** 기계 하나의 생산 현황. 비율은 모두 0~1 */
export interface MachineStats {
  /** 최대 속도일 때 분당 생산 / 소비 */
  maxOut: ItemStack[];
  maxIn: ItemStack[];
  /** 최대 대비 실제 속도 (가동률) */
  util: number;
  /** 재료 부족·출력 막힘으로 멈춰 있던 비율 */
  starve: number;
  blocked: number;
  /** 작동은 했지만 전력 부족으로 느려져 잃은 비율 */
  lowPower: number;
  /** 놓은 지 얼마 안 돼서 아직 숫자가 불안정함 */
  measuring: boolean;
}

export class World {
  readonly resItem: (ItemId | null)[];
  /** 남은 매장량. Infinity = 무한 */
  readonly resAmount: Float64Array;
  /** 칸마다 건물 id (0 = 비어 있음) */
  readonly occ: Int32Array;
  /**
   * 칸마다 속한 광맥 번호 (0 = 없음). 다 캐서 사라진 칸도 번호는 남겨서,
   * 그 위 채굴기가 저장·불러오기 뒤에도 같은 광맥에서 계속 캔다.
   */
  readonly patchOf: Int32Array;
  /** 칸마다 나무 자람 정도 (0 = 없음, 0~1 = 자라는 중, 1 = 다 자람). 광맥·물·건물 칸에는 없다 */
  readonly tree: Float64Array;
  /** 자라는 중인 나무 칸들 */
  private growing: number[] = [];
  /** 불러온 저장에 나무 층이 있었는지 (숲이 생기기 전 저장이면 false → 자연 숲을 더한다) */
  forestsLoaded = true;
  /** 심어서 다 자란 나무 수 (목표 안내용, 저장하지 않음) */
  treesGrown = 0;
  private patches = new Map<number, Patch>();
  private patchesDirty = true;
  /**
   * 광맥마다 처음 매장량과 광석 종류. 한 번 정하면 유지한다.
   * 다 캐서 칸이 전부 사라진 광맥도 불러온 뒤 "철광맥이 바닥났다"고 알 수 있게.
   */
  private patchMeta = new Map<number, { initial: number; item: ItemId | null }>();
  readonly buildings = new Map<number, Building>();
  nextId = 1;
  /** 도로 위를 달리는 트럭 (건물이 아니라 칸을 차지하지 않는다) */
  readonly vehicles = new Map<number, Vehicle>();
  nextVehicleId = 1;
  nextStationNo = 1;
  /** 도로·정류장이 바뀔 때마다 늘어난다. 트럭은 이게 바뀌면 길을 다시 찾는다 (저장하지 않음) */
  private roadVersion = 0;
  /** 되돌리기 기록. 같이 하는 사람마다 따로 (플레이어 번호 → 기록). 저장하지 않는다 */
  private histories = new Map<number, EditHistory>();
  /** 지금 명령을 낸 플레이어 (0 = 혼자 하거나 호스트). 되돌리기 기록을 이 사람 것에 남긴다 */
  actor = 0;
  /** 창고 id → 같이 합쳐진 창고들 (혼자면 없음). 창고를 짓거나 철거하면 다시 묶는다 (저장하지 않음) */
  private storageGroups = new Map<number, Building[]>();
  private storagesDirty = true;
  /** 되돌리기로 다시 만든 트럭: 예전 id → 새 id */
  private truckAlias = new Map<number, number>();
  hub: Building | null = null;
  stock = new Map<ItemId, number>();
  unlockedBuildings = new Set<BuildingType>(INITIAL_BUILDINGS);
  unlockedRecipes = new Set<string>(INITIAL_RECIPES);
  researched = new Set<string>();
  /** 끝없는 연구 단계 (연구 id → 단계, 없으면 0) */
  levels = new Map<string, number>();
  /** 이룬 목표(가이드)의 제목. 한 번 이루면 저장에 남아 다시 앞 목표로 돌아가지 않는다 */
  guideDone = new Set<string>();
  /** 빈 땅에서 흙을 캘 수 있는지 ("흙 정제" 연구) */
  dirtMining = false;
  power: PowerState = { demand: 0, capacity: HUB_BASE_POWER, supply: 0, satisfaction: 1, charge: 0 };
  time = 0;
  /** 지금까지 돈 틱 수 (저장하지 않는다. 같이 하기 스냅샷에만 넣는다) */
  private tickNo = 0;
  seed = 0;
  /** 세계 규칙 프로필. 기존 저장은 legacy-v042로 읽고 자동으로 바꾸지 않는다 */
  rules: RuleProfile = 'legacy-v042';
  /** 지역 전력 구역 (regional-v1). 허브 구역과, 공급 범위 밖에 놓은 발전기가 만든 구역 */
  zones: Zone[] = [];
  nextZoneId = 1;
  /** 구역마다 이번 틱 전력 (화면용, 매 틱 다시 계산) */
  zoneState = new Map<number, ZoneState>();
  /** 송전 터미널(보내는 쪽 id)마다 이번 틱 보낸 kW */
  linkFlow = new Map<number, number>();
  /** 이번 틱 트럭마다 실제로 받는 충전 kW (구역 충전 예산·전력 비율 반영) */
  private chargeGrant = new Map<number, number>();
  private gridDirty = true;
  private nodeCache = new Map<number, [number, number, number][]>();
  private zoneOfB = new Map<number, number>();
  /** 칸마다 지형 번호 (TERRAIN_IDS). 예전 지도는 null (지형 배율 없음) */
  terrain: Uint8Array | null = null;
  /** 지열 분출구 칸들 (분출구마다 지열 발전소 한 대) */
  vents: number[] = [];
  /**
   * 확인한 땅 (regional-v1). null이면 모두 보인다 (예전 지도). 처음엔 허브 둘레만 보이고,
   * 메인 목표를 이루면 다음 산업의 거점이 길과 함께 열린다. 확인한 땅 가장자리에 지으면 둘레 6칸이 더 보인다
   */
  revealed: Uint8Array | null = null;
  /** 확인한 칸 수 (화면 알림·해시용) */
  revealedCount = 0;
  /** 지도 생성의 거점 자리 (A 시작 ~ H 조립 부지, 두 번째 자원지들). 목표를 이루면 여기를 연다 */
  sites: Record<string, [number, number]> = {};
  /** 현지 회수 더미 (regional-v1). 칸 번호·아이템·회수 사건별 */
  piles: PileEntry[] = [];
  /** 다음 회수 사건 번호 */
  nextPileEv = 1;
  /** 공장 실적 (목표 판정용, regional-v1): 생산·배송·작업 전기·쓰임·허브 프로젝트 */
  stats: FactoryStats = newStats();
  /** 이룬 메인 목표 id (regional-v1) */
  goals = new Set<string>();
  /** 이룬 선택 도전 id */
  challenges = new Set<string>();
  /** 업적 판정 상태 (모든 세계, 예전 세계는 기본 기능 업적만) */
  ach = new AchState();
  /** 이번 틱 최종 소비(작업·충전)에 쓰인 전기를 발전원별로 (kW): hub·solar·wind·geo·hydro·link·storage·coal·fuel */
  powerSrc = new Map<string, number>();
  /** 운송 예약 (출고: 실제 보관물, 입고: 목적지 정류장 풀). 화물이 아니라 권리 표시라 실물 합계에 더하지 않는다 */
  reservations: Reservation[] = [];
  /** 처리한 현지 실물 명령: rid → 결과 (중복 수신은 이 결과만 돌려준다). 넣은 순서대로 오래된 것부터 잊는다 */
  doneCmds = new Map<string, UseResult>();
  /** 실제 사건 기록 (목표 판정용): 모듈을 쓴 배치 완료 수, 고급 트럭이 실제로 내린 개수 */
  moduleBatches = 0;
  advDelivered = 0;

  private layoutDirty = true;
  private beltOrder: Building[] = [];
  private targetCache = new Map<number, OutTarget[]>();
  /** 허브 입고 기록: 1초 단위 버킷 60개 */
  private incomeBuckets: Map<ItemId, number>[] = Array.from({ length: 60 }, () => new Map());
  private incomeSecond = 0;

  constructor(
    readonly width: number,
    readonly height: number,
  ) {
    const n = width * height;
    this.resItem = new Array<ItemId | null>(n).fill(null);
    this.resAmount = new Float64Array(n);
    this.occ = new Int32Array(n);
    this.patchOf = new Int32Array(n);
    this.tree = new Float64Array(n);
  }

  // ───────────────────────── 조회 ─────────────────────────

  get tickCount(): number {
    return this.tickNo;
  }

  inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.width && y < this.height;
  }

  idx(x: number, y: number): number {
    return y * this.width + x;
  }

  buildingAt(x: number, y: number): Building | null {
    if (!this.inBounds(x, y)) return null;
    const id = this.occ[this.idx(x, y)];
    return id ? (this.buildings.get(id) ?? null) : null;
  }

  stockOf(item: ItemId): number {
    return countOf(this.stock, item);
  }

  /** 지역 생산망 확장 세계인지 */
  get regional(): boolean {
    return this.rules === 'regional-v1';
  }

  /** 이 칸을 확인했는지 (예전 지도는 늘 true) */
  isRevealed(i: number): boolean {
    return !this.revealed || this.revealed[i] === 1;
  }

  /** (cx, cy)에서 반지름 r 안을 확인한 땅으로 */
  reveal(cx: number, cy: number, r: number): void {
    if (!this.revealed) return;
    for (let y = Math.max(0, Math.floor(cy - r)); y <= Math.min(this.height - 1, Math.ceil(cy + r)); y++) {
      for (let x = Math.max(0, Math.floor(cx - r)); x <= Math.min(this.width - 1, Math.ceil(cx + r)); x++) {
        if ((x - cx) ** 2 + (y - cy) ** 2 > r * r) continue;
        const i = y * this.width + x;
        if (!this.revealed[i]) {
          this.revealed[i] = 1;
          this.revealedCount++;
        }
      }
    }
  }

  /** 허브에서 (x, y)까지 폭 7칸의 길 후보 띠 (가로 먼저, 그다음 세로) */
  private revealRoad(x: number, y: number): void {
    const a = this.sites.A;
    if (!a) return;
    const step = (fx: number, fy: number, tx: number, ty: number) => {
      const n = Math.max(Math.abs(tx - fx), Math.abs(ty - fy));
      for (let k = 0; k <= n; k += 2) this.reveal(fx + ((tx - fx) * k) / Math.max(1, n), fy + ((ty - fy) * k) / Math.max(1, n), 3.5);
    };
    step(a[0], a[1], x, a[1]);
    step(x, a[1], x, y);
  }

  /** 목표를 이루면 열리는 거점 (기획의 생산 순서: 주석·조립 부지 → 숲 → 사막 → 화산·염호 → 두 번째 자원지 → 전체) */
  revealForGoal(id: string): string[] {
    if (!this.revealed) return [];
    const list = REVEAL_ON_GOAL[id];
    if (!list) return [];
    if (list[0] === '*') {
      this.revealed.fill(1);
      this.revealedCount = this.revealed.length;
      return ['지도 전체'];
    }
    const names: string[] = [];
    for (const key of list) {
      const s = this.sites[key];
      if (!s) continue;
      this.revealRoad(s[0], s[1]);
      this.reveal(s[0], s[1], key.endsWith('2') ? 20 : 26);
      names.push(SITE_LABEL[key] ?? key);
    }
    return names;
  }

  /** 칸의 지형 (예전 지도는 늘 초원) */
  terrainAt(i: number): TerrainKind {
    return this.terrain ? TERRAIN_IDS[this.terrain[i]] : 'grass';
  }

  /** 건물 기준 칸 (왼쪽 위에서 floor(크기/2)). 전력·지형 판정에 쓴다 */
  refTile(b: { x: number; y: number; size: number }): number {
    const h = Math.floor(b.size / 2);
    return this.idx(b.x + h, b.y + h);
  }

  /** regional-v1: 그 칸 지형의 지금 날씨 효과 (틱마다 지형별로 한 번만 계산). 예전 세계는 맑음 */
  weatherEffect(i: number): WeatherFx {
    if (!this.regional) return WEATHER_FX.clear;
    return this.localWeather(this.terrainAt(i)).fx;
  }

  /** regional-v1: 지형의 지금 날씨 */
  localWeather(t: TerrainKind): { kind: LocalWeather; fx: WeatherFx; strength: number } {
    if (this.wxTime !== this.time) {
      this.wxTime = this.time;
      this.wxCache.clear();
    }
    let w = this.wxCache.get(t);
    if (!w) this.wxCache.set(t, (w = localWeather(this.seed, this.time, t)));
    return w;
  }
  private wxTime = -1;
  private wxCache = new Map<TerrainKind, { kind: LocalWeather; fx: WeatherFx; strength: number }>();

  /** 수액 채취기 몸체에 상하좌우로 맞닿은 고무나무 군락 (광맥 번호, 가장 작은 것 하나) */
  groveOf(b: { x: number; y: number; size: number }): number[] {
    this.ensurePatches();
    let best = 0;
    for (const [nx, ny] of edgeNeighbors(b as Building)) {
      if (!this.inBounds(nx, ny)) continue;
      const i = this.idx(nx, ny);
      if (this.resItem[i] !== 'sap') continue;
      const p = this.patchOf[i];
      if (p && (!best || p < best)) best = p;
    }
    return best ? [best] : [];
  }

  /** 고무나무 군락 하나에 붙은 수액 채취기 수 */
  groveUsers(grove: number): number {
    let n = 0;
    for (const b of this.buildings.values()) if (b.type === 'sap-extractor' && b.minePatches[0] === grove) n++;
    return n;
  }

  /** 이 아이템을 캘 연구가 있는지 (regional-v1의 주석·보크사이트·황). 없으면 필요한 연구 id */
  oreLock(item: ItemId | null): string | null {
    if (!item || !this.regional) return null;
    const need = ORE_TECH[item];
    return need && !this.researched.has(need) ? need : null;
  }

  /** 이 세계의 연구 목록 */
  get techs(): Tech[] {
    return techsFor(this.rules);
  }

  tech(id: string): Tech | undefined {
    return techFor(this.rules, id);
  }

  canAfford(cost: ItemStack[]): boolean {
    return cost.every((c) => this.stockOf(c.item) >= c.count);
  }

  recipeOf(b: Building): Recipe | null {
    return b.recipe ? (RECIPES[b.recipe] ?? null) : null;
  }

  /** 최근 60초 동안 허브에 들어온 개수 */
  incomePerMinute(item: ItemId): number {
    let sum = 0;
    for (const bucket of this.incomeBuckets) sum += bucket.get(item) ?? 0;
    return sum;
  }

  setResource(x: number, y: number, item: ItemId | null, amount: number): void {
    const i = this.idx(x, y);
    this.resItem[i] = item;
    this.resAmount[i] = item ? amount : 0;
    this.patchesDirty = true;
  }

  // ───────────────────────── 광맥 ─────────────────────────

  /** 이어진 같은 광석 칸들을 한 광맥으로 묶는다. 이미 번호가 있는 칸은 그대로 둔다. */
  private assignPatches(): void {
    let next = 1;
    for (let i = 0; i < this.patchOf.length; i++) next = Math.max(next, this.patchOf[i] + 1);
    const stack: number[] = [];
    for (let s = 0; s < this.resItem.length; s++) {
      const item = this.resItem[s];
      if (!item || item === 'water' || this.patchOf[s]) continue;
      const id = next++;
      this.patchOf[s] = id;
      stack.push(s);
      while (stack.length) {
        const i = stack.pop()!;
        const x = i % this.width;
        const y = (i - x) / this.width;
        for (let d = 0; d < 4; d++) {
          const nx = x + DX[d];
          const ny = y + DY[d];
          if (!this.inBounds(nx, ny)) continue;
          const j = this.idx(nx, ny);
          if (this.patchOf[j] || this.resItem[j] !== item) continue;
          this.patchOf[j] = id;
          stack.push(j);
        }
      }
    }
  }

  /** patchOf 로 광맥마다 캐는 순서(바깥 칸부터)와 남은 양을 만든다 */
  private indexPatches(): void {
    this.patches.clear();
    const members = new Map<number, number[]>();
    for (let i = 0; i < this.patchOf.length; i++) {
      const p = this.patchOf[i];
      if (!p) continue;
      let list = members.get(p);
      if (!list) members.set(p, (list = []));
      list.push(i);
    }
    for (const [id, tiles] of members) {
      // 가장자리(광맥 밖과 맞닿은 칸)를 0으로, 안쪽으로 한 칸씩 깊어진다. 원래 모양 기준.
      const depth = new Map<number, number>();
      const queue: number[] = [];
      for (const i of tiles) {
        const x = i % this.width;
        const y = (i - x) / this.width;
        let edge = false;
        for (let d = 0; d < 4 && !edge; d++) {
          const nx = x + DX[d];
          const ny = y + DY[d];
          edge = !this.inBounds(nx, ny) || this.patchOf[this.idx(nx, ny)] !== id;
        }
        if (edge) {
          depth.set(i, 0);
          queue.push(i);
        }
      }
      for (let q = 0; q < queue.length; q++) {
        const i = queue[q];
        const x = i % this.width;
        const y = (i - x) / this.width;
        for (let d = 0; d < 4; d++) {
          if (!this.inBounds(x + DX[d], y + DY[d])) continue;
          const j = this.idx(x + DX[d], y + DY[d]);
          if (this.patchOf[j] !== id || depth.has(j)) continue;
          depth.set(j, depth.get(i)! + 1);
          queue.push(j);
        }
      }
      // 같은 깊이 안에서는 칸마다 섞어서, 테두리가 한 줄씩 깎이지 않고 울퉁불퉁하게 줄어든다
      const order = [...tiles].sort((a, b) => depth.get(a)! - depth.get(b)! || tileHash(a) - tileHash(b));
      let remaining = 0;
      let item: ItemId | null = null;
      let sx = 0;
      let sy = 0;
      for (const i of tiles) {
        remaining += this.resAmount[i];
        item ??= this.resItem[i];
        sx += i % this.width;
        sy += Math.floor(i / this.width);
      }
      const meta = this.patchMeta.get(id);
      item ??= meta?.item ?? null;
      const initial = Math.max(meta?.initial ?? 0, remaining);
      this.patchMeta.set(id, { initial, item });
      const cx = sx / tiles.length + 0.5;
      const cy = sy / tiles.length + 0.5;
      this.patches.set(id, { item, order, cursor: 0, remaining, initial, cx, cy });
    }
  }

  private ensurePatches(): void {
    if (!this.patchesDirty) return;
    this.patchesDirty = false;
    this.assignPatches();
    this.indexPatches();
    for (const b of this.buildings.values()) {
      if (isMinerType(b.type) && b.type !== 'pump') b.minePatches = this.patchesUnder(b);
    }
  }

  /** 건물 밑 칸들이 속한 광맥 번호 */
  private patchesUnder(b: Building): number[] {
    const ids = new Set<number>();
    for (let dy = 0; dy < b.size; dy++) {
      for (let dx = 0; dx < b.size; dx++) {
        const p = this.patchOf[this.idx(b.x + dx, b.y + dy)];
        const item = p ? this.patches.get(p)?.item : null;
        if (p && this.patches.has(p) && !(item && NOT_MINED.includes(item))) ids.add(p);
      }
    }
    return [...ids];
  }

  private underMiner(i: number): boolean {
    const id = this.occ[i];
    const b = id ? this.buildings.get(id) : undefined;
    return !!b && isMinerType(b.type);
  }

  /**
   * 광맥에서 하나 캔다. 바깥 칸부터 줄고, 다 캔 칸은 사라진다.
   * 채굴기가 깔고 있는 칸은 맨 나중에 (채굴기가 맨땅에서 캐는 것처럼 보이지 않게).
   */
  private takeFromPatch(p: Patch): ItemId | null {
    if (!p.item || p.remaining <= 0) return null;
    if (p.remaining === Infinity) return p.item;
    let pick = -1;
    let fallback = -1;
    for (let k = p.cursor; k < p.order.length; k++) {
      const i = p.order[k];
      if (this.resAmount[i] <= 0) {
        if (k === p.cursor) p.cursor++;
        continue;
      }
      if (this.underMiner(i)) {
        if (fallback < 0) fallback = i;
        continue;
      }
      pick = i;
      break;
    }
    const i = pick >= 0 ? pick : fallback;
    if (i < 0) {
      p.remaining = 0;
      return null;
    }
    this.resAmount[i] -= 1;
    p.remaining -= 1;
    if (this.resAmount[i] <= 0) {
      this.resAmount[i] = 0;
      this.resItem[i] = null;
      // 광맥의 마지막 칸 (H03)
      if (p.remaining <= 0) this.ach.lastOre.add(i);
    }
    return p.item;
  }

  /** 채굴기가 캐는 광맥 전체에 남은 양 (흙·물은 무한) */
  mineRemaining(b: Building): number {
    if (b.mineDirt || b.type === 'pump') return Infinity;
    this.ensurePatches();
    let sum = 0;
    for (const id of b.minePatches) sum += this.patches.get(id)?.remaining ?? 0;
    return sum;
  }

  /** 그 칸이 속한 광맥 전체에 남은 양. 광맥이 아니면 null */
  patchRemainingAt(i: number): number | null {
    this.ensurePatches();
    const p = this.patches.get(this.patchOf[i]);
    return p ? p.remaining : null;
  }

  /**
   * 채굴기가 캐고 있는 유한 광맥들 (돌 광맥처럼 무한인 곳은 빼고).
   * 속도는 그 광맥 위 채굴기 전부의 최근 생산을 합친 것. 여러 광맥에 걸친 채굴기는 남은 광맥끼리 나눈다.
   * 바닥난 광맥도 위에 채굴기가 남아 있으면 넣는다 (옮기라고 알려 주려고).
   */
  patchReports(): PatchReport[] {
    this.ensurePatches();
    const byPatch = new Map<number, PatchReport>();
    for (const b of this.buildings.values()) {
      if (!isMinerType(b.type) || b.type === 'pump' || b.mineDirt) continue;
      const alive = b.minePatches.filter((id) => (this.patches.get(id)?.remaining ?? 0) > 0);
      const st = alive.length ? this.machineStats(b) : null;
      const share = st ? (st.maxOut[0].count * st.util) / alive.length : 0;
      for (const id of b.minePatches) {
        const p = this.patches.get(id);
        if (!p?.item || p.remaining === Infinity) continue;
        let r = byPatch.get(id);
        if (!r) {
          r = { id, item: p.item, remaining: p.remaining, initial: p.initial, perMin: 0, etaMin: Infinity, miners: [], x: p.cx, y: p.cy };
          byPatch.set(id, r);
        }
        r.miners.push(b);
        if (p.remaining > 0) r.perMin += share;
      }
    }
    for (const r of byPatch.values()) {
      r.etaMin = r.remaining <= 0 ? 0 : r.perMin > 0 ? r.remaining / r.perMin : Infinity;
    }
    return [...byPatch.values()];
  }

  /** 맵의 모든 광맥: 광석 종류, 남은 양, 처음 양, 가운데 칸 좌표, 위에 놓인 채굴기 수 */
  patchList(): { id: number; item: ItemId; remaining: number; initial: number; x: number; y: number; miners: number }[] {
    this.ensurePatches();
    const miners = new Map<number, number>();
    for (const b of this.buildings.values()) for (const p of b.minePatches) miners.set(p, (miners.get(p) ?? 0) + 1);
    const list = [];
    for (const [id, p] of this.patches) {
      if (!p.item) continue;
      list.push({ id, item: p.item, remaining: p.remaining, initial: p.initial, x: p.cx, y: p.cy, miners: miners.get(id) ?? 0 });
    }
    return list;
  }

  /** 그 칸이 속한 광맥의 처음 매장량. 광맥이 아니면 null */
  patchInitialAt(i: number): number | null {
    this.ensurePatches();
    return this.patches.get(this.patchOf[i])?.initial ?? null;
  }

  private savedPatches(): [number, number][] {
    this.ensurePatches();
    const out: [number, number][] = [];
    for (let i = 0; i < this.patchOf.length; i++) if (this.patchOf[i]) out.push([i, this.patchOf[i]]);
    return out;
  }

  /** 예전 맵의 먼 광맥(맵 가운데에서 20칸 이상)을 f배로 줄인다. 허브 근처 시작 광맥은 그대로. */
  scaleFarOre(f: number): void {
    const cx = this.width / 2;
    const cy = this.height / 2;
    for (let i = 0; i < this.resItem.length; i++) {
      const item = this.resItem[i];
      const a = this.resAmount[i];
      if (!item || item === 'water' || a === Infinity) continue;
      const x = i % this.width;
      const y = (i - x) / this.width;
      if (Math.hypot(x + 0.5 - cx, y + 0.5 - cy) < 20) continue;
      this.resAmount[i] = Math.max(1, Math.round(a * f));
    }
    this.patchesDirty = true;
  }

  // ───────────────────────── 건설 ─────────────────────────

  /** 배치할 때 커서 칸을 기준으로 한 건물 왼쪽 위 좌표 */
  static originFor(type: BuildingType, cx: number, cy: number): [number, number] {
    const off = Math.floor((BUILDINGS[type].size - 1) / 2);
    return [cx - off, cy - off];
  }

  /**
   * replaceBelts = true면 자리에 깔린 컨베이어는 걸림돌로 치지 않는다 (놓을 때 철거·환급).
   * 비용도 그 컨베이어를 돌려받은 뒤 기준으로 따진다.
   */
  canPlace(type: BuildingType, x: number, y: number, replaceBelts = false): PlaceCheck {
    const def = BUILDINGS[type];
    const replacing = replaceBelts && !isBeltType(type);
    for (let dy = 0; dy < def.size; dy++) {
      for (let dx = 0; dx < def.size; dx++) {
        if (!this.inBounds(x + dx, y + dy)) return { ok: false, reason: '맵 밖' };
        if (!this.isRevealed(this.idx(x + dx, y + dy))) return { ok: false, reason: '아직 모르는 땅 (목표를 이루거나 가장자리에 지어 넓혀요)' };
        const occupant = this.buildingAt(x + dx, y + dy);
        if (occupant && !(replacing && isBeltType(occupant.type))) return { ok: false, reason: '이미 건물이 있음' };
      }
    }
    if (type !== 'hub' && !this.unlockedBuildings.has(type)) {
      return { ok: false, reason: '잠김 (연구 필요)' };
    }
    // 호수: 양수기만 물 위에 놓을 수 있다 (다른 건 지하 컨베이어로 건너간다)
    const water = this.waterTilesUnder(x, y, def.size);
    if (type === 'pump' && water === 0) return { ok: false, reason: '호수 위에 놓아야 함' };
    if (type !== 'pump' && water > 0) return { ok: false, reason: '물 위에는 지을 수 없음' };
    // 고무나무 위에는 짓지 않는다 (나무를 베지 않고 옆에서 수액을 받는다)
    for (let dy = 0; dy < def.size; dy++) {
      for (let dx = 0; dx < def.size; dx++) {
        if (this.resItem[this.idx(x + dx, y + dy)] === 'sap') return { ok: false, reason: '고무나무 위에는 지을 수 없음' };
      }
    }
    if (type === 'geothermal' && !this.vents.includes(this.refTile({ x, y, size: def.size }))) {
      return { ok: false, reason: '가운데 칸을 지열 분출구 위에 놓아야 함' };
    }
    if (isMinerType(type) && type !== 'pump') {
      for (let dy = 0; dy < def.size; dy++) {
        for (let dx = 0; dx < def.size; dx++) {
          const it = this.resItem[this.idx(x + dx, y + dy)];
          if (it === 'crude-oil' || it === 'brine') return { ok: false, reason: '원유·염수 지점에는 시추기를 놓아요' };
        }
      }
    }
    if (type === 'sap-extractor' && !this.groveOf({ x, y, size: def.size }).length) return { ok: false, reason: '고무나무 군락에 맞닿게 놓아야 함' };
    if (type === 'drill') {
      const i = this.refTile({ x, y, size: def.size });
      const item = this.resItem[i];
      if (item !== 'crude-oil' && item !== 'brine') return { ok: false, reason: '오른쪽 아래 칸을 원유·염수 지점 위에 놓아야 함' };
      const lock = this.oreLock(item);
      if (lock) return { ok: false, reason: `연구 "${this.tech(lock)?.name}" 뒤에 ${item === 'brine' ? '염수' : '원유'}를 뽑아요` };
    }
    if (
      isMinerType(type) &&
      type !== 'pump' &&
      !this.dirtMining &&
      this.mineTilesFor(type, x, y, def.size).length === 0
    ) {
      return { ok: false, reason: '광맥 위에 놓아야 함 (빈 땅의 흙은 "흙 정제" 연구 후)' };
    }
    const refund = replacing ? this.beltsUnder(type, x, y).length : 0;
    const beltCost = BUILDINGS.belt.cost;
    const affordable = def.cost.every((c) => {
      const back = beltCost.find((b) => b.item === c.item)?.count ?? 0;
      return this.stockOf(c.item) + back * refund >= c.count;
    });
    if (!affordable) return { ok: false, reason: '재료 부족' };
    return { ok: true };
  }

  /** 배치 자리(왼쪽 위 x, y)에 깔린 컨베이어들 */
  beltsUnder(type: BuildingType, x: number, y: number): Building[] {
    const size = BUILDINGS[type].size;
    const res: Building[] = [];
    for (let dy = 0; dy < size; dy++) {
      for (let dx = 0; dx < size; dx++) {
        const b = this.buildingAt(x + dx, y + dy);
        if (b && isBeltType(b.type)) res.push(b);
      }
    }
    return res;
  }

  /**
   * 컨베이어 위에 놓을 때 이어지도록 고를 방향 (출구가 흐름 방향을 향하게).
   * 커서 칸(hx, hy)의 컨베이어 방향을 우선하고, 없으면 덮는 컨베이어 중 가장 많은 방향. 컨베이어가 없으면 null.
   */
  flowDirUnder(type: BuildingType, x: number, y: number, hx: number, hy: number): Dir | null {
    const belts = this.beltsUnder(type, x, y);
    if (belts.length === 0) return null;
    const hovered = this.buildingAt(hx, hy);
    if (hovered && isBeltType(hovered.type)) return hovered.dir;
    const count = [0, 0, 0, 0];
    for (const b of belts) count[b.dir]++;
    return count.indexOf(Math.max(...count)) as Dir;
  }

  /**
   * 하역기를 (x, y)에 놓을 때 뒤(입구)가 허브·창고에 닿는 방향.
   * preferred가 맞으면 그대로, 아니면 맞는 방향 아무거나. 옆에 허브·창고가 없으면 null.
   */
  unloaderDir(x: number, y: number, preferred: Dir): Dir | null {
    const ok = (d: Dir) => {
      const n = this.buildingAt(x - DX[d], y - DY[d]);
      return !!n && (n.type === 'hub' || n.type === 'storage');
    };
    if (ok(preferred)) return preferred;
    for (const d of [0, 1, 2, 3] as Dir[]) if (ok(d)) return d;
    return null;
  }

  /**
   * 건물(주로 스마트 분류기)로 들어오는 줄을 거꾸로 따라가서, 이 줄에 들어올 수 있는 아이템과
   * 그 아이템을 넣는 건물들을 찾는다. 컨베이어·지하 컨베이어·분배기·병합기는 지나가고,
   * 채굴기·기계·하역기에서 멈춘다. 지금 줄 위에 있는 아이템도 함께 센다.
   */
  upstream(start: Building): { items: ItemId[]; sources: Building[] } {
    const items = new Set<ItemId>();
    const sources = new Map<number, Building>();
    const seen = new Set<number>([start.id]);
    const queue: Building[] = [start];
    // 이 노드(건물)가 d 방향 이웃에게서 받을 수 있는지
    const accepts = (node: Building, d: Dir) =>
      isLineType(node.type) ? entryPos(node, d) >= 0 : acceptsFrom(node, d);
    while (queue.length && seen.size < 2000) {
      const node = queue.shift()!;
      for (const it of node.items) items.add(it.item);
      if (node.held) items.add(node.held);
      for (const [nx, ny, d] of edgeNeighbors(node)) {
        if (!accepts(node, d)) continue;
        const n = this.buildingAt(nx, ny);
        if (!n || seen.has(n.id)) continue;
        const toward = opposite(d); // n에서 node 쪽 방향
        let next: Building | null = null;
        if (isBeltType(n.type)) {
          if (n.dir === toward) next = n;
        } else if (n.type === 'underground') {
          // 지하 출구에서 나온 것이면 땅속을 지나 입구로
          if (n.ugMode === 'out' && n.dir === toward) next = this.partnerOf(n);
          if (next) seen.add(n.id);
        } else if (outputsToward(n, toward)) {
          if (isSplitterType(n.type) || n.type === 'merger') next = n;
          else {
            seen.add(n.id);
            sources.set(n.id, n);
            for (const it of this.possibleOutputs(n)) items.add(it);
          }
        }
        if (next && !seen.has(next.id)) {
          seen.add(next.id);
          queue.push(next);
        }
      }
    }
    return { items: ITEM_IDS.filter((i) => items.has(i)), sources: [...sources.values()] };
  }

  /** 이 건물이 내보낼 수 있는 아이템. 레시피를 아직 안 정한 기계는 정할 수 있는 레시피의 결과 전부 */
  possibleOutputs(b: Building): ItemId[] {
    if (b.mineDirt) return ['dirt'];
    if (b.type === 'pump') return ['water'];
    if (isMinerType(b.type)) {
      this.ensurePatches();
      return b.minePatches.map((p) => this.patches.get(p)?.item).filter((i): i is ItemId => !!i);
    }
    if (b.type === 'unloader') {
      if (b.filter) return [b.filter];
      // 안 골랐으면 붙은 허브·창고에 든 것 전부
      const src = this.buildingAt(b.x - DX[b.dir], b.y - DY[b.dir]);
      if (src?.type === 'hub') return ITEM_IDS.filter((i) => this.stockOf(i) > 0);
      if (src?.type === 'storage') return [...this.storageContents(src).keys()];
      return [];
    }
    if (b.type === 'station') {
      // 내리기 정류장: 쌓인 것 + 여기로 오는 트럭의 짐 + 그 트럭이 싣는 정류장에 쌓인 것
      const items = new Set(b.outBuf.keys());
      for (const v of this.vehicles.values()) {
        if (!v.stops.some((s) => s.act === 'unload' && s.id === b.id)) continue;
        for (const i of v.cargo.keys()) items.add(i);
        for (const s of v.stops) if (s.act === 'load') for (const i of this.buildings.get(s.id)?.inBuf.keys() ?? []) items.add(i);
      }
      return [...items];
    }
    if (isRecipeMachine(b.type)) {
      const r = this.recipeOf(b);
      const rs = r
        ? [r]
        : Object.values(RECIPES).filter((x) => x.machine === b.type && this.unlockedRecipes.has(x.id));
      return [...new Set(rs.flatMap((x) => x.outputs.map((o) => o.item)))];
    }
    return [];
  }

  place(type: BuildingType, x: number, y: number, dir: Dir, free = false, replaceBelts = false): Building | null {
    if (!free && !this.canPlace(type, x, y, replaceBelts).ok) return null;
    if (replaceBelts && !isBeltType(type)) for (const belt of this.beltsUnder(type, x, y)) this.remove(belt);
    const def = BUILDINGS[type];
    if (!free) for (const c of def.cost) addTo(this.stock, c.item, -c.count);
    // 나무 위에 지으면 나무를 벤다 (다 자란 나무는 통나무로 돌려준다)
    for (let dy = 0; dy < def.size; dy++) {
      for (let dx = 0; dx < def.size; dx++) {
        if (this.clearTree(this.idx(x + dx, y + dy)) && !free) addTo(this.stock, 'log', FOREST.logs);
      }
    }
    const b = new Building(this.nextId++, type, x, y, dir);
    this.attach(b);
    // 광맥이 없는 땅에 놓은 채굴기는 흙을 캔다 (광맥 위에 놓은 건 광맥이 바닥나면 멈춘다)
    if (isMinerType(type) && type !== 'pump' && b.mineTiles.length === 0) b.mineDirt = true;
    if (type === 'station') b.stationNo = this.nextStationNo++;
    this.assignZone(b);
    if (type === 'wind' && !free) {
      const kind = this.regional ? this.localWeather(this.terrainAt(this.refTile(b))).kind : weatherAt(this.seed, this.time).kind;
      if (kind === 'cloudy' || kind === 'rain' || kind === 'storm') this.ach.num.set(`ww:${b.id}`, 1);
    }
    // 지은 자리 둘레를 확인한 땅으로 (도로를 깔며 조금씩 나아갈 수 있게)
    if (this.revealed && !free) this.reveal(b.x + b.size / 2 - 0.5, b.y + b.size / 2 - 0.5, REVEAL_BUILD + b.size / 2);
    if (type === 'underground') {
      const plan = this.undergroundPlan(x, y, dir);
      b.ugMode = plan.mode;
      if (plan.partner) {
        b.partner = plan.partner.id;
        plan.partner.partner = b.id;
      }
    }
    this.record({ kind: 'place', type, x, y, dir });
    return b;
  }

  /**
   * (x, y)에 dir 방향 지하 컨베이어를 놓으면 입구/출구 중 무엇이 되고 누구와 짝이 되는지.
   * - 뒤쪽 최대 간격 안에 짝 없는 같은 방향 입구가 있으면 그 출구
   * - 아니면 입구. 앞쪽에 짝 잃은 같은 방향 출구가 있으면 그와 짝
   * 가장 가까운 같은 방향 지하 컨베이어만 본다.
   */
  undergroundPlan(x: number, y: number, dir: Dir): { mode: 'in' | 'out'; partner: Building | null } {
    const nearest = (sign: number) => {
      for (let k = 1; k <= UNDERGROUND_MAX_GAP + 1; k++) {
        const n = this.buildingAt(x + DX[dir] * k * sign, y + DY[dir] * k * sign);
        if (n?.type === 'underground' && n.dir === dir) return n;
      }
      return null;
    };
    const back = nearest(-1);
    if (back?.ugMode === 'in' && !back.partner) return { mode: 'out', partner: back };
    const front = nearest(1);
    if (front?.ugMode === 'out' && !front.partner) return { mode: 'in', partner: front };
    return { mode: 'in', partner: null };
  }

  partnerOf(b: Building): Building | null {
    return b.partner ? (this.buildings.get(b.partner) ?? null) : null;
  }

  /** 아이템이 지나가는 길이 (칸). 지하 입구는 출구 앞 가장자리까지 */
  beltLength(b: Building): number {
    const p = b.type === 'underground' && b.ugMode === 'in' ? this.partnerOf(b) : null;
    return p ? Math.abs(p.x - b.x) + Math.abs(p.y - b.y) + 1 : 1;
  }

  /** 허브를 놓는다. 아래 자원은 지운다. */
  createHub(x: number, y: number): Building {
    for (let dy = 0; dy < 3; dy++) for (let dx = 0; dx < 3; dx++) this.setResource(x + dx, y + dy, null, 0);
    const b = this.place('hub', x, y, 0, true)!;
    this.hub = b;
    this.ensureHubZone();
    return b;
  }

  /** 건물을 맵에 연결한다 (비용 처리 없음). 불러오기에서도 쓴다. */
  attach(b: Building): void {
    for (let dy = 0; dy < b.size; dy++) {
      for (let dx = 0; dx < b.size; dx++) this.occ[this.idx(b.x + dx, b.y + dy)] = b.id;
    }
    if (isMinerType(b.type)) b.mineTiles = this.mineTilesFor(b.type, b.x, b.y, b.size);
    // 벌목기·식목기: 둘레 범위 칸들 (건물은 움직이지 않으니 한 번만)
    if (isForestType(b.type)) b.mineTiles = this.forestTiles(b);
    if (isMinerType(b.type) && b.type !== 'pump') {
      this.ensurePatches();
      b.minePatches = this.patchesUnder(b);
    }
    // 수액 채취기: 몸체에 맞닿은 고무나무 군락(광맥 번호), 시추기: 기준 칸의 원유·염수 지점
    if (b.type === 'sap-extractor') {
      this.ensurePatches();
      b.minePatches = this.groveOf(b);
    }
    if (b.type === 'drill') b.mineTiles = [this.refTile(b)];
    if (b.type === 'hub') this.hub = b;
    if (b.type === 'road' || b.type === 'station' || b.type === 'charger') this.roadVersion++;
    if (b.type === 'storage') this.storagesDirty = true;
    this.buildings.set(b.id, b);
    this.nextId = Math.max(this.nextId, b.id + 1);
    this.layoutDirty = true;
  }

  /**
   * 철거. 건설 비용은 100% 허브로 돌려준다. 안에 든 아이템은 예전 세계면 허브로,
   * regional-v1이면 그 자리의 현지 회수 더미로 (장착 모듈도 같은 회수 사건으로)
   */
  remove(b: Building): boolean {
    if (b.type === 'hub') return false;
    const ev = this.regional ? this.nextPileEv++ : 0;
    this.record({
      kind: 'remove',
      type: b.type,
      x: b.x,
      y: b.y,
      dir: b.dir,
      recipe: b.recipe,
      filter: b.filter,
      mode: b.stationMode,
      no: b.stationNo,
      ug: b.ugMode,
      id: b.id,
      ...(b.module ? { mod: ev } : {}),
    });
    for (const c of b.def.cost) addTo(this.stock, c.item, c.count);
    if (b.type === 'terminal' && b.partner) this.unlinkTerminal(b);
    this.refundContents(b, 'remove', ev);
    this.dropModule(b, 'remove', ev);
    const partner = this.partnerOf(b);
    if (partner) {
      partner.partner = 0;
      // 출구가 사라지면 땅속에 있던 아이템은 갈 곳이 없으니 돌려준다
      if (b.ugMode === 'out') this.refundContents(partner, 'remove', ev);
    }
    for (let dy = 0; dy < b.size; dy++) {
      for (let dx = 0; dx < b.size; dx++) this.occ[this.idx(b.x + dx, b.y + dy)] = 0;
    }
    if (b.type === 'road' || b.type === 'station' || b.type === 'charger') this.roadVersion++;
    if (b.type === 'storage') this.storagesDirty = true;
    // 사라진 보관물·목적지에 걸린 예약은 끝낸다 (창고군이 바뀌면 그 정류장들의 싣기 예약도 다시)
    if (this.reservations.length && (b.type === 'station' || b.type === 'storage')) {
      this.reservations = this.reservations.filter((r) => r.holder !== b.id);
      if (b.type === 'storage') this.reservations = this.reservations.filter((r) => r.dir === 'in');
    }
    this.buildings.delete(b.id);
    this.layoutDirty = true;
    // 전봇대를 뜯으면 다음 틱을 기다리지 않고 바로 끊긴 것을 보여 준다
    this.gridDirty = true;
    return true;
  }

  /** 지금 하는 작업 1회에 걸리는 시간 (초) */
  craftTime(b: Building): number {
    // 양수기는 비·폭풍에 더 많이 퍼 올린다 (전력도 그만큼)
    if (b.type === 'pump' && this.regional) return 1 / ((b.def.speed ?? 1) * this.boost('endless-mining') * this.weatherEffect(this.refTile(b)).pump);
    if (isMinerType(b.type)) return 1 / ((b.def.speed ?? 1) * this.boost('endless-mining'));
    if (b.type === 'drill') return EXTRACT.drillTime / this.boost('endless-mining');
    if (b.type === 'sap-extractor') {
      // 군락 하나에 채취기가 4대를 넘으면 군락 한도(분당 120개)를 나눠 받는다
      const n = this.groveUsers(b.minePatches[0] ?? 0);
      return (EXTRACT.sapTime * Math.max(1, n / EXTRACT.groveMax)) / this.boost('endless-mining');
    }
    if (b.type === 'lumberjack') return FOREST.cut / this.boost('endless-mining');
    if (b.type === 'planter') return FOREST.plant;
    // 모듈을 쓰는 배치는 연구 적용값보다 1.2배 빠르다 (배치를 시작할 때 정해진다)
    return (this.recipeOf(b)?.time ?? 1) / this.boost('endless-crafting') / (b.modBatch ? MODULE.speed : 1);
  }

  /** 작동 중 전력 (kW). 모듈을 쓰는 배치는 1.25배 */
  workPower(b: Building): number {
    const pump = b.type === 'pump' && this.regional ? this.weatherEffect(this.refTile(b)).pump : 1;
    return b.def.power * (b.modBatch ? MODULE.power : 1) * pump;
  }

  /** 끝없는 연구로 빨라진 배율 (1 = 그대로, 3단계면 1.3) */
  boost(id: string): number {
    const t = ENDLESS_BY_ID[id];
    return 1 + (t ? t.step * (this.levels.get(id) ?? 0) : 0);
  }

  /** 채굴기·제련로·조립기의 최근 생산 현황. 그 밖의 건물이나 레시피가 없으면 null */
  machineStats(b: Building): MachineStats | null {
    // 식목기는 나무가 자라는 속도에 묶여 있어 가동률이 의미 없다
    if (!isCrafter(b) || b.type === 'planter') return null;
    let maxOut: ItemStack[];
    let maxIn: ItemStack[] = [];
    if (isMinerType(b.type)) {
      const tile = b.mineTiles.find((i) => this.resItem[i]);
      const patchItem = b.minePatches.map((p) => this.patches.get(p)?.item).find(Boolean) ?? null;
      const item = b.mineDirt
        ? 'dirt'
        : b.type === 'pump'
          ? tile !== undefined
            ? this.resItem[tile]
            : null
          : patchItem;
      if (!item) return null;
      maxOut = [{ item, count: 60 / this.craftTime(b) }];
    } else if (isExtractorType(b.type)) {
      const item = b.type === 'sap-extractor' ? 'sap' : this.resItem[b.mineTiles[0]];
      if (!item) return null;
      maxOut = [{ item, count: 60 / this.craftTime(b) }];
    } else if (b.type === 'lumberjack') {
      const perMin = 60 / this.craftTime(b);
      maxOut = [
        { item: 'log', count: FOREST.logs * perMin },
        { item: 'sapling', count: perMin },
      ];
    } else {
      const r = this.recipeOf(b);
      if (!r) return null;
      const perMin = 60 / this.craftTime(b);
      maxOut = r.outputs.map((o) => ({ item: o.item, count: o.count * perMin }));
      maxIn = r.inputs.map((i) => ({ item: i.item, count: i.count * perMin }));
    }
    // 처음엔 0에서 시작하는 평균이라 낮게 나오므로, 지난 시간만큼 보정한다
    const s = b.stats;
    const c = 1 - Math.exp(-s.age / STATS_TAU);
    const fix = (v: number) => (c > 1e-6 ? Math.min(1, v / c) : 0);
    const util = fix(s.eff);
    return {
      maxOut,
      maxIn,
      util,
      starve: fix(s.starve),
      blocked: fix(s.blocked),
      lowPower: Math.max(0, fix(s.work) - util),
      measuring: s.age < 3,
    };
  }

  /** 공장 전체 아이템 흐름: 기계마다 생산 현황을 더하고, 발전기가 태우는 석탄도 소비로 친다 */
  factoryFlows(): Map<ItemId, ItemFlow> {
    const flows = new Map<ItemId, ItemFlow>();
    const flow = (item: ItemId) => {
      let f = flows.get(item);
      if (!f) flows.set(item, (f = { made: 0, used: 0, madeMax: 0, usedMax: 0, makers: 0, users: 0 }));
      return f;
    };
    for (const b of this.buildings.values()) {
      if (b.type === 'generator' || b.type === 'hydro') {
        const hydro = b.type === 'hydro';
        // 석탄 발전기는 숯이 들어 있으면 숯을 먼저 태운다
        const charcoal = !hydro && countOf(b.inBuf, 'charcoal') > 0;
        const unit = hydro ? WATER_ENERGY : charcoal ? CHARCOAL_ENERGY : COAL_ENERGY;
        const f = flow(hydro ? 'water' : charcoal ? 'charcoal' : 'coal');
        f.used += (b.load / unit) * 60;
        f.usedMax += ((hydro ? HYDRO_POWER : GENERATOR_POWER) / unit) * 60;
        f.users++;
        continue;
      }
      const st = this.machineStats(b);
      if (!st) continue;
      for (const o of st.maxOut) {
        const f = flow(o.item);
        f.made += o.count * st.util;
        f.madeMax += o.count;
        f.makers++;
      }
      for (const i of st.maxIn) {
        const f = flow(i.item);
        f.used += i.count * st.util;
        f.usedMax += i.count;
        f.users++;
      }
    }
    return flows;
  }

  private updateStats(b: Building): void {
    const s = b.stats;
    const k = DT / STATS_TAU;
    s.eff += ((b.crafting ? this.satOf(b) : 0) - s.eff) * k;
    s.work += ((b.crafting ? 1 : 0) - s.work) * k;
    s.starve += ((b.status === 'no-input' || b.status === 'depleted' ? 1 : 0) - s.starve) * k;
    s.blocked += ((b.status === 'output-full' ? 1 : 0) - s.blocked) * k;
    s.age += DT;
  }

  /**
   * 컨베이어를 다른 종류 컨베이어로 바꾼다 (예: 일반 → 고속). 위에 있던 아이템은 그대로 둔다.
   * 비용은 원래 컨베이어를 돌려받은 뒤 기준. 잠겼거나 재료가 모자라면 null.
   */
  replaceBelt(b: Building, type: BuildingType, dir: Dir): Building | null {
    if (!isBeltType(b.type) || !isBeltType(type)) return null;
    if (b.type === type) {
      this.rotate(b, dir);
      return b;
    }
    if (!this.unlockedBuildings.has(type)) return null;
    const back = (item: ItemId) => b.def.cost.find((c) => c.item === item)?.count ?? 0;
    if (!BUILDINGS[type].cost.every((c) => this.stockOf(c.item) + back(c.item) >= c.count)) return null;
    const items = b.items;
    b.items = [];
    this.remove(b);
    const nb = this.place(type, b.x, b.y, dir)!;
    nb.items = items;
    return nb;
  }

  rotate(b: Building, dir: Dir): void {
    // 지하 컨베이어는 짝이 깨지므로 돌리지 않는다 (철거 후 다시 놓기)
    if (b.dir === dir || b.type === 'underground') return;
    this.record({ kind: 'rotate', x: b.x, y: b.y, from: b.dir, to: dir });
    b.dir = dir;
    this.layoutDirty = true;
  }

  /** 정류장 싣기/내리기. 안에 쌓인 건 돌려준다 (regional-v1은 현지 회수 더미로) */
  setStationMode(b: Building, mode: StationMode): boolean {
    if (b.type !== 'station') return false;
    if (b.stationMode === mode) return true;
    this.record({ kind: 'mode', x: b.x, y: b.y, from: b.stationMode, to: mode });
    if (this.reservations.length) this.reservations = this.reservations.filter((r) => r.holder !== b.id);
    this.refundContents(b, 'mode');
    b.stationMode = mode;
    this.layoutDirty = true;
    return true;
  }

  /** 스마트 분류기가 앞으로 보낼 아이템 */
  setFilter(b: Building, item: ItemId | null): boolean {
    if (b.type !== 'sorter' && b.type !== 'unloader') return false;
    if (b.filter !== item) this.record({ kind: 'filter', x: b.x, y: b.y, from: b.filter, to: item });
    b.filter = item;
    return true;
  }

  setRecipe(b: Building, recipeId: string | null): boolean {
    if (!isRecipeMachine(b.type)) return false;
    if (recipeId !== null) {
      const r = RECIPES[recipeId];
      if (!r || r.machine !== b.type || !this.unlockedRecipes.has(recipeId)) return false;
    }
    if (b.recipe === recipeId) return true;
    this.record({ kind: 'recipe', x: b.x, y: b.y, from: b.recipe, to: recipeId });
    this.refundContents(b, 'recipe');
    // 모듈은 슬롯에 남는다. 분리 예약이 있었으면 작업이 취소돼 잠금이 풀렸으니 이제 한 번 내린다
    if (b.detach) this.dropModule(b, 'module');
    b.recipe = recipeId;
    b.status = 'idle';
    return true;
  }

  /**
   * 건물 안의 실물(버퍼·제작 중 투입물·연료·벨트 위 아이템)을 돌려준다. 예전 세계는 허브로,
   * regional-v1은 건물 왼쪽 위 칸의 현지 회수 더미로. 제작 중이던 배치는 취소한다 (완제품은 생기지 않는다)
   */
  private refundContents(b: Building, why: PileReason, ev = 0): void {
    const tile = this.idx(b.x, b.y);
    if (this.regional && !ev) ev = this.nextPileEv++;
    const give = (item: ItemId, n: number) => {
      if (n <= 0) return;
      if (this.regional) this.addPile(tile, item, n, ev, why);
      else addTo(this.stock, item, n);
    };
    for (const it of b.items) give(it.item, it.n);
    b.items = [];
    for (const [item, n] of b.inBuf) give(item, n);
    for (const [item, n] of b.outBuf) give(item, n);
    b.inBuf.clear();
    b.outBuf.clear();
    const r = this.recipeOf(b);
    if (b.crafting && r) for (const i of r.inputs) give(i.item, i.count);
    b.crafting = false;
    b.modBatch = false;
    b.progress = 0;
    // 발전기에 쌓인 연료 (수력 발전기는 물)
    if (b.fuel) give(b.type === 'hydro' ? 'water' : b.type === 'fuel-generator' ? 'fuel' : 'coal', b.fuel);
    b.fuel = 0;
    if (b.held) give(b.held, b.heldN);
    b.held = null;
    b.heldN = 0;
  }

  // ───────────────────────── 현지 회수 더미 (regional-v1) ─────────────────────────

  /** 회수 더미에 쌓는다 (같은 칸·아이템·사건이면 합친다) */
  private addPile(tile: number, item: ItemId, n: number, ev: number, why: PileReason): void {
    if (n <= 0) return;
    const e = this.piles.find((p) => p.tile === tile && p.item === item && p.ev === ev);
    if (e) e.n += n;
    else this.piles.push({ tile, item, n, ev, why });
  }

  /** 이 칸 회수 더미의 아이템별 합계 (아이템 목록 순서) */
  pileAt(tile: number): Map<ItemId, number> {
    const all = new Map<ItemId, number>();
    for (const p of this.piles) if (p.tile === tile) addTo(all, p.item, p.n);
    return new Map(ITEM_IDS.filter((i) => countOf(all, i) > 0).map((i) => [i, countOf(all, i)]));
  }

  pileCount(tile: number, item: ItemId): number {
    let n = 0;
    for (const p of this.piles) if (p.tile === tile && p.item === item) n += p.n;
    return n;
  }

  /** 회수 더미가 있는 칸들 (칸 번호 → 합계 개수) */
  pileTiles(): Map<number, number> {
    const m = new Map<number, number>();
    for (const p of this.piles) m.set(p.tile, (m.get(p.tile) ?? 0) + p.n);
    return m;
  }

  /** 더미에서 item을 최대 n개 꺼낸다 (먼저 생긴 사건부터). ev를 주면 그 사건 몫에서만. 꺼낸 개수 */
  private takePile(tile: number, item: ItemId, n: number, ev = 0): number {
    let got = 0;
    for (const p of this.piles) {
      if (got >= n) break;
      if (p.tile !== tile || p.item !== item || (ev && p.ev !== ev)) continue;
      const k = Math.min(n - got, p.n);
      p.n -= k;
      got += k;
    }
    if (got) this.piles = this.piles.filter((p) => p.n > 0);
    return got;
  }

  // ───────────────────────── 자동화 설비 모듈 (regional-v1) ─────────────────────────

  /** 장착 모듈을 기계 왼쪽 위 칸의 현지 회수 더미로 내린다 (분리 예약도 끝). 내렸으면 true */
  private dropModule(b: Building, why: PileReason, ev = 0): boolean {
    if (!b.module) return false;
    this.addPile(this.idx(b.x, b.y), 'module', 1, ev || this.nextPileEv++, why);
    b.module = null;
    b.detach = false;
    return true;
  }

  /** 모듈을 설치할 수 있는 기계인지 (세계·연구·기계 종류). 안 되면 이유 */
  moduleSupport(b: Building): string | null {
    if (!this.regional) return '이 세계에서는 설비 모듈을 쓰지 않아요';
    if (!MODULE_MACHINES.includes(b.type)) return '레시피 생산 기계에만 설치해요';
    if (!this.researched.has(TECH_MODULE_SLOTS)) return `연구 "${this.tech(TECH_MODULE_SLOTS)?.name}"이 필요해요`;
    return null;
  }

  /**
   * 몸체가 상하좌우로 맞닿은 창고군들. 같은 군의 여러 동이 닿아도 한 번만, 대표(가장 작은 id) 창고 순.
   * 각 군: 대표 id, 구조 표시(군의 창고 id들), 닿은 창고 id
   */
  touchingStorageGroups(b: Building): { id: number; key: string; group: Building[] }[] {
    const seen = new Map<string, { id: number; key: string; group: Building[] }>();
    for (const [nx, ny] of edgeNeighbors(b)) {
      const n = this.buildingAt(nx, ny);
      if (n?.type !== 'storage') continue;
      const group = this.storageGroup(n);
      const key = groupKey(group);
      if (!seen.has(key)) seen.set(key, { id: Math.min(...group.map((s) => s.id)), key, group });
    }
    return [...seen.values()].sort((a, c) => a.id - c.id);
  }


  /** 창고군에서 item의 [실물, 예약, 사용 가능] (같은 군의 창고를 한 번씩만 센다) */
  groupStock(group: Building[], item: ItemId): { real: number; reserved: number; free: number } {
    let real = 0;
    let reserved = 0;
    for (const s of group) {
      real += countOf(s.inBuf, item);
      reserved += this.reservedAt(s, item);
    }
    return { real, reserved, free: Math.max(0, real - reserved) };
  }

  /** 창고군에서 예약되지 않은 item 1개를 실제로 들고 있는 창고 (id 순). 없으면 null */
  private groupHolder(group: Building[], item: ItemId): Building | null {
    for (const s of [...group].sort((a, c) => a.id - c.id)) {
      if (countOf(s.inBuf, item) - this.reservedAt(s, item) >= 1) return s;
    }
    return null;
  }

  /**
   * 모듈 설치: 몸체에 닿은 창고군(storage = 닿은 창고 id, key = 명령을 낼 때 본 군의 구조)의 예약되지 않은 모듈 1개를 슬롯으로 옮긴다.
   * 검사를 모두 마친 뒤에만 옮긴다 (실패하면 아무것도 바뀌지 않는다). 전력·레시피·정지와 상관없이 설치할 수 있다
   */
  installModule(b: Building, storage: number, key: string): UseResult {
    const no = this.moduleSupport(b);
    if (no) return { ok: false, reason: no };
    if (b.module) return { ok: false, reason: b.detach ? '분리 대기 중이에요' : '이미 설치돼 있어요' };
    const st = this.buildings.get(storage);
    const g = st?.type === 'storage' ? this.touchingStorageGroups(b).find((x) => x.group.includes(st)) : undefined;
    if (!g || g.key !== key) return { ok: false, reason: '공급 창고를 다시 골라 주세요 (연결이 바뀌었어요)' };
    const holder = this.groupHolder(g.group, 'module');
    if (!holder) return { ok: false, reason: '창고에 쓸 수 있는 모듈이 없어요' };
    addTo(holder.inBuf, 'module', -1);
    b.module = { from: holder.id };
    return { ok: true, from: holder.id };
  }

  /**
   * 모듈 분리.
   * - normal: 지금 배치가 모듈을 쓰는 중이면 "제작 완료 후 분리" 예약, 아니면 바로 현지 회수 더미로
   * - cancel-request: 분리 예약 취소 (모듈·재료는 그대로)
   * - force: 작업 취소 후 즉시 분리. 지금 배치에 실제 투입한 재료와 모듈만 현지 회수 (입력·출력 버퍼는 남는다)
   */
  detachModule(b: Building, mode: 'normal' | 'cancel-request' | 'force'): UseResult {
    if (!this.regional) return { ok: false, reason: '이 세계에서는 설비 모듈을 쓰지 않아요' };
    if (mode === 'cancel-request') {
      if (!b.module || !b.detach) return { ok: false, reason: '분리 예약이 없어요' };
      b.detach = false;
      return { ok: true, note: 'cancelled' };
    }
    if (!b.module) return { ok: false, reason: '설치된 모듈이 없어요' };
    const locked = b.crafting && b.modBatch;
    if (mode === 'normal' && locked) {
      if (b.detach) return { ok: false, reason: '이미 분리 예약했어요' };
      b.detach = true;
      return { ok: true, note: 'scheduled' };
    }
    const ev = this.nextPileEv++;
    if (locked) {
      // 이 배치에 실제로 넣은 재료만 돌려주고 진행도를 버린다 (완제품·완료 기록은 없다)
      const r = this.recipeOf(b);
      if (r) for (const i of r.inputs) this.addPile(this.idx(b.x, b.y), i.item, i.count, ev, 'cancel');
      b.crafting = false;
      b.modBatch = false;
      b.progress = 0;
    }
    this.dropModule(b, 'module', ev);
    return { ok: true };
  }

  /** 기계 화면에 보일 모듈 상태 */
  moduleState(b: Building): 'none' | 'installed' | 'next' | 'detaching' {
    if (!b.module) return 'none';
    if (b.detach) return 'detaching';
    return b.crafting && !b.modBatch ? 'next' : 'installed';
  }

  // ───────────────────────── 숲 ─────────────────────────

  /** 나무를 심을 수 있는 칸: 광맥·물·건물·나무가 없는 땅 (다 캔 광맥 자리 포함) */
  canPlant(i: number): boolean {
    // 지형 성장 배율이 0인 곳(화산)에는 심지 못한다
    return !this.resItem[i] && !this.occ[i] && this.tree[i] === 0 && TERRAIN[this.terrainAt(i)].tree > 0;
  }

  /** (x, y)에 나무를 놓는다. growth 1 = 다 자란 나무 (맵 만들 때), 그보다 작으면 거기서부터 자란다 */
  setTree(x: number, y: number, growth: number): void {
    const i = this.idx(x, y);
    const was = this.tree[i];
    this.tree[i] = growth;
    if (growth > 0 && growth < 1 && !(was > 0 && was < 1)) this.growing.push(i);
  }

  /** 칸의 나무를 없앤다 (벨 때·건물을 지을 때). 다 자란 나무였으면 true */
  private clearTree(i: number): boolean {
    const g = this.tree[i];
    if (g <= 0) return false;
    this.tree[i] = 0;
    if (g < 1) {
      const k = this.growing.indexOf(i);
      if (k >= 0) this.growing.splice(k, 1);
    }
    return g >= 1;
  }

  /** 나무가 자라는 빠르기 (1 = 기본 2분): 연구 "숲 가꾸기" × 끝없는 연구 "나무 자라기" */
  treeGrowth(): number {
    return (this.researched.has('forest-care') ? FOREST.care : 1) * this.boost('endless-forest');
  }

  /** 자라는 나무를 한 틱만큼 키운다 */
  private growTrees(): void {
    if (!this.growing.length) return;
    const step = (DT * this.treeGrowth()) / FOREST.grow;
    let keep = 0;
    for (const i of this.growing) {
      // regional-v1: 지형·날씨에 따라 빨리 또는 느리게 자란다
      const k = this.terrain ? TERRAIN[this.terrainAt(i)].tree * this.weatherEffect(i).tree : 1;
      const g = Math.min(1, this.tree[i] + step * k);
      this.tree[i] = g;
      if (g >= 1) {
        this.treesGrown++;
        this.stats.treesMatured++;
        if (this.ach.trees.get(i) === 1) this.ach.trees.set(i, 2);
        if (this.ach.lastOre.has(i)) this.ach.add('h03', 1);
      }
      else this.growing[keep++] = i;
    }
    this.growing.length = keep;
  }

  /** 벌목기·식목기가 다루는 칸들: 건물 둘레 FOREST.range칸 (건물 칸 빼고, 위에서 아래·왼쪽에서 오른쪽 차례) */
  forestTiles(b: { x: number; y: number; size: number }): number[] {
    const r = FOREST.range;
    const out: number[] = [];
    for (let y = b.y - r; y < b.y + b.size + r; y++) {
      for (let x = b.x - r; x < b.x + b.size + r; x++) {
        if (!this.inBounds(x, y)) continue;
        if (x >= b.x && x < b.x + b.size && y >= b.y && y < b.y + b.size) continue;
        out.push(this.idx(x, y));
      }
    }
    return out;
  }

  /** 저장용: 나무가 있는 칸 [칸 번호, 자람 정도] */
  private treeList(): [number, number][] {
    const out: [number, number][] = [];
    for (let i = 0; i < this.tree.length; i++) if (this.tree[i] > 0) out.push([i, this.tree[i]]);
    return out;
  }

  /** 맵의 나무 수 (다 자란 것, 자라는 것) */
  treeCount(): { grown: number; growing: number } {
    let grown = 0;
    for (const g of this.tree) if (g >= 1) grown++;
    return { grown, growing: this.growing.length };
  }

  /** 광맥을 다 캐서 빈 땅이 된 칸 (광맥 번호는 남고 광맥 표시는 사라진 칸) */
  isSpentOre(i: number): boolean {
    return this.patchOf[i] > 0 && !this.resItem[i];
  }

  /** 숲 되살리기: 다 캔 광맥 칸 수와, 그중 다 자란 나무가 선 칸 수 */
  revivedLand(): { spent: number; revived: number } {
    this.ensurePatches();
    let spent = 0;
    let revived = 0;
    for (let i = 0; i < this.tree.length; i++) {
      if (!this.isSpentOre(i)) continue;
      spent++;
      if (this.tree[i] >= 1) revived++;
    }
    return { spent, revived };
  }

  /** 뽑아낼 칸들: 양수기는 물 칸, 채굴기는 광맥 칸 (물 제외) */
  private mineTilesFor(type: BuildingType, x: number, y: number, size: number): number[] {
    const tiles: number[] = [];
    for (let dy = 0; dy < size; dy++) {
      for (let dx = 0; dx < size; dx++) {
        if (!this.inBounds(x + dx, y + dy)) continue;
        const i = this.idx(x + dx, y + dy);
        const item = this.resItem[i];
        if (!item || this.resAmount[i] <= 0) continue;
        if (type === 'pump' ? item === 'water' : !NOT_MINED.includes(item)) tiles.push(i);
      }
    }
    return tiles;
  }

  private waterTilesUnder(x: number, y: number, size: number): number {
    let n = 0;
    for (let dy = 0; dy < size; dy++) {
      for (let dx = 0; dx < size; dx++) {
        if (this.inBounds(x + dx, y + dy) && this.resItem[this.idx(x + dx, y + dy)] === 'water') n++;
      }
    }
    return n;
  }

  /** 사각형(양 끝 칸 포함)에 한 칸이라도 걸친 건물들 (허브 제외) */
  buildingsIn(x0: number, y0: number, x1: number, y1: number): Building[] {
    const [ax, bx] = x0 <= x1 ? [x0, x1] : [x1, x0];
    const [ay, by] = y0 <= y1 ? [y0, y1] : [y1, y0];
    return [...this.buildings.values()].filter(
      (b) => b.type !== 'hub' && b.x <= bx && b.y <= by && b.x + b.size - 1 >= ax && b.y + b.size - 1 >= ay,
    );
  }

  /**
   * 단체 선택 (Shift + 드래그): 사각형 안에서 가장 많은 한 종류의 건물들.
   * 컨베이어·지하 컨베이어·도로는 빼고, 레시피를 고르는 기계(조립기 등)가 있으면 그쪽을 먼저.
   */
  groupIn(x0: number, y0: number, x1: number, y1: number): Building[] {
    const byType = new Map<BuildingType, Building[]>();
    for (const b of this.buildingsIn(x0, y0, x1, y1)) {
      if (isBeltType(b.type) || b.type === 'underground' || b.type === 'road') continue;
      const list = byType.get(b.type);
      if (list) list.push(b);
      else byType.set(b.type, [b]);
    }
    let best: Building[] = [];
    for (const [type, list] of byType) {
      const pick = isRecipeMachine(type) ? 1 : 0;
      const cur = best.length ? (isRecipeMachine(best[0].type) ? 1 : 0) : -1;
      if (pick > cur || (pick === cur && list.length > best.length)) best = list;
    }
    return best;
  }

  // ───────────────────────── 되돌리기 ─────────────────────────

  /** 여기서부터 endEdit까지 바뀐 것을 되돌리기 한 단계로 묶는다 (겹쳐 불러도 바깥 한 단계) */
  beginEdit(): void {
    const h = this.history();
    if (h.depth++ === 0) h.batch = [];
  }

  endEdit(): void {
    const h = this.history();
    if (h.depth === 0 || --h.depth > 0) return;
    const batch = h.batch;
    h.batch = null;
    if (!batch?.length) return;
    h.undo.push(batch);
    if (h.undo.length > UNDO_LIMIT) h.undo.shift();
    h.redo = [];
  }

  /** player(기본: 지금 명령을 낸 사람)의 되돌리기 기록 */
  private history(player = this.actor): EditHistory {
    let h = this.histories.get(player);
    if (!h) this.histories.set(player, (h = { undo: [], redo: [], batch: null, depth: 0 }));
    return h;
  }

  /** fn 안에서 바뀐 것을 되돌리기 한 단계로 */
  edit<T>(fn: () => T): T {
    this.beginEdit();
    try {
      return fn();
    } finally {
      this.endEdit();
    }
  }

  get canUndo(): boolean {
    return this.history().undo.length > 0;
  }

  get canRedo(): boolean {
    return this.history().redo.length > 0;
  }

  /** 되돌리기·다시 하기 하면 바뀔 것 (버튼 설명용). 없으면 null */
  nextEdit(redo: boolean, player = this.actor): EditOp[] | null {
    const h = this.history(player);
    const stack = redo ? h.redo : h.undo;
    return stack[stack.length - 1] ?? null;
  }

  /**
   * 마지막 단계를 되돌린다. 지은 건 철거(환급)하고 철거한 건 다시 짓는다(재료를 다시 냄).
   * 재료가 모자라거나 그 자리에 다른 게 생겼으면 그 부분만 건너뛴다. 안에 들어 있던 아이템은 돌아오지 않는다.
   */
  undo(): { ops: EditOp[]; skipped: number } | null {
    const h = this.history();
    const batch = h.undo.pop();
    if (!batch) return null;
    // 먼저 옮겨 둔다: 되돌리는 도중 정류장이 다시 지어지면 이 단계 기록 속 정류장 번호도 고쳐지게 (revive)
    h.redo.push(batch);
    const skipped = this.replay(() => {
      let n = 0;
      for (let i = batch.length - 1; i >= 0; i--) if (!this.applyOp(batch[i], true)) n++;
      return n;
    });
    return { ops: batch, skipped };
  }

  redo(): { ops: EditOp[]; skipped: number } | null {
    const h = this.history();
    const batch = h.redo.pop();
    if (!batch) return null;
    h.undo.push(batch);
    const skipped = this.replay(() => {
      let n = 0;
      for (const op of batch) if (!this.applyOp(op, false)) n++;
      return n;
    });
    return { ops: batch, skipped };
  }

  /** 되돌리는 동안 바뀐 것은 새 단계로 기록하지 않는다 */
  private replay(fn: () => number): number {
    const h = this.history();
    const saved = h.batch;
    h.batch = null;
    try {
      return fn();
    } finally {
      h.batch = saved;
    }
  }

  private record(op: EditOp): void {
    this.history().batch?.push(op);
  }

  /** back = true면 되돌리기(반대로), false면 다시 하기 */
  private applyOp(op: EditOp, back: boolean): boolean {
    if (op.kind === 'route') {
      // 트럭이 되돌리기로 다시 만들어졌으면 지금 id로 찾는다
      const v = this.vehicles.get(this.truckId(op.id));
      if (!v) return false;
      this.setStops(v, back ? op.from : op.to);
      return true;
    }
    if (op.kind === 'truck-add' || op.kind === 'truck-remove') {
      // 만들기를 되돌리기 = 철거, 철거를 되돌리기 = 다시 만들기
      const last = this.truckId(op.id);
      if (back === (op.kind === 'truck-add')) {
        const v = this.vehicles.get(last);
        if (!v) return false;
        this.removeVehicle(v);
        return true;
      }
      if (!this.canAfford(TRUCK.cost)) return false;
      const v = this.spawnTruck(op.tile, op.stops);
      // 다른 단계가 이 트럭의 마지막 id로 찾아도 새 트럭에 닿게
      this.truckAlias.set(last, v.id);
      op.id = v.id;
      return true;
    }
    const b = this.buildingAt(op.x, op.y);
    const here = b && b.x === op.x && b.y === op.y ? b : null;
    switch (op.kind) {
      case 'place': {
        if (back) {
          if (here?.type === op.type) [op.id, op.no] = [here.id, here.stationNo];
          return this.removeOp(here, op.type);
        }
        const nb = this.place(op.type, op.x, op.y, op.dir);
        if (nb && op.id) this.revive(nb, op.id, op.no ?? 0);
        return !!nb;
      }
      case 'remove':
        if (!back) {
          if (here?.type === op.type) op.id = here.id;
          return this.removeOp(here, op.type);
        }
        return this.restore(op);
      case 'rotate':
        if (!here) return false;
        this.rotate(here, back ? op.from : op.to);
        return true;
      case 'recipe':
        return !!here && this.setRecipe(here, back ? op.from : op.to);
      case 'filter':
        return !!here && this.setFilter(here, back ? op.from : op.to);
      case 'mode':
        return !!here && this.setStationMode(here, back ? op.from : op.to);
    }
  }

  /** 되돌리기로 다시 지은 정류장: 원래 번호를 쓰고, 예전 id를 오가던 트럭을 새 정류장에 잇는다 */
  private revive(b: Building, oldId: number, no: number): void {
    if (b.type !== 'station') return;
    // 방금 새로 뗀 번호는 돌려놓는다
    if (b.stationNo === this.nextStationNo - 1) this.nextStationNo--;
    if (no) b.stationNo = no;
    for (const v of this.vehicles.values()) for (const s of v.stops) if (s.id === oldId) s.id = b.id;
    // 되돌리기 기록 속 노선도 (트럭 만들기·철거, 노선 바꾸기). 안 그러면 다시 하기로 되살린 노선이 없는 정류장을 가리킨다
    for (const h of this.histories.values()) {
      for (const batch of [...h.undo, ...h.redo, ...(h.batch ? [h.batch] : [])]) {
        for (const op of batch) {
          const lists = op.kind === 'route' ? [op.from, op.to] : op.kind === 'truck-add' || op.kind === 'truck-remove' ? [op.stops] : [];
          for (const list of lists) for (const s of list) if (s.id === oldId) s.id = b.id;
        }
      }
    }
  }

  /** 되돌리기로 여러 번 다시 만들어진 트럭의 지금 id */
  private truckId(id: number): number {
    while (this.truckAlias.has(id)) id = this.truckAlias.get(id)!;
    return id;
  }

  private removeOp(b: Building | null, type: BuildingType): boolean {
    return !!b && b.type === type && this.remove(b);
  }

  /** 철거한 건물을 같은 자리에 같은 설정으로 다시 짓는다 */
  private restore(op: Extract<EditOp, { kind: 'remove' }>): boolean {
    const b = this.place(op.type, op.x, op.y, op.dir);
    if (!b) return false;
    if (op.recipe && this.unlockedRecipes.has(op.recipe)) this.setRecipe(b, op.recipe);
    if (op.filter) this.setFilter(b, op.filter);
    if (b.type === 'station') this.setStationMode(b, op.mode);
    this.revive(b, op.id, op.no);
    op.id = b.id;
    // 철거 때 내려놓은 모듈이 그 회수분 그대로 남아 있을 때만 다시 장착한다 (이미 옮겨 쓴 모듈은 채우지 않는다)
    if (op.mod && !this.moduleSupport(b) && this.takePile(this.idx(b.x, b.y), 'module', 1, op.mod)) b.module = { from: 0 };
    // 지하 컨베이어: 다시 지은 순서 때문에 입구·출구가 바뀌지 않게 원래 종류로 짝을 맞춘다
    if (b.type === 'underground' && op.ug && b.ugMode !== op.ug) {
      const old = this.partnerOf(b);
      if (old) old.partner = 0;
      b.partner = 0;
      b.ugMode = op.ug;
      const sign = op.ug === 'in' ? 1 : -1;
      for (let k = 1; k <= UNDERGROUND_MAX_GAP + 1; k++) {
        const n = this.buildingAt(b.x + DX[b.dir] * k * sign, b.y + DY[b.dir] * k * sign);
        if (n?.type !== 'underground' || n.dir !== b.dir) continue;
        if (n.ugMode !== op.ug && !n.partner) {
          n.partner = b.id;
          b.partner = n.id;
        }
        break;
      }
      this.layoutDirty = true;
    }
    return true;
  }

  // ───────────────────────── 연구 ─────────────────────────

  canResearch(id: string): PlaceCheck {
    const e = ENDLESS_BY_ID[id];
    if (e) {
      if (!this.researched.has(ENDLESS_REQUIRES)) return { ok: false, reason: '광맥 독립 뒤에 열려요' };
      if (!this.canAfford(endlessCost(e, this.endlessLevel(id) + 1))) return { ok: false, reason: '재료 부족' };
      return { ok: true };
    }
    const t = this.tech(id);
    if (!t) return { ok: false, reason: '없는 연구' };
    if (this.researched.has(id)) return { ok: false, reason: '완료됨' };
    if (!t.requires.every((r) => this.researched.has(r))) return { ok: false, reason: '선행 연구 필요' };
    if (!this.canAfford(t.cost)) return { ok: false, reason: '재료 부족' };
    return { ok: true };
  }

  research(id: string): boolean {
    if (!this.canResearch(id).ok) return false;
    const e = ENDLESS_BY_ID[id];
    if (e) {
      // 끝없는 연구는 한 단계씩 오른다
      const level = this.endlessLevel(id) + 1;
      for (const c of endlessCost(e, level)) addTo(this.stock, c.item, -c.count);
      this.levels.set(id, level);
      return true;
    }
    for (const c of this.tech(id)!.cost) addTo(this.stock, c.item, -c.count);
    this.applyTech(id);
    return true;
  }

  /** 끝없는 연구의 지금 단계 */
  endlessLevel(id: string): number {
    return this.levels.get(id) ?? 0;
  }

  /** 연구 효과만 적용 (비용 없음). 불러오기에서도 쓴다. */
  applyTech(id: string): void {
    const t = this.tech(id);
    if (!t || this.researched.has(id)) return;
    this.researched.add(id);
    t.unlockBuildings?.forEach((b) => this.unlockedBuildings.add(b));
    t.unlockRecipes?.forEach((r) => this.unlockedRecipes.add(r));
    if (t.dirtMining) this.dirtMining = true;
  }

  // ───────────────────────── 시뮬레이션 ─────────────────────────

  tick(): void {
    this.ensurePatches();
    if (this.layoutDirty) this.rebuildLayout();

    const sec = Math.floor(this.time);
    if (sec !== this.incomeSecond) {
      this.incomeSecond = sec;
      this.incomeBuckets[sec % 60].clear();
    }

    this.growTrees();
    for (const b of this.buildings.values()) if (isCrafter(b)) this.tryStart(b);
    this.updatePower();
    for (const b of this.buildings.values()) {
      if (!isCrafter(b)) continue;
      this.updateCrafting(b);
      this.updateStats(b);
    }
    for (const b of this.buildings.values()) {
      if (isCrafter(b)) this.pushOutputs(b);
      else if (isSplitterType(b.type)) this.pushSplitter(b);
      else if (b.type === 'unloader') this.updateUnloader(b);
      else if (b.type === 'merger') this.pushMerger(b);
      else if (b.type === 'station' && b.stationMode === 'unload') this.pushOutputs(b);
    }
    for (const b of this.beltOrder) this.updateBelt(b);
    for (const v of this.vehicles.values()) this.updateVehicle(v);

    this.time += DT;
    this.tickNo++;
    // 메인 목표·업적은 시뮬레이션이 1초마다 판정해 고정 id로 남긴다 (화면을 열지 않아도)
    if (this.tickNo % TICK_RATE === 0) {
      if (this.regional) evaluateGoals(this);
      this.achTick();
    }
  }

  private pushMerger(b: Building): void {
    if (!b.held) return;
    for (const t of this.targetsOf(b)) if (this.giveHeld(b, t)) return;
  }

  /** 분배기·병합기가 들고 있는 묶음을 t에 넘긴다 (받는 만큼만, 남으면 계속 든다). 넘겼으면 true */
  private giveHeld(b: Building, t: OutTarget): boolean {
    const k = this.insert(t, b.held!, b, b.heldN);
    if (k <= 0) return false;
    b.heldN -= k;
    if (b.heldN <= 0) {
      b.held = null;
      b.heldN = 0;
    }
    return true;
  }

  /**
   * 병합기: 뒤 → 오른쪽 → 왼쪽 차례로 돌아가며 받는다.
   * 차례인 쪽이 최근(지난 틱 이후)에 넣으려 했으면 그쪽을 기다리고, 아니면 건너뛴다.
   * 그래서 여러 줄이 기다리면 하나씩 번갈아 받고, 한 줄만 있으면 기다리지 않고 바로 받는다.
   */
  private mergerAccept(n: Building, item: ItemId, fromSide: Dir, count: number): boolean {
    n.lastTry[fromSide] = this.tickNo;
    if (n.held) return false;
    const order: Dir[] = [opposite(n.dir), rotateCW(n.dir), rotateCW(rotateCW(rotateCW(n.dir)))];
    for (let k = 0; k < order.length; k++) {
      const side = order[(n.outRR + k) % order.length];
      if (this.tickNo - n.lastTry[side] > 1) continue;
      if (side !== fromSide) return false;
      n.held = item;
      n.heldN = count;
      n.outRR = (n.outRR + k + 1) % order.length;
      return true;
    }
    return false;
  }

  /** 재료가 있고 출력 공간이 있으면 제작을 시작한다 (재료는 시작할 때 소모). */
  private tryStart(b: Building): void {
    if (b.crafting) return;
    if (b.type === 'lumberjack') {
      if (sumOf(b.outBuf) >= LUMBER_OUT_CAP) {
        b.status = 'output-full';
        return;
      }
      if (!b.mineTiles.some((i) => this.tree[i] >= 1)) {
        b.status = 'no-trees';
        return;
      }
      b.crafting = true;
      return;
    }
    if (b.type === 'planter') {
      if (countOf(b.inBuf, 'sapling') <= 0) {
        b.status = 'no-input';
        return;
      }
      if (!b.mineTiles.some((i) => this.canPlant(i))) {
        b.status = 'no-room';
        return;
      }
      b.crafting = true;
      return;
    }
    if (isExtractorType(b.type)) {
      if (sumOf(b.outBuf) >= MINER_OUT_CAP) {
        b.status = 'output-full';
        return;
      }
      const tile = b.mineTiles[0];
      const item = b.type === 'drill' ? (tile !== undefined ? this.resItem[tile] : null) : 'sap';
      if (b.type === 'sap-extractor' ? !b.minePatches.length : !item || this.resAmount[tile] <= 0) {
        b.status = 'depleted';
        return;
      }
      if (this.oreLock(item)) {
        b.status = 'locked';
        return;
      }
      b.crafting = true;
      return;
    }
    if (isMinerType(b.type)) {
      let total = 0;
      for (const n of b.outBuf.values()) total += n;
      if (total >= MINER_OUT_CAP) {
        b.status = 'output-full';
        return;
      }
      const hasOre =
        b.mineDirt ||
        (b.type === 'pump'
          ? b.mineTiles.some((i) => this.resAmount[i] > 0)
          : b.minePatches.some((p) => (this.patches.get(p)?.remaining ?? 0) > 0));
      if (!hasOre) {
        b.status = 'depleted';
        return;
      }
      // regional-v1: 주석·보크사이트·황은 연구 뒤에 캔다
      if (!b.mineDirt && b.type !== 'pump' && b.minePatches.every((p) => this.oreLock(this.patches.get(p)?.item ?? null))) {
        b.status = 'locked';
        return;
      }
      b.crafting = true;
      return;
    }
    const r = this.recipeOf(b);
    if (!r) {
      b.status = 'no-recipe';
      return;
    }
    // 분리기처럼 평균 개수가 1보다 작은 결과도 최소 1개 분량은 쌓아 둘 수 있게
    if (r.outputs.some((o) => countOf(b.outBuf, o.item) >= Math.max(1, o.count) * MACHINE_BUFFER_CRAFTS)) {
      b.status = 'output-full';
      return;
    }
    if (r.inputs.some((i) => countOf(b.inBuf, i.item) < i.count)) {
      b.status = 'no-input';
      return;
    }
    for (const i of r.inputs) addTo(b.inBuf, i.item, -i.count);
    if (r.inputs.some((i) => i.item === 'iron-ore' || i.item === 'copper-ore' || i.item === 'coal')) this.ach.flags.add('ore');
    if (this.regional) {
      // 구역에서 제작에 실제로 쓴 재료 (공급선의 쓰임 확인)
      const z = this.zoneOfB.get(b.id);
      if (z) {
        let used = this.stats.zoneUsed.get(z);
        if (!used) this.stats.zoneUsed.set(z, (used = new Set()));
        for (const i of r.inputs) used.add(i.item);
      }
      if (b.type === 'large-assembler') this.stats.largeStarted = true;
    }
    b.crafting = true;
    // 이 배치가 모듈을 쓰는지는 시작할 때 정한다 (도중에 설치해도 이 배치는 그대로)
    b.modBatch = !!b.module;
  }

  // ───────────────────────── 지역 전력 (regional-v1) ─────────────────────────

  /** 허브 구역 (없으면 만든다) */
  private ensureHubZone(): void {
    if (!this.regional || !this.hub || this.zones.some((z) => z.hub)) return;
    const h = this.refTile(this.hub);
    this.zones.push({ id: this.nextZoneId++, x: h % this.width, y: Math.floor(h / this.width), hub: true, creator: this.hub.id, budget: GRID.charge });
    this.gridDirty = true;
  }

  /** 구역이 변전소로 정식화됐는지 */
  private zoneFormal(z: Zone): boolean {
    if (this.gridDirty || !this.formalCache) {
      // 배치가 바뀐 뒤 처음 물을 때 한 번만 센다 (구역마다 건물 전체를 돌지 않게)
      this.formalCache = new Set();
      for (const b of this.buildings.values()) if (b.type === 'substation' && b.zone) this.formalCache.add(b.zone);
    }
    return this.formalCache.has(z.id);
  }
  private formalCache: Set<number> | null = null;

  /** 구역 중심에서의 확장 한계 (체비쇼프 칸) */
  zoneLimit(z: Zone): number {
    return z.hub ? GRID.hub.limit : this.zoneFormal(z) ? GRID.formal.limit : GRID.local.limit;
  }

  /** 구역 처리 전력 (kW) */
  zoneCap(z: Zone): number {
    return this.zoneFormal(z) ? GRID.formal.cap : z.hub ? GRID.hub.cap : GRID.local.cap;
  }

  /**
   * 구역의 공급 노드: 허브(24칸)·구역을 만든 발전기(10칸)·변전소(18칸)와, 이들에서 12칸씩 이어진 전봇대(6칸).
   * 각 노드 [x, y, 반경]
   */
  zoneNodes(z: Zone, linked?: Set<number>, wires?: Wire[]): [number, number, number][] {
    const at = (b: Building): [number, number] => {
      const t = this.refTile(b);
      return [t % this.width, Math.floor(t / this.width)];
    };
    const nodes: [number, number, number][] = [];
    const creator = this.buildings.get(z.creator);
    if (z.hub && this.hub) nodes.push([...at(this.hub), GRID.hub.radius]);
    else if (creator && isGeneratorType(creator.type)) nodes.push([...at(creator), GRID.local.radius]);
    for (const b of this.buildings.values()) if (b.type === 'substation' && b.zone === z.id) nodes.push([...at(b), GRID.formal.radius]);
    // 전봇대: 이미 이어진 노드에서 12칸 안이면 차례로 잇는다 (id 순으로 고정)
    const poles = [...this.buildings.values()].filter((b) => b.type === 'pole' && b.zone === z.id).sort((a, c) => a.id - c.id);
    let grew = true;
    const done = new Set<number>();
    while (grew) {
      grew = false;
      for (const p of poles) {
        if (done.has(p.id)) continue;
        const [px, py] = at(p);
        // 가장 가까운 이어진 노드에 전선을 건다 (그림용. 이어지는지는 12칸 안이면 된다)
        let from: [number, number, number] | null = null;
        let fd = Infinity;
        for (const n of nodes) {
          const d = Math.max(Math.abs(n[0] - px), Math.abs(n[1] - py));
          if (d <= GRID.pole.link && d < fd) [from, fd] = [n, d];
        }
        if (from) {
          done.add(p.id);
          linked?.add(p.id);
          wires?.push([from[0], from[1], from[2], px, py]);
          nodes.push([px, py, GRID.pole.radius]);
          grew = true;
        }
      }
    }
    return nodes;
  }

  /** (x, y) 칸에 전기를 주는 구역 (여럿이면 중심이 가까운 곳, 같으면 id가 작은 곳). 없으면 null */
  zoneAt(x: number, y: number): Zone | null {
    if (this.gridDirty) this.rebuildGrid();
    let best: Zone | null = null;
    let bd = Infinity;
    for (const z of this.zones) {
      const limit = this.zoneLimit(z);
      if (Math.max(Math.abs(x - z.x), Math.abs(y - z.y)) > limit) continue;
      const nodes = this.nodeCache.get(z.id) ?? [];
      if (!nodes.some(([nx, ny, r]) => Math.max(Math.abs(x - nx), Math.abs(y - ny)) <= r)) continue;
      const d = (x - z.x) ** 2 + (y - z.y) ** 2;
      if (d < bd || (d === bd && best && z.id < best.id)) [best, bd] = [z, d];
    }
    return best;
  }

  /** 건물이 속한 전력 구역 (기준 칸이 공급 범위 안). 예전 세계·범위 밖이면 null */
  zoneOf(b: Building): Zone | null {
    if (!this.regional) return null;
    if (this.gridDirty) this.rebuildGrid();
    const id = this.zoneOfB.get(b.id);
    return id ? (this.zones.find((z) => z.id === id) ?? null) : null;
  }

  /** 전봇대·변전소를 놓을 때 붙을 구역: 이어진 노드에서 12칸 안이고 구역 확장 한계 안 */
  private nodeZoneFor(x: number, y: number): Zone | null {
    if (this.gridDirty) this.rebuildGrid();
    let best: Zone | null = null;
    let bd = Infinity;
    for (const z of this.zones) {
      if (Math.max(Math.abs(x - z.x), Math.abs(y - z.y)) > this.zoneLimit(z)) continue;
      const nodes = this.nodeCache.get(z.id) ?? [];
      if (!nodes.some(([nx, ny]) => Math.max(Math.abs(x - nx), Math.abs(y - ny)) <= GRID.pole.link)) continue;
      const d = (x - z.x) ** 2 + (y - z.y) ** 2;
      if (d < bd) [best, bd] = [z, d];
    }
    return best;
  }

  /** 새 전력 건물의 구역 정하기 (place에서). 공급 범위 밖에 놓은 발전기는 새 구역을 만든다 */
  private assignZone(b: Building): void {
    if (!this.regional) return;
    const t = this.refTile(b);
    const x = t % this.width;
    const y = Math.floor(t / this.width);
    if (b.type === 'pole' || b.type === 'substation') b.zone = this.nodeZoneFor(x, y)?.id ?? 0;
    else if (isGeneratorType(b.type)) {
      const z = this.zoneAt(x, y);
      if (z) b.zone = z.id;
      else {
        b.zone = this.nextZoneId++;
        this.zones.push({ id: b.zone, x, y, hub: false, creator: b.id, budget: GRID.charge });
      }
    }
    this.gridDirty = true;
  }

  private rebuildGrid(): void {
    this.formalCache = null;
    this.coverCache = null;
    this.gridDirty = false;
    this.nodeCache.clear();
    const linked = new Set<number>();
    for (const z of this.zones) this.nodeCache.set(z.id, this.zoneNodes(z, linked));
    // 전봇대·변전소는 지은 순서와 상관없이 이어진다:
    // 끊긴 전봇대는 구역에서 풀고, 아직 안 붙은 것은 더 붙을 곳이 없을 때까지 다시 붙인다 (id 순)
    const zoneIds = new Set(this.zones.map((z) => z.id));
    const loose: Building[] = [];
    for (const b of this.buildings.values()) {
      if (b.type !== 'pole' && b.type !== 'substation') continue;
      if (b.zone && (!zoneIds.has(b.zone) || (b.type === 'pole' && !linked.has(b.id)))) b.zone = 0;
      if (!b.zone) loose.push(b);
    }
    loose.sort((a, c) => a.id - c.id);
    let grew = loose.length > 0;
    while (grew) {
      grew = false;
      for (const b of loose) {
        if (b.zone) continue;
        const t = this.refTile(b);
        const z = this.nodeZoneFor(t % this.width, Math.floor(t / this.width));
        if (!z) continue;
        b.zone = z.id;
        if (b.type === 'substation') this.formalCache = null;
        this.nodeCache.set(z.id, this.zoneNodes(z, linked));
        grew = true;
      }
    }
    this.wireCache = [];
    for (const z of this.zones) this.zoneNodes(z, undefined, this.wireCache);
    this.zoneOfB.clear();
    for (const b of this.buildings.values()) {
      if (isLineType(b.type) || b.type === 'road') continue;
      const t = this.refTile(b);
      const z = this.zoneAt(t % this.width, Math.floor(t / this.width));
      if (z) this.zoneOfB.set(b.id, z.id);
    }
  }

  /** 전선 (그림용): 이어 준 노드 [x, y, 반경]에서 전봇대 칸 [x, y]로 */
  powerWires(): readonly Wire[] {
    if (this.gridDirty) this.rebuildGrid();
    return this.wireCache;
  }
  private wireCache: Wire[] = [];

  /** 전력 공급 칸 지도 (구역 노드 범위 ∩ 확장 한계). 배치가 바뀔 때만 다시 센다 */
  powerCover(): Uint8Array {
    if (this.gridDirty) this.rebuildGrid();
    if (this.coverCache) return this.coverCache;
    const m = new Uint8Array(this.width * this.height);
    for (const z of this.zones) {
      const lim = this.zoneLimit(z);
      for (const [nx, ny, r] of this.nodeCache.get(z.id) ?? []) {
        const xa = Math.max(0, nx - r, z.x - lim);
        const xb = Math.min(this.width - 1, nx + r, z.x + lim);
        const ya = Math.max(0, ny - r, z.y - lim);
        const yb = Math.min(this.height - 1, ny + r, z.y + lim);
        for (let y = ya; y <= yb; y++) m.fill(1, y * this.width + xa, y * this.width + xb + 1);
      }
    }
    return (this.coverCache = m);
  }
  private coverCache: Uint8Array | null = null;

  /** 이 건물이 지금 받는 전력 비율 (0~1). 예전 세계는 공장 전체 하나 */
  satOf(b: Building): number {
    if (!this.regional) return this.power.satisfaction;
    const z = this.zoneOf(b);
    return z ? (this.zoneState.get(z.id)?.satisfaction ?? 1) : 0;
  }

  /** 이 칸의 지형·날씨를 반영한 태양광 한 대 출력 (kW) */
  solarAt(b: Building): number {
    if (!this.regional) return this.solarOutput();
    const i = this.refTile(b);
    return SOLAR_POWER * (1 - darkness(this.time)) * TERRAIN[this.terrainAt(i)].solar * this.weatherEffect(i).solar;
  }

  windAt(b: Building): number {
    if (!this.regional) return this.windOutput();
    const i = this.refTile(b);
    return this.weatherEffect(i).wind * TERRAIN[this.terrainAt(i)].wind;
  }

  /**
   * 지역 전력: 구역마다 따로 수요·발전을 맞춘다. 같은 틱 안에서
   * 1) 비연료 발전(허브·태양광·풍력·지열·수력) 2) 수전 3) 축전 방전 4) 석탄·연료 발전 순으로 쓴다.
   * 송전 요청은 하류에서 상류로 모으고(선로마다 95%로 나눔), 전달은 상류에서 하류로 한다. 순환 연결은 만들지 않는다
   */
  private updateGrid(): void {
    if (this.gridDirty) this.rebuildGrid();
    this.powerSrc.clear();
    const sun = 1 - darkness(this.time);
    type Acc = {
      z: Zone;
      demand: number;
      charge: number;
      free: number;
      hydros: Building[];
      coal: Building[];
      fuel: Building[];
      accs: Building[];
      cap: number;
      recv: number;
      sent: number;
      discharge: number;
      fuelUsed: number;
      stored: number;
      geo: number;
      solar: number;
      wind: number;
      local0: number;
      recvGeo: number;
      ren: Building[];
    };
    const st = new Map<number, Acc>();
    for (const z of this.zones) {
      st.set(z.id, { z, demand: 0, charge: 0, free: z.hub ? HUB_BASE_POWER : 0, hydros: [], coal: [], fuel: [], accs: [], cap: this.zoneCap(z), recv: 0, sent: 0, discharge: 0, fuelUsed: 0, stored: 0, geo: 0, solar: 0, wind: 0, local0: 0, recvGeo: 0, ren: [] });
    }
    for (const b of this.buildings.values()) {
      const zid = this.zoneOfB.get(b.id);
      const s = zid ? st.get(zid) : undefined;
      if (b.crafting && b.def.power > 0 && s) s.demand += this.workPower(b);
      if (b.type === 'solar' || b.type === 'wind') {
        b.load = s ? (b.type === 'solar' ? (sun > 0 ? this.solarAt(b) : 0) : this.windAt(b)) : 0;
        b.status = b.load > 0 ? 'working' : 'idle';
        if (s) {
          s.free += b.load;
          if (b.type === 'solar') s.solar += b.load;
          else s.wind += b.load;
          s.ren.push(b);
        }
      } else if (b.type === 'geothermal') {
        b.load = s ? GRID.geothermal : 0;
        b.status = s ? 'working' : 'idle';
        if (s) {
          s.free += b.load;
          s.geo += b.load;
          s.ren.push(b);
        }
      } else if (b.type === 'generator' || b.type === 'hydro' || b.type === 'fuel-generator') {
        const has = b.energy > 0 || b.fuel > 0 || countOf(b.inBuf, 'charcoal') > 0;
        if (!has || !s) {
          b.load = 0;
          b.status = b.type === 'hydro' ? 'no-water' : 'no-fuel';
        } else (b.type === 'hydro' ? s.hydros : b.type === 'generator' ? s.coal : s.fuel).push(b);
      } else if (b.type === 'accumulator' && s) {
        s.accs.push(b);
        s.stored += b.energy;
      }
    }
    // 차량 충전: 구역 충전 예산 안에서 도착 순서·id 순으로
    this.chargeGrant.clear();
    const wants: { v: Vehicle; want: number; z: number }[] = [];
    for (const v of this.vehicles.values()) {
      const want = this.chargeWant(v);
      if (want <= 0) continue;
      const spot = this.chargeSpot(v);
      const zid = spot ? this.zoneOfB.get(spot.id) : undefined;
      if (zid) wants.push({ v, want, z: zid });
    }
    wants.sort((a, c) => a.v.arrivedAt - c.v.arrivedAt || a.v.id - c.v.id);
    const left = new Map(this.zones.map((z) => [z.id, z.budget]));
    for (const w of wants) {
      const g = Math.min(w.want, left.get(w.z) ?? 0);
      if (g <= 0) continue;
      left.set(w.z, left.get(w.z)! - g);
      this.chargeGrant.set(w.v.id, g);
      st.get(w.z)!.charge += g;
    }
    // 송전 연결: 보내는 터미널 → 받는 터미널 (구역이 다르고 둘 다 구역 안)
    const links: { src: Building; from: number; to: number; out: number; send: number }[] = [];
    for (const b of this.buildings.values()) {
      if (b.type !== 'terminal' || !b.send || !b.partner) continue;
      const dst = this.buildings.get(b.partner);
      const from = this.zoneOfB.get(b.id);
      const to = dst ? this.zoneOfB.get(dst.id) : undefined;
      if (from && to && from !== to) links.push({ src: b, from, to, out: 0, send: 0 });
    }
    links.sort((a, c) => a.src.id - c.src.id);
    const order = this.zoneOrder(links);
    const hydroCap = (s: Acc) => s.hydros.length * HYDRO_POWER;
    const nonfuel = (s: Acc) => s.free + hydroCap(s);
    // 요청: 하류부터
    const req = new Map<number, number>();
    for (let k = order.length - 1; k >= 0; k--) {
      const s = st.get(order[k])!;
      let down = 0;
      for (const l of links) if (l.from === s.z.id) down += l.out;
      const r = Math.max(0, Math.min(s.cap, s.demand + s.charge) + down - nonfuel(s));
      req.set(s.z.id, r);
      // 이 구역으로 들어오는 선로들에 나눠 요청 (터미널 id 순, 선로마다 받을 수 있는 1.9MW까지)
      let rest = r;
      for (const l of links) {
        if (l.to !== s.z.id) continue;
        const got = Math.min(rest, GRID.link.cap * GRID.link.efficiency);
        l.out = got / GRID.link.efficiency;
        rest -= got;
      }
    }
    // 전달: 상류부터
    for (const id of order) {
      const s = st.get(id)!;
      const need = Math.min(s.cap, s.demand + s.charge);
      let avail = nonfuel(s) + s.recv;
      let served = Math.min(need, avail);
      s.local0 = served;
      avail -= served;
      // 보내는 전기 중 지열 몫 (H09)
      const geoShare = nonfuel(s) > 0 ? s.geo / nonfuel(s) : 0;
      for (const l of links) {
        if (l.from !== id) continue;
        const send = Math.min(l.out, avail, Math.max(0, s.cap - served - s.sent));
        avail -= send;
        s.sent += send;
        l.send = send;
        st.get(l.to)!.recv += send * GRID.link.efficiency;
        st.get(l.to)!.recvGeo += send * GRID.link.efficiency * geoShare;
      }
      // 모자라면 축전기 방전, 그래도 모자라면 석탄·연료 발전
      let deficit = need - served;
      for (const a of s.accs) {
        if (deficit <= 0) break;
        const can = Math.min(GRID.accumulator.rate, Math.max(0, (a.energy - GRID.accumulator.capacity * GRID.accumulator.floor) / DT));
        const d = Math.min(can, deficit);
        a.energy -= d * DT;
        a.load = -d;
        deficit -= d;
        served += d;
        s.discharge += d;
        // H07: 맑은 낮 태양광으로 채운 몫이 모래 바람 중 작업에
        if (this.terrainAt(this.refTile(a)) === 'sand' && this.localWeather('sand').kind === 'sandstorm' && this.localWeather('sand').strength >= 1 && s.demand > 0) {
          const kept = this.ach.get(`acc:${a.id}`);
          const use = Math.min(kept, d * DT);
          if (use > 0) {
            this.ach.add('h07', use);
            this.ach.add(`acc:${a.id}`, -use);
          }
        }
      }
      const fuelCap = s.coal.length * GENERATOR_POWER + s.fuel.length * GRID.fuel.power;
      const burn = Math.min(fuelCap, Math.max(0, deficit));
      served += burn;
      s.fuelUsed = burn;
      const share = fuelCap > 0 ? burn / fuelCap : 0;
      this.burn(s.coal, GENERATOR_POWER * share, COAL_ENERGY);
      this.burn(s.fuel, GRID.fuel.power * share, GRID.fuel.energy);
      // 남는 비연료 전기로 축전 (방전한 틱에는 충전하지 않는다)
      let spare = s.discharge > 0 ? 0 : avail;
      for (const a of s.accs) {
        if (s.discharge > 0) break;
        const room = (GRID.accumulator.capacity - a.energy) / (DT * GRID.accumulator.efficiency);
        const c = Math.min(GRID.accumulator.rate, room, spare);
        a.energy += c * DT * GRID.accumulator.efficiency;
        if (c > 0 && this.terrainAt(this.refTile(a)) === 'sand' && darkness(this.time) === 0 && this.localWeather('sand').kind === 'clear' && s.free > 0) {
          this.ach.add(`acc:${a.id}`, c * DT * GRID.accumulator.efficiency * (s.solar / s.free));
        }
        a.load = c;
        spare -= c;
        avail -= c;
      }
      // 수력: 허브·태양광·풍력·지열을 먼저 쓰고 모자란 만큼만 물을 태운다
      const used = nonfuel(s) + s.recv - avail;
      const hydroUse = Math.max(0, Math.min(hydroCap(s), used - s.free));
      this.burn(s.hydros, s.hydros.length ? hydroUse / s.hydros.length : 0, WATER_ENERGY);
      const demand = s.demand + s.charge;
      const satisfaction = demand === 0 ? 1 : Math.min(1, served / demand);
      // 실적: 구역의 작업 전기, 허브 밖 발전원이 준 몫, 정식 구역의 작업 전기
      const work = s.demand * satisfaction * DT;
      this.stats.zoneWork.set(id, (this.stats.zoneWork.get(id) ?? 0) + work);
      this.stats.genWork += Math.max(0, work - (s.z.hub ? Math.min(HUB_BASE_POWER, nonfuel(s)) * DT : 0));
      if (s.cap > GRID.hub.cap) this.stats.formalWork += work;
      this.ach.addWin(`zw:${id}`, work, this.time);
      // 업적: 최종 소비를 발전원별로 (허브·태양광·풍력·지열 → 수력 → 수전 → 축전 → 연료)
      const hub = s.z.hub ? HUB_BASE_POWER : 0;
      const fuelCapNow = s.coal.length * GENERATOR_POWER + s.fuel.length * GRID.fuel.power;
      const src = this.creditSources(s.local0, { hub, solar: s.solar, wind: s.wind, geo: s.geo }, hydroCap(s), s.recv, s.discharge, s.fuelUsed, fuelCapNow ? (s.coal.length * GENERATOR_POWER) / fuelCapNow : 0);
      const total = s.demand + s.charge;
      const workFrac = total > 0 ? s.demand / total : 0;
      const day = Math.floor(this.time / DAY_SEC);
      if ((src.get('link') ?? 0) > 0 && s.recv > 0 && TERRAIN_IDS[this.terrain ? this.terrain[this.idx(s.z.x, s.z.y)] : 0] === 'forest') {
        this.ach.add('h09', (src.get('link')! * (s.recvGeo / s.recv)) * workFrac * DT);
      }
      if (this.isNight() && s.demand >= 100) this.ach.add(`d09:${id}:${day}`, (src.get('storage') ?? 0) * workFrac * DT);
      this.achSolarWind(src, workFrac, s.wind, id, [...s.ren, ...s.hydros]);
      for (const b of s.coal) this.ach.addWin(`tg:${this.terrainAt(this.refTile(b))}`, b.load * DT, this.time);
      for (const b of s.fuel) this.ach.addWin(`tg:${this.terrainAt(this.refTile(b))}`, b.load * DT, this.time);
      // 선택 도전: 지열·수전·한밤 축전이 실제 작업에 준 몫, 구역 중심 지형의 지금 날씨별 작업 전기
      if (work > 0) {
        this.stats.geoWork += Math.min(work, s.geo * DT);
        this.stats.linkWork += Math.min(work, s.recv * DT);
        if (darkness(this.time) >= 0.99) this.stats.nightStorage += Math.min(work, s.discharge * DT);
        const lw = this.localWeather(this.terrainAt(this.idx(s.z.x, s.z.y)));
        const kind = lw.strength >= 0.5 ? lw.kind : 'clear';
        this.stats.weatherWork.set(kind, (this.stats.weatherWork.get(kind) ?? 0) + work);
      }
      this.zoneState.set(id, {
        demand: s.demand,
        charge: s.charge,
        nonfuel: nonfuel(s),
        received: s.recv,
        sent: s.sent,
        discharge: s.discharge,
        fuel: s.fuelUsed,
        stored: s.accs.reduce((a, b) => a + b.energy, 0),
        storeMax: s.accs.length * GRID.accumulator.capacity,
        capacity: nonfuel(s) + s.recv + fuelCap + s.accs.length * GRID.accumulator.rate,
        cap: s.cap,
        satisfaction,
        request: req.get(id) ?? 0,
      });
    }
    for (const l of links) this.linkFlow.set(l.src.id, l.send);
    // 차량 충전은 구역 비율만큼
    for (const [vid, g] of this.chargeGrant) {
      const v = this.vehicles.get(vid)!;
      const spot = this.chargeSpot(v);
      const zid = spot ? this.zoneOfB.get(spot.id) : undefined;
      this.chargeGrant.set(vid, g * (zid ? (this.zoneState.get(zid)?.satisfaction ?? 0) : 0));
    }
    // 화면용 합계
    let demand = 0;
    this.ach.roll(this.time);
    let capacity = 0;
    let supply = 0;
    let charge = 0;
    for (const z of this.zoneState.values()) {
      demand += z.demand + z.charge;
      capacity += z.capacity;
      supply += (z.demand + z.charge) * z.satisfaction;
      charge += z.charge;
    }
    this.power = { demand, capacity, supply, satisfaction: demand ? supply / demand : 1, charge };
  }

  /**
   * 최종 소비(served) 중 앞부분 local0을 발전원 순서대로 나눈다: 허브·태양광·풍력·지열(나눠서) → 수력 → 수전,
   * 그 뒤 축전 방전과 연료(석탄 몫 coalShare). 업적 누적(kJ)과 이번 틱 발전원별 kW에 더한다
   */
  private creditSources(local0: number, free: Record<'hub' | 'solar' | 'wind' | 'geo', number>, hydroCap: number, recv: number, discharge: number, fuel: number, coalShare: number): Map<string, number> {
    const out = new Map<string, number>();
    const freeTotal = free.hub + free.solar + free.wind + free.geo;
    const f = Math.min(local0, freeTotal);
    if (freeTotal > 0) for (const [k, v] of Object.entries(free)) out.set(k, (f * v) / freeTotal);
    const h = Math.min(Math.max(0, local0 - f), hydroCap);
    out.set('hydro', h);
    out.set('link', Math.max(0, Math.min(recv, local0 - f - h)));
    out.set('storage', discharge);
    out.set('coal', fuel * coalShare);
    out.set('fuel', fuel * (1 - coalShare));
    for (const [k, v] of out) {
      if (v <= 0) continue;
      this.powerSrc.set(k, (this.powerSrc.get(k) ?? 0) + v);
      this.ach.add(`e:${k}`, v * DT);
    }
    return out;
  }

  /**
   * 업적: 풍력·태양광의 쓰임 (H04 비 오는 날 지은 풍력의 공급, H12 낮 태양광·한밤 풍력, 지형별 발전량).
   * 구역 하나의 발전원별 kW(src), 그중 작업 몫, 그 구역 풍력 출력 합
   */
  private achSolarWind(src: Map<string, number>, workFrac: number, windOut: number, zone: number, ren: Building[]): void {
    const day = Math.floor(this.time / DAY_SEC);
    const sun = src.get('solar') ?? 0;
    const wind = src.get('wind') ?? 0;
    if (darkness(this.time) === 0 && sun > 0) this.ach.add(`h12d:${day}`, sun * workFrac * DT);
    if (this.isNight() && wind > 0) this.ach.add(`h12n:${day}`, wind * workFrac * DT);
    const frac = windOut > 0 ? wind / windOut : 0;
    for (const b of ren) {
      if (this.terrain && b.load > 0) this.ach.addWin(`tg:${this.terrainAt(this.refTile(b))}`, b.load * DT, this.time);
      if (b.type === 'wind' && frac > 0 && this.ach.get(`ww:${b.id}`)) {
        this.ach.add(`w:${b.id}`, b.load * frac * DT);
        if (this.ach.get(`w:${b.id}`) >= 1000) this.ach.add('h04', 1);
      }
    }
    // H14: 한밤에 이 구역 충전 중 풍력 몫
    if (this.isNight() && wind > 0) {
      let served = 0;
      for (const v of src.values()) served += v;
      for (const [vid, g] of this.chargeGrant) {
        const v = this.vehicles.get(vid);
        const spot = v ? this.chargeSpot(v) : null;
        if (!spot || (this.regional && this.zoneOfB.get(spot.id) !== zone)) continue;
        this.ach.add(`vw:${vid}:${day}`, g * (wind / Math.max(1, served)) * DT);
      }
    }
  }

  /** 송전 연결을 따라 상류 구역부터 (Kahn 순서, 같은 단계는 id 순). 연결이 없는 구역도 들어간다 */
  private zoneOrder(links: { from: number; to: number }[]): number[] {
    const ids = this.zones.map((z) => z.id).sort((a, b) => a - b);
    const indeg = new Map(ids.map((id) => [id, 0]));
    for (const l of links) indeg.set(l.to, (indeg.get(l.to) ?? 0) + 1);
    const out: number[] = [];
    const ready = ids.filter((id) => !indeg.get(id));
    while (ready.length) {
      ready.sort((a, b) => a - b);
      const id = ready.shift()!;
      out.push(id);
      for (const l of links) {
        if (l.from !== id) continue;
        indeg.set(l.to, indeg.get(l.to)! - 1);
        if (indeg.get(l.to) === 0) ready.push(l.to);
      }
    }
    // 순환에 걸린 구역은 (만들지 못하게 막지만 혹시라도) 마지막에
    for (const id of ids) if (!out.includes(id)) out.push(id);
    return out;
  }

  /** 트럭이 충전하는 건물 (정류장·길가 충전기) */
  private chargeSpot(v: Vehicle): Building | null {
    if (v.charger) {
      for (const b of this.buildings.values()) {
        if (b.type !== 'charger') continue;
        const x = v.tile % this.width;
        const y = Math.floor(v.tile / this.width);
        if (Math.abs(b.x - x) + Math.abs(b.y - y) === 1) return b;
      }
      return null;
    }
    if (!this.routeOk(v)) return v.home ? (this.buildings.get(v.home) ?? null) : null;
    return this.buildings.get(v.stopId) ?? null;
  }

  /**
   * 송전 연결: src 터미널에서 dst 터미널로 (dst = 0이면 끊기, 케이블은 허브로 돌려준다).
   * 두 터미널은 다른 구역에 있어야 하고, 거리 128칸 이하, 구역마다 보내기·받기 3개까지, 순환 없음.
   * 이을 때 고용량 케이블 (맨해튼 거리 ÷ 8 올림)개를 허브에서 낸다
   */
  linkTerminals(src: Building, dstId: number): UseResult {
    if (!this.regional || src.type !== 'terminal') return { ok: false, reason: '송전 터미널이 아니에요' };
    if (!dstId) {
      if (!src.partner) return { ok: false, reason: '이어진 곳이 없어요' };
      this.unlinkTerminal(src);
      return { ok: true };
    }
    const dst = this.buildings.get(dstId);
    if (!dst || dst.type !== 'terminal' || dst === src) return { ok: false, reason: '받을 송전 터미널을 골라 주세요' };
    if (src.partner || dst.partner) return { ok: false, reason: '터미널 하나는 한 연결에만 써요 (먼저 끊어 주세요)' };
    const from = this.zoneOf(src);
    const to = this.zoneOf(dst);
    if (!from || !to) return { ok: false, reason: '두 터미널 모두 전력 구역 안에 있어야 해요' };
    if (from === to) return { ok: false, reason: '같은 구역끼리는 잇지 않아요' };
    const a = this.refTile(src);
    const b = this.refTile(dst);
    const dist = Math.abs((a % this.width) - (b % this.width)) + Math.abs(Math.floor(a / this.width) - Math.floor(b / this.width));
    if (dist > GRID.link.range) return { ok: false, reason: `너무 멀어요 (${dist}칸, 최대 ${GRID.link.range}칸)` };
    const links = [...this.buildings.values()].filter((t) => t.type === 'terminal' && t.send && t.partner);
    const ends = links.map((t) => [this.zoneOf(t)?.id, this.zoneOf(this.buildings.get(t.partner)!)?.id]);
    if (ends.filter(([f]) => f === from.id).length >= GRID.link.maxPerZone) return { ok: false, reason: '이 구역은 이미 3곳에 보내요' };
    if (ends.filter(([, t]) => t === to.id).length >= GRID.link.maxPerZone) return { ok: false, reason: '받는 구역은 이미 3곳에서 받아요' };
    // 순환: to에서 따라가 from에 닿으면 안 된다
    const seen = new Set<number>([to.id]);
    const stack = [to.id];
    while (stack.length) {
      const z = stack.pop()!;
      if (z === from.id) return { ok: false, reason: '전기가 돌아서 다시 오는 연결은 만들 수 없어요' };
      for (const [f, t] of ends) if (f === z && t && !seen.has(t)) seen.add(t), stack.push(t);
    }
    const cables = Math.ceil(dist / GRID.link.perCable);
    if (this.stockOf('hc-cable') < cables) return { ok: false, reason: `고용량 케이블 ${cables}개가 필요해요` };
    addTo(this.stock, 'hc-cable', -cables);
    src.partner = dst.id;
    dst.partner = src.id;
    src.send = true;
    dst.send = false;
    src.cable = cables;
    return { ok: true };
  }

  private unlinkTerminal(t: Building): void {
    const other = this.buildings.get(t.partner);
    const src = t.send ? t : other;
    if (src?.cable) addTo(this.stock, 'hc-cable', src.cable);
    if (src) src.cable = 0;
    if (other) {
      other.partner = 0;
      other.send = false;
    }
    t.partner = 0;
    t.send = false;
  }

  /** 구역의 차량 충전 예산 (0~800kW) */
  setZoneBudget(id: number, kw: number): boolean {
    const z = this.zones.find((x) => x.id === id);
    if (!z || !Number.isFinite(kw)) return false;
    z.budget = Math.max(0, Math.min(800, Math.round(kw / 50) * 50));
    return true;
  }

  // ───────────────────────── 다품목 예약 운송 (regional-v1, docs/물류-회수-운영규칙.md §4~10) ─────────────────────────

  /** 정류장에 연결한 창고군 (지정한 창고가 아직 몸체에 맞닿아 있을 때만). 없으면 빈 목록 */
  dockGroup(st: Building): Building[] {
    if (!st.dock) return [];
    const s = this.buildings.get(st.dock);
    if (s?.type !== 'storage') return [];
    const g = this.touchingStorageGroups(st).find((x) => x.group.includes(s));
    return g ? [...g.group].sort((a, b) => a.id - b.id) : [];
  }

  /** 물류 보관 풀: 정류장 자체와 연결 창고군 (실제 보관물들) */
  poolOf(st: Building): Building[] {
    return [st, ...this.dockGroup(st)];
  }

  /** 보관물 하나에 든 item 실물 (정류장은 싣기·내리기 칸 모두) */
  private holderCount(h: Building, item: ItemId): number {
    return countOf(h.inBuf, item) + (h.type === 'station' ? countOf(h.outBuf, item) : 0);
  }

  /** 풀의 item 실물 합계 (같은 창고를 두 번 세지 않는다) */
  poolCount(st: Building, item: ItemId): number {
    let n = 0;
    for (const h of this.poolOf(st)) n += this.holderCount(h, item);
    return n;
  }

  /** 풀의 남은 공간 (입고 예약을 뺀 값) */
  poolFree(st: Building): number {
    let room = Math.max(0, STATION_CAPACITY - sumOf(st.stationMode === 'unload' ? st.outBuf : st.inBuf));
    const g = this.dockGroup(st);
    if (g.length) room += Math.max(0, this.storageCapacity(g[0]) - this.storageTotal(g[0]));
    return Math.max(0, room - this.inReserved(st));
  }

  /** 보관물에 걸린 출고 예약 (다른 트럭이 실기로 한 몫) */
  reservedAt(holder: Building, item: ItemId): number {
    let n = 0;
    for (const r of this.reservations) if (r.dir === 'out' && r.holder === holder.id && r.item === item) n += r.n;
    return n;
  }

  /** 목적지 풀(정류장 id)로 오는 입고 예약: item을 주면 그 품목만 */
  inReserved(st: Building, item?: ItemId): number {
    let n = 0;
    for (const r of this.reservations) if (r.dir === 'in' && r.holder === st.id && (!item || r.item === item)) n += r.n;
    return n;
  }

  /** 창고군에 연결된 정류장들로 오는 입고 예약 합계 (벨트가 그 공간을 먼저 차지하지 않게) */
  private groupInReserved(group: Building[]): number {
    let n = 0;
    for (const st of this.buildings.values()) {
      if (st.type !== 'station' || !st.dock) continue;
      const g = this.dockGroup(st);
      if (g.length && g[0] === group[0]) n += this.inReserved(st);
    }
    return n;
  }

  /** 목적지의 추가 요청량: 목표 - 실물 - 입고 예정 (목표가 없으면 제한 없음) */
  requestOf(st: Building, item: ItemId): number {
    const target = st.targets.get(item);
    if (target === undefined) return Infinity;
    return Math.max(0, target - this.poolCount(st, item) - this.inReserved(st, item));
  }

  /** 계획 운송 노선인지: 확장 세계, 계획이 있고, 싣기 → 내리기 두 정류장 */
  planned(v: Vehicle): boolean {
    return this.regional && v.plan.length > 0 && v.stops.length === 2 && v.stops[0].act === 'load' && v.stops[1].act === 'unload';
  }

  /** 트럭의 예약을 푼다 (dir을 주면 그쪽만) */
  releaseReservations(v: Vehicle, dir?: 'in' | 'out'): void {
    this.reservations = this.reservations.filter((r) => r.v !== v.id || (dir && r.dir !== dir));
  }

  /**
   * 적재 차례가 된 트럭의 예약: 품목마다 min(이번 편 상한 - 실은 것, 출발지 가용, 목적지 요청, 목적지 공간, 차량 여유)만큼
   * 출발지 실제 보관물(정류장 먼저, 창고 id 순)과 목적지 풀에 함께 건다. 품목 순서는 편마다 돌린다
   */
  private reserveTrip(v: Vehicle, src: Building, dst: Building): number {
    this.releaseReservations(v);
    let room = this.truckCapacity(v) - v.load;
    let space = this.poolFree(dst);
    let total = 0;
    const n = v.plan.length;
    for (let k = 0; k < n; k++) {
      const { item, cap } = v.plan[(v.planTurn + k) % n];
      const want = Math.min(cap - countOf(v.cargo, item), this.requestOf(dst, item), space, room);
      if (want <= 0) continue;
      let got = 0;
      for (const h of this.poolOf(src)) {
        const free = this.holderCount(h, item) - this.reservedAt(h, item);
        const k2 = Math.min(free, want - got);
        if (k2 <= 0) continue;
        this.reservations.push({ v: v.id, holder: h.id, item, n: k2, dir: 'out' });
        got += k2;
        if (got >= want) break;
      }
      if (got <= 0) continue;
      this.reservations.push({ v: v.id, holder: dst.id, item, n: got, dir: 'in' });
      room -= got;
      space -= got;
      total += got;
    }
    v.planTurn = (v.planTurn + 1) % Math.max(1, n);
    return total;
  }

  /** 예약한 몫을 보관물에서 한 개 실는다 (정류장 먼저). 실었으면 true */
  private loadOne(v: Vehicle): boolean {
    for (const r of this.reservations) {
      if (r.v !== v.id || r.dir !== 'out' || r.n <= 0) continue;
      const h = this.buildings.get(r.holder);
      if (!h || this.holderCount(h, r.item) <= 0) {
        r.n = 0;
        continue;
      }
      this.markLoaded(v, this.buildings.get(v.stops[0].id) ?? h, r.item);
      if (countOf(h.inBuf, r.item) > 0) addTo(h.inBuf, r.item, -1);
      else addTo(h.outBuf, r.item, -1);
      addTo(v.cargo, r.item, 1);
      r.n--;
      this.reservations = this.reservations.filter((x) => x.n > 0);
      return true;
    }
    return false;
  }

  /**
   * 계획 운송의 싣는 곳: 정기편 출발 10초 전부터 적재 차례 → 예약 → 10개/초로 최대 10초 → 싣지 못한 예약은 해제 → 예정 시각에 출발.
   * 요청이 없거나 재료가 없으면 빈 왕복을 하지 않고 다음 편을 기다린다
   */
  private loadPlanned(v: Vehicle, st: Building): void {
    const dst = this.buildings.get(v.stops[1].id)!;
    if (v.returning) this.returnCargo(v, st);
    // 일시정지: 새 편을 싣지 않는다 (실은 화물은 한 번 배송한 뒤 빈 차로 대기)
    if (v.paused) {
      this.releaseReservations(v, 'out');
      if (v.load > 0) {
        this.trimInbound(v);
        v.loadTimer = -1;
        if (this.batteryFull(v)) this.goTo(v, 1);
        else v.status = 'charging';
        return;
      }
      v.status = 'paused';
      v.loadTimer = -1;
      return;
    }
    if (v.loadTimer < 0) {
      // 정기편은 출발 10초 전부터 적재 차례, 예전 방식은 빈 편 뒤 5초 쉬었다가
      if (v.period > 0 ? this.time < v.nextDue - 10 : this.time < v.nextDue) {
        v.status = 'scheduled';
        return;
      }
      const got = this.reserveTrip(v, st, dst);
      if (got <= 0 && v.load <= 0) {
        // 빈 편: 이번 주기를 넘긴다
        const want = v.plan.some((p) => this.requestOf(dst, p.item) > 0);
        v.status = want ? 'no-supply' : 'satisfied';
        if (v.period > 0) v.nextDue = Math.max(v.nextDue, this.time) + v.period;
        else v.nextDue = this.time + TRUCK.wait;
        return;
      }
      v.loadTimer = 0;
      v.timer = 0;
    }
    const gap = 1 / TRUCK.transfer;
    v.loadTimer += DT;
    v.timer = Math.min(gap, v.timer + DT);
    const pending = this.reservations.some((r) => r.v === v.id && r.dir === 'out');
    if (pending && v.timer >= gap - 1e-9 && v.loadTimer <= 10 + 1e-9) {
      v.timer -= gap;
      if (this.loadOne(v)) {
        v.status = 'loading';
        return;
      }
    }
    if (pending && v.loadTimer < 10) {
      v.status = 'loading';
      return;
    }
    // 적재 끝: 남은 출고 예약 해제, 실은 만큼만 입고 예약 유지
    this.releaseReservations(v, 'out');
    this.trimInbound(v);
    if (v.load <= 0) {
      v.loadTimer = -1;
      return;
    }
    if (v.period > 0 && this.time < v.nextDue && !v.early) {
      v.status = 'scheduled';
      return;
    }
    if (!this.batteryFull(v)) {
      v.status = 'charging';
      return;
    }
    v.nextDue = v.period > 0 ? Math.max(v.nextDue + v.period, this.time + 1) : this.time;
    v.loadTimer = -1;
    this.ach.num.set(`tl:${v.id}`, v.load);
    this.goTo(v, 1);
  }

  /**
   * 반송해 온 화물을 출발 정류장 풀에 내린다 (정류장 칸 → 연결 창고). 공간이 없으면 정류장 자리 회수 더미로.
   * 반송은 새 배송·생산 실적이 아니다
   */
  private returnCargo(v: Vehicle, st: Building): void {
    const g = this.dockGroup(st);
    for (const [item, n] of [...v.cargo]) {
      let left = n;
      const k1 = Math.min(left, Math.max(0, STATION_CAPACITY - sumOf(st.inBuf)));
      if (k1 > 0) addTo(st.inBuf, item, k1);
      left -= k1;
      if (left > 0 && g.length) {
        const k2 = Math.min(left, Math.max(0, this.storageCapacity(g[0]) - this.storageTotal(g[0])));
        if (k2 > 0) addTo(g[0].inBuf, item, k2);
        left -= k2;
      }
      if (left > 0) this.addPile(this.idx(st.x, st.y), item, left, this.nextPileEv++, 'truck');
      v.cargo.delete(item);
    }
    this.releaseReservations(v);
    v.returning = false;
    v.loadTimer = -1;
  }

  /**
   * 계획 운송의 예외 (확장 세계): 목적지가 사라지거나 내리기 정류장이 아니게 되면 실은 화물을 출발지로 반송,
   * 길이 끊기면 목적지 입고 예약을 풀어 먼 공간을 잠그지 않는다 (다시 이어지면 도착해서 빈 공간에 내린다).
   * 따로 처리했으면 true (updateVehicle이 더 하지 않는다)
   */
  private planExceptions(v: Vehicle): boolean {
    if (!this.regional || !v.plan.length || v.stops.length !== 2) return false;
    const src = this.buildings.get(v.stops[0].id);
    const dst = this.buildings.get(v.stops[1].id);
    const dstOk = dst?.type === 'station' && dst.stationMode === 'unload';
    if (!v.returning && v.load > 0 && !dstOk && (v.state === 'to-unload' || v.state === 'unloading')) {
      this.releaseReservations(v);
      v.returning = true;
    }
    if (!v.returning || this.routeOk(v)) return false;
    // 목적지가 없어 노선이 깨진 채로 반송: 출발 정류장까지 직접 간다
    if (src?.type !== 'station') {
      v.status = 'no-station';
      return true;
    }
    v.state = 'to-load';
    if (!this.drive(v, src)) {
      if (v.status === 'moving') v.status = 'returning';
      return true;
    }
    this.returnCargo(v, src);
    v.status = 'no-station';
    return true;
  }

  /** 트럭의 화물을 지금 칸의 회수 더미에 내려놓는다 (확장 세계). 예약은 끝 */
  dumpCargo(v: Vehicle): boolean {
    if (!this.regional || v.load <= 0) return false;
    const ev = this.nextPileEv++;
    for (const [item, n] of v.cargo) this.addPile(v.tile, item, n, ev, 'truck');
    v.cargo.clear();
    this.releaseReservations(v);
    v.returning = false;
    v.loadTimer = -1;
    return true;
  }

  /** 입고 예약을 실제로 실은 화물만큼으로 줄인다 */
  private trimInbound(v: Vehicle): void {
    for (const r of this.reservations) if (r.v === v.id && r.dir === 'in') r.n = Math.min(r.n, countOf(v.cargo, r.item));
    this.reservations = this.reservations.filter((r) => r.n > 0);
  }

  /**
   * 계획 운송의 내리는 곳: 품목을 돌려 가며 풀(정류장 → 연결 창고)에 내린다. 입고 예약을 실물로 바꾼다.
   * 최대 10초 또는 5초 동안 하나도 못 내리면 남은 화물은 반송 (출발 정류장으로 가져가 내린다)
   */
  private unloadPlanned(v: Vehicle, st: Building): void {
    if (v.returning) {
      // 목적지가 바뀐 채 도착: 내리지 않고 출발지로
      this.goTo(v, 0);
      return;
    }
    if (v.loadTimer < 0) {
      v.loadTimer = 0;
      v.stuck = 0;
    }
    const gap = 1 / TRUCK.transfer;
    v.loadTimer += DT;
    v.stuck += DT;
    v.timer = Math.min(gap, v.timer + DT);
    const items = [...v.cargo.keys()].filter((i) => countOf(v.cargo, i) > 0);
    if (!items.length) {
      // 정기편 한 편을 다 내렸으면 성공 1회 (출발지 → 목적지 조합마다)
      if (v.period > 0 && this.ach.get(`tl:${v.id}`) >= 2) this.ach.add(`d27:${v.stops[0].id}>${st.id}`, 1);
      this.ach.num.delete(`tl:${v.id}`);
      this.releaseReservations(v);
      v.loadTimer = -1;
      v.status = 'unloading';
      return this.leave(v);
    }
    if (v.timer >= gap - 1e-9) {
      v.timer -= gap;
      for (let k = 0; k < items.length; k++) {
        const item = items[(v.planTurn + k) % items.length];
        if (!this.dropInto(st, item)) continue;
        addTo(v.cargo, item, -1);
        this.recordDelivery(v, st, item);
        const r = this.reservations.find((x) => x.v === v.id && x.dir === 'in' && x.item === item);
        if (r) r.n--;
        this.reservations = this.reservations.filter((x) => x.n > 0);
        v.lapUnloaded++;
        if (v.kind === 'advanced') this.advDelivered++;
        v.stuck = 0;
        v.planTurn++;
        v.status = 'unloading';
        return;
      }
    }
    if (v.loadTimer >= 10 || v.stuck >= 5) {
      // 반송
      this.releaseReservations(v);
      v.returning = true;
      v.loadTimer = -1;
      v.status = 'returning';
      this.goTo(v, 0);
      return;
    }
    v.status = v.stuck > gap * 2 ? 'unload-full' : 'unloading';
  }

  /** 목적지 풀에 한 개 내린다 (정류장 칸 먼저, 그다음 연결 창고). 내렸으면 true */
  private dropInto(st: Building, item: ItemId): boolean {
    const buf = st.stationMode === 'unload' ? st.outBuf : st.inBuf;
    if (sumOf(buf) < STATION_CAPACITY) {
      addTo(buf, item, 1);
      return true;
    }
    const g = this.dockGroup(st);
    if (g.length && this.storageTotal(g[0]) < this.storageCapacity(g[0])) {
      addTo(g[0].inBuf, item, 1);
      return true;
    }
    return false;
  }

  /** 운송 계획 바꾸기 (품목별 1회 상한, 정기편 주기 초, 조기 출발). 합계가 적재량을 넘으면 거절 */
  setPlan(v: Vehicle, plan: { item: ItemId; cap: number }[], period: number, early: boolean): boolean {
    const total = plan.reduce((a, p) => a + p.cap, 0);
    if (total > this.truckCapacity(v)) return false;
    // 아직 싣지 않은 예약은 다시 계산한다 (이미 실은 화물의 입고 예약은 그대로)
    this.releaseReservations(v, 'out');
    v.plan = plan.map((p) => ({ ...p }));
    v.period = period;
    v.early = early;
    // 같은 노선 트럭들은 주기/대수 간격으로 나눠 출발
    const same = [...this.vehicles.values()].filter((o) => o.stops.length === 2 && o.stops[0].id === v.stops[0].id && o.stops[1].id === v.stops[1].id && o.period > 0);
    const k = Math.max(0, same.indexOf(v));
    v.nextDue = this.time + (period > 0 && same.length ? (k * period) / same.length : 0);
    v.loadTimer = -1;
    return true;
  }

  /** 정류장 연결 창고 (닿은 창고군 중 하나, 0 = 없음). 바꾸면 그 정류장에서 싣기로 한 예약을 다시 계산한다 */
  setDock(st: Building, storage: number): boolean {
    if (st.type !== 'station') return false;
    if (storage) {
      const s = this.buildings.get(storage);
      if (s?.type !== 'storage' || !this.touchingStorageGroups(st).some((g) => g.group.includes(s))) return false;
    }
    st.dock = storage;
    for (const v of this.vehicles.values()) if (v.stops.some((s) => s.id === st.id)) this.releaseReservations(v, 'out');
    return true;
  }

  /** 목적지 목표 재고 (n = 0이면 지운다) */
  setTarget(st: Building, item: ItemId, n: number): boolean {
    if (st.type !== 'station' || !Number.isFinite(n) || n < 0) return false;
    if (n === 0) st.targets.delete(item);
    else st.targets.set(item, Math.floor(n));
    return true;
  }

  private updatePower(): void {
    if (this.regional) return this.updateGrid();
    let demand = 0;
    let solar = 0;
    let sunAll = 0;
    let windAll = 0;
    const gens: Building[] = [];
    const hydros: Building[] = [];
    const sun = this.solarOutput();
    const wind = this.windOutput();
    for (const b of this.buildings.values()) {
      if (b.crafting && b.def.power > 0) demand += this.workPower(b);
      if (b.type === 'solar' || b.type === 'wind') {
        b.load = b.type === 'solar' ? sun : wind;
        solar += b.load;
        if (b.type === 'solar') sunAll += b.load;
        else windAll += b.load;
        b.status = b.load > 0 ? 'working' : 'idle';
      } else if (b.type === 'generator' || b.type === 'hydro') {
        if (b.energy > 0 || b.fuel > 0 || countOf(b.inBuf, 'charcoal') > 0) (b.type === 'hydro' ? hydros : gens).push(b);
        else {
          b.load = 0;
          b.status = b.type === 'hydro' ? 'no-water' : 'no-fuel';
        }
      }
    }
    // 정류장에 선 트럭의 충전도 공장 전력을 쓴다 (모자라면 기계처럼 같은 비율로 느려진다)
    let charge = 0;
    for (const v of this.vehicles.values()) charge += this.chargeWant(v);
    demand += charge;
    // 허브·태양광·풍력: 아무것도 들지 않는 전력
    const free = HUB_BASE_POWER + solar;
    const capacity = free + hydros.length * HYDRO_POWER + gens.length * GENERATOR_POWER;
    const supply = Math.min(demand, capacity);
    const satisfaction = demand === 0 ? 1 : Math.min(1, capacity / demand);
    // 아무것도 안 드는 허브·태양광을 먼저 쓰고, 모자란 만큼 수력(물)이,
    // 그래도 모자라면 석탄 발전기가 나눠서 부담한다 (석탄은 아껴 쓴다).
    let rest = Math.max(0, supply - free);
    const hydroLoad = hydros.length ? Math.min(HYDRO_POWER, rest / hydros.length) : 0;
    rest = Math.max(0, rest - hydroLoad * hydros.length);
    const genLoad = gens.length ? rest / gens.length : 0;
    // 실적: 허브(400kW) 밖 발전원이 기계 작업에 준 전기
    this.stats.genWork += Math.max(0, (demand - charge) * satisfaction - HUB_BASE_POWER) * DT;
    this.burn(hydros, hydroLoad, WATER_ENERGY);
    this.burn(gens, genLoad, COAL_ENERGY);
    this.power = { demand, capacity, supply, satisfaction, charge };
    // 업적: 최종 소비를 발전원별로 (허브·태양광·풍력 → 수력 → 석탄)
    this.powerSrc.clear();
    const src = this.creditSources(Math.min(supply, free + hydroLoad * hydros.length), { hub: HUB_BASE_POWER, solar: sunAll, wind: windAll, geo: 0 }, hydroLoad * hydros.length, 0, 0, genLoad * gens.length, 1);
    const ren = [...hydros];
    for (const b of this.buildings.values()) if (b.type === 'solar' || b.type === 'wind') ren.push(b);
    this.achSolarWind(src, demand > 0 ? (demand - charge) / demand : 0, windAll, 0, ren);
  }

  /** 지금 태양광 패널 한 대의 출력 (kW): 해가 있는 만큼 × 날씨 */
  solarOutput(): number {
    return SOLAR_POWER * (1 - darkness(this.time)) * weatherMix(this.seed, this.time, (k) => SOLAR_WEATHER[k]);
  }

  /** 지금 풍력 발전기 한 대의 출력 (kW): 날씨만 따른다 */
  windOutput(): number {
    return weatherMix(this.seed, this.time, (k) => WIND_POWER[k]);
  }

  /**
   * 발전기들이 load(kW)만큼 한 틱 동안 연료(석탄·물)를 쓴다. 연료 1개 = unit kJ.
   * 석탄 발전기는 숯(inBuf)을 먼저 태운다 (끝없이 얻는 쪽을 먼저, 석탄은 아껴 쓴다)
   */
  private burn(gens: Building[], load: number, unit: number): void {
    for (const g of gens) {
      g.load = load;
      g.energy -= load * DT;
      while (g.energy <= 0) {
        if (countOf(g.inBuf, 'charcoal') > 0) {
          addTo(g.inBuf, 'charcoal', -1);
          g.energy += CHARCOAL_ENERGY;
        } else if (g.fuel > 0) {
          g.fuel--;
          g.energy += unit;
          if (g.type === 'generator') this.ach.flags.add('ore');
          // H10: 사막 수력이 태운 물 (트럭으로 반입한 물과 대응)
          if (g.type === 'hydro' && this.terrain && ['sand', 'rock'].includes(this.terrainAt(this.refTile(g)))) this.ach.add('h10burn', 1);
        } else break;
      }
      if (g.energy < 0) g.energy = 0;
      g.status = load > 0 ? 'working' : 'idle';
    }
  }

  private updateCrafting(b: Building): void {
    if (!b.crafting) return;
    const sat = this.satOf(b);
    const time = this.craftTime(b);
    const speed = sat;
    b.progress += DT * speed;
    b.status = sat <= 0 && this.regional && !this.zoneOf(b) ? 'no-power' : sat < 1 ? 'low-power' : 'working';
    if (b.progress < time) return;

    this.finishCraft(b);
    // 완료 → 분리 예약 처리 → 다음 시작 순서는 고정 (산출을 확정한 뒤 모듈을 한 번 내리고, 다음 배치는 모듈 없이)
    if (b.modBatch) this.moduleBatches++;
    if (b.detach) this.dropModule(b, 'module');
    b.modBatch = false;
    b.crafting = false;
    b.progress -= time;
    // 남은 진행도를 이어받아 바로 다음 제작을 시작해야 정확한 생산 속도가 나온다.
    this.tryStart(b);
    if (!b.crafting) b.progress = 0;
  }

  /** 기계가 만든(캔) 물건을 출력 칸에 넣고 생산 실적으로 센다 */
  private produce(b: Building, item: ItemId, n: number): void {
    addTo(b.outBuf, item, n);
    addTo(this.stats.made, item, n);
    this.ach.addWin(`m:${item}`, n, this.time);
    const z = this.regional ? this.zoneOfB.get(b.id) : undefined;
    if (z) {
      this.stats.zoneMade.set(z, (this.stats.zoneMade.get(z) ?? 0) + n);
      this.ach.addWin(`zm:${z}`, n, this.time);
    }
    if (this.terrain) this.ach.addWin(`tm:${this.terrainAt(this.refTile(b))}`, n, this.time);
    if (isMinerType(b.type) && (item === 'iron-ore' || item === 'copper-ore' || item === 'coal')) this.ach.flags.add('ore');
  }

  /** 트럭이 실은 곳(정류장·구역)과 다른 정류장에 내렸을 때 배송 실적 */
  private recordDelivery(v: Vehicle, st: Building, item: ItemId): void {
    if (!v.fromStation || v.fromStation === st.id) return;
    this.achDelivery(v, st, item);
    const s = this.stats;
    s.delivered++;
    if (this.planned(v) && v.period > 0) s.scheduledDelivered++;
    const to = this.regional ? (this.zoneOfB.get(st.id) ?? 0) : 0;
    if (v.fromZone && to && v.fromZone !== to) {
      addTo(s.itemDelivered, item, 1);
      const key = `${v.fromZone}>${to}`;
      let p = s.pairs.get(key);
      if (!p) s.pairs.set(key, (p = { n: 0, items: new Set() }));
      p.n++;
      p.items.add(item);
    }
  }

  /** 트럭이 이 정류장에서 실었다고 표시 (배송 실적의 출발지) */
  private markLoaded(v: Vehicle, st: Building, item?: ItemId): void {
    v.fromStation = st.id;
    v.fromZone = this.regional ? (this.zoneOfB.get(st.id) ?? 0) : 0;
    // 업적: 실을 때 그 정류장의 날씨, 한 바퀴 안에서 정류장별로 실은 것 (H05·H06·H11)
    this.ach.text.set(`tw:${v.id}`, this.stationWeather(st));
    if (item === 'iron-ore' || item === 'copper-ore') this.ach.add(`ll:${v.id}:${st.id}:${item}`, 1);
  }

  /** 정류장 칸의 안정된 현지 날씨 (전환이 끝난 것만). 예전 세계는 '' */
  private stationWeather(st: Building): string {
    if (!this.regional) return '';
    const lw = this.localWeather(this.terrainAt(this.refTile(st)));
    return lw.strength >= 1 ? lw.kind : 'clear';
  }

  /** 업적용 배송 기록: 한 구간 20개마다 거리·날씨 확인, 지형 사이 교역, 한 바퀴 기록, 한밤 배송 */
  private achDelivery(v: Vehicle, st: Building, item: ItemId): void {
    const a = this.ach;
    const from = this.buildings.get(v.fromStation);
    const key = `${v.fromStation}>${st.id}`;
    if (a.text.get(`tk:${v.id}`) !== key) {
      a.text.set(`tk:${v.id}`, key);
      a.num.set(`tn:${v.id}`, 0);
    }
    a.add(`tn:${v.id}`, 1);
    if (item === 'iron-ore' || item === 'copper-ore') a.add(`ld:${v.id}:${st.id}:${item}`, 1);
    const fromT = from && this.terrain ? this.terrainAt(this.refTile(from)) : null;
    const toT = this.terrain ? this.terrainAt(this.refTile(st)) : null;
    if (from && a.get(`tn:${v.id}`) === 20) {
      const dist = Math.hypot(from.x + from.size / 2 - (st.x + st.size / 2), from.y + from.size / 2 - (st.y + st.size / 2));
      a.num.set('d14', Math.max(a.get('d14'), Math.floor(dist)));
      const wxFrom = a.text.get(`tw:${v.id}`) ?? '';
      const wxTo = this.stationWeather(st);
      if (dist >= 20 && wxFrom === 'fog' && wxTo === 'fog') a.add('h05', 1);
      if (dist >= 20 && wxFrom === 'snow' && wxTo === 'snow' && fromT === 'snow' && toT === 'snow') a.add('h06', 1);
    }
    if (fromT && toT) {
      a.addWin(`td:${fromT}`, 1, this.time);
      if (toT !== fromT) a.addWin(`td:${toT}`, 1, this.time);
      if (toT !== fromT && SPECIALTY[fromT].includes(item)) a.add(`d20:${fromT}`, 1);
      if (item === 'water' && toT !== fromT && (toT === 'sand' || toT === 'rock')) a.add('h10water', 1);
    }
    const fz = v.fromZone;
    const tz = this.regional ? (this.zoneOfB.get(st.id) ?? 0) : 0;
    if (fz && tz && fz !== tz) a.addWin(`pw:${fz}>${tz}`, 1, this.time);
    // H14: 한밤에 풍력으로 1MJ 넘게 충전한 트럭의 그 밤 배송
    const day = Math.floor(this.time / DAY_SEC);
    if (this.isNight() && a.get(`vw:${v.id}:${day}`) >= 1000) {
      a.add(`vd:${v.id}:${day}`, 1);
      if (a.get(`vd:${v.id}:${day}`) >= 20) a.add('h14', 1);
    }
  }

  /** 노선 한 바퀴를 마칠 때: D15 정류장 수, H11 두 곳에서 실은 철·구리를 세 번째 정류장에 함께 납품 */
  private achLap(v: Vehicle): void {
    const a = this.ach;
    if (v.lapUnloaded >= 20 && v.tripStart >= 0) a.num.set('d15', Math.max(a.get('d15'), new Set(v.stops.map((s) => s.id)).size));
    const loads = new Map<string, Map<number, number>>();
    const drops = new Map<number, Set<string>>();
    for (const [k, n] of a.num) {
      const m = /^(ll|ld):(\d+):(\d+):(.+)$/.exec(k);
      if (!m || Number(m[2]) !== v.id) continue;
      if (m[1] === 'll') {
        let x = loads.get(m[4]);
        if (!x) loads.set(m[4], (x = new Map()));
        x.set(Number(m[3]), n);
      } else {
        let x = drops.get(Number(m[3]));
        if (!x) drops.set(Number(m[3]), (x = new Set()));
        x.add(m[4]);
      }
    }
    const big = (item: string) => [...(loads.get(item) ?? [])].filter(([, n]) => n >= 10).map(([s]) => s);
    for (const s1 of big('iron-ore')) {
      for (const s2 of big('copper-ore')) {
        if (s1 === s2) continue;
        for (const [s3, items] of drops) if (s3 !== s1 && s3 !== s2 && items.has('iron-ore') && items.has('copper-ore')) a.add('h11', 1);
      }
    }
    for (const k of [...a.num.keys()]) if (k.startsWith(`ll:${v.id}:`) || k.startsWith(`ld:${v.id}:`)) a.num.delete(k);
  }

  /** 업적의 1초 단위 처리: 날씨·밤 기록, 광석 안 쓴 시간(H15), 지하 건널목(H01), 화산 태양광(H08), 정리, 그리고 판정 */
  private achTick(): void {
    const a = this.ach;
    const day = Math.floor(this.time / DAY_SEC);
    // H15: 광맥 독립 뒤 철광석·구리광석·석탄을 한 번도 쓰지 않은 1초 (작업 수요가 있을 때)
    const recipes = ['iron-plate-c', 'copper-plate-c', 'steel-e'];
    const ok = this.researched.has('ore-independence') && this.power.demand - this.power.charge > 0 && !a.flags.has('ore');
    if (ok) a.add('h15:secs', 1);
    for (const r of recipes) {
      const now = this.stats.recipeDone.get(r) ?? 0;
      if (ok) a.add(`h15:${r}`, now - a.get(`h15last:${r}`));
      a.num.set(`h15last:${r}`, now);
    }
    // D12: 가동 구역이 95% 이상으로 버틴 안정된 현지 날씨 종류
    if (this.regional) {
      const kinds = new Set<string>();
      for (const z of this.zones) {
        const s = this.zoneState.get(z.id);
        if (!s || s.demand < 100 || s.satisfaction < 0.95) continue;
        const lw = this.localWeather(this.terrainAt(this.idx(z.x, z.y)));
        kinds.add(lw.strength >= 1 ? lw.kind : lw.strength <= 0 ? 'clear' : '');
      }
      for (const k of kinds) if (k) a.add(`wx:${k}`, 1);
      // H08: 화산의 태양광
      for (const b of this.buildings.values()) if (b.type === 'solar' && this.terrainAt(this.refTile(b)) === 'volcano' && b.load === 0) a.num.set('h08', 1);
    }
    // D09: 한 밤 안의 최대 축전 공급
    for (const [k, v] of a.num) if (k.startsWith('d09:') && v > a.get('d09max')) a.num.set('d09max', v);
    // H12: 같은 날 낮 태양광 5MJ와 한밤 풍력 5MJ
    if (a.get(`h12d:${day}`) >= 5000 && a.get(`h12n:${day}`) >= 5000) a.num.set('h12', 1);
    // H10: 사막 수력이 반입한 물로 낸 전기 (물 1개 = 300kJ)
    a.num.set('h10', Math.min(a.get('h10burn'), a.get('h10water')) * WATER_ENERGY);
    // H01: 60초 안에 같은 건널목 아래로 20개, 위로 트럭
    for (const k of a.win.keys()) {
      if (!k.startsWith('ug:')) continue;
      const id = k.slice(3);
      if (a.winSum(k, 60, this.time) >= 20 && a.winSum(`ugT:${id}`, 60, this.time) >= 1) a.num.set('h01', 1);
    }
    // 정리: 지난 날짜·없는 트럭의 기록 (1분마다)
    if (this.tickNo % (TICK_RATE * 60) === 0) {
      for (const k of [...a.num.keys()]) {
        const m = /^(h12d|h12n|d09:\d+|vw:\d+|vd:\d+):(\d+)$/.exec(k);
        if (m && Number(m[2]) < day - 1) a.num.delete(k);
        const v = /^(tn|tl|vw|vd|ll|ld):(\d+)/.exec(k);
        if (v && !this.vehicles.has(Number(v[2]))) a.num.delete(k);
      }
      for (const k of [...a.text.keys()]) if (!this.vehicles.has(Number(k.split(':')[1]))) a.text.delete(k);
    }
    evaluateAchievements(this);
    a.flags.clear();
  }

  /** D02: 최근 60초 가동률 90% 이상인 생산 기계 수 (만든 지 60초 넘은 것) */
  busyMachines(): number {
    let n = 0;
    for (const b of this.buildings.values()) {
      if (!isCrafter(b) || b.def.power <= 0 || b.stats.age < 60) continue;
      if ((this.machineStats(b)?.util ?? 0) >= 0.9) n++;
    }
    return n;
  }

  /** D18: 생산·발전 거점이 있는 지형 수 (건물 3개 이상, 최근 300초 제작 100개 또는 발전 5MJ) */
  terrainBases(): number {
    if (!this.terrain) return 0;
    const count = new Map<string, number>();
    for (const b of this.buildings.values()) {
      if (!(isCrafter(b) && b.def.power > 0) && !isGeneratorType(b.type)) continue;
      const t = this.terrainAt(this.refTile(b));
      count.set(t, (count.get(t) ?? 0) + 1);
    }
    let n = 0;
    for (const [t, c] of count) {
      if (c < 3) continue;
      if (this.ach.winSum(`tm:${t}`, 300, this.time) >= 100 || this.ach.winSum(`tg:${t}`, 300, this.time) >= 5000) n++;
    }
    return n;
  }

  /** D28: 한 조립 거점(구역)으로 최근 300초 재료가 이어진 가동 생산 거점 수 (최근 60초 생산 1개·작업 1MJ) */
  supplyNetwork(): number {
    const active = (z: number) => this.ach.winSum(`zm:${z}`, 60, this.time) >= 1 && this.ach.winSum(`zw:${z}`, 60, this.time) >= 1000;
    const edges: [number, number][] = [];
    for (const k of this.ach.win.keys()) {
      if (!k.startsWith('pw:') || this.ach.winSum(k, 300, this.time) <= 0) continue;
      const [f, t] = k.slice(3).split('>').map(Number);
      edges.push([f, t]);
    }
    let best = 0;
    for (const z of this.zones) {
      if (!edges.some(([, t]) => t === z.id)) continue;
      const seen = new Set<number>([z.id]);
      const stack = [z.id];
      while (stack.length) {
        const cur = stack.pop()!;
        for (const [f, t] of edges) if (t === cur && !seen.has(f) && active(f)) seen.add(f), stack.push(f);
      }
      const n = [...seen].filter(active).length;
      best = Math.max(best, n);
    }
    return best;
  }

  /** H16: 허브 둘레 16칸 안에 심어 지금 다 자란 나무 수 */
  gardenTrees(): number {
    if (!this.hub) return 0;
    const cx = this.hub.x + 1;
    const cy = this.hub.y + 1;
    let n = 0;
    for (const [i, st] of this.ach.trees) {
      if (st !== 2 || this.tree[i] < 1) continue;
      if (Math.hypot((i % this.width) - cx, Math.floor(i / this.width) - cy) <= 16) n++;
    }
    return n;
  }

  /** 한밤 (하루의 0.7 ~ 0.9) */
  private isNight(): boolean {
    const p = dayPhase(this.time);
    return p >= 0.7 && p < 0.9;
  }

  private finishCraft(b: Building): void {
    if (b.type === 'lumberjack') {
      // 범위에서 처음 찾은 다 자란 나무를 벤다 (그사이 누가 베었으면 다음 나무)
      const i = b.mineTiles.find((t) => this.tree[t] >= 1);
      if (i === undefined) return;
      if (this.ach.trees.get(i) === 2) this.ach.trees.set(i, 3);
      else this.ach.trees.delete(i);
      this.clearTree(i);
      this.produce(b, 'log', FOREST.logs);
      this.produce(b, 'sapling', 1);
      return;
    }
    if (b.type === 'planter') {
      const i = b.mineTiles.find((t) => this.canPlant(t));
      if (i === undefined || countOf(b.inBuf, 'sapling') <= 0) return;
      addTo(b.inBuf, 'sapling', -1);
      // 아주 조금 자란 상태로 심는다 (0은 "나무 없음")
      this.setTree(i % this.width, Math.floor(i / this.width), 0.001);
      if (this.ach.trees.get(i) === 3) this.ach.add('h02', 1);
      this.ach.trees.set(i, 1);
      this.ach.add('planted', 1);
      return;
    }
    if (b.mineDirt) {
      this.produce(b, 'dirt', 1);
      return;
    }
    if (b.type === 'sap-extractor') {
      this.produce(b, 'sap', 1);
      return;
    }
    if (b.type === 'drill') {
      const i = b.mineTiles[0];
      const item = this.resItem[i];
      if (!item || this.resAmount[i] <= 0) return;
      this.resAmount[i] -= 1;
      this.produce(b, item, 1);
      return;
    }
    if (isMinerType(b.type) && b.type !== 'pump') {
      // 광맥 전체에서 번갈아 캔다 (여러 광맥에 걸쳐 놓였으면 차례로)
      const n = b.minePatches.length;
      for (let k = 0; k < n; k++) {
        const p = this.patches.get(b.minePatches[(b.mineIdx + k) % n]);
        const item = p && !this.oreLock(p.item) ? this.takeFromPatch(p) : null;
        if (!item) continue;
        this.produce(b, item, 1);
        b.mineIdx = (b.mineIdx + k + 1) % n;
        return;
      }
      return;
    }
    if (isMinerType(b.type)) {
      // 양수기: 밑의 물 칸에서 (무한)
      const n = b.mineTiles.length;
      for (let k = 0; k < n; k++) {
        const i = b.mineTiles[(b.mineIdx + k) % n];
        const item = this.resItem[i];
        if (!item || this.resAmount[i] <= 0) continue;
        this.resAmount[i] -= 1;
        if (this.resAmount[i] <= 0) {
          this.resAmount[i] = 0;
          this.resItem[i] = null;
        }
        this.produce(b, item, 1);
        b.mineIdx = (b.mineIdx + k + 1) % n;
        return;
      }
      return;
    }
    const r = this.recipeOf(b);
    if (!r) return;
    if (r.pattern) {
      // 분리기: 정해진 순서대로 하나씩
      this.produce(b, r.pattern[b.cycle % r.pattern.length], 1);
      b.cycle = (b.cycle + 1) % r.pattern.length;
      return;
    }
    for (const o of r.outputs) this.produce(b, o.item, o.count);
    this.stats.recipeDone.set(r.id, (this.stats.recipeDone.get(r.id) ?? 0) + 1);
    this.ach.addWin(`r:${r.id}`, 1, this.time);
  }

  private pushOutputs(b: Building): void {
    if (b.outBuf.size === 0) return;
    const targets = this.targetsOf(b);
    if (targets.length === 0) return;
    for (const item of [...b.outBuf.keys()]) {
      for (let k = 0; k < targets.length; k++) {
        const t = targets[(b.outRR + k) % targets.length];
        // 쌓인 만큼 한 번에 내보낸다 (컨베이어 한 칸이 받는 만큼만)
        const sent = this.insert(t, item, b, countOf(b.outBuf, item));
        if (sent > 0) {
          addTo(b.outBuf, item, -sent);
          b.outRR = (b.outRR + k + 1) % targets.length;
          break;
        }
      }
    }
  }

  /** 들고 있는 묶음을 넘긴다. 받는 쪽이 덜 받으면 남은 건 다음 틱에 (차례는 넘긴 쪽 다음으로) */
  private pushSplitter(b: Building): void {
    if (!b.held) return;
    const targets = this.targetsOf(b).filter((t) => t.b.id !== b.heldFrom);
    if (targets.length === 0) return;
    if (b.type === 'sorter') {
      // 고른 아이템은 앞으로만, 나머지는 양옆으로만 (번갈아). 갈 곳이 막히면 기다린다.
      if (b.held === b.filter) {
        for (const t of targets) if (t.out === b.dir && this.giveHeld(b, t)) return;
        return;
      }
      // 양옆 차례(outRR)는 옆으로 보낼 때만 넘긴다. 앞으로 보낸 것 때문에 차례가 꼬이지 않게.
      const sides = targets.filter((t) => t.out !== b.dir);
      for (let k = 0; k < sides.length; k++) {
        if (this.giveHeld(b, sides[(b.outRR + k) % sides.length])) {
          b.outRR = (b.outRR + k + 1) % sides.length;
          return;
        }
      }
      return;
    }
    if (b.type === 'overflow') {
      // 앞쪽 우선. 막혔을 때만 양옆으로 번갈아 넘긴다.
      for (const t of targets) if (t.out === b.dir && this.giveHeld(b, t)) return;
      const rest = targets.filter((t) => t.out !== b.dir);
      for (let k = 0; k < rest.length; k++) {
        if (this.giveHeld(b, rest[(b.outRR + k) % rest.length])) {
          b.outRR = (b.outRR + k + 1) % rest.length;
          return;
        }
      }
      return;
    }
    for (let k = 0; k < targets.length; k++) {
      if (this.giveHeld(b, targets[(b.outRR + k) % targets.length])) {
        b.outRR = (b.outRR + k + 1) % targets.length;
        return;
      }
    }
  }

  /**
   * 하역기: 뒤에 붙은 허브·창고에서 일정 간격으로 한 묶음(앞 컨베이어 한 칸만큼)씩 꺼내 앞으로 내보낸다.
   * 아이템을 고르지 않았으면 든 것을 종류별로 번갈아 전부 꺼낸다. 앞이 막히면 꺼내지 않는다 (재고는 그대로).
   */
  private updateUnloader(b: Building): void {
    b.progress = Math.min(UNLOADER_INTERVAL, b.progress + DT);
    if (b.progress < UNLOADER_INTERVAL) return;
    const bx = b.x - DX[b.dir];
    const by = b.y - DY[b.dir];
    const src = this.buildingAt(bx, by);
    // 뒤가 허브·창고가 아니면 뒤 칸의 현지 회수 더미에서 꺼낸다 (regional-v1)
    const pile = src?.type !== 'hub' && src?.type !== 'storage' && this.inBounds(bx, by) ? this.idx(bx, by) : -1;
    const count = (item: ItemId) =>
      src?.type === 'hub'
        ? this.stockOf(item)
        : src?.type === 'storage'
          ? this.storageCount(src, item) - this.storageGroup(src).reduce((a, s) => a + this.reservedAt(s, item), 0)
          : pile >= 0 && this.piles.length
            ? this.pileCount(pile, item)
            : 0;
    // 고른 아이템, 없으면 다음 차례(b.cycle)부터 든 것 중 첫 번째
    let item = b.filter;
    if (!item) {
      for (let k = 0; k < ITEM_IDS.length && !item; k++) {
        const i = ITEM_IDS[(b.cycle + k) % ITEM_IDS.length];
        if (count(i) > 0) item = i;
      }
    }
    const have = item ? count(item) : 0;
    if (!item || have <= 0) {
      b.status = 'no-input';
      return;
    }
    for (const t of this.targetsOf(b)) {
      const sent = this.insert(t, item, b, have);
      if (sent <= 0) continue;
      if (src?.type === 'hub') addTo(this.stock, item, -sent);
      else if (src?.type === 'storage') this.storageTake(src, item, sent, true);
      else this.takePile(pile, item, sent);
      if (!b.filter) b.cycle = (ITEM_IDS.indexOf(item) + 1) % ITEM_IDS.length;
      b.progress = 0;
      b.status = 'working';
      return;
    }
    b.status = 'output-full';
  }

  /** t에 item을 최대 n개 넣는다. 넣은 개수를 돌려준다 (0 = 못 넣음) */
  private insert(t: OutTarget, item: ItemId, src: Building, n = 1): number {
    return isLineType(t.b.type) ? this.beltAccept(t.b, item, t.fromSide, n) : this.acceptStack(t.b, item, n, src, t.fromSide);
  }

  /** 컨베이어가 아닌 건물이 최대 n개 받는다. 분배기·병합기는 한 묶음을 통째로 들고, 나머지는 받는 만큼 하나씩 */
  private acceptStack(b: Building, item: ItemId, n: number, src: Building, fromSide: Dir): number {
    if (isSplitterType(b.type) || b.type === 'merger') return this.acceptItem(b, item, src, fromSide, n) ? n : 0;
    let k = 0;
    while (k < n && this.acceptItem(b, item, src, fromSide)) k++;
    return k;
  }

  /** 컨베이어가 아닌 건물이 아이템을 받는다. fromSide = 받는 건물에서 본 보내는 쪽 방향. count = 분배기·병합기가 통째로 들 개수 */
  private acceptItem(n: Building, item: ItemId, src: Building, fromSide: Dir, count = 1): boolean {
    // 지정 칸 입구가 있는 새 설비는 보내는 쪽이 입구 칸에 있어야 받는다
    if (n.def.ports ? !this.portFrom(n, src) : !acceptsFrom(n, fromSide)) return false;
    switch (n.type) {
      case 'storage': {
        // 합쳐진 창고는 묶음 전체가 한 창고 (받은 칸에 쌓는다). 트럭이 예약한 입고 공간은 비워 둔다
        const resv = this.reservations.length ? this.groupInReserved(this.storageGroup(n)) : 0;
        if (this.storageTotal(n) + resv >= this.storageCapacity(n)) return false;
        addTo(n.inBuf, item, 1);
        return true;
      }
      case 'hub':
        addTo(this.stats.hubIn, item, 1);
        // 허브 프로젝트: 실제로 허브에 도착한 설비 모듈을 남은 목표만큼 소비한다
        if (item === 'module' && this.stats.projectOn && this.stats.projectDelivered < PROJECT_GOAL) {
          this.stats.projectDelivered++;
          return true;
        }
        addTo(this.stock, item, 1);
        addTo(this.incomeBuckets[this.incomeSecond % 60], item, 1);
        return true;
      case 'station':
        // 싣기 정류장: 트럭이 올 때까지 쌓아 둔다
        if (sumOf(n.inBuf) >= STATION_CAPACITY) return false;
        addTo(n.inBuf, item, 1);
        return true;
      case 'smelter':
      case 'assembler':
      case 'crusher':
      case 'washer':
      case 'separator':
      case 'electric-furnace':
      case 'sawmill':
      case 'chem-reactor':
      case 'refinery':
      case 'electrolyzer':
      case 'large-assembler':
        return this.machineAccept(n, item);
      case 'planter':
        if (item !== 'sapling' || countOf(n.inBuf, 'sapling') >= FOREST.planterCap) return false;
        addTo(n.inBuf, 'sapling', 1);
        return true;
      case 'generator':
        // 석탄은 fuel, 숯은 inBuf에 (태울 때 에너지가 다르다). 합쳐서 GENERATOR_FUEL_CAP개까지
        if (item !== 'coal' && item !== 'charcoal') return false;
        if (n.fuel + countOf(n.inBuf, 'charcoal') >= GENERATOR_FUEL_CAP) return false;
        if (item === 'coal') n.fuel++;
        else addTo(n.inBuf, 'charcoal', 1);
        return true;
      case 'fuel-generator':
        if (item !== 'fuel' || n.fuel >= GRID.fuel.cap) return false;
        n.fuel++;
        return true;
      case 'hydro':
        if (item !== 'water' || n.fuel >= HYDRO_WATER_CAP) return false;
        n.fuel++;
        return true;
      case 'splitter':
      case 'overflow':
      case 'sorter':
        if (n.held) return false;
        n.held = item;
        n.heldN = count;
        n.heldFrom = src.id;
        return true;
      case 'merger':
        return this.mergerAccept(n, item, fromSide, count);
      default:
        return false;
    }
  }

  private machineAccept(n: Building, item: ItemId): boolean {
    let r = this.recipeOf(n);
    // 조립기는 직접 골라야 하고, 나머지는 처음 들어온 재료로 정한다
    if (!r && !needsRecipeChoice(n.type)) {
      r = this.autoRecipe(n.type as MachineKind, item);
      if (r) n.recipe = r.id;
    }
    // 처음 재료가 여러 레시피에 쓰여서 잘못 골랐을 수 있다 (철판 먼저 → 석탄 강철, 그다음 숯).
    // 쉬는 중이고, 들고 있는 재료와 새 재료를 다 쓰는 다른 레시피가 있으면 그것으로 바꾼다
    // (빈 기계는 바꾸지 않는다: 처음 들어온 재료로 정한 레시피가 섞인 컨베이어에서 오락가락하지 않게)
    const held = [...n.inBuf].filter(([, k]) => k > 0).map(([it]) => it);
    if (r && !needsRecipeChoice(n.type) && !n.crafting && held.length && !r.inputs.some((i) => i.item === item)) {
      const alt = Object.values(RECIPES).find(
        (x) =>
          x.machine === n.type &&
          this.unlockedRecipes.has(x.id) &&
          x.inputs.some((i) => i.item === item) &&
          held.every((h) => x.inputs.some((i) => i.item === h)),
      );
      if (alt) {
        n.recipe = alt.id;
        r = alt;
      }
    }
    if (!r) return false;
    const input = r.inputs.find((i) => i.item === item);
    if (!input) return false;
    if (countOf(n.inBuf, item) >= input.count * MACHINE_BUFFER_CRAFTS) return false;
    addTo(n.inBuf, item, 1);
    return true;
  }

  /** 처음 들어온 재료로 레시피를 고른다 (제련로·분쇄기 등). 재료가 하나인 레시피 우선. */
  private autoRecipe(machine: MachineKind, item: ItemId): Recipe | null {
    const candidates = Object.values(RECIPES).filter(
      (r) =>
        r.machine === machine &&
        this.unlockedRecipes.has(r.id) &&
        r.inputs.some((i) => i.item === item),
    );
    candidates.sort((a, b) => a.inputs.length - b.inputs.length);
    return candidates[0] ?? null;
  }

  /**
   * 옆 건물이 컨베이어(또는 지하 입구)에 아이템을 최대 n개 올린다 (한 칸에 쌓을 수 있는 만큼만).
   * fromSide = 받는 쪽에서 본 보내는 쪽 방향. 올린 개수를 돌려준다.
   */
  private beltAccept(belt: Building, item: ItemId, fromSide: Dir, n = 1): number {
    const entry = entryPos(belt, fromSide);
    if (entry < 0) return 0;
    for (const it of belt.items) {
      if (Math.abs(it.pos - entry) < BELT_SPACING - 1e-9) return 0;
    }
    const k = Math.min(n, belt.def.stack ?? 1);
    let i = 0;
    while (i < belt.items.length && belt.items[i].pos > entry) i++;
    belt.items.splice(i, 0, { item, pos: entry, n: k });
    return k;
  }

  /**
   * 아이템은 앞쪽부터 정렬되어 있다 (items[0]이 출구에 가장 가까움).
   * 지하 입구는 출구 앞 가장자리까지가 한 줄이라 길이가 1보다 길다.
   */
  private updateBelt(b: Building): void {
    const items: BeltItem[] = b.items;
    if (items.length === 0) return;
    const step = (b.def.speed ?? BELT_SPEED) * this.boost('endless-belt') * DT;
    const len = this.beltLength(b);
    let limit = this.frontLimit(b, len);
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (it.pos < limit) it.pos = Math.min(it.pos + step, limit);
      if (i === 0 && it.pos >= len) {
        // 받는 쪽이 덜 받으면(한 칸에 덜 쌓는 컨베이어, 칸이 모자란 기계) 남은 건 그 자리에서 기다린다
        it.n -= this.pushFromBelt(b, it.item, it.n);
        if (it.n <= 0) {
          items.shift();
          i--;
          limit = this.frontLimit(b, len);
          continue;
        }
      }
      limit = it.pos - BELT_SPACING;
    }
  }

  /** 맨 앞 아이템이 갈 수 있는 한계. 다음 컨베이어 입구 근처 아이템과 겹치지 않게 한다. */
  private frontLimit(b: Building, len: number): number {
    const n = this.nextBelt(b);
    if (!n || n.items.length === 0) return len;
    const e = entryPos(n, opposite(b.dir));
    let ahead = Infinity;
    for (const it of n.items) if (it.pos >= e && it.pos < ahead) ahead = it.pos;
    return ahead === Infinity ? len : Math.min(len, len + ahead - e - BELT_SPACING);
  }

  /** 아이템이 나가는 칸. 지하 입구는 짝 출구의 앞 칸이고, 짝 없는 입구와 출구는 막혀 있다. */
  private frontTile(b: Building): [number, number] | null {
    if (b.type === 'underground') {
      const p = b.ugMode === 'in' ? this.partnerOf(b) : null;
      return p ? [p.x + DX[p.dir], p.y + DY[p.dir]] : null;
    }
    return [b.x + DX[b.dir], b.y + DY[b.dir]];
  }

  /** src가 n(지정 칸 입구가 있는 새 설비)의 입구 칸에 있는지. 지하 입구는 아이템이 실제로 나오는 출구 자리로 본다 */
  private portFrom(n: Building, src: Building): boolean {
    const s = src.type === 'underground' && src.ugMode === 'in' ? (this.partnerOf(src) ?? src) : src;
    return portTiles(n, 'in').some(([x, y]) => s.contains(x, y));
  }

  /** 컨베이어 끝에서 앞 칸으로 최대 count개 넘긴다. 넘긴 개수 */
  private pushFromBelt(b: Building, item: ItemId, count: number): number {
    const f = this.frontTile(b);
    const n = f ? this.buildingAt(f[0], f[1]) : null;
    if (!n) return 0;
    const k = isLineType(n.type) ? this.beltAccept(n, item, opposite(b.dir), count) : this.acceptStack(n, item, count, b, opposite(b.dir));
    if (k > 0 && b.type === 'underground' && this.ugCover().ids.has(b.id)) this.ach.addWin(`ug:${b.id}`, k, this.time);
    return k;
  }

  /** 도로 아래를 건너는 지하 컨베이어: 입구 id들과, 그 사이 도로 칸 → 입구 id (도로·배치가 바뀌면 다시) */
  private ugCover(): { ids: Set<number>; tiles: Map<number, number> } {
    const ver = `${this.roadVersion}:${this.nextId}:${this.buildings.size}`;
    if (this.ugCache?.ver === ver) return this.ugCache;
    const ids = new Set<number>();
    const tiles = new Map<number, number>();
    for (const b of this.buildings.values()) {
      if (b.type !== 'underground' || b.ugMode !== 'in') continue;
      const p = this.partnerOf(b);
      if (!p) continue;
      const len = Math.abs(p.x - b.x) + Math.abs(p.y - b.y);
      for (let k = 1; k < len; k++) {
        const i = this.idx(b.x + DX[b.dir] * k, b.y + DY[b.dir] * k);
        if (!this.isRoad(i)) continue;
        ids.add(b.id);
        tiles.set(i, b.id);
      }
    }
    this.ugCache = { ver, ids, tiles };
    return this.ugCache;
  }
  private ugCache: { ver: string; ids: Set<number>; tiles: Map<number, number> } | null = null;

  // ───────────────────────── 창고 합치기 ─────────────────────────

  /**
   * 이 창고와 합쳐진 창고들 (왼쪽 위 창고부터). 빈틈없는 직사각형으로 붙은 창고만 합쳐지고,
   * 가로·세로 최대 3×4 (어느 방향이든). 튀어나온 창고는 따로 논다.
   */
  storageGroup(b: Building): Building[] {
    if (this.storagesDirty) this.groupStorages();
    return this.storageGroups.get(b.id) ?? [b];
  }

  /** 합쳐진 창고 전체에 들어갈 수 있는 개수 */
  storageCapacity(b: Building): number {
    return STORAGE_CAPACITY * this.storageGroup(b).length;
  }

  storageTotal(b: Building): number {
    let n = 0;
    for (const s of this.storageGroup(b)) n += sumOf(s.inBuf);
    return n;
  }

  storageCount(b: Building, item: ItemId): number {
    let n = 0;
    for (const s of this.storageGroup(b)) n += countOf(s.inBuf, item);
    return n;
  }

  /** 합쳐진 창고 전체의 내용물 (아이템 목록 순서) */
  storageContents(b: Building): Map<ItemId, number> {
    const all = new Map<ItemId, number>();
    for (const s of this.storageGroup(b)) for (const [item, n] of s.inBuf) addTo(all, item, n);
    return new Map(ITEM_IDS.filter((i) => countOf(all, i) > 0).map((i) => [i, countOf(all, i)]));
  }

  /** 합쳐진 창고에서 item을 n개 꺼낸다 (앞 창고부터) */
  private storageTake(b: Building, item: ItemId, n: number, free = false): void {
    for (const s of this.storageGroup(b)) {
      // free: 트럭이 예약한 몫은 남긴다 (하역기 등 다른 출고)
      const k = Math.max(0, Math.min(n, countOf(s.inBuf, item) - (free ? this.reservedAt(s, item) : 0)));
      if (k > 0) addTo(s.inBuf, item, -k);
      n -= k;
      if (n <= 0) return;
    }
  }

  /** 위·왼쪽 창고부터, 그 창고를 왼쪽 위로 하는 가장 큰 빈틈없는 직사각형을 하나씩 묶는다 */
  private groupStorages(): void {
    this.storagesDirty = false;
    this.storageGroups.clear();
    const all = [...this.buildings.values()].filter((b) => b.type === 'storage').sort((a, b) => a.y - b.y || a.x - b.x);
    const at = new Map(all.map((s) => [`${s.x},${s.y}`, s]));
    const S = BUILDINGS.storage.size;
    const { short, long } = STORAGE_GROUP_MAX;
    const used = new Set<number>();
    for (const s of all) {
      if (used.has(s.id)) continue;
      let best = [s];
      for (let h = 1; h <= long; h++) {
        for (let w = 1; w <= long; w++) {
          if (Math.min(w, h) > short || w * h <= best.length) continue;
          const cells: Building[] = [];
          for (let j = 0; j < h; j++) {
            for (let i = 0; i < w; i++) {
              const c = at.get(`${s.x + i * S},${s.y + j * S}`);
              if (c && !used.has(c.id)) cells.push(c);
            }
          }
          if (cells.length === w * h) best = cells;
        }
      }
      for (const c of best) used.add(c.id);
      if (best.length > 1) for (const c of best) this.storageGroups.set(c.id, best);
    }
  }

  // ───────────────────────── 차량 운송 ─────────────────────────

  /**
   * (x, y)에 정류장을 놓을 때 허브·창고에 바로 붙는 면. 그쪽을 앞으로 한 내리기 정류장이 되게 한다
   * (싣기 정류장이 허브에 붙어 봐야 허브는 내보내지 않으니 쓸모가 없다). 안 붙으면 null.
   */
  stationFacing(x: number, y: number): Dir | null {
    const size = BUILDINGS.station.size;
    for (const d of [0, 1, 2, 3] as Dir[]) {
      for (let i = 0; i < size; i++) {
        // d쪽 바깥 칸들: 위(0)·오른쪽(1)·아래(2)·왼쪽(3)
        const nx = d === 1 ? x + size : d === 3 ? x - 1 : x + i;
        const ny = d === 0 ? y - 1 : d === 2 ? y + size : y + i;
        const n = this.buildingAt(nx, ny);
        if (n?.type === 'hub' || n?.type === 'storage') return d;
      }
    }
    return null;
  }

  /** 정류장들 (번호 순) */
  stations(): Building[] {
    return [...this.buildings.values()].filter((b) => b.type === 'station').sort((a, b) => a.stationNo - b.stationNo);
  }

  isRoad(i: number): boolean {
    const id = this.occ[i];
    return !!id && this.buildings.get(id)?.type === 'road';
  }

  /** 트럭이 이 정류장에 서는 칸들: 정류장 테두리에 붙은 도로 */
  stationStops(st: Building): number[] {
    const res: number[] = [];
    for (const [nx, ny] of edgeNeighbors(st)) {
      if (!this.inBounds(nx, ny)) continue;
      const i = this.idx(nx, ny);
      if (this.isRoad(i) && !res.includes(i)) res.push(i);
    }
    return res;
  }

  /**
   * 노선의 구간마다 도로 길이 (칸). i번째 = stops[i]에서 다음 정류장까지 (마지막은 처음으로). 길이 없거나 정류장이 아니면 null.
   * 정보창에서 매번 길을 찾지 않도록, 도로·정류장이 바뀌기 전까지 마지막 결과를 기억한다 (시뮬레이션과 무관).
   */
  routeLegs(stops: RouteStop[]): number[] | null {
    const key = `${stops.map((s) => s.id).join(',')}|${this.roadVersion}`;
    if (this.routeCache?.key === key) return this.routeCache.legs;
    let legs: number[] | null = [];
    for (let i = 0; i < stops.length && legs; i++) {
      const a = this.buildings.get(stops[i].id);
      const b = this.buildings.get(stops[(i + 1) % stops.length].id);
      if (a?.type !== 'station' || b?.type !== 'station' || a === b) legs = null;
      else {
        const start = this.stationStops(a)[0];
        const p = start === undefined ? null : this.findPath(start, new Set(this.stationStops(b)));
        if (p) legs.push(p.length);
        else legs = null;
      }
    }
    this.routeCache = { key, legs };
    return legs;
  }
  private routeCache: { key: string; legs: number[] | null } | null = null;

  /** 두 정류장 사이 도로 길이 (칸, 한쪽). 길이 없거나 정류장이 아니면 null */
  routeLength(loadId: number, unloadId: number): number | null {
    return (
      this.routeLegs([
        { id: loadId, act: 'load' },
        { id: unloadId, act: 'unload' },
      ])?.[0] ?? null
    );
  }

  /**
   * 도로를 따라 from에서 targets 중 가장 가까운 칸까지 지나갈 칸들 (from은 빼고, 도착 칸은 넣고).
   * from이 이미 targets면 빈 배열, 갈 수 없으면 null. from은 도로가 아니어도 된다 (밑의 도로가 철거된 트럭).
   */
  findPath(from: number, targets: Set<number>): number[] | null {
    if (targets.has(from)) return [];
    if (targets.size === 0) return null;
    const prev = new Map<number, number>([[from, -1]]);
    const queue = [from];
    for (let q = 0; q < queue.length; q++) {
      const i = queue[q];
      const x = i % this.width;
      const y = (i - x) / this.width;
      for (let d = 0; d < 4; d++) {
        if (!this.inBounds(x + DX[d], y + DY[d])) continue;
        const j = this.idx(x + DX[d], y + DY[d]);
        if (prev.has(j) || !this.isRoad(j)) continue;
        prev.set(j, i);
        if (targets.has(j)) {
          const path: number[] = [];
          for (let k = j; k !== from; k = prev.get(k)!) path.push(k);
          return path.reverse();
        }
        queue.push(j);
      }
    }
    return null;
  }

  canBuildTruck(st: Building): PlaceCheck {
    if (st.type !== 'station') return { ok: false, reason: '정류장에서만 만들 수 있어요' };
    if (!this.stationStops(st).length) return { ok: false, reason: '정류장 옆에 도로가 있어야 해요' };
    if (!this.canAfford(TRUCK.cost)) return { ok: false, reason: '재료 부족' };
    return { ok: true };
  }

  /**
   * 정류장 옆 도로에 트럭을 만든다. 짝은 도로로 갈 수 있는 가장 가까운 반대 종류 정류장
   * (싣기 정류장에서 만들면 내리기 정류장, 반대도 마찬가지). 없으면 한쪽만 정해진 채로 기다린다.
   */
  buildTruck(st: Building): Vehicle | null {
    if (!this.canBuildTruck(st).ok) return null;
    const other = this.nearestStation(st, st.stationMode === 'load' ? 'unload' : 'load');
    const load = st.stationMode === 'load' ? st.id : (other?.id ?? 0);
    const unload = st.stationMode === 'load' ? (other?.id ?? 0) : st.id;
    return this.spawnTruck(this.stationStops(st)[0], [
      { id: load, act: 'load' },
      { id: unload, act: 'unload' },
    ]);
  }

  /** 같은 노선을 도는 트럭을 하나 더 만든다 (노선에서 처음 들르는, 트럭을 만들 수 있는 정류장 옆에서 출발) */
  cloneTruck(v: Vehicle): Vehicle | null {
    // 고급 트럭은 조립품 1개씩 따로 조립한다 (buildAdvancedTruck의 copy)
    if (v.kind !== 'basic') return null;
    const i = v.stops.findIndex((s) => {
      const st = this.buildings.get(s.id);
      return st?.type === 'station' && this.canBuildTruck(st).ok;
    });
    if (i < 0) return null;
    const st = this.buildings.get(v.stops[i].id)!;
    // 노선을 베끼면 싣는 곳마다 고른 짐도 같다
    return this.spawnTruck(this.stationStops(st)[0], v.stops, i);
  }

  /** 재료를 내고 tile 칸에 트럭을 놓는다 (확인은 부르는 쪽에서). 노선의 stop번째 정류장부터 */
  private spawnTruck(tile: number, stops: RouteStop[], stop = 0): Vehicle {
    for (const c of TRUCK.cost) addTo(this.stock, c.item, -c.count);
    const v = new Vehicle(this.nextVehicleId++, tile, this.width);
    v.battery = this.truckBattery();
    v.stops = stops.map((s) => ({ ...s }));
    this.goTo(v, stop);
    this.vehicles.set(v.id, v);
    this.record({ kind: 'truck-add', id: v.id, tile, stops: v.stops.map((s) => ({ ...s })) });
    return v;
  }

  /**
   * 트럭 철거. 기본 트럭은 만든 재료를 허브로 돌려준다. 고급 트럭은 포함된 조립품 1개만 지금 칸의 회수 더미로 (기본 트럭 비용은 없다).
   * 실은 짐은 예전 세계면 허브로, regional-v1이면 지금 칸의 회수 더미로. 고급 트럭 철거는 되돌리기 기록에 넣지 않는다
   */
  removeVehicle(v: Vehicle): void {
    if (v.kind === 'basic') this.record({ kind: 'truck-remove', id: v.id, tile: v.tile, stops: v.stops.map((s) => ({ ...s })) });
    const ev = this.regional ? this.nextPileEv++ : 0;
    if (v.kit) this.addPile(v.tile, v.kit.item, 1, ev, 'truck');
    else for (const c of TRUCK.cost) addTo(this.stock, c.item, c.count);
    for (const [item, n] of v.cargo) {
      if (this.regional) this.addPile(v.tile, item, n, ev, 'truck');
      else addTo(this.stock, item, n);
    }
    this.releaseReservations(v);
    this.vehicles.delete(v.id);
  }

  /** 고급 트럭을 조립할 수 있는지 (세계·연구·정류장·도로). 재료는 따로 본다 */
  advTruckSupport(st: Building | undefined): string | null {
    if (!this.regional) return '이 세계에서는 고급 트럭을 만들지 않아요';
    if (!this.researched.has(TECH_ADVANCED_TRUCK)) return `연구 "${this.tech(TECH_ADVANCED_TRUCK)?.name}"이 필요해요`;
    if (st?.type !== 'station') return '정류장이 없어요';
    if (!this.stationStops(st).length) return '정류장 옆에 도로가 필요해요';
    return null;
  }

  /** 정류장 자체 안의 조립품 (싣기 칸 + 내리기 칸) 중 예약되지 않은 수 */
  private stationFree(st: Building, item: ItemId): number {
    return Math.max(0, countOf(st.inBuf, item) + countOf(st.outBuf, item) - this.reservedAt(st, item));
  }

  /**
   * 고급 트럭 조립: 정류장 자체 → 정류장에 직접 붙은 창고군(key = 명령을 낼 때 본 군의 구조, '' = 안 봄) 순으로
   * 예약되지 않은 조립품 1개를 한 보관물에서 꺼내 고급 트럭 1대를 만든다. 검사를 모두 마친 뒤에만 바꾼다 (실패하면 id 순서도 그대로).
   * 새 트럭: 화물 0·노선 없음·배터리 0kJ, 정류장 옆 도로 중 칸 번호가 가장 작은 곳. copy = 노선(설정)만 베낄 트럭
   */
  buildAdvancedTruck(st: Building | undefined, key: string, copy?: Vehicle): UseResult {
    const no = this.advTruckSupport(st);
    if (no) return { ok: false, reason: no };
    const station = st!;
    const kit = ADVANCED_TRUCK.kit;
    const groups = this.touchingStorageGroups(station);
    const g = key ? groups.find((x) => x.key === key) : undefined;
    if (key && !g) return { ok: false, reason: '연결 창고가 바뀌었어요. 다시 확인해 주세요' };
    let holder: Building | null = null;
    if (this.stationFree(station, kit) >= 1) holder = station;
    else if (g) holder = this.groupHolder(g.group, kit);
    if (!holder) return { ok: false, reason: '이 정류장·연결 창고에 고급 트럭 조립품이 없어요' };
    const tile = Math.min(...this.stationStops(station));
    // 여기부터는 실패하지 않는다: 차감·차량 등록을 한 번에
    if (holder === station) addTo(countOf(station.inBuf, kit) > 0 ? station.inBuf : station.outBuf, kit, -1);
    else addTo(holder.inBuf, kit, -1);
    const v = new Vehicle(this.nextVehicleId++, tile, this.width);
    v.kind = 'advanced';
    v.kit = { item: kit, from: holder.id };
    v.home = station.id;
    v.battery = 0;
    if (copy) {
      v.stops = copy.stops.map((s) => ({ ...s }));
      v.stop = 0;
    }
    this.vehicles.set(v.id, v);
    return { ok: true, vehicle: v.id, from: holder.id };
  }

  /** 트럭 한 번에 싣는 개수 */
  truckCapacity(v?: Vehicle): number {
    return v?.kind === 'advanced' ? ADVANCED_TRUCK.capacity : TRUCK.capacity;
  }

  /** 달리는 동안 쓰는 전력 (kW) */
  private truckDrive(v: Vehicle): number {
    return v.kind === 'advanced' ? ADVANCED_TRUCK.drive : TRUCK.drive;
  }

  /** 종류 기본 속도 (연구 전, 칸/초) */
  private baseSpeed(v: Vehicle): number {
    return v.kind === 'advanced' ? ADVANCED_TRUCK.speed : TRUCK.speed;
  }

  /** 한 칸 달리는 데 드는 전기 (kJ). 두 종류 모두 15kJ */
  truckPerTile(v?: Vehicle): number {
    return v ? this.truckDrive(v) / this.baseSpeed(v) : TRUCK.drive / TRUCK.speed;
  }

  /** 노선 없이 조립한 정류장 옆 도로에 서 있는 고급 트럭: 그 정류장에서 충전할 수 있다 */
  private parkedAtHome(v: Vehicle): boolean {
    if (v.kind !== 'advanced' || !v.home) return false;
    const st = this.buildings.get(v.home);
    return st?.type === 'station' && this.stationStops(st).includes(v.tile) && v.x === (v.tile % this.width) + 0.5 && v.y === Math.floor(v.tile / this.width) + 0.5;
  }

  /** 두 곳만 오가는 노선 (싣는 곳 → 내리는 곳) */
  setRoute(v: Vehicle, loadId: number, unloadId: number): void {
    this.setStops(v, [
      { id: loadId, act: 'load' },
      { id: unloadId, act: 'unload' },
    ]);
  }

  /**
   * 노선 바꾸기. 지금 가거나 서 있는 정류장(같은 일)이 새 노선에도 있으면 하던 일을 계속하고,
   * 없으면 짐이 있을 때는 첫 내리는 곳, 없을 때는 첫 싣는 곳으로 간다
   */
  setStops(v: Vehicle, stops: RouteStop[]): void {
    // 노선이 바뀌면 아직 싣지 않은 예약은 푼다 (실은 화물의 입고 예약은 그대로)
    this.releaseReservations(v, 'out');
    const cur = v.stops[v.stop];
    const from = v.stops.map((s) => ({ ...s }));
    v.stops = stops.map((s) => ({ ...s }));
    if (JSON.stringify(from) !== JSON.stringify(v.stops)) {
      this.record({ kind: 'route', id: v.id, from, to: v.stops.map((s) => ({ ...s })) });
    }
    const keep = cur ? v.stops.findIndex((s) => s.id === cur.id && s.act === cur.act) : -1;
    if (keep >= 0) {
      v.stop = keep;
      return;
    }
    const want = v.load > 0 ? 'unload' : 'load';
    this.goTo(v, Math.max(0, v.stops.findIndex((s) => s.act === want)));
    v.pathTo = 0;
  }

  /** 노선의 i번째 정류장으로 출발 */
  private goTo(v: Vehicle, i: number): void {
    v.stop = i;
    v.state = v.stops[i]?.act === 'unload' ? 'to-unload' : 'to-load';
    v.timer = 0;
    v.idle = 0;
  }

  /** 노선의 다른 싣는 곳 중에 이 트럭이 지금 실을 짐이 있는 곳이 있는지 */
  private otherLoadReady(v: Vehicle): boolean {
    return v.stops.some((s, i) => {
      const st = this.buildings.get(s.id);
      return i !== v.stop && s.act === 'load' && st?.type === 'station' && this.loadableItem(st, s.item ?? null) !== null;
    });
  }

  /** 노선에 지금 정류장 말고도 act(싣기·내리기)를 하는 정류장이 있는지 */
  private hasOtherStop(v: Vehicle, act: RouteStop['act']): boolean {
    return v.stops.some((s, i) => i !== v.stop && s.act === act);
  }

  /** 트럭이 모든 싣는 곳에서 실을 아이템 (null = 아무거나). 이미 실은 짐은 그대로 둔다 */
  setTruckFilter(v: Vehicle, item: ItemId | null): void {
    v.filter = item;
    v.idle = 0;
  }

  /** 이 정류장을 노선에 넣은 트럭들 */
  trucksOf(st: Building): Vehicle[] {
    return [...this.vehicles.values()].filter((v) => v.stops.some((s) => s.id === st.id));
  }

  /** (x, y) 칸 좌표에서 가장 가까운 트럭 (반 칸 안, 화면에 보이는 자리 기준). 없으면 null */
  vehicleAt(x: number, y: number): Vehicle | null {
    const spots = this.truckSpots();
    let best: Vehicle | null = null;
    let bestD = 0.5;
    for (const v of this.vehicles.values()) {
      const p = spots.get(v.id) ?? v;
      const d = Math.hypot(p.x - x, p.y - y);
      if (d < bestD) [best, bestD] = [v, d];
    }
    return best;
  }

  /**
   * 화면용: 같은 칸에 서 있는 트럭들(정류장에서 싣고 내리거나 차례를 기다림, 충전기 앞에서 충전)을 줄 세운 자리.
   * 맨 앞(먼저 온) 트럭은 제자리, 나머지는 그 칸에서 도로를 따라 뒤쪽 칸에 한 대씩. 달리는 트럭은 지금처럼 겹쳐 지나간다.
   * 시뮬레이션은 바꾸지 않는다 (트럭은 실제로는 모두 그 칸에 있다). 줄이 없으면 빈 맵
   */
  truckSpots(): Map<number, { x: number; y: number; angle: number }> {
    const groups = new Map<number, Vehicle[]>();
    for (const v of this.vehicles.values()) {
      const parked = v.state === 'loading' || v.state === 'unloading' || v.charger;
      if (!parked) continue;
      const g = groups.get(v.tile);
      if (g) g.push(v);
      else groups.set(v.tile, [v]);
    }
    const spots = new Map<number, { x: number; y: number; angle: number }>();
    for (const [tile, g] of groups) {
      if (g.length < 2) continue;
      g.sort((a, b) => a.arrivedAt - b.arrivedAt || a.id - b.id);
      const cells = this.queueCells(tile, g[0].angle, g.length - 1);
      let prev = { x: (tile % this.width) + 0.5, y: Math.floor(tile / this.width) + 0.5 };
      g.forEach((v, k) => {
        if (k === 0) return;
        // 칸이 모자라면 마지막 칸에 겹친다
        const c = cells[Math.min(k - 1, cells.length - 1)];
        if (c === undefined) return;
        const x = (c % this.width) + 0.5;
        const y = Math.floor(c / this.width) + 0.5;
        // 앞 트럭 쪽을 본다
        spots.set(v.id, { x, y, angle: Math.atan2(prev.y - y, prev.x - x) });
        prev = { x, y };
      });
    }
    return spots;
  }

  /** tile에서 도로를 따라 가까운 순서로 n칸 (맨 앞 트럭이 온 쪽, 즉 바라보는 반대쪽을 먼저) */
  private queueCells(tile: number, angle: number, n: number): number[] {
    const w = this.width;
    // 맨 앞 트럭이 바라보는 방향 (이쪽에 있는 칸이 "앞")
    const hx = Math.cos(angle);
    const hy = Math.sin(angle);
    const dirs = [
      [0, -1],
      [1, 0],
      [0, 1],
      [-1, 0],
    ];
    // 도로를 따라 가까운 순서로 넉넉히 찾은 다음, 트럭이 온 쪽(뒤·옆)을 먼저 채우고 앞쪽은 모자랄 때만
    const found: { j: number; d: number; front: boolean }[] = [];
    const seen = new Map([[tile, 0]]);
    const queue = [tile];
    const ox = tile % w;
    const oy = Math.floor(tile / w);
    while (queue.length && found.length < n * 2 + 8) {
      const t = queue.shift()!;
      const tx = t % w;
      const ty = Math.floor(t / w);
      for (const [dx, dy] of dirs) {
        const x = tx + dx;
        const y = ty + dy;
        const j = y * w + x;
        if (!this.inBounds(x, y) || seen.has(j) || !this.isRoad(j)) continue;
        const d = seen.get(t)! + 1;
        seen.set(j, d);
        found.push({ j, d, front: (x - ox) * hx + (y - oy) * hy > 0.5 });
        queue.push(j);
      }
    }
    found.sort((p, q) => Number(p.front) - Number(q.front) || p.d - q.d);
    return found.slice(0, n).map((c) => c.j);
  }

  /** from에서 도로로 갈 수 있는 가장 가까운 정류장. prefer 종류를 먼저 고른다 */
  private nearestStation(from: Building, prefer: StationMode): Building | null {
    const start = this.stationStops(from)[0];
    if (start === undefined) return null;
    let best: Building | null = null;
    let bestScore = Infinity;
    for (const s of this.stations()) {
      if (s === from) continue;
      const p = this.findPath(start, new Set(this.stationStops(s)));
      if (!p) continue;
      const score = p.length + (s.stationMode === prefer ? 0 : 1e6);
      if (score < bestScore) [best, bestScore] = [s, score];
    }
    return best;
  }

  /** 노선의 정류장이 모두 정해져 있고, 바로 다음 정류장이 같은 곳이 아닌지 (마지막 다음은 처음) */
  routeOk(v: Vehicle): boolean {
    const n = v.stops.length;
    if (n < ROUTE_MIN) return false;
    return v.stops.every((s, i) => this.buildings.get(s.id)?.type === 'station' && s.id !== v.stops[(i + 1) % n].id);
  }

  /**
   * 이번 틱에 충전하고 싶은 전력 (kW). 정류장에 서 있고(싣는 중·내리는 중) 배터리가 덜 찼을 때만.
   * updatePower(수요 계산)와 updateVehicle(실제 충전)이 같은 값을 쓰도록 한곳에서 정한다.
   */
  private chargeWant(v: Vehicle): number {
    if (this.batteryFull(v)) return 0;
    const need = (this.truckBattery(v) - v.battery) / DT;
    if (!this.routeOk(v)) return this.parkedAtHome(v) ? Math.min(this.stationCharge(v), need) : 0;
    // 길 중간 충전기 앞에 선 트럭은 더 빨리
    if (v.charger) return Math.min(TRUCK.fastCharge, need);
    if (v.state !== 'loading' && v.state !== 'unloading') return 0;
    return Math.min(this.stationCharge(v), need);
  }

  /** 트럭 배터리 크기 (kJ). 차량 종류 기본값에 연구 "고용량 배터리"와 끝없는 연구 "트럭 성능"을 곱한다 */
  truckBattery(v?: Vehicle): number {
    const base = v?.kind === 'advanced' ? ADVANCED_TRUCK.battery : TRUCK.battery;
    return base * this.batteryTech() * this.boost('endless-truck');
  }

  /** 정류장에 서 있을 때 충전 속도 (kW) */
  stationCharge(v?: Vehicle): number {
    return (v?.kind === 'advanced' ? ADVANCED_TRUCK.charge : TRUCK.charge) * this.batteryTech();
  }

  private batteryTech(): number {
    return this.researched.has('battery') ? TRUCK.batteryTech : 1;
  }

  /** 충전기 옆 도로 칸들. 도로·정류장·충전기가 바뀔 때만 다시 센다 */
  chargerTiles(): Set<number> {
    if (this.chargerCache?.ver === this.roadVersion) return this.chargerCache.tiles;
    const tiles = new Set<number>();
    for (const b of this.buildings.values()) {
      if (b.type !== 'charger') continue;
      for (const [dx, dy] of [
        [0, -1],
        [1, 0],
        [0, 1],
        [-1, 0],
      ]) {
        const x = b.x + dx;
        const y = b.y + dy;
        if (this.inBounds(x, y) && this.isRoad(y * this.width + x)) tiles.add(y * this.width + x);
      }
    }
    this.chargerCache = { ver: this.roadVersion, tiles };
    return tiles;
  }
  private chargerCache: { ver: number; tiles: Set<number> } | null = null;

  /** 트럭 속도 (칸/초). 차량 종류 기본값에 끝없는 연구 "트럭 성능"을 곱한다 */
  truckSpeed(v?: Vehicle): number {
    return (v?.kind === 'advanced' ? ADVANCED_TRUCK.speed : TRUCK.speed) * this.boost('endless-truck');
  }

  /** 배터리가 다 찼는지 (더하고 나눌 때 생기는 아주 작은 오차는 봐준다) */
  private batteryFull(v: Vehicle): boolean {
    return v.battery >= this.truckBattery(v) - 1e-6;
  }

  private updateVehicle(v: Vehicle): void {
    // 정류장에 서 있으면 충전 (전력이 모자라면 그 비율만큼만). 노선 없는 고급 트럭도 조립한 정류장 옆이면
    const want = this.chargeWant(v);
    if (want > 0) {
      // regional-v1: 구역 충전 예산 안에서 받은 만큼 (예산을 못 받은 트럭은 기다린다)
      const got = this.regional ? (this.chargeGrant.get(v.id) ?? 0) : want * this.power.satisfaction;
      v.battery = Math.min(this.truckBattery(v), v.battery + got * DT);
      if (this.batteryFull(v)) v.battery = this.truckBattery(v);
    }
    if (this.planExceptions(v)) return;
    if (!this.routeOk(v)) {
      v.status = want > 0 ? 'charging' : 'no-station';
      return;
    }
    const st = this.buildings.get(v.stopId)!;
    if (v.state === 'to-load' || v.state === 'to-unload') {
      if (!this.drive(v, st)) return;
      v.state = v.state === 'to-load' ? 'loading' : 'unloading';
      v.timer = 0;
      v.idle = 0;
      v.arrivedAt = this.time;
    }
    if (this.planned(v)) {
      if (v.state === 'loading') this.loadPlanned(v, st);
      else this.unloadPlanned(v, st);
      return;
    }
    if (v.state === 'loading') this.loadTruck(v, st);
    else this.unloadTruck(v, st);
  }

  /** 정류장 st까지 한 틱만큼 달린다. 달린 거리만큼 배터리를 쓰고, 배터리가 없으면 천천히. 도착해 있으면 true */
  private drive(v: Vehicle, st: Building): boolean {
    if (v.charger) {
      // 다 찼거나 충전기가 없어졌으면 다시 간다
      if (this.batteryFull(v) || !this.chargerTiles().has(v.tile)) v.charger = false;
      else {
        v.status = 'charging';
        return false;
      }
    }
    const empty = v.battery <= 0;
    // regional-v1: 지금 바퀴가 있는 칸의 날씨만큼 느려진다 (칸당 전기는 그대로)
    const full = this.truckSpeed(v) * DT * (empty ? TRUCK.emptySpeed : 1) * this.weatherEffect(v.tile).truck;
    const [arrived, left] = this.move(v, st, full);
    // 한 칸에 drive / speed kJ (기본 속도 기준: 빨라져도 칸당 드는 전기는 같다)
    v.battery = Math.max(0, v.battery - (full - left) * this.truckPerTile(v));
    if (empty && v.status === 'moving') v.status = 'no-battery';
    return arrived;
  }

  /** step 칸만큼 길을 따라 움직인다. [도착했는지, 남은 거리] */
  private move(v: Vehicle, st: Building, step: number): [boolean, number] {
    for (;;) {
      const tx = (v.tile % this.width) + 0.5;
      const ty = Math.floor(v.tile / this.width) + 0.5;
      // Math.hypot은 브라우저마다 마지막 자리가 다를 수 있다. 같이 하기에서 모두 똑같이 계산하도록 sqrt로
      const d = Math.sqrt((tx - v.x) ** 2 + (ty - v.y) ** 2);
      if (d > 0) {
        v.angle = Math.atan2(ty - v.y, tx - v.x);
        if (d > step) {
          v.x += ((tx - v.x) / d) * step;
          v.y += ((ty - v.y) / d) * step;
          v.status = 'moving';
          return [false, 0];
        }
        v.x = tx;
        v.y = ty;
        step -= d;
      }
      // 칸 가운데에서만 길을 (다시) 찾는다. 목적지나 도로가 바뀌었을 때만.
      if (v.pathTo !== st.id || v.pathVer !== this.roadVersion) {
        v.path = this.findPath(v.tile, new Set(this.stationStops(st)));
        v.pathTo = st.id;
        v.pathVer = this.roadVersion;
      }
      if (!v.path) {
        v.status = 'no-route';
        if (this.reservations.length) this.releaseReservations(v);
        return [false, step];
      }
      if (v.path.length === 0) return [true, step];
      // 충전기 옆 칸: 남은 길을 갈 배터리가 모자라면 서서 가득 채운다 (넉넉하면 그냥 지나간다)
      if (v.battery < v.path.length * this.truckPerTile(v) && !this.batteryFull(v) && this.chargerTiles().has(v.tile)) {
        v.charger = true;
        v.status = 'charging';
        return [false, step];
      }
      if (step <= 0) {
        v.status = 'moving';
        return [false, 0];
      }
      v.tile = v.path.shift()!;
      const ug = this.ugCover().tiles.get(v.tile);
      if (ug) this.ach.addWin(`ugT:${ug}`, 1, this.time);
    }
  }

  /** 정류장 st에서 실을 수 있는 아이템 (item을 골랐으면 그것만, null이면 아무거나). 없으면 null */
  private loadableItem(st: Building, item: ItemId | null): ItemId | null {
    if (item) return (st.inBuf.get(item) ?? 0) > 0 ? item : null;
    return firstItem(st.inBuf);
  }

  private canLoadNow(v: Vehicle, st: Building): boolean {
    return v.load < this.truckCapacity(v) && this.loadableItem(st, v.stopItem) !== null;
  }

  /**
   * 가득 차면 출발. 덜 찼어도 잠깐(TRUCK.wait) 새 짐이 없으면 있는 만큼 싣고 출발.
   * 빈 채로는 기다리지만, 노선의 다른 싣는 곳에 이 트럭이 실을 짐이 있으면 빈 채로 그리로 간다 (빈 바퀴는 돌지 않는다)
   */
  private loadTruck(v: Vehicle, st: Building): void {
    if (v.load >= this.truckCapacity(v)) return this.leave(v);
    // 먼저 온 트럭부터 하나씩 채운다 (여럿이 나눠 실으면 모두 덜 찬 채로 떠나게 된다)
    for (const o of this.vehicles.values()) {
      if (o === v || o.state !== 'loading' || o.stopId !== v.stopId) continue;
      // 서로 다른 아이템만 싣는 트럭끼리는 기다리지 않는다
      if (o.stopItem && v.stopItem && o.stopItem !== v.stopItem) continue;
      // 앞 트럭이 지금 실을 게 없으면(고른 짐이 없음) 뒤 트럭이 먼저 싣는다 (정류장이 막히지 않게)
      if (!this.canLoadNow(o, st)) continue;
      if (o.arrivedAt < v.arrivedAt || (o.arrivedAt === v.arrivedAt && o.id < v.id)) {
        v.status = 'queued';
        v.idle = 0;
        return;
      }
    }
    const gap = 1 / TRUCK.transfer;
    v.timer = Math.min(gap, v.timer + DT);
    const item = this.loadableItem(st, v.stopItem);
    if (item) {
      v.status = 'loading';
      v.idle = 0;
      // 1/60을 여섯 번 더하면 0.1보다 아주 조금 작아서, 그만큼은 봐준다
      if (v.timer < gap - 1e-9) return;
      v.timer -= gap;
      addTo(st.inBuf, item, -1);
      addTo(v.cargo, item, 1);
      this.markLoaded(v, st, item);
      return;
    }
    v.idle += DT;
    v.status = v.load > 0 ? 'loading' : 'waiting';
    if ((v.load > 0 || this.otherLoadReady(v)) && v.idle >= TRUCK.wait) this.leave(v);
  }

  /**
   * 다 내리면 다음 정류장으로. 내리기 정류장은 앞으로 내보낼 칸에, 싣기 정류장은 다른 트럭이 실어 갈 칸에 내린다.
   * 내릴 칸이 꽉 차면 기다리지만, 노선에 다른 내리는 곳이 있으면 남은 짐을 싣고 그리로 간다
   */
  private unloadTruck(v: Vehicle, st: Building): void {
    const item = firstItem(v.cargo);
    if (!item) return this.leave(v);
    const gap = 1 / TRUCK.transfer;
    v.timer = Math.min(gap, v.timer + DT);
    if (v.timer < gap - 1e-9) return;
    const buf = st.stationMode === 'unload' ? st.outBuf : st.inBuf;
    if (sumOf(buf) >= STATION_CAPACITY) {
      if (this.hasOtherStop(v, 'unload')) return this.leave(v);
      v.status = 'unload-full';
      return;
    }
    v.timer -= gap;
    addTo(v.cargo, item, -1);
    addTo(buf, item, 1);
    this.recordDelivery(v, st, item);
    v.lapUnloaded++;
    if (v.kind === 'advanced') this.advDelivered++;
    v.status = 'unloading';
  }

  /**
   * 다음 정류장으로 떠난다. 떠날 준비가 됐어도 배터리가 다 찰 때까지는 충전한다 (그동안 짐은 계속 싣는다).
   * 노선 마지막 정류장을 떠나면 한 바퀴: 걸린 시간과 그동안 내린 개수를 기록한다
   */
  private leave(v: Vehicle): void {
    if (!this.batteryFull(v)) {
      v.status = 'charging';
      return;
    }
    const next = (v.stop + 1) % v.stops.length;
    if (next === 0) {
      this.achLap(v);
      if (v.tripStart >= 0) {
        v.lastTrip = this.time - v.tripStart;
        v.lastLoad = v.lapUnloaded;
      }
      v.tripStart = this.time;
      v.lapUnloaded = 0;
    }
    this.goTo(v, next);
  }

  // ───────────────────────── 배치 캐시 ─────────────────────────

  private targetsOf(b: Building): OutTarget[] {
    let t = this.targetCache.get(b.id);
    if (!t) {
      t = this.computeTargets(b);
      this.targetCache.set(b.id, t);
    }
    return t;
  }

  private computeTargets(b: Building): OutTarget[] {
    const res: OutTarget[] = [];
    const seen = new Set<number>();
    const isSplitter = isSplitterType(b.type);
    const outs = b.def.ports ? portTiles(b, 'out') : null;
    for (const [nx, ny, out] of edgeNeighbors(b)) {
      // 기계는 앞면(화살표)으로만, 분배기는 입구(뒤)를 뺀 세 면으로, 새 설비는 지정 출구 칸으로만 내보낸다.
      if (outs ? !outs.some(([px, py]) => px === nx && py === ny) : isSplitter ? out === opposite(b.dir) : out !== b.dir) continue;
      const n = this.buildingAt(nx, ny);
      if (!n || n === b) continue;
      const fromSide = opposite(out);
      if (isLineType(n.type)) {
        // 이 건물 쪽을 향한 컨베이어(입력)나 지하 출구는 받을 수 없다.
        if (entryPos(n, fromSide) >= 0) res.push({ b: n, fromSide, out });
        continue;
      }
      if (seen.has(n.id) || (n.def.ports ? !this.portFrom(n, b) : !acceptsFrom(n, fromSide))) continue;
      seen.add(n.id);
      res.push({ b: n, fromSide, out });
    }
    return res;
  }

  private rebuildLayout(): void {
    this.layoutDirty = false;
    this.gridDirty = true;
    this.targetCache.clear();
    const belts = [...this.buildings.values()].filter(
      (b) => isBeltType(b.type) || (b.type === 'underground' && b.ugMode === 'in'),
    );

    for (const b of belts) if (isBeltType(b.type)) b.curveFrom = this.computeCurve(b);

    // 하류(출구 쪽) 컨베이어부터 갱신해야 줄 선 아이템 사이에 빈틈이 생기지 않는다.
    const order: Building[] = [];
    const visited = new Set<number>();
    for (const start of belts) {
      const path: Building[] = [];
      let cur: Building | null = start;
      while (cur && !visited.has(cur.id)) {
        visited.add(cur.id);
        path.push(cur);
        cur = this.nextBelt(cur);
      }
      for (let i = path.length - 1; i >= 0; i--) order.push(path[i]);
    }
    this.beltOrder = order;
  }

  /** 아이템을 이어받는 다음 컨베이어 (또는 지하 입구) */
  private nextBelt(b: Building): Building | null {
    const f = this.frontTile(b);
    const n = f ? this.buildingAt(f[0], f[1]) : null;
    return n && isLineType(n.type) && entryPos(n, opposite(b.dir)) >= 0 ? n : null;
  }

  /**
   * 뒤에서 들어오는 게 없고 옆에서 하나만 들어오면 굽은 컨베이어.
   * 컨베이어뿐 아니라 출구가 이 칸을 향한 기계·분배기 등도 "들어오는 것"으로 친다.
   */
  private computeCurve(b: Building): Dir | null {
    const feeds = (side: Dir) => {
      const n = this.buildingAt(b.x + DX[side], b.y + DY[side]);
      if (!n) return false;
      if (isLineType(n.type)) {
        return n.dir === opposite(side) && (isBeltType(n.type) || n.ugMode === 'out');
      }
      return outputsToward(n, opposite(side));
    };
    if (feeds(opposite(b.dir))) return null;
    const sides = [((b.dir + 1) % 4) as Dir, ((b.dir + 3) % 4) as Dir].filter(feeds);
    return sides.length === 1 ? sides[0] : null;
  }

  // ───────────────────────── 저장 ─────────────────────────

  serialize(): SaveData {
    const res: [number, number, number][] = [];
    for (let i = 0; i < this.resItem.length; i++) {
      const item = this.resItem[i];
      if (!item) continue;
      const a = this.resAmount[i];
      res.push([i, ITEM_IDS.indexOf(item), a === Infinity ? -1 : a]);
    }
    return {
      v: 3,
      width: this.width,
      height: this.height,
      seed: this.seed,
      time: this.time,
      res,
      rev: CONTENT_REV,
      patches: this.savedPatches(),
      patchMeta: [...this.patchMeta]
        .filter(([id, m]) => this.patches.has(id) && Number.isFinite(m.initial))
        .map(([id, m]): [number, number, number] => [id, m.initial, m.item ? ITEM_IDS.indexOf(m.item) : -1]),
      stock: [...this.stock],
      researched: [...this.researched],
      ...(this.levels.size ? { levels: [...this.levels] } : {}),
      trees: this.treeList(),
      guide: [...this.guideDone],
      buildings: [...this.buildings.values()].map((b) => ({
        id: b.id,
        type: b.type,
        x: b.x,
        y: b.y,
        dir: b.dir,
        recipe: b.recipe,
        inBuf: [...b.inBuf],
        outBuf: [...b.outBuf],
        crafting: b.crafting,
        progress: b.progress,
        outRR: b.outRR,
        mineIdx: b.mineIdx,
        fuel: b.fuel,
        energy: b.energy,
        // 쌓인 칸만 개수를 붙인다 (예전 저장과 같은 모양)
        items: b.items.map((it): [ItemId, number] | [ItemId, number, number] => (it.n > 1 ? [it.item, it.pos, it.n] : [it.item, it.pos])),
        held: b.held,
        ...(b.held && b.heldN > 1 ? { heldN: b.heldN } : {}),
        heldFrom: b.heldFrom,
        ...(b.mineDirt ? { mineDirt: true } : {}),
        ...(b.cycle ? { cycle: b.cycle } : {}),
        ...(b.filter ? { filter: b.filter } : {}),
        ...(b.ugMode ? { ug: b.ugMode, partner: b.partner } : {}),
        ...(b.zone ? { zone: b.zone } : {}),
        ...(b.dock ? { dock: b.dock } : {}),
        ...(b.targets.size ? { targets: [...b.targets] } : {}),
        ...(b.type === 'terminal' && b.partner ? { partner: b.partner, ...(b.send ? { send: true, cable: b.cable } : {}) } : {}),
        ...(b.type === 'station' ? { no: b.stationNo, ...(b.stationMode === 'unload' ? { mode: 'unload' as const } : {}) } : {}),
        // 슬롯의 모듈 1개와 출처, 지금 배치가 모듈을 쓰는지, 분리 예약 (슬롯과 배치는 같은 한 개를 가리킨다)
        ...(b.module ? { mod: b.module.from } : {}),
        ...(b.modBatch ? { modBatch: true } : {}),
        ...(b.detach ? { detach: true } : {}),
      })),
      nextStationNo: this.nextStationNo,
      vehicles: [...this.vehicles.values()].map((v) => ({
        id: v.id,
        x: v.x,
        y: v.y,
        tile: v.tile,
        angle: v.angle,
        // load·unload는 노선이 생기기 전 버전도 읽을 수 있게 (처음 싣는 곳·내리는 곳)
        load: v.loadId,
        unload: v.unloadId,
        stops: v.stops.map((st) => ({ ...st })),
        stop: v.stop,
        cargo: [...v.cargo],
        state: v.state,
        timer: v.timer,
        idle: v.idle,
        battery: v.battery,
        ...(v.charger ? { charger: true } : {}),
        ...(v.filter ? { filter: v.filter } : {}),
        ...(v.kind !== 'basic' ? { kind: v.kind, kit: v.kit ?? undefined, home: v.home } : {}),
        ...(v.fromStation ? { from: [v.fromStation, v.fromZone] as [number, number] } : {}),
        ...(v.plan.length || v.returning
          ? { plan: v.plan.map((p) => ({ ...p })), period: v.period, nextDue: v.nextDue, early: v.early, loadTimer: v.loadTimer, stuck: v.stuck, returning: v.returning, planTurn: v.planTurn, paused: v.paused }
          : {}),
      })),
      // 예전 세계는 모양을 그대로 (없으면 legacy-v042로 읽는다)
      ...(this.rules !== 'legacy-v042' ? { rules: this.rules } : {}),
      ...(this.terrain ? { terrain: runLength(this.terrain), vents: [...this.vents] } : {}),
      ...(this.revealed ? { fog: runLength(this.revealed), sites: { ...this.sites } } : {}),
      ...(this.zones.length ? { zones: this.zones.map((z) => ({ ...z })), nextZoneId: this.nextZoneId } : {}),
      ...(this.reservations.length ? { resv: this.reservations.map((r) => ({ ...r })) } : {}),
      // 실적은 업적 때문에 모든 세계에 남긴다 (목표·도전은 확장 세계만)
      stats: saveStats(this.stats),
      ach: this.ach.serialize(),
      ...(this.regional ? { goals: [...this.goals], challenges: [...this.challenges] } : {}),
      ...(this.piles.length || this.nextPileEv > 1
        ? { piles: this.piles.map((p): [number, number, number, number, PileReason] => [p.tile, ITEM_IDS.indexOf(p.item), p.n, p.ev, p.why]), pileEv: this.nextPileEv }
        : {}),
      ...(this.doneCmds.size ? { cmds: [...this.doneCmds] } : {}),
      ...(this.moduleBatches || this.advDelivered ? { counters: { moduleBatches: this.moduleBatches, advDelivered: this.advDelivered } } : {}),
    };
  }

  static deserialize(data: SaveData): World {
    if (data.v !== 1 && data.v !== 2 && data.v !== 3) throw new Error('지원하지 않는 저장 버전');
    const w = new World(data.width, data.height);
    w.seed = data.seed;
    w.time = data.time;
    // 규칙 프로필이 없는 저장은 기존 세계. 모르는 프로필은 열지 않는다 (가격·규칙을 엉뚱하게 바꾸지 않게)
    const rules = data.rules ?? 'legacy-v042';
    if (!RULE_PROFILES.includes(rules)) throw new Error(`이 버전이 모르는 세계 규칙: ${rules}`);
    w.rules = rules;
    if (data.terrain) {
      w.terrain = new Uint8Array(w.width * w.height);
      let k = 0;
      for (let j = 0; j < data.terrain.length; j += 2) w.terrain.fill(data.terrain[j], k, (k += data.terrain[j + 1]));
      w.vents = [...(data.vents ?? [])];
    }
    if (data.fog) {
      w.revealed = new Uint8Array(w.width * w.height);
      let k = 0;
      for (let j = 0; j < data.fog.length; j += 2) w.revealed.fill(data.fog[j], k, (k += data.fog[j + 1]));
      w.revealedCount = w.revealed.reduce((a, b) => a + b, 0);
      w.sites = { ...(data.sites ?? {}) };
    }
    for (const [i, itemIdx, a] of data.res) {
      w.resItem[i] = ITEM_IDS[itemIdx];
      w.resAmount[i] = a < 0 ? Infinity : a;
    }
    // 나무 (숲이 생기기 전 저장에는 없다 → 불러오는 쪽에서 자연 숲을 더한다)
    if (data.trees) for (const [i, g] of data.trees) w.setTree(i % w.width, Math.floor(i / w.width), g);
    else w.forestsLoaded = false;
    // 광맥 번호 (없으면 지금 칸들로 다시 묶는다)
    for (const [i, p] of data.patches ?? []) w.patchOf[i] = p;
    // 광맥 번호가 저장돼 있을 때만 (번호를 새로 매기면 다른 광맥과 짝이 맞지 않는다)
    if (data.patches) {
      for (const [id, initial, item] of data.patchMeta ?? []) {
        w.patchMeta.set(id, { initial, item: item >= 0 ? ITEM_IDS[item] : null });
      }
    }
    // 광맥을 줄이기 전(rev 0) 맵: 먼 광맥을 1/4로
    if ((data.rev ?? 0) < 1) w.scaleFarOre(0.25);
    w.patchesDirty = true;
    w.stock = new Map(data.stock);
    for (const id of data.researched) w.applyTech(id);
    w.levels = new Map(data.levels ?? []);
    w.guideDone = new Set(data.guide ?? []);
    for (const s of data.buildings) {
      const b = new Building(s.id, s.type, s.x, s.y, s.dir);
      b.recipe = s.recipe;
      b.inBuf = new Map(s.inBuf);
      b.outBuf = new Map(s.outBuf);
      b.crafting = s.crafting;
      b.progress = s.progress;
      b.outRR = s.outRR;
      b.mineIdx = s.mineIdx;
      b.fuel = s.fuel;
      b.energy = s.energy;
      b.items = s.items.map(([item, pos, n]) => ({ item, pos, n: n ?? 1 }));
      b.held = s.held;
      b.heldN = s.held ? (s.heldN ?? 1) : 0;
      b.heldFrom = s.heldFrom;
      b.mineDirt = s.mineDirt ?? false;
      b.cycle = s.cycle ?? 0;
      b.filter = s.filter ?? null;
      b.ugMode = s.ug ?? null;
      b.partner = s.partner ?? 0;
      b.zone = s.zone ?? 0;
      b.dock = s.dock ?? 0;
      b.targets = new Map(s.targets ?? []);
      b.send = s.send ?? false;
      b.cable = s.cable ?? 0;
      b.stationNo = s.no ?? 0;
      b.stationMode = s.mode ?? 'load';
      b.module = s.mod !== undefined ? { from: s.mod } : null;
      // 슬롯이 비었는데 모듈 배치·분리 예약이 있는 손상 저장은 아이템을 만들어 맞추지 않고 효과만 버린다
      b.modBatch = !!s.modBatch && !!b.module && b.crafting;
      b.detach = !!s.detach && !!b.module;
      w.attach(b);
    }
    w.nextStationNo = data.nextStationNo ?? Math.max(0, ...w.stations().map((s) => s.stationNo)) + 1;
    for (const s of data.vehicles ?? []) {
      const v = new Vehicle(s.id, s.tile, w.width);
      v.x = s.x;
      v.y = s.y;
      v.angle = s.angle;
      if (s.stops?.length) {
        v.stops = s.stops.map((st) => ({
          id: st.id,
          act: st.act === 'unload' ? 'unload' : 'load',
          ...(st.act !== 'unload' && st.item ? { item: st.item } : {}),
        }));
        v.stop = Math.min(Math.max(0, s.stop ?? 0), v.stops.length - 1);
      } else {
        // 노선이 생기기 전 저장: 두 곳을 오가는 노선으로
        v.stops = [
          { id: s.load, act: 'load' },
          { id: s.unload, act: 'unload' },
        ];
        v.stop = s.state === 'to-load' || s.state === 'loading' ? 0 : 1;
        // 트럭마다 하나였던 싣는 짐
        v.filter = s.filter ?? null;
      }
      v.cargo = new Map(s.cargo);
      v.state = s.state;
      v.timer = s.timer;
      v.idle = s.idle;
      // 배터리가 생기기 전 저장이면 가득 찬 채로
      v.battery = s.battery ?? w.truckBattery();
      v.charger = s.charger ?? false;
      // 종류가 없는 차량은 기존 기본 트럭
      if (s.from) [v.fromStation, v.fromZone] = s.from;
      if (s.plan) {
        v.plan = s.plan.map((p) => ({ ...p }));
        v.period = s.period ?? 0;
        v.nextDue = s.nextDue ?? 0;
        v.early = s.early ?? false;
        v.loadTimer = s.loadTimer ?? -1;
        v.stuck = s.stuck ?? 0;
        v.returning = s.returning ?? false;
        v.planTurn = s.planTurn ?? 0;
        v.paused = s.paused ?? false;
      }
      if (s.kind === 'advanced') {
        v.kind = 'advanced';
        v.kit = s.kit ?? null;
        v.home = s.home ?? 0;
      }
      w.vehicles.set(v.id, v);
      w.nextVehicleId = Math.max(w.nextVehicleId, v.id + 1);
    }
    for (const [tile, itemIdx, n, ev, why] of data.piles ?? []) {
      const item = ITEM_IDS[itemIdx];
      if (item && n > 0) w.piles.push({ tile, item, n, ev, why });
    }
    w.nextPileEv = Math.max(data.pileEv ?? 1, ...w.piles.map((p) => p.ev + 1));
    w.doneCmds = new Map(data.cmds ?? []);
    w.zones = (data.zones ?? []).map((z) => ({ ...z }));
    w.reservations = (data.resv ?? []).map((r) => ({ ...r }));
    if (data.stats) w.stats = loadStats(data.stats);
    w.goals = new Set(data.goals ?? []);
    w.challenges = new Set(data.challenges ?? []);
    w.ach = AchState.from(data.ach);
    w.nextZoneId = data.nextZoneId ?? Math.max(0, ...w.zones.map((z) => z.id)) + 1;
    // 구역이 생기기 전의 확장 세계 저장이면 허브 구역을 만든다
    w.ensureHubZone();
    w.moduleBatches = data.counters?.moduleBatches ?? 0;
    w.advDelivered = data.counters?.advDelivered ?? 0;
    // v1은 입출구 방향이 없던 시절이라, 이어진 컨베이어를 보고 방향을 맞춰 준다.
    if (data.v === 1) for (const b of w.buildings.values()) w.orientLegacy(b);
    return w;
  }

  // ───────────────────────── 같이 하기 ─────────────────────────

  /**
   * 같이 하기에서 새로 들어온 사람에게 보내는 월드 전체.
   * 저장 파일에 없는 것(틱 번호, 트럭이 찾아 둔 길, 되돌리기 기록 등)까지 넣어서,
   * 받은 쪽이 이어서 돌려도 호스트와 한 틱도 다르지 않게 한다.
   */
  snapshot(): NetSnapshot {
    const lastTry: [number, number[]][] = [];
    for (const b of this.buildings.values()) if (b.lastTry.some((t) => t !== -9)) lastTry.push([b.id, [...b.lastTry]]);
    return {
      save: this.serialize(),
      tickNo: this.tickNo,
      nextId: this.nextId,
      nextVehicleId: this.nextVehicleId,
      roadVersion: this.roadVersion,
      power: { ...this.power },
      lastTry,
      vehicles: [...this.vehicles.values()].map((v) => ({
        id: v.id,
        path: v.path ? [...v.path] : null,
        pathTo: v.pathTo,
        pathVer: v.pathVer,
        arrivedAt: v.arrivedAt,
        tripStart: v.tripStart,
        lastTrip: v.lastTrip,
        lastLoad: v.lastLoad,
        lapUnloaded: v.lapUnloaded,
      })),
      truckAlias: [...this.truckAlias],
      histories: structuredClone([...this.histories]),
    };
  }

  static fromSnapshot(s: NetSnapshot): World {
    const w = World.deserialize(s.save);
    w.tickNo = s.tickNo;
    w.nextId = s.nextId;
    w.nextVehicleId = s.nextVehicleId;
    w.roadVersion = s.roadVersion;
    w.power = { ...s.power };
    for (const [id, t] of s.lastTry) {
      const b = w.buildings.get(id);
      if (b) b.lastTry = [...t];
    }
    for (const e of s.vehicles) {
      const v = w.vehicles.get(e.id);
      if (!v) continue;
      v.path = e.path ? [...e.path] : null;
      v.pathTo = e.pathTo;
      v.pathVer = e.pathVer;
      v.arrivedAt = e.arrivedAt;
      v.tripStart = e.tripStart;
      v.lastTrip = e.lastTrip;
      v.lastLoad = e.lastLoad;
      v.lapUnloaded = e.lapUnloaded;
    }
    w.truckAlias = new Map(s.truckAlias);
    w.histories = new Map(structuredClone(s.histories));
    return w;
  }

  /**
   * 시뮬레이션 상태를 숫자 하나로 (같이 하기에서 호스트와 어긋났는지 확인용).
   * 화면용 값(가동 기록, 트럭 각도, 이룬 목표)은 넣지 않는다.
   */
  checksum(): number {
    const h = new Hasher();
    h.num(this.tickNo).num(this.nextId).num(this.nextVehicleId).num(this.time);
    h.num(this.revealedCount);
    h.str(this.rules).num(this.nextPileEv).num(this.moduleBatches).num(this.advDelivered).num(this.nextZoneId);
    for (const z of this.zones) h.num(z.id).num(z.x).num(z.y).num(z.creator).num(z.budget);
    for (const r of this.reservations) h.num(r.v).num(r.holder).str(r.item).num(r.n).str(r.dir);
    const st = this.stats;
    h.num(this.ach.digest());
    h.num(st.genWork).num(st.formalWork).num(st.delivered).num(st.scheduledDelivered).num(st.projectDelivered).num(st.projectOn ? 1 : 0).num(this.goals.size).num(this.challenges.size).num(st.geoWork).num(st.linkWork).num(st.nightStorage).num(st.treesMatured);
    for (const [item, n] of st.made) h.str(item).num(n);
    for (const [k, p] of st.pairs) h.str(k).num(p.n);
    for (const p of this.piles) h.num(p.tile).str(p.item).num(p.n).num(p.ev);
    for (const [rid, r] of this.doneCmds) h.str(rid).num(r.ok ? 1 : 0).num(r.vehicle ?? 0).num(r.from ?? 0);
    for (const [item, n] of this.stock) h.str(item).num(n);
    h.num(this.researched.size);
    for (const [id, n] of this.levels) h.str(id).num(n);
    for (let i = 0; i < this.resAmount.length; i++) if (this.resItem[i]) h.num(i).num(this.resAmount[i]);
    for (let i = 0; i < this.tree.length; i++) if (this.tree[i] > 0) h.num(i).num(this.tree[i]);
    for (const b of this.buildings.values()) {
      h.num(b.id).str(b.type).num(b.x).num(b.y).num(b.dir).str(b.recipe ?? '').str(b.filter ?? '');
      h.num(b.progress).num(b.crafting ? 1 : 0).num(b.outRR).num(b.mineIdx).num(b.fuel).num(b.energy);
      h.num(b.cycle).num(b.partner).num(b.heldFrom).str(b.held ?? '').num(b.heldN).str(b.stationMode);
      h.num(b.module ? b.module.from + 1 : 0).num(b.modBatch ? 1 : 0).num(b.detach ? 1 : 0).num(b.zone).num(b.send ? 1 : 0).num(b.cable).num(b.dock);
      for (const [item, n] of b.targets) h.str(item).num(n);
      for (const [item, n] of b.inBuf) h.str(item).num(n);
      for (const [item, n] of b.outBuf) h.str(item).num(n);
      for (const it of b.items) h.str(it.item).num(it.pos).num(it.n);
    }
    for (const v of this.vehicles.values()) {
      h.num(v.id).num(v.x).num(v.y).num(v.tile).str(v.state).num(v.timer).num(v.idle).num(v.battery).num(v.charger ? 1 : 0);
      h.num(v.stop).str(v.kind).num(v.home).str(v.kit?.item ?? '').num(v.kit?.from ?? 0);
      h.num(v.fromStation).num(v.fromZone).num(v.paused ? 1 : 0);
      h.num(v.period).num(v.nextDue).num(v.loadTimer).num(v.stuck).num(v.returning ? 1 : 0).num(v.planTurn).num(v.early ? 1 : 0);
      for (const p of v.plan) h.str(p.item).num(p.cap);
      for (const s of v.stops) h.num(s.id).str(s.act).str(s.item ?? '');
      for (const [item, n] of v.cargo) h.str(item).num(n);
    }
    return h.value;
  }

  /**
   * 예전 규칙(아무 면으로나 입출력)으로 지은 건물의 방향을 새 규칙에 맞춘다.
   * - 분배기: 들어오는 컨베이어가 있는 면을 입구(뒤)로
   * - 기계: 나가는 컨베이어·허브가 가장 많고 들어오는 컨베이어가 없는 면을 출구(앞)로
   */
  orientLegacy(b: Building): void {
    const score: number[] = [0, 0, 0, 0];
    for (const [nx, ny, out] of edgeNeighbors(b)) {
      const n = this.buildingAt(nx, ny);
      if (!n) continue;
      if (isBeltType(n.type)) score[out] += n.dir === opposite(out) ? -10 : 1;
      else if (n.type === 'hub') score[out] += 2;
    }
    if (isSplitterType(b.type)) {
      const input = score.findIndex((s) => s <= -10);
      if (input >= 0) b.dir = opposite(input as Dir);
    } else if (isCrafter(b)) {
      const best = score.indexOf(Math.max(...score));
      if (score[best] > 0) b.dir = best as Dir;
    }
    this.layoutDirty = true;
  }
}

export interface SavedBuilding {
  id: number;
  type: BuildingType;
  x: number;
  y: number;
  dir: Dir;
  recipe: string | null;
  inBuf: [ItemId, number][];
  outBuf: [ItemId, number][];
  crafting: boolean;
  progress: number;
  outRR: number;
  mineIdx: number;
  fuel: number;
  energy: number;
  /** [아이템, 위치, 쌓인 개수(1이면 생략)] */
  items: ([ItemId, number] | [ItemId, number, number])[];
  held: ItemId | null;
  /** 분배기·병합기가 들고 있는 개수 (1이면 생략) */
  heldN?: number;
  heldFrom: number;
  /** 흙 채굴기만 */
  mineDirt?: boolean;
  /** 분리기 다음 차례 */
  cycle?: number;
  /** 스마트 분류기만 */
  filter?: ItemId;
  /** 지하 컨베이어만 */
  ug?: 'in' | 'out';
  partner?: number;
  /** 정류장만: 번호, 내리기면 'unload' (없으면 싣기) */
  no?: number;
  mode?: 'unload';
  /** 장착 모듈의 출처 창고 id (있으면 슬롯에 모듈 1개). 지금 배치가 모듈을 쓰는지, 분리 예약 */
  mod?: number;
  modBatch?: boolean;
  detach?: boolean;
  /** 정류장 연결 창고·목적지 목표 재고 */
  dock?: number;
  targets?: [ItemId, number][];
  /** 지역 전력: 붙은 구역, 송전 터미널의 보내는 쪽·낸 케이블 */
  zone?: number;
  send?: boolean;
  cable?: number;
}

export interface SavedVehicle {
  id: number;
  x: number;
  y: number;
  tile: number;
  angle: number;
  /** 처음 싣는 곳·내리는 곳 (노선이 생기기 전 저장은 이 둘만 있다) */
  load: number;
  unload: number;
  /** 노선과 지금 정류장 번호 */
  stops?: RouteStop[];
  stop?: number;
  cargo: [ItemId, number][];
  state: VehicleState;
  timer: number;
  idle: number;
  /** 배터리 (kJ). 없으면 가득 */
  battery?: number;
  /** 길 중간 충전기 앞에서 충전하는 중 */
  charger?: boolean;
  /** 싣는 아이템 (없으면 아무거나). 노선이 생기기 전 버전이 읽는 값 = 첫 싣는 곳의 것 */
  filter?: ItemId;
  /** 차량 종류 (없으면 기본 트럭), 고급 트럭에 포함된 조립품과 출처, 조립한 정류장 */
  kind?: TruckKind;
  kit?: { item: ItemId; from: number };
  home?: number;
  /** 마지막으로 실은 정류장과 그 전력 구역 (배송 실적) */
  from?: [number, number];
  /** 계획 운송 (regional-v1) */
  plan?: { item: ItemId; cap: number }[];
  period?: number;
  nextDue?: number;
  early?: boolean;
  loadTimer?: number;
  stuck?: number;
  returning?: boolean;
  planTurn?: number;
  paused?: boolean;
}

export interface SaveData {
  /** 1: 입출구 방향 규칙 이전, 2: 호수 추가 이전, 3: 현재 */
  v: 1 | 2 | 3;
  width: number;
  height: number;
  seed: number;
  time: number;
  /** [칸 번호, 아이템 번호, 매장량(-1 = 무한)] */
  res: [number, number, number][];
  /** 콘텐츠 개정: 0 = 광맥 줄이기 전, 1 = 지금 */
  rev?: number;
  /** [칸 번호, 광맥 번호]. 다 캐서 사라진 칸도 포함 */
  patches?: [number, number][];
  /** [광맥 번호, 처음 매장량, 아이템 번호(-1 = 모름)] */
  patchMeta?: [number, number, number][];
  stock: [ItemId, number][];
  researched: string[];
  /** 끝없는 연구 [연구 id, 단계] (없으면 모두 0) */
  levels?: [string, number][];
  /** 나무 [칸 번호, 자람 정도] (없으면 숲이 생기기 전 저장) */
  trees?: [number, number][];
  /** 이룬 목표 제목들 */
  guide?: string[];
  buildings: SavedBuilding[];
  nextStationNo?: number;
  vehicles?: SavedVehicle[];
  /** 세계 규칙 프로필 (없으면 legacy-v042) */
  rules?: RuleProfile;
  /** 지형 [번호, 이어진 칸 수, 번호, 칸 수, …] (예전 지도는 없음)과 지열 분출구 칸들 */
  terrain?: number[];
  vents?: number[];
  /** 확인한 땅 [0/1, 이어진 칸 수, …]과 거점 자리 (없으면 모두 보임) */
  fog?: number[];
  sites?: Record<string, [number, number]>;
  /** 지역 전력 구역과 다음 구역 번호 */
  zones?: Zone[];
  nextZoneId?: number;
  /** 운송 예약 */
  resv?: Reservation[];
  /** 공장 실적과 이룬 메인 목표 (regional-v1) */
  stats?: SavedStats;
  goals?: string[];
  challenges?: string[];
  /** 업적 판정 상태 */
  ach?: ReturnType<AchState['serialize']>;
  /** 현지 회수 더미 [칸 번호, 아이템 번호, 개수, 회수 사건, 이유]와 다음 사건 번호 */
  piles?: [number, number, number, number, PileReason][];
  pileEv?: number;
  /** 처리한 현지 실물 명령 [rid, 결과] (같은 명령을 다시 받아도 다시 실행하지 않게) */
  cmds?: [string, UseResult][];
  /** 목표 판정용 실제 사건 수 */
  counters?: { moduleBatches: number; advDelivered: number };
}

export interface NetSnapshot {
  save: SaveData;
  tickNo: number;
  nextId: number;
  nextVehicleId: number;
  roadVersion: number;
  power: PowerState;
  /** [건물 id, 병합기 방향별 마지막 시도 틱] (기본값이 아닌 것만) */
  lastTry: [number, number[]][];
  vehicles: {
    id: number;
    path: number[] | null;
    pathTo: number;
    pathVer: number;
    arrivedAt: number;
    tripStart: number;
    lastTrip: number;
    lastLoad: number;
    lapUnloaded: number;
  }[];
  truckAlias: [number, number][];
  histories: [number, EditHistory][];
}

/** FNV-1a. 숫자는 64비트 그대로 섞어서 아주 작은 차이도 잡는다 */
class Hasher {
  value = 0x811c9dc5;
  private f = new Float64Array(1);
  private u = new Uint32Array(this.f.buffer);

  private mix(x: number): void {
    this.value = Math.imul(this.value ^ x, 0x01000193) >>> 0;
  }

  num(n: number): this {
    this.f[0] = n;
    this.mix(this.u[0]);
    this.mix(this.u[1]);
    return this;
  }

  str(s: string): this {
    for (let i = 0; i < s.length; i++) this.mix(s.charCodeAt(i));
    this.mix(0);
    return this;
  }
}

/** 컨베이어에 들어오는 위치. 뒤·굽은 쪽은 0, 옆은 가운데(0.5), 앞에서는 못 들어온다(-1). */
export function entryPos(belt: Building, fromSide: Dir): number {
  // 지하 출구는 땅속에서만 아이템을 받는다
  if (belt.type === 'underground' && belt.ugMode !== 'in') return -1;
  if (fromSide === belt.dir) return -1;
  if (fromSide === opposite(belt.dir)) return 0;
  return belt.curveFrom === fromSide ? 0 : 0.5;
}

/**
 * 컨베이어가 아닌 건물이 fromSide(받는 쪽에서 본 방향)에서 오는 아이템을 받는 면인지.
 * - 기계: 출구(앞면)를 뺀 모든 면
 * - 분배기: 뒤쪽 입구 한 면
 * - 허브, 발전기: 모든 면
 */
export function acceptsFrom(n: Building, fromSide: Dir): boolean {
  switch (n.type) {
    case 'hub':
    case 'generator':
    case 'hydro':
    case 'storage':
    case 'planter':
      return true;
    case 'smelter':
    case 'assembler':
    case 'crusher':
    case 'washer':
    case 'separator':
    case 'electric-furnace':
    case 'sawmill':
    case 'merger':
      return fromSide !== n.dir;
    // 새 설비: 실제로는 지정 칸만 받는다 (portTiles). 면으로는 앞만 아니면 후보
    case 'chem-reactor':
    case 'refinery':
    case 'electrolyzer':
    case 'large-assembler':
      return fromSide !== n.dir;
    case 'splitter':
    case 'overflow':
    case 'sorter':
      return fromSide === opposite(n.dir);
    case 'station':
      return n.stationMode === 'load';
    default:
      return false;
  }
}

/** 컨베이어가 아닌 건물이 d 방향(건물에서 이웃 쪽)으로 아이템을 내보내는지 */
function outputsToward(n: Building, d: Dir): boolean {
  if (isSplitterType(n.type)) return d !== opposite(n.dir);
  if (n.type === 'station') return n.stationMode === 'unload' && d === n.dir;
  // 식목기는 받기만 한다
  if (n.type === 'planter') return false;
  if (isCrafter(n) || n.type === 'unloader' || n.type === 'merger') return d === n.dir;
  return false;
}

/** 뒤로 받아 앞·양옆으로 나눠 주는 건물 */
export function isSplitterType(type: BuildingType): boolean {
  return type === 'splitter' || type === 'overflow' || type === 'sorter';
}

/** 아이템이 흘러가는 칸 (컨베이어 종류 + 지하 컨베이어) */
export function isLineType(type: BuildingType): boolean {
  return isBeltType(type) || type === 'underground';
}

/** 광맥 하나: 이어진 같은 광석 칸들 */
interface Patch {
  item: ItemId | null;
  /** 캐는 순서: 바깥 칸부터 안쪽으로 (원래 모양 기준) */
  order: number[];
  /** order 앞쪽의 다 캔 칸은 건너뛰려고 기억하는 위치 */
  cursor: number;
  /** 남은 양 합계 (돌 광맥은 Infinity) */
  remaining: number;
  /** 처음 매장량 */
  initial: number;
  /** 가운데 (칸 좌표) */
  cx: number;
  cy: number;
}

/** 칸 번호로 만든 고정 난수 (같은 깊이 칸끼리 사라지는 순서를 섞는 데 쓴다) */
function tileHash(n: number): number {
  let h = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

/**
 * 새 설비의 지정 입구·출구 칸 (맵 칸 좌표). 데이터는 앞면이 남쪽(dir 2)일 때 기준이라 방향만큼 시계 방향으로 돌린다
 * (한 번 돌리면 (x, y) → (크기 - 1 - y, x))
 */
export function portTiles(b: { x: number; y: number; size: number; dir: Dir; def: { ports?: Ports } }, kind: 'in' | 'out'): [number, number][] {
  const list = b.def.ports?.[kind] ?? [];
  const turns = (b.dir - 2 + 4) % 4;
  return list.map(([px, py]) => {
    let x = px;
    let y = py;
    for (let k = 0; k < turns; k++) [x, y] = [b.size - 1 - y, x];
    return [b.x + x, b.y + y];
  });
}

export type SavedStats = ReturnType<typeof saveStats>;

function saveStats(s: FactoryStats) {
  return {
    made: [...s.made],
    hubIn: [...s.hubIn],
    genWork: s.genWork,
    formalWork: s.formalWork,
    delivered: s.delivered,
    scheduledDelivered: s.scheduledDelivered,
    itemDelivered: [...s.itemDelivered],
    pairs: [...s.pairs].map(([k, p]): [string, number, ItemId[]] => [k, p.n, [...p.items]]),
    zoneMade: [...s.zoneMade],
    zoneWork: [...s.zoneWork],
    zoneUsed: [...s.zoneUsed].map(([z, set]): [number, ItemId[]] => [z, [...set]]),
    largeStarted: s.largeStarted,
    projectOn: s.projectOn,
    projectDelivered: s.projectDelivered,
    treesMatured: s.treesMatured,
    recipeDone: [...s.recipeDone],
    geoWork: s.geoWork,
    linkWork: s.linkWork,
    nightStorage: s.nightStorage,
    weatherWork: [...s.weatherWork],
  };
}

function loadStats(d: Partial<ReturnType<typeof saveStats>>): FactoryStats {
  return {
    made: new Map(d.made ?? []),
    hubIn: new Map(d.hubIn ?? []),
    genWork: d.genWork ?? 0,
    formalWork: d.formalWork ?? 0,
    delivered: d.delivered ?? 0,
    scheduledDelivered: d.scheduledDelivered ?? 0,
    itemDelivered: new Map(d.itemDelivered ?? []),
    pairs: new Map((d.pairs ?? []).map(([k, n, items]) => [k, { n, items: new Set(items) }])),
    zoneMade: new Map(d.zoneMade ?? []),
    zoneWork: new Map(d.zoneWork ?? []),
    zoneUsed: new Map((d.zoneUsed ?? []).map(([z, items]) => [z, new Set(items)])),
    largeStarted: d.largeStarted ?? false,
    projectOn: d.projectOn ?? false,
    projectDelivered: d.projectDelivered ?? 0,
    treesMatured: d.treesMatured ?? 0,
    recipeDone: new Map(d.recipeDone ?? []),
    geoWork: d.geoWork ?? 0,
    linkWork: d.linkWork ?? 0,
    nightStorage: d.nightStorage ?? 0,
    weatherWork: new Map(d.weatherWork ?? []),
  };
}

/** [값, 이어진 개수] 쌍으로 줄인 배열 (지형 저장용) */
function runLength(a: Uint8Array): number[] {
  const out: number[] = [];
  for (let i = 0; i < a.length; ) {
    let j = i;
    while (j < a.length && a[j] === a[i]) j++;
    out.push(a[i], j - i);
    i = j;
  }
  return out;
}

/** 창고군의 구조 표시: 군에 든 창고 id들. 창고를 짓거나 철거해 군이 바뀌면 달라진다 */
export function groupKey(group: Building[]): string {
  return group
    .map((s) => s.id)
    .sort((a, b) => a - b)
    .join(',');
}

/** 창고 묶음이 차지하는 칸 범위 (오른쪽·아래는 끝 칸 다음) */
export function storageBounds(group: Building[]): { x0: number; y0: number; x1: number; y1: number } {
  return {
    x0: Math.min(...group.map((s) => s.x)),
    y0: Math.min(...group.map((s) => s.y)),
    x1: Math.max(...group.map((s) => s.x + s.size)),
    y1: Math.max(...group.map((s) => s.y + s.size)),
  };
}

function sumOf(m: Map<ItemId, number>): number {
  let n = 0;
  for (const c of m.values()) n += c;
  return n;
}

/** 맵에 든 아이템 중 하나 (넣은 순서대로). 비었으면 null */
function firstItem(m: Map<ItemId, number>): ItemId | null {
  for (const [item, n] of m) if (n > 0) return item;
  return null;
}

function isCrafter(b: Building): boolean {
  return isMinerType(b.type) || isRecipeMachine(b.type) || isForestType(b.type) || isExtractorType(b.type);
}

/** 건물 테두리 바깥 칸들과, 건물에서 그 칸으로 향하는 방향 */
function edgeNeighbors(b: Building): [number, number, Dir][] {
  const out: [number, number, Dir][] = [];
  const s = b.size;
  for (let i = 0; i < s; i++) {
    out.push([b.x + i, b.y - 1, 0]);
    out.push([b.x + s, b.y + i, 1]);
    out.push([b.x + i, b.y + s, 2]);
    out.push([b.x - 1, b.y + i, 3]);
  }
  return out;
}
