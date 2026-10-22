import { BUILDINGS, isBeltType, type BuildingType } from '../data/buildings';
import { ITEMS } from '../data/items';
import type { Camera } from '../render/camera';
import { ORE_GROUND } from '../render/pixel';
import { patchAlert, type World } from '../sim/world';

/** 픽셀 맵과 같은 따뜻한 공방 색 */
const GROUND = '#e6d6af';
const WATER = '#4f96cf';
/** 지도에서 건물 색. 맵 색 그대로면 바닥과 구분이 안 되는 것만 따로 */
const BUILDING_COLOR: Partial<Record<BuildingType, string>> = {
  road: '#8f877a',
  underground: '#9e7526',
};
const BELT = '#6e6052';
const TRUCK = '#d9822b';
const SAVE_KEY = 'automation-game/minimap';

const rgbCache = new Map<string, [number, number, number]>();
function rgb(hex: string): [number, number, number] {
  let c = rgbCache.get(hex);
  if (!c) {
    const n = parseInt(hex.slice(1), 16);
    c = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    rgbCache.set(hex, c);
  }
  return c;
}

/**
 * 맵 전체 지도 (칸당 1픽셀): 광맥·호수·건물·도로·트럭과 지금 보는 곳(흰 테두리).
 * 누르거나 끌면 화면이 그리로 간다. M 키 / 위쪽 "지도" 버튼으로 켜고 끈다 (켜 둔 상태는 기억).
 */
export class Minimap {
  private ctx: CanvasRenderingContext2D;
  private img: ImageData | null = null;
  private paintedAt = 0;
  private alerts: { x: number; y: number; level: 'low' | 'empty' }[] = [];
  /** 같이 하기: 다른 사람 커서(점)와 핑(동그라미) */
  marks: () => { x: number; y: number; color: string; ping: boolean }[] = () => [];

  constructor(
    private canvas: HTMLCanvasElement,
    private getWorld: () => World,
    private cam: Camera,
  ) {
    this.ctx = canvas.getContext('2d')!;
    try {
      canvas.hidden = localStorage.getItem(SAVE_KEY) !== 'on';
    } catch {
      canvas.hidden = true;
    }
    const jump = (e: PointerEvent) => {
      const w = this.getWorld();
      const r = canvas.getBoundingClientRect();
      this.cam.x = ((e.clientX - r.left) / r.width) * w.width;
      this.cam.y = ((e.clientY - r.top) / r.height) * w.height;
    };
    canvas.addEventListener('pointerdown', (e) => {
      canvas.setPointerCapture(e.pointerId);
      jump(e);
    });
    canvas.addEventListener('pointermove', (e) => {
      if (e.buttons & 1) jump(e);
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  get shown(): boolean {
    return !this.canvas.hidden;
  }

  toggle(): void {
    this.canvas.hidden = !this.canvas.hidden;
    this.img = null;
    try {
      localStorage.setItem(SAVE_KEY, this.canvas.hidden ? 'off' : 'on');
    } catch {
      // 저장이 막힌 브라우저면 이번에만
    }
  }

  /** 매 프레임 불러도 된다. 땅·건물은 0.25초마다 다시 칠하고, 트럭과 보는 곳 테두리는 매번 */
  draw(): void {
    if (this.canvas.hidden) return;
    const w = this.getWorld();
    if (this.canvas.width !== w.width || this.canvas.height !== w.height) {
      this.canvas.width = w.width;
      this.canvas.height = w.height;
      this.img = null;
    }
    const now = performance.now();
    if (!this.img || now - this.paintedAt > 250) {
      this.paintedAt = now;
      this.img = this.paint(w);
      this.alerts = w
        .patchReports()
        .map((r) => ({ x: r.x, y: r.y, level: patchAlert(r) }))
        .filter((a): a is { x: number; y: number; level: 'low' | 'empty' } => a.level !== null);
    }
    const ctx = this.ctx;
    ctx.putImageData(this.img, 0, 0);
    // 곧 바닥나는 광맥(노랑)·바닥난 광맥(빨강)에 동그라미 (왼쪽 위 "광맥 경고"와 같은 기준)
    ctx.lineWidth = 1.5;
    for (const r of this.alerts) {
      ctx.strokeStyle = r.level === 'empty' ? '#c0392b' : '#b7791f';
      ctx.beginPath();
      ctx.arc(r.x, r.y, 4, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.fillStyle = TRUCK;
    for (const v of w.vehicles.values()) ctx.fillRect(Math.floor(v.x) - 1, Math.floor(v.y) - 1, 2, 2);
    for (const m of this.marks()) {
      ctx.strokeStyle = m.color;
      ctx.fillStyle = m.color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      if (m.ping) {
        ctx.arc(m.x, m.y, 4 + 3 * Math.abs(Math.sin(now / 200)), 0, Math.PI * 2);
        ctx.stroke();
      } else {
        ctx.arc(m.x, m.y, 2.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    const vw = this.cam.viewW / this.cam.zoom;
    const vh = this.cam.viewH / this.cam.zoom;
    ctx.strokeStyle = 'rgba(59,39,22,0.9)';
    ctx.lineWidth = 1;
    ctx.strokeRect(Math.round(this.cam.x - vw / 2) + 0.5, Math.round(this.cam.y - vh / 2) + 0.5, Math.round(vw), Math.round(vh));
  }

  private paint(w: World): ImageData {
    const img = this.ctx.createImageData(w.width, w.height);
    const d = img.data;
    const ground = rgb(GROUND);
    for (let i = 0; i < w.width * w.height; i++) {
      let c = ground;
      const item = w.resItem[i];
      if (item === 'water') c = rgb(WATER);
      else if (item) {
        // 광맥: 맵에서 멀리 볼 때와 같은 광물별 바닥색
        c = rgb(ORE_GROUND[item] ?? ITEMS[item].color);
      }
      const id = w.occ[i];
      const b = id ? w.buildings.get(id) : undefined;
      if (b) c = rgb(BUILDING_COLOR[b.type] ?? (isBeltType(b.type) ? BELT : BUILDINGS[b.type].color));
      d[i * 4] = c[0];
      d[i * 4 + 1] = c[1];
      d[i * 4 + 2] = c[2];
      d[i * 4 + 3] = 255;
    }
    return img;
  }
}
