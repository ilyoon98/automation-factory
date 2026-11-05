import { afterEach, describe, expect, it, vi } from 'vitest';
import { World } from '../sim/world';
import { Session } from './session';

afterEach(() => vi.unstubAllGlobals());

/** 서버 대신 메시지를 직접 넣고, 보낸 메시지를 모은다. 실제 연결은 하지 않는다 */
function session() {
  const memory = () => {
    const m = new Map<string, string>();
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
  };
  vi.stubGlobal('window', { setTimeout, clearTimeout });
  vi.stubGlobal('localStorage', memory());
  vi.stubGlobal('sessionStorage', memory());
  vi.stubGlobal('location', { href: 'http://localhost/', host: 'localhost', hostname: 'localhost', protocol: 'http:', origin: 'http://localhost' });
  vi.stubGlobal('history', { replaceState: vi.fn() });
  vi.stubGlobal('WebSocket', { OPEN: 1, CONNECTING: 0 });
  const w = new World(10, 10); w.rules = 'regional-v1'; w.createHub(0, 0);
  const hooks = { getWorld: () => w, setWorld: vi.fn(), restoreOwnWorld: vi.fn(), getSpeed: () => 1, setSpeed: vi.fn(), toast: vi.fn(), chat: vi.fn(), changed: vi.fn() };
  const s = new Session(hooks);
  const sent: { type: string; [k: string]: unknown }[] = [];
  (s as unknown as { ws: unknown }).ws = { readyState: 1, send: (raw: string) => sent.push(JSON.parse(raw)), close: vi.fn() };
  const recv = (m: object) => (s as unknown as { onMessage(m: object): void }).onMessage(m);
  recv({ type: 'welcome', id: 7 });
  return { s, hooks, sent, recv };
}

describe('방장: 참가 신청 처리', () => {
  it('신청을 목록에 한 번만 넣고, 허락·거절하면 서버에 알리고 목록에서 뺀다', () => {
    const { s, sent, recv } = session();
    recv({ type: 'your-role', role: 'host' });
    recv({ type: 'join-request', id: 3, name: '친구' });
    recv({ type: 'join-request', id: 3, name: '친구' });
    recv({ type: 'join-request', id: 4, name: '' });
    expect(s.requests).toEqual([{ id: 3, name: '친구' }, { id: 4, name: '' }]);
    s.approve(3);
    s.deny(4);
    expect(sent.slice(-2)).toEqual([{ type: 'approve', id: 3 }, { type: 'deny', id: 4 }]);
    expect(s.requests).toEqual([]);
  });

  it('신청이 취소되거나 방을 닫으면 목록을 비운다', () => {
    const { s, recv } = session();
    recv({ type: 'your-role', role: 'host' });
    recv({ type: 'join-request', id: 3, name: 'A' });
    recv({ type: 'join-request', id: 4, name: 'B' });
    recv({ type: 'join-cancel', id: 3 });
    expect(s.requests.map((r) => r.id)).toEqual([4]);
    recv({ type: 'your-role', role: null, reason: 'left' });
    expect(s.requests).toEqual([]);
  });

  it('손님은 신청을 받지 않고, 방장은 자기 자신이나 없는 사람을 내보내지 않는다', () => {
    const { s, sent, recv } = session();
    recv({ type: 'join-request', id: 3, name: 'A' });
    expect(s.requests).toEqual([]);
    recv({ type: 'your-role', role: 'host' });
    recv({ type: 'room', open: true, players: [{ p: 0, name: '', host: true }, { p: 5, name: 'B', host: false }] });
    s.kick(0); s.kick(9);
    expect(sent.some((m) => m.type === 'kick')).toBe(false);
    s.kick(5);
    expect(sent.at(-1)).toEqual({ type: 'kick', id: 5 });
  });
});

describe('손님: 허락 기다리기', () => {
  it('신청하면 허락을 기다리고, 거절당하면 다시 신청하지 않는다', () => {
    const { s, sent, recv } = session();
    recv({ type: 'room', open: true, players: [{ p: 0, name: '', host: true }] });
    s.joinRoom();
    recv({ type: 'join-pending' });
    expect(s.asking).toBe(true);
    recv({ type: 'join-refused', reason: 'denied' });
    expect(s.asking).toBe(false);
    const before = sent.length;
    recv({ type: 'room', open: true, players: [{ p: 0, name: '', host: true }] });
    expect(sent.slice(before).some((m) => m.type === 'join-room')).toBe(false);
  });

  it('기다리다 그만두면 신청을 거둔다', () => {
    const { s, sent, recv } = session();
    recv({ type: 'room', open: true, players: [{ p: 0, name: '', host: true }] });
    s.joinRoom();
    recv({ type: 'join-pending' });
    s.leaveRoom();
    expect(sent.at(-1)).toEqual({ type: 'leave-room' });
    expect(s.asking).toBe(false);
  });

  it('방장이 내보내면 내 공장으로 돌아간다', () => {
    const { s, hooks, recv } = session();
    recv({ type: 'room', open: true, players: [{ p: 0, name: '', host: true }] });
    s.joinRoom();
    recv({ type: 'your-role', role: 'guest' });
    recv({ type: 'your-role', role: null, reason: 'kicked' });
    expect(s.role).toBe('solo');
    expect(hooks.restoreOwnWorld).toHaveBeenCalled();
    expect(hooks.toast).toHaveBeenLastCalledWith('방장이 나를 내보냈어요. 내 공장으로 돌아가요');
  });
});

describe('연결 표시', () => {
  it('방장은 2초마다 지연을 묻고, 답으로 왕복 시간을 재어 표를 모두에게 알린다', () => {
    let now = 1000;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    const { s, sent, recv } = session();
    recv({ type: 'your-role', role: 'host' });
    recv({ type: 'join', id: 3 });
    now = 3500;
    s.advance(0);
    const ping = sent.find((m) => m.type === 'rtt-ping');
    expect(ping).toEqual({ type: 'rtt-ping', t: 3500 });
    now = 3542;
    recv({ type: 'rtt-pong', from: 3, t: 3500 });
    expect(s.linkOf(3)).toEqual({ ms: 42, unstable: false });
    now = 5600;
    s.advance(0);
    expect(sent.filter((m) => m.type === 'rtt').at(-1)).toEqual({ type: 'rtt', links: [[3, 42, false]] });
    vi.restoreAllMocks();
  });

  it('방장은 5초 넘게 답이 없는 손님을 불안정으로 표시하고, 답이 오면 푼다', () => {
    let now = 1000;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    const { s, recv } = session();
    recv({ type: 'your-role', role: 'host' });
    recv({ type: 'join', id: 3 });
    now = 7000;
    s.advance(0);
    expect(s.linkOf(3)?.unstable).toBe(true);
    recv({ type: 'rtt-pong', from: 3, t: 6990 });
    expect(s.linkOf(3)).toEqual({ ms: 10, unstable: false });
    vi.restoreAllMocks();
  });

  it('손님은 지연 질문에 바로 답하고, 방장 표를 받아 보며, 방장 진행이 3초 끊기면 불안정이다', () => {
    let now = 1000;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    const { s, sent, recv } = session();
    recv({ type: 'room', open: true, players: [{ p: 0, name: '', host: true }, { p: 7, name: '', host: false }] });
    s.joinRoom();
    recv({ type: 'your-role', role: 'guest' });
    const w = new World(10, 10); w.rules = 'regional-v1'; w.createHub(0, 0);
    recv({ type: 'snapshot', snap: w.snapshot(), speed: 1 });
    recv({ type: 'rtt-ping', t: 123 });
    expect(sent.at(-1)).toEqual({ type: 'rtt-pong', t: 123 });
    recv({ type: 'rtt', links: [[7, 55, false]] });
    expect(s.linkOf(7)).toEqual({ ms: 55, unstable: false });
    expect(s.hostSilent).toBe(false);
    now = 4500;
    expect(s.hostSilent).toBe(true);
    recv({ type: 'frame', upTo: w.tickCount, cmds: [], hashes: [], speed: 1 });
    expect(s.hostSilent).toBe(false);
    vi.restoreAllMocks();
  });
});
