import { ITEMS, type ItemId } from '../data/items';
import { TERRAIN_IDS, type TerrainKind } from '../data/terrain';
import type { World } from './world';

/**
 * 업적 (docs/업적-확장기획서.md). 최초 42 · 심화 27(D24 탐사 제외) · 숨은 16 · 기록 30 (docs/업적-기록30종-구현기준.md).
 * 시뮬레이션이 1초마다 판정하고 공장 저장에 남긴다 (화면을 열지 않아도, 같이 하는 모두에게 같은 결과).
 * 보상은 기록·알림·완료 도장뿐이다 (생산 보너스 없음).
 */

export type AchKind = 'first' | 'deep' | 'hidden' | 'record';
/** 필요한 기능: K 기본, B 지형·특화 자원, R 신규 생산, P 지역 전력, W 확장 날씨, L 계획 운송 */
export type AchNeed = 'K' | 'B' | 'R' | 'P' | 'W' | 'L';
export type AchArea = '생산' | '물류' | '전력' | '지역' | '숲';

export interface AchDef {
  /** 저장 id (기록은 record-v1/… 고정 키) */
  id: string;
  /** 화면에 보일 번호 (기록 REC01 등). 없으면 id */
  code?: string;
  kind: AchKind;
  name: string;
  /** 조건 설명 (숨은 업적은 달성 뒤에만 보인다) */
  desc: string;
  /** 숨은 업적의 공개 힌트 */
  hint?: string;
  area: AchArea;
  needs: AchNeed[];
  /** 심화·기록: 네 메달 기준(이상), 단위, 지금 값 (여러 항목은 가장 낮은 것, 기록은 지금까지의 최고) */
  tiers?: number[];
  unit?: string;
  /** 심화: 조건 충족을 이만큼(초) 누적해야 메달 */
  sustain?: number;
  value?(w: World): number;
  /** 최초·숨은: 이뤘는지 */
  check?(w: World): boolean;
}

/** 5초 단위 칸 60개 = 최근 300초 */
const BUCKET = 5;
const SLOTS = 60;

/** 기록 REC18~23: 최근 60초에 실제로 완성한 수량을 재는 품목 */
export const Q60_ITEMS: ItemId[] = ['iron-plate', 'copper-plate', 'gear', 'copper-wire', 'steel', 'circuit'];

/** 업적 판정 상태 (공장 저장 단위) */
export class AchState {
  /** 이룬 최초·숨은 업적 → 게임 시각 */
  done = new Map<string, number>();
  /** 심화 메달 단계 (1~4) */
  medals = new Map<string, number>();
  /** 심화 "조건 충족 누적" 초: `id:단계` → 초 */
  secs = new Map<string, number>();
  /** 누적값들 (에너지 kJ, 개수, 표시) */
  num = new Map<string, number>();
  /** 최근 300초 창: 키 → 5초 칸 60개 */
  win = new Map<string, number[]>();
  bucket = -1;
  /** 식목 추적: 칸 → 1 심음, 2 다 자람, 3 다 자란 뒤 벌목 */
  trees = new Map<number, number>();
  /** 광맥이 바닥난 마지막 칸 */
  lastOre = new Set<number>();
  /** 이번 1초 동안의 표시 (광석 사용 등) */
  flags = new Set<string>();
  /** 글자 값 (트럭마다 지금 배송 구간, 실을 때 날씨 등) */
  text = new Map<string, string>();
  /**
   * 기록 1초 창 (record-v1): 집계 시작 초, 지금 열린 초, 품목별 지금 초 수량·닫힌 1초 칸 60개·최근 60초·최고,
   * 허브 밖 발전이 작업에 준 전기의 지금 초 kJ·마지막으로 닫힌 초 kJ(= 평균 kW)·최고
   */
  recStart = -1;
  recSec = -1;
  q60Cur = Q60_ITEMS.map(() => 0);
  q60Ring = Q60_ITEMS.map(() => new Array<number>(60).fill(0));
  q60Now = Q60_ITEMS.map(() => 0);
  q60Best = Q60_ITEMS.map(() => 0);
  workCur = 0;
  workLast = 0;
  workBest = 0;

  /** 게임 시각 t까지 끝난 1초 칸을 닫는다 (정확히 t초의 사건은 다음 칸). 60초를 다 잰 뒤부터 Q60을 판정한다 */
  recRoll(t: number): void {
    const sec = Math.floor(t + 1e-9);
    if (this.recStart < 0) {
      this.recStart = sec;
      this.recSec = sec;
      return;
    }
    while (this.recSec < sec) {
      const slot = this.recSec % 60;
      for (let i = 0; i < Q60_ITEMS.length; i++) {
        this.q60Ring[i][slot] = this.q60Cur[i];
        this.q60Cur[i] = 0;
      }
      this.workLast = this.workCur;
      this.workBest = Math.max(this.workBest, this.workCur);
      this.workCur = 0;
      this.recSec++;
      if (this.recSec - this.recStart >= 60) {
        for (let i = 0; i < Q60_ITEMS.length; i++) {
          this.q60Now[i] = this.q60Ring[i].reduce((a, b) => a + b, 0);
          this.q60Best[i] = Math.max(this.q60Best[i], this.q60Now[i]);
        }
      }
    }
  }

  /** 기계가 실제로 산출한 n개 (Q60 품목이면 지금 초 칸에) */
  recProduce(item: ItemId, n: number, t: number): void {
    const i = Q60_ITEMS.indexOf(item);
    if (i < 0) return;
    this.recRoll(t);
    this.q60Cur[i] += n;
  }

  /** 허브 밖 발전이 실제 작업에 직접 준 전기 kJ (REC24 1초 평균) */
  recWork(kj: number, t: number): void {
    if (kj <= 0) return;
    this.recRoll(t);
    this.workCur += kj;
  }

  /** Q60 측정이 끝난 초 수 (60이면 판정 중) */
  q60Measured(): number {
    return this.recStart < 0 ? 0 : Math.min(60, this.recSec - this.recStart);
  }

  add(key: string, n: number): void {
    this.num.set(key, (this.num.get(key) ?? 0) + n);
  }

  get(key: string): number {
    return this.num.get(key) ?? 0;
  }

  /** 시각 t의 칸으로 넘어가며 지난 칸들을 비운다 */
  roll(t: number): number {
    const idx = Math.floor(Math.max(0, t) / BUCKET);
    if (idx > this.bucket) {
      const steps = Math.min(SLOTS, idx - this.bucket);
      for (const arr of this.win.values()) for (let k = 1; k <= steps; k++) arr[(this.bucket + k) % SLOTS] = 0;
      this.bucket = idx;
    }
    return idx % SLOTS;
  }

  addWin(key: string, n: number, t: number): void {
    const slot = this.roll(t);
    let arr = this.win.get(key);
    if (!arr) this.win.set(key, (arr = new Array<number>(SLOTS).fill(0)));
    arr[slot] += n;
  }

  /** 최근 seconds초 합 (5초 칸 단위, 지금 칸 포함) */
  winSum(key: string, seconds: number, t: number): number {
    const arr = this.win.get(key);
    if (!arr) return 0;
    const slot = this.roll(t);
    const n = Math.min(SLOTS, Math.ceil(seconds / BUCKET));
    let s = 0;
    for (let k = 0; k < n; k++) s += arr[(slot - k + SLOTS * 2) % SLOTS];
    return s;
  }

  serialize() {
    return {
      done: [...this.done],
      medals: [...this.medals],
      secs: [...this.secs],
      num: [...this.num],
      win: [...this.win].filter(([, a]) => a.some((x) => x)),
      bucket: this.bucket,
      trees: [...this.trees],
      lastOre: [...this.lastOre],
      flags: [...this.flags],
      text: [...this.text],
      rec: {
        start: this.recStart,
        sec: this.recSec,
        cur: [...this.q60Cur],
        ring: this.q60Ring.map((r) => [...r]),
        now: [...this.q60Now],
        best: [...this.q60Best],
        work: [this.workCur, this.workLast, this.workBest],
      },
    };
  }

  static from(d: Partial<ReturnType<AchState['serialize']>> | undefined): AchState {
    const s = new AchState();
    if (!d) return s;
    s.done = new Map(d.done ?? []);
    s.medals = new Map(d.medals ?? []);
    s.secs = new Map(d.secs ?? []);
    s.num = new Map(d.num ?? []);
    s.win = new Map((d.win ?? []).map(([k, a]) => [k, [...a]]));
    s.bucket = d.bucket ?? -1;
    s.trees = new Map(d.trees ?? []);
    s.lastOre = new Set(d.lastOre ?? []);
    s.flags = new Set(d.flags ?? []);
    s.text = new Map(d.text ?? []);
    // 기록 창이 없는 이전 저장은 지금부터 새로 잰다 (과거 속도를 재고로 추정하지 않는다)
    if (d.rec) {
      s.recStart = d.rec.start;
      s.recSec = d.rec.sec;
      s.q60Cur = Q60_ITEMS.map((_, i) => d.rec!.cur[i] ?? 0);
      s.q60Ring = Q60_ITEMS.map((_, i) => (d.rec!.ring[i] ? [...d.rec!.ring[i]] : new Array<number>(60).fill(0)));
      s.q60Now = Q60_ITEMS.map((_, i) => d.rec!.now[i] ?? 0);
      s.q60Best = Q60_ITEMS.map((_, i) => d.rec!.best[i] ?? 0);
      [s.workCur, s.workLast, s.workBest] = d.rec.work;
    }
    return s;
  }

  /** 상태 해시용 숫자 하나 */
  digest(): number {
    // 키 순서와 무관하게 (불러온 쪽은 빈 창을 버려 순서가 달라질 수 있다)
    const sorted = <V>(m: Map<string, V>) => [...m].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    let h = this.done.size * 7 + this.medals.size * 13 + this.bucket;
    for (const [k, v] of sorted(this.medals)) h = (h * 31 + k.length + v) | 0;
    for (const [, v] of sorted(this.num)) h = (h * 31 + Math.round(v * 1000)) | 0;
    for (const [, v] of sorted(this.secs)) h = (h * 31 + v) | 0;
    // 저장은 0뿐인 창을 빼므로 해시도 빼고 센다
    for (const [, a] of sorted(this.win)) if (a.some((x) => x)) for (const x of a) h = (h * 31 + Math.round(x * 1000)) | 0;
    for (const v of this.text.values()) h = (h * 31 + v.length) | 0;
    h = (h * 31 + this.recStart * 7 + this.recSec) | 0;
    for (const arr of [this.q60Cur, this.q60Now, this.q60Best, [this.workCur, this.workLast, this.workBest], ...this.q60Ring]) for (const x of arr) h = (h * 31 + Math.round(x * 1000)) | 0;
    return h + this.trees.size * 3 + this.lastOre.size + this.text.size * 5;
  }
}

// ───────────────────────── 정의 ─────────────────────────

const made = (w: World, item: ItemId) => w.stats.made.get(item) ?? 0;
const madeOf = (item: ItemId) => (w: World) => made(w, item) >= 1;
const recipe = (w: World, id: string) => w.stats.recipeDone.get(id) ?? 0;
const q60 = (w: World, item: ItemId) => w.ach.winSum(`m:${item}`, 60, w.time);
const kj = (w: World, key: string) => w.ach.get(key);

/** 원광·물·벌목 원료 (가공품 수에서 뺀다) */
const RAW = new Set<ItemId>(['iron-ore', 'copper-ore', 'coal', 'stone', 'dirt', 'water', 'log', 'sapling', 'tin-ore', 'bauxite', 'sap', 'crude-oil', 'sulfur', 'brine', 'sand']);

/** D20: 지형마다 인정하는 특산 원료 */
export const SPECIALTY: Record<TerrainKind, ItemId[]> = {
  grass: ['iron-ore', 'copper-ore'],
  forest: ['log', 'sap'],
  rock: ['coal', 'stone', 'bauxite'],
  sand: ['crude-oil', 'sand'],
  snow: ['tin-ore'],
  salt: ['brine'],
  volcano: ['sulfur'],
};

const first = (id: string, name: string, desc: string, area: AchArea, needs: AchNeed[], check: (w: World) => boolean): AchDef => ({
  id,
  kind: 'first',
  name,
  desc,
  area,
  needs,
  check,
});

const deep = (
  id: string,
  name: string,
  desc: string,
  area: AchArea,
  needs: AchNeed[],
  tiers: number[],
  unit: string,
  value: (w: World) => number,
  sustain?: number,
): AchDef => ({ id, kind: 'deep', name, desc, area, needs, tiers, unit, value, sustain });

/** 기록: 저장 id는 record-v1/… 고정 키, 화면에는 REC 번호 */
const record = (code: string, id: string, name: string, desc: string, area: AchArea, needs: AchNeed[], tiers: number[], unit: string, value: (w: World) => number): AchDef => ({
  id,
  code,
  kind: 'record',
  name,
  desc,
  area,
  needs,
  tiers,
  unit,
  value,
});

const produced = (code: string, item: ItemId, name: string, tiers: number[], needs: AchNeed[] = ['K']) =>
  record(code, `record-v1/produced/${item}`, name, `${ITEMS[item].name} 누적 생산 (기계가 실제로 산출한 개수)`, '생산', needs, tiers, '개', (w) => made(w, item));

const speed = (code: string, item: ItemId, name: string, tiers: number[]) =>
  record(code, `record-v1/q60/${item}`, name, `최근 게임 시간 60초에 실제로 완성한 ${ITEMS[item].name} (한 번 넘으면 지급)`, '생산', ['K'], tiers, '개', (w) => w.ach.q60Best[Q60_ITEMS.indexOf(item)]);

/** REC27에서 세지 않는 건물 (벨트·도로·전봇대 같은 연결 설비와 허브) */
export const RECORD_SKIP = new Set<string>(['hub', 'belt', 'fast-belt', 'underground', 'splitter', 'overflow', 'sorter', 'merger', 'road', 'pole']);

/** 기록 30종 (docs/업적-기록30종-구현기준.md): 누적 17 · 속도 6 · 공장 7 */
const RECORDS: AchDef[] = [
  produced('REC01', 'iron-ore', '철을 캐는 공장', [500, 2500, 10000, 25000]),
  produced('REC02', 'copper-ore', '구리를 캐는 공장', [500, 2500, 10000, 25000]),
  produced('REC03', 'coal', '불을 위한 광산', [500, 2000, 7500, 20000]),
  produced('REC04', 'stone', '돌부터 시작해서', [500, 2500, 10000, 25000]),
  produced('REC05', 'iron-plate', '공장의 바탕', [250, 1500, 7500, 30000]),
  produced('REC06', 'copper-plate', '구릿빛 판재', [250, 1500, 7500, 30000]),
  produced('REC07', 'gear', '맞물리는 수천 개', [100, 750, 3000, 10000]),
  produced('REC08', 'copper-wire', '가늘고 긴 연결', [500, 2500, 10000, 40000]),
  produced('REC09', 'steel', '단단해진 공장', [100, 500, 2500, 10000]),
  produced('REC10', 'circuit', '생각하는 부품', [100, 500, 2500, 10000]),
  produced('REC11', 'log', '숲에서 온 기둥', [250, 1500, 7500, 25000]),
  produced('REC12', 'wood', '나무를 다듬는 일', [250, 1500, 7500, 25000]),
  produced('REC13', 'charcoal', '다시 쓰는 불씨', [100, 500, 2500, 10000]),
  produced('REC14', 'paper', '쌓이는 종이', [100, 500, 2500, 10000]),
  produced('REC15', 'tin-plate', '눈밭의 금속', [100, 500, 2000, 5000], ['B', 'R']),
  produced('REC16', 'bronze', '합금의 시대', [250, 1000, 5000, 20000], ['B', 'R']),
  produced('REC17', 'aluminum-plate', '가벼워진 산업', [50, 250, 1000, 5000], ['B', 'R']),
  speed('REC18', 'iron-plate', '철판이 흐르는 속도', [30, 60, 180, 600]),
  speed('REC19', 'copper-plate', '구리판이 흐르는 속도', [30, 60, 180, 600]),
  speed('REC20', 'gear', '기어가 맞물리는 속도', [10, 30, 90, 240]),
  speed('REC21', 'copper-wire', '이어지는 구리선', [60, 120, 360, 1200]),
  speed('REC22', 'steel', '강철이 완성되는 속도', [5, 15, 45, 120]),
  speed('REC23', 'circuit', '회로가 완성되는 속도', [5, 15, 45, 120]),
  record('REC24', 'record-v1/factory/work-power', '공장을 움직인 전기', '허브 밖 발전이 실제 작업에 직접 준 전기의 1초 평균 (축전 방전·충전 제외)', '전력', ['K'], [500, 2000, 8000, 20000], 'kW', (w) => w.ach.workBest),
  record('REC25', 'record-v1/factory/night-energy', '밤에도 켜진 공장', '한밤 중 허브 밖 발전이 실제 작업에 직접 준 전기 누적', '전력', ['K'], [10, 100, 500, 2500], 'MJ', (w) => w.ach.get('r:night') / 1000),
  record('REC26', 'record-v1/factory/storm-wind-energy', '폭풍을 쓰는 공장', '안정된 현지 폭풍 속 풍력이 실제 작업에 직접 준 전기 누적', '전력', ['W'], [5, 25, 100, 500], 'MJ', (w) => w.ach.get('r:storm') / 1000),
  record('REC27', 'record-v1/factory/buildings', '커지는 공장', '지금 있는 설비 수 (허브·벨트류·도로·전봇대 제외)', '생산', ['K'], [10, 30, 75, 150], '대', (w) => {
    let n = 0;
    for (const b of w.buildings.values()) if (!RECORD_SKIP.has(b.type)) n++;
    return n;
  }),
  record('REC28', 'record-v1/factory/trucks', '바퀴가 늘어나는 공장', '지금 있는 트럭 수 (기본·고급 모두)', '물류', ['K'], [1, 4, 12, 24], '대', (w) => w.vehicles.size),
  record('REC29', 'record-v1/factory/planted-trees', '직접 심은 숲', '식목기가 실제로 심은 나무 누적', '숲', ['K'], [25, 100, 500, 2000], '그루', (w) => w.ach.get('planted')),
  record('REC30', 'record-v1/factory/endless-levels', '한 걸음 더 연구', '끝없는 연구 5종을 재료를 내고 실제로 올린 단계 합계', '생산', ['K'], [1, 5, 10, 20], '단계', (w) => w.ach.get('r:endless')),
];

const hidden = (id: string, name: string, hint: string, desc: string, area: AchArea, needs: AchNeed[], check: (w: World) => boolean): AchDef => ({
  id,
  kind: 'hidden',
  name,
  hint,
  desc,
  area,
  needs,
  check,
});

export const ACHIEVEMENTS: AchDef[] = [
  // ───── 최초 42 ─────
  first('F01', '첫 삽', '채굴기로 광석·석탄·돌 중 하나를 실제 1개 채굴', '생산', ['K'], (w) =>
    (['iron-ore', 'copper-ore', 'coal', 'stone'] as ItemId[]).some((i) => made(w, i) >= 1),
  ),
  first('F02', '뜨거운 첫 판', '제련로에서 철판 1개 제작', '생산', ['K'], madeOf('iron-plate')),
  first('F03', '허브까지 왔어요', '기계가 만든 아이템이 허브에 입고', '물류', ['K'], (w) => [...w.stats.hubIn.values()].some((n) => n > 0)),
  first('F04', '내일의 공장', '재료를 내는 연구 1개 완료', '생산', ['K'], (w) => w.researched.size >= 1),
  first('F05', '맞물리기 시작', '기어 1개 제작', '생산', ['K'], madeOf('gear')),
  first('F06', '구리 한 가닥', '구리선 1개 제작', '생산', ['K'], madeOf('copper-wire')),
  first('F07', '공장에 지능을', '회로 1개 제작', '생산', ['K'], madeOf('circuit')),
  first('F08', '더 단단하게', '강철 1개 제작 (어느 레시피든)', '생산', ['K'], madeOf('steel')),
  first('F09', '스스로 켠 불', '허브 밖 연료 발전기가 실제 수요에 전기 1MJ', '전력', ['K'], (w) => kj(w, 'e:coal') + kj(w, 'e:fuel') >= 1000),
  first('F10', '바람을 잡다', '풍력 발전기가 실제 수요에 전기 1MJ', '전력', ['K'], (w) => kj(w, 'e:wind') >= 1000),
  first('F11', '햇빛 한 조각', '태양광이 실제 수요에 전기 1MJ', '전력', ['K'], (w) => kj(w, 'e:solar') >= 1000),
  first('F12', '첫 납품', '트럭이 다른 정류장에 화물 1개 이상 배송', '물류', ['K'], (w) => w.stats.delivered >= 1),
  first('F13', '숲의 선물', '벌목기가 통나무 1개 벌목', '숲', ['K'], madeOf('log')),
  first('F14', '다시 심는 마음', '식목기가 나무 1그루 식재', '숲', ['K'], (w) => w.ach.get('planted') >= 1),
  first('F15', '종이 한 장', '종이 1개 제작', '숲', ['K'], madeOf('paper')),
  first('F16', '흙 속의 가능성', '흙 분쇄에서 모래 1개 생산', '생산', ['K'], (w) => recipe(w, 'crush-dirt') >= 1),
  first('F17', '광맥 밖의 철', '철 정광 제련으로 철판 1개 제작', '생산', ['K'], (w) => recipe(w, 'iron-plate-c') >= 1),
  first('F18', '두 금속의 만남', '청동 1개 제작', '생산', ['B', 'R'], madeOf('bronze')),
  first('F19', '가벼운 미래', '알루미늄판 1개 제작', '생산', ['B', 'R'], madeOf('aluminum-plate')),
  first('F20', '광맥 독립 선언', '광맥 독립 연구 완료', '생산', ['K'], (w) => w.researched.has('ore-independence')),
  first('F21', '사막의 검은 물', '원유 1단위 실제 채취', '지역', ['B', 'R'], madeOf('crude-oil')),
  first('F22', '모양을 바꾸는 재료', '플라스틱 1개 제작', '생산', ['R'], madeOf('plastic')),
  first('F23', '숲의 또 다른 선물', '고무 1개 제작', '숲', ['B', 'R'], madeOf('rubber')),
  first('F24', '전기를 감싸다', '절연 전선 1개 제작', '생산', ['R'], madeOf('insulated-wire')),
  first('F25', '노란 광맥', '황 1개 실제 채굴', '지역', ['B', 'R'], madeOf('sulfur')),
  first('F26', '더 질긴 연결', '강화 고무 1개 제작', '생산', ['R'], madeOf('hardened-rubber')),
  first('F27', '염호의 은빛', '리튬 1개 생산', '지역', ['B', 'R'], madeOf('lithium')),
  first('F28', '전기를 담는 상자', '배터리 팩 1개 제작', '생산', ['R'], madeOf('battery-pack')),
  first('F29', '땅속에서 온 전기', '지열 발전소가 실제 수요에 전기 1MJ', '전력', ['B', 'P'], (w) => kj(w, 'e:geo') >= 1000),
  first('F30', '이웃에게 보낸 전기', '전봇대로 이어진 다른 생산 거점(20칸 이상)의 작업에 허브 밖 발전 전기 1MJ', '전력', ['P'], (w) => kj(w, 'e:link') >= 1000),
  first('F31', '움직임의 씨앗', '청동 구동부 1개 제작', '생산', ['R'], madeOf('bronze-drive')),
  first('F32', '돌아가기 시작한 모터', '절연 모터 1개 제작', '생산', ['R'], madeOf('motor')),
  first('F33', '더 복잡한 회로', '고급 회로 1개 제작', '생산', ['R'], madeOf('adv-circuit')),
  first('F34', '공장의 제어 장치', '산업 제어기 1개 제작', '생산', ['R'], madeOf('controller')),
  first('F35', '가벼운 골격', '경량 프레임 1개 제작', '생산', ['R'], madeOf('frame')),
  first('F36', '먼 길을 위한 바퀴', '강화 타이어 1개 제작', '생산', ['R'], madeOf('tire')),
  first('F37', '굵어진 연결', '고용량 케이블 1개 제작', '생산', ['R'], madeOf('hc-cable')),
  first('F38', '부드러운 움직임', '고급 윤활제 1개 제작', '생산', ['R'], madeOf('adv-lubricant')),
  first('F39', '조립이 끝난 트럭', '고급 트럭 조립품 1개 제작', '생산', ['R'], madeOf('truck-kit')),
  first('F40', '직접 만든 운송 수단', '조립품으로 만든 고급 트럭이 화물 20개 이상 배송', '물류', ['R'], (w) => w.advDelivered >= 20),
  first('F41', '공장이 만든 자동화', '자동화 설비 모듈 1개 제작', '생산', ['R'], madeOf('module')),
  first('F42', '개선이 일을 시작할 때', '모듈을 설치한 기계가 레시피 1회 완료', '생산', ['R'], (w) => w.moduleBatches >= 1),

  // ───── 심화 27 (D24 제외) ─────
  deep('D01', '다품종 자동화', '최근 60초에 10개 이상 만든 서로 다른 가공품 수 (조건 충족 누적 180초)', '생산', ['K'], [4, 6, 8, 12], '종', (w) => {
    let n = 0;
    for (const item of w.stats.made.keys()) if (!RAW.has(item) && q60(w, item) >= 10) n++;
    return n;
  }, 180),
  deep('D02', '잘 돌아가는 공장', '최근 60초 가동률 90% 이상인 생산 기계 수 (누적 180초)', '생산', ['K'], [5, 15, 30, 60], '대', (w) => w.busyMachines(), 180),
  deep('D03', '부산물의 재발견', '벽돌·콘크리트·종이를 각각 누적 생산', '생산', ['K'], [100, 1000, 5000, 20000], '개', (w) =>
    Math.min(made(w, 'brick'), made(w, 'concrete'), made(w, 'paper')),
  ),
  deep('D04', '땅에서 다시 얻는 금속', '정광 제련 철판·구리판의 최근 60초 생산 (누적 180초)', '생산', ['K'], [30, 60, 180, 600], '개', (w) =>
    Math.min(w.ach.winSum('r:iron-plate-c', 60, w.time), w.ach.winSum('r:copper-plate-c', 60, w.time)), 180),
  deep('D05', '화학 산업의 중심', '플라스틱·고무·황산·리튬을 각각 누적 생산', '생산', ['R'], [50, 500, 2500, 10000], '개', (w) =>
    Math.min(made(w, 'plastic'), made(w, 'rubber'), made(w, 'sulfuric-acid'), made(w, 'lithium')),
  ),
  deep('D06', '한 번 더 정제하기', '고효율 모래 세척에서 광물 가루 누적 생산', '생산', ['R'], [100, 1000, 5000, 25000], '개', (w) => recipe(w, 'acid-wash') * 2),
  deep('D07', '자립하는 거점들', '서로 전선으로 이어지지 않은 전력망 중 전력 95% 이상인 가동 망 수 (망마다 한 곳, 누적 180초)', '전력', ['P'], [2, 3, 5, 7], '곳', (w) => {
    let n = 0;
    for (const s of w.netState.values()) if (s.demand >= 100 && s.satisfaction >= 0.95 && s.sites.length) n++;
    return n;
  }, 180),
  deep('D08', '전기를 나누는 공장', '다른 생산 거점(20칸 이상)의 작업에 준 허브 밖 발전 전기 누적', '전력', ['P'], [10, 100, 500, 2000], 'MJ', (w) => kj(w, 'e:link') / 1000),
  deep('D09', '저장해 둔 밤', '한 거점의 한밤 동안 축전기가 작업에 준 전기 (한밤 하나 안에서)', '전력', ['P'], [5, 25, 100, 500], 'MJ', (w) => w.ach.get('d09max') / 1000),
  deep('D10', '지하의 불꽃', '지열이 실제로 공급하는 전력 (누적 180초)', '전력', ['B', 'P'], [300, 600, 1200, 2400], 'kW', (w) => w.powerSrc.get('geo') ?? 0, 180),
  deep('D11', '연료 없이 돌아가는 공장', '허브·연료 없이 공급하는 작업 전력, 전력 95% 이상 (누적 300초)', '전력', ['P'], [500, 2000, 5000, 10000], 'kW', (w) =>
    w.power.satisfaction >= 0.95 ? ['solar', 'wind', 'hydro', 'geo'].reduce((a, k) => a + (w.powerSrc.get(k) ?? 0), 0) : 0, 300),
  deep('D12', '날씨에 맞춘 설계', '가동 구역이 전력 95% 이상으로 버틴 현지 날씨 종류 (종류마다 60초)', '지역', ['B', 'P', 'W'], [2, 3, 5, 7], '종', (w) => {
    let n = 0;
    for (const [k, v] of w.ach.num) if (k.startsWith('wx:') && v >= 60) n++;
    return n;
  }),
  deep('D13', '끊이지 않는 납품', '트럭이 다른 정류장에 배송한 누적 개수', '물류', ['K'], [100, 1000, 10000, 100000], '개', (w) => w.stats.delivered),
  deep('D14', '멀리서 온 재료', '한 번에 20개 이상 배송한 정류장 사이 직선거리', '물류', ['K'], [20, 40, 60, 80], '칸', (w) => w.ach.get('d14')),
  deep('D15', '한 바퀴의 설계', '20개 이상 배송한 노선 한 바퀴의 서로 다른 정류장 수', '물류', ['K'], [3, 4, 6, 8], '곳', (w) => w.ach.get('d15')),
  deep('D16', '지역을 잇는 길', '최근 300초에 20개 이상 배송이 오간 지형 수', '지역', ['B'], [2, 3, 5, 7], '종', (w) =>
    TERRAIN_IDS.filter((t) => w.ach.winSum(`td:${t}`, 300, w.time) >= 20).length,
  ),
  deep('D17', '광맥 뒤의 정원사', '다 캔 광맥 자리에 심어 지금 다 자란 나무', '숲', ['K'], [25, 50, 100, 250], '그루', (w) => w.revivedLand().revived),
  deep('D18', '일곱 땅의 공장', '생산·발전 거점이 있는 지형 수 (건물 3개 이상, 최근 300초 제작 100개 또는 발전 5MJ)', '지역', ['B'], [2, 3, 5, 7], '종', (w) => w.terrainBases()),
  deep('D19', '다시 자라는 자원', '심은 나무가 다 자란 누적 횟수', '숲', ['K'], [100, 1000, 5000, 20000], '회', (w) => w.stats.treesMatured),
  deep('D20', '특산품 교역망', '특산 원료를 다른 지형으로 100개 이상 보낸 출발 지형 수', '지역', ['B', 'R'], [2, 3, 5, 7], '종', (w) =>
    TERRAIN_IDS.filter((t) => w.ach.get(`d20:${t}`) >= 100).length,
  ),
  deep('D21', '배터리 공업', '배터리 팩 누적 생산', '생산', ['R'], [25, 250, 1000, 5000], '개', (w) => made(w, 'battery-pack')),
  deep('D22', '연결을 만드는 산업', '절연 전선·고용량 케이블을 각각 누적 생산', '생산', ['R'], [100, 500, 2500, 10000], '개', (w) =>
    Math.min(made(w, 'insulated-wire'), made(w, 'hc-cable')),
  ),
  deep('D23', '마찰을 줄이는 재료', '고급 윤활제 누적 생산', '생산', ['R'], [50, 250, 1000, 5000], '개', (w) => made(w, 'adv-lubricant')),
  deep('D25', '중간재의 동업', '구동부·절연 모터·산업 제어기의 최근 60초 생산 (누적 180초)', '생산', ['R'], [1, 2, 4, 8], '개', (w) =>
    Math.min(q60(w, 'bronze-drive'), q60(w, 'motor'), q60(w, 'controller')), 180),
  deep('D26', '복합 조립 공장', '설비 모듈의 최근 60초 생산 (누적 300초)', '생산', ['R'], [1, 2, 4, 8], '개', (w) => q60(w, 'module'), 300),
  deep('D27', '약속을 지키는 노선', '성공 정기편 10회를 기록한 서로 다른 계획 운송 노선 수', '물류', ['L'], [1, 3, 6, 10], '개', (w) => {
    let n = 0;
    for (const [k, v] of w.ach.num) if (k.startsWith('d27:') && v >= 10) n++;
    return n;
  }),
  deep('D28', '서로 필요한 공장들', '한 조립 거점으로 이어진 가동 생산 거점 수 (누적 180초)', '지역', ['B', 'R', 'P', 'L'], [2, 3, 4, 6], '곳', (w) => w.supplyNetwork(), 180),

  // ───── 숨은 16 ─────
  hidden('H01', '길 아래의 길', '길이 하나뿐일 필요는 없어요.', '도로 아래를 건너는 지하 컨베이어로 60초 안에 20개가 지나가고 같은 도로로 트럭이 지나감', '물류', ['K'], (w) => w.ach.get('h01') > 0),
  hidden('H02', '같은 자리의 새 생명', '숲은 돌아오는 길을 알아요.', '같은 칸에서 식목 → 성숙 → 벌목 → 다시 식목', '숲', ['K'], (w) => w.ach.get('h02') > 0),
  hidden('H03', '폐광의 약속', '마지막 한 조각 뒤에도 이야기는 남아요.', '광맥이 바닥난 마지막 칸에 심은 나무가 다 자람', '숲', ['K'], (w) => w.ach.get('h03') > 0),
  hidden('H04', '바람을 기다린 사람', '바람이 부는 동안 새 이웃이 생겼어요.', '흐림·비·폭풍 중에 지은 풍력 발전기가 실제 수요에 1MJ', '전력', ['K'], (w) => w.ach.get('h04') > 0),
  hidden('H05', '안개 속 택배', '잘 보이지 않는 날에도 도착할 수 있어요.', '안개 속에 출발·도착해 20칸 넘게 떨어진 곳에 20개 이상 배송', '물류', ['W'], (w) => w.ach.get('h05') > 0),
  hidden('H06', '눈꽃 배송', '차가운 길에도 따뜻한 소식이 와요.', '눈 오는 눈밭 정류장에서 눈 오는 다른 눈밭 정류장(20칸 이상)으로 20개 이상 배송', '지역', ['B', 'W'], (w) => w.ach.get('h06') > 0),
  hidden('H07', '모래바람에 빌려온 낮', '해가 가려져도 남겨 둔 빛이 있어요.', '모래사막에서 맑은 낮 태양광으로 채운 축전기가 모래 바람 중 작업에 1MJ', '전력', ['B', 'P', 'W'], (w) => w.ach.get('h07') >= 1000),
  hidden('H08', '여기는 햇빛 휴무', '땅마다 하늘의 사정이 달라요.', '화산에 태양광을 지어 화산재로 출력이 0임을 확인', '지역', ['B'], (w) => w.ach.get('h08') > 0),
  hidden('H09', '뜨거운 이웃', '먼 땅의 온기가 숲까지 닿을까요?', '화산 지열 전기가 같은 전력망의 숲 생산 거점 작업에 5MJ', '전력', ['B', 'P'], (w) => w.ach.get('h09') >= 5000),
  hidden('H10', '사막의 물레방아', '물길은 눈에 보이는 강만 있는 게 아니에요.', '사막의 수력 발전기가 다른 지형에서 트럭으로 가져온 물로 5MJ', '지역', ['K', 'B'], (w) => w.ach.get('h10') >= 5000),
  hidden('H11', '한 차에 두 이야기', '한 번의 여행에 두 가지 선물을 담아 보세요.', '트럭 한 대가 다른 두 정류장에서 철광석·구리광석을 10개씩 싣고 한 바퀴 안에 세 번째 정류장에 둘 다 납품', '물류', ['K'], (w) => w.ach.get('h11') > 0),
  hidden('H12', '낮과 밤의 동업', '해와 바람이 교대로 일할 수 있어요.', '같은 날 낮에 태양광 5MJ, 그날 한밤에 풍력 5MJ를 작업에', '전력', ['K'], (w) => w.ach.get('h12') > 0),
  hidden('H13', '리튬의 두 얼굴', '전기를 담는 일 외에도 재능이 있어요.', '300초 안에 배터리 팩·고급 윤활제를 각각 10개 이상 제작', '생산', ['R'], (w) =>
    w.ach.winSum('m:battery-pack', 300, w.time) >= 10 && w.ach.winSum('m:adv-lubricant', 300, w.time) >= 10,
  ),
  hidden('H14', '바람으로 달리는 밤', '밤바람이 바퀴까지 움직여요.', '한밤에 풍력으로 1MJ 넘게 충전한 트럭이 그 밤이 끝나기 전에 20개 이상 배송', '물류', ['P'], (w) => w.ach.get('h14') > 0),
  hidden('H15', '진짜 독립한 오후', '증표 다음에는 실제 하루가 있어요.', '광맥 독립 뒤 철광석·구리광석·석탄을 전혀 쓰지 않고 300초, 그동안 정광 철판·정광 구리판·전기 강철 각 10개', '생산', ['K'], (w) =>
    w.ach.get('h15:secs') >= 300 && w.ach.get('h15:iron-plate-c') >= 10 && w.ach.get('h15:copper-plate-c') >= 10 && w.ach.get('h15:steel-e') >= 10,
  ),
  hidden('H16', '공장과 정원', '허브 곁에도 계절이 자랄 수 있어요.', '허브 16칸 안에 심어 다 자란 나무 20그루와 최근 60초 회로·강철 각 10개', '숲', ['K'], (w) =>
    w.gardenTrees() >= 20 && q60(w, 'circuit') >= 10 && q60(w, 'steel') >= 10,
  ),
];

ACHIEVEMENTS.push(...RECORDS);

export const ACH_BY_ID: Record<string, AchDef> = Object.fromEntries(ACHIEVEMENTS.map((a) => [a.id, a]));

/** 이 세계에서 켜진 업적 (예전 세계는 기본 기능 K만) */
export function activeAchievements(w: World): AchDef[] {
  return ACHIEVEMENTS.filter((a) => w.regional || a.needs.every((n) => n === 'K'));
}

/**
 * 1초마다 판정 (시뮬레이션 틱 안에서). 새로 이룬 것의 id ("D13:2" = 심화 2단계)
 */
export function evaluateAchievements(w: World): string[] {
  const s = w.ach;
  const got: string[] = [];
  for (const a of activeAchievements(w)) {
    if (a.kind === 'first' || a.kind === 'hidden') {
      if (s.done.has(a.id) || !a.check!(w)) continue;
      s.done.set(a.id, w.time);
      got.push(a.id);
      continue;
    }
    const level = s.medals.get(a.id) ?? 0;
    if (level >= 4) continue;
    const v = a.value!(w);
    let next = level;
    for (let t = level; t < 4; t++) {
      if (v < a.tiers![t]) break;
      if (a.sustain) {
        const key = `${a.id}:${t}`;
        const secs = (s.secs.get(key) ?? 0) + 1;
        s.secs.set(key, secs);
        if (secs < a.sustain) break;
      }
      next = t + 1;
    }
    if (next > level) {
      s.medals.set(a.id, next);
      got.push(`${a.id}:${next}`);
    }
  }
  return got;
}

/** 공개 완료율 (숨은 업적 제외): [얻은 기록 수, 전체 기록 수] */
export function achProgress(w: World): [number, number] {
  let have = 0;
  let all = 0;
  for (const a of activeAchievements(w)) {
    if (a.kind === 'hidden') continue;
    if (a.kind === 'first') {
      all++;
      if (w.ach.done.has(a.id)) have++;
    } else {
      all += 4;
      have += w.ach.medals.get(a.id) ?? 0;
    }
  }
  return [have, all];
}

/** 조건 충족 누적 초 (심화의 다음 단계) */
export function sustainedSecs(w: World, a: AchDef): number {
  const level = w.ach.medals.get(a.id) ?? 0;
  return w.ach.secs.get(`${a.id}:${level}`) ?? 0;
}
