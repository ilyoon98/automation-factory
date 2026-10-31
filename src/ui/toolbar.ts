import { BUILDINGS, CATEGORIES, categoryItems, type BuildingType, type Category } from '../data/buildings';
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
import { ITEMS } from '../data/items';
import { buildingIconUrl, itemIcon, lockIcon, techIcon, truckIconUrl } from './icons';

/** 건물 탭들 + 맨 끝 청사진 탭 (K) */
type Tab = Category | 'blueprints';
const BP_KEY = 'k';

/** 탭마다 대표 그림 (운송은 트럭) */
const TAB_ICON: Record<Category, () => string> = {
  logistics: () => buildingIconUrl('belt'),
  production: () => buildingIconUrl('miner'),
  generation: () => buildingIconUrl('wind'),
  power: () => buildingIconUrl('pole'),
  storage: () => buildingIconUrl('storage'),
  transport: truckIconUrl,
  forest: () => buildingIconUrl('lumberjack'),
  industry: () => buildingIconUrl('large-assembler'),
};

const categoryOf = (type: BuildingType): Category | null =>
  CATEGORIES.find((c) => c.items.includes(type))?.id ?? null;

/**
 * 하단 툴바: 카테고리 탭 + 그 탭의 건물 목록.
 * - 탭에 적힌 키 또는 Tab / Shift+Tab 으로 탭을 바꾸고, 숫자 1~9로 그 탭의 N번째 건물을 고른다.
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
    const nav = document.getElementById('palette-nav')!;
    const bar = document.getElementById('palette-bar')!;
    const thumb = bar.querySelector<HTMLElement>('.thumb')!;
    const range = nav.querySelector<HTMLElement>('.range')!;
    const prev = nav.querySelector<HTMLButtonElement>('.prev')!;
    const next = nav.querySelector<HTMLButtonElement>('.next')!;
    const overflow = () => palette.scrollWidth - palette.clientWidth;

    const sync = () => {
      const max = overflow();
      nav.hidden = max <= 1;
      palette.classList.toggle('fade-left', palette.scrollLeft > 1);
      palette.classList.toggle('fade-right', palette.scrollLeft < max - 1);
      if (nav.hidden) return;
      const w = Math.max(30, (bar.clientWidth * palette.clientWidth) / palette.scrollWidth);
      thumb.style.width = `${w}px`;
      thumb.style.left = `${(palette.scrollLeft / max) * (bar.clientWidth - w)}px`;
      // 지금 반 이상 보이는 카드 범위 (번호는 원래 목록 순서 그대로)
      const cards = [...palette.children] as HTMLElement[];
      const left = palette.scrollLeft;
      const right = left + palette.clientWidth;
      const seen = cards.map((c, i) => [i, Math.min(right, c.offsetLeft + c.offsetWidth) - Math.max(left, c.offsetLeft) >= c.offsetWidth / 2] as const).filter(([, v]) => v);
      range.textContent = seen.length ? `${seen[0][0] + 1}–${seen.at(-1)![0] + 1} / ${cards.length}` : '';
      prev.disabled = left <= 1;
      next.disabled = left >= max - 1;
    };
    const page = (dir: number) => palette.scrollBy({ left: dir * palette.clientWidth * 0.8, behavior: 'smooth' });
    prev.addEventListener('click', () => page(-1));
    next.addEventListener('click', () => page(1));
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
  /** 잠긴 건물 카드를 눌렀을 때 (ui.ts가 연구 창을 그 연구로 연다) */
  onLockedClick: ((type: BuildingType) => void) | null = null;
  /** 지금 세계가 regional-v1인지 (전력·산업 탭과 확장 설비를 보일지) */
  private regional = false;

  /** 지금 탭의 i번째(0부터) 건물. 청사진 탭이면 i번째 청사진을 들고 null */
  slot(i: number): BuildingType | null {
    if (this.category === 'blueprints') {
      const s = blueprints()[i];
      if (s) this.input.startPaste(s.bp, s.name);
      return null;
    }
    const type = categoryItems(this.category, this.regional)[i] ?? null;
    if (type) this.reveal(type);
    return type;
  }

  /** 청사진을 저장·삭제했으면 목록을 다시 그린다 */
  refreshBlueprints(): void {
    if (this.category === 'blueprints') this.renderPalette();
  }

  /** 표시 중인 탭의 단축키면 그 탭으로 바꾸고 true */
  selectByKey(key: string): boolean {
    if (key === BP_KEY) {
      this.setCategory('blueprints');
      return true;
    }
    const c = CATEGORIES.find((cat) => cat.key === key);
    if (!c || !categoryItems(c.id, this.regional).length) return false;
    this.setCategory(c.id);
    return true;
  }

  /** Tab / Shift+Tab */
  cycle(delta: number): void {
    const tabs: Tab[] = [...CATEGORIES.map((c) => c.id).filter((id) => categoryItems(id, this.regional).length), 'blueprints'];
    const i = tabs.indexOf(this.category);
    this.setCategory(tabs[(i + delta + tabs.length) % tabs.length]);
  }

  update(w: World): void {
    this.world = w;
    // 세계를 바꾸면 발전의 연료·지열 등 확장 전용 카드도 다시 걸러 낸다.
    if (this.regional !== w.regional) {
      this.regional = w.regional;
      this.renderPalette();
    }
    for (const { id } of CATEGORIES) {
      const tab = document.querySelector<HTMLElement>(`#tabs .tab[data-cat="${id}"]`);
      if (tab) tab.hidden = !categoryItems(id, w.regional).length;
    }
    if (this.category !== 'blueprints' && !categoryItems(this.category, w.regional).length) this.setCategory('production');
    const tool = this.input.tool;
    // 다른 탭의 건물을 들게 되면 그 탭을 보여 준다
    if (tool !== this.lastTool) {
      this.lastTool = tool;
      const cat = tool ? categoryOf(tool) : null;
      if (cat && cat !== this.category) this.setCategory(cat);
      if (tool) this.reveal(tool);
    }
    this.paintCards(w);
  }

  /** 고른 건물 카드가 가로 목록에서 잘려 있으면 다 보이게 넘긴다 (숫자 키·클릭 모두) */
  private reveal(type: BuildingType): void {
    const btn = this.buttons.get(type);
    const palette = document.getElementById('palette');
    if (!btn || !palette) return;
    const pad = 24; // 가장자리 흐림·넘기기 단추에 가리지 않게
    const left = btn.getBoundingClientRect().left - palette.getBoundingClientRect().left + palette.scrollLeft;
    const right = left + btn.offsetWidth;
    let to = palette.scrollLeft;
    if (left - pad < to) to = left - pad;
    else if (right + pad > to + palette.clientWidth) to = right + pad - palette.clientWidth;
    if (to !== palette.scrollLeft) palette.scrollTo({ left: Math.max(0, to), behavior: 'smooth' });
  }

  /** 마지막으로 본 공장 (탭을 바꿔 카드를 새로 그릴 때 상태 띠를 바로 채우려고) */
  private world: World | null = null;

  /** 카드마다 비용·상태 띠·선택 표시 */
  private paintCards(w: World): void {
    const tool = this.input.tool;
    const looking = this.input.blocked?.type ?? null;
    for (const [type, btn] of this.buttons) {
      const state = buildState(w, type);
      // 지금 지을 수 없으면 막힌 표시가 선택 표시보다 먼저 (금빛·체크는 실제로 들고 있고 지을 수 있을 때만)
      btn.classList.toggle('locked', state === 'locked');
      btn.classList.toggle('poor', state === 'poor');
      btn.classList.toggle('active', tool === type && state === 'ok');
      btn.classList.toggle('looking', looking === type);
      const cost = costHtml(w, type, state === 'poor');
      const el = btn.querySelector<HTMLElement>('.cost')!;
      if (el.innerHTML !== cost) el.innerHTML = cost;
      const band = STATE_BAND[state];
      const s = btn.querySelector<HTMLElement>('.state')!;
      if (s.dataset.band !== state) {
        s.dataset.band = state;
        s.innerHTML = band;
      }
      btn.setAttribute('aria-pressed', String(tool === type && state === 'ok'));
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
    // 탭 글자 옆에 단축키가 이미 있으니 Tab과 우클릭만
    hint.innerHTML = `<kbd>Tab</kbd>: 탭 바꾸기 · 우클릭: 도감`;
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
    const items = categoryItems(this.category, this.regional);
    items.forEach((type, i) => {
      const def = BUILDINGS[type];
      const btn = document.createElement('button');
      btn.className = 'pal';
      btn.dataset.codexBuilding = type; // 우클릭: 도감
      // 비용은 늘 보이게 (아이콘 + 개수). 상태 띠: 건설 가능 · 연구 잠김 · 재료 부족 (update에서 채운다)
      btn.innerHTML = `
        <span class="key">${i + 1}</span>
        <img src="${buildingIconUrl(type)}" alt="">
        <span class="name">${def.name}</span>
        <span class="cost"></span>
        <span class="state"></span>`;
      btn.title = `${def.name} · ${def.size}×${def.size}${def.power ? ` · 전력 ${def.power}kW` : ''}\n${def.description}\n비용: ${def.cost.map((c) => `${ITEMS[c.item].name} ${c.count}`).join(', ')}\n우클릭: 도감`;
      btn.addEventListener('click', () => {
        this.input.setTool(type);
        this.reveal(type);
        // 연구로 잠긴 건물을 누르면 그 건물을 여는 연구를 바로 보여 준다
        if (this.input.blocked?.type === type && this.input.blocked.why === 'locked') this.onLockedClick?.(type);
      });
      palette.appendChild(btn);
      this.buttons.set(type, btn);
    });
    if (this.world) this.paintCards(this.world);
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
        <span class="keep" title="지우지 않기">취소</span>
        <span class="del" title="이 청사진 지우기">✕</span>`;
      btn.title = `${s.name}\n건물 ${n}개 · ${s.bp.w}×${s.bp.h}칸\n클릭: 붙여넣기 · 📋: 공유 코드 복사 · ✕(또는 우클릭): 지우기`;
      // 확인 창(confirm)은 앱 안 브라우저 등에서 뜨지 않을 수 있어서, ✕를 누르면 이 버튼에서 "지우기 / 취소"를 묻는다.
      // 취소: "취소", 버튼의 다른 곳, 바깥 클릭, Esc, 5초 지나기
      const del = btn.querySelector<HTMLElement>('.del')!;
      let armed = false;
      let timer = 0;
      const outside = (e: PointerEvent) => {
        if (!btn.contains(e.target as Node)) disarm();
      };
      const esc = (e: KeyboardEvent) => {
        if (e.key === 'Escape') disarm();
      };
      const disarm = () => {
        if (!armed) return;
        armed = false;
        clearTimeout(timer);
        del.textContent = '✕';
        btn.classList.remove('confirm-del');
        window.removeEventListener('pointerdown', outside, true);
        window.removeEventListener('keydown', esc);
      };
      const remove = () => {
        if (!armed) {
          armed = true;
          del.textContent = '지우기';
          btn.classList.add('confirm-del');
          timer = window.setTimeout(disarm, 5000);
          window.addEventListener('pointerdown', outside, true);
          window.addEventListener('keydown', esc);
          return;
        }
        disarm();
        removeBlueprint(i);
        this.renderPalette();
        this.input.notify(`청사진 '${s.name}'을 지웠어요`);
      };
      btn.addEventListener('click', (e) => {
        const t = e.target as HTMLElement;
        if (t.closest('.del')) remove();
        else if (armed) disarm(); // 묻는 중에 다른 곳(취소 포함)을 누르면 취소만
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

export type BuildState = 'ok' | 'locked' | 'poor';

/** 툴바 카드 상태: 연구 잠김이 재료 부족보다 먼저. 재료는 허브 건설 재고 기준 (world.canAfford) */
export function buildState(w: World, type: BuildingType): BuildState {
  if (!w.unlockedBuildings.has(type)) return 'locked';
  return w.canAfford(BUILDINGS[type].cost) ? 'ok' : 'poor';
}

const STATE_BAND: Record<BuildState, string> = { ok: '✓ 건설 가능', locked: `${lockIcon()}연구 잠김`, poor: '⚠ 재료 부족' };

/** 비용 (아이콘 + 개수). 재료 부족이면 모자란 재료를 강조 */
function costHtml(w: World, type: BuildingType, poor: boolean): string {
  return BUILDINGS[type].cost
    .map((c) => {
      const short = poor && w.stockOf(c.item) < c.count;
      return `<span class="${short ? 'short' : ''}">${itemIcon(c.item)}${c.count}</span>`;
    })
    .join(' ');
}

/** 막힌 이유 한 줄: 잠김이면 해금하는 연구, 재료 부족이면 재료마다 보유/필요(부족) */
export function blockReason(w: World, type: BuildingType, why: 'locked' | 'poor'): string {
  if (why === 'locked') {
    const t = w.techs.find((tc) => tc.unlockBuildings?.includes(type));
    return t ? `필요한 연구: ${techIcon(t)}${t.name}` : '연구로 해금해야 해요';
  }
  return BUILDINGS[type].cost
    .filter((c) => w.stockOf(c.item) < c.count)
    .map((c) => {
      const have = Math.floor(w.stockOf(c.item));
      return `${itemIcon(c.item)}${ITEMS[c.item].name} ${have}/${c.count} <b class="bad">(${c.count - have} 부족)</b>`;
    })
    .join(' · ');
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}
