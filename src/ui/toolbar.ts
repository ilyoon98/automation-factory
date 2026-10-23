import { BUILDINGS, CATEGORIES, type BuildingType, type Category } from '../data/buildings';
import type { Input } from '../input/input';
import type { World } from '../sim/world';
import type { Blueprint } from '../sim/blueprint';
import {
  blueprintCode,
  blueprintPreview,
  blueprintTabIcon,
  blueprints,
  parseBlueprintCode,
  removeBlueprint,
  saveBlueprint,
  uniqueBlueprintName,
} from './blueprints';
import { copyText } from './clipboard';
import { buildingIconUrl, itemIcon, truckIconUrl } from './icons';

/** 건물 탭들 + 맨 끝 청사진 탭 (K) */
type Tab = Category | 'blueprints';
const BP_KEY = 'k';

/** 탭마다 대표 그림 (운송은 트럭) */
const TAB_ICON: Record<Category, () => string> = {
  logistics: () => buildingIconUrl('belt'),
  production: () => buildingIconUrl('miner'),
  power: () => buildingIconUrl('generator'),
  storage: () => buildingIconUrl('storage'),
  transport: truckIconUrl,
  forest: () => buildingIconUrl('lumberjack'),
};

const categoryOf = (type: BuildingType): Category | null =>
  CATEGORIES.find((c) => c.items.includes(type))?.id ?? null;

/**
 * 하단 툴바: 카테고리 탭 + 그 탭의 건물 목록.
 * - Z X C V B 또는 Tab / Shift+Tab 으로 탭을 바꾸고, 숫자 1~9로 그 탭의 N번째 건물을 고른다.
 * - 다른 방법(Q로 집기 등)으로 다른 탭의 건물을 들면 그 탭으로 넘어간다.
 */
export class Toolbar {
  private category: Tab = 'logistics';
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
      // 마우스는 화면 픽셀, 스크롤은 UI 픽셀이라 (글자 또렷하게로 UI 배율이 1이 아닐 수 있음) 화면에 보이는 너비로 나눈다
      const ratio = overflow() / Math.max(1, bar.getBoundingClientRect().width - thumb.getBoundingClientRect().width);
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
      const tw = thumb.getBoundingClientRect().width;
      const t = (e.clientX - r.left - tw / 2) / Math.max(1, r.width - tw);
      palette.scrollLeft = Math.min(1, Math.max(0, t)) * overflow();
    });
  }

  private syncScrollbar: () => void = () => {};

  /** 지금 탭의 i번째(0부터) 건물. 청사진 탭이면 i번째 청사진을 들고 null */
  slot(i: number): BuildingType | null {
    if (this.category === 'blueprints') {
      const s = blueprints()[i];
      if (s) this.input.startPaste(s.bp, s.name);
      return null;
    }
    return CATEGORIES.find((c) => c.id === this.category)?.items[i] ?? null;
  }

  /** 청사진을 저장·삭제했으면 목록을 다시 그린다 */
  refreshBlueprints(): void {
    if (this.category === 'blueprints') this.renderPalette();
  }

  /** 탭 단축키(z, x, c, v, b, n, k)면 그 탭으로 바꾸고 true */
  selectByKey(key: string): boolean {
    if (key === BP_KEY) {
      this.setCategory('blueprints');
      return true;
    }
    const c = CATEGORIES.find((cat) => cat.key === key);
    if (!c) return false;
    this.setCategory(c.id);
    return true;
  }

  /** Tab / Shift+Tab */
  cycle(delta: number): void {
    const tabs: Tab[] = [...CATEGORIES.map((c) => c.id), 'blueprints'];
    const i = tabs.indexOf(this.category);
    this.setCategory(tabs[(i + delta + tabs.length) % tabs.length]);
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

  /**
   * 목표가 가리키는 건물을 반짝인다: 다른 탭이면 그 탭을, 지금 탭이면 그 버튼을.
   * 이미 들고 있으면 반짝이지 않는다
   */
  setGuide(type: BuildingType | null): void {
    const want = type && this.input.tool !== type ? type : null;
    const cat = want ? categoryOf(want) : null;
    document.querySelectorAll<HTMLElement>('#tabs .tab').forEach((t) => {
      t.classList.toggle('guide-pulse', !!cat && cat !== this.category && t.dataset.cat === cat);
    });
    for (const [t, btn] of this.buttons) btn.classList.toggle('guide-pulse', t === want && cat === this.category);
  }

  private setCategory(id: Tab): void {
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
      btn.innerHTML = `<img class="ticon" src="${TAB_ICON[c.id]()}" alt="">${c.name} <kbd>${c.key.toUpperCase()}</kbd>`;
      btn.addEventListener('click', () => this.setCategory(c.id));
      tabs.appendChild(btn);
    }
    const bp = document.createElement('button');
    bp.className = 'tab';
    bp.dataset.cat = 'blueprints';
    bp.title = 'Ctrl + 드래그로 복사한 공장 묶음을 저장해 두고 다시 꺼내 써요';
    bp.innerHTML = `<img class="ticon" src="${blueprintTabIcon()}" alt="">청사진 <kbd>${BP_KEY.toUpperCase()}</kbd>`;
    bp.addEventListener('click', () => this.setCategory('blueprints'));
    tabs.appendChild(bp);
    const hint = document.createElement('span');
    hint.className = 'hint';
    const keys = [...CATEGORIES.map((c) => c.key), BP_KEY].map((k) => `<kbd>${k.toUpperCase()}</kbd>`).join('');
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
    if (this.category === 'blueprints') {
      this.renderBlueprints(palette);
      return;
    }
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

  /** 청사진 탭: 저장한 청사진들 (누르면 붙여넣기, 📋 코드 복사, ✕ 지우기)과 맨 끝에 공유 코드 붙여넣는 칸 */
  private renderBlueprints(palette: HTMLElement): void {
    const list = blueprints();
    if (!list.length) {
      palette.innerHTML = `<p class="pal-empty">저장한 청사진이 없어요. <kbd>Ctrl</kbd> + 드래그로 공장 묶음을 복사한 뒤, 오른쪽 창에서 💾 저장하면 여기에 모여요.</p>`;
    }
    list.forEach((s, i) => {
      const n = s.bp.entries.length;
      const btn = document.createElement('button');
      btn.className = 'pal';
      btn.innerHTML = `
        ${i < 9 ? `<span class="key">${i + 1}</span>` : ''}
        <img src="${blueprintPreview(s.bp)}" alt="">
        <span class="name">${escapeHtml(s.name)}</span>
        <span class="cost">건물 ${n}개 · ${s.bp.w}×${s.bp.h}</span>
        <span class="share" title="공유 코드 복사 (친구에게 보내기)">📋</span>
        <span class="del" title="이 청사진 지우기">✕</span>`;
      btn.title = `${s.name}\n건물 ${n}개 · ${s.bp.w}×${s.bp.h}칸\n클릭: 붙여넣기 · 📋: 공유 코드 복사 · ✕(또는 우클릭) 두 번: 지우기`;
      // 확인 창(confirm)은 앱 안 브라우저 등에서 뜨지 않을 수 있어서, ✕를 두 번 누르면 지운다
      const del = btn.querySelector<HTMLElement>('.del')!;
      let armed = 0;
      const remove = () => {
        if (!armed) {
          del.textContent = '지우기?';
          btn.classList.add('confirm-del');
          armed = window.setTimeout(() => {
            armed = 0;
            del.textContent = '✕';
            btn.classList.remove('confirm-del');
          }, 3000);
          return;
        }
        clearTimeout(armed);
        removeBlueprint(i);
        this.renderPalette();
        this.input.notify(`청사진 '${s.name}'을 지웠어요`);
      };
      btn.addEventListener('click', (e) => {
        const t = e.target as HTMLElement;
        if (t.closest('.del')) remove();
        else if (t.closest('.share')) void this.shareCode(s.name, s.bp);
        else this.input.startPaste(s.bp, s.name);
      });
      btn.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        remove();
      });
      palette.appendChild(btn);
    });
    // 친구가 보낸 공유 코드 붙여넣기
    const box = document.createElement('div');
    box.className = 'pal pal-import';
    box.innerHTML = `<span class="name">📥 받은 코드 넣기</span>
      <input data-act="bp-code" placeholder="AF1.… 공유 코드를 붙여넣기 (Ctrl+V)">
      <button data-act="bp-import">가져오기</button>`;
    const field = box.querySelector<HTMLInputElement>('input')!;
    const go = () => void this.importCode(field.value);
    box.querySelector('button')!.addEventListener('click', go);
    field.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') go();
    });
    palette.appendChild(box);
    palette.scrollLeft = 0;
    this.syncScrollbar();
  }

  /** 공유 코드를 클립보드에 */
  private async shareCode(name: string, bp: Blueprint): Promise<void> {
    const code = await blueprintCode(name, bp);
    const ok = await copyText(code);
    this.input.notify(ok ? `'${name}' 공유 코드를 복사했어요 — 메신저에 붙여넣어 보내세요` : '복사하지 못했어요');
  }

  /** 받은 공유 코드를 청사진으로 저장하고 바로 들기 */
  private async importCode(code: string): Promise<void> {
    if (!code.trim()) return;
    const got = await parseBlueprintCode(code);
    if (!got) {
      this.input.notify('공유 코드가 아니거나 잘렸어요. "AF1."로 시작하는 줄 전체를 붙여넣어 주세요');
      return;
    }
    const name = uniqueBlueprintName(got.name);
    saveBlueprint(name, got.bp);
    this.renderPalette();
    this.input.startPaste(blueprints().find((s) => s.name === name)!.bp, name);
    this.input.notify(`청사진 '${name}'을 받았어요 (건물 ${got.bp.entries.length}개) — 클릭해서 붙여넣기`);
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}
