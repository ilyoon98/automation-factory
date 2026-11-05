import { afterEach, describe, expect, it, vi } from 'vitest';
import { StartScreen, startScreenHtml, type StartState } from './start-screen';

const state = (values: Partial<StartState> = {}): StartState => ({
  hasSave: true, day: 3, sites: 2, netReady: true, rooms: 0, version: '0.6.11', canSwitch: true, active: 2,
  slots: [{ id: 2, name: '철판 공장', day: 3, sites: 2, savedAt: 0 }, { id: 1, name: '<공장 1>', day: 9, sites: 4, savedAt: 0 }],
  ...values,
});

afterEach(() => vi.unstubAllGlobals());

describe('시작화면 내용', () => {
  it('저장이 있으면 이어하기와 지금 공장 이름·일차·거점, 새 공장을 보인다', () => {
    const html = startScreenHtml(state());
    expect(html).toContain('이어하기<small>철판 공장 · 3일차 · 거점 2곳</small>');
    expect(html).toContain('data-start="new"');
    expect(html).toContain('게임 버전 0.6.11');
  });

  it('저장이 없으면 새 공장 시작 하나만 기본으로 두고 새 공장 버튼은 없다', () => {
    const html = startScreenHtml(state({ hasSave: false }));
    expect(html).toContain('새 공장 시작');
    expect(html).not.toContain('data-start="new"');
  });

  it('같이 하기는 서버가 없으면 막고, 열린 방 수를 알려 준다', () => {
    expect(startScreenHtml(state({ netReady: false }))).toMatch(/data-start="together" disabled/);
    expect(startScreenHtml(state({ rooms: 2 }))).toContain('같은 와이파이에 열린 방 2개');
  });
});

/** 클릭·키 리스너만 호출하는 작은 DOM 대역 */
function fixture(s = state()) {
  const listeners = new Map<string, ((e: unknown) => void)[]>();
  const on = (name: string, fn: (e: unknown) => void) => listeners.set(name, [...(listeners.get(name) ?? []), fn]);
  vi.stubGlobal('window', { addEventListener: (name: string, fn: (e: unknown) => void) => on(`win:${name}`, fn) });
  vi.stubGlobal('document', { activeElement: null });
  vi.stubGlobal('HTMLElement', class {});
  const el = { hidden: true, innerHTML: '', querySelector: () => null, addEventListener: (name: string, fn: (e: unknown) => void) => on(`el:${name}`, fn) };
  const actions = { play: vi.fn(), newFactory: vi.fn(), together: vi.fn(), open: vi.fn(), rename: vi.fn(), remove: vi.fn() };
  const screen = new StartScreen(el as unknown as HTMLElement, actions);
  screen.open(s);
  const click = (act: string, slot?: number) => listeners.get('el:click')!.forEach(fn => fn({ target: { closest: () => ({ dataset: { start: act, slot: slot === undefined ? undefined : String(slot) } }) } }));
  const key = (k: string) => {
    const e = { key: k, target: null, preventDefault: vi.fn(), stopImmediatePropagation: vi.fn() };
    listeners.get('win:keydown')!.forEach(fn => fn(e));
    return e;
  };
  return { el, actions, screen, click, key };
}

describe('시작화면 동작', () => {
  it('이어하기·같이 하기는 시작화면을 닫고 고른 일을 한다', () => {
    const f = fixture();
    expect(f.el.hidden).toBe(false);
    f.click('together');
    expect(f.el.hidden).toBe(true); expect(f.actions.together).toHaveBeenCalledOnce();
  });

  it('새 공장은 덮어쓰지 않으므로 한 번에 만든다', () => {
    const f = fixture();
    f.click('new');
    expect(f.actions.newFactory).toHaveBeenCalledOnce(); expect(f.el.hidden).toBe(true);
  });

  it('다른 공장 열기는 닫고 열며, 지우기는 한 번 더 눌러야 한다', () => {
    const f = fixture();
    f.click('remove', 1);
    expect(f.actions.remove).not.toHaveBeenCalled();
    expect(f.el.innerHTML).toContain('정말 지우기');
    f.click('remove', 1);
    expect(f.actions.remove).toHaveBeenCalledWith(1); expect(f.el.hidden).toBe(false);
    f.click('open', 1);
    expect(f.actions.open).toHaveBeenCalledWith(1); expect(f.el.hidden).toBe(true);
  });

  it('Esc는 이어하기이고, 버튼 밖의 Space는 뒤 공장으로 새지 않는다', () => {
    const f = fixture();
    const space = f.key(' ');
    expect(space.stopImmediatePropagation).toHaveBeenCalled(); expect(f.actions.play).not.toHaveBeenCalled();
    f.key('Escape');
    expect(f.actions.play).toHaveBeenCalledOnce(); expect(f.el.hidden).toBe(true);
    const after = f.key(' ');
    expect(after.stopImmediatePropagation).not.toHaveBeenCalled();
  });
});

describe('공장 목록', () => {
  it('지금 공장에는 열기·지우기가 없고 다른 공장에는 있으며, 이름은 글자 그대로 보인다', () => {
    const html = startScreenHtml(state());
    expect(html).toContain('<b>철판 공장</b><span class="tag">지금</span>');
    expect(html).not.toContain('data-start="open" data-slot="2"');
    expect(html).toContain('data-start="open" data-slot="1"');
    expect(html).toContain('&#60;공장 1&#62;');
  });

  it('같이 하는 동안 손님은 공장을 바꾸거나 지우지 못한다', () => {
    const html = startScreenHtml(state({ canSwitch: false }));
    expect(html).toMatch(/data-start="new" disabled/);
    expect(html).toMatch(/data-start="open" data-slot="1" disabled/);
    expect(html).toMatch(/data-start="remove" data-slot="1" class="" disabled/);
  });

  it('이름 고치기는 입력칸으로 바뀐다', () => {
    expect(startScreenHtml(state(), { rename: 1, remove: null })).toContain('<input data-rename="1" value="&#60;공장 1&#62;"');
  });
});
