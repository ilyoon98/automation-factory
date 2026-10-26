import { BUILDINGS, isBeltType, type BuildingType } from '../data/buildings';
import type { Camera } from '../render/camera';
import type { ViewState } from '../render/renderer';
import { copyArea, type Blueprint } from '../sim/blueprint';
import type { Exec, PlaceResult } from '../sim/commands';
import { dirOf, rotateCW, type Dir } from '../sim/dir';
import { World, describeEdit } from '../sim/world';

export interface InputCallbacks {
  getWorld(): World;
  /** 월드를 바꾸는 건 전부 명령으로 (같이 하기에서 모두에게 똑같이 적용되도록) */
  exec: Exec;
  /** 배치 실패 등 짧은 안내 */
  toast(msg: string): void;
  togglePause(): void;
  /** 선택/도구가 바뀌어 UI를 다시 그려야 할 때 */
  changed(): void;
  /** 지금 툴바 탭의 i번째(0부터) 건물 */
  paletteSlot(i: number): BuildingType | null;
  /** 같이 하기: 모두에게 "여기 보세요" (F 키, Alt + 클릭) */
  ping(x: number, y: number): void;
}

type Mode = 'none' | 'place' | 'remove' | 'remove-area' | 'pan' | 'press' | 'select' | 'multi';

const ROTATABLE: BuildingType[] = [
  'belt',
  'fast-belt',
  'splitter',
  'overflow',
  'sorter',
  'merger',
  'unloader',
  'miner',
  'miner-2',
  'smelter',
  'assembler',
  'crusher',
  'washer',
  'separator',
  'pump',
  'station',
  'electric-furnace',
  'electrolyzer',
  'lumberjack',
  'sawmill',
];
/**
 * 마우스 중심 조작.
 * - 좌클릭: 배치 (도구 선택 시) / 건물 선택 (빈손) / 빈손 드래그는 화면 이동
 * - Ctrl + 좌클릭 드래그: 영역 복사 → 좌클릭으로 붙여넣기, 우클릭(또는 Esc)으로 취소
 * - Shift + 좌클릭 드래그: 단체 선택 (그 안의 가장 많은 한 종류 기계들 → 정보창에서 레시피를 한 번에)
 * - 우클릭(드래그): 철거, Ctrl + 우클릭 드래그: 사각형 영역 철거 (복사와 같은 Ctrl + 드래그라 헷갈리지 않게)
 * - Ctrl+Z / Ctrl+Y: 되돌리기 / 다시 하기 (마우스를 누르고 뗄 때까지가 한 단계)
 * - 가운데 드래그: 화면 이동, 휠: 줌
 */
export class Input implements ViewState {
  tool: BuildingType | null = null;
  toolDir: Dir = 1;
  hover: { x: number; y: number } | null = null;
  /** 마우스 위치 (칸 좌표, 소수점까지). 같이 하기에서 다른 사람에게 커서를 보여 주려고 */
  mouse: [number, number] | null = null;
  selectedId: number | null = null;
  /** 고른 트럭 (건물과 동시에 고르지 않는다) */
  selectedVehicle: number | null = null;
  /** Ctrl 드래그 중인 복사 영역 */
  selection: { x0: number; y0: number; x1: number; y1: number } | null = null;
  /** Ctrl + 우클릭 드래그 중인 철거 영역 */
  removeArea: { x0: number; y0: number; x1: number; y1: number } | null = null;
  /** Shift 드래그 중인 단체 선택 영역 */
  multiArea: { x0: number; y0: number; x1: number; y1: number } | null = null;
  /** 단체 선택한 건물들 (2대 이상. 하나면 selectedId로) */
  multi: number[] = [];
  /** 붙여넣기 대기 중인 청사진 */
  paste: Blueprint | null = null;
  /** 청사진 저장함에서 꺼낸 것이면 그 이름 (방금 복사한 것이면 null → 정보창에서 저장할 수 있다) */
  pasteName: string | null = null;
  /** 기계마다 분당 생산량 표시 (I 키, 위쪽 "생산량" 버튼) */
  showRates = false;
  /** 건물 종류별로 마지막에 고른 설정 (레시피 id 또는 분류기 아이템). 새로 지을 때 그대로 적용한다. */
  private toolSettings = new Map<BuildingType, string>();

  private mode: Mode = 'none';
  private last: { x: number; y: number } | null = null;
  private pressAt = { x: 0, y: 0 };
  private panFrom = { sx: 0, sy: 0, cx: 0, cy: 0 };
  private keys = new Set<string>();
  /** 마우스를 누른 동안 바뀐 것을 되돌리기 한 단계로 묶는 중 */
  private editing = false;
  /** 우클릭 한 번(누르고 뗄 때까지)에 지운 개수 */
  private pressRemovals = 0;
  /** 우클릭으로 하나씩 지운 시각들 (몇 번 연달아 하면 드래그 철거를 알려 준다) */
  private singleRemovals: number[] = [];
  private removeTipShown = false;
  /** 이번 드래그에서 "도로와 컨베이어는 겹칠 수 없어요"를 이미 알렸는지 */
  private crossTipShown = false;

  constructor(
    private canvas: HTMLCanvasElement,
    private cam: Camera,
    private cb: InputCallbacks,
  ) {
    canvas.addEventListener('pointerdown', (e) => this.onDown(e));
    canvas.addEventListener('pointermove', (e) => this.onMove(e));
    window.addEventListener('pointerup', (e) => this.onUp(e));
    canvas.addEventListener('pointerleave', () => {
      this.hover = null;
      this.mouse = null;
    });
    canvas.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('keydown', (e) => this.onKey(e));
    window.addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()));
    window.addEventListener('blur', () => this.keys.clear());
  }

  setTool(t: BuildingType | null): void {
    const w = this.cb.getWorld();
    if (t && !w.unlockedBuildings.has(t)) {
      this.cb.toast(`${BUILDINGS[t].name}: 연구로 해금해야 해요`);
      return;
    }
    this.tool = this.tool === t ? null : t;
    if (this.tool) {
      this.selectedId = null;
      this.selectedVehicle = null;
      this.paste = null;
      this.multi = [];
    }
    this.cb.changed();
  }

  /** 들고 있는 도구로 지으면 들어갈 설정 */
  get toolSetting(): string | null {
    return this.tool ? (this.toolSettings.get(this.tool) ?? null) : null;
  }

  /** 정보창에서 레시피·아이템을 고르면 같은 종류를 새로 지을 때 쓰도록 기억한다 */
  rememberSetting(type: BuildingType, value: string | null): void {
    if (value) this.toolSettings.set(type, value);
    else this.toolSettings.delete(type);
  }

  /** 키보드로 화면 이동 (매 프레임) */
  update(dt: number): void {
    const speed = (600 / this.cam.zoom) * dt;
    if (this.keys.has('w') || this.keys.has('arrowup')) this.cam.y -= speed;
    if (this.keys.has('s') || this.keys.has('arrowdown')) this.cam.y += speed;
    if (this.keys.has('a') || this.keys.has('arrowleft')) this.cam.x -= speed;
    if (this.keys.has('d') || this.keys.has('arrowright')) this.cam.x += speed;
  }

  private tileAt(e: PointerEvent | WheelEvent): { x: number; y: number } {
    const [wx, wy] = this.worldAt(e);
    return { x: Math.floor(wx), y: Math.floor(wy) };
  }

  /** 마우스 위치의 칸 좌표 (소수점까지) */
  private worldAt(e: PointerEvent | WheelEvent): [number, number] {
    const r = this.canvas.getBoundingClientRect();
    return this.cam.screenToWorld(e.clientX - r.left, e.clientY - r.top);
  }

  private onDown(e: PointerEvent): void {
    this.canvas.setPointerCapture(e.pointerId);
    const t = this.tileAt(e);
    this.last = t;
    if (e.button === 1) return this.startPan(e);
    if (e.button === 2) {
      // 복사한 걸 들고 있으면 우클릭은 철거가 아니라 붙여넣기 취소
      if (this.paste) {
        this.paste = null;
        this.mode = 'none';
        this.cb.toast('붙여넣기 취소');
        this.cb.changed();
        return;
      }
      if (e.ctrlKey || e.metaKey) {
        this.mode = 'remove-area';
        this.removeArea = { x0: t.x, y0: t.y, x1: t.x, y1: t.y };
        return;
      }
      this.mode = 'remove';
      this.startEdit();
      this.removeAt(t.x, t.y);
      return;
    }
    if (e.button !== 0) return;
    if (e.altKey) {
      const [wx, wy] = this.worldAt(e);
      this.cb.ping(wx, wy);
      return;
    }
    if (e.ctrlKey || e.metaKey) {
      this.mode = 'select';
      this.selection = { x0: t.x, y0: t.y, x1: t.x, y1: t.y };
      return;
    }
    if (e.shiftKey && !this.paste) {
      this.mode = 'multi';
      this.multiArea = { x0: t.x, y0: t.y, x1: t.x, y1: t.y };
      return;
    }
    if (this.paste) {
      this.cb.exec({ t: 'paste', bp: this.paste, x: t.x, y: t.y }, ({ placed, skipped }) =>
        this.cb.toast(skipped ? `${placed}개 붙여넣음 · ${skipped}개는 놓을 수 없음` : `${placed}개 붙여넣음`),
      );
      return;
    }
    if (this.tool) {
      // 도구를 든 채로 이미 있는 건물을 누르면 짓지 않고 그 건물을 연다
      // (컨베이어 덮어쓰기, 도로를 든 채 도로에서 시작하는 드래그는 예외)
      const existing = this.cb.getWorld().buildingAt(t.x, t.y);
      if (existing && !isBeltType(existing.type) && !(this.tool === 'road' && existing.type === 'road')) {
        this.selectedId = existing.id;
        this.selectedVehicle = null;
        this.cb.changed();
        return;
      }
      this.mode = 'place';
      this.startEdit();
      this.placeAt(t.x, t.y, this.toolDir, true);
    } else {
      this.mode = 'press';
      this.pressAt = { x: e.clientX, y: e.clientY };
      this.startPan(e, 'press');
    }
  }

  private startPan(e: PointerEvent, mode: Mode = 'pan'): void {
    this.mode = mode;
    this.panFrom = { sx: e.clientX, sy: e.clientY, cx: this.cam.x, cy: this.cam.y };
  }

  private onMove(e: PointerEvent): void {
    const t = this.tileAt(e);
    this.hover = t;
    this.mouse = this.worldAt(e);
    if (this.mode === 'select' && this.selection) {
      this.selection.x1 = t.x;
      this.selection.y1 = t.y;
      return;
    }
    if (this.mode === 'remove-area' && this.removeArea) {
      this.removeArea.x1 = t.x;
      this.removeArea.y1 = t.y;
      return;
    }
    if (this.mode === 'multi' && this.multiArea) {
      this.multiArea.x1 = t.x;
      this.multiArea.y1 = t.y;
      return;
    }
    if (this.mode === 'press' && Math.hypot(e.clientX - this.pressAt.x, e.clientY - this.pressAt.y) > 5) {
      this.mode = 'pan';
    }
    if (this.mode === 'pan') {
      this.cam.x = this.panFrom.cx - (e.clientX - this.panFrom.sx) / this.cam.zoom;
      this.cam.y = this.panFrom.cy - (e.clientY - this.panFrom.sy) / this.cam.zoom;
      return;
    }
    if ((this.mode === 'place' || this.mode === 'remove') && this.last) {
      // 빠르게 움직여도 칸을 건너뛰지 않도록 한 칸씩 따라간다
      let { x, y } = this.last;
      while (x !== t.x || y !== t.y) {
        const dx = Math.sign(t.x - x);
        const dy = Math.sign(t.y - y);
        const stepX = Math.abs(t.x - x) >= Math.abs(t.y - y);
        const sx = stepX ? dx : 0;
        const sy = stepX ? 0 : dy;
        const dir = dirOf(sx, sy)!;
        if (this.mode === 'place') {
          if (this.tool && isBeltType(this.tool)) {
            // 드래그 방향으로 이전 칸 컨베이어도 돌려서 자연스럽게 꺾이게 한다
            this.orientBelt(x, y, dir);
            this.toolDir = dir;
          }
          this.placeAt(x + sx, y + sy, this.tool && isBeltType(this.tool) ? dir : this.toolDir, false);
        } else {
          this.removeAt(x + sx, y + sy);
        }
        x += sx;
        y += sy;
      }
      this.last = { x, y };
    }
  }

  private onUp(e: PointerEvent): void {
    if (this.mode === 'remove-area' && this.removeArea) {
      const { x0, y0, x1, y1 } = this.removeArea;
      this.removeArea = null;
      this.cb.exec({ t: 'remove-area', x0, y0, x1, y1 }, (n) => {
        if (!n) return;
        if (this.selectedId && !this.cb.getWorld().buildings.has(this.selectedId)) this.selectedId = null;
        this.cb.toast(`${n}개 철거 (재료 100% 환급) · 실수했으면 Ctrl+Z`);
        this.cb.changed();
      });
      this.cb.changed();
    }
    if (this.mode === 'remove' && this.pressRemovals === 1) this.noteSingleRemoval();
    this.finishEdit();
    if (this.mode === 'select' && this.selection) {
      const s = this.selection;
      const bp = copyArea(this.cb.getWorld(), s.x0, s.y0, s.x1, s.y1);
      this.selection = null;
      if (bp) {
        this.startPaste(bp, null);
        this.cb.toast(`${bp.entries.length}개 복사 — 클릭해서 붙여넣기 (우클릭·Esc 취소) · 오른쪽 창에서 청사진으로 저장`);
      }
      this.cb.changed();
    }
    if (this.mode === 'multi' && this.multiArea) {
      const a = this.multiArea;
      const group = this.cb.getWorld().groupIn(a.x0, a.y0, a.x1, a.y1);
      this.multiArea = null;
      this.tool = null;
      this.selectedVehicle = null;
      this.multi = group.length > 1 ? group.map((b) => b.id) : [];
      this.selectedId = group.length === 1 ? group[0].id : null;
      if (group.length > 1) this.cb.toast(`${BUILDINGS[group[0].type].name} ${group.length}대 고름 — 오른쪽 창에서 한 번에 바꿔요`);
      this.cb.changed();
    }
    if (this.mode === 'press') {
      this.multi = [];
      // 트럭이 도로·정류장 위에 있으므로 트럭을 먼저 본다
      const w = this.cb.getWorld();
      const [wx, wy] = this.worldAt(e);
      const v = w.vehicleAt(wx, wy);
      const b = v ? null : w.buildingAt(Math.floor(wx), Math.floor(wy));
      this.selectedVehicle = v ? v.id : null;
      this.selectedId = b ? b.id : null;
      this.cb.changed();
    }
    this.mode = 'none';
    this.last = null;
  }

  private onWheel(e: WheelEvent): void {
    e.preventDefault();
    const r = this.canvas.getBoundingClientRect();
    this.cam.zoomAt(e.clientX - r.left, e.clientY - r.top, e.deltaY < 0 ? 1.15 : 1 / 1.15);
  }

  private onKey(e: KeyboardEvent): void {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
    const k = e.key.toLowerCase();
    if ((e.ctrlKey || e.metaKey) && (k === 'z' || k === 'y')) {
      e.preventDefault();
      this.undoRedo(k === 'y' || e.shiftKey);
      return;
    }
    this.keys.add(k);
    // 1~9, 0 = 10번째
    if (/^[0-9]$/.test(e.key)) {
      const type = this.cb.paletteSlot((Number(e.key) + 9) % 10);
      if (type) this.setTool(type);
      return;
    }
    switch (k) {
      case 'r':
        this.rotate(e.shiftKey);
        break;
      case 'f':
        if (this.mouse) this.cb.ping(...this.mouse);
        break;
      case 'q':
        this.pipette();
        break;
      case 'escape':
        this.tool = null;
        this.paste = null;
        this.multi = [];
        this.selectedId = null;
        this.selectedVehicle = null;
        this.cb.changed();
        break;
      case ' ':
        e.preventDefault();
        this.cb.togglePause();
        break;
      case 'delete':
      case 'backspace': {
        if (this.multi.length) {
          this.removeMulti();
          break;
        }
        const w = this.cb.getWorld();
        if (this.selectedVehicle && w.vehicles.has(this.selectedVehicle)) {
          this.cb.exec({ t: 'remove-truck', id: this.selectedVehicle });
          this.selectedVehicle = null;
          this.cb.changed();
        }
        const b = this.selectedId ? w.buildings.get(this.selectedId) : null;
        if (b) {
          this.cb.exec({ t: 'remove', id: b.id }, (ok) => {
            if (!ok || this.selectedId !== b.id) return;
            this.selectedId = null;
            this.cb.changed();
          });
        }
        break;
      }
    }
  }

  /** 짧은 안내 (툴바처럼 입력을 거쳐 알릴 때) */
  notify(msg: string): void {
    this.cb.toast(msg);
  }

  /** 청사진을 들고 붙여넣기 대기 (name = 저장함에서 꺼낸 이름) */
  startPaste(bp: Blueprint, name: string | null): void {
    this.paste = bp;
    this.pasteName = name;
    this.tool = null;
    this.selectedId = null;
    this.selectedVehicle = null;
    this.multi = [];
    if (name) this.cb.toast(`청사진 '${name}' — 클릭해서 붙여넣기 (우클릭·Esc 취소)`);
    this.cb.changed();
  }

  /** 단체 선택한 건물을 모두 철거 (되돌리기 한 단계) */
  removeMulti(): void {
    const w = this.cb.getWorld();
    const ids = this.multi.filter((id) => w.buildings.has(id));
    this.multi = [];
    if (!ids.length) return;
    this.cb.exec({ t: 'begin' });
    for (const id of ids) this.cb.exec({ t: 'remove', id });
    this.cb.exec({ t: 'end' });
    this.cb.toast(`${ids.length}개 철거 (재료 100% 환급) · 실수했으면 Ctrl+Z`);
    this.cb.changed();
  }

  /** 마우스 아래에 돌릴 수 있는 건물이 있으면 그 건물을, 아니면 들고 있는 도구를 돌린다 */
  private rotate(ccw: boolean): void {
    const turn = (d: Dir): Dir => (ccw ? rotateCW(rotateCW(rotateCW(d))) : rotateCW(d));
    const w = this.cb.getWorld();
    const b = this.hover ? w.buildingAt(this.hover.x, this.hover.y) : null;
    if (b && ROTATABLE.includes(b.type)) this.cb.exec({ t: 'rotate', id: b.id, dir: turn(b.dir) });
    else if (this.tool) this.toolDir = turn(this.toolDir);
  }

  /** 마우스 아래 건물과 같은 도구를 집는다. 빈 칸이면 도구 해제 */
  private pipette(): void {
    this.paste = null;
    if (!this.hover) return;
    const b = this.cb.getWorld().buildingAt(this.hover.x, this.hover.y);
    if (b && b.type !== 'hub') {
      this.tool = null;
      this.setTool(b.type);
      this.toolDir = b.dir;
      const setting = b.type === 'station' ? b.stationMode : (b.recipe ?? b.filter);
      if (setting) this.toolSettings.set(b.type, setting);
    } else {
      this.tool = null;
      this.cb.changed();
    }
  }

  /** initial = 드래그가 아닌 첫 클릭. 컨베이어 덮어쓰기는 첫 클릭에서만 (드래그로 줄 전체를 지우지 않게) */
  private placeAt(x: number, y: number, dir: Dir, initial: boolean): void {
    const tool = this.tool;
    if (!tool) return;
    // 지하 컨베이어는 입구·출구를 하나씩 정확히 놓아야 해서 드래그로 깔지 않는다
    if (tool === 'underground' && !initial) return;
    const setting = this.toolSettings.get(tool) ?? null;
    this.cb.exec({ t: 'place', tool, x, y, dir, initial, setting }, (r) => this.placed(tool, initial, r));
  }

  /** 짓기 결과 안내: 실패 이유, 설정이 필요한 건물은 정보창 열기 */
  private placed(tool: BuildingType, initial: boolean, r: PlaceResult): void {
    const name = BUILDINGS[tool].name;
    if (!r.ok) {
      if (r.swap) {
        if (initial) this.cb.toast(`${name}: 재료 부족`);
      } else if (!r.reason) {
        return;
      } else if (initial && r.reason !== '이미 건물이 있음') this.cb.toast(`${name}: ${r.reason}`);
      else if (r.reason === '재료 부족') this.cb.toast(`${name}: 재료 부족`);
      else if (!this.crossTipShown && r.crossRoad) {
        // 컨베이어를 끌다가 도로를 만나면(또는 반대) 조용히 끊기므로, 드래그마다 한 번 알려 준다
        this.crossTipShown = true;
        this.cb.toast('도로와 컨베이어는 겹칠 수 없어요. 지하 컨베이어(물류 3)로 도로 밑을 지나가게 하세요');
      }
      return;
    }
    const b = r.building!;
    // 설정이 꼭 필요한 조립기·분류기·하역기, 트럭을 만들 정류장은 바로 볼 수 있게 정보창을 연다
    if (initial && !r.swap && (r.needsSetting || b.type === 'station')) {
      this.selectedId = b.id;
      this.selectedVehicle = null;
      this.cb.changed();
    }
  }

  // 아래 둘은 지금 보이는 월드로 미리 거르지 않는다. 같이 하기 손님은 방금 놓은 컨베이어가
  // 아직 자기 월드에 없을 수 있어서, 있는지 없는지는 명령이 적용될 때 판단한다.
  private orientBelt(x: number, y: number, dir: Dir): void {
    this.cb.exec({ t: 'orient', x, y, dir });
  }

  private removeAt(x: number, y: number): void {
    const b = this.cb.getWorld().buildingAt(x, y);
    if (b?.type === 'hub') return;
    if (b && b.id === this.selectedId) this.selectedId = null;
    this.cb.exec({ t: 'remove-at', x, y }, (ok) => {
      if (ok) this.pressRemovals++;
    });
  }

  /** 마우스를 누른 동안 바뀐 것을 되돌리기 한 단계로 묶기 시작 */
  private startEdit(): void {
    if (this.editing) return;
    this.editing = true;
    this.pressRemovals = 0;
    this.crossTipShown = false;
    this.cb.exec({ t: 'begin' });
  }

  private finishEdit(): void {
    if (!this.editing) return;
    this.editing = false;
    this.cb.exec({ t: 'end' });
  }

  /** 우클릭으로 하나씩 여러 번 지우고 있으면, 드래그로 지우는 법을 한 번 알려 준다 */
  private noteSingleRemoval(): void {
    if (this.removeTipShown) return;
    const now = performance.now();
    this.singleRemovals = [...this.singleRemovals.filter((t) => now - t < 8000), now];
    if (this.singleRemovals.length < 3) return;
    this.removeTipShown = true;
    this.cb.toast('팁: 우클릭한 채 끌면 지나간 칸을, Ctrl+우클릭으로 끌면 사각형 안을 한 번에 철거해요');
  }

  /** Ctrl+Z / Ctrl+Y (위쪽 ↶ ↷ 버튼도) */
  undoRedo(redo: boolean): void {
    this.cb.exec({ t: redo ? 'redo' : 'undo' }, (r) => {
      if (!r) {
        this.cb.toast(redo ? '다시 할 게 없어요' : '되돌릴 게 없어요');
        return;
      }
      const skipped = r.skipped ? ` · ${r.skipped}개는 못 함 (재료 부족이거나 자리가 막힘)` : '';
      this.cb.toast(`${redo ? '다시 함' : '되돌림'}: ${describeEdit(r.ops)}${skipped}`);
      if (this.selectedId && !this.cb.getWorld().buildings.has(this.selectedId)) this.selectedId = null;
      this.cb.changed();
    });
  }
}
