import { ITEMS, type ItemId } from '../data/items';
import { countOf, type Building } from '../sim/building';
import { MACHINE_BUFFER_CRAFTS, type World } from '../sim/world';

export interface ProductionDiagnostic {
  label: string;
  detail?: string;
  item?: ItemId;
  severity: 'warning' | 'waiting';
}

/** 현재 멈춤 원인을 구체화한다. 작업·전력 상태를 덮어쓰거나 생산 상태를 바꾸지 않는다. */
export function getProductionDiagnostic(w: World, b: Building): ProductionDiagnostic | null {
  if (b.type === 'planter' && b.status === 'no-input' && countOf(b.inBuf, 'sapling') === 0) {
    let room = false, growing = false, grown = false;
    for (const tile of b.mineTiles) {
      if (w.tree[tile] >= 1) grown = true;
      else if (w.tree[tile] > 0) growing = true;
      else if (w.canPlant(tile)) room = true;
    }
    // 빈 땅이 없으면 묘목을 더 넣어도 심을 수 없다. 정상적인 성장 대기를 부족으로 경고하지 않는다.
    if (!room) return {
      label: growing ? '숲 성장 대기' : grown ? '벌목 대기' : '심을 땅 없음',
      severity: 'waiting',
    };
    if (growing || grown) return {
      label: '묘목 대기',
      detail: '회수 묘목을 기다려요. 더 공급하면 빈 땅도 채워요.',
      item: 'sapling',
      severity: 'waiting',
    };
    return {
      label: '묘목 부족',
      detail: '벌목기에서 나온 묘목을 넣어 주세요.',
      item: 'sapling',
      severity: 'warning',
    };
  }

  if (b.type === 'sawmill' && b.status === 'output-full') {
    const recipe = w.recipeOf(b);
    const blocked = recipe?.outputs.filter(o => countOf(b.outBuf, o.item) >= Math.max(1, o.count) * MACHINE_BUFFER_CRAFTS) ?? [];
    if (!blocked.length) return null; // 방금 배출되어 상태 갱신을 기다리는 경우에는 원인을 추측하지 않는다.
    const names = blocked.map(o => ITEMS[o.item].name);
    return {
      label: `${names.join('·')} 적체`,
      detail: blocked.length > 1
        ? '두 품목의 출구를 비워야 생산을 이어가요.'
        : blocked[0].item === 'sawdust'
          ? '톱밥 배출이 막혀 목재 생산도 멈췄어요.'
          : '목재가 나갈 컨베이어나 창고를 확인하세요.',
      item: blocked.length === 1 ? blocked[0].item : undefined,
      severity: 'warning',
    };
  }
  return null;
}
