/**
 * 효과음. 소리 파일 없이 Web Audio로 그 자리에서 만든다 (나무 공방 느낌의 짧고 부드러운 소리).
 * 내가 한 일에만 소리를 낸다 (다른 사람이 짓는 소리까지 나면 시끄러우므로).
 * 음량·끄기는 브라우저에 기억한다.
 */
export type SoundName = 'place' | 'remove' | 'rotate' | 'error' | 'research' | 'goal' | 'truck' | 'undo' | 'chat';

const KEY = 'automation-game/sound';

interface Settings {
  volume: number;
  muted: boolean;
}

function loadSettings(): Settings {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Settings>;
    return { volume: typeof s.volume === 'number' ? Math.min(1, Math.max(0, s.volume)) : 0.6, muted: !!s.muted };
  } catch {
    return { volume: 0.6, muted: false };
  }
}

/** 같은 소리를 이 간격(초)보다 빨리 다시 내지 않는다 (컨베이어를 끌면 칸마다 명령이 나오므로) */
const GAP: Partial<Record<SoundName, number>> = { place: 0.05, remove: 0.05, rotate: 0.04, error: 0.4, chat: 0.2 };

class Sound {
  private settings = loadSettings();
  private ctx: AudioContext | null = null;
  private out: GainNode | null = null;
  private last = new Map<SoundName, number>();
  /** 연달아 지을 때 소리 높이를 조금씩 바꿔 기계음처럼 들리지 않게 */
  private step = 0;

  get volume(): number {
    return this.settings.volume;
  }

  get muted(): boolean {
    return this.settings.muted;
  }

  setVolume(v: number): void {
    this.settings.volume = Math.min(1, Math.max(0, v));
    if (this.settings.volume > 0) this.settings.muted = false;
    this.apply();
  }

  toggleMute(): void {
    this.settings.muted = !this.settings.muted;
    this.apply();
  }

  private apply(): void {
    if (this.out) this.out.gain.value = this.level();
    try {
      localStorage.setItem(KEY, JSON.stringify(this.settings));
    } catch {
      // 저장 공간이 막혀도 이번 실행 동안은 그대로 쓴다
    }
  }

  private level(): number {
    return this.settings.muted ? 0 : this.settings.volume * 0.5;
  }

  /** 브라우저는 사용자가 한 번 누르기 전에는 소리를 막으므로, 처음 소리를 낼 때 만든다 */
  private audio(): AudioContext | null {
    if (!this.ctx) {
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return null;
      this.ctx = new Ctx();
      this.out = this.ctx.createGain();
      this.out.gain.value = this.level();
      this.out.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    return this.ctx;
  }

  play(name: SoundName): void {
    if (this.settings.muted || this.settings.volume <= 0) return;
    const ctx = this.audio();
    if (!ctx || !this.out) return;
    const t = ctx.currentTime;
    const gap = GAP[name] ?? 0.1;
    if (t - (this.last.get(name) ?? -1) < gap) return;
    this.last.set(name, t);
    const wobble = [1, 1.06, 0.97, 1.03][this.step++ % 4];
    switch (name) {
      case 'place':
        // 나무 블록을 내려놓는 "톡"
        this.tone(ctx, 'triangle', 520 * wobble, 260 * wobble, t, 0.09, 0.5);
        this.noise(ctx, t, 0.03, 0.12, 2400);
        break;
      case 'remove':
        // 들어 올리는 "퉁" (낮게)
        this.tone(ctx, 'triangle', 220 * wobble, 340 * wobble, t, 0.1, 0.4);
        this.noise(ctx, t, 0.05, 0.1, 900);
        break;
      case 'rotate':
        this.tone(ctx, 'square', 900, 900, t, 0.03, 0.08);
        break;
      case 'error':
        this.tone(ctx, 'triangle', 196, 180, t, 0.12, 0.35);
        this.tone(ctx, 'triangle', 165, 150, t + 0.11, 0.16, 0.35);
        break;
      case 'research':
        // 도-미-솔 올라가는 소리
        [523, 659, 784].forEach((f, i) => this.tone(ctx, 'triangle', f, f, t + i * 0.08, 0.22, 0.32));
        break;
      case 'goal':
        // 목표 달성: 맑은 종 4음
        [659, 784, 988, 1319].forEach((f, i) => this.bell(ctx, f, t + i * 0.09, 0.6, 0.22));
        break;
      case 'truck':
        // 빵빵
        this.tone(ctx, 'square', 392, 392, t, 0.09, 0.12);
        this.tone(ctx, 'square', 392, 392, t + 0.14, 0.12, 0.12);
        break;
      case 'undo':
        this.tone(ctx, 'sine', 700, 420, t, 0.08, 0.25);
        break;
      case 'chat':
        this.tone(ctx, 'sine', 880, 1175, t, 0.08, 0.2);
        break;
    }
  }

  /** from → to로 미끄러지는 음 하나 (빠르게 올라갔다 천천히 사라짐) */
  private tone(ctx: AudioContext, type: OscillatorType, from: number, to: number, at: number, len: number, vol: number): void {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(from, at);
    o.frequency.exponentialRampToValueAtTime(to, at + len);
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(vol, at + 0.005);
    g.gain.exponentialRampToValueAtTime(0.001, at + len);
    o.connect(g).connect(this.out!);
    o.start(at);
    o.stop(at + len + 0.02);
  }

  /** 종소리: 기본음 + 배음 두 개가 천천히 사라짐 */
  private bell(ctx: AudioContext, f: number, at: number, len: number, vol: number): void {
    this.tone(ctx, 'sine', f, f, at, len, vol);
    this.tone(ctx, 'sine', f * 2, f * 2, at, len * 0.5, vol * 0.3);
    this.tone(ctx, 'sine', f * 3.01, f * 3.01, at, len * 0.25, vol * 0.12);
  }

  /** 짧은 잡음 (나무가 부딪는 질감) */
  private noise(ctx: AudioContext, at: number, len: number, vol: number, cutoff: number): void {
    const n = Math.ceil(ctx.sampleRate * len);
    const buf = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = cutoff;
    const g = ctx.createGain();
    g.gain.value = vol;
    src.connect(f).connect(g).connect(this.out!);
    src.start(at);
  }
}

export const sound = new Sound();
