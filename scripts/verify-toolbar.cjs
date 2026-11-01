// 임시 저장의 숨김 Electron에서 배율·툴바 스크롤 입력을 확인한다.
const {app,BrowserWindow}=require('electron');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
app.setPath('userData',fs.mkdtempSync(path.join(os.tmpdir(),'factory-toolbar-')));
app.commandLine.appendSwitch('disable-gpu');
const delay=ms=>new Promise(r=>setTimeout(r,ms));
app.whenReady().then(async()=>{
  const {createServer}=await import('vite');const server=await createServer({server:{host:'127.0.0.1',port:0}});
  const win=new BrowserWindow({show:false,width:400,height:700,webPreferences:{offscreen:true,backgroundThrottling:false}});
  const js=code=>win.webContents.executeJavaScript(`(async()=>{${code}})()`);
  let checks=0;const check=async(name,code)=>{if(!await js(code))throw Error(name);checks++;console.log(`PASS ${name}`);};
  try{
    await server.listen();await win.loadURL(server.resolvedUrls.local[0]);
    await js(`window.requestAnimationFrame=()=>0;game.setSpeed(0);document.querySelectorAll('.modal').forEach(e=>e.hidden=true);
      Object.defineProperty(window,'devicePixelRatio',{value:1.25,configurable:true});(await import('/src/ui/crisp.ts')).setCrispText(true);
      ui.toolbar.selectByKey('x');ui.update();ui.toolbar.slot(8);`);
    await delay(450);
    await check('number key selection reveals the full card with crisp text enabled',`const p=document.getElementById('palette'),c=p.lastElementChild;const pr=p.getBoundingClientRect(),cr=c.getBoundingClientRect();return cr.left>=pr.left-1&&cr.right<=pr.right+1;`);
    await js(`const p=document.getElementById('palette');p.scrollLeft=100;const t=document.querySelector('#palette-bar .thumb');t.setPointerCapture=()=>{};
      t.dispatchEvent(new PointerEvent('pointerdown',{pointerId:1,button:0,buttons:1,clientX:100,bubbles:true}));
      t.dispatchEvent(new PointerEvent('pointercancel',{pointerId:1,bubbles:true}));window.scrollBefore=p.scrollLeft;
      t.dispatchEvent(new PointerEvent('pointermove',{pointerId:1,buttons:1,clientX:180,bubbles:true}));`);
    await check('cancelled scrollbar drag stops moving and clears drag appearance',`return document.getElementById('palette').scrollLeft===scrollBefore&&!document.querySelector('#palette-bar .thumb').classList.contains('drag');`);
    win.setSize(1600,900);await delay(60);
    await js(`Object.defineProperty(window,'devicePixelRatio',{value:1.5,configurable:true});const crisp=await import('/src/ui/crisp.ts');crisp.setCrispText(true);
      const left=document.getElementById('left');left.style.height='120px';left.style.overflowY='scroll';const r=left.getBoundingClientRect();
      window.dispatchEvent(new PointerEvent('pointermove',{buttons:0,clientX:r.right-(left.offsetWidth-left.clientWidth)*crisp.uiZoom()+1,clientY:r.top+30}));`);
    await check('enlarged UI keeps the entire left scrollbar draggable',`return document.getElementById('left').classList.contains('grab-scroll');`);
    await js(`game.input.layer='base';window.dispatchEvent(new KeyboardEvent('keydown',{key:'@',code:'Digit2',shiftKey:true,bubbles:true}));
      for(let i=0;i<5;i++)window.dispatchEvent(new KeyboardEvent('keydown',{key:'@',code:'Digit2',shiftKey:true,repeat:true,bubbles:true}));`);
    await check('holding a map layer shortcut does not flicker the selected layer',`return game.input.layer==='power';`);
    await js(`window.clipField=document.createElement('input');clipField.value='공유 코드';document.body.append(clipField);clipField.focus();clipField.setSelectionRange(1,3);
      Object.defineProperty(window,'isSecureContext',{value:false,configurable:true});document.execCommand=()=>false;
      window.clipResult=await (await import('/src/ui/clipboard.ts')).copyText('복사할 내용');`);
    await check('failed fallback copy returns focus and selection to the original input',`return clipResult===false&&document.activeElement===clipField&&clipField.selectionStart===1&&clipField.selectionEnd===3;`);
    await js(`document.execCommand=()=>true;clipResult=await (await import('/src/ui/clipboard.ts')).copyText('복사할 내용');`);
    await check('successful fallback copy also preserves keyboard focus',`return clipResult===true&&document.activeElement===clipField;`);
    await js(`const bp={w:1,h:1,entries:[{type:'belt',dx:0,dy:0,dir:1,recipe:null,filter:null}]};
      localStorage.setItem('automation-blueprints',JSON.stringify([{name:'손상',bp:{...bp,entries:[null]}},{name:'복구한 공장',bp,at:123}]));
      ui.toolbar.selectByKey('k');ui.update();`);
    await check('blueprint tab still renders usable cards after a damaged saved entry',`return [...document.querySelectorAll('#palette button.pal .name')].some(e=>e.textContent==='복구한 공장');`);
    await js(`ui.toolbar.slot(0);`);
    await check('a recovered blueprint can still be selected for placement',`return game.input.paste?.entries.length===1&&game.input.paste.entries[0].type==='belt'&&game.input.pasteName==='복구한 공장';`);
    console.log(JSON.stringify({passed:true,checks}));await server.close();app.exit(0);
  }catch(error){console.error(error);await server.close();app.exit(1);}
}).catch(error=>{console.error(error);app.exit(1);});
