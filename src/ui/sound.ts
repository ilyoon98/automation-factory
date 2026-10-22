/**
 * 효과음과 배경음. 소리 파일 없이 Web Audio로 그 자리에서 만든다 (나무 공방 느낌의 짧고 부드러운 소리).
 * 효과음은 내가 한 일에만 낸다 (다른 사람이 짓는 소리까지 나면 시끄러우므로).
 * 배경음은 조용한 화음 위에 칼림바 같은 음이 띄엄띄엄 떨어지는 곡을 끝없이 새로 만든다.
 * 음량·끄기는 브라우저에 기억한다.
 */
export type SoundName = 'place' | 'remove' | 'rotate' | 'error' | 'research' | 'goal' | 'truck' | 'undo' | 'chat';

const KEY = 'automation-game/sound';

interface Settings {
  /** 효과음 음량 (0 ~ 1) */
  volume: number;
  /** 배경음 음량 (0 ~ 1) */
  music: number;
  /** 위쪽 🔊 버튼: 효과음·배경음 모두 끄기 */
  muted: boolean;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

function loadSettings(): Settings {
  const d: Settings = { volume: 0.6, music: 0.35, muted: false };
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Settings>;
    return {
      volume: typeof s.volume === 'number' ? clamp01(s.volume) : d.volume,
      music: typeof s.music === 'number' ? clamp01(s.music) : d.music,
      muted: !!s.muted,
    };
  } catch {
    return d;
  }
}

/** 같은 소리를 이 간격(초)보다 빨리 다시 내지 않는다 (컨베이어를 끌면 칸마다 명령이 나오므로) */
const GAP: Partial<Record<SoundName, number>> = { place: 0.05, remove: 0.05, rotate: 0.04, error: 0.4, chat: 0.2 };
/** 연달아 지을 때 한 번에 한 칸씩 올라가는 음 (한 옥타브 안의 반음 수, 5음계). 다섯 번이면 한 옥타브를 돌아 처음 음으로 */
const PLACE_STEPS = [0, 2, 4, 7, 9];
/** 짓는 소리 사이가 이보다(초) 벌어지면 처음 음으로 돌아간다 */
const PLACE_STREAK_GAP = 0.5;
/** 셰퍼드 음: 가장 낮은 음(C2), 옥타브 겹 수, 가장 크게 들리는 높이(Hz), 소리가 퍼진 폭(옥타브) */
const SHEPARD_LOW = 65.41;
const SHEPARD_OCTAVES = 7;
const SHEPARD_CENTER = 520;
const SHEPARD_WIDTH = 1;

// ───────────────────────── 배경음 악보 ─────────────────────────

/** 8분음표 하나의 길이 (초). 박자 70 BPM */
const EIGHTH = 60 / 70 / 2;
/** 한 마디 = 8분음표 8개. 화음은 두 마디마다 바뀐다 */
const BAR = 8;
/** 음 이름 → 주파수 (MIDI 번호로) */
const hz = (midi: number) => 440 * 2 ** ((midi - 69) / 12);
/** 화음 진행 (C장조): Cmaj7 → Am7 → Fmaj7 → G6. 각 화음의 근음(베이스)과 화음 음들 */
const CHORDS: { root: number; notes: number[] }[] = [
  { root: 36, notes: [60, 64, 67, 71] },
  { root: 45, notes: [57, 60, 64, 67] },
  { root: 41, notes: [57, 60, 64, 65] },
  { root: 43, notes: [59, 62, 64, 67] },
];
/** 멜로디로 쓰는 음 (C장조 5음계, 두 옥타브) */
const SCALE = [72, 74, 76, 79, 81, 84, 86, 88];

class Sound {
  private settings = loadSettings();
  private ctx: AudioContext | null = null;
  private out: GainNode | null = null;
  private musicOut: GainNode | null = null;
  private last = new Map<SoundName, number>();
  /** 연달아 철거할 때 소리 높이를 조금씩 바꿔 기계음처럼 들리지 않게 */
  private step = 0;
  /** 연달아 지은 횟수와 마지막으로 짓는 소리를 낸 시각 (음이 한 칸씩 올라가게) */
  private placeStreak = 0;
  private lastPlaceAt = -1;
  /** 배경음: 다음 8분음표를 낼 시각(AudioContext 시간)과 지금까지 몇 번째 8분음표인지 */
  private nextNote = 0;
  private noteNo = 0;
  /** 멜로디가 지난번에 낸 음 (SCALE 번호). 가까운 음으로 움직이게 */
  private melodyAt = 2;
  /** 이번 마디를 쉬는지 (가끔 쉬어야 덜 지겹다) */
  private restBar = false;

  constructor() {
    // 브라우저는 사용자가 한 번 누르거나 키를 누르기 전에는 소리를 막는다. 그때 배경음을 시작한다
    const start = () => {
      window.removeEventListener('pointerdown', start);
      window.removeEventListener('keydown', start);
      this.audio();
      window.setInterval(() => this.scheduleMusic(), 200);
    };
    window.addEventListener('pointerdown', start);
    window.addEventListener('keydown', start);
  }

  get volume(): number {
    return this.settings.volume;
  }

  get musicVolume(): number {
    return this.settings.music;
  }

  get muted(): boolean {
    return this.settings.muted;
  }

  setVolume(v: number): void {
    this.settings.volume = clamp01(v);
    if (this.settings.volume > 0) this.settings.muted = false;
    this.apply();
  }

  setMusicVolume(v: number): void {
    this.settings.music = clamp01(v);
    if (this.settings.music > 0) this.settings.muted = false;
    this.apply();
  }

  toggleMute(): void {
    this.settings.muted = !this.settings.muted;
    this.apply();
  }

  private apply(): void {
    if (this.out) this.out.gain.value = this.level();
    if (this.musicOut) this.musicOut.gain.value = this.musicLevel();
    try {
      localStorage.setItem(KEY, JSON.stringify(this.settings));
    } catch {
      // 저장 공간이 막혀도 이번 실행 동안은 그대로 쓴다
    }
  }

  private level(): number {
    return this.settings.muted ? 0 : this.settings.volume * 0.5;
  }

  private musicLevel(): number {
    return this.settings.muted ? 0 : this.settings.music * 0.35;
  }

  /** 소리를 낼 준비 (처음 한 번 만들고, 브라우저가 멈춰 두었으면 다시 켠다) */
  private audio(): AudioContext | null {
    if (!this.ctx) {
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return null;
      this.ctx = new Ctx();
      this.out = this.ctx.createGain();
      this.out.gain.value = this.level();
      this.out.connect(this.ctx.destination);
      // 배경음: 메아리(지연 + 되먹임)를 조금 섞어 공간감을 준다
      this.musicOut = this.ctx.createGain();
      this.musicOut.gain.value = this.musicLevel();
      const echo = this.ctx.createDelay(1);
      echo.delayTime.value = EIGHTH * 3;
      const feedback = this.ctx.createGain();
      feedback.gain.value = 0.28;
      const wet = this.ctx.createGain();
      wet.gain.value = 0.35;
      this.musicOut.connect(this.ctx.destination);
      this.musicOut.connect(echo);
      echo.connect(feedback).connect(echo);
      echo.connect(wet).connect(this.ctx.destination);
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
    const out = this.out;
    switch (name) {
      case 'place': {
        // 나무 블록을 내려놓는 "톡". 연달아 지으면 5음계를 따라 한 칸씩 끝없이 올라가는 것처럼 들리고 (셰퍼드 음),
        // 잠깐 멈추면 처음 음으로
        this.placeStreak = t - this.lastPlaceAt < PLACE_STREAK_GAP ? this.placeStreak + 1 : 0;
        this.lastPlaceAt = t;
        this.shepard(out, PLACE_STEPS[this.placeStreak % PLACE_STEPS.length], t, 0.12, 0.22);
        this.noise(ctx, t, 0.03, 0.12, 2400);
        break;
      }
      case 'remove':
        // 들어 올리는 "퉁" (낮게)
        this.tone(out, 'triangle', 220 * wobble, 340 * wobble, t, 0.1, 0.4);
        this.noise(ctx, t, 0.05, 0.1, 900);
        break;
      case 'rotate':
        this.tone(out, 'square', 900, 900, t, 0.03, 0.08);
        break;
      case 'error':
        this.tone(out, 'triangle', 196, 180, t, 0.12, 0.35);
        this.tone(out, 'triangle', 165, 150, t + 0.11, 0.16, 0.35);
        break;
      case 'research':
        // 도-미-솔 올라가는 소리
        [523, 659, 784].forEach((f, i) => this.tone(out, 'triangle', f, f, t + i * 0.08, 0.22, 0.32));
        break;
      case 'goal':
        // 목표 달성: 맑은 종 4음
        [659, 784, 988, 1319].forEach((f, i) => this.bell(out, f, t + i * 0.09, 0.6, 0.22));
        break;
      case 'truck':
        // 빵빵
        this.tone(out, 'square', 392, 392, t, 0.09, 0.12);
        this.tone(out, 'square', 392, 392, t + 0.14, 0.12, 0.12);
        break;
      case 'undo':
        this.tone(out, 'sine', 700, 420, t, 0.08, 0.25);
        break;
      case 'chat':
        this.tone(out, 'sine', 880, 1175, t, 0.08, 0.2);
        break;
    }
  }

  // ───────────────────────── 배경음 ─────────────────────────

  /** 0.2초마다 불려서 앞으로 1.2초 안에 낼 음을 미리 예약한다 (타이머가 조금 늦어도 박자가 흔들리지 않게) */
  private scheduleMusic(): void {
    const ctx = this.ctx;
    // 끄거나 창을 내려 두면 새 음을 예약하지 않는다. 다시 켜면 그 자리에서 이어서
    if (!ctx || !this.musicOut || ctx.state !== 'running' || this.musicLevel() <= 0 || document.hidden) {
      this.nextNote = 0;
      return;
    }
    if (this.nextNote < ctx.currentTime) this.nextNote = ctx.currentTime + 0.1;
    while (this.nextNote < ctx.currentTime + 1.2) {
      this.musicNote(this.noteNo++, this.nextNote);
      this.nextNote += EIGHTH;
    }
  }

  /** n번째 8분음표 자리에 낼 음 (화음·베이스·멜로디) */
  private musicNote(n: number, at: number): void {
    const out = this.musicOut!;
    const beat = n % BAR;
    const bar = Math.floor(n / BAR);
    const chord = CHORDS[Math.floor(bar / 2) % CHORDS.length];
    if (beat === 0) {
      // 마디 첫 박: 화음은 두 마디 동안 천천히 부풀었다 사라지고, 베이스는 마디마다
      if (bar % 2 === 0) for (const m of chord.notes) this.pad(out, hz(m), at, EIGHTH * BAR * 2, 0.05);
      this.tone(out, 'sine', hz(chord.root), hz(chord.root), at, EIGHTH * 6, 0.22);
      // 여덟 마디에 한 번쯤 멜로디가 한 마디 쉰다
      this.restBar = bar % 8 === 7 || Math.random() < 0.12;
    }
    if (beat === 4) this.tone(out, 'sine', hz(chord.root + 7), hz(chord.root + 7), at, EIGHTH * 3, 0.1);
    if (this.restBar) return;
    // 멜로디: 강박에서 더 자주. 지난 음에서 한두 칸 움직이고, 화음에 있는 음이면 조금 더 머문다
    if (Math.random() > (beat % 2 === 0 ? 0.5 : 0.22)) return;
    const move = [-2, -1, -1, 1, 1, 2][Math.floor(Math.random() * 6)];
    this.melodyAt = Math.min(SCALE.length - 1, Math.max(0, this.melodyAt + move));
    const m = SCALE[this.melodyAt];
    const inChord = chord.notes.some((c) => (m - c) % 12 === 0);
    this.pluck(out, hz(m), at, inChord ? 1.4 : 0.9, 0.16);
  }

  /** 칼림바 같은 음: 세모파 + 한 옥타브 위 사인파가 빠르게 사라짐 */
  private pluck(out: AudioNode, f: number, at: number, len: number, vol: number): void {
    this.tone(out, 'triangle', f, f, at, len, vol);
    this.tone(out, 'sine', f * 2, f * 2, at, len * 0.35, vol * 0.4);
  }

  /** 부드러운 화음 한 음: 천천히 커졌다가 천천히 사라짐 (거친 소리는 걸러서) */
  private pad(out: AudioNode, f: number, at: number, len: number, vol: number): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    const lp = ctx.createBiquadFilter();
    const g = ctx.createGain();
    o.type = 'triangle';
    o.frequency.value = f;
    o.detune.value = (Math.random() - 0.5) * 8;
    lp.type = 'lowpass';
    lp.frequency.value = 900;
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(vol, at + len * 0.3);
    g.gain.linearRampToValueAtTime(0, at + len);
    o.connect(lp).connect(g).connect(out);
    o.start(at);
    o.stop(at + len + 0.05);
  }

  // ───────────────────────── 소리 재료 ─────────────────────────

  /** from → to로 미끄러지는 음 하나 (빠르게 올라갔다 천천히 사라짐) */
  private tone(out: AudioNode, type: OscillatorType, from: number, to: number, at: number, len: number, vol: number): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(from, at);
    o.frequency.exponentialRampToValueAtTime(to, at + len);
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(vol, at + 0.005);
    g.gain.exponentialRampToValueAtTime(0.001, at + len);
    o.connect(g).connect(out);
    o.start(at);
    o.stop(at + len + 0.02);
  }

  /**
   * 셰퍼드 음: 한 옥타브씩 떨어진 사인파 여러 개를, 가운데 높이(SHEPARD_CENTER)가 가장 크고 위아래로 갈수록 작게 섞는다.
   * 음을 한 칸씩 올리면 맨 위 음은 작아지며 사라지고 맨 아래에서 새 음이 커져서, 한 옥타브를 돌아 처음 음이 되어도
   * 계속 올라가는 것처럼 들린다. semis = 한 옥타브 안의 높이 (반음 수)
   */
  private shepard(out: AudioNode, semis: number, at: number, len: number, vol: number): void {
    for (let k = 0; k < SHEPARD_OCTAVES; k++) {
      const f = SHEPARD_LOW * 2 ** (k + semis / 12);
      const d = Math.log2(f / SHEPARD_CENTER) / SHEPARD_WIDTH;
      const w = Math.exp(-0.5 * d * d);
      if (w < 0.02) continue;
      // 반음만큼 살짝 내려앉아 "톡" 느낌은 남긴다 (한 옥타브씩 미끄러지면 옆 음과 겹쳐 올라가는 느낌이 깨짐)
      this.tone(out, 'sine', f, f * 0.94, at, len, vol * w);
    }
  }

  /** 종소리: 기본음 + 배음 두 개가 천천히 사라짐 */
  private bell(out: AudioNode, f: number, at: number, len: number, vol: number): void {
    this.tone(out, 'sine', f, f, at, len, vol);
    this.tone(out, 'sine', f * 2, f * 2, at, len * 0.5, vol * 0.3);
    this.tone(out, 'sine', f * 3.01, f * 3.01, at, len * 0.25, vol * 0.12);
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
