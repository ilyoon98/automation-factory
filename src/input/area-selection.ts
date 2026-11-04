import type { World } from '../sim/world';

export interface SelectionArea { x0: number; y0: number; x1: number; y1: number }

/** 미리보기와 선택 확정이 같은 설비·더미를 센다. 한 칸의 여러 품목은 회수 더미 한 곳이다. */
export function areaSelection(w: World, a: SelectionArea) {
  const group = w.groupIn(a.x0, a.y0, a.x1, a.y1);
  const left = Math.min(a.x0, a.x1), right = Math.max(a.x0, a.x1);
  const top = Math.min(a.y0, a.y1), bottom = Math.max(a.y0, a.y1);
  const piles = [...w.pileTiles().keys()].filter(tile => {
    const x = tile % w.width, y = Math.floor(tile / w.width);
    return x >= left && x <= right && y >= top && y <= bottom && w.isRevealed(tile);
  }).sort((a, b) => a - b);
  return { group, piles, label: `설비 ${group.length}대 · 회수 더미 ${piles.length}곳` };
}
