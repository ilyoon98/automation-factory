import { afterEach, describe, expect, it, vi } from 'vitest';
import { StartScreen, startScreenHtml, type StartState } from './start-screen';

const state = (values: Partial<StartState> = {}): StartState => ({
  hasSave: true, day: 3, sites: 2, netReady: true, rooms: 0, version: '0.6.11', ...values,
});

afterEach(() => vi.unstubAllGlobals());

describe('시작화면 내용', () => {
  it('저장이 있으면 이어하기와 일차·거점, 새 공장을 보인다', () => {
    const html = startScreenHtml(state());
    expect(html).toContain('이어하기<small>3일차 · 거점 2곳</small>');
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
  const actions = { play: vi.fn(), newFactory: vi.fn(), together: vi.fn() };
  const screen = new StartScreen(el as unknown as HTMLElement, actions);
  screen.open(s);
  const click = (act: string) => listeners.get('el:click')!.forEach(fn => fn({ target: { closest: () => ({ dataset: { start: act } }) } }));
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

  it('저장이 있으면 새 공장은 한 번 더 눌러야 바꾼다', () => {
    const f = fixture();
    f.click('new');
    expect(f.actions.newFactory).not.toHaveBeenCalled();
    expect(f.el.innerHTML).toContain('한 번 더 누르면 새 공장');
    f.click('new');
    expect(f.actions.newFactory).toHaveBeenCalledOnce(); expect(f.el.hidden).toBe(true);
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
