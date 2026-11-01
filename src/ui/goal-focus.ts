import type { BuildingType } from '../data/buildings';
import type { ItemId } from '../data/items';
import { RECIPES } from '../data/recipes';
import type { MainGoal } from '../sim/goals';
import type { World } from '../sim/world';
import type { GuideFocus, GuideTarget } from './guide';

/** 땅에서 캐는 것: 그것을 캐는 건물 */
const RAW_MAKER: Partial<Record<ItemId, BuildingType>> = {
  'iron-ore': 'miner',
  'copper-ore': 'miner',
  coal: 'miner',
  stone: 'miner',
  'tin-ore': 'miner',
  bauxite: 'miner',
  sulfur: 'miner',
  log: 'lumberjack',
  sapling: 'lumberjack',
  sap: 'sap-extractor',
  'crude-oil': 'drill',
  brine: 'drill',
  water: 'pump',
};

const RAW_TARGET: Partial<Record<ItemId, GuideTarget>> = {
  'iron-ore': 'iron-ore', 'copper-ore': 'copper-ore', coal: 'coal', stone: 'stone',
  'tin-ore': 'tin-ore', bauxite: 'bauxite', sulfur: 'sulfur', 'crude-oil': 'crude-oil',
  brine: 'brine', sap: 'sap', water: 'water', log: 'tree', sapling: 'tree',
};

function extracting(w: World, item: ItemId): boolean {
  return [...w.buildings.values()].some(b => (b.type === RAW_MAKER[item] || RAW_MAKER[item] === 'miner' && b.type === 'miner-2') &&
    (item === 'log' || item === 'sapling' || b.mineTiles.some(i => w.resItem[i] === item)));
}

/**
 * 메인 목표의 다음 할 일을 반짝일 곳 (기본 지도 안내와 같은 방식): 못 마친 확인 항목 순서대로,
 * 안 한 연구면 그 연구, 만들어야 할 재료면 그것을 만드는 건물이 아직 하나도 없을 때 그 건물(잠겼으면 그 건물을 여는 연구)
 */
export function goalFocus(w: World, g: MainGoal): GuideFocus | null {
  if (g.id === 'MG01') {
    const checks = g.checks(w);
    if (checks[0][1] < checks[0][2] && !extracting(w, 'iron-ore')) return { build: 'miner', target: 'iron-ore' };
    if (checks[1][1] < checks[1][2]) return { build: 'belt', target: 'hub' };
  }
  for (const [, have, need, hint] of g.checks(w)) {
    if (have >= need || !hint) continue;
    if (hint.tech) {
      if (!w.researched.has(hint.tech)) return { research: hint.tech };
      continue;
    }
    if (!hint.item) continue;
    const ore: Partial<Record<ItemId, ItemId>> = { 'iron-plate': 'iron-ore', 'copper-plate': 'copper-ore', 'tin-plate': 'tin-ore' };
    const input = ore[hint.item];
    if (input && !extracting(w, input) && w.unlockedBuildings.has('miner')) return { build: 'miner', target: RAW_TARGET[input] };
    const type = RAW_MAKER[hint.item] ?? (Object.values(RECIPES).find((r) => r.outputs.some((o) => o.item === hint.item))?.machine as BuildingType | undefined);
    if (!type) continue;
    if (RAW_MAKER[hint.item] && extracting(w, hint.item)) continue;
    let built = false;
    for (const b of w.buildings.values()) {
      if (!RAW_MAKER[hint.item] && b.type === type) {
        built = true;
        break;
      }
    }
    if (built) continue;
    if (w.unlockedBuildings.has(type)) return { build: type, ...(RAW_TARGET[hint.item] ? { target: RAW_TARGET[hint.item] } : {}) };
    const tech = w.techs.find((t) => t.unlockBuildings?.includes(type));
    if (tech && !w.researched.has(tech.id)) return { research: tech.id };
  }
  return null;
}
