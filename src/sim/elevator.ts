import type { ItemId } from '../data/items';
import type { World } from './world';

/**
 * 산지 협동의 공동 대형 프로젝트: 광장의 우주 엘리베이터 (docs/멀티-산지협동-상세기획.md §9).
 * 허브에 들어온 물건 중 지금 단계에 필요한 것을 엘리베이터로 돌린다 (허브 프로젝트의 모듈 납품과 같은 방식).
 * 단계마다 모두 채우면 다음 단계, 네 단계를 마치면 완공. 납품량은 4명 기준이고 방장이 인원에 맞춰 배율을 정한다.
 */
export interface ElevatorStage {
  name: string;
  items: [ItemId, number][];
}

/** 4명 기준 납품량. 산지 협동 지도에는 주석·고무가 없어 모터·제어기 대신 기본 자원으로 만드는 것만 쓴다 */
export const ELEVATOR_STAGES: ElevatorStage[] = [
  { name: '기초', items: [['concrete', 3000], ['brick', 3000]] },
  { name: '골조', items: [['steel', 5000], ['gear', 2000]] },
  { name: '배선', items: [['copper-wire', 8000], ['circuit', 2000]] },
  { name: '가동', items: [['steel', 3000], ['circuit', 3000], ['concrete', 2000]] },
];

/** 엘리베이터 부지 한 변 (칸) */
export const ELEVATOR_SIZE = 4;

export interface Elevator {
  /** 지금 단계 (ELEVATOR_STAGES.length = 완공) */
  stage: number;
  /** 지금 단계에 납품한 개수 */
  delivered: Map<ItemId, number>;
  /** 허브에 들어온 물건을 엘리베이터로 돌릴지 (건설 재료가 모자라면 잠시 끈다) */
  on: boolean;
  /** 납품량 배율 (4명 = 1, 2명 = 0.5, 혼자 = 1) */
  scale: number;
  /** 완공한 게임 시각 (-1 = 아직) */
  doneAt: number;
  /** 부지 왼쪽 위 (광장 안, 짓지 못한다) */
  x: number;
  y: number;
}

export function newElevator(x: number, y: number): Elevator {
  return { stage: 0, delivered: new Map(), on: true, scale: 1, doneAt: -1, x, y };
}

/** 인원에 맞춘 배율: 혼자는 4명 기준 그대로, 둘 이상은 인원/4 */
export function elevatorScale(players: number): number {
  return players <= 1 ? 1 : players / 4;
}

/** 지금 단계에서 이 품목이 몇 개 필요한지 (배율 적용) */
export function stageNeed(e: Elevator, item: ItemId): number {
  const n = ELEVATOR_STAGES[e.stage]?.items.find(([i]) => i === item)?.[1] ?? 0;
  return Math.ceil(n * e.scale);
}

/** 단계 진행률 (0~1) */
export function stageProgress(e: Elevator): number {
  const s = ELEVATOR_STAGES[e.stage];
  if (!s) return 1;
  const total = s.items.reduce((a, [i]) => a + stageNeed(e, i), 0);
  const got = s.items.reduce((a, [i]) => a + Math.min(e.delivered.get(i) ?? 0, stageNeed(e, i)), 0);
  return total ? got / total : 1;
}

/** 허브에 들어온 물건 하나를 엘리베이터가 받는지. 받으면 그 단계를 채웠는지 보고 다음 단계로 넘긴다 */
export function elevatorTake(w: World, item: ItemId): boolean {
  const e = w.elevator;
  if (!e || !e.on || e.stage >= ELEVATOR_STAGES.length) return false;
  if ((e.delivered.get(item) ?? 0) >= stageNeed(e, item)) return false;
  e.delivered.set(item, (e.delivered.get(item) ?? 0) + 1);
  if (stageProgress(e) >= 1) {
    e.stage++;
    e.delivered = new Map();
    if (e.stage >= ELEVATOR_STAGES.length) e.doneAt = w.time;
  }
  return true;
}
