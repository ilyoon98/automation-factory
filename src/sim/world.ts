import {
  BUILDINGS,
  CHARCOAL_ENERGY,
  COAL_ENERGY,
  FOREST,
  GENERATOR_POWER,
  HUB_BASE_POWER,
  HYDRO_POWER,
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
  type BuildingType,
} from '../data/buildings';
import { GROUNDS, type GroundDef } from '../data/ground';
import { ITEM_IDS, type ItemId, type ItemStack } from '../data/items';
import { RECIPES, type MachineKind, type Recipe } from '../data/recipes';
import { ENDLESS_BY_ID, ENDLESS_REQUIRES, INITIAL_BUILDINGS, INITIAL_RECIPES, TECH_BY_ID, endlessCost } from '../data/tech';
import { Building, addTo, countOf, type BeltItem, type StationMode } from './building';
import { DX, DY, opposite, rotateCW, type Dir } from './dir';
import { darkness, weatherMix } from './sky';
import { ROUTE_MIN, Vehicle, type RouteStop, type VehicleState } from './vehicle';

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
  /** 칸마다 땅 종류 (GROUNDS 번호: 0 초원 · 1 사막 · 2 눈밭). 맵을 만들 때 정하고 바뀌지 않는다 */
  readonly ground: Uint8Array;
  /** 불러온 저장에 땅 종류가 있었는지 (땅 종류가 생기기 전 저장이면 false → 씨앗으로 만든다) */
  groundLoaded = true;
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
  /** 이룬 업적: 업적 id → 단계 (1 = 동 … 4 = 다이아). 목표처럼 화면 쪽에서 채우고 저장에 남긴다 */
  achieved = new Map<string, number>();
  /** 지금까지 기계가 만든(캔·벤) 아이템 총량 (업적용) */
  madeTotal = new Map<ItemId, number>();
  /** 식목기가 심은 나무 총수 (업적용) */
  planted = 0;
  /** 1초마다 남긴 madeTotal, 최근 1분 (분당 생산 업적용. 저장하지 않음) */
  private madeLog: { sec: number; made: Map<ItemId, number> }[] = [];
  /** 빈 땅에서 흙을 캘 수 있는지 ("흙 정제" 연구) */
  dirtMining = false;
  power: PowerState = { demand: 0, capacity: HUB_BASE_POWER, supply: 0, satisfaction: 1, charge: 0 };
  time = 0;
  /** 지금까지 돈 틱 수 (저장하지 않는다. 같이 하기 스냅샷에만 넣는다) */
  private tickNo = 0;
  seed = 0;

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
    this.ground = new Uint8Array(n);
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
        if (p && this.patches.has(p)) ids.add(p);
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
    if (b.type === 'hub') this.hub = b;
    if (b.type === 'road' || b.type === 'station' || b.type === 'charger') this.roadVersion++;
    if (b.type === 'storage') this.storagesDirty = true;
    this.buildings.set(b.id, b);
    this.nextId = Math.max(this.nextId, b.id + 1);
    this.layoutDirty = true;
  }

  /** 철거. 건설 비용과 안에 든 아이템을 100% 허브로 돌려준다. */
  remove(b: Building): boolean {
    if (b.type === 'hub') return false;
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
    });
    for (const c of b.def.cost) addTo(this.stock, c.item, c.count);
    this.refundContents(b);
    const partner = this.partnerOf(b);
    if (partner) {
      partner.partner = 0;
      // 출구가 사라지면 땅속에 있던 아이템은 갈 곳이 없으니 허브로 돌려준다
      if (b.ugMode === 'out') this.refundContents(partner);
    }
    for (let dy = 0; dy < b.size; dy++) {
      for (let dx = 0; dx < b.size; dx++) this.occ[this.idx(b.x + dx, b.y + dy)] = 0;
    }
    if (b.type === 'road' || b.type === 'station' || b.type === 'charger') this.roadVersion++;
    if (b.type === 'storage') this.storagesDirty = true;
    this.buildings.delete(b.id);
    this.layoutDirty = true;
    return true;
  }

  /** 지금 하는 작업 1회에 걸리는 시간 (초) */
  craftTime(b: Building): number {
    if (isMinerType(b.type)) return 1 / ((b.def.speed ?? 1) * this.boost('endless-mining'));
    if (b.type === 'lumberjack') return FOREST.cut / this.boost('endless-mining');
    if (b.type === 'planter') return FOREST.plant;
    return (this.recipeOf(b)?.time ?? 1) / this.boost('endless-crafting');
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
    s.eff += ((b.crafting ? this.power.satisfaction : 0) - s.eff) * k;
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

  /** 정류장 싣기/내리기. 안에 쌓인 건 허브로 돌려준다 */
  setStationMode(b: Building, mode: StationMode): boolean {
    if (b.type !== 'station') return false;
    if (b.stationMode === mode) return true;
    this.record({ kind: 'mode', x: b.x, y: b.y, from: b.stationMode, to: mode });
    this.refundContents(b);
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
    this.refundContents(b);
    b.recipe = recipeId;
    b.status = 'idle';
    return true;
  }

  private refundContents(b: Building): void {
    for (const it of b.items) addTo(this.stock, it.item, it.n);
    b.items = [];
    for (const [item, n] of b.inBuf) addTo(this.stock, item, n);
    for (const [item, n] of b.outBuf) addTo(this.stock, item, n);
    b.inBuf.clear();
    b.outBuf.clear();
    const r = this.recipeOf(b);
    if (b.crafting && r) for (const i of r.inputs) addTo(this.stock, i.item, i.count);
    b.crafting = false;
    b.progress = 0;
    // 발전기에 쌓인 연료 (수력 발전기는 물)
    if (b.fuel) addTo(this.stock, b.type === 'hydro' ? 'water' : 'coal', b.fuel);
    b.fuel = 0;
    if (b.held) addTo(this.stock, b.held, b.heldN);
    b.held = null;
    b.heldN = 0;
  }

  // ───────────────────────── 숲 ─────────────────────────

  /** 나무를 심을 수 있는 칸: 광맥·물·건물·나무가 없는 땅 (다 캔 광맥 자리 포함) */
  canPlant(i: number): boolean {
    return !this.resItem[i] && !this.occ[i] && this.tree[i] === 0 && GROUNDS[this.ground[i]].plant;
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
      const g = Math.min(1, this.tree[i] + step * GROUNDS[this.ground[i]].treeGrow);
      this.tree[i] = g;
      if (g >= 1) this.treesGrown++;
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
        if ((type === 'pump') === (item === 'water')) tiles.push(i);
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
    const t = TECH_BY_ID[id];
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
    for (const c of TECH_BY_ID[id].cost) addTo(this.stock, c.item, -c.count);
    this.applyTech(id);
    return true;
  }

  /** 끝없는 연구의 지금 단계 */
  endlessLevel(id: string): number {
    return this.levels.get(id) ?? 0;
  }

  /** 연구 효과만 적용 (비용 없음). 불러오기에서도 쓴다. */
  applyTech(id: string): void {
    const t = TECH_BY_ID[id];
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
    if (sec !== this.madeLog[this.madeLog.length - 1]?.sec) {
      this.madeLog.push({ sec, made: new Map(this.madeTotal) });
      if (this.madeLog.length > 61) this.madeLog.shift();
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
    b.crafting = true;
  }

  /**
   * 최근 1분 동안 기계가 실제로 만든 개수. 기록이 1분이 안 됐으면 (막 켰거나 불러왔으면) 0.
   * 기계 평균(factoryFlows)과 달리 정말 나온 개수라 업적에 쓴다.
   */
  madePerMinute(item: ItemId): number {
    const old = this.madeLog[0];
    const cur = this.madeLog[this.madeLog.length - 1];
    if (!old || cur.sec - old.sec < 60) return 0;
    return (this.madeTotal.get(item) ?? 0) - (old.made.get(item) ?? 0);
  }

  /** 기계가 만든 것을 출력 칸에 넣고 총량에 센다 */
  private make(b: Building, item: ItemId, n: number): void {
    addTo(b.outBuf, item, n);
    addTo(this.madeTotal, item, n);
  }

  private updatePower(): void {
    let demand = 0;
    let solar = 0;
    const gens: Building[] = [];
    const hydros: Building[] = [];
    const sun = this.solarOutput();
    const wind = this.windOutput();
    for (const b of this.buildings.values()) {
      if (b.crafting && b.def.power > 0) demand += b.def.power;
      if (b.type === 'solar' || b.type === 'wind') {
        const g = this.groundOf(b);
        b.load = b.type === 'solar' ? sun * g.solar : wind * g.wind;
        solar += b.load;
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
    this.burn(hydros, hydroLoad, WATER_ENERGY);
    this.burn(gens, genLoad, COAL_ENERGY);
    this.power = { demand, capacity, supply, satisfaction, charge };
  }

  /** 건물이 선 땅 (가운데 칸) */
  groundOf(b: { x: number; y: number; size: number }): GroundDef {
    const h = Math.floor(b.size / 2);
    // 맵 밖(가장자리에 걸친 미리보기)은 초원으로
    return this.inBounds(b.x + h, b.y + h) ? GROUNDS[this.ground[this.idx(b.x + h, b.y + h)]] : GROUNDS[0];
  }

  /** 지금 태양광 패널 한 대의 출력 (kW): 해가 있는 만큼 × 날씨 (초원 기준, 땅 배율은 따로) */
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
        } else break;
      }
      if (g.energy < 0) g.energy = 0;
      g.status = load > 0 ? 'working' : 'idle';
    }
  }

  private updateCrafting(b: Building): void {
    if (!b.crafting) return;
    const sat = this.power.satisfaction;
    const time = this.craftTime(b);
    const speed = sat;
    b.progress += DT * speed;
    b.status = sat < 1 ? 'low-power' : 'working';
    if (b.progress < time) return;

    this.finishCraft(b);
    b.crafting = false;
    b.progress -= time;
    // 남은 진행도를 이어받아 바로 다음 제작을 시작해야 정확한 생산 속도가 나온다.
    this.tryStart(b);
    if (!b.crafting) b.progress = 0;
  }

  private finishCraft(b: Building): void {
    if (b.type === 'lumberjack') {
      // 범위에서 처음 찾은 다 자란 나무를 벤다 (그사이 누가 베었으면 다음 나무)
      const i = b.mineTiles.find((t) => this.tree[t] >= 1);
      if (i === undefined) return;
      this.clearTree(i);
      this.make(b, 'log', FOREST.logs);
      this.make(b, 'sapling', 1);
      return;
    }
    if (b.type === 'planter') {
      const i = b.mineTiles.find((t) => this.canPlant(t));
      if (i === undefined || countOf(b.inBuf, 'sapling') <= 0) return;
      addTo(b.inBuf, 'sapling', -1);
      this.planted++;
      // 아주 조금 자란 상태로 심는다 (0은 "나무 없음")
      this.setTree(i % this.width, Math.floor(i / this.width), 0.001);
      return;
    }
    if (b.mineDirt) {
      this.make(b, 'dirt', 1);
      return;
    }
    if (isMinerType(b.type) && b.type !== 'pump') {
      // 광맥 전체에서 번갈아 캔다 (여러 광맥에 걸쳐 놓였으면 차례로)
      const n = b.minePatches.length;
      for (let k = 0; k < n; k++) {
        const p = this.patches.get(b.minePatches[(b.mineIdx + k) % n]);
        const item = p ? this.takeFromPatch(p) : null;
        if (!item) continue;
        this.make(b, item, 1);
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
        this.make(b, item, 1);
        b.mineIdx = (b.mineIdx + k + 1) % n;
        return;
      }
      return;
    }
    const r = this.recipeOf(b);
    if (!r) return;
    if (r.pattern) {
      // 분리기: 정해진 순서대로 하나씩
      this.make(b, r.pattern[b.cycle % r.pattern.length], 1);
      b.cycle = (b.cycle + 1) % r.pattern.length;
      return;
    }
    for (const o of r.outputs) this.make(b, o.item, o.count);
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
    const src = this.buildingAt(b.x - DX[b.dir], b.y - DY[b.dir]);
    const count = (item: ItemId) =>
      src?.type === 'hub' ? this.stockOf(item) : src?.type === 'storage' ? this.storageCount(src, item) : 0;
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
      if (src!.type === 'hub') addTo(this.stock, item, -sent);
      else this.storageTake(src!, item, sent);
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
    if (!acceptsFrom(n, fromSide)) return false;
    switch (n.type) {
      case 'storage': {
        // 합쳐진 창고는 묶음 전체가 한 창고 (받은 칸에 쌓는다)
        if (this.storageTotal(n) >= this.storageCapacity(n)) return false;
        addTo(n.inBuf, item, 1);
        return true;
      }
      case 'hub':
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
    if (!r && n.type !== 'assembler') {
      r = this.autoRecipe(n.type as MachineKind, item);
      if (r) n.recipe = r.id;
    }
    // 처음 재료가 여러 레시피에 쓰여서 잘못 골랐을 수 있다 (철판 먼저 → 석탄 강철, 그다음 숯).
    // 쉬는 중이고, 들고 있는 재료와 새 재료를 다 쓰는 다른 레시피가 있으면 그것으로 바꾼다
    // (빈 기계는 바꾸지 않는다: 처음 들어온 재료로 정한 레시피가 섞인 컨베이어에서 오락가락하지 않게)
    const held = [...n.inBuf].filter(([, k]) => k > 0).map(([it]) => it);
    if (r && n.type !== 'assembler' && !n.crafting && held.length && !r.inputs.some((i) => i.item === item)) {
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

  /** 컨베이어 끝에서 앞 칸으로 최대 count개 넘긴다. 넘긴 개수 */
  private pushFromBelt(b: Building, item: ItemId, count: number): number {
    const f = this.frontTile(b);
    const n = f ? this.buildingAt(f[0], f[1]) : null;
    if (!n) return 0;
    if (isLineType(n.type)) return this.beltAccept(n, item, opposite(b.dir), count);
    return this.acceptStack(n, item, count, b, opposite(b.dir));
  }

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
  private storageTake(b: Building, item: ItemId, n: number): void {
    for (const s of this.storageGroup(b)) {
      const k = Math.min(n, countOf(s.inBuf, item));
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

  /** 트럭 철거: 만든 재료와 실은 짐을 허브로 돌려준다 */
  removeVehicle(v: Vehicle): void {
    this.record({ kind: 'truck-remove', id: v.id, tile: v.tile, stops: v.stops.map((s) => ({ ...s })) });
    for (const c of TRUCK.cost) addTo(this.stock, c.item, c.count);
    for (const [item, n] of v.cargo) addTo(this.stock, item, n);
    this.vehicles.delete(v.id);
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
    if (!this.routeOk(v) || this.batteryFull(v)) return 0;
    const need = (this.truckBattery() - v.battery) / DT;
    // 길 중간 충전기 앞에 선 트럭은 더 빨리
    if (v.charger) return Math.min(TRUCK.fastCharge, need);
    if (v.state !== 'loading' && v.state !== 'unloading') return 0;
    return Math.min(this.stationCharge(), need);
  }

  /** 트럭 배터리 크기 (kJ). 연구 "고용량 배터리"와 끝없는 연구 "트럭 성능"으로 커진다 */
  truckBattery(): number {
    return TRUCK.battery * this.batteryTech() * this.boost('endless-truck');
  }

  /** 정류장에 서 있을 때 충전 속도 (kW) */
  stationCharge(): number {
    return TRUCK.charge * this.batteryTech();
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

  /** 트럭 속도 (칸/초). 끝없는 연구 "트럭 성능"으로 빨라진다 */
  truckSpeed(): number {
    return TRUCK.speed * this.boost('endless-truck');
  }

  /** 배터리가 다 찼는지 (더하고 나눌 때 생기는 아주 작은 오차는 봐준다) */
  private batteryFull(v: Vehicle): boolean {
    return v.battery >= this.truckBattery() - 1e-6;
  }

  private updateVehicle(v: Vehicle): void {
    if (!this.routeOk(v)) {
      v.status = 'no-station';
      return;
    }
    const st = this.buildings.get(v.stopId)!;
    // 정류장에 서 있으면 충전 (전력이 모자라면 그 비율만큼만)
    const want = this.chargeWant(v);
    if (want > 0) {
      v.battery = Math.min(this.truckBattery(), v.battery + want * this.power.satisfaction * DT);
      if (this.batteryFull(v)) v.battery = this.truckBattery();
    }
    if (v.state === 'to-load' || v.state === 'to-unload') {
      if (!this.drive(v, st)) return;
      v.state = v.state === 'to-load' ? 'loading' : 'unloading';
      v.timer = 0;
      v.idle = 0;
      v.arrivedAt = this.time;
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
    const full = this.truckSpeed() * DT * (empty ? TRUCK.emptySpeed : 1);
    const [arrived, left] = this.move(v, st, full);
    // 한 칸에 drive / speed kJ (기본 속도 기준: 빨라져도 칸당 드는 전기는 같다)
    v.battery = Math.max(0, v.battery - ((full - left) * TRUCK.drive) / TRUCK.speed);
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
        return [false, step];
      }
      if (v.path.length === 0) return [true, step];
      // 충전기 옆 칸: 남은 길을 갈 배터리가 모자라면 서서 가득 채운다 (넉넉하면 그냥 지나간다)
      if (v.battery < v.path.length * (TRUCK.drive / TRUCK.speed) && !this.batteryFull(v) && this.chargerTiles().has(v.tile)) {
        v.charger = true;
        v.status = 'charging';
        return [false, step];
      }
      if (step <= 0) {
        v.status = 'moving';
        return [false, 0];
      }
      v.tile = v.path.shift()!;
    }
  }

  /** 정류장 st에서 실을 수 있는 아이템 (item을 골랐으면 그것만, null이면 아무거나). 없으면 null */
  private loadableItem(st: Building, item: ItemId | null): ItemId | null {
    if (item) return (st.inBuf.get(item) ?? 0) > 0 ? item : null;
    return firstItem(st.inBuf);
  }

  private canLoadNow(v: Vehicle, st: Building): boolean {
    return v.load < TRUCK.capacity && this.loadableItem(st, v.stopItem) !== null;
  }

  /**
   * 가득 차면 출발. 덜 찼어도 잠깐(TRUCK.wait) 새 짐이 없으면 있는 만큼 싣고 출발.
   * 빈 채로는 기다리지만, 노선의 다른 싣는 곳에 이 트럭이 실을 짐이 있으면 빈 채로 그리로 간다 (빈 바퀴는 돌지 않는다)
   */
  private loadTruck(v: Vehicle, st: Building): void {
    if (v.load >= TRUCK.capacity) return this.leave(v);
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
    v.lapUnloaded++;
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
    for (const [nx, ny, out] of edgeNeighbors(b)) {
      // 기계는 앞면(화살표)으로만, 분배기는 입구(뒤)를 뺀 세 면으로 내보낸다.
      if (isSplitter ? out === opposite(b.dir) : out !== b.dir) continue;
      const n = this.buildingAt(nx, ny);
      if (!n || n === b) continue;
      const fromSide = opposite(out);
      if (isLineType(n.type)) {
        // 이 건물 쪽을 향한 컨베이어(입력)나 지하 출구는 받을 수 없다.
        if (entryPos(n, fromSide) >= 0) res.push({ b: n, fromSide, out });
        continue;
      }
      if (seen.has(n.id) || !acceptsFrom(n, fromSide)) continue;
      seen.add(n.id);
      res.push({ b: n, fromSide, out });
    }
    return res;
  }

  private rebuildLayout(): void {
    this.layoutDirty = false;
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
      ground: groundRuns(this.ground),
      guide: [...this.guideDone],
      ...(this.achieved.size ? { achievements: [...this.achieved] } : {}),
      ...(this.madeTotal.size ? { made: [...this.madeTotal] } : {}),
      ...(this.planted ? { planted: this.planted } : {}),
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
        ...(b.type === 'station' ? { no: b.stationNo, ...(b.stationMode === 'unload' ? { mode: 'unload' as const } : {}) } : {}),
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
      })),
    };
  }

  static deserialize(data: SaveData): World {
    if (data.v !== 1 && data.v !== 2 && data.v !== 3) throw new Error('지원하지 않는 저장 버전');
    const w = new World(data.width, data.height);
    w.seed = data.seed;
    w.time = data.time;
    for (const [i, itemIdx, a] of data.res) {
      w.resItem[i] = ITEM_IDS[itemIdx];
      w.resAmount[i] = a < 0 ? Infinity : a;
    }
    // 나무 (숲이 생기기 전 저장에는 없다 → 불러오는 쪽에서 자연 숲을 더한다)
    if (data.trees) for (const [i, g] of data.trees) w.setTree(i % w.width, Math.floor(i / w.width), g);
    else w.forestsLoaded = false;
    // 땅 종류 (생기기 전 저장에는 없다 → 불러오는 쪽에서 씨앗으로 만든다)
    if (data.ground) {
      let i = 0;
      for (let k = 0; k < data.ground.length; k += 2) {
        w.ground.fill(data.ground[k], i, i + data.ground[k + 1]);
        i += data.ground[k + 1];
      }
    } else w.groundLoaded = false;
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
    w.achieved = new Map(data.achievements ?? []);
    w.madeTotal = new Map(data.made ?? []);
    w.planted = data.planted ?? 0;
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
      b.stationNo = s.no ?? 0;
      b.stationMode = s.mode ?? 'load';
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
      w.vehicles.set(v.id, v);
      w.nextVehicleId = Math.max(w.nextVehicleId, v.id + 1);
    }
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
    for (const [item, n] of this.stock) h.str(item).num(n);
    h.num(this.researched.size);
    for (const [id, n] of this.levels) h.str(id).num(n);
    for (let i = 0; i < this.resAmount.length; i++) if (this.resItem[i]) h.num(i).num(this.resAmount[i]);
    for (let i = 0; i < this.tree.length; i++) if (this.tree[i] > 0) h.num(i).num(this.tree[i]);
    for (const [item, n] of this.madeTotal) h.str(item).num(n);
    h.num(this.planted);
    for (const b of this.buildings.values()) {
      h.num(b.id).str(b.type).num(b.x).num(b.y).num(b.dir).str(b.recipe ?? '').str(b.filter ?? '');
      h.num(b.progress).num(b.crafting ? 1 : 0).num(b.outRR).num(b.mineIdx).num(b.fuel).num(b.energy);
      h.num(b.cycle).num(b.partner).num(b.heldFrom).str(b.held ?? '').num(b.heldN).str(b.stationMode);
      for (const [item, n] of b.inBuf) h.str(item).num(n);
      for (const [item, n] of b.outBuf) h.str(item).num(n);
      for (const it of b.items) h.str(it.item).num(it.pos).num(it.n);
    }
    for (const v of this.vehicles.values()) {
      h.num(v.id).num(v.x).num(v.y).num(v.tile).str(v.state).num(v.timer).num(v.idle).num(v.battery).num(v.charger ? 1 : 0);
      h.num(v.stop);
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
  /** 땅 종류를 칸 번호 차례로 [종류, 이어지는 칸 수, 종류, 칸 수, …] (없으면 땅 종류가 생기기 전 저장) */
  ground?: number[];
  /** 이룬 목표 제목들 */
  guide?: string[];
  /** 이룬 업적 [업적 id, 단계] */
  achievements?: [string, number][];
  /** 기계가 만든 아이템 총량 (업적용) */
  made?: [ItemId, number][];
  /** 식목기가 심은 나무 총수 (업적용) */
  planted?: number;
  buildings: SavedBuilding[];
  nextStationNo?: number;
  vehicles?: SavedVehicle[];
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
  return isMinerType(b.type) || isRecipeMachine(b.type) || isForestType(b.type);
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

/** 땅 종류를 저장용으로 줄인다: 같은 종류가 이어지는 칸을 [종류, 칸 수]로 */
function groundRuns(ground: Uint8Array): number[] {
  const out: number[] = [];
  for (let i = 0; i < ground.length; ) {
    let j = i + 1;
    while (j < ground.length && ground[j] === ground[i]) j++;
    out.push(ground[i], j - i);
    i = j;
  }
  return out;
}
