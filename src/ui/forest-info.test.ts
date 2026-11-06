import { afterEach, describe, expect, it, vi } from 'vitest';
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

afterEach(() => vi.unstubAllGlobals());

function setup(type: 'planter' | 'sawmill' | 'lumberjack') {
  const w = new World(40, 40);
  w.createHub(0, 0);
  w.applyTech('forestry');
  for (const item of ITEM_IDS) w.stock.set(item, 1000);
  const b = w.place(type, 15, 15, 0)!;
  const tip = { hidden: true, innerHTML: '' };
  vi.stubGlobal('document', { getElementById: () => tip, querySelector: () => null });
  const ui = Object.assign(Object.create(UI.prototype), {
    game: { input: { hover: { x: 15, y: 15 }, tool: null } }, positionTooltip: vi.fn(),
  });
  return { w, b, ui, tip };
}

describe('산림 정보창과 툴팁의 실제 원인 표시', () => {
  it('묘목 부족과 정상 성장 대기를 같은 정보창·툴팁에 반영한다', () => {
    const { w, b, ui, tip } = setup('planter');
    w.tick();
    expect(ui.infoDynamic(w, b)).toContain('묘목 부족');
    expect(ui.infoDynamic(w, b)).toContain('묘목 입고');
    expect(ui.infoDynamic(w, b)).toContain('8×8');
    ui.updateTooltip(w);
    expect(tip.innerHTML).toContain('묘목 부족');
    for (const tile of b.mineTiles) w.setTree(tile % w.width, Math.floor(tile / w.width), 0.2);
    expect(ui.infoDynamic(w, b)).toContain('숲 성장 대기');
    expect(ui.infoDynamic(w, b)).not.toContain('묘목 부족');
    ui.updateTooltip(w);
    expect(tip.innerHTML).toContain('숲 성장 대기');
  });

  it('톱밥만 쌓이면 목재 적체라고 하지 않고 해결 후 안내도 사라진다', () => {
    const { w, b, ui, tip } = setup('sawmill');
    w.setRecipe(b, 'saw');
    b.inBuf.set('log', 2);
    b.outBuf.set('sawdust', 2);
    w.tick();
    const html = ui.infoDynamic(w, b);
    expect(html).toContain('톱밥 적체');
    expect(html).toContain('톱밥 배출이 막혀 목재 생산도 멈췄어요.');
    expect(html).not.toContain('목재 적체');
    ui.updateTooltip(w);
    expect(tip.innerHTML).toContain('톱밥 적체');
    b.outBuf.clear();
    w.tick();
    expect(ui.infoDynamic(w, b)).not.toContain('적체');
    ui.updateTooltip(w);
    expect(tip.innerHTML).not.toContain('적체');
  });

  it('벌목기는 실제로 넓어진 작업 범위를 표시한다', () => {
    const { w, b, ui } = setup('lumberjack');
    expect(ui.infoDynamic(w, b)).toContain('12×12');
  });
});
