import { TRUCK } from '../data/buildings';
import type { ItemId } from '../data/items';

/**
 * 지금 정류장(노선의 stop번째)으로 가는 중이거나 거기서 일하는 중. 그 정류장에서 싣는지 내리는지에 따라
 * 싣는 곳으로 가는 중 → 싣는 중, 내리는 곳으로 가는 중 → 내리는 중
 */
export type VehicleState = 'to-load' | 'loading' | 'to-unload' | 'unloading';

/** 노선의 정류장 하나: 어느 정류장(건물 id, 0 = 안 정함)에서 싣는지 내리는지, 싣는 곳이면 실을 아이템 (없으면 아무거나) */
export interface RouteStop {
  id: number;
  act: 'load' | 'unload';
  item?: ItemId | null;
}

/** 노선에 넣을 수 있는 정류장 수 */
export const ROUTE_MIN = 2;
export const ROUTE_MAX = 8;

export type VehicleStatus =
  | 'moving'
  | 'loading'
  | 'queued'
  | 'waiting'
  | 'unloading'
  | 'unload-full'
  | 'charging'
  | 'no-battery'
  | 'no-route'
  | 'no-station';

export const VEHICLE_STATUS_LABEL: Record<VehicleStatus, string> = {
  moving: '달리는 중',
  loading: '싣는 중',
  queued: '차례 기다리는 중',
  waiting: '짐 기다리는 중',
  unloading: '내리는 중',
  'unload-full': '내릴 곳이 꽉 참',
  charging: '충전 중',
  'no-battery': '배터리 없음 (천천히)',
  'no-route': '길 없음',
  'no-station': '정류장을 골라 주세요',
};

/**
 * 트럭. 건물이 아니라 도로 위를 달리는 차라서 칸을 차지하지 않는다 (트럭끼리 겹쳐 지나간다).
 * 노선(정류장 2~8곳)을 차례대로 돌고, 마지막 정류장 다음에는 처음으로 돌아간다.
 * 전기 트럭: 달리면 배터리가 줄고, 정류장에 서 있는 동안 공장 전력으로 충전한다.
 */
export class Vehicle {
  /** 칸 좌표. 칸 가운데는 (tx + 0.5, ty + 0.5) */
  x: number;
  y: number;
  /** 지금 있거나 향하고 있는 칸 (칸 번호) */
  tile: number;
  /** 바라보는 방향 (라디안, 그리기용) */
  angle = 0;
  /** 노선: 차례대로 들르는 정류장들 */
  stops: RouteStop[] = [
    { id: 0, act: 'load' },
    { id: 0, act: 'unload' },
  ];
  /** 지금 가거나 서 있는 정류장 (stops 번호) */
  stop = 0;
  cargo = new Map<ItemId, number>();
  state: VehicleState = 'to-load';
  status: VehicleStatus = 'waiting';
  /** tile 다음에 지나갈 칸들. null = 길을 못 찾음 */
  path: number[] | null = [];
  /** path를 찾은 목적지(정류장 id)와 그때의 도로 상태. 바뀌면 다시 찾는다 (저장하지 않음) */
  pathTo = 0;
  pathVer = -1;
  /** 싣고 내리는 간격을 재는 시계 */
  timer = 0;
  /** 새 짐 없이 기다린 시간 */
  idle = 0;
  /** 지금 정류장에 도착한 시각. 같은 싣기 정류장에서는 먼저 온 트럭부터 채운다 (저장하지 않음) */
  arrivedAt = 0;
  /** 한 바퀴 기록: 지난번 노선 끝 정류장을 떠난 시각, 지난 바퀴에 걸린 시간(초)과 내린 개수, 이번 바퀴에 내린 개수 */
  tripStart = -1;
  lastTrip = 0;
  lastLoad = 0;
  lapUnloaded = 0;
  /** 배터리 (kJ, 0 ~ World.truckBattery()) */
  battery = TRUCK.battery;
  /** 길 중간 충전기 앞에 서서 충전하는 중 (가득 차면 다시 간다) */
  charger = false;

  constructor(
    readonly id: number,
    tile: number,
    width: number,
  ) {
    this.tile = tile;
    this.x = (tile % width) + 0.5;
    this.y = Math.floor(tile / width) + 0.5;
  }

  /** 노선에서 처음 싣는 정류장 / 처음 내리는 정류장 (없으면 0). 두 곳만 오가던 예전 트럭과 같은 뜻 */
  get loadId(): number {
    return this.stops.find((s) => s.act === 'load')?.id ?? 0;
  }

  get unloadId(): number {
    return this.stops.find((s) => s.act === 'unload')?.id ?? 0;
  }

  /**
   * 트럭 전체의 싣는 아이템 (예전처럼 트럭마다 하나): 읽으면 첫 싣는 곳의 것, 쓰면 모든 싣는 곳에.
   * 싣는 곳마다 다르게 하려면 stops[i].item
   */
  get filter(): ItemId | null {
    return this.stops.find((s) => s.act === 'load')?.item ?? null;
  }

  set filter(item: ItemId | null) {
    for (const s of this.stops) {
      if (s.act !== 'load') continue;
      if (item) s.item = item;
      else delete s.item;
    }
  }

  /** 지금 정류장에서 실을 아이템 (null = 아무거나) */
  get stopItem(): ItemId | null {
    return this.stops[this.stop]?.item ?? null;
  }

  /** 지금 가거나 서 있는 정류장 (건물 id) */
  get stopId(): number {
    return this.stops[this.stop]?.id ?? 0;
  }

  get load(): number {
    let n = 0;
    for (const c of this.cargo.values()) n += c;
    return n;
  }

  /** 지난 한 바퀴 기준 분당 운송량 (아직 한 바퀴를 못 돌았으면 null) */
  get perMinute(): number | null {
    return this.lastTrip > 0 ? (this.lastLoad / this.lastTrip) * 60 : null;
  }
}
