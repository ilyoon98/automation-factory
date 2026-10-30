import type { World } from '../sim/world';

/** 상태의 증가만 관찰한다. 새 월드/재동기화에서는 과거 완료를 재생하지 않는다. */
export class ResearchObserver {
  private world: World | null = null;
  private seen = new Map<string, number>();
  poll(w: World): { id: string; level: number }[] {
    const now = new Map([...w.researched].map((id) => [id, 1]));
    for (const [id, n] of w.levels) now.set(id, n);
    const fresh = this.world === w ? [...now].filter(([id, n]) => n > (this.seen.get(id) ?? 0)).map(([id, level]) => ({ id, level })) : [];
    this.world = w; this.seen = now;
    return fresh;
  }
}

export type NoticeKind = 'general' | 'research' | 'finale';
export interface CompletionNotice { title: string; body: string; kind: NoticeKind; ms: number }
const priority: Record<NoticeKind, number> = { general: 0, research: 1, finale: 2 };

/** 큰 카드 하나. 같은 종류는 한 장으로 묶고, 최종 완료가 우선한다. */
export class NoticeQueue {
  current: CompletionNotice | null = null;
  pending: CompletionNotice[] = [];
  push(n: CompletionNotice): boolean {
    if (!this.current) { this.current = n; return true; }
    if (priority[n.kind] > priority[this.current.kind]) {
      this.merge(this.current); this.current = n; return true;
    }
    if (n.kind === this.current.kind && n.kind !== 'finale') {
      this.current = this.combine(this.current, n); return true;
    }
    this.merge(n); return false;
  }
  private combine(a: CompletionNotice, b: CompletionNotice): CompletionNotice {
    return { ...b, title: `${a.title}<br>${b.title}`.split('<br>').slice(-4).join('<br>'), body: b.body || a.body, ms: Math.max(a.ms, b.ms) };
  }
  private merge(n: CompletionNotice): void {
    const i = this.pending.findIndex((x) => x.kind === n.kind);
    if (i < 0) this.pending.push(n);
    else this.pending[i] = this.combine(this.pending[i], n);
    this.pending.sort((a, b) => priority[b.kind] - priority[a.kind]);
    // 표시 밀도 상한: 반복 연구·메달의 오래된 줄은 상세 화면에서 다시 확인한다.
    for (const x of this.pending) x.title = x.title.split('<br>').slice(-4).join('<br>');
  }
  next(): CompletionNotice | null { return (this.current = this.pending.shift() ?? null); }
  clear(): void { this.current = null; this.pending = []; }
}

export function completionSummary(w: World): string {
  const c = w.stats.completion;
  if (!c) return `설비 모듈 ${w.stats.projectDelivered}/50 납품 · 완료 시점 통계는 이 저장에 없어요`;
  const t = Math.floor(c.time);
  return `<dl class="completion-stats"><div><dt>게임 경과</dt><dd>${Math.floor(t / 3600)}:${String(Math.floor(t / 60) % 60).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}</dd></div><div><dt>생산 거점</dt><dd>${c.sites}곳</dd></div><div><dt>프로젝트 납품</dt><dd>${c.delivered}/50</dd></div></dl>`;
}
