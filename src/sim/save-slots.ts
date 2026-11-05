import { CURRENT_SAVE_KEY, PREVIOUS_SAVE_KEY } from './current-save';
import { DAY_SEC } from './sky';
import { World } from './world';

/** 공장 목록 한 줄. 일차·거점·저장 시각은 목록을 그릴 때 공장을 통째로 읽지 않으려고 저장할 때마다 적어 둔다 */
export interface SlotMeta {
  id: number;
  name: string;
  /** 공장 데이터를 넣어 둔 저장 키. 예전 한 칸 저장은 원래 키를 그대로 쓴다 (예전 버전으로 돌아가도 이어 하도록) */
  key: string;
  day: number;
  sites: number;
  /** 마지막 저장 시각 (Date.now) */
  savedAt: number;
}

export interface SlotIndex {
  /** 켤 때 바로 이어 할 공장 (0 = 아직 없음) */
  active: number;
  slots: SlotMeta[];
}

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export const SLOT_NAME_MAX = 24;

/**
 * 여러 공장 저장. 목록은 `<base>/slots`에, 공장은 칸마다 따로 둔다.
 * 처음 쓰는 PC에 예전 한 칸 저장이 있으면 그 공장을 1번 공장으로 삼는다 (데이터는 옮기지 않는다).
 */
export class SaveSlots {
  constructor(
    private store: Store,
    private base = CURRENT_SAVE_KEY,
    private legacy: string[] = [PREVIOUS_SAVE_KEY],
    private now = () => Date.now(),
  ) {}

  private get indexKey(): string {
    return `${this.base}/slots`;
  }

  /** 공장 목록. 목록이 없으면 예전 저장에서 만든다 */
  index(): SlotIndex {
    try {
      const raw = this.store.getItem(this.indexKey);
      if (raw) {
        const idx = JSON.parse(raw) as SlotIndex;
        if (Array.isArray(idx.slots)) return idx;
      }
    } catch {
      // 목록이 깨졌으면 예전 저장에서 다시 만든다 (공장 데이터는 칸마다 따로라 그대로 남아 있다)
    }
    return this.migrate();
  }

  private migrate(): SlotIndex {
    const idx: SlotIndex = { active: 0, slots: [] };
    for (const key of [this.base, ...this.legacy]) {
      const w = this.read(key);
      if (!w) continue;
      idx.slots.push({ id: 1, name: '공장 1', key, ...summary(w), savedAt: this.now() });
      idx.active = 1;
      break;
    }
    this.write(idx);
    return idx;
  }

  private write(idx: SlotIndex): void {
    this.store.setItem(this.indexKey, JSON.stringify(idx));
  }

  private read(key: string): World | null {
    try {
      const raw = this.store.getItem(key);
      if (!raw) return null;
      const w = World.deserialize(JSON.parse(raw));
      return w.regional ? w : null;
    } catch {
      return null;
    }
  }

  /** 최근에 저장한 공장부터 */
  list(): SlotMeta[] {
    return [...this.index().slots].sort((a, b) => b.savedAt - a.savedAt || b.id - a.id);
  }

  get activeId(): number {
    return this.index().active;
  }

  load(id: number): World | null {
    const slot = this.index().slots.find((s) => s.id === id);
    return slot ? this.read(slot.key) : null;
  }

  /** 켤 때 이어 할 공장. 마지막 공장을 못 읽으면 남은 공장 중 최근 것 */
  loadActive(): World | null {
    const idx = this.index();
    const order = [idx.active, ...this.list().map((s) => s.id)];
    for (const id of order) {
      const w = id ? this.load(id) : null;
      if (!w) continue;
      if (id !== idx.active) this.write({ ...idx, active: id });
      return w;
    }
    return null;
  }

  /** 지금 공장을 저장한다. 아직 칸이 없으면 새로 만든다. 저장 공간이 모자라면 예외를 그대로 던진다 */
  save(w: World): void {
    let idx = this.index();
    if (!idx.slots.some((s) => s.id === idx.active)) idx = this.add(idx);
    const slot = idx.slots.find((s) => s.id === idx.active)!;
    this.store.setItem(slot.key, JSON.stringify(w.serialize()));
    Object.assign(slot, summary(w), { savedAt: this.now() });
    this.write(idx);
  }

  /** 새 공장 칸을 만들어 지금 공장으로 삼는다 (데이터는 다음 save에서 쓴다) */
  create(): SlotMeta {
    const idx = this.add(this.index());
    this.write(idx);
    return idx.slots.find((s) => s.id === idx.active)!;
  }

  private add(idx: SlotIndex): SlotIndex {
    const id = Math.max(0, ...idx.slots.map((s) => s.id)) + 1;
    // 첫 공장은 예전 한 칸 저장 키에 둔다 (예전 버전으로 돌아가도 이어 하도록). 남은 데이터가 있으면 덮어쓰지 않는다
    const key = id === 1 && this.store.getItem(this.base) === null ? this.base : `${this.base}/slot-${id}`;
    const slot: SlotMeta = { id, name: `공장 ${id}`, key, day: 1, sites: 1, savedAt: this.now() };
    return { active: id, slots: [...idx.slots, slot] };
  }

  setActive(id: number): void {
    const idx = this.index();
    if (idx.slots.some((s) => s.id === id)) this.write({ ...idx, active: id });
  }

  rename(id: number, name: string): void {
    const clean = name.trim().slice(0, SLOT_NAME_MAX);
    const idx = this.index();
    const slot = idx.slots.find((s) => s.id === id);
    if (!slot || !clean) return;
    slot.name = clean;
    this.write(idx);
  }

  /** 지금 공장이 아닌 공장만 지운다. 지웠으면 true */
  remove(id: number): boolean {
    const idx = this.index();
    const slot = idx.slots.find((s) => s.id === id);
    if (!slot || id === idx.active) return false;
    this.store.removeItem(slot.key);
    this.write({ ...idx, slots: idx.slots.filter((s) => s !== slot) });
    return true;
  }
}

function summary(w: World): Pick<SlotMeta, 'day' | 'sites'> {
  return { day: Math.floor(w.time / DAY_SEC) + 1, sites: w.zones.length };
}
