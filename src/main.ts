import './style.css';
import { Input } from './input/input';
import { PING_SEC, Session } from './net/session';
import { Camera } from './render/camera';
import { Renderer, type OtherPlayer, type PingMark } from './render/renderer';
import type { Command, PlaceResult, ResultOf } from './sim/commands';
import { DT, World } from './sim/world';
import { ITEM_IDS } from './data/items';
import { CURRENT_SAVE_KEY, loadCurrentSave } from './sim/current-save';
import { generateRegionalWorld } from './sim/regional-map';
import { Chat } from './ui/chat';
import { uiZoom } from './ui/crisp';
import { Minimap } from './ui/minimap';
import { sound } from './ui/sound';
import { UI, type GameApi } from './ui/ui';
import { setupUpdateBanner } from './ui/update';

/**
 * 개발용 지역 생산망 확장 세계 (주소 끝에 ?regional-dev).
 * 모든 연구를 마치고 허브 재고를 채운 시험용 세계라 평소 저장과 섞이지 않게 따로 저장한다
 */
const REGIONAL_DEV = new URLSearchParams(location.search).has('regional-dev');
const SAVE_KEY = REGIONAL_DEV ? 'automation-game/save-regional-dev' : CURRENT_SAVE_KEY;

/**
 * 새 세계와 자동 이어하기는 지역 생산망 확장 지도만 사용한다.
 * 개발용 regional-dev면 연구 완료·재고
 */
function newWorld(): World {
  const seed = (Math.random() * 2 ** 31) | 0;
  const w = generateRegionalWorld(seed);
  if (REGIONAL_DEV) {
    w.revealSites(['*']);
    for (const t of w.techs) w.applyTech(t.id);
    for (const item of ITEM_IDS) w.stock.set(item, 10000);
  }
  return w;
}
const AUTOSAVE_SEC = 30;

function loadWorld(): World | null {
  return REGIONAL_DEV ? loadCurrentSave(localStorage, [SAVE_KEY]) : loadCurrentSave(localStorage);
}

const canvas = document.getElementById('game') as HTMLCanvasElement;
const camera = new Camera();
const renderer = new Renderer(canvas);

const loaded = loadWorld();
let world = loaded ?? newWorld();
let lastSpeed = 1;
const minimap = new Minimap(document.getElementById('minimap') as HTMLCanvasElement, () => world, camera);

function centerOnHub(): void {
  const hub = world.hub!;
  camera.x = hub.x + 1.5;
  camera.y = hub.y + 1.5;
  camera.zoom = 36;
}
centerOnHub();

/** 속도를 실제로 바꾼다 (손님은 호스트가 알려 준 속도를 보여 주기만) */
function applySpeed(s: number): void {
  if (s > 0) lastSpeed = s;
  game.speed = s;
  ui.update();
}

const session = new Session({
  getWorld: () => world,
  setWorld(w, first) {
    world = w;
    // 스냅샷에 포함된 진행 중 편집도 새 세계에서 end로 마감해야 다음 드래그가 독립된다.
    game.input.resetWorld();
    if (first) centerOnHub();
    ui.update();
  },
  restoreOwnWorld() {
    // 손님으로 있는 동안 내 저장은 건드리지 않았으므로 그대로 불러오면 된다
    game.input.resetWorld(false);
    world = loadWorld() ?? newWorld();
    applySpeed(lastSpeed);
    centerOnHub();
  },
  getSpeed: () => game.speed,
  setSpeed: applySpeed,
  toast: (msg) => ui.toast(msg, 2600),
  chat(from, text) {
    chat.show(from, text);
    if (from !== session.me) sound.play('chat');
  },
  changed: () => ui.update(),
});
const chat = new Chat(session);

/** 내가 낸 명령이 적용되면 그에 맞는 효과음 */
function commandSound(cmd: Command, r: unknown): void {
  switch (cmd.t) {
    case 'place': {
      const p = r as PlaceResult;
      if (p.ok) sound.play('place');
      else if (cmd.initial && p.reason) {
        const [x, y] = World.originFor(cmd.tool, cmd.x, cmd.y);
        renderer.rejectPlacement(x, y, cmd.tool, p.reason);
      }
      // 드래그 중 막힌 칸마다 소리를 내면 시끄러우니 처음 클릭에서만
      if (!p.ok && cmd.initial && (p.swap || (p.reason && p.reason !== '이미 건물이 있음'))) sound.play('error');
      break;
    }
    case 'paste':
      if ((r as ResultOf<typeof cmd>).placed > 0) sound.play('place');
      break;
    case 'road-build':
      sound.play((r as ResultOf<typeof cmd>).ok ? 'place' : 'error');
      sound.endStroke();
      break;
    case 'remove-at':
    case 'remove':
    case 'remove-truck':
      if (r) sound.play('remove');
      break;
    case 'remove-area':
      if ((r as number) > 0) sound.play('remove');
      break;
    case 'rotate':
      sound.play('rotate');
      break;
    case 'research':
      if (!r) sound.play('error');
      break;
    case 'build-truck':
    case 'clone-truck':
      sound.play(r ? 'truck' : 'error');
      break;
    case 'undo':
    case 'redo':
      if (r) sound.play('undo');
      break;
    case 'end':
      // 마우스를 떼면 연달아 짓는 동안 오르던 글리산도를 끈다
      sound.endStroke();
      break;
  }
}

/** 위쪽 저장 버튼: 마지막 저장이 됐는지, 그 뒤로 내가 공장을 바꿨는지 */
const saveState = { ok: true, dirty: false };
let savedWorld: World | null = null;
let savedTick = -1;
let savedTime = -1;
let pendingSave: number | null = null;

const game: GameApi = {
  getWorld: () => world,
  exec: (cmd, done) => {
    if (cmd.t !== 'end') saveState.dirty = true;
    return session.exec(cmd, (r) => {
      commandSound(cmd, r);
      done?.(r);
    });
  },
  get me() {
    return session.me;
  },
  get net() {
    return session;
  },
  input: null!,
  speed: 1,
  get lastSpeed() {
    return lastSpeed;
  },
  get saveState() {
    return saveState;
  },
  setSpeed(s: number) {
    if (!session.requestSpeed(s)) applySpeed(s);
  },
  save() {
    // 손님은 호스트의 공장을 빌려 쓰는 중이라, 내 저장(혼자 하던 공장)을 덮어쓰지 않는다
    if (!session.canSave) return false;
    if (pendingSave !== null) {
      cancelIdleCallback(pendingSave);
      pendingSave = null;
    }
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(world.serialize()));
      saveState.ok = true;
      saveState.dirty = false;
      savedWorld = world;
      savedTick = world.tickCount;
      savedTime = world.time;
      return true;
    } catch (err) {
      console.warn('저장 실패', err);
      saveState.ok = false;
      return false;
    }
  },
  get mapShown() {
    return minimap.shown;
  },
  toggleMap() {
    minimap.toggle();
    ui.update();
  },
  get center() {
    return { x: camera.x, y: camera.y };
  },
  focus(x: number, y: number) {
    camera.x = x;
    camera.y = y;
    camera.zoom = Math.max(camera.zoom, 28);
  },
  newGame() {
    if (session.role === 'guest') {
      ui.toast('새 게임은 호스트만 시작할 수 있어요');
      return;
    }
    if (!backupWorld()) {
      ui.toast(BACKUP_FAILURE, 9000);
      return;
    }
    game.input.resetWorld();
    world = newWorld();
    centerOnHub();
    game.save();
    session.worldReplaced();
    ui.update();
  },
  exportSave() {
    const blob = new Blob([JSON.stringify(world.serialize())], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    const d = new Date();
    const two = (n: number) => String(n).padStart(2, '0');
    a.download = `자동화공장-${d.getFullYear()}${two(d.getMonth() + 1)}${two(d.getDate())}-${two(d.getHours())}${two(d.getMinutes())}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  },
  importSave(text: string) {
    // 손님은 방장의 공장을 빌려 쓰는 중이라 바꿀 수 없다 (새 게임과 같은 규칙)
    if (!session.canSave) return '같이 하는 동안 손님은 불러올 수 없어요';
    let w: World;
    try {
      w = World.deserialize(JSON.parse(text));
    } catch {
      return '공장 파일이 아니에요';
    }
    if (!w.regional) return '구맵 저장은 지원하지 않아요. 지역 생산망 확장 지도 공장 파일을 선택해 주세요.';
    if (!backupWorld()) return BACKUP_FAILURE;
    replaceWorld(w);
    return null;
  },
  restoreBackup() {
    if (!session.canSave) return '같이 하는 동안 손님은 되돌릴 수 없어요';
    let w: World;
    try {
      const raw = localStorage.getItem(BACKUP_KEY);
      if (!raw) return '되돌릴 공장이 없어요';
      w = World.deserialize(JSON.parse(raw));
    } catch {
      return '보관한 공장을 읽지 못했어요';
    }
    if (!w.regional) return '구맵 백업은 지원하지 않아요. 새 공장은 지역 생산망 확장 지도를 사용해요.';
    // 지금 공장과 맞바꿔 둔다 (한 번 더 누르면 다시 돌아오게)
    if (!backupWorld()) return BACKUP_FAILURE;
    replaceWorld(w);
    return null;
  },
  get hasBackup() {
    return hasBackup;
  },
};

/** 새 게임·파일 불러오기·되돌리기로 공장이 통째로 바뀌기 바로 전의 공장 (한 칸만) */
const BACKUP_KEY = REGIONAL_DEV ? 'automation-game/save-regional-dev-backup' : 'automation-game/save-regional-v1-backup';
let hasBackup = (() => {
  try {
    return localStorage.getItem(BACKUP_KEY) !== null;
  } catch {
    return false;
  }
})();

const BACKUP_FAILURE = '현재 공장을 보관하지 못해 전환을 중단했어요. 공장을 파일로 내보낸 뒤 저장 공간을 확인해 주세요.';

function backupWorld(): boolean {
  try {
    localStorage.setItem(BACKUP_KEY, JSON.stringify(world.serialize()));
    hasBackup = true;
    return true;
  } catch (err) {
    console.warn('되돌리기용 보관 실패', err);
    return false;
  }
}

/** 다른 공장으로 바꾼다 (불러오기·되돌리기). 저장하고, 방장이면 손님들에게도 보낸다 */
function replaceWorld(w: World): void {
  game.input.resetWorld();
  world = w;
  centerOnHub();
  game.save();
  session.worldReplaced();
  ui.update();
  if (w.loadNote) ui.toast(w.loadNote, 9000);
}

game.input = new Input(canvas, camera, {
  getWorld: () => world,
  exec: game.exec,
  toast: (msg) => ui.toast(msg),
  togglePause: () => game.setSpeed(game.speed === 0 ? lastSpeed : 0),
  changed: () => ui.update(),
  paletteSlot: (i) => ui.paletteSlot(i),
  ping(x, y) {
    if (session.role === 'solo') ui.toast('핑은 같이 할 때 다른 사람에게 보여요');
    else session.ping(x, y);
  },
  pickPile(tile) {
    const [sx, sy] = camera.worldToScreen((tile % world.width) + 0.5, Math.floor(tile / world.width));
    ui.pickPile(tile, sx, sy);
  },
  pickPiles: (tiles, kept) => ui.pickPiles(tiles, kept),
});
const ui = new UI(game);
// exe: 새 버전 알림 (같이 하는 중이면 업데이트 전에 한 번 묻는다)
setupUpdateBanner({ sharing: () => session.role !== 'solo' && session.players > 1 });

function resize(): void {
  renderer.resize(camera);
}
window.addEventListener('resize', resize);
resize();

/** 소리를 낸 마지막 핑의 시각 (performance.now) */
let lastPing = 0;

/** 같이 하기: 내 커서를 보내고, 다른 사람 커서와 핑을 그린다 */
function drawPresence(now: number): void {
  if (session.role === 'solo') return;
  const input = game.input;
  session.sendPresence({
    at: input.mouse,
    tool: input.tool,
    dir: input.toolDir,
    setting: input.toolSetting,
    sel: input.selection,
    rem: input.removeArea,
    paste: input.paste ? { w: input.paste.w, h: input.paste.h } : null,
  });
  const others: OtherPlayer[] = [];
  for (const [p, o] of session.others) {
    others.push({ name: session.nameOf(p), color: session.colorOf(p), s: o.s, idle: now - o.t > 6000 });
  }
  const live = session.livePings(now);
  // 새로 찍힌 핑 (내 것·남의 것)에 소리
  for (const g of live) {
    if (g.t <= lastPing) continue;
    lastPing = g.t;
    sound.play('ping');
  }
  const pings: PingMark[] = live.map((g) => ({
    x: g.x,
    y: g.y,
    name: session.nameOf(g.p),
    color: session.colorOf(g.p),
    age: (now - g.t) / 1000,
    life: PING_SEC,
  }));
  renderer.drawPresence(camera, others, pings);
}

minimap.marks = () => [
  ...[...session.others].filter(([, o]) => o.s.at).map(([p, o]) => ({ x: o.s.at![0], y: o.s.at![1], color: session.colorOf(p), ping: false })),
  ...session.pings.map((g) => ({ x: g.x, y: g.y, color: session.colorOf(g.p), ping: true })),
];

let last = performance.now();
let uiTimer = 0;

function frame(now: number): void {
  const dt = Math.min(0.25, (now - last) / 1000);
  last = now;

  session.advance(dt);

  if (document.hidden) { requestAnimationFrame(frame); return; }

  game.input.update(dt);
  // 맵 글씨도 "글자 또렷하게" 배율을 따른다
  renderer.textZoom = uiZoom();
  renderer.draw(world, camera, game.input);
  if (ui.guideMark) renderer.drawGuideMark(camera, ui.guideMark, now / 1000);
  drawPresence(now);
  minimap.draw();

  uiTimer += dt;
  if (uiTimer >= 0.15) {
    uiTimer = 0;
    ui.update();
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// 화면 갱신과 독립적으로 저장한다. 멈춘 공장은 다시 직렬화하지 않고,
// 보이는 창은 유휴 시간에 저장하되 1초 안에는 실행한다.
setInterval(() => {
  if (!session.canSave || pendingSave !== null) return;
  if (saveState.ok && !saveState.dirty && savedWorld === world && savedTick === world.tickCount && savedTime === world.time) return;
  if (document.hidden || typeof requestIdleCallback !== 'function') {
    game.save();
  } else {
    pendingSave = requestIdleCallback(() => {
      pendingSave = null;
      game.save();
    }, { timeout: 1000 });
  }
}, AUTOSAVE_SEC * 1000);

// 탭이 가려지거나 창이 다른 창에 덮이면 브라우저가 화면 그리기(rAF)를 멈추거나 늦춘다.
// 같이 하는 중이면 시뮬레이션만 따로 돌린다: 호스트가 멈추면 손님들도 멈추고, 손님이 멈추면 받은 명령이 쌓이기만 한다.
// (가려진 탭의 타이머는 1초에 한 번쯤으로 느려지므로 그만큼 몰아서 돌린다)
setInterval(() => {
  const now = performance.now();
  if (session.role === 'solo' || now - last < 300) return;
  session.advance(Math.min(1, (now - last) / 1000));
  last = now;
}, 250);

session.connect();

window.addEventListener('beforeunload', () => game.save());
document.addEventListener('visibilitychange', () => {
  if (document.hidden) game.save();
  renderer.clearEffects();
  ui.silenceEffects();
  if (!document.hidden) ui.update();
});

if (!loaded) ui.showHelp();
else if (world.loadNote) ui.toast(world.loadNote, 9000);
ui.update();

// 개발 중 콘솔에서 상태를 살펴볼 수 있게
if (import.meta.env.DEV) {
  Object.assign(window, {
    game,
    camera,
    session,
    renderer,
    ui,
    /** 탭이 숨겨져 rAF가 멈춰도 콘솔에서 n초 진행시키고 다시 그린다 (혼자 할 때만) */
    step(seconds: number) {
      for (let i = 0; i < seconds / DT; i++) world.tick();
      renderer.draw(world, camera, game.input);
      minimap.draw();
      ui.update();
    },
  });
}
