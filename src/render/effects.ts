/** 개인 화면 설정. 저장 파일·공유 명령에는 포함하지 않는다. */
const KEY = 'automation-game/reduced-motion';
let override: boolean | undefined;
let loaded = false;

export function reducedEffects(): boolean {
  if (!loaded) {
    loaded = true;
    try {
      const saved = localStorage.getItem(KEY);
      if (saved !== null) override = saved === '1';
    } catch { /* 저장 공간 없이도 OS 설정을 따른다 */ }
  }
  return override ?? (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches);
}

export function setReducedEffects(on: boolean): void {
  loaded = true;
  override = on;
  try { localStorage.setItem(KEY, on ? '1' : '0'); } catch { /* 이번 실행 동안 유지 */ }
  if (typeof document !== 'undefined') {
    document.documentElement.classList.toggle('reduced-effects', on);
    document.documentElement.classList.toggle('full-effects', !on);
  }
}
