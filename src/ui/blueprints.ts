import { BUILDINGS, isBeltType, type BuildingType } from '../data/buildings';
import type { Blueprint } from '../sim/blueprint';

/**
 * 청사진 저장함: Ctrl + 드래그로 복사한 공장 묶음에 이름을 붙여 이 PC(브라우저·exe)에 남겨 둔다.
 * 같이 하는 사람과 나누지는 않는다 (붙여넣기만 명령으로 모두에게).
 */
export interface SavedBlueprint {
  name: string;
  bp: Blueprint;
  /** 저장한 시각 (ms) */
  at: number;
}

const KEY = 'automation-blueprints';

let list: SavedBlueprint[] | null = null;

/** 저장한 청사진들 (오래된 것부터). 모르는 건물이 섞인 항목은 그 건물만 뺀다 */
export function blueprints(): SavedBlueprint[] {
  if (list) return list;
  list = [];
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '[]') as SavedBlueprint[];
    for (const s of raw) {
      if (!s?.bp?.entries) continue;
      const entries = s.bp.entries.filter((e) => e.type in BUILDINGS);
      if (entries.length) list.push({ name: String(s.name), at: Number(s.at) || 0, bp: { ...s.bp, entries } });
    }
  } catch {
    // 깨진 저장은 무시하고 빈 저장함으로
  }
  return list;
}

function persist(): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(blueprints()));
  } catch {
    // 저장 공간이 없으면 이번 실행 동안만 남는다
  }
}

/** 이름 붙여 저장 (같은 이름이 있으면 바꿔 끼운다) */
export function saveBlueprint(name: string, bp: Blueprint): void {
  const all = blueprints();
  const i = all.findIndex((s) => s.name === name);
  const entry = { name, bp: JSON.parse(JSON.stringify(bp)) as Blueprint, at: Date.now() };
  if (i >= 0) all[i] = entry;
  else all.push(entry);
  persist();
}

export function removeBlueprint(i: number): void {
  blueprints().splice(i, 1);
  persist();
}

/** 이름을 안 적었을 때: 가장 많은 건물 이름 + 번호 ("조립기 묶음 2") */
export function defaultBlueprintName(bp: Blueprint): string {
  const count = new Map<BuildingType, number>();
  for (const e of bp.entries) if (!isBeltType(e.type)) count.set(e.type, (count.get(e.type) ?? 0) + 1);
  const top = [...count].sort((a, b) => b[1] - a[1])[0]?.[0] ?? bp.entries[0].type;
  const base = `${BUILDINGS[top].name} 묶음`;
  const names = new Set(blueprints().map((s) => s.name));
  let n = 1;
  while (names.has(n === 1 ? base : `${base} ${n}`)) n++;
  return n === 1 ? base : `${base} ${n}`;
}

const previews = new WeakMap<Blueprint, string>();

/** 미리보기 (32×32): 건물마다 그 색 네모, 컨베이어는 가는 줄 */
export function blueprintPreview(bp: Blueprint): string {
  const cached = previews.get(bp);
  if (cached) return cached;
  const size = 32;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#2f5f8a';
  ctx.fillRect(0, 0, size, size);
  const k = Math.min((size - 4) / bp.w, (size - 4) / bp.h);
  const ox = Math.floor((size - bp.w * k) / 2);
  const oy = Math.floor((size - bp.h * k) / 2);
  for (const e of bp.entries) {
    const def = BUILDINGS[e.type];
    const s = def.size * k;
    const x = ox + e.dx * k;
    const y = oy + e.dy * k;
    ctx.fillStyle = isBeltType(e.type) ? '#d8e6f2' : def.color;
    const pad = isBeltType(e.type) ? s * 0.3 : Math.min(1, s * 0.15);
    ctx.fillRect(Math.round(x + pad), Math.round(y + pad), Math.max(1, Math.round(s - pad * 2)), Math.max(1, Math.round(s - pad * 2)));
  }
  const url = c.toDataURL();
  previews.set(bp, url);
  return url;
}

let tabIcon: string | null = null;

/** 청사진 탭 그림 (32×32): 파란 종이에 흰 칸선 */
export function blueprintTabIcon(): string {
  if (tabIcon) return tabIcon;
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#3b2716';
  ctx.fillRect(3, 5, 26, 22);
  ctx.fillStyle = '#3f7fb5';
  ctx.fillRect(5, 7, 22, 18);
  ctx.fillStyle = '#9cc8ea';
  for (let x = 9; x < 27; x += 5) ctx.fillRect(x, 7, 1, 18);
  for (let y = 11; y < 25; y += 5) ctx.fillRect(5, y, 22, 1);
  ctx.fillStyle = '#f2f6fa';
  ctx.fillRect(10, 12, 9, 4);
  ctx.fillRect(15, 17, 9, 4);
  tabIcon = c.toDataURL();
  return tabIcon;
}
