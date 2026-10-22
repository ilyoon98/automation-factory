/**
 * "글자 또렷하게" (도움말에서 켜기, 기본은 꺼짐).
 * 픽셀 글꼴(갈무리)은 10·12·15px에 맞춰 그려져 있어서, 화면 배율이 125%·150%처럼 정수가 아니면
 * 글자 한 픽셀이 기기 픽셀 1.25개·1.5개에 걸쳐 흐려진다.
 * 켜면 맵(#game)을 뺀 UI 전체를 CSS zoom으로 정수 배율에 맞춘다 (125% → 100% 크기, 150% → 200% 또는 창이 좁으면 100%).
 * 그만큼 창·글자 크기가 바뀌는 대신 모든 선과 글자가 기기 픽셀에 딱 맞는다.
 * 브라우저 확대(Ctrl +/-)도 화면 배율로 잡히므로, 켜 두면 확대해도 정수 배율로 붙는다.
 */
const KEY = 'automation-game/crisp-text';

let on = (() => {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
})();
let zoom = 1;
const listeners: (() => void)[] = [];

/** 지금 UI에 걸린 확대 배율 (꺼져 있거나 화면 배율이 정수면 1) */
export function uiZoom(): number {
  return zoom;
}

export function crispText(): boolean {
  return on;
}

export function setCrispText(v: boolean): void {
  on = v;
  try {
    localStorage.setItem(KEY, v ? '1' : '0');
  } catch {
    // 저장 공간이 막혀도 이번 실행 동안은 그대로 쓴다
  }
  apply();
}

/** 배율이 바뀔 때 (켜고 끄기, 창을 다른 모니터로 옮기기, 브라우저 확대) */
export function onUiZoom(fn: () => void): void {
  listeners.push(fn);
}

/** 켰을 때 UI 폭(화면 기준 CSS px)이 이보다 좁아지면 한 단계 작은 정수 배율로 (위쪽 바가 넘치지 않게) */
const MIN_UI_W = 1200;

/**
 * 화면 배율과 켰을 때 맞출 정수 배율. 가장 가까운 정수가 기본이지만,
 * 키웠을 때 창이 좁아 UI가 넘치면 내림 (예: 1080p 노트북 150% → 200%면 960px 폭이라 100%로)
 */
export function crispTarget(): { dpr: number; target: number } {
  const dpr = window.devicePixelRatio || 1;
  const near = Math.max(1, Math.round(dpr));
  const down = Math.max(1, Math.floor(dpr));
  return { dpr, target: (window.innerWidth * dpr) / near >= MIN_UI_W ? near : down };
}

function apply(): void {
  const { dpr, target } = crispTarget();
  zoom = on ? target / dpr : 1;
  if (Math.abs(zoom - 1) < 0.001) zoom = 1;
  document.documentElement.style.setProperty('--uiz', String(zoom));
  for (const fn of listeners) fn();
}

/** 화면 배율이 바뀌면 다시 맞춘다 (지금 배율이 아니게 되는 순간 한 번 알려 주는 media query) */
function watchDpr(): void {
  const mq = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
  mq.addEventListener(
    'change',
    () => {
      apply();
      watchDpr();
    },
    { once: true },
  );
}

apply();
watchDpr();
// 창 크기에 따라 맞출 배율이 달라질 수 있다 (위 MIN_UI_W)
window.addEventListener('resize', () => {
  if (on) apply();
});
