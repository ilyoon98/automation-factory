import { FOREST, type BuildingType } from '../data/buildings';
import { ITEM_IDS, type ItemId } from '../data/items';
import type { World } from '../sim/world';

/** 맵에서 가리킬 곳의 종류 */
export type GuideTarget = 'iron-ore' | 'copper-ore' | 'coal' | 'water' | 'hub' | 'tree' | 'spent';

/** 목표가 지금 가리키는 것: 들어야 할 건물(툴바), 연구(연구 창), 놓을 곳(맵) */
export interface GuideFocus {
  build?: BuildingType;
  /** 연구 id. 'endless'면 끝없는 연구 탭 */
  research?: string;
  /** 건물을 들었을 때(build가 없으면 늘) 맵에 표시할 곳 */
  target?: GuideTarget;
}

export interface GuideStep {
  /** 짧은 목표 (이룬 목표는 이 제목으로 저장되니 바꾸지 않는다) */
  title: string;
  /** 지금 무엇을 어떻게 하면 되는지. 짧은 문장 몇 개 (마침표마다 줄을 바꿔 보여 준다) */
  hint: string;
  done(w: World): boolean;
  /** 지금 무엇을 반짝여 알려 줄지 (상황에 따라 달라진다) */
  focus?(w: World): GuideFocus | null;
}

function has(w: World, pred: (type: string, recipe: string | null) => boolean): boolean {
  for (const b of w.buildings.values()) if (pred(b.type, b.recipe)) return true;
  return false;
}

/** 아직 안 한 연구가 있으면 그 연구부터, 다 했으면 then */
function after(w: World, ids: string[], then: GuideFocus): GuideFocus {
  const id = ids.find((t) => !w.researched.has(t));
  return id ? { research: id } : then;
}

/** 그 광석을 캐는 채굴기가 있는지 */
function mining(w: World, item: ItemId): boolean {
  for (const b of w.buildings.values()) {
    if ((b.type === 'miner' || b.type === 'miner-2') && b.mineTiles.some((i) => w.resItem[i] === item)) return true;
  }
  return false;
}

const TARGET_NAME: Record<GuideTarget, string> = {
  'iron-ore': '철광맥',
  'copper-ore': '구리광맥',
  coal: '석탄 광맥',
  water: '호수',
  hub: '허브',
  tree: '다 자란 나무',
  spent: '다 캔 광맥 땅',
};

/** 허브에서 가장 가까운 그 종류의 빈 칸 (가운데 좌표와 이름). 없으면 null */
export function findTarget(w: World, kind: GuideTarget): { x: number; y: number; label: string } | null {
  const hub = w.hub;
  const cx = hub ? hub.x + hub.size / 2 : w.width / 2;
  const cy = hub ? hub.y + hub.size / 2 : w.height / 2;
  if (kind === 'hub') return hub ? { x: cx, y: cy, label: TARGET_NAME.hub } : null;
  let best = -1;
  let bd = Infinity;
  for (let i = 0; i < w.tree.length; i++) {
    if (w.occ[i]) continue;
    const ok =
      kind === 'tree' ? w.tree[i] >= 1 : kind === 'spent' ? w.isSpentOre(i) && w.canPlant(i) : w.resItem[i] === kind;
    if (!ok) continue;
    const d = ((i % w.width) + 0.5 - cx) ** 2 + (Math.floor(i / w.width) + 0.5 - cy) ** 2;
    if (d < bd) {
      bd = d;
      best = i;
    }
  }
  if (best < 0) return null;
  return { x: (best % w.width) + 0.5, y: Math.floor(best / w.width) + 0.5, label: TARGET_NAME[kind] };
}

/** 허브에 무엇이든 들어오고 있으면 연결된 것 (중간에 제련로·조립기를 거쳐도) */
function hubReceiving(w: World): boolean {
  return ITEM_IDS.some((i) => w.incomePerMinute(i) > 0);
}

/** 처음 하는 사람을 위한 진행 목표. 순서대로 보여 준다. */
export const GUIDE: GuideStep[] = [
  {
    title: '채굴기 놓기',
    hint: '생산 탭(X)에서 채굴기(1)를 고르세요. 파란 회색 철광맥 위를 클릭해요. 노란 화살표가 출구예요.',
    done: (w) => has(w, (t) => t === 'miner' || t === 'miner-2'),
    focus: () => ({ build: 'miner', target: 'iron-ore' }),
  },
  {
    title: '채굴기에서 허브까지 컨베이어 깔기',
    hint: '물류 탭(Z)에서 컨베이어(1)를 고르세요. 채굴기 출구 앞에서 허브까지 누른 채 끌어요. 화살표가 허브를 향하면 돼요.',
    done: (w) => hubReceiving(w) || w.stockOf('iron-ore') > 0,
    focus: () => ({ build: 'belt', target: 'hub' }),
  },
  {
    title: '제련로로 철판 만들기',
    hint: '생산 탭(X)의 제련로(2)를 컨베이어 줄 위에 놓으세요. 광석이 들어가면 철판이 나와요.',
    done: (w) => w.incomePerMinute('iron-plate') > 0 || has(w, (t, r) => t === 'smelter' && r === 'iron-plate'),
    focus: () => ({ build: 'smelter' }),
  },
  {
    title: '연구: 조립 자동화',
    hint: 'T 키로 연구 창을 여세요. 조립 자동화를 연구해요 (철판 40).',
    done: (w) => w.researched.has('automation'),
    focus: () => ({ research: 'automation' }),
  },
  {
    title: '기어 자동 생산',
    hint: '조립기(X 3)를 놓고 레시피를 "기어"로 고르세요. 철판을 넣고 출구를 허브로 이어요.',
    done: (w) => w.incomePerMinute('gear') > 0,
    focus: () => ({ build: 'assembler' }),
  },
  {
    title: '구리판 생산',
    hint: '주황색 구리광맥에도 채굴기 → 제련로 → 허브 줄을 만드세요.',
    done: (w) => w.incomePerMinute('copper-plate') > 0,
    focus: (w) => (mining(w, 'copper-ore') ? { build: 'smelter' } : { build: 'miner', target: 'copper-ore' }),
  },
  {
    title: '연구: 석탄 발전',
    hint: '석탄 발전을 연구하세요 (철판 250, 기어 80, 구리판 150). 기계를 몇 대 더 늘리면 빨리 모여요.',
    done: (w) => w.researched.has('power'),
    focus: () => ({ research: 'power' }),
  },
  {
    title: '발전기에 석탄 넣기',
    hint: '짙은 회색 석탄광맥에 채굴기를 놓으세요. 컨베이어로 석탄 발전기(C 1)까지 이어요. 왼쪽 전력 공급이 300kW를 넘으면 성공이에요.',
    done: (w) => w.power.capacity > 300,
    focus: (w) => (mining(w, 'coal') ? { build: 'generator' } : { build: 'miner', target: 'coal' }),
  },
  {
    title: '강철 생산',
    hint: '강철 제련을 연구하세요. 제련로에 철판과 석탄을 같이 넣어요 (철판 2 + 석탄 1 → 강철 1).',
    done: (w) => w.incomePerMinute('steel') > 0,
    focus: (w) => after(w, ['steel'], { build: 'smelter' }),
  },
  {
    title: '회로 생산',
    hint: '구리 가공과 전자 공학을 연구하세요. 조립기 하나는 구리선, 하나는 회로를 만들게 해요.',
    done: (w) => w.incomePerMinute('circuit') > 0,
    focus: (w) => after(w, ['copper-working', 'electronics'], { build: 'assembler' }),
  },
  {
    title: '연구: 고급 채굴',
    hint: '강철과 회로로 고급 채굴을 연구하세요. 2배 빠른 고급 채굴기가 생겨요.',
    done: (w) => w.researched.has('mining-productivity'),
    focus: () => ({ research: 'mining-productivity' }),
  },
  {
    title: '연구: 차량 운송',
    hint: '가까운 광맥은 언젠가 바닥나요. 차량 운송을 연구하면 트럭으로 먼 광맥을 이을 수 있어요 (강철 200, 기어 200, 회로 100).',
    done: (w) => w.researched.has('vehicles'),
    focus: () => ({ research: 'vehicles' }),
  },
  {
    title: '트럭으로 실어 나르기',
    hint: '운송 탭(B)에서 도로를 깔고 양 끝에 정류장을 놓으세요. 허브 쪽 정류장은 "내리기"로 바꿔 허브에 붙여요. 광맥 쪽 정류장에 광석을 넣고 "트럭 만들기"를 눌러요.',
    done: (w) => [...w.vehicles.values()].some((v) => v.tripStart >= 0),
    focus: (w) => (!has(w, (t) => t === 'road') ? { build: 'road' } : w.stations().length < 2 ? { build: 'station' } : null),
  },

  // ───── 숲·나무 ─────
  {
    title: '연구: 산림',
    hint: '초록 숲은 베고 다시 심으면 끝없는 자원이에요. 자원 탭에서 산림을 연구하세요 (철판 300, 기어 150).',
    done: (w) => w.researched.has('forestry'),
    focus: () => ({ research: 'forestry' }),
  },
  {
    title: '나무 베기',
    hint: '숲 탭(N)의 벌목기를 숲 가운데에 놓으세요. 점선 안 나무를 베어 통나무와 묘목을 내보내요.',
    done: (w) => has(w, (t) => t === 'lumberjack') && (w.stockOf('log') > 0 || w.incomePerMinute('log') > 0),
    focus: () => ({ build: 'lumberjack', target: 'tree' }),
  },
  {
    title: '나무 심기',
    hint: '식목기(N 2)를 놓고 묘목을 컨베이어로 넣으세요. 빈 땅에 심으면 2분 뒤 다 자라요. 벌목기와 범위를 겹치면 숲이 끝없이 돌아가요.',
    done: (w) => w.treesGrown > 0,
    focus: () => ({ build: 'planter' }),
  },

  // ───── M7: 광맥 독립 ─────
  {
    title: '연구: 흙 정제',
    hint: '흙 정제를 연구하세요 (강철 250, 회로 200). 빈 땅에서도 흙을 캘 수 있어요.',
    done: (w) => w.researched.has('soil-refining'),
    focus: () => ({ research: 'soil-refining' }),
  },
  {
    title: '흙을 부숴 모래 만들기',
    hint: '빈 땅에 채굴기를 놓으면 흙이 나와요. 분쇄기(X 5)에 넣으면 자갈과 모래가 나와요. 스마트 분류기로 나누세요.',
    done: (w) => w.incomePerMinute('sand') > 0 || has(w, (t, r) => t === 'washer' && r === 'wash'),
    focus: (w) => ({ build: [...w.buildings.values()].some((b) => b.mineDirt) ? 'crusher' : 'miner' }),
  },
  {
    title: '양수기로 물 뜨기',
    hint: '파란 호수 위에 양수기(X 8)를 놓으세요. 물이 나와요.',
    done: (w) => has(w, (t) => t === 'pump'),
    focus: () => ({ build: 'pump', target: 'water' }),
  },
  {
    title: '세척기로 광물 가루 만들기',
    hint: '세척기(X 6)에 모래 3 + 물 2를 넣으세요. 광물 가루와 진흙이 나와요. 진흙은 제련로에서 벽돌이 돼요.',
    done: (w) => w.incomePerMinute('mineral-dust') > 0 || w.incomePerMinute('brick') > 0 || has(w, (t, r) => t === 'separator' && !!r),
    focus: () => ({ build: 'washer' }),
  },
  {
    title: '연구: 광물 분리',
    hint: '벽돌 120과 회로 150으로 광물 분리를 연구하세요. 분리기가 생겨요.',
    done: (w) => w.researched.has('separation'),
    focus: () => ({ research: 'separation' }),
  },
  {
    title: '흙에서 철판 만들기',
    hint: '분리기(X 7)가 광물 가루를 정광과 슬래그로 나눠요. 정광은 분류기로 나눠 제련로로 보내세요.',
    done: (w) => has(w, (t, r) => t === 'smelter' && (r === 'iron-plate-c' || r === 'copper-plate-c')),
    focus: () => ({ build: 'separator' }),
  },
  {
    title: '콘크리트 만들기',
    hint: '조립기에 슬래그 2 + 자갈 1을 넣으세요. 콘크리트가 나와요.',
    done: (w) => w.incomePerMinute('concrete') > 0 || w.stockOf('concrete') > 0,
    focus: () => ({ build: 'assembler' }),
  },
  {
    title: '종이 만들기',
    hint: '제지를 연구하세요 (목재 200, 회로 100). 세척기에 톱밥 2 + 물 1을 넣으면 종이가 나와요. 톱밥은 제재소에서 나와요.',
    done: (w) => w.incomePerMinute('paper') > 0 || w.stockOf('paper') > 0,
    focus: (w) => after(w, ['paper-making'], { build: 'washer' }),
  },
  {
    title: '석탄 없이 전기 만들기',
    hint: '재생 에너지를 연구하세요. 태양광 패널(늘 100kW)을 깔거나, 수력 발전기에 양수기 물을 넣어요. 수력 발전기(나무 물레방아)에는 목재가 들어요.',
    done: (w) => [...w.buildings.values()].some((b) => b.type === 'solar' || (b.type === 'hydro' && b.load > 0)),
    focus: (w) => after(w, ['renewables'], { build: 'solar' }),
  },
  {
    title: '석탄 없이 강철 만들기',
    hint: '전기 제강을 연구하세요. 전기로(X 9)가 석탄 없이 철판 2개로 강철 1개를 만들어요.',
    done: (w) => [...w.buildings.values()].some((b) => b.type === 'electric-furnace' && b.recipe === 'steel-e'),
    focus: (w) => after(w, ['electric-steel'], { build: 'electric-furnace' }),
  },
  {
    title: '연구: 광맥 독립 (최종 목표)',
    hint: '콘크리트 30, 벽돌 200, 철판 500, 강철 200으로 광맥 독립을 연구하세요. 흙 공장을 크게 지어야 하는 마지막 큰 일이에요.',
    done: (w) => w.researched.has('ore-independence'),
    focus: () => ({ research: 'ore-independence' }),
  },
  {
    title: '끝없는 연구 1단계',
    hint: '최종 목표 달성! 연구 창의 "끝없는" 탭에서 속도를 단계마다 10%씩 올릴 수 있어요.',
    done: (w) => [...w.levels.values()].some((n) => n > 0),
    focus: () => ({ research: 'endless' }),
  },
  {
    title: '숲 되살리기',
    hint: `광맥을 다 캔 빈 땅에 식목기로 나무를 심으세요. 다 자란 나무 ${FOREST.revive}그루면 성공이에요. 공장 통계에서 몇 그루인지 볼 수 있어요.`,
    done: (w) => w.revivedLand().revived >= FOREST.revive,
    focus: () => ({ build: 'planter', target: 'spent' }),
  },
];
