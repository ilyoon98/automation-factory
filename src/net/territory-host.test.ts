import { describe, expect, it } from 'vitest';
import { applyCommand, type Command } from '../sim/commands';
import { generateTerritoryWorld } from '../sim/territory-map';
import { AWAY_GRACE_MS, TerritoryHost } from './territory-host';

function setup() {
  const w = generateTerritoryWorld(5);
  // 여덟 곳을 모두 연 지도 (산지 과제로 다 열린 뒤)
  for (const t of w.territories) { t.open = true; t.owner = 0; }
  let now = 0;
  const sent: Command[] = [];
  // 방장 명령은 방장 번호(0)로 바로 적용된다
  const host = new TerritoryHost(() => w, (cmd) => { sent.push(cmd); applyCommand(w, 0, cmd); }, () => now);
  const owners = () => w.territories.map((t) => t.owner);
  const count = (p: number) => owners().filter((o) => o === p).length;
  return { w, host, sent, owners, count, tick: (ms: number) => { now += ms; host.tick(); } };
}

describe('방장 산지 관리', () => {
  it('혼자면 모두 방장, 손님이 들어오면 둘로 나누고 접속 키를 적는다', () => {
    const f = setup();
    f.host.rebalance();
    expect(f.sent).toHaveLength(0);
    f.host.joined(7, 'key-a');
    expect(f.count(0)).toBe(4); expect(f.count(7)).toBe(4);
    expect(f.w.territories.filter((t) => t.owner === 7).every((t) => t.key === 'key-a')).toBe(true);
    expect(f.w.territories.filter((t) => t.owner === 0).every((t) => t.key === '')).toBe(true);
  });

  it('나간 손님의 산지는 2분 지켜 주고, 같은 키로 새 번호로 돌아오면 그대로 이어받는다', () => {
    const f = setup();
    f.host.joined(7, 'key-a');
    const mine = f.owners().map((o) => o === 7);
    f.host.left(7);
    f.tick(AWAY_GRACE_MS - 1000);
    expect(f.count(7)).toBe(4);
    f.host.joined(12, 'key-a');
    expect(f.owners().map((o) => o === 12)).toEqual(mine);
    expect(f.count(7)).toBe(0);
  });

  it('2분이 지나도 안 돌아오면 남은 사람끼리 다시 나눈다', () => {
    const f = setup();
    f.host.joined(7, 'key-a');
    f.host.joined(8, 'key-b');
    f.host.left(8);
    f.tick(AWAY_GRACE_MS + 1);
    expect(f.count(8)).toBe(0);
    expect(f.count(0) + f.count(7)).toBe(8);
    expect(f.count(7)).toBe(4);
  });

  it('방을 닫으면 모든 산지가 방장에게 돌아온다', () => {
    const f = setup();
    f.host.joined(7, 'key-a');
    f.host.ended();
    expect(f.count(0)).toBe(8);
    expect(f.w.territories.every((t) => t.key === '')).toBe(true);
  });

  it('불러온 공장의 없는 손님 산지는 2분 기다렸다가 방장에게 돌아오고, 그 안에 오면 이어받는다', () => {
    const f = setup();
    f.host.joined(7, 'key-a');
    const host2 = new TerritoryHost(() => f.w, (cmd) => applyCommand(f.w, 0, cmd), () => 0);
    host2.adopt();
    expect(f.count(7)).toBe(4);
    host2.joined(3, 'key-a');
    expect(f.count(3)).toBe(4);
  });

  it('산지 없는 공장이면 아무 명령도 보내지 않고, 손님이 보낸 나누기 명령은 무시한다', () => {
    const f = setup();
    expect(applyCommand(f.w, 7, { t: 'territories', owners: Array(8).fill(7), keys: Array(8).fill('x') })).toBe(false);
    expect(f.count(0)).toBe(8);
    f.w.territory = null;
    f.host.joined(7, 'key-a');
    expect(f.sent).toHaveLength(0);
  });
});
