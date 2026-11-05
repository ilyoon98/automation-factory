import { createServer } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { DENY_COOLDOWN_MS, attachRelay } from './relay.mjs';

/** 실제 중계 서버에 붙는 작은 접속. 받은 메시지를 쌓아 두고 원하는 것이 올 때까지 기다린다 */
class Peer {
  /** @param {WebSocket} ws */
  constructor(ws) {
    this.ws = ws;
    /** @type {{ type: string; [k: string]: unknown }[]} */
    this.inbox = [];
    /** @type {(() => void)[]} */
    this.waiters = [];
    ws.on('message', (raw) => {
      this.inbox.push(JSON.parse(raw.toString()));
      for (const w of this.waiters.splice(0)) w();
    });
  }
  /** @param {object} msg */
  send(msg) {
    this.ws.send(JSON.stringify(msg));
  }
  /** @param {string} type @param {(m: any) => boolean} [match] */
  async next(type, match = () => true) {
    for (;;) {
      const i = this.inbox.findIndex((m) => m.type === type && match(m));
      if (i >= 0) return this.inbox.splice(i, 1)[0];
      await new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error(`기다린 메시지 ${type}가 오지 않음`)), 1500);
        this.waiters.push(() => { clearTimeout(t); resolve(undefined); });
      });
    }
  }
  /** @param {string} type */
  has(type) {
    return this.inbox.some((m) => m.type === type);
  }
}

/** @type {import('node:http').Server | null} */
let http = null;
/** @type {Peer[]} */
const peers = [];
let clock = 0;

async function relay() {
  const server = createServer();
  http = server;
  // 시험은 모두 같은 PC(127.0.0.1)에서 붙으므로 방장 PC 자동 허락을 끈다
  attachRelay(server, { trustHostPc: false, now: () => clock });
  await new Promise((r) => server.listen(0, '127.0.0.1', () => r(undefined)));
  const port = /** @type {import('node:net').AddressInfo} */ (server.address()).port;
  /** @param {string} name */
  const join = async (name) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/lan`);
    const p = new Peer(ws);
    peers.push(p);
    await p.next('welcome');
    p.send({ type: 'hello', name, version: '1', build: 'b' });
    return p;
  };
  const host = await join('방장');
  host.send({ type: 'create-room' });
  await host.next('your-role', (m) => m.role === 'host');
  return { join, host };
}

afterEach(async () => {
  for (const p of peers.splice(0)) p.ws.close();
  await new Promise((r) => (http ? http.close(() => r(undefined)) : r(undefined)));
  http = null;
  clock = 0;
});

describe('방 참가 승인', () => {
  it('참가 신청은 방장에게 한 번만 묻고, 허락하면 손님이 된다', async () => {
    const { join, host } = await relay();
    const guest = await join('친구');
    guest.send({ type: 'join-room' });
    guest.send({ type: 'join-room' });
    await guest.next('join-pending');
    const req = await host.next('join-request');
    expect(req).toMatchObject({ name: '친구' });
    host.send({ type: 'approve', id: req.id });
    await guest.next('your-role', (m) => m.role === 'guest');
    await host.next('join', (m) => m.id === req.id);
    expect(host.has('join-request')).toBe(false);
  });

  it('한 번 허락받은 PC는 다시 들어올 때 묻지 않는다', async () => {
    const { join, host } = await relay();
    const guest = await join('친구');
    guest.send({ type: 'join-room' });
    host.send({ type: 'approve', id: (await host.next('join-request')).id });
    await guest.next('your-role', (m) => m.role === 'guest');
    guest.send({ type: 'leave-room' });
    await guest.next('your-role', (m) => m.role === null);
    guest.send({ type: 'join-room' });
    await guest.next('your-role', (m) => m.role === 'guest');
  });

  it('거절하면 알리고 잠시 다시 신청하지 못한다', async () => {
    const { join, host } = await relay();
    const guest = await join('모르는 사람');
    guest.send({ type: 'join-room' });
    host.send({ type: 'deny', id: (await host.next('join-request')).id });
    await guest.next('join-refused', (m) => m.reason === 'denied');
    guest.send({ type: 'join-room' });
    await guest.next('join-refused', (m) => m.reason === 'denied');
    clock += DENY_COOLDOWN_MS + 1;
    guest.send({ type: 'join-room' });
    await host.next('join-request');
  });

  it('내보낸 손님은 방이 열려 있는 동안 다시 못 들어오고, 방을 다시 열면 풀린다', async () => {
    const { join, host } = await relay();
    const guest = await join('장난꾸러기');
    guest.send({ type: 'join-room' });
    const req = await host.next('join-request');
    host.send({ type: 'approve', id: req.id });
    await guest.next('your-role', (m) => m.role === 'guest');
    host.send({ type: 'kick', id: req.id });
    await guest.next('your-role', (m) => m.role === null && m.reason === 'kicked');
    await host.next('leave', (m) => m.id === req.id);
    guest.send({ type: 'join-room' });
    await guest.next('join-refused', (m) => m.reason === 'banned');
    host.send({ type: 'leave-room' });
    await host.next('your-role', (m) => m.role === null);
    host.send({ type: 'create-room' });
    await host.next('your-role', (m) => m.role === 'host');
    guest.send({ type: 'join-room' });
    await host.next('join-request');
  });

  it('손님은 방장을 내보내거나 신청을 처리하지 못한다', async () => {
    const { join, host } = await relay();
    const a = await join('A');
    a.send({ type: 'join-room' });
    const req = await host.next('join-request');
    host.send({ type: 'approve', id: req.id });
    await a.next('your-role', (m) => m.role === 'guest');
    // 방장의 접속 번호는 1 (서버를 띄우고 처음 붙은 접속)
    a.send({ type: 'kick', id: 1 });
    a.send({ type: 'deny', id: req.id });
    a.send({ type: 'kick', id: req.id });
    await new Promise((r) => setTimeout(r, 100));
    expect(host.has('your-role')).toBe(false);
    expect(a.has('your-role')).toBe(false);
    expect(a.has('join-refused')).toBe(false);
  });

  it('신청을 취소하거나 연결이 끊기면 방장 목록에서 지우고, 방장이 방을 닫으면 신청이 취소된다', async () => {
    const { join, host } = await relay();
    const a = await join('A');
    a.send({ type: 'join-room' });
    const req = await host.next('join-request');
    a.send({ type: 'leave-room' });
    await host.next('join-cancel', (m) => m.id === req.id);
    const b = await join('B');
    b.send({ type: 'join-room' });
    const reqB = await host.next('join-request');
    b.ws.close();
    await host.next('join-cancel', (m) => m.id === reqB.id);
    const c = await join('C');
    c.send({ type: 'join-room' });
    await host.next('join-request');
    host.send({ type: 'leave-room' });
    await c.next('join-refused', (m) => m.reason === 'closed');
  });
});
