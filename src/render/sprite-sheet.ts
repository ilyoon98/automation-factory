import 'galmuri/dist/galmuri.css';
import { loadSpriteOverrides, sprite, spriteNames } from './pixel';
import './pixel-buildings';

/**
 * 스프라이트 목록 (개발용, /sprites.html): 모든 그림의 이름·크기·프레임을 보여 주고 움직여 본다.
 * 직접 그린 PNG로 바꿔 끼울 때 이름과 크기를 여기서 확인한다.
 */
const params = new URLSearchParams(location.search);
const SCALE = Number(params.get('scale') ?? 3);
/** ?q=miner,belt 처럼 이름 일부로 거르기 */
const FILTER = (params.get('q') ?? '').split(',').filter(Boolean);

document.body.style.cssText = 'margin:0;padding:16px;background:#fbf3df;color:#3b2716;font:12px Galmuri11,sans-serif';
const head = document.createElement('div');
head.innerHTML = `<b style="font-size:24px">스프라이트 목록</b> · 확대 ×${SCALE} (주소 뒤에 ?scale=4 처럼 바꿀 수 있음) · <span id="ov"></span>`;
document.body.append(head);
const grid = document.createElement('div');
grid.style.cssText = 'display:flex;flex-wrap:wrap;gap:12px;margin-top:12px;align-items:flex-end';
document.body.append(grid);

const cards: { name: string; canvas: HTMLCanvasElement }[] = [];

function build(): void {
  grid.innerHTML = '';
  cards.length = 0;
  for (const { name, w, h } of spriteNames()) {
    if (FILTER.length && !FILTER.some((q) => name.includes(q))) continue;
    const s = sprite(name)!;
    const card = document.createElement('div');
    card.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:4px;padding:6px;border:2px solid #3b2716;background:#eadcb8';
    const c = document.createElement('canvas');
    c.width = w * SCALE;
    c.height = h * SCALE;
    c.style.imageRendering = 'pixelated';
    const label = document.createElement('div');
    label.textContent = `${name} ${w}×${h}${s.frames > 1 ? ` ·${s.frames}프레임` : ''}`;
    card.append(c, label);
    grid.append(card);
    cards.push({ name, canvas: c });
  }
}

function tick(t: number): void {
  for (const { name, canvas } of cards) {
    const s = sprite(name)!;
    const ctx = canvas.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const f = Math.floor(t / 150) % s.frames;
    ctx.drawImage(s.img, f * s.w, 0, s.w, s.h, 0, 0, canvas.width, canvas.height);
  }
  requestAnimationFrame(tick);
}

build();
requestAnimationFrame(tick);
loadSpriteOverrides().then((names) => {
  document.getElementById('ov')!.textContent = names.length ? `바꿔 끼운 그림: ${names.join(', ')}` : '바꿔 끼운 그림 없음';
});
