import { isBeltType } from './buildings';
import type { ItemId } from './items';
import { darkness, weatherAt } from '../sim/sky';
import type { World } from '../sim/world';

/**
 * 업적: 목표가 "다음에 할 것"이라면 업적은 지금까지 해 온 것의 기록.
 * 업적마다 4단계 (동·은·금·다이아). 보상 없이 기록만 남는다.
 * 목표처럼 화면 쪽(ui.ts)에서 확인해 world.achieved에 채우고, 저장에 남긴다.
 */

export type AchievementKind =
  /** 기계가 만든(캔·벤) 총량 */
  | 'made'
  /** 최근 1분 동안 실제로 만든 개수 */
  | 'rate'
  /** 지금 쓰는 전력 (kW) */
  | 'power'
  /** 한밤에 쓰는 전력 (kW) */
  | 'night-power'
  /** 폭풍 속에서 쓰는 전력 (kW) */
  | 'storm-power'
  /** 컨베이어를 뺀 건물 수 (허브 빼고) */
  | 'buildings'
  | 'trucks'
  /** 식목기로 심은 나무 수 */
  | 'planted'
  /** 끝없는 연구 단계 합 */
  | 'endless';

export type AchievementGroup = 'made' | 'rate' | 'factory';

export interface AchievementDef {
  id: string;
  name: string;
  kind: AchievementKind;
  group: AchievementGroup;
  item?: ItemId;
  /** 단계마다 넘어야 할 값 (동·은·금·다이아) */
  tiers: [number, number, number, number];
  /** 그림 (아이템이 없는 업적) */
  icon?: string;
}

export const TIER_NAMES = ['동', '은', '금', '다이아'] as const;
export const TIER_ICONS = ['🥉', '🥈', '🥇', '💎'] as const;

export const ACHIEVEMENT_GROUPS: { id: AchievementGroup; name: string; note: string }[] = [
  { id: 'made', name: '누적 생산', note: '기계가 지금까지 만든(캔·벤) 개수. 허브에 쌓인 양이 아니라서 연구에 써도 줄지 않아요.' },
  { id: 'rate', name: '생산 속도', note: '최근 1분 동안 기계가 실제로 만든 개수. 1분 내내 그 속도로 돌아야 해요.' },
  { id: 'factory', name: '공장', note: '' },
];

const BIG: AchievementDef['tiers'] = [1_000, 10_000, 100_000, 1_000_000];
const MID: AchievementDef['tiers'] = [500, 5_000, 50_000, 500_000];
const SMALL: AchievementDef['tiers'] = [100, 1_000, 10_000, 100_000];

const made = (item: ItemId, name: string, tiers: AchievementDef['tiers']): AchievementDef => ({
  id: `made-${item}`,
  name,
  kind: 'made',
  group: 'made',
  item,
  tiers,
});

const rate = (item: ItemId, name: string, tiers: AchievementDef['tiers']): AchievementDef => ({
  id: `rate-${item}`,
  name,
  kind: 'rate',
  group: 'rate',
  item,
  tiers,
});

export const ACHIEVEMENTS: AchievementDef[] = [
  made('iron-ore', '철광석 캐기', BIG),
  made('copper-ore', '구리광석 캐기', BIG),
  made('coal', '석탄 캐기', BIG),
  made('stone', '돌 캐기', BIG),
  made('iron-plate', '철판 만들기', BIG),
  made('copper-plate', '구리판 만들기', BIG),
  made('gear', '기어 만들기', MID),
  made('copper-wire', '구리선 만들기', BIG),
  made('steel', '강철 만들기', SMALL),
  made('circuit', '회로 만들기', SMALL),
  made('log', '통나무 베기', MID),
  made('wood', '목재 만들기', MID),
  made('paper', '종이 만들기', SMALL),
  made('tin-ore', '주석광석 캐기', MID),
  made('bauxite', '보크사이트 캐기', MID),
  made('bronze', '청동 만들기', SMALL),
  made('aluminum', '알루미늄판 만들기', SMALL),

  rate('iron-plate', '철판 분당', [60, 300, 1_200, 3_000]),
  rate('copper-plate', '구리판 분당', [60, 300, 1_200, 3_000]),
  rate('gear', '기어 분당', [30, 150, 600, 1_500]),
  rate('steel', '강철 분당', [15, 60, 300, 900]),
  rate('circuit', '회로 분당', [15, 60, 300, 900]),
  rate('wood', '목재 분당', [60, 300, 1_200, 3_000]),

  { id: 'power', name: '전력 쓰기', kind: 'power', group: 'factory', tiers: [1_000, 5_000, 20_000, 50_000], icon: '⚡' },
  { id: 'night-power', name: '한밤에 전력 쓰기', kind: 'night-power', group: 'factory', tiers: [500, 2_000, 10_000, 30_000], icon: '🌙' },
  { id: 'storm-power', name: '폭풍 속 전력 쓰기', kind: 'storm-power', group: 'factory', tiers: [500, 2_000, 10_000, 30_000], icon: '⛈️' },
  { id: 'buildings', name: '건물 짓기 (컨베이어 빼고)', kind: 'buildings', group: 'factory', tiers: [50, 200, 1_000, 3_000], icon: '🏭' },
  { id: 'trucks', name: '트럭 굴리기', kind: 'trucks', group: 'factory', tiers: [5, 20, 50, 100], icon: '🚚' },
  { id: 'planted', name: '나무 심기', kind: 'planted', group: 'factory', tiers: [100, 1_000, 10_000, 100_000], icon: '🌱' },
  { id: 'endless', name: '끝없는 연구', kind: 'endless', group: 'factory', tiers: [5, 15, 30, 60], icon: '♾️' },
];

/** 업적이 재는 지금 값 */
export function achievementValue(w: World, a: AchievementDef): number {
  switch (a.kind) {
    case 'made':
      return w.madeTotal.get(a.item!) ?? 0;
    case 'rate':
      return w.madePerMinute(a.item!);
    case 'power':
      return w.power.supply;
    case 'night-power':
      return darkness(w.time) >= 1 ? w.power.supply : 0;
    case 'storm-power':
      return weatherAt(w.seed, w.time).kind === 'storm' ? w.power.supply : 0;
    case 'buildings': {
      let n = 0;
      for (const b of w.buildings.values()) if (b.type !== 'hub' && !isBeltType(b.type) && b.type !== 'underground') n++;
      return n;
    }
    case 'trucks':
      return w.vehicles.size;
    case 'planted':
      return w.planted;
    case 'endless': {
      let n = 0;
      for (const v of w.levels.values()) n += v;
      return n;
    }
  }
}

/** 값으로 닿은 단계 (0 = 아직, 4 = 다이아) */
export function tierOf(a: AchievementDef, value: number): number {
  let t = 0;
  while (t < a.tiers.length && value >= a.tiers[t]) t++;
  return t;
}

/**
 * 새로 오른 업적 단계를 world.achieved에 남기고 돌려준다.
 * 한 번 오른 단계는 내려가지 않는다 (속도·전력이 잠깐 떨어져도).
 */
export function checkAchievements(w: World): { def: AchievementDef; tier: number }[] {
  const up: { def: AchievementDef; tier: number }[] = [];
  for (const a of ACHIEVEMENTS) {
    const before = w.achieved.get(a.id) ?? 0;
    if (before >= a.tiers.length) continue;
    const tier = tierOf(a, achievementValue(w, a));
    if (tier <= before) continue;
    w.achieved.set(a.id, tier);
    up.push({ def: a, tier });
  }
  return up;
}

/** 1,000 → 1천, 10,000 → 1만, 1,500 → 1,500 (만·천으로 딱 떨어질 때만 줄인다) */
export function fmtCount(n: number): string {
  if (n >= 10_000 && n % 10_000 === 0) return `${(n / 10_000).toLocaleString('ko-KR')}만`;
  if (n >= 1_000 && n % 1_000 === 0 && n < 10_000) return `${n / 1_000}천`;
  return Math.floor(n).toLocaleString('ko-KR');
}

/** 업적 값에 단위를 붙인다 */
export function fmtAchievement(a: AchievementDef, n: number): string {
  switch (a.kind) {
    case 'made':
      return `${fmtCount(n)}개`;
    case 'rate':
      return `분당 ${fmtCount(n)}`;
    case 'power':
    case 'night-power':
    case 'storm-power':
      return n >= 1_000 ? `${(Math.floor(n / 100) / 10).toLocaleString('ko-KR')}MW` : `${Math.floor(n)}kW`;
    case 'buildings':
      return `${fmtCount(n)}개`;
    case 'trucks':
      return `${fmtCount(n)}대`;
    case 'planted':
      return `${fmtCount(n)}그루`;
    case 'endless':
      return `${fmtCount(n)}단계`;
  }
}
