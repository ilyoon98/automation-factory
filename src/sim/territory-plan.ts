import type { ItemId } from '../data/items';
import type { Territory } from './world';

/**
 * 산지 나누기 (docs/멀티-산지협동-상세기획.md §6).
 *
 * 산지는 둘레를 따라 1~8번이고 철·석탄·구리·돌이 번갈아 돈다 (1 철, 2 석탄, 3 구리, 4 돌, 5 철 …).
 * 인원마다 나누는 묶음은 표로 정해 둔다: 혼자서 네 자원을 다 갖지 않게, 점수 합이 비슷하게,
 * 둘 이상 갖는 사람은 서로 다른 자원을 이웃한 땅으로. 사람이 바뀌면 지금 주인과 가장 많이 겹치게 짝지어
 * 넘어가는 산지를 줄인다.
 */

/** 산지 점수: 수요가 많은 자원일수록 높다. 점수가 낮은 자원을 맡은 사람은 산지를 더 받는다 */
export const TERRITORY_SCORE: Partial<Record<ItemId, number>> = { coal: 3, 'iron-ore': 3, 'copper-ore': 2, stone: 2 };

/** 인원수(1~8) → 사람마다 가질 산지 번호 묶음 */
const PLANS: number[][][] = [
  [],
  [[1, 2, 3, 4, 5, 6, 7, 8]],
  // 철·구리 / 석탄·돌: 서로 없으면 굴러가지 않는다
  [[1, 3, 5, 7], [2, 4, 6, 8]],
  [[1, 5], [2, 6], [3, 4, 7, 8]],
  [[1, 5], [2, 6], [3, 7], [4, 8]],
  [[2], [6], [8, 1], [4, 5], [3, 7]],
  [[1], [2], [5], [6], [3, 4], [7, 8]],
  [[1], [2], [5], [6], [7], [8], [3, 4]],
  [[1], [2], [3], [4], [5], [6], [7], [8]],
];

/** 산지 수(8)를 넘는 사람은 광장에만 짓는다 */
export const MAX_TERRITORY_PLAYERS = PLANS.length - 1;

/**
 * players(먼저 온 순, 방장 먼저)에게 산지를 나눈 결과: 산지 순서대로 주인 플레이어 번호 (-1 = 없음).
 * 같은 묶음 모양이라도 반대편(번호 +4)으로 돌려 보고, 지금 주인이 그대로 남는 산지가 가장 많은 짝을 고른다
 */
export function planOwners(territories: Territory[], players: number[]): number[] {
  const n = Math.min(players.length, MAX_TERRITORY_PLAYERS);
  if (!n) return territories.map(() => -1);
  const who = players.slice(0, n);
  const current = new Map(territories.map((t) => [t.id, t.owner]));
  let best: number[] | null = null;
  let bestKeep = -1;
  for (const shift of [0, 4]) {
    const groups = PLANS[n].map((g) => g.map((id) => ((id - 1 + shift) % 8) + 1));
    // 묶음 → 사람 짝짓기: 사람은 많아야 8명이라 모든 순서를 본다. 같으면 먼저 온 사람이 앞 묶음
    for (const order of permutations(n)) {
      let keep = 0;
      order.forEach((g, k) => {
        for (const id of groups[g]) if (current.get(id) === who[k]) keep++;
      });
      if (keep <= bestKeep) continue;
      bestKeep = keep;
      const owner = new Map<number, number>();
      order.forEach((g, k) => groups[g].forEach((id) => owner.set(id, who[k])));
      best = territories.map((t) => owner.get(t.id) ?? -1);
    }
  }
  return best!;
}

/** 0..n-1의 모든 순서 (사전 순) */
function* permutations(n: number): Generator<number[]> {
  const a = Array.from({ length: n }, (_, i) => i);
  for (;;) {
    yield [...a];
    let i = n - 2;
    while (i >= 0 && a[i] >= a[i + 1]) i--;
    if (i < 0) return;
    let j = n - 1;
    while (a[j] <= a[i]) j--;
    [a[i], a[j]] = [a[j], a[i]];
    a.splice(i + 1, n - i - 1, ...a.slice(i + 1).reverse());
  }
}

/** 사람마다 가진 산지 점수 합 (화면·시험용) */
export function scoresOf(territories: Territory[], owners: number[]): Map<number, number> {
  const out = new Map<number, number>();
  territories.forEach((t, k) => {
    if (owners[k] < 0) return;
    out.set(owners[k], (out.get(owners[k]) ?? 0) + (TERRITORY_SCORE[t.item] ?? 0));
  });
  return out;
}
