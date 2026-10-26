import { describe, expect, it } from 'vitest';
import { DAY_SEC, WEATHER_SEC, darkness, skyLabel, sunset, weatherAt, weatherOf } from './ambient';

describe('낮·밤과 날씨', () => {
  it('아침(0초)은 밝고, 밤은 어둡고, 하루가 지나면 다시 아침', () => {
    expect(darkness(0)).toBe(0);
    expect(darkness(DAY_SEC * 0.3)).toBe(0);
    expect(darkness(DAY_SEC * 0.8)).toBe(1);
    expect(darkness(DAY_SEC * 0.65)).toBeGreaterThan(0);
    expect(darkness(DAY_SEC * 0.65)).toBeLessThan(1);
    expect(darkness(DAY_SEC)).toBe(0);
    expect(sunset(DAY_SEC * 0.3)).toBe(0);
    expect(sunset(DAY_SEC * 0.65)).toBeGreaterThan(0.5);
  });

  it('날씨는 씨앗과 시간만으로 정해진다 (같이 하는 사람끼리 같다). 첫 3분은 맑음', () => {
    expect(weatherOf(7, 0)).toBe('clear');
    for (let slot = 1; slot < 50; slot++) expect(weatherOf(7, slot)).toBe(weatherOf(7, slot));
    const kinds = new Set(Array.from({ length: 200 }, (_, s) => weatherOf(123, s + 1)));
    expect(kinds).toEqual(new Set(['clear', 'cloudy', 'fog', 'rain', 'storm']));
    // 바뀌는 순간은 서서히
    const slot = Array.from({ length: 200 }, (_, s) => s + 1).find((s) => weatherOf(5, s) === 'rain' && weatherOf(5, s - 1) === 'clear')!;
    const at = (dt: number) => weatherAt(5, slot * WEATHER_SEC + dt).rain;
    expect(at(0)).toBe(0);
    expect(at(10)).toBeGreaterThan(0);
    expect(at(10)).toBeLessThan(1);
    expect(at(60)).toBe(1);
  });

  it('시계 옆 하늘: 낮 ☀️, 밤 🌙', () => {
    expect(skyLabel(1, 30).icon).toBe('☀️');
    expect(skyLabel(1, DAY_SEC * 0.8).text).toMatch(/밤/);
  });
});
