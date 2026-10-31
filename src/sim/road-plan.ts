import { BUILDINGS } from '../data/buildings';
import type { ItemStack } from '../data/items';
import type { Building } from './building';
import { DX, DY } from './dir';
import type { World } from './world';

export interface RoadPlan {
  ok: true;
  from: number;
  to: number;
  /** 양 정류장에 맞닿는 실제 정차 칸을 포함한 도로 경로. */
  path: number[];
  newTiles: number[];
  turns: number;
  cost: ItemStack[];
}
export type RoadPlanResult = RoadPlan | { ok: false; reason: string };
export interface RoadBuildResult { ok: boolean; reason?: string; placed?: number }

function edge(w: World, b: Building): number[] {
  const tiles: number[] = [];
  for (let n = 0; n < b.size; n++) {
    for (const [x, y] of [[b.x + n, b.y - 1], [b.x + n, b.y + b.size], [b.x - 1, b.y + n], [b.x + b.size, b.y + n]]) {
      if (w.inBounds(x, y)) tiles.push(w.idx(x, y));
    }
  }
  return tiles.sort((a, b) => a - b);
}

/** 최단거리를 먼저 구한 뒤 같은 거리의 경로에서 꺾임 수, 신규 도로 수를 최소화한다. */
export function planRoad(w: World, from: number, to: number): RoadPlanResult {
  const a = w.buildings.get(from), b = w.buildings.get(to);
  if (!a || !b || a.type !== 'station' || b.type !== 'station') return { ok: false, reason: '출발·도착 정류장을 골라 주세요' };
  if (from === to) return { ok: false, reason: '서로 다른 정류장을 골라 주세요' };
  if (!w.unlockedBuildings.has('road')) return { ok: false, reason: '차량 운송 연구가 필요해요' };
  for (const s of [a, b]) for (let y = s.y; y < s.y + s.size; y++) for (let x = s.x; x < s.x + s.size; x++) {
    if (!w.isRevealed(w.idx(x, y))) return { ok: false, reason: '공개된 정류장만 연결할 수 있어요' };
  }
  const count = w.width * w.height;
  // 0 미확인, 1 막힘, 2 기존 도로, 3 신설 가능. 재료 부족을 장애물로 취급하지 않는다.
  const cells = new Uint8Array(count);
  const open = (t: number): boolean => {
    if (cells[t]) return cells[t] > 1;
    if (!w.isRevealed(t)) { cells[t] = 1; return false; }
    if (w.isRoad(t)) { cells[t] = 2; return true; }
    const check = w.canPlace('road', t % w.width, Math.floor(t / w.width));
    cells[t] = check.ok || check.reason === '재료 부족' ? 3 : 1;
    return cells[t] === 3;
  };
  const starts = edge(w, a).filter(open), ends = edge(w, b).filter(open);
  if (!starts.length || !ends.length) return { ok: false, reason: '정류장 테두리에 도로를 놓을 빈칸이 없어요' };
  const goals = new Uint8Array(count); for (const t of ends) goals[t] = 1;
  const dist = new Int32Array(count); dist.fill(-1);
  const queue = new Int32Array(count); let head = 0, tail = 0, shortest = -1;
  for (const t of starts) { dist[t] = 0; queue[tail++] = t; }
  while (head < tail) {
    const t = queue[head++], depth = dist[t];
    if (shortest >= 0 && depth > shortest) break;
    if (goals[t]) shortest = depth;
    if (shortest >= 0 && depth >= shortest) continue;
    const x = t % w.width, y = Math.floor(t / w.width);
    for (let d = 0; d < 4; d++) {
      const nx = x + DX[d], ny = y + DY[d];
      if (!w.inBounds(nx, ny)) continue;
      const next = w.idx(nx, ny);
      if (dist[next] >= 0 || !open(next)) continue;
      dist[next] = depth + 1; queue[tail++] = next;
    }
  }
  if (shortest < 0) return { ok: false, reason: '연결 경로가 없어요. 건물·물·미공개 지역을 확인하세요' };

  // 최단거리의 다음 층으로만 진행하며 방향별 상태로 꺾임을 비교한다.
  const turns = new Int32Array(count * 4); turns.fill(0x7fffffff);
  const built = new Int32Array(count * 4); built.fill(0x7fffffff);
  const parent = new Int32Array(count * 4); parent.fill(-2);
  for (const t of starts) for (let d = 0; d < 4; d++) {
    const s = t * 4 + d; turns[s] = 0; built[s] = cells[t] === 3 ? 1 : 0; parent[s] = -1;
  }
  for (let i = 0; i < tail; i++) {
    const t = queue[i]; if (dist[t] >= shortest) continue;
    const x = t % w.width, y = Math.floor(t / w.width);
    for (let d = 0; d < 4; d++) {
      const nx = x + DX[d], ny = y + DY[d];
      if (!w.inBounds(nx, ny)) continue;
      const next = w.idx(nx, ny); if (dist[next] !== dist[t] + 1) continue;
      const state = next * 4 + d;
      for (let previous = 0; previous < 4; previous++) {
        const p = t * 4 + previous; if (parent[p] === -2) continue;
        const bends = turns[p] + (previous === d ? 0 : 1), roads = built[p] + (cells[next] === 3 ? 1 : 0);
        if (bends < turns[state] || bends === turns[state] && (roads < built[state] || roads === built[state] && p < parent[state])) {
          turns[state] = bends; built[state] = roads; parent[state] = p;
        }
      }
    }
  }
  let best = -1;
  for (const t of ends) if (dist[t] === shortest) for (let d = 0; d < 4; d++) {
    const s = t * 4 + d; if (parent[s] === -2) continue;
    if (best < 0 || turns[s] < turns[best] || turns[s] === turns[best] && (built[s] < built[best] || built[s] === built[best] && s < best)) best = s;
  }
  const path: number[] = [];
  for (let s = best; s >= 0; s = parent[s]) path.push(Math.floor(s / 4));
  path.reverse();
  const newTiles = path.filter((t) => cells[t] === 3);
  return { ok: true, from, to, path, newTiles, turns: turns[best], cost: BUILDINGS.road.cost.map((c) => ({ item: c.item, count: c.count * newTiles.length })) };
}

/** 확인한 미리보기를 다시 검증한다. 경로나 비용이 달라지면 설치하지 않고 재확인한다. */
export function buildRoad(w: World, from: number, to: number, path: number[], newTiles: number[]): RoadBuildResult {
  if (!Array.isArray(path) || !Array.isArray(newTiles) || path.length > w.width * w.height || newTiles.length > path.length) return { ok: false, reason: '도로 경로를 다시 확인해 주세요' };
  const plan = planRoad(w, from, to);
  if (!plan.ok) return plan;
  if (plan.path.length !== path.length || plan.path.some((t, i) => t !== path[i]) || plan.newTiles.length !== newTiles.length || plan.newTiles.some((t, i) => t !== newTiles[i])) {
    return { ok: false, reason: '지도가 바뀌었어요. 갱신된 경로와 비용을 확인해 주세요' };
  }
  if (!plan.newTiles.length) return { ok: false, reason: '새로 설치할 도로가 없어요' };
  if (!w.canAfford(plan.cost)) return { ok: false, reason: '재료가 부족해요. 도로는 설치하지 않았어요' };
  w.edit(() => {
    for (const t of plan.newTiles) w.place('road', t % w.width, Math.floor(t / w.width), 0);
  });
  return { ok: true, placed: plan.newTiles.length };
}
