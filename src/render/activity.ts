import type { Activity } from '../sim/activity';

/** 누적 위상이라 배속·전력·레시피 변경 때 거꾸로 뛰지 않는다. */
export class ActivityPhases {
  work = new Map<number, number>();
  wheels = new Map<number, number>();
  charge = new Map<number, number>();
  record(e: Activity): void {
    if (e.kind === 'work') this.work.set(e.id, (this.work.get(e.id) ?? 0) + e.cycles);
    if (e.kind === 'drive') this.wheels.set(e.id, (this.wheels.get(e.id) ?? 0) + e.distance);
    if (e.kind === 'charge') this.charge.set(e.id, (this.charge.get(e.id) ?? 0) + e.amount);
  }
  clear(): void { this.work.clear(); this.wheels.clear(); this.charge.clear(); }
}

/** 세 번째 그림은 실제로 가득 찼을 때만 쓴다. 차량별 현재 용량을 전달한다. */
export function cargoFrame(load: number, capacity: number): number {
  return load <= 0 ? 0 : load < capacity ? 1 : 2;
}
