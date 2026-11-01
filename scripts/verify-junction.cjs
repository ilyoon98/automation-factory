// 임시 프로필에서 방향 설정과 재료 부족 표시를 실제 정보창으로 확인한다.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'factory-junction-')));
app.commandLine.appendSwitch('disable-gpu');
app.whenReady().then(async () => {
  const { createServer } = await import('vite');
  const server = await createServer({ server: { host: '127.0.0.1', port: 0 } });
  const win = new BrowserWindow({ show: false, width: 1280, height: 900, webPreferences: { offscreen: true, backgroundThrottling: false } });
  const js = code => win.webContents.executeJavaScript(`(async()=>{${code}})()`);
  let checks = 0;
  const check = async (name, code) => { if (!await js(code)) throw Error(name); checks++; console.log(`PASS ${name}`); };
  try {
    await server.listen(); await win.loadURL(server.resolvedUrls.local[0]);
    await js(`window.requestAnimationFrame=()=>0;game.setSpeed(0);document.querySelectorAll('.modal,#newgame').forEach(e=>e.hidden=true);
      window.jw=new (await import('/src/sim/world.ts')).World(30,30);jw.createHub(0,0);
      for(const t of jw.techs)jw.applyTech(t.id);
      for(const i of (await import('/src/data/items.ts')).ITEM_IDS)jw.stock.set(i,10000);
      game.getWorld=()=>jw;const {applyCommand}=await import('/src/sim/commands.ts');
      game.exec=(cmd,done)=>{const r=applyCommand(jw,0,cmd);done?.(r);};
      window.jb=jw.place('sorter',10,10,0);game.input.selectedId=jb.id;game.input.selectedVehicle=null;ui.update();
      window.change=(act,value)=>{const el=document.querySelector('[data-act="'+act+'"]');el.value=String(value);el.dispatchEvent(new Event('change',{bubbles:true}));};`);
    await check('sorter exposes direction controls', `return !!document.querySelector('[data-act="junction-input"]')&&!!document.querySelector('[data-act="junction-outputs"]');`);
    await js(`change('junction-input',8);change('junction-outputs',3);`);
    await check('left input and top/right outputs apply through UI commands', `return jb.junction.inputs===8&&jb.junction.outputs===3;`);
    const out = path.resolve('artifacts/junction'); fs.mkdirSync(out, { recursive: true });
    await js(`camera.x=11;camera.y=10;camera.zoom=48;renderer.draw(jw,camera,game.input);`);
    fs.writeFileSync(path.join(out, 'junction-ports.png'), (await win.webContents.capturePage()).toPNG());
    await js(`change('junction-front',1);`);
    await check('rotation preserves the relative port layout', `return jb.dir===1&&jb.junction.inputs===8&&jb.junction.outputs===3;`);
    await js(`window.jm=jw.place('merger',15,10,1);game.input.selectedId=jm.id;ui.update();change('junction-inputs',4);`);
    await check('merger input selection applies', `return jm.junction.inputs===4&&jm.junction.outputs===1;`);
    await js(`window.ja=jw.place('assembler',10,15,0);jw.setRecipe(ja,'circuit');ja.inBuf.set('copper-wire',6);ja.stats={eff:.85,work:.85,starve:.15,blocked:0,age:20};
      game.input.selectedId=ja.id;ui.update();`);
    await check('only iron is marked short when copper wire is waiting', `const rows=[...document.querySelectorAll('#info .dyn .row')];return rows.some(r=>r.textContent.includes('철판')&&r.textContent.includes('1개 부족'))&&rows.some(r=>r.textContent.includes('구리선')&&r.textContent.includes('6 / 3 · 준비됨'));`);
    await check('consumption is explicitly separate from material readiness', `const t=document.getElementById('info').textContent;return t.includes('소비 속도')&&t.includes('가동률 기준')&&t.includes('다음 제작 준비')&&!t.includes('재료 사용');`);
    await js(`ja.crafting=true;ui.update();`);
    await check('in-progress crafting labels the wait as next-batch readiness', `return document.getElementById('info').textContent.includes('현재 제작 완료 후');`);
    fs.writeFileSync(path.join(out, 'material-readiness.png'), (await win.webContents.capturePage()).toPNG());
    win.setSize(400, 750);
    await js(`ui.update();`);
    await check('material information stays inside the narrow panel', `const p=document.getElementById('info');return p.scrollWidth<=p.clientWidth+1;`);
    console.log(JSON.stringify({ passed: true, checks })); await server.close(); app.exit(0);
  } catch (error) { console.error(error); await server.close(); app.exit(1); }
}).catch(error => { console.error(error); app.exit(1); });
