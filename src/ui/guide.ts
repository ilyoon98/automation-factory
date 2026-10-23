import { ITEM_IDS } from '../data/items';
import type { World } from '../sim/world';

export interface GuideStep {
  /** 짧은 목표 */
  title: string;
  /** 지금 무엇을 어떻게 하면 되는지 */
  hint: string;
  done(w: World): boolean;
}

function has(w: World, pred: (type: string, recipe: string | null) => boolean): boolean {
  for (const b of w.buildings.values()) if (pred(b.type, b.recipe)) return true;
  return false;
}

/** 허브에 무엇이든 들어오고 있으면 연결된 것 (중간에 제련로·조립기를 거쳐도) */
function hubReceiving(w: World): boolean {
  return ITEM_IDS.some((i) => w.incomePerMinute(i) > 0);
}

/** 처음 하는 사람을 위한 진행 목표. 순서대로 보여 준다. */
export const GUIDE: GuideStep[] = [
  {
    title: '채굴기 놓기',
    hint: '아래 툴바 생산 탭(X)에서 채굴기(1)를 고르고, 파란 회색 철광맥 위를 클릭하세요. 노란 화살표가 출구예요.',
    done: (w) => has(w, (t) => t === 'miner' || t === 'miner-2'),
  },
  {
    title: '채굴기에서 허브까지 컨베이어 깔기',
    hint: '물류 탭(Z)에서 컨베이어(1)를 고르고, 채굴기 출구(노란 화살표) 앞 칸에서 가운데 파란 허브까지 마우스를 누른 채 끌어요. 화살표가 허브를 향하면 광석이 흘러가요.',
    done: (w) => hubReceiving(w) || w.stockOf('iron-ore') > 0,
  },
  {
    title: '제련로로 철판 만들기',
    hint: '생산 탭(X)의 제련로(2)를 컨베이어 줄 위에 바로 놓으세요. 그 칸이 자동으로 바뀌어 라인에 끼워지고, 광석이 들어가면 철판이 나와요.',
    done: (w) => w.incomePerMinute('iron-plate') > 0 || has(w, (t, r) => t === 'smelter' && r === 'iron-plate'),
  },
  {
    title: '연구: 조립 자동화',
    hint: 'T 키(또는 위쪽 "연구" 버튼)로 연구 창을 열고 조립 자동화를 누르세요. 철판 40개가 들어요.',
    done: (w) => w.researched.has('automation'),
  },
  {
    title: '기어 자동 생산',
    hint: '생산 탭(X)의 조립기(3)를 놓으면 오른쪽에 창이 열려요. 레시피를 "기어"로 고르고, 철판을 넣은 뒤 출구(노란 화살표)를 허브로 이어 주세요. 다음 조립기부터는 기어가 자동으로 정해져요.',
    done: (w) => w.incomePerMinute('gear') > 0,
  },
  {
    title: '구리판 생산',
    hint: '주황색 구리광맥에도 채굴기 → 제련로 → 허브 라인을 하나 만드세요.',
    done: (w) => w.incomePerMinute('copper-plate') > 0,
  },
  {
    title: '연구: 석탄 발전',
    hint: '연구 창(T)에서 석탄 발전을 연구하세요. 철판 250, 기어 80, 구리판 150이 필요해요. 제련로·조립기를 몇 대 더 늘리면 빨리 모여요.',
    done: (w) => w.researched.has('power'),
  },
  {
    title: '발전기에 석탄 넣기',
    hint: '짙은 회색 석탄광맥에 채굴기를 놓고, 컨베이어로 석탄 발전기(전력 탭 C, 1)까지 이어요. 왼쪽 "전력" 칸의 공급이 300kW보다 커지면 성공이에요.',
    done: (w) => w.power.capacity > 300,
  },
  {
    title: '강철 생산',
    hint: '연구 창에서 강철 제련을 먼저 연구하고, 제련로에 철판과 석탄을 같이 넣으세요 (철판 2 + 석탄 1 → 강철 1).',
    done: (w) => w.incomePerMinute('steel') > 0,
  },
  {
    title: '회로 생산',
    hint: '구리 가공·전자 공학을 연구한 뒤, 조립기 하나는 구리선을, 다른 하나는 회로(철판 1 + 구리선 3)를 만들게 하세요.',
    done: (w) => w.incomePerMinute('circuit') > 0,
  },
  {
    title: '연구: 고급 채굴',
    hint: '강철과 회로를 모아 고급 채굴을 연구하면, 2배 빠른 고급 채굴기를 지을 수 있어요.',
    done: (w) => w.researched.has('mining-productivity'),
  },
  {
    title: '연구: 차량 운송',
    hint: '가까운 광맥은 언젠가 바닥나요. 연구 창(T)에서 차량 운송을 연구하면 도로·정류장·트럭으로 먼 광맥을 이을 수 있어요 (강철 200, 기어 200, 회로 100).',
    done: (w) => w.researched.has('vehicles'),
  },
  {
    title: '트럭으로 실어 나르기',
    hint: '운송 탭(B)에서 도로를 드래그로 깔고 양 끝 도로 옆에 정류장을 놓으세요. 허브 쪽 정류장은 클릭해서 "내리기"로 바꾸고 앞(노란 화살표)을 허브에 붙여요. 광맥 쪽 싣기 정류장에 컨베이어로 광석을 넣고, 정류장을 클릭해 "트럭 만들기". 트럭은 정류장에서 공장 전력으로 충전해요 (한 대 200kW).',
    done: (w) => [...w.vehicles.values()].some((v) => v.tripStart >= 0),
  },

  // ───── 숲·나무 ─────
  {
    title: '연구: 산림',
    hint: '맵의 초록 숲은 베고 다시 심으면 끝이 없는 자원이에요. 연구 창(T) 자원 탭에서 산림을 연구하세요 (철판 300, 기어 150).',
    done: (w) => w.researched.has('forestry'),
  },
  {
    title: '나무 베기',
    hint: '숲 탭(N)에서 벌목기(1)를 숲 가운데에 놓으세요. 점선 안의 다 자란 나무를 베어 앞(노란 화살표)으로 통나무와 묘목을 내보내요. 통나무는 제재소에서 목재로, 제련로에서 숯(석탄 대신 땔감·강철)으로.',
    done: (w) => has(w, (t) => t === 'lumberjack') && (w.stockOf('log') > 0 || w.incomePerMinute('log') > 0),
  },
  {
    title: '나무 심기',
    hint: '식목기(N 2)를 빈 땅에 놓고 벌목기에서 나온 묘목을 컨베이어로 넣으세요. 점선 안 빈 땅에 심고, 2분이면 다 자라요. 벌목기와 범위를 겹치게 두면 숲이 끝없이 돌아가요.',
    done: (w) => w.treesGrown > 0,
  },

  // ───── M7: 광맥 독립 ─────
  {
    title: '연구: 흙 정제',
    hint: '광맥은 언젠가 바닥나요. 연구 창(T)에서 흙 정제를 연구하면 빈 땅에서 흙을 캘 수 있어요 (강철 250, 회로 200).',
    done: (w) => w.researched.has('soil-refining'),
  },
  {
    title: '흙을 부숴 모래 만들기',
    hint: '광맥이 없는 빈 땅에 채굴기를 놓으면 흙이 나와요. 분쇄기(생산 탭 5)에 넣으면 자갈과 모래가 섞여 나오니, 스마트 분류기로 나누세요. 자갈도 분쇄기에 다시 넣으면 모래가 돼요.',
    done: (w) => w.incomePerMinute('sand') > 0 || has(w, (t, r) => t === 'washer' && r === 'wash'),
  },
  {
    title: '양수기로 물 뜨기',
    hint: '맵의 파란 호수 위에 양수기(생산 탭 8)를 놓으면 물이 나와요. 호수가 멀면 컨베이어나 지하 컨베이어로 끌어오세요.',
    done: (w) => has(w, (t) => t === 'pump'),
  },
  {
    title: '세척기로 광물 가루 만들기',
    hint: '세척기(생산 탭 6)에 모래 3 + 물 2를 넣으면 광물 가루와 진흙이 나와요. 진흙은 제련로에 넣으면 벽돌이 돼요.',
    done: (w) => w.incomePerMinute('mineral-dust') > 0 || w.incomePerMinute('brick') > 0 || has(w, (t, r) => t === 'separator' && !!r),
  },
  {
    title: '연구: 광물 분리',
    hint: '벽돌 120과 회로 150으로 광물 분리를 연구하면 분리기를 지을 수 있어요. 세척기를 여러 대 두면 벽돌이 빨리 모여요.',
    done: (w) => w.researched.has('separation'),
  },
  {
    title: '흙에서 철판 만들기',
    hint: '분리기(생산 탭 7)가 광물 가루를 철 정광 7 · 구리 정광 2 · 슬래그 1로 나눠요. 분류기로 나눠서 정광은 제련로로 보내세요.',
    done: (w) => has(w, (t, r) => t === 'smelter' && (r === 'iron-plate-c' || r === 'copper-plate-c')),
  },
  {
    title: '콘크리트 만들기',
    hint: '슬래그 2 + 자갈 1을 조립기에 넣으면 콘크리트가 돼요. 부산물을 버리지 않고 쓰는 방법이에요.',
    done: (w) => w.incomePerMinute('concrete') > 0 || w.stockOf('concrete') > 0,
  },
  {
    title: '석탄 없이 전기 만들기',
    hint: '석탄 광맥도 언젠가 바닥나요. 재생 에너지를 연구해서 태양광 패널(전력 탭 C, 늘 100kW)을 깔거나, 수력 발전기에 양수기 물을 넣으세요 (양수기 1대 = 600kW).',
    done: (w) => [...w.buildings.values()].some((b) => b.type === 'solar' || (b.type === 'hydro' && b.load > 0)),
  },
  {
    title: '석탄 없이 강철 만들기',
    hint: '전기 제강을 연구하면 전기로(생산 탭 9)에서 철판 2개를 강철 1개로 만들어요. 석탄 대신 전력을 많이(450kW) 써요.',
    done: (w) => [...w.buildings.values()].some((b) => b.type === 'electric-furnace' && b.recipe === 'steel-e'),
  },
  {
    title: '연구: 광맥 독립 (최종 목표)',
    hint: '재생 에너지·전기 제강까지 마치고, 콘크리트 30, 벽돌 200, 철판 500, 강철 200으로 광맥 독립을 연구하면 최종 목표 달성이에요. 흙 공장을 크게 지어야 하는 마지막 큰 일이에요.',
    done: (w) => w.researched.has('ore-independence'),
  },
  {
    title: '끝없는 연구 1단계',
    hint: '최종 목표를 이뤘어요! 연구 창(T)의 "끝없는" 탭에서 채굴·기계·컨베이어·트럭을 단계마다 10%씩 끝없이 올릴 수 있어요. 단계마다 비용이 1.5배라 공장을 키울수록 더 높이 올라가요.',
    done: (w) => [...w.levels.values()].some((n) => n > 0),
  },
];
