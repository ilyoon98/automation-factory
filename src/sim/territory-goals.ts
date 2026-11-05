import type { ItemId } from '../data/items';
import type { GoalCheck } from './goals';
import type { World } from './world';

/**
 * 산지 협동 과제 (docs/멀티-산지협동-상세기획.md §6 점점 열기·§8 첫 목표).
 * 차례대로 하나씩 이루면 닫힌 산지가 하나씩 열린다 (4곳 → 8곳). 모두 허브 납품으로 판정해서
 * 서로 다른 산지의 자원을 모아야 이룰 수 있다. 이룬 과제 id는 w.challenges에 남는다 (지역 과제와 같은 곳).
 */
export interface TerritoryTask {
  id: string;
  title: string;
  hint: string;
  checks(w: World): GoalCheck[];
}

const delivered = (w: World, item: ItemId, need: number, name: string): GoalCheck => [`허브에 ${name}`, w.stats.hubIn.get(item) ?? 0, need, { item }];

export const TERRITORY_TASKS: TerritoryTask[] = [
  {
    id: 'T1',
    title: '네 산지의 첫 납품',
    hint: '서로의 자원을 주고받아 철판·석탄·구리판·돌을 모두 허브로 보내요. 광장과 경계로 벨트를 이어 보세요.',
    checks: (w) => [delivered(w, 'iron-plate', 50, '철판'), delivered(w, 'coal', 50, '석탄'), delivered(w, 'copper-plate', 50, '구리판'), delivered(w, 'stone', 50, '돌')],
  },
  {
    id: 'T2',
    title: '강철과 구리선',
    hint: '철과 석탄으로 강철을, 구리판으로 구리선을 만들어 허브로 보내요.',
    checks: (w) => [delivered(w, 'steel', 50, '강철'), delivered(w, 'copper-wire', 100, '구리선')],
  },
  {
    id: 'T3',
    title: '벽돌과 콘크리트',
    hint: '돌로 벽돌과 콘크리트를 구워 허브로 보내요.',
    checks: (w) => [delivered(w, 'brick', 100, '벽돌'), delivered(w, 'concrete', 50, '콘크리트')],
  },
  {
    id: 'T4',
    title: '첫 회로',
    hint: '구리선과 철판으로 회로를 만들어 허브로 보내요.',
    checks: (w) => [delivered(w, 'circuit', 100, '회로')],
  },
];

/** 지금 할 산지 과제 (모두 이뤘으면 null) */
export function currentTerritoryTask(w: World): TerritoryTask | null {
  return TERRITORY_TASKS.find((t) => !w.challenges.has(t.id)) ?? null;
}

/** 지금 과제를 이뤘으면 기록하고 닫힌 산지 하나를 연다. 새로 이룬 것: 과제 id와 'open:산지번호' */
export function evaluateTerritoryTasks(w: World): string[] {
  const t = currentTerritoryTask(w);
  if (!t || !t.checks(w).every(([, have, need]) => have >= need)) return [];
  w.challenges.add(t.id);
  const opened = w.openNextTerritory();
  return opened ? [t.id, `open:${opened.id}`] : [t.id];
}
