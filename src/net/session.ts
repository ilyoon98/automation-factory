import type { BuildingType } from '../data/buildings';
import { applyCommand, type Command, type ResultOf } from '../sim/commands';
import type { Dir } from '../sim/dir';
import { DT, World, type NetSnapshot } from '../sim/world';
import { BUILD_ID, VERSION } from '../version';
import { packReply, unpackReply, type PackedReply } from './replies';

/**
 * 같은 공유기(LAN)에서 같이 하기. 누군가 "방 만들기"를 누르면 방장(호스트), "참가하기"를 누르면 손님이 된다.
 * 락스텝 방식:
 * - 방장만 시간을 정한다. 손님은 방장이 "여기까지 돌려"라고 한 틱까지만 돌린다.
 * - 월드 상태는 주고받지 않고 명령만 주고받는다. 손님의 명령도 호스트가 틱 번호를 찍어 모두에게 돌려주고,
 *   모두가 같은 틱에 같은 순서로 적용해서 같은 월드를 유지한다.
 * - 새로 들어온 손님은 호스트의 스냅샷을 받아 시작하고, 2초마다 체크섬을 비교해 어긋나면 다시 받는다.
 *
 * 서버(server/relay.mjs)는 메시지를 나르기만 한다. 서버 하나에 방 하나.
 * exe(electron/main.mjs)는 저마다 서버를 갖고, 같은 와이파이에서 찾은 남의 방에 참가하면 그 PC의 서버로 옮겨 붙는다.
 */

export type Role = 'solo' | 'host' | 'guest';

/** 체크섬을 비교하는 간격 (틱) */
const HASH_EVERY = 120;
/** 프레임 하나에서 따라잡을 최대 틱 수 (느린 기기에서 멈춤 방지) */
const MAX_STEPS = 240;
/** 손님은 호스트보다 뒤처지면 안 되므로 더 많이 따라잡는다 (가려진 탭은 1초에 한 번만 불린다. 4배속 = 초당 240틱) */
const GUEST_MAX_STEPS = 1200;

/** 핑이 화면에 남아 있는 시간 (초) */
export const PING_SEC = 5;
/** 채팅 한 줄 최대 글자 수 (서버도 80자에서 자른다) */
export const CHAT_MAX = 60;
/** 커서를 보내는 최소 간격 (ms). 안 움직여도 이만큼마다 한 번은 보낸다 */
const PRESENCE_MIN_MS = 66;
const PRESENCE_IDLE_MS = 2000;
/** 방장이 손님들의 지연을 재는 간격 (ms) */
export const RTT_EVERY_MS = 2000;
/** 방장: 손님이 이만큼 답이 없으면 불안정 (ms) */
export const GUEST_SILENT_MS = 5000;
/** 손님: 방장의 진행(frame)이 이만큼 끊기면 불안정 (ms). 가려진 방장 창도 0.25초마다 보낸다 */
export const HOST_SILENT_MS = 3000;
const NAME_KEY = 'automation-game/name';
/** 이 탭의 접속 키 (새로고침해도 같고, 탭마다 다르다). 다시 접속해 번호가 바뀌어도 같은 사람인지 알아본다 */
const CLIENT_KEY = 'automation-game/client-key';

/** 플레이어마다 색 (커서·이름표·핑). 접속자 목록 순서대로 나눠 준다 */
const PLAYER_COLORS = ['#ffb347', '#5fb4ff', '#ff6b9a', '#7be07b', '#c38bff', '#4fd6d0', '#ff8a5c', '#e8e05a'];

export interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** 다른 사람에게 보여 줄 내 마우스와 손에 든 것. 게임 진행과 상관없어서 호스트를 거치지 않는다 */
export interface Presence {
  /** 마우스 (칸 좌표, 소수점까지). 화면 밖이면 null */
  at: [number, number] | null;
  tool: BuildingType | null;
  dir: Dir;
  setting: string | null;
  /** 복사 영역, 철거 영역 */
  sel: Rect | null;
  rem: Rect | null;
  /** 붙여넣기 대기 중인 청사진 크기 */
  paste: { w: number; h: number } | null;
}

export interface RosterEntry {
  p: number;
  name: string;
  host: boolean;
}

export interface Ping {
  p: number;
  x: number;
  y: number;
  /** 찍은 시각 (performance.now) */
  t: number;
}

/** 호스트가 틱 번호를 찍은 명령. p = 낸 사람, seq = 손님이 붙인 번호 (결과를 돌려주려고) */
interface Stamped {
  tick: number;
  p: number;
  seq?: number;
  cmd: Command;
}

/** 접속자 한 명의 연결 상태. ms = 방장과의 왕복 시간 (아직 못 쟀으면 null), unstable = 답이 끊김 */
export interface Link {
  ms: number | null;
  unstable: boolean;
}

/** 서버를 거쳐 오가는 메시지. from은 서버가 붙이고, to가 있으면 그 손님에게만 간다 */
type Msg =
  // 서버 → 나
  | { type: 'welcome'; id: number; urls?: string[] }
  /** 방이 열렸는지, 방 안에 누가 있는지 (방 밖에 있어도 받는다). version = 방장의 게임 버전 */
  | { type: 'room'; open: boolean; players: RosterEntry[]; version?: string }
  /**
   * 참가를 막음. version·build = 방장과 게임이 다름, denied = 방장이 거절(잠시 다시 신청 못 함),
   * banned = 이 방에서 내보내짐, closed = 허락을 기다리는 동안 방이 닫힘
   */
  | { type: 'join-refused'; reason: 'version' | 'build'; host: string; me: string }
  | { type: 'join-refused'; reason: 'denied' | 'banned' | 'closed' }
  /** 참가 신청을 방장에게 보냄 (허락을 기다린다) */
  | { type: 'join-pending' }
  /** 내 역할이 바뀜. reason: left = 내가 나감, closed = 방장이 방을 닫음, host-left = 방장 연결이 끊김, kicked = 방장이 내보냄 */
  | { type: 'your-role'; role: 'host' | 'guest' | null; reason?: 'left' | 'closed' | 'host-left' | 'kicked' }
  // 서버 → 방장: 참가 신청, 신청 취소(그만두거나 연결이 끊김)
  | { type: 'join-request'; id: number; name: string }
  | { type: 'join-cancel'; id: number }
  | { type: 'join'; id: number; key?: string }
  | { type: 'leave'; id: number }
  // 방 안의 누구든 → 나머지 모두
  | { type: 'presence'; from: number; s: Presence }
  | { type: 'ping'; from: number; x: number; y: number }
  | { type: 'chat'; from: number; text: string }
  // 손님 → 방장
  | { type: 'cmd'; from: number; seq: number; cmd: Command }
  | { type: 'speed'; from: number; speed: number }
  | { type: 'need-sync'; from: number }
  | { type: 'reply-ack'; from: number; seq: number }
  | { type: 'rtt-pong'; from: number; t: number }
  // 방장 → 손님
  | { type: 'frame'; upTo: number; cmds: Stamped[]; hashes: [number, number][]; speed: number }
  /** 지연 재기: 손님은 t를 그대로 돌려준다. rtt = 방장이 잰 손님별 [플레이어, ms, 불안정] */
  | { type: 'rtt-ping'; t: number }
  | { type: 'rtt'; links: [number, number | null, boolean][] }
  | { type: 'snapshot'; to?: number; snap: NetSnapshot; speed: number; replies?: [number, [number, PackedReply][]][] };

/** 이 탭에서 방을 만들었는지·참가했는지. 새로고침·잠깐 끊김 뒤에 저절로 다시 열고 다시 들어가려고 (탭을 닫으면 잊는다) */
const INTENT_KEY = 'automation-game/room-intent';
type Intent = 'host' | 'guest' | null;
/** exe: 다른 PC의 방에 들어가 있으면 그 서버 주소 (새로고침해도 그 방으로 다시 들어가려고) */
const SERVER_KEY = 'automation-game/room-server';
/** 다른 PC의 서버에 이 시간 안에 못 붙으면 포기한다 (방화벽에 막히면 한참 기다리므로) */
const REMOTE_CONNECT_MS = 5000;

/** 같은 와이파이에서 찾은 다른 exe의 방. electron/main.mjs가 1초마다 보내 준다 */
export interface LanRoom {
  id: string;
  ip: string;
  port: number;
  /** 방장 이름 */
  host: string;
  players: number;
  /** 방장 exe의 게임 버전 (버전 확인 전의 옛 exe면 빈 값) */
  version: string;
  /** 내 exe와 같은 빌드인지. 다르면 같이 할 수 없다 (락스텝은 모두 같은 시뮬레이션 코드를 돌려야 맞는다) */
  same: boolean;
}

/** exe 업데이트 상태 */
export type UpdateState =
  | { state: 'available'; version: string; current: string }
  | { state: 'downloading'; percent: number }
  | { state: 'installing' }
  | { state: 'error'; message: string };

/** 이 방에 들어갈 수 있는지. 버전이 다르면 무엇이 다른지 */
export function lanRoomCheck(r: LanRoom): 'ok' | 'newer' | 'older' | 'build' {
  if (r.version !== VERSION) return compareVersions(r.version, VERSION) > 0 ? 'newer' : 'older';
  return r.same ? 'ok' : 'build';
}

/** 0.2.10 > 0.2.9 처럼 숫자로 비교. 빈 값(옛 게임)은 가장 낮다 */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((n) => Number(n) || 0);
  const pb = b.split('.').map((n) => Number(n) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d;
  }
  return a === b ? 0 : a ? 1 : -1;
}

/** exe 게임 서버의 기본 포트 (electron/main.mjs의 GAME_PORT). 주소에 포트가 없으면 이것으로 */
export const DEFAULT_ROOM_PORT = 47820;

/**
 * 친구가 보낸 방 주소를 서버 주소(호스트:포트)로. 초대 주소(http://25.1.2.3:47820/?join), 호스트:포트, 호스트만 모두 받는다.
 * 알아볼 수 없으면 null
 */
export function parseRoomAddress(text: string): string | null {
  const raw = text.trim();
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(/^[a-z]+:\/\//i.test(raw) ? raw : `http://${raw}`);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' || url.username || url.password) return null;
  const host = url.hostname;
  if (!/^[a-z0-9.-]+$/i.test(host) && !/^\[[0-9a-f:]+\]$/i.test(host)) return null;
  const port = url.port ? Number(url.port) : DEFAULT_ROOM_PORT;
  return `${host}:${port}`;
}

/** 참가가 막혔을 때 보여 줄 말 */
export function versionMismatchText(reason: 'version' | 'build', host: string, me: string): string {
  if (reason === 'build') return `방장과 게임 파일이 달라요 (둘 다 ${me}이지만 따로 빌드한 파일). 같은 파일로 켜 주세요`;
  if (compareVersions(host, me) > 0) return `방장이 새 버전이에요 (방장 ${host}, 나 ${me}). 업데이트하고 들어오세요`;
  return `방장이 옛 버전이에요 (방장 ${host || '옛 버전'}, 나 ${me}). 방장에게 업데이트를 부탁하세요`;
}

declare global {
  interface Window {
    /** exe에서만 있다 (electron/preload.cjs). 브라우저로 열면 없음 */
    desktop?: {
      onLanRooms(cb: (rooms: LanRoom[]) => void): void;
      /** 업데이트 상태 (electron/main.mjs의 updater). 켤 때 새 버전이 있으면 available이 온다 */
      onUpdate(cb: (s: UpdateState) => void): void;
      /** 새 버전 받기. 다 받으면 저절로 다시 시작한다 */
      downloadUpdate(): void;
    };
  }
}

export interface SessionHooks {
  getWorld(): World;
  /** 손님이 방장의 월드를 받았을 때. first = 이번 참가에서 처음 */
  setWorld(w: World, first: boolean): void;
  /** 방에서 나와 내 공장(내 저장)으로 돌아간다 */
  restoreOwnWorld(): void;
  /** 방장: 지금 게임 속도. 손님: 방장이 알려 준 속도를 화면에 */
  getSpeed(): number;
  setSpeed(s: number): void;
  toast(msg: string): void;
  /** 누가 채팅을 보냄 (내가 보낸 것도) */
  chat(from: number, text: string): void;
  /** 역할·접속 인원이 바뀜 */
  changed(): void;
  /** 방장: 손님이 들어옴 (key = 손님의 접속 키) / 나감 / 방장이 아니게 됨(방을 닫음) */
  guestJoined?(p: number, key: string): void;
  guestLeft?(p: number): void;
  hostEnded?(): void;
}

export class Session {
  /** solo = 방 밖 (혼자 하는 중이거나 방장을 기다리는 중) */
  role: Role = 'solo';
  /** 내 플레이어 번호. 혼자 하거나 방장이면 0, 손님이면 서버가 정해 준 번호 */
  me = 0;
  /** 방 인원 (혼자면 1) */
  players = 1;
  /** 서버에 붙어 있는지 (서버 없이 연 게임이면 계속 false: 같이 하기 메뉴를 숨긴다) */
  connected = false;
  /** 서버에 방이 열려 있는지 */
  roomOpen = false;
  /** 열린 방 방장의 게임 버전 (옛 서버면 빈 값) */
  roomVersion = '';
  /** 손님: 방장 월드를 받아서 같이 돌고 있는지 */
  synced = false;
  /**
   * 지금 보는 월드가 방장 것인지. 방장 연결이 끊겨 방 밖으로 밀려나도 그대로 두고 멈춰서 기다린다
   * (이 월드를 혼자 돌리거나 내 저장에 덮어쓰면 안 된다).
   */
  borrowed = false;
  /** 다른 PC에서 들어올 주소 (서버를 --host 없이 띄웠으면 비어 있다) */
  lanUrls: string[] = [];
  /** 방 안 사람들 (방장 먼저, 그다음 들어온 순) */
  roster: RosterEntry[] = [];
  /** 다른 사람의 커서. t = 마지막으로 받은 시각 */
  others = new Map<number, { s: Presence; t: number }>();
  pings: Ping[] = [];
  /** 내 이름 (비어 있으면 P번호) */
  myName = '';
  /** exe로 켰는지 (같은 와이파이의 방을 저절로 찾는다) */
  readonly desktop = !!window.desktop;
  /** exe: 같은 와이파이에서 찾은 다른 PC의 방 */
  lanRooms: LanRoom[] = [];
  /** exe: 다른 PC의 방에 들어가려고 그 PC의 서버(ip:포트)에 붙어 있으면 그 주소. null = 이 게임을 연 서버 */
  server: string | null = null;
  /** 참가를 신청하고 방장의 허락을 기다리는 중 */
  asking = false;
  /** 방장: 허락을 기다리는 참가 신청 (먼저 온 순) */
  requests: { id: number; name: string }[] = [];
  /** 이 탭의 접속 키 */
  readonly clientKey: string;
  /** 방장: 손님 번호 → 접속 키 */
  guestKeys = new Map<number, string>();
  /** 방 안 손님들의 연결 상태 (방장이 재서 모두에게 알린다) */
  links = new Map<number, Link>();

  private ws: WebSocket | null = null;
  private retryTimer = 0;
  /** 서버가 정해 준 접속 번호 (손님이 되면 플레이어 번호가 된다) */
  private connId = 0;
  private intent: Intent = null;
  /** 한 번이라도 서버에 붙었는지 (서버 없이 열었으면 다시 붙으려 하지 않는다) */
  private everConnected = false;
  private retryMs = 1000;
  private acc = 0;

  // 방장
  private guests = new Set<number>();
  /** 손님별 마지막 지연 답 시각 (performance.now) */
  private lastPong = new Map<number, number>();
  private rttAt = 0;
  private outbox: Stamped[] = [];
  private hashes: [number, number][] = [];
  /** 손님이 결과를 읽었다고 확인하기 전까지. 동기화가 프레임을 대체해도 응답은 남긴다. */
  private replies = new Map<number, Map<number, PackedReply>>();

  // 손님
  private inbox: Stamped[] = [];
  private hostTick = 0;
  private expected = new Map<number, number>();
  private seq = 0;
  private pending = new Map<number, (r: unknown) => void>();
  /** 이번 참가에서 방장 월드를 한 번이라도 받았는지 (처음 받을 때만 화면을 허브로 옮긴다) */
  private joined = false;
  /** 방장에게서 마지막으로 진행을 받은 시각 (performance.now) */
  private hostHeardAt = 0;

  private lastPresence = '';
  private presenceAt = 0;

  constructor(private hooks: SessionHooks) {
    this.clientKey = loadClientKey();
    try {
      this.myName = localStorage.getItem(NAME_KEY) ?? '';
      this.intent = (sessionStorage.getItem(INTENT_KEY) as Intent) ?? null;
      if (this.intent === 'guest') this.server = sessionStorage.getItem(SERVER_KEY);
    } catch {
      // 저장이 막힌 브라우저면 이름 없이
    }
    window.desktop?.onLanRooms((rooms) => this.onLanRooms(rooms));
    // 초대 주소(…/?join)로 열었으면 방에 바로 들어간다. 새로고침하면 다시 묻지 않도록 주소에서 지운다
    const url = new URL(location.href);
    if (url.searchParams.has('join')) {
      this.setIntent('guest');
      url.searchParams.delete('join');
      history.replaceState(null, '', url);
    }
  }

  connect(): void {
    clearTimeout(this.retryTimer);
    const url = this.server ? `ws://${this.server}/lan` : `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/lan`;
    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch {
      return;
    }
    this.ws = ws;
    let opened = false;
    const remote = this.server !== null;
    const giveUp = remote ? window.setTimeout(() => ws.readyState === WebSocket.CONNECTING && ws.close(), REMOTE_CONNECT_MS) : 0;
    ws.onopen = () => {
      clearTimeout(giveUp);
      opened = true;
      if (!remote) this.everConnected = true;
      this.retryMs = 1000;
      this.hello();
    };
    ws.onmessage = (e) => {
      if (this.ws === ws) this.onMessage(JSON.parse(e.data as string) as Msg);
    };
    ws.onclose = () => {
      clearTimeout(giveUp);
      if (this.ws !== ws) return;
      this.ws = null;
      if (remote && !this.borrowed) {
        // 다른 PC의 방에 들어가기 전에 못 붙었거나 끊김: 기다릴 월드도 없으니 내 서버로 돌아온다
        this.hooks.toast(
          opened ? '방장 PC와 연결이 끊겼어요' : '방장 PC에 붙지 못했어요. 그 PC에서 Windows 방화벽이 "자동화 공장"을 허용했는지 확인해 주세요',
        );
        this.setIntent(null);
        this.switchServer(null);
        return;
      }
      if (!this.everConnected && !remote) return;
      if (this.role !== 'solo') this.hooks.toast('서버와 연결이 끊겼어요. 다시 붙는 중…');
      this.connected = false;
      this.roomOpen = false;
      this.leaveRole();
      this.hooks.changed();
      this.retryTimer = window.setTimeout(() => this.connect(), this.retryMs);
      this.retryMs = Math.min(10_000, this.retryMs * 2);
    };
  }

  /** 붙을 서버를 바꾼다 (null = 이 게임을 연 서버로 돌아옴). 지금 연결은 끊고 새로 붙는다 */
  private switchServer(server: string | null): void {
    if (server === this.server) return;
    this.server = server;
    try {
      if (server) sessionStorage.setItem(SERVER_KEY, server);
      else sessionStorage.removeItem(SERVER_KEY);
    } catch {
      // 이번 접속에서만
    }
    const old = this.ws;
    this.ws = null;
    old?.close();
    this.connected = false;
    this.roomOpen = false;
    this.roster = [];
    this.lanUrls = [];
    this.leaveRole();
    this.retryMs = 1000;
    this.connect();
    this.hooks.changed();
  }

  // ───────────────────────── 방 ─────────────────────────

  /** 방 만들기: 지금 내 공장으로 방을 열고 내가 방장이 된다 */
  createRoom(): void {
    if (!this.connected || this.role !== 'solo' || this.roomOpen || this.borrowed || this.server) return;
    this.setIntent('host');
    this.send({ type: 'create-room' });
  }

  /** 열린 방에 참가: 방장의 공장을 받아서 같이 한다 (내 공장은 저장된 채로 둔다) */
  joinRoom(): void {
    if (!this.connected || this.role !== 'solo' || !this.roomOpen) return;
    this.setIntent('guest');
    this.send({ type: 'join-room' });
  }

  /** exe: 같은 와이파이에서 찾은 방에 참가. 그 PC의 서버로 옮겨 붙으면 방 상태를 받자마자 들어간다 (resume) */
  joinLan(id: string): void {
    const r = this.lanRooms.find((x) => x.id === id);
    if (!r || this.role !== 'solo' || this.borrowed || this.intent) return;
    if (lanRoomCheck(r) !== 'ok') {
      this.hooks.toast(versionMismatchText(r.version !== VERSION ? 'version' : 'build', r.version, VERSION));
      return;
    }
    this.setIntent('guest');
    this.switchServer(`${r.ip}:${r.port}`);
  }

  /**
   * 주소로 참가: 방 목록에 뜨지 않는 방(VPN·다른 네트워크)에 그 PC의 서버로 옮겨 붙어 신청한다.
   * 붙지 못하거나 버전이 다르거나 거절되면 내 서버로 돌아온다. 알아볼 수 없는 주소면 이유를 돌려준다
   */
  joinAddress(text: string): string | null {
    const server = parseRoomAddress(text);
    if (!server) return '주소를 알아볼 수 없어요. 방장 방 창의 주소(예: 25.12.34.56:47820)를 그대로 붙여 넣어 주세요';
    if (this.role !== 'solo' || this.borrowed || this.intent) return '지금은 다른 방에 들어갈 수 없어요. 방에서 먼저 나와 주세요';
    this.setIntent('guest');
    this.switchServer(server);
    return null;
  }

  /** 방장이면 방 닫기 (손님은 모두 각자 공장으로), 손님이면 나가기 */
  leaveRoom(): void {
    if (this.role === 'solo') {
      // 허락을 기다리던 중이면 신청을 거두고, 방장을 기다리던 중이면 기다리기를 그만두고 내 공장으로
      if (this.asking) this.send({ type: 'leave-room' });
      this.asking = false;
      this.setIntent(null);
      if (this.borrowed) this.backToOwnWorld();
      this.switchServer(null);
      this.hooks.changed();
      return;
    }
    this.send({ type: 'leave-room' });
  }

  /** 방장을 기다리는 중 (방장 연결이 끊겼거나, 초대 주소로 열었는데 아직 방이 없음) */
  get waitingForHost(): boolean {
    return this.role === 'solo' && this.intent === 'guest';
  }

  /** exe: 다른 PC의 방에 들어가는 중 (아직 방장 월드를 한 번도 못 받음) */
  get joining(): boolean {
    return this.server !== null && this.waitingForHost && !this.borrowed;
  }

  /** 새로고침 전에 방장·손님이었거나 초대 주소로 열어서 저절로 방을 열거나 들어갈 참인지 (시작화면을 건너뛴다) */
  get rejoining(): boolean {
    return this.intent !== null;
  }

  /** 방장: 참가 신청을 허락한다 */
  approve(id: number): void {
    this.answer(id, 'approve');
  }

  /** 방장: 참가 신청을 거절한다 (그 PC는 잠시 다시 신청하지 못한다) */
  deny(id: number): void {
    this.answer(id, 'deny');
  }

  private answer(id: number, type: 'approve' | 'deny'): void {
    if (this.role !== 'host') return;
    this.requests = this.requests.filter((r) => r.id !== id);
    this.send({ type, id });
    this.hooks.changed();
  }

  /** 방장: 손님을 내보낸다. 그 PC는 방이 열려 있는 동안 다시 들어오지 못한다 */
  kick(p: number): void {
    if (this.role !== 'host' || p === this.me || !this.roster.some((r) => r.p === p)) return;
    this.send({ type: 'kick', id: p });
    this.hooks.toast(`${this.nameOf(p)} 님을 내보냈어요`);
  }

  /** 손님: 방장의 진행이 한동안 오지 않음 (방장 PC가 멈췄거나 네트워크가 끊기는 중) */
  get hostSilent(): boolean {
    return this.role === 'guest' && this.synced && performance.now() - this.hostHeardAt > HOST_SILENT_MS;
  }

  /** 방 안 누군가의 연결 상태. 방장 자신은 없다 */
  linkOf(p: number): Link | null {
    return this.links.get(p) ?? null;
  }

  /** 방장 이름 */
  get hostName(): string {
    return this.nameOf(0);
  }

  /** 손님을 부를 주소. 열면 바로 참가한다 */
  get inviteUrl(): string {
    return `${this.lanUrls[0] ?? (this.server ? `http://${this.server}` : location.origin)}/?join`;
  }

  /** 다른 PC가 들어올 수 있는 주소가 있는지 (없으면 이 PC가 네트워크에 안 붙어 있는 것) */
  get reachable(): boolean {
    return this.lanUrls.length > 0 || this.server !== null || !isLocalHost(location.hostname);
  }

  /** exe: 같은 와이파이의 방 목록이 왔다 (1초마다). 바뀌었을 때만 화면을 고친다 */
  private onLanRooms(rooms: LanRoom[]): void {
    const before = this.lanRooms;
    if (JSON.stringify(rooms) === JSON.stringify(before)) return;
    this.lanRooms = rooms;
    if (this.role === 'solo' && !this.intent && !this.borrowed) {
      for (const r of rooms) {
        if (lanRoomCheck(r) === 'ok' && !before.some((b) => b.id === r.id)) this.hooks.toast(`${r.host || '누군가'}의 방이 열렸어요. 위쪽 "같이 하기"에서 참가할 수 있어요`);
      }
    }
    this.hooks.changed();
  }

  private setIntent(i: Intent): void {
    this.intent = i;
    try {
      if (i) sessionStorage.setItem(INTENT_KEY, i);
      else sessionStorage.removeItem(INTENT_KEY);
    } catch {
      // 이번 탭에서만
    }
  }

  /** 방 상태가 바뀔 때마다: 이 탭이 방장이었으면 다시 열고, 손님이었으면 다시 들어간다 */
  private resume(): void {
    if (!this.connected || this.role !== 'solo') return;
    if (this.intent === 'host' && !this.roomOpen && !this.borrowed) this.send({ type: 'create-room' });
    if (this.intent === 'guest' && this.roomOpen) this.send({ type: 'join-room' });
  }

  /** 방장·손님 역할을 내려놓는다 (방 밖으로) */
  private leaveRole(): void {
    this.role = 'solo';
    this.asking = false;
    this.requests = [];
    this.links.clear();
    this.lastPong.clear();
    this.me = 0;
    this.synced = false;
    this.guests.clear();
    this.outbox = [];
    this.hashes = [];
    this.replies.clear();
    this.inbox = [];
    this.pending.clear();
    this.others.clear();
    this.pings = [];
  }

  private backToOwnWorld(): void {
    this.borrowed = false;
    this.hooks.restoreOwnWorld();
  }

  // ───────────────────────── 명령 ─────────────────────────

  /** 명령 내기. 혼자·방장이면 바로 적용, 손님이면 방장에게 보내고 돌아오면 적용 */
  exec<C extends Command>(cmd: C, done?: (r: ResultOf<C>) => void): void {
    if (this.role === 'guest' || this.borrowed) {
      if (this.role !== 'guest' || !this.synced || !this.ws) {
        this.hooks.toast(this.role === 'guest' ? '방장과 맞추는 중이에요. 잠시 뒤에 다시 해 주세요' : '방장을 기다리는 중이에요');
        return;
      }
      const seq = ++this.seq;
      if (done) this.pending.set(seq, done as (r: unknown) => void);
      this.send({ type: 'cmd', seq, cmd });
      return;
    }
    const w = this.hooks.getWorld();
    const r = applyCommand(w, this.me, cmd);
    if (this.guests.size) this.outbox.push({ tick: w.tickCount, p: this.me, cmd });
    done?.(r);
  }

  /** 게임 속도. 손님은 방장에게 부탁한다 (속도는 모두 같아야 하므로) */
  requestSpeed(s: number): boolean {
    if (this.role !== 'guest' && !this.borrowed) return false;
    this.send({ type: 'speed', speed: s });
    return true;
  }

  get canSave(): boolean {
    return this.role !== 'guest' && !this.borrowed;
  }

  // ───────────────────────── 커서·핑·이름 ─────────────────────────

  /** 매 프레임 불러도 된다. 바뀌었을 때만 (안 바뀌어도 가끔은) 보낸다 */
  sendPresence(s: Presence): void {
    if (this.role === 'solo' || this.players < 2) return;
    const json = JSON.stringify(s);
    const now = performance.now();
    const wait = json === this.lastPresence ? PRESENCE_IDLE_MS : PRESENCE_MIN_MS;
    if (now - this.presenceAt < wait) return;
    this.lastPresence = json;
    this.presenceAt = now;
    this.send({ type: 'presence', s });
  }

  /** 여기 보세요! 모두의 화면에 몇 초 동안 동그라미가 퍼진다 */
  ping(x: number, y: number): void {
    this.pings.push({ p: this.me, x, y, t: performance.now() });
    this.send({ type: 'ping', x, y });
  }

  /** 채팅. 내 화면엔 바로 띄우고, 방 안이면 다른 사람에게도 보낸다 */
  chat(text: string): void {
    text = text.trim().slice(0, CHAT_MAX);
    if (!text) return;
    this.hooks.chat(this.me, text);
    if (this.role !== 'solo') this.send({ type: 'chat', text });
  }

  /** 지난 핑은 지운다 (그리기 전에) */
  livePings(now: number): Ping[] {
    this.pings = this.pings.filter((p) => now - p.t < PING_SEC * 1000);
    return this.pings;
  }

  rename(name: string): void {
    this.myName = name.trim().slice(0, 16);
    try {
      localStorage.setItem(NAME_KEY, this.myName);
    } catch {
      // 이번 접속에서만
    }
    this.hello();
    this.hooks.changed();
  }

  /** 서버에 내 이름과 게임 버전을 알린다 (버전·빌드가 방장과 달라야 참가를 막을 수 있다) */
  private hello(): void {
    this.send({ type: 'hello', name: this.myName, version: VERSION, build: BUILD_ID, key: this.clientKey });
  }

  /** 목록 순서(방장 먼저, 그다음 들어온 순)로 색을 정해서 모두의 화면에서 같은 색, 겹치지 않게 */
  colorOf(p: number): string {
    const i = this.roster.findIndex((r) => r.p === p);
    return PLAYER_COLORS[(i >= 0 ? i : p) % PLAYER_COLORS.length];
  }

  nameOf(p: number): string {
    const e = this.roster.find((r) => r.p === p);
    if (e?.name) return e.name;
    if (p === this.me && this.myName) return this.myName;
    return p === 0 ? '방장' : `P${p}`;
  }

  // ───────────────────────── 진행 ─────────────────────────

  /** 매 프레임. 시뮬레이션을 돌리고, 방장이면 이번 프레임에 돈 틱과 명령을 손님들에게 보낸다 */
  advance(dt: number): void {
    if (this.role === 'guest') return this.catchUp();
    // 방장을 기다리는 동안 방장 월드는 멈춰 둔다
    if (this.borrowed) return;
    const w = this.hooks.getWorld();
    const sharing = this.guests.size > 0;
    this.acc += dt * this.hooks.getSpeed();
    let steps = 0;
    while (this.acc >= DT && steps < MAX_STEPS) {
      w.tick();
      if (sharing && w.tickCount % HASH_EVERY === 0) this.hashes.push([w.tickCount, w.checksum()]);
      this.acc -= DT;
      steps++;
    }
    if (steps >= MAX_STEPS) this.acc = 0;
    this.flush();
    this.measureLinks();
  }

  /** 방장: 2초마다 손님들에게 지연을 묻고, 지금까지 잰 표를 모두에게 알린다 */
  private measureLinks(): void {
    if (this.role !== 'host' || !this.guests.size) return;
    const now = performance.now();
    if (now - this.rttAt < RTT_EVERY_MS) return;
    this.rttAt = now;
    let changed = false;
    for (const p of this.guests) {
      const unstable = now - (this.lastPong.get(p) ?? now) > GUEST_SILENT_MS;
      const link = this.links.get(p) ?? { ms: null, unstable: false };
      if (link.unstable !== unstable) changed = true;
      this.links.set(p, { ...link, unstable });
    }
    this.send({ type: 'rtt-ping', t: now });
    this.send({ type: 'rtt', links: [...this.links].map(([p, l]) => [p, l.ms, l.unstable]) });
    if (changed) this.hooks.changed();
  }

  /** 방장: 월드를 통째로 바꿨을 때 (새 게임) 모든 손님에게 다시 보낸다 */
  worldReplaced(): void {
    if (this.role === 'host' && this.guests.size) this.sendSnapshot();
  }

  // ───────────────────────── 방장 ─────────────────────────

  private flush(): void {
    if (!this.guests.size) {
      this.outbox = [];
      this.hashes = [];
      return;
    }
    this.send({
      type: 'frame',
      upTo: this.hooks.getWorld().tickCount,
      cmds: this.outbox,
      hashes: this.hashes,
      speed: this.hooks.getSpeed(),
    });
    this.outbox = [];
    this.hashes = [];
  }

  /** to가 없으면 모든 손님에게 */
  private sendSnapshot(to?: number): void {
    // 이미 적용한 명령이 스냅샷에도 들어가고 다음 프레임에도 실려 두 번 적용되지 않도록, 먼저 내보낸다
    this.flush();
    this.send({
      type: 'snapshot',
      to,
      snap: this.hooks.getWorld().snapshot(),
      speed: this.hooks.getSpeed(),
      replies: [...this.replies].map(([player, replies]) => [player, [...replies]]),
    });
  }

  // ───────────────────────── 손님 ─────────────────────────

  /** 방장이 돌린 틱까지 따라간다. 명령은 찍힌 틱이 되면 적용한다 */
  private catchUp(): void {
    if (!this.synced) return;
    const w = this.hooks.getWorld();
    let steps = 0, acknowledged = 0;
    try {
      for (;;) {
        while (this.inbox.length && this.inbox[0].tick === w.tickCount) {
          const e = this.inbox.shift()!;
          const r = applyCommand(w, e.p, e.cmd);
          if (e.p === this.me && e.seq) {
            const done = this.pending.get(e.seq);
            this.pending.delete(e.seq);
            done?.(r);
            acknowledged = Math.max(acknowledged, e.seq);
          }
        }
        if (this.inbox.length && this.inbox[0].tick < w.tickCount) return this.resync();
        if (w.tickCount >= this.hostTick || steps >= GUEST_MAX_STEPS) return;
        w.tick();
        steps++;
        const want = this.expected.get(w.tickCount);
        if (want === undefined) continue;
        this.expected.delete(w.tickCount);
        if (w.checksum() !== want) return this.resync();
      }
    } finally {
      if (acknowledged) this.send({ type: 'reply-ack', seq: acknowledged });
    }
  }

  private resync(): void {
    this.synced = false;
    console.warn('방장과 월드가 어긋나서 다시 받아요');
    this.hooks.toast('방장과 어긋나서 다시 맞추는 중…');
    this.send({ type: 'need-sync' });
    this.hooks.changed();
  }

  // ───────────────────────── 메시지 ─────────────────────────

  private send(msg: object): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  private onMessage(m: Msg): void {
    switch (m.type) {
      case 'welcome':
        this.connected = true;
        this.connId = m.id;
        this.lanUrls = m.urls ?? [];
        this.hooks.changed();
        return;
      case 'room':
        this.roomVersion = m.version ?? '';
        this.onRoom(m.open, m.players);
        return;
      case 'join-refused':
        // 못 들어감: 다시 들어가려 하지 않고, 다른 PC의 방이었으면 내 서버로 돌아온다
        this.asking = false;
        this.hooks.toast(
          'host' in m
            ? versionMismatchText(m.reason, m.host, m.me)
            : m.reason === 'denied'
              ? '방장이 참가를 거절했어요. 잠시 뒤에 다시 신청할 수 있어요'
              : m.reason === 'banned'
                ? '이 방에서 내보내져서 방이 다시 열릴 때까지 들어갈 수 없어요'
                : '허락을 기다리는 동안 방이 닫혀서 신청이 취소됐어요',
        );
        this.setIntent(null);
        if (this.borrowed) this.backToOwnWorld();
        this.switchServer(null);
        this.hooks.changed();
        return;
      case 'your-role':
        this.onRole(m.role, m.reason);
        return;
      case 'join-pending':
        this.asking = true;
        this.hooks.toast('방장에게 참가를 신청했어요. 허락하면 들어가요');
        this.hooks.changed();
        return;
      case 'join-request':
        if (this.role !== 'host' || this.requests.some((r) => r.id === m.id)) return;
        this.requests.push({ id: m.id, name: String(m.name ?? '').slice(0, 16) });
        this.hooks.toast(`${m.name || `P${m.id}`} 님이 들어오려 해요. 위쪽 방 버튼에서 허락하거나 거절해 주세요`);
        this.hooks.changed();
        return;
      case 'join-cancel':
        this.requests = this.requests.filter((r) => r.id !== m.id);
        this.hooks.changed();
        return;
      case 'join':
        this.guests.add(m.id);
        this.guestKeys.set(m.id, String(m.key ?? '').slice(0, 64));
        this.hooks.guestJoined?.(m.id, this.guestKeys.get(m.id)!);
        this.lastPong.set(m.id, performance.now());
        this.sendSnapshot(m.id);
        return;
      case 'leave':
        if (this.role === 'host' && this.guests.has(m.id)) {
          // 드래그의 end를 보내기 전에 나가도 같은 접속 번호로 재입장한 편집과 섞이지 않게 한다.
          const w = this.hooks.getWorld(), cmd = { t: 'end' } as const;
          applyCommand(w, m.id, cmd);
          this.outbox.push({ tick: w.tickCount, p: m.id, cmd });
        }
        this.replies.delete(m.id);
        this.guests.delete(m.id);
        this.links.delete(m.id);
        this.lastPong.delete(m.id);
        if (this.guestKeys.delete(m.id)) this.hooks.guestLeft?.(m.id);
        return;
      case 'presence':
        this.others.set(m.from, { s: m.s, t: performance.now() });
        return;
      case 'ping':
        this.pings.push({ p: m.from, x: m.x, y: m.y, t: performance.now() });
        this.hooks.toast(`${this.nameOf(m.from)} 님이 핑을 찍었어요`);
        return;
      case 'chat':
        this.hooks.chat(m.from, String(m.text).slice(0, CHAT_MAX));
        return;
      case 'cmd': {
        if (this.role !== 'host' || !this.guests.has(m.from)) return;
        const w = this.hooks.getWorld();
        const result = applyCommand(w, m.from, m.cmd);
        let replies = this.replies.get(m.from);
        if (!replies) this.replies.set(m.from, (replies = new Map()));
        replies.set(m.seq, packReply(m.cmd, result));
        this.outbox.push({ tick: w.tickCount, p: m.from, seq: m.seq, cmd: m.cmd });
        return;
      }
      case 'reply-ack': {
        if (this.role !== 'host' || !this.guests.has(m.from) || !Number.isSafeInteger(m.seq)) return;
        const replies = this.replies.get(m.from);
        if (replies) for (const seq of replies.keys()) if (seq <= m.seq) replies.delete(seq);
        if (!replies?.size) this.replies.delete(m.from);
        return;
      }
      case 'speed':
        if (this.role === 'host') this.hooks.setSpeed(m.speed);
        return;
      case 'rtt-pong': {
        if (this.role !== 'host' || !this.guests.has(m.from) || !Number.isFinite(m.t)) return;
        const now = performance.now();
        const was = this.links.get(m.from);
        this.lastPong.set(m.from, now);
        this.links.set(m.from, { ms: Math.max(0, Math.round(now - m.t)), unstable: false });
        if (was?.unstable) this.hooks.changed();
        return;
      }
      case 'rtt-ping':
        if (this.role === 'guest') this.send({ type: 'rtt-pong', t: m.t });
        return;
      case 'rtt':
        if (this.role !== 'guest' || !Array.isArray(m.links)) return;
        this.links = new Map(m.links.map(([p, ms, unstable]) => [p, { ms, unstable }]));
        return;
      case 'need-sync':
        if (this.role === 'host' && this.guests.has(m.from)) this.sendSnapshot(m.from);
        return;
      case 'frame':
        if (this.role !== 'guest' || !this.synced) return;
        for (const c of m.cmds) this.inbox.push(c);
        for (const [t, h] of m.hashes) this.expected.set(t, h);
        this.hostTick = m.upTo;
        this.hostHeardAt = performance.now();
        this.syncSpeed(m.speed);
        return;
      case 'snapshot': {
        if (this.role !== 'guest') return;
        const first = !this.joined;
        const replies = m.replies?.find(([player]) => player === this.me)?.[1] ?? [];
        let acknowledged = 0;
        for (const [seq, result] of replies) {
          const done = this.pending.get(seq);
          this.pending.delete(seq);
          done?.(unpackReply(result, this.hooks.getWorld()));
          acknowledged = Math.max(acknowledged, seq);
        }
        if (acknowledged) this.send({ type: 'reply-ack', seq: acknowledged });
        const w = World.fromSnapshot(m.snap);
        this.inbox = [];
        this.expected.clear();
        this.hostTick = w.tickCount;
        this.synced = true;
        this.joined = true;
        this.borrowed = true;
        this.hostHeardAt = performance.now();
        this.hooks.setWorld(w, first);
        this.syncSpeed(m.speed);
        if (first) this.hooks.toast(`${this.hostName}의 공장에 들어왔어요`);
        this.hooks.changed();
        return;
      }
    }
  }

  private onRole(role: 'host' | 'guest' | null, reason?: 'left' | 'closed' | 'host-left' | 'kicked'): void {
    const prev = this.role;
    if (prev === 'host' && role !== 'host') {
      this.guestKeys.clear();
      this.hooks.hostEnded?.();
    }
    if (role === 'host') {
      this.leaveRole();
      this.role = 'host';
      this.hooks.toast(
        this.desktop ? '방을 만들었어요. 같은 와이파이에서 exe를 켠 사람들의 방 목록에 떠요' : '방을 만들었어요. 주소를 복사해서 사람들을 불러 보세요',
      );
    } else if (role === 'guest') {
      this.leaveRole();
      this.role = 'guest';
      this.me = this.connId;
      this.joined = false;
      this.hooks.toast('방에 들어가는 중…');
    } else {
      this.leaveRole();
      if (reason === 'host-left' && prev === 'guest') {
        // 방장이 새로고침했거나 잠깐 끊김: 방장 월드에 머문 채로 기다렸다가, 다시 열리면 저절로 들어간다
        this.hooks.toast('방장 연결이 끊겼어요. 방이 다시 열리면 저절로 들어가요');
      } else {
        this.setIntent(null);
        if (prev === 'guest') {
          this.hooks.toast(
            reason === 'closed' ? '방장이 방을 닫았어요. 내 공장으로 돌아가요'
              : reason === 'kicked' ? '방장이 나를 내보냈어요. 내 공장으로 돌아가요'
                : '방에서 나왔어요. 내 공장으로 돌아가요',
          );
          this.backToOwnWorld();
          // exe: 방장 PC의 서버에서 내 서버로 돌아온다
          this.switchServer(null);
        } else if (prev === 'host') this.hooks.toast('방을 닫았어요');
      }
    }
    this.hooks.changed();
  }

  private syncSpeed(speed: number): void {
    if (speed !== this.hooks.getSpeed()) this.hooks.setSpeed(speed);
  }

  /** 방 상태: 들어오고 나간 사람을 알리고, 이 탭이 방장·손님이었으면 다시 연다·들어간다 */
  private onRoom(open: boolean, list: RosterEntry[]): void {
    const wasOpen = this.roomOpen;
    const before = this.roster;
    this.roomOpen = open;
    this.roster = list;
    this.players = Math.max(1, this.role === 'solo' ? 1 : list.length);
    for (const p of this.others.keys()) if (!list.some((r) => r.p === p)) this.others.delete(p);
    if (this.role !== 'solo' && before.length) {
      for (const r of list) {
        if (r.p !== this.me && !before.some((b) => b.p === r.p)) this.hooks.toast(`${this.nameOf(r.p)} 님이 들어왔어요 (${list.length}명)`);
      }
      for (const b of before) {
        if (list.some((r) => r.p === b.p) || b.host) continue;
        this.hooks.toast(`${b.name || `P${b.p}`} 님이 나갔어요 (${list.length}명)`);
      }
    }
    if (this.role === 'solo' && open && !wasOpen && this.intent !== 'guest' && this.intent !== 'host') {
      this.hooks.toast(`${this.hostName}의 방이 열렸어요. 위쪽 "같이 하기"에서 참가할 수 있어요`);
    }
    this.resume();
    this.hooks.changed();
  }
}

function loadClientKey(): string {
  const fresh = () => (globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`);
  try {
    let key = sessionStorage.getItem(CLIENT_KEY);
    if (!key) sessionStorage.setItem(CLIENT_KEY, (key = fresh()));
    return key;
  } catch {
    return fresh();
  }
}

function isLocalHost(h: string): boolean {
  return h === 'localhost' || h === '127.0.0.1' || h === '[::1]';
}
