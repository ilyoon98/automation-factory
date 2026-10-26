import { BUILDINGS, CATEGORIES, FOREST, TRUCK, isMinerType, isRecipeMachine, type BuildingType } from '../data/buildings';
import { ITEMS, type ItemId } from '../data/items';
import { RECIPES, recipesFor, type MachineKind, type Recipe } from '../data/recipes';
import { ENDLESS_GROWTH, ENDLESS_TECHS, TECHS } from '../data/tech';
import type { World } from '../sim/world';
import { buildingIconUrl, depositIconUrl, itemIconUrl, itemLink } from './icons';

/** 광맥·지형. 나오는 아이템으로 구분한다 */
export type DepositId = 'iron-ore' | 'copper-ore' | 'coal' | 'stone' | 'water' | 'dirt';

/** 도감 한 페이지: 아이템, 건물, 광맥·지형, 또는 전체 목록(null) */
export type CodexPage = { item: ItemId } | { building: BuildingType } | { deposit: DepositId } | null;

const DEPOSITS: Record<DepositId, { name: string; finite: boolean; desc: string; amount: string; where: string }> = {
  'iron-ore': {
    name: '철광맥',
    finite: true,
    desc: '철광석이 묻힌 땅이에요. 채굴기를 광맥 어디에 놓든 광맥 전체에서 캐고, 바깥 칸부터 옅어지다 사라져요. 다 캐면 빈 땅이 돼요.',
    amount: '칸당 약 200~800개. 멀리 있는 광맥일수록 넓어요',
    where: '허브 근처에 하나, 맵 바깥쪽에 여러 개',
  },
  'copper-ore': {
    name: '구리광맥',
    finite: true,
    desc: '구리광석이 묻힌 땅이에요. 채굴기를 광맥 어디에 놓든 광맥 전체에서 캐고, 바깥 칸부터 사라져요. 다 캐면 빈 땅이 돼요.',
    amount: '칸당 약 200~700개. 멀리 있는 광맥일수록 넓어요',
    where: '허브 근처에 하나, 맵 바깥쪽에 여러 개',
  },
  coal: {
    name: '석탄 광맥',
    finite: true,
    desc: '석탄이 묻힌 땅이에요. 석탄은 강철 재료이자 발전기 연료라서 두 곳이 서로 가져가려고 해요. 바깥 칸부터 사라져요.',
    amount: '칸당 약 200~700개. 멀리 있는 광맥일수록 넓어요',
    where: '허브 근처에 하나, 맵 바깥쪽에 몇 개',
  },
  stone: {
    name: '돌 광맥',
    finite: false,
    desc: '돌이 드러난 땅이에요. 아무리 캐도 줄지 않아요. 제련로·창고를 지을 때 쓰고, 분쇄기로 자갈을 만들 수 있어요.',
    amount: '무한',
    where: '허브 근처에 하나, 맵 바깥쪽에 몇 개',
  },
  water: {
    name: '호수',
    finite: false,
    desc: '물이 고인 곳이에요. 위에는 양수기만 지을 수 있고, 컨베이어는 지하 컨베이어로 건너가야 해요.',
    amount: '무한',
    where: '허브에서 20칸쯤 떨어진 곳에 하나, 멀리 여러 개',
  },
  dirt: {
    name: '빈 땅',
    finite: false,
    desc: '광맥이 없는 평범한 땅이에요. "흙 정제"를 연구하면 여기에 채굴기를 놓아 흙을 캘 수 있어요. 광맥을 다 캔 자리도 빈 땅이 돼요.',
    amount: '무한',
    where: '맵 어디나',
  },
};
const DEPOSIT_IDS = Object.keys(DEPOSITS) as DepositId[];

/** 광맥 이름 (예: 철광맥, 석탄 광맥) */
export function depositName(id: DepositId): string {
  return DEPOSITS[id].name;
}

/** 누르면 도감에서 그 광맥이 열리는 링크 */
function depositLink(id: DepositId): string {
  return `<span class="ilink" data-deposit="${id}" title="${DEPOSITS[id].name} · 클릭: 도감"><img class="icon" src="${depositIconUrl(id)}" alt="">${DEPOSITS[id].name}</span>`;
}

/** 레시피·건물을 해금하는 연구 이름 (처음부터 쓸 수 있으면 없음) */
const recipeTech = new Map<string, string>();
const buildingTech = new Map<BuildingType, string>();
for (const t of TECHS) {
  for (const r of t.unlockRecipes ?? []) recipeTech.set(r, t.name);
  for (const b of t.unlockBuildings ?? []) buildingTech.set(b, t.name);
}

/** 레시피가 아닌 방법으로 얻는 아이템: [어디서] ─건물─▶ [아이템] */
const SOURCES: { item: DepositId; building: BuildingType; note: string; dirt?: boolean }[] = [
  { item: 'iron-ore', building: 'miner', note: '캐면 줄어요' },
  { item: 'copper-ore', building: 'miner', note: '캐면 줄어요' },
  { item: 'coal', building: 'miner', note: '캐면 줄어요' },
  { item: 'stone', building: 'miner', note: '무한' },
  { item: 'dirt', building: 'miner', note: '무한', dirt: true },
  { item: 'water', building: 'pump', note: '무한' },
];

/** 레시피가 아닌 쓰임새: [아이템] ─건물─▶ 결과 */
const OTHER_USES: { item: ItemId; building: BuildingType; result: string; note: string }[] = [
  { item: 'coal', building: 'generator', result: '⚡ 전력 최대 900kW', note: '1개 = 4000kJ' },
  { item: 'charcoal', building: 'generator', result: '⚡ 전력 최대 900kW', note: '1개 = 2500kJ<br>석탄보다 먼저 태움' },
  { item: 'water', building: 'hydro', result: '⚡ 전력 최대 600kW', note: '1개 = 300kJ' },
  { item: 'sapling', building: 'planter', result: '🌱 빈 땅에 심기', note: '2분이면 다 자람' },
];

/** 전기를 만드는 건물 */
const POWER_MADE: Partial<Record<BuildingType, string>> = {
  generator: '석탄으로 전력 최대 900kW',
  hydro: '물로 전력 최대 600kW',
  solar: '맑은 낮 전력 150kW (밤 0)',
  wind: '전력 60~150kW (날씨 따라)',
};

/** 건물마다 어디로 받고 어디로 내보내는지 */
function portText(b: BuildingType): string {
  if (isMinerType(b)) return '노란 화살표(앞면)로 내보내요. 받는 곳은 없어요.';
  if (isRecipeMachine(b)) return '노란 화살표(앞면)로 내보내고, 나머지 세 면으로 재료를 받아요. R로 돌릴 수 있어요.';
  switch (b) {
    case 'splitter':
    case 'overflow':
    case 'sorter':
      return '흰 화살표(뒤)로 받고, 노란 화살표(앞·양옆)로 내보내요.';
    case 'merger':
      return '뒤·양옆(흰 화살표)으로 받고, 앞(노란 화살표)으로 내보내요.';
    case 'unloader':
      return '흰 화살표(뒤)에 붙은 허브·창고에서 꺼내 노란 화살표(앞)로 내보내요.';
    case 'storage':
    case 'hub':
    case 'generator':
    case 'hydro':
      return '아무 면으로나 받아요.';
    case 'solar':
    case 'wind':
      return '받는 것도 내보내는 것도 없어요. 놓기만 하면 전기를 만들어요.';
    case 'station':
      return '싣기 정류장은 아무 면으로나 받고, 내리기 정류장은 노란 화살표(앞)로 내보내요. 트럭은 테두리에 닿은 도로에 서요.';
    case 'road':
      return '아이템은 지나가지 않아요. 트럭만 다녀요.';
    case 'charger':
      return '아이템은 받지도 내보내지도 않아요. 바로 옆 도로에 선 트럭을 공장 전력으로 충전해요.';
    case 'lumberjack':
      return '노란 화살표(앞면)로 통나무·묘목을 내보내요. 받는 곳은 없어요. R로 돌릴 수 있어요.';
    case 'planter':
      return '아무 면으로나 묘목을 받아요. 내보내는 것은 없어요.';
    default:
      return '';
  }
}

/** 전체 목록 묶음 */
const ITEM_GROUPS: { name: string; items: ItemId[] }[] = [
  { name: '원자재', items: ['iron-ore', 'copper-ore', 'coal', 'stone', 'dirt', 'water'] },
  { name: '금속 · 부품', items: ['iron-plate', 'copper-plate', 'gear', 'copper-wire', 'steel', 'circuit'] },
  { name: '흙 정제', items: ['gravel', 'sand', 'mineral-dust', 'iron-concentrate', 'copper-concentrate'] },
  { name: '부산물 · 건설 재료', items: ['mud', 'slag', 'brick', 'concrete'] },
  { name: '숲', items: ['sapling', 'log', 'wood', 'sawdust', 'charcoal', 'paper'] },
];

const fmt = (n: number) => {
  const r = Math.round(n * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
};

/** 누르면 도감에서 그 건물이 열리는 링크 */
export function buildingLink(b: BuildingType): string {
  return `<span class="ilink" data-building="${b}" title="${BUILDINGS[b].name} · 클릭: 도감"><img class="icon" src="${buildingIconUrl(b)}" alt="">${BUILDINGS[b].name}</span>`;
}

/**
 * 도감 (마인크래프트 JEI 같은 것).
 * 아이템 페이지: 얻는 법 · 쓰는 곳 · 건설/연구 재료.
 * 건물 페이지: 설명 · 짓는 법 · 넣을 수 있는 재료 · 하는 일.
 * 표는 "왼쪽 재료 ─ 가운데 기계 ─▶ 오른쪽 결과" 모양이고, 안의 아이템·건물을 누르면 그리로 넘어간다.
 */
export class Codex {
  private el = document.getElementById('codex')!;
  private current: CodexPage = null;
  private history: CodexPage[] = [];

  constructor(
    private getWorld: () => World,
    /** 광맥 목록의 "가기": 도감을 닫고 화면을 그리로 */
    private goto: (x: number, y: number) => void = () => {},
  ) {
    this.el.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      const to = t.closest<HTMLElement>('[data-goto]')?.dataset.goto;
      if (to) {
        const [x, y] = to.split(',').map(Number);
        this.close();
        this.goto(x, y);
      } else if (t === this.el || t.closest('[data-act="close-codex"]')) this.close();
      else if (t.closest('[data-act="back"]')) this.back();
      else if (t.closest('[data-act="index"]')) this.open(null);
    });
  }

  get isOpen(): boolean {
    return !this.el.hidden;
  }

  open(page: CodexPage): void {
    if (this.isOpen && !samePage(page, this.current)) this.history.push(this.current);
    this.current = page;
    this.el.hidden = false;
    this.render();
    this.el.querySelector('.panel')!.scrollTop = 0;
  }

  toggle(): void {
    if (this.isOpen) this.close();
    else this.open(this.current);
  }

  close(): void {
    this.el.hidden = true;
    this.history = [];
  }

  private back(): void {
    if (!this.history.length) return;
    this.current = this.history.pop()!;
    this.render();
  }

  /**
   * 재고·입고 숫자만 바꾼다. 통째로 다시 그리면 누르는 도중에 요소가 바뀌어 클릭이 사라지므로
   * 페이지는 열 때·넘어갈 때만 그린다.
   */
  refresh(): void {
    if (!this.isOpen) return;
    const w = this.getWorld();
    this.el.querySelectorAll<HTMLElement>('[data-stock]').forEach((s) => {
      s.textContent = String(w.stockOf(s.dataset.stock as ItemId));
    });
    this.el.querySelectorAll<HTMLElement>('[data-income]').forEach((s) => {
      const n = w.incomePerMinute(s.dataset.income as ItemId);
      s.textContent = n ? ` · 들어오는 중 +${n}/분` : '';
    });
    // 이 공장에서 이 아이템을 지금 얼마나 만들고 쓰는지 (공장 통계와 같은 숫자)
    const flowEls = this.el.querySelectorAll<HTMLElement>('[data-flow]');
    if (flowEls.length) {
      const flows = w.factoryFlows();
      flowEls.forEach((s) => {
        const f = flows.get(s.dataset.flow as ItemId);
        s.textContent = f
          ? `이 공장: 분당 만들기 ${fmt(f.made)} (최대 ${fmt(f.madeMax)}, ${f.makers}대) · 쓰기 ${fmt(f.used)} (최대 ${fmt(f.usedMax)}, ${f.users}대)`
          : '이 공장에서는 아직 만들거나 쓰지 않아요';
      });
    }
  }

  private render(): void {
    const w = this.getWorld();
    const p = this.current;
    const nav = `<header>
        <button data-act="back" ${this.history.length ? '' : 'disabled'}>← 뒤로</button>
        <button data-act="index" ${p ? '' : 'disabled'}>전체 목록</button>
        <span class="muted">아이템·건물을 누르면 그리로 넘어가요</span>
        <button class="x" data-act="close-codex">×</button>
      </header>`;
    const body = !p
      ? this.indexPage()
      : 'item' in p
        ? this.itemPage(w, p.item)
        : 'deposit' in p
          ? this.depositPage(w, p.deposit)
          : this.buildingPage(w, p.building);
    this.el.innerHTML = `<div class="panel codex">${nav}${body}</div>`;
    this.refresh();
  }

  private indexPage(): string {
    const items = ITEM_GROUPS.map(
      (g) => `<h3>${g.name}</h3><div class="codex-grid">${g.items
        .map(
          (i) => `<div class="codex-card" data-item="${i}">
            <img src="${itemIconUrl(i)}" alt=""><b>${ITEMS[i].name}</b><span class="muted" data-stock="${i}"></span>
          </div>`,
        )
        .join('')}</div>`,
    ).join('');
    const buildings = CATEGORIES.map(
      (c) => `<h3>건물 · ${c.name}</h3><div class="codex-grid">${c.items
        .map(
          (b) => `<div class="codex-card" data-building="${b}">
            <img src="${buildingIconUrl(b)}" alt=""><b>${BUILDINGS[b].name}</b>
          </div>`,
        )
        .join('')}</div>`,
    ).join('');
    const deposits = `<h3>광맥 · 지형</h3><div class="codex-grid">${DEPOSIT_IDS.map(
      (d) => `<div class="codex-card" data-deposit="${d}">
        <img src="${depositIconUrl(d)}" alt=""><b>${DEPOSITS[d].name}</b><span class="muted">${DEPOSITS[d].finite ? '유한' : '무한'}</span>
      </div>`,
    ).join('')}</div>`;
    return deposits + items + buildings;
  }

  private depositPage(w: World, id: DepositId): string {
    const d = DEPOSITS[id];
    // 지금 맵에 남은 양 (빈 땅은 셀 필요가 없다)
    let tiles = 0;
    let left = 0;
    if (id !== 'dirt') {
      for (let i = 0; i < w.resItem.length; i++) {
        if (w.resItem[i] !== id) continue;
        tiles++;
        left += w.resAmount[i];
      }
    }
    const status =
      id === 'dirt'
        ? w.dirtMining
          ? '무한 · 캘 수 있어요'
          : '무한 · 🔒 흙 정제 연구 필요'
        : d.finite
          ? `유한 · 지금 맵에 ${left.toLocaleString()}개 남음 (${tiles}칸)`
          : `무한 · 지금 맵에 ${tiles}칸`;
    const head = `<div class="codex-head">
        <img src="${depositIconUrl(id)}" alt="">
        <div><h2>${d.name}</h2><span class="muted">${status}</span></div>
      </div>`;
    const about = `<h3>설명</h3><p class="codex-desc">${d.desc}<br><span class="muted">어디에: ${d.where}</span></p>
      <h3>매장량</h3><p class="codex-desc">${d.amount}</p>`;
    const miners: BuildingType[] = id === 'water' ? ['pump'] : ['miner', 'miner-2'];
    const base = SOURCES.find((s) => s.item === id)!;
    const rows = miners.map((m) => this.sourceRow(w, { ...base, building: m }, id, 60 * (BUILDINGS[m].speed ?? 1)));
    return head + about + section('캐는 법', rows) + this.patchSection(w, id);
  }

  /** 이 맵의 같은 광맥들: 허브에서 가까운 순, 남은 양, 채굴기 수, 누르면 그리로 */
  private patchSection(w: World, id: DepositId): string {
    if (id === 'water' || id === 'dirt' || !w.hub) return '';
    const hx = w.hub.x + 1.5;
    const hy = w.hub.y + 1.5;
    const all = w.patchList().filter((p) => p.item === id && p.remaining > 0);
    // 한두 칸짜리 부스러기는 갈 만한 곳이 아니라서 뺀다 (이미 캐고 있는 곳은 남긴다)
    const list = all
      .filter((p) => p.initial >= 1000 || p.miners > 0)
      .map((p) => ({ ...p, dist: Math.round(Math.hypot(p.x - hx, p.y - hy)) }))
      .sort((a, b) => a.dist - b.dist);
    const crumbs = all.length - list.length;
    const note = crumbs ? `<p class="muted">1,000개보다 작은 조각 ${crumbs}곳은 뺐어요.</p>` : '';
    if (!list.length) return `<h3>이 맵의 ${DEPOSITS[id].name}</h3><p class="muted">남은 곳이 없어요.</p>${note}`;
    const rows = list
      .map((p) => {
        const left = p.remaining === Infinity ? '무한' : `${p.remaining.toLocaleString()}개 (${Math.round((p.remaining / p.initial) * 100)}%)`;
        return `<div class="patch-row"><span>허브에서 <b>${p.dist}칸</b></span><span>${left}</span>
          <span class="muted">${p.miners ? `채굴기 ${p.miners}대` : '아직 안 캠'}</span>
          <button data-goto="${p.x},${p.y}">📍 가기</button></div>`;
      })
      .join('');
    return `<h3>이 맵의 ${DEPOSITS[id].name} <small>${list.length}곳 · 가까운 순</small></h3><div class="patch-list">${rows}</div>${note}`;
  }

  private itemPage(w: World, item: ItemId): string {
    const recipes = Object.values(RECIPES);
    const making = recipes.filter((r) => r.outputs.some((o) => o.item === item));
    const using = recipes.filter((r) => r.inputs.some((i) => i.item === item));
    const builds = (Object.keys(BUILDINGS) as BuildingType[])
      .map((b) => ({ b, c: BUILDINGS[b].cost.find((c) => c.item === item) }))
      .filter((x) => x.c);
    const techs = TECHS.map((t) => ({ t, c: t.cost.find((c) => c.item === item) })).filter((x) => x.c);
    const endless = ENDLESS_TECHS.map((t) => ({ t, c: t.base.find((c) => c.item === item) })).filter((x) => x.c);

    const head = `<div class="codex-head">
        <img src="${itemIconUrl(item)}" alt="">
        <div><h2>${ITEMS[item].name}</h2>
          <span class="muted">허브 재고 <b data-stock="${item}"></b><span data-income="${item}"></span></span>
          <br><span class="muted" data-flow="${item}"></span></div>
      </div>`;

    const sourceRows = SOURCES.filter((s) => s.item === item).map((s) => this.sourceRow(w, s, item));
    // 통나무·묘목: 다 자란 나무를 벌목기로 (광맥이 아니라 다시 심어 키우는 숲)
    if (item === 'log' || item === 'sapling') {
      const n = item === 'log' ? FOREST.logs : 1;
      sourceRows.push(
        flowRow({
          left: plain('🌲 다 자란 나무'),
          mid: machine('lumberjack'),
          right: chip(item, `×${n}`, item),
          tag: `분당 ${fmt((60 / FOREST.cut) * n)}<br>다시 심으면 끝없음`,
          cls: w.unlockedBuildings.has('lumberjack') ? '' : 'locked',
        }),
      );
    }
    const otherUseRows = OTHER_USES.filter((s) => s.item === item).map((s) =>
      flowRow({ left: chip(item, '×1', item), mid: machine(s.building), right: plain(s.result), tag: s.note }),
    );

    return (
      head +
      section('얻는 법', [...sourceRows, ...making.map((r) => this.recipeRow(w, r, item, 'out'))]) +
      section('쓰는 곳', [...using.map((r) => this.recipeRow(w, r, item, 'in')), ...otherUseRows]) +
      section(
        '건설 재료로',
        builds.map(({ b, c }) => {
          const locked = b !== 'hub' && !w.unlockedBuildings.has(b);
          return flowRow({
            left: chip(item, `×${c!.count}`, item),
            mid: label('🔨 짓기'),
            right: plain(buildingLink(b)),
            tag: locked ? `🔒 ${buildingTech.get(b) ?? ''}` : '',
            cls: locked ? 'locked' : '',
          });
        }),
      ) +
      section(
        '연구 재료로',
        techs.map(({ t, c }) => {
          const done = w.researched.has(t.id);
          return flowRow({
            left: chip(item, `×${c!.count}`, item),
            mid: label('🔬 연구'),
            right: plain(t.name),
            tag: done ? '<span class="ok">완료</span>' : t.description,
            cls: done ? 'done' : '',
          });
        }).concat(
          endless.map(({ t, c }) =>
            flowRow({
              left: chip(item, `×${c!.count}`, item),
              mid: label('📈 끝없는 연구'),
              right: plain(t.name),
              tag: `1단계 비용, 단계마다 ${ENDLESS_GROWTH}배 · 지금 ${w.endlessLevel(t.id)}단계`,
            }),
          ),
        ),
      )
    );
  }

  private buildingPage(w: World, b: BuildingType): string {
    const def = BUILDINGS[b];
    const locked = b !== 'hub' && !w.unlockedBuildings.has(b);
    const meta = [
      `${def.size}×${def.size}칸`,
      def.power ? `전력 ${def.power}kW` : (POWER_MADE[b] ?? '전력 필요 없음'),
      locked ? `🔒 ${buildingTech.get(b) ?? ''} 연구 필요` : '사용 가능',
    ].join(' · ');
    const head = `<div class="codex-head">
        <img src="${buildingIconUrl(b)}" alt="">
        <div><h2>${def.name}</h2><span class="muted">${meta}</span></div>
      </div>`;

    const ports = portText(b);
    const about = `<h3>설명</h3><p class="codex-desc">${def.description}${ports ? `<br><span class="muted">${ports}</span>` : ''}</p>`;

    const build =
      b === 'hub'
        ? section('짓는 법', ['<p class="muted">맵에 처음부터 하나 있어요.</p>'])
        : section('짓는 법', [
            flowRow({
              left: def.cost.map((c) => chip(c.item, `×${c.count}`)).join('<span class="plus">+</span>'),
              mid: label('🔨 짓기'),
              right: plain(`<img class="icon" src="${buildingIconUrl(b)}" alt="">${def.name}`),
              tag: locked ? `🔒 ${buildingTech.get(b) ?? ''}` : '허브 재고에서 빠지고<br>철거하면 돌려받아요',
              cls: locked ? 'locked' : '',
            }),
          ]);

    // 하는 일: 레시피 기계는 레시피 전부, 채굴기·양수기는 캐는 곳, 발전기는 연료
    let work = '';
    if (isRecipeMachine(b)) {
      const rs = recipesFor(b as MachineKind);
      const inputs = [...new Set(rs.flatMap((r) => r.inputs.map((i) => i.item)))];
      const accepts = inputs
        .map((i) => {
          const open = rs.some((r) => w.unlockedRecipes.has(r.id) && r.inputs.some((x) => x.item === i));
          return `<span class="chip ${open ? '' : 'dim'}">${itemLink(i)}</span>`;
        })
        .join('');
      const auto = b === 'assembler' ? '클릭해서 레시피를 골라요.' : '처음 들어온 재료로 레시피를 스스로 골라요 (정보창에서 바꿀 수도 있어요).';
      work =
        `<h3>넣을 수 있는 재료</h3><div class="chips">${accepts}</div><p class="muted">${auto} 흐린 재료는 아직 연구가 필요해요.</p>` +
        section(
          '하는 일 (레시피)',
          rs.map((r) => this.recipeRow(w, r, null, 'out')),
        );
    } else if (isMinerType(b)) {
      const speed = def.speed ?? 1;
      const rows = SOURCES.filter((s) => (b === 'pump') === (s.building === 'pump')).map((s) =>
        this.sourceRow(w, { ...s, building: b }, null, 60 * speed),
      );
      work = section('캐는 것', rows);
    } else {
      const uses = OTHER_USES.filter((s) => s.building === b).map((s) =>
        flowRow({ left: chip(s.item, '×1'), mid: machine(b), right: plain(s.result), tag: s.note }),
      );
      if (uses.length) work = section('넣을 수 있는 것', uses);
    }
    if (b === 'station') {
      work = section('트럭 만들기', [
        flowRow({
          left: TRUCK.cost.map((c) => chip(c.item, `×${c.count}`)).join('<span class="plus">+</span>'),
          mid: label('🔨 정류장에서'),
          right: plain('🚚 트럭'),
          tag: `한 번에 ${TRUCK.capacity}개<br>초당 ${TRUCK.speed}칸<br>충전 한 번에 ${(TRUCK.battery / TRUCK.drive) * TRUCK.speed}칸`,
          cls: locked ? 'locked' : '',
        }),
      ]);
    }
    return head + about + build + work;
  }

  /** 레시피가 아닌 얻는 법 한 줄. perMin을 주면 그 속도로 표시 */
  private sourceRow(w: World, s: (typeof SOURCES)[number], me: ItemId | null, perMin?: number): string {
    const lockedDirt = s.dirt && !w.dirtMining;
    const rate = perMin ?? 60 * ((s.building === 'pump' ? BUILDINGS.pump.speed : BUILDINGS.miner.speed) ?? 1);
    return flowRow({
      left: plain(depositLink(s.item)),
      mid: machine(s.building),
      right: chip(s.item, '', me),
      tag: lockedDirt ? '🔒 흙 정제' : `분당 ${fmt(rate)}<br>${s.note}`,
      cls: lockedDirt ? 'locked' : '',
    });
  }

  /**
   * side = me가 결과물(out)인지 재료(in)인지. 기계 한 대 기준 분당 개수를 덧붙인다.
   * me가 없으면(건물 페이지) 첫 결과물 기준.
   */
  private recipeRow(w: World, r: Recipe, me: ItemId | null, side: 'in' | 'out'): string {
    const locked = !w.unlockedRecipes.has(r.id);
    const plus = '<span class="plus">+</span>';
    const left = r.inputs.map((s) => chip(s.item, `×${fmt(s.count)}`, me)).join(plus);
    // 분리기: 10개마다 정해진 개수
    const right = r.pattern
      ? `${r.outputs.map((o) => chip(o.item, `${Math.round(o.count * 10)}`, me)).join(plus)}<span class="muted every">${r.pattern.length}개마다</span>`
      : r.outputs.map((s) => chip(s.item, `×${fmt(s.count)}`, me)).join(plus);
    const list = side === 'out' ? r.outputs : r.inputs;
    const target = (me && list.find((s) => s.item === me)) || r.outputs[0];
    const per = target.count * (60 / r.time);
    const what = me ? (side === 'out' ? '생산' : '사용') : `${ITEMS[target.item].name} 생산`;
    return flowRow({
      left,
      mid: machine(r.machine, `${r.time}초`),
      right,
      tag: locked ? `🔒 ${recipeTech.get(r.id) ?? ''}` : `한 대에 분당 ${fmt(per)}<br>${what}`,
      cls: locked ? 'locked' : '',
    });
  }
}

function samePage(a: CodexPage, b: CodexPage): boolean {
  if (!a || !b) return a === b;
  return (
    ('item' in a && 'item' in b && a.item === b.item) ||
    ('building' in a && 'building' in b && a.building === b.building) ||
    ('deposit' in a && 'deposit' in b && a.deposit === b.deposit)
  );
}

function section(title: string, rows: string[]): string {
  return `<h3>${title}</h3>${rows.length ? rows.join('') : '<p class="muted">없음</p>'}`;
}

/** 아이템 칩. me와 같은 아이템은 강조 */
function chip(item: ItemId, count: string, me: ItemId | null = null): string {
  return `<span class="chip ${item === me ? 'me' : ''}">${itemLink(item)}${count ? `<b>${count}</b>` : ''}</span>`;
}

function plain(html: string): string {
  return `<span class="chip plain">${html}</span>`;
}

function label(text: string): string {
  return `<div class="mach-label">${text}</div>`;
}

/** 가운데 칸: 기계(누르면 도감) */
function machine(b: BuildingType, sub = ''): string {
  return `<div class="mach-label">${buildingLink(b)}</div>${sub ? `<div class="flow-arrow"><span>${sub}</span></div>` : ''}`;
}

/** 왼쪽 재료 ─ 가운데 기계·화살표 ─▶ 오른쪽 결과, 맨 오른쪽 메모 */
function flowRow(o: { left: string; mid: string; right: string; tag?: string; cls?: string }): string {
  const mid = o.mid.includes('flow-arrow') ? o.mid : `${o.mid}<div class="flow-arrow"></div>`;
  return `<div class="flow ${o.cls ?? ''}">
    <div class="flow-in">${o.left}</div>
    <div class="flow-mid">${mid}</div>
    <div class="flow-out">${o.right}</div>
    <div class="flow-tag">${o.tag ?? ''}</div>
  </div>`;
}
