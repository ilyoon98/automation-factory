import type { ItemId } from '../data/items';
import type { Territory } from './world';

/**
 * 산지 나누기 (docs/멀티-산지협동-상세기획.md §6).
 *
 * 열린 산지만 나눈다. 산지는 많아야 8곳이라 열린 산지를 사람 수만큼 묶는 모든 방법(벨 수, 8곳이면 4,140가지)을 보고
 * 가장 나은 것을 고른다: 둘 이상이면 한 사람이 네 자원을 다 갖지 않게, 점수 합이 비슷하게,
 * 같은 사람의 산지는 서로 다른 자원·이웃한 땅으로. 같은 점수면 지금 주인이 가장 많이 남는 짝을 고른다.
 */

/** 산지 점수: 수요가 많은 자원일수록 높다. 점수가 낮은 자원을 맡은 사람은 산지를 더 받는다 */
export const TERRITORY_SCORE: Partial<Record<ItemId, number>> = { coal: 3, 'iron-ore': 3, 'copper-ore': 2, stone: 2 };

/** 둘레를 도는 산지 수 (1번과 8번이 이웃) */
const RING = 8;

/**
 * players(먼저 온 순, 방장 먼저)에게 열린 산지를 나눈 결과: 산지 순서대로 주인 플레이어 번호 (-1 = 없음·닫힘).
 * 열린 산지보다 사람이 많으면 넘는 사람은 산지가 없다 (광장에만 짓는다)
 */
export function planOwners(territories: Territory[], players: number[]): number[] {
  const open = territories.filter((t) => t.open);
  const n = Math.min(players.length, open.length);
  if (!n) return territories.map(() => -1);
  const who = players.slice(0, n);
  let bestCost = Infinity;
  let best: number[] | null = null;
  let bestKeep = -1;
  for (const blocks of partitions(open.length, n)) {
    const groups = blocks.map((b) => b.map((i) => open[i]));
    const c = cost(groups, n);
    if (c > bestCost) continue;
    if (c < bestCost) [bestCost, bestKeep] = [c, -1];
    // 묶음 → 사람 짝짓기: 지금 주인이 그대로 남는 산지가 가장 많은 순서 (같으면 먼저 온 사람이 앞 묶음)
    for (const order of permutations(n)) {
      let keep = 0;
      order.forEach((g, k) => {
        for (const t of groups[g]) if (t.owner === who[k]) keep++;
      });
      if (keep <= bestKeep) continue;
      bestKeep = keep;
      const owner = new Map<number, number>();
      order.forEach((g, k) => groups[g].forEach((t) => owner.set(t.id, who[k])));
      best = territories.map((t) => owner.get(t.id) ?? -1);
    }
  }
  return best!;
}

/** 나누기의 나쁜 정도 (작을수록 좋다) */
function cost(groups: Territory[][], n: number): number {
  const scores = groups.map((g) => g.reduce((a, t) => a + (TERRITORY_SCORE[t.item] ?? 0), 0));
  let c = (Math.max(...scores) - Math.min(...scores)) * 10;
  for (const g of groups) {
    const kinds = new Set(g.map((t) => t.item)).size;
    // 혼자서 네 자원을 다 가지면 교환할 일이 없다
    if (n >= 2 && kinds >= 4) c += 1000;
    // 같은 자원을 여러 곳 갖기보다 서로 다른 자원을
    c += (g.length - kinds) * 3;
    // 같은 사람 땅은 붙어 있을수록 좋다
    for (const a of g) for (const b of g) if (a.id < b.id && (b.id - a.id === 1 || (a.id === 1 && b.id === RING))) c -= 1;
  }
  // 한 자원을 여러 사람이 나눠 가질수록 서로 주고받을 일이 줄어든다
  const holders = new Map<ItemId, number>();
  for (const g of groups) for (const item of new Set(g.map((t) => t.item))) holders.set(item, (holders.get(item) ?? 0) + 1);
  for (const k of holders.values()) c += (k - 1) * 5;
  return c;
}

/** 0..m-1을 정확히 n묶음으로 나누는 모든 방법 (묶음 순서는 처음 나온 원소 순) */
function* partitions(m: number, n: number): Generator<number[][]> {
  const label = new Array<number>(m).fill(0);
  function* go(i: number, used: number): Generator<number[][]> {
    if (m - i < n - used) return;
    if (i === m) {
      if (used !== n) return;
      const blocks: number[][] = Array.from({ length: n }, () => []);
      label.forEach((l, k) => blocks[l].push(k));
      yield blocks;
      return;
    }
    for (let l = 0; l <= Math.min(used, n - 1); l++) {
      label[i] = l;
      yield* go(i + 1, Math.max(used, l + 1));
    }
  }
  yield* go(0, 0);
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
