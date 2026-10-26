import { describe, expect, it } from 'vitest';
import { FOREST, SOLAR_POWER } from '../data/buildings';
import { DESERT, GRASS, SNOW } from '../data/ground';
import { WEATHER } from '../data/weather';
import { WEATHER_SEC, darkness, forecast, localWeather, weatherOf, type WeatherKind } from './sky';
import { TICK_RATE, World } from './world';

/** 날씨가 kind인 첫 날씨 칸의 한가운데 시각 (바뀌는 중이 아닐 때) */
function timeOf(seed: number, kind: WeatherKind): number {
  for (let slot = 2; slot < 2000; slot++) if (weatherOf(seed, slot) === kind) return slot * WEATHER_SEC + WEATHER_SEC / 2;
  throw new Error(`날씨 ${kind}가 없다`);
}

describe('날씨 더하기', () => {
  it('다섯 가지 날씨가 대략 정한 비율로 나온다', () => {
    const n = 20_000;
    const count: Record<string, number> = {};
    for (let s = 1; s <= n; s++) {
      const k = weatherOf(11, s);
      count[k] = (count[k] ?? 0) + 1;
    }
    expect(count.clear / n).toBeCloseTo(0.5, 1);
    expect(count.cloudy / n).toBeCloseTo(0.2, 1);
    expect(count.fog / n).toBeCloseTo(0.1, 1);
    expect(count.rain / n).toBeCloseTo(0.15, 1);
    expect(count.storm / n).toBeCloseTo(0.05, 1);
  });

  it('비는 눈밭에서 눈, 사막에서 모래 바람', () => {
    expect(localWeather('rain', GRASS)).toBe('rain');
    expect(localWeather('rain', SNOW)).toBe('snow');
    expect(localWeather('rain', DESERT)).toBe('sandstorm');
    expect(localWeather('storm', DESERT)).toBe('storm');
    expect(localWeather('fog', SNOW)).toBe('fog');
  });

  it('예보: 앞으로 바뀌는 날씨만, 정한 시간 안까지', () => {
    const seed = 3;
    const t = 1000;
    const f = forecast(seed, t, 9 * 60);
    let prev = weatherOf(seed, Math.floor(t / WEATHER_SEC));
    for (const e of f) {
      expect(e.at).toBeGreaterThan(t);
      expect(e.at).toBeLessThanOrEqual(t + 9 * 60);
      expect(e.kind).toBe(weatherOf(seed, e.at / WEATHER_SEC));
      expect(e.kind).not.toBe(prev);
      prev = e.kind;
    }
    // 3분 예보는 다음 날씨 칸 하나까지만
    expect(forecast(seed, t, WEATHER_SEC).length).toBeLessThanOrEqual(1);
  });

  it('땅마다 다른 날씨 영향: 비 오는 날 트럭·나무·양수기', () => {
    const w = new World(10, 10);
    w.seed = 21;
    w.time = timeOf(w.seed, 'rain');
    expect(w.skyFactors(GRASS).truck).toBeCloseTo(WEATHER.rain.truck, 6);
    expect(w.skyFactors(SNOW).truck).toBeCloseTo(WEATHER.snow.truck, 6);
    expect(w.skyFactors(DESERT).truck).toBeCloseTo(WEATHER.sandstorm.truck, 6);
    expect(w.skyFactors(GRASS).tree).toBeCloseTo(1.5, 6);
    // 눈이 오면 눈밭 나무는 자라지 않는다
    expect(w.skyFactors(SNOW).tree).toBe(0);
    expect(w.skyFactors(GRASS).pump).toBeCloseTo(1.2, 6);
    const sun = SOLAR_POWER * (1 - darkness(w.time));
    expect(w.solarOutput(DESERT)).toBeCloseTo(sun * WEATHER.sandstorm.solar * 1.5, 6);
    expect(w.windOutput(SNOW)).toBeCloseTo(WEATHER.snow.wind * 1.3, 6);
  });

  it('폭풍에는 풍력 250kW, 안개에는 트럭이 느리다', () => {
    const w = new World(10, 10);
    w.seed = 21;
    w.time = timeOf(w.seed, 'storm');
    expect(w.windOutput()).toBeCloseTo(250, 6);
    w.time = timeOf(w.seed, 'fog');
    expect(w.skyFactors(GRASS).truck).toBeCloseTo(0.8, 6);
    expect(w.windOutput()).toBeCloseTo(60, 6);
  });

  it('비 오는 초원에서 나무가 1.5배 빨리 자란다', () => {
    const w = new World(10, 10);
    w.seed = 21;
    w.time = timeOf(w.seed, 'rain') - WEATHER_SEC / 2 + 25; // 바뀌는 20초가 지난 뒤
    w.setTree(5, 5, 0.001);
    for (let i = 0; i < 10 * TICK_RATE; i++) w.tick();
    expect(w.tree[w.idx(5, 5)]).toBeCloseTo(0.001 + (10 * 1.5) / FOREST.grow, 3);
  });
});
