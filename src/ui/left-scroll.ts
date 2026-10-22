/**
 * 왼쪽 패널 묶음(#left)은 평소 클릭을 받지 않는다 (pointer-events: none): 판 사이 틈과 스크롤바 자리로 맵을 누를 수 있게.
 * 그러면 스크롤바도 못 끌어서, 내용이 넘쳐 스크롤바가 생겼을 때 마우스가 스크롤바 위에 있는 동안만 클릭을 받게 켠다 (.grab-scroll).
 * 판 위에서 휠로 굴리는 건 원래 된다.
 */
export function letScrollbarDrag(el: HTMLElement): void {
  let on = false;
  const set = (v: boolean) => {
    if (v === on) return;
    on = v;
    el.classList.toggle('grab-scroll', v);
  };
  window.addEventListener('pointermove', (e) => {
    // 끄는 중에는 바깥으로 나가도 그대로
    if (on && e.buttons) return;
    // 스크롤바 너비 = 바깥 너비 - 안쪽 너비 (넘치지 않으면 자리만 있고 막대는 없다)
    const bar = el.offsetWidth - el.clientWidth;
    if (bar <= 0 || el.scrollHeight <= el.clientHeight) return set(false);
    const r = el.getBoundingClientRect();
    set(e.clientX >= r.right - bar && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom);
  });
}
