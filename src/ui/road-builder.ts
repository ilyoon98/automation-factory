import { ITEMS } from '../data/items';
import type { Building } from '../sim/building';
import type { RoadPlanResult } from '../sim/road-plan';
import type { World } from '../sim/world';
import { itemIcon } from './icons';

const rendered = new WeakMap<HTMLElement, string>();

/** 동일한 표시 갱신으로 열어 둔 정류장 목록이 닫히지 않게 원본 마크업을 비교한다. */
export function replaceRoadBuilder(el: HTMLElement, html: string): void {
  if (rendered.get(el) === html) return;
  el.innerHTML = html;
  rendered.set(el, html);
}

export function roadStations(w: World): Building[] {
  return [...w.buildings.values()].filter((b) => b.type === 'station' &&
    Array.from({ length: b.size * b.size }, (_, n) => w.idx(b.x + n % b.size, b.y + Math.floor(n / b.size))).every((t) => w.isRevealed(t)))
    .sort((a, b) => a.stationNo - b.stationNo || a.id - b.id);
}

export function roadPlanKey(w: World): string {
  return `${w.nextId}:${w.buildings.size}:${w.roadRevision}:${w.revealedCount}:${w.unlockedBuildings.has('road')}`;
}

export function roadBuilderHtml(w: World, from: number, to: number, plan: RoadPlanResult | null, busy: boolean): string {
  const stations = roadStations(w), source = stations.find((b) => b.id === from);
  const name = (b: Building) => `정류장 ${b.stationNo}${w.regional ? b.zone ? ` · 거점 ${b.zone}` : ' · 거점 미배정' : ''}`;
  const options = stations.filter((b) => b.id !== from).map((b) => `<option value="${b.id}" ${b.id === to ? 'selected' : ''}>${name(b)}</option>`).join('');
  const missing = to && !stations.some((b) => b.id === to) ? `<option value="${to}" selected disabled>삭제되었거나 미공개인 정류장</option>` : '';
  let body = `<p class="muted">${options ? 'B정류장을 고르면 경로와 비용을 미리 보여줘요.' : '연결할 다른 정류장이 없어요.'}</p>`;
  if (plan && !plan.ok) body = `<p class="bad" role="status">${plan.reason}</p>`;
  if (plan?.ok) {
    const shortages = plan.cost.filter((c) => w.stockOf(c.item) < c.count);
    const costs = plan.newTiles.length ? plan.cost.map((c) => `<span>${itemIcon(c.item)}${c.count}</span>`).join(' ') : '추가 비용 없음';
    const disabled = busy || !plan.newTiles.length || shortages.length > 0;
    body = `<div class="row"><span>경로</span><b>${plan.path.length}칸 · 꺾임 ${plan.turns}회</b></div>
      <div class="row"><span>도로</span><b>새로 ${plan.newTiles.length} · 기존 ${plan.path.length - plan.newTiles.length}칸</b></div>
      <div class="row road-cost"><span>건설 비용</span><b>${costs}</b></div>
      ${shortages.length ? `<p class="bad">부족: ${shortages.map((c) => `${itemIcon(c.item)}${ITEMS[c.item].name} ${c.count - w.stockOf(c.item)}개`).join(' · ')}</p>` : ''}
      <div class="actions"><button data-act="road-focus">경로 보기</button><button data-act="road-build" ${disabled ? 'disabled' : ''}>${busy ? '건설 중…' : plan.newTiles.length ? '건설' : '이미 설치됨'}</button></div>`;
  }
  return `<div class="route-head"><b>도로 미리보기</b><button data-act="road-cancel" aria-label="도로 미리보기 닫기" ${busy ? 'disabled' : ''}>×</button></div>
    <div class="row"><span>A</span><b>${source ? name(source) : '정류장 없음'}</b></div>
    <label class="recipe">B <select data-act="road-target" ${busy ? 'disabled' : ''}><option value="0" ${to ? '' : 'selected'}>정류장 고르기</option>${missing}${options}</select></label>
    <small class="muted">최단거리 우선 · 같은 거리면 꺾임 최소</small>${body}`;
}
