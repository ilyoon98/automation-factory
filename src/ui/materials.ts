import type { ItemStack } from '../data/items';
import { countOf, type Building } from '../sim/building';

/** Inputs are consumed when a batch starts: the buffer describes the NEXT batch, even while working. */
export function materialReadiness(b: Building, inputs: ItemStack[]) {
  return inputs.map(i => {
    const stored = countOf(b.inBuf, i.item);
    return { ...i, stored, missing: Math.max(0, i.count - stored) };
  });
}
