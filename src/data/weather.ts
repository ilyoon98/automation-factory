import type { LocalWeather } from '../sim/sky';

/**
 * 날씨마다 공장에 주는 영향 (0.6.x). 날씨는 공장을 느리게만 하고 멈추거나 부수지 않는다.
 * 컨베이어·기계 속도는 건드리지 않는다 (공장이 계산대로 돌아가는 맛을 지키려고).
 */
export interface WeatherDef {
  name: string;
  icon: string;
  /** 태양광 배율 (해가 있는 만큼에 곱한다) */
  solar: number;
  /** 풍력 발전기 한 대 출력 (kW) */
  wind: number;
  /** 트럭 속도 배율 */
  truck: number;
  /** 나무가 자라는 빠르기 배율 */
  tree: number;
  /** 양수기 속도 배율 */
  pump: number;
}

export const WEATHER: Record<LocalWeather, WeatherDef> = {
  clear: { name: '맑음', icon: '☀️', solar: 1, wind: 60, truck: 1, tree: 1, pump: 1 },
  cloudy: { name: '흐림', icon: '⛅', solar: 0.5, wind: 100, truck: 1, tree: 1, pump: 1 },
  fog: { name: '안개', icon: '🌫️', solar: 0.6, wind: 60, truck: 0.8, tree: 1, pump: 1 },
  rain: { name: '비', icon: '🌧️', solar: 0.25, wind: 150, truck: 0.9, tree: 1.5, pump: 1.2 },
  snow: { name: '눈', icon: '🌨️', solar: 0.25, wind: 150, truck: 0.7, tree: 0, pump: 1 },
  sandstorm: { name: '모래 바람', icon: '🌪️', solar: 0.1, wind: 150, truck: 0.8, tree: 1, pump: 1 },
  storm: { name: '폭풍', icon: '⛈️', solar: 0.1, wind: 250, truck: 0.7, tree: 1.5, pump: 1.2 },
};

/** 날씨 영향을 한 줄로 ("태양광 0.25배 · 풍력 150kW · 트럭 0.9배 · 나무 1.5배") */
export function weatherEffects(w: WeatherDef): string {
  const out = [`태양광 ${w.solar}배`, `풍력 ${w.wind}kW`];
  if (w.truck !== 1) out.push(`트럭 ${w.truck}배`);
  if (w.tree === 0) out.push('나무 안 자람');
  else if (w.tree !== 1) out.push(`나무 ${w.tree}배`);
  if (w.pump !== 1) out.push(`양수기 ${w.pump}배`);
  return out.join(' · ');
}
