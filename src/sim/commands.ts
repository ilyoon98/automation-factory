import { crossesRoad, isBeltType, type BuildingType } from '../data/buildings';
import { ITEMS, type ItemId } from '../data/items';
import { pasteBlueprint, type Blueprint } from './blueprint';
import type { Building, StationMode } from './building';
import type { Dir } from './dir';
import { ROUTE_MAX, ROUTE_MIN, type RouteStop, type Vehicle } from './vehicle';
import { World, applyOnce, type EditOp, type UseResult } from './world';

/**
 * 플레이어가 월드를 바꾸는 일 전부. 마우스·버튼은 월드를 직접 고치지 않고 명령을 낸다.
 * 같이 하기에서는 이 명령만 주고받고, 모두가 같은 틱에 같은 순서로 적용해서 같은 월드를 유지한다.
 * 그래서 명령은 JSON으로 보낼 수 있어야 하고, 건물은 객체가 아니라 id·좌표로 가리킨다.
 */
export type Command =
  /** 마우스를 누르고 뗄 때까지를 되돌리기 한 단계로 묶는다 */
  | { t: 'begin' }
  | { t: 'end' }
  /** initial = 드래그가 아닌 첫 클릭. setting = 새 건물에 넣을 레시피·아이템·정류장 종류 */
  | { t: 'place'; tool: BuildingType; x: number; y: number; dir: Dir; initial: boolean; setting: string | null }
  /** 드래그로 꺾을 때 이전 칸 컨베이어 방향 맞추기 */
  | { t: 'orient'; x: number; y: number; dir: Dir }
  | { t: 'remove-at'; x: number; y: number }
  | { t: 'remove-area'; x0: number; y0: number; x1: number; y1: number }
  | { t: 'remove'; id: number }
  | { t: 'rotate'; id: number; dir: Dir }
  | { t: 'paste'; bp: Blueprint; x: number; y: number }
  | { t: 'config'; id: number; key: 'recipe' | 'filter' | 'mode'; value: string | null }
  | { t: 'research'; id: string }
  | { t: 'build-truck'; station: number }
  | { t: 'clone-truck'; id: number }
  | { t: 'remove-truck'; id: number }
  /** 트럭 노선 (정류장 ROUTE_MIN ~ ROUTE_MAX곳, 차례대로) */
  | { t: 'route'; id: number; stops: RouteStop[] }
  | { t: 'truck-filter'; id: number; item: ItemId | null }
  /**
   * 현지 실물을 쓰는 명령 (regional-v1). rid = 명령마다 새로 붙이는 고유 번호: 같은 rid는 한 번만 적용한다.
   * 되돌리기(Ctrl+Z) 대상이 아니다. 설치의 반대는 분리, 고급 트럭 조립의 반대는 철거
   */
  /** 기계(id)에 닿은 창고(storage)가 속한 창고군(key = 그때 본 구조)의 모듈 1개를 슬롯으로 */
  | { t: 'module-install'; rid: string; id: number; storage: number; key: string }
  /** normal = 바로 또는 제작 완료 후 분리, cancel-request = 분리 예약 취소, force = 작업 취소 후 즉시 분리 */
  | { t: 'module-detach'; rid: string; id: number; mode: 'normal' | 'cancel-request' | 'force' }
  /** 회수 더미(칸)를 줍기 (가까운 창고·정류장, 없으면 허브) · 버리기 */
  | { t: 'pile-collect'; rid: string; tile: number }
  | { t: 'pile-discard'; rid: string; tile: number }
  /** 컨베이어 줄에서 잘못 들어간 아이템만 빼기 */
  | { t: 'line-take'; rid: string; id: number; item: ItemId }
  /** 정류장 자체 또는 직접 붙은 창고군(key, '' = 정류장만)의 조립품 1개로 고급 트럭. copy = 노선을 베낄 트럭 */
  | { t: 'build-adv-truck'; rid: string; station: number; key: string; copy?: number }
  /** 전력망: 기계·정류장·충전기·축전기가 접속할 노드를 공급 범위 안에서 고른다 */
  | { t: 'power-node'; id: number; node: number }
  /** 계획 운송: 품목별 1회 상한, 정기편 주기(초, 0 = 예전 방식), 조기 출발 */
  | { t: 'truck-plan'; id: number; plan: { item: ItemId; cap: number }[]; period: number; early: boolean }
  /** 계획 운송 노선 일시정지 (새 편을 싣지 않음) */
  | { t: 'truck-pause'; id: number; on: boolean }
  /** 트럭 화물을 지금 칸의 회수 더미에 내려놓기 */
  | { t: 'truck-dump'; id: number }
  /** 정류장 연결 창고 (닿은 창고 id, 0 = 없음) */
  | { t: 'station-dock'; id: number; storage: number }
  /** 정류장 목표 재고 (0 = 지우기) */
  | { t: 'station-target'; id: number; item: ItemId; n: number }
  /** 허브 프로젝트: 허브에 도착한 설비 모듈을 납품으로 소비할지 */
  | { t: 'project'; on: boolean }
  /** 전력 구역의 차량 충전 예산 (kW, 0~800) */
  | { t: 'zone-budget'; zone: number; kw: number }
  | { t: 'undo' }
  | { t: 'redo' };

export interface PlaceResult {
  ok: boolean;
  reason?: string;
  building?: Building;
  /** 컨베이어 위에 컨베이어를 놓아 바꿔 끼우려 했는지 */
  swap?: boolean;
  /** 도로와 컨베이어가 겹쳐서 못 놓았는지 */
  crossRoad?: boolean;
  /** 레시피·아이템 설정이 꼭 필요한데 아직 없음 */
  needsSetting?: boolean;
}

/** 명령마다 돌려주는 결과 (명령을 낸 사람에게 안내를 보여 주려고) */
export interface CommandResults {
  begin: void;
  end: void;
  place: PlaceResult;
  orient: void;
  'remove-at': boolean;
  'remove-area': number;
  remove: boolean;
  rotate: void;
  paste: { placed: number; skipped: number };
  config: boolean;
  research: boolean;
  'build-truck': Vehicle | null;
  'clone-truck': Vehicle | null;
  'remove-truck': boolean;
  route: void;
  'truck-filter': void;
  'module-install': UseResult;
  'module-detach': UseResult;
  'pile-collect': UseResult;
  'pile-discard': UseResult;
  'line-take': UseResult;
  'build-adv-truck': UseResult;
  'power-node': UseResult;
  'zone-budget': boolean;
  project: boolean;
  'truck-plan': boolean;
  'station-dock': boolean;
  'truck-pause': boolean;
  'truck-dump': boolean;
  'station-target': boolean;
  undo: { ops: EditOp[]; skipped: number } | null;
  redo: { ops: EditOp[]; skipped: number } | null;
}

export type ResultOf<C extends Command> = CommandResults[C['t']];

/**
 * 명령을 내는 함수. done은 명령이 실제로 적용될 때 결과와 함께 불린다
 * (혼자 하거나 호스트면 바로, 같이 하기 손님이면 호스트를 한 바퀴 돌아온 뒤).
 */
export type Exec = <C extends Command>(cmd: C, done?: (r: ResultOf<C>) => void) => void;

/** 레시피 대신 아이템 하나를 고르는 건물 */
export const USES_FILTER: BuildingType[] = ['sorter', 'unloader'];

/** player가 낸 명령을 적용한다. 모든 참가자가 같은 틱·같은 순서로 부르면 결과도 같다 */
export function applyCommand<C extends Command>(w: World, player: number, cmd: C): ResultOf<C> {
  const prev = w.actor;
  w.actor = player;
  try {
    return run(w, cmd) as ResultOf<C>;
  } finally {
    w.actor = prev;
  }
}

function run(w: World, c: Command): CommandResults[Command['t']] {
  switch (c.t) {
    case 'begin':
      return w.beginEdit();
    case 'end':
      return w.endEdit();
    case 'place':
      return place(w, c);
    case 'orient': {
      const b = w.buildingAt(c.x, c.y);
      if (b && isBeltType(b.type)) w.rotate(b, c.dir);
      return;
    }
    case 'remove-at': {
      const b = w.buildingAt(c.x, c.y);
      return !!b && b.type !== 'hub' && w.remove(b);
    }
    case 'remove-area': {
      const list = w.buildingsIn(c.x0, c.y0, c.x1, c.y1);
      if (list.length) w.edit(() => list.forEach((b) => w.remove(b)));
      return list.length;
    }
    case 'remove': {
      const b = w.buildings.get(c.id);
      return !!b && w.edit(() => w.remove(b));
    }
    case 'rotate': {
      const b = w.buildings.get(c.id);
      if (b) w.edit(() => w.rotate(b, c.dir));
      return;
    }
    case 'paste':
      return w.edit(() => pasteBlueprint(w, c.bp, c.x, c.y));
    case 'config': {
      const b = w.buildings.get(c.id);
      if (!b) return false;
      return w.edit(() =>
        c.key === 'recipe'
          ? w.setRecipe(b, c.value)
          : c.key === 'mode'
            ? w.setStationMode(b, c.value as StationMode)
            : w.setFilter(b, c.value as ItemId | null),
      );
    }
    case 'research':
      return w.research(c.id);
    case 'build-truck': {
      const st = w.buildings.get(c.station);
      return st ? w.edit(() => w.buildTruck(st)) : null;
    }
    case 'clone-truck': {
      const v = w.vehicles.get(c.id);
      return v ? w.edit(() => w.cloneTruck(v)) : null;
    }
    case 'remove-truck': {
      const v = w.vehicles.get(c.id);
      if (v) w.edit(() => w.removeVehicle(v));
      return !!v;
    }
    case 'route': {
      const v = w.vehicles.get(c.id);
      const stops = routeStops(c.stops);
      // 노선 바꾸기 한 번이 되돌리기 한 단계
      if (v && stops) w.edit(() => w.setStops(v, stops));
      return;
    }
    case 'truck-filter': {
      const v = w.vehicles.get(c.id);
      if (v) w.setTruckFilter(v, c.item);
      return;
    }
    case 'module-install':
      return applyOnce(w, c.rid, () => {
        const b = w.buildings.get(c.id);
        if (!b) return { ok: false, reason: '기계가 없어요' };
        return w.installModule(b, Number(c.storage), String(c.key ?? ''));
      });
    case 'pile-collect':
      return applyOnce(w, c.rid, () => w.collectPile(Number(c.tile)));
    case 'pile-discard':
      return applyOnce(w, c.rid, () => w.discardPile(Number(c.tile)));
    case 'line-take':
      return applyOnce(w, c.rid, () => {
        const b = w.buildings.get(c.id);
        if (!b || !Object.hasOwn(ITEMS, c.item)) return { ok: false, reason: '컨베이어가 없어요' };
        return w.takeFromLine(b, c.item);
      });
    case 'module-detach':
      return applyOnce(w, c.rid, () => {
        const b = w.buildings.get(c.id);
        if (!b) return { ok: false, reason: '기계가 없어요' };
        if (c.mode !== 'normal' && c.mode !== 'cancel-request' && c.mode !== 'force') return { ok: false, reason: '잘못된 명령이에요' };
        return w.detachModule(b, c.mode);
      });
    case 'build-adv-truck':
      return applyOnce(w, c.rid, () => {
        const copy = c.copy ? w.vehicles.get(c.copy) : undefined;
        return w.buildAdvancedTruck(w.buildings.get(c.station), String(c.key ?? ''), copy);
      });
    case 'power-node': {
      const b = w.buildings.get(c.id);
      return b ? w.setPowerNode(b, Number(c.node) || 0) : { ok: false, reason: '건물이 없어요' };
    }
    case 'truck-plan': {
      const v = w.vehicles.get(c.id);
      const plan = Array.isArray(c.plan) ? c.plan.filter((p) => Object.hasOwn(ITEMS, p?.item) && Number.isInteger(p.cap) && p.cap > 0) : null;
      if (!v || !plan || ![0, 60, 120, 180, 240].includes(c.period)) return false;
      return w.setPlan(v, plan, c.period, !!c.early);
    }
    case 'truck-pause': {
      const v = w.vehicles.get(c.id);
      if (!v) return false;
      v.paused = !!c.on;
      return true;
    }
    case 'truck-dump': {
      const v = w.vehicles.get(c.id);
      return !!v && w.dumpCargo(v);
    }
    case 'station-dock': {
      const b = w.buildings.get(c.id);
      return !!b && w.setDock(b, Number(c.storage) || 0);
    }
    case 'station-target': {
      const b = w.buildings.get(c.id);
      return !!b && Object.hasOwn(ITEMS, c.item) && w.setTarget(b, c.item, Number(c.n));
    }
    case 'project':
      if (!w.regional || !w.researched.has('integrated-automation')) return false;
      w.stats.projectOn = !!c.on;
      return true;
    case 'zone-budget':
      return w.setZoneBudget(Number(c.zone), Number(c.kw));
    case 'undo':
      return w.undo();
    case 'redo':
      return w.redo();
  }
}

/** 받은 노선을 믿을 수 있는 모양으로 (같이 하기에서 온 명령이라). 모양이 틀리면 null */
function routeStops(raw: unknown): RouteStop[] | null {
  if (!Array.isArray(raw) || raw.length < ROUTE_MIN || raw.length > ROUTE_MAX) return null;
  const stops: RouteStop[] = [];
  for (const s of raw as Partial<RouteStop>[]) {
    if (!Number.isInteger(s?.id) || (s.act !== 'load' && s.act !== 'unload')) return null;
    if (s.item != null && !Object.hasOwn(ITEMS, s.item)) return null;
    stops.push({ id: s.id!, act: s.act, ...(s.act === 'load' && s.item ? { item: s.item } : {}) });
  }
  return stops;
}

/** 들고 있는 도구로 (x, y)에 짓기. 컨베이어 위 덮어쓰기·방향 자동 맞춤·설정 넣기까지 */
function place(w: World, c: Extract<Command, { t: 'place' }>): PlaceResult {
  const { tool, x, y, dir, initial } = c;
  if (!w.unlockedBuildings.has(tool)) return { ok: false, reason: '연구로 해금해야 해요' };
  // 지하 컨베이어는 입구·출구를 하나씩 정확히 놓아야 해서 드래그로 깔지 않는다
  if (tool === 'underground' && !initial) return { ok: false };
  const existing = w.buildingAt(x, y);
  // 컨베이어 위에 컨베이어: 같은 종류면 방향만, 다른 종류면 교체 (예: 일반 → 고속)
  if (isBeltType(tool) && existing && isBeltType(existing.type)) {
    const nb = w.replaceBelt(existing, tool, dir);
    return nb ? { ok: true, building: nb, swap: true } : { ok: false, reason: '재료 부족', swap: true };
  }
  const [ox, oy] = World.originFor(tool, x, y);
  // 기계를 컨베이어 위에 놓으면 그 칸을 바꿔 끼우지만, 도로는 컨베이어를 지우지 않는다
  const replace = initial && tool !== 'road';
  const check = w.canPlace(tool, ox, oy, replace);
  if (!check.ok) return { ok: false, reason: check.reason, crossRoad: !!existing && crossesRoad(tool, existing.type) };
  // 컨베이어 위에 놓으면 흐름 방향을 따라 출구를 맞춰 라인에 끼워 넣는다
  const flow = replace ? w.flowDirUnder(tool, ox, oy, x, y) : null;
  // 하역기는 허브·창고 쪽으로 뒤가 향하게, 허브·창고에 붙인 정류장은 그쪽을 앞으로 저절로 돌린다
  const unload = tool === 'unloader' ? w.unloaderDir(ox, oy, flow ?? dir) : null;
  const facing = tool === 'station' ? w.stationFacing(ox, oy) : null;
  const b = w.place(tool, ox, oy, unload ?? facing ?? flow ?? dir, false, replace);
  if (!b) return { ok: false };
  const setting = facing !== null ? 'unload' : c.setting;
  const applied =
    !!setting &&
    (b.type === 'station'
      ? w.setStationMode(b, setting as StationMode)
      : USES_FILTER.includes(b.type)
        ? w.setFilter(b, setting as ItemId)
        : w.setRecipe(b, setting));
  // 하역기는 안 골라도 전부 꺼내므로 꼭 골라야 하는 건 조립기·분류기뿐
  return { ok: true, building: b, needsSetting: !applied && (b.type === 'assembler' || b.type === 'sorter') };
}
