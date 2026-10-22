export const MIN_ZOOM = 6;
export const MAX_ZOOM = 100;

/**
 * 픽셀아트가 또렷하게 보이는 줌만 쓴다: 그림 1픽셀 = 기기 픽셀 n개 (1칸 16픽셀 × n).
 * 줌(칸당 CSS 픽셀)은 n × 16 / 화면 배율. 0.5는 멀리서 볼 때만 (조금 거칠다)
 */
const ART_SCALES = [0.5, 1, 2, 3, 4, 5, 6, 7, 8, 10, 12];

function zoomSteps(): number[] {
  const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
  const steps = ART_SCALES.map((n) => (n * 16) / dpr).filter((z) => z >= MIN_ZOOM && z <= MAX_ZOOM);
  return steps.length ? steps : [16 / dpr];
}

/** 가장 가까운 단계 번호 (비율로 비교) */
function nearestStep(steps: number[], z: number): number {
  let best = 0;
  for (let i = 1; i < steps.length; i++) if (Math.abs(Math.log(steps[i] / z)) < Math.abs(Math.log(steps[best] / z))) best = i;
  return best;
}

/** 화면 가운데가 가리키는 월드 좌표(칸 단위)와 줌(칸당 픽셀) */
export class Camera {
  x = 0;
  y = 0;
  viewW = 800;
  viewH = 600;
  private z = 32;

  get zoom(): number {
    return this.z;
  }
  /** 아무 값이나 넣어도 가장 가까운 줌 단계로 맞춘다 */
  set zoom(v: number) {
    const steps = zoomSteps();
    this.z = steps[nearestStep(steps, v)];
  }

  /** 화면 배율이 바뀌었을 때 지금 줌을 새 단계에 다시 맞춘다 */
  refit(): void {
    this.zoom = this.z;
  }

  worldToScreen(wx: number, wy: number): [number, number] {
    return [(wx - this.x) * this.zoom + this.viewW / 2, (wy - this.y) * this.zoom + this.viewH / 2];
  }

  screenToWorld(sx: number, sy: number): [number, number] {
    return [(sx - this.viewW / 2) / this.zoom + this.x, (sy - this.viewH / 2) / this.zoom + this.y];
  }

  /** 커서 아래 지점이 고정되도록 줌. factor > 1이면 한 단계 가까이, < 1이면 한 단계 멀리 */
  zoomAt(sx: number, sy: number, factor: number): void {
    const [wx, wy] = this.screenToWorld(sx, sy);
    const steps = zoomSteps();
    const i = nearestStep(steps, this.z) + (factor > 1 ? 1 : factor < 1 ? -1 : 0);
    this.z = steps[Math.max(0, Math.min(steps.length - 1, i))];
    const [wx2, wy2] = this.screenToWorld(sx, sy);
    this.x += wx - wx2;
    this.y += wy - wy2;
  }
}
