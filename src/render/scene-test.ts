import 'galmuri/dist/galmuri.css';
import { BUILDINGS, type BuildingType } from '../data/buildings';
import { ITEM_IDS, type ItemId } from '../data/items';
import { RECIPES } from '../data/recipes';
import type { Building } from '../sim/building';
import type { Dir } from '../sim/dir';
import { generateWorld } from '../sim/mapgen';
import { DT } from '../sim/world';
import { Camera } from './camera';
import { Renderer, type ViewState } from './renderer';

/**
 * 그림 확인용 장면 (개발용, /scene.html): 모든 건물을 한 줄씩 늘어놓고 진짜 렌더러로 그린다.
 * ?scale=3 (그림 배율), ?ghost=smelter (마우스 미리보기), ?rates=1, ?select=1
 * 게임 저장과 상관없는 따로 만든 월드라 마음대로 바꿔도 된다.
 */
const params = new URLSearchParams(location.search);
const world = generateWorld(4242);
for (const t of Object.keys(BUILDINGS)) world.unlockedBuildings.add(t as BuildingType);
for (const r of Object.keys(RECIPES)) world.unlockedRecipes.add(r);
for (const i of ITEM_IDS) world.stock.set(i, 99999);

const hub = world.hub!;
const ax = hub.x + 5;
const ay = hub.y - 2;
const put = (type: BuildingType, x: number, y: number, dir: Dir = 1): Building | null => world.place(type, ax + x, ay + y, dir, true);

// 1줄: 기계 (늘 일하는 것처럼 보이게 아래에서 상태를 덮어쓴다)
const showcase: Building[] = [];
const machines: [BuildingType, string | null][] = [
  ['miner', null],
  ['miner-2', null],
  ['smelter', 'iron-plate'],
  ['assembler', 'gear'],
  ['crusher', 'crush-stone'],
  ['washer', 'wash'],
  ['separator', 'separate'],
  ['electric-furnace', 'steel-e'],
  ['pump', null],
  ['generator', null],
  ['solar', null],
  ['hydro', null],
];
machines.forEach(([type, recipe], k) => {
  const b = put(type, k * 3, 0, (k % 4) as Dir);
  if (!b) return;
  if (recipe) world.setRecipe(b, recipe);
  showcase.push(b);
});

// 2줄: 컨베이어 (곧은 것, 굽은 것, 고속, 지하) + 쌓인 아이템
const line: [number, number, Dir, BuildingType][] = [
  [0, 4, 1, 'belt'],
  [1, 4, 1, 'belt'],
  [2, 4, 2, 'belt'],
  [2, 5, 2, 'belt'],
  [2, 6, 1, 'belt'],
  [3, 6, 1, 'belt'],
  [4, 6, 0, 'belt'],
  [4, 5, 0, 'belt'],
  [4, 4, 1, 'belt'],
  [5, 4, 1, 'fast-belt'],
  [6, 4, 1, 'fast-belt'],
  [7, 4, 1, 'fast-belt'],
];
for (const [x, y, d, t] of line) put(t, x, y, d);
put('underground', 9, 4, 1);
put('underground', 12, 4, 1);
put('underground', 14, 4, 1);
const stacks: [number, number, ItemId, number][] = [
  [0, 4, 'iron-ore', 1],
  [1, 4, 'copper-plate', 2],
  [5, 4, 'gear', 3],
  [6, 4, 'circuit', 4],
  [7, 4, 'coal', 2],
];
for (const [x, y, item, n] of stacks) {
  const b = world.buildingAt(ax + x, ay + y)!;
  b.items.push({ item, pos: 0.25, n }, { item, pos: 0.75, n: 1 });
}

// 3줄: 1칸 물류 상자, 창고 (하나, 2×1 묶음)
const boxes: [BuildingType, ItemId | null][] = [
  ['splitter', 'iron-plate'],
  ['overflow', null],
  ['sorter', null],
  ['sorter', 'gear'],
  ['merger', 'copper-ore'],
  ['unloader', null],
  ['unloader', 'stone'],
];
boxes.forEach(([type, item], k) => {
  const b = put(type, 17 + k * 2, 4, 1);
  if (!b || !item) return;
  if (type === 'sorter' || type === 'unloader') world.setFilter(b, item);
  else {
    b.held = item;
    b.heldN = k % 3 === 0 ? 3 : 1;
  }
});
put('storage', 0, 8);
put('storage', 3, 8);
put('storage', 5, 8);
put('storage', 3, 10);
put('storage', 5, 10);

// 4줄: 도로와 정류장 둘, 트럭
const sA = put('station', 9, 8, 1);
const sB = put('station', 22, 8, 3);
if (sB) world.setStationMode(sB, 'unload');
for (let x = 11; x < 22; x++) put('road', x, 9, 1);
put('road', 16, 10, 1);
put('road', 16, 11, 1);
if (sA) world.buildTruck(sA);
if (sA) world.buildTruck(sA);

const canvas = document.getElementById('game') as HTMLCanvasElement;
const camera = new Camera();
const renderer = new Renderer(canvas);
const scale = Number(params.get('scale') ?? 2);
camera.x = ax + 17;
camera.y = ay + 6;
renderer.resize(camera);
camera.zoom = (scale * 16) / (window.devicePixelRatio || 1);
window.addEventListener('resize', () => renderer.resize(camera));
// 휠로 줌, 드래그로 이동
canvas.addEventListener('wheel', (e) => camera.zoomAt(e.clientX, e.clientY, e.deltaY < 0 ? 1.15 : 1 / 1.15));
canvas.addEventListener('mousemove', (e) => {
  if (e.buttons !== 1) return;
  camera.x -= e.movementX / camera.zoom;
  camera.y -= e.movementY / camera.zoom;
});

const ghost = params.get('ghost') as BuildingType | null;
const view: ViewState = {
  tool: ghost,
  toolDir: 1,
  hover: ghost ? { x: ax + 30, y: ay + 6 } : null,
  selectedId: params.get('select') ? (showcase[2]?.id ?? null) : null,
  selectedVehicle: params.get('select') ? ([...world.vehicles.keys()][0] ?? null) : null,
  selection: null,
  removeArea: null,
  paste: null,
  toolSetting: ghost === 'smelter' ? 'iron-plate' : null,
  showRates: !!params.get('rates'),
};

let last = performance.now();
let acc = 0;
function frame(now: number): void {
  acc += Math.min(0.25, (now - last) / 1000);
  last = now;
  while (acc >= DT) {
    world.tick();
    acc -= DT;
  }
  // 늘어놓은 기계는 늘 일하는 것처럼
  for (const b of showcase) {
    b.status = 'working';
    b.load = 300;
    b.fuel = 3;
    b.crafting = b.type !== 'generator' && b.type !== 'solar' && b.type !== 'hydro';
    b.progress = (world.time % 2) * 0.5;
  }
  renderer.draw(world, camera, view);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
(window as unknown as { scene: unknown }).scene = { world, camera, view };
