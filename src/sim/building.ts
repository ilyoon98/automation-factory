import { BUILDINGS, type BuildingType } from '../data/buildings';
import type { ItemId } from '../data/items';
import type { Dir } from './dir';

export type Status =
  | 'idle'
  | 'working'
  | 'low-power'
  | 'no-input'
  | 'output-full'
  | 'no-recipe'
  | 'depleted'
  | 'no-fuel'
  | 'no-water'
  | 'no-filter';

export const STATUS_LABEL: Record<Status, string> = {
  idle: '대기',
  working: '작동 중',
  'low-power': '전력 부족 (감속)',
  'no-input': '재료 부족',
  'output-full': '출력 막힘',
  'no-recipe': '레시피 없음',
  depleted: '광맥 고갈',
  'no-fuel': '연료 없음',
  'no-water': '물 없음',
  'no-filter': '아이템 선택 안 함',
};

export type StationMode = 'load' | 'unload';

export interface BeltItem {
  item: ItemId;
  /** 0 = 입구, 1 = 출구 */
  pos: number;
  /** 이 칸에 쌓인 개수 (컨베이어 종류마다 최대가 다르다) */
  n: number;
}

/**
 * 모든 건물 종류가 한 클래스를 공유한다. 종류별로 쓰는 필드만 다르다.
 * 프로토타입 단계에서 저장/불러오기를 단순하게 유지하기 위함.
 */
export class Building {
  readonly size: number;

  // 공통
  status: Status = 'idle';

  // 제련로 / 조립기 / 채굴기
  recipe: string | null = null;
  inBuf = new Map<ItemId, number>();
  outBuf = new Map<ItemId, number>();
  crafting = false;
  progress = 0;
  outRR = 0;

  /**
   * 최근 가동 기록 (지수 이동 평균, 저장하지 않음).
   * eff = 최대 속도 대비 실제 속도, work = 작동 중인 시간 비율,
   * starve = 재료 부족 비율, blocked = 출력 막힘 비율, age = 측정한 시간(초)
   */
  stats = { eff: 0, work: 0, starve: 0, blocked: 0, age: 0 };

  // 채굴기
  mineTiles: number[] = [];
  mineIdx = 0;
  /** 광맥이 없는 빈 땅에 놓여 흙을 캐는 채굴기 */
  mineDirt = false;
  /** 이 채굴기가 캐는 광맥 번호들 (밑에 깔린 칸이 속한 광맥 전체에서 캔다) */
  minePatches: number[] = [];

  /** 분리기처럼 순서대로 결과가 나오는 레시피에서 다음 차례 */
  cycle = 0;

  // 발전기
  fuel = 0;
  energy = 0;
  load = 0;

  // 컨베이어
  items: BeltItem[] = [];
  /** 옆에서만 들어오는 굽은 벨트일 때, 들어오는 쪽 방향 */
  curveFrom: Dir | null = null;

  // 분배기
  held: ItemId | null = null;
  /** 들고 있는 개수 (컨베이어에서 쌓인 채로 받으면 여러 개) */
  heldN = 0;
  heldFrom = 0;
  /** 병합기: 방향별로 마지막에 넣으려 한 틱 (최근에 기다린 쪽에 차례를 준다) */
  lastTry = [-9, -9, -9, -9];
  /** 스마트 분류기: 앞으로 보낼 아이템, 하역기: 꺼낼 아이템 */
  filter: ItemId | null = null;

  // 지하 컨베이어. 입구가 아이템을 들고 출구 앞까지 한 줄로 옮긴다.
  ugMode: 'in' | 'out' | null = null;
  /** 짝 건물 id (0 = 짝 없음) */
  partner = 0;

  // 정류장. 싣기는 컨베이어로 받아 inBuf에 쌓고, 내리기는 트럭이 내린 걸 outBuf에서 앞으로 내보낸다.
  stationMode: StationMode = 'load';
  /** 화면에 보이는 번호 (정류장 1, 2, …) */
  stationNo = 0;

  constructor(
    readonly id: number,
    readonly type: BuildingType,
    readonly x: number,
    readonly y: number,
    public dir: Dir,
  ) {
    this.size = BUILDINGS[type].size;
  }

  get def() {
    return BUILDINGS[this.type];
  }

  contains(tx: number, ty: number): boolean {
    return tx >= this.x && ty >= this.y && tx < this.x + this.size && ty < this.y + this.size;
  }
}

export function addTo(map: Map<ItemId, number>, item: ItemId, n: number): void {
  const v = (map.get(item) ?? 0) + n;
  if (v === 0) map.delete(item);
  else map.set(item, v);
}

export function countOf(map: Map<ItemId, number>, item: ItemId): number {
  return map.get(item) ?? 0;
}
