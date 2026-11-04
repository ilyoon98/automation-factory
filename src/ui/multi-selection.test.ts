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
function setup(withBuildings = true, deferred = false) {
  vi.useFakeTimers();
  const w = new World(40, 30); w.rules = 'regional-v1'; w.createHub(0, 0);
  for (const t of w.techs) w.applyTech(t.id);
  for (const item of ITEM_IDS) w.stock.set(item, 1000);
  const buildings = [w.place('smelter', 10, 10, 0)!, w.place('smelter', 15, 10, 0)!];
  const tile = w.idx(10, 10);
  w.piles.push({ tile, item: 'iron-plate', n: 7, ev: 1, why: 'remove' });
  const input = { multi: withBuildings ? buildings.map(b => b.id) : [], multiPiles: [tile],
    selectedId: null, selectedVehicle: null, paste: null };
  const info = { innerHTML: '', hidden: true, dataset: {} };
  vi.stubGlobal('document', { getElementById: () => info });
  const commands: Command[] = [], pending: (() => void)[] = [];
  const game = { input, getWorld: () => w, exec: (c: Command, done: (r: unknown) => void) => {
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
  return { w, input, info, ui, click, commands, pending, buildings, tile };
}

describe('선택한 아이템 모두 줍기 정보창', () => {
  it('설비와 더미를 구분하고 실제 줍기 버튼은 설비 선택을 그대로 둔다', () => {
    const f = setup(), selected = [...f.input.multi], hub = f.w.stockOf('iron-plate');
    expect(f.info.innerHTML).toContain('회수 더미 1곳 · 아이템 7개');
    expect(f.info.innerHTML).toContain('제련로 2대');
    f.click('multi-pile-collect');
    expect(f.commands).toHaveLength(1); expect(f.commands[0].t).toBe('piles-collect');
    expect(f.w.stockOf('iron-plate')).toBe(hub + 7);
    expect(f.input.multi).toEqual(selected); expect(f.input.multiPiles).toEqual([]);
    expect(f.info.innerHTML).not.toContain('data-act="multi-pile-collect"');
    expect(f.info.innerHTML).toContain('제련로 2대');
    expect(f.buildings.every(b => f.w.buildings.has(b.id))).toBe(true);
  });

  it('아이템만 선택했을 때도 버튼이 동작하고 설비 철거는 표시하지 않는다', () => {
    const f = setup(false);
    expect(f.info.hidden).toBe(false);
    expect(f.info.innerHTML).not.toContain('data-act="multi-remove"');
    f.click('multi-pile-collect');
    expect(f.w.pileAt(f.tile).size).toBe(0); expect(f.info.hidden).toBe(true);
  });

  it('응답을 기다리는 동안 중복 클릭을 막고 새 선택은 이전 응답으로 지우지 않는다', () => {
    const f = setup(true, true);
    f.click('multi-pile-collect'); f.click('multi-pile-collect');
    expect(f.commands).toHaveLength(1); expect(f.info.innerHTML).toContain('줍는 중…');
    const next = f.w.idx(25, 20);
    f.w.piles.push({ tile: next, item: 'coal', n: 3, ev: 2, why: 'remove' });
    f.input.multiPiles = [next];
    f.pending[0]();
    expect(f.input.multiPiles).toEqual([next]); expect(f.w.pileCount(next, 'coal')).toBe(3);
  });
});
