/**
 * 낮·밤과 날씨를 화면에 보이는 설정과 하늘 아이콘.
 * 하늘 계산은 sim/sky에 있다 (태양광·풍력 출력도 같은 값을 쓴다).
 */
import { darkness, dayPhase, sunset, weatherAt } from '../sim/sky';

export { DAY_SEC, WEATHER_SEC, darkness, dayPhase, forecast, sunset, weatherAt, weatherOf, type WeatherKind } from '../sim/sky';

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

/** 위쪽 시계 옆에 보일 하늘 (아이콘, 설명) */
export function skyLabel(seed: number, time: number): { icon: string; text: string } {
  const w = weatherAt(seed, time).kind;
  const d = darkness(time);
  const night = d > 0.5;
  if (w === 'storm') return { icon: '⛈️', text: night ? '폭풍 치는 밤' : '폭풍' };
  if (w === 'rain') return { icon: '🌧️', text: `${night ? '비 오는 밤' : '비'} (눈밭에는 눈, 사막에는 모래 바람)` };
  if (w === 'fog') return { icon: '🌫️', text: night ? '안개 낀 밤' : '안개' };
  if (w === 'cloudy') return { icon: night ? '☁️' : '⛅', text: night ? '흐린 밤' : '흐림' };
  if (night) return { icon: '🌙', text: '밤' };
  if (sunset(time) > 0.3) return { icon: '🌇', text: dayPhase(time) > 0.5 ? '해 질 녘' : '해 뜰 녘' };
  return { icon: '☀️', text: '낮' };
}
