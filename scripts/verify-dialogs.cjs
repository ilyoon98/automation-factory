// 임시 프로필의 숨김 Electron으로 창 갱신과 키보드 조작을 검증한다.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'factory-dialogs-')));
app.whenReady().then(async () => {
  const { createServer } = await import('vite');
  const server = await createServer({ server: { host: '127.0.0.1', port: 0 } });
  const win = new BrowserWindow({ show: false, width: 1280, height: 800, webPreferences: { offscreen: true, backgroundThrottling: false } });
  const errors = [];
  win.webContents.on('console-message', (event) => { if (event.level === 'error' && !event.message.includes('WebSocket')) errors.push(event.message); });
  const js = (code) => win.webContents.executeJavaScript(`(async () => { ${code} })()`);
  let count = 0;
  const check = async (name, code) => {
    if (!await js(code)) throw Error(name);
    count++; console.log(`PASS ${name}`);
  };
  try {
    await server.listen(); await win.loadURL(server.resolvedUrls.local[0]);
    await js(`game.setSpeed(0); document.querySelectorAll('.modal').forEach(el => el.hidden = true);`);
    for (const [id, key, button] of [['research', 't', 'research'], ['help', 'h', 'help'], ['codex', 'g', 'codex'], ['stats', 'p', 'stats'], ['goals', 'o', 'goals'], ['ach', 'j', 'ach']]) {
      await js(`document.getElementById('btn-${button}').click();`);
      await check(`${id} opens`, `return !document.getElementById('${id}').hidden;`);
      await js(`window.dispatchEvent(new KeyboardEvent('keydown', {key:'${key}', repeat:true, bubbles:true}));`);
      await check(`${id} ignores key repeat`, `return !document.getElementById('${id}').hidden;`);
      await js(`window.dispatchEvent(new KeyboardEvent('keydown', {key:'${key}', bubbles:true}));`);
      await check(`${id} closes with its own key`, `return document.getElementById('${id}').hidden;`);
    }
    await js(`document.getElementById('btn-research').click(); ui.researchTab='production'; ui.researchKey=''; ui.update();
      const p=document.querySelector('#research .panel'); p.scrollTop=180; window.beforeResearch=p.scrollTop;
      const w=game.getWorld(); for(const i of (await import('/src/data/items.ts')).ITEM_IDS) w.stock.set(i,100000);
      w.applyTech('automation'); ui.update();`);
    await check('research unlock preserves reading position', `return beforeResearch>0 && document.querySelector('#research .panel').scrollTop===beforeResearch;`);
    await js(`document.querySelectorAll('.modal').forEach(el=>el.hidden=true);document.getElementById('btn-goals').click();
      const p=document.querySelector('#goals .panel');p.scrollTop=240;window.beforeGoals=p.scrollTop;
      game.getWorld().goals.add('MG01');ui.update();`);
    await check('goal completion preserves reading position', `return beforeGoals>0 && document.querySelector('#goals .panel').scrollTop===beforeGoals;`);
    await js(`document.querySelectorAll('.modal').forEach(el=>el.hidden=true);document.getElementById('btn-stats').click();
      document.querySelector('#stats .x').focus();ui.statsAt=0;ui.update();`);
    await check('operations refresh preserves keyboard focus', `return document.activeElement===document.querySelector('#stats .x');`);
    await js(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'Tab',bubbles:true,cancelable:true}));`);
    await check('Tab still stays inside the refreshed window', `return document.getElementById('stats').contains(document.activeElement);`);
    if (errors.length) throw Error(errors.join('\n'));
    console.log(JSON.stringify({passed:true,checks:count}));
    await server.close(); app.exit(0);
  } catch (error) { console.error(error); await server.close(); app.exit(1); }
}).catch(error => { console.error(error); app.exit(1); });
