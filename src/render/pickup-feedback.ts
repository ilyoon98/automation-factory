import type { ItemId } from '../data/items';

export interface PickupSource { tile: number; item: ItemId }
export interface PickupEffect extends PickupSource { born: number }

/** 한 더미당 아이콘 두 장. 많은 물건을 주워도 화면 장식은 최대 24장만. */
export const PICKUP_LIMIT = 12;
export const PICKUP_DURATION = 0.48;

/** 회수 결과의 화면 장식만 보관한다. 시간은 배속과 무관한 실제 초. */
export class PickupFeedback {
  private world: object | null = null;
  private effects: PickupEffect[] = [];

  clear(): void { this.effects = []; this.world = null; }

  active(world: object, now: number, enabled = true): readonly PickupEffect[] {
    if (this.world !== world || !enabled) this.effects = [];
    this.world = world;
    this.effects = this.effects.filter(e => now - e.born >= 0 && now - e.born < PICKUP_DURATION);
    return this.effects;
  }

  add(world: object, sources: readonly PickupSource[], now: number, enabled = true): void {
    this.active(world, now, enabled);
    if (!enabled) return;
    for (const source of sources) {
      if (this.effects.length >= PICKUP_LIMIT) break;
      if (this.effects.some(e => e.tile === source.tile)) continue;
      this.effects.push({ ...source, born: now });
    }
  }
}

/** 두 아이템이 주변에서 상자 중심으로 모인다. 좌표를 그림 픽셀 단위로 끊는다. */
export function pickupSample(effect: PickupEffect, now: number) {
  const progress = Math.max(0, Math.min(1, (now - effect.born) / PICKUP_DURATION));
  const t = Math.floor(progress * 10) / 10;
  const remaining = Math.max(0, 1 - t / 0.8) ** 2;
  const flip = effect.tile % 2 ? -1 : 1;
  return {
    offsets: [
      { x: Math.round(-6 * remaining * flip), y: Math.round(-5 * remaining) },
      { x: Math.round(6 * remaining * flip), y: Math.round(4 * remaining) },
    ],
    alpha: Math.min(1, (1 - progress) / 0.25),
    sparkle: progress >= 0.65 && progress < 0.95,
  };
}
