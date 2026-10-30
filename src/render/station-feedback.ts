import { BUILDINGS } from '../data/buildings';
import type { ItemId } from '../data/items';
import type { Activity } from '../sim/activity';
import type { Building } from '../sim/building';
import type { World } from '../sim/world';

/** 새 정류장을 지었을 때와 같은 접도 판정. 도로 칸은 새 주차 구역을 점유하지 않는다. */
export function stationRoadPreview(w: World, x: number, y: number, replaceBelts = false) {
  const size = BUILDINGS.station.size;
  const check = w.canPlace('station', x, y, replaceBelts);
  const bodyVisible = Array.from({ length: size * size }, (_, i) => [x + i % size, y + Math.floor(i / size)])
    .every(([bx, by]) => w.inBounds(bx, by) && w.isRevealed(w.idx(bx, by)));
  const roads = bodyVisible ? w.stationStops({ x, y, size }).filter((tile) => w.isRevealed(tile)) : [];
  return {
    roads: roads.map((tile) => ({ tile, x: tile % w.width, y: Math.floor(tile / w.width) })),
    valid: check.ok,
    state: !check.ok ? 'blocked' as const : roads.length ? 'connected' as const : 'no-road' as const,
  };
}

export const TRANSFER_DURATION = 0.55;
export const TRANSFER_LIMIT = 4;

export interface StationTransfer {
  station: number;
  item: ItemId;
  entering: boolean;
  kind: 'truck' | 'port';
  born: number;
  gameAt: number;
  vehicle?: number;
  from?: number;
  to?: number;
}

/** 실제 이동 사건만 장식으로 바꾼다. 실패/예약/대기 상태는 호출 대상이 아니다. */
export function stationTransfer(w: World, e: Activity, now: number): StationTransfer | null {
  if (e.kind === 'cargo') {
    const st = w.buildings.get(e.station);
    if (st?.type !== 'station' || !w.vehicles.has(e.id) || !w.isRevealed(w.idx(st.x, st.y))) return null;
    return { station: st.id, item: e.item, entering: !e.loading, kind: 'truck', vehicle: e.id, born: now, gameAt: w.time };
  }
  if (e.kind === 'station-port') {
    const st = w.buildings.get(e.id), from = w.buildings.get(e.from), to = w.buildings.get(e.to);
    if (st?.type !== 'station' || !from || !to || ![from, to].every((b) => w.isRevealed(w.idx(b.x, b.y)))) return null;
    return { station: st.id, item: e.item, entering: to.id === st.id, kind: 'port', from: from.id, to: to.id, born: now, gameAt: w.time };
  }
  return null;
}

/** 진행 중인 아이콘을 중간에 지우지 않고 묶는다. 상한을 넘으면 새 장식만 생략한다. */
export function queueStationTransfer(flights: StationTransfer[], next: StationTransfer, now: number): StationTransfer[] {
  const live = flights.filter((f) => now - f.born < TRANSFER_DURATION);
  if (live.length < TRANSFER_LIMIT && !live.some((f) => f.station === next.station && f.kind === next.kind && f.entering === next.entering)) live.push(next);
  return live;
}

type Point = { x: number; y: number };
const center = (b: Pick<Building, 'x' | 'y' | 'size'>): Point => ({ x: b.x + b.size / 2, y: b.y + b.size / 2 });

/** 화물이 정류장 안에서 들어가고 나오는 끝점. 옆 도로/벨트 쪽의 내부 적재 구역을 사용한다. */
function hatch(st: Building, other: Point): Point {
  const c = center(st), dx = other.x - c.x, dy = other.y - c.y;
  const span = Math.max(Math.abs(dx), Math.abs(dy));
  if (!span) return c;
  const r = st.size * 0.32;
  return { x: c.x + dx / span * r, y: c.y + dy / span * r };
}

export function transferEndpoints(w: World, f: StationTransfer, spots: ReadonlyMap<number, Point> = new Map()): { a: Point; b: Point } | null {
  const st = w.buildings.get(f.station);
  if (st?.type !== 'station' || !w.isRevealed(w.idx(st.x, st.y))) return null;
  if (f.kind === 'truck') {
    const truck = f.vehicle === undefined ? null : w.vehicles.get(f.vehicle);
    if (!truck) return null;
    const at = spots.get(truck.id) ?? truck;
    const bay = hatch(st, at);
    return f.entering ? { a: at, b: bay } : { a: bay, b: at };
  }
  const from = f.from === undefined ? null : w.buildings.get(f.from), to = f.to === undefined ? null : w.buildings.get(f.to);
  if (!from || !to || ![from, to].every((b) => w.isRevealed(w.idx(b.x, b.y)))) return null;
  const a = from.type === 'station' ? hatch(from, center(to)) : center(from);
  const b = to.type === 'station' ? hatch(to, center(from)) : center(to);
  return { a, b };
}

/** 배속과 무관하게 0.55초 유지하는 완료 사건의 장식. 작업/운송 시간을 늘리지 않는다. */
export function transferSample(f: StationTransfer, now: number, a: Point, b: Point) {
  const t = Math.max(0, Math.min(1, (now - f.born) / TRANSFER_DURATION));
  const at = (p: number) => ({ x: a.x + (b.x - a.x) * p, y: a.y + (b.y - a.y) * p - Math.sin(Math.PI * p) * (f.kind === 'truck' ? 0.28 : 0.14) });
  return { t, point: at(t), trail: at(Math.max(0, t - 0.2)), alpha: Math.min(1, (1 - t) / 0.12) };
}

export function transferLabel(f: StationTransfer): string {
  return f.kind === 'truck' ? f.entering ? '하차' : '상차' : f.entering ? '입고' : '출고';
}
