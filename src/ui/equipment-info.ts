import { UNLOADER_INTERVAL } from '../data/buildings';
import type { Building } from '../sim/building';
import { DX, DY } from '../sim/dir';
import { type World } from '../sim/world';

/** 막대는 충족률이 아니라 공급 용량 중 작업에 요청한 몫이다. 실제 미공급량은 따로 표시한다. */
export function powerUsage(demand: number, capacity: number, satisfaction: number) {
  const ratio = capacity > 0 ? demand / capacity : demand > 0 ? Infinity : 0;
  const shortfall = Math.max(0, demand * (1 - satisfaction));
  return {
    percent: Number.isFinite(ratio) ? Math.round(ratio * 100) : null,
    fill: Math.min(100, ratio * 100),
    shortfall,
    color: shortfall > 0.5 || ratio > 1 ? '#c0392b' : ratio >= 0.9 ? '#b7791f' : '#3f8a3a',
  };
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
