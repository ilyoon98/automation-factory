import type { TerrainKind } from '../data/terrain';
import { DAY_SEC } from './sky';

/**
 * regional-v1 세계의 날씨 (docs/날씨-확률-발생규칙.md). 예전 세계는 sky.ts의 180초 고정 날씨를 그대로 쓴다.
 *
 * 평온 → 0.25일마다 시작 검사(첫 2일은 없음, 확률 2%에서 4%p씩, 6일째 100%) → 종류 한 번 고르기
 * → 기준 지속 S의 0.5·0.75·1·1.25·1.5배 시점에 종료 검사(10·25·45·70·100%) → 평온.
 * 모든 추첨은 세계 씨앗·사건 순번·검사 번호로만 정해져서, 같은 씨앗과 게임 시간이면 누구나 같은 날씨다
 * (프레임·화면과 무관, 저장 없이도 중간 참가가 같은 결과). 예보는 없다: 화면에는 지금 날씨만 보여 준다.
 */

/** 세계 전체에 하나만 진행하는 주요 날씨 (일반 강수는 지형마다 비·눈·모래 바람으로 보인다) */
export type MajorWeather = 'calm' | 'precip' | 'cloudy' | 'fog' | 'storm';
/** 한 칸에서 실제로 보이는 날씨 */
export type LocalWeather = 'clear' | 'cloudy' | 'fog' | 'rain' | 'snow' | 'sandstorm' | 'storm';

export const LOCAL_WEATHER_LABEL: Record<LocalWeather, string> = {
  clear: '맑음',
  cloudy: '흐림',
  fog: '안개',
  rain: '비',
  snow: '눈',
  sandstorm: '모래 바람',
  storm: '폭풍',
};

/** 종류마다 추첨 가중치와 기준 지속 시간 S (일) */
const KINDS: { kind: Exclude<MajorWeather, 'calm'>; weight: number; days: number }[] = [
  { kind: 'precip', weight: 55, days: 1 },
  { kind: 'cloudy', weight: 20, days: 0.5 },
  { kind: 'fog', weight: 15, days: 0.25 },
  { kind: 'storm', weight: 10, days: 0.25 },
];

const PROTECT_DAYS = 2;
const CHECK_DAYS = 0.25;
const END_STEPS: [number, number][] = [
  [0.5, 0.1],
  [0.75, 0.25],
  [1, 0.45],
  [1.25, 0.7],
  [1.5, 1],
];
/** 날씨가 들어오고 나갈 때 서서히 바뀌는 시간 (초) */
export const WEATHER_FADE_V1 = 20;

/** 한 번의 주요 날씨: 시작·끝 게임 시각 (초) */
export interface WeatherEvent {
  kind: Exclude<MajorWeather, 'calm'>;
  start: number;
  end: number;
}

/** 날씨마다 효과: 태양광 배율, 풍력 kW/대, 트럭 속도, 나무 성장, 양수 처리량·전력 */
export interface WeatherFx {
  solar: number;
  wind: number;
  truck: number;
  tree: number;
  pump: number;
}

export const WEATHER_FX: Record<LocalWeather, WeatherFx> = {
  clear: { solar: 1, wind: 60, truck: 1, tree: 1, pump: 1 },
  cloudy: { solar: 0.75, wind: 100, truck: 1, tree: 1, pump: 1 },
  fog: { solar: 0.8, wind: 60, truck: 0.95, tree: 1, pump: 1 },
  rain: { solar: 0.6, wind: 150, truck: 0.95, tree: 1.25, pump: 1.2 },
  snow: { solar: 0.55, wind: 150, truck: 0.9, tree: 0.75, pump: 1 },
  sandstorm: { solar: 0.5, wind: 150, truck: 0.9, tree: 1, pump: 1 },
  storm: { solar: 0.2, wind: 250, truck: 0.8, tree: 1.25, pump: 1.2 },
};

/** 씨앗·사건 번호·검사 번호·용도로 정한 0~1 난수 */
function roll(seed: number, ev: number, check: number, tag: number): number {
  let h = (seed ^ Math.imul(ev + 1, 0x9e3779b1) ^ Math.imul(check + 1, 0x85ebca6b) ^ Math.imul(tag + 1, 0xc2b2ae35)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** 씨앗마다 날씨 사건을 앞에서부터 필요한 만큼만 만들어 둔다 (같은 씨앗이면 늘 같은 목록) */
const cache = new Map<number, WeatherEvent[]>();

/** time(초)까지의 날씨 사건들 */
export function weatherEvents(seed: number, time: number): WeatherEvent[] {
  let list = cache.get(seed);
  if (!list) cache.set(seed, (list = []));
  while (!list.length || list[list.length - 1].end <= time) {
    const n = list.length;
    const calmStart = n ? list[n - 1].end : 0;
    // 시작 검사: 평온 2.25일부터 0.25일마다
    let start = calmStart;
    for (let k = 1; ; k++) {
      const p = k >= 16 ? 1 : 0.02 + 0.04 * (k - 1);
      if (roll(seed, n, k, 0) < p) {
        start = calmStart + (PROTECT_DAYS + CHECK_DAYS * k) * DAY_SEC;
        break;
      }
    }
    // 종류: 직전 종류는 가중치 절반
    const prev = n ? list[n - 1].kind : null;
    const weights = KINDS.map((k) => k.weight * (k.kind === prev ? 0.5 : 1));
    let r = roll(seed, n, 0, 1) * weights.reduce((a, b) => a + b, 0);
    let pick = KINDS[KINDS.length - 1];
    for (let i = 0; i < KINDS.length; i++) {
      r -= weights[i];
      if (r < 0) {
        pick = KINDS[i];
        break;
      }
    }
    // 종료 검사
    let end = start + pick.days * 1.5 * DAY_SEC;
    for (let s = 0; s < END_STEPS.length; s++) {
      if (roll(seed, n, s, 2) < END_STEPS[s][1]) {
        end = start + pick.days * END_STEPS[s][0] * DAY_SEC;
        break;
      }
    }
    list.push({ kind: pick.kind, start, end });
  }
  return list;
}

/** time에 진행 중인 사건 (없으면 null)과 들어오고 나가는 세기 (0~1) */
export function majorAt(seed: number, time: number): { ev: WeatherEvent | null; mix: number; last: WeatherEvent | null } {
  const t = Math.max(0, time);
  const list = weatherEvents(seed, t);
  let last: WeatherEvent | null = null;
  for (const ev of list) {
    if (ev.start > t) break;
    if (t < ev.end) return { ev, mix: Math.min(1, (t - ev.start) / WEATHER_FADE_V1), last };
    last = ev;
  }
  // 끝난 직후 20초는 서서히 걷힌다
  if (last && t - last.end < WEATHER_FADE_V1) return { ev: null, mix: 1 - (t - last.end) / WEATHER_FADE_V1, last };
  return { ev: null, mix: 0, last };
}

/** 주요 날씨를 그 지형에서 보이는 모습으로 */
export function localKind(major: MajorWeather, terrain: TerrainKind): LocalWeather {
  if (major === 'calm') return 'clear';
  if (major !== 'precip') return major;
  if (terrain === 'snow') return 'snow';
  if (terrain === 'rock' || terrain === 'sand' || terrain === 'salt') return 'sandstorm';
  return 'rain';
}

/** 그 지형의 지금 날씨와 효과 (들어오고 나갈 때는 맑음과 섞는다) */
export function localWeather(seed: number, time: number, terrain: TerrainKind): { kind: LocalWeather; fx: WeatherFx; strength: number } {
  const { ev, mix, last } = majorAt(seed, time);
  const kind = localKind(ev?.kind ?? (mix > 0 && last ? last.kind : 'calm'), terrain);
  const a = WEATHER_FX.clear;
  const b = WEATHER_FX[kind];
  const lerp = (x: number, y: number) => x + (y - x) * mix;
  return {
    kind: mix > 0 ? kind : 'clear',
    strength: mix,
    fx: { solar: lerp(a.solar, b.solar), wind: lerp(a.wind, b.wind), truck: lerp(a.truck, b.truck), tree: lerp(a.tree, b.tree), pump: lerp(a.pump, b.pump) },
  };
}
