export type ItemId =
  | 'iron-ore'
  | 'copper-ore'
  | 'coal'
  | 'stone'
  | 'iron-plate'
  | 'copper-plate'
  | 'gear'
  | 'copper-wire'
  | 'steel'
  | 'circuit'
  // M7: 흙에서 금속 얻기
  | 'dirt'
  | 'gravel'
  | 'sand'
  | 'water'
  | 'mineral-dust'
  | 'mud'
  | 'iron-concentrate'
  | 'copper-concentrate'
  | 'slag'
  | 'brick'
  | 'concrete'
  // 숲·나무 (0.4.0)
  | 'sapling'
  | 'log'
  | 'wood'
  | 'sawdust'
  | 'charcoal'
  | 'paper'
  // 지역 생산망 확장 (regional-v1). 원자원 6종
  | 'tin-ore'
  | 'bauxite'
  | 'sap'
  | 'crude-oil'
  | 'sulfur'
  | 'brine'
  // 가공품·부품·조립품 22종
  | 'tin-plate'
  | 'bronze'
  | 'bronze-drive'
  | 'rubber'
  | 'insulated-wire'
  | 'motor'
  | 'plastic'
  | 'adv-circuit'
  | 'controller'
  | 'aluminum-plate'
  | 'frame'
  | 'hardened-rubber'
  | 'tire'
  | 'sulfuric-acid'
  | 'lithium'
  | 'battery-pack'
  | 'hc-cable'
  | 'lubricant'
  | 'fuel'
  | 'adv-lubricant'
  | 'truck-kit'
  | 'module';

/** 아이템을 그릴 때 쓰는 모양 */
export type ItemShape = 'ore' | 'plate' | 'gear' | 'wire' | 'ingot' | 'chip' | 'powder' | 'drop' | 'sapling' | 'log' | 'plank' | 'sheet';

export interface ItemDef {
  id: ItemId;
  name: string;
  color: string;
  shape: ItemShape;
}

export interface ItemStack {
  item: ItemId;
  count: number;
}

export const ITEMS: Record<ItemId, ItemDef> = {
  'iron-ore': { id: 'iron-ore', name: '철광석', color: '#7f93ad', shape: 'ore' },
  'copper-ore': { id: 'copper-ore', name: '구리광석', color: '#c9733f', shape: 'ore' },
  coal: { id: 'coal', name: '석탄', color: '#2a2a2e', shape: 'ore' },
  stone: { id: 'stone', name: '돌', color: '#a8a08f', shape: 'ore' },
  'iron-plate': { id: 'iron-plate', name: '철판', color: '#c9d1da', shape: 'plate' },
  'copper-plate': { id: 'copper-plate', name: '구리판', color: '#e8955a', shape: 'plate' },
  gear: { id: 'gear', name: '기어', color: '#9ea8b3', shape: 'gear' },
  'copper-wire': { id: 'copper-wire', name: '구리선', color: '#f2a65e', shape: 'wire' },
  steel: { id: 'steel', name: '강철', color: '#6f7d8f', shape: 'ingot' },
  circuit: { id: 'circuit', name: '회로', color: '#3fa34d', shape: 'chip' },
  dirt: { id: 'dirt', name: '흙', color: '#7a5a3a', shape: 'ore' },
  gravel: { id: 'gravel', name: '자갈', color: '#8c8c88', shape: 'powder' },
  sand: { id: 'sand', name: '모래', color: '#d9c38a', shape: 'powder' },
  water: { id: 'water', name: '물', color: '#4a90d9', shape: 'drop' },
  'mineral-dust': { id: 'mineral-dust', name: '광물 가루', color: '#8f7fa8', shape: 'powder' },
  mud: { id: 'mud', name: '진흙', color: '#5a4430', shape: 'drop' },
  'iron-concentrate': { id: 'iron-concentrate', name: '철 정광', color: '#9fb3cc', shape: 'powder' },
  'copper-concentrate': { id: 'copper-concentrate', name: '구리 정광', color: '#e0864a', shape: 'powder' },
  slag: { id: 'slag', name: '슬래그', color: '#4a4a52', shape: 'ore' },
  brick: { id: 'brick', name: '벽돌', color: '#b5583e', shape: 'ingot' },
  concrete: { id: 'concrete', name: '콘크리트', color: '#a9adb3', shape: 'plate' },
  // 저장 파일이 광맥 아이템을 이 순서(번호)로 기억하므로 새 아이템은 늘 맨 뒤에
  sapling: { id: 'sapling', name: '묘목', color: '#5fae5a', shape: 'sapling' },
  log: { id: 'log', name: '통나무', color: '#8f5c2c', shape: 'log' },
  wood: { id: 'wood', name: '목재', color: '#e3b06c', shape: 'plank' },
  sawdust: { id: 'sawdust', name: '톱밥', color: '#d9b98a', shape: 'powder' },
  charcoal: { id: 'charcoal', name: '숯', color: '#3a3230', shape: 'ore' },
  paper: { id: 'paper', name: '종이', color: '#e9dfc6', shape: 'sheet' },
  // 지역 생산망 확장 (regional-v1 세계에서만 연구로 열린다). 기존 아이템 뒤에 붙여 저장 번호를 지킨다
  'tin-ore': { id: 'tin-ore', name: '주석광석', color: '#b9c4c9', shape: 'ore' },
  bauxite: { id: 'bauxite', name: '보크사이트', color: '#b5653f', shape: 'ore' },
  sap: { id: 'sap', name: '수액', color: '#e8dcb0', shape: 'drop' },
  'crude-oil': { id: 'crude-oil', name: '원유', color: '#3b3431', shape: 'drop' },
  sulfur: { id: 'sulfur', name: '황', color: '#e3d23c', shape: 'powder' },
  brine: { id: 'brine', name: '리튬 함유 염수', color: '#8fc4c9', shape: 'drop' },
  'tin-plate': { id: 'tin-plate', name: '주석판', color: '#d9e0e3', shape: 'plate' },
  bronze: { id: 'bronze', name: '청동', color: '#c48a3c', shape: 'ingot' },
  'bronze-drive': { id: 'bronze-drive', name: '청동 구동부', color: '#b07a34', shape: 'gear' },
  rubber: { id: 'rubber', name: '고무', color: '#4a4440', shape: 'sheet' },
  'insulated-wire': { id: 'insulated-wire', name: '절연 전선', color: '#c94a3c', shape: 'wire' },
  motor: { id: 'motor', name: '절연 모터', color: '#5a7a9a', shape: 'gear' },
  plastic: { id: 'plastic', name: '플라스틱', color: '#e9eef2', shape: 'sheet' },
  'adv-circuit': { id: 'adv-circuit', name: '고급 회로', color: '#c43c3c', shape: 'chip' },
  controller: { id: 'controller', name: '산업 제어기', color: '#3c6fc4', shape: 'chip' },
  'aluminum-plate': { id: 'aluminum-plate', name: '알루미늄판', color: '#dfe6ee', shape: 'plate' },
  frame: { id: 'frame', name: '경량 프레임', color: '#9fb0c4', shape: 'ingot' },
  'hardened-rubber': { id: 'hardened-rubber', name: '강화 고무', color: '#2e2a2c', shape: 'sheet' },
  tire: { id: 'tire', name: '강화 타이어', color: '#26232a', shape: 'gear' },
  'sulfuric-acid': { id: 'sulfuric-acid', name: '황산', color: '#d8e05a', shape: 'drop' },
  lithium: { id: 'lithium', name: '리튬', color: '#e2e9ef', shape: 'powder' },
  'battery-pack': { id: 'battery-pack', name: '배터리 팩', color: '#4aa36a', shape: 'chip' },
  'hc-cable': { id: 'hc-cable', name: '고용량 케이블', color: '#d98f3c', shape: 'wire' },
  lubricant: { id: 'lubricant', name: '윤활유', color: '#9a7a2a', shape: 'drop' },
  fuel: { id: 'fuel', name: '정유 연료', color: '#d96a2a', shape: 'drop' },
  'adv-lubricant': { id: 'adv-lubricant', name: '고급 윤활제', color: '#6a9ad9', shape: 'drop' },
  'truck-kit': { id: 'truck-kit', name: '고급 트럭 조립품', color: '#d9a03c', shape: 'ingot' },
  module: { id: 'module', name: '자동화 설비 모듈', color: '#8f5fd9', shape: 'chip' },
};

export const ITEM_IDS = Object.keys(ITEMS) as ItemId[];
