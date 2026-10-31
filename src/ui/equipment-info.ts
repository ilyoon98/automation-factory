import { UNLOADER_INTERVAL } from '../data/buildings';
import type { Building } from '../sim/building';
import { DX, DY } from '../sim/dir';
import { DT, type World } from '../sim/world';

/** 실제 충전원과 차량이 받은 전력만 집계한다. */
export function chargerInfo(w: World, b: Building) {
  const roads = [0, 1, 2, 3].map((d) => [b.x + DX[d], b.y + DY[d]])
    .filter(([x, y]) => w.inBounds(x, y) && w.isRoad(w.idx(x, y)));
  const trucks = [...w.vehicles.values()].filter((v) => v.charger && w.chargeSpot(v)?.id === b.id);
  const active = trucks.filter((v) => v.receivedCharge > 0);
  return { roads: roads.length, active: active.length, waiting: trucks.length - active.length,
    kw: active.reduce((n, v) => n + v.receivedCharge / DT, 0) };
}

/** 허브·창고를 우선하고 다른 설비와 겹친 더미도 실제 하역기와 같은 순서로 읽는다. */
export function unloaderInfo(w: World, b: Building) {
  const x = b.x - DX[b.dir], y = b.y - DY[b.dir];
  const back = w.buildingAt(x, y);
  const holder = back?.type === 'hub' || back?.type === 'storage' ? back : null;
  const pile = !holder && w.inBounds(x, y) && w.pileAt(w.idx(x, y)).size > 0;
  const front = w.buildingAt(b.x + DX[b.dir], b.y + DY[b.dir]);
  return { source: holder?.def.name ?? (pile ? '회수 더미' : null), maximum: (60 / UNLOADER_INTERVAL) * (front?.def.stack ?? 1) };
}

/** 접어서 보는 설비 사용법. 세계별로 다른 철거 반환 안내도 함께 관리한다. */
export function equipmentHelp(w: World, b: Building): string {
  const notes = [b.def.description];
  if (b.type === 'storage') notes.push(w.regional
    ? '철거하면 건설 재료는 허브로, 내용물은 그 칸의 회수 더미로 돌아가요.'
    : '철거하면 건설 재료와 내용물이 허브로 돌아가요.');
  if (b.type === 'unloader' && w.regional) notes.push('뒤 칸의 회수 더미에서도 꺼낼 수 있어요. 허브·창고가 겹쳐 있으면 그 보관함을 먼저 사용해요.');
  if (b.type === 'underground') notes.push('방향을 바꾸려면 철거하고 다시 놓으세요.');
  if (b.type === 'generator') notes.push('숯이 있으면 석탄보다 먼저 태워요.');
  return notes.map((s) => `<p class="muted">${s}</p>`).join('');
}
