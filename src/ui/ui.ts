import {
  BUILDINGS,
  GENERATOR_POWER,
  HUB_BASE_POWER,
  HYDRO_POWER,
  SOLAR_POWER,
  STATION_CAPACITY,
  TRUCK,
  UNLOADER_INTERVAL,
  crossesRoad,
  isBeltType,
  isMinerType,
  isRecipeMachine,
  type BuildingType,
} from '../data/buildings';
import { ITEMS, ITEM_IDS, type ItemId, type ItemStack } from '../data/items';
import { RECIPES, recipesFor, type MachineKind } from '../data/recipes';
import { ENDLESS_REQUIRES, ENDLESS_TECHS, TECHS, TECH_BY_ID, TECH_CATEGORIES, endlessCost, type TechCategory } from '../data/tech';
import type { Input } from '../input/input';
import { lanRoomCheck, type Session } from '../net/session';
import { VERSION } from '../version';
import { STATUS_LABEL, type Building, type StationMode, type Status } from '../sim/building';
import type { Exec } from '../sim/commands';
import { DX, DY } from '../sim/dir';
import { VEHICLE_STATUS_LABEL, type Vehicle, type VehicleStatus } from '../sim/vehicle';
import {
  PATCH_LOW_MIN,
  describeEdit,
  patchAlert,
  storageBounds,
  type MachineStats,
  type PatchReport,
  type World,
} from '../sim/world';
import { GUIDE } from './guide';
import { Codex, depositName, type DepositId } from './codex';
import { depositIconUrl, itemIcon, itemLink } from './icons';
import { letScrollbarDrag } from './left-scroll';
import { Toolbar } from './toolbar';

export interface GameApi {
  getWorld(): World;
  /** 월드를 바꾸는 건 전부 명령으로 (같이 하기에서 모두에게 똑같이 적용되도록) */
  exec: Exec;
  /** 내 플레이어 번호 (되돌리기 기록을 내 것만 보려고) */
  readonly me: number;
  /** 같이 하기 상태 */
  readonly net: Session;
  input: Input;
  speed: number;
  setSpeed(s: number): void;
  save(): boolean;
  newGame(): void;
  /** 지금 공장을 파일로 내려받는다 (다른 PC로 옮기거나 백업) */
  exportSave(): void;
  /** 파일 내용으로 공장을 바꾼다. 안 되면 이유, 되면 null */
  importSave(text: string): string | null;
  /** 화면 가운데를 그 칸 좌표로 옮긴다 */
  focus(x: number, y: number): void;
  /** 지도 켜고 끄기 */
  readonly mapShown: boolean;
  toggleMap(): void;
}

type OreAlert = { r: PatchReport; level: 'low' | 'empty' };

const STATUS_COLOR: Record<Status, string> = {
  idle: '#8a7a66',
  working: '#3f8a3a',
  'low-power': '#b7791f',
  'no-input': '#8a7a66',
  'output-full': '#e8893a',
  'no-recipe': '#c0392b',
  depleted: '#9a3b3b',
  'no-fuel': '#c0392b',
  'no-water': '#c0392b',
  'no-filter': '#c0392b',
};

const VEHICLE_STATUS_COLOR: Record<VehicleStatus, string> = {
  moving: '#3f8a3a',
  loading: '#3f8a3a',
  unloading: '#3f8a3a',
  queued: '#8a7a66',
  waiting: '#8a7a66',
  'unload-full': '#e8893a',
  charging: '#3f8a3a',
  'no-battery': '#e8893a',
  'no-route': '#c0392b',
  'no-station': '#c0392b',
};

/** 트럭이 멈춰 있을 때 할 일 */
const VEHICLE_HINT: Partial<Record<VehicleStatus, string>> = {
  waiting: '싣는 정류장에 짐이 없어요. 컨베이어로 정류장에 넣어 주세요.',
  'no-battery': `배터리가 떨어져 천천히 가요. 정류장에 닿으면 충전해요. 한 번 충전으로 기본 ${(TRUCK.battery / TRUCK.drive) * TRUCK.speed}칸까지 가니(끝없는 연구 "트럭 성능"으로 늘어요), 길이 더 길면 중간에 싣기 정류장을 두고 트럭 두 대로 나눠 나르세요 (갈아싣기).`,
  'unload-full': '내리는 정류장이 꽉 찼어요. 정류장 앞(노란 화살표)으로 짐이 빠져나가는지 확인하세요.',
  'no-route': '두 정류장 사이 도로가 끊겼어요. 도로를 이어 주세요.',
  'no-station': '싣는 곳과 내리는 곳을 서로 다른 정류장으로 골라 주세요.',
};

const STATION_MODE_NAME: Record<StationMode, string> = { load: '싣기', unload: '내리기' };

/** 통계 창 재고 그래프: 게임 시간 10초마다 한 번, 60개 = 최근 10분 */
const STOCK_SAMPLE_SEC = 10;
const STOCK_SAMPLES = 60;

/** 상태(작동 중, 재료 부족 등)를 보여 주는 건물 */
const HAS_STATUS: BuildingType[] = [
  'miner',
  'miner-2',
  'pump',
  'smelter',
  'assembler',
  'crusher',
  'washer',
  'separator',
  'electric-furnace',
  'generator',
  'hydro',
  'unloader',
];

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

export class UI {
  private toolbar: Toolbar;
  private codex: Codex;
  private infoKey = '';
  private researchKey = '';
  /** 연구 창에서 보고 있는 탭 (처음 열 때 정한다) */
  private researchTab: TechCategory | null = null;
  private toastTimer = 0;
  private mouse = { x: 0, y: 0 };
  private oreKey = '';
  /** 광맥마다 이미 알린 단계 (같은 일로 두 번 알리지 않게) */
  private oreAlerted = new Map<number, 'low' | 'empty'>();
  private oreWorld: World | null = null;
  /** 경고를 누를 때마다 그 광맥의 다음 채굴기로 */
  private oreCycle = { id: 0, n: 0 };
  /** 접속자 목록을 마지막으로 그린 상태 */
  private playersKey = '';
  /** exe를 켜면 방 창을 먼저 띄운다 (같은 와이파이의 방 목록 · 방 만들기 · 혼자 하기). 서버에 붙으면 한 번 */
  private roomsOnStart: boolean;
  /** 통계 창을 마지막으로 그린 시각 (1초마다만 다시 그려서 숫자가 덜 흔들리고 클릭이 씹히지 않게) */
  private statsAt = 0;
  /** 허브 재고 기록 (통계 창 그래프용). 게임 시간 STOCK_SAMPLE_SEC초마다, 최근 STOCK_SAMPLES개. 화면 쪽에만 둔다 */
  private stockHist = new Map<ItemId, number[]>();
  private histWorld: World | null = null;
  private histNext = 0;

  constructor(private game: GameApi) {
    this.roomsOnStart = game.net.desktop;
    this.toolbar = new Toolbar(game.input);
    this.codex = new Codex(
      () => game.getWorld(),
      (x, y) => game.focus(x, y),
    );
    // 어디서든 아이템([data-item])을 누르면 도감에서 그 아이템을 연다
    document.addEventListener('click', (e) => {
      const el = (e.target as HTMLElement).closest<HTMLElement>('[data-item], [data-building], [data-deposit]');
      if (el?.dataset.item) this.codex.open({ item: el.dataset.item as ItemId });
      else if (el?.dataset.building) this.codex.open({ building: el.dataset.building as BuildingType });
      else if (el?.dataset.deposit) this.codex.open({ deposit: el.dataset.deposit as DepositId });
    });
    // 아래 툴바의 건물을 우클릭하면 도감에서 그 건물을 연다
    document.addEventListener('contextmenu', (e) => {
      const el = (e.target as HTMLElement).closest<HTMLElement>('[data-codex-building]');
      if (!el) return;
      e.preventDefault();
      this.codex.open({ building: el.dataset.codexBuilding as BuildingType });
    });

    document.querySelectorAll<HTMLButtonElement>('#topbar [data-speed]').forEach((btn) =>
      btn.addEventListener('click', () => game.setSpeed(Number(btn.dataset.speed))),
    );
    $('btn-research').addEventListener('click', () => this.toggleModal('research'));
    $('btn-stats').addEventListener('click', () => this.toggleModal('stats'));
    $('btn-map').addEventListener('click', () => game.toggleMap());
    $('btn-help').addEventListener('click', () => this.toggleModal('help'));
    $('btn-rates').addEventListener('click', () => this.toggleRates());
    $('btn-undo').addEventListener('click', () => game.input.undoRedo(false));
    $('btn-redo').addEventListener('click', () => game.input.undoRedo(true));
    $('btn-codex').addEventListener('click', () => this.codex.toggle());
    $('btn-save').addEventListener('click', () => this.toast(game.save() ? '저장했어요' : '저장 실패'));
    // 공장 파일: 도움말 창 아래 버튼
    $('btn-export').addEventListener('click', () => game.exportSave());
    $('btn-import').addEventListener('click', () => $<HTMLInputElement>('import-file').click());
    $('import-file').addEventListener('change', async (e) => {
      const input = e.target as HTMLInputElement;
      const file = input.files?.[0];
      input.value = '';
      if (!file) return;
      if (!confirm('지금 공장 대신 이 파일의 공장을 불러올까요? 지금 공장은 사라져요 (먼저 내보내 두세요).')) return;
      const err = game.importSave(await file.text());
      this.toast(err ?? '공장을 불러왔어요');
      if (!err) $('help').hidden = true;
    });
    $('btn-new').addEventListener('click', () => {
      if (confirm('지금 공장을 버리고 새 게임을 시작할까요?')) game.newGame();
    });

    window.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
      const k = e.key.toLowerCase();
      // 툴바 탭: Tab / Shift+Tab 으로 돌리기, Z X C V 로 바로 가기 (Ctrl+C 같은 조합은 무시)
      if (k === 'tab') {
        e.preventDefault();
        this.toolbar.cycle(e.shiftKey ? -1 : 1);
      } else if (!e.ctrlKey && !e.metaKey && !e.altKey) this.toolbar.selectByKey(k);
      if (k === 't') this.toggleModal('research');
      if (k === 'h') this.toggleModal('help');
      if (k === 'i') this.toggleRates();
      if (k === 'g') this.codex.toggle();
      if (k === 'p' && !e.ctrlKey && !e.metaKey) this.toggleModal('stats');
      if (k === 'm' && !e.ctrlKey && !e.metaKey) game.toggleMap();
      if (k === 'escape') {
        $('research').hidden = true;
        $('help').hidden = true;
        $('stats').hidden = true;
        this.codex.close();
      }
    });
    document.querySelectorAll('.modal').forEach((m) =>
      m.addEventListener('click', (e) => {
        if (e.target === m || (e.target as HTMLElement).dataset.act === 'close-modal') (m as HTMLElement).hidden = true;
      }),
    );

    $('game').addEventListener('pointermove', (e) => (this.mouse = { x: e.clientX, y: e.clientY }));
    // 왼쪽 판 사이 틈으로는 맵을 누르고, 스크롤바는 끌 수 있게
    letScrollbarDrag($('left'));

    // 목록이 다시 그려져도 놓치지 않게 click 대신 pointerdown
    $('ore-alerts').addEventListener('pointerdown', (e) => {
      const id = Number((e.target as HTMLElement).closest<HTMLElement>('[data-patch]')?.dataset.patch);
      const r = id ? game.getWorld().patchReports().find((p) => p.id === id) : undefined;
      if (!r || !r.miners.length) return;
      this.oreCycle = this.oreCycle.id === id ? { id, n: this.oreCycle.n + 1 } : { id, n: 0 };
      const m = r.miners[this.oreCycle.n % r.miners.length];
      game.focus(m.x + m.size / 2, m.y + m.size / 2);
      game.input.selectedId = m.id;
      game.input.selectedVehicle = null;
      this.update();
    });

    $('info').addEventListener('click', (e) => this.onInfoClick(e));
    $('info').addEventListener('change', (e) => {
      const sel = e.target as HTMLSelectElement;
      const v = this.selectedVehicle();
      if (v) {
        const id = Number(sel.value);
        if (sel.dataset.act === 'route-load') game.exec({ t: 'route', id: v.id, loadId: id, unloadId: v.unloadId });
        if (sel.dataset.act === 'route-unload') game.exec({ t: 'route', id: v.id, loadId: v.loadId, unloadId: id });
        this.update();
        return;
      }
      const b = this.selected();
      if (!b) return;
      const value = sel.value || null;
      const key = ({ recipe: 'recipe', 'station-mode': 'mode', filter: 'filter' } as const)[sel.dataset.act ?? ''];
      if (!key) return;
      game.exec({ t: 'config', id: b.id, key, value }, (ok) => {
        if (ok) game.input.rememberSetting(b.type, value);
        this.update();
      });
    });
    $('research').addEventListener('click', (e) => {
      const rtab = (e.target as HTMLElement).closest<HTMLElement>('[data-rtab]')?.dataset.rtab;
      if (rtab) {
        this.researchTab = rtab as TechCategory;
        this.update();
        return;
      }
      const id = (e.target as HTMLElement).closest<HTMLElement>('[data-tech]')?.dataset.tech;
      if (!id) return;
      game.exec({ t: 'research', id }, (ok) => {
        if (!ok) return;
        const t = TECH_BY_ID[id];
        this.toast(`연구 완료: ${t.icon} ${t.name}`);
        this.update();
      });
    });

    // 같이 하기: 위쪽 버튼을 누르면 방 창 (만들기·참가·주소 복사·접속자 목록)
    $('net').addEventListener('click', () => this.showPlayers($('players').hidden === true));
    $('players').addEventListener('click', (e) => {
      const t = (e.target as HTMLElement).closest<HTMLElement>('[data-act], [data-goto]');
      if (!t) return;
      const net = game.net;
      if (t.dataset.goto !== undefined) {
        const at = net.others.get(Number(t.dataset.goto))?.s.at;
        if (at) game.focus(at[0], at[1]);
        return;
      }
      const act = t.dataset.act;
      if (act === 'create') net.createRoom();
      if (act === 'join') net.joinRoom();
      if (act === 'join-lan' && t.dataset.room) net.joinLan(t.dataset.room);
      if (act === 'solo') $('players').hidden = true;
      if (act === 'leave' && (net.role !== 'host' || confirm('방을 닫을까요? 손님들은 각자 자기 공장으로 돌아가요.'))) net.leaveRoom();
      if (act === 'copy') {
        void copyText(net.inviteUrl).then((ok) =>
          this.toast(ok ? '주소를 복사했어요. 메신저에 붙여넣어 보내 주세요' : `복사가 막혔어요. 직접 알려 주세요: ${net.inviteUrl}`, 3500),
        );
      }
      if (act === 'select') (t as HTMLInputElement).select();
    });
    $('players').addEventListener('change', (e) => {
      const el = e.target as HTMLInputElement;
      if (el.dataset.act === 'rename') game.net.rename(el.value);
    });
    window.addEventListener('pointerdown', (e) => {
      const t = e.target as HTMLElement;
      // 도움말 같은 창을 닫느라 누른 건 빼고 (exe를 처음 켜면 도움말과 방 창이 같이 뜬다)
      if (!t.closest('#players') && !t.closest('#net') && !t.closest('.modal')) $('players').hidden = true;
    });
  }

  showHelp(): void {
    $('help').hidden = false;
  }

  /** 방 창 열기·닫기 (위쪽 같이 하기 버튼 아래에) */
  private showPlayers(show: boolean): void {
    const panel = $('players');
    panel.hidden = !show;
    panel.style.left = `${$('net').getBoundingClientRect().left}px`;
    this.playersKey = '';
    this.update();
  }

  /** 위쪽 같이 하기 버튼. 서버 없이 연 게임이면 숨긴다 */
  private updateNet(): void {
    const net = this.game.net;
    const el = $('net');
    el.hidden = offline(net);
    if (this.roomsOnStart && net.connected) {
      this.roomsOnStart = false;
      // 새로고침 전에 방장·손님이었으면 저절로 다시 들어가므로 묻지 않는다
      if (net.role === 'solo' && !net.rejoining) this.showPlayers(true);
    }
    const lan = net.lanRooms.filter((r) => lanRoomCheck(r) === 'ok');
    let text: string;
    let cls = '';
    if (net.joining) [text, cls] = ['🚪 들어가는 중…', 'wait'];
    else if (!net.connected)
      [text, cls] = [!net.desktop ? '연결 끊김 · 다시 붙는 중' : net.borrowed ? '⏳ 방장 기다리는 중' : '연결 중…', 'wait'];
    else if (net.role === 'host')
      [text, cls] = [net.players > 1 ? `🏠 내 방 · ${net.players}명` : net.desktop ? '🏠 방 열림 · 1명' : '🏠 방 열림 · 주소 복사', 'live'];
    else if (net.role === 'guest') [text, cls] = [net.synced ? `🚪 ${net.hostName}의 방 · ${net.players}명` : '맞추는 중…', net.synced ? 'live' : 'wait'];
    else if (net.waitingForHost || net.borrowed) [text, cls] = ['⏳ 방장 기다리는 중', 'wait'];
    else if (net.roomOpen) [text, cls] = [`🚪 ${net.hostName}의 방 · 참가`, 'wait'];
    else if (lan.length) [text, cls] = [lan.length > 1 ? `🚪 열린 방 ${lan.length}개 · 참가` : `🚪 ${lan[0].host || '누군가'}의 방 · 참가`, 'wait'];
    else text = '👥 같이 하기';
    el.textContent = text;
    el.title = '같이 하기: 방 만들기 · 참가 · 주소 복사 · 접속자 목록';
    el.className = cls;
    const save = net.canSave;
    $<HTMLButtonElement>('btn-save').disabled = !save;
    $<HTMLButtonElement>('btn-new').disabled = !save;
    $<HTMLButtonElement>('btn-import').disabled = !save;
    this.updatePlayers();
  }

  /**
   * 방 창. 상태마다: 방 만들기 / 열린 방에 참가 / 방장 기다리는 중 / 내 방(주소 복사·닫기) / 남의 방(나가기).
   * 바뀔 때만 다시 그린다 (이름 입력 중 날아가지 않게).
   */
  private updatePlayers(): void {
    const panel = $('players');
    const net = this.game.net;
    if (offline(net)) panel.hidden = true;
    if (panel.hidden) return;
    const seen = (p: number) => !!net.others.get(p)?.s.at;
    const state =
      net.role !== 'solo' ? net.role : net.joining ? 'joining' : net.waitingForHost || net.borrowed ? 'wait' : net.roomOpen ? 'open' : 'none';
    const key = JSON.stringify([state, net.roster, net.me, net.roster.map((r) => seen(r.p)), net.inviteUrl, net.synced, net.lanRooms]);
    if (key === this.playersKey) return;
    this.playersKey = key;

    const members = net.roster
      .map((r) => {
        const me = net.role !== 'solo' && r.p === net.me;
        const tags = [r.host && '방장', me && '나'].filter(Boolean).join(' · ');
        const go = net.role !== 'solo' && !me && seen(r.p) ? `<button data-goto="${r.p}" title="그 사람 커서로 화면 이동">보기</button>` : '';
        return `<div class="row"><span class="dot" style="background:${net.colorOf(r.p)}"></span>
          <span class="who">${escapeHtml(net.nameOf(r.p))} <span class="tag">${tags}</span></span>${go}</div>`;
      })
      .join('');
    const name = `<label class="hint">내 이름</label>
      <input data-act="rename" maxlength="16" placeholder="${net.role === 'host' ? '방장' : net.role === 'guest' ? `P${net.me}` : '이름'}" value="${escapeHtml(net.myName)}" />`;
    // 주소가 여러 개면(가상 어댑터 등) 첫 주소가 안 될 때 써 볼 수 있게 나머지도 알려 준다
    const others = net.lanUrls.slice(1).map((u) => u.replace('http://', ''));
    const invite = `<div class="invite"><input readonly data-act="select" value="${escapeHtml(net.inviteUrl)}" />
        <button class="primary" data-act="copy">주소 복사</button></div>
      ${
        net.reachable
          ? net.desktop
            ? `<div class="hint">exe 없이 브라우저로 들어올 사람에게는 이 주소를 보내 주세요 (같은 와이파이·공유기에서).
              안 되면 이 PC의 Windows 방화벽에서 "자동화 공장"을 허용해 주세요.${others.length ? ` 다른 주소: ${others.join(', ')}` : ''}</div>`
            : `<div class="hint">같은 와이파이·공유기에 연결된 PC에서 이 주소를 열면 바로 들어와요.
              안 열리면 이 PC의 Windows 방화벽에서 Node.js를 허용해 주세요.${others.length ? ` 다른 주소: ${others.join(', ')}` : ''}</div>`
          : '<div class="warn">이 PC가 와이파이·랜선에 연결돼 있지 않아서 다른 PC가 들어올 주소가 없어요</div>'
      }`;
    // exe: 같은 와이파이에서 찾은 방 (다른 PC에서 방을 만들면 1~2초 안에 저절로 뜬다)
    // 버전이 다른 방은 흐리게 하고 참가를 막는다 (락스텝이라 같은 버전·같은 빌드끼리만 같이 할 수 있다)
    const lanList = net.lanRooms
      .map((r) => {
        const check = lanRoomCheck(r);
        const why =
          check === 'newer'
            ? ['새 버전이라 업데이트 필요', '방장이 새 버전이에요. 내 게임을 업데이트하면 들어갈 수 있어요']
            : check === 'older'
              ? ['옛 버전', '방장이 옛 버전이에요. 방장에게 업데이트를 부탁하세요']
              : ['파일이 달라요', '버전은 같지만 따로 빌드한 파일이에요. 같은 파일로 켜 주세요'];
        return `<div class="row${check === 'ok' ? '' : ' dim'}" ${check === 'ok' ? '' : `title="${why[1]}"`}>
          <span class="who">🚪 ${escapeHtml(r.host || '이름 없음')}의 방
            <span class="tag">${r.players}명 · ${escapeHtml(r.version || '옛 버전')}</span></span>${
              check === 'ok'
                ? `<button class="primary" data-act="join-lan" data-room="${escapeHtml(r.id)}">참가</button>`
                : `<button disabled title="${why[1]}">${why[0]}</button>`
            }</div>`;
      })
      .join('');
    const lan = `<label class="hint">같은 와이파이에서 열린 방</label>
      ${lanList || '<p class="hint">아직 없어요. 다른 PC에서 방을 만들면 여기에 저절로 떠요.</p>'}`;
    let html: string;
    if (state === 'host') {
      html = net.desktop
        ? `<h3>🏠 내 방 · ${net.players}명</h3>
          <p class="hint">같은 와이파이에서 exe를 켠 사람들의 방 목록에 이 방이 저절로 떠요.</p>${members}${name}${invite}
          <button class="wide" data-act="leave">방 닫기</button>`
        : `<h3>🏠 내 방 · ${net.players}명</h3>${invite}${members}${name}
        <button class="wide" data-act="leave">방 닫기</button>`;
    } else if (state === 'joining') {
      html = `<h3>🚪 방에 들어가는 중…</h3>
        <p class="hint">방장 PC에 붙는 중이에요. 방이 잠깐 닫혀 있으면 다시 열릴 때 저절로 들어가요.</p>
        <button class="wide" data-act="leave">그만두고 내 공장으로</button>`;
    } else if (state === 'guest') {
      html = `<h3>🚪 ${escapeHtml(net.hostName)}의 방 · ${net.players}명</h3>${members}${name}${net.reachable ? invite : ''}
        <button class="wide" data-act="leave">나가기 (내 공장으로)</button>`;
    } else if (state === 'wait') {
      html = `<h3>⏳ 방장을 기다리는 중</h3>
        <p class="hint">방장이 새로고침했거나 연결이 잠깐 끊겼어요. 방이 다시 열리면 저절로 들어가요.</p>
        <button class="wide" data-act="leave">기다리지 않고 내 공장으로</button>`;
    } else if (state === 'open') {
      // 방장 버전이 다르면 미리 알려 준다 (빌드까지 다른 건 참가를 눌러야 서버가 알려 준다)
      const other = net.roomVersion !== VERSION;
      html = `<h3>🚪 ${escapeHtml(net.hostName)}의 방 · ${net.roster.length}명</h3>${members}${name}
        ${
          other
            ? `<div class="warn">방장 버전 ${escapeHtml(net.roomVersion || '옛 버전')}, 내 버전 ${VERSION}. 버전이 같아야 같이 할 수 있어요</div>`
            : '<button class="primary wide" data-act="join">참가하기</button>'
        }
        <p class="hint">참가하면 방장의 공장에서 같이 지어요. 내 공장은 저장된 채로 남아 있다가, 나오면 돌아와요.</p>`;
    } else if (net.desktop) {
      html = `<h3>👥 같이 하기</h3>${lan}
        <p class="hint">참가하면 방장의 공장에서 같이 지어요. 내 공장은 저장된 채로 남아 있다가, 나오면 돌아와요.
          방을 만들면 지금 내 공장에 다른 사람들이 들어와요. 허브 재고와 연구는 모두 함께 써요.</p>
        ${name}<button class="primary wide" data-act="create">방 만들기</button>
        <button class="wide" data-act="solo">혼자 하기</button>
        ${net.reachable ? '' : invite}`;
    } else {
      html = `<h3>👥 같이 하기</h3>
        <p class="hint">방을 만들면 지금 내 공장에 다른 사람들이 들어와 같이 지어요. 허브 재고와 연구는 모두 함께 써요.</p>
        ${name}<button class="primary wide" data-act="create">방 만들기</button>
        ${net.reachable ? '' : invite}`;
    }
    panel.innerHTML = `${html}<div class="hint">F 또는 Alt + 클릭: 핑 찍기 · 게임 버전 ${VERSION}</div>`;
  }

  toast(msg: string, ms = 1800): void {
    const el = $('toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => el.classList.remove('show'), ms);
  }

  private toggleRates(): void {
    const input = this.game.input;
    input.showRates = !input.showRates;
    $('btn-rates').classList.toggle('active', input.showRates);
    this.toast(input.showRates ? '생산량 표시 켬 (기계 위 숫자 = 분당 생산, 색 = 가동률)' : '생산량 표시 끔');
  }

  private toggleModal(id: 'research' | 'help' | 'stats'): void {
    const el = $(id);
    el.hidden = !el.hidden;
    if (id === 'research') this.researchKey = '';
    if (id === 'stats') this.statsAt = 0;
    this.update();
  }

  private selected(): Building | null {
    const id = this.game.input.selectedId;
    return id ? (this.game.getWorld().buildings.get(id) ?? null) : null;
  }

  private selectedVehicle(): Vehicle | null {
    const id = this.game.input.selectedVehicle;
    return id ? (this.game.getWorld().vehicles.get(id) ?? null) : null;
  }

  /** 지금 툴바 탭의 i번째(0부터) 건물 */
  paletteSlot(i: number): BuildingType | null {
    return this.toolbar.slot(i);
  }

  // ───────────────────────── 주기 갱신 ─────────────────────────

  update(): void {
    const w = this.game.getWorld();

    // 시계, 속도
    const t = Math.floor(w.time);
    $('clock').textContent = `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
    document.querySelectorAll<HTMLButtonElement>('#topbar [data-speed]').forEach((btn) => {
      btn.classList.toggle('active', Number(btn.dataset.speed) === this.game.speed);
    });
    $('btn-map').classList.toggle('active', this.game.mapShown);
    this.updateNet();
    // 되돌리기 버튼: 누르면 무엇이 바뀌는지 설명에 적어 둔다
    for (const [id, redo, name] of [['btn-undo', false, '되돌리기 (Ctrl+Z)'], ['btn-redo', true, '다시 하기 (Ctrl+Y)']] as const) {
      const next = w.nextEdit(redo, this.game.me);
      const btn = $<HTMLButtonElement>(id);
      btn.disabled = !next;
      btn.title = next ? `${name}: ${describeEdit(next)}` : name;
    }

    this.toolbar.update(w);

    this.updateHolding();
    this.updatePower(w);
    this.updateStock(w);
    this.updateOreAlerts(w);
    this.updateGuide(w);
    this.updateInfo(w);
    if (!$('research').hidden) this.updateResearch(w);
    this.sampleStock(w);
    if (!$('stats').hidden) this.updateStatsPanel(w);
    this.updateTooltip(w);
    this.codex.refresh();
  }

  /** 도구를 들고 있을 때 툴바 위 안내 */
  private updateHolding(): void {
    const el = $('holding');
    const input = this.game.input;
    if (input.paste) {
      el.hidden = false;
      el.innerHTML = `<b>복사한 건물 ${input.paste.entries.length}개</b> · 클릭: 붙여넣기 · <kbd>Esc</kbd> 취소`;
      return;
    }
    if (!input.tool) {
      el.hidden = true;
      return;
    }
    const s = input.toolSetting;
    const label = !s
      ? ''
      : input.tool === 'station'
        ? STATION_MODE_NAME[s as StationMode]
        : input.tool === 'sorter' || input.tool === 'unloader'
          ? ITEMS[s as ItemId].name
          : (RECIPES[s]?.name ?? '');
    el.hidden = false;
    el.innerHTML = `<b>${BUILDINGS[input.tool].name}</b>${label ? ` (${label})` : ''} 들고 있음 ·
      클릭: 짓기 · 건물 클릭: 설정 열기 · <kbd>R</kbd> 회전 (건물 위면 그 건물) · <kbd>Esc</kbd> 내려놓기`;
  }

  private updatePower(w: World): void {
    const p = w.power;
    const pct = Math.round(p.satisfaction * 100);
    const color = p.satisfaction >= 1 ? '#3f8a3a' : p.satisfaction >= 0.6 ? '#b7791f' : '#c0392b';
    const usage = p.capacity ? Math.min(1, p.demand / p.capacity) : 0;
    // 어디서 오는 전력인지: 허브 · 태양광 · 수력 · 석탄 (돌 수 있는 최대치)
    const src = { solar: 0, hydro: 0, coal: 0 };
    for (const b of w.buildings.values()) {
      if (b.type === 'solar') src.solar += SOLAR_POWER;
      else if (b.type === 'hydro' && (b.fuel > 0 || b.energy > 0)) src.hydro += HYDRO_POWER;
      else if (b.type === 'generator' && (b.fuel > 0 || b.energy > 0)) src.coal += GENERATOR_POWER;
    }
    const parts = [`허브 ${HUB_BASE_POWER}`];
    if (src.solar) parts.push(`태양광 ${src.solar}`);
    if (src.hydro) parts.push(`수력 ${src.hydro}`);
    if (src.coal) parts.push(`석탄 ${src.coal}`);
    $('power').innerHTML = `
      <h3>전력</h3>
      <div class="bar"><div style="width:${usage * 100}%;background:${color}"></div></div>
      <div class="row"><span>사용 / 공급</span><b>${Math.round(p.demand)} / ${Math.round(p.capacity)} kW</b></div>
      <div class="row"><span>기계 속도</span><b style="color:${color}">${pct}%</b></div>
      ${parts.length > 1 ? `<p class="muted power-src">${parts.join(' · ')} kW</p>` : ''}
      ${p.charge > 0 ? `<p class="muted power-src">사용 중 트럭 충전 ${Math.round(p.charge)} kW</p>` : ''}`;
  }

  private updateStock(w: World): void {
    const rows = ITEM_IDS.filter((i) => w.stockOf(i) > 0 || w.incomePerMinute(i) > 0)
      .map((i) => {
        const rate = w.incomePerMinute(i);
        return `<div class="row stock-row" data-item="${i}" title="클릭: 도감">${itemIcon(i)}<span>${ITEMS[i].name}</span><b>${w.stockOf(i)}</b><em>${rate ? `+${rate}/분` : ''}</em></div>`;
      })
      .join('');
    $('stock').innerHTML = `<h3>허브 재고</h3>${rows || '<p class="muted">비어 있음</p>'}`;
  }

  /** 곧 바닥나거나 바닥난 광맥: 처음 한 번은 알림, 해결될 때까지 왼쪽 위 목록 */
  private updateOreAlerts(w: World): void {
    const reports = w.patchReports();
    const alerts = reports
      .map((r) => ({ r, level: patchAlert(r) }))
      .filter((a): a is OreAlert => a.level !== null)
      .sort((a, b) => a.r.etaMin - b.r.etaMin);

    // 새 게임·불러오기 직후에 이미 있던 경고는 알림 없이 목록에만
    const fresh = this.oreWorld !== w;
    this.oreWorld = w;
    if (fresh) this.oreAlerted.clear();
    for (const { r, level } of alerts) {
      const before = this.oreAlerted.get(r.id);
      if (before === level || before === 'empty') continue;
      this.oreAlerted.set(r.id, level);
      if (fresh) continue;
      const name = depositName(r.item as DepositId);
      this.toast(
        level === 'empty'
          ? `⚠ ${name}이 바닥났어요 · 채굴기 ${r.miners.length}대가 멈췄어요`
          : `⚠ ${name}이 곧 바닥나요 (약 ${fmtMin(r.etaMin)} 남음)`,
        5000,
      );
    }
    // 채굴기를 다 치운 광맥은 잊는다
    const live = new Set(reports.map((r) => r.id));
    for (const id of this.oreAlerted.keys()) if (!live.has(id)) this.oreAlerted.delete(id);

    const pct = (r: PatchReport) => Math.round((r.remaining / r.initial) * 100);
    const key = alerts.map(({ r, level }) => `${r.id}:${level}:${fmtMin(r.etaMin)}:${pct(r)}:${r.miners.length}`).join('|');
    if (key === this.oreKey) return;
    this.oreKey = key;
    const el = $('ore-alerts');
    el.hidden = !alerts.length;
    const rows = alerts
      .map(({ r, level }) => {
        const state = level === 'empty' ? `<b class="bad">바닥남</b>` : `<b class="warn">약 ${fmtMin(r.etaMin)}</b>`;
        const sub = level === 'empty' ? `채굴기 ${r.miners.length}대 멈춤` : `${pct(r)}% 남음 · 채굴기 ${r.miners.length}대`;
        return `<div class="ore-alert" data-patch="${r.id}" title="클릭: 이 광맥의 채굴기로 이동">
          <img class="icon" src="${depositIconUrl(r.item)}" alt=""><span>${depositName(r.item as DepositId)}<small>${sub}</small></span>${state}</div>`;
      })
      .join('');
    el.innerHTML = `<h3>⚠ 광맥 경고 <small>${alerts.length}</small></h3>${rows}
      <p class="muted">누르면 그 채굴기로 가요. 철거하면 재료를 100% 돌려받아요.</p>`;
  }

  private updateGuide(w: World): void {
    // 이룬 목표는 저장에 남긴다 (생산이 잠깐 멈춰도, 불러온 뒤에도 앞 목표로 돌아가지 않게)
    for (const s of GUIDE) if (!w.guideDone.has(s.title) && s.done(w)) w.guideDone.add(s.title);
    const todo = GUIDE.filter((s) => !w.guideDone.has(s.title));
    const head = `<h3>목표 <small>${GUIDE.length - todo.length}/${GUIDE.length}</small></h3>`;
    if (todo.length === 0) {
      $('guide').innerHTML = `${head}<p class="muted">모든 목표 달성! 자유롭게 공장을 키워 보세요.</p>`;
      return;
    }
    const [now, ...next] = todo;
    const later = next
      .slice(0, 2)
      .map((s) => `<li>${s.title}</li>`)
      .join('');
    $('guide').innerHTML = `${head}
      <div class="now"><b>${now.title}</b><p>${now.hint}</p></div>
      ${later ? `<div class="later">다음</div><ul>${later}</ul>` : ''}`;
  }

  // ───────────────────────── 정보창 ─────────────────────────

  private updateInfo(w: World): void {
    const el = $('info');
    const v = this.selectedVehicle();
    if (v) {
      this.updateVehicleInfo(w, v);
      return;
    }
    const b = this.selected();
    if (!b) {
      el.hidden = true;
      this.infoKey = '';
      return;
    }
    el.hidden = false;
    // 하역기는 붙은 창고·허브에 든 아이템 종류가 바뀌면 고르는 목록도 다시 만든다
    const src = b.type === 'unloader' ? unloaderSource(w, b) : null;
    let srcKey = src ? `${src.id}:${sourceItems(w, src).join(',')}` : '';
    // 분류기는 줄 끝 기계나 흐르는 아이템이 바뀌면 고르는 목록을 다시 만든다
    if (b.type === 'sorter') {
      const up = w.upstream(b);
      srcKey = `${up.items.join(',')}:${up.sources.map((s) => s.id).join(',')}`;
    }
    // 정류장은 트럭 목록과 "트럭 만들기" 버튼 상태가 바뀌면 다시 만든다
    if (b.type === 'station') {
      srcKey = `${b.stationMode}:${w.trucksOf(b).map((t) => `${t.id}${t.loadId}`).join(',')}:${w.canBuildTruck(b).reason ?? ''}`;
    }
    const key = `${b.id}|${b.recipe}|${b.filter}|${w.unlockedRecipes.size}|${srcKey}`;
    if (key !== this.infoKey) {
      this.infoKey = key;
      el.innerHTML = this.infoStatic(w, b);
    }
    el.querySelector('.dyn')!.innerHTML = this.infoDynamic(w, b);
    // 정류장의 트럭 목록: 버튼은 그대로 두고 상태 글자만 바꾼다
    el.querySelectorAll<HTMLElement>('[data-truck-status]').forEach((s) => {
      const t = w.vehicles.get(Number(s.dataset.truckStatus));
      if (t) s.textContent = `· ${VEHICLE_STATUS_LABEL[t.status]} (${t.load}/${TRUCK.capacity})`;
    });
    // 목록을 다시 만들지 않고 개수만 바꾼다 (고르는 도중에 목록이 흔들리지 않게)
    if (src) {
      el.querySelectorAll<HTMLOptionElement>('select[data-act="filter"] option[data-name]').forEach((o) => {
        o.textContent = `${o.dataset.name} (${sourceCount(w, src, o.value as ItemId)}개)`;
      });
    }
  }

  private infoStatic(w: World, b: Building): string {
    const def = b.def;
    const title = b.type === 'station' ? `${def.name} ${b.stationNo}` : def.name;
    let html = `<header><span class="swatch" style="background:${def.color}"></span><h3>${title}</h3>
      <button class="x" data-act="close">×</button></header>
      <p class="muted">${def.description}</p>`;
    if (b.type === 'station') {
      const opt = (m: StationMode, text: string) =>
        `<option value="${m}" ${b.stationMode === m ? 'selected' : ''}>${STATION_MODE_NAME[m]} · ${text}</option>`;
      html += `<label class="recipe">종류 <select data-act="station-mode">
        ${opt('load', '컨베이어로 받아 트럭에 싣기')}${opt('unload', '트럭에서 내려 앞으로 내보내기')}</select></label>`;
      const trucks = w.trucksOf(b);
      const check = w.canBuildTruck(b);
      const cost = TRUCK.cost.map((c) => `${itemIcon(c.item)}${c.count}`).join(' ');
      const rows = trucks
        .map(
          (t) =>
            `<button class="truck-row" data-truck="${t.id}">🚚 트럭 ${t.id} · ${t.loadId === b.id ? '여기서 싣기' : '여기에 내리기'}
              <span class="muted" data-truck-status="${t.id}"></span></button>`,
        )
        .join('');
      html += `<div class="trucks"><div class="row"><span>이 정류장을 오가는 트럭</span><b>${trucks.length}대</b></div>${rows}
        <button data-act="build-truck" ${check.ok ? '' : 'disabled'}>🚚 트럭 만들기 <span class="cost">${cost}</span></button>
        ${check.ok ? '' : `<p class="muted">${check.reason}</p>`}</div>`;
    }
    if (isRecipeMachine(b.type)) {
      const options = recipesFor(b.type as MachineKind)
        .filter((r) => w.unlockedRecipes.has(r.id))
        .map((r) => `<option value="${r.id}" ${b.recipe === r.id ? 'selected' : ''}>${r.name}</option>`)
        .join('');
      const none = b.type === 'assembler' ? '선택 안 함' : '자동 (들어온 재료로)';
      html += `<label class="recipe">레시피 <select data-act="recipe"><option value="">${none}</option>${options}</select></label>`;
      const r = w.recipeOf(b);
      if (r) {
        const fmt = (s: ItemStack) => `${itemLink(s.item)} ×${s.count}`;
        // 분리기: 10개마다 정해진 개수가 섞여 나온다
        const outs = r.pattern
          ? `${r.outputs.map((o) => `${itemIcon(o.item)}${ITEMS[o.item].name} ${Math.round(o.count * 10)}`).join(' · ')}
             <span class="muted">(${r.pattern.length}개마다, 한 줄로 섞여 나옴)</span>`
          : r.outputs.map(fmt).join(' + ');
        html += `<div class="recipe-card">
          <div>${r.inputs.map(fmt).join(' + ')}</div>
          <div class="arrow">→ ${r.time}초 →</div>
          <div>${outs}</div>
        </div>`;
      }
    }
    if (b.type === 'sorter') {
      // 이 줄로 들어올 수 있는 아이템만. 줄 끝에서 기계를 못 찾으면 전체 목록
      const up = w.upstream(b);
      const list = up.items.length ? [...up.items] : [...ITEM_IDS];
      if (b.filter && !list.includes(b.filter)) list.unshift(b.filter);
      const options = list
        .map((i) => `<option value="${i}" ${b.filter === i ? 'selected' : ''}>${ITEMS[i].name}</option>`)
        .join('');
      html += `<label class="recipe">앞으로 보낼 아이템 <select data-act="filter"><option value="">선택 안 함 (전부 옆으로)</option>${options}</select></label>`;
      const names = [...new Set(up.sources.map((s) => s.def.name))];
      html += names.length
        ? `<p class="muted">이 줄로 들어오는 곳: ${names.join(', ')}</p>`
        : `<p class="muted">들어오는 기계를 찾지 못해서 전체 아이템을 보여 줘요. 줄을 이으면 그 줄에 오는 것만 나와요.</p>`;
    }
    if (b.type === 'unloader') {
      // 붙은 창고·허브에 실제로 든 아이템만 (지금 고른 건 비었어도 남겨 둔다)
      const src = unloaderSource(w, b);
      if (!src) {
        html += `<p class="bad">흰 화살표(뒤)가 창고나 허브에 닿아야 꺼낼 수 있어요.</p>`;
      } else {
        const items = sourceItems(w, src);
        if (b.filter && !items.includes(b.filter)) items.unshift(b.filter);
        const options = items
          .map(
            (i) =>
              `<option value="${i}" data-name="${ITEMS[i].name}" ${b.filter === i ? 'selected' : ''}>${ITEMS[i].name} (${sourceCount(w, src, i)}개)</option>`,
          )
          .join('');
        html += `<label class="recipe">꺼낼 아이템 <select data-act="filter"><option value="">전부 (번갈아)</option>${options}</select></label>`;
        if (!items.length) html += `<p class="muted">${src.def.name}가 비어 있어요. 무언가 들어오면 여기서 고를 수 있어요.</p>`;
      }
    }
    html += `<div class="dyn"></div><div class="actions">`;
    if (!['hub', 'generator', 'underground', 'storage', 'road', 'solar', 'hydro'].includes(b.type)) {
      html += `<button data-act="rotate">회전 (R)</button>`;
    }
    if (b.type !== 'hub') html += `<button data-act="remove" class="danger">철거 (Del)</button>`;
    if (b.type === 'storage' || b.type === 'hub') {
      // 창고·허브는 스스로 내보내지 않으니 꺼낼 방법을 바로 쥐여 준다
      html += `<button data-act="take-out" title="옆에 놓으면 흰 화살표가 이쪽을 향하게 저절로 돌아가요">📤 하역기 들기</button>`;
    }
    html += `<button data-act="codex" title="이 건물의 설명·짓는 법·레시피">📖 도감</button>`;
    html += `</div>`;
    return html;
  }

  private infoDynamic(w: World, b: Building): string {
    const lines: string[] = [];
    const st = w.machineStats(b);
    if (st) lines.push(productionBlock(st));
    if (HAS_STATUS.includes(b.type)) {
      lines.push(`<div class="row"><span>상태</span><b style="color:${STATUS_COLOR[b.status]}">${STATUS_LABEL[b.status]}</b></div>`);
    }
    if (b.crafting) {
      const time = w.craftTime(b);
      lines.push(`<div class="bar"><div style="width:${Math.min(100, (b.progress / time) * 100)}%"></div></div>`);
    }
    const buf = (m: Map<ItemId, number>) =>
      [...m].map(([i, n]) => `${itemIcon(i)}${n}`).join(' ') || '<span class="muted">없음</span>';
    switch (b.type) {
      case 'miner':
      case 'miner-2':
      case 'pump': {
        // 채굴기는 밑 칸만이 아니라 그 광맥 전체에서 캐므로 광맥 전체 기준으로 보여 준다
        const left = w.mineRemaining(b);
        const st = w.machineStats(b);
        const icon = st ? itemIcon(st.maxOut[0].item) : '';
        if (left === Infinity) {
          lines.push(`<div class="row"><span>광맥 전체 남은 양</span><b>${icon} 무한</b></div>`);
        } else {
          const rs = w.patchReports().filter((r) => b.minePatches.includes(r.id));
          const initial = rs.reduce((s, r) => s + r.initial, 0);
          const perMin = rs.reduce((s, r) => s + r.perMin, 0);
          const miners = new Set(rs.flatMap((r) => r.miners)).size;
          // 여러 광맥에 걸쳐 있으면 마지막 광맥이 바닥날 때 멈춘다
          const eta = rs.length ? Math.max(...rs.map((r) => r.etaMin)) : 0;
          const low = eta <= PATCH_LOW_MIN;
          const pct = initial > 0 ? Math.round((left / initial) * 100) : 0;
          lines.push(`<div class="row"><span>광맥 전체 남은 양</span><b>${icon} ${left.toLocaleString()}개 <span class="muted">(${pct}%)</span></b></div>`);
          lines.push(`<div class="bar"><div style="width:${pct}%;background:${low ? '#b7791f' : '#3f8a3a'}"></div></div>`);
          if (left <= 0) {
            lines.push(`<p class="bad">광맥이 바닥났어요. 철거하면 재료를 100% 돌려받으니 다른 광맥으로 옮기세요.</p>`);
          } else {
            lines.push(`<div class="row"><span>이 광맥 채굴기</span><b>${miners}대 · 분당 ${fmtNum(perMin)}</b></div>`);
            const etaText = eta === Infinity ? '<span class="muted">안 캐는 중</span>' : `약 ${fmtMin(eta)}`;
            lines.push(`<div class="row"><span>바닥까지</span><b${low ? ' style="color:#b7791f"' : ''}>${etaText}</b></div>`);
          }
        }
        lines.push(`<div class="row"><span>출력 대기</span><b>${buf(b.outBuf)}</b></div>`);
        break;
      }
      case 'smelter':
      case 'assembler':
      case 'crusher':
      case 'washer':
      case 'separator':
      case 'electric-furnace':
        lines.push(`<div class="row"><span>입력</span><b>${buf(b.inBuf)}</b></div>`);
        lines.push(`<div class="row"><span>출력 대기</span><b>${buf(b.outBuf)}</b></div>`);
        lines.push(`<div class="row"><span>전력</span><b>${b.def.power} kW</b></div>`);
        break;
      case 'generator':
        lines.push(`<div class="row"><span>연료</span><b>${itemIcon('coal')} ${b.fuel} / 5</b></div>`);
        lines.push(`<div class="row"><span>출력</span><b>${Math.round(b.load)} / ${GENERATOR_POWER} kW</b></div>`);
        lines.push(`<p class="muted">허브·태양광·수력으로 모자란 만큼만 석탄을 태워요.</p>`);
        break;
      case 'hydro':
        lines.push(`<div class="row"><span>물</span><b>${itemIcon('water')} ${b.fuel} / 10</b></div>`);
        lines.push(`<div class="row"><span>출력</span><b>${Math.round(b.load)} / ${HYDRO_POWER} kW</b></div>`);
        lines.push(`<p class="muted">허브·태양광으로 모자란 만큼만 물을 써요 (석탄 발전기보다 먼저). 최대로 돌면 초당 물 2개 = 양수기 1대.</p>`);
        break;
      case 'solar':
        lines.push(`<div class="row"><span>출력</span><b>${SOLAR_POWER} kW (늘)</b></div>`);
        lines.push(`<p class="muted">아무것도 넣지 않아도 돼요. 전력이 모자라면 더 깔아 주세요.</p>`);
        break;
      case 'belt':
      case 'fast-belt':
        lines.push(`<div class="row"><span>운반 중</span><b>${countItems(b)}개</b></div>`);
        lines.push(`<p class="muted">한 칸에 ${b.def.stack ?? 1}개까지 쌓아요.</p>`);
        break;
      case 'underground': {
        const p = w.partnerOf(b);
        const entrance = b.ugMode === 'in' ? b : p;
        lines.push(`<div class="row"><span>종류</span><b>${b.ugMode === 'in' ? '입구' : '출구'}</b></div>`);
        lines.push(
          p
            ? `<div class="row"><span>연결</span><b>${Math.abs(p.x - b.x) + Math.abs(p.y - b.y) - 1}칸 건너</b></div>`
            : `<p class="muted">짝이 없어요. 같은 방향으로 최대 4칸 건너 하나 더 놓으면 연결돼요.</p>`,
        );
        if (entrance) lines.push(`<div class="row"><span>땅속 운반 중</span><b>${countItems(entrance)}개</b></div>`);
        lines.push(`<p class="muted">방향을 바꾸려면 철거하고 다시 놓으세요.</p>`);
        break;
      }
      case 'splitter':
      case 'overflow':
      case 'sorter':
      case 'merger':
        lines.push(
          `<div class="row"><span>들고 있음</span><b>${b.held ? `${itemIcon(b.held)}${b.heldN > 1 ? ` ×${b.heldN}` : ''}` : '<span class="muted">없음</span>'}</b></div>`,
        );
        break;
      case 'unloader': {
        const src = w.buildingAt(b.x - DX[b.dir], b.y - DY[b.dir]);
        const ok = src?.type === 'hub' || src?.type === 'storage';
        const front = w.buildingAt(b.x + DX[b.dir], b.y + DY[b.dir]);
        const per = front?.def.stack ?? 1;
        lines.push(`<div class="row"><span>꺼내는 곳</span><b>${ok ? src!.def.name : '<span class="muted">없음</span>'}</b></div>`);
        lines.push(`<div class="row"><span>꺼내는 것</span><b>${b.filter ? itemIcon(b.filter) + ITEMS[b.filter].name : '전부 (종류별로 번갈아)'}</b></div>`);
        lines.push(`<div class="row"><span>속도</span><b>분당 ${fmtNum((60 / UNLOADER_INTERVAL) * per)}</b></div>`);
        lines.push(`<p class="muted">${UNLOADER_INTERVAL}초마다 앞 컨베이어 한 칸만큼(${per}개)씩 꺼내요.</p>`);
        if (!ok) lines.push(`<p class="muted">흰 화살표(뒤) 쪽을 허브나 창고에 붙여 주세요.</p>`);
        break;
      }
      case 'storage': {
        // 합쳐진 창고는 묶음 전체를 한 창고로 보여 준다
        const group = w.storageGroup(b);
        const box = storageBounds(group);
        const contents = w.storageContents(b);
        if (group.length > 1) {
          lines.push(`<div class="row"><span>합쳐짐</span><b>${(box.x1 - box.x0) / 2}×${(box.y1 - box.y0) / 2} · ${group.length}개</b></div>`);
        }
        lines.push(`<div class="row"><span>보관 중</span><b>${w.storageTotal(b).toLocaleString()} / ${w.storageCapacity(b).toLocaleString()}</b></div>`);
        // 많은 순으로 이름과 개수 (이름을 누르면 도감)
        const rows = [...contents]
          .sort((a, c) => c[1] - a[1])
          .map(([i, n]) => `<div class="row content-row">${itemLink(i)}<b>${n}</b></div>`)
          .join('');
        lines.push(`<div class="row"><span>내용물</span></div>${rows || '<p class="muted">비어 있음</p>'}`);
        lines.push(
          `<p class="muted">빈틈없는 직사각형으로 붙여 놓으면 한 창고로 합쳐져요 (최대 3×4개). 하역기로 꺼내고, 철거하면 그 칸에 든 것은 허브로 가요.</p>`,
        );
        break;
      }
      case 'station': {
        const load = b.stationMode === 'load';
        const box = load ? b.inBuf : b.outBuf;
        let total = 0;
        for (const n of box.values()) total += n;
        lines.push(`<div class="row"><span>${load ? '실을 짐' : '내보낼 짐'}</span><b>${total} / ${STATION_CAPACITY}</b></div>`);
        // 오가는 트럭들의 운송량 합 (한 바퀴 기준)
        const rates = w.trucksOf(b).map((t) => t.perMinute);
        if (rates.length) {
          const known = rates.filter((r): r is number => r !== null);
          const sum = known.reduce((s, r) => s + r, 0);
          lines.push(
            `<div class="row"><span>트럭 운송량</span><b>${known.length ? `분당 ${fmtNum(sum)}개` : '<span class="muted">한 바퀴 돌면 나와요</span>'}</b></div>`,
          );
        }
        const rows = [...box]
          .filter(([, n]) => n > 0)
          .sort((a, c) => c[1] - a[1])
          .map(([i, n]) => `<div class="row content-row">${itemIcon(i)}<span>${ITEMS[i].name}</span><b>${n}</b></div>`)
          .join('');
        lines.push(rows);
        if (!w.stationStops(b).length) {
          lines.push(`<p class="bad">옆에 도로가 없어요. 정류장 테두리에 도로가 닿아야 트럭이 서요.</p>`);
        }
        lines.push(
          `<p class="muted">${
            load
              ? '컨베이어를 아무 면에나 대면 쌓였다가 트럭에 실려요.'
              : '트럭이 내린 짐을 노란 화살표(앞)로 내보내요. 앞을 허브나 컨베이어에 붙이세요.'
          }</p>`,
        );
        break;
      }
      case 'hub':
        lines.push(`<div class="row"><span>기본 전력</span><b>${HUB_BASE_POWER} kW</b></div>`);
        lines.push(`<p class="muted">재고는 왼쪽 패널에 있어요. 건물을 지으면 재고에서 빠지고, 철거하면 돌아와요.</p>`);
        break;
    }
    return lines.join('');
  }

  // ───────────────────────── 트럭 정보창 ─────────────────────────

  private updateVehicleInfo(w: World, v: Vehicle): void {
    const el = $('info');
    el.hidden = false;
    const stations = w.stations();
    const home = w.buildings.get(v.loadId) ?? w.buildings.get(v.unloadId);
    const clone = home ? w.canBuildTruck(home) : { ok: false, reason: '정류장을 먼저 골라 주세요' };
    const key = `v${v.id}|${v.loadId}|${v.unloadId}|${stations.map((s) => `${s.id}${s.stationMode}`).join(',')}|${clone.reason ?? ''}`;
    if (key !== this.infoKey) {
      this.infoKey = key;
      const opt = (sel: number) =>
        `<option value="0" ${sel ? '' : 'selected'}>고르기</option>` +
        stations
          .map((s) => `<option value="${s.id}" ${s.id === sel ? 'selected' : ''}>정류장 ${s.stationNo} (${STATION_MODE_NAME[s.stationMode]})</option>`)
          .join('');
      el.innerHTML = `<header><span class="swatch" style="background:#d9a441"></span><h3>트럭 ${v.id}</h3>
          <button class="x" data-act="close">×</button></header>
        <p class="muted">두 정류장을 오가요. 싣는 곳에서 가득 차거나 ${TRUCK.wait}초 동안 새 짐이 없으면 출발하고,
          내리는 곳에서 다 내리면 돌아와요. 한 번에 ${TRUCK.capacity}개, 초당 ${TRUCK.speed}칸.</p>
        <label class="recipe">싣는 곳 <select data-act="route-load">${opt(v.loadId)}</select></label>
        <label class="recipe">내리는 곳 <select data-act="route-unload">${opt(v.unloadId)}</select></label>
        <div class="dyn"></div>
        <div class="actions">
          <button data-act="clone-truck" ${clone.ok ? '' : 'disabled'} title="${clone.ok ? '같은 두 정류장을 오가는 트럭을 하나 더' : (clone.reason ?? '')}">
            🚚 같은 길로 한 대 더 <span class="muted">${TRUCK.cost.map((c) => `${itemIcon(c.item)}${c.count}`).join(' ')}</span></button>
          <button data-act="follow">📍 트럭으로 가기</button>
          <button data-act="remove-truck" class="danger">철거 (Del)</button>
        </div>`;
    }
    const lines: string[] = [];
    const goingToLoad = v.state === 'to-load' || v.state === 'loading';
    const st = w.buildings.get(goingToLoad ? v.loadId : v.unloadId);
    let state = VEHICLE_STATUS_LABEL[v.status];
    if (v.status === 'moving' && st) state += ` → 정류장 ${st.stationNo} (${goingToLoad ? '실으러' : '내리러'})`;
    lines.push(`<div class="row"><span>상태</span><b style="color:${VEHICLE_STATUS_COLOR[v.status]}">${state}</b></div>`);
    const cargo = [...v.cargo].filter(([, n]) => n > 0).map(([i, n]) => `${itemIcon(i)}${n}`).join(' ');
    lines.push(`<div class="row"><span>짐</span><b>${cargo || '<span class="muted">없음</span>'} <span class="muted">${v.load} / ${TRUCK.capacity}</span></b></div>`);
    lines.push(`<div class="bar"><div style="width:${(v.load / TRUCK.capacity) * 100}%;background:#c9b27a"></div></div>`);
    // 배터리: 남은 양과 그만큼 갈 수 있는 칸 수. 충전 중이면 공장 전력이 모자란 만큼 느려진다
    const charge = v.battery / w.truckBattery();
    const range = Math.floor((v.battery / TRUCK.drive) * TRUCK.speed);
    const charging = v.status === 'charging' || ((v.state === 'loading' || v.state === 'unloading') && charge < 1);
    const rate = charging ? ` · 충전 ${Math.round(TRUCK.charge * w.power.satisfaction)}kW` : '';
    const batColor = charge > 0.5 ? '#3f8a3a' : charge > 0.2 ? '#b7791f' : '#c0392b';
    lines.push(`<div class="row"><span>배터리</span><b>${Math.round(charge * 100)}% <span class="muted">${range}칸${rate}</span></b></div>`);
    lines.push(`<div class="bar"><div style="width:${charge * 100}%;background:${batColor}"></div></div>`);
    const perMin = v.perMinute;
    lines.push(
      perMin === null
        ? `<div class="row"><span>운송량</span><b class="muted">한 바퀴 돌면 나와요</b></div>`
        : `<div class="row"><span>운송량</span><b>분당 ${fmtNum(perMin)}개 <span class="muted">(${Math.round(v.lastTrip)}초에 ${v.lastLoad}개)</span></b></div>`,
    );
    const hint = VEHICLE_HINT[v.status];
    if (hint) lines.push(`<p class="muted">→ ${hint}</p>`);
    el.querySelector('.dyn')!.innerHTML = lines.join('');
  }

  private onInfoClick(e: MouseEvent): void {
    const act = (e.target as HTMLElement).closest<HTMLElement>('[data-act]')?.dataset.act;
    const input = this.game.input;
    // 정류장 정보창의 트럭 목록: 그 트럭으로
    const truck = (e.target as HTMLElement).closest<HTMLElement>('[data-truck]')?.dataset.truck;
    if (truck) {
      input.selectedVehicle = Number(truck);
      input.selectedId = null;
      this.update();
      return;
    }
    const v = this.selectedVehicle();
    if (v) {
      if (act === 'close') input.selectedVehicle = null;
      if (act === 'follow') this.game.focus(v.x, v.y);
      if (act === 'clone-truck') {
        this.game.exec({ t: 'clone-truck', id: v.id }, (t) => {
          if (!t) return;
          input.selectedVehicle = t.id;
          this.toast(`트럭 ${t.id} 추가 (트럭 ${v.id}의 길과 같음)`);
          this.update();
        });
      }
      if (act === 'remove-truck') {
        this.game.exec({ t: 'remove-truck', id: v.id });
        input.selectedVehicle = null;
      }
      this.update();
      return;
    }
    const b = this.selected();
    if (!b) return;
    if (act === 'build-truck') {
      this.game.exec({ t: 'build-truck', station: b.id }, (t) => {
        if (!t) return;
        input.selectedVehicle = t.id;
        input.selectedId = null;
        const w = this.game.getWorld();
        const name = (id: number) => {
          const s = w.buildings.get(id);
          return s ? `정류장 ${s.stationNo}` : null;
        };
        const from = name(t.loadId);
        const to = name(t.unloadId);
        this.toast(from && to ? `트럭 ${t.id}: ${from} → ${to} 왕복` : `트럭 ${t.id}: 오갈 정류장을 골라 주세요`, 3000);
        this.update();
      });
    }
    if (act === 'close') this.game.input.selectedId = null;
    if (act === 'codex') this.codex.open({ building: b.type });
    if (act === 'take-out') {
      this.game.input.tool = null;
      this.game.input.setTool('unloader');
      if (this.game.input.tool === 'unloader') this.toast('하역기를 창고(허브) 바로 옆에 놓으세요. 방향은 저절로 맞춰져요.');
    }
    if (act === 'rotate') this.game.exec({ t: 'rotate', id: b.id, dir: ((b.dir + 1) % 4) as 0 | 1 | 2 | 3 });
    if (act === 'remove') {
      this.game.exec({ t: 'remove', id: b.id }, (ok) => {
        if (ok && this.game.input.selectedId === b.id) this.game.input.selectedId = null;
        this.update();
      });
    }
    this.update();
  }

  // ───────────────────────── 연구 ─────────────────────────

  private updateResearch(w: World): void {
    const el = $('research');
    // 처음 열 때는 지금 연구할 수 있는 게 있는 탭으로
    if (!this.researchTab) {
      const ready = TECHS.find((t) => !w.researched.has(t.id) && w.canResearch(t.id).ok);
      const open = TECHS.find((t) => !w.researched.has(t.id) && t.requires.every((r) => w.researched.has(r)));
      // 다 마쳤으면 끝없는 연구 탭으로
      this.researchTab = ready?.category ?? open?.category ?? (w.researched.has(ENDLESS_REQUIRES) ? 'endless' : TECHS[0].category);
    }
    const tab = this.researchTab;
    const key =
      tab +
      TECHS.map((t) => `${w.researched.has(t.id) ? 1 : 0}${w.canResearch(t.id).ok ? 1 : 0}`).join('') +
      ENDLESS_TECHS.map((t) => `${w.endlessLevel(t.id)}${w.canResearch(t.id).ok ? 1 : 0}`).join(',');
    if (key !== this.researchKey) {
      this.researchKey = key;
      const tabs = TECH_CATEGORIES.map((c) => {
        let count: string;
        let ready: boolean;
        if (c.id === 'endless') {
          count = `${ENDLESS_TECHS.reduce((n, t) => n + w.endlessLevel(t.id), 0)}단계`;
          ready = ENDLESS_TECHS.some((t) => w.canResearch(t.id).ok);
        } else {
          const list = TECHS.filter((t) => t.category === c.id);
          count = `${list.filter((t) => w.researched.has(t.id)).length}/${list.length}`;
          ready = list.some((t) => !w.researched.has(t.id) && w.canResearch(t.id).ok);
        }
        return `<button data-rtab="${c.id}" class="${c.id === tab ? 'active' : ''}" title="${ready ? '지금 연구할 수 있는 게 있어요' : ''}">
          ${c.icon} ${c.name} <small>${count}</small>${ready ? '<span class="ready"></span>' : ''}</button>`;
      }).join('');
      const costHtml = (list: ItemStack[]) =>
        list.map((c) => `<span class="c">${itemLink(c.item, false)}<span data-have="${c.item}"></span>/${c.count}</span>`).join(' ');
      // 끝없는 연구: 단계와 지금 효과, 다음 단계 비용
      const endless = ENDLESS_TECHS.map((t) => {
        const level = w.endlessLevel(t.id);
        const check = w.canResearch(t.id);
        const open = w.researched.has(ENDLESS_REQUIRES);
        const now = Math.round(t.step * level * 100);
        const req = open ? '' : `<div class="req">선행: ${TECH_BY_ID[ENDLESS_REQUIRES].icon} ${TECH_BY_ID[ENDLESS_REQUIRES].name}</div>`;
        return `<div class="tech ${open ? 'open' : 'locked'}">
          <h4><span class="ticon">${t.icon}</span>${t.name} <small class="muted">${level}단계</small></h4>
          <p>${t.description}<br><small>지금 +${now}% → 다음 단계 +${now + Math.round(t.step * 100)}%</small></p>
          ${req}
          <div class="cost">${costHtml(endlessCost(t, level + 1))}</div>
          <button data-tech="${t.id}" ${check.ok ? '' : 'disabled'}>${check.ok ? `${level + 1}단계 연구하기` : (check.reason ?? '')}</button>
        </div>`;
      });
      const cards = tab === 'endless' ? endless.join('') : TECHS.filter((t) => t.category === tab).map((t) => {
        const done = w.researched.has(t.id);
        const check = w.canResearch(t.id);
        const reqOk = t.requires.every((r) => w.researched.has(r));
        const cls = done ? 'done' : reqOk ? 'open' : 'locked';
        const unlocks = [
          ...(t.unlockBuildings ?? []).map((b) => BUILDINGS[b].name),
          ...(t.unlockRecipes ?? []).map((r) => `${RECIPES[r].name} 레시피`),
        ].join(', ');
        const req = t.requires.length
          ? `<div class="req">선행: ${t.requires
              .map((r) => {
                const x = TECH_BY_ID[r];
                return `${x.icon} ${x.name}${w.researched.has(r) ? ' ✓' : ''}`;
              })
              .join(', ')}</div>`
          : '';
        const cost = t.cost
          .map((c) => `<span class="c">${itemLink(c.item, false)}<span data-have="${c.item}"></span>/${c.count}</span>`)
          .join(' ');
        return `<div class="tech ${cls}">
          <h4><span class="ticon">${t.icon}</span>${t.name}</h4>
          <p>${t.description}${unlocks ? `<br><small>해금: ${unlocks}</small>` : ''}</p>
          ${req}
          <div class="cost">${cost}</div>
          ${done ? '<div class="badge">완료</div>' : `<button data-tech="${t.id}" ${check.ok ? '' : 'disabled'}>${check.ok ? '연구하기' : (check.reason ?? '')}</button>`}
        </div>`;
      }).join('');
      el.innerHTML = `<div class="panel"><header><h2>연구</h2><button class="x" data-act="close-modal">×</button></header>
        <p class="muted">허브 재고에서 재료를 내고 즉시 해금해요. 초록 점 = 지금 연구할 수 있는 게 있는 탭</p>
        <div class="rtabs">${tabs}</div><div class="techs">${cards}</div></div>`;
    }
    el.querySelectorAll<HTMLElement>('[data-have]').forEach((s) => {
      s.textContent = String(w.stockOf(s.dataset.have as ItemId));
    });
  }

  // ───────────────────────── 공장 통계 ─────────────────────────

  /**
   * 아이템마다 분당 만드는 양·쓰는 양 (지금 / 모든 기계 100%일 때), 허브 입고, 재고.
   * 100%일 때 모자라면 어떤 기계가 몇 대 더 필요한지까지.
   */
  /** 허브 재고를 게임 시간 기준으로 띄엄띄엄 적어 둔다. 공장이 바뀌면(새 게임·불러오기·방 참가) 처음부터 */
  private sampleStock(w: World): void {
    if (w !== this.histWorld || w.time < this.histNext - STOCK_SAMPLE_SEC) {
      this.histWorld = w;
      this.stockHist.clear();
      this.histNext = 0;
    }
    if (w.time < this.histNext) return;
    this.histNext = (Math.floor(w.time / STOCK_SAMPLE_SEC) + 1) * STOCK_SAMPLE_SEC;
    for (const i of ITEM_IDS) {
      const n = w.stockOf(i);
      let h = this.stockHist.get(i);
      if (!h) {
        if (!n) continue;
        h = [];
        this.stockHist.set(i, h);
      }
      h.push(n);
      if (h.length > STOCK_SAMPLES) h.shift();
    }
  }

  /** 재고 기록을 픽셀 막대그래프로 (오른쪽이 지금). 늘면 초록, 줄면 빨강 */
  private stockSpark(i: ItemId): string {
    const h = this.stockHist.get(i);
    if (!h || h.length < 2) return '<small>–</small>';
    const H = 16;
    const max = Math.max(...h, 1);
    const x0 = STOCK_SAMPLES - h.length;
    const d = h.map((n, k) => `M${x0 + k + 0.5} ${H}V${H - Math.max(1, Math.round((n / max) * H))}`).join('');
    const diff = h[h.length - 1] - h[0];
    // 그대로인 줄은 흐리게 (늘거나 준 줄이 눈에 띄도록)
    const color = diff > 0 ? 'var(--good)' : diff < 0 ? 'var(--bad)' : 'var(--lo)';
    return `<svg class="spark" width="${STOCK_SAMPLES}" height="${H}" viewBox="0 0 ${STOCK_SAMPLES} ${H}"><path d="${d}" stroke="${color}" stroke-width="1"/></svg>`;
  }

  private updateStatsPanel(w: World): void {
    const now = performance.now();
    if (now - this.statsAt < 1000) return;
    this.statsAt = now;
    const flows = w.factoryFlows();
    const sign = (n: number) => (n > 0.05 ? `+${fmtNum(n)}` : n < -0.05 ? `−${fmtNum(-n)}` : '0');
    const rows = ITEM_IDS.filter((i) => flows.has(i) || w.stockOf(i) > 0 || w.incomePerMinute(i) > 0)
      .map((i) => {
        const f = flows.get(i) ?? { made: 0, used: 0, madeMax: 0, usedMax: 0, makers: 0, users: 0 };
        const net = f.made - f.used;
        const netMax = f.madeMax - f.usedMax;
        const short = netMax < -0.05;
        const fix = short ? makerHint(w, i, -netMax) : '';
        return `<tr class="${short ? 'short' : ''}">
          <td>${itemLink(i)}</td>
          <td>${f.makers ? `<b>${fmtNum(f.made)}</b> <small>/ ${fmtNum(f.madeMax)} · ${f.makers}대</small>` : '<small>–</small>'}</td>
          <td>${f.users ? `<b>${fmtNum(f.used)}</b> <small>/ ${fmtNum(f.usedMax)} · ${f.users}대</small>` : '<small>–</small>'}</td>
          <td class="${net < -0.05 ? 'neg' : net > 0.05 ? 'pos' : ''}">${sign(net)}</td>
          <td class="${short ? 'neg' : netMax > 0.05 ? 'pos' : ''}">${sign(netMax)}${fix ? `<br><small>${fix}</small>` : ''}</td>
          <td>${w.incomePerMinute(i) || '<small>–</small>'}</td>
          <td>${w.stockOf(i)}</td>
          <td>${this.stockSpark(i)}</td>
        </tr>`;
      })
      .join('');
    $('stats').innerHTML = `<div class="panel stats-panel"><header><h2>공장 통계</h2><button class="x" data-act="close-modal">×</button></header>
      <p class="muted">분당 개수. "지금"은 기계마다 최근 15초 평균을 더한 것, "/" 뒤는 모든 기계가 100%로 돌 때.
        <b>100%일 때 남음</b>이 빨간 줄은 기계를 다 돌리면 모자라는 아이템이에요 (재료 기계를 늘리거나 쓰는 기계를 줄이기).</p>
      <table class="stats-table">
        <thead><tr><th>아이템</th><th>만들기</th><th>쓰기</th><th>지금 남음</th><th>100%일 때 남음</th><th>허브 입고</th><th>허브 재고</th><th title="게임 시간 10초마다 잰 허브 재고. 오른쪽이 지금">재고 흐름 (10분)</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="8" class="muted">아직 아무것도 만들지 않아요</td></tr>'}</tbody>
      </table></div>`;
  }

  // ───────────────────────── 툴팁 ─────────────────────────

  private updateTooltip(w: World): void {
    const tip = $('tooltip');
    const h = this.game.input.hover;
    if (!h || !w.inBounds(h.x, h.y)) {
      tip.hidden = true;
      return;
    }
    const lines: string[] = [];
    const tool = this.game.input.tool;
    if (tool) {
      const [ox, oy] = [h.x - Math.floor((BUILDINGS[tool].size - 1) / 2), h.y - Math.floor((BUILDINGS[tool].size - 1) / 2)];
      // 도로는 컨베이어를 바꿔 끼우지 않는다 (겹치면 놓을 수 없음)
      const replace = tool !== 'road';
      const check = w.canPlace(tool, ox, oy, replace);
      if (!check.ok && check.reason !== '이미 건물이 있음') lines.push(`<span class="bad">${check.reason}</span>`);
      const there = w.buildingAt(h.x, h.y);
      if (!check.ok && there && crossesRoad(tool, there.type)) {
        lines.push(`<span class="bad">도로와 컨베이어는 겹칠 수 없어요 · 지하 컨베이어로 밑을 지나가게</span>`);
      }
      if (tool === 'unloader' && check.ok && w.unloaderDir(ox, oy, this.game.input.toolDir) === null) {
        lines.push(`<span class="bad">창고나 허브 바로 옆에 놓아야 꺼낼 수 있어요</span>`);
      }
      if (tool === 'underground' && check.ok) {
        const flow = w.flowDirUnder(tool, ox, oy, h.x, h.y);
        const plan = w.undergroundPlan(ox, oy, flow ?? this.game.input.toolDir);
        lines.push(
          plan.partner
            ? `<b>출구</b>가 돼요 · ${Math.abs(plan.partner.x - ox) + Math.abs(plan.partner.y - oy) - 1}칸 건너 입구와 연결`
            : `<b>입구</b>가 돼요 · 같은 방향으로 최대 4칸 건너(점) 하나 더 놓으면 출구`,
        );
      }
      const replaced = !replace || isBeltType(tool) ? 0 : w.beltsUnder(tool, ox, oy).length;
      if (check.ok && replaced) lines.push(`<span class="muted">컨베이어 ${replaced}칸을 지우고 라인에 끼워 넣어요</span>`);
    }
    for (const v of w.vehicles.values()) {
      if (Math.floor(v.x) !== h.x || Math.floor(v.y) !== h.y) continue;
      lines.push(
        `<b>🚚 트럭 ${v.id}</b> · <span style="color:${VEHICLE_STATUS_COLOR[v.status]}">${VEHICLE_STATUS_LABEL[v.status]}</span> · 짐 ${v.load}/${TRUCK.capacity}`,
      );
    }
    const b = w.buildingAt(h.x, h.y);
    if (b) {
      let s = `<b>${b.type === 'station' ? `정류장 ${b.stationNo}` : b.def.name}</b>`;
      if (b.type === 'station') s += ` · ${STATION_MODE_NAME[b.stationMode]} · 트럭 ${w.trucksOf(b).length}대`;
      if (HAS_STATUS.includes(b.type)) {
        s += ` · <span style="color:${STATUS_COLOR[b.status]}">${STATUS_LABEL[b.status]}</span>`;
      }
      const r = w.recipeOf(b);
      if (r) s += ` · ${r.name}`;
      const st = w.machineStats(b);
      if (st && !st.measuring) {
        const o = st.maxOut[0];
        s += ` · ${fmtNum(o.count * st.util)}/분 <span style="color:${utilColor(st.util)}">(${Math.round(st.util * 100)}%)</span>`;
      }
      lines.push(s);
      if (st?.maxIn.length) {
        lines.push(`<span class="muted">100%에 필요: ${st.maxIn.map((i) => `${itemIcon(i.item)}분당 ${fmtNum(i.count)}`).join(' ')}</span>`);
      }
      if (tool && !isBeltType(b.type)) {
        const rotatable = !['hub', 'generator', 'solar', 'hydro'].includes(b.type);
        lines.push(`<span class="muted">클릭: 설정 열기${rotatable ? ' · R: 이 건물 회전' : ''}</span>`);
      }
    }
    const i = w.idx(h.x, h.y);
    const item = w.resItem[i];
    if (item === 'water') {
      lines.push(`${itemIcon('water')}호수 · 양수기를 놓으면 물을 퍼요`);
    } else if (item) {
      const a = w.resAmount[i];
      const all = w.patchRemainingAt(i) ?? a;
      const initial = w.patchInitialAt(i) ?? all;
      lines.push(
        a === Infinity
          ? `${itemIcon(item)}${ITEMS[item].name} 광맥 · 무한`
          : `${itemIcon(item)}${ITEMS[item].name} 광맥 · 이 칸 ${a}개 · 광맥 전체 ${all.toLocaleString()}개 (${Math.round((all / initial) * 100)}%)`,
      );
      const r = a === Infinity ? undefined : w.patchReports().find((p) => p.id === w.patchOf[i]);
      if (r && r.etaMin !== Infinity) {
        lines.push(`<span${patchAlert(r) ? ' style="color:#b7791f"' : ' class="muted"'}>채굴기 ${r.miners.length}대가 캐는 중 · 약 ${fmtMin(r.etaMin)} 뒤 바닥</span>`);
      }
    } else if (w.dirtMining && !b && tool && isMinerType(tool) && tool !== 'pump') {
      lines.push(`${itemIcon('dirt')}빈 땅 · 채굴기를 놓으면 흙을 캐요 (무한)`);
    }
    if (!lines.length) {
      tip.hidden = true;
      return;
    }
    tip.hidden = false;
    tip.innerHTML = lines.join('<br>');
    tip.style.left = `${this.mouse.x + 16}px`;
    tip.style.top = `${this.mouse.y + 16}px`;
  }
}

/** 하역기 뒤(흰 화살표)에 붙은 창고·허브. 없으면 null */
function unloaderSource(w: World, b: Building): Building | null {
  const n = w.buildingAt(b.x - DX[b.dir], b.y - DY[b.dir]);
  return n && (n.type === 'storage' || n.type === 'hub') ? n : null;
}

/** 창고·허브에 지금 들어 있는 아이템 (아이템 목록 순서) */
function sourceItems(w: World, src: Building): ItemId[] {
  return ITEM_IDS.filter((i) => sourceCount(w, src, i) > 0);
}

function sourceCount(w: World, src: Building, item: ItemId): number {
  return src.type === 'hub' ? w.stockOf(item) : w.storageCount(src, item);
}

/** 컨베이어 위 아이템 개수 (한 칸에 쌓인 것까지) */
function countItems(b: Building): number {
  let n = 0;
  for (const it of b.items) n += it.n;
  return n;
}

/** 땅에서 캐는 아이템: 캐는 건물과 그 건물 한 대의 분당 개수 */
const MINED: Partial<Record<ItemId, [BuildingType, number]>> = {
  'iron-ore': ['miner', 60],
  'copper-ore': ['miner', 60],
  coal: ['miner', 60],
  stone: ['miner', 60],
  dirt: ['miner', 60],
  water: ['pump', 120],
};

/**
 * 분당 deficit개가 모자랄 때 "제련로 약 2대 더". 지금 그 아이템을 만드는 기계가 쓰는 레시피를 먼저 보고,
 * 없으면 해금된 레시피 중 첫 번째. 만들 방법이 없으면 빈 문자열.
 */
function makerHint(w: World, item: ItemId, deficit: number): string {
  const mined = MINED[item];
  if (mined) return `${BUILDINGS[mined[0]].name} 약 ${Math.ceil(deficit / mined[1])}대 더`;
  const used = new Map<string, number>();
  for (const b of w.buildings.values()) {
    const r = w.recipeOf(b);
    if (r?.outputs.some((o) => o.item === item)) used.set(r.id, (used.get(r.id) ?? 0) + 1);
  }
  const candidates = Object.values(RECIPES).filter((r) => w.unlockedRecipes.has(r.id) && r.outputs.some((o) => o.item === item));
  const r = candidates.sort((a, b) => (used.get(b.id) ?? 0) - (used.get(a.id) ?? 0))[0];
  if (!r) return '';
  // 끝없는 연구(기계 속도)로 빨라진 만큼
  const perMachine = ((r.outputs.find((o) => o.item === item)!.count * 60) / r.time) * w.boost('endless-crafting');
  return `${BUILDINGS[r.machine].name} 약 ${Math.ceil(deficit / perMachine)}대 더`;
}

/** 분을 읽기 쉽게: 7분, 1시간 5분 (1분 미만도 1분) */
function fmtMin(m: number): string {
  const total = Math.max(1, Math.ceil(m));
  if (total < 60) return `${total}분`;
  const h = Math.floor(total / 60);
  return total % 60 ? `${h}시간 ${total % 60}분` : `${h}시간`;
}

function fmtNum(n: number): string {
  const r = Math.round(n * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
}

/** 가동률 색: 90% 이상 초록, 50% 이상 노랑, 그 아래 빨강 */
export function utilColor(u: number): string {
  return u >= 0.9 ? '#3f8a3a' : u >= 0.5 ? '#b7791f' : '#c0392b';
}

/**
 * 재료: 최대 속도(100%)로 돌리려면 분당 몇 개가 필요한지 크게, 지금 실제로 쓰는 양은 옆에.
 * 재료 줄을 몇 갈래로 나눌지 정할 때 보는 숫자라 측정 중에도 보여 준다.
 */
function needBlock(st: MachineStats, u: number | null): string {
  if (!st.maxIn.length) return '';
  const rows = st.maxIn
    .map(
      (i) =>
        `<div class="row need-row">${itemIcon(i.item)}<span>${ITEMS[i.item].name}</span><b>분당 ${fmtNum(i.count)}</b><small>${u === null ? '' : `지금 ${fmtNum(i.count * u)}`}</small></div>`,
    )
    .join('');
  return `<div class="prod-sub">재료 <span class="muted">100%로 돌리려면 필요한 양</span></div>${rows}`;
}

/** 정보창 맨 위 생산 현황: 실제 분당 생산(크게)·최대·가동률·멈춘 이유·재료 */
function productionBlock(st: MachineStats): string {
  const head = `<div class="prod-head"><span>생산</span><span class="muted">최근 15초 평균</span></div>`;
  if (st.measuring) return `<div class="prod">${head}<p class="muted">측정 중…</p>${needBlock(st, null)}</div>`;
  const u = st.util;
  const color = utilColor(u);
  const outs = st.maxOut
    .map(
      (o) =>
        `<div class="prod-row">${itemIcon(o.item)}<b class="big">${fmtNum(o.count * u)}</b><span>/분</span><span class="muted">최대 ${fmtNum(o.count)}</span></div>`,
    )
    .join('');
  const reasons = (
    [
      ['재료 부족', st.starve, '앞 단계 기계를 늘리거나 재료 줄을 확인하세요'],
      ['출력 막힘', st.blocked, '결과물이 빠져나갈 곳(출구 쪽)을 확인하세요'],
      ['전력 부족', st.lowPower, '발전기를 늘리세요'],
    ] as const
  ).filter(([, v]) => v >= 0.03);
  const main = reasons.length ? reasons.reduce((a, b) => (b[1] > a[1] ? b : a)) : null;
  const reasonRow = reasons.length
    ? `<div class="row"><span>멈춘 이유</span><b>${reasons.map(([n, v]) => `${n} ${Math.round(v * 100)}%`).join(' · ')}</b></div>`
    : '';
  // 재료가 모자라면 무엇을 얼마나 넣어야 하는지 숫자로
  const starving = main?.[0] === '재료 부족' && st.maxIn.length > 0;
  const need = st.maxIn.map((i) => `${ITEMS[i.item].name} 분당 ${fmtNum(i.count)}개`).join(', ');
  const now = st.maxIn.length === 1 ? `분당 ${fmtNum(st.maxIn[0].count * u)}개` : `그 ${Math.round(u * 100)}%`;
  const hint =
    main && u < 0.9
      ? `<p class="muted">→ ${starving ? `${need}를 대 주면 100%로 돌아가요. 지금은 ${now}만 들어와요.` : main[2]}</p>`
      : '';
  return `<div class="prod">${head}${outs}
    <div class="bar"><div style="width:${u * 100}%;background:${color}"></div></div>
    <div class="row"><span>가동률</span><b style="color:${color}">${Math.round(u * 100)}%</b></div>
    ${reasonRow}${hint}${needBlock(st, u)}</div>`;
}

/** 서버 없이 연 게임이면 방 창을 닫아 둔다 */
function offline(net: Session): boolean {
  // exe는 늘 자기 서버가 있다 (방장 PC 서버에서 내 서버로 갈아타는 찰나에 방 창이 닫히지 않게)
  return !net.connected && !net.borrowed && !net.joining && !net.desktop;
}

/** 클립보드에 복사. http로 연 다른 PC(보안 컨텍스트가 아님)에서는 navigator.clipboard가 없어서 옛 방식으로 */
async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // 아래 옛 방식으로
  }
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }
  ta.remove();
  return ok;
}

/** 플레이어가 정한 이름처럼 남이 입력한 글자를 HTML에 넣을 때 */
function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}
