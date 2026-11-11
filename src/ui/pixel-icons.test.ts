import { describe, expect, it } from 'vitest';
import { PIXEL_ICONS, iconSvg, skyIcon } from './pixel-icons';
import { LOCAL_WEATHER_ICON } from '../sim/weather-v1';

describe('위쪽 바 픽셀 아이콘', () => {
  it('모든 그림이 12×12 격자이고 팔레트에 있는 색만 쓴다', () => {
    for (const [name, grid] of Object.entries(PIXEL_ICONS)) {
      expect(grid, name).toHaveLength(12);
      for (const row of grid) expect(row.length, `${name}: ${row}`).toBe(12);
      expect(iconSvg(grid), name).not.toContain('undefined');
    }
  });

  it('하늘 이모지마다 아이콘이 있다 (시계에 이모지가 남지 않게)', () => {
    for (const emoji of [...Object.values(LOCAL_WEATHER_ICON), '🌙', '🌇', '☁️']) {
      const name = skyIcon(emoji);
      expect(name, emoji).not.toBeNull();
      expect(PIXEL_ICONS[name!], emoji).toBeDefined();
    }
  });
});
