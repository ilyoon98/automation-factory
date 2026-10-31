import type { ItemId } from '../data/items';
import type { World } from './world';

/**
 * 지역 생산망의 메인 목표 36개 (docs/목표-진행-상세기획.md). regional-v1 세계에서만.
 * 시뮬레이션이 같은 틱에 판정하고 고정 id로 저장한다 (예전 안내의 제목 저장과 따로). 실적은 목표를 추적하기 전부터 쌓이고
 * 한 번 이룬 목표는 생산이 멈춰도 되돌아가지 않는다. 시간·유지율 조건은 없다.
 */

/** 확인 항목이 무엇을 요구하는지 (안내 반짝임용: 연구 버튼·지을 건물) */
export interface GoalHint {
  tech?: string;
  item?: ItemId;
}

/** 확인 항목 하나: [설명, 지금, 필요, 무엇을 요구하는지] */
export type GoalCheck = [string, number, number, GoalHint?];

export interface MainGoal {
  id: string;
  chapter: string;
  title: string;
  requires: string[];
  /** 다음 행동 안내 (한두 문장) */
  hint: string;
  checks(w: World): GoalCheck[];
}

const made = (w: World, item: ItemId, need: number, name: string): GoalCheck => [`${name} 누적 생산`, w.stats.made.get(item) ?? 0, need, { item }];
const tech = (w: World, id: string): GoalCheck => [`연구 "${w.tech(id)?.name ?? id}"`, w.researched.has(id) ? 1 : 0, 1, { tech: id }];

/** 생산 거점: 자동 채취·제작 10개와 작업 전기 1MJ를 기록한 전력 구역 */
export function productionZones(w: World): number[] {
  return [...w.stats.zoneMade.keys()].filter((z) => (w.stats.zoneMade.get(z) ?? 0) >= 10 && (w.stats.zoneWork.get(z) ?? 0) >= 1000).sort((a, b) => a - b);
}

/** 생산 거점 사이(출발 거점 → 다른 도착 구역) 배송: [출발, 도착, 개수, 품목들] */
function siteLinks(w: World): { from: number; to: number; n: number; items: ItemId[] }[] {
  const sites = new Set(productionZones(w));
  const out = [];
  for (const [key, p] of w.stats.pairs) {
    const [from, to] = key.split('>').map(Number);
    if (from !== to && sites.has(from)) out.push({ from, to, n: p.n, items: [...p.items] });
  }
  return out;
}

export const MAIN_GOALS: MainGoal[] = [
  // ───── 첫 공장 ─────
  {
    id: 'MG01',
    chapter: '첫 공장',
    title: '첫 생산물을 허브로',
    requires: [],
    hint: '철광석을 그대로 보내거나, 제련한 철판을 허브로 보내요.',
    checks: (w) => [
      ['철광석 채굴 또는 철판 생산', Math.max(w.stats.made.get('iron-ore') ?? 0, w.stats.made.get('iron-plate') ?? 0), 10, { item: 'iron-ore' }],
      ['허브에 들어온 철광석·철판', (w.stats.hubIn.get('iron-ore') ?? 0) + (w.stats.hubIn.get('iron-plate') ?? 0), 10],
    ],
  },
  { id: 'MG02', chapter: '첫 공장', title: '첫 철판 라인', requires: ['MG01'], hint: '제련로를 놓고 철광석을 넣어요. 출구(화살표)가 막히면 멈춰요.', checks: (w) => [made(w, 'iron-plate', 20, '철판')] },
  { id: 'MG03', chapter: '첫 공장', title: '기어 자동화', requires: ['MG02'], hint: '조립 자동화를 연구하고 조립기에서 기어를 골라요.', checks: (w) => [tech(w, 'automation'), made(w, 'gear', 20, '기어')] },
  {
    id: 'MG04',
    chapter: '첫 공장',
    title: '스스로 만드는 전기',
    requires: ['MG03'],
    hint: '석탄 발전기나 풍력 발전기를 지어 허브 밖 전기로 기계를 돌려요.',
    checks: (w) => [['허브 밖 발전원이 기계에 준 전기 (kJ)', Math.floor(w.stats.genWork), 1000]],
  },
  // ───── 기본 산업과 운송 ─────
  { id: 'MG05', chapter: '기본 산업과 운송', title: '구리선 한 줄', requires: ['MG03'], hint: '구리 가공을 연구하고 구리판을 구리선으로.', checks: (w) => [made(w, 'copper-plate', 20, '구리판'), made(w, 'copper-wire', 40, '구리선')] },
  { id: 'MG06', chapter: '기본 산업과 운송', title: '강철과 회로', requires: ['MG04', 'MG05'], hint: '철판과 석탄으로 강철, 철판과 구리선으로 회로.', checks: (w) => [made(w, 'steel', 20, '강철'), made(w, 'circuit', 20, '회로')] },
  {
    id: 'MG07',
    chapter: '기본 산업과 운송',
    title: '첫 트럭 배송',
    requires: ['MG06'],
    hint: '도로 양 끝에 정류장을 짓고 트럭으로 화물을 다른 정류장에 내려요.',
    checks: (w) => [['트럭이 다른 정류장에 내린 화물', w.stats.delivered, 20]],
  },
  { id: 'MG08', chapter: '기본 산업과 운송', title: '숲의 건설 재료', requires: ['MG06'], hint: '산림을 연구하고 벌목기·제재소로 목재를 만들어요.', checks: (w) => [tech(w, 'forestry'), made(w, 'wood', 100, '목재')] },
  // ───── 첫 지역 조합 ─────
  { id: 'MG09', chapter: '첫 지역 조합', title: '합금 가공 준비', requires: ['MG07'], hint: '합금 가공(T01)을 연구해요. 눈밭의 주석 자원지와 현지 발전을 준비해요.', checks: (w) => [tech(w, 'alloy')] },
  {
    id: 'MG10',
    chapter: '첫 지역 조합',
    title: '눈밭에서 온 주석',
    requires: ['MG09'],
    hint: '주석판 20개를 생산하고, 주석광석·주석판을 합쳐 20개를 거점 번호가 다른 정류장에 트럭으로 내려요. 거점 번호는 정류장 정보에서 확인해요.',
    checks: (w) => [made(w, 'tin-plate', 20, '주석판'), ['주석광석·주석판 다른 거점 트럭 배송', (w.stats.itemDelivered.get('tin-ore') ?? 0) + (w.stats.itemDelivered.get('tin-plate') ?? 0), 20]],
  },
  { id: 'MG11', chapter: '첫 지역 조합', title: '청동 구동부', requires: ['MG10'], hint: '구리판과 주석판으로 청동, 청동과 기어로 구동부.', checks: (w) => [made(w, 'bronze-drive', 20, '청동 구동부')] },
  { id: 'MG12', chapter: '첫 지역 조합', title: '산업 전동기 연구', requires: ['MG11', 'MG08'], hint: '산업 전동기(T02)를 연구해 수액 채취기와 화학 반응기를 열어요.', checks: (w) => [tech(w, 'industrial-motor')] },
  // ───── 숲과 금속의 연결 ─────
  { id: 'MG13', chapter: '숲과 금속의 연결', title: '전기를 감싼 고무', requires: ['MG12'], hint: '고무나무 옆 수액 채취기 → 화학 반응기(고무) → 조립기(절연 전선).', checks: (w) => [made(w, 'rubber', 20, '고무'), made(w, 'insulated-wire', 40, '절연 전선')] },
  { id: 'MG14', chapter: '숲과 금속의 연결', title: '첫 절연 모터', requires: ['MG13'], hint: '구동부·절연 전선·철판으로 절연 모터.', checks: (w) => [made(w, 'motor', 10, '절연 모터')] },
  {
    id: 'MG15',
    chapter: '숲과 금속의 연결',
    title: '두 거점의 생산',
    requires: ['MG10', 'MG14'],
    hint: '서로 다른 전력 구역 두 곳에서 생산하고, 그 사이에 제작 재료를 날라요.',
    checks: (w) => {
      const links = siteLinks(w).filter((l) => productionZones(w).includes(l.to));
      return [
        ['생산 거점 (작업 1MJ·생산 10개를 기록한 구역)', productionZones(w).length, 2],
        ['거점 사이 배송', Math.max(0, ...links.map((l) => l.n)), 20],
      ];
    },
  },
  {
    id: 'MG16',
    chapter: '숲과 금속의 연결',
    title: '현지 배전 정리',
    requires: ['MG14'],
    hint: '변전소를 지어 둘레 18칸의 기계를 전봇대 없이 돌려요.',
    checks: (w) => [['변전소에 접속한 기계에 준 전기 (kJ)', Math.floor(w.stats.formalWork), 1000]],
  },
  // ───── 제어와 경량 금속 ─────
  { id: 'MG17', chapter: '제어와 경량 금속', title: '정제 설비의 기초', requires: ['MG06'], hint: '흙 정제를 연구하고 진흙으로 벽돌을 구워요.', checks: (w) => [tech(w, 'soil-refining'), made(w, 'brick', 120, '벽돌')] },
  { id: 'MG18', chapter: '제어와 경량 금속', title: '석유에서 플라스틱', requires: ['MG14', 'MG17'], hint: '석유와 제어(T03), 시추기의 원유와 물로 정유소에서 플라스틱.', checks: (w) => [tech(w, 'oil-control'), made(w, 'plastic', 40, '플라스틱')] },
  { id: 'MG19', chapter: '제어와 경량 금속', title: '산업 제어기', requires: ['MG18', 'MG13'], hint: '회로·플라스틱·주석판으로 고급 회로, 그다음 산업 제어기.', checks: (w) => [made(w, 'adv-circuit', 10, '고급 회로'), made(w, 'controller', 10, '산업 제어기')] },
  { id: 'MG20', chapter: '제어와 경량 금속', title: '경량 프레임', requires: ['MG14', 'MG17'], hint: '전해 금속(T04), 보크사이트와 물로 알루미늄판, 그다음 경량 프레임.', checks: (w) => [tech(w, 'electro-metal'), made(w, 'frame', 10, '경량 프레임')] },
  // ───── 강화 소재와 정기 운송 ─────
  { id: 'MG21', chapter: '강화 소재와 정기 운송', title: '화산의 황', requires: ['MG19', 'MG20'], hint: '황 화학(T05)을 연구하고 화산의 황을 캐요.', checks: (w) => [tech(w, 'sulfur-chem'), made(w, 'sulfur', 10, '황 채굴')] },
  { id: 'MG22', chapter: '강화 소재와 정기 운송', title: '강화 고무와 타이어', requires: ['MG21', 'MG13'], hint: '고무와 황으로 강화 고무, 강철을 더해 강화 타이어.', checks: (w) => [made(w, 'hardened-rubber', 30, '강화 고무'), made(w, 'tire', 20, '강화 타이어')] },
  { id: 'MG23', chapter: '강화 소재와 정기 운송', title: '거점을 잇는 케이블', requires: ['MG21', 'MG20'], hint: '알루미늄판·절연 전선·강화 고무로 고용량 케이블.', checks: (w) => [made(w, 'hc-cable', 40, '고용량 케이블')] },
  {
    id: 'MG24',
    chapter: '강화 소재와 정기 운송',
    title: '정기편의 첫 성과',
    requires: ['MG15', 'MG16'],
    hint: '트럭에 운송 계획(품목·정기편)을 정해 실제로 배송해요.',
    checks: (w) => [['계획 운송 정기편으로 배송', w.stats.scheduledDelivered, 40]],
  },
  // ───── 배터리와 조립 거점 ─────
  { id: 'MG25', chapter: '배터리와 조립 거점', title: '염호에서 리튬', requires: ['MG19', 'MG20'], hint: '리튬과 축전(T06), 염수와 물로 전해로에서 리튬.', checks: (w) => [tech(w, 'lithium-storage'), made(w, 'lithium', 10, '리튬')] },
  { id: 'MG26', chapter: '배터리와 조립 거점', title: '배터리 팩', requires: ['MG25', 'MG18'], hint: '리튬·구리판·회로·플라스틱으로 배터리 팩.', checks: (w) => [made(w, 'battery-pack', 10, '배터리 팩')] },
  { id: 'MG27', chapter: '배터리와 조립 거점', title: '기계를 위한 윤활제', requires: ['MG25', 'MG18'], hint: '정유소 윤활유와 리튬으로 화학 반응기에서 고급 윤활제.', checks: (w) => [made(w, 'adv-lubricant', 10, '고급 윤활제')] },
  {
    id: 'MG28',
    chapter: '배터리와 조립 거점',
    title: '재료가 모이는 조립 거점',
    requires: ['MG19', 'MG20', 'MG26'],
    hint: '서로 다른 생산 거점 세 곳에서 한 조립 거점으로 재료를 10개 이상씩 보내요.',
    checks: (w) => {
      const by = new Map<number, number>();
      for (const l of siteLinks(w)) if (l.n >= 10) by.set(l.to, (by.get(l.to) ?? 0) + 1);
      return [['한 거점으로 10개 이상 보낸 생산 거점 수', Math.max(0, ...by.values()), 3]];
    },
  },
  // ───── 상위 운송과 통합 자동화 ─────
  {
    id: 'MG29',
    chapter: '상위 운송과 통합 자동화',
    title: '대형 조립 준비',
    requires: ['MG22', 'MG26', 'MG19'],
    hint: '상위 차량 조립(T07), 대형 조립소에 재료를 넣어 첫 제작을 시작해요.',
    checks: (w) => [tech(w, 'advanced-vehicle'), ['대형 조립소 첫 제작 시작', w.stats.largeStarted ? 1 : 0, 1]],
  },
  { id: 'MG30', chapter: '상위 운송과 통합 자동화', title: '고급 트럭 조립품', requires: ['MG29', 'MG28'], hint: '프레임·모터·타이어·배터리·제어기로 고급 트럭 조립품.', checks: (w) => [made(w, 'truck-kit', 1, '고급 트럭 조립품')] },
  {
    id: 'MG31',
    chapter: '상위 운송과 통합 자동화',
    title: '만든 트럭으로 배송',
    requires: ['MG30'],
    hint: '조립품을 정류장으로 옮겨 고급 트럭을 조립하고 실제로 배송해요.',
    checks: (w) => [['고급 트럭이 내린 화물', w.advDelivered, 20]],
  },
  { id: 'MG32', chapter: '상위 운송과 통합 자동화', title: '통합 자동화 연구', requires: ['MG29', 'MG23', 'MG08', 'MG17'], hint: '제지와 통합 자동화(T08)를 연구해요.', checks: (w) => [tech(w, 'paper-making'), tech(w, 'integrated-automation')] },
  // ───── 생산망 완성과 허브 납품 ─────
  { id: 'MG33', chapter: '생산망 완성과 허브 납품', title: '첫 설비 모듈', requires: ['MG32', 'MG27'], hint: '대형 조립소에서 자동화 설비 모듈을 만들어요.', checks: (w) => [made(w, 'module', 1, '자동화 설비 모듈')] },
  {
    id: 'MG34',
    chapter: '생산망 완성과 허브 납품',
    title: '만든 부품으로 공장 개선',
    requires: ['MG33'],
    hint: '모듈을 기계 옆 창고에 넣고 설치한 뒤, 그 기계가 한 번 제작을 마치게 해요.',
    checks: (w) => [['모듈을 쓴 제작 완료', w.moduleBatches, 1]],
  },
  {
    id: 'MG35',
    chapter: '생산망 완성과 허브 납품',
    title: '쓰임이 있는 공급선',
    requires: ['MG24', 'MG28'],
    hint: '서로 다른 생산 노선 세 개로 재료를 20개씩 보내고, 도착한 곳에서 그 재료를 실제로 써요.',
    checks: (w) => {
      const used = siteLinks(w).filter((l) => l.n >= 20 && l.items.some((i) => w.stats.zoneUsed.get(l.to)?.has(i)));
      return [['쓰임이 확인된 공급 노선', used.length, 3]];
    },
  },
  {
    id: 'MG36',
    chapter: '생산망 완성과 허브 납품',
    title: '공장망의 결실',
    requires: ['MG31', 'MG34', 'MG35'],
    hint: '허브 정보창에서 "설비 모듈 납품"을 켜고, 모듈을 허브로 실제로 보내요.',
    checks: (w) => [['설비 모듈 허브 납품', w.stats.projectDelivered, PROJECT_GOAL]],
  },
];

/** 지역 과제 하나: 그 지역 자원으로 할 수 있는 일 */
export interface RegionTask {
  id: string;
  title: string;
  hint: string;
  checks(w: World): GoalCheck[];
}

/** 지역 단계: 지금 열린 땅에서 하는 과제 셋, 그중 REGION_NEED개를 이루면 opens(거점 키, '*' = 지도 전체)가 열린다 */
export interface RegionStage {
  id: string;
  /** 지금 지역 이름 */
  name: string;
  /** 이루면 열리는 곳 (화면 안내용 이름은 world의 siteLabels) */
  opens: string[];
  tasks: RegionTask[];
}

/** 지역마다 과제 셋 중 이만큼 이루면 다음 지역이 열린다 (모두 할 필요는 없다) */
export const REGION_NEED = 2;

/**
 * 지역 과제 (2026-10-28 사용자 결정): 지도는 메인 목표가 아니라 지역 과제로 열린다.
 * 메인 목표는 공장 전체 이야기, 지역 과제는 지금 열린 땅에서 할 수 있는 일. 이룬 과제 id는 w.challenges에 남는다
 */
export const REGION_STAGES: RegionStage[] = [
  {
    id: 'R1',
    name: '시작 초원',
    opens: ['B', 'H'],
    tasks: [
      { id: 'R1a', title: '철판 공장', hint: '철광석을 제련로로 자동으로 녹여요.', checks: (w) => [made(w, 'iron-plate', 100, '철판')] },
      { id: 'R1b', title: '스스로 만든 전기', hint: '석탄·풍력 발전기로 허브 밖 전기를 기계에 대요.', checks: (w) => [['허브 밖 발전원이 기계에 준 전기 (kJ)', Math.floor(w.stats.genWork), 1000]] },
      { id: 'R1c', title: '숲의 첫 수확', hint: '벌목기로 시작 지역 가장자리 숲의 나무를 베요.', checks: (w) => [made(w, 'log', 50, '통나무')] },
    ],
  },
  {
    id: 'R2',
    name: '눈밭과 조립 부지',
    opens: ['C'],
    tasks: [
      { id: 'R2a', title: '눈밭의 주석', hint: '눈밭의 주석광석을 캐서 주석판으로.', checks: (w) => [made(w, 'tin-plate', 50, '주석판')] },
      { id: 'R2b', title: '첫 합금', hint: '구리판과 주석판으로 청동을 만들어요.', checks: (w) => [made(w, 'bronze', 40, '청동')] },
      {
        id: 'R2c',
        title: '거점 사이 운송',
        hint: '트럭으로 다른 거점에 재료를 실어 날라요.',
        checks: (w) => [['다른 거점으로 배송한 재료', [...w.stats.itemDelivered.values()].reduce((a, n) => a + n, 0), 20]],
      },
    ],
  },
  {
    id: 'R3',
    name: '숲',
    opens: ['D', 'E'],
    tasks: [
      { id: 'R3a', title: '고무나무 수액', hint: '고무나무 옆에 수액 채취기를 놓아요.', checks: (w) => [made(w, 'sap', 30, '수액')] },
      { id: 'R3b', title: '첫 고무', hint: '화학 반응기에서 수액으로 고무를 만들어요.', checks: (w) => [made(w, 'rubber', 20, '고무')] },
      { id: 'R3c', title: '다시 자라는 숲', hint: '식목기로 심은 나무가 다 자라게 해요.', checks: (w) => [['심은 나무가 다 자람', w.stats.treesMatured, 30]] },
    ],
  },
  {
    id: 'R4',
    name: '두 사막',
    opens: ['F', 'G'],
    tasks: [
      { id: 'R4a', title: '사막의 원유', hint: '모래사막의 원유 지점에 시추기를 놓아요.', checks: (w) => [made(w, 'crude-oil', 50, '원유')] },
      { id: 'R4b', title: '첫 플라스틱', hint: '정유소에서 원유와 물로 플라스틱을 만들어요.', checks: (w) => [made(w, 'plastic', 20, '플라스틱')] },
      { id: 'R4c', title: '가벼운 금속', hint: '바위사막의 보크사이트를 전해로에서 알루미늄판으로.', checks: (w) => [made(w, 'aluminum-plate', 10, '알루미늄판')] },
    ],
  },
  {
    id: 'R5',
    name: '화산과 염호',
    opens: ['tin2', 'bauxite2', 'oil2', 'brine2', 'sulfur2', 'rubber2'],
    tasks: [
      { id: 'R5a', title: '화산의 황', hint: '화산의 황 자원지를 캐요.', checks: (w) => [made(w, 'sulfur', 20, '황')] },
      { id: 'R5b', title: '지하의 불꽃', hint: '분출구 위에 지열 발전소를 지어 기계를 돌려요.', checks: (w) => [['지열이 작업에 준 전기 (kJ)', Math.floor(w.stats.geoWork), 1000]] },
      { id: 'R5c', title: '염호의 리튬', hint: '염수를 전해로에서 리튬으로.', checks: (w) => [made(w, 'lithium', 10, '리튬')] },
    ],
  },
  {
    id: 'R6',
    name: '두 번째 자원지',
    opens: ['*'],
    tasks: [
      {
        id: 'R6a',
        title: '날씨에 맞춘 발전',
        hint: '서로 다른 날씨 세 가지에서 각각 기계에 1MJ씩 전기를 대요.',
        checks: (w) => [['1MJ 넘게 일한 날씨 종류', [...w.stats.weatherWork.values()].filter((k) => k >= 1000).length, 3]],
      },
      { id: 'R6b', title: '저장해 둔 밤', hint: '낮에 축전기에 모아 둔 전기로 한밤의 기계를 돌려요.', checks: (w) => [['한밤에 축전기가 작업에 준 전기 (kJ)', Math.floor(w.stats.nightStorage), 1000]] },
      { id: 'R6c', title: '고급 트럭', hint: '대형 조립소의 고급 트럭 조립품으로 고급 트럭을 만들어요.', checks: (w) => [['고급 트럭', [...w.vehicles.values()].some((v) => v.kind !== 'basic') ? 1 : 0, 1]] },
    ],
  },
];

export const REGION_TASK_BY_ID: Record<string, RegionTask> = Object.fromEntries(REGION_STAGES.flatMap((s) => s.tasks.map((t) => [t.id, t])));

/** 이 지역 단계를 마쳤는지 (과제 REGION_NEED개) */
export function stageCleared(w: World, s: RegionStage): boolean {
  return s.tasks.filter((t) => w.challenges.has(t.id)).length >= REGION_NEED;
}

/** 지금 지역 단계 번호 (모두 마쳤으면 REGION_STAGES.length) */
export function currentStage(w: World): number {
  const i = REGION_STAGES.findIndex((s) => !stageCleared(w, s));
  return i < 0 ? REGION_STAGES.length : i;
}

/** 메인 목표가 쓰는 자원이 있는 지역: 이만큼의 지역 단계를 마쳐야 그 땅이 열려 있다 */
const GOAL_NEEDS_STAGE: Record<string, number> = { MG10: 1, MG11: 1, MG13: 2, MG18: 3, MG20: 3, MG21: 4, MG25: 4 };

/** 이 메인 목표에 필요한데 아직 안 열린 지역 단계 (없으면 null) */
export function goalNeedsStage(w: World, g: MainGoal): RegionStage | null {
  const need = GOAL_NEEDS_STAGE[g.id];
  if (!need || !w.revealed) return null;
  const cur = currentStage(w);
  return cur < need ? REGION_STAGES[cur] : null;
}

/** 허브 프로젝트의 납품 목표 */
export const PROJECT_GOAL = 50;

export const MAIN_GOAL_BY_ID: Record<string, MainGoal> = Object.fromEntries(MAIN_GOALS.map((g) => [g.id, g]));

/** 한 목표의 확인 항목이 모두 찼는지 */
export function goalMet(w: World, g: MainGoal): boolean {
  return g.checks(w).every(([, have, need]) => have >= need);
}

/** 이룰 수 있는(선행을 마친) 목표를 판정해 기록한다. 새로 이룬 id들 */
export function evaluateGoals(w: World): string[] {
  const got: string[] = [];
  for (const g of MAIN_GOALS) {
    if (w.goals.has(g.id) || !g.requires.every((r) => w.goals.has(r))) continue;
    if (!goalMet(w, g)) continue;
    w.goals.add(g.id);
    if (g.id === 'MG36') w.stats.completion = { time: w.time, sites: productionZones(w).length, delivered: w.stats.projectDelivered };
    got.push(g.id);
  }
  // 지역 과제: 지금 지역까지의 과제만 판정한다. 한 지역의 과제를 REGION_NEED개 이루면 다음 땅이 열린다
  for (let i = 0; i < REGION_STAGES.length && i <= currentStage(w); i++) {
    const s = REGION_STAGES[i];
    const was = stageCleared(w, s);
    for (const t of s.tasks) {
      if (w.challenges.has(t.id) || !t.checks(w).every(([, have, need]) => have >= need)) continue;
      w.challenges.add(t.id);
      got.push(t.id);
    }
    if (!was && stageCleared(w, s)) {
      w.revealSites(s.opens);
      got.push(`stage:${s.id}`);
    }
  }
  return got;
}

/** 지금 추적할 메인 목표 (선행을 마친 것 중 앞 번호). 다 이뤘으면 null */
export function currentGoal(w: World): MainGoal | null {
  return MAIN_GOALS.find((g) => !w.goals.has(g.id) && g.requires.every((r) => w.goals.has(r))) ?? null;
}
