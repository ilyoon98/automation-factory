import {
  BUILDINGS,
  STATION_CAPACITY,
  TRUCK,
  UNDERGROUND_MAX_GAP,
  isBeltType,
  type BuildingType,
} from '../data/buildings';
import { ITEMS, type ItemId } from '../data/items';
import { RECIPES } from '../data/recipes';
import type { Presence } from '../net/session';
import type { Blueprint } from '../sim/blueprint';
import type { Building, StationMode, Status } from '../sim/building';
import type { Vehicle } from '../sim/vehicle';
import { DX, DY, type Dir } from '../sim/dir';
import { BELT_SPEED, World, isLineType, patchAlert, storageBounds } from '../sim/world';
import type { Camera } from './camera';
import { roundRect } from './draw-item';
import { NUM_ADVANCE, ORE_GROUND, PAL, TILE, hash, loadSpriteOverrides, sprite, spriteHalf, tone } from './pixel';
import { MACHINE } from './pixel-buildings';

/** 렌더러가 입력 상태에서 필요로 하는 것 */
export interface ViewState {
  tool: BuildingType | null;
  toolDir: Dir;
  hover: { x: number; y: number } | null;
  selectedId: number | null;
  /** 고른 트럭 */
  selectedVehicle: number | null;
  selection: { x0: number; y0: number; x1: number; y1: number } | null;
  /** Ctrl + 우클릭 드래그 중인 철거 영역 */
  removeArea: { x0: number; y0: number; x1: number; y1: number } | null;
  paste: Blueprint | null;
  /** 들고 있는 도구로 지으면 들어갈 설정 (레시피 id 또는 분류기 아이템) */
  toolSetting: string | null;
  /** 기계마다 분당 생산량 표시 (I 키) */
  showRates: boolean;
}

/** 월드 바깥 */
const BG = '#2b2119';
/** 도구를 들었을 때만 보이는 옅은 격자 */
const GRID = 'rgba(59,39,22,0.13)';
const SELECT = '#ffd34d';
const CREAM = '#f3e7c9';

/** 방향(입구/출구)이 있는 건물 */
const HAS_PORTS: BuildingType[] = [
  'miner',
  'miner-2',
  'smelter',
  'assembler',
  'crusher',
  'washer',
  'separator',
  'pump',
  'splitter',
  'overflow',
  'sorter',
  'merger',
  'unloader',
  'station',
  'electric-furnace',
];

/** 정류장 종류별 색: 싣기 초록, 내리기 주황 */
const STATION_COLOR: Record<StationMode, string> = { load: PAL.green, unload: PAL.orange };

/** 상태 표시 그림 (badge:<이름>) */
const STATUS_BADGE: Partial<Record<Status, string>> = {
  'low-power': 'power',
  'no-input': 'wait',
  'output-full': 'full',
  'no-recipe': 'what',
  depleted: 'empty',
  'no-fuel': 'nofuel',
  'no-water': 'nowater',
  'no-filter': 'what',
};
/** 곧 바닥날 광맥 위 채굴기 (상태 표시가 따로 없을 때) */
const ORE_LOW_BADGE = 'low';

/** 광맥 그림이 있는 자원 */
const ORE_TILES: ItemId[] = ['iron-ore', 'copper-ore', 'coal', 'stone'];
/** 바닥은 이만큼(칸)씩 묶어 한 장으로 구워 둔다 */
const CHUNK = 16;
/** 그림 1픽셀이 화면 픽셀 이만큼보다 작아지면(멀리서 보면) 바닥을 칸마다 단색으로 */
const LOD_SCALE = 1;

/**
 * 캔버스 글꼴: 픽셀 글꼴 갈무리 (Galmuri11은 12px, Galmuri9는 10px의 배수에서 또렷하다).
 * zoom = "글자 또렷하게"를 켰을 때 UI에 걸린 배율 (125%면 0.8 → 기기 픽셀로 딱 12px)
 */
const font = (px: number, zoom = 1) => `${px * zoom}px ${px === 10 ? 'Galmuri9' : 'Galmuri11'}, system-ui, sans-serif`;

/** 짓거나 철거한 자리에서 잠깐 퍼지는 먼지 (화면에만, 시뮬레이션과 무관) */
interface Puff {
  /** 건물 왼쪽 위 칸과 크기 */
  x: number;
  y: number;
  size: number;
  /** 생긴 시각 (초, performance.now 기준) */
  t0: number;
  build: boolean;
  /** 먼지 알갱이: 건물 아래 가장자리에서 출발 위치(그림 픽셀)와 날아가는 속도(그림 픽셀/초) */
  dots: { x: number; vx: number; vy: number; big: boolean }[];
  /** 철거: 건물 그림을 네모 조각으로 잘라 흩뿌린다. 조각 = 그림 안 위치(x, y)와 크기 s, 속도 */
  art?: string;
  shards?: { x: number; y: number; s: number; vx: number; vy: number }[];
}

/** 먼지가 남아 있는 시간 (초) */
const PUFF_SEC = 0.45;
/** 한꺼번에 보여 줄 먼지 수 (큰 붙여넣기·영역 철거에서 너무 많아지지 않게) */
const PUFF_MAX = 160;
/** 지을 때 이는 먼지 색 (바닥보다 조금 진한 모래색) */
const PUFF_DUST = '#b89a63';
/** 지은 건물이 위에서 툭 떨어져 내려앉는 시간 (초). 앞은 떨어지기, 뒤는 작게 한 번 더 튀기 */
const HOP_FALL = 0.14;
const HOP_SEC = 0.28;
/** 철거 조각이 떨어지는 가속도 (그림 픽셀/초²) */
const SHARD_G = 220;
/** 연구를 마쳤을 때 허브 반짝임 시간 (초) */
const SPARKLE_SEC = 0.6;

/** 철거 조각에 쓸 건물 그림 (종류마다 대표 모양 하나, 첫 프레임) */
function artOf(b: Building): string {
  switch (b.type) {
    case 'station':
      return `station-${b.stationMode}`;
    case 'storage':
      return 'storage:15';
    case 'road':
      return 'road:0';
    case 'underground':
      return `underground-${b.ugMode === 'in' ? 'in' : 'out'}`;
    default:
      return b.type;
  }
}

/** 끝난 연구 수 (끝없는 연구는 단계마다 하나) */
function researchCount(world: World): number {
  let n = world.researched.size;
  for (const lv of world.levels.values()) n += lv;
  return n;
}

export class Renderer {
  /** 맵 글씨 배율: "글자 또렷하게"를 켜면 UI와 같은 배율 (main에서 넣는다, ui/crisp.ts) */
  textZoom = 1;
  private ctx: CanvasRenderingContext2D;
  private dpr = 1;
  private cam!: Camera;
  /** 그림 1픽셀의 화면 크기 (CSS px) */
  private u = 1;
  /** 그림 1픽셀이 기기 픽셀 몇 개인지 (0.5, 1, 2, 3, ...) */
  private n = 1;
  /**
   * 멀리서 보는 중 (LOD): 바닥은 칸마다 단색, 건물·컨베이어는 절반 크기로 줄인 그림을 멈춘 채로.
   * 컨베이어 위 아이템, 이름표, 진행 막대, 화살표 같은 덧그림은 그리지 않는다
   */
  private lod = false;
  /** 구워 둔 바닥 묶음 (키 = 칸 그림이 바뀌었는지 보는 해시) */
  private chunks = new Map<number, { canvas: HTMLCanvasElement; key: number }>();
  /** 멀리서 볼 때 쓰는 바닥 묶음 (칸 하나 = 1픽셀) */
  private lodChunks = new Map<number, { canvas: HTMLCanvasElement; key: number }>();
  /** 짓기·철거 먼지. 지난 프레임에 있던 건물과 비교해서 찾는다 (누가 지었든, 되돌리기든) */
  private puffs: Puff[] = [];
  private seenWorld: World | null = null;
  private seen = new Map<number, { x: number; y: number; size: number; art: string }>();
  private seenNextId = 0;
  private seenCount = 0;
  /** 막 지은 건물 id → 생긴 시각 (툭 내려앉기) */
  private hops = new Map<number, number>();
  /** 지난 프레임까지 끝난 연구 수, 허브 반짝임이 시작된 시각 (없으면 -1) */
  private seenResearch = 0;
  private sparkleT0 = -1;

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
    // 직접 그린 PNG(public/sprites)가 있으면 바꿔 끼우고 바닥을 다시 굽는다
    loadSpriteOverrides().then((names) => {
      if (names.length) this.chunks.clear();
    });
  }

  resize(camera: Camera): void {
    this.dpr = window.devicePixelRatio || 1;
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    this.canvas.width = Math.round(w * this.dpr);
    this.canvas.height = Math.round(h * this.dpr);
    camera.viewW = w;
    camera.viewH = h;
    // 화면 배율이 바뀌면 줌 단계도 달라진다
    camera.refit();
  }

  draw(world: World, cam: Camera, view: ViewState): void {
    const ctx = this.ctx;
    const dpr = this.dpr;
    this.cam = cam;
    this.u = cam.zoom / TILE;
    this.n = this.u * dpr;
    this.lod = this.n < LOD_SCALE;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, cam.viewW, cam.viewH);
    // 월드 원점을 기기 픽셀에 맞춘다: 칸 경계와 그림 픽셀이 화면 픽셀에 딱 떨어져야 또렷하다
    {
      const [ox, oy] = cam.worldToScreen(0, 0);
      ctx.setTransform(dpr, 0, 0, dpr, Math.round(ox * dpr) - ox * dpr, Math.round(oy * dpr) - oy * dpr);
    }

    const z = cam.zoom;
    const [wx0, wy0] = cam.screenToWorld(0, 0);
    const [wx1, wy1] = cam.screenToWorld(cam.viewW, cam.viewH);
    const x0 = Math.max(0, Math.floor(wx0));
    const y0 = Math.max(0, Math.floor(wy0));
    const x1 = Math.min(world.width - 1, Math.ceil(wx1));
    const y1 = Math.min(world.height - 1, Math.ceil(wy1));

    this.drawGround(world, x0, y0, x1, y1);
    if (view.tool || view.paste) this.drawGrid(x0, y0, x1, y1);
    this.trackBuildings(world);

    const visible: Building[] = [];
    for (const b of world.buildings.values()) {
      if (b.x + b.size < x0 || b.y + b.size < y0 || b.x > x1 || b.y > y1) continue;
      visible.push(b);
    }

    // 컨베이어 무늬가 흐르는 위치 (칸 단위, 0~0.5. 종류마다 속도가 다르다)
    const phase = (b: Building) => (world.time * (b.def.speed ?? BELT_SPEED) * world.boost('endless-belt')) % 0.5;
    const isLine = (b: Building) => isLineType(b.type);
    for (const b of visible) if (b.type === 'road') this.drawRoad(world, b);
    for (const b of visible) {
      if (isBeltType(b.type)) this.drawBelt(b, phase(b));
      else if (b.type === 'underground') this.drawUnderground(world, b, phase(b));
    }
    if (!this.lod) {
      for (const b of visible) {
        if (isBeltType(b.type)) this.drawBeltItems(b);
        else if (b.type === 'underground') this.drawUndergroundItems(world, b);
      }
    }
    for (const b of visible) if (!isLine(b) && b.type !== 'road') this.drawBuilding(world, b);
    // 창고는 묶음마다 한 번 (묶음 일부만 화면에 보여도)
    if (!this.lod) {
      const storages = new Set(visible.filter((b) => b.type === 'storage').map((b) => world.storageGroup(b)[0]));
      for (const leader of storages) this.drawStorageInfo(world, leader);
    }
    // 트럭은 건물 위에 (도로 옆 정류장에 서 있을 때도 보이게). 같은 칸에 서 있는 트럭들은 도로를 따라 줄 세워 그린다
    const spots = world.truckSpots();
    for (const v of world.vehicles.values()) {
      const p = spots.get(v.id) ?? v;
      if (p.x < x0 - 1 || p.y < y0 - 1 || p.x > x1 + 2 || p.y > y1 + 2) continue;
      this.drawTruck(v, v.id === view.selectedVehicle, p);
    }
    this.drawPuffs();
    this.drawSparkle(world);
    if (this.n >= 1) {
      const low = new Set<number>();
      for (const r of world.patchReports()) if (patchAlert(r) === 'low') for (const m of r.miners) low.add(m.id);
      for (const b of visible) if (!isLine(b)) this.drawBadge(b, low.has(b.id) ? ORE_LOW_BADGE : undefined);
    }
    if (view.showRates && z >= 12) for (const b of visible) this.drawRate(world, b);

    // 지하 컨베이어를 들고 있으면 짝을 점선으로 이어 보여 준다
    if (view.tool === 'underground') {
      ctx.strokeStyle = 'rgba(158,117,38,0.85)';
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      for (const b of visible) {
        const p = b.type === 'underground' && b.ugMode === 'in' ? world.partnerOf(b) : null;
        if (!p) continue;
        const [ax, ay] = cam.worldToScreen(b.x + 0.5, b.y + 0.5);
        const [bx, by] = cam.worldToScreen(p.x + 0.5, p.y + 0.5);
        ctx.moveTo(ax, ay);
        ctx.lineTo(bx, by);
      }
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // 선택한 건물
    if (view.selectedId) {
      const b = world.buildings.get(view.selectedId);
      if (b) {
        const [sx, sy] = cam.worldToScreen(b.x, b.y);
        this.outline(sx, sy, b.size * z, b.size * z, SELECT);
      }
    }
    // 고른 트럭: 오가는 두 정류장과 가는 길
    if (view.selectedVehicle) {
      const v = world.vehicles.get(view.selectedVehicle);
      if (v) this.drawRoute(world, v);
    }

    // 복사 영역
    if (view.selection) {
      const s = view.selection;
      const [sx, sy] = cam.worldToScreen(Math.min(s.x0, s.x1), Math.min(s.y0, s.y1));
      const w = (Math.abs(s.x1 - s.x0) + 1) * z;
      const h = (Math.abs(s.y1 - s.y0) + 1) * z;
      ctx.fillStyle = 'rgba(63,134,196,0.14)';
      ctx.fillRect(sx, sy, w, h);
      this.outline(sx, sy, w, h, '#3f86c4', true);
    }

    // 철거 영역: 지워질 건물을 빨갛게 덮고 개수를 보여 준다
    if (view.removeArea) {
      const a = view.removeArea;
      const doomed = world.buildingsIn(a.x0, a.y0, a.x1, a.y1);
      ctx.fillStyle = 'rgba(217,83,74,0.4)';
      for (const b of doomed) {
        const [bx, by] = cam.worldToScreen(b.x, b.y);
        ctx.fillRect(bx, by, b.size * z, b.size * z);
      }
      const [sx, sy] = cam.worldToScreen(Math.min(a.x0, a.x1), Math.min(a.y0, a.y1));
      const w = (Math.abs(a.x1 - a.x0) + 1) * z;
      const h = (Math.abs(a.y1 - a.y0) + 1) * z;
      ctx.fillStyle = 'rgba(217,83,74,0.1)';
      ctx.fillRect(sx, sy, w, h);
      this.outline(sx, sy, w, h, PAL.red, true);
      this.text(doomed.length ? `${doomed.length}개 철거` : '철거할 것 없음', sx + 2, sy - 4, '#fbf3df', 12, PAL.red, 'left', 'bottom');
    }

    // 배치 미리보기 / 마우스 칸
    if (view.hover) {
      if (view.paste) {
        for (const e of view.paste.entries) {
          this.drawGhost(world, e.type, e.dir, view.hover.x + e.dx, view.hover.y + e.dy, false);
        }
      } else if (view.tool) {
        // 도구를 든 채 건물 위에 있으면 클릭 = 설정 열기, R = 그 건물 회전이라 미리보기 대신 건물을 강조한다
        const hb = world.buildingAt(view.hover.x, view.hover.y);
        if (hb && !isBeltType(hb.type) && !(view.tool === 'road' && hb.type === 'road')) {
          const [bx, by] = cam.worldToScreen(hb.x, hb.y);
          this.outline(bx, by, hb.size * z, hb.size * z, SELECT, true);
        } else {
          this.drawGhost(world, view.tool, view.toolDir, view.hover.x, view.hover.y, true, view.toolSetting);
        }
      } else {
        const [sx, sy] = cam.worldToScreen(view.hover.x, view.hover.y);
        ctx.strokeStyle = 'rgba(59,39,22,0.4)';
        ctx.lineWidth = 1;
        ctx.strokeRect(sx + 0.5, sy + 0.5, z - 1, z - 1);
      }
    }
  }

  // ───────────────────────── 짓기·철거 먼지 ─────────────────────────

  /** 지난 프레임과 비교해 새로 생기거나 사라진 건물 자리에 먼지를 만든다 */
  private trackBuildings(world: World): void {
    const remember = (b: Building) => this.seen.set(b.id, { x: b.x, y: b.y, size: b.size, art: artOf(b) });
    // 공장이 통째로 바뀌면(새 게임·불러오기·방 참가) 먼지 없이 기억만 새로
    if (world !== this.seenWorld) {
      this.seenWorld = world;
      this.seen.clear();
      for (const b of world.buildings.values()) remember(b);
      this.puffs = [];
      this.hops.clear();
      this.seenResearch = researchCount(world);
      this.sparkleT0 = -1;
      return;
    }
    const now = performance.now() / 1000;
    if (world.nextId !== this.seenNextId || world.buildings.size !== this.seenCount) {
      for (const b of world.buildings.values()) {
        if (this.seen.has(b.id)) continue;
        remember(b);
        // 건물은 위에서 툭 떨어져 내려앉고, 땅에 닿을 때 먼지 (컨베이어·도로는 끌어 놓으니 먼지만)
        const hop = !isLineType(b.type) && b.type !== 'road';
        if (hop) this.hops.set(b.id, now);
        this.addPuff(b.x, b.y, b.size, true, hop ? now + HOP_FALL : now);
      }
      for (const [id, s] of this.seen) {
        if (world.buildings.has(id)) continue;
        this.seen.delete(id);
        this.hops.delete(id);
        this.addPuff(s.x, s.y, s.size, false, now, s.art);
      }
    }
    this.seenNextId = world.nextId;
    this.seenCount = world.buildings.size;
    // 화면 밖에서 지어 한 번도 안 그린 건물도 잊는다
    for (const [id, t0] of this.hops) if (now - t0 >= HOP_SEC) this.hops.delete(id);
    // 연구를 마치면 (누가 했든) 허브에서 반짝
    const done = researchCount(world);
    if (done > this.seenResearch) this.sparkleT0 = now;
    this.seenResearch = done;
  }

  /** 막 지은 건물이 떠 있는 높이 (그림 픽셀, 위로 +). 떨어져 내려앉은 뒤 작게 한 번 더 튄다 */
  private hopLift(b: Building): number {
    if (!this.hops.size) return 0;
    const t0 = this.hops.get(b.id);
    if (t0 === undefined) return 0;
    const t = performance.now() / 1000 - t0;
    if (t >= HOP_SEC) {
      this.hops.delete(b.id);
      return 0;
    }
    const h = b.size === 1 ? 4 : 6;
    if (t < HOP_FALL) {
      const k = t / HOP_FALL;
      return Math.round(h * (1 - k * k));
    }
    return Math.round((h / 3) * Math.sin((Math.PI * (t - HOP_FALL)) / (HOP_SEC - HOP_FALL)));
  }

  private addPuff(x: number, y: number, size: number, build: boolean, now: number, art?: string): void {
    if (this.puffs.length >= PUFF_MAX) return;
    const w = size * TILE;
    const n = size === 1 ? 4 : 8;
    const dots: Puff['dots'] = [];
    for (let i = 0; i < n; i++) {
      // 아래 가장자리를 따라 고르게 놓고 바깥쪽 위로 튄다 (지으면 내려앉으며 이는 먼지, 철거하면 이는 흙먼지)
      const side = (i + 0.5) / n;
      dots.push({
        x: side * w,
        vx: (side - 0.5) * (build ? 46 : 60) + (Math.random() - 0.5) * 10,
        vy: -(build ? 10 : 22) - Math.random() * 14,
        big: i % 3 === 0,
      });
    }
    // 철거: 그림을 4×4 조각으로 잘라 가운데에서 바깥쪽 위로 흩뿌린다 (작은 건물은 덜 세게)
    let shards: Puff['shards'];
    if (art && sprite(art)) {
      shards = [];
      const s = w / 4;
      const power = size === 1 ? 0.6 : 1;
      for (let j = 0; j < 4; j++) {
        for (let i = 0; i < 4; i++) {
          const dx = (i - 1.5) / 1.5;
          const dy = (j - 1.5) / 1.5;
          shards.push({
            x: i * s,
            y: j * s,
            s,
            vx: (dx * 30 + (Math.random() - 0.5) * 36) * power,
            vy: (-42 + dy * 10 - Math.random() * 26) * power,
          });
        }
      }
    }
    this.puffs.push({ x, y, size, t0: now, build, dots, art, shards });
  }

  private drawPuffs(): void {
    if (!this.puffs.length) return;
    const now = performance.now() / 1000;
    this.puffs = this.puffs.filter((p) => now - p.t0 < PUFF_SEC);
    if (this.lod) return;
    const ctx = this.ctx;
    const u = this.u;
    for (const p of this.puffs) {
      const t = now - p.t0;
      // 지을 때 먼지는 건물이 땅에 닿을 때부터
      if (t < 0) continue;
      const k = t / PUFF_SEC;
      const [sx, sy] = this.cam.worldToScreen(p.x, p.y);
      const bottom = p.size * TILE;
      ctx.globalAlpha = 1 - k * k;
      // 지을 때는 땅에 닿고 0.12초 동안 테두리가 반짝 (어디에 생겼는지 눈에 띄게)
      if (p.build && t < 0.12) this.outline(sx - u, sy - u, (bottom + 2) * u, (bottom + 2) * u, PAL.brass.hi);
      // 철거 조각: 날아가다 떨어지고, 뒤 절반에는 조각 가운데만 남아 부스러진다
      const img = p.shards && sprite(p.art!);
      if (img) {
        const crumble = k > 0.55;
        for (const c of p.shards!) {
          const cs = crumble ? c.s / 2 : c.s;
          const ox = crumble ? c.s / 4 : 0;
          const px = Math.round(c.x + ox + c.vx * t);
          const py = Math.round(c.y + ox + c.vy * t + 0.5 * SHARD_G * t * t);
          ctx.drawImage(img.img, c.x + ox, c.y + ox, cs, cs, sx + px * u, sy + py * u, cs * u, cs * u);
        }
      }
      ctx.fillStyle = PUFF_DUST;
      for (const d of p.dots) {
        // 위로 튀었다가 조금 떨어진다 (그림 픽셀 단위로 맞춰 또렷하게)
        const px = Math.round(d.x + d.vx * t);
        const py = Math.round(bottom - 2 + d.vy * t + 60 * t * t);
        const sz = d.big ? 2 : 1;
        ctx.fillRect(sx + px * u, sy + py * u, sz * u, sz * u);
      }
    }
    ctx.globalAlpha = 1;
  }

  /**
   * 연구를 마쳤을 때 허브 둘레로 퍼지는 별 반짝임 (0.6초).
   * 별은 그림 픽셀 단위 십자 모양: 처음엔 크게, 퍼질수록 작아져 점 하나로 사라진다
   */
  private drawSparkle(world: World): void {
    if (this.sparkleT0 < 0) return;
    const t = performance.now() / 1000 - this.sparkleT0;
    const hub = world.hub;
    if (t >= SPARKLE_SEC || !hub) {
      this.sparkleT0 = -1;
      return;
    }
    if (this.lod) return;
    const ctx = this.ctx;
    const u = this.u;
    const k = t / SPARKLE_SEC;
    const [sx, sy] = this.cam.worldToScreen(hub.x, hub.y);
    const half = (hub.size * TILE) / 2;
    // 처음 0.15초는 허브 테두리가 놋쇠색으로 반짝
    if (t < 0.15) this.outline(sx - u, sy - u, (half * 2 + 2) * u, (half * 2 + 2) * u, PAL.brass.hi);
    const ease = 1 - (1 - k) * (1 - k);
    const r = half - 4 + 22 * ease;
    const arm = k < 0.35 ? 2 : k < 0.7 ? 1 : 0;
    const star = (x: number, y: number, c: string) => {
      ctx.fillStyle = c;
      ctx.fillRect(sx + (x - arm) * u, sy + y * u, (arm * 2 + 1) * u, u);
      ctx.fillRect(sx + x * u, sy + (y - arm) * u, u, (arm * 2 + 1) * u);
    };
    ctx.globalAlpha = k < 0.7 ? 1 : 1 - (k - 0.7) / 0.3;
    const n = 12;
    for (let i = 0; i < n; i++) {
      // 바깥 별과 안쪽 별이 번갈아 (안쪽은 조금 늦게, 반대 방향으로 살짝 돈다)
      const inner = i % 2 === 1;
      const a = (i / n) * Math.PI * 2 + (inner ? -0.5 : 0.5) * k;
      const rr = inner ? r * 0.72 : r;
      const x = Math.round(half + Math.cos(a) * rr);
      const y = Math.round(half + Math.sin(a) * rr);
      star(x, y, inner ? PAL.brass.hi : '#fffbe8');
    }
    // 굴뚝 쪽으로 올라가는 작은 불티
    ctx.fillStyle = PAL.brass.hi;
    for (let i = 0; i < 5; i++) {
      const x = Math.round(half - 12 + i * 6 + Math.sin(k * 9 + i) * 2);
      const y = Math.round(half - 6 - (20 + (i % 3) * 6) * ease);
      ctx.fillRect(sx + x * u, sy + y * u, u, u);
    }
    ctx.globalAlpha = 1;
  }

  // ───────────────────────── 그림 찍기 도우미 ─────────────────────────

  /** 그림 한 장. (sx, sy) = 왼쪽 위 화면 좌표, frame = 가로 몇 번째 프레임 (LOD면 절반 그림, 첫 프레임) */
  private blit(name: string, frame: number, sx: number, sy: number): void {
    const s = this.lod ? spriteHalf(name) : sprite(name);
    if (!s) return;
    const u = this.lod ? this.u * 2 : this.u;
    this.ctx.drawImage(s.img, (frame % s.frames) * s.w, 0, s.w, s.h, sx, sy, s.w * u, s.h * u);
  }

  /** 가운데 (cx, cy)를 축으로 90도 단위로 돌려서 (rot = 시계 방향 횟수, flip = 위아래 뒤집기) */
  private blitTurned(name: string, frame: number, cx: number, cy: number, rot: number, flip = false): void {
    const s = this.lod ? spriteHalf(name) : sprite(name);
    if (!s) return;
    const ctx = this.ctx;
    const u = this.lod ? this.u * 2 : this.u;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate((rot * Math.PI) / 2);
    if (flip) ctx.scale(1, -1);
    ctx.drawImage(s.img, (frame % s.frames) * s.w, 0, s.w, s.h, (-s.w / 2) * u, (-s.h / 2) * u, s.w * u, s.h * u);
    ctx.restore();
  }

  /** 건물 왼쪽 위 (sx, sy)에서 그림 픽셀 단위로 네모 (진행 막대, 석탄 칸 같은 덧그림) */
  private artRect(sx: number, sy: number, x: number, y: number, w: number, h: number, color: string): void {
    const u = this.u;
    this.ctx.fillStyle = color;
    this.ctx.fillRect(sx + x * u, sy + y * u, w * u, h * u);
  }

  /** 픽셀 숫자 (왼쪽 위 기준). big이면 두 배 굵기 */
  private drawNum(str: string, sx: number, sy: number, big = false): void {
    const kind = big ? 'num2' : 'num';
    for (let i = 0; i < str.length; i++) this.blit(`${kind}:${str[i]}`, 0, sx + i * NUM_ADVANCE[kind] * this.u, sy);
  }

  /** 1픽셀 테두리 글씨 (픽셀 글꼴이 또렷하게 정수 좌표에) */
  private text(
    str: string,
    x: number,
    y: number,
    color: string,
    size = 12,
    outline: string | null = PAL.ink,
    align: CanvasTextAlign = 'center',
    baseline: CanvasTextBaseline = 'middle',
  ): void {
    const ctx = this.ctx;
    ctx.font = font(size, this.textZoom);
    ctx.textAlign = align;
    ctx.textBaseline = baseline;
    x = this.snap(x, 'x');
    y = this.snap(y, 'y');
    if (outline) {
      // 테두리 1픽셀 = 글꼴 1픽셀 (글자 또렷하게를 켜면 기기 픽셀 하나)
      const d = this.textZoom;
      ctx.fillStyle = outline;
      for (const [dx, dy] of [[-d, 0], [d, 0], [0, -d], [0, d]]) ctx.fillText(str, x + dx, y + dy);
    }
    ctx.fillStyle = color;
    ctx.fillText(str, x, y);
  }

  /** 화면 좌표(CSS px)를 가장 가까운 기기 픽셀 경계로 (배율이 125%처럼 정수가 아니어도 글자가 또렷하게) */
  private snap(v: number, axis: 'x' | 'y'): number {
    const m = this.ctx.getTransform();
    const k = axis === 'x' ? m.a : m.d;
    const o = axis === 'x' ? m.e : m.f;
    return (Math.round(v * k + o) - o) / k;
  }

  /** 그림 픽셀 칸 (x, y, w, h) 안에 들어가는 가장 큰 크기로 글씨. 안 들어가면 그리지 않는다 */
  private label(str: string, sx: number, sy: number, box: { x: number; y: number; w: number; h: number }, color: string, pill = false): void {
    const u = this.u;
    const ctx = this.ctx;
    for (const size of [24, 12, 10]) {
      ctx.font = font(size, this.textZoom);
      const tw = ctx.measureText(str).width;
      const fs = size * this.textZoom;
      if (fs + 2 > box.h * u || tw + 4 > box.w * u) continue;
      const cx = sx + (box.x + box.w / 2) * u;
      const cy = sy + (box.y + box.h / 2) * u;
      if (pill) {
        const w = Math.round(tw + 6);
        const h = Math.round(fs + 4);
        const x = Math.round(cx - w / 2);
        const y = Math.round(cy - h / 2);
        ctx.fillStyle = PAL.ink;
        ctx.fillRect(x - 1, y - 1, w + 2, h + 2);
        ctx.fillStyle = CREAM;
        ctx.fillRect(x, y, w, h);
      }
      this.text(str, cx, cy + 1, color, size, pill ? null : PAL.ink);
      return;
    }
  }

  /** 2겹 테두리 (안쪽 색 + 바깥 잉크). dash면 점선 */
  private outline(sx: number, sy: number, w: number, h: number, color: string, dash = false): void {
    const ctx = this.ctx;
    if (dash) ctx.setLineDash([6, 4]);
    ctx.lineWidth = 4;
    ctx.strokeStyle = 'rgba(59,39,22,0.6)';
    ctx.strokeRect(sx + 1, sy + 1, w - 2, h - 2);
    ctx.lineWidth = 2;
    ctx.strokeStyle = color;
    ctx.strokeRect(sx + 1, sy + 1, w - 2, h - 2);
    if (dash) ctx.setLineDash([]);
  }

  // ───────────────────────── 바닥 ─────────────────────────

  /**
   * 땅·광맥은 묶음 그림으로, 물은 칸마다 (물결이 움직인다).
   * 멀리서 볼 때(LOD, 그림 1픽셀 < 화면 1픽셀)는 칸마다 바닥색 한 가지만: 돌·물결 없이 광맥 범위가 한눈에 보이게
   */
  private drawGround(world: World, x0: number, y0: number, x1: number, y1: number): void {
    const ctx = this.ctx;
    const cam = this.cam;
    const size = CHUNK * cam.zoom;
    const lod = this.lod;
    for (let cy = Math.floor(y0 / CHUNK); cy <= Math.floor(y1 / CHUNK); cy++) {
      for (let cx = Math.floor(x0 / CHUNK); cx <= Math.floor(x1 / CHUNK); cx++) {
        const [sx, sy] = cam.worldToScreen(cx * CHUNK, cy * CHUNK);
        ctx.drawImage(this.chunk(world, cx, cy, lod), sx, sy, size, size);
      }
    }
    if (lod) return;
    const t = world.time * 2.5;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const i = world.idx(x, y);
        if (world.resItem[i] !== 'water') continue;
        const h = hash(i);
        const [sx, sy] = cam.worldToScreen(x, y);
        this.blit(`water:${h & 3}`, Math.floor(t + ((h >>> 4) & 3)), sx, sy);
      }
    }
  }

  /**
   * 바닥 묶음 하나 (칸 그림이 바뀌었으면 다시 굽는다: 광맥이 줄어 돌이 작아질 때).
   * lod면 칸 하나 = 1픽셀짜리 작은 그림 (늘려 그리면 칸마다 단색 네모)
   */
  private chunk(world: World, cx: number, cy: number, lod: boolean): HTMLCanvasElement {
    let key = 0;
    for (let ty = 0; ty < CHUNK; ty++) {
      for (let tx = 0; tx < CHUNK; tx++) {
        const x = cx * CHUNK + tx;
        const y = cy * CHUNK + ty;
        const code = world.inBounds(x, y) ? groundCode(world, world.idx(x, y)) : 0;
        key = (Math.imul(key, 31) + code + 1) | 0;
      }
    }
    const id = cy * 65536 + cx;
    const cache = lod ? this.lodChunks : this.chunks;
    const cached = cache.get(id);
    if (cached && cached.key === key) return cached.canvas;
    const canvas = cached?.canvas ?? document.createElement('canvas');
    const px = lod ? 1 : TILE;
    canvas.width = canvas.height = CHUNK * px;
    const g = canvas.getContext('2d')!;
    g.imageSmoothingEnabled = false;
    g.fillStyle = BG;
    g.fillRect(0, 0, canvas.width, canvas.height);
    for (let ty = 0; ty < CHUNK; ty++) {
      for (let tx = 0; tx < CHUNK; tx++) {
        const x = cx * CHUNK + tx;
        const y = cy * CHUNK + ty;
        if (!world.inBounds(x, y)) continue;
        const i = world.idx(x, y);
        if (lod) {
          g.fillStyle = lodColor(world, i);
          g.fillRect(tx, ty, 1, 1);
          continue;
        }
        const s = sprite(groundSprite(world, i));
        if (s) g.drawImage(s.img, 0, 0, TILE, TILE, tx * TILE, ty * TILE, TILE, TILE);
      }
    }
    cache.set(id, { canvas, key });
    return canvas;
  }

  private drawGrid(x0: number, y0: number, x1: number, y1: number): void {
    const ctx = this.ctx;
    const cam = this.cam;
    const z = cam.zoom;
    const lw = 1 / this.dpr;
    const [sx0, sy0] = cam.worldToScreen(x0, y0);
    const [sx1, sy1] = cam.worldToScreen(x1 + 1, y1 + 1);
    ctx.fillStyle = GRID;
    for (let x = x0; x <= x1 + 1; x++) ctx.fillRect(sx0 + (x - x0) * z, sy0, lw, sy1 - sy0);
    for (let y = y0; y <= y1 + 1; y++) ctx.fillRect(sx0, sy0 + (y - y0) * z, sx1 - sx0, lw);
  }

  // ───────────────────────── 컨베이어·도로 ─────────────────────────

  private drawBelt(b: Building, phase: number): void {
    const name = b.type + (b.curveFrom === null ? '' : '-curve');
    // 굽은 그림은 아래에서 들어온다. 왼쪽(rel 3)에서 들어오면 위아래를 뒤집는다
    const flip = b.curveFrom !== null && (b.curveFrom - b.dir + 4) % 4 === 3;
    const [cx, cy] = this.cam.worldToScreen(b.x + 0.5, b.y + 0.5);
    this.blitTurned(name, Math.floor(phase * TILE), cx, cy, b.dir - 1, flip);
  }

  private drawBeltItems(b: Building): void {
    for (const it of b.items) {
      const [wx, wy] = beltItemWorldPos(b, it.pos);
      this.drawStack(it.item, wx, wy, it.n);
    }
  }

  /** 아이템 하나 (가운데 = 월드 좌표). 그림 픽셀 칸에 맞춰 찍는다. 2개부터 뒤에 하나 더, 3개부터 개수 */
  private drawStack(item: ItemId, wx: number, wy: number, n = 1): void {
    const u = this.u;
    const [sx, sy] = this.cam.worldToScreen(Math.round(wx * TILE - 4) / TILE, Math.round(wy * TILE - 4) / TILE);
    if (n >= 2) this.blit(`item:${item}`, 0, sx + 2 * u, sy - 2 * u);
    this.blit(`item:${item}`, 0, sx, sy);
    if (n >= 3 && this.n >= 1) this.drawNum(String(n), sx + 5 * u, sy + 3 * u);
  }

  /** 입구는 뒤 절반이 컨베이어·앞 절반이 굴 입구, 출구는 그 반대. 짝이 없으면 빨간 테 */
  private drawUnderground(world: World, b: Building, phase: number): void {
    const name = `underground-${b.ugMode === 'in' ? 'in' : 'out'}${world.partnerOf(b) ? '' : '-alone'}`;
    const [cx, cy] = this.cam.worldToScreen(b.x + 0.5, b.y + 0.5);
    this.blitTurned(name, Math.floor(phase * TILE), cx, cy, b.dir - 1);
  }

  /** 땅속 구간은 숨기고 입구·출구 칸에 있을 때만 그린다 */
  private drawUndergroundItems(world: World, b: Building): void {
    const entrance = b.ugMode === 'in' ? b : world.partnerOf(b);
    if (!entrance) return;
    const len = world.beltLength(entrance);
    const bx = entrance.x + 0.5 - DX[entrance.dir] * 0.5;
    const by = entrance.y + 0.5 - DY[entrance.dir] * 0.5;
    for (const it of entrance.items) {
      const visible = b.ugMode === 'in' ? it.pos < 0.5 : it.pos > len - 0.5;
      if (!visible) continue;
      this.drawStack(it.item, bx + DX[entrance.dir] * it.pos, by + DY[entrance.dir] * it.pos, it.n);
    }
  }

  /** 도로: 이웃한 도로·정류장 쪽은 이어지고 끊긴 쪽은 연석 */
  private drawRoad(world: World, b: Building): void {
    const [sx, sy] = this.cam.worldToScreen(b.x, b.y);
    this.blit(`road:${roadMask(world, b.x, b.y)}`, 0, sx, sy);
  }

  // ───────────────────────── 건물 ─────────────────────────

  /**
   * 창고 한 칸. 합쳐진 창고는 묶음 바깥쪽 변에만 테두리가 있는 조각을 골라 큰 상자 하나처럼 보인다.
   * 이름표·채운 정도는 묶음마다 한 번 (drawStorageInfo)
   */
  private drawStorage(world: World, b: Building): void {
    const g = storageBounds(world.storageGroup(b));
    const mask = (b.y === g.y0 ? 1 : 0) | (b.x + b.size === g.x1 ? 2 : 0) | (b.y + b.size === g.y1 ? 4 : 0) | (b.x === g.x0 ? 8 : 0);
    const [sx, sy] = this.cam.worldToScreen(b.x, b.y);
    this.blit(`storage:${mask}`, 0, sx, sy - this.hopLift(b) * this.u);
  }

  /** 창고 묶음 하나의 이름표(가장 많은 아이템), 채운 정도, 개수 (묶음 가운데에 한 번) */
  private drawStorageInfo(world: World, leader: Building): void {
    const group = world.storageGroup(leader);
    const g = storageBounds(group);
    const [sx, sy] = this.cam.worldToScreen(g.x0, g.y0);
    const gw = (g.x1 - g.x0) * TILE;
    const gh = (g.y1 - g.y0) * TILE;
    const total = world.storageTotal(leader);
    const cap = world.storageCapacity(leader);
    let top: ItemId | null = null;
    let max = 0;
    for (const [item, n] of world.storageContents(leader)) if (n > max) [top, max] = [item, n];
    // 이름표: 앞면을 뺀 윗면 가운데
    const px = Math.floor(gw / 2) - 5;
    const py = Math.floor((gh - 6) / 2) - 5;
    this.artRect(sx, sy, px, py, 10, 10, PAL.ink);
    this.artRect(sx, sy, px + 1, py + 1, 8, 8, CREAM);
    if (top) this.blit(`item:${top}`, 0, sx + (px + 1) * this.u, sy + (py + 1) * this.u);
    // 채운 정도: 앞면에
    this.drawBar(sx, sy, total / cap, total >= cap ? PAL.orange : PAL.brass.mid, { x: 3, y: gh - 7, w: gw - 6 });
    if (group.length > 1 && this.n >= 2) {
      this.text(`${total.toLocaleString()} / ${cap.toLocaleString()}`, sx + (gw / 2) * this.u, sy + (py + 10) * this.u + 9, CREAM, 12);
    }
  }

  private drawBuilding(world: World, b: Building): void {
    if (b.type === 'storage') return this.drawStorage(world, b);
    const [sx, sy0] = this.cam.worldToScreen(b.x, b.y);
    // 막 지었으면 툭 내려앉는 중 (이름표·막대·화살표도 같이)
    const sy = sy0 - this.hopLift(b) * this.u;
    // 멀리서: 몸체 그림만 (멈춘 채로, 이름표·막대·화살표 없이)
    if (this.lod) return this.blit(b.type === 'station' ? `station-${b.stationMode}` : b.type, 0, sx, sy);
    const u = this.u;
    const t = world.time;
    const working = b.status === 'working' || b.status === 'low-power';
    /** 일하는 동안 1~4 프레임을 돈다 (전력 부족이면 반 속도) */
    const anim = (on: boolean, fps = 8) =>
      on ? 1 + (Math.floor(t * (b.status === 'low-power' ? fps / 2 : fps) + b.id) % 4) : 0;
    /** 앞면 이름표에 아이템 */
    const plate = (item: ItemId | null | undefined) => {
      if (item) this.blit(`item:${item}`, 0, sx + MACHINE.plate.x * u, sy + MACHINE.plate.y * u);
    };

    switch (b.type) {
      case 'hub':
        this.blit('hub', Math.floor(t * 3), sx, sy);
        break;
      case 'miner':
      case 'miner-2':
        this.blit(b.type, anim(working, 10), sx, sy);
        plate(b.mineTiles.length ? world.resItem[b.mineTiles[b.mineIdx % b.mineTiles.length]] : null);
        break;
      case 'pump':
        this.blit('pump', anim(working, 5), sx, sy);
        plate('water');
        break;
      case 'smelter':
      case 'assembler':
      case 'crusher':
      case 'washer':
      case 'separator':
      case 'electric-furnace':
        this.blit(b.type, anim(working), sx, sy);
        plate(world.recipeOf(b)?.outputs[0].item);
        break;
      case 'generator': {
        this.blit('generator', anim(b.load > 0, 10), sx, sy);
        const fu = MACHINE.fuel;
        for (let k = 0; k < Math.min(fu.n, b.fuel); k++) {
          this.artRect(sx, sy, fu.x + k * fu.step, fu.y, fu.w, fu.h, '#2a2a2e');
          this.artRect(sx, sy, fu.x + k * fu.step, fu.y, 1, 1, '#77767f');
        }
        break;
      }
      case 'solar': {
        // 패널 위로 가끔 반짝임이 지나간다
        const step = Math.floor(t * 6 + b.id * 5) % 16;
        this.blit('solar', step < 4 ? step + 1 : 0, sx, sy);
        break;
      }
      case 'hydro':
        // 물이 많을수록 빨리 돈다. 물 눈금은 진행 막대 자리에
        this.blit('hydro', anim(b.load > 0, 4 + (b.load / 600) * 8), sx, sy);
        this.drawBar(sx, sy, b.fuel / 10, PAL.water.mid);
        break;
      case 'splitter':
      case 'overflow':
      case 'merger':
        this.blit(b.type, 0, sx, sy);
        if (b.held) this.drawStack(b.held, b.x + 0.5, b.y + 6 / TILE, b.heldN);
        break;
      case 'sorter':
      case 'unloader':
        // 고른 아이템을 뚜껑에. 안 골랐으면 분류기는 빨간 ?, 하역기는 "전부" (든 것을 번갈아 다 꺼낸다)
        this.blit(b.type, 0, sx, sy);
        if (b.filter) this.drawStack(b.filter, b.x + 0.5, b.y + 6 / TILE);
        else if (b.type === 'sorter') this.blit('num:?', 0, sx + 5 * u, sy + 3 * u);
        else this.label('전부', sx, sy, { x: 2, y: 2, w: 12, h: 9 }, PAL.ink, true);
        break;
      case 'station':
        this.drawStation(b, sx, sy);
        break;
      case 'charger':
        this.blit('charger', 0, sx, sy);
        break;
    }

    if (HAS_PORTS.includes(b.type)) this.drawPorts(b.type, b.dir, sx, sy, b.stationMode);

    // 진행 막대
    if (b.crafting) {
      const p = Math.min(1, b.progress / world.craftTime(b));
      this.drawBar(sx, sy, p, b.status === 'low-power' ? '#e8c547' : PAL.green);
    }
  }

  /** 정류장: 차양 색(싣기 초록·내리기 주황), 번호, 이름표(가장 많은 아이템), 쌓인 양 */
  private drawStation(b: Building, sx: number, sy: number): void {
    const u = this.u;
    const mode = b.stationMode;
    this.blit(`station-${mode}`, 0, sx, sy);
    const buf = mode === 'load' ? b.inBuf : b.outBuf;
    let total = 0;
    let top: ItemId | null = null;
    let max = 0;
    for (const [item, n] of buf) {
      total += n;
      if (n > max) [top, max] = [item, n];
    }
    const no = String(b.stationNo);
    const w = no.length * NUM_ADVANCE.num2 + 1;
    this.drawNum(no, sx + (MACHINE.stationNo.cx - Math.floor(w / 2)) * u, sy + MACHINE.stationNo.y * u, true);
    if (top) this.blit(`item:${top}`, 0, sx + MACHINE.plate.x * u, sy + MACHINE.plate.y * u);
    this.drawBar(sx, sy, total / STATION_CAPACITY, STATION_COLOR[mode]);
    this.label(mode === 'load' ? '싣기' : '내리기', sx, sy, MACHINE.faceText, CREAM);
  }

  /** 앞면 막대 (틀 + 안쪽 2줄). 기본 자리는 2×2 기계 공통 */
  private drawBar(sx: number, sy: number, p: number, color: string, at = MACHINE.bar): void {
    const { x, y, w } = at;
    this.artRect(sx, sy, x, y, w, 4, PAL.ink);
    this.artRect(sx, sy, x + 1, y + 1, w - 2, 2, '#4a3a2c');
    const fill = Math.round((w - 2) * Math.max(0, Math.min(1, p)));
    if (fill <= 0) return;
    this.artRect(sx, sy, x + 1, y + 1, fill, 2, color);
    this.artRect(sx, sy, x + 1, y + 1, fill, 1, 'rgba(255,255,255,0.35)');
  }

  /**
   * 입출구 화살표. 기계는 앞면에 출구 하나,
   * 분배기는 뒤에 입구(안쪽 화살표)와 앞·양옆에 출구(바깥 화살표).
   * 몸체 그림은 돌리지 않으니 방향은 이 화살표로만 보인다.
   */
  private drawPorts(type: BuildingType, dir: Dir, sx: number, sy: number, mode: StationMode = 'load'): void {
    const ctx = this.ctx;
    const u = this.u;
    const S = BUILDINGS[type].size * TILE;
    const small = S === TILE ? '-s' : '';
    ctx.save();
    ctx.translate(sx + (S / 2) * u, sy + (S / 2) * u);
    ctx.rotate((dir * Math.PI) / 2);
    // rot만큼 돌린 가장자리 가운데에. 끝이 바깥으로 2픽셀 나온다. inward면 안쪽을 가리킨다
    const arrow = (rot: number, name: string, inward = false) => {
      const s = sprite(name + small);
      if (!s) return;
      ctx.save();
      ctx.rotate(rot);
      ctx.translate(0, (-S / 2) * u);
      if (inward) ctx.scale(1, -1);
      ctx.drawImage(s.img, 0, 0, s.w, s.h, (-s.w / 2) * u, -2 * u, s.w * u, s.h * u);
      ctx.restore();
    };
    if (type === 'splitter' || type === 'overflow' || type === 'sorter') {
      const side = type === 'overflow' ? 'arrow-out-dim' : 'arrow-out';
      arrow(Math.PI, 'arrow-in', true);
      arrow(0, 'arrow-out');
      arrow(Math.PI / 2, side);
      arrow(-Math.PI / 2, side);
    } else if (type === 'unloader') {
      // 뒤에 붙은 허브·창고에서 꺼내 앞으로
      arrow(Math.PI, 'arrow-in', true);
      arrow(0, 'arrow-out');
    } else if (type === 'merger') {
      // 뒤·양옆 세 곳이 입구, 앞 하나가 출구 (분배기의 반대)
      arrow(Math.PI, 'arrow-in', true);
      arrow(Math.PI / 2, 'arrow-in', true);
      arrow(-Math.PI / 2, 'arrow-in', true);
      arrow(0, 'arrow-out');
    } else if (type === 'station') {
      // 싣기: 아무 면으로나 받는다, 내리기: 앞으로 내보낸다
      if (mode === 'load') for (let k = 0; k < 4; k++) arrow((k * Math.PI) / 2, 'arrow-in', true);
      else arrow(0, 'arrow-out');
    } else {
      arrow(0, 'arrow-out');
    }
    ctx.restore();
  }

  /** 트럭: 가까운 네 방향 그림, 짐 양에 따라 빈 차·조금·가득. 멈춘 이유가 있으면 ! */
  /** at: 그릴 자리 (줄 선 트럭은 실제 자리와 다르다) */
  private drawTruck(v: Vehicle, selected: boolean, at: { x: number; y: number; angle: number }): void {
    const u = this.u;
    const dir = (((Math.round(at.angle / (Math.PI / 2)) + 1) % 4) + 4) % 4;
    const fill = v.load / TRUCK.capacity;
    const [sx, sy] = this.cam.worldToScreen(Math.round(at.x * TILE - 8) / TILE, Math.round(at.y * TILE - 8) / TILE);
    if (selected) {
      // 차 모양(가로 16×12, 세로 12×16)에 맞춘 테두리
      const side = dir % 2 === 1;
      this.outline(sx + (side ? -1 : 1) * u, sy + (side ? 1 : -1) * u, (side ? 18 : 14) * u, (side ? 14 : 18) * u, SELECT);
    }
    this.blit(`truck:${dir}`, fill <= 0 ? 0 : fill < 0.5 ? 1 : 2, sx, sy);
    if (this.lod) return;
    if (v.status === 'no-route' || v.status === 'no-station' || v.status === 'unload-full' || v.status === 'no-battery') {
      // 꽉 참·배터리 없음은 주황(멈추지는 않음), 나머지는 빨강
      const orange = v.status === 'unload-full' || v.status === 'no-battery';
      this.blit(orange ? 'badge:alert-full' : 'badge:alert', 0, sx + 4 * u, sy - 7 * u);
    }
  }

  /** 고른 트럭의 노선: 정류장마다 점선 테두리 + "1 싣기 철광석 · 3 내리기"처럼 차례와 할 일 (지금 가는 곳은 ▶), 지금 가는 길 */
  private drawRoute(world: World, v: Vehicle): void {
    const ctx = this.ctx;
    const cam = this.cam;
    const z = cam.zoom;
    // 한 정류장을 노선에 여러 번 넣을 수 있으므로 정류장마다 묶는다
    const marks = new Map<number, { labels: string[]; act: 'load' | 'unload' }>();
    v.stops.forEach((s, i) => {
      const m = marks.get(s.id) ?? { labels: [], act: s.act };
      const what = s.act === 'load' ? `싣기${s.item ? ` ${ITEMS[s.item].name}` : ''}` : '내리기';
      m.labels.push(`${i === v.stop ? '▶' : ''}${i + 1} ${what}`);
      marks.set(s.id, m);
    });
    for (const [id, m] of marks) {
      const st = world.buildings.get(id);
      if (st?.type !== 'station') continue;
      const [sx, sy] = cam.worldToScreen(st.x, st.y);
      const w = st.size * z;
      this.outline(sx - 3, sy - 3, w + 6, w + 6, STATION_COLOR[m.act], true);
      this.text(m.labels.join(' · '), sx + w / 2, sy - 7, '#fbf3df', 12, PAL.ink, 'center', 'bottom');
    }
    if (!v.path || (v.state !== 'to-load' && v.state !== 'to-unload')) return;
    ctx.strokeStyle = 'rgba(217,140,30,0.9)';
    ctx.lineWidth = Math.max(2, z * 0.08);
    ctx.setLineDash([z * 0.2, z * 0.15]);
    ctx.beginPath();
    ctx.moveTo(...cam.worldToScreen(v.x, v.y));
    for (const t of [v.tile, ...v.path]) {
      ctx.lineTo(...cam.worldToScreen((t % world.width) + 0.5, Math.floor(t / world.width) + 0.5));
    }
    ctx.stroke();
    ctx.setLineDash([]);
  }

  /**
   * 생산량 표시: 기계 위쪽 가운데에 "32/분", 바탕색은 가동률 (초록 ≥90%, 노랑 ≥50%, 빨강).
   * 정류장은 오가는 트럭들의 운송량 합 (한 바퀴 기준, 아직 한 바퀴를 못 돌았으면 …)
   */
  private drawRate(world: World, b: Building): void {
    let text: string;
    let bg: string;
    if (b.type === 'station') {
      const rates = world.trucksOf(b).map((v) => v.perMinute);
      if (!rates.length) return;
      const known = rates.filter((r): r is number => r !== null);
      text = known.length ? `🚚 ${Math.round(known.reduce((s, r) => s + r, 0))}/분` : '🚚 …';
      bg = '#8a6d1f';
    } else {
      const st = world.machineStats(b);
      if (!st) return;
      text = st.measuring ? '…' : `${Math.round(st.maxOut[0].count * st.util)}/분`;
      bg = st.measuring ? '#7d7567' : st.util >= 0.9 ? '#3f8a3a' : st.util >= 0.5 ? '#a8862a' : '#a33a3a';
    }
    const ctx = this.ctx;
    const [sx, sy] = this.cam.worldToScreen(b.x, b.y);
    const w = b.size * this.cam.zoom;
    ctx.font = font(12, this.textZoom);
    const tw = Math.ceil(ctx.measureText(text).width) + 8;
    const th = Math.round(12 * this.textZoom) + 4;
    const x = Math.round(sx + w / 2 - tw / 2);
    const y = Math.round(sy - th / 2);
    ctx.fillStyle = PAL.ink;
    ctx.fillRect(x - 1, y - 1, tw + 2, th + 2);
    ctx.fillStyle = bg;
    ctx.fillRect(x, y, tw, th);
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ctx.fillRect(x, y, tw, 1);
    this.text(text, x + tw / 2, y + th / 2 + 1, '#fff', 12, null);
  }

  private drawBadge(b: Building, extra?: string): void {
    const name = STATUS_BADGE[b.status] ?? extra;
    if (!name) return;
    // 오른쪽 위 모서리에 걸쳐서 (건물을 덜 가리게)
    const [sx, sy] = this.cam.worldToScreen(b.x, b.y);
    this.blit(`badge:${name}`, 0, sx + (b.size * TILE - 7) * this.u, sy - 3 * this.u);
  }

  /** centered = true면 (hx, hy)를 커서 칸으로 보고 건물 중심을 맞춘다. false면 왼쪽 위 좌표 */
  private drawGhost(
    world: World,
    tool: BuildingType,
    dir: Dir,
    hx: number,
    hy: number,
    centered = true,
    setting: string | null = null,
  ): void {
    const ctx = this.ctx;
    const cam = this.cam;
    const z = cam.zoom;
    const u = this.u;
    const def = BUILDINGS[tool];
    const [ox, oy] = centered ? World.originFor(tool, hx, hy) : [hx, hy];
    // 도구 미리보기는 클릭 한 번과 같은 규칙: 컨베이어 위면 덮어쓰고 흐름 방향을 따른다
    const replace = centered && !isBeltType(tool) && tool !== 'road';
    const flow = replace ? world.flowDirUnder(tool, ox, oy, hx, hy) : null;
    if (flow !== null) dir = flow;
    if (tool === 'unloader') dir = world.unloaderDir(ox, oy, dir) ?? dir;
    // 허브·창고에 붙인 정류장은 그쪽을 앞으로 한 내리기 정류장이 된다
    const facing = tool === 'station' ? world.stationFacing(ox, oy) : null;
    if (facing !== null) {
      dir = facing;
      setting = 'unload';
    }
    const ok = world.canPlace(tool, ox, oy, replace).ok;
    const [sx, sy] = cam.worldToScreen(ox, oy);
    const w = def.size * z;
    ctx.globalAlpha = 0.6;
    this.drawSpriteOf(world, tool, dir, ox, oy, setting);
    ctx.globalAlpha = 1;
    if (!ok) {
      ctx.fillStyle = 'rgba(217,83,74,0.45)';
      ctx.fillRect(sx, sy, w, w);
    }
    this.outline(sx, sy, w, w, ok ? '#7fd17a' : PAL.red);
    const shown = !setting ? null : tool === 'sorter' || tool === 'unloader' ? (setting as ItemId) : RECIPES[setting]?.outputs[0].item;
    if (shown) {
      if (def.size === 1) this.drawStack(shown, ox + 0.5, oy + 6 / TILE);
      else this.blit(`item:${shown}`, 0, sx + MACHINE.plate.x * u, sy + MACHINE.plate.y * u);
    }
    // 지워질 컨베이어에 ×
    if (replace && ok) {
      ctx.strokeStyle = PAL.red;
      ctx.lineWidth = Math.max(1.5, z * 0.07);
      ctx.beginPath();
      for (const b of world.beltsUnder(tool, ox, oy)) {
        const [bx, by] = cam.worldToScreen(b.x, b.y);
        ctx.moveTo(bx + z * 0.3, by + z * 0.3);
        ctx.lineTo(bx + z * 0.7, by + z * 0.7);
        ctx.moveTo(bx + z * 0.7, by + z * 0.3);
        ctx.lineTo(bx + z * 0.3, by + z * 0.7);
      }
      ctx.stroke();
    }
    if (tool === 'underground' && ok) {
      // 입구가 될지 출구가 될지, 출구를 놓을 수 있는 범위
      const plan = world.undergroundPlan(ox, oy, dir);
      this.text(plan.mode === 'in' ? '입구' : '출구', sx + w / 2, sy - 3, '#fbf3df', 12, PAL.ink, 'center', 'bottom');
      if (plan.partner) {
        const [px2, py2] = cam.worldToScreen(plan.partner.x + 0.5, plan.partner.y + 0.5);
        ctx.strokeStyle = 'rgba(158,117,38,0.9)';
        ctx.lineWidth = 2;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(sx + w / 2, sy + w / 2);
        ctx.lineTo(px2, py2);
        ctx.stroke();
        ctx.setLineDash([]);
      } else {
        // 출구 자리 후보: 그림 2픽셀 점
        ctx.fillStyle = 'rgba(158,117,38,0.75)';
        for (let k = 2; k <= UNDERGROUND_MAX_GAP + 1; k++) {
          const [dx2, dy2] = cam.worldToScreen(ox + DX[dir] * k + 0.5, oy + DY[dir] * k + 0.5);
          const r = Math.max(2, Math.round(u * 1.5));
          ctx.fillRect(Math.round(dx2 - r), Math.round(dy2 - r), r * 2, r * 2);
        }
      }
    }
    if (HAS_PORTS.includes(tool)) {
      this.drawPorts(tool, dir, sx, sy, tool === 'station' && setting === 'unload' ? 'unload' : 'load');
    } else if (isBeltType(tool) || tool === 'underground') {
      this.drawDirArrow(sx + w / 2, sy + w / 2, dir, z, '#fbf3df');
    }
  }

  /** 건물 종류만으로 그림 한 장 (미리보기·붙여넣기) */
  private drawSpriteOf(world: World, tool: BuildingType, dir: Dir, ox: number, oy: number, setting: string | null): void {
    const size = BUILDINGS[tool].size;
    const [sx, sy] = this.cam.worldToScreen(ox, oy);
    const [cx, cy] = this.cam.worldToScreen(ox + size / 2, oy + size / 2);
    if (isBeltType(tool)) return this.blitTurned(tool, 0, cx, cy, dir - 1);
    if (tool === 'underground') return this.blitTurned(`underground-${world.undergroundPlan(ox, oy, dir).mode}`, 0, cx, cy, dir - 1);
    if (tool === 'road') return this.blit(`road:${roadMask(world, ox, oy)}`, 0, sx, sy);
    if (tool === 'storage') return this.blit('storage:15', 0, sx, sy);
    if (tool === 'station') return this.blit(`station-${setting === 'unload' ? 'unload' : 'load'}`, 0, sx, sy);
    this.blit(tool, 0, sx, sy);
  }

  /** 컨베이어 미리보기의 방향 화살표 */
  private drawDirArrow(cx: number, cy: number, dir: Dir, z: number, color: string): void {
    const ctx = this.ctx;
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(1.5, z * 0.08);
    ctx.beginPath();
    ctx.moveTo(cx - DX[dir] * z * 0.3, cy - DY[dir] * z * 0.3);
    ctx.lineTo(cx + DX[dir] * z * 0.3, cy + DY[dir] * z * 0.3);
    const px = -DY[dir];
    const py = DX[dir];
    ctx.moveTo(cx + DX[dir] * z * 0.3, cy + DY[dir] * z * 0.3);
    ctx.lineTo(cx + DX[dir] * z * 0.1 + px * z * 0.18, cy + DY[dir] * z * 0.1 + py * z * 0.18);
    ctx.moveTo(cx + DX[dir] * z * 0.3, cy + DY[dir] * z * 0.3);
    ctx.lineTo(cx + DX[dir] * z * 0.1 - px * z * 0.18, cy + DY[dir] * z * 0.1 - py * z * 0.18);
    ctx.stroke();
  }

  // ───────────────────────── 같이 하기 ─────────────────────────

  /** 다른 사람의 커서·이름표, 들고 있는 건물, 드래그 중인 영역, 그리고 핑 (월드 위, 마지막에 그린다) */
  drawPresence(cam: Camera, others: OtherPlayer[], pings: PingMark[]): void {
    const ctx = this.ctx;
    const z = cam.zoom;
    for (const o of others) {
      const s = o.s;
      ctx.globalAlpha = o.idle ? 0.4 : 1;
      if (s.sel) this.drawArea(cam, s.sel, o.color, 'rgba(63,134,196,0.12)');
      if (s.rem) this.drawArea(cam, s.rem, o.color, 'rgba(217,83,74,0.18)');
      if (s.at) {
        const hx = Math.floor(s.at[0]);
        const hy = Math.floor(s.at[1]);
        if (s.paste) {
          this.drawArea(cam, { x0: hx, y0: hy, x1: hx + s.paste.w - 1, y1: hy + s.paste.h - 1 }, o.color, 'rgba(255,255,255,0.1)');
        } else if (s.tool) {
          const [ox, oy] = World.originFor(s.tool, hx, hy);
          const def = BUILDINGS[s.tool];
          const [sx, sy] = cam.worldToScreen(ox, oy);
          const w = def.size * z;
          ctx.save();
          ctx.globalAlpha *= 0.3;
          ctx.fillStyle = def.color;
          ctx.fillRect(sx, sy, w, w);
          ctx.restore();
          ctx.strokeStyle = o.color;
          ctx.lineWidth = 2;
          ctx.setLineDash([5, 3]);
          ctx.strokeRect(sx + 1, sy + 1, w - 2, w - 2);
          ctx.setLineDash([]);
          if (HAS_PORTS.includes(s.tool)) this.drawPorts(s.tool, s.dir, sx, sy);
          else if (isBeltType(s.tool) || s.tool === 'underground') this.drawDirArrow(sx + w / 2, sy + w / 2, s.dir, z, o.color);
        }
        const [cx, cy] = cam.worldToScreen(s.at[0], s.at[1]);
        this.drawCursor(cx, cy, o.color, o.name);
      }
    }
    ctx.globalAlpha = 1;
    for (const p of pings) this.drawPing(cam, p);
  }

  /** 다른 사람의 드래그 영역: 그 사람 색 점선 */
  private drawArea(cam: Camera, a: { x0: number; y0: number; x1: number; y1: number }, color: string, fill: string): void {
    const ctx = this.ctx;
    const z = cam.zoom;
    const [sx, sy] = cam.worldToScreen(Math.min(a.x0, a.x1), Math.min(a.y0, a.y1));
    const w = (Math.abs(a.x1 - a.x0) + 1) * z;
    const h = (Math.abs(a.y1 - a.y0) + 1) * z;
    ctx.fillStyle = fill;
    ctx.fillRect(sx, sy, w, h);
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    ctx.strokeRect(sx + 1, sy + 1, w - 2, h - 2);
    ctx.setLineDash([]);
  }

  /** 화살표 커서 + 이름표 */
  private drawCursor(x: number, y: number, color: string, name: string): void {
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x, y + 17);
    ctx.lineTo(x + 4.5, y + 13);
    ctx.lineTo(x + 7.5, y + 19.5);
    ctx.lineTo(x + 10, y + 18.4);
    ctx.lineTo(x + 7.2, y + 12);
    ctx.lineTo(x + 12.5, y + 12);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
    ctx.strokeStyle = 'rgba(10,12,15,0.85)';
    ctx.lineWidth = 1.2;
    ctx.stroke();
    this.drawTag(x + 12, y + 18, name, color);
  }

  /** 색 바탕 이름표 (왼쪽 위 기준) */
  private drawTag(x: number, y: number, text: string, color: string): void {
    const ctx = this.ctx;
    ctx.font = font(12, this.textZoom);
    const w = ctx.measureText(text).width + 10;
    const h = Math.round(12 * this.textZoom) + 5;
    ctx.fillStyle = color;
    ctx.beginPath();
    roundRect(ctx, x, y, w, h, 4);
    ctx.fill();
    ctx.fillStyle = '#14171b';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, this.snap(x + 5, 'x'), this.snap(y + h / 2 + 0.5, 'y'));
  }

  /** 핑: 퍼지는 동그라미. 화면 밖이면 가장자리에 그쪽을 가리키는 화살표 */
  private drawPing(cam: Camera, p: PingMark): void {
    const ctx = this.ctx;
    const [px, py] = cam.worldToScreen(p.x, p.y);
    const fade = Math.min(1, (p.life - p.age) / 1);
    ctx.globalAlpha = Math.max(0, fade);
    const margin = 28;
    const inside = px >= margin && py >= margin && px <= cam.viewW - margin && py <= cam.viewH - margin;
    if (inside) {
      for (let k = 0; k < 2; k++) {
        const f = (p.age * 0.9 + k * 0.5) % 1;
        ctx.strokeStyle = p.color;
        ctx.globalAlpha = Math.max(0, fade) * (1 - f);
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(px, py, 6 + f * 46, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.globalAlpha = Math.max(0, fade);
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(px, py, 5, 0, Math.PI * 2);
      ctx.fill();
      this.drawTag(px + 8, py - 26, p.name, p.color);
    } else {
      // 화면 가운데에서 핑 쪽으로 그은 선이 가장자리와 만나는 곳
      const cx = cam.viewW / 2;
      const cy = cam.viewH / 2;
      const dx = px - cx;
      const dy = py - cy;
      const k = Math.min((cx - margin) / Math.abs(dx || 1e-9), (cy - margin) / Math.abs(dy || 1e-9));
      const ex = cx + dx * k;
      const ey = cy + dy * k;
      const a = Math.atan2(dy, dx);
      const pulse = 1 + 0.15 * Math.sin(p.age * 8);
      ctx.save();
      ctx.translate(ex, ey);
      ctx.rotate(a);
      ctx.scale(pulse, pulse);
      ctx.beginPath();
      ctx.moveTo(14, 0);
      ctx.lineTo(-8, -10);
      ctx.lineTo(-8, 10);
      ctx.closePath();
      ctx.fillStyle = p.color;
      ctx.fill();
      ctx.strokeStyle = 'rgba(10,12,15,0.85)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.restore();
      ctx.font = font(12, this.textZoom);
      const tw = ctx.measureText(p.name).width + 10;
      const tx = Math.min(cam.viewW - tw - 4, Math.max(4, ex - tw / 2 - Math.cos(a) * 30));
      const ty = Math.min(cam.viewH - 21, Math.max(44, ey - 8 - Math.sin(a) * 26));
      this.drawTag(tx, ty, p.name, p.color);
    }
    ctx.globalAlpha = 1;
  }
}

/** 같이 하기: 다른 사람 한 명의 커서 (renderer.drawPresence에 넘긴다) */
export interface OtherPlayer {
  name: string;
  color: string;
  s: Presence;
  /** 한동안 소식이 없음 (흐리게) */
  idle: boolean;
}

export interface PingMark {
  x: number;
  y: number;
  name: string;
  color: string;
  /** 찍은 지 지난 시간, 남아 있는 전체 시간 (초) */
  age: number;
  life: number;
}

/** 컨베이어 위 아이템의 월드 좌표. 굽은 컨베이어는 2차 베지어 곡선을 따른다. */
export function beltItemWorldPos(b: Building, pos: number): [number, number] {
  const cx = b.x + 0.5;
  const cy = b.y + 0.5;
  const fx = DX[b.dir];
  const fy = DY[b.dir];
  if (b.curveFrom === null) return [cx + fx * (pos - 0.5), cy + fy * (pos - 0.5)];
  const sx = cx + DX[b.curveFrom] * 0.5;
  const sy = cy + DY[b.curveFrom] * 0.5;
  const ex = cx + fx * 0.5;
  const ey = cy + fy * 0.5;
  const u = 1 - pos;
  return [u * u * sx + 2 * u * pos * cx + pos * pos * ex, u * u * sy + 2 * u * pos * cy + pos * pos * ey];
}

/** 도로 그림 번호: 이웃한 도로·정류장 쪽 비트 (1 위, 2 오른쪽, 4 아래, 8 왼쪽) */
function roadMask(world: World, x: number, y: number): number {
  let mask = 0;
  for (let d = 0; d < 4; d++) {
    const n = world.buildingAt(x + DX[d], y + DY[d]);
    if (n && (n.type === 'road' || n.type === 'station')) mask |= 1 << d;
  }
  return mask;
}

/** 광맥 돌 크기: 매장량에 따라 큰 돌 1~3개 (무한은 3) */
function richness(amount: number): number {
  return amount >= 600 ? 3 : amount >= 250 ? 2 : 1;
}

/** 바닥 칸 그림 이름 (물은 따로 그린다) */
function groundSprite(world: World, i: number): string {
  const item = world.resItem[i];
  const h = hash(i);
  if (item && ORE_TILES.includes(item)) return `ore:${item}:${richness(world.resAmount[i])}:${(h >>> 3) & 3}`;
  return `ground:${h & 7}`;
}

/** 바닥 칸 그림이 바뀌었는지 볼 번호 */
function groundCode(world: World, i: number): number {
  const item = world.resItem[i];
  if (item === 'water') return 99;
  const k = item ? ORE_TILES.indexOf(item) : -1;
  return k < 0 ? 0 : 1 + k * 4 + richness(world.resAmount[i]);
}

/** 멀리서 볼 때 칸 색: 땅, 물, 광맥 바닥색 (매장량이 많으면 진하게, 적으면 옅게) */
function lodColor(world: World, i: number): string {
  const item = world.resItem[i];
  if (item === 'water') return PAL.water.lo;
  const base = item ? ORE_GROUND[item] : undefined;
  if (!base) return PAL.ground[0];
  const rich = richness(world.resAmount[i]);
  return rich === 3 ? tone(base, -0.12) : rich === 2 ? base : tone(base, 0.25);
}
