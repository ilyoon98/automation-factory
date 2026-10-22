import { crossesRoad, isBeltType, type BuildingType } from '../data/buildings';
import type { ItemId } from '../data/items';
import { pasteBlueprint, type Blueprint } from './blueprint';
import type { Building, StationMode } from './building';
import type { Dir } from './dir';
import type { Vehicle } from './vehicle';
import { World, type EditOp } from './world';

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
  | { t: 'route'; id: number; loadId: number; unloadId: number }
  | { t: 'truck-filter'; id: number; item: ItemId | null }
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
      if (v) w.setRoute(v, c.loadId, c.unloadId);
      return;
    }
    case 'truck-filter': {
      const v = w.vehicles.get(c.id);
      if (v) w.setTruckFilter(v, c.item);
      return;
    }
    case 'undo':
      return w.undo();
    case 'redo':
      return w.redo();
  }
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
