import { describe, expect, it, vi } from 'vitest';
import { ITEM_IDS } from '../data/items';
import { planRoad } from '../sim/road-plan';
import { World } from '../sim/world';
import { replaceRoadBuilder, roadBuilderHtml, roadPlanKey, roadStations } from './road-builder';

vi.mock('./icons', () => ({ itemIcon: (item: string) => `<img data-icon="${item}">` }));

function setup() {
  const w = new World(40, 30); w.rules = 'regional-v1'; w.createHub(0, 0);
  for (const t of w.techs) w.applyTech(t.id);
  for (const i of ITEM_IDS) w.stock.set(i, 1000);
  const a = w.place('station', 5, 5, 0)!, b = w.place('station', 25, 5, 0)!;
  return { w, a, b };
}

describe('도로 건설 미리보기 UI', () => {
  it('도로가 아직 없는 정류장도 고를 수 있고 공개되지 않은 곳은 목록에 나오지 않는다', () => {
    const { w, a, b } = setup();
    expect(w.stationStops(b)).toHaveLength(0);
    expect(roadStations(w).map((s) => s.id)).toEqual([a.id, b.id]);
    const html = roadBuilderHtml(w, a.id, b.id, planRoad(w, a.id, b.id), false);
    expect(html).toContain(`value="${b.id}" selected`); expect(html).not.toContain(`value="${a.id}"`);
    expect(html).toContain('data-icon="stone"'); expect(html).toContain('꺾임 0회'); expect(html).toContain('거점');
    w.revealed = new Uint8Array(w.width * w.height).fill(1); w.revealed[w.idx(b.x + 1, b.y)] = 0;
    expect(roadStations(w).map((s) => s.id)).toEqual([a.id]);
    expect(roadBuilderHtml(w, a.id, b.id, planRoad(w, a.id, b.id), false)).toContain('삭제되었거나 미공개인 정류장');
  });

  it('비용 부족·처리 중·추가 도로 없음은 건설 버튼을 막고 경로 확인은 유지한다', () => {
    const { w, a, b } = setup(), p = planRoad(w, a.id, b.id);
    if (!p.ok) throw Error(p.reason);
    const saved = w.serialize(), hash = w.checksum();
    expect(roadBuilderHtml(w, a.id, b.id, p, false)).toContain('data-act="road-build" >건설');
    expect(roadBuilderHtml(w, a.id, b.id, p, true)).toContain('disabled>건설 중');
    expect(w.serialize()).toEqual(saved); expect(w.checksum()).toBe(hash);
    w.stock.set('stone', 0);
    const html = roadBuilderHtml(w, a.id, b.id, p, false);
    expect(html).toContain('부족:'); expect(html).toContain('disabled>건설'); expect(html).toContain('경로 보기');
    const installed = { ...p, newTiles: [], cost: [] };
    expect(roadBuilderHtml(w, a.id, b.id, installed, false)).toContain('disabled>이미 설치됨');
  });

  it('정규화된 DOM 문자열 때문에 동일한 미리보기를 매번 다시 그리지 않는다', () => {
    let writes = 0, value = '';
    const element = { get innerHTML() { return value.replace(' selected', ' selected=""'); }, set innerHTML(html: string) { writes++; value = html; } } as HTMLElement;
    const html = '<select><option selected>정류장</option></select>';
    replaceRoadBuilder(element, html); replaceRoadBuilder(element, html);
    expect(writes).toBe(1);
    replaceRoadBuilder(element, html + '<p>갱신</p>'); expect(writes).toBe(2);
  });

  it('건물·도로·공개 범위 변경은 경로를 갱신하고 재고 변화는 선택 목록을 재탐색하지 않는다', () => {
    const { w } = setup(); const key = roadPlanKey(w);
    w.stock.set('stone', 1); expect(roadPlanKey(w)).toBe(key);
    const b = w.place('belt', 15, 15, 0)!; expect(roadPlanKey(w)).not.toBe(key);
    const placed = roadPlanKey(w); w.remove(b); expect(roadPlanKey(w)).not.toBe(placed);
    const removed = roadPlanKey(w); w.revealedCount++; expect(roadPlanKey(w)).not.toBe(removed);
  });
});
