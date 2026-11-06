import { reducedEffects } from '../render/effects';

/**
 * UI 움직임 중 CSS만으로 안 되는 것 (style.css의 "UI 움직임"과 짝).
 * - 창이 열리는 순간에만 ui-opening을 붙인다 (내용을 자주 다시 그리는 창이 그때마다 튀지 않게)
 * - 창이 닫히면 같은 모양의 잔상을 잠깐 띄워 사라지게 한다. 진짜 창은 바로 닫힌 상태라
 *   단축키·Esc·닫힘 판정은 그대로다 (잔상은 modal·popover 클래스를 떼서 그런 판정에 걸리지 않는다)
 * - 진행 막대를 다시 그려도 이전 폭에서 새 폭으로 이어지게 한다
 */

/** 열리고 닫히는 것을 지켜볼 창: 큰 창·시작화면(.modal), 위쪽 팝업(.popover), 오른쪽 정보창 */
const WATCH = '.modal, .popover, #info';
const OPENING_MS = 200;
const GHOST_MS = 160;

export function setupUiMotion(root: ParentNode = document): void {
  const observer = new MutationObserver((records) => {
    for (const r of records) {
      const el = r.target as HTMLElement;
      const wasHidden = r.oldValue !== null;
      const hidden = el.hasAttribute('hidden');
      if (wasHidden && !hidden) opened(el);
      else if (!wasHidden && hidden) closed(el);
    }
  });
  for (const el of root.querySelectorAll<HTMLElement>(WATCH)) {
    observer.observe(el, { attributes: true, attributeFilter: ['hidden'], attributeOldValue: true });
  }
}

function opened(el: HTMLElement): void {
  if (!el.classList.contains('modal')) return;
  el.classList.add('ui-opening');
  window.setTimeout(() => el.classList.remove('ui-opening'), OPENING_MS);
}

/** 닫힌 창 자리에 잔상을 띄웠다 지운다 */
function closed(el: HTMLElement): void {
  el.classList.remove('ui-opening');
  if (reducedEffects() || !el.parentNode) return;
  const ghost = el.cloneNode(true) as HTMLElement;
  ghost.removeAttribute('hidden');
  ghost.setAttribute('aria-hidden', 'true');
  ghost.inert = true;
  // 모양은 같게, 판정(.modal:not([hidden]) 등)에는 안 걸리게
  if (!ghost.classList.replace('modal', 'modal-like')) ghost.classList.replace('popover', 'popover-like');
  ghost.classList.add('ui-ghost');
  // 같은 id라도 원래 창이 문서 앞에 있도록 바로 뒤에 둔다 (getElementById는 앞의 것을 준다)
  el.after(ghost);
  window.setTimeout(() => ghost.remove(), GHOST_MS);
}

/** 진행 막대 폭: data-bar 이름 → 마지막 폭 */
const lastWidth = new Map<string, string>();

/**
 * 막 다시 그린 영역의 진행 막대([data-bar="이름"])를 이전 폭에서 새 폭으로 옮긴다 (CSS transition이 끊어서 움직인다).
 * 처음 보는 막대는 그대로 둔다
 */
export function tweenBars(container: ParentNode): void {
  for (const bar of container.querySelectorAll<HTMLElement>('[data-bar]')) {
    const key = bar.dataset.bar!;
    const target = bar.style.width;
    const prev = lastWidth.get(key);
    lastWidth.set(key, target);
    if (!prev || prev === target || reducedEffects()) continue;
    bar.style.transition = 'none';
    bar.style.width = prev;
    void bar.offsetWidth; // 이전 폭을 한 번 그린 것으로 확정한 뒤 새 폭으로
    bar.style.transition = '';
    bar.style.width = target;
  }
}

/**
 * 숫자가 바뀌면 잠깐 'up'(늘면)·'down'(줄면) 표시. 계속 들어오는 품목이 내내 깜빡이지 않게
 * 한 번 표시하면 FLASH_MS 동안 보이고, REARM_MS가 지나야 다시 표시한다.
 * 보는 대상(owner, 예: 공장)이 바뀌면(불러오기·방 들어가기) 그때 값을 처음 값으로 삼고 표시하지 않는다
 */
export class ChangeFlash<K> {
  static readonly FLASH_MS = 500;
  static readonly REARM_MS = 2000;
  private seen = new Map<K, { n: number; dir: 'up' | 'down'; until: number; next: number }>();
  private owner: unknown = undefined;

  mark(owner: unknown, values: [K, number][], now: number, enabled: boolean): Map<K, 'up' | 'down'> {
    if (owner !== this.owner) {
      this.owner = owner;
      this.seen.clear();
    }
    const out = new Map<K, 'up' | 'down'>();
    for (const [key, n] of values) {
      const s = this.seen.get(key);
      if (!s) {
        this.seen.set(key, { n, dir: 'up', until: 0, next: 0 });
        continue;
      }
      if (n !== s.n && now >= s.next && enabled) {
        s.dir = n > s.n ? 'up' : 'down';
        s.until = now + ChangeFlash.FLASH_MS;
        s.next = now + ChangeFlash.REARM_MS;
      }
      s.n = n;
      if (enabled && now < s.until) out.set(key, s.dir);
    }
    return out;
  }
}
