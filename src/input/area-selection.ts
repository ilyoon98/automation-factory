import { DX, DY } from '../sim/dir';
import type { World } from '../sim/world';

export interface SelectionArea { x0: number; y0: number; x1: number; y1: number }

/** 하역기가 뒤 칸에서 꺼내 쓰는 회수 더미 칸 (뒤가 허브·창고면 더미를 쓰지 않는다) */
function unloaderSources(w: World): Set<number> {
  const tiles = new Set<number>();
  for (const b of w.buildings.values()) {
    if (b.type !== 'unloader') continue;
    const x = b.x - DX[b.dir], y = b.y - DY[b.dir];
    const back = w.buildingAt(x, y);
    if (w.inBounds(x, y) && back?.type !== 'hub' && back?.type !== 'storage') tiles.add(w.idx(x, y));
  }
  return tiles;
}

/**
 * 미리보기와 선택 확정이 같은 설비·더미를 센다. 한 칸의 여러 품목은 회수 더미 한 곳이다.
 * 하역기가 빼내는 더미는 일부러 둔 것이라 줍지 않고 따로 센다.
 */
export function areaSelection(w: World, a: SelectionArea) {
  const group = w.groupIn(a.x0, a.y0, a.x1, a.y1);
  const left = Math.min(a.x0, a.x1), right = Math.max(a.x0, a.x1);
  const top = Math.min(a.y0, a.y1), bottom = Math.max(a.y0, a.y1);
  const inside = [...w.pileTiles().keys()].filter(tile => {
    const x = tile % w.width, y = Math.floor(tile / w.width);
    return x >= left && x <= right && y >= top && y <= bottom && w.isRevealed(tile);
  }).sort((a, b) => a - b);
  const sources = inside.length ? unloaderSources(w) : new Set<number>();
  const piles = inside.filter(tile => !sources.has(tile));
  const kept = inside.length - piles.length;
  const label = `설비 ${group.length}대 · 회수 더미 ${piles.length}곳 줍기${kept ? ` · 하역기 더미 ${kept}곳 남김` : ''}`;
  return { group, piles, kept, label };
}
