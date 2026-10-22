// @ts-check
import { app, BrowserWindow, ipcMain, Menu, shell } from 'electron';
import updater from 'electron-updater';
import { createHash, randomUUID } from 'node:crypto';
import dgram from 'node:dgram';
import { appendFileSync, createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import http from 'node:http';
import { networkInterfaces } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { attachRelay } from '../server/relay.mjs';

/**
 * 자동화 공장 exe. 게임 화면(dist)을 창에 띄우고, 같이 하기에 필요한 것을 이 프로그램 안에서 다 한다.
 * - 내장 서버: 게임 파일을 주고, 같이 하기 중계 서버(server/relay.mjs)도 붙인다.
 *   내가 방을 만들면 이 서버가 방이 되고, 같은 와이파이의 다른 PC(exe든 브라우저든)가 여기로 들어온다.
 * - 방 알리기: 내 방이 열려 있으면 1초마다 같은 와이파이에 "여기 방 있어요" 신호(UDP 브로드캐스트)를 뿌린다.
 * - 방 찾기: 다른 PC가 뿌린 신호를 모아 게임 화면의 방 목록에 보내 준다 (preload.cjs → window.desktop).
 *   참가를 누르면 게임 화면이 그 PC의 서버로 옮겨 붙는다 (src/net/session.ts).
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(here, '..', 'dist');
/**
 * 내장 서버 포트. 저장(localStorage)이 주소별로 따로라서 늘 같은 포트를 쓴다.
 * 같은 PC에서 하나 더 켜면 다음 포트(47821, 47822, …)를 쓰고 저장도 따로 한다.
 */
const GAME_PORT = 47820;
const MAX_WINDOWS = 10;
/** 방 알리기 신호를 주고받는 포트 (UDP) */
const DISCOVERY_PORT = 47819;
/** 브로드캐스트를 막는 공유기를 위해 멀티캐스트로도 보낸다 */
const DISCOVERY_GROUP = '239.255.78.20';
const BEACON_MS = 1000;
/** 신호가 이만큼 안 오면 방이 닫힌 것으로 본다 */
const ROOM_TTL_MS = 3500;
const GAME_ID = 'automation-factory';

/** 이 프로그램 하나를 가리키는 번호 (내 신호는 내 방 목록에 안 띄우려고) */
const instanceId = randomUUID();
/**
 * 게임 빌드 번호. 같이 하기는 모두 같은 시뮬레이션 코드를 돌려야 맞으므로, 빌드가 다른 방은 목록에 "버전이 달라요"로 띄운다.
 * Vite가 파일 내용으로 이름을 지어 index.html에 넣으므로 index.html만 보면 된다.
 */
const BUILD = existsSync(path.join(DIST, 'index.html'))
  ? createHash('sha1').update(readFileSync(path.join(DIST, 'index.html'))).digest('hex').slice(0, 10)
  : 'dev';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ico': 'image/x-icon',
};

/** dist 안의 파일만 준다 */
function serveStatic(/** @type {http.IncomingMessage} */ req, /** @type {http.ServerResponse} */ res) {
  let urlPath;
  try {
    urlPath = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname);
  } catch {
    res.writeHead(400).end();
    return;
  }
  let file = path.normalize(path.join(DIST, urlPath));
  if (!file.startsWith(DIST)) {
    res.writeHead(403).end();
    return;
  }
  if (!existsSync(file) || statSync(file).isDirectory()) file = path.join(DIST, 'index.html');
  res.writeHead(200, { 'Content-Type': MIME[/** @type {keyof typeof MIME} */ (path.extname(file))] ?? 'application/octet-stream' });
  createReadStream(file).pipe(res);
}

/**
 * 47820부터 빈 포트를 찾아 연다. slot = 같은 PC에서 몇 번째로 켠 창인지 (0부터)
 * @returns {Promise<{ server: http.Server; port: number; slot: number }>}
 */
async function startServer() {
  for (let slot = 0; slot < MAX_WINDOWS; slot++) {
    const server = http.createServer(serveStatic);
    const ok = await new Promise((resolve, reject) => {
      server.once('listening', () => resolve(true));
      server.once('error', (err) => (/** @type {NodeJS.ErrnoException} */ (err).code === 'EADDRINUSE' ? resolve(false) : reject(err)));
      server.listen(GAME_PORT + slot, '0.0.0.0');
    });
    if (ok) return { server, port: GAME_PORT + slot, slot };
  }
  throw new Error('빈 포트가 없어요');
}

/** 각 랜카드의 브로드캐스트 주소 (예: 192.168.0.255). 255.255.255.255는 랜카드 하나로만 나가는 경우가 있어 같이 쓴다 */
function localNets() {
  const broadcast = new Set(['255.255.255.255']);
  /** @type {string[]} */
  const ips = [];
  for (const n of Object.values(networkInterfaces()).flat()) {
    if (!n || n.family !== 'IPv4' || n.internal) continue;
    ips.push(n.address);
    const ip = n.address.split('.').map(Number);
    const mask = n.netmask.split('.').map(Number);
    broadcast.add(ip.map((b, i) => (b & mask[i]) | (~mask[i] & 255)).join('.'));
  }
  return { ips, broadcast: [...broadcast] };
}

/**
 * 게임 화면에 보내는 방 하나. same = 내 exe와 같은 빌드인지
 * @typedef {{ id: string; ip: string; port: number; host: string; players: number; same: boolean }} LanRoom
 */

/** 같은 와이파이에 방 알리기 + 남의 방 찾기 */
function startDiscovery(/** @type {number} */ gamePort, /** @type {() => import('../server/relay.mjs').RoomState} */ roomState) {
  /** @type {Map<string, LanRoom & { seen: number; ipSeen: number }>} */
  const rooms = new Map();
  /** @type {BrowserWindow | null} */
  let win = null;
  // 같은 PC에서 여러 개 켜도 모두 같은 포트로 신호를 받을 수 있게 reuseAddr (브로드캐스트는 모두에게 간다)
  const sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });
  /** 멀티캐스트에 들어간 랜카드 (와이파이를 다시 잡으면 새로 들어간다) */
  const joined = new Set();
  const joinGroup = () => {
    for (const ip of localNets().ips) {
      if (joined.has(ip)) continue;
      try {
        sock.addMembership(DISCOVERY_GROUP, ip);
        joined.add(ip);
      } catch {
        // 멀티캐스트가 안 되는 랜카드: 브로드캐스트만
      }
    }
  };
  let bound = false;
  sock.on('error', (err) => console.warn('방 찾기 오류', err));
  sock.bind(DISCOVERY_PORT, () => {
    bound = true;
    sock.setBroadcast(true);
    sock.setMulticastLoopback(true);
    joinGroup();
  });

  sock.on('message', (buf, rinfo) => {
    let m;
    try {
      m = JSON.parse(buf.toString());
    } catch {
      return;
    }
    if (m?.game !== GAME_ID || typeof m.id !== 'string' || m.id === instanceId) return;
    if (!m.open) {
      if (rooms.delete(m.id)) push();
      return;
    }
    const now = Date.now();
    const prev = rooms.get(m.id);
    // 같은 방 신호가 여러 랜카드로 오면 처음 받은 주소를 계속 쓴다 (그 주소가 끊기면 바꾼다)
    const keepIp = prev && prev.ip !== rinfo.address && now - prev.ipSeen < ROOM_TTL_MS;
    rooms.set(m.id, {
      id: m.id,
      ip: keepIp ? prev.ip : rinfo.address,
      ipSeen: keepIp ? prev.ipSeen : now,
      port: Number(m.port),
      host: String(m.host ?? '').slice(0, 16),
      players: Number(m.players) || 1,
      version: String(m.version ?? '').slice(0, 32),
      same: m.build === BUILD,
      seen: now,
    });
    if (!prev) push();
  });

  const beacon = () => {
    if (!bound) return;
    const room = roomState();
    const host = room.players.find((p) => p.host);
    const msg = Buffer.from(
      JSON.stringify({
        game: GAME_ID,
        id: instanceId,
        version: app.getVersion(),
        build: BUILD,
        open: room.open,
        port: gamePort,
        host: host?.name ?? '',
        players: room.players.length,
      }),
    );
    for (const addr of [...localNets().broadcast, DISCOVERY_GROUP]) sock.send(msg, DISCOVERY_PORT, addr, () => {});
  };

  /** 지난 신호를 지우고 화면에 보낸다 */
  const push = () => {
    const now = Date.now();
    for (const [id, r] of rooms) if (now - r.seen > ROOM_TTL_MS) rooms.delete(id);
    if (!win || win.isDestroyed()) return;
    win.webContents.send(
      'lan-rooms',
      [...rooms.values()].map(({ seen: _s, ipSeen: _i, ...r }) => r),
    );
  };

  let wasOpen = false;
  setInterval(() => {
    joinGroup();
    const open = roomState().open;
    // 방을 닫은 순간에도 한 번 알려서 남의 목록에서 바로 지워지게
    if (open || wasOpen) beacon();
    wasOpen = open;
    push();
  }, BEACON_MS);

  return {
    /** 방이 열리고 닫힐 때·사람이 들고 날 때 바로 알린다 (1초 기다리지 않게) */
    roomChanged: () => beacon(),
    setWindow: (/** @type {BrowserWindow} */ w) => {
      win = w;
    },
  };
}

async function main() {
  const { server, port, slot } = await startServer();
  await app.whenReady();
  // 메뉴 막대(File·Edit…)는 영어라 없앤다. 새로고침(F5)·개발자 도구(F12)는 아래에서 직접
  Menu.setApplicationMenu(null);
  /** @type {ReturnType<typeof startDiscovery> | null} */
  let discovery = null;
  const relay = attachRelay(server, { onRoom: () => discovery?.roomChanged() });
  discovery = startDiscovery(port, relay.roomState);

  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    title: `자동화 공장 ${app.getVersion()}${slot ? ` (${slot + 1})` : ''}`,
    // 창·작업 표시줄 아이콘 (npm run app으로 켤 때도 기본 일렉트론 아이콘 대신)
    icon: path.join(here, 'icon.ico'),
    backgroundColor: '#1a1d22',
    webPreferences: {
      preload: path.join(here, 'preload.cjs'),
      // 같은 PC에서 두 번째로 켠 창은 저장 공간도 따로 (같은 공간을 둘이 같이 열면 저장이 안 될 수 있다)
      partition: slot ? `persist:window${slot + 1}` : undefined,
      // 창을 내려놔도 방장 시간이 느려지지 않게 (같이 할 때 손님들이 멈추지 않도록)
      backgroundThrottling: false,
    },
  });
  // 게임 제목(<title>)이 창 제목을 덮지 않게: 같은 PC에서 여러 개 켰을 때 몇 번째 창인지 보이도록
  win.on('page-title-updated', (e) => e.preventDefault());
  discovery.setWindow(win);
  const ses = win.webContents.session;

  win.webContents.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'F5') {
      e.preventDefault();
      win.webContents.reload();
    } else if (input.key === 'F12') {
      e.preventDefault();
      win.webContents.toggleDevTools();
    }
  });
  // 링크는 게임 창이 아니라 브라우저로
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (new URL(url).origin !== `http://localhost:${port}`) e.preventDefault();
  });
  // 창을 닫을 때 게임이 마지막으로 저장한 것을 디스크에 확실히 쓴다
  win.on('closed', () => {
    ses.flushStorageData();
    app.quit();
  });
  setupUpdates(win);
  await win.loadURL(`http://localhost:${port}/`);
}

/**
 * 게임 안 업데이트. 켤 때 깃허브 릴리스(package.json의 build.publish)에서 새 버전을 찾고,
 * 있으면 게임 화면에 알린다 (src/ui/update.ts). 사용자가 "업데이트"를 누르면 받아서 조용히 설치하고 다시 켠다.
 * 설치 파일 전체가 아니라 바뀐 조각만 받는다 (electron-builder가 만드는 .blockmap).
 * 기록: %APPDATA%\자동화 공장\update.log
 */
function setupUpdates(/** @type {BrowserWindow} */ win) {
  // npm run app으로 켠 개발용 창은 업데이트하지 않는다 (설치한 게임에만 업데이트 주소가 들어 있다)
  if (!app.isPackaged) return;
  const { autoUpdater } = updater;
  const logFile = path.join(app.getPath('userData'), 'update.log');
  const log = (/** @type {unknown[]} */ ...a) => {
    try {
      appendFileSync(logFile, `${new Date().toISOString()} ${a.map((x) => (x instanceof Error ? x.stack : String(x))).join(' ')}\n`);
    } catch {
      // 기록 못 해도 게임은 계속
    }
  };
  autoUpdater.logger = { info: log, warn: log, error: log, debug: () => {} };
  autoUpdater.autoDownload = false;

  /** 마지막으로 알린 상태 (게임 화면을 새로고침해도 다시 보여 주려고) @type {object | null} */
  let last = null;
  /** 사용자가 받기를 눌렀는지. 그 전의 오류(인터넷이 없음 등)는 화면에 띄우지 않는다 */
  let asked = false;
  const send = (/** @type {object} */ s) => {
    last = s;
    if (!win.isDestroyed()) win.webContents.send('update', s);
  };
  autoUpdater.on('update-available', (info) => send({ state: 'available', version: info.version, current: app.getVersion() }));
  autoUpdater.on('download-progress', (p) => send({ state: 'downloading', percent: p.percent }));
  autoUpdater.on('update-downloaded', () => {
    send({ state: 'installing' });
    // 창이 닫히면서 게임이 저장되고, 조용히 설치한 다음 다시 켠다
    setTimeout(() => autoUpdater.quitAndInstall(true, true), 1000);
  });
  autoUpdater.on('error', (err) => {
    if (asked) send({ state: 'error', message: String(err?.message ?? err).split('\n')[0].slice(0, 120) });
  });
  ipcMain.on('update-download', () => {
    asked = true;
    autoUpdater.downloadUpdate().catch(() => {}); // 실패는 위 error로 온다
  });
  win.webContents.on('did-finish-load', () => {
    if (last) win.webContents.send('update', last);
  });
  autoUpdater.checkForUpdates().catch(() => {}); // 실패는 기록만 (logger)
}

main().catch((err) => {
  console.error(err);
  app.quit();
});
