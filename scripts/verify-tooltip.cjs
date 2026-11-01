// 개인 저장에 접근하지 않는 숨김 Electron에서 지도 안내를 검증한다.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'factory-tooltip-')));
app.whenReady().then(async () => {
  const { createServer } = await import('vite');
  const server = await createServer({ server: { host: '127.0.0.1', port: 0 } });
  const win = new BrowserWindow({ show: false, width: 1280, height: 800, webPreferences: { offscreen: true, backgroundThrottling: false } });
  const js = code => win.webContents.executeJavaScript(`(async()=>{${code}})()`);
  let checks = 0;
  const check = async (name, code) => { if (!await js(code)) throw Error(name); checks++; console.log(`PASS ${name}`); };
  try {
    await server.listen(); await win.loadURL(server.resolvedUrls.local[0]);
    await js(`window.requestAnimationFrame=()=>0; game.setSpeed(0);
      document.querySelectorAll('.modal').forEach(el=>el.hidden=true);
      window.tw=new (await import('/src/sim/world.ts')).World(40,30); tw.createHub(0,0); game.getWorld=()=>tw;game.input.cb.getWorld=()=>tw;
      game.input.tool=null;game.input.paste=null;game.input.mode='none';game.input.keys.clear();game.input.hover={x:10,y:10};game.input.mouse=[10.5,10.5];
      ui.mouse={x:500,y:400};ui.updateTooltip(tw);`);
    await check('empty ground does not cover the map with movement instructions', `return document.getElementById('tooltip').hidden;`);
    await js(`game.input.mode='pan';ui.updateTooltip(tw);`);
    await check('panning empty ground stays quiet', `return document.getElementById('tooltip').hidden;`);
    await js(`game.input.mode='none';tw.resItem[tw.idx(10,10)]='iron-ore';tw.resAmount[tw.idx(10,10)]=100;ui.updateTooltip(tw);`);
    await check('resource information remains visible without movement instructions', `const t=document.getElementById('tooltip');return !t.hidden&&t.textContent.includes('광맥')&&!t.textContent.includes('화면 이동');`);
    await js(`ui.mouse={x:innerWidth-2,y:innerHeight-2};ui.updateTooltip(tw);`);
    await check('resource tooltip stays within bottom and right edges', `const r=document.getElementById('tooltip').getBoundingClientRect();return r.left>=0&&r.top>=0&&r.right<=innerWidth&&r.bottom<=innerHeight;`);
    await js(`document.getElementById('btn-research').click();ui.updateTooltip(tw);`);
    await check('opening a dialog hides map tooltip', `return document.getElementById('tooltip').hidden;`);
    await js(`document.querySelectorAll('.modal').forEach(el=>el.hidden=true);tw.resItem[tw.idx(10,10)]=null;game.input.tool='miner';ui.updateTooltip(tw);`);
    await check('construction feedback remains visible', `return !document.getElementById('tooltip').hidden;`);
    await js(`game.input.tool=null;tw.resItem[tw.idx(10,10)]='iron-ore';tw.resAmount[tw.idx(10,10)]=100;
      Object.defineProperty(window,'devicePixelRatio',{value:1.25,configurable:true});
      (await import('/src/ui/crisp.ts')).setCrispText(true);ui.mouse={x:innerWidth-2,y:innerHeight-2};ui.updateTooltip(tw);`);
    await check('tooltip respects crisp text UI scaling', `const r=document.getElementById('tooltip').getBoundingClientRect();return r.left>=0&&r.top>=0&&r.right<=innerWidth&&r.bottom<=innerHeight;`);
    await js(`(await import('/src/ui/crisp.ts')).setCrispText(false);`);
    win.setSize(320,700);
    await js(`ui.mouse={x:innerWidth-2,y:innerHeight-2};ui.updateTooltip(tw);`);
    await check('tooltip remains readable in a narrow window', `const r=document.getElementById('tooltip').getBoundingClientRect();return r.width>100&&r.left>=0&&r.right<=innerWidth&&r.bottom<=innerHeight;`);
    console.log(JSON.stringify({passed:true,checks}));
    await server.close();app.exit(0);
  } catch(error) { console.error(error);await server.close();app.exit(1); }
}).catch(error=>{console.error(error);app.exit(1);});
