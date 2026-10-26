/**
 * 땅 종류: 맵을 초원 · 사막 · 눈밭 구역으로 나눈다 (0.6.0).
 * 구역마다 땅 색, 나무, 태양광·풍력이 다르다. 건물은 어디에나 지을 수 있다.
 */

/** 저장 파일은 이 순서(번호)로 기억하므로 새 땅은 늘 맨 뒤에 */
export const GROUND_IDS = ['grass', 'desert', 'snow'] as const;
export type GroundId = (typeof GROUND_IDS)[number];

export const GRASS = 0;
export const DESERT = 1;
export const SNOW = 2;

export interface GroundDef {
  id: GroundId;
  name: string;
  icon: string;
  /** 태양광 출력 배율 */
  solar: number;
  /** 풍력 출력 배율 */
  wind: number;
  /** 나무가 자라는 빠르기 배율 */
  treeGrow: number;
  /** 나무를 심을 수 있는지 */
  plant: boolean;
  /** 맵에서 차지하는 비율 */
  share: number;
  desc: string;
}

export const GROUNDS: GroundDef[] = [
  {
    id: 'grass',
    name: '초원',
    icon: '🌿',
    solar: 1,
    wind: 1,
    treeGrow: 1,
    plant: true,
    share: 0.5,
    desc: '허브 둘레는 늘 초원이에요. 자연 숲이 있고 나무가 잘 자라요.',
  },
  {
    id: 'desert',
    name: '사막',
    icon: '🏜️',
    solar: 1.5,
    wind: 1,
    treeGrow: 1,
    plant: false,
    share: 0.25,
    desc: '해가 세서 태양광이 1.5배예요. 나무는 심을 수 없어요.',
  },
  {
    id: 'snow',
    name: '눈밭',
    icon: '❄️',
    solar: 0.75,
    wind: 1.3,
    treeGrow: 0.5,
    plant: true,
    share: 0.25,
    desc: '바람이 세서 풍력이 1.3배예요. 태양광은 0.75배, 나무는 2배 느리게 자라요.',
  },
];

/** 땅 효과를 한 줄로 ("태양광 1.5배 · 나무 못 심음") */
export function groundEffects(g: GroundDef): string {
  const out: string[] = [];
  if (g.solar !== 1) out.push(`태양광 ${g.solar}배`);
  if (g.wind !== 1) out.push(`풍력 ${g.wind}배`);
  if (!g.plant) out.push('나무 못 심음');
  else if (g.treeGrow !== 1) out.push(`나무 ${1 / g.treeGrow}배 느리게`);
  return out.join(' · ');
}
