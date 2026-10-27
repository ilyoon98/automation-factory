import { onUiZoom, uiZoom } from './crisp';

/**
 * 위쪽 바의 줄 배치와 팝오버 (docs/상단-UI-배치-앵커-상세기획.md).
 * - 기능 묶음(index.html의 .tb-group)을 화면 논리 폭 W에 맞춰 줄의 왼쪽·오른쪽으로 옮긴다:
 *   W ≥ 900 두 줄, 640 ≤ W < 900 세 줄, 그보다 좁으면 여섯 줄. DOM 순서 = 읽는 순서라 Tab 이동도 화면 순서를 따른다.
 * - 위쪽 바의 실제 높이를 --top-h에 넣는다 (아래 툴바의 --bottom-h와 같은 UI 논리 픽셀). 판·창·팝오버는 이 값 아래에서 연다.
 * - 팝오버는 한 번에 하나: 바깥 클릭·Esc로 닫고, 닫으면 연 버튼에 초점을 돌린다.
 */

/** 줄 하나: [왼쪽 묶음들, 오른쪽 묶음들]. '|'는 묶음 사이 세로 구분선 */
type Row = [string[], string[]];

const WIDE: Row[] = [
  [['g-time', 'g-speed', '|', 'g-edit'], ['g-save', 'g-net', 'g-chat', 'g-menu']],
  [['g-windows'], ['g-map', '|', 'layers', 'g-rates']],
];
const MID: Row[] = [
  [['g-time', 'g-speed'], ['g-save', 'g-net', 'g-chat', 'g-menu']],
  [['g-edit'], ['g-windows']],
  [['g-map', '|', 'layers', 'g-rates'], []],
];
const NARROW: Row[] = [
  [['g-time'], ['g-save', 'g-menu']],
  [['g-speed'], ['g-net']],
  [['g-edit'], ['g-chat']],
  [['g-windows'], []],
  [['g-map'], ['g-rates']],
  [['layers'], []],
];

/** 화면 가장자리·위쪽 바와 띄우는 거리 (UI 논리 px) */
const EDGE = 8;

export type TopLayout = 'wide' | 'mid' | 'narrow';

interface Pop {
  panel: HTMLElement;
  trigger: HTMLElement;
  align: 'left' | 'right';
  onOpen?: () => void;
}

export class Topbar {
  private bar = document.getElementById('topbar')!;
  private layout: TopLayout | null = null;
  /** 지도 레이어 묶음이 보이는지 (보이지 않으면 그 앞 구분선·빈 줄도 뺀다) */
  private layersShown = false;
  private pops = new Map<string, Pop>();
  private openId: string | null = null;

  constructor() {
    // 바 크기가 바뀌면 (창 폭·글자·접속 상태) 줄 배치를 다시 보고 실제 높이를 알린다.
    // 폭이 같으면 줄은 그대로라 높이만 바뀌어 다시 불려도 멈춘다
    new ResizeObserver(() => {
      this.relayout();
      document.documentElement.style.setProperty('--top-h', `${this.bar.offsetHeight}px`);
    }).observe(this.bar);
    window.addEventListener('resize', () => this.relayout());
    onUiZoom(() => this.relayout());
    this.relayout();

    // 바깥을 누르면 닫는다 (팝오버 안·연 버튼은 빼고. 버튼은 스스로 열고 닫는다)
    window.addEventListener(
      'pointerdown',
      (e) => {
        if (!this.openId) return;
        const p = this.pops.get(this.openId)!;
        const t = e.target as Node;
        if (!p.panel.contains(t) && !p.trigger.contains(t)) this.close(false);
      },
      true,
    );
  }

  /** 화면 논리 폭 (UI 배율로 나눈 값) */
  get width(): number {
    return window.innerWidth / uiZoom();
  }

  get mode(): TopLayout {
    return this.layout ?? 'wide';
  }

  /** 레이어 묶음 표시가 바뀌면 줄을 다시 짠다 (기본 지도엔 레이어가 없다) */
  setLayersShown(shown: boolean): void {
    if (shown === this.layersShown) return;
    this.layersShown = shown;
    this.layout = null;
    this.relayout();
  }

  private relayout(): void {
    const w = this.width;
    const mode: TopLayout = w >= 900 ? 'wide' : w >= 640 ? 'mid' : 'narrow';
    document.body.dataset.top = mode;
    if (mode !== this.layout) {
      this.layout = mode;
      this.build(mode === 'wide' ? WIDE : mode === 'mid' ? MID : NARROW);
    }
    this.place();
  }

  private build(rows: Row[]): void {
    const groups = new Map<string, HTMLElement>();
    this.bar.querySelectorAll<HTMLElement>('.tb-group').forEach((g) => groups.set(g.id, g));
    const focused = document.activeElement;
    const side = (ids: string[], cls: string) => {
      const el = document.createElement('div');
      el.className = `tb-side ${cls}`;
      ids.forEach((id, i) => {
        if (id === '|') {
          // 구분선은 양쪽에 보이는 묶음이 있을 때만
          const next = ids[i + 1];
          if (next === 'layers' && !this.layersShown) return;
          const sep = document.createElement('i');
          sep.className = 'tb-sep';
          el.append(sep);
        } else el.append(groups.get(id)!);
      });
      return el;
    };
    const made = rows
      .filter(([l, r]) => [...l, ...r].some((id) => id !== '|' && (id !== 'layers' || this.layersShown)))
      .map(([l, r]) => {
        const row = document.createElement('div');
        row.className = 'tb-row';
        row.append(side(l, 'left'));
        if (r.length) row.append(side(r, 'right'));
        return row;
      });
    // 숨은 묶음(레이어)도 DOM에는 남겨 둔다
    const rest = [...groups.values()].filter((g) => !made.some((row) => row.contains(g)));
    this.bar.replaceChildren(...made, ...rest);
    if (focused instanceof HTMLElement && this.bar.contains(focused)) focused.focus();
  }

  // ───────────── 팝오버 ─────────────

  /** 위쪽 버튼으로 여는 팝오버를 등록한다. align: 버튼 왼쪽에 맞출지(시간) 오른쪽에 맞출지(메뉴·함께 하기·채팅) */
  register(id: string, panel: HTMLElement, trigger: HTMLElement, align: 'left' | 'right', onOpen?: () => void): void {
    this.pops.set(id, { panel, trigger, align, onOpen });
  }

  isOpen(id: string): boolean {
    return this.openId === id;
  }

  toggle(id: string): void {
    if (this.openId === id) this.close(true);
    else this.open(id);
  }

  open(id: string): void {
    if (this.openId && this.openId !== id) this.close(false);
    const p = this.pops.get(id)!;
    this.openId = id;
    p.panel.hidden = false;
    p.trigger.classList.add('active');
    p.trigger.setAttribute('aria-expanded', 'true');
    p.onOpen?.();
    this.place();
  }

  /** 열린 팝오버를 닫는다. focus: 연 버튼에 초점을 돌릴지 (Esc·X로 닫을 때) */
  close(focus: boolean): boolean {
    if (!this.openId) return false;
    const p = this.pops.get(this.openId)!;
    this.openId = null;
    p.panel.hidden = true;
    p.trigger.classList.remove('active');
    p.trigger.setAttribute('aria-expanded', 'false');
    if (focus) p.trigger.focus();
    return true;
  }

  /** 열린 팝오버를 연 버튼 아래(위쪽 바 전체 아래)에, 화면 양 끝 8px 안으로 */
  place(): void {
    if (!this.openId) return;
    const p = this.pops.get(this.openId)!;
    const s = uiZoom();
    // 버튼 위치는 화면 픽셀이라 UI 배율로 나눠 논리 좌표로
    const r = p.trigger.getBoundingClientRect();
    const pw = p.panel.offsetWidth;
    const want = p.align === 'right' ? r.right / s - pw : r.left / s;
    const x = Math.max(EDGE, Math.min(want, this.width - pw - EDGE));
    p.panel.style.left = `${x}px`;
  }
}

/** 화면에 위쪽 바는 하나 (채팅·UI가 같이 쓴다) */
export const topbar = new Topbar();
