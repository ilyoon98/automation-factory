/**
 * 낮·밤과 날씨 (화면만. 생산·전력 같은 게임 규칙은 그대로).
 * 게임 시간(world.time)과 맵 씨앗(seed)만으로 정해서, 같이 하는 사람끼리 같은 하늘을 본다.
 */

const SETTING_KEY = 'automation-ambient';
let enabled: boolean | null = null;

/** 낮·밤과 날씨를 보일지 (도움말의 설정, 이 PC에 저장. 기본은 켬) */
export function ambientEnabled(): boolean {
  if (enabled === null) {
    try {
      enabled = localStorage.getItem(SETTING_KEY) !== '0';
    } catch {
      enabled = true;
    }
  }
  return enabled;
}

export function setAmbientEnabled(on: boolean): void {
  enabled = on;
  try {
    localStorage.setItem(SETTING_KEY, on ? '1' : '0');
  } catch {
    // 저장 공간이 없으면 이번 실행 동안만
  }
}

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

export type WeatherKind = 'clear' | 'cloudy' | 'rain';

/** 날씨 칸(slot)마다 정해진 날씨: 맑음 60% · 흐림 25% · 비 15% */
export function weatherOf(seed: number, slot: number): WeatherKind {
  let h = (seed ^ Math.imul(slot + 1, 0x9e3779b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  const r = ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  // 맨 처음(새 게임 첫 3분)은 늘 맑게
  if (slot === 0) return 'clear';
  return r < 0.6 ? 'clear' : r < 0.85 ? 'cloudy' : 'rain';
}

/** 지금 날씨와 세기 (cloud: 흐린 정도 0~1, rain: 비 0~1). 날씨가 바뀔 때 서서히 */
export function weatherAt(seed: number, time: number): { kind: WeatherKind; cloud: number; rain: number } {
  const slot = Math.floor(Math.max(0, time) / WEATHER_SEC);
  const into = Math.max(0, time) - slot * WEATHER_SEC;
  const cur = weatherOf(seed, slot);
  const prev = slot > 0 ? weatherOf(seed, slot - 1) : cur;
  const k = smooth(into / WEATHER_FADE);
  const cloudOf = (w: WeatherKind) => (w === 'clear' ? 0 : w === 'cloudy' ? 0.6 : 1);
  const rainOf = (w: WeatherKind) => (w === 'rain' ? 1 : 0);
  return {
    kind: cur,
    cloud: cloudOf(prev) + (cloudOf(cur) - cloudOf(prev)) * k,
    rain: rainOf(prev) + (rainOf(cur) - rainOf(prev)) * k,
  };
}

/** 위쪽 시계 옆에 보일 하늘 (아이콘, 설명) */
export function skyLabel(seed: number, time: number): { icon: string; text: string } {
  const w = weatherAt(seed, time).kind;
  const d = darkness(time);
  const night = d > 0.5;
  if (w === 'rain') return { icon: '🌧️', text: night ? '비 오는 밤' : '비' };
  if (w === 'cloudy') return { icon: night ? '☁️' : '⛅', text: night ? '흐린 밤' : '흐림' };
  if (night) return { icon: '🌙', text: '밤' };
  if (sunset(time) > 0.3) return { icon: '🌇', text: dayPhase(time) > 0.5 ? '해 질 녘' : '해 뜰 녘' };
  return { icon: '☀️', text: '낮' };
}
