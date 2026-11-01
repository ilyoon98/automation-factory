// 구맵 저장이 남은 시작·신맵 이어하기·목표 위치를 개인 저장과 분리해 확인한다.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'factory-startup-')));
app.commandLine.appendSwitch('disable-gpu');
app.whenReady().then(async () => {
  const { createServer } = await import('vite');
  const server = await createServer({ server: { host: '127.0.0.1', port: 0 } });
  const win = new BrowserWindow({ show: false, width: 1280, height: 900, webPreferences: { offscreen: true, backgroundThrottling: false } });
  const js = code => win.webContents.executeJavaScript(`(async()=>{${code}})()`);
  let checks = 0;
  const check = async (name, code) => { if (!await js(code)) throw Error(name); checks++; console.log(`PASS ${name}`); };
  const freeze = () => js(`window.requestAnimationFrame=()=>0;game.setSpeed(0);document.querySelectorAll('.modal,#newgame').forEach(e=>e.hidden=true);`);
  try {
    await server.listen(); const url = server.resolvedUrls.local[0]; await win.loadURL(url); await freeze();
    await js(`const w=new (await import('/src/sim/world.ts')).World(30,30);w.createHub(0,0);w.seed=123;
      localStorage.setItem('test-old',JSON.stringify(w.serialize()));localStorage.setItem('automation-game/save-v1',localStorage.getItem('test-old'));
      localStorage.removeItem('automation-game/save-regional-v1');`);
    await win.loadURL(url); await freeze();
    await check('startup skips the old map and generates the regional map', `const w=game.getWorld();return w.regional&&w.width===256&&w.height===256;`);
    await check('old saved factory remains intact', `return localStorage.getItem('automation-game/save-v1')===localStorage.getItem('test-old');`);
    await js(`game.input.tool='miner';ui.update();`);
    await check('first regional goal points at visible iron ore', `const m=ui.guideMark,w=game.getWorld();return !!m&&m.label==='철광맥'&&w.isRevealed(w.idx(Math.floor(m.x),Math.floor(m.y)));`);
    await check('legacy import cannot replace the new map', `const w=game.getWorld();return !!game.importSave(localStorage.getItem('test-old'))&&game.getWorld()===w;`);
    await js(`localStorage.setItem('test-regional-seed',String(game.getWorld().seed));game.save();`);
    await win.loadURL(url); await freeze();
    await check('restarting continues the saved new factory', `return game.getWorld().regional&&String(game.getWorld().seed)===localStorage.getItem('test-regional-seed');`);
    await js(`localStorage.setItem('automation-game/save-v1',JSON.stringify(game.getWorld().serialize()));localStorage.removeItem('automation-game/save-regional-v1');`);
    await win.loadURL(url); await freeze();
    await check('a new-map save from the previous version also continues', `return game.getWorld().regional&&String(game.getWorld().seed)===localStorage.getItem('test-regional-seed');`);
    await js(`game.input.tool='miner';ui.update();`);
    const out = path.resolve('artifacts/junction'); fs.mkdirSync(out, { recursive: true });
    await js(`renderer.draw(game.getWorld(),camera,game.input);if(ui.guideMark)renderer.drawGuideMark(camera,ui.guideMark,1);`);
    fs.writeFileSync(path.join(out, 'regional-goal.png'), (await win.webContents.capturePage()).toPNG());
    console.log(JSON.stringify({ passed: true, checks })); await server.close(); app.exit(0);
  } catch (error) { console.error(error); await server.close(); app.exit(1); }
}).catch(error => { console.error(error); app.exit(1); });
