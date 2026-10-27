import { describe, expect, it } from 'vitest';
import { DAY_SEC } from './sky';
import { WEATHER_FX, localKind, localWeather, majorAt, weatherEvents } from './weather-v1';
import { TICK_RATE, World } from './world';

/** docs/날씨-확률-발생규칙.md: 시작 확률·종류·종료 확률, 지역 변환, 효과 */

const S = { precip: 1, cloudy: 0.5, fog: 0.25, storm: 0.25 };

describe('날씨 시작·종료', () => {
  it('평온 2일 동안은 날씨가 없고, 평온은 길어야 6일', () => {
    for (let seed = 1; seed <= 300; seed++) {
      const list = weatherEvents(seed, 60 * DAY_SEC);
      let calm = 0;
      for (const ev of list) {
        const gap = (ev.start - calm) / DAY_SEC;
        expect(gap).toBeGreaterThanOrEqual(2.25 - 1e-9);
        expect(gap).toBeLessThanOrEqual(6 + 1e-9);
        // 0.25일 간격 검사 시점에만 시작
        expect(Math.abs(gap * 4 - Math.round(gap * 4))).toBeLessThan(1e-9);
        const dur = (ev.end - ev.start) / DAY_SEC / S[ev.kind];
        expect([0.5, 0.75, 1, 1.25, 1.5].some((k) => Math.abs(dur - k) < 1e-9)).toBe(true);
        calm = ev.end;
      }
    }
  });

  it('장기 평균: 주요 날씨 시작 간격 약 4.29일, 일반 강수 지속 약 1일', () => {
    const gaps: number[] = [];
    const rain: number[] = [];
    const kinds = { precip: 0, cloudy: 0, fog: 0, storm: 0 };
    for (let seed = 1; seed <= 400; seed++) {
      const list = weatherEvents(seed, 200 * DAY_SEC);
      for (let i = 1; i < list.length; i++) gaps.push((list[i].start - list[i - 1].start) / DAY_SEC);
      for (const ev of list) {
        kinds[ev.kind]++;
        if (ev.kind === 'precip') rain.push((ev.end - ev.start) / DAY_SEC);
      }
    }
    const avg = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
    expect(avg(gaps)).toBeGreaterThan(4.1);
    expect(avg(gaps)).toBeLessThan(4.5);
    expect(avg(rain)).toBeGreaterThan(0.95);
    expect(avg(rain)).toBeLessThan(1.07);
    const total = kinds.precip + kinds.cloudy + kinds.fog + kinds.storm;
    // 반복 완화 뒤 장기 비율: 강수 약 49% · 흐림 22% · 안개 17% · 폭풍 12%
    expect(kinds.precip / total).toBeCloseTo(0.4908, 1);
    expect(kinds.storm / total).toBeCloseTo(0.1169, 1);
  });

  it('같은 씨앗·시각이면 같은 날씨 (계산 순서와 무관)', () => {
    const t = 37.3 * DAY_SEC;
    const a = majorAt(5, t);
    weatherEvents(6, 100 * DAY_SEC);
    expect(majorAt(5, t)).toEqual(a);
  });

  it('지역 변환: 강수는 눈밭에서 눈, 사막·염호에서 모래 바람, 화산·숲·초원은 비', () => {
    expect(localKind('precip', 'snow')).toBe('snow');
    expect(localKind('precip', 'sand')).toBe('sandstorm');
    expect(localKind('precip', 'salt')).toBe('sandstorm');
    expect(localKind('precip', 'rock')).toBe('sandstorm');
    expect(localKind('precip', 'volcano')).toBe('rain');
    expect(localKind('storm', 'snow')).toBe('storm');
    expect(localKind('calm', 'forest')).toBe('clear');
  });

  it('들어올 때 20초에 걸쳐 서서히', () => {
    const ev = weatherEvents(9, 30 * DAY_SEC)[0];
    const half = localWeather(9, ev.start + 10, 'grass');
    expect(half.strength).toBeCloseTo(0.5, 3);
    expect(localWeather(9, ev.start - 1, 'grass').kind).toBe('clear');
  });
});

describe('날씨 효과', () => {
  it('폭풍에는 트럭이 ×0.8로 달리고 칸당 전기는 그대로', () => {
    // 폭풍이 오는 씨앗과 시각을 찾는다
    let seed = 1;
    let at = 0;
    for (; seed < 500 && !at; seed++) {
      const ev = weatherEvents(seed, 40 * DAY_SEC).find((e) => e.kind === 'storm');
      if (ev) at = ev.start + 30;
    }
    seed--;
    expect(at).toBeGreaterThan(0);
    const make = (time: number) => {
      const w = new World(60, 20);
      w.rules = 'regional-v1';
      w.seed = seed;
      w.time = time;
      w.terrain = new Uint8Array(60 * 20);
      w.createHub(0, 0);
      for (const t of w.techs) w.applyTech(t.id);
      w.stock.set('steel', 100);
      w.stock.set('gear', 100);
      w.stock.set('circuit', 100);
      w.stock.set('iron-plate', 500);
      w.stock.set('stone', 500);
      for (let x = 4; x < 58; x++) w.place('road', x, 10, 0);
      const a = w.place('station', 4, 8, 0)!;
      const b = w.place('station', 54, 8, 0)!;
      w.setStationMode(b, 'unload');
      const v = w.buildTruck(a)!;
      v.stops = [
        { id: b.id, act: 'unload' },
        { id: a.id, act: 'load' },
      ];
      v.stop = 0;
      v.state = 'to-unload';
      return { w, v };
    };
    const calm = make(1);
    const storm = make(at);
    for (let i = 0; i < 2 * TICK_RATE; i++) {
      calm.w.tick();
      storm.w.tick();
    }
    const dCalm = calm.v.x - 4.5;
    const dStorm = storm.v.x - 4.5;
    expect(dStorm / dCalm).toBeCloseTo(WEATHER_FX.storm.truck, 1);
    // 같은 거리만큼 쓴 전기: 칸당 15kJ
    expect((1800 * 1.5 - storm.v.battery) / dStorm).toBeCloseTo(15, 0);
  });
});
