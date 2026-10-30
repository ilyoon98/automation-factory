import type { Wire } from '../sim/world';

export const wireKey = (w: Wire): string => {
  const a = `${w[0]},${w[1]}`, b = `${w[2]},${w[3]}`;
  return a < b ? `${a}/${b}` : `${b}/${a}`;
};

/** 실제 간선만으로 만드는 안정적인 신장 숲. 발전기만 있는 성분도 보존한다. */
export function representativeWires(edges: readonly Wire[], previous = new Set<string>()): Set<string> {
  const parent = new Map<string, string>();
  const root = (x: string): string => {
    const p = parent.get(x);
    if (!p) { parent.set(x, x); return x; }
    if (p === x) return x;
    const r = root(p); parent.set(x, r); return r;
  };
  const sorted = [...edges].sort((a, b) =>
    Number(previous.has(wireKey(b))) - Number(previous.has(wireKey(a))) ||
    Math.hypot(a[0] - a[2], a[1] - a[3]) - Math.hypot(b[0] - b[2], b[1] - b[3]) || wireKey(a).localeCompare(wireKey(b)));
  const chosen = new Set<string>();
  for (const e of sorted) {
    const a = root(`${e[0]},${e[1]}`), b = root(`${e[2]},${e[3]}`);
    if (a === b) continue;
    parent.set(a, b); chosen.add(wireKey(e));
  }
  return chosen;
}
