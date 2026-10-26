/**
 * 낮·밤과 날씨.
 * 게임 시간(world.time)과 맵 씨앗(seed)만으로 정해서, 같이 하는 사람끼리 같은 하늘을 본다.
 * 화면(render/ambient)뿐 아니라 전력(태양광·풍력)도 이 값을 쓴다.
 */

/** 하루 길이 (게임 시간 초). 0초 = 아침 */
export const DAY_SEC = 720;
/** 날씨가 바뀔 수 있는 간격 (초) */
export const WEATHER_SEC = 180;
/** 날씨가 바뀔 때 서서히 넘어가는 시간 (초) */
const WEATHER_FADE = 20;

// 하루 안의 때 (0~1): 낮 0~0.6 · 해 질 녘 0.6~0.7 · 밤 0.7~0.9 · 해 뜰 녘 0.9~1
const DUSK = 0.6;
const NIGHT = 0.7;
const DAWN = 0.9;

const smooth = (x: number) => {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
};

/** 하루 중 어디쯤인지 (0~1) */
export function dayPhase(time: number): number {
  return (((time % DAY_SEC) + DAY_SEC) % DAY_SEC) / DAY_SEC;
}

/** 어두운 정도: 낮 0 → 밤 1 */
export function darkness(time: number): number {
  const p = dayPhase(time);
  if (p < DUSK) return 0;
  if (p < NIGHT) return smooth((p - DUSK) / (NIGHT - DUSK));
  if (p < DAWN) return 1;
  return 1 - smooth((p - DAWN) / (1 - DAWN));
}

/** 노을 정도 (해 질 녘·해 뜰 녘 가운데에서 1) */
export function sunset(time: number): number {
  const p = dayPhase(time);
  const bump = (a: number, b: number) => (p >= a && p < b ? Math.sin(((p - a) / (b - a)) * Math.PI) : 0);
  return Math.max(bump(DUSK - 0.03, NIGHT), bump(DAWN, 1));
}

/** 맵 전체 날씨 */
export type WeatherKind = 'clear' | 'cloudy' | 'fog' | 'rain' | 'storm';
/** 땅에 따라 달라 보이는 날씨: 비가 눈밭에서는 눈, 사막에서는 모래 바람 */
export type LocalWeather = WeatherKind | 'snow' | 'sandstorm';

/** 날씨 칸(slot)마다 정해진 날씨: 맑음 50% · 흐림 20% · 안개 10% · 비 15% · 폭풍 5% */
export function weatherOf(seed: number, slot: number): WeatherKind {
  let h = (seed ^ Math.imul(slot + 1, 0x9e3779b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  const r = ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  // 맨 처음(새 게임 첫 3분)은 늘 맑게
  if (slot === 0) return 'clear';
  return r < 0.5 ? 'clear' : r < 0.7 ? 'cloudy' : r < 0.8 ? 'fog' : r < 0.95 ? 'rain' : 'storm';
}

/** 땅(GROUNDS 번호: 1 사막 · 2 눈밭)에서 보이는 날씨 */
export function localWeather(kind: WeatherKind, ground: number): LocalWeather {
  if (kind !== 'rain') return kind;
  return ground === 2 ? 'snow' : ground === 1 ? 'sandstorm' : 'rain';
}

/** 지금 뒤로 날씨가 바뀌는 때들 (시각이 가까운 순, horizon초 안). 같이 하는 사람끼리 같다 */
export function forecast(seed: number, time: number, horizon: number): { kind: WeatherKind; at: number }[] {
  const t = Math.max(0, time);
  const slot = Math.floor(t / WEATHER_SEC);
  const out: { kind: WeatherKind; at: number }[] = [];
  let prev = weatherOf(seed, slot);
  for (let s = slot + 1; s * WEATHER_SEC <= t + horizon; s++) {
    const k = weatherOf(seed, s);
    if (k !== prev) out.push({ kind: k, at: s * WEATHER_SEC });
    prev = k;
  }
  return out;
}

/** 날씨마다 정한 값(of)을, 날씨가 바뀔 때는 앞 날씨에서 서서히 넘어가게 */
export function weatherMix(seed: number, time: number, of: (w: WeatherKind) => number): number {
  const slot = Math.floor(Math.max(0, time) / WEATHER_SEC);
  const into = Math.max(0, time) - slot * WEATHER_SEC;
  const cur = of(weatherOf(seed, slot));
  const prev = slot > 0 ? of(weatherOf(seed, slot - 1)) : cur;
  return prev + (cur - prev) * smooth(into / WEATHER_FADE);
}

/**
 * 지금 날씨와 세기 (모두 0~1, 날씨가 바뀔 때 서서히).
 * cloud: 흐린 정도 · rain: 비(눈밭은 눈, 사막은 모래 바람, 폭풍 포함) · fog: 안개 · storm: 폭풍
 */
export function weatherAt(
  seed: number,
  time: number,
): { kind: WeatherKind; cloud: number; rain: number; fog: number; storm: number } {
  return {
    kind: weatherOf(seed, Math.floor(Math.max(0, time) / WEATHER_SEC)),
    cloud: weatherMix(seed, time, (w) => (w === 'clear' ? 0 : w === 'cloudy' ? 0.6 : w === 'fog' ? 0.3 : 1)),
    rain: weatherMix(seed, time, (w) => (w === 'rain' || w === 'storm' ? 1 : 0)),
    fog: weatherMix(seed, time, (w) => (w === 'fog' ? 1 : 0)),
    storm: weatherMix(seed, time, (w) => (w === 'storm' ? 1 : 0)),
  };
}
