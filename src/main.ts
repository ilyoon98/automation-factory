import './style.css';
import { Input } from './input/input';
import { PING_SEC, Session } from './net/session';
import { Camera } from './render/camera';
import { Renderer, type OtherPlayer, type PingMark } from './render/renderer';
import { addForests, addLakes, generateWorld } from './sim/mapgen';
import type { Command, PlaceResult, ResultOf } from './sim/commands';
import { DT, World } from './sim/world';
import { ITEM_IDS } from './data/items';
import type { RuleProfile } from './data/tech';
import { generateRegionalWorld } from './sim/regional-map';
import { Chat } from './ui/chat';
import { uiZoom } from './ui/crisp';
import { Minimap } from './ui/minimap';
import { sound } from './ui/sound';
import { UI, type GameApi } from './ui/ui';
import { setupUpdateBanner } from './ui/update';

/**
 * 개발용 지역 생산망 확장 세계 (주소 끝에 ?regional-dev). 확장 지도·지역 전력이 아직 없어 기존 지도에 regional-v1 규칙만 얹는다.
 * 모든 연구를 마치고 허브 재고를 채운 시험용 세계라 평소 저장과 섞이지 않게 따로 저장한다
 */
const REGIONAL_DEV = new URLSearchParams(location.search).has('regional-dev');
const SAVE_KEY = REGIONAL_DEV ? 'automation-game/save-regional-dev' : 'automation-game/save-v1';

/** 새 세계 (개발용 regional-dev면 확장 지도에 연구 완료·재고) */
function newWorld(rules: RuleProfile = REGIONAL_DEV ? 'regional-v1' : 'legacy-v042'): World {
  const seed = (Math.random() * 2 ** 31) | 0;
  const w = rules === 'regional-v1' ? generateRegionalWorld(seed) : generateWorld(seed);
  if (REGIONAL_DEV) {
    for (const t of w.techs) w.applyTech(t.id);
    for (const item of ITEM_IDS) w.stock.set(item, 500);
  }
  return w;
}
const AUTOSAVE_SEC = 30;

function loadWorld(): World | null {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const w = World.deserialize(JSON.parse(raw));
    // 호수가 생기기 전에 만든 맵이면 빈 땅에 호수를 더한다.
    // 저장 버전만 보면, 코드가 바뀌는 도중에 저장된 맵(버전은 새것, 호수는 없음)을 놓친다.
    if (!w.resItem.includes('water')) addLakes(w, w.seed);
    // 숲이 생기기 전 저장이면 자연 숲을 더한다
    if (!w.forestsLoaded) addForests(w, w.seed);
    return w;
  } catch (err) {
    console.warn('저장 파일을 불러오지 못했어요', err);
    return null;
  }
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
    game.input.selectedId = null;
    game.input.selectedVehicle = null;
    if (first) centerOnHub();
    ui.update();
  },
  restoreOwnWorld() {
    // 손님으로 있는 동안 내 저장은 건드리지 않았으므로 그대로 불러오면 된다
    world = loadWorld() ?? newWorld();
    game.input.selectedId = null;
    game.input.selectedVehicle = null;
    game.input.tool = null;
    game.input.paste = null;
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
      // 드래그 중 막힌 칸마다 소리를 내면 시끄러우니 처음 클릭에서만
      else if (cmd.initial && (p.swap || (p.reason && p.reason !== '이미 건물이 있음'))) sound.play('error');
      break;
    }
    case 'paste':
      if ((r as ResultOf<typeof cmd>).placed > 0) sound.play('place');
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
      sound.play(r ? 'research' : 'error');
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
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(world.serialize()));
      saveState.ok = true;
      saveState.dirty = false;
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
  newGame(rules?: RuleProfile) {
    if (session.role === 'guest') {
      ui.toast('새 게임은 호스트만 시작할 수 있어요');
      return;
    }
    backupWorld();
    world = newWorld(rules);
    game.input.selectedId = null;
    game.input.tool = null;
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
    backupWorld();
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
    // 지금 공장과 맞바꿔 둔다 (한 번 더 누르면 다시 돌아오게)
    backupWorld();
    replaceWorld(w);
    return null;
  },
  get hasBackup() {
    return hasBackup;
  },
};

/** 새 게임·파일 불러오기·되돌리기로 공장이 통째로 바뀌기 바로 전의 공장 (한 칸만) */
const BACKUP_KEY = REGIONAL_DEV ? 'automation-game/save-regional-dev-backup' : 'automation-game/save-backup';
let hasBackup = (() => {
  try {
    return localStorage.getItem(BACKUP_KEY) !== null;
  } catch {
    return false;
  }
})();

function backupWorld(): void {
  try {
    localStorage.setItem(BACKUP_KEY, JSON.stringify(world.serialize()));
    hasBackup = true;
  } catch (err) {
    // 아주 큰 공장이면 저장 공간이 모자랄 수 있다. 되돌리기만 못 할 뿐 바꾸기는 그대로 한다
    console.warn('되돌리기용 보관 실패', err);
  }
}

/** 다른 공장으로 바꾼다 (불러오기·되돌리기). 저장하고, 방장이면 손님들에게도 보낸다 */
function replaceWorld(w: World): void {
  if (!w.resItem.includes('water')) addLakes(w, w.seed);
  if (!w.forestsLoaded) addForests(w, w.seed);
  world = w;
  game.input.selectedId = null;
  game.input.selectedVehicle = null;
  game.input.tool = null;
  game.input.paste = null;
  centerOnHub();
  game.save();
  session.worldReplaced();
  ui.update();
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
let saveTimer = 0;

function frame(now: number): void {
  const dt = Math.min(0.25, (now - last) / 1000);
  last = now;

  session.advance(dt);

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
  saveTimer += dt;
  if (saveTimer >= AUTOSAVE_SEC) {
    saveTimer = 0;
    game.save();
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

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
});

if (!loaded) ui.showHelp();
ui.update();

// 개발 중 콘솔에서 상태를 살펴볼 수 있게
if (import.meta.env.DEV) {
  Object.assign(window, {
    game,
    camera,
    session,
    /** 탭이 숨겨져 rAF가 멈춰도 콘솔에서 n초 진행시키고 다시 그린다 (혼자 할 때만) */
    step(seconds: number) {
      for (let i = 0; i < seconds / DT; i++) world.tick();
      renderer.draw(world, camera, game.input);
      minimap.draw();
      ui.update();
    },
  });
}
