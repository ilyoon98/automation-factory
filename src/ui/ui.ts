import {
  BUILDINGS,
  FOREST,
  GENERATOR_POWER,
  HUB_BASE_POWER,
  HYDRO_POWER,
  SOLAR_POWER,
  STATION_CAPACITY,
  TRUCK,
  crossesRoad,
  isBeltType,
  isMinerType,
  isRecipeMachine,
  needsRecipeChoice,
  isGeneratorType,
  GRID,
  MODULE,
  type BuildingType,
} from '../data/buildings';
import { ITEMS, ITEM_IDS, type ItemId, type ItemStack } from '../data/items';
import { RECIPES, recipesFor, type MachineKind, type Recipe } from '../data/recipes';
import { ENDLESS_BY_ID, ENDLESS_REQUIRES, ENDLESS_TECHS, TECH_CATEGORIES, endlessCost, type RuleProfile, type TechCategory } from '../data/tech';
import type { Input } from '../input/input';
import { DAY_SEC, ambientEnabled, dayLabel, dayPhase, setAmbientEnabled, skyLabel } from '../render/ambient';
import { darkness } from '../sim/sky';
import type { MapLayer } from '../render/renderer';
import { TERRAIN, TERRAIN_IDS, type TerrainKind } from '../data/terrain';
import { LOCAL_WEATHER_ICON, LOCAL_WEATHER_LABEL } from '../sim/weather-v1';
import { lanRoomCheck, type Session } from '../net/session';
import { VERSION } from '../version';
import { STATUS_LABEL, countOf, type Building, type StationMode, type Status } from '../sim/building';
import type { Blueprint } from '../sim/blueprint';
import type { Exec } from '../sim/commands';
import { DX, DY } from '../sim/dir';
import { ROUTE_MAX, ROUTE_MIN, TRUCK_KIND_LABEL, VEHICLE_STATUS_LABEL, type RouteStop, type Vehicle, type VehicleStatus } from '../sim/vehicle';
import {
  PATCH_LOW_MIN,
  DT,
  describeEdit,
  patchAlert,
  storageBounds,
  PILE_REASON_LABEL,
  isLineType,
  siteLabels,
  type MachineStats,
  type PatchReport,
  type UseResult,
  type World,
} from '../sim/world';
import { blueprintCode, blueprintPreview, defaultBlueprintName, saveBlueprint } from './blueprints';
import { copyText } from './clipboard';
import { GUIDE, findTarget, type GuideFocus } from './guide';
import { goalFocus } from './goal-focus';
import { MAIN_GOALS, PROJECT_GOAL, REGION_NEED, REGION_STAGES, currentGoal, currentStage, goalNeedsStage, stageCleared, type GoalHint } from '../sim/goals';
import { ACH_BY_ID, Q60_ITEMS, achProgress, activeAchievements, sustainedSecs, type AchDef, type AchKind } from '../sim/achievements';
import { Codex, depositName, type DepositId } from './codex';
import { buildingIcon, buildingIconUrl, depositIconUrl, itemIcon, itemLink, lockIcon, mapIcon, techIcon, techTabIcon, truckIconUrl, withBuildingIcons } from './icons';
import { sound } from './sound';
import { crispTarget, crispText, onUiZoom, setCrispText, uiZoom } from './crisp';
import { letScrollbarDrag } from './left-scroll';
import { Toolbar, blockReason, buildState } from './toolbar';
import { topbar } from './topbar';
import { reducedEffects, setReducedEffects } from '../render/effects';
import { ResearchObserver, NoticeQueue, completionSummary, type NoticeKind } from './completion';
import { focusRouteStation, reachableStations, refreshTransportItemSelect, replaceTransportInfo, stationMapButton, transportItemOptions, transportSection } from './transport';
import { chargerInfo, equipmentHelp, unloaderInfo } from './equipment-info';
import { planRoad, type RoadPlanResult } from '../sim/road-plan';
import { replaceRoadBuilder, roadBuilderHtml, roadPlanKey } from './road-builder';

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
  /** 정지 전 배속 (계속을 누르면 이 배속으로) */
  readonly lastSpeed: number;
  setSpeed(s: number): void;
  save(): boolean;
  /** 마지막 저장이 됐는지(ok), 그 뒤로 내가 공장을 바꿨는지(dirty) */
  readonly saveState: { ok: boolean; dirty: boolean };
  newGame(rules?: RuleProfile): void;
  /** 지금 공장을 파일로 내려받는다 (다른 PC로 옮기거나 백업) */
  exportSave(): void;
  /** 파일 내용으로 공장을 바꾼다. 안 되면 이유, 되면 null */
  importSave(text: string): string | null;
  /** 새 게임·불러오기 바로 전 공장으로 되돌린다 (지금 공장과 맞바꿈). 안 되면 이유 */
  restoreBackup(): string | null;
  readonly hasBackup: boolean;
  /** 화면 가운데를 그 칸 좌표로 옮긴다 */
  focus(x: number, y: number): void;
  /** 지금 화면 가운데 칸 좌표 */
  readonly center: { x: number; y: number };
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
  'no-trees': '#8a7a66',
  'no-room': '#e8893a',
  locked: '#c0392b',
  'no-power': '#c0392b',
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
  scheduled: '#8a7a66',
  'no-supply': '#b7791f',
  satisfied: '#3f8a3a',
  returning: '#e8893a',
  paused: '#8a7a66',
};

/** 트럭이 멈춰 있을 때 할 일 */
const VEHICLE_HINT: Partial<Record<VehicleStatus, string>> = {
  waiting: '싣는 정류장에 짐이 없어요. 컨베이어로 정류장에 넣어 주세요.',
  'no-battery': `배터리가 떨어져 천천히 가요. 정류장에 닿으면 충전해요. 한 번 충전으로 기본 ${(TRUCK.battery / TRUCK.drive) * TRUCK.speed}칸까지 가니, 길이 더 길면 연구 "고용량 배터리"의 충전기를 길 중간 도로 옆에 놓아 주세요.`,
  'unload-full': '내리는 정류장이 꽉 찼어요. 정류장 앞(노란 화살표)으로 짐이 빠져나가는지 확인하세요.',
  'no-route': '다음 정류장으로 가는 도로가 끊겼어요. 도로를 이어 주세요.',
  'no-station': '노선의 정류장을 모두 골라 주세요. 바로 다음 정류장은 서로 달라야 해요.',
};

const STATION_MODE_NAME: Record<StationMode, string> = { load: '벨트 입고', unload: '벨트 출고' };

/**
 * 현지 실물 명령(모듈 설치·분리, 고급 트럭 조립)마다 붙이는 고유 번호. 이 화면에서만 쓰는 접두어 + 차례 번호라
 * 같은 명령이 두 번 와도(재전송) 시뮬레이션이 한 번만 적용한다
 */
const RID_PREFIX = Math.random().toString(36).slice(2, 8);
let ridSeq = 0;
const newRid = () => `${RID_PREFIX}-${++ridSeq}`;

/** 심화 메달 네 단계 */
const MEDAL = ['🥉', '🥈', '🥇', '💎'];
/** 기계로 들어오는 재료: 안에 든 것 + 이어진 줄로 오는 것 (줄 끝 기계가 낼 수 있는 것 포함) */
function incomingItems(w: World, b: Building): ItemId[] {
  const items = new Set<ItemId>(w.upstream(b).items);
  for (const [item, n] of b.inBuf) if (n > 0) items.add(item);
  return ITEM_IDS.filter((i) => items.has(i));
}

/** Shift + 1~4 정보 보기 */
const LAYER_KEYS: MapLayer[] = ['base', 'power', 'transport', 'resource'];
/** 허브 재고를 접었을 때 보이는 줄 수 */
const STOCK_FOLD = 8;

const ACH_TAB: Record<AchKind, string> = { first: '최초', deep: '심화', record: '기록', hidden: '숨은' };
/** 메달 네 단계로 세는 업적 (심화·기록) */
const tiered = (a: AchDef) => a.kind === 'deep' || a.kind === 'record';

const MODULE_STATE_LABEL = { none: '미설치', installed: '설치됨', next: '다음 제작부터 적용', detaching: '제작 완료 후 분리' } as const;

/** 트럭이 이 정류장에서 하는 일 (정류장 정보창 트럭 목록) */
function stationRole(v: Vehicle, stationId: number): string {
  const acts = new Set(v.stops.filter((s) => s.id === stationId).map((s) => s.act));
  if (acts.size === 2) return '여기서 싣고 내리기';
  return acts.has('load') ? '여기서 싣기' : '여기에 내리기';
}

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
  'lumberjack',
  'planter',
  'sawmill',
  'chem-reactor',
  'refinery',
  'electrolyzer',
  'large-assembler',
  'sap-extractor',
  'drill',
];

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

export class UI {
  private toolbar: Toolbar;
  private codex: Codex;
  private infoKey = '';
  private infoWorld: World | null = null;
  private roadBuilder: { world: World; from: number; to: number; key: string; plan: RoadPlanResult | null; busy: boolean } | null = null;
  /** 응답을 기다리는 현지 실물 명령 (같은 버튼을 두 번 누르지 않게) */
  private useBusy = new Set<string>();
  /** 기계마다 마지막으로 고른 모듈 공급 창고군 (대표 창고 id), 정류장마다 고른 연결 창고군 (구조 표시, '' = 없음) */
  private moduleSrc = new Map<number, number>();
  /** 트럭 계획 편집 중인 줄 수 */
  private planRows = new Map<number, number>();
  private kitSrc = new Map<number, string>();
  private researchKey = '';
  /** 잠긴 건물에서 연 연구 (반짝이고, 처음 한 번 그 카드로 스크롤) */
  private researchFocus: string | null = null;
  private researchScroll = false;
  /** 연구 창에서 보고 있는 탭 (처음 열 때 정한다) */
  private researchTab: TechCategory | null = null;
  private toastTimer = 0;
  /** 목표 달성 소리를 낼지 가리려고 지난번에 본 공장 */
  private guideWorld: World | null = null;
  /** 방금 복사해서 저장한 묶음 → 저장한 이름 */
  private savedPastes = new WeakMap<Blueprint, string>();
  /** 지금 목표가 가리키는 것 */
  private guideFocus: GuideFocus | null = null;
  /** 업적 창: 탭, 미달성만, 분야, 가까운 순, 다시 그릴 때를 알 열쇠. 알림용 지난 상태 */
  private achTab: AchKind = 'first';
  private achTodo = false;
  private achArea = '';
  private achSort = false;
  private achKey = '';
  private achAt = 0;
  private achSeen: { world: World | null; got: Set<string> } = { world: null, got: new Set() };
  /** 확장 세계: 지난번에 본 이룬 목표 수, 완성 알림을 보였는지 */
  private goalCount = 0;
  /** 지난번에 본 지역 단계 (새 땅이 열렸을 때만 알리려고) */
  private stageCount = 0;
  /** 회수 더미를 차례로 보여 줄 때 지금 차례 */
  private pileCycle = -1;
  private finaleShown = false;
  /** 위쪽 바: 줄 배치·팝오버 */
  private topbar = topbar;
  /** 목표판(O)을 마지막으로 그린 상태 */
  private goalsKey = '';
  private noticeTimer = 0;
  private notices = new NoticeQueue();
  private researchObserver = new ResearchObserver();
  private noticeWorld: World | null = null;
  /** 지금 목표가 맵에서 가리키는 곳 (건물을 들었을 때) */
  guideMark: { x: number; y: number; label: string } | null = null;
  private mouse = { x: 0, y: 0 };
  private oreKey = '';
  /** 광맥마다 이미 알린 단계 (같은 일로 두 번 알리지 않게) */
  private oreAlerted = new Map<number, 'low' | 'empty'>();
  private oreWorld: World | null = null;
  /** 전력 부족 소리: 지금 모자란지, 그 상태가 시작된 시각, 이번 부족에 알렸는지, 마지막으로 울린 시각 (초) */
  private powerAlarm = { world: null as World | null, short: false, since: 0, warned: false, at: -Infinity };
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
    this.toolbar.onLockedClick = (t) => this.openResearchFor(t);
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
      const el = (e.target as HTMLElement).closest<HTMLElement>('[data-codex-building], [data-codex-item], [data-codex-tech]');
      if (!el) return;
      e.preventDefault();
      // 목표 확인 항목의 아이콘: 아이템은 도감, 연구는 연구 창
      if (el.dataset.codexItem) this.codex.open({ item: el.dataset.codexItem as ItemId });
      else if (el.dataset.codexTech) this.openResearchTech(el.dataset.codexTech);
      else this.codex.open({ building: el.dataset.codexBuilding as BuildingType });
    });

    document.querySelectorAll<HTMLButtonElement>('#topbar [data-speed]').forEach((btn) =>
      btn.addEventListener('click', () => game.setSpeed(Number(btn.dataset.speed))),
    );
    // 정지 ↔ 계속 (계속은 직전 배속으로)
    $('btn-pause').addEventListener('click', () => game.setSpeed(game.speed === 0 ? game.lastSpeed : 0));
    // 위쪽 팝오버: 시간(버튼 왼쪽 맞춤) · 메뉴 · 함께 하기(오른쪽 맞춤). 채팅은 chat.ts가 등록
    this.topbar.register('time', $('time-pop'), $('clock'), 'left', () => this.updateTimePop(game.getWorld()));
    this.topbar.register('menu', $('menu-pop'), $('btn-menu'), 'right');
    this.topbar.register('players', $('players'), $('net'), 'right', () => {
      this.playersKey = '';
      this.update();
    });
    $('clock').addEventListener('click', () => this.topbar.toggle('time'));
    $('btn-menu').addEventListener('click', () => this.topbar.toggle('menu'));
    // 메뉴 안 항목을 고르면 메뉴는 닫는다 (소리 켜기·끄기는 결과를 보도록 남긴다)
    $('menu-pop').addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('#btn-new, #btn-help')) this.topbar.close(false);
    });
    $('btn-research').addEventListener('click', () => this.toggleModal('research'));
    $('btn-stats').addEventListener('click', () => this.toggleModal('stats'));
    $('btn-ach').addEventListener('click', () => this.toggleModal('ach'));
    $('btn-goals').addEventListener('click', () => this.toggleModal('goals'));
    $('notice').addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('.x, [data-continue]')) this.hideNotice();
      const tech = (e.target as HTMLElement).closest<HTMLElement>('[data-unlock]')?.dataset.unlock;
      if (tech) {
        this.hideNotice();
        this.openResearchTech(tech);
      }
      if ((e.target as HTMLElement).closest('[data-completion-record]')) {
        this.hideNotice(); if ($('goals').hidden) this.toggleModal('goals');
      }
      const ach = (e.target as HTMLElement).closest<HTMLElement>('[data-ach]')?.dataset.ach;
      if (ach) {
        this.hideNotice();
        this.openAch(ach);
      }
    });
    // 툴바에서 잠긴 건물을 눌렀을 때 상세 줄의 "연구 보기"
    $('holding').addEventListener('click', (e) => {
      const t = game.input.blocked?.type;
      if ((e.target as HTMLElement).closest('[data-act="open-research"]') && t) this.openResearchFor(t);
    });
    // 업적 창: 탭·필터·추적 (개인 설정)
    $('ach').addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      const tab = t.closest<HTMLElement>('[data-achtab]')?.dataset.achtab;
      if (tab) this.achTab = tab as AchKind;
      const track = t.closest<HTMLElement>('[data-achtrack]')?.dataset.achtrack;
      if (track !== undefined) {
        try {
          localStorage.setItem('automation-ach-track', track === this.trackedAch() ? '' : track);
        } catch {
          // 저장 공간이 없으면 이번 실행 동안만
        }
      }
      if (tab || track !== undefined) {
        this.achKey = '';
        this.update();
      }
    });
    $('ach').addEventListener('change', (e) => {
      const el = e.target as HTMLInputElement | HTMLSelectElement;
      if (el.dataset.achf === 'todo') this.achTodo = (el as HTMLInputElement).checked;
      if (el.dataset.achf === 'area') this.achArea = el.value;
      if (el.dataset.achf === 'sort') this.achSort = el.value === 'near';
      this.achKey = '';
      this.update();
    });
    $('btn-map').addEventListener('click', () => game.toggleMap());
    $('layers').addEventListener('click', (e) => {
      const l = (e.target as HTMLElement).closest<HTMLElement>('[data-layer]')?.dataset.layer as MapLayer | undefined;
      if (l) game.input.layer = game.input.layer === l ? 'base' : l;
      this.update();
    });
    $('btn-help').addEventListener('click', () => this.toggleModal('help'));
    $('btn-rates').addEventListener('click', () => this.toggleRates());
    $('btn-undo').addEventListener('click', () => game.input.undoRedo(false));
    $('btn-redo').addEventListener('click', () => game.input.undoRedo(true));
    $('btn-codex').addEventListener('click', () => {
      if (!this.codex.isOpen) this.closeWindows();
      this.codex.toggle();
      this.update();
    });
    $('btn-save').addEventListener('click', () => {
      this.toast(game.save() ? '저장했어요' : '저장하지 못했어요 (저장 공간이 꽉 찼을 수 있어요)');
      this.update();
    });
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
    $('btn-restore').addEventListener('click', () => {
      if (!confirm('새 게임·파일 불러오기 바로 전의 공장으로 돌아갈까요? 지금 공장은 맞바꿔 보관해서, 한 번 더 누르면 다시 돌아와요.')) return;
      const err = game.restoreBackup();
      this.toast(err ?? '바로 전 공장으로 돌아왔어요');
      if (!err) $('help').hidden = true;
    });
    // 효과음·배경음: 위쪽 버튼은 둘 다 켜기·끄기, 도움말 창 아래에서 각각 음량
    $('btn-sound').addEventListener('click', () => {
      sound.toggleMute();
      this.updateSound();
      if (!sound.muted) sound.play('place');
    });
    $('sound-volume').addEventListener('input', (e) => {
      sound.setVolume(Number((e.target as HTMLInputElement).value) / 100);
      this.updateSound();
      sound.play('place');
    });
    $('music-volume').addEventListener('input', (e) => {
      sound.setMusicVolume(Number((e.target as HTMLInputElement).value) / 100);
      this.updateSound();
    });
    this.updateSound();
    // 버튼·탭을 누르면 아주 작게 "톡"
    document.addEventListener('click', (e) => {
      if ((e.target as Element).closest('button, .ore-alert')) sound.play('click');
    });
    // 글자 또렷하게: 화면 배율이 정수가 아닐 때 UI 배율을 정수에 맞춘다 (crisp.ts)
    $<HTMLInputElement>('crisp-text').addEventListener('change', (e) => setCrispText((e.target as HTMLInputElement).checked));
    // 낮·밤과 날씨 (render/ambient.ts)
    $<HTMLInputElement>('ambient-on').checked = ambientEnabled();
    $<HTMLInputElement>('ambient-on').addEventListener('change', (e) => {
      setAmbientEnabled((e.target as HTMLInputElement).checked);
      this.update();
    });
    const reduced = $<HTMLInputElement>('reduced-effects');
    reduced.checked = reducedEffects();
    document.documentElement.classList.toggle('reduced-effects', reduced.checked);
    reduced.addEventListener('change', () => { setReducedEffects(reduced.checked); this.update(); });
    onUiZoom(() => this.updateCrisp());
    this.updateCrisp();
    $('btn-new').addEventListener('click', () => ($('newgame').hidden = false));
    $('newgame').addEventListener('click', (e) => {
      const rules = (e.target as HTMLElement).closest<HTMLElement>('[data-rules]')?.dataset.rules;
      if (!rules || !confirm('지금 공장을 버리고 새 게임을 시작할까요?')) return;
      $('newgame').hidden = true;
      game.newGame(rules as RuleProfile);
    });

    // Esc는 위에 떠 있는 것부터 하나씩: 알림 카드 → 팝오버 → 창 → (input.ts) 선택·건설 도구.
    // 캡처 단계라 input.ts보다 먼저 받고, 닫은 게 있으면 거기서 멈춘다
    window.addEventListener(
      'keydown',
      (e) => {
        if (e.key !== 'Escape' || isTyping(e.target)) return;
        let used = false;
        if (!$('notice').hidden) used = this.hideNotice();
        else if (this.topbar.close(true)) used = true;
        else if (this.codex.isOpen) {
          this.codex.close();
          used = true;
        } else if (!$('newgame').hidden) used = !!($('newgame').hidden = true);
        else used = this.closeWindows();
        if (!used) return;
        e.stopImmediatePropagation();
        this.update();
      },
      true,
    );
    window.addEventListener('keydown', (e) => {
      if (isTyping(e.target) && e.key !== 'Tab') return;
      const k = e.key.toLowerCase();
      const modal = document.querySelector<HTMLElement>('.modal:not([hidden])');
      if (modal) {
        if (k === 'tab') {
          const controls = [...modal.querySelectorAll<HTMLElement>('button, input, select, textarea, a[href], summary, [contenteditable="true"], [tabindex]')]
            .filter((el) => !el.matches(':disabled, [tabindex="-1"]') && el.getClientRects().length > 0);
          if (controls.length) {
            const first = controls[0], last = controls[controls.length - 1];
            if (!modal.contains(document.activeElement) || (e.shiftKey ? document.activeElement === first : document.activeElement === last)) {
              e.preventDefault();
              (e.shiftKey ? last : first).focus();
            }
          }
        }
        return;
      }
      if (isTyping(e.target)) return;
      if (e.repeat && ['t', 'h', 'i', 'g', 'p', 'o', 'j', 'm'].includes(k)) return;
      // 툴바 탭: Tab / Shift+Tab 으로 돌리기, 탭에 적힌 키로 바로 가기 (Ctrl+C 같은 조합은 무시)
      if (k === 'tab') {
        e.preventDefault();
        this.toolbar.cycle(e.shiftKey ? -1 : 1);
      } else if (!e.ctrlKey && !e.metaKey && !e.altKey) this.toolbar.selectByKey(k);
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (k === 't') this.toggleModal('research');
      if (k === 'h') this.toggleModal('help');
      if (k === 'i') this.toggleRates();
      if (k === 'g') {
        if (!this.codex.isOpen) this.closeWindows();
        this.codex.toggle();
        this.update();
      }
      if (k === 'p') this.toggleModal('stats');
      if (k === 'o') this.toggleModal('goals');
      if (k === 'j') this.toggleModal('ach');
      if (k === 'm') game.toggleMap();
      // Shift + 1~4: 정보 보기 (숫자만 누르면 건물 고르기라 Shift와 함께. 키 배열과 상관없이 e.code로)
      const n = /^Digit([1-4])$/.exec(e.code);
      if (e.shiftKey && n && game.getWorld().regional) {
        const l = LAYER_KEYS[Number(n[1]) - 1];
        game.input.layer = game.input.layer === l && l !== 'base' ? 'base' : l;
        this.update();
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
    // 선택 도전 고르기 (개인 설정)
    // 선택 도전 줄을 누르면 그 도전의 세부를 펼친다 (다시 누르면 접기, 개인 설정)
    $('guide').addEventListener('pointerdown', (e) => {
      const id = (e.target as HTMLElement).closest<HTMLElement>('[data-chal]')?.dataset.chal;
      if (!id) return;
      try {
        localStorage.setItem('automation-challenge', this.trackedChallenge() === id ? '' : id);
      } catch {
        // 저장 공간이 없으면 이번 실행 동안만
      }
      this.update();
    });
    // 운영 개요·회수 목록: 누르면 그 자리로
    $('stats').addEventListener('pointerdown', (e) => {
      const f = (e.target as HTMLElement).closest<HTMLElement>('[data-focus]')?.dataset.focus;
      if (!f) return;
      const [x, y] = f.split(',').map(Number);
      $('stats').hidden = true;
      game.focus(x + 0.5, y + 0.5);
    });
    // 전력망 목록: 누르면 그 망의 첫 노드로
    $('piles').addEventListener('pointerdown', (e) => {
      if ((e.target as HTMLElement).closest('[data-piles]')) {
        const tiles = [...game.getWorld().pileTiles().keys()];
        if (!tiles.length) return;
        this.pileCycle = (this.pileCycle + 1) % tiles.length;
        const t = tiles[this.pileCycle];
        const w0 = game.getWorld().width;
        // 누를 때마다 다음 더미로 화면만 옮긴다 (옮기기는 맵에서 더미를 눌러서)
        game.focus((t % w0) + 0.5, Math.floor(t / w0) + 0.5);
      }
    });
    // 허브 재고 펼치기·접기 (다시 그려져도 놓치지 않게 pointerdown)
    $('stock').addEventListener('pointerdown', (e) => {
      if (!(e.target as HTMLElement).closest('[data-stock-toggle]')) return;
      this.stockOpen = !this.stockOpen;
      this.update();
    });
    $('power').addEventListener('pointerdown', (e) => {
      const id = Number((e.target as HTMLElement).closest<HTMLElement>('[data-net]')?.dataset.net);
      const n = id ? game.getWorld().buildings.get(id) : undefined;
      if (n) game.focus(n.x + n.size / 2, n.y + n.size / 2);
    });
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
    const refreshCargoChoices = (e: Event) => {
      const select = e.target as HTMLSelectElement;
      const v = this.selectedVehicle();
      if (v && select.tagName === 'SELECT') refreshTransportItemSelect(game.getWorld(), v, select);
    };
    $('info').addEventListener('focusin', refreshCargoChoices);
    $('info').addEventListener('pointerdown', refreshCargoChoices);
    // 청사진 이름 칸에서 Enter = 저장
    $('info').addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' || (e.target as HTMLElement).dataset.act !== 'bp-name') return;
      e.preventDefault();
      this.saveCopied();
      this.update();
    });
    $('info').addEventListener('change', (e) => {
      const sel = e.target as HTMLSelectElement;
      if (sel.dataset.act === 'road-target' && this.roadBuilder && !this.roadBuilder.busy) {
        this.roadBuilder.to = Number(sel.value);
        this.roadBuilder.key = '';
        this.update();
        return;
      }
      const v = this.selectedVehicle();
      if (v) {
        // 노선 i번째 정류장 바꾸기. 정류장을 고르면 싣기·내리기는 그 정류장 종류로 맞춘다 (바꾸고 싶으면 아래 줄에서).
        // 실을 짐은 싣는 곳에만 (내리기로 바꾸면 지운다)
        const i = Number(sel.dataset.i);
        const act = sel.dataset.act ?? '';
        if (act === 'stop-station' || act === 'stop-act' || act === 'stop-item') {
          const stops = v.stops.map((st) => ({ ...st }));
          const cur = stops[i];
          let next: RouteStop = { ...cur };
          if (act === 'stop-station') {
            const st = game.getWorld().buildings.get(Number(sel.value));
            next = { ...cur, id: Number(sel.value), act: st?.type === 'station' ? st.stationMode : cur.act };
          }
          if (act === 'stop-act') next = { ...cur, act: sel.value === 'unload' ? 'unload' : 'load' };
          if (act === 'stop-item') next = { ...cur, item: (sel.value || null) as ItemId | null };
          if (next.act === 'unload' || !next.item) delete next.item;
          stops[i] = next;
          game.exec({ t: 'route', id: v.id, stops });
        }
        this.update();
        return;
      }
      // 단체 선택: 고른 기계 모두에 같은 레시피 (되돌리기 한 단계)
      if (sel.dataset.act === 'multi-recipe') {
        const group = this.multiSelected(game.getWorld());
        const value = sel.value || null;
        if (!group.length) return;
        game.exec({ t: 'begin' });
        for (const g of group) game.exec({ t: 'config', id: g.id, key: 'recipe', value });
        game.exec({ t: 'end' });
        game.input.rememberSetting(group[0].type, value);
        this.toast(`${group.length}대를 ${value ? RECIPES[value].name : '선택 안 함'}(으)로 바꿨어요 · 실수했으면 Ctrl+Z`);
        this.update();
        return;
      }
      const b = this.selected();
      if (!b) return;
      // 모듈 공급 창고·고급 트럭 연결 창고 고르기 (명령은 버튼을 눌러야 간다)
      if (sel.dataset.act === 'mod-src') {
        this.moduleSrc.set(b.id, Number(sel.value));
        this.update();
        return;
      }
      if (sel.dataset.act === 'station-dock') {
        game.exec({ t: 'station-dock', id: b.id, storage: Number(sel.value) });
        this.update();
        return;
      }
      if (sel.dataset.act === 'power-node') {
        game.exec({ t: 'power-node', id: b.id, node: Number(sel.value) }, (r) => {
          if (!r.ok) this.toast(r.reason ?? '할 수 없어요', 3000);
          this.update();
        });
        return;
      }
      if (sel.dataset.act === 'zone-budget') {
        game.exec({ t: 'zone-budget', zone: Number(sel.dataset.zone), kw: Number(sel.value) });
        this.update();
        return;
      }
      if (sel.dataset.act === 'kit-src') {
        this.kitSrc.set(b.id, sel.value);
        this.update();
        return;
      }
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
      game.exec({ t: 'research', id }, () => this.update());
    });

    // 같이 하기: 위쪽 버튼을 누르면 방 창 (만들기·참가·주소 복사·접속자 목록)
    $('net').addEventListener('click', () => this.topbar.toggle('players'));
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
      if (act === 'solo') this.topbar.close(true);
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
  }

  showHelp(): void {
    $('help').hidden = false;
  }

  /**
   * 위쪽 함께 하기 버튼. 서버 없이 연 게임이면 같은 자리에 비활성으로 남긴다.
   * 채팅 버튼도 여기서: 혼자 할 때는 비활성 + 방에 들어가면 쓸 수 있다는 안내
   */
  private updateNet(): void {
    const net = this.game.net;
    const el = $<HTMLButtonElement>('net');
    const off = offline(net);
    el.disabled = off;
    if (off && this.topbar.isOpen('players')) this.topbar.close(false);
    if (this.roomsOnStart && net.connected) {
      this.roomsOnStart = false;
      // 새로고침 전에 방장·손님이었으면 저절로 다시 들어가므로 묻지 않는다
      if (net.role === 'solo' && !net.rejoining) this.topbar.open('players');
    }
    const chat = $<HTMLButtonElement>('btn-chat');
    const together = net.role !== 'solo';
    chat.disabled = !together;
    chat.title = together
      ? `채팅 (Enter) — 방 안의 모두(${net.players}명)에게 흘러가요`
      : '채팅은 함께 하기 방에 들어간 뒤에 쓸 수 있어요 (함께 하기 버튼에서 방 만들기·참가)';
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
    else text = '👥 함께 하기';
    if (off) [text, cls] = ['👥 함께 하기', ''];
    el.textContent = text;
    el.title = off
      ? '함께 하기는 게임 서버(npm run host 또는 exe)로 열었을 때 쓸 수 있어요'
      : '함께 하기: 방 만들기 · 참가 · 주소 복사 · 접속자 목록';
    el.classList.toggle('live', cls === 'live');
    el.classList.toggle('wait', cls === 'wait');
    const save = net.canSave;
    this.updateSave(save);
    $<HTMLButtonElement>('btn-new').disabled = !save;
    $<HTMLButtonElement>('btn-import').disabled = !save;
    $<HTMLButtonElement>('btn-restore').disabled = !save || !this.game.hasBackup;
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

  private updateCrisp(): void {
    const { dpr, target } = crispTarget();
    $<HTMLInputElement>('crisp-text').checked = crispText();
    const pct = (v: number) => `${Math.round(v * 100)}%`;
    $('crisp-text-hint').textContent =
      dpr === target
        ? `지금 화면 배율(${pct(dpr)})에서는 이미 또렷해요`
        : crispText()
          ? `화면 배율 ${pct(dpr)} → 창·글자를 ${pct(target)} 크기로 맞춰 또렷하게 그리는 중`
          : `화면 배율 ${pct(dpr)}라 글자가 살짝 흐려요. 켜면 창·글자가 ${pct(target)} 크기로 ${target < dpr ? '작아지는' : '커지는'} 대신 또렷해져요`;
  }

  private updateSound(): void {
    const off = sound.muted || (sound.volume <= 0 && sound.musicVolume <= 0);
    const btn = $('btn-sound');
    btn.textContent = off ? '🔇 소리 꺼짐' : '🔊 소리 켜짐';
    btn.classList.toggle('off', off);
    const pct = Math.round(sound.volume * 100);
    $<HTMLInputElement>('sound-volume').value = String(pct);
    $('sound-volume-text').textContent = sound.muted ? '꺼짐' : `${pct}%`;
    const music = Math.round(sound.musicVolume * 100);
    $<HTMLInputElement>('music-volume').value = String(music);
    $('music-volume-text').textContent = sound.muted ? '꺼짐' : `${music}%`;
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

  /** 큰 창은 한 번에 하나: 위쪽 버튼·단축키로 열면 다른 큰 창은 닫는다 */
  private toggleModal(id: WindowId): void {
    const el = $(id);
    const open = el.hidden;
    if (open) this.closeWindows();
    this.topbar.close(false);
    el.hidden = !open;
    if (id === 'research') {
      this.researchKey = '';
      this.researchFocus = null;
    }
    if (id === 'ach') {
      this.achKey = '';
      this.achFocus = null;
    }
    if (id === 'goals') this.goalsKey = '';
    if (id === 'stats') this.statsAt = 0;
    this.update();
  }

  /** 이 건물을 여는 연구를 연구 창에서 그 탭으로 열어 반짝인다 (선행이 남았으면 카드에 선행이 보인다) */
  /** 목표 확인 항목 앞 아이콘: 만들 아이템(우클릭 = 도감에서 얻는 법) · 연구(우클릭 = 연구 창의 그 연구) */
  private checkIcon(w: World, hint?: GoalHint): string {
    if (hint?.item) return `<span class="goal-ico" data-codex-item="${hint.item}" title="${ITEMS[hint.item].name} · 우클릭: 도감">${itemIcon(hint.item)}</span>`;
    const t = hint?.tech ? w.tech(hint.tech) : undefined;
    if (t) return `<span class="goal-ico" data-codex-tech="${t.id}" title="${t.name} · 우클릭: 연구">${techIcon(t)}</span>`;
    return '';
  }

  /** 연구 창을 그 연구의 탭으로 열어 반짝인다 */
  private openResearchTech(id: string): void {
    const tech = this.game.getWorld().tech(id);
    if ($('research').hidden) this.toggleModal('research');
    if (!tech) return;
    this.researchTab = tech.category;
    this.researchFocus = tech.id;
    this.researchScroll = true;
    this.researchKey = '';
    this.update();
  }

  private openResearchFor(type: BuildingType): void {
    const tech = this.game.getWorld().techs.find((t) => t.unlockBuildings?.includes(type));
    if (tech) this.openResearchTech(tech.id);
    else if ($('research').hidden) this.toggleModal('research');
  }

  /** 열린 큰 창(도감 포함)을 모두 닫는다. 닫은 게 있으면 true */
  private closeWindows(): boolean {
    let closed = false;
    for (const id of WINDOWS) {
      if ($(id).hidden) continue;
      $(id).hidden = true;
      closed = true;
    }
    if (this.codex.isOpen) {
      this.codex.close();
      closed = true;
    }
    return closed;
  }

  /**
   * 연구 완료·목표 달성 알림 카드 (위쪽 바 아래 가운데). 몇 초 안에 또 오면 한 장에 모아 보여 준다.
   * 적용은 이미 끝난 일이고 카드는 알려 주기만 한다
   */
  notice(title: string, body = '', ms = 2500, kind: NoticeKind = 'general'): void {
    if (document.hidden) return;
    if (!this.notices.push({ title, body, ms, kind })) return;
    this.renderNotice();
  }

  private renderNotice(): void {
    const n = this.notices.current;
    if (!n) return;
    const el = $('notice');
    el.dataset.kind = n.kind;
    el.style.setProperty('--notice-life', `${n.ms}ms`);
    const celebrate = n.kind !== 'general' && !reducedEffects();
    const sparks = celebrate ? Array.from({ length: 20 }, (_, i) => {
      const angle = i * Math.PI * 2 / 20, r = 28 + i % 3 * 9;
      return '<i style="--dx:' + Math.round(Math.cos(angle) * r) + 'px;--dy:' + Math.round(Math.sin(angle) * r) + 'px;--delay:' + (n.kind === 'finale' && i >= 10 ? 0.3 : 0) + 's"></i>';
    }).join('') : '';
    el.innerHTML = '<header><h3>' + (n.kind === 'finale' ? '최종 목표 완료' : n.kind === 'research' ? '연구 완료' : '✓ 달성') + '</h3><button class="x" title="닫기 (Esc)">×</button></header>' +
      '<div class="notice-title">' + n.title + '</div><div class="notice-body">' + n.body + '</div>' +
      (sparks ? '<div class="notice-sparks" aria-hidden="true">' + sparks + '</div>' : '');
    el.hidden = false;
    clearTimeout(this.noticeTimer);
    this.noticeTimer = window.setTimeout(() => this.hideNotice(), n.ms);
    // 같은 갱신에서 연구·최종 완료가 겹치면 최종적으로 남은 한 카드만 소리를 낸다.
    queueMicrotask(() => { if (this.notices.current === n && !document.hidden) sound.play(n.kind === 'research' ? 'research' : 'goal'); });
  }

  private hideNotice(): boolean {
    if ($('notice').hidden) return false;
    clearTimeout(this.noticeTimer);
    $('notice').hidden = true;
    if (this.notices.next()) this.renderNotice();
    return true;
  }

  /** 숨긴 탭·공장 교체에서 과거 연출을 버리고 현재 사실만 기억한다. */
  silenceEffects(): void {
    clearTimeout(this.noticeTimer); this.notices.clear(); $('notice').hidden = true;
    this.researchObserver = new ResearchObserver();
    this.researchObserver.poll(this.game.getWorld());
    this.guideWorld = null; this.achSeen.world = null;
  }

  private researchNotify(w: World): void {
    for (const { id, level } of this.researchObserver.poll(w)) {
      const repeat = ENDLESS_BY_ID[id];
      if (repeat) { this.notice('연구 완료: ' + repeat.name + ' ' + level + '단계'); continue; }
      const tech = w.tech(id);
      if (!tech) continue;
      const icons = [...(tech.unlockBuildings ?? []).map((t) => '<img class="icon" src="' + buildingIconUrl(t) + '" alt="' + BUILDINGS[t].name + '" title="' + BUILDINGS[t].name + '">'),
        ...(tech.unlockRecipes ?? []).map((r) => itemIcon(RECIPES[r].outputs[0].item))];
      const body = '<p>새로 열린 설비·레시피 ' + icons.slice(0, 3).join('') + (icons.length > 3 ? ' 외 ' + (icons.length - 3) + '개' : '') + '</p><button data-unlock="' + id + '">해금 보기</button>';
      this.notice('<span class="research-emblem">' + techIcon(tech) + '</span>' + tech.name, body, 4000, 'research');
    }
  }

  /** 저장 버튼: 저장됨 · 저장 필요 · 저장 실패 · (손님) 저장 안 함. 글자가 바뀌어도 폭은 그대로 (CSS) */
  private updateSave(canSave: boolean): void {
    const btn = $<HTMLButtonElement>('btn-save');
    const s = this.game.saveState;
    const [text, cls] = !canSave ? ['저장 안 함', ''] : !s.ok ? ['⚠ 저장 실패', 'bad'] : s.dirty ? ['● 저장 필요', 'warn'] : ['✓ 저장됨', 'good'];
    if (btn.textContent !== text) btn.textContent = text;
    btn.disabled = !canSave;
    btn.classList.toggle('bad', cls === 'bad');
    btn.classList.toggle('warn', cls === 'warn');
    btn.classList.toggle('good', cls === 'good');
    btn.title = !canSave
      ? '손님은 방장의 공장이라 저장하지 않아요 (방장이 저장해요)'
      : `${!s.ok ? '마지막 저장이 실패했어요. 눌러서 다시 저장 · ' : ''}지금 저장 (30초마다 저절로). 다른 PC로 옮기려면 메뉴 → 도움말 아래 '공장 파일로 내보내기'`;
  }

  /** 시간 팝오버: 날짜·때·경과 시간·지금 화면 가운데의 날씨 */
  private updateTimePop(w: World): void {
    if (!this.topbar.isOpen('time')) return;
    const sky = w.regional ? this.regionalSky(w) : skyLabel(w.seed, w.time);
    const t = Math.floor(w.time);
    const hms = `${Math.floor(t / 3600)}:${String(Math.floor(t / 60) % 60).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
    const html = `<h3>${dayNumber(w.time)}일차 · ${dayPart(w.time)}</h3>
      <div class="row"><span>지난 게임 시간</span><b class="num">${hms}</b></div>
      <div class="row"><span>하루 길이</span><b>${DAY_SEC / 60}분</b></div>
      <div class="row"><span>날씨</span><b>${sky.icon}</b></div>
      <p class="muted">${sky.text}</p>
      ${
        w.regional
          ? this.terrainWeatherTable(w)
          : `<div class="row"><span>태양광 한 대</span><b>${Math.round(w.solarOutput())}kW</b></div>
      <div class="row"><span>풍력 한 대</span><b>${Math.round(w.windOutput())}kW</b></div>`
      }`;
    if ($('time-pop').innerHTML !== html) $('time-pop').innerHTML = html;
  }

  /** 목표판 (O): 확장 세계는 메인 목표 36개 + 지역 과제, 기본 세계는 안내 목표 전체 */
  private updateGoalsPanel(w: World): void {
    const tracked = this.trackedChallenge();
    const key = w.regional
      ? `${[...w.goals].join()}|${[...w.challenges].join()}|${tracked}|${currentGoal(w)?.id}`
      : [...w.guideDone].join();
    if (key === this.goalsKey) return;
    this.goalsKey = key;
    let body: string;
    if (w.regional) {
      const cur = currentGoal(w);
      let chapter = '';
      const rows = MAIN_GOALS.map((g) => {
        const done = w.goals.has(g.id);
        const head = g.chapter !== chapter ? `<h3>${(chapter = g.chapter)}</h3>` : '';
        const cls = done ? 'done' : g === cur ? 'cur' : '';
        return `${head}<li class="${cls}"><span class="mark">${done ? '✓' : g === cur ? '▶' : '·'}</span><small class="muted">${g.id}</small> ${g.title}</li>`;
      });
      const done = MAIN_GOALS.filter((g) => w.goals.has(g.id)).length;
      const stageNow = currentStage(w);
      const stages = REGION_STAGES.map((s, i) => {
        const cleared = stageCleared(w, s);
        const tasks = s.tasks
          .map((t) => `<li class="${w.challenges.has(t.id) ? 'done' : ''}"><span class="mark">${w.challenges.has(t.id) ? '✓' : '·'}</span>${t.title} <small class="muted">${t.hint}</small></li>`)
          .join('');
        const state = cleared ? '✓ 열림' : i === stageNow ? '▶ 지금 지역' : '잠김';
        return `<h3>${s.name} <small>${state} · 보상: ${siteLabels(s.opens).join(', ')}</small></h3>${i <= stageNow ? `<ul class="steps goal-list">${tasks}</ul>` : ''}`;
      }).join('');
      body = `<p class="muted">메인 목표 ${done}/${MAIN_GOALS.length} · 지금 목표는 왼쪽 카드에서 자세히 볼 수 있어요.</p>
        <ul class="steps goal-list">${rows.join('')}</ul>
        <h3>지역 과제</h3>
        <p class="muted">지역마다 과제 ${REGION_NEED}개를 이루면 다음 땅이 열려요 (셋 다 할 필요는 없어요).</p>
        ${stages}${w.goals.has('MG36') ? '<h3>공장망 완성 기록</h3>' + completionSummary(w) : ''}`;
    } else {
      const cur = GUIDE.findIndex((s) => !w.guideDone.has(s.title));
      const rows = GUIDE.map((s, i) => {
        const done = w.guideDone.has(s.title);
        return `<li class="${done ? 'done' : i === cur ? 'cur' : ''}"><span class="mark">${done ? '✓' : i === cur ? '▶' : '·'}</span>${s.title}</li>`;
      }).join('');
      body = `<p class="muted">목표 ${GUIDE.filter((s) => w.guideDone.has(s.title)).length}/${GUIDE.length} · 지금 목표는 왼쪽 카드에서 자세히 볼 수 있어요.</p>
        <ul class="steps goal-list">${rows}</ul>`;
    }
    $('goals').innerHTML = `<div class="panel"><header><h2>목표판</h2><button class="x" data-act="close-modal">×</button></header>${body}</div>`;
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
    if (this.roadBuilder && (this.roadBuilder.world !== w || this.game.input.selectedId !== this.roadBuilder.from || this.game.input.selectedVehicle || this.game.input.tool || this.game.input.paste)) {
      this.roadBuilder = null;
      this.game.input.roadPreview = null;
    }
    document.documentElement.classList.toggle('reduced-effects', reducedEffects());
    document.documentElement.classList.toggle('full-effects', !reducedEffects());
    if (this.noticeWorld !== w) { this.noticeWorld = w; this.silenceEffects(); }
    this.researchNotify(w);

    // 시계, 속도
    const t = Math.floor(w.time);
    const time = `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
    // 하늘 아이콘 (낮·해 질 녘·밤·흐림·비). 태양광·풍력 출력이 하늘을 따르니 화면 효과를 꺼도 보인다
    const sky = w.regional ? this.regionalSky(w) : skyLabel(w.seed, w.time);
    const clock = `${sky.icon} ${dayNumber(w.time)}일차 · ${dayPart(w.time)}`;
    if ($('clock').textContent !== clock) $('clock').textContent = clock;
    $('clock').title = `${sky.text} · 게임 시간 ${time} · 누르면 자세히`;
    this.updateTimePop(w);
    // 정지 중이면 "계속"과 정지 표시만. 직전 배속은 기억하되 도는 것처럼 표시하지 않는다
    const paused = this.game.speed === 0;
    const pause = $('btn-pause');
    pause.classList.toggle('active', paused);
    const pauseHtml = paused ? '▶ 계속' : '⏸ 정지';
    if (pause.innerHTML !== pauseHtml) pause.innerHTML = pauseHtml;
    pause.title = paused ? `계속 (Space) — ${this.game.lastSpeed}×로` : '정지 (Space)';
    document.querySelectorAll<HTMLButtonElement>('#topbar [data-speed]').forEach((btn) => {
      btn.classList.toggle('active', Number(btn.dataset.speed) === this.game.speed);
    });
    $('btn-map').classList.toggle('active', this.game.mapShown);
    $('layers').hidden = !w.regional;
    this.topbar.setLayersShown(w.regional);
    if (!w.regional) this.game.input.layer = 'base';
    document.querySelectorAll<HTMLElement>('#layers [data-layer]').forEach((b) => b.classList.toggle('active', b.dataset.layer === this.game.input.layer));
    // 열린 창 버튼 (같은 묶음 안에서만 금빛)
    for (const [btn, id] of [['btn-stats', 'stats'], ['btn-goals', 'goals'], ['btn-ach', 'ach'], ['btn-research', 'research']] as const) {
      $(btn).classList.toggle('active', !$(id).hidden);
    }
    $('btn-codex').classList.toggle('active', this.codex.isOpen);
    // 지금 재료로 할 수 있는 연구가 있으면 작은 점 (고르지는 않는다)
    const ready = w.techs.some((tc) => !w.researched.has(tc.id) && w.canResearch(tc.id).ok);
    $('btn-research').querySelector<HTMLElement>('.dot')!.hidden = !ready;
    $('btn-research').title = ready ? '연구: 지금 할 수 있는 연구가 있어요 (T)' : '연구: 새 건물·레시피 해금 (T)';
    this.updateNet();
    // 되돌리기 버튼: 이력이 없어도 같은 자리에 비활성으로. 누르면 무엇이 바뀌는지 설명에 적어 둔다
    for (const [id, redo, name, none] of [
      ['btn-undo', false, '되돌리기 (Ctrl+Z)', '되돌릴 작업 없음'],
      ['btn-redo', true, '다시 실행 (Ctrl+Y)', '다시 실행할 작업 없음'],
    ] as const) {
      const next = w.nextEdit(redo, this.game.me);
      const btn = $<HTMLButtonElement>(id);
      btn.disabled = !next;
      btn.title = next ? `${name}: ${describeEdit(next)}` : `${name} · ${none}`;
    }

    this.toolbar.update(w);

    this.updateHolding(w);
    this.updatePower(w);
    this.updateStock(w);
    this.updateOreAlerts(w);
    this.updateGuide(w);
    this.updateInfo(w);
    if (!$('research').hidden) this.updateResearch(w);
    this.sampleStock(w);
    if (!$('stats').hidden) this.updateStatsPanel(w);
    if (!$('ach').hidden) this.updateAchPanel(w);
    if (!$('goals').hidden) this.updateGoalsPanel(w);
    this.achNotify(w);
    this.updateTooltip(w);
    this.codex.refresh();
    // 좁은 화면(900px 미만)에서는 선택 상세가 열리면 왼쪽 판을 접어 한 판만 보인다
    document.body.classList.toggle('one-panel', this.topbar.mode !== 'wide' && !$('info').hidden);
  }

  /**
   * 툴바 위 상세 줄: 든 건물(또는 막힌 건물)의 이름·크기·전력·건설 상태·막힌 이유만.
   * 회전·취소 같은 조작 안내는 도움말(H)에 있어 여기서는 뺀다
   */
  private updateHolding(w: World): void {
    const el = $('holding');
    const input = this.game.input;
    let html = '';
    let blocked = false;
    if (input.paste) html = `<b>복사한 건물 ${input.paste.entries.length}개</b> 붙여넣는 중`;
    else if (input.tool || input.blocked) {
      const type = (input.tool ?? input.blocked!.type) as BuildingType;
      const def = BUILDINGS[type];
      const s = input.tool ? input.toolSetting : null;
      const label = !s
        ? ''
        : type === 'station'
          ? STATION_MODE_NAME[s as StationMode]
          : type === 'sorter' || type === 'unloader'
            ? ITEMS[s as ItemId].name
            : (RECIPES[s]?.name ?? '');
      const state = buildState(w, type);
      const head = `<b>${def.name}</b>${label ? ` (${label})` : ''} · ${def.size}×${def.size}${def.power ? ` · 전력 ${def.power}kW` : ''}`;
      if (state === 'ok') html = `${head} · <span class="ok">✓ 건설 가능</span>`;
      else {
        blocked = true;
        html = `${head} · <span class="no">${state === 'locked' ? `${lockIcon()}연구 잠김` : '⚠ 재료 부족'}</span> · ${blockReason(w, type, state)}${
          state === 'locked' ? ' <button data-act="open-research">연구 보기 <kbd>T</kbd></button>' : ''
        }`;
      }
    }
    el.hidden = !html;
    el.classList.toggle('blocked', blocked);
    if (html && el.innerHTML !== html) el.innerHTML = html;
  }

  /**
   * 전력 부족이 새로 시작되면 한 번만 소리. 기계가 한꺼번에 돌기 시작해 잠깐 모자란 것은 넘기고(2초),
   * 5초 넘게 넉넉해야 부족이 끝난 것으로 본다. 1분 안에 또 모자라면 조용히
   */
  private powerSound(w: World): void {
    const now = performance.now() / 1000;
    const short = w.power.satisfaction < 1;
    const s = this.powerAlarm;
    if (s.world !== w) {
      // 새 게임·불러오기·방 참가 직후에 이미 모자라던 것은 조용히
      Object.assign(s, { world: w, short, since: now, warned: short });
      return;
    }
    if (short !== s.short) Object.assign(s, { short, since: now });
    const held = now - s.since;
    if (short && !s.warned && held >= 2) {
      s.warned = true;
      if (now - s.at >= 60) {
        s.at = now;
        sound.play('power');
      }
    }
    if (!short && held >= 5) s.warned = false;
  }

  private updatePower(w: World): void {
    this.powerSound(w);
    if (w.regional) return this.updateZones(w);
    const p = w.power;
    const pct = Math.round(p.satisfaction * 100);
    const color = p.satisfaction >= 1 ? '#3f8a3a' : p.satisfaction >= 0.6 ? '#b7791f' : '#c0392b';
    // 어디서 오는 전력인지: 허브 · 태양광 · 풍력 (지금 내는 만큼) · 수력 · 석탄 (돌 수 있는 최대치)
    const src = { solar: 0, wind: 0, hydro: 0, coal: 0 };
    for (const b of w.buildings.values()) {
      if (b.type === 'solar') src.solar += b.load;
      else if (b.type === 'wind') src.wind += b.load;
      else if (b.type === 'hydro' && (b.fuel > 0 || b.energy > 0)) src.hydro += HYDRO_POWER;
      else if (b.type === 'generator' && (b.fuel > 0 || b.energy > 0)) src.coal += GENERATOR_POWER;
    }
    const parts = [`허브 ${HUB_BASE_POWER}`];
    if (src.solar) parts.push(`태양광 ${Math.round(src.solar)}`);
    if (src.wind) parts.push(`풍력 ${Math.round(src.wind)}`);
    if (src.hydro) parts.push(`수력 ${src.hydro}`);
    if (src.coal) parts.push(`석탄 ${src.coal}`);
    $('power').innerHTML = `
      <h3>전력</h3>
      <div class="bar" title="전력 충족률"><div style="width:${Math.min(100, pct)}%;background:${color}"></div></div>
      <div class="row"><span>수요 / 용량</span><b>${Math.round(p.demand)} / ${Math.round(p.capacity)} kW</b></div>
      <div class="row"><span>전력 충족</span><b style="color:${color}">${pct}%</b></div>
      ${parts.length > 1 ? `<p class="muted power-src">${parts.join(' · ')} kW</p>` : ''}
      ${p.charge > 0 ? `<p class="muted power-src">충전 수요 ${Math.round(p.charge)} kW</p>` : ''}`;
  }

  /** 컨베이어: 이 줄에 올라 있는 아이템과, 잘못 들어간 것만 빼는 버튼 (기계가 막혔을 때) */
  private lineBlock(w: World, b: Building): string {
    const items = w.lineItems(b);
    if (!items.size) return '<p class="muted">이 줄에 올라 있는 아이템이 없어요.</p>';
    const rows = [...items]
      .map(([i, n]) => `<div class="row"><span>${itemIcon(i)}${ITEMS[i].name} <span data-line-count="${i}">${n}</span>개</span><button data-line-take="${i}" title="이어진 줄 전체에서 이 아이템만 빼서 가까운 창고(없으면 허브)로">빼기</button></div>`)
      .join('');
    return `<div class="line-items"><b>이 줄의 아이템</b>${rows}<small class="muted">빼기: 연결된 줄 전체에서 해당 품목 회수</small></div>`;
  }

  /** 회수 더미를 바로 줍는다 (가까운 창고·정류장, 없으면 허브). 주운 자리에 "+아이콘 개수"가 떠오른다 */
  pickPile(tile: number, sx: number, sy: number): void {
    const items = [...this.game.getWorld().pileAt(tile)];
    this.sendUse(`pile:${tile}`, { t: 'pile-collect', rid: newRid(), tile }, () => this.floatGain(sx, sy, items));
  }

  /** 얻은 것을 그 자리에서 위로 떠오르며 사라지게 (화면 좌표) */
  private floatGain(sx: number, sy: number, items: [ItemId, number][]): void {
    const el = document.createElement('div');
    el.className = 'gain-float';
    el.style.left = `${sx}px`;
    el.style.top = `${sy}px`;
    el.innerHTML = items
      .slice(0, 4)
      .map(([i, n]) => `<div>+${itemIcon(i)}${n}</div>`)
      .join('') + (items.length > 4 ? `<div>+${items.length - 4}종</div>` : '');
    document.body.appendChild(el);
    sound.play('click');
    setTimeout(() => el.remove(), 1400);
  }

  /** regional-v1: 지도에 있는 땅마다 지금 날씨와 영향 (화면 가운데 땅을 굵게). 예보는 없다 */
  private terrainWeatherTable(w: World): string {
    if (this.terrainKinds.world !== w) this.terrainKinds = { world: w, kinds: [...new Set(w.terrain ? [...w.terrain] : [])].sort((a, b) => a - b).map((i) => TERRAIN_IDS[i]) };
    const cam = this.game.center;
    const here = w.terrainAt(w.idx(Math.max(0, Math.min(w.width - 1, Math.floor(cam.x))), Math.max(0, Math.min(w.height - 1, Math.floor(cam.y)))));
    const sun = 1 - darkness(w.time);
    const rows = this.terrainKinds.kinds
      .map((t) => {
        const lw = w.localWeather(t);
        const fx = lw.fx;
        const solar = Math.round(SOLAR_POWER * sun * TERRAIN[t].solar * fx.solar);
        const wind = Math.round(fx.wind * TERRAIN[t].wind);
        const cell = (s: string) => (t === here ? `<b>${s}</b>` : s);
        return `<tr><td>${cell(TERRAIN[t].name)}</td><td>${LOCAL_WEATHER_ICON[lw.kind]} ${cell(LOCAL_WEATHER_LABEL[lw.kind])}</td><td>${solar}</td><td>${wind}</td><td>×${fx.truck.toFixed(2)}</td></tr>`;
      })
      .join('');
    return `<table class="stats-table"><thead><tr><th>땅</th><th>날씨</th><th>태양광 kW</th><th>풍력 kW</th><th>트럭</th></tr></thead><tbody>${rows}</tbody></table>
      <p class="muted">발전기 한 대 기준 지금 출력이에요. 굵은 줄이 화면 가운데 땅이고, 발전기별 날씨는 전력 보기(Shift+2)에서 보여요.</p>`;
  }
  private terrainKinds: { world: World | null; kinds: TerrainKind[] } = { world: null, kinds: [] };

  /** regional-v1: 화면 가운데 지형의 지금 날씨 (예보 없이 지금 영향만) */
  private regionalSky(w: World): { icon: string; text: string } {
    const cam = this.game.center;
    const x = Math.max(0, Math.min(w.width - 1, Math.floor(cam.x)));
    const y = Math.max(0, Math.min(w.height - 1, Math.floor(cam.y)));
    const t = w.terrainAt(w.idx(x, y));
    const lw = w.localWeather(t);
    const base = dayLabel(w.time);
    const icon = lw.kind === 'clear' ? base.icon : LOCAL_WEATHER_ICON[lw.kind];
    const fx = lw.fx;
    return {
      icon,
      text: `${TERRAIN[t].name} · ${LOCAL_WEATHER_LABEL[lw.kind]} (트럭 ×${fx.truck.toFixed(2)} · 태양광 ×${fx.solar.toFixed(2)} · 풍력 ${Math.round(fx.wind * TERRAIN[t].wind)}kW/대) · ${base.text}`,
    };
  }

  /** regional-v1: 전력망마다 요청·공급·축전·충전 (누르면 그 망의 첫 노드로). 일하는 망부터 */
  private updateZones(w: World): void {
    const kw = (n: number) => Math.round(n).toLocaleString();
    const nets = [...w.netState.entries()]
      .filter(([, s]) => s.demand + s.charge > 0 || s.storeMax > 0)
      .sort(([a, p], [b, q]) => q.demand + q.charge - (p.demand + p.charge) || a - b);
    const hubNet = w.hub ? w.netOf(w.hub) : 0;
    const shown = nets.slice(0, 6);
    const rows = shown
      .map(([id, s]) => {
        const sat = s.satisfaction;
        const color = !s.source ? '#7a7a7a' : sat >= 1 ? '#3f8a3a' : sat >= 0.6 ? '#b7791f' : '#c0392b';
        const need = s.demand + s.charge;
        const extra = [
          s.storeMax ? `축전 ${(s.stored / 1000).toFixed(1)}/${s.storeMax / 1000}MJ` : '',
          s.charge ? `충전 수요 ${kw(s.charge)} kW` : '',
          s.sites.length > 1 ? `거점 ${s.sites.length}곳 공유` : s.sites.length ? `거점 ${s.sites[0]}` : '',
        ].filter(Boolean);
        return `<div class="zone-row" data-net="${id}" title="누르면 이 망으로">
          <div class="row"><span>전력망 ${id} <span class="muted">${id === hubNet ? '허브' : s.source ? '' : '공급원 없음'}</span></span><b style="color:${color}" title="전력 충족률">충족 ${Math.round(sat * 100)}%</b></div>
          <div class="bar" title="전력 충족률"><div style="width:${Math.min(100, sat * 100)}%;background:${color}"></div></div>
          <p class="muted power-src">수요 ${kw(need)} / 용량 ${kw(s.capacity)} kW${extra.length ? ` · ${extra.join(' · ')}` : ''}</p></div>`;
      })
      .join('');
    $('power').innerHTML = `<h3>전력 <span class="muted">일하는 망 ${nets.length}개 · 거점 ${w.zones.length}곳</span></h3>${rows}
      ${nets.length > shown.length ? `<p class="muted power-src">외 ${nets.length - shown.length}개 망</p>` : ''}
      ${!nets.length ? '<p class="muted power-src">전기를 사용하는 설비가 없어요.</p>' : ''}`;
  }

  private updateStock(w: World): void {
    // 회수 더미: 전력과 따로 작은 칸 (누르면 더미로, 누를 때마다 다음 곳)
    const piles = w.pileTiles();
    let pileN = 0;
    for (const n of piles.values()) pileN += n;
    $('piles').hidden = !piles.size;
    const pileHtml = piles.size ? `<p class="power-src" data-piles title="누를 때마다 다음 회수 더미로">📦 회수 대기 ${piles.size}곳 · ${pileN}개</p>` : '';
    if ($('piles').innerHTML !== pileHtml) $('piles').innerHTML = pileHtml;
    // 허브 재고: 처음엔 STOCK_FOLD개만, 펼치면 전부 (들어오는 속도가 있는 것부터)
    const items = ITEM_IDS.filter((i) => w.stockOf(i) > 0 || w.incomePerMinute(i) > 0);
    const shown = this.stockOpen ? items : items.slice(0, STOCK_FOLD);
    const rows = shown
      .map((i) => {
        const rate = w.incomePerMinute(i);
        return `<div class="row stock-row" data-item="${i}" title="클릭: 도감">${itemIcon(i)}<span>${ITEMS[i].name}</span><b>${w.stockOf(i)}</b><em>${rate ? `+${rate}/분` : ''}</em></div>`;
      })
      .join('');
    // 펼치기·접기는 제목 줄에 (펼친 뒤 접으려고 맨 아래까지 내려가지 않게)
    const more = items.length > STOCK_FOLD ? `<button class="stock-more" data-stock-toggle>${this.stockOpen ? '접기 ▲' : `펼치기 ▼ +${items.length - STOCK_FOLD}`}</button>` : '';
    $('stock').innerHTML = `<h3 class="stock-head">허브 재고 <small class="muted">${items.length}종</small>${more}</h3>${rows || '<p class="muted">비어 있음</p>'}`;
  }
  private stockOpen = false;

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
      sound.play('ore');
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

  /**
   * 확장 세계의 메인 목표 카드: 장 이름 · 지금 목표 · 확인 항목(최대 3) · 안내. 판정은 시뮬레이션(goals.ts)이 한다
   */
  private updateMainGoals(w: World): void {
    const done = MAIN_GOALS.filter((g) => w.goals.has(g.id)).length;
    if (w !== this.guideWorld) this.finaleShown = w.goals.has('MG36');
    // 새로 이룬 목표만 알린다 (불러오거나 방에 들어가 한꺼번에 채워질 때는 조용히)
    if (w === this.guideWorld && done > this.goalCount) {
      const last = MAIN_GOALS.filter((g) => w.goals.has(g.id)).at(-1);
      if (w.goals.has('MG36') && !this.finaleShown) this.showFinale(w);
      else if (last) this.notice(`목표 달성: ${last.title}`);
    }
    // 지역 과제를 마쳐 새 땅이 열렸으면 알린다
    const stage = currentStage(w);
    if (w === this.guideWorld && stage > this.stageCount) {
      const opened = REGION_STAGES.slice(this.stageCount, stage).flatMap((s) => siteLabels(s.opens));
      this.notice(`${mapIcon()} 새 지역이 열렸어요`, opened.join(', '));
    }
    this.stageCount = stage;
    this.goalCount = done;
    this.guideWorld = w;
    const cur = currentGoal(w);
    this.applyGuideFocus(w, cur ? goalFocus(w, cur) : null);
    const pct = Math.round((done / MAIN_GOALS.length) * 100);
    const head = `<h3>메인 목표 <small>${done}/${MAIN_GOALS.length}</small></h3><div class="gbar"><i style="width:${pct}%"></i></div>`;
    const g = currentGoal(w);
    if (!g) {
      $('guide').innerHTML = `${head}<p class="muted">공장망 완성! 지도는 계속 운영할 수 있어요. 끝없는 연구와 거점 확장을 이어 가 보세요.</p>`;
      return;
    }
    const checks = g.checks(w)
      .slice(0, 3)
      .map(([label, have, need, hint]) => {
        const ok = have >= need;
        return `<li class="${ok ? 'done' : ''}"><span class="mark">${ok ? '✓' : '·'}</span>${this.checkIcon(w, hint)}${label} <b>${Math.min(have, need).toLocaleString()}/${need.toLocaleString()}</b></li>`;
      })
      .join('');
    // 이 목표의 자원이 아직 안 열린 땅에 있으면: 지역 과제부터
    const need = goalNeedsStage(w, g);
    const html = `${head}
      <div class="now"><small class="muted">${g.chapter} · ${g.id}</small><b>${g.title}</b><p>${withBuildingIcons(g.hint)}</p></div>
      <ul class="steps">${checks}</ul>
      ${need ? `<p class="reward">${mapIcon()} 다음 지역이 필요해요: 아래 "${need.name}" 지역 과제 ${need.tasks.filter((t) => w.challenges.has(t.id)).length}/${REGION_NEED}</p>` : ''}
      ${this.regionHtml(w)}${this.trackedAchHtml(w)}`;
    // 선택 도전 목록을 펼친 동안 다시 그리면 목록이 바로 닫힌다: 고르는 중이면 그대로 둔다
    if (html === this.guideHtml || $('guide').contains(document.activeElement) && document.activeElement instanceof HTMLSelectElement) return;
    this.guideHtml = html;
    $('guide').innerHTML = html;
  }
  private guideHtml = '';

  /**
   * 지금 지역의 과제 셋 (이름·진행률), 그중 REGION_NEED개를 이루면 보상으로 다음 땅이 열린다.
   * 줄을 누르면 그 과제의 세부가 펼쳐진다 (펼친 것은 이 PC에만 기억)
   */
  private regionHtml(w: World): string {
    if (!w.revealed) return '';
    const i = currentStage(w);
    const s = REGION_STAGES[i];
    if (!s) return '<p class="muted">지역 과제를 모두 마쳐 지도 전체가 열렸어요.</p>';
    const open = this.trackedChallenge();
    const pct = (c: (typeof s.tasks)[number]) => {
      const cs = c.checks(w);
      return Math.round((cs.reduce((a, [, have, need]) => a + Math.min(1, need ? have / need : 1), 0) / Math.max(1, cs.length)) * 100);
    };
    const got = s.tasks.filter((t) => w.challenges.has(t.id)).length;
    const rows = s.tasks.map((c) => {
      const done = w.challenges.has(c.id);
      const head = `<li class="chal ${done ? 'done' : ''} ${c.id === open ? 'open' : ''}" data-chal="${c.id}" title="눌러서 자세히">
        <span class="mark">${done ? '✓' : c.id === open ? '▾' : '▸'}</span>${c.title} <b>${done ? '완료' : `${pct(c)}%`}</b></li>`;
      if (c.id !== open) return head;
      const detail = c
        .checks(w)
        .map(([label, have, need, hint]) => `<li class="sub ${have >= need ? 'done' : ''}"><span class="mark">${have >= need ? '✓' : '·'}</span>${this.checkIcon(w, hint)}${label} <b>${Math.min(have, need).toLocaleString()}/${need.toLocaleString()}</b></li>`)
        .join('');
      return `${head}<li class="sub muted">${c.hint}</li>${detail}`;
    }).join('');
    return `<div class="row"><span>지역 과제 · ${s.name} <small class="muted">셋 중 ${REGION_NEED}개</small></span><b>${got}/${REGION_NEED}</b></div>
      <ul class="steps chals">${rows}</ul>
      <p class="reward">보상: ${mapIcon()} ${siteLabels(s.opens).join(', ')}</p>`;
  }

  private trackedChallenge(): string {
    try {
      return localStorage.getItem('automation-challenge') ?? '';
    } catch {
      return '';
    }
  }

  /** 추적 중인 업적 id (이 PC에만 기억) */
  private trackedAch(): string {
    try {
      return localStorage.getItem('automation-ach-track') ?? '';
    } catch {
      return '';
    }
  }

  /** 새로 얻은 업적을 한 알림으로 묶어 알린다 (불러오기·방 들어가기로 한꺼번에 채워질 때는 조용히) */
  private achNotify(w: World): void {
    const got = new Set<string>([...w.ach.done.keys(), ...[...w.ach.medals].map(([id, n]) => `${id}:${n}`)]);
    if (this.achSeen.world === w) {
      const fresh = [...got].filter((k) => !this.achSeen.got.has(k));
      if (fresh.length) {
        const names = fresh.map((k) => {
          const [id, n] = k.split(':');
          const a = ACH_BY_ID[id];
          // 누르면 업적 창에서 그 업적으로
          return a ? `<a data-ach="${a.id}" title="눌러서 업적 보기">${a.name}${n ? ` ${MEDAL[Number(n) - 1]}` : ''}</a>` : k;
        });
        this.notice(`🏅 업적: ${names.slice(0, 3).join(', ')}${names.length > 3 ? ` 외 ${names.length - 3}개` : ''}`);
      }
    }
    this.achSeen = { world: w, got };
  }

  /** 업적 하나의 진행 막대·설명 (숨은 업적은 달성 전 힌트만) */
  private achCard(w: World, a: AchDef, tracked: string): string {
    const done = w.ach.done.has(a.id);
    const level = w.ach.medals.get(a.id) ?? 0;
    if (a.kind === 'hidden' && !done) {
      return `<div class="tech locked"><h4><span class="ticon">❔</span>???</h4><p>${a.hint}</p></div>`;
    }
    let body = '';
    if (tiered(a)) {
      const v = a.value!(w);
      const next = level < 4 ? a.tiers![level] : null;
      const medals = a.tiers!.map((t, i) => `<span title="${t.toLocaleString()}${a.unit}" style="opacity:${i < level ? 1 : 0.25}">${MEDAL[i]}</span>`).join('');
      body = `<div class="row"><span>${medals}</span><b>${next !== null ? `${fmtNum(Math.min(v, next))} / ${next.toLocaleString()}${a.unit}` : '모두 얻음'}</b></div>`;
      if (next !== null) body += `<div class="bar"><div style="width:${Math.min(100, (v / next) * 100)}%"></div></div>`;
      if (a.sustain && next !== null) {
        const secs = sustainedSecs(w, a);
        body += `<small class="muted">조건 충족 누적 ${secs}/${a.sustain}초${v < next && secs > 0 ? ' · 잠시 멈춤 (누적은 그대로)' : ''}</small>`;
      }
      body += this.recordNote(w, a);
    }
    const state = tiered(a) ? (level >= 4 ? 'done' : level > 0 ? 'open' : 'locked') : done ? 'done' : 'open';
    const canTrack = a.kind !== 'hidden' && !(done || level >= 4);
    return `<div class="tech ${state}" data-ach-id="${a.id}">
      <h4><span class="ticon">${a.kind === 'hidden' ? '🌟' : done || level >= 4 ? '🏅' : '·'}</span>${a.name} <small class="muted">${a.code ?? a.id} · ${a.area}</small></h4>
      <p>${a.desc}</p>${body}
      ${canTrack ? `<button data-achtrack="${a.id}">${tracked === a.id ? '추적 그만' : '추적'}</button>` : done ? '<div class="badge">완료</div>' : ''}
    </div>`;
  }

  /** 기록의 지금 값 (속도는 최근 60초와 측정 중, 전력은 마지막 1초 평균). 메달 판정 값은 지금까지의 최고 */
  private recordNote(w: World, a: AchDef): string {
    const i = Q60_ITEMS.findIndex((item) => a.id === `record-v1/q60/${item}`);
    if (i >= 0) {
      const n = w.ach.q60Measured();
      return `<small class="muted">${n < 60 ? `측정 중 ${n}/60초` : `최근 60초 ${w.ach.q60Now[i]}개`} · 최고 ${w.ach.q60Best[i]}개</small>`;
    }
    if (a.id === 'record-v1/factory/work-power') return `<small class="muted">마지막 1초 평균 ${Math.round(w.ach.workLast)}kW · 최고 ${Math.round(w.ach.workBest)}kW</small>`;
    return '';
  }

  /** 업적 창: 최초 / 심화 / 기록 / 숨은 탭, 분야·미달성 필터, 가까운 순 정렬, 공개 완료율과 숨은 발견 수 */
  private updateAchPanel(w: World): void {
    const now = performance.now();
    const key = `${this.achTab}|${this.achTodo}|${this.achArea}|${this.achSort}|${w.ach.done.size}|${[...w.ach.medals.values()].join('')}`;
    const modal = $('ach');
    const focused = modal.contains(document.activeElement) ? document.activeElement as HTMLElement : null;
    // 열린 필터 목록을 주기 갱신으로 닫지 않는다. 필터를 실제로 바꾼 경우(key 변경)는 즉시 반영한다.
    if (key === this.achKey && (now - this.achAt < 1000 || focused instanceof HTMLSelectElement)) return;
    const scroll = modal.querySelector('.panel')?.scrollTop ?? 0;
    const focusAttr = ['data-achf', 'data-achtab', 'data-achtrack'].find((attr) => focused?.hasAttribute(attr));
    const focusValue = focusAttr ? focused!.getAttribute(focusAttr) : null;
    this.achKey = key;
    this.achAt = now;
    const all = activeAchievements(w);
    const tracked = this.trackedAch();
    const [have, total] = achProgress(w);
    const hiddenAll = all.filter((a) => a.kind === 'hidden');
    const hiddenGot = hiddenAll.filter((a) => w.ach.done.has(a.id)).length;
    const tabs = (['first', 'deep', 'record', 'hidden'] as AchKind[])
      .map((t) => `<button data-achtab="${t}" class="${t === this.achTab ? 'active' : ''}">${ACH_TAB[t]} <small>${all.filter((a) => a.kind === t).length}</small></button>`)
      .join('');
    const isDone = (a: AchDef) => (tiered(a) ? (w.ach.medals.get(a.id) ?? 0) >= 4 : w.ach.done.has(a.id));
    const closeness = (a: AchDef) => {
      if (!tiered(a)) return w.ach.done.has(a.id) ? -1 : 0;
      const level = w.ach.medals.get(a.id) ?? 0;
      return level >= 4 ? -1 : a.value!(w) / a.tiers![level];
    };
    let list = all.filter((a) => a.kind === this.achTab && (!this.achArea || a.area === this.achArea) && (!this.achTodo || !isDone(a)));
    if (this.achSort && this.achTab !== 'hidden') list = [...list].sort((x, y) => closeness(y) - closeness(x));
    const areas = ['생산', '물류', '전력', '지역', '숲'].map((x) => `<option ${x === this.achArea ? 'selected' : ''}>${x}</option>`).join('');
    $('ach').innerHTML = `<div class="panel"><header><h2>업적</h2><button class="x" data-act="close-modal">×</button></header>
      <p class="muted">공개 업적 ${have}/${total} 기록 (${total ? Math.round((have / total) * 100) : 0}%) · 숨은 업적 발견 ${hiddenGot}/${hiddenAll.length}${w.regional ? '' : ' · 지역 생산망 확장 지도에서는 업적이 더 있어요'}.
        보상은 기록과 메달뿐이에요 (생산 보너스 없음).</p>
      <div class="rtabs">${tabs}</div>
      <div class="line">
        <label><input type="checkbox" data-achf="todo" ${this.achTodo ? 'checked' : ''}> 아직 못 얻은 것만</label>
        <select data-achf="area"><option value="">모든 분야</option>${areas}</select>
        ${this.achTab !== 'hidden' ? `<select data-achf="sort"><option value="">순서대로</option><option value="near" ${this.achSort ? 'selected' : ''}>다음 단계가 가까운 순</option></select>` : ''}
      </div>
      <div class="techs">${list.map((a) => this.achCard(w, a, tracked)).join('') || '<p class="muted">해당하는 업적이 없어요.</p>'}</div></div>`;
    modal.querySelector('.panel')!.scrollTop = scroll;
    if (focusAttr && focusValue !== null) modal.querySelector<HTMLElement>(`[${focusAttr}="${CSS.escape(focusValue)}"]`)?.focus({ preventScroll: true });
    // 알림에서 연 업적: 반짝이고, 처음 한 번 그 카드로 스크롤
    if (this.achFocus) {
      const card = $('ach').querySelector<HTMLElement>(`[data-ach-id="${CSS.escape(this.achFocus)}"]`);
      card?.classList.add('guide-pulse');
      if (card && this.achScroll) {
        this.achScroll = false;
        card.scrollIntoView({ block: 'center' });
      }
    }
  }

  /** 업적 하나를 업적 창에서 보여 준다 (그 탭으로, 필터를 풀고) */
  private openAch(id: string): void {
    const a = ACH_BY_ID[id];
    if (!a) return;
    if ($('ach').hidden) this.toggleModal('ach');
    this.achTab = a.kind;
    this.achTodo = false;
    this.achArea = '';
    this.achFocus = id;
    this.achScroll = true;
    this.achKey = '';
    this.update();
  }
  private achFocus: string | null = null;
  private achScroll = false;

  /** 목표 카드 아래: 추적 중인 업적 한 줄 */
  private trackedAchHtml(w: World): string {
    const id = this.trackedAch();
    const a = id ? ACH_BY_ID[id] : undefined;
    if (!a || !activeAchievements(w).includes(a)) return '';
    if (tiered(a)) {
      const level = w.ach.medals.get(a.id) ?? 0;
      if (level >= 4) return '';
      const v = a.value!(w);
      return `<p class="muted">🏅 추적: ${a.name} ${MEDAL[level]} ${fmtNum(Math.min(v, a.tiers![level]))}/${a.tiers![level].toLocaleString()}${a.unit}${a.sustain ? ` · 누적 ${sustainedSecs(w, a)}/${a.sustain}초` : ''}</p>`;
    }
    return w.ach.done.has(a.id) ? '' : `<p class="muted">🏅 추적: ${a.name} · ${a.desc}</p>`;
  }

  /** 최종 납품을 마쳤을 때 한 번: 공장망 요약과 계속 건설 */
  private showFinale(w: World): void {
    this.finaleShown = true;
    this.notice('공장망 완성', '<p>설비 모듈 50/50 납품</p>' + completionSummary(w) + '<div class="completion-actions"><button data-continue>계속 건설</button><button data-completion-record>완료 기록 보기</button></div>', 8000, 'finale');
  }

  private updateGuide(w: World): void {
    if (w.regional) return this.updateMainGoals(w);
    // 이룬 목표는 저장에 남긴다 (생산이 잠깐 멈춰도, 불러온 뒤에도 앞 목표로 돌아가지 않게)
    let reached = false;
    for (const s of GUIDE) {
      if (w.guideDone.has(s.title) || !s.done(w)) continue;
      w.guideDone.add(s.title);
      reached = true;
    }
    // 같은 공장에서 새로 이룬 목표만 알린다 (불러오거나 방에 들어가 한꺼번에 채워질 때는 조용히)
    if (reached && w === this.guideWorld) sound.play('goal');
    this.guideWorld = w;
    const done = GUIDE.filter((s) => w.guideDone.has(s.title)).length;
    const pct = Math.round((done / GUIDE.length) * 100);
    const head = `<h3>목표 <small>${done}/${GUIDE.length}</small></h3><div class="gbar"><i style="width:${pct}%"></i></div>`;
    const cur = GUIDE.findIndex((s) => !w.guideDone.has(s.title));
    this.applyGuideFocus(w, cur < 0 ? null : (GUIDE[cur].focus?.(w) ?? null));
    if (cur < 0) {
      $('guide').innerHTML = `${head}<p class="muted">모든 목표 달성! 끝없는 연구(T)로 자유롭게 공장을 키워 보세요.</p>`;
      return;
    }
    const now = GUIDE[cur];
    // 마침표마다 줄을 바꾼다 ("1.5배"처럼 숫자 사이 점은 그대로)
    const hint = withBuildingIcons(now.hint).split(/(?<=[.!?])\s+/).join('<br>');
    // 진행도: 바로 앞 목표 2개(끝남, 빗금) · 지금 · 다음 2개
    const steps = GUIDE.slice(Math.max(0, cur - 2), cur + 3)
      .map((s) => {
        const ok = w.guideDone.has(s.title);
        const cls = s === now ? 'cur' : ok ? 'done' : '';
        return `<li class="${cls}"><span class="mark">${s === now ? '▶' : ok ? '✓' : '·'}</span>${s.title}</li>`;
      })
      .join('');
    $('guide').innerHTML = `${head}
      <div class="now"><b>${now.title}</b><p>${hint}</p></div>
      <ul class="steps">${steps}</ul>${this.trackedAchHtml(w)}`;
  }

  /**
   * 지금 목표가 가리키는 것을 반짝인다: 툴바 탭·건물 버튼, 연구 버튼(창이 열리면 탭·카드는 updateResearch에서),
   * 건물을 들면 놓을 곳을 맵에 (guideMark → main.ts가 핑처럼 그린다)
   */
  private applyGuideFocus(w: World, f: GuideFocus | null): void {
    this.guideFocus = f;
    this.toolbar.setGuide(f?.build && w.unlockedBuildings.has(f.build) ? f.build : null);
    $('btn-research').classList.toggle('guide-pulse', !!f?.research && $('research').hidden === true);
    const holding = !f?.build || this.game.input.tool === f.build;
    this.guideMark = f?.target && holding ? findTarget(w, f.target) : null;
  }

  // ───────────────────────── 정보창 ─────────────────────────

  private updateInfo(w: World): void {
    const el = $('info');
    if (this.infoWorld !== w) {
      this.infoWorld = w;
      this.infoKey = '';
      this.planRows.clear();
      delete el.dataset.transportContext;
      delete el.dataset.transportPlanVersion;
    }
    const v = this.selectedVehicle();
    if (v) {
      this.updateVehicleInfo(w, v);
      return;
    }
    const group = this.multiSelected(w);
    if (group.length > 1) {
      this.updateMultiInfo(w, group);
      return;
    }
    // 철거 등으로 하나만 남으면 그 건물 하나를 고른 것으로
    if (this.game.input.multi.length) {
      this.game.input.multi = [];
      if (group.length) this.game.input.selectedId = group[0].id;
    }
    const b = this.selected();
    if (!b && this.game.input.paste) {
      this.updatePasteInfo(this.game.input.paste, this.game.input.pasteName);
      return;
    }
    if (!b) {
      el.hidden = true;
      this.infoKey = '';
      return;
    }
    el.hidden = false;
    // 하역기는 붙은 창고·허브에 든 아이템 종류가 바뀌면 고르는 목록도 다시 만든다
    const src = b.type === 'unloader' ? unloaderSource(w, b) : null;
    let srcKey = src ? `${src.id}:${sourceItems(w, src).join(',')}` : '';
    // 뒤 칸이 회수 더미인 하역기: 더미가 바뀌면 다시
    if (b.type === 'unloader' && !src && w.piles.length && w.inBounds(b.x - DX[b.dir], b.y - DY[b.dir])) {
      srcKey = `pile:${[...w.pileAt(w.idx(b.x - DX[b.dir], b.y - DY[b.dir]))].join(',')}`;
    }
    // 분류기는 줄 끝 기계나 흐르는 아이템이 바뀌면 고르는 목록을 다시 만든다
    if (b.type === 'sorter') {
      const up = w.upstream(b);
      srcKey = `${up.items.join(',')}:${up.sources.map((s) => s.id).join(',')}`;
    }
    // 레시피 기계는 들어오는 재료가 바뀌면 레시피 목록 순서를 다시 만든다
    if (isRecipeMachine(b.type)) srcKey = incomingItems(w, b).join(',');
    // 컨베이어는 줄에 오른 아이템 종류가 바뀌면 빼기 버튼을 다시 (개수만 바뀔 때는 그대로 두어 누르는 중에 사라지지 않게)
    const lineItems = isLineType(b.type) ? w.lineItems(b) : null;
    if (lineItems) srcKey = [...lineItems.keys()].join(',');
    // 정류장은 트럭 목록과 "트럭 만들기" 버튼 상태가 바뀌면 다시 만든다
    if (b.type === 'station') {
      srcKey = `${b.stationMode}:${w
        .trucksOf(b)
        .map((t) => `${t.id}${t.stops.map((st) => st.id + st.act).join('-')}`)
        .join(',')}:${w.canBuildTruck(b).reason ?? ''}`;
    }
    const key = `${b.id}|${b.recipe}|${b.filter}|${w.unlockedRecipes.size}|${srcKey}|${this.useSig(w, b)}|${b.type === 'hub' ? `${w.stats.projectOn}${w.stats.projectDelivered}${w.researched.size}` : ''}`;
    if (key !== this.infoKey) {
      this.infoKey = key;
      replaceTransportInfo(el, this.infoStatic(w, b), `building:${b.id}`);
    }
    el.querySelector('.dyn')!.innerHTML = this.infoDynamic(w, b);
    this.updateRoadBuilder(w, b);
    if (lineItems) el.querySelectorAll<HTMLElement>('[data-line-count]').forEach((s) => {
      s.textContent = String(lineItems.get(s.dataset.lineCount as ItemId) ?? 0);
    });
    const stationPower = el.querySelector('.station-power');
    if (stationPower) stationPower.innerHTML = this.gridLines(w, b).join('');
    // 정류장의 트럭 목록: 버튼은 그대로 두고 상태 글자만 바꾼다
    el.querySelectorAll<HTMLElement>('[data-truck-status]').forEach((s) => {
      const t = w.vehicles.get(Number(s.dataset.truckStatus));
      if (t) s.textContent = `· ${VEHICLE_STATUS_LABEL[t.status]} (${t.load}/${w.truckCapacity(t)})`;
    });
    // 현재/목표와 입고 예정을 다른 줄에 표시한다. 예약량을 현재 재고처럼 더하지 않는다.
    el.querySelectorAll<HTMLElement>('[data-target-row]').forEach((s) => {
      const item = s.dataset.targetRow as ItemId;
      s.textContent = String(w.poolCount(b, item));
    });
    el.querySelectorAll<HTMLElement>('[data-target-incoming]').forEach((s) => {
      const incoming = w.inReserved(b, s.dataset.targetIncoming as ItemId);
      s.hidden = incoming === 0;
      s.textContent = `입고 예정 ${incoming}개`;
    });
    // 목록을 다시 만들지 않고 개수만 바꾼다 (고르는 도중에 목록이 흔들리지 않게)
    if (src) {
      el.querySelectorAll<HTMLOptionElement>('select[data-act="filter"] option[data-name]').forEach((o) => {
        o.textContent = `${o.dataset.name} (${sourceCount(w, src, o.value as ItemId)}개)`;
      });
    }
  }

  /** 붙여넣기 중: 무엇을 들었는지, 방금 복사한 것이면 이름 붙여 청사진 저장함에 저장 */
  private updatePasteInfo(bp: Blueprint, name: string | null): void {
    const el = $('info');
    el.hidden = false;
    // 글자를 치는 동안 다시 그리지 않게, 든 것이 바뀔 때만
    const key = `paste|${name ?? ''}|${bp.entries.length}|${bp.w}x${bp.h}|${this.savedPastes.has(bp)}`;
    if (key === this.infoKey) return;
    this.infoKey = key;
    const saved = name ?? (this.savedPastes.has(bp) ? this.savedPastes.get(bp)! : null);
    let html = `<header><img class="swatch" src="${blueprintPreview(bp)}" alt=""><h3>${saved ? `청사진 · ${escapeHtml(saved)}` : '복사한 묶음'}</h3>
      <button class="x" data-act="close">×</button></header>
      <div class="row"><span>건물</span><b>${bp.entries.length}개 · ${bp.w}×${bp.h}칸</b></div>
      <p class="muted">맵을 클릭하면 붙여넣어요. 우클릭·Esc로 내려놓기.</p>`;
    if (saved) {
      html += `<p class="muted">청사진 탭(K)에 저장돼 있어요.</p>
        <div class="actions"><button data-act="bp-share">📋 공유 코드 복사</button></div>`;
    } else {
      html += `<label class="recipe">이름 <input data-act="bp-name" maxlength="24" placeholder="${escapeHtml(defaultBlueprintName(bp))}"></label>
        <div class="actions"><button data-act="bp-save">💾 청사진으로 저장</button><button data-act="bp-share">📋 공유 코드 복사</button></div>
        <p class="muted">저장하면 아래 청사진 탭(K)에서 언제든 다시 꺼내 써요. 이 PC에만 남아요.</p>`;
    }
    html += `<p class="muted">공유 코드를 메신저로 보내면, 친구는 청사진 탭(K) 맨 끝 칸에 붙여넣어 받아요.</p>`;
    el.innerHTML = html;
  }

  /** 단체 선택한 건물들 (철거된 건 빼고) */
  private multiSelected(w: World): Building[] {
    return this.game.input.multi.map((id) => w.buildings.get(id)).filter((b): b is Building => !!b);
  }

  /** 단체 선택 정보창: 몇 대 골랐는지, 레시피 한 번에 바꾸기, 모두 철거 */
  private updateMultiInfo(w: World, group: Building[]): void {
    const el = $('info');
    el.hidden = false;
    const type = group[0].type;
    const recipes = group.map((b) => b.recipe ?? '');
    const key = `multi|${group.map((b) => b.id).join(',')}|${recipes.join(',')}|${w.unlockedRecipes.size}`;
    if (key === this.infoKey) return;
    this.infoKey = key;
    const def = BUILDINGS[type];
    let html = `<header><img class="swatch" src="${buildingIconUrl(type)}" alt=""><h3>${def.name} ${group.length}대</h3>
      <button class="x" data-act="close">×</button></header>`;
    if (isRecipeMachine(type)) {
      const same = recipes.every((r) => r === recipes[0]) ? recipes[0] : null;
      const none = type === 'assembler' ? '선택 안 함' : '자동 (들어온 재료로)';
      const options = recipesFor(type as MachineKind)
        .filter((r) => w.unlockedRecipes.has(r.id))
        .map((r) => `<option value="${r.id}" ${same === r.id ? 'selected' : ''}>${r.name}</option>`)
        .join('');
      const mixed = same === null ? '<option value="*" selected disabled>여러 가지</option>' : '';
      html += `<label class="recipe">레시피 <select data-act="multi-recipe">${mixed}<option value="" ${same === '' ? 'selected' : ''}>${none}</option>${options}</select></label>`;
      html += `<p class="muted">고르면 ${group.length}대가 모두 바뀌어요.</p>`;
      // 지금 레시피별 대수
      const count = new Map<string, number>();
      for (const r of recipes) count.set(r, (count.get(r) ?? 0) + 1);
      const rows = [...count]
        .map(([r, n]) => `<div class="row"><span>${r ? RECIPES[r].name : none}</span><b>${n}대</b></div>`)
        .join('');
      html += rows;
    }
    html += `<div class="actions"><button data-act="multi-remove" class="danger">모두 철거 (${group.length}대)</button></div>
      <p class="muted">Shift + 드래그로 다시 고르기 · Esc로 풀기</p>`;
    el.innerHTML = html;
  }

  private infoStatic(w: World, b: Building): string {
    const def = b.def;
    const title = b.type === 'station' ? `${def.name} ${b.stationNo}` : def.name;
    let html = `<header><img class="swatch" src="${buildingIconUrl(b.type)}" alt=""><h3>${title}</h3>
      <button class="x" data-act="close">×</button></header>`;
    if (b.type === 'station') {
      const opt = (m: StationMode) =>
        `<option value="${m}" ${b.stationMode === m ? 'selected' : ''}>${m === 'load' ? '벨트 입고 (상차)' : '벨트 출고 (하차)'}</option>`;
      html += `<label class="recipe">벨트 입출력 <select data-act="station-mode">
        ${opt('load')}${opt('unload')}</select></label>
        <div class="transport-flow muted">${b.stationMode === 'load' ? '컨베이어 → 트럭' : '트럭 → 앞면 출력'}</div><div class="dyn"></div>`;
      html += '<button data-act="road-start">도로로 연결</button><div class="road-builder" hidden></div>';
      const trucks = w.trucksOf(b);
      const check = w.canBuildTruck(b);
      const cost = TRUCK.cost.map((c) => `${itemIcon(c.item)}${c.count}`).join(' ');
      const rows = trucks
        .map(
          (t) =>
            `<button class="truck-row" data-truck="${t.id}">🚚 트럭 ${t.id} · ${stationRole(t, b.id)}
              <span class="muted" data-truck-status="${t.id}"></span></button>`,
        )
        .join('');
      html += `<div class="trucks"><div class="row"><span>이 정류장을 오가는 트럭</span><b>${trucks.length}대</b></div>${rows}
        <button data-act="build-truck" ${check.ok ? '' : 'disabled'}>🚚 트럭 만들기 <span class="cost">${cost}</span></button>
        ${check.ok ? '' : `<p class="muted">${check.reason}</p>`}</div>`;
      if (w.regional) {
        const advanced = this.advTruckBlock(w, b);
        if (advanced) html += transportSection('advanced-truck', '고급 트럭 조립', advanced);
        html += transportSection('charging', '충전·전력 상세', '<div class="station-power"></div>' + this.budgetBlock(w, b) + this.powerNodeBlock(w, b));
      }
      if (w.regional) html += this.dockBlock(w, b);
      html += transportSection('help', '정류장 사용법', `<p class="muted">${def.description}</p>`);
    }
    if (w.regional && w.isPowerUser(b) && b.type !== 'station') {
      const node = this.powerNodeBlock(w, b);
      if (node) html += transportSection('power-node', '전력 연결 선택', node);
    }
    if (isLineType(b.type)) html += this.lineBlock(w, b);
    if (b.type === 'charger' && w.regional) html += transportSection('charge-budget', '충전 예산', this.budgetBlock(w, b));
    if (isRecipeMachine(b.type)) {
      // 들어오는 재료로 만들 수 있는 레시피를 위로, 일부만 들어오는 것, 나머지 순 (아무것도 안 이어졌으면 그대로)
      const incoming = new Set(incomingItems(w, b));
      const opt = (r: Recipe) => `<option value="${r.id}" ${b.recipe === r.id ? 'selected' : ''}>${r.name}</option>`;
      const list = recipesFor(b.type as MachineKind).filter((r) => w.unlockedRecipes.has(r.id));
      const has = (r: Recipe) => r.inputs.filter((i) => incoming.has(i.item)).length;
      const full = list.filter((r) => r.inputs.length && has(r) === r.inputs.length);
      const part = list.filter((r) => has(r) > 0 && has(r) < r.inputs.length);
      const rest = list.filter((r) => !full.includes(r) && !part.includes(r));
      const group = (label: string, rs: Recipe[]) => (rs.length ? `<optgroup label="${label}">${rs.map(opt).join('')}</optgroup>` : '');
      const options = incoming.size
        ? group('들어오는 재료로 만들 수 있어요', full) + group('재료 일부가 들어와요', part) + group('다른 레시피', rest)
        : list.map(opt).join('');
      const none = needsRecipeChoice(b.type) ? '선택 안 함' : '자동 (들어온 재료로)';
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
      if (w.regional && (w.researched.has('integrated-automation') || b.module)) html += this.moduleBlock(w, b);
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
        : `<p class="muted">입력 미연결 · 전체 품목 표시</p>`;
    }
    if (b.type === 'unloader') {
      // 붙은 창고·허브에 실제로 든 아이템만 (지금 고른 건 비었어도 남겨 둔다)
      const src = unloaderSource(w, b);
      const pileTile = w.idx(b.x - DX[b.dir], b.y - DY[b.dir]);
      const pile = !src && w.inBounds(b.x - DX[b.dir], b.y - DY[b.dir]) ? w.pileAt(pileTile) : null;
      if (pile?.size) {
        // 뒤 칸의 현지 회수 더미에서 꺼낸다 (regional-v1)
        const why = [...new Set(w.piles.filter((p) => p.tile === pileTile).map((p) => PILE_REASON_LABEL[p.why]))].join(', ');
        html += `<div class="row"><span>회수 더미 (${why})</span><b>${[...pile].map(([i, n]) => `${itemIcon(i)}${n}`).join(' ')}</b></div>`;
      } else if (!src) {
        html += `<p class="bad">뒤(흰 화살표)에 허브·창고${w.regional ? '·회수 더미' : ''}가 필요해요.</p>`;
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
        if (!items.length) html += `<p class="muted">${src.def.name} 비어 있음</p>`;
      }
    }
    html += b.type === 'station' ? '' : '<div class="dyn"></div>' + transportSection('building-help', '설비 사용법', equipmentHelp(w, b));
    html += '<div class="actions">';
    if (!['hub', 'generator', 'underground', 'storage', 'road', 'solar', 'hydro', 'wind', 'charger', 'planter'].includes(b.type)) {
      html += `<button data-act="rotate">회전 (R)</button>`;
    }
    if (b.type !== 'hub') html += `<button data-act="remove" class="danger">철거 (Del)</button>`;
    if (b.type === 'hub' && w.regional && w.researched.has('integrated-automation')) {
      // 허브 프로젝트: 실제로 허브에 도착한 설비 모듈을 50개까지 납품
      const on = w.stats.projectOn;
      html += `<button data-act="project" title="켜 두면 허브로 들어오는 설비 모듈을 남은 목표만큼 프로젝트가 가져가요 (허브에 이미 있던 모듈은 쓰지 않아요)">${on ? '⏸ 모듈 납품 끄기' : '🏁 설비 모듈 납품 켜기'} <span class="muted">${w.stats.projectDelivered}/${PROJECT_GOAL}</span></button>`;
    }
    if (b.type === 'storage' || b.type === 'hub') {
      // 창고·허브는 스스로 내보내지 않으니 꺼낼 방법을 바로 쥐여 준다
      html += `<button data-act="take-out" title="옆에 놓으면 흰 화살표가 이쪽을 향하게 저절로 돌아가요">📤 하역기 들기</button>`;
    }
    html += `<button data-act="codex" title="이 건물의 설명·짓는 법·레시피">📖 도감</button>`;
    html += `</div>`;
    return html;
  }

  private updateRoadBuilder(w: World, b: Building): void {
    const box = $('info').querySelector<HTMLElement>('.road-builder');
    if (!box) return;
    const state = this.roadBuilder;
    const start = $('info').querySelector<HTMLButtonElement>('[data-act="road-start"]');
    if (start) start.disabled = state?.busy ?? false;
    box.hidden = !state || state.from !== b.id;
    if (!state || state.from !== b.id) return;
    const key = `${state.to}:${roadPlanKey(w)}`;
    if (key !== state.key) {
      state.key = key;
      state.plan = state.to ? planRoad(w, state.from, state.to) : null;
    }
    this.game.input.roadPreview = state.plan?.ok ? state.plan : null;
    const html = roadBuilderHtml(w, state.from, state.to, state.plan, state.busy);
    replaceRoadBuilder(box, html);
  }

  /**
   * 계획 운송 (확장 세계, 싣기 → 내리기 두 정류장): 품목별 1회 상한, 정기편 주기, 조기 출발.
   * 고친 뒤 "계획 적용"을 눌러야 명령이 간다 (합계가 적재량을 넘으면 알린다)
   */
  private planBlock(w: World, v: Vehicle): string {
    if (!(v.stops.length === 2 && v.stops[0].act === 'load' && v.stops[1].act === 'unload')) {
      return '';
    }
    const rows = this.planRows.get(v.id) ?? Math.max(1, v.plan.length);
    const opts = (sel: ItemId | '') => transportItemOptions(w, v.stops[0].id, sel, true, '품목 고르기');
    let html = `<div class="route plan"><div class="route-head"><span>품목별 적재 상한</span><span class="muted">합계 ${w.truckCapacity(v)}개 이하</span></div>`;
    for (let i = 0; i < rows; i++) {
      const p = v.plan[i];
      html += `<div class="line"><select data-plan-item="${i}">${opts(p?.item ?? '')}</select>
        <input type="number" min="1" max="${w.truckCapacity(v)}" value="${p?.cap ?? 10}" data-plan-cap="${i}" style="width:4em"></div>`;
    }
    const per = [0, 60, 120, 180, 240]
      .map((s) => `<option value="${s}" ${s === v.period ? 'selected' : ''}>${s ? `${s}초마다` : '짐 대기 후 출발'}</option>`)
      .join('');
    html += `<button data-act="plan-row">+ 품목</button>
      <label class="recipe">출발 <select data-plan-period>${per}</select></label>
      <label><input type="checkbox" data-plan-early ${v.early ? 'checked' : ''}> 다 실으면 바로 출발</label>
      <div class="actions"><button data-act="plan-apply">계획 적용</button>${v.plan.length ? '<button data-act="plan-clear">계획 끄기</button>' : ''}</div>
      ${transportSection('plan-help', '운송 계획 도움말', '<p class="muted">목적지에 목표 재고를 정하면 부족한 만큼만 실어요. 재고와 도착 공간은 자동으로 예약해요. 출발 간격이 없으면 새 짐 없이 5초 기다린 뒤 출발해요.</p>')}</div>`;
    return transportSection('plan', `품목별 운송 설정${v.plan.length ? ` · ${v.plan.length}품목 사용 중` : ''}`, html);
  }

  /** 정류장 연결 창고와 목표 재고 (확장 세계) */
  private dockBlock(w: World, b: Building): string {
    const groups = w.touchingStorageGroups(b);
    let html = `<label class="recipe">연결 창고 <select data-act="station-dock"><option value="0">없음 (정류장만)</option>${groups
      .map((g) => {
        const rep = g.group.find((s) => s.id === g.id)!;
        const sel = w.dockGroup(b).includes(rep);
        return `<option value="${rep.id}" ${sel ? 'selected' : ''}>창고 묶음 #${g.id} (${g.group.length}동)</option>`;
      })
      .join('')}</select></label>`;
    if (!groups.length) html += '<p class="muted">창고를 붙여 보관량을 늘릴 수 있어요.</p>';
    let targets = '<div class="route-head"><span>현재 / 목표</span></div>';
    for (const [item, n] of b.targets) {
      targets += `<div class="row"><span>${itemIcon(item)}${ITEMS[item].name}</span><b><span data-target-row="${item}"></span> / ${n}
        <button data-act="target-del" data-item="${item}" title="목표 지우기">×</button></b></div>
        <small class="muted target-incoming" data-target-incoming="${item}" hidden></small>`;
    }
    targets += `<div class="line"><select data-target-item><option value="">품목</option>${ITEM_IDS.map((i) => `<option value="${i}">${ITEMS[i].name}</option>`).join('')}</select>
      <input type="number" min="1" value="40" data-target-n style="width:4em"><button data-act="target-add">목표 정하기</button></div>`;
    return html + transportSection('targets', `목표 재고${b.targets.size ? ` · ${b.targets.size}품목` : ''}`, targets);
  }

  /** 정류장·충전기가 속한 거점의 차량 충전 예산 고르기 */
  private budgetBlock(w: World, b: Building): string {
    const z = w.siteOf(b);
    if (!z) return '';
    const opts = [0, 100, 200, 300, 400, 500, 600, 700, 800]
      .map((k) => `<option value="${k}" ${k === z.budget ? 'selected' : ''}>${k} kW${k === GRID.charge ? ' (기본)' : ''}</option>`)
      .join('');
    return `<label class="recipe">거점 ${z.id} 충전 예산 <select data-act="zone-budget" data-zone="${z.id}">${opts}</select></label>
      <p class="muted">이 거점의 모든 정류장·충전기가 나눠 써요. 먼저 온 트럭부터 받고, 남은 트럭은 기다려요. 전기는 정류장이 접속한 망에서 받아요.</p>`;
  }

  /** 전기를 받는 건물: 공급 범위 안 노드가 여럿이면 접속할 노드를 고른다 (다른 망이면 그 망에서 받는다) */
  private powerNodeBlock(w: World, b: Building): string {
    const choices = w.nodeChoices(b);
    if (choices.length < 2) return '';
    const opts = choices
      .map((c) => `<option value="${c.id}" ${c.id === b.node ? 'selected' : ''}>${BUILDINGS[c.type].name} #${c.id} · 전력망 ${c.net}${w.netHasSource(c.net) ? '' : ' (공급원 없음)'} · ${c.dist}칸</option>`)
      .join('');
    return `<label class="recipe">접속 노드 <select data-act="power-node">${opts}</select></label>`;
  }

  /** regional-v1: 이 건물의 전력망·거점과 축전 상태. 노드면 철거했을 때 끊길 것 */
  private gridLines(w: World, b: Building): string[] {
    const node = w.nodeRadius(b) > 0;
    if (!node && !w.isPowerUser(b)) return [];
    const lines: string[] = [];
    const net = w.netOf(b);
    const s = net ? w.netState.get(net) : undefined;
    if (!net || !w.netHasSource(net)) {
      lines.push(`<div class="row"><span>전력망</span><b style="color:#c0392b">${net ? `전력망 ${net} · 공급원 없음` : '공급 범위 밖'}</b></div>`);
      lines.push(
        node
          ? '<p class="muted">허브·발전기가 있는 망의 노드와 12칸 안이면 전선으로 이어져요.</p>'
          : '<p class="muted">노드의 공급 범위 안에 놓아야 해요 (허브 24칸·변전소 18칸·발전기 10칸·전봇대 6칸).</p>',
      );
    } else {
      lines.push(`<div class="row"><span>전력망</span><b>${net} · 충족 ${Math.round((s?.satisfaction ?? 1) * 100)}%</b></div>`);
      if (s && s.sites.length > 1) lines.push(`<div class="row"><span>전력망 공유</span><b>거점 ${s.sites.join(', ')}</b></div>`);
    }
    if (!node && b.node) {
      const n = w.buildings.get(b.node);
      if (n) lines.push(`<div class="row"><span>접속</span><b>${BUILDINGS[n.type].name} #${n.id}</b></div>`);
    }
    const site = w.siteOf(b);
    if (site) lines.push(`<div class="row"><span>거점</span><b>거점 ${site.id}${site.hub ? ' (허브)' : ''}</b></div>`);
    if (b.type === 'accumulator') {
      const pct = b.energy / GRID.accumulator.capacity;
      lines.push(`<div class="row"><span>저장</span><b>${(b.energy / 1000).toFixed(2)} / ${GRID.accumulator.capacity / 1000} MJ <span class="muted">${b.load > 0 ? `충전 ${Math.round(b.load)}kW` : b.load < 0 ? `방전 ${Math.round(-b.load)}kW` : ''}</span></b></div>`);
      lines.push(`<div class="bar"><div style="width:${pct * 100}%;background:#3f8a6a"></div></div>`);
    }
    if ((b.type === 'station' || b.type === 'charger') && site) {
      lines.push(`<div class="row"><span>거점 충전 배정</span><b>${Math.round(w.siteState.get(site.id)?.charge ?? 0)} / 예산 ${site.budget} kW</b></div>`);
    }
    const cut = node ? w.removalPreview(b) : null;
    if (cut && cut.cut) {
      lines.push(`<p class="muted">철거하면: 전선 ${cut.cut}가닥 끊김${cut.split > 1 ? ` · 망이 ${cut.split}개로 나뉨` : ''}${cut.lost ? ` · 전기가 끊길 설비 ${cut.lost}대` : ''}</p>`);
    }
    return lines;
  }

  /** 정보창을 다시 그려야 하는 현지 실물 상태 (모듈 슬롯·공급 창고 수량·고급 트럭 재료·처리 중 명령) */
  private useSig(w: World, b: Building): string {
    if (!w.regional) return '';
    return `${w.isPowerUser(b) ? `${b.node}>${w.nodeChoices(b).map((c) => `${c.id}:${c.net}`).join(',')}|` : ''}${this.useSigLocal(w, b)}`;
  }

  private useSigLocal(w: World, b: Building): string {
    const busy = [...this.useBusy].filter((k) => k.endsWith(`:${b.id}`)).join(',');
    const groups = (item: ItemId) =>
      w
        .touchingStorageGroups(b)
        .map((g) => `${g.key}=${w.groupStock(g.group, item).free}/${w.groupStock(g.group, item).real}`)
        .join(';');
    if (isRecipeMachine(b.type)) {
      return `${w.moduleState(b)}${b.crafting && b.modBatch ? 'L' : ''}|${w.moduleSupport(b) ?? ''}|${groups('module')}|${this.moduleSrc.get(b.id) ?? ''}|${busy}`;
    }
    if (b.type === 'charger') return `${b.zone}:${w.siteOf(b)?.budget}`;
    if (b.type === 'station') {
      const kit = countOf(b.inBuf, 'truck-kit') + countOf(b.outBuf, 'truck-kit');
      return `${w.advTruckSupport(b) ?? ''}|${kit}|${groups('truck-kit')}|${this.kitSrc.get(b.id) ?? ''}|${busy}|${b.zone}:${w.siteOf(b)?.budget}|${b.dock}|${[...b.targets].join(';')}`;
    }
    return '';
  }

  /** 기계마다 고른 모듈 공급 창고군 (없거나 사라졌으면 대표 창고 id가 가장 작은 군) */
  private moduleGroup(w: World, b: Building) {
    const groups = w.touchingStorageGroups(b);
    return groups.find((g) => g.id === this.moduleSrc.get(b.id)) ?? groups[0] ?? null;
  }

  /** 기계 정보창의 "설비 모듈": 상태, 공급 창고와 사용 가능 수량, 배율, 설치·분리 버튼 */
  private moduleBlock(w: World, b: Building): string {
    const state = w.moduleState(b);
    let html = `<div class="trucks module-box"><div class="row"><span>${itemIcon('module')} 설비 모듈</span><b>${MODULE_STATE_LABEL[state]}</b></div>`;
    const no = w.moduleSupport(b);
    if (no) return `${html}<p class="muted">${no}</p></div>`;
    const busy = (act: string) => (this.useBusy.has(`${act}:${b.id}`) ? 'disabled' : '');
    const kw = (k: number) => `${Math.round(b.def.power * k)}kW`;
    const rate = `속도 ×${MODULE.speed} · 작업 전력 ×${MODULE.power} <span class="muted">(${kw(1)} → ${kw(MODULE.power)})</span>`;
    if (!b.module) {
      const groups = w.touchingStorageGroups(b);
      if (!groups.length) {
        return `${html}<p class="muted">몸체에 상하좌우로 맞닿은 창고에 모듈을 넣어 두면 여기서 설치해요. 대각선·한 칸 떨어진 창고·허브의 모듈은 쓰지 않아요.</p></div>`;
      }
      const g = this.moduleGroup(w, b)!;
      if (groups.length > 1) {
        html += `<label class="recipe">공급 창고 <select data-act="mod-src">${groups
          .map((x) => `<option value="${x.id}" ${x === g ? 'selected' : ''}>창고 묶음 #${x.id} (${x.group.length}동 · 모듈 ${w.groupStock(x.group, 'module').free}개)</option>`)
          .join('')}</select></label>`;
      }
      const s = w.groupStock(g.group, 'module');
      html += `<div class="row"><span>공급 창고의 모듈</span><b>실물 ${s.real} · 예약 ${s.reserved} · 사용 가능 ${s.free}</b></div>
        <div class="row"><span>설치하면</span><b>${rate}</b></div>
        <button data-act="mod-install" ${s.free < 1 ? 'disabled' : busy('install')}>${itemIcon('module')} 설치 <span class="muted">창고의 모듈 1개</span></button>
        ${s.free < 1 ? '<p class="muted">이 창고 묶음에 쓸 수 있는 모듈이 없어요. 운송으로 실제 모듈을 넣어 주세요.</p>' : '<p class="muted">작업 중이면 지금 제작은 그대로 끝나고 다음 제작부터 적용돼요.</p>'}`;
      return `${html}</div>`;
    }
    const locked = b.crafting && b.modBatch;
    const r = w.recipeOf(b);
    const back = r && locked ? r.inputs.map((i) => `${itemIcon(i.item)}${i.count}`).join(' ') : '';
    html += `<div class="row"><span>효과</span><b>${rate}</b></div>
      <div class="row"><span>지금 제작</span><b>${b.crafting ? (b.modBatch ? '모듈 적용 중' : '모듈 없이 (다음 제작부터)') : '<span class="muted">없음</span>'}</b></div>`;
    if (b.detach) {
      html += `<button data-act="mod-cancel" ${busy('cancel')}>분리 요청 취소 <span class="muted">모듈은 슬롯에 그대로</span></button>`;
    } else {
      html += `<button data-act="mod-detach" ${busy('detach')}>${locked ? '제작 완료 후 분리' : '분리'} <span class="muted">이 기계 자리 회수 더미로</span></button>`;
    }
    if (locked) {
      html += `<button data-act="mod-force" class="danger" ${busy('force')}>작업 취소 후 즉시 분리 <span class="muted">진행 버림 · 투입 재료 ${back} 현지 반환</span></button>`;
    }
    html += `<p class="muted">분리한 모듈은 기계 왼쪽 위 칸의 회수 더미에 놓여요. 다시 쓰려면 하역기로 꺼내 창고로 옮겨 주세요. 설치·분리는 Ctrl+Z로 되돌리지 않아요.</p>`;
    return `${html}</div>`;
  }

  /** 정류장 정보창의 "고급 트럭 조립": 현지 조립품 1개 (정류장 안 또는 직접 붙은 창고 묶음), 도로 상태 */
  private advTruckBlock(w: World, b: Building): string {
    let html = `<div class="trucks"><div class="row"><span>🚛 고급 트럭 조립</span><b>${itemIcon('truck-kit')} 현지 조립품 1개</b></div>`;
    const no = w.advTruckSupport(b);
    if (no && no !== '정류장 옆에 도로가 필요해요') return `${html}<p class="muted">${no}</p></div>`;
    const inside = countOf(b.inBuf, 'truck-kit') + countOf(b.outBuf, 'truck-kit');
    const groups = w.touchingStorageGroups(b);
    const g = groups.find((x) => x.key === this.kitSrc.get(b.id)) ?? groups[0] ?? null;
    html += `<div class="row"><span>정류장 안</span><b>${inside}개</b></div>`;
    if (groups.length > 1) {
      html += `<label class="recipe">연결 창고 <select data-act="kit-src">${groups
        .map((x) => `<option value="${x.key}" ${x === g ? 'selected' : ''}>창고 묶음 #${x.id} (${x.group.length}동)</option>`)
        .join('')}</select></label>`;
    }
    const s = g ? w.groupStock(g.group, 'truck-kit') : null;
    if (s) html += `<div class="row"><span>연결 창고</span><b>실물 ${s.real} · 예약 ${s.reserved} · 사용 가능 ${s.free}</b></div>`;
    const road = no ? `<span style="color:#c0392b">${no}</span>` : '있음';
    html += `<div class="row"><span>도로</span><b>${road}</b></div>`;
    const have = inside + (s?.free ?? 0) > 0;
    const busy = this.useBusy.has(`adv:${b.id}`);
    html += `<button data-act="adv-truck" ${!no && have && !busy ? '' : 'disabled'}>🚛 고급 트럭 조립</button>
      <p class="muted">${have ? '허브 재료는 쓰지 않아요. 새 트럭은 짐 0·노선 없음·배터리 0kJ로 옆 도로에 서서 이 정류장 전력으로 충전해요.' : '이 정류장이나 붙은 창고에 고급 트럭 조립품을 실제로 옮겨 와야 해요 (다른 정류장·허브의 것은 쓰지 않아요).'}</p></div>`;
    return html;
  }

  /** 현지 실물 명령 보내기: 처리 중에는 같은 버튼을 막고, 실패하면 이유를 알린다 */
  private sendUse(busyKey: string, cmd: Parameters<Exec>[0], ok?: (r: UseResult) => void): void {
    if (this.useBusy.has(busyKey)) return;
    this.useBusy.add(busyKey);
    // 손님인데 방장과 맞추는 중이라 보내지 못했으면 답이 오지 않는다: 잠시 뒤 버튼을 다시 연다 (자동으로 다시 보내지는 않는다)
    setTimeout(() => this.useBusy.delete(busyKey), 5000);
    this.update();
    this.game.exec(cmd, (r) => {
      this.useBusy.delete(busyKey);
      const res = r as UseResult;
      if (!res.ok) this.toast(res.reason ?? '할 수 없어요', 3000);
      else ok?.(res);
      this.update();
    });
  }

  private infoDynamic(w: World, b: Building): string {
    const lines: string[] = [];
    if (w.regional && b.type !== 'station') lines.push(...this.gridLines(w, b));
    const st = w.machineStats(b);
    if (st) lines.push(productionBlock(st));
    if (isGeneratorType(b.type)) {
      const rated = b.type === 'generator' ? GENERATOR_POWER : b.type === 'hydro' ? HYDRO_POWER : b.type === 'fuel-generator' ? GRID.fuel.power : b.type === 'geothermal' ? GRID.geothermal : null;
      lines.push(`<div class="row"><span>발전 출력</span><b>${Math.round(b.load)}${rated === null ? '' : ` <small class="muted">/ 최대 ${rated}</small>`} kW</b></div>`);
    }
    if (HAS_STATUS.includes(b.type)) {
      lines.push(`<div class="row"><span>현재 상태</span><b style="color:${STATUS_COLOR[b.status]}">${STATUS_LABEL[b.status]}</b></div>`);
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
            lines.push(`<p class="bad">광맥 고갈</p>`);
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
      case 'sawmill':
        lines.push(`<div class="row"><span>입력</span><b>${buf(b.inBuf)}</b></div>`);
        lines.push(`<div class="row"><span>출력 대기</span><b>${buf(b.outBuf)}</b></div>`);
        lines.push(`<div class="row"><span>기본 작업 전력</span><b>${b.def.power} kW</b></div>`);
        break;
      case 'lumberjack':
      case 'planter': {
        // 범위 안 나무: 다 자란 것 · 자라는 것 · 심을 수 있는 빈 땅
        let grown = 0;
        let growing = 0;
        let room = 0;
        // 다 캔 광맥 땅과 그중 다 자란 나무 (숲 되살리기)
        let spent = 0;
        let revived = 0;
        for (const i of b.mineTiles) {
          if (w.tree[i] >= 1) grown++;
          else if (w.tree[i] > 0) growing++;
          else if (w.canPlant(i)) room++;
          if (w.isSpentOre(i)) {
            spent++;
            if (w.tree[i] >= 1) revived++;
          }
        }
        lines.push(`<div class="row"><span>범위 안 나무</span><b>다 자람 ${grown} · 자라는 중 ${growing}</b></div>`);
        if (b.type === 'planter') {
          lines.push(`<div class="row"><span>심을 빈 땅</span><b>${room}칸</b></div>`);
          if (spent) lines.push(`<div class="row"><span>다 캔 광맥 땅</span><b>${spent}칸 · 다 자란 나무 ${revived}</b></div>`);
          lines.push(`<div class="row"><span>묘목</span><b>${itemIcon('sapling')} ${countOf(b.inBuf, 'sapling')} / ${FOREST.planterCap}</b></div>`);
          const sec = Math.round(FOREST.grow / w.treeGrowth());
          lines.push(`<div class="row"><span>나무 성장 시간</span><b>${sec}초</b></div>`);
        } else {
          lines.push(`<div class="row"><span>출력 대기</span><b>${buf(b.outBuf)}</b></div>`);
        }
        lines.push(`<div class="row"><span>기본 작업 전력</span><b>${b.def.power} kW</b></div>`);
        break;
      }
      case 'generator': {
        const charcoal = countOf(b.inBuf, 'charcoal');
        lines.push(
          `<div class="row"><span>연료</span><b>${itemIcon('coal')} ${b.fuel}${charcoal ? ` · ${itemIcon('charcoal')} ${charcoal}` : ''} / 5</b></div>`,
        );
        break;
      }
      case 'hydro':
        lines.push(`<div class="row"><span>물</span><b>${itemIcon('water')} ${b.fuel} / 10</b></div>`);
        break;
      case 'solar':
      case 'wind':
      case 'geothermal':
        break;
      case 'fuel-generator':
        lines.push(`<div class="row"><span>정유 연료</span><b>${itemIcon('fuel')} ${b.fuel} / ${GRID.fuel.cap}</b></div>`);
        break;
      case 'charger': {
        const info = chargerInfo(w, b);
        lines.push(`<div class="row"><span>실제 충전</span><b>${info.active}대 · ${Math.round(info.kw)} kW</b></div>`);
        if (info.waiting) lines.push(`<div class="row"><span>충전 대기</span><b>${info.waiting}대</b></div>`);
        if (!info.roads) lines.push('<p class="bad">옆에 도로가 필요해요.</p>');
        break;
      }
      case 'belt':
      case 'fast-belt':
        lines.push(`<div class="row"><span>운반 중</span><b>${countItems(b)}개</b></div>`);
        lines.push(`<div class="row"><span>칸당 적재 한도</span><b>${b.def.stack ?? 1}개</b></div>`);
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
        const info = unloaderInfo(w, b);
        lines.push(`<div class="row"><span>꺼내는 곳</span><b>${info.source ?? '<span class="muted">없음</span>'}</b></div>`);
        lines.push(`<div class="row"><span>꺼내는 것</span><b>${b.filter ? itemIcon(b.filter) + ITEMS[b.filter].name : '전부 (종류별로 번갈아)'}</b></div>`);
        lines.push(`<div class="row"><span>최대 하역량</span><b>${fmtNum(info.maximum)}개/분</b></div>`);
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
        break;
      }
      case 'station': {
        const load = b.stationMode === 'load';
        if (w.regional) lines.push(`<div class="row"><span>거점</span><b>${b.zone ? `거점 ${b.zone}` : '미배정'}</b></div>`);
        if (w.regional) {
          const net = w.netOf(b);
          const sat = net ? w.netState.get(net)?.satisfaction ?? 1 : 0;
          if (!net || !w.netHasSource(net)) lines.push('<p class="bad">충전 전력 없음</p>');
          else if (sat < 0.999) lines.push('<p class="bad">충전 전력 부족</p>');
        }
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
        // 여기 서서 충전하는 트럭 (공장 전력을 쓴다)
        const charging = w.trucksOf(b).filter(
          (t) =>
            (t.state === 'loading' || t.state === 'unloading') &&
            t.stopId === b.id &&
            t.receivedCharge > 0,
        );
        if (charging.length) {
          lines.push(
            `<div class="row"><span>충전 중</span><b>${charging.length}대 · ${Math.round(charging.reduce((sum, t) => sum + t.receivedCharge / DT, 0))} kW</b></div>`,
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
        break;
      }
      case 'hub':
        lines.push(`<div class="row"><span>기본 전력</span><b>${HUB_BASE_POWER} kW</b></div>`);
        break;
    }
    return lines.join('');
  }

  // ───────────────────────── 트럭 정보창 ─────────────────────────

  private updateVehicleInfo(w: World, v: Vehicle): void {
    const el = $('info');
    el.hidden = false;
    const stations = reachableStations(w, v.tile);
    const reachable = new Set(stations.map((s) => s.id));
    // 같은 노선으로 한 대 더: 노선에서 처음 들르는 정류장 옆에 만든다 (world.cloneTruck과 같은 순서)
    const homes = v.stops.map((st) => w.buildings.get(st.id)).filter((st): st is Building => st?.type === 'station');
    const clone = homes.find((st) => w.canBuildTruck(st).ok)
      ? { ok: true as const, reason: undefined }
      : homes.length
        ? w.canBuildTruck(homes[0])
        : { ok: false, reason: '정류장을 먼저 골라 주세요' };
    const roadState = v.stops.map((stop) => {
      const station = w.buildings.get(stop.id);
      return station?.type === 'station' ? `${stop.id}:${reachable.has(stop.id) ? 1 : 0}` : `${stop.id}:deleted`;
    }).join(',');
    const key = `v${v.id}|${v.stops.map((st) => `${st.id}${st.act}${st.item ?? ''}`).join(',')}|${w.endlessLevel('endless-truck')}|${stations.map((s) => `${s.id}${s.stationMode}`).join(',')}|${roadState}|${clone.reason ?? ''}|${JSON.stringify(v.plan)}${v.period}${v.early}${v.paused}|${this.planRows.get(v.id) ?? ''}`;
    if (key !== this.infoKey) {
      this.infoKey = key;
      const opt = (sel: number) =>
        `<option value="0" ${sel ? '' : 'selected'}>고르기</option>` +
        (sel && !reachable.has(sel)
          ? `<option value="${sel}" selected disabled>${w.buildings.get(sel)?.type === 'station' ? `정류장 ${w.buildings.get(sel)!.stationNo} · 도로 끊김` : '삭제된 정류장'}</option>`
          : '') +
        stations
          .map((s) => `<option value="${s.id}" ${s.id === sel ? 'selected' : ''}>정류장 ${s.stationNo} · ${STATION_MODE_NAME[s.stationMode]}</option>`)
          .join('');
      replaceTransportInfo(el, `<header><img class="swatch" src="${truckIconUrl()}" alt=""><h3>${TRUCK_KIND_LABEL[v.kind]} ${v.id}</h3>
          <button class="x" data-act="close">×</button></header>
        <div class="dyn"></div>
        <div class="route">
          <div class="route-head"><b>노선 ↻</b><span class="muted">도로 연결 ${stations.length}곳</span></div>
          ${stations.length ? '' : '<p class="bad">연결된 정류장이 없어요. 도로를 이어 주세요.</p>'}
          ${v.stops
            .map(
              (st, i) => `<div class="stop" data-stop="${i}">
              <div class="line"><span class="no">${i + 1}</span>
                <select data-act="stop-station" data-i="${i}">${opt(st.id)}</select>
                </div>
              <div class="line sub">
                <select data-act="stop-act" data-i="${i}" title="이 정류장에서 트럭이 할 일">
                  <option value="load" ${st.act === 'load' ? 'selected' : ''}>트럭에 싣기</option>
                  <option value="unload" ${st.act === 'unload' ? 'selected' : ''}>트럭에서 내리기</option></select>
                ${
                  st.act === 'load'
                    ? `<select data-act="stop-item" data-i="${i}" title="정류장에 여러 아이템이 섞여 있을 때 여기서 실을 것">
                  ${transportItemOptions(w, st.id, st.item)}</select>`
                    : ''
                }</div>
              <div class="line sub stop-tools">
                ${stationMapButton(w, st.id, i)}
                <button data-act="stop-up" data-i="${i}" title="한 칸 앞으로" ${i === 0 ? 'disabled' : ''}>▲</button>
                <button data-act="stop-remove" data-i="${i}" title="노선에서 빼기" ${v.stops.length <= ROUTE_MIN ? 'disabled' : ''}>×</button>
              </div></div>`,
            )
            .join('')}
          <button data-act="stop-add" ${v.stops.length >= ROUTE_MAX ? 'disabled' : ''}>+ 정류장 더하기 <span class="muted">(최대 ${ROUTE_MAX}곳)</span></button>
        </div>
        ${w.regional ? this.planBlock(w, v) : ''}
        ${w.regional && v.plan.length ? `<div class="actions"><button data-act="plan-pause">${v.paused ? '▶ 노선 다시 운행' : '⏸ 노선 일시정지'}</button></div>` : ''}
        ${transportSection('metrics', '운행 정보', '<div class="vehicle-metrics"></div>')}
        <div class="actions">
          ${
            v.kind === 'advanced'
              ? `<button class="transport-clone" data-act="adv-clone" title="조립한 정류장의 현지 조립품 1개를 또 써서, 같은 노선을 도는 고급 트럭을 한 대 더">
            🚛 같은 노선 추가 <span class="transport-cost muted">${itemIcon('truck-kit')}현지 1개</span></button>`
              : `<button class="transport-clone" data-act="clone-truck" ${clone.ok ? '' : 'disabled'} title="${clone.ok ? '같은 노선을 도는 트럭을 하나 더' : (clone.reason ?? '')}">
            🚚 같은 노선 추가 <span class="transport-cost muted">${TRUCK.cost.map((c) => `${itemIcon(c.item)}${c.count}`).join(' ')}</span></button>`
          }
          <button data-act="follow">📍 트럭으로 가기</button>
        </div>
        ${transportSection('help', '운송 도움말', `<p class="muted">정류장을 순서대로 돌고 마지막에는 처음으로 돌아와요. 같은 도로로 갈 수 있는 정류장만 목록에 보여요.</p>
          <p class="muted">싣는 곳에서는 가득 차거나 새 짐 없이 ${TRUCK.wait}초 기다리면 출발하고, 내리는 곳에서는 모두 내린 뒤 출발해요. 운송 계획 사용 시 설정한 주기를 따라요.</p>
          ${v.kind === 'advanced' ? '<p class="muted">고급 트럭은 노선이 없어도 조립한 정류장에서 충전해요.</p>' : ''}`)}
        ${transportSection('manage', '차량 관리', `<div class="actions">${w.regional ? '<button data-act="truck-dump">📦 화물 내려놓기</button>' : ''}<button data-act="remove-truck" class="danger">철거 (Del)</button></div>`)}
        `, `vehicle:${v.id}`, JSON.stringify([v.plan, v.period, v.early]));
    }
    const lines: string[] = [];
    const st = w.buildings.get(v.stopId);
    const shortReason: Partial<Record<VehicleStatus, string>> = {
      waiting: v.stopItem ? `${ITEMS[v.stopItem].name} 대기` : '실을 짐 대기',
      'no-supply': '출발지 재료 부족', 'unload-full': '도착지 보관 공간 부족',
    };
    let state = shortReason[v.status] ?? VEHICLE_STATUS_LABEL[v.status];
    if (v.status === 'charging' && v.receivedCharge <= 0) state = '충전 대기 (받은 전력 없음)';
    if (v.status === 'moving' && st) state += ` → 정류장 ${st.stationNo} (${v.stops[v.stop].act === 'load' ? '실으러' : '내리러'})`;
    // 노선에서 지금 가거나 서 있는 정류장 표시
    el.querySelectorAll<HTMLElement>('.route [data-stop]').forEach((row) => row.classList.toggle('now', Number(row.dataset.stop) === v.stop));
    lines.push(`<div class="row"><span>상태</span><b style="color:${VEHICLE_STATUS_COLOR[v.status]}">${state}</b></div>`);
    const cargo = [...v.cargo].filter(([, n]) => n > 0).map(([i, n]) => `${itemIcon(i)}${n}`).join(' ');
    lines.push(`<div class="row"><span>짐</span><b>${cargo || '<span class="muted">없음</span>'} <span class="muted">${v.load} / ${w.truckCapacity(v)}</span></b></div>`);
    lines.push(`<div class="bar"><div style="width:${(v.load / w.truckCapacity(v)) * 100}%;background:#c9b27a"></div></div>`);
    // 배터리: 남은 양과 그만큼 갈 수 있는 칸 수. 충전 중이면 공장 전력이 모자란 만큼 느려진다
    const charge = v.battery / w.truckBattery(v);
    const range = Math.floor(v.battery / w.truckPerTile(v));
    const charging = v.status === 'charging' || ((v.state === 'loading' || v.state === 'unloading') && charge < 1);
    const rate = charging ? v.receivedCharge > 0 ? ` · 충전 ${Math.round(v.receivedCharge / DT)}kW` : ' · 충전 대기 0kW' : '';
    const batColor = charge > 0.5 ? '#3f8a3a' : charge > 0.2 ? '#b7791f' : '#c0392b';
    lines.push(`<div class="row"><span>배터리</span><b>${Math.round(charge * 100)}% <span class="muted">${range}칸${rate}</span></b></div>`);
    lines.push(`<div class="bar"><div style="width:${charge * 100}%;background:${batColor}"></div></div>`);
    const disconnected = v.stops.filter((s) => s.id && !reachable.has(s.id));
    if (disconnected.length) lines.push('<p class="bad">노선의 도로가 끊겼어요. 정류장 연결을 확인하세요.</p>');
    const legs = w.routeLegs(v.stops);
    const fullRange = Math.floor(w.truckBattery(v) / w.truckPerTile(v));
    if (legs && Math.max(...legs) > fullRange) lines.push('<p class="bad">정류장 사이 거리가 완충 주행거리보다 길어요. 중간 충전기를 확인하세요.</p>');
    el.querySelector('.dyn')!.innerHTML = lines.join('');
    lines.length = 0;
    lines.push(`<div class="row"><span>적재 한도</span><b>${w.truckCapacity(v)}개</b></div>`);
    lines.push(`<div class="row"><span>주행 속도</span><b>${fmtNum(w.truckSpeed(v))}칸/초</b></div>`);
    // 길 길이: 정류장마다 충전하므로, 가장 긴 구간이 배터리 가득일 때 갈 수 있는 칸보다 길면 중간에 배터리가 떨어진다
    if (legs) {
      const longest = Math.max(...legs);
      const total = legs.reduce((a, b) => a + b, 0);
      const ok = longest <= fullRange;
      const what = legs.length === 2 ? `${legs[0]}칸 (한쪽)` : `한 바퀴 ${total}칸 · 가장 긴 구간 ${longest}칸`;
      lines.push(
        `<div class="row"><span>길</span><b>${what} <span ${ok ? 'class="muted"' : 'style="color:#c0392b"'}>· 완충 ${fullRange}칸${ok ? '' : ' 초과'}</span></b></div>`,
      );
    }
    const perMin = v.perMinute;
    lines.push(
      perMin === null
        ? `<div class="row"><span>운송량</span><b class="muted">한 바퀴 돌면 나와요</b></div>`
        : `<div class="row"><span>운송량</span><b>분당 ${fmtNum(perMin)}개 <span class="muted">(${Math.round(v.lastTrip)}초에 ${v.lastLoad}개)</span></b></div>`,
    );
    const hint =
      v.status === 'waiting' && v.stopItem
        ? `여기서 실을 짐(${ITEMS[v.stopItem].name})이 정류장에 없어요. 컨베이어로 넣거나 노선에서 이 정류장의 짐을 바꿔 주세요.`
        : VEHICLE_HINT[v.status];
    if (hint) lines.push(`<p class="muted">→ ${hint}</p>`);
    el.querySelector('.vehicle-metrics')!.innerHTML = lines.join('');
  }

  /** 지금 든 복사 묶음을 청사진 저장함에 (이름을 안 적으면 "조립기 묶음" 같은 이름) */
  private saveCopied(): void {
    const bp = this.game.input.paste;
    if (!bp) return;
    const typed = $<HTMLInputElement>('info').querySelector<HTMLInputElement>('[data-act="bp-name"]')?.value.trim();
    const name = typed || defaultBlueprintName(bp);
    saveBlueprint(name, bp);
    this.savedPastes.set(bp, name);
    this.toolbar.refreshBlueprints();
    this.toast(`청사진 '${name}' 저장 — 청사진 탭(K)에서 다시 꺼내 써요`);
  }

  /** 지금 든 묶음의 공유 코드를 클립보드에 (이름은 저장한 이름, 없으면 적은 이름·저절로 붙는 이름) */
  private async shareCopied(): Promise<void> {
    const bp = this.game.input.paste;
    if (!bp) return;
    const typed = $<HTMLInputElement>('info').querySelector<HTMLInputElement>('[data-act="bp-name"]')?.value.trim();
    const name = this.game.input.pasteName ?? this.savedPastes.get(bp) ?? (typed || defaultBlueprintName(bp));
    const ok = await copyText(await blueprintCode(name, bp));
    this.toast(ok ? `'${name}' 공유 코드를 복사했어요 — 메신저에 붙여넣어 보내세요` : '복사하지 못했어요');
  }

  private onInfoClick(e: MouseEvent): void {
    const act = (e.target as HTMLElement).closest<HTMLElement>('[data-act]')?.dataset.act;
    const input = this.game.input;
    // 컨베이어 줄에서 잘못 들어간 아이템만 빼기
    const take = (e.target as HTMLElement).closest<HTMLElement>('[data-line-take]')?.dataset.lineTake as ItemId | undefined;
    const sel = this.selected();
    if (act?.startsWith('road-')) {
      if (act === 'road-start' && sel?.type === 'station') {
        input.setTool(null);
        this.roadBuilder = { world: this.game.getWorld(), from: sel.id, to: 0, key: '', plan: null, busy: false };
      } else if (act === 'road-cancel') {
        this.roadBuilder = null; input.roadPreview = null;
      } else if (act === 'road-focus' && this.roadBuilder?.plan?.ok) {
        input.frameRoadPreview();
      } else if (act === 'road-build' && this.roadBuilder?.plan?.ok && !this.roadBuilder.busy) {
        const state = this.roadBuilder, plan = state.plan;
        if (!plan?.ok) return;
        state.busy = true;
        const waiting = setTimeout(() => {
          if (this.roadBuilder !== state || !state.busy) return;
          state.busy = false; state.key = '';
          this.toast('건설 응답을 받지 못했어요. 연결 상태와 지도를 확인해 주세요');
          this.update();
        }, 5000);
        this.game.exec({ t: 'road-build', from: plan.from, to: plan.to, path: [...plan.path], newTiles: [...plan.newTiles] }, (r) => {
          clearTimeout(waiting);
          if (this.roadBuilder === state) {
            state.busy = false; state.key = '';
            if (r.ok) { this.roadBuilder = null; input.roadPreview = null; }
          }
          this.toast(r.ok ? `도로 ${r.placed}칸 건설 · Ctrl+Z로 되돌리기` : (r.reason ?? '도로를 건설할 수 없어요'));
          this.update();
        });
      }
      this.update();
      return;
    }
    if (take && sel) {
      this.sendUse(`line:${sel.id}`, { t: 'line-take', rid: newRid(), id: sel.id, item: take }, (r) => {
        const to = r.from ? this.game.getWorld().buildings.get(r.from) : undefined;
        this.toast(`줄에서 ${ITEMS[take].name} ${r.moved}개를 빼서 ${to ? BUILDINGS[to.type].name : '허브'}로 옮겼어요`, 3000);
      });
      this.update();
      return;
    }
    // 정류장 정보창의 트럭 목록: 그 트럭으로
    const truck = (e.target as HTMLElement).closest<HTMLElement>('[data-truck]')?.dataset.truck;
    if (truck) {
      input.selectedVehicle = Number(truck);
      input.selectedId = null;
      this.update();
      return;
    }
    if (input.paste && !this.selected()) {
      if (act === 'close') input.paste = null;
      if (act === 'bp-save') this.saveCopied();
      if (act === 'bp-share') void this.shareCopied();
      this.update();
      return;
    }
    if (input.multi.length) {
      if (act === 'close') input.multi = [];
      if (act === 'multi-remove') input.removeMulti();
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
      if (act === 'plan-pause') this.game.exec({ t: 'truck-pause', id: v.id, on: !v.paused });
      if (act === 'truck-dump')
        this.game.exec({ t: 'truck-dump', id: v.id }, (ok) => this.toast(ok ? '화물을 이 자리 회수 더미에 내려놨어요' : '내려놓을 화물이 없어요', 2500));
      if (act === 'plan-row') this.planRows.set(v.id, (this.planRows.get(v.id) ?? Math.max(1, v.plan.length)) + 1);
      if (act === 'plan-clear') {
        this.game.exec({ t: 'truck-plan', id: v.id, plan: [], period: 0, early: false });
        this.planRows.delete(v.id);
      }
      if (act === 'plan-apply') {
        const el = $('info');
        const plan: { item: ItemId; cap: number }[] = [];
        let invalidCap = false;
        el.querySelectorAll<HTMLSelectElement>('select[data-plan-item]').forEach((s) => {
          const cap = Number(el.querySelector<HTMLInputElement>(`input[data-plan-cap="${s.dataset.planItem}"]`)?.value);
          if (!s.value) return;
          if (!Number.isSafeInteger(cap) || cap < 1) invalidCap = true;
          else plan.push({ item: s.value as ItemId, cap });
        });
        const period = Number(el.querySelector<HTMLSelectElement>('select[data-plan-period]')?.value ?? 0);
        const early = !!el.querySelector<HTMLInputElement>('input[data-plan-early]')?.checked;
        const total = plan.reduce((a, p) => a + p.cap, 0);
        const cap = this.game.getWorld().truckCapacity(v);
        if (invalidCap) this.toast('품목별 상한은 1 이상의 정수로 입력해 주세요. 기존 계획은 바꾸지 않았어요', 3500);
        else if (new Set(plan.map((p) => p.item)).size !== plan.length) this.toast('같은 품목은 한 줄에만 넣어 주세요. 기존 계획은 바꾸지 않았어요', 3500);
        else if (total > cap) this.toast(`상한 합계 ${total}개가 한 번에 싣는 ${cap}개보다 많아요. 줄여 주세요`, 3500);
        else
          this.game.exec({ t: 'truck-plan', id: v.id, plan, period, early }, (ok) => {
            this.toast(ok ? (plan.length ? '운송 계획을 적용했어요' : '계획을 껐어요') : '계획을 적용하지 못했어요', 2500);
            if (ok) {
              this.planRows.delete(v.id);
              delete el.dataset.transportPlanVersion;
              this.infoKey = '';
            }
            this.update();
          });
      }
      if (act === 'adv-clone') {
        // 조립한 정류장(없으면 노선의 첫 정류장)의 현지 조립품 1개로 한 대 더. 노선(설정)만 베낀다
        const w = this.game.getWorld();
        const home = [v.home, ...v.stops.map((s) => s.id)].map((id) => w.buildings.get(id)).find((s) => s?.type === 'station');
        if (!home) this.toast('조립할 정류장이 없어요. 노선에 정류장을 넣어 주세요');
        else {
          const g = w.touchingStorageGroups(home)[0];
          this.sendUse(`adv:${home.id}`, { t: 'build-adv-truck', rid: newRid(), station: home.id, key: g?.key ?? '', copy: v.id }, (r) => {
            input.selectedVehicle = r.vehicle ?? null;
            this.toast(`고급 트럭 ${r.vehicle} 추가 (고급 트럭 ${v.id}의 노선과 같음, 배터리 0kJ부터)`, 3500);
          });
        }
      }
      if (act === 'remove-truck') {
        if (v.kind === 'advanced' && !confirm(`고급 트럭 ${v.id}을 철거할까요? 조립품 1개와 실은 짐은 지금 자리의 회수 더미에 남고, Ctrl+Z로 되돌릴 수 없어요.`)) return;
        this.game.exec({ t: 'remove-truck', id: v.id });
        input.selectedVehicle = null;
      }
      // 노선 편집: 정류장 더하기·빼기·한 칸 앞으로
      const i = Number((e.target as HTMLElement).closest<HTMLElement>('[data-i]')?.dataset.i);
      const stops = v.stops.map((st) => ({ ...st }));
      if (act === 'stop-map') {
        if (!focusRouteStation(this.game.getWorld(), stops, i, (x, y) => this.game.focus(x, y))) this.toast('정류장을 먼저 골라 주세요');
      }
      if (act === 'stop-add' && stops.length < ROUTE_MAX) {
        stops.push({ id: 0, act: stops[stops.length - 1].act === 'load' ? 'unload' : 'load' });
        this.game.exec({ t: 'route', id: v.id, stops });
      }
      if (act === 'stop-remove' && stops.length > ROUTE_MIN) {
        stops.splice(i, 1);
        this.game.exec({ t: 'route', id: v.id, stops });
      }
      if (act === 'stop-up' && i > 0) {
        [stops[i - 1], stops[i]] = [stops[i], stops[i - 1]];
        this.game.exec({ t: 'route', id: v.id, stops });
      }
      this.update();
      return;
    }
    const b = this.selected();
    if (!b) return;
    // 설비 모듈: 명령을 보낼 때 본 공급 창고군의 구조를 함께 보내서, 그사이 군이 바뀌었으면 실패하게 한다
    if (act === 'mod-install') {
      const g = this.moduleGroup(this.game.getWorld(), b);
      if (g) {
        this.moduleSrc.set(b.id, g.id);
        const store = g.group.find((s) => s.id === g.id) ?? g.group[0];
        this.sendUse(`install:${b.id}`, { t: 'module-install', rid: newRid(), id: b.id, storage: store.id, key: g.key }, () =>
          this.toast('모듈을 설치했어요. 다음 제작부터 빨라져요'),
        );
      }
    }
    const modes: Record<string, 'normal' | 'cancel-request' | 'force' | undefined> = { 'mod-detach': 'normal', 'mod-cancel': 'cancel-request', 'mod-force': 'force' };
    const detachMode = act ? modes[act] : undefined;
    if (detachMode) {
      const name = ({ normal: 'detach', 'cancel-request': 'cancel', force: 'force' } as const)[detachMode];
      this.sendUse(`${name}:${b.id}`, { t: 'module-detach', rid: newRid(), id: b.id, mode: detachMode }, (r) =>
        this.toast(
          r.note === 'scheduled'
            ? '지금 제작이 끝나면 모듈을 분리해요'
            : r.note === 'cancelled'
              ? '분리 요청을 취소했어요'
              : `모듈을 이 자리 회수 더미에 내려놨어요${detachMode === 'force' ? ' (투입 재료도)' : ''}`,
          3000,
        ),
      );
    }
    if (act === 'target-add' || act === 'target-del') {
      const el = $('info');
      const item = (act === 'target-add'
        ? el.querySelector<HTMLSelectElement>('select[data-target-item]')?.value
        : (e.target as HTMLElement).closest<HTMLElement>('[data-item]')?.dataset.item) as ItemId | undefined;
      const n = act === 'target-add' ? Number(el.querySelector<HTMLInputElement>('input[data-target-n]')?.value) : 0;
      if (item) this.game.exec({ t: 'station-target', id: b.id, item, n });
    }
    if (act === 'project') {
      const on = !this.game.getWorld().stats.projectOn;
      this.game.exec({ t: 'project', on }, (ok) => {
        if (ok) this.toast(on ? '허브로 들어오는 설비 모듈을 프로젝트에 납품해요' : '모듈 납품을 껐어요 (들어오는 모듈은 허브 재고로)', 3000);
        this.update();
      });
    }
    if (act === 'adv-truck') {
      const w = this.game.getWorld();
      const groups = w.touchingStorageGroups(b);
      const g = groups.find((x) => x.key === this.kitSrc.get(b.id)) ?? groups[0];
      this.sendUse(`adv:${b.id}`, { t: 'build-adv-truck', rid: newRid(), station: b.id, key: g?.key ?? '' }, (r) => {
        input.selectedVehicle = r.vehicle ?? null;
        input.selectedId = null;
        this.toast(`고급 트럭 ${r.vehicle} 조립 · 노선을 정해 주세요 (그동안 이 정류장에서 충전해요)`, 3500);
      });
    }
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
      const ready = w.techs.find((t) => !w.researched.has(t.id) && w.canResearch(t.id).ok);
      const open = w.techs.find((t) => !w.researched.has(t.id) && t.requires.every((r) => w.researched.has(r)));
      // 다 마쳤으면 끝없는 연구 탭으로
      this.researchTab = ready?.category ?? open?.category ?? (w.researched.has(ENDLESS_REQUIRES) ? 'endless' : w.techs[0].category);
    }
    const tab = this.researchTab;
    const key =
      tab +
      w.techs.map((t) => `${w.researched.has(t.id) ? 1 : 0}${w.canResearch(t.id).ok ? 1 : 0}`).join('') +
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
          const list = w.techs.filter((t) => t.category === c.id);
          count = `${list.filter((t) => w.researched.has(t.id)).length}/${list.length}`;
          ready = list.some((t) => !w.researched.has(t.id) && w.canResearch(t.id).ok);
        }
        return `<button data-rtab="${c.id}" class="${c.id === tab ? 'active' : ''}" title="${ready ? '지금 연구할 수 있는 게 있어요' : ''}">
          ${techTabIcon(c.id)}${c.name} <small>${count}</small>${ready ? '<span class="ready"></span>' : ''}</button>`;
      }).join('');
      const costHtml = (list: ItemStack[]) =>
        list.map((c) => `<span class="c">${itemLink(c.item, false)}<span data-have="${c.item}"></span>/${c.count}</span>`).join(' ');
      // 끝없는 연구: 단계와 지금 효과, 다음 단계 비용
      const endless = ENDLESS_TECHS.map((t) => {
        const level = w.endlessLevel(t.id);
        const check = w.canResearch(t.id);
        const open = w.researched.has(ENDLESS_REQUIRES);
        const now = Math.round(t.step * level * 100);
        const req = open ? '' : `<div class="req">선행: ${techIcon(w.tech(ENDLESS_REQUIRES)!)}${w.tech(ENDLESS_REQUIRES)!.name}</div>`;
        return `<div class="tech ${open ? 'open' : 'locked'}">
          <h4><span class="ticon">${techIcon(t)}</span>${t.name} <small class="muted">${level}단계</small></h4>
          <p>${t.description}<br><small>지금 +${now}% → 다음 단계 +${now + Math.round(t.step * 100)}%</small></p>
          ${req}
          <div class="cost">${costHtml(endlessCost(t, level + 1))}</div>
          <button data-tech="${t.id}" ${check.ok ? '' : 'disabled'}>${check.ok ? `${level + 1}단계 연구하기` : (check.reason ?? '')}</button>
        </div>`;
      });
      const cards = tab === 'endless' ? endless.join('') : w.techs.filter((t) => t.category === tab).map((t) => {
        const done = w.researched.has(t.id);
        const check = w.canResearch(t.id);
        const reqOk = t.requires.every((r) => w.researched.has(r));
        const cls = done ? 'done' : reqOk ? 'open' : 'locked';
        const unlocks = [
          ...(t.unlockBuildings ?? []).map((b) => `<span class="tech-unlock" title="${BUILDINGS[b].name} · 설비">${buildingIcon(b)}<span>${BUILDINGS[b].name}</span></span>`),
          ...(t.unlockRecipes ?? []).map((id) => {
            const r = RECIPES[id];
            const items = [...new Set(r.outputs.map((o) => o.item))];
            return `<span class="tech-unlock" title="${r.name} 레시피"><span class="unlock-icons">${items.map(itemIcon).join('')}</span><span>${r.name} 레시피</span></span>`;
          }),
        ].join('');
        const req = t.requires.length
          ? `<div class="req">선행: ${t.requires
              .map((r) => {
                const x = w.tech(r)!;
                return `${techIcon(x)}${x.name}${w.researched.has(r) ? ' ✓' : ''}`;
              })
              .join(', ')}</div>`
          : '';
        const cost = t.cost
          .map((c) => `<span class="c">${itemLink(c.item, false)}<span data-have="${c.item}"></span>/${c.count}</span>`)
          .join(' ');
        return `<div class="tech ${cls}">
          <h4><span class="ticon">${techIcon(t)}</span>${t.name}</h4>
          <p>${t.description}</p>
          ${unlocks ? `<div class="tech-unlocks"><span class="unlock-label">해금</span><div class="unlock-list">${unlocks}</div></div>` : ''}
          ${req}
          <div class="cost">${cost}</div>
          ${done ? '<div class="badge">완료</div>' : `<button data-tech="${t.id}" ${check.ok ? '' : 'disabled'}>${check.ok ? '연구하기' : (check.reason ?? '')}</button>`}
        </div>`;
      }).join('');
      el.innerHTML = `<div class="panel"><header><h2>연구</h2><button class="x" data-act="close-modal">×</button></header>
        <p class="muted">허브 재고에서 재료를 내고 즉시 해금해요. 초록 점 = 지금 연구할 수 있는 게 있는 탭</p>
        <div class="rtabs">${tabs}</div><div class="techs">${cards}</div></div>`;
    }
    // 목표가 가리키는 연구: 그 탭(다른 탭이면)과 카드를 반짝인다
    const want = this.guideFocus?.research ?? null;
    const wantTab = want === 'endless' ? 'endless' : want ? w.tech(want)?.category : null;
    el.querySelectorAll<HTMLElement>('[data-rtab]').forEach((b) => {
      b.classList.toggle('guide-pulse', !!wantTab && wantTab !== this.researchTab && b.dataset.rtab === wantTab);
    });
    el.querySelectorAll<HTMLElement>('.tech').forEach((c) => {
      const id = c.querySelector<HTMLElement>('[data-tech]')?.dataset.tech;
      const hit = want === 'endless' ? this.researchTab === 'endless' && !!id && w.canResearch(id).ok : id === want;
      const focus = !!id && id === this.researchFocus;
      c.classList.toggle('guide-pulse', (!!want && hit) || focus);
      if (focus && this.researchScroll) {
        this.researchScroll = false;
        c.scrollIntoView({ block: 'center' });
      }
    });
    el.querySelectorAll<HTMLElement>('[data-have]').forEach((s) => {
      s.textContent = String(w.stockOf(s.dataset.have as ItemId));
    });
  }

  // ───────────────────────── 공장 통계 ─────────────────────────

  /**
   * 아이템마다 현재/최대 생산·사용량과 분당 증감, 허브 입고, 재고를 표시한다.
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
        return `<tr class="${short ? 'short' : ''}">
          <td>${itemLink(i)}</td>
          <td title="생산 설비 ${f.makers}대">${f.makers ? `<b>${fmtNum(f.made)}</b> <small>/ 최대 ${fmtNum(f.madeMax)}</small>` : '<small>–</small>'}</td>
          <td title="사용 설비 ${f.users}대">${f.users ? `<b>${fmtNum(f.used)}</b> <small>/ 최대 ${fmtNum(f.usedMax)}</small>` : '<small>–</small>'}</td>
          <td class="${net < -0.05 ? 'neg' : net > 0.05 ? 'pos' : ''}">${sign(net)}</td>
          <td class="${short ? 'neg' : netMax > 0.05 ? 'pos' : ''}">${sign(netMax)}</td>
          <td>${w.incomePerMinute(i) || '<small>–</small>'}</td>
          <td>${w.stockOf(i)}</td>
          <td>${this.stockSpark(i)}</td>
        </tr>`;
      })
      .join('');
    // 숲: 맵의 나무와 숲 되살리기 (다 캔 광맥 땅에 다 자란 나무)
    const trees = w.treeCount();
    const land = w.revivedLand();
    const forest =
      trees.grown || trees.growing || land.spent
        ? `<p>🌲 숲: 다 자란 나무 <b>${trees.grown}</b>그루 · 자라는 중 ${trees.growing}
            ${land.spent ? ` · 다 캔 광맥 땅 ${land.spent}칸 중 <b>${land.revived}</b>칸에 다 자란 나무 <small>(숲 되살리기 ${Math.min(land.revived, FOREST.revive)}/${FOREST.revive})</small>` : ''}</p>`
        : '';
    const scroll = $('stats').querySelector('.panel')?.scrollTop ?? 0;
    $('stats').innerHTML = `<div class="panel stats-panel"><header><h2>공장 통계</h2><button class="x" data-act="close-modal">×</button></header>
      ${w.regional ? this.overviewHtml(w) : ''}
      <p class="muted">단위: 개/분 · 현재 / 최대 · 증감 = 생산 − 사용</p>
      ${forest}
      <table class="stats-table">
        <thead><tr><th>아이템</th><th title="최근 15초 평균 / 최대 생산량">생산</th><th title="최근 15초 평균 / 최대 사용량">사용</th><th title="현재 생산량 − 현재 사용량. 재고 개수가 아닌 분당 변화">현재 증감</th><th title="최대 생산량 − 최대 사용량">최대 증감</th><th>허브 입고</th><th>허브 재고</th><th title="게임 시간 10초마다 잰 허브 재고. 오른쪽이 지금">재고 흐름 (10분)</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="8" class="muted">아직 아무것도 만들지 않아요</td></tr>'}</tbody>
      </table></div>`;
    $('stats').querySelector('.panel')!.scrollTop = scroll;
  }

  /**
   * 확장 세계 운영 개요: 거점마다 생산·작업 전기·전력 비율, 멈춘 기계의 원인별 수, 트럭 상태,
   * 그리고 회수 더미 목록. 누르면 그곳으로 간다
   */
  private overviewHtml(w: World): string {
    const causes: [Status, string][] = [
      ['no-input', '재료 부족'],
      ['output-full', '출력 막힘'],
      ['low-power', '전력 부족'],
      ['no-power', '전력 없음'],
      ['locked', '연구 필요'],
      ['no-recipe', '레시피 없음'],
      ['depleted', '고갈'],
    ];
    type Row = { machines: number; working: number; stalled: Map<Status, number>; stations: number; trucks: Map<string, number> };
    const rows = new Map<number, Row>();
    const row = (z: number) => {
      let r = rows.get(z);
      if (!r) rows.set(z, (r = { machines: 0, working: 0, stalled: new Map(), stations: 0, trucks: new Map() }));
      return r;
    };
    for (const b of w.buildings.values()) {
      const z = b.zone;
      if (b.type === 'station') row(z).stations++;
      if (!HAS_STATUS.includes(b.type) || b.def.power <= 0) continue;
      const r = row(z);
      r.machines++;
      if (b.status === 'working') r.working++;
      else if (causes.some(([s]) => s === b.status)) r.stalled.set(b.status, (r.stalled.get(b.status) ?? 0) + 1);
    }
    for (const v of w.vehicles.values()) {
      const st = w.buildings.get(v.stopId);
      const r = row(st ? st.zone : 0);
      const label = VEHICLE_STATUS_LABEL[v.status];
      r.trucks.set(label, (r.trucks.get(label) ?? 0) + 1);
    }
    const ids = [...rows.keys()].sort((a, b) => (a || 1e9) - (b || 1e9));
    const body = ids
      .map((id) => {
        const r = rows.get(id)!;
        const z = w.zones.find((x) => x.id === id);
        const s = z ? w.siteState.get(id) : undefined;
        const made = w.stats.zoneMade.get(id) ?? 0;
        const work = (w.stats.zoneWork.get(id) ?? 0) / 1000;
        const stalled = causes
          .filter(([st]) => r.stalled.get(st))
          .map(([st, name]) => `<span class="neg">${name} ${r.stalled.get(st)}</span>`)
          .join(' · ');
        const trucks = [...r.trucks].map(([k, n]) => `${k} ${n}`).join(' · ');
        const name = z ? `거점 ${id}${z.hub ? ' (허브)' : ''}` : '<span class="neg">거점 없음</span>';
        const focus = z ? `data-focus="${z.x},${z.y}"` : '';
        return `<tr ${focus} title="누르면 그 거점으로">
          <td>${name}</td><td>${made.toLocaleString()}</td><td>${work.toFixed(1)}</td>
          <td>${s && s.demand > 0 ? `${Math.round((s.work / s.demand) * 100)}%` : '-'}</td>
          <td>${r.working}/${r.machines}${stalled ? `<br><small>${stalled}</small>` : ''}</td>
          <td>${r.stations}${trucks ? `<br><small>${trucks}</small>` : ''}</td></tr>`;
      })
      .join('');
    const piles = [...w.pileTiles()].filter(([, n]) => n > 0);
    const pileRows = piles
      .slice(0, 12)
      .map(([tile, n]) => {
        const x = tile % w.width;
        const y = Math.floor(tile / w.width);
        const items = [...w.pileAt(tile)].map(([i, k]) => `${itemIcon(i)}${k}`).join(' ');
        const why = [...new Set(w.piles.filter((p) => p.tile === tile).map((p) => PILE_REASON_LABEL[p.why]))].join(', ');
        return `<tr data-focus="${x},${y}" title="누르면 그 자리로"><td>(${x}, ${y})</td><td>${items}</td><td><small>${why}</small></td><td>${n}</td></tr>`;
      })
      .join('');
    return `<h3>거점 운영 개요</h3>
      <table class="stats-table"><thead><tr><th>거점</th><th>누적 생산</th><th>작업 전기 MJ</th><th>전력 충족</th><th>가동 / 전체 기계</th><th>정류장 수 · 트럭 상태</th></tr></thead>
      <tbody>${body || '<tr><td colspan="6" class="muted">아직 기계가 없어요</td></tr>'}</tbody></table>
      <h3>회수 대기 ${piles.length}곳 · ${piles.reduce((a, [, n]) => a + n, 0)}개</h3>
      ${
        piles.length
          ? `<table class="stats-table"><thead><tr><th>자리</th><th>물건</th><th>이유</th><th>개수</th></tr></thead><tbody>${pileRows}</tbody></table>
             <p class="muted">지도에서 클릭하거나 하역기로 회수${piles.length > 12 ? ' · 앞 12곳 표시' : ''}</p>`
          : '<p class="muted">회수 대기 물건이 없어요.</p>'
      }`;
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
    const action = this.game.input.pointerFeedback;
    if (action) lines.push(`<b style="color:${action.color}">${action.label}</b>`);
    if (action?.pileTile !== undefined) {
      const items = [...w.pileAt(action.pileTile)];
      lines.push(items.slice(0, 4).map(([item, n]) => `${itemIcon(item)}${ITEMS[item].name} ${n}개`).join(' · ') + (items.length > 4 ? ` · 외 ${items.length - 4}종` : ''));
    }
    // 공개 전 지도에서는 지형·설비·자원 정보를 툴팁으로 노출하지 않는다.
    if (!w.isRevealed(w.idx(h.x, h.y))) {
      tip.hidden = false;
      tip.textContent = action?.label ?? '아직 공개되지 않은 지역';
      tip.style.left = `${this.mouse.x / uiZoom() + 16}px`;
      tip.style.top = `${this.mouse.y / uiZoom() + 16}px`;
      return;
    }
    const tool = this.game.input.tool;
    if (tool && (action?.kind === 'build' || action?.kind === 'blocked')) {
      const [ox, oy] = [h.x - Math.floor((BUILDINGS[tool].size - 1) / 2), h.y - Math.floor((BUILDINGS[tool].size - 1) / 2)];
      // 도로는 컨베이어를 바꿔 끼우지 않는다 (겹치면 놓을 수 없음)
      const replace = tool !== 'road';
      const check = w.canPlace(tool, ox, oy, replace);
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
      if (action?.kind === 'pickup') break;
      if (Math.floor(v.x) !== h.x || Math.floor(v.y) !== h.y) continue;
      lines.push(
        `<b>🚚 트럭 ${v.id}</b> · <span style="color:${VEHICLE_STATUS_COLOR[v.status]}">${VEHICLE_STATUS_LABEL[v.status]}</span> · 짐 ${v.load}/${TRUCK.capacity}`,
      );
    }
    const b = w.buildingAt(h.x, h.y);
    if (b && action?.kind !== 'pickup') {
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
    }
    const i = w.idx(h.x, h.y);
    const item = action?.kind === 'pickup' ? null : w.resItem[i];
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
    // 마우스 좌표는 화면 픽셀이고 툴팁은 UI 배율(글자 또렷하게)을 받으므로 나눠서 놓는다
    tip.style.left = `${this.mouse.x / uiZoom() + 16}px`;
    tip.style.top = `${this.mouse.y / uiZoom() + 16}px`;
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
 * 재료도 생산과 같은 현재 → 최대 순서. 측정 중에는 현재를 —로 두고 최대 필요량만 보여 준다.
 */
function needBlock(st: MachineStats, u: number | null): string {
  if (!st.maxIn.length) return '';
  const rows = st.maxIn
    .map(
      (i) =>
        `<div class="row need-row">${itemIcon(i.item)}<span>${ITEMS[i.item].name}</span><b>지금 ${u === null ? '—' : fmtNum(i.count * u)}</b><small>최대 ${fmtNum(i.count)}</small></div>`,
    )
    .join('');
  return `<div class="prod-sub">재료 사용 <span class="muted">/분</span></div>${rows}`;
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
      ['재료 부족', st.starve],
      ['출력 막힘', st.blocked],
      ['전력 부족', st.lowPower],
    ] as const
  ).filter(([, v]) => v >= 0.03);
  const reasonRow = reasons.length
    ? `<div class="row"><span>멈춘 이유</span><b>${reasons.map(([n, v]) => `${n} ${Math.round(v * 100)}%`).join(' · ')}</b></div>`
    : '';
  return `<div class="prod">${head}${outs}
    <div class="bar"><div style="width:${u * 100}%;background:${color}"></div></div>
    <div class="row"><span>가동률</span><b style="color:${color}">${Math.round(u * 100)}%</b></div>
    ${reasonRow}${needBlock(st, u)}</div>`;
}

/** 서버 없이 연 게임이면 방 창을 닫아 둔다 */
/** 위쪽 버튼으로 여는 큰 창 (도감은 따로 codex.ts) */
const WINDOWS = ['research', 'help', 'stats', 'ach', 'goals'] as const;
type WindowId = (typeof WINDOWS)[number];

/** 글을 쓰는 중이면 게임 단축키를 쓰지 않는다 */
function isTyping(t: EventTarget | null): boolean {
  return t instanceof HTMLElement && !!t.closest('input, select, textarea, [contenteditable="true"]');
}

/** 몇 일차 (게임 시작이 1일차) */
function dayNumber(time: number): number {
  return Math.floor(time / DAY_SEC) + 1;
}

/** 하루 안의 때: sky.ts의 구간과 같다 (낮 0~0.6 · 저녁 ~0.7 · 밤 ~0.9 · 아침 ~1) */
function dayPart(time: number): string {
  const p = dayPhase(time);
  return p < 0.6 ? '낮' : p < 0.7 ? '저녁' : p < 0.9 ? '밤' : '아침';
}

function offline(net: Session): boolean {
  // exe는 늘 자기 서버가 있다 (방장 PC 서버에서 내 서버로 갈아타는 찰나에 방 창이 닫히지 않게)
  return !net.connected && !net.borrowed && !net.joining && !net.desktop;
}

/** 플레이어가 정한 이름처럼 남이 입력한 글자를 HTML에 넣을 때 */
function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}
