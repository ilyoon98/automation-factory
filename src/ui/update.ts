import type { UpdateState } from '../net/session';

/**
 * exe 업데이트 알림 (브라우저로 열면 아무것도 안 한다).
 * 켤 때 electron/main.mjs가 깃허브 릴리스에서 새 버전을 찾으면 위쪽에 "새 버전이 있어요 [업데이트]"를 띄우고,
 * 누르면 받은 다음 저절로 다시 시작한다 (창이 닫힐 때 게임이 저장된다).
 */
export function setupUpdateBanner(opts: { sharing: () => boolean }): void {
  const desktop = window.desktop;
  if (!desktop?.onUpdate) return;
  const el = document.createElement('div');
  el.id = 'update';
  el.hidden = true;
  document.body.append(el);
  let latest = '';
  const show = (html: string) => {
    el.innerHTML = html;
    el.hidden = false;
  };

  el.addEventListener('click', (e) => {
    const act = (e.target as HTMLElement).closest<HTMLElement>('[data-act]')?.dataset.act;
    if (act === 'later') el.hidden = true;
    if (act === 'update') {
      if (opts.sharing() && !confirm('같이 하는 중이에요. 업데이트하면 게임이 다시 시작돼서 잠깐 끊겨요. 지금 할까요?')) return;
      desktop.downloadUpdate();
      show(`새 버전 ${latest} 받는 중… 0%`);
    }
  });

  desktop.onUpdate((s: UpdateState) => {
    if (s.state === 'available') {
      latest = s.version;
      show(`<b>새 버전이 있어요</b> (${esc(s.current)} → ${esc(s.version)})
        <button class="primary" data-act="update">업데이트</button>
        <button data-act="later">나중에</button>`);
    } else if (s.state === 'downloading') show(`새 버전 ${esc(latest)} 받는 중… ${Math.floor(s.percent)}%`);
    else if (s.state === 'installing') show('다 받았어요. 다시 시작하는 중…');
    else show(`업데이트를 받지 못했어요 (${esc(s.message)}) <button data-act="later">닫기</button>`);
  });
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}
