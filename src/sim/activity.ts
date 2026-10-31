import type { ItemId } from '../data/items';

/** 이미 확정한 작업의 읽기 전용 통지. 이 일시 사건은 저장하거나 공유하지 않는다. */
export type Activity =
  | { kind: 'work'; id: number; cycles: number }
  | { kind: 'batch'; id: number }
  | { kind: 'drive'; id: number; distance: number }
  | { kind: 'charge'; id: number; amount: number }
  | { kind: 'cargo'; id: number; station: number; item: ItemId; loading: boolean }
  | { kind: 'station-port'; id: number; from: number; to: number; item: ItemId };
