import { CHAT_MAX, type Session } from '../net/session';
import { topbar } from './topbar';

/** 흘러가는 속도 (px/초). 길이와 상관없이 같은 속도라, 같은 줄에서 뒤 메시지가 앞 메시지를 따라잡지 않는다 */
const SPEED = 170;
/** 줄 간격 (px). 줄 수는 화면 높이에 맞춰 정한다 (위쪽 바 아래 ~ 툴바 위) */
const LANE_H = 32;
/** 같은 줄에서 앞 메시지 꼬리와 띄울 거리 (px) */
const GAP = 48;
/** 너무 빨리 연달아 보내지 않게 (ms) */
const SEND_GAP_MS = 400;
/** 기억해 두는 지난 채팅 수와, 입력창을 열 때 위에 보여 주는 수 (흘러가는 걸 놓쳤을 때 다시 보려고) */
const HISTORY = 30;
const LOG_SHOW = 6;

/**
 * 채팅: Enter(또는 위쪽 채팅 버튼)로 입력창을 열고 보내면, 메시지가 화면 오른쪽에서 왼쪽으로 쭉 흘러가다 사라진다.
 * 함께 하기 방에 들어가 있을 때만 (혼자면 위쪽 버튼이 비활성). 입력창은 위쪽 바 아래, 채팅 버튼 오른쪽에 맞춘 팝오버
 */
export class Chat {
  private flow = document.getElementById('chat-flow')!;
  private box = document.getElementById('chat-box')!;
  private input = this.box.querySelector('input')!;
  /** 줄마다 마지막 메시지 꼬리가 화면에 다 들어오는 시각 (ms). 그 뒤에야 같은 줄에 다음 메시지를 띄운다 */
  private laneFree: number[] = [];
  private sentAt = 0;
  /** 지난 채팅 (이름·색은 받은 때 그대로) */
  private history: { name: string; color: string; text: string; mine: boolean }[] = [];
  private log = document.createElement('div');

  constructor(private session: Session) {
    this.input.maxLength = CHAT_MAX;
    this.log.className = 'chat-log';
    this.box.append(this.log);

    window.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' || e.isComposing) return;
      const t = e.target;
      if (t instanceof HTMLInputElement || t instanceof HTMLSelectElement || t instanceof HTMLTextAreaElement) return;
      e.preventDefault();
      this.open();
    });
    this.input.addEventListener('keydown', (e) => {
      // 한글 조합 중에 누른 Enter는 글자를 끝내는 것이라 보내지 않는다 (바로 뒤에 진짜 Enter가 한 번 더 온다)
      if (e.isComposing || e.keyCode === 229) return;
      if (e.key === 'Enter') {
        e.preventDefault();
        this.send();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        this.input.value = '';
        this.close();
      }
    });
    // 다른 곳을 누르면 닫는다 (쓰던 글은 남겨 둔다)
    this.input.addEventListener('blur', () => this.close());
    const btn = document.getElementById('btn-chat')!;
    topbar.register('chat', this.box, btn, 'right');
    btn.addEventListener('click', () => this.open());
  }

  open(): void {
    if (this.session.role === 'solo') return;
    this.input.placeholder = `모두에게 보내기 (${this.session.players}명)`;
    this.renderLog();
    topbar.open('chat');
    this.input.focus();
  }

  /** 입력창 위에 최근 채팅 몇 줄 */
  private renderLog(): void {
    const recent = this.history.slice(-LOG_SHOW);
    this.log.hidden = recent.length === 0;
    this.log.replaceChildren(
      ...recent.map((m) => {
        const row = document.createElement('div');
        if (m.mine) row.className = 'mine';
        const who = document.createElement('b');
        who.textContent = m.name;
        who.style.color = m.color;
        row.append(who, document.createTextNode(m.text));
        return row;
      }),
    );
  }

  close(): void {
    if (this.box.hidden) return;
    if (topbar.isOpen('chat')) topbar.close(false);
    this.box.hidden = true;
    this.input.blur();
  }

  private send(): void {
    const text = this.input.value.trim();
    if (text) {
      const now = performance.now();
      if (now - this.sentAt < SEND_GAP_MS) return;
      this.sentAt = now;
      this.session.chat(text);
    }
    this.input.value = '';
    this.close();
  }

  /** 메시지 하나를 오른쪽 끝에서 왼쪽 끝까지 흘려보낸다 */
  show(from: number, text: string): void {
    const s = this.session;
    const el = document.createElement('div');
    el.className = from === s.me ? 'chat-msg mine' : 'chat-msg';
    const who = document.createElement('b');
    who.textContent = s.role === 'solo' ? s.myName || '나' : s.nameOf(from);
    who.style.color = s.colorOf(from);
    el.append(who, document.createTextNode(text));
    this.flow.append(el);
    this.history.push({ name: who.textContent, color: who.style.color, text, mine: from === s.me });
    if (this.history.length > HISTORY) this.history.shift();
    if (!this.box.hidden) this.renderLog();

    const w = el.offsetWidth;
    const W = this.flow.clientWidth;
    const now = performance.now();
    const lane = this.pickLane(now);
    el.style.top = `${lane * LANE_H}px`;
    this.laneFree[lane] = now + ((w + GAP) / SPEED) * 1000;
    const anim = el.animate([{ transform: `translateX(${W}px)` }, { transform: `translateX(${-w}px)` }], {
      duration: ((W + w) / SPEED) * 1000,
      easing: 'linear',
    });
    anim.onfinish = () => el.remove();
  }

  /** 비어 있는 줄 중 아무 줄. 다 차 있으면 가장 먼저 비는 줄 (살짝 겹쳐도 메시지를 미루지는 않는다) */
  private pickLane(now: number): number {
    const lanes = Math.max(1, Math.floor(this.flow.clientHeight / LANE_H));
    const free: number[] = [];
    let best = 0;
    for (let i = 0; i < lanes; i++) {
      const t = this.laneFree[i] ?? 0;
      if (t <= now) free.push(i);
      else if (t < (this.laneFree[best] ?? 0)) best = i;
    }
    return free.length ? free[Math.floor(Math.random() * free.length)] : best;
  }
}
