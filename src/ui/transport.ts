import type { Building } from '../sim/building';
import { DX, DY } from '../sim/dir';
import type { World } from '../sim/world';
import { ITEM_IDS, ITEMS, type ItemId } from '../data/items';
import type { RouteStop, Vehicle } from '../sim/vehicle';

const networks = new WeakMap<World, { revision: number; components: Uint32Array }>();
const itemOptions = new WeakMap<HTMLSelectElement, string>();

/** 정류장의 서로 떨어진 접도 칸을 통해 도로망이 합쳐지지 않게 도로 칸만 묶는다. */
function roadComponents(w: World): Uint32Array {
  const cached = networks.get(w);
  if (cached?.revision === w.roadRevision) return cached.components;
  const components = new Uint32Array(w.width * w.height);
  let network = 0;
  for (const road of w.buildings.values()) {
    if (road.type !== 'road') continue;
    const start = w.idx(road.x, road.y);
    if (components[start]) continue;
    components[start] = ++network;
    const queue = [start];
    for (let q = 0; q < queue.length; q++) {
      const x = queue[q] % w.width, y = Math.floor(queue[q] / w.width);
      for (let d = 0; d < 4; d++) {
        if (!w.inBounds(x + DX[d], y + DY[d])) continue;
        const next = w.idx(x + DX[d], y + DY[d]);
        if (components[next] || !w.isRoad(next)) continue;
        components[next] = network;
        queue.push(next);
      }
    }
  }
  networks.set(w, { revision: w.roadRevision, components });
  return components;
}

/** 현재 차량 칸에서 실제 findPath와 같은 규칙으로 갈 수 있는 정류장만 반환한다. */
export function reachableStations(w: World, from: number): Building[] {
  const components = roadComponents(w);
  const origins = new Set<number>();
  const x = from % w.width, y = Math.floor(from / w.width);
  if (!w.inBounds(x, y)) return [];
  if (components[from]) origins.add(components[from]);
  else {
    // 차 밑의 도로가 철거되어도 인접 도로로 나갈 수 있는 기존 경로 탐색과 일치한다.
    for (let d = 0; d < 4; d++) {
      if (!w.inBounds(x + DX[d], y + DY[d])) continue;
      const network = components[w.idx(x + DX[d], y + DY[d])];
      if (network) origins.add(network);
    }
  }
  return w.stations().filter((s) => w.isRevealed(w.idx(s.x, s.y)) &&
    w.stationStops(s).some((tile) => tile === from || origins.has(components[tile])));
}

/** 현재 보관 중인 품목을 우선한다. 일반 운송과 계획 운송의 실제 화물 공급 범위를 따른다. */
export function sourceItemGroups(w: World, stationId: number, planned = false): { stocked: ItemId[]; other: ItemId[] } {
  const station = w.buildings.get(stationId);
  const stocked = station?.type === 'station'
    ? ITEM_IDS.filter((item) => (planned ? w.poolCount(station, item) : station.inBuf.get(item) ?? 0) > 0)
    : [];
  const have = new Set(stocked);
  return { stocked, other: ITEM_IDS.filter((item) => !have.has(item)) };
}

export function transportItemOptions(w: World, stationId: number, selected: ItemId | '' | null | undefined, planned = false, placeholder = '아무거나'): string {
  const { stocked, other } = sourceItemGroups(w, stationId, planned);
  const options = (ids: ItemId[]) => ids.map((item) => `<option value="${item}" ${selected === item ? 'selected' : ''}>${ITEMS[item].name}</option>`).join('');
  return `<option value="" ${selected ? '' : 'selected'}>${placeholder}</option>` +
    (stocked.length ? `<optgroup label="출발지에 있음">${options(stocked)}</optgroup>` : '') +
    `<optgroup label="${stocked.length ? '다른 품목' : '전체 품목'}">${options(other)}</optgroup>`;
}

/** 목록을 열 때 그 목록만 갱신한다. 다른 입력이나 아직 적용하지 않은 계획을 재작성하지 않는다. */
export function refreshTransportItemSelect(w: World, v: Vehicle, select: HTMLSelectElement): void {
  const planned = select.dataset.planItem !== undefined;
  if (!planned && select.dataset.act !== 'stop-item') return;
  const source = planned ? v.stops[0]?.id : v.stops[Number(select.dataset.i)]?.id;
  const selected = select.value as ItemId | '';
  const html = transportItemOptions(w, source ?? 0, selected, planned, planned ? '품목 고르기' : '아무거나');
  if (itemOptions.get(select) !== html) {
    select.innerHTML = html;
    select.value = selected;
    itemOptions.set(select, html);
  }
}

function stationMapPoint(w: World, id: number): { x: number; y: number; no: number } | null {
  const station = w.buildings.get(id);
  if (station?.type !== 'station' || !w.isRevealed(w.idx(station.x, station.y))) return null;
  return { x: station.x + station.size / 2, y: station.y + station.size / 2, no: station.stationNo };
}

export function stationMapButton(w: World, stationId: number, index: number): string {
  const point = stationMapPoint(w, stationId);
  return `<button data-act="stop-map" data-i="${index}" aria-label="${point ? `정류장 ${point.no} 지도에서 보기` : '정류장 지도에서 보기'}" title="${point ? `정류장 ${point.no} 지도에서 보기` : '정류장을 먼저 골라 주세요'}" ${point ? '' : 'disabled'}>지도에서 보기</button>`;
}

/** 도로가 끊겨도 존재하는 공개 정류장은 볼 수 있다. 선택한 차량과 노선은 바꾸지 않는다. */
export function focusRouteStation(w: World, stops: readonly RouteStop[], index: number, focus: (x: number, y: number) => void): boolean {
  if (!Number.isInteger(index) || index < 0) return false;
  const stop = stops[index];
  const point = stop && stationMapPoint(w, stop.id);
  if (!point) return false;
  focus(point.x, point.y);
  return true;
}

export function transportSection(id: string, label: string, content: string): string {
  return `<details class="transport-section" data-transport-section="${id}"><summary>${label}</summary>${content}</details>`;
}

/** 상태 갱신이나 노선 편집 때문에 사용자가 펼친 설명/설정이 다시 닫히지 않게 한다. */
export function replaceTransportInfo(el: HTMLElement, html: string, context: string, planVersion?: string): void {
  const same = el.dataset.transportContext === context;
  const open = same
    ? new Set([...el.querySelectorAll<HTMLDetailsElement>('details[data-transport-section][open]')].map((d) => d.dataset.transportSection))
    : new Set<string>();
  // 확정된 계획이 그대로면 목록/도로 상태를 다시 그려도 작성 중인 값은 보존한다.
  // 다른 차량 또는 실제 계획 변경(명령 적용·멀티플레이 갱신)은 새 확정값을 보여 준다.
  const draft: { selector: string; value: string; checked: boolean; focused: boolean }[] = [];
  if (same && planVersion !== undefined && el.dataset.transportPlanVersion === planVersion) {
    for (const attr of ['data-plan-item', 'data-plan-cap', 'data-plan-period', 'data-plan-early']) {
      for (const field of el.querySelectorAll<HTMLInputElement | HTMLSelectElement>(`[${attr}]`)) {
        draft.push({ selector: `[${attr}="${field.getAttribute(attr)}"]`, value: field.value,
          checked: field instanceof HTMLInputElement && field.checked, focused: field === document.activeElement });
      }
    }
  }
  const scroll = same ? el.scrollTop : 0;
  el.innerHTML = html;
  el.dataset.transportContext = context;
  el.dataset.transportPlanVersion = planVersion ?? '';
  for (const d of el.querySelectorAll<HTMLDetailsElement>('details[data-transport-section]')) {
    d.open = open.has(d.dataset.transportSection!);
  }
  for (const saved of draft) {
    const field = el.querySelector<HTMLInputElement | HTMLSelectElement>(saved.selector);
    if (!field) continue;
    field.value = saved.value;
    if (field instanceof HTMLInputElement) field.checked = saved.checked;
    if (saved.focused) field.focus({ preventScroll: true });
  }
  el.scrollTop = scroll;
}
