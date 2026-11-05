import type { Command } from '../sim/commands';
import { planOwners } from '../sim/territory-plan';
import type { World } from '../sim/world';

/** 손님이 끊긴 뒤 산지를 지켜 주는 시간 (ms). 새로고침·잠깐 끊김이면 그 안에 돌아온다 */
export const AWAY_GRACE_MS = 120_000;

/**
 * 산지 협동: 방장(혼자 할 때도)이 산지 나누기를 정해 명령으로 모두에게 보낸다 (docs/멀티-산지협동-상세기획.md §6).
 * - 손님이 들어오면 다시 나누고, 같은 접속 키로 돌아온 사람에게는 원래 산지를 새 번호로 돌려준다.
 * - 손님이 나가면 2분 동안 그 산지를 그대로 두고, 그 뒤에도 안 돌아오면 남은 사람끼리 다시 나눈다.
 * - 방을 닫으면 모두 방장에게.
 * 손님 화면에서는 쓰지 않는다 (나누기는 한 곳에서만 정한다).
 */
export class TerritoryHost {
  /** 방에 있는 손님 (먼저 온 순) */
  private guests: { p: number; key: string }[] = [];
  /** 끊긴 손님: 접속 키 → 끊긴 시각 */
  private away = new Map<string, number>();
  /** 마지막으로 본 열린 산지 (산지 과제로 새로 열리면 다시 나눈다) */
  private openSeen = '';

  constructor(
    private getWorld: () => World,
    private exec: (cmd: Command) => void,
    private now: () => number = () => performance.now(),
  ) {}

  joined(p: number, key: string): void {
    this.guests = this.guests.filter((g) => g.p !== p && (!key || g.key !== key));
    this.guests.push({ p, key });
    this.away.delete(key);
    this.rebalance();
  }

  left(p: number): void {
    const g = this.guests.find((x) => x.p === p);
    this.guests = this.guests.filter((x) => x.p !== p);
    if (g?.key && this.getWorld().territories.some((t) => t.key === g.key)) this.away.set(g.key, this.now());
    this.rebalance();
  }

  /** 방을 닫음: 손님도 기다리던 사람도 없다 */
  ended(): void {
    this.guests = [];
    this.away.clear();
    this.rebalance();
  }

  /**
   * 공장을 불러오거나 바꾼 뒤: 지금 없는 사람의 산지는 끊긴 사람처럼 2분 기다린다
   * (방장이 새로고침해도 손님들이 돌아올 시간을 준다)
   */
  adopt(): void {
    const present = new Set(this.guests.map((g) => g.key));
    for (const t of this.getWorld().territories) {
      if (t.owner > 0 && t.key && !present.has(t.key) && !this.away.has(t.key)) this.away.set(t.key, this.now());
    }
    this.rebalance();
  }

  /** 자주 불러도 된다: 기다린 지 2분이 지난 사람의 산지를 다시 나눈다 */
  tick(): void {
    const now = this.now();
    let expired = false;
    for (const [key, at] of this.away) {
      if (now - at < AWAY_GRACE_MS) continue;
      this.away.delete(key);
      expired = true;
    }
    // 산지 과제를 이뤄 새 산지가 열렸으면 누군가에게 붙인다
    const open = this.getWorld().territories.map((t) => (t.open ? 1 : 0)).join('');
    if (expired || open !== this.openSeen) this.rebalance();
  }

  /** 지금 있는 사람과 기다리는 사람으로 다시 나눠, 바뀌면 명령을 보낸다 */
  rebalance(): void {
    const w = this.getWorld();
    if (!w.territory || !w.territories.length) return;
    // 같은 키로 돌아온 사람은 예전 번호 대신 지금 번호로 본다 (산지를 그대로 이어받도록)
    const byKey = new Map(this.guests.filter((g) => g.key).map((g) => [g.key, g.p]));
    const current = w.territories.map((t) => ({ ...t, owner: t.key && byKey.has(t.key) ? byKey.get(t.key)! : t.owner }));
    // 기다리는 사람은 예전 번호 그대로 자리를 지킨다
    const waiting = [...new Set(current.filter((t) => t.key && this.away.has(t.key)).map((t) => t.owner))];
    const players = [0, ...this.guests.map((g) => g.p), ...waiting.filter((p) => p !== 0 && !this.guests.some((g) => g.p === p))];
    // 사람이 열린 산지보다 많으면 사람 수만큼 연다 (모두 자기 땅을 하나는 갖게)
    let opened = false;
    for (const t of current) {
      if (current.filter((x) => x.open).length >= players.length) break;
      if (!t.open) [t.open, opened] = [true, true];
    }
    const owners = planOwners(current, players);
    const keyOf = (p: number) => (p <= 0 ? '' : (this.guests.find((g) => g.p === p)?.key ?? current.find((t) => t.owner === p)?.key ?? ''));
    const keys = owners.map(keyOf);
    // 트럭은 만든 사람 것: 같은 키로 돌아오면 새 번호로 이어받고, 기다리는 동안은 그대로, 떠난 사람 것은 방장에게
    const present = new Set([0, ...this.guests.map((g) => g.p)]);
    const trucks: [number, number, string][] = [];
    for (const v of w.vehicles.values()) {
      let owner = v.owner, key = v.ownerKey;
      if (key && byKey.has(key)) owner = byKey.get(key)!;
      else if (!(key && this.away.has(key)) && !present.has(owner)) [owner, key] = [0, ''];
      if (owner !== v.owner || key !== v.ownerKey) trucks.push([v.id, owner, key]);
    }
    this.openSeen = current.map((t) => (t.open ? 1 : 0)).join('');
    if (!trucks.length && !opened && w.territories.every((t, k) => t.owner === owners[k] && t.key === keys[k])) return;
    this.exec({ t: 'territories', owners, keys, ...(trucks.length ? { trucks } : {}), ...(opened ? { open: current.map((t) => t.open) } : {}) });
  }
}
