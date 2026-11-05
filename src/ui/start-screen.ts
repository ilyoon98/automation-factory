/**
 * 시작화면. 처음 켤 때(저장 없음)와 메뉴의 🏠 시작화면에서 뜬다.
 * 공장은 멈춘 채 뒤에 비치고, 이어하기·새 공장·같이 하기·공장 목록(열기·이름·지우기)을 한곳에서 고른다.
 */
export interface StartSlot {
  id: number;
  name: string;
  day: number;
  sites: number;
  savedAt: number;
}

export interface StartState {
  /** 이어 할 공장이 있는지 (처음 켠 PC면 없다) */
  hasSave: boolean;
  /** 지금 공장의 일차·거점 수 (이어하기 버튼 아래 한 줄) */
  day: number;
  sites: number;
  /** 저장한 공장들 (최근 순)과 지금 공장 */
  slots: StartSlot[];
  active: number;
  /** 공장을 바꿀 수 있는지 (같이 하는 동안 손님은 못 바꾼다) */
  canSwitch: boolean;
  /** 같이 하기를 쓸 수 있는지 (exe이거나 게임 서버로 열었을 때) */
  netReady: boolean;
  /** 같은 와이파이에 들어갈 수 있는 방 수 */
  rooms: number;
  version: string;
}

export interface StartActions {
  /** 시작화면을 닫고 지금 공장을 이어 한다 (저장이 없으면 방금 만든 새 공장) */
  play(): void;
  /** 지금 공장은 목록에 두고 새 공장을 새 칸에 만든다 */
  newFactory(): void;
  together(): void;
  /** 목록의 다른 공장으로 바꿔 이어 한다 */
  open(id: number): void;
  rename(id: number, name: string): void;
  remove(id: number): void;
}

/** 화면 쪽 상태: 이름을 고치는 공장, 지우기를 한 번 누른 공장 */
interface Editing {
  rename: number | null;
  remove: number | null;
}

const NO_EDIT: Editing = { rename: null, remove: null };

export function startScreenHtml(s: StartState, edit: Editing = NO_EDIT): string {
  const current = s.slots.find((x) => x.id === s.active);
  const lock = s.canSwitch ? '' : 'disabled title="같이 하는 동안 손님은 공장을 바꿀 수 없어요"';
  const play = s.hasSave
    ? `<button class="primary" data-start="play">이어하기<small>${current ? `${escapeHtml(current.name)} · ` : ''}${s.day}일차 · 거점 ${s.sites}곳</small></button>`
    : `<button class="primary" data-start="play">새 공장 시작<small>처음이면 조작 도움말이 함께 열려요</small></button>`;
  const fresh = s.hasSave ? `<button data-start="new" ${lock}>새 공장<small>지금 공장은 아래 목록에 남아요</small></button>` : '';
  const rooms = s.rooms ? `같은 와이파이에 열린 방 ${s.rooms}개` : '방 만들기 · 같은 와이파이의 방 참가';
  const together = `<button data-start="together" ${s.netReady ? '' : 'disabled title="설치한 게임이나 게임 서버(npm run host)로 열었을 때 쓸 수 있어요"'}>👥 같이 하기<small>${s.netReady ? rooms : '설치판에서 쓸 수 있어요'}</small></button>`;
  const rows = s.slots
    .map((x) => {
      const now = x.id === s.active;
      const name = edit.rename === x.id
        ? `<input data-rename="${x.id}" value="${escapeHtml(x.name)}" maxlength="24" spellcheck="false" aria-label="공장 이름">`
        : `<span><b>${escapeHtml(x.name)}</b>${now ? '<span class="tag">지금</span>' : ''}</span>`;
      const btns = [
        now ? '' : `<button data-start="open" data-slot="${x.id}" ${lock}>열기</button>`,
        `<button data-start="rename" data-slot="${x.id}">이름</button>`,
        now ? '' : `<button data-start="remove" data-slot="${x.id}" class="${edit.remove === x.id ? 'danger' : ''}" ${lock}>${edit.remove === x.id ? '정말 지우기' : '지우기'}</button>`,
      ].join('');
      return `<div class="start-slot${now ? ' now' : ''}"><div class="start-slot-name">${name}<small>${x.day}일차 · 거점 ${x.sites}곳 · ${savedAt(x.savedAt)}</small></div><div class="start-slot-btns">${btns}</div></div>`;
    })
    .join('');
  const list = s.slots.length ? `<section class="start-slots"><h2>공장 목록</h2>${rows}</section>` : '';
  return `<div class="start-card">
    <h1>자동화 공장</h1>
    <div class="start-actions">${play}${fresh}${together}</div>
    ${list}
    <p class="muted">게임 버전 ${s.version}</p>
  </div>`;
}

export class StartScreen {
  private edit: Editing = { ...NO_EDIT };
  private html = '';
  private state: StartState | null = null;

  constructor(private el: HTMLElement, private actions: StartActions) {
    el.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-start]');
      const act = btn?.dataset.start;
      const id = Number(btn?.dataset.slot);
      if (act === 'play') this.choose(() => actions.play());
      else if (act === 'new') this.choose(() => actions.newFactory());
      else if (act === 'together') this.choose(() => actions.together());
      else if (act === 'open') this.choose(() => actions.open(id));
      else if (act === 'rename') {
        this.edit = { rename: id, remove: null };
        this.render();
        const input = el.querySelector<HTMLInputElement>(`[data-rename="${id}"]`);
        input?.focus();
        input?.select();
      } else if (act === 'remove') {
        if (this.edit.remove !== id) this.edit = { rename: null, remove: id };
        else {
          this.edit = { ...NO_EDIT };
          actions.remove(id);
        }
        this.render();
      }
    });
    // 이름 칸에서 벗어나면 고친 이름을 저장한다
    el.addEventListener('focusout', (e) => {
      if ((e.target as HTMLElement).dataset?.rename) this.commitRename(e.target as HTMLInputElement);
    });
    // 단축키보다 먼저: Esc는 이어하기(이름을 고치는 중이면 취소), 버튼 밖의 Space는 뒤 공장의 정지 풀기로 새지 않게 막는다
    window.addEventListener(
      'keydown',
      (e) => {
        if (!this.isOpen) return;
        const target = e.target instanceof HTMLElement ? e.target : null;
        if (target?.dataset.rename) {
          if (e.key === 'Enter') this.commitRename(target as HTMLInputElement);
          else if (e.key === 'Escape') {
            this.edit = { ...NO_EDIT };
            this.render();
          } else return;
        } else if (e.key === 'Escape') this.choose(() => actions.play());
        else if (e.key !== ' ' || target?.closest('button')) return;
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
    this.edit = { ...NO_EDIT };
    this.update(s);
    this.el.hidden = false;
    this.el.querySelector<HTMLButtonElement>('[data-start="play"]')?.focus();
  }

  /** 열려 있는 동안 방 목록·연결 상태가 바뀌면 다시 그린다 (같으면 그대로 두어 누르는 중인 버튼이 바뀌지 않게) */
  update(s: StartState): void {
    this.state = s;
    this.render();
  }

  private commitRename(input: HTMLInputElement): void {
    const id = Number(input.dataset.rename);
    if (this.edit.rename !== id) return;
    this.edit = { ...NO_EDIT };
    this.actions.rename(id, input.value);
  }

  private render(): void {
    if (!this.state) return;
    const html = startScreenHtml(this.state, this.edit);
    if (html === this.html) return;
    // 이름을 고치는 동안에는 다시 그리지 않는다 (입력 중인 글자가 사라지지 않게)
    const typing = document.activeElement instanceof HTMLElement && document.activeElement.dataset?.rename;
    if (typing && this.edit.rename !== null) return;
    const focused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const again = focused?.dataset?.start ? `[data-start="${focused.dataset.start}"]${focused.dataset.slot ? `[data-slot="${focused.dataset.slot}"]` : ''}` : null;
    this.html = html;
    this.el.innerHTML = html;
    if (again) this.el.querySelector<HTMLElement>(again)?.focus();
  }

  private choose(run: () => void): void {
    this.el.hidden = true;
    this.edit = { ...NO_EDIT };
    run();
  }
}

/** 저장 시각: 오늘이면 시:분, 아니면 월/일 시:분 */
function savedAt(ms: number): string {
  const d = new Date(ms), now = new Date();
  const two = (n: number) => String(n).padStart(2, '0');
  const time = `${two(d.getHours())}:${two(d.getMinutes())}`;
  return d.toDateString() === now.toDateString() ? `오늘 ${time}` : `${d.getMonth() + 1}/${d.getDate()} ${time}`;
}

/** 플레이어가 정한 공장 이름을 HTML에 넣을 때 */
function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}
