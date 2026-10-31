import { afterEach, describe, expect, it, vi } from 'vitest';
import { ITEM_IDS } from '../data/items';
import { Camera } from '../render/camera';
import { PILE_MARKER } from '../render/pile-marker';
import { applyCommand, type Exec } from '../sim/commands';
import { World } from '../sim/world';
import { Input } from './input';
import { constructionCheck, pointerFeedback, type PointerState } from './pointer';
import { planRoad } from '../sim/road-plan';

function factory() {
  const w = new World(40, 30); w.rules = 'regional-v1'; w.createHub(0, 0);
  for (const t of w.techs) w.applyTech(t.id);
  for (const i of ITEM_IDS) w.stock.set(i, 1000);
  const belt = w.place('belt', 10, 10, 1)!;
  belt.items = [{ item: 'copper-plate', pos: .5, n: 1 }];
  const tile = w.idx(10, 10);
  w.piles.push({ tile, item: 'iron-plate', n: 7, ev: 1, why: 'remove' });
  return { w, belt, tile };
}

const state = (values: Partial<PointerState> = {}): PointerState => ({
  tool: null, paste: null, hover: { x: 10, y: 10 }, mouse: [10.5, 10.5], gesture: 'idle', ctrl: false, shift: false, alt: false, ...values,
});

/** 이벤트 리스너만 호출한다. 브라우저·화면 자동화 없이 실제 Input의 클릭 분기를 검사한다. */
function surface() {
  const handlers = new Map<string, ((e: unknown) => void)[]>();
  return {
    addEventListener(name: string, handler: (e: unknown) => void) {
      const list = handlers.get(name) ?? []; list.push(handler); handlers.set(name, list);
    },
    fire(name: string, e: unknown = {}) { for (const handler of handlers.get(name) ?? []) handler(e); },
  };
}

function inputFixture() {
  const { w, belt, tile } = factory();
  const win = surface(), canvasEvents = surface();
  vi.stubGlobal('window', { ...win, devicePixelRatio: 1 });
  vi.stubGlobal('document', { querySelector: () => null });
  vi.stubGlobal('HTMLElement', class {});
  for (const name of ['HTMLInputElement', 'HTMLSelectElement', 'HTMLTextAreaElement']) vi.stubGlobal(name, class {});
  const canvas = { ...canvasEvents, dataset: {} as Record<string, string>, setPointerCapture() {}, getBoundingClientRect: () => ({ left: 0, top: 0 }) };
  const cam = new Camera(); cam.x = cam.y = 10.5;
  let rid = 0;
  const exec: Exec = (c, done) => {
    const result = applyCommand(w, 0, c);
    done?.(result);
  };
  const pickPile = vi.fn((target: number) => applyCommand(w, 0, { t: 'pile-collect', rid: `input-${++rid}`, tile: target }));
  const togglePause = vi.fn();
  const input = new Input(canvas as unknown as HTMLCanvasElement, cam, {
    getWorld: () => w, exec, pickPile, changed: vi.fn(), toast: vi.fn(), togglePause, paletteSlot: () => null, ping: vi.fn(),
  });
  const event = (wx: number, wy: number, values = {}) => {
    const [clientX, clientY] = cam.worldToScreen(wx, wy);
    return { clientX, clientY, pointerId: 1, button: 0, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...values };
  };
  const click = (wx: number, wy: number, values = {}) => {
    canvas.fire('pointerdown', event(wx, wy, values)); win.fire('pointerup', event(wx, wy, values));
  };
  return { w, belt, tile, cam, input, canvas, win, pickPile, togglePause, event, click };
}

afterEach(() => vi.unstubAllGlobals());

describe('창이 열린 동안 입력 보호', () => {
  it('Space를 길게 눌러도 정지 상태가 자동 반복으로 뒤집히지 않는다', () => {
    const f = inputFixture();
    const event = { key: ' ', preventDefault() {} };
    f.win.fire('keydown', event);
    for (let i = 0; i < 5; i++) f.win.fire('keydown', { ...event, repeat: true });
    expect(f.togglePause).toHaveBeenCalledTimes(1);
    f.win.fire('keyup', event);
    f.win.fire('keydown', event);
    expect(f.togglePause).toHaveBeenCalledTimes(2);
  });
  it('이동 키를 지우고, 창을 닫은 뒤에도 눌린 상태가 남지 않는다', () => {
    const { input, cam, win } = inputFixture();
    win.fire('keydown', { key: 'd' });
    const x = cam.x;
    vi.stubGlobal('document', { querySelector: () => ({}) });
    input.update(1);
    expect(cam.x).toBe(x);
    vi.stubGlobal('document', { querySelector: () => null });
    input.update(1);
    expect(cam.x).toBe(x);
  });

  it.each(['frame', 'move', 'up'])('모달이 열리면 %s 경로에서도 건설 드래그가 중단되고 이미 지은 부분만 한 번에 되돌린다', (path) => {
    const f = inputFixture();
    const before = [...f.w.stock];
    f.input.setTool('road');
    f.canvas.fire('pointerdown', f.event(14.5, 14.5));
    f.canvas.fire('pointermove', f.event(18.5, 14.5));
    expect(f.w.buildingAt(18, 14)?.type).toBe('road');
    vi.stubGlobal('document', { querySelector: () => ({}) });
    if (path === 'frame') f.input.update(0);
    if (path === 'move') f.canvas.fire('pointermove', f.event(24.5, 14.5));
    if (path === 'up') f.win.fire('pointerup', f.event(24.5, 14.5));
    vi.stubGlobal('document', { querySelector: () => null });
    f.canvas.fire('pointermove', f.event(26.5, 14.5));
    f.win.fire('pointerup', f.event(26.5, 14.5));
    expect(f.w.buildingAt(19, 14)).toBeNull();
    expect(f.w.buildingAt(26, 14)).toBeNull();
    f.input.undoRedo(false);
    expect([...f.w.stock]).toEqual(before);
    expect(f.w.buildingAt(14, 14)).toBeNull();
  });

  it.each(['escape', 'pointercancel', 'lostpointercapture'])('%s로 영역 철거를 취소하면 마우스를 뗐을 때도 철거하지 않는다', (reason) => {
    const f = inputFixture();
    const first = f.w.place('road', 14, 14, 0)!;
    f.w.place('road', 15, 14, 0);
    const before = [...f.w.stock];
    f.canvas.fire('pointerdown', f.event(14.5, 14.5, { button: 2, ctrlKey: true }));
    f.canvas.fire('pointermove', f.event(16.5, 15.5, { button: 2, ctrlKey: true }));
    expect(f.input.removeArea).not.toBeNull();
    if (reason === 'escape') f.win.fire('keydown', { key: 'Escape' });
    else f.canvas.fire(reason);
    f.win.fire('pointerup', f.event(16.5, 15.5, { button: 2, ctrlKey: true }));
    expect(f.input.removeArea).toBeNull();
    expect(f.w.buildings.get(first.id)).toBe(first);
    expect([...f.w.stock]).toEqual(before);
  });

  it('복사 영역을 그리다 포인터가 취소되면 나중에 뗐을 때 청사진을 만들지 않는다', () => {
    const f = inputFixture();
    f.canvas.fire('pointerdown', f.event(9.5, 9.5, { ctrlKey: true }));
    f.canvas.fire('pointermove', f.event(12.5, 12.5, { ctrlKey: true }));
    f.canvas.fire('pointercancel');
    f.win.fire('pointerup', f.event(12.5, 12.5));
    expect(f.input.selection).toBeNull();
    expect(f.input.paste).toBeNull();
  });
});

describe('도로 미리보기 화면 이동', () => {
  it('경로에 맞춰 화면과 줌만 바꾸며 시뮬레이션·재고·도로를 변경하지 않는다', () => {
    const f = inputFixture();
    const a = f.w.place('station', 3, 20, 0)!, b = f.w.place('station', 34, 20, 0)!;
    const p = planRoad(f.w, a.id, b.id); if (!p.ok) throw Error(p.reason);
    f.input.roadPreview = p;
    const hash = f.w.checksum(), saved = f.w.serialize();
    f.input.frameRoadPreview();
    expect(f.cam.zoom).toBeLessThan(32);
    expect(f.cam.x).toBeGreaterThan(a.x); expect(f.cam.x).toBeLessThan(b.x);
    expect(f.w.checksum()).toBe(hash); expect(f.w.serialize()).toEqual(saved);
    f.input.setTool('road'); expect(f.input.roadPreview).toBeNull();
  });
});

describe('Shift 직선 설치', () => {
  it.each([
    { name: '오른쪽', first: [25.5, 21.5], later: [27.5, 27.5], axis: 'x', dir: 1 },
    { name: '왼쪽', first: [15.5, 21.5], later: [13.5, 27.5], axis: 'x', dir: 3 },
    { name: '아래', first: [21.5, 25.5], later: [27.5, 27.5], axis: 'y', dir: 2 },
    { name: '위', first: [21.5, 15.5], later: [27.5, 13.5], axis: 'y', dir: 0 },
  ])('$name: 대각선 흔들림에도 축과 컨베이어 방향을 고정하고 미리보기를 실제 배치에 맞춘다', ({ first, later, axis, dir }) => {
    const f = inputFixture(); f.input.setTool('belt');
    f.canvas.fire('pointerdown', f.event(20.5, 20.5, { shiftKey: true }));
    expect(f.input.multiArea).toBeNull();
    f.canvas.fire('pointermove', f.event(first[0], first[1], { shiftKey: true }));
    f.canvas.fire('pointermove', f.event(later[0], later[1], { shiftKey: true }));
    f.input.update(0);
    const placed = [...f.w.buildings.values()].filter((b) => b.type === 'belt' && b !== f.belt);
    expect(placed.length).toBeGreaterThan(5);
    expect(placed.every((b) => (axis === 'x' ? b.y : b.x) === 20)).toBe(true);
    expect(placed.every((b) => b.dir === dir), JSON.stringify(placed.map((b) => [b.x, b.y, b.dir]))).toBe(true);
    expect(axis === 'x' ? f.input.hover?.y : f.input.hover?.x).toBe(20);
    expect(f.input.straightPlacement?.axis).toBe(axis);
    expect(f.input.pointerFeedback?.kind).toBe('build');
    expect(f.input.pointerFeedback?.label).toContain('직선 건설 중');
    f.win.fire('pointerup', f.event(later[0], later[1], { shiftKey: true }));
    expect(f.input.straightPlacement).toBeNull();
  });

  it('Shift를 놓으면 자유 설치로 돌아가고 다시 누르면 마지막 배치 칸에서 직선을 시작한다', () => {
    const f = inputFixture(); f.input.setTool('road');
    f.canvas.fire('pointerdown', f.event(14.5, 14.5, { shiftKey: true }));
    f.canvas.fire('pointermove', f.event(18.5, 15.5, { shiftKey: true }));
    f.win.fire('keyup', { key: 'Shift' });
    f.canvas.fire('pointermove', f.event(18.5, 18.5));
    expect(f.input.straightPlacement).toBeNull();
    expect(f.w.buildingAt(18, 18)?.type).toBe('road');
    f.canvas.fire('pointermove', f.event(20.5, 22.5, { shiftKey: true }));
    f.canvas.fire('pointermove', f.event(26.5, 24.5, { shiftKey: true }));
    expect(f.input.straightPlacement).toMatchObject({ x0: 18, y0: 18, x1: 18, y1: 24, axis: 'y' });
    expect(f.w.buildingAt(18, 24)?.type).toBe('road');
    expect(f.w.buildingAt(26, 24)).toBeNull();
  });

  it('빈손 Shift는 단체 선택, 건설 도구를 든 Shift는 설치로 동작한다', () => {
    const f = inputFixture();
    const a = f.w.place('smelter', 14, 14, 0)!, b = f.w.place('smelter', 14, 18, 0)!;
    f.canvas.fire('pointerdown', f.event(13.5, 13.5, { shiftKey: true }));
    f.canvas.fire('pointermove', f.event(16.5, 20.5, { shiftKey: true }));
    f.win.fire('pointerup', f.event(16.5, 20.5, { shiftKey: true }));
    expect(f.input.multi).toEqual([a.id, b.id]);
    f.input.setTool('road');
    f.canvas.fire('pointermove', f.event(24.5, 14.5, { shiftKey: true }));
    expect(f.input.pointerFeedback?.kind).toBe('build');
    f.click(24.5, 14.5, { shiftKey: true });
    expect(f.w.buildingAt(24, 14)?.type).toBe('road');
    expect(f.input.multiArea).toBeNull();
  });

  it('장애물을 우회하지 않고 직선을 유지하며 전체 설치를 한 번에 되돌린다', () => {
    const f = inputFixture(), obstacle = f.w.place('storage', 18, 14, 0)!;
    const before = [...f.w.stock];
    f.input.setTool('road');
    f.canvas.fire('pointerdown', f.event(14.5, 14.5, { shiftKey: true }));
    f.canvas.fire('pointermove', f.event(22.5, 17.5, { shiftKey: true }));
    f.win.fire('pointerup', f.event(22.5, 17.5, { shiftKey: true }));
    const roads = [...f.w.buildings.values()].filter((b) => b.type === 'road');
    expect(roads).toHaveLength(7);
    expect(roads.every((b) => b.y === 14)).toBe(true);
    expect(f.w.buildings.get(obstacle.id)).toBe(obstacle);
    f.input.undoRedo(false);
    expect([...f.w.buildings.values()].filter((b) => b.type === 'road')).toHaveLength(0);
    expect([...f.w.stock]).toEqual(before);
    expect(f.w.buildings.get(obstacle.id)).toBe(obstacle);
  });

  it('2칸 설비도 한 줄에 배치하며 지하 컨베이어의 클릭 배치 제한은 유지한다', () => {
    const f = inputFixture(); f.input.setTool('wind');
    f.canvas.fire('pointerdown', f.event(14.5, 14.5, { shiftKey: true }));
    f.canvas.fire('pointermove', f.event(24.5, 17.5, { shiftKey: true }));
    f.win.fire('pointerup', f.event(24.5, 17.5, { shiftKey: true }));
    const wind = [...f.w.buildings.values()].filter((b) => b.type === 'wind');
    expect(wind).toHaveLength(6); expect(wind.every((b) => b.y === 14)).toBe(true);
    f.input.setTool('underground');
    f.canvas.fire('pointerdown', f.event(14.5, 22.5, { shiftKey: true }));
    f.canvas.fire('pointermove', f.event(22.5, 24.5, { shiftKey: true }));
    f.win.fire('pointerup', f.event(22.5, 24.5, { shiftKey: true }));
    expect([...f.w.buildings.values()].filter((b) => b.type === 'underground')).toHaveLength(1);
  });

  it.each(['escape', 'blur', 'tool'])('%s 종료 후 축이 다음 설치에 남지 않는다', (cancel) => {
    const f = inputFixture(); f.input.setTool('road');
    f.canvas.fire('pointerdown', f.event(14.5, 14.5, { shiftKey: true }));
    f.canvas.fire('pointermove', f.event(18.5, 15.5, { shiftKey: true }));
    if (cancel === 'escape') f.win.fire('keydown', { key: 'Escape', target: null, preventDefault() {} });
    else if (cancel === 'blur') f.win.fire('blur');
    else f.input.setTool('belt');
    expect(f.input.straightPlacement).toBeNull();
    f.win.fire('pointerup', f.event(18.5, 15.5));
    if (f.input.tool) f.input.setTool(null);
    f.input.setTool('road');
    f.canvas.fire('pointerdown', f.event(24.5, 14.5, { shiftKey: true }));
    f.canvas.fire('pointermove', f.event(25.5, 19.5, { shiftKey: true }));
    expect(f.input.straightPlacement).toMatchObject({ x0: 24, y0: 14, x1: 24, y1: 19, axis: 'y' });
  });
});

describe('겹쳐 있는 바닥 회수 더미와 커서', () => {
  it('컨베이어 밑이 아니라 위에 그린 회수 상자를 강조하고 실제 품목·수량을 안내한다', () => {
    const { w, tile } = factory();
    const action = pointerFeedback(w, state());
    expect(action).toMatchObject({ kind: 'pickup', pileTile: tile, target: { x: 10 + PILE_MARKER.x / 16, y: 10 + PILE_MARKER.y / 16, size: PILE_MARKER.size / 16 } });
    expect(action?.label).toContain('철판 7개');
    w.piles.push({ tile, item: 'gear', n: 3, ev: 2, why: 'remove' });
    expect(pointerFeedback(w, state())?.label).toContain('회수 더미 2종 10개');
    w.revealed = new Uint8Array(w.width * w.height);
    expect(pointerFeedback(w, state())).toMatchObject({ kind: 'blocked' });
    expect(pointerFeedback(w, state())?.pileTile).toBeUndefined();
  });

  it('컨베이어와 겹친 바닥 물건을 클릭하면 더미만 회수하고 설비·운반 화물·생산 실적은 보존한다', () => {
    const f = inputFixture(), before = f.w.serialize();
    const hub = f.w.stockOf('iron-plate');
    f.canvas.fire('pointermove', f.event(10.5, 10.5)); f.input.update(0);
    expect(f.canvas.dataset.action).toBe('pickup');
    f.click(10.5, 10.5);
    expect(f.pickPile).toHaveBeenCalledWith(f.tile);
    expect(f.w.pileAt(f.tile).size).toBe(0);
    expect(f.w.stockOf('iron-plate')).toBe(hub + 7);
    expect(f.w.buildings.get(f.belt.id)).toBe(f.belt);
    expect(f.belt.items).toEqual([{ item: 'copper-plate', pos: .5, n: 1 }]);
    expect(f.w.serialize().stats).toEqual(before.stats);
    expect(f.w.serialize().goals).toEqual(before.goals);
    f.input.update(0); expect(f.canvas.dataset.action).toBe('select');
    f.click(10.5, 10.5);
    expect(f.input.selectedId).toBe(f.belt.id);
    expect(f.pickPile).toHaveBeenCalledTimes(1);
  });

  it('큰 설비나 허브의 0번 칸과 겹쳐도 바닥 더미를 먼저 회수한다', () => {
    const f = inputFixture();
    const machine = f.w.place('smelter', 15, 15, 0)!;
    const tile = f.w.idx(16, 16);
    f.w.piles.push({ tile, item: 'gear', n: 3, ev: 3, why: 'remove' });
    f.click(16.5, 16.5);
    expect(f.pickPile).toHaveBeenLastCalledWith(tile);
    expect(f.w.buildings.get(machine.id)).toBe(machine);
    f.w.piles.push({ tile: 0, item: 'gear', n: 1, ev: 4, why: 'remove' });
    f.click(.5, .5);
    expect(f.pickPile).toHaveBeenLastCalledWith(0);
    expect(f.w.pileAt(0).size).toBe(0);
  });

  it('더미 위에서 화면을 드래그하거나 Ctrl/Shift/Alt 조작을 하면 회수하지 않는다', () => {
    const f = inputFixture();
    f.canvas.fire('pointerdown', f.event(10.5, 10.5));
    f.canvas.fire('pointermove', f.event(11.5, 10.5));
    expect(f.input.pointerFeedback?.kind).toBe('pan');
    f.win.fire('pointerup', f.event(11.5, 10.5));
    expect(f.pickPile).not.toHaveBeenCalled();
    for (const values of [{ ctrlKey: true }, { shiftKey: true }, { altKey: true }]) f.click(10.5, 10.5, values);
    expect(f.pickPile).not.toHaveBeenCalled();
    expect(f.w.pileAt(f.tile).get('iron-plate')).toBe(7);
  });

  it('빈 땅은 기존처럼 회수하며 이미 다른 사람이 회수했어도 밑의 설비를 대신 누르지 않는다', () => {
    const f = inputFixture();
    const ground = f.w.idx(20, 20);
    f.w.piles.push({ tile: ground, item: 'gear', n: 2, ev: 4, why: 'remove' });
    f.click(20.5, 20.5); expect(f.pickPile).toHaveBeenLastCalledWith(ground);
    f.canvas.fire('pointerdown', f.event(10.5, 10.5));
    f.w.collectPile(f.tile);
    const stock = f.w.stockOf('iron-plate');
    f.win.fire('pointerup', f.event(10.5, 10.5));
    expect(f.w.stockOf('iron-plate')).toBe(stock);
    expect(f.input.selectedId).toBeNull();
    expect(f.w.buildings.get(f.belt.id)).toBe(f.belt);
  });

  it('건설·철거·복사 등 현재 조작은 회수보다 우선하며 바닥 더미와 운반 화물을 구분한다', () => {
    const { w } = factory();
    expect(pointerFeedback(w, state({ tool: 'belt' }))?.kind).toBe('build');
    expect(pointerFeedback(w, state({ tool: 'belt', gesture: 'remove' }))?.kind).toBe('remove');
    expect(pointerFeedback(w, state({ ctrl: true }))?.kind).toBe('copy');
    expect(pointerFeedback(w, state({ shift: true }))?.kind).toBe('multi');
    expect(pointerFeedback(w, state({ alt: true }))?.kind).toBe('ping');
    w.piles = [];
    expect(pointerFeedback(w, state())).toMatchObject({ kind: 'select' });
    expect(pointerFeedback(w, state())?.pileTile).toBeUndefined();
  });

  it('배치 가능 표시가 실제 벨트 교체 환급·동일 벨트 회전·연구·드래그 제한과 일치한다', () => {
    const { w, belt } = factory(); w.stock.clear();
    expect(constructionCheck(w, 'belt', 10, 10).ok).toBe(true);
    expect(constructionCheck(w, 'fast-belt', 10, 10).ok).toBe(false);
    w.stock.set('steel', 1000); w.stock.set('gear', 1000);
    expect(constructionCheck(w, 'fast-belt', 10, 10).ok).toBe(true);
    const result = applyCommand(w, 0, { t: 'place', tool: 'fast-belt', x: 10, y: 10, dir: belt.dir, initial: true, setting: null });
    expect(result.ok).toBe(true);
    expect(constructionCheck(w, 'underground', 15, 15, true).ok).toBe(false);
    w.unlockedBuildings.delete('fast-belt');
    expect(constructionCheck(w, 'fast-belt', 10, 10)).toMatchObject({ ok: false, reason: '연구 필요' });
  });

  it('건설·철거·영역 철거·화면 이탈·포커스 상실을 커서와 입력 상태에 반영한다', () => {
    const f = inputFixture(); f.input.setTool('belt');
    f.canvas.fire('pointermove', f.event(14.5, 14.5)); f.input.update(0);
    expect(f.canvas.dataset.action).toBe('build');
    f.canvas.fire('pointerdown', f.event(14.5, 14.5, { button: 2 })); f.input.update(0);
    expect(f.canvas.dataset.action).toBe('remove');
    f.win.fire('pointerup', f.event(14.5, 14.5, { button: 2 })); f.input.update(0);
    expect(f.canvas.dataset.action).toBe('build');
    f.canvas.fire('pointerdown', f.event(14.5, 14.5, { button: 2, ctrlKey: true }));
    expect(f.input.pointerFeedback?.label).toContain('영역 철거');
    f.win.fire('blur'); expect(f.input.removeArea).toBeNull();
    f.canvas.fire('pointerleave');
    expect(f.input.pointerFeedback).toBeNull(); expect(f.canvas.dataset.action).toBe('');
  });

  it('줌·카메라 이동 뒤에도 화면의 실제 마우스 위치에 대상 칸을 맞춘다', () => {
    const f = inputFixture(); f.canvas.fire('pointermove', f.event(10.5, 10.5));
    f.cam.x += 2; f.cam.zoom = 64; f.input.update(0);
    expect(f.input.mouse).toEqual([12.5, 10.5]); expect(f.input.hover).toEqual({ x: 12, y: 10 });
    expect(f.input.pointerFeedback?.kind).toBe('move');
  });
});
