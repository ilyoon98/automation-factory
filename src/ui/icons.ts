import type { BuildingType } from '../data/buildings';
import { ITEMS, type ItemId } from '../data/items';
import { loadSpriteOverrides, sprite } from '../render/pixel';
import '../render/pixel-buildings';

/**
 * DOM에서 쓰는 아이콘: 맵과 같은 픽셀 그림을 작은 캔버스에 찍어 data URL로 캐시.
 * 그림 크기 그대로 만들고(아이템 8×8, 칸 16×16, 건물 32×32) CSS에서 정수 배로 키운다 (image-rendering: pixelated)
 */
const cache = new Map<string, string>();
/** 아이콘마다 만든 방법 (PNG를 바꿔 끼우면 다시 만들려고) */
const recipes = new Map<string, () => string>();

/** 그림 한 장을 size×size 캔버스 가운데에 k배로 (frame = 가로 몇 번째 프레임) */
function spriteUrl(key: string, name: string, size: number, k = 1, frame = 0): string {
  const url = cache.get(key);
  if (url) return url;
  recipes.set(key, () => paintIcon(key, name, size, k, frame));
  return paintIcon(key, name, size, k, frame);
}

function paintIcon(key: string, name: string, size: number, k: number, frame: number): string {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  const s = sprite(name);
  if (s) {
    ctx.imageSmoothingEnabled = k >= 1;
    const w = s.w * k;
    const h = s.h * k;
    ctx.drawImage(s.img, (frame % s.frames) * s.w, 0, s.w, s.h, Math.floor((size - w) / 2), Math.floor((size - h) / 2), w, h);
  }
  const url = c.toDataURL();
  cache.set(key, url);
  return url;
}

/**
 * 직접 그린 PNG(public/sprites)가 늦게 들어오면 아이콘을 새 그림으로 다시 만들고,
 * 이미 화면에 있는 아이콘(툴바, 열려 있는 도감·정보창)도 바꿔 끼운다
 */
loadSpriteOverrides().then((names) => {
  if (!names.length) return;
  const old = new Map<string, string>();
  for (const [key, url] of cache) old.set(url, key);
  cache.clear();
  const fresh = new Map<string, string>();
  for (const [key, make] of recipes) fresh.set(key, make());
  for (const img of document.querySelectorAll('img')) {
    const key = old.get(img.getAttribute('src') ?? '');
    const url = key && fresh.get(key);
    if (url) img.src = url;
  }
});

export function itemIconUrl(item: ItemId): string {
  return spriteUrl(`item:${item}`, `item:${item}`, 8);
}

export function itemIcon(item: ItemId): string {
  return `<img class="icon" src="${itemIconUrl(item)}" alt="" title="${ITEMS[item].name}">`;
}

/** 누르면 도감이 열리는 아이템 (아이콘 + 이름). 클릭은 UI가 [data-item]으로 한 번에 받는다. */
export function itemLink(item: ItemId, withName = true): string {
  return `<span class="ilink" data-item="${item}" title="${ITEMS[item].name} · 클릭: 도감">${itemIcon(item)}${withName ? ITEMS[item].name : ''}</span>`;
}

/**
 * 광맥·지형 그림: 맵에서 보이는 칸 하나 (16×16).
 * id는 나오는 아이템 (iron-ore, copper-ore, coal, stone, water, dirt)
 */
export function depositIconUrl(id: ItemId): string {
  if (id === 'water') return spriteUrl('deposit:water', 'water:0', 16);
  if (id === 'dirt') return spriteUrl('deposit:dirt', 'ground:3', 16);
  if (sprite(`ore:${id}:3:0`)) return spriteUrl(`deposit:${id}`, `ore:${id}:3:0`, 16);
  return spriteUrl(`deposit:${id}`, `item:${id}`, 16);
}

/** 건물 그림 이름 (종류마다 대표 모양 하나) */
const BUILDING_SPRITE: Partial<Record<BuildingType, string>> = {
  underground: 'underground-in',
  road: 'road:10',
  storage: 'storage:15',
  station: 'station-load',
};

/**
 * 툴바·도감용 건물 아이콘 (32×32). 1칸 건물은 2배, 2칸은 그대로, 허브는 줄여서.
 * 움직이는 기계는 일하는 첫 프레임 (불이 켜진 모습)
 */
export function buildingIconUrl(type: BuildingType): string {
  const name = BUILDING_SPRITE[type] ?? type;
  const s = sprite(name);
  const k = !s ? 1 : s.w <= 16 ? 2 : s.w <= 32 ? 1 : 32 / s.w;
  return spriteUrl(`building:${type}`, name, 32, k, s && s.frames > 1 && type !== 'hub' ? 1 : 0);
}

/** 트럭 아이콘 (32×32, 오른쪽을 보고 짐을 가득 실은 모습) */
export function truckIconUrl(): string {
  return spriteUrl('truck', 'truck:1', 32, 2, 2);
}
