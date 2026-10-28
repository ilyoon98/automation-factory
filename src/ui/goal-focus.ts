import type { BuildingType } from '../data/buildings';
import type { ItemId } from '../data/items';
import { RECIPES } from '../data/recipes';
import type { MainGoal } from '../sim/goals';
import type { World } from '../sim/world';
import type { GuideFocus } from './guide';

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

/**
 * 메인 목표의 다음 할 일을 반짝일 곳 (기본 지도 안내와 같은 방식): 못 마친 확인 항목 순서대로,
 * 안 한 연구면 그 연구, 만들어야 할 재료면 그것을 만드는 건물이 아직 하나도 없을 때 그 건물(잠겼으면 그 건물을 여는 연구)
 */
export function goalFocus(w: World, g: MainGoal): GuideFocus | null {
  for (const [, have, need, hint] of g.checks(w)) {
    if (have >= need || !hint) continue;
    if (hint.tech) {
      if (!w.researched.has(hint.tech)) return { research: hint.tech };
      continue;
    }
    if (!hint.item) continue;
    const type = RAW_MAKER[hint.item] ?? (Object.values(RECIPES).find((r) => r.outputs.some((o) => o.item === hint.item))?.machine as BuildingType | undefined);
    if (!type) continue;
    let built = false;
    for (const b of w.buildings.values()) {
      if (b.type === type) {
        built = true;
        break;
      }
    }
    if (built) continue;
    if (w.unlockedBuildings.has(type)) return { build: type };
    const tech = w.techs.find((t) => t.unlockBuildings?.includes(type));
    if (tech && !w.researched.has(tech.id)) return { research: tech.id };
  }
  return null;
}
