import { BUILDINGS, isBeltType, type BuildingType } from '../data/buildings';
import { ITEMS } from '../data/items';
import { PILE_MARKER } from '../render/pile-marker';
import type { Building } from '../sim/building';
import { World } from '../sim/world';

export type PointerGesture = 'idle' | 'place' | 'remove' | 'remove-area' | 'pan' | 'copy' | 'multi';
export interface PointerState {
  tool: BuildingType | null;
  paste: unknown;
  hover: { x: number; y: number } | null;
  mouse: [number, number] | null;
  gesture: PointerGesture;
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
}

export interface PointerFeedback {
  kind: 'build' | 'remove' | 'pickup' | 'select' | 'move' | 'pan' | 'blocked' | 'copy' | 'multi' | 'ping';
  label: string;
  color: string;
  target?: { x: number; y: number; size: number };
  /** 바닥 회수 더미만. 컨베이어에서 운반 중인 화물과 구분한다. */
  pileTile?: number;
}

const GREEN = '#3f8a3a', RED = '#c0392b', INK = '#3b2716', BLUE = '#3f86c4';
const body = (b: Building) => ({ x: b.x, y: b.y, size: b.size });

/** 첫 클릭의 벨트 교체·원가 환급과 드래그의 덮어쓰기 제한도 실제 배치 명령에 맞춘다. */
export function constructionCheck(w: World, tool: BuildingType, hx: number, hy: number, dragging = false): { ok: boolean; reason?: string } {
  if (!w.unlockedBuildings.has(tool)) return { ok: false, reason: '연구 필요' };
  if (tool === 'underground' && dragging) return { ok: false, reason: '지하 컨베이어는 한 칸씩 클릭해서 배치해요' };
  const b = w.buildingAt(hx, hy);
  if (isBeltType(tool) && b && isBeltType(b.type)) {
    const affordable = tool === b.type || BUILDINGS[tool].cost.every((c) => w.stockOf(c.item) + (b.def.cost.find((v) => v.item === c.item)?.count ?? 0) >= c.count);
    return affordable ? { ok: true } : { ok: false, reason: '재료 부족' };
  }
  const [x, y] = World.originFor(tool, hx, hy);
  return w.canPlace(tool, x, y, !dragging && tool !== 'road');
}

/** 실제 클릭 분기와 같은 우선순위. 커서·테두리·툴팁은 이 결과 하나를 사용한다. */
export function pointerFeedback(w: World, s: PointerState): PointerFeedback | null {
  const h = s.hover;
  if (!h || !w.inBounds(h.x, h.y)) return null;
  if (s.gesture === 'pan') return { kind: 'pan', label: '화면 이동 중', color: INK };
  if (!w.isRevealed(w.idx(h.x, h.y))) return { kind: 'blocked', label: '아직 공개되지 않은 지역', color: RED };
  const b = w.buildingAt(h.x, h.y);
  if (s.gesture === 'remove-area') return { kind: 'remove', label: '영역 철거 · 마우스를 떼면 철거', color: RED };
  if (s.gesture === 'remove') {
    return b?.type === 'hub'
      ? { kind: 'blocked', label: '허브는 철거할 수 없어요', color: RED, target: body(b) }
      : { kind: 'remove', label: b ? `${b.def.name} 철거 중` : '철거 중 · 우클릭을 놓으면 종료', color: RED, target: b ? body(b) : { ...h, size: 1 } };
  }
  if (s.alt) return { kind: 'ping', label: '클릭: 위치 알리기', color: BLUE };
  if (s.gesture === 'copy' || s.ctrl) return { kind: 'copy', label: '드래그: 영역 복사 · 우클릭 드래그: 영역 철거', color: BLUE };
  if (s.gesture === 'multi' || (s.shift && !s.tool && !s.paste)) return { kind: 'multi', label: '드래그: 설비 단체 선택', color: BLUE };
  if (s.paste) return { kind: 'build', label: '클릭: 청사진 배치 · 우클릭: 취소', color: GREEN };
  if (s.tool) {
    if (s.gesture !== 'place' && b && !isBeltType(b.type) && !(s.tool === 'road' && b.type === 'road')) {
      return { kind: 'select', label: `클릭: ${b.def.name} 선택`, color: BLUE, target: body(b) };
    }
    const tool = s.tool, [x, y] = World.originFor(tool, h.x, h.y);
    const target = { x, y, size: BUILDINGS[tool].size };
    const check = constructionCheck(w, tool, h.x, h.y, s.gesture === 'place');
    if (!check.ok) return { kind: 'blocked', label: `건설 불가 · ${check.reason}`, color: RED, target };
    const action = s.shift ? s.gesture === 'place' ? '직선 건설 중' : 'Shift 직선 건설' : s.gesture === 'place' ? '건설 중' : '클릭: 건설';
    return { kind: 'build', label: `${BUILDINGS[tool].name} · ${action}`, color: GREEN, target };
  }
  const tile = w.idx(h.x, h.y);
  const pile = w.pileAt(tile);
  if (pile.size) {
    const total = [...pile.values()].reduce((n, amount) => n + amount, 0);
    const name = pile.size === 1 ? ITEMS[pile.keys().next().value!].name : `회수 더미 ${pile.size}종`;
    return {
      kind: 'pickup', label: `${name} ${total}개 · 클릭: 바닥 물건 줍기`, color: GREEN, pileTile: tile,
      target: { x: h.x + PILE_MARKER.x / 16, y: h.y + PILE_MARKER.y / 16, size: PILE_MARKER.size / 16 },
    };
  }
  if (s.mouse) {
    const v = w.vehicleAt(...s.mouse);
    if (v) return { kind: 'select', label: `클릭: 트럭 ${v.id} 선택`, color: BLUE };
  }
  if (b) {
    return { kind: 'select', label: `클릭: ${b.def.name} 선택`, color: BLUE, target: body(b) };
  }
  return { kind: 'move', label: '드래그: 화면 이동', color: INK };
}
