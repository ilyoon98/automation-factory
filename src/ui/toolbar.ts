import { BUILDINGS, CATEGORIES, type BuildingType, type Category } from '../data/buildings';
import type { Input } from '../input/input';
import type { World } from '../sim/world';
import { buildingIconUrl, itemIcon } from './icons';

const categoryOf = (type: BuildingType): Category | null =>
  CATEGORIES.find((c) => c.items.includes(type))?.id ?? null;

/**
 * 하단 툴바: 카테고리 탭 + 그 탭의 건물 목록.
 * - Z X C V B 또는 Tab / Shift+Tab 으로 탭을 바꾸고, 숫자 1~9로 그 탭의 N번째 건물을 고른다.
 * - 다른 방법(Q로 집기 등)으로 다른 탭의 건물을 들면 그 탭으로 넘어간다.
 */
export class Toolbar {
  private category: Category = 'logistics';
  private buttons = new Map<BuildingType, HTMLButtonElement>();
  private lastTool: BuildingType | null = null;

  constructor(private input: Input) {
    this.buildTabs();
    this.setupScrollbar();
    this.renderPalette();

    // 툴바 높이에 맞춰 위쪽 안내·토스트 위치를 옮긴다
    const bottom = document.getElementById('bottom')!;
    new ResizeObserver(() => {
      document.documentElement.style.setProperty('--bottom-h', `${bottom.offsetHeight}px`);
    }).observe(bottom);
  }

  /**
   * 브라우저 기본 가로 스크롤바 대신 쓰는 얇은 막대.
   * 휠로도 가로로 넘기고, 넘칠 때만 보이며, 가려진 쪽 가장자리는 흐리게 한다.
   */
  private setupScrollbar(): void {
    const palette = document.getElementById('palette')!;
    const bar = document.getElementById('palette-bar')!;
    const thumb = bar.querySelector<HTMLElement>('.thumb')!;
    const overflow = () => palette.scrollWidth - palette.clientWidth;

    const sync = () => {
      const max = overflow();
      bar.hidden = max <= 1;
      palette.classList.toggle('fade-left', palette.scrollLeft > 1);
      palette.classList.toggle('fade-right', palette.scrollLeft < max - 1);
      if (bar.hidden) return;
      const w = Math.max(30, (bar.clientWidth * palette.clientWidth) / palette.scrollWidth);
      thumb.style.width = `${w}px`;
      thumb.style.left = `${(palette.scrollLeft / max) * (bar.clientWidth - w)}px`;
    };
    this.syncScrollbar = sync;
    palette.addEventListener('scroll', sync);
    new ResizeObserver(sync).observe(palette);

    // 세로 휠을 가로 이동으로
    palette.addEventListener(
      'wheel',
      (e) => {
        if (overflow() <= 1 || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
        e.preventDefault();
        palette.scrollLeft += e.deltaY;
      },
      { passive: false },
    );

    // 막대 끌기
    thumb.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      thumb.setPointerCapture(e.pointerId);
      thumb.classList.add('drag');
      const startX = e.clientX;
      const startLeft = palette.scrollLeft;
      const ratio = overflow() / Math.max(1, bar.clientWidth - thumb.offsetWidth);
      const move = (ev: PointerEvent) => (palette.scrollLeft = startLeft + (ev.clientX - startX) * ratio);
      const up = () => {
        thumb.classList.remove('drag');
        thumb.removeEventListener('pointermove', move);
        thumb.removeEventListener('pointerup', up);
      };
      thumb.addEventListener('pointermove', move);
      thumb.addEventListener('pointerup', up);
    });

    // 막대 빈 곳을 누르면 그 위치로
    bar.addEventListener('pointerdown', (e) => {
      if (e.target === thumb) return;
      const r = bar.getBoundingClientRect();
      const t = (e.clientX - r.left - thumb.offsetWidth / 2) / Math.max(1, r.width - thumb.offsetWidth);
      palette.scrollLeft = Math.min(1, Math.max(0, t)) * overflow();
    });
  }

  private syncScrollbar: () => void = () => {};

  /** 지금 탭의 i번째(0부터) 건물 */
  slot(i: number): BuildingType | null {
    return CATEGORIES.find((c) => c.id === this.category)?.items[i] ?? null;
  }

  /** 탭 단축키(z, x, c, v, b)면 그 탭으로 바꾸고 true */
  selectByKey(key: string): boolean {
    const c = CATEGORIES.find((cat) => cat.key === key);
    if (!c) return false;
    this.setCategory(c.id);
    return true;
  }

  /** Tab / Shift+Tab */
  cycle(delta: number): void {
    const i = CATEGORIES.findIndex((c) => c.id === this.category);
    this.setCategory(CATEGORIES[(i + delta + CATEGORIES.length) % CATEGORIES.length].id);
  }

  update(w: World): void {
    const tool = this.input.tool;
    // 다른 탭의 건물을 들게 되면 그 탭을 보여 준다
    if (tool !== this.lastTool) {
      this.lastTool = tool;
      const cat = tool ? categoryOf(tool) : null;
      if (cat && cat !== this.category) this.setCategory(cat);
    }
    for (const [type, btn] of this.buttons) {
      const locked = !w.unlockedBuildings.has(type);
      btn.classList.toggle('locked', locked);
      btn.classList.toggle('poor', !locked && !w.canAfford(BUILDINGS[type].cost));
      btn.classList.toggle('active', tool === type);
    }
  }

  private setCategory(id: Category): void {
    if (this.category === id) return;
    this.category = id;
    this.renderPalette();
  }

  private buildTabs(): void {
    const tabs = document.getElementById('tabs')!;
    for (const c of CATEGORIES) {
      const btn = document.createElement('button');
      btn.className = 'tab';
      btn.dataset.cat = c.id;
      btn.innerHTML = `${c.name} <kbd>${c.key.toUpperCase()}</kbd>`;
      btn.addEventListener('click', () => this.setCategory(c.id));
      tabs.appendChild(btn);
    }
    const hint = document.createElement('span');
    hint.className = 'hint';
    const keys = CATEGORIES.map((c) => `<kbd>${c.key.toUpperCase()}</kbd>`).join('');
    hint.innerHTML = `${keys} 또는 <kbd>Tab</kbd>: 탭 바꾸기 · <kbd>1</kbd>~<kbd>9</kbd>: 건물 고르기 · 우클릭: 도감`;
    tabs.appendChild(hint);
  }

  private renderPalette(): void {
    document.querySelectorAll<HTMLElement>('#tabs .tab').forEach((t) => {
      t.classList.toggle('active', t.dataset.cat === this.category);
    });
    const palette = document.getElementById('palette')!;
    palette.innerHTML = '';
    this.buttons.clear();
    const items = CATEGORIES.find((c) => c.id === this.category)?.items ?? [];
    items.forEach((type, i) => {
      const def = BUILDINGS[type];
      const btn = document.createElement('button');
      btn.className = 'pal';
      btn.dataset.codexBuilding = type; // 우클릭: 도감
      btn.innerHTML = `
        <span class="key">${i + 1}</span>
        <img src="${buildingIconUrl(type)}" alt="">
        <span class="name">${def.name}</span>
        <span class="cost">${def.cost.map((c) => `${itemIcon(c.item)}${c.count}`).join(' ')}</span>
        <span class="lock">🔒</span>`;
      btn.title = `${def.name}\n${def.description}${def.power ? `\n전력 ${def.power}kW` : ''}\n우클릭: 도감`;
      btn.addEventListener('click', () => this.input.setTool(type));
      palette.appendChild(btn);
      this.buttons.set(type, btn);
    });
    palette.scrollLeft = 0;
    this.syncScrollbar();
  }
}
