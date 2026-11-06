import type { UseResult } from '../sim/world';

/** 수령한 곳별 실제 합계만 짧게 표시한다. 예전 저장 응답에는 도착지를 추측하지 않는다. */
export function pickupSummary(result: UseResult, kept = 0): string {
  const names = { storage: '창고', station: '정류장', hub: '허브' };
  const parts = (['storage', 'station', 'hub'] as const)
    .filter(kind => (result.destinations?.[kind] ?? 0) > 0)
    .map(kind => `${names[kind]} +${result.destinations![kind]!.toLocaleString('ko-KR')}개`);
  if (!parts.length && result.moved) parts.push(`회수 +${result.moved.toLocaleString('ko-KR')}개`);
  if (kept) parts.push(`하역기용 ${kept}곳 유지`);
  return parts.join(' · ');
}
