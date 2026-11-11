/**
 * 위쪽 바 픽셀 아이콘 (12×12). 갈무리 글꼴 한 픽셀 = 아이콘 한 픽셀이라 글자와 같은 굵기로 보인다.
 * 그림은 아래 글자 격자로 적고, 색 글자 하나 = 한 픽셀. '.'은 빈칸.
 * 시스템 이모지(☀️ 👥 ⏸)는 OS마다 모양·색이 달라 픽셀 UI에서 튀어서 이 그림으로 바꾼다.
 *
 * 쓰는 법: 버튼에 data-ico="이름" → applyIcons()가 CSS 변수 --ico에 그림을 넣고, CSS ::before가 그린다.
 * 버튼 글자를 바꿔도(textContent) ::before는 남는다. 상태에 따라 바꿀 때는 setIcon(el, 이름).
 */

/** 팔레트: style.css 토큰과 같은 색 + 아이콘용 몇 가지 */
const PAL: Record<string, string> = {
  k: '#3b2716', // 잉크
  w: '#fffaf0', // 흰 종이
  p: '#e9d9b4', // 종이 그늘
  n: '#8a6e4b', // 옅은 갈색
  y: '#f6d77e', // 금빛
  o: '#d7a63d', // 진한 금빛
  e: '#e07b2a', // 주황
  r: '#c0392b', // 빨강
  g: '#3f8a3a', // 초록
  l: '#8fcf6a', // 연두
  b: '#3b78c4', // 파랑
  c: '#9fd0f0', // 하늘색
  a: '#b3aca2', // 회색
  s: '#6b645c', // 진회색
};

const SIZE = 12;

const pause = [
  '............',
  '............',
  '..kkk..kkk..',
  '..kyk..kyk..',
  '..kyk..kyk..',
  '..kyk..kyk..',
  '..kyk..kyk..',
  '..kyk..kyk..',
  '..kyk..kyk..',
  '..kkk..kkk..',
  '............',
  '............',
];
const play = [
  '............',
  '...kk.......',
  '...klk......',
  '...kllk.....',
  '...klllk....',
  '...kllllk...',
  '...kggggk...',
  '...kgggk....',
  '...kggk.....',
  '...kgk......',
  '...kk.......',
  '............',
];
const undo = [
  '............',
  '....k.......',
  '...kk.......',
  '..kkkkkkk...',
  '.kkkkkkkkk..',
  '..kkk...kkk.',
  '...kk....kk.',
  '....k....kk.',
  '.........kk.',
  '........kkk.',
  '......kkkk..',
  '......kkk...',
];
const disk = [
  '............',
  '.kkkkkkkkk..',
  '.kbaaaaabkk.',
  '.kbaasaabbk.',
  '.kbaaaaabbk.',
  '.kbbbbbbbbk.',
  '.kbwwwwwwbk.',
  '.kbwppppwbk.',
  '.kbwwwwwwbk.',
  '.kbwppppwbk.',
  '.kkkkkkkkkk.',
  '............',
];
/** 저장 필요: 디스크 + 주황 점 */
const diskDirty = overlay(disk, ['.kkk.', 'keeek', 'keyek', 'keeek', '.kkk.'], 7, 7);
/** 저장 실패: 디스크 + 빨간 느낌표 */
const diskBad = overlay(disk, ['.kkk.', 'krwrk', 'krwrk', 'krrrk', 'krwrk', '.kkk.'], 7, 6);
const people = [
  '............',
  '..kk....kk..',
  '.kyyk..kcck.',
  '.kyyk..kcck.',
  '..kk....kk..',
  '.kkkk..kkkk.',
  'kyyyykkcccck',
  'kyyyykkcccck',
  'kyyyykkcccck',
  'kkkkkkkkkkkk',
  '............',
  '............',
];
const chat = [
  '............',
  '.kkkkkkkkkk.',
  'kwwwwwwwwwwk',
  'kwwwwwwwwwwk',
  'kwkkwkkwkkwk',
  'kwwwwwwwwwwk',
  'kwwwwwwwwwwk',
  '.kkkwwkkkkk.',
  '...kwk......',
  '...kk.......',
  '...k........',
  '............',
];
const menu = [
  '............',
  '............',
  '.kkkkkkkkkk.',
  '.kkkkkkkkkk.',
  '............',
  '.kkkkkkkkkk.',
  '.kkkkkkkkkk.',
  '............',
  '.kkkkkkkkkk.',
  '.kkkkkkkkkk.',
  '............',
  '............',
];
const stats = [
  '............',
  '........kkk.',
  '........kyk.',
  '....kkk.kyk.',
  '....kek.kyk.',
  '....kek.kyk.',
  'kkk.kek.kyk.',
  'klk.kek.kyk.',
  'klk.kek.kyk.',
  'klk.kek.kyk.',
  'kkkkkkkkkkkk',
  '............',
];
const goals = [
  '.k..........',
  '.kkkkkkkkkk.',
  '.kkrrrrrrrk.',
  '.kkrwrrrrrk.',
  '.kkrrrrrrk..',
  '.kkrrrrrrrk.',
  '.kkkkkkkkkk.',
  '.kk.........',
  '.kk.........',
  '.kk.........',
  'kkkk........',
  '............',
];
const ach = [
  '.kkk....kkk.',
  '.krrk..kbbk.',
  '..krrkkbbk..',
  '...krkkbk...',
  '...kkkkkk...',
  '..kkkkkkkk..',
  '.kyywyyyyok.',
  '.kywyyyyyok.',
  '.kyyyyyyyok.',
  '.kyyyyyyook.',
  '..kkkkkkkk..',
  '............',
];
const codex = [
  '............',
  '.kkkkkkkkkk.',
  '.kgkggggggk.',
  '.kgkgyyyygk.',
  '.kgkggggggk.',
  '.kgkgyyyggk.',
  '.kgkggggggk.',
  '.kgkggggggk.',
  '.kkkkkkkkkk.',
  '.kwwwwwwwwk.',
  '.kkkkkkkkkk.',
  '............',
];
const research = [
  '...kkkkkk...',
  '....kwwk....',
  '....kwwk....',
  '....kwwk....',
  '...kwwwwk...',
  '..kwwwwwwk..',
  '.kllllllllk.',
  'kllwllllllgk',
  'klllllllllgk',
  'kllllllllggk',
  '.kkkkkkkkkk.',
  '............',
];
const map = [
  '............',
  'kkkkkkkkkkkk',
  'klllkpppkcck',
  'klllkpppkcck',
  'klllkrprkcck',
  'klllkprpkcck',
  'klllkrprkcck',
  'klllkpppkcck',
  'klllkpppkcck',
  'kkkkkkkkkkkk',
  '............',
  '............',
];
const rates = [
  '............',
  '............',
  '...kkkkkk...',
  '..kllwwrrk..',
  '.kllwwwwkrk.',
  '.klwwwwkwwk.',
  'kwwwwwkwwwwk',
  'kwwwwkkwwwwk',
  'kwwwwkkwwwwk',
  'kkkkkkkkkkkk',
  '............',
  '............',
];
const layerBase = [
  '............',
  '.kkkkkkkkkk.',
  '.kllkllkppk.',
  '.kllkllkppk.',
  '.kkkkkkkkkk.',
  '.kllkppkllk.',
  '.kllkppkllk.',
  '.kkkkkkkkkk.',
  '.kppkllkllk.',
  '.kppkllkllk.',
  '.kkkkkkkkkk.',
  '............',
];
const bolt = [
  '......kkkk..',
  '.....kyyk...',
  '....kyyk....',
  '...kyyk.....',
  '..kyyykkkk..',
  '.kyyyyyyyk..',
  '.kkkkyyyk...',
  '....kyyk....',
  '...kyyk.....',
  '..kyyk......',
  '..kkk.......',
  '............',
];
const truck = [
  '............',
  '............',
  'kkkkkkkk....',
  'keeeeeekkk..',
  'keeeeeekcck.',
  'keeeeeekccck',
  'keeeeeekkkkk',
  'kkkkkkkkkkkk',
  '.kssk..kssk.',
  '..kk....kk..',
  '............',
  '............',
];
const ore = [
  '............',
  '............',
  '....kkkk....',
  '...kssaak...',
  '..ksaayaak..',
  '.kssaaaaoak.',
  '.ksyoaasaak.',
  'kssaaaasaaak',
  'kssaaayoaaak',
  '.kkkkkkkkkk.',
  '............',
  '............',
];
const sun = [
  '.....oo.....',
  '.o...oo...o.',
  '..o.kkkk.o..',
  '...kyyyyk...',
  '..kyywyyyk..',
  'ookywyyyykoo',
  'ookyyyyyykoo',
  '..kyyyyyyk..',
  '...kyyyyk...',
  '..o.kkkk.o..',
  '.o...oo...o.',
  '.....oo.....',
];
const moon = [
  '....kkkk....',
  '..kkyyk.....',
  '.kyyyk......',
  '.kyyk.......',
  'kyyyk.......',
  'kyyyk.......',
  'kyyyk.......',
  'kyyyyk....k.',
  '.kyyyyk..kk.',
  '.kyyyyykkyk.',
  '..kkyyyyyk..',
  '....kkkkk...',
];
const dusk = [
  '............',
  '............',
  '.....oo.....',
  '.o...oo...o.',
  '..o.kkkk.o..',
  '...keeeek...',
  '..keeyeeek..',
  'kkkkkkkkkkkk',
  '............',
  '.nnnn..nnnn.',
  '............',
  '..nnn..nnn..',
];
const cloud = [
  '............',
  '............',
  '.......oo...',
  '....kkkooo..',
  '...kwwwkoo..',
  '.kkwwwwwkk..',
  'kwwwwwwwwwk.',
  'kwwwwwwwwwwk',
  'kwwwwwwwwwwk',
  '.kkkkkkkkkk.',
  '............',
  '............',
];
const rainCloud = [
  '....kkk.....',
  '...kaaak....',
  '.kkaaaaakk..',
  'kaaaaaaaaak.',
  'kaaaaaaaaaak',
  '.kkkkkkkkkk.',
];
const rain = [...rainCloud, '............', '..b...b...b.', '.b...b...b..', '............', '..b...b...b.', '.b...b...b..'];
const snow = [...rainCloud, '............', '..c...c...c.', '.ccc.ccc.ccc', '..c...c...c.', '............', '....c...c...'];
const storm = [...rainCloud, '.....kkk....', '....kyk.....', '...kyyykk...', '....kkyk....', '.....kk.....', '............'];
const fog = [
  '............',
  '............',
  '.aaaaaaa....',
  '............',
  '...aaaaaaaa.',
  '............',
  '.aaaaaaaaa..',
  '............',
  '....aaaaaaa.',
  '............',
  '..aaaaa.....',
  '............',
];
const sandstorm = [
  '............',
  '............',
  '.eeeee......',
  '......nnnn..',
  '..nnnnnn..n.',
  '.n.......n..',
  '..eeee..ee..',
  '......ee....',
  '.nnnnnn.....',
  '.......nnn..',
  '..eee.......',
  '............',
];

const home = [
  '.....kk.....',
  '....krrk....',
  '...krrrrk...',
  '..krrrrrrk..',
  '.krrrrrrrrk.',
  'kkkkkkkkkkkk',
  '.kwwwwwwwwk.',
  '.kwkkkwbbwk.',
  '.kwkekwbbwk.',
  '.kwkekwwwwk.',
  '.kwkekwwwwk.',
  '.kkkkkkkkkk.',
];
const door = [
  '............',
  '..kkkkkkkk..',
  '..keeeeeek..',
  '..keknnkek..',
  '..keknnkek..',
  '..keeeeeek..',
  '..keeeeyek..',
  '..keknnkek..',
  '..keknnkek..',
  '..keeeeeek..',
  '.kkkkkkkkkk.',
  '............',
];
const hourglass = [
  '.kkkkkkkkkk.',
  '..kyyyyyyk..',
  '..kyyyyyyk..',
  '...kyyyyk...',
  '....kyyk....',
  '.....kk.....',
  '....kwwk....',
  '...kwwwwk...',
  '..kwwyywwk..',
  '..kyyyyyyk..',
  '.kkkkkkkkkk.',
  '............',
];
const newGame = [
  '.kkkkkkk....',
  '.kwwwwwkk...',
  '.kwwwwwkwk..',
  '.kwwwwwkkkk.',
  '.kwwwwwwwwk.',
  '.kwwwgwwwwk.',
  '.kwwwgwwwwk.',
  '.kwgggggwwk.',
  '.kwwwgwwwwk.',
  '.kwwwgwwwwk.',
  '.kwwwwwwwwk.',
  '.kkkkkkkkkk.',
];
const help = [
  '............',
  '...kkkkkk...',
  '..kbbbbbbk..',
  '.kbbwwwwbbk.',
  '.kbwwbbwwbk.',
  '.kbbbbbwwbk.',
  '.kbbbbwwbbk.',
  '.kbbbwwbbbk.',
  '.kbbbbbbbbk.',
  '.kbbbwwbbbk.',
  '..kbbbbbbk..',
  '...kkkkkk...',
];
const soundOn = [
  '............',
  '.....k...k..',
  '....kk....k.',
  'kkkkak.k..k.',
  'kaaaak..k..k',
  'kaaaak..k..k',
  'kaaaak..k..k',
  'kkkkak.k..k.',
  '....kk....k.',
  '.....k...k..',
  '............',
  '............',
];
const soundOff = [
  '............',
  '.....k......',
  '....kk......',
  'kkkkak.r...r',
  'kaaaak..r.r.',
  'kaaaak...r..',
  'kaaaak..r.r.',
  'kkkkak.r...r',
  '....kk......',
  '.....k......',
  '............',
  '............',
];

export const PIXEL_ICONS: Record<string, string[]> = {
  pause,
  play,
  undo,
  redo: undo.map((row) => [...row].reverse().join('')),
  save: disk,
  'save-dirty': diskDirty,
  'save-bad': diskBad,
  people,
  chat,
  menu,
  stats,
  goals,
  ach,
  codex,
  research,
  map,
  rates,
  'layer-base': layerBase,
  'layer-power': bolt,
  'layer-transport': truck,
  'layer-resource': ore,
  sun,
  moon,
  dusk,
  cloud,
  rain,
  snow,
  storm,
  fog,
  sandstorm,
  home,
  door,
  hourglass,
  'new-game': newGame,
  help,
  'sound-on': soundOn,
  'sound-off': soundOff,
};

/** 하늘 이모지(render/ambient · sim/weather-v1) → 픽셀 아이콘 이름. 모르는 것은 null (글자 그대로 둔다) */
const SKY: Record<string, string> = {
  '☀️': 'sun',
  '🌙': 'moon',
  '🌇': 'dusk',
  '⛅': 'cloud',
  '☁️': 'cloud',
  '🌧️': 'rain',
  '🌨️': 'snow',
  '⛈️': 'storm',
  '🌫️': 'fog',
  '🌪️': 'sandstorm',
};
export function skyIcon(emoji: string): string | null {
  return SKY[emoji] ?? null;
}

/** 글 안에 넣는 아이콘 HTML (팝오버 제목·목록). 모르는 이름이면 빈 글자 */
export function iconHtml(name: string | null): string {
  const url = name ? iconUrl(name) : null;
  return url ? `<i class="px-ico" aria-hidden="true" style='--ico:${url}'></i>` : '';
}

/** 작은 그림(badge)을 (x, y)에 겹친다. badge의 '.'은 아래 그림을 그대로 둔다 */
function overlay(base: string[], badge: string[], x: number, y: number): string[] {
  return base.map((row, j) => {
    const b = badge[j - y];
    if (!b) return row;
    return [...row].map((ch, i) => (b[i - x] && b[i - x] !== '.' ? b[i - x] : ch)).join('');
  });
}

/** 격자 → SVG. 같은 색이 이어지는 가로 칸은 사각형 하나로 */
export function iconSvg(grid: string[]): string {
  let rects = '';
  grid.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      const ch = row[x];
      let end = x + 1;
      while (end < row.length && row[end] === ch) end++;
      if (ch !== '.') rects += `<rect x="${x}" y="${y}" width="${end - x}" height="1" fill="${PAL[ch]}"/>`;
      x = end;
    }
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SIZE} ${SIZE}" shape-rendering="crispEdges">${rects}</svg>`;
}

const urls = new Map<string, string>();
function iconUrl(name: string): string | null {
  const grid = PIXEL_ICONS[name];
  if (!grid) return null;
  let url = urls.get(name);
  if (!url) {
    url = `url("data:image/svg+xml,${encodeURIComponent(iconSvg(grid))}")`;
    urls.set(name, url);
  }
  return url;
}

/** el의 아이콘을 바꾼다 (같으면 그대로). null이면 아이콘을 뗀다 */
export function setIcon(el: HTMLElement, name: string | null): void {
  if ((el.dataset.ico ?? null) === name) return;
  const url = name ? iconUrl(name) : null;
  if (name && url) {
    el.dataset.ico = name;
    el.style.setProperty('--ico', url);
  } else {
    delete el.dataset.ico;
    el.style.removeProperty('--ico');
  }
}

/** root 안 data-ico가 적힌 요소마다 그림을 넣는다 (시작할 때 한 번) */
export function applyIcons(root: ParentNode = document): void {
  root.querySelectorAll<HTMLElement>('[data-ico]').forEach((el) => {
    const name = el.dataset.ico!;
    delete el.dataset.ico;
    setIcon(el, name);
  });
}

/**
 * 버튼 이름만 바꾼다 (아이콘 ::before·단축키 <kbd>는 그대로).
 * 이름은 <span class="lbl">에 둔다 — 넘치면 말줄임(…)도 이 칸에서.
 */
export function setLabel(el: HTMLElement, text: string): void {
  let lbl = el.querySelector<HTMLElement>(':scope > .lbl');
  if (!lbl) {
    lbl = document.createElement('span');
    lbl.className = 'lbl';
    el.prepend(lbl);
  }
  if (lbl.textContent !== text) lbl.textContent = text;
}
