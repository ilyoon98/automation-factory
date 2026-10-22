import type { BuildingType } from '../data/buildings';
import type { ItemId } from '../data/items';
import type { StationMode } from './building';
import type { Dir } from './dir';
import type { World } from './world';

export interface BlueprintEntry {
  type: BuildingType;
  /** 청사진 왼쪽 위 기준 좌표 */
  dx: number;
  dy: number;
  dir: Dir;
  recipe: string | null;
  filter: ItemId | null;
  /** 정류장만 */
  mode?: StationMode;
}

export interface Blueprint {
  entries: BlueprintEntry[];
  w: number;
  h: number;
}

/** 사각형 안에 완전히 들어오는 건물(허브 제외)을 복사한다. 비어 있으면 null */
export function copyArea(world: World, x0: number, y0: number, x1: number, y1: number): Blueprint | null {
  const [ax, bx] = x0 <= x1 ? [x0, x1] : [x1, x0];
  const [ay, by] = y0 <= y1 ? [y0, y1] : [y1, y0];
  const picked = [...world.buildings.values()].filter(
    (b) => b.type !== 'hub' && b.x >= ax && b.y >= ay && b.x + b.size - 1 <= bx && b.y + b.size - 1 <= by,
  );
  if (picked.length === 0) return null;
  const minX = Math.min(...picked.map((b) => b.x));
  const minY = Math.min(...picked.map((b) => b.y));
  const maxX = Math.max(...picked.map((b) => b.x + b.size));
  const maxY = Math.max(...picked.map((b) => b.y + b.size));
  return {
    entries: picked.map((b) => ({
      type: b.type,
      dx: b.x - minX,
      dy: b.y - minY,
      dir: b.dir,
      recipe: b.recipe,
      filter: b.filter,
      ...(b.type === 'station' ? { mode: b.stationMode } : {}),
    })),
    w: maxX - minX,
    h: maxY - minY,
  };
}

/**
 * (x, y)를 왼쪽 위로 붙여넣는다. 놓을 수 없는 건물(겹침, 재료 부족, 잠김)은 건너뛴다.
 * 놓은 개수와 건너뛴 개수를 돌려준다.
 */
export function pasteBlueprint(world: World, bp: Blueprint, x: number, y: number): { placed: number; skipped: number } {
  let placed = 0;
  let skipped = 0;
  for (const e of bp.entries) {
    const b = world.place(e.type, x + e.dx, y + e.dy, e.dir);
    if (!b) {
      skipped++;
      continue;
    }
    if (e.recipe && world.unlockedRecipes.has(e.recipe)) world.setRecipe(b, e.recipe);
    if (e.filter) world.setFilter(b, e.filter);
    if (e.mode) world.setStationMode(b, e.mode);
    placed++;
  }
  return { placed, skipped };
}
