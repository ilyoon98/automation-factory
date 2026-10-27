/**
 * 지역 생산망 확장(regional-v1) 지도의 지형 7종. 예전 지도에는 지형이 없다 (모두 초원처럼 배율 1).
 * 저장에는 번호(TERRAIN_IDS 순서)로 남기므로 순서를 바꾸지 않는다
 */
export type TerrainKind = 'grass' | 'forest' | 'rock' | 'sand' | 'snow' | 'salt' | 'volcano';

export const TERRAIN_IDS: TerrainKind[] = ['grass', 'forest', 'rock', 'sand', 'snow', 'salt', 'volcano'];

export interface TerrainDef {
  name: string;
  /** 바닥 색 (지도·바닥 그림) */
  color: string;
  /** 태양광·풍력·나무 성장 배율 (설비 기준 칸의 지형) */
  solar: number;
  wind: number;
  tree: number;
  /** 목표 면적 비율 (지도 생성 검사용) */
  share: number;
}

export const TERRAIN: Record<TerrainKind, TerrainDef> = {
  grass: { name: '초원', color: '#e9dcb8', solar: 1, wind: 1, tree: 1, share: 0.28 },
  forest: { name: '숲', color: '#c9d7a4', solar: 0.75, wind: 0.75, tree: 1.25, share: 0.18 },
  rock: { name: '바위사막', color: '#d6b994', solar: 1.1, wind: 1.05, tree: 0.6, share: 0.14 },
  sand: { name: '모래사막', color: '#f1d897', solar: 1.35, wind: 1, tree: 0.35, share: 0.14 },
  snow: { name: '눈밭', color: '#eef2f4', solar: 0.7, wind: 1.5, tree: 0.5, share: 0.12 },
  salt: { name: '염호', color: '#e3ebe6', solar: 1.2, wind: 1.2, tree: 0.2, share: 0.08 },
  volcano: { name: '화산', color: '#a89a92', solar: 0, wind: 0.8, tree: 0, share: 0.06 },
};
