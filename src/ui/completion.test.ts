import { describe, expect, it } from 'vitest';
import { World } from '../sim/world';
import { MAIN_GOALS, evaluateGoals } from '../sim/goals';
import { ResearchObserver, NoticeQueue, completionSummary } from './completion';

describe('완료 사건의 재생과 기록', () => {
  it('연구는 관찰 중 새로 적용한 ID/단계만 한 번 알리고 불러오기·함께 하기 스냅샷은 조용하다', () => {
    const w = new World(30, 30), observer = new ResearchObserver();
    w.applyTech('automation'); expect(observer.poll(w)).toEqual([]);
    w.applyTech('power'); expect(observer.poll(w)).toEqual([{ id: 'power', level: 1 }]);
    w.applyTech('power'); expect(observer.poll(w)).toEqual([]);
    w.levels.set('endless-mining', 3); expect(observer.poll(w)).toEqual([{ id: 'endless-mining', level: 3 }]);
    expect(observer.poll(World.deserialize(w.serialize()))).toEqual([]);
    expect(observer.poll(World.fromSnapshot(w.snapshot()))).toEqual([]);
  });

  it('최종 완료 → 연구 → 목표/업적 순서로 한 장씩 내보내며 반복 알림을 묶는다', () => {
    const q = new NoticeQueue();
    q.push({ title: '목표', body: '', kind: 'general', ms: 2500 });
    q.push({ title: '업적', body: '', kind: 'general', ms: 2500 });
    expect(q.current?.title).toBe('목표<br>업적');
    q.push({ title: '연구', body: '', kind: 'research', ms: 4000 });
    q.push({ title: '공장망 완성', body: '', kind: 'finale', ms: 8000 });
    expect(q.current?.kind).toBe('finale'); expect(q.pending).toHaveLength(2);
    expect(q.next()?.kind).toBe('research'); expect(q.next()?.kind).toBe('general'); expect(q.next()).toBeNull();
    for (let i = 0; i < 100; i++) q.push({ title: `연구 ${i}`, body: '', kind: 'research', ms: 4000 });
    expect(q.current?.title.split('<br>')).toHaveLength(4);
    q.clear(); expect(q.current).toBeNull(); expect(q.pending).toEqual([]);
  });

  it('50개가 먼저 도착해도 선행 충족 뒤 MG36에서만 통계를 한 번 기록하고 저장·동기화한다', () => {
    const w = new World(40, 40); w.rules = 'regional-v1'; w.createHub(0, 0);
    w.stats.projectDelivered = 50; w.time = 1234;
    evaluateGoals(w); expect(w.stats.completion).toBeUndefined();
    for (const g of MAIN_GOALS) if (g.id !== 'MG36') w.goals.add(g.id);
    w.stats.zoneMade.set(1, 10); w.stats.zoneWork.set(1, 1000);
    w.stats.zoneMade.set(2, 100); w.stats.zoneWork.set(2, 999);
    expect(evaluateGoals(w)).toContain('MG36');
    expect(w.stats.completion).toEqual({ time: 1234, sites: 1, delivered: 50 });
    w.time = 9999; w.stats.zoneWork.set(2, 1000); evaluateGoals(w);
    expect(w.stats.completion?.time).toBe(1234); expect(w.stats.completion?.sites).toBe(1);
    expect(w.stats.projectDelivered).toBe(50);
    expect(World.deserialize(w.serialize()).stats.completion).toEqual(w.stats.completion);
    expect(World.fromSnapshot(w.snapshot()).stats.completion).toEqual(w.stats.completion);
    expect(completionSummary(w)).toContain('0:20:34');
  });

  it('과거 완료 저장의 빠진 통계를 현재 실적으로 채우지 않는다', () => {
    const w = new World(30, 30); w.rules = 'regional-v1'; w.createHub(0, 0);
    w.goals.add('MG36'); w.stats.projectDelivered = 50;
    const old = World.deserialize(w.serialize()); evaluateGoals(old);
    expect(old.stats.completion).toBeUndefined();
    expect(completionSummary(old)).toContain('통계는 이 저장에 없어요');
  });
});
