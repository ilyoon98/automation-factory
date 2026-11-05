/**
 * 켤 때 보이는 시작화면. 공장은 멈춘 채 뒤에 비치고, 이어하기·새 공장·같이 하기를 한곳에서 고른다.
 * 새로고침 뒤 방에 다시 들어가는 중이면 띄우지 않는다 (main.ts).
 */
export interface StartState {
  /** 이어 할 저장 공장이 있는지 */
  hasSave: boolean;
  /** 저장 공장의 일차·거점 수 (이어하기 버튼 아래 한 줄) */
  day: number;
  sites: number;
  /** 같이 하기를 쓸 수 있는지 (exe이거나 게임 서버로 열었을 때) */
  netReady: boolean;
  /** 같은 와이파이에 들어갈 수 있는 방 수 */
  rooms: number;
  version: string;
}

export interface StartActions {
  /** 시작화면을 닫고 지금 공장을 이어 한다 (저장이 없으면 방금 만든 새 공장) */
  play(): void;
  /** 지금 공장을 보관하고 새 공장으로 바꾼다 */
  newFactory(): void;
  together(): void;
}

/** 새 공장은 저장이 있으면 한 번 더 눌러야 바꾼다 (confirm: 두 번째 누름을 기다리는 중) */
export function startScreenHtml(s: StartState, confirm = false): string {
  const play = s.hasSave
    ? `<button class="primary" data-start="play">이어하기<small>${s.day}일차 · 거점 ${s.sites}곳</small></button>`
    : `<button class="primary" data-start="play">새 공장 시작<small>처음이면 조작 도움말이 함께 열려요</small></button>`;
  const fresh = s.hasSave
    ? `<button data-start="new" class="${confirm ? 'danger' : ''}">${confirm ? '한 번 더 누르면 새 공장' : '새 공장'}<small>${confirm ? '지금 공장은 메뉴의 ‘바로 전 공장으로’로 되돌릴 수 있어요' : '지금 공장은 되돌리기용으로 보관해요'}</small></button>`
    : '';
  const rooms = s.rooms ? `같은 와이파이에 열린 방 ${s.rooms}개` : '방 만들기 · 같은 와이파이의 방 참가';
  const together = `<button data-start="together" ${s.netReady ? '' : 'disabled title="설치한 게임이나 게임 서버(npm run host)로 열었을 때 쓸 수 있어요"'}>👥 같이 하기<small>${s.netReady ? rooms : '설치판에서 쓸 수 있어요'}</small></button>`;
  return `<div class="start-card">
    <h1>자동화 공장</h1>
    <div class="start-actions">${play}${fresh}${together}</div>
    <p class="muted">게임 버전 ${s.version}</p>
  </div>`;
}

export class StartScreen {
  private confirmNew = false;
  private html = '';
  private state: StartState | null = null;

  constructor(private el: HTMLElement, actions: StartActions) {
    el.addEventListener('click', (e) => {
      const act = (e.target as HTMLElement).closest<HTMLElement>('[data-start]')?.dataset.start;
      if (act === 'play') this.choose(() => actions.play());
      else if (act === 'together') this.choose(() => actions.together());
      else if (act === 'new') {
        if (this.state?.hasSave && !this.confirmNew) {
          this.confirmNew = true;
          this.render(true);
          return;
        }
        this.choose(() => actions.newFactory());
      }
    });
    // 단축키보다 먼저: Esc는 이어하기, 버튼 밖의 Space는 뒤 공장의 정지 풀기로 새지 않게 막는다
    window.addEventListener(
      'keydown',
      (e) => {
        if (!this.isOpen) return;
        const onButton = e.target instanceof HTMLElement && !!e.target.closest('button');
        if (e.key === 'Escape') this.choose(() => actions.play());
        else if (e.key !== ' ' || onButton) return;
        e.preventDefault();
        e.stopImmediatePropagation();
      },
      true,
    );
  }

  get isOpen(): boolean {
    return !this.el.hidden;
  }

  open(s: StartState): void {
    this.confirmNew = false;
    this.update(s);
    this.el.hidden = false;
    this.el.querySelector<HTMLButtonElement>('[data-start="play"]')?.focus();
  }

  /** 열려 있는 동안 방 목록·연결 상태가 바뀌면 다시 그린다 (같으면 그대로 두어 누르는 중인 버튼이 바뀌지 않게) */
  update(s: StartState): void {
    this.state = s;
    this.render(false);
  }

  private render(focusNew: boolean): void {
    if (!this.state) return;
    const html = startScreenHtml(this.state, this.confirmNew);
    if (html === this.html) return;
    const focused = (document.activeElement as HTMLElement | null)?.dataset?.start;
    this.html = html;
    this.el.innerHTML = html;
    const again = focusNew ? 'new' : focused;
    if (again) this.el.querySelector<HTMLButtonElement>(`[data-start="${again}"]`)?.focus();
  }

  private choose(run: () => void): void {
    this.el.hidden = true;
    this.confirmNew = false;
    run();
  }
}
