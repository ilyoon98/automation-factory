import { afterEach, expect, it, vi } from 'vitest';
import { Camera } from '../render/camera';
import { World } from '../sim/world';
import { Minimap } from './minimap';

afterEach(() => vi.unstubAllGlobals());

function fixture() {
  const events = new Map<string, (e: Partial<PointerEvent>) => void>();
  vi.stubGlobal('window', { addEventListener: vi.fn() });
  vi.stubGlobal('localStorage', { getItem: () => 'on' });
  const canvas = {
    getContext: () => ({}), hidden: false,
    addEventListener: (name: string, fn: (e: Partial<PointerEvent>) => void) => events.set(name, fn),
    setPointerCapture: vi.fn(),
    getBoundingClientRect: () => ({ left: 20, top: 30, width: 200, height: 100 }),
  };
  const camera = new Camera(); camera.x = 30; camera.y = 20;
  new Minimap(canvas as unknown as HTMLCanvasElement, () => new World(100, 50), camera);
  const fire = (name: string, e: Partial<PointerEvent> = {}) => events.get(name)?.({ pointerId: 1, button: 0, buttons: 1, clientX: 120, clientY: 80, ...e });
  return { camera, fire };
}

it('지도 바깥에서 시작한 드래그와 우클릭으로 화면이 튀지 않는다', () => {
  const f = fixture();
  f.fire('pointermove'); expect(f.camera.x).toBe(30); expect(f.camera.y).toBe(20);
  f.fire('pointerdown', { button: 2 }); expect(f.camera.x).toBe(30);
  f.fire('pointermove'); expect(f.camera.x).toBe(30);
});

it('지도에서 시작한 왼쪽 드래그만 이동하고 지도 경계에서 멈춘다', () => {
  const f = fixture();
  f.fire('pointerdown'); expect(f.camera.x).toBe(50); expect(f.camera.y).toBe(25);
  f.fire('pointermove', { clientX: 1000, clientY: -100 });
  expect(f.camera.x).toBe(100); expect(f.camera.y).toBe(0);
});

it.each(['pointerup', 'pointercancel', 'lostpointercapture'])('%s 뒤에는 마우스 이동으로 지도를 계속 끌지 않는다', name => {
  const f = fixture(); f.fire('pointerdown'); f.fire(name);
  f.fire('pointermove', { clientX: 200 }); expect(f.camera.x).toBe(50);
});
