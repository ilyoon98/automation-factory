const contexts = new WeakMap<HTMLElement, string>();

/** 같은 창·탭의 내용 갱신은 읽던 위치와 여전히 존재하는 조작 항목의 초점을 보존한다. */
export function replacePanel(modal: HTMLElement, html: string, context: string): void {
  const same = contexts.get(modal) === context;
  const oldPanel = modal.querySelector<HTMLElement>('.panel');
  const top = same ? oldPanel?.scrollTop ?? 0 : 0;
  const left = same ? oldPanel?.scrollLeft ?? 0 : 0;
  const active = modal.ownerDocument.activeElement;
  let focus: string | null = null;
  if (same && active instanceof HTMLElement && modal.contains(active)) {
    if (active.id) focus = `#${CSS.escape(active.id)}`;
    else {
      const attrs = [...active.attributes].filter((a) => a.name.startsWith('data-'));
      if (attrs.length) focus = active.tagName.toLowerCase() + attrs.map((a) => `[${CSS.escape(a.name)}="${CSS.escape(a.value)}"]`).join('');
    }
  }
  modal.innerHTML = html;
  contexts.set(modal, context);
  const panel = modal.querySelector<HTMLElement>('.panel');
  if (panel) {
    panel.scrollTop = top;
    panel.scrollLeft = left;
  }
  if (focus) {
    const target = modal.querySelector<HTMLElement>(focus);
    if (target && !target.matches(':disabled') && target.getClientRects().length) target.focus({ preventScroll: true });
  }
}
