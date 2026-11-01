// 임시 프로필·숨김 Electron으로 운송 선택/접기 UI를 검증한다. 개인 저장은 사용하지 않는다.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const out = path.resolve('artifacts/transport');
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'factory-transport-')));
app.commandLine.appendSwitch('disable-gpu');
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
app.whenReady().then(async () => {
  const { createServer } = await import('vite');
  const server = await createServer({ server: { host: '127.0.0.1', port: 0 } });
  const win = new BrowserWindow({ show: false, width: 1280, height: 800, webPreferences: { offscreen: true, backgroundThrottling: false } });
  const results = [], errors = [];
  fs.mkdirSync(out, { recursive: true });
  win.webContents.on('console-message', (_event, level, message) => { if (level >= 3 && !message.includes('WebSocket')) errors.push(message); });
  const js = (code) => win.webContents.executeJavaScript(`(async () => { ${code} })()`);
  const check = async (name, code) => {
    const result = await js(code); results.push({ name, result });
    if (result === false || result?.pass === false) throw Error(name);
  };
  const shot = async (name) => {
    await delay(70); fs.writeFileSync(path.join(out, `${name}.png`), (await win.webContents.capturePage()).toPNG());
  };
  try {
    await server.listen(); await win.loadURL(server.resolvedUrls.local[0]); await delay(350);
    await js(`
      window.requestAnimationFrame = () => 0; game.setSpeed(0); await new Promise(r => setTimeout(r, 50));
      for (const el of document.querySelectorAll('.modal, #newgame')) el.hidden = true;
      window.tw = new (await import('/src/sim/world.ts')).World(40, 30); tw.rules = 'regional-v1'; tw.createHub(0, 0);
      for (const t of tw.techs) tw.applyTech(t.id);
      for (const item of (await import('/src/data/items.ts')).ITEM_IDS) tw.stock.set(item, 10000);
      window.ta = tw.place('station', 3,4,0); window.tb = tw.place('station', 15,4,0); window.tc = tw.place('station', 26,4,0);
      tw.setStationMode(tb, 'unload');
      for (let x=3;x<=17;x++) tw.place('road', x,6,0);
      for (let x=25;x<=29;x++) tw.place('road', x,6,0);
      window.tv = tw.buildTruck(ta); tw.setRoute(tv, ta.id, tb.id);
      game.getWorld = () => tw;
      const { applyCommand } = await import('/src/sim/commands.ts');
      window.sentCommands = [];
      game.exec = (cmd, done) => { sentCommands.push(cmd); const result = applyCommand(tw, 0, cmd); done?.(result); return result; };
      game.input.selectedId = null; game.input.selectedVehicle = tv.id;
      ui.infoKey = ''; ui.update(); camera.x = 11; camera.y=6; camera.zoom=24; renderer.draw(tw,camera,game.input);
    `);
    await check('only stations on the current road network can be chosen', `
      const ids = [...document.querySelector('[data-act="stop-station"]').options].map(o=>Number(o.value));
      return ids.includes(ta.id) && ids.includes(tb.id) && !ids.includes(tc.id);
    `);
    await check('compact default shows status cargo battery and folds all advanced text', `
      return document.querySelectorAll('#info .dyn').length===1 && !document.querySelector('#info [data-transport-section][open]') &&
        ['상태','짐','배터리'].every(t=>document.querySelector('#info .dyn').textContent.includes(t));
    `);
    await shot('vehicle-default');
    await js(`document.querySelector('[data-transport-section="plan"]').open=true; document.querySelector('[data-transport-section="metrics"]').open=true;
      const select=document.querySelector('[data-act="stop-item"]'); select.value='iron-ore'; select.dispatchEvent(new Event('change',{bubbles:true}));`);
    await check('normal route change is applied and expanded settings stay open', `return tv.stops[0].item==='iron-ore' && document.querySelector('[data-transport-section="plan"]').open && document.querySelector('[data-transport-section="metrics"]').open;`);
    await js(`
      document.querySelector('[data-plan-item="0"]').value='tin-ore';
      document.querySelector('[data-plan-cap="0"]').value='37';
      document.querySelector('[data-plan-period]').value='120';
      document.querySelector('[data-plan-early]').checked=true;
      document.querySelector('[data-act="plan-row"]').click();
    `);
    await check('adding another plan item preserves the unsubmitted first row and schedule', `
      return document.querySelectorAll('[data-plan-item]').length===2 && document.querySelector('[data-plan-item="0"]').value==='tin-ore' &&
        document.querySelector('[data-plan-cap="0"]').value==='37' && document.querySelector('[data-plan-period]').value==='120' && document.querySelector('[data-plan-early]').checked && tv.plan.length===0;
    `);
    await js(`document.querySelector('[data-plan-cap="0"]').focus(); tw.beginEdit(); tw.remove(tw.buildingAt(10,6)); tw.endEdit(); ui.update();`);
    await check('road refresh preserves unsent values and focus', `return document.querySelector('[data-plan-cap="0"]').value==='37' && document.querySelector('[data-plan-period]').value==='120' && document.activeElement.dataset.planCap==='0' && tv.plan.length===0;`);
    await check('broken selected stop stays selected with a disabled reason', `
      const select = document.querySelector('[data-act="stop-station"][data-i="1"]');
      return Number(select.value)===tb.id && select.selectedOptions[0].disabled && select.selectedOptions[0].textContent.includes('도로 끊김') && tv.stops[1].id===tb.id;
    `);
    await shot('disconnected-selection');
    await js('tw.undo(); ui.update();');
    await check('undo restores the selected destination without changing the route', `const s=document.querySelector('[data-act="stop-station"][data-i="1"]'); return Number(s.value)===tb.id && !s.selectedOptions[0].disabled;`);
    await js(`document.querySelector('[data-act="plan-apply"]').click();`);
    await check('applying a draft updates the actual plan and removes the unused row', `return tv.plan.length===1 && tv.plan[0].item==='tin-ore' && tv.plan[0].cap===37 && tv.period===120 && tv.early && document.querySelectorAll('[data-plan-item]').length===1;`);
    await js(`document.querySelector('[data-plan-cap="0"]').value='77'; tw.setPlan(tv,[{item:'coal',cap:12}],60,false); ui.update();`);
    await check('an authoritative plan change replaces the draft instead of restoring stale inputs', `return document.querySelector('[data-plan-item="0"]').value==='coal' && document.querySelector('[data-plan-cap="0"]').value==='12' && document.querySelector('[data-plan-period]').value==='60' && !document.querySelector('[data-plan-early]').checked;`);
    await js(`window.commandCount = sentCommands.length; document.querySelector('[data-plan-cap="0"]').value='0'; document.querySelector('[data-act="plan-apply"]').click();`);
    await check('invalid capacity leaves the existing plan and draft untouched without sending a command', `return sentCommands.length===commandCount && tv.plan.length===1 && tv.plan[0].cap===12 && document.querySelector('[data-plan-cap="0"]').value==='0' && document.getElementById('toast').textContent.includes('상한');`);
    await js('tw.remove(tc); tw.remove(tb); ui.update();');
    await check('deleted stop is retained as an explicit invalid selection', `return document.querySelector('[data-act="stop-station"][data-i="1"]').selectedOptions[0].textContent.includes('삭제된 정류장');`);
    await js(`game.input.selectedVehicle=null; game.input.selectedId=ta.id; ui.update();`);
    await check('station shows inventory once and folds charging targets assembly help', `return document.querySelectorAll('#info .dyn').length===1 && document.querySelectorAll('#info details[data-transport-section]').length>=4 && !document.querySelector('#info details[open]');`);
    await check('power connection details are folded instead of filling the station summary', `return document.querySelector('[data-transport-section="charging"] .station-power') && !document.querySelector('#info .dyn').textContent.includes('접속') && !document.querySelector('#info .dyn').textContent.includes('거점 충전');`);
    await js(`document.querySelector('[data-transport-section="targets"]').open=true;
      document.querySelector('[data-target-item]').value='motor';const field=document.querySelector('[data-target-n]');field.value='137';field.focus();
      ta.inBuf.set('truck-kit',1);ui.update();`);
    await check('station inventory refresh preserves an unfinished inventory target and focus', `return document.querySelector('[data-target-item]').value==='motor'&&document.querySelector('[data-target-n]').value==='137'&&document.activeElement===document.querySelector('[data-target-n]');`);
    await js(`tw.setTarget(ta,'motor',50);ui.update();window.targetCommandCount=sentCommands.length;
      document.querySelector('[data-target-item]').value='motor';document.querySelector('[data-target-n]').value='';document.querySelector('[data-act="target-add"]').click();`);
    await check('an empty target amount never deletes an existing target', `return ta.targets.get('motor')===50&&sentCommands.length===targetCommandCount&&document.getElementById('toast').textContent.includes('정수');`);
    await check('zero negative fractional and unsafe target amounts leave the old target intact', `for(const value of ['0','-2','1.5','1e20']){document.querySelector('[data-target-n]').value=value;document.querySelector('[data-act="target-add"]').click();if(ta.targets.get('motor')!==50||sentCommands.length!==targetCommandCount)return false;}return true;`);
    await js(`document.querySelector('[data-target-n]').value='137';document.querySelector('[data-act="target-add"]').click();`);
    await check('a valid target is applied and explicit delete still removes it', `if(ta.targets.get('motor')!==137)return false;document.querySelector('[data-act="target-del"][data-item="motor"]').click();return !ta.targets.has('motor');`);
    await js(`window.td=tw.place('station',26,4,0);game.input.selectedId=td.id;ui.update();`);
    await check('another station never inherits the previous target draft', `return document.querySelector('[data-target-item]').value===''&&document.querySelector('[data-target-n]').value==='40';`);
    await js(`game.input.selectedId=ta.id;ui.update();`);
    await shot('station-default');
    await js('game.input.selectedId=null; game.input.selectedVehicle=tv.id; ui.update();');
    win.setSize(320, 700); await delay(120); await js('ui.update();');
    await check('320px route controls stay inside the panel', `const panel=document.getElementById('info'); const r=panel.getBoundingClientRect(); return {pass:[...panel.querySelectorAll('select,summary,button')].filter(el=>el.getClientRects().length).every(el=>{const b=el.getBoundingClientRect();return b.left>=r.left && b.right<=r.right+1;}) && panel.scrollWidth<=panel.clientWidth+1,width:panel.clientWidth,scroll:panel.scrollWidth};`);
    await check('narrow layout leaves readable vertical space for transport', `return document.getElementById('info').getBoundingClientRect().height >= 150 && document.getElementById('tabs').scrollWidth > document.getElementById('tabs').clientWidth;`);
    await shot('vehicle-narrow');
    await js(`document.querySelector('[data-transport-section="plan"]').open=true; document.querySelector('[data-transport-section="metrics"]').open=true;`);
    await check('expanded transport settings also fit 320px', `const p=document.getElementById('info');return p.scrollWidth<=p.clientWidth+1;`);
    await js(`document.querySelector('[data-plan-cap="0"]').value='29'; tw = (await import('/src/sim/world.ts')).World.deserialize(tw.serialize()); tv = tw.vehicles.get(tv.id); ui.update();`);
    await check('loading a different world never copies a draft to a reused truck id', `return document.querySelector('[data-plan-cap="0"]').value===String(tv.plan[0].cap);`);
    await js(`document.querySelector('[data-act="clone-truck"]').click();`);
    await check('same route button creates a truck with the displayed transport plan', `const copy=tw.vehicles.get(game.input.selectedVehicle);return copy&&copy.id!==tv.id&&JSON.stringify(copy.plan)===JSON.stringify(tv.plan)&&copy.period===tv.period&&copy.early===tv.early&&copy.load===0&&document.querySelector('[data-plan-cap="0"]').value===String(tv.plan[0].cap);`);
    if (errors.length) throw Error(errors.join('\n'));
    fs.writeFileSync(path.join(out,'results.json'),JSON.stringify({passed:true,results,errors},null,2));
    console.log(JSON.stringify({passed:true,checks:results.length,out}));
    await server.close(); app.exit(0);
  } catch(error) {
    fs.writeFileSync(path.join(out,'results.json'),JSON.stringify({passed:false,results,errors,error:String(error)},null,2));
    console.error(error); await server.close(); app.exit(1);
  }
});
