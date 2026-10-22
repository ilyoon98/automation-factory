import { CHAT_MAX, type Session } from '../net/session';

/** 흘러가는 속도 (px/초). 길이와 상관없이 같은 속도라, 같은 줄에서 뒤 메시지가 앞 메시지를 따라잡지 않는다 */
const SPEED = 170;
/** 줄 간격 (px). 줄 수는 화면 높이에 맞춰 정한다 (위쪽 바 아래 ~ 툴바 위) */
const LANE_H = 32;
/** 같은 줄에서 앞 메시지 꼬리와 띄울 거리 (px) */
const GAP = 48;
/** 너무 빨리 연달아 보내지 않게 (ms) */
const SEND_GAP_MS = 400;

/**
 * 채팅: Enter(또는 위쪽 채팅 버튼)로 입력창을 열고 보내면, 메시지가 화면 오른쪽에서 왼쪽으로 쭉 흘러가다 사라진다.
 * 같이 하면 방 안의 모두에게, 혼자면 내 화면에만 뜬다.
 */
export class Chat {
  private flow = document.getElementById('chat-flow')!;
  private box = document.getElementById('chat-box')!;
  private input = this.box.querySelector('input')!;
  /** 줄마다 마지막 메시지 꼬리가 화면에 다 들어오는 시각 (ms). 그 뒤에야 같은 줄에 다음 메시지를 띄운다 */
  private laneFree: number[] = [];
  private sentAt = 0;

  constructor(private session: Session) {
    this.input.maxLength = CHAT_MAX;

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
    document.getElementById('btn-chat')!.addEventListener('click', () => this.open());
  }

  open(): void {
    this.input.placeholder =
      this.session.role === 'solo' ? '혼자 할 땐 내 화면에만 보여요' : `모두에게 보내기 (${this.session.players}명)`;
    this.box.hidden = false;
    this.input.focus();
  }

  close(): void {
    if (this.box.hidden) return;
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
