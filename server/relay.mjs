// @ts-check
import { networkInterfaces } from 'node:os';
import { WebSocket, WebSocketServer } from 'ws';

/**
 * 같은 공유기(LAN)에서 같이 하기용 중계 서버. 개발 서버(vite.config.ts)와 exe(electron/main.mjs)가 같이 쓴다.
 * - 서버 하나에 방 하나. 누군가 "방 만들기"를 누르면 그 브라우저가 방장(호스트)이 되어 월드를 갖고 시간을 정한다.
 * - "참가하기"를 누른 사람은 손님. 서버는 메시지를 나르기만 한다:
 *   손님 → 방장 (from을 붙여서), 방장 → 손님 (to가 있으면 그 손님만).
 * - 커서·핑·채팅(presence, ping, chat)은 게임 진행과 상관없어서 방장을 거치지 않고 방 안의 모두에게 바로 뿌린다.
 * - 방 상태(열렸는지, 누가 있는지)는 방 밖에서 기다리는 사람까지 모두에게 보낸다.
 * - 락스텝이라 방장과 손님의 게임 버전·빌드가 같아야 한다. 다르면 참가를 막고 왜 막혔는지 알려 준다 (join-refused).
 *
 * @typedef {{ p: number; name: string; host: boolean }} RoomPlayer
 * @typedef {{ open: boolean; players: RoomPlayer[]; version: string }} RoomState version = 방장의 게임 버전
 * @typedef {{ id: number; ws: WebSocket; name: string; role: 'host' | 'guest' | null; version: string; build: string }} Client
 */

/**
 * 다른 PC에서 들어올 IP. 공유기가 나눠 주는 주소(192.168.*, 10.*)를 앞에 둔다.
 * VirtualBox·WSL 같은 가상 어댑터(172.16~31.*)는 뒤로, 공유기를 못 찾은 주소(169.254.*)는 뺀다.
 * @returns {string[]}
 */
export function lanIps() {
  /** @param {string} ip */
  const rank = (ip) => (ip.startsWith('192.168.') ? 0 : ip.startsWith('10.') ? 1 : 2);
  return Object.values(networkInterfaces())
    .flat()
    .filter((n) => n && n.family === 'IPv4' && !n.internal && !n.address.startsWith('169.254.'))
    .map((n) => /** @type {import('node:os').NetworkInterfaceInfo} */ (n).address)
    .sort((a, b) => rank(a) - rank(b));
}

/**
 * http 서버의 /lan 에 중계 서버를 붙인다.
 * @param {import('node:http').Server} http
 * @param {{ onRoom?: (room: RoomState) => void }} [opts] 방 상태가 바뀔 때마다 (exe가 같은 와이파이에 방을 알리려고)
 */
export function attachRelay(http, opts = {}) {
  const wss = new WebSocketServer({ noServer: true });
  /** @type {Map<WebSocket, Client>} */
  const clients = new Map();
  let nextId = 1;

  /** @param {WebSocket} ws @param {object} msg */
  const send = (ws, msg) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  };
  const host = () => [...clients.values()].find((c) => c.role === 'host') ?? null;
  const guests = () => [...clients.values()].filter((c) => c.role === 'guest');
  /** 플레이어 번호: 방장은 0, 손님은 접속 번호 @param {Client} c */
  const playerOf = (c) => (c.role === 'host' ? 0 : c.id);
  /** @returns {RoomState} */
  const roomState = () => {
    const h = host();
    const players = h ? [h, ...guests()].map((c) => ({ p: playerOf(c), name: c.name, host: c.role === 'host' })) : [];
    return { open: !!h, players, version: h?.version ?? '' };
  };
  const sendRoom = () => {
    const room = roomState();
    for (const c of clients.values()) send(c.ws, { type: 'room', ...room });
    opts.onRoom?.(room);
  };
  /** @param {Client} c @param {Client['role']} role @param {string} [reason] */
  const setRole = (c, role, reason) => {
    c.role = role;
    send(c.ws, { type: 'your-role', role, reason });
  };
  /** 방장이 방을 닫거나 나감: 손님은 모두 방 밖으로 @param {'closed' | 'host-left'} reason */
  const closeRoom = (reason) => {
    for (const g of guests()) setRole(g, null, reason);
  };
  /** 다른 PC에서 들어올 주소. 서버가 이 PC 밖에서 안 보이면 빈 목록 */
  const lanUrls = () => {
    const addr = /** @type {import('node:net').AddressInfo | null} */ (http.address());
    if (!addr || (addr.address !== '::' && addr.address !== '0.0.0.0')) return [];
    return lanIps().map((ip) => `http://${ip}:${addr.port}`);
  };

  http.on('upgrade', (req, socket, head) => {
    if (new URL(req.url ?? '/', 'http://x').pathname !== '/lan') return;
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  });

  wss.on('connection', (/** @type {WebSocket} */ ws) => {
    /** @type {Client} */
    const me = { id: nextId++, ws, name: '', role: null, version: '', build: '' };
    clients.set(ws, me);
    send(ws, { type: 'welcome', id: me.id, urls: lanUrls() });
    sendRoom();

    ws.on('message', (raw) => {
      /** @type {{ type?: string; to?: number; from?: number; name?: unknown; text?: unknown; version?: unknown; build?: unknown }} */
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }
      switch (msg.type) {
        case 'hello':
          me.name = String(msg.name ?? '').slice(0, 16);
          // 버전을 안 보내는 옛 게임은 빈 값: 새 게임과는 버전이 달라서 같이 못 한다
          if (msg.version !== undefined) me.version = String(msg.version).slice(0, 32);
          if (msg.build !== undefined) me.build = String(msg.build).slice(0, 32);
          sendRoom();
          return;
        case 'create-room':
          if (host() || me.role) return;
          setRole(me, 'host');
          sendRoom();
          return;
        case 'join-room': {
          const h = host();
          if (!h || me.role) return;
          if (me.version !== h.version || me.build !== h.build) {
            send(ws, { type: 'join-refused', reason: me.version !== h.version ? 'version' : 'build', host: h.version, me: me.version });
            return;
          }
          setRole(me, 'guest');
          send(h.ws, { type: 'join', id: me.id });
          sendRoom();
          return;
        }
        case 'leave-room':
          if (me.role === 'host') {
            closeRoom('closed');
            setRole(me, null, 'left');
          } else if (me.role === 'guest') {
            setRole(me, null, 'left');
            const h = host();
            if (h) send(h.ws, { type: 'leave', id: me.id });
          }
          sendRoom();
          return;
        case 'presence':
        case 'ping':
        case 'chat': {
          if (!me.role) return;
          msg.from = playerOf(me);
          // 채팅은 너무 길면 자른다
          if (msg.type === 'chat') msg.text = String(msg.text ?? '').slice(0, 80);
          const out = JSON.stringify(msg);
          for (const c of clients.values()) if (c !== me && c.role && c.ws.readyState === WebSocket.OPEN) c.ws.send(out);
          return;
        }
      }
      // 게임 메시지 (명령·프레임·스냅샷): 방 안에서만
      if (me.role === 'host') {
        if (msg.to !== undefined) {
          const g = guests().find((c) => c.id === msg.to);
          if (g) g.ws.send(raw.toString());
        } else for (const g of guests()) if (g.ws.readyState === WebSocket.OPEN) g.ws.send(raw.toString());
      } else if (me.role === 'guest') {
        const h = host();
        if (!h) return;
        msg.from = me.id;
        send(h.ws, msg);
      }
    });

    ws.on('close', () => {
      clients.delete(ws);
      if (me.role === 'host') closeRoom('host-left');
      else if (me.role === 'guest') {
        const h = host();
        if (h) send(h.ws, { type: 'leave', id: me.id });
      }
      sendRoom();
    });
  });

  return { roomState };
}
