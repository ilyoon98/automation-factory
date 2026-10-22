import type { ItemId } from '../data/items';

/** 싣는 곳으로 가는 중 → 싣는 중 → 내리는 곳으로 가는 중 → 내리는 중 → 다시 처음 */
export type VehicleState = 'to-load' | 'loading' | 'to-unload' | 'unloading';

export type VehicleStatus =
  | 'moving'
  | 'loading'
  | 'queued'
  | 'waiting'
  | 'unloading'
  | 'unload-full'
  | 'no-route'
  | 'no-station';

export const VEHICLE_STATUS_LABEL: Record<VehicleStatus, string> = {
  moving: '달리는 중',
  loading: '싣는 중',
  queued: '차례 기다리는 중',
  waiting: '짐 기다리는 중',
  unloading: '내리는 중',
  'unload-full': '내릴 곳이 꽉 참',
  'no-route': '길 없음',
  'no-station': '정류장을 골라 주세요',
};

/**
 * 트럭. 건물이 아니라 도로 위를 달리는 차라서 칸을 차지하지 않는다 (트럭끼리 겹쳐 지나간다).
 * 싣는 정류장과 내리는 정류장 두 곳을 오간다. 연료는 아직 없다 (나중에 붙일 자리: updateVehicle).
 */
export class Vehicle {
  /** 칸 좌표. 칸 가운데는 (tx + 0.5, ty + 0.5) */
  x: number;
  y: number;
  /** 지금 있거나 향하고 있는 칸 (칸 번호) */
  tile: number;
  /** 바라보는 방향 (라디안, 그리기용) */
  angle = 0;
  /** 싣는 정류장, 내리는 정류장 (건물 id, 0 = 안 정함) */
  loadId = 0;
  unloadId = 0;
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
  /** 한 바퀴 기록: 지난번 다 내린 시각, 지난 바퀴에 걸린 시간(초)과 실어 나른 개수 */
  tripStart = -1;
  lastTrip = 0;
  lastLoad = 0;

  constructor(
    readonly id: number,
    tile: number,
    width: number,
  ) {
    this.tile = tile;
    this.x = (tile % width) + 0.5;
    this.y = Math.floor(tile / width) + 0.5;
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
