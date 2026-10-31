import { describe, expect, it, vi } from 'vitest';
import { BUILDINGS, CATEGORIES, categoryItems, type BuildingType } from '../data/buildings';
import { INITIAL_BUILDINGS, techsFor, type RuleProfile } from '../data/tech';
import { Toolbar } from './toolbar';

// 아이콘의 캔버스 생성만 대체한다. 브라우저 없이 실제 키 선택 경로를 검사한다.
vi.mock('./icons', () => ({
  buildingIconUrl: () => '', itemIcon: () => '', lockIcon: () => '', techIcon: () => '', truckIconUrl: () => '',
}));

/** DOM 그리기를 생략하고 실제 탭·숫자키 선택 메서드를 사용한다. */
function selectionOnly(regional: boolean): Toolbar {
  return Object.assign(Object.create(Toolbar.prototype) as Toolbar, {
    regional,
    category: 'logistics',
    renderPalette: () => {},
    reveal: () => {},
  });
}

describe('건설 탭과 진행 순서', () => {
  it('건설 가능한 모든 설비를 중복 없이 한 번씩 등록하고 숫자키 1~9 안에 둔다', () => {
    const items = CATEGORIES.flatMap((c) => c.items);
    expect(new Set(items).size).toBe(items.length);
    expect([...items].sort()).toEqual(Object.values(BUILDINGS).filter((b) => b.placeable).map((b) => b.type).sort());
    expect(CATEGORIES.every((c) => c.items.length > 0 && c.items.length <= 9)).toBe(true);
    const keys = CATEGORIES.map((c) => c.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys.some((k) => ['k', 'r', 'f', 'q', 'w', 'a', 's', 'd', 't', 'h', 'i', 'g', 'p', 'o', 'j', 'm'].includes(k))).toBe(false);
  });

  for (const rules of ['legacy-v042', 'regional-v1'] as RuleProfile[]) {
    it(`${rules}: 초기 설비를 먼저 두고 선행 연구보다 후속 설비를 앞에 놓지 않는다`, () => {
      const techs = techsFor(rules);
      const byId = new Map(techs.map((t) => [t.id, t]));
      const depth = (id: string): number => 1 + Math.max(0, ...byId.get(id)!.requires.map(depth));
      const tier = new Map<BuildingType, number>(INITIAL_BUILDINGS.map((type) => [type, 0]));
      for (const t of techs) for (const b of t.unlockBuildings ?? []) tier.set(b, depth(t.id));
      for (const c of CATEGORIES) {
        const items = categoryItems(c.id, rules === 'regional-v1');
        const tiers = items.map((b) => tier.get(b));
        expect(tiers.every((n) => n !== undefined), c.name).toBe(true);
        expect(tiers, c.name).toEqual([...tiers].sort((a, b) => a! - b!));
      }
      const visible = CATEGORIES.flatMap((c) => categoryItems(c.id, rules === 'regional-v1'));
      expect([...visible].sort()).toEqual([...tier.keys()].sort());
    });

    it(`${rules}: 표시 순서·탭 키·숫자키가 일치하고 Tab은 빈 탭을 건너뛴다`, () => {
      const regional = rules === 'regional-v1';
      const toolbar = selectionOnly(regional);
      const visible = CATEGORIES.filter((c) => categoryItems(c.id, regional).length);
      for (let i = 0; i < visible.length; i++) {
        const c = visible[i];
        expect(toolbar.selectByKey(c.key)).toBe(true);
        categoryItems(c.id, regional).forEach((type, slot) => expect(toolbar.slot(slot)).toBe(type));
        expect(toolbar.slot(9)).toBeNull();
        toolbar.cycle(1);
        if (i + 1 < visible.length) expect(toolbar.slot(0)).toBe(categoryItems(visible[i + 1].id, regional)[0]);
        toolbar.cycle(-1);
        expect(toolbar.slot(0)).toBe(categoryItems(c.id, regional)[0]);
      }
      for (const c of CATEGORIES.filter((c) => !categoryItems(c.id, regional).length)) {
        expect(toolbar.selectByKey(c.key)).toBe(false);
      }
    });
  }

  it('풍력은 C1, 연결·공급·축전은 별도 U 탭에서 고른다', () => {
    const toolbar = selectionOnly(true);
    toolbar.selectByKey('c');
    expect(toolbar.slot(0)).toBe('wind');
    expect(categoryItems('generation', true)).not.toContain('pole');
    expect(categoryItems('generation', true)).not.toContain('substation');
    expect(categoryItems('generation', true)).not.toContain('accumulator');
    toolbar.selectByKey('u');
    expect([0, 1, 2].map((n) => toolbar.slot(n))).toEqual(['pole', 'substation', 'accumulator']);
    expect(toolbar.slot(3)).toBeNull();
  });
});
