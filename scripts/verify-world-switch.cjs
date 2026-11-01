// 임시 프로필에서 실제 새 게임·불러오기·백업 복구의 입력 초기화를 확인한다.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'factory-world-switch-')));
app.whenReady().then(async () => {
  const { createServer } = await import('vite');
  const server = await createServer({ server: { host:'127.0.0.1', port:0 } });
  const win = new BrowserWindow({ show:false, webPreferences:{ offscreen:true, backgroundThrottling:false } });
  const js = code => win.webContents.executeJavaScript(`(async()=>{${code}})()`);
  let checks=0;
  const check=async(name,code)=>{if(!await js(code))throw Error(name);checks++;console.log(`PASS ${name}`);};
  try {
    await server.listen();await win.loadURL(server.resolvedUrls.local[0]);
    await js(`window.requestAnimationFrame=()=>0;game.setSpeed(0);document.querySelectorAll('.modal').forEach(e=>e.hidden=true);
      window.saved=JSON.stringify(game.getWorld().serialize());
      window.dirtyInput=()=>{const i=game.input;i.selectedVehicle=1;i.selectedId=1;i.multi=[1,2];i.blocked={type:'belt',why:'poor'};
        i.paste={w:1,h:1,entries:[{type:'belt',dx:0,dy:0,dir:1,recipe:null,filter:null}]};i.pasteName='옛 공장';
        i.mode='remove-area';i.removeArea={x0:0,y0:0,x1:20,y1:20};i.keys.add('d');};`);
    for(const [name,action] of [['new game',`game.newGame()`],['import',`if(game.importSave(saved)!==null)throw Error('import failed')`],['restore backup',`if(game.restoreBackup()!==null)throw Error('restore failed')`]]) {
      await js(`dirtyInput();${action};`);
      await check(`${name} clears stale selections and pending blueprint`, `const i=game.input;return i.selectedId===null&&i.selectedVehicle===null&&!i.multi.length&&!i.paste&&!i.pasteName&&!i.blocked;`);
      await check(`${name} cancels pending area removal`, `return game.input.removeArea===null;`);
      await check(`${name} clears held movement keys`, `const x=camera.x;game.input.update(1);return camera.x===x;`);
      await check(`${name} cannot execute old removal after pointer release`, `const n=game.getWorld().buildings.size;window.dispatchEvent(new PointerEvent('pointerup',{pointerId:1,clientX:100,clientY:100}));return game.getWorld().buildings.size===n;`);
    }
    console.log(JSON.stringify({passed:true,checks}));await server.close();app.exit(0);
  }catch(error){console.error(error);await server.close();app.exit(1);}
}).catch(error=>{console.error(error);app.exit(1);});
