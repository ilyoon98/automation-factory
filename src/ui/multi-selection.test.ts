import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyCommand, type Command } from '../sim/commands';
import { ITEM_IDS } from '../data/items';
import { World } from '../sim/world';

vi.mock('./topbar', () => ({ topbar: {} }));
vi.mock('./sound', () => ({ sound: { play: vi.fn() } }));
vi.mock('./crisp', () => ({ uiZoom: () => 1, crispText: () => false, crispTarget: () => ({ dpr: 1, target: 1 }),
  onUiZoom: vi.fn(), setCrispText: vi.fn() }));
vi.mock('./icons', () => Object.fromEntries([
  'buildingIcon', 'buildingIconUrl', 'depositIconUrl', 'itemIcon', 'itemLink', 'lockIcon',
  'mapIcon', 'techIcon', 'techTabIcon', 'truckIconUrl', 'withBuildingIcons',
].map(name => [name, (value: string) => value ?? ''])));
import { UI } from './ui';

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

/** 실제 UI의 표시·버튼 분기를 작은 DOM 대역에서 검사한다. 게임 창이나 브라우저는 실행하지 않는다. */
function setup(deferred = false) {
  vi.useFakeTimers();
  const w = new World(40, 30); w.rules = 'regional-v1'; w.createHub(0, 0);
  for (const t of w.techs) w.applyTech(t.id);
  for (const item of ITEM_IDS) w.stock.set(item, 1000);
  const buildings = [w.place('smelter', 10, 10, 0)!, w.place('smelter', 15, 10, 0)!];
  const tile = w.idx(10, 10);
  w.piles.push({ tile, item: 'iron-plate', n: 7, ev: 1, why: 'remove' });
  const input = { multi: buildings.map(b => b.id),
    selectedId: null, selectedVehicle: null, paste: null };
  const info = { innerHTML: '', hidden: true, dataset: {} };
  vi.stubGlobal('document', { getElementById: () => info });
  const commands: Command[] = [], pending: (() => void)[] = [];
  const game = { input, getWorld: () => w, showPickup: vi.fn(), exec: (c: Command, done: (r: unknown) => void) => {
    commands.push(c);
    const run = () => done(applyCommand(w, 0, c));
    if (deferred) pending.push(run); else run();
  } };
  // 생성자의 전체 앱 초기화 없이 정보창의 실제 메서드를 실행한다.
  const ui = Object.assign(Object.create(UI.prototype), {
    game, infoWorld: w, infoKey: '', useBusy: new Set<string>(), toast: vi.fn(),
  });
  ui.update = () => ui.updateInfo(w);
  const click = (act: string) => ui.onInfoClick({ target: {
    closest: (selector: string) => selector === '[data-act]' ? { dataset: { act } } : null,
  } });
  ui.update();
  return { w, game, input, info, ui, click, commands, pending, buildings, tile };
}

describe('Shift 드래그 바닥 아이템 바로 줍기', () => {
  it('설비 단체 선택 정보창에는 줍기 버튼이 없고, 영역 줍기는 설비 선택을 그대로 둔다', () => {
    const f = setup(), selected = [...f.input.multi], hub = f.w.stockOf('iron-plate');
    expect(f.info.innerHTML).toContain('제련로 2대');
    expect(f.info.innerHTML).not.toContain('줍기');
    f.ui.pickPiles([f.tile], 0);
    expect(f.commands).toHaveLength(1); expect(f.commands[0].t).toBe('piles-collect');
    expect(f.w.stockOf('iron-plate')).toBe(hub + 7);
    expect(f.ui.toast).toHaveBeenLastCalledWith('허브 +7개', 2400);
    expect(f.game.showPickup).toHaveBeenCalledWith([{ tile: f.tile, item: 'iron-plate' }]);
    expect(f.input.multi).toEqual(selected);
    expect(f.buildings.every(b => f.w.buildings.has(b.id))).toBe(true);
  });

  it('하역기 더미만 있으면 명령 없이 남긴 곳 수를 알리고, 함께 주우면 결과 뒤에 덧붙인다', () => {
    const f = setup();
    f.ui.pickPiles([], 2);
    expect(f.commands).toHaveLength(0);
    expect(f.ui.toast).toHaveBeenLastCalledWith('하역기용 2곳 유지', 2400);
    expect(f.game.showPickup).not.toHaveBeenCalled();
    f.ui.pickPiles([f.tile], 1);
    expect(f.ui.toast).toHaveBeenLastCalledWith('허브 +7개 · 하역기용 1곳 유지', 2400);
  });

  it('응답을 기다리는 중에도 다음 영역 줍기를 막지 않는다', () => {
    const f = setup(true);
    const next = f.w.idx(25, 20);
    f.w.piles.push({ tile: next, item: 'coal', n: 3, ev: 2, why: 'remove' });
    f.ui.pickPiles([f.tile], 0); f.ui.pickPiles([next], 0);
    expect(f.commands).toHaveLength(2);
    for (const run of f.pending) run();
    expect(f.w.pileTiles().size).toBe(0);
  });

  it('개별 줍기도 창고에 실제로 들어간 몫과 허브로 넘긴 몫을 나눠 표시한다', () => {
    const f = setup();
    const storage = f.w.place('storage', 12, 12, 0)!;
    storage.inBuf.set('stone', 197);
    f.ui.pickPile(f.tile);
    expect(f.ui.toast).toHaveBeenLastCalledWith('창고 +3개 · 허브 +4개', 2400);
    expect(f.game.showPickup).toHaveBeenCalledExactlyOnceWith([{ tile: f.tile, item: 'iron-plate' }]);
    expect(storage.inBuf.get('iron-plate')).toBe(3);
  });

  it('응답 전에 사라진 더미에는 회수 효과를 만들지 않고 실패 이유만 표시한다', () => {
    const f = setup(true);
    f.ui.pickPile(f.tile); f.ui.pickPile(f.tile);
    expect(f.commands).toHaveLength(1);
    f.w.collectPile(f.tile);
    f.pending[0]();
    expect(f.game.showPickup).not.toHaveBeenCalled();
    expect(f.ui.toast).toHaveBeenLastCalledWith('회수 더미가 없어요', 3000);
  });

  it('다른 공장으로 바꾼 뒤 도착한 응답으로 새 지도에 회수 효과·완료 알림을 띄우지 않는다', () => {
    const f = setup(true);
    f.ui.pickPiles([f.tile], 0);
    f.game.getWorld = () => new World(40, 30);
    f.pending[0]();
    expect(f.game.showPickup).not.toHaveBeenCalled();
    expect(f.ui.toast).not.toHaveBeenCalled();
  });
});
