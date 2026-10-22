import type { ItemId } from '../data/items';
import { sprite } from './pixel';

/** 아이템 아이콘 (픽셀 그림). (x, y)는 중심, r은 반지름(px). 8×8 그림을 r에 맞는 정수 배로 찍는다 */
export function drawItem(ctx: CanvasRenderingContext2D, item: ItemId, x: number, y: number, r: number): void {
  const s = sprite(`item:${item}`);
  if (!s) return;
  const size = s.w * Math.max(1, Math.floor((r * 2) / s.w));
  const smooth = ctx.imageSmoothingEnabled;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(s.img, 0, 0, s.w, s.h, Math.round(x - size / 2), Math.round(y - size / 2), size, size);
  ctx.imageSmoothingEnabled = smooth;
}

export function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

/** #rrggbb 색을 밝게(+) 또는 어둡게(-) */
export function shade(hex: string, amt: number): string {
  const n = parseInt(hex.slice(1), 16);
  const f = (c: number) => Math.round(Math.min(255, Math.max(0, amt < 0 ? c * (1 + amt) : c + (255 - c) * amt)));
  return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`;
}
