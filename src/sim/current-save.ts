import { World } from './world';

export const CURRENT_SAVE_KEY = 'automation-game/save-regional-v1';
export const PREVIOUS_SAVE_KEY = 'automation-game/save-v1';

/** Continue regional factories, including those written by older versions. Legacy saves remain untouched. */
export function loadCurrentSave(storage: Pick<Storage, 'getItem'>, keys = [CURRENT_SAVE_KEY, PREVIOUS_SAVE_KEY]): World | null {
  for (const key of keys) {
    try {
      const raw = storage.getItem(key);
      if (!raw) continue;
      const w = World.deserialize(JSON.parse(raw));
      if (w.regional) return w;
    } catch {
      // A damaged current slot must not hide a valid regional save from the previous slot.
    }
  }
  return null;
}
