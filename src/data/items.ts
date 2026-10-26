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
  // 금속: 주석·알루미늄 (0.7.0)
  | 'tin-ore'
  | 'bauxite'
  | 'tin-plate'
  | 'bronze'
  | 'aluminum';

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
  'tin-ore': { id: 'tin-ore', name: '주석광석', color: '#c3ccd6', shape: 'ore' },
  bauxite: { id: 'bauxite', name: '보크사이트', color: '#c8645c', shape: 'ore' },
  'tin-plate': { id: 'tin-plate', name: '주석판', color: '#d8d6cc', shape: 'plate' },
  bronze: { id: 'bronze', name: '청동', color: '#c4893c', shape: 'ingot' },
  aluminum: { id: 'aluminum', name: '알루미늄판', color: '#c9def2', shape: 'plate' },
};

export const ITEM_IDS = Object.keys(ITEMS) as ItemId[];
