// 실제 저장은 건드리지 않고, 저장 실패와 화면 상태별 자동 저장을 검증한다.
const {app,BrowserWindow}=require('electron');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
app.setPath('userData',fs.mkdtempSync(path.join(os.tmpdir(),'factory-save-safety-')));
app.whenReady().then(async()=>{
 const {createServer}=await import('vite');
 const server=await createServer({server:{host:'127.0.0.1',port:0}});
 const win=new BrowserWindow({show:false,webPreferences:{offscreen:true,backgroundThrottling:false}});
 const js=code=>win.webContents.executeJavaScript(`(async()=>{${code}})()`);
 let checks=0;
 const check=async(name,code)=>{if(!await js(code))throw Error(name);checks++;console.log('PASS '+name);};
 try{
  await win.loadURL('about:blank');
  win.webContents.debugger.attach('1.3');
  await win.webContents.debugger.sendCommand('Page.enable');
  await win.webContents.debugger.sendCommand('Page.addScriptToEvaluateOnNewDocument',{source:`
   const nativeInterval=window.setInterval;
   window.setInterval=(fn,ms,...args)=>{if(ms===30000)window.testAutosave=fn;return nativeInterval(fn,ms,...args);};
  `});
  await server.listen();await win.loadURL(server.resolvedUrls.local[0]);
  await js(`window.requestAnimationFrame=()=>0;game.setSpeed(0);game.save();
   window.saveKey='automation-game/save-regional-v1';window.backupKey=saveKey+'-backup';
   window.saved=JSON.stringify(game.getWorld().serialize());
   localStorage.setItem(backupKey,saved);window.beforeWorld=game.getWorld();
   window.originalSet=Storage.prototype.setItem;
   Storage.prototype.setItem=function(k,v){if(k===backupKey)throw new DOMException('test','QuotaExceededError');return originalSet.call(this,k,v);};`);
  await js(`window.result=game.restoreBackup();`);
  await check('restore aborts on backup failure without replacing saves',`return game.getWorld()===beforeWorld&&localStorage.getItem(saveKey)===saved&&localStorage.getItem(backupKey)===saved;`);
  await check('restore explains backup failure',`return typeof result==='string'&&result.includes('전환을 중단');`);
  // 새 공장·불러오기는 새 칸에 만들어 지금 공장을 덮어쓰지 않는다
  await js(`Storage.prototype.setItem=originalSet;window.slotsKey=saveKey+'/slots';window.firstSaved=localStorage.getItem(saveKey);game.newGame();`);
  await check('new game keeps the previous factory in its own slot',`const idx=JSON.parse(localStorage.getItem(slotsKey));return idx.slots.length===2&&idx.active===2&&localStorage.getItem(saveKey)===firstSaved&&game.getWorld()!==beforeWorld;`);
  await js(`window.result=game.importSave(saved);`);
  await check('import opens a new slot and keeps both factories',`const idx=JSON.parse(localStorage.getItem(slotsKey));return result===null&&idx.slots.length===3&&idx.active===3&&localStorage.getItem(saveKey)===firstSaved;`);
  await js(`game.setSpeed(0);window.requestAnimationFrame=()=>0;
   window.saveKey=JSON.parse(localStorage.getItem(slotsKey)).slots.find(x=>x.id===3).key;
   window.writes=0;Storage.prototype.setItem=function(k,v){if(k===saveKey)writes++;return originalSet.call(this,k,v);};
   Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});
   game.getWorld().tick();testAutosave();`);
  await check('hidden window saves simulation progress',`return writes===1&&JSON.parse(localStorage.getItem(saveKey)).time===game.getWorld().time;`);
  await js('testAutosave();');
  await check('unchanged paused world avoids repeated serialization',`return writes===1;`);
  await js(`game.getWorld().tick();Storage.prototype.setItem=function(){throw new DOMException('test','QuotaExceededError');};testAutosave();`);
  await check('failed autosave reports failure',`return !game.saveState.ok;`);
  await js(`Storage.prototype.setItem=function(k,v){if(k===saveKey)writes++;return originalSet.call(this,k,v);};testAutosave();`);
  await check('failed autosave is retried',`return game.saveState.ok&&writes===2;`);
  await js(`Object.defineProperty(document,'hidden',{configurable:true,get:()=>false});
   window.idle=null;window.cancelled=false;window.requestIdleCallback=(fn)=>{idle=fn;return 123;};window.cancelIdleCallback=()=>{cancelled=true;idle=null;};
   game.getWorld().tick();testAutosave();`);
  await check('visible autosave waits for idle time',`return writes===2&&typeof idle==='function';`);
  await js('idle();');
  await check('idle autosave writes current world',`return writes===3;`);
  await js('game.getWorld().tick();testAutosave();game.save();');
  await check('manual save cancels queued duplicate autosave',`return cancelled&&idle===null&&writes===4;`);
  await js('Storage.prototype.setItem=originalSet;');
  console.log(JSON.stringify({passed:true,checks}));await server.close();app.exit(0);
 }catch(e){console.error(e);await server.close();app.exit(1);}
}).catch(e=>{console.error(e);app.exit(1);});
