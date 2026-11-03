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
        ['상태','짐'].every(t=>document.querySelector('#info .dyn').textContent.includes(t));
    `);
    await shot('vehicle-default');
    await check('truck overview folds route and name without battery controls', `
      const panel=document.querySelector('#info');
      return !panel.querySelector('[data-transport-section="route"]').open &&
        !panel.querySelector('[data-act="truck-name"]').checkVisibility() &&
        !panel.querySelector('[data-act="stop-station"]').checkVisibility() &&
        !panel.querySelector('.dyn').textContent.includes('배터리') && !panel.querySelector('.dyn').textContent.includes('kW') && !panel.querySelector('.dyn').textContent.includes('칸');
    `);
    await js(`document.querySelector('[data-transport-section="route"]').open=true;`);
    await check('blocked truck uses one short status without extra warning paragraphs', `
      const previous=tv.status;
      try {
        for(const [status,label] of [['no-route','도로 끊김'],['unload-full','도착지 보관 공간 부족'],['no-supply','출발지 재료 부족']]){
          tv.status=status;ui.update();
          const summary=document.querySelector('#info .dyn');
          if(!summary.textContent.includes(label)||summary.querySelector('p.bad'))return false;
        }
        return !document.querySelector('#info .route').textContent.includes('노선의 싣기·내리기는');
      } finally {tv.status=previous;ui.update();}
    `);
    await js(`document.querySelector('[data-transport-section="plan"]').open=true; document.querySelector('[data-transport-section="metrics"]').open=true;
      const select=document.querySelector('[data-act="stop-item"]'); select.value='iron-ore'; select.dispatchEvent(new Event('change',{bubbles:true}));`);
    await check('normal route change is applied and expanded settings stay open', `return tv.stops[0].item==='iron-ore' && document.querySelector('[data-transport-section="route"]').open && document.querySelector('[data-transport-section="plan"]').open && document.querySelector('[data-transport-section="metrics"]').open;`);
    await js(`
      const wait=document.querySelector('[data-act="dispatch-wait"]');wait.value='15';wait.dispatchEvent(new Event('change',{bubbles:true}));
      document.querySelector('[data-plan-item="0"]').value='tin-ore';
      document.querySelector('[data-act="plan-row"]').click();
    `);
    await check('adding another plan item preserves the unsubmitted first row and schedule', `
      return document.querySelectorAll('[data-plan-item]').length===2 && document.querySelector('[data-plan-item="0"]').value==='tin-ore' &&
        document.querySelector('[data-act="dispatch-wait"]').value==='15' && tv.departureWait===15 && !document.querySelector('[data-plan-cap], [data-plan-period], [data-plan-early]') && tv.plan.length===0;
    `);
    await js(`document.querySelector('[data-plan-item="0"]').focus(); tw.beginEdit(); tw.remove(tw.buildingAt(10,6)); tw.endEdit(); ui.update();`);
    await check('road refresh preserves unsent values and focus', `return document.querySelector('[data-plan-item="0"]').value==='tin-ore' && document.querySelector('[data-act="dispatch-wait"]').value==='15' && document.activeElement.dataset.planItem==='0' && tv.plan.length===0;`);
    await check('broken selected stop stays selected with a disabled reason', `
      const select = document.querySelector('[data-act="stop-station"][data-i="1"]');
      return Number(select.value)===tb.id && select.selectedOptions[0].disabled && select.selectedOptions[0].textContent.includes('도로 끊김') && tv.stops[1].id===tb.id;
    `);
    await shot('disconnected-selection');
    await js('tw.undo(); ui.update();');
    await check('undo restores the selected destination without changing the route', `const s=document.querySelector('[data-act="stop-station"][data-i="1"]'); return Number(s.value)===tb.id && !s.selectedOptions[0].disabled;`);
    await js(`document.querySelector('[data-act="plan-apply"]').click();`);
    await check('applying a draft updates the actual plan and removes the unused row', `return tv.plan.length===1 && tv.plan[0].item==='tin-ore' && tv.departureWait===15 && tv.period===0 && !tv.early && document.querySelectorAll('[data-plan-item]').length===1;`);
    await js(`document.querySelector('[data-plan-item="0"]').value='motor'; tw.setDispatch(tv,['coal'],5); ui.update();`);
    await check('an authoritative plan change replaces the draft instead of restoring stale inputs', `return document.querySelector('[data-plan-item="0"]').value==='coal' && document.querySelector('[data-act="dispatch-wait"]').value==='5';`);
    await js(`document.querySelector('[data-act="plan-row"]').click();document.querySelector('[data-plan-item="1"]').value='coal';window.commandCount=sentCommands.length; document.querySelector('[data-act="plan-apply"]').click();`);
    await check('duplicate items leave the existing plan and draft untouched without sending a command', `return sentCommands.length===commandCount && tv.plan.length===1 && tv.plan[0].item==='coal' && document.getElementById('toast').textContent.includes('중복');`);
    await js('tw.remove(tc); tw.remove(tb); ui.update();');
    await check('deleted stop is retained as an explicit invalid selection', `return document.querySelector('[data-act="stop-station"][data-i="1"]').selectedOptions[0].textContent.includes('삭제된 정류장');`);
    await js(`game.input.selectedVehicle=null; game.input.selectedId=ta.id; ui.update();`);
    await check('station shows inventory once and folds charging targets assembly help', `return document.querySelectorAll('#info .dyn').length===1 && document.querySelectorAll('#info details[data-transport-section]').length>=4 && !document.querySelector('#info details[open]');`);
    await check('station settings and operating metrics stay out of the overview', `return !document.querySelector('[data-act="station-name"]').checkVisibility() && !document.querySelector('[data-act="station-mode"]').checkVisibility() && !document.querySelector('#info .dyn').textContent.includes('트럭 운송량');`);
    await check('station has no charge or target controls', `return !document.querySelector('[data-transport-section="charging"], [data-transport-section="targets"], [data-target-item], [data-act="zone-budget"]')&&!document.querySelector('#info').textContent.includes('충전');`);
    await js(`document.querySelector('[data-transport-section="settings"]').open=true;const name=document.querySelector('[data-act="station-name"]');name.focus();name.value='출발지 초안';ta.inBuf.set('truck-kit',1);ui.update();`);
    await check('inventory refresh keeps the station name draft and focus', `return document.activeElement===document.querySelector('[data-act="station-name"]')&&document.activeElement.value==='출발지 초안';`);
    await js(`window.td=tw.place('station',26,4,0);game.input.selectedId=td.id;ui.update();`);
    await check('another station does not inherit the draft name', `return document.querySelector('[data-act="station-name"]').value==='';`);
    await js(`game.input.selectedId=ta.id;ui.update();`);
    await shot('station-default');
    await js('game.input.selectedId=null; game.input.selectedVehicle=tv.id; ui.update();');
    win.setSize(320, 700); await delay(120); await js('ui.update();');
    await check('320px route controls stay inside the panel', `const panel=document.getElementById('info'); const r=panel.getBoundingClientRect(); return {pass:[...panel.querySelectorAll('select,summary,button')].filter(el=>el.getClientRects().length).every(el=>{const b=el.getBoundingClientRect();return b.left>=r.left && b.right<=r.right+1;}) && panel.scrollWidth<=panel.clientWidth+1,width:panel.clientWidth,scroll:panel.scrollWidth};`);
    await check('narrow layout leaves readable vertical space for transport', `return document.getElementById('info').getBoundingClientRect().height >= 150 && document.getElementById('tabs').scrollWidth > document.getElementById('tabs').clientWidth;`);
    await shot('vehicle-narrow');
    await js(`document.querySelector('[data-transport-section="route"]').open=true;document.querySelector('[data-transport-section="plan"]').open=true; document.querySelector('[data-transport-section="metrics"]').open=true;`);
    await check('expanded transport settings also fit 320px', `const p=document.getElementById('info');return p.scrollWidth<=p.clientWidth+1;`);
    await shot('vehicle-expanded-narrow');
    await js(`document.querySelector('[data-plan-item="0"]').value='motor'; tw = (await import('/src/sim/world.ts')).World.deserialize(tw.serialize()); tv = tw.vehicles.get(tv.id); ui.update();`);
    await check('loading a different world never copies a draft to a reused truck id', `return document.querySelector('[data-plan-item="0"]').value===tv.plan[0].item;`);
    await js(`document.querySelector('[data-act="clone-truck"]').click();`);
    await check('same route button creates a truck with the displayed transport plan', `const copy=tw.vehicles.get(game.input.selectedVehicle);return copy&&copy.id!==tv.id&&JSON.stringify(copy.plan)===JSON.stringify(tv.plan)&&copy.departureWait===tv.departureWait&&copy.load===0&&document.querySelector('[data-plan-item="0"]').value===tv.plan[0].item;`);
    await js(`tw=new (await import('/src/sim/world.ts')).World(40,30);tw.rules='regional-v1';tw.createHub(0,0);
      for(const t of tw.techs)tw.applyTech(t.id);for(const item of (await import('/src/data/items.ts')).ITEM_IDS)tw.stock.set(item,10000);
      for(let x=3;x<=29;x++)tw.place('road',x,6,0);
      ta=tw.place('station',3,4,0);tb=tw.place('station',15,4,0);tc=tw.place('station',26,4,0);tw.setStationMode(tb,'unload');tw.setStationMode(tc,'unload');
      tv=tw.buildTruck(ta);tw.setStops(tv,[{id:ta.id,act:'load'},{id:tb.id,act:'unload'}]);tw.setPlan(tv,[{item:'motor',cap:20}],0,false);
      tv.cargo.set('motor',10);tv.stop=1;tv.state='to-unload';game.input.selectedVehicle=tv.id;game.input.selectedId=null;ui.update();
      const select=document.querySelector('[data-act="stop-station"][data-i="1"]');select.value=String(tc.id);select.dispatchEvent(new Event('change',{bubbles:true}));`);
    await check('editing a loaded route displays the next destination and explains deferred application',`return tv.stops[1].id===tb.id&&tv.route[1].id===tc.id&&Number(document.querySelector('[data-act="stop-station"][data-i="1"]').value)===tc.id&&document.querySelector('#info .dyn').textContent.includes('배송·반송 후 노선 변경')&&!document.querySelector('.route .stop.now');`);
    await js(`game.input.cb.getWorld=()=>tw;renderer.resize(camera);renderer.draw(tw,camera,game.input);`);
    await shot('vehicle-pending-narrow');
    win.setSize(1280,800);await delay(100);await js(`ui.update();renderer.resize(camera);renderer.draw(tw,camera,game.input);`);
    await shot('vehicle-pending-wide');
    await js(`const select=document.querySelector('[data-act="stop-station"][data-i="1"]');select.value=String(tb.id);select.dispatchEvent(new Event('change',{bubbles:true}));`);
    await check('choosing the current destination cancels a pending route in the UI',`return tv.pendingStops===null&&tv.stops[1].id===tb.id&&!document.querySelector('#info .dyn').textContent.includes('배송·반송 후 노선 변경');`);
    win.setSize(1280,800);
    await js(`tv.cargo.clear();tw.setPlan(tv,[],0,false);tw.setStops(tv,[{id:ta.id,act:'load'},{id:tb.id,act:'unload'}]);
      game.input.selectedId=null;game.input.selectedVehicle=tv.id;ui.update();
      document.querySelector('[data-transport-section="manage"]').open=true;
      let field=document.querySelector('[data-act="truck-name"]');field.focus();field.value='철판 <1> "운반"';
      field.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',isComposing:true,bubbles:true}));`);
    await check('composing a truck name does not save it early', `return tv.name==='';`);
    await js(`tw.renameStation(ta,'제철소');ui.update();`);
    await check('station updates preserve the focused truck-name draft', `const f=document.querySelector('[data-act="truck-name"]');return f===document.activeElement&&f.value==='철판 <1> "운반"';`);
    await js(`document.querySelector('[data-act="truck-name"]').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));`);
    await check('Enter saves the truck name and displays it as text', `return tv.name==='철판 <1> "운반"'&&document.querySelector('#info h3').textContent.includes(tv.name)&&!document.querySelector('#info h3 img');`);
    await check('route station choices display custom station names', `return document.querySelector('[data-act="stop-station"]').textContent.includes('제철소');`);
    await js(`ta.inBuf.set('coal',7);ui.update();`);
    await check('normal loading shows the actual source stock and amount', `const r=document.querySelector('[data-load-stock="0"]');return r.textContent.includes('석탄')&&r.textContent.includes('7개')&&r.textContent.includes('정류장 재고');`);
    await js(`ta.inBuf.set('coal',4);ui.update();`);
    await check('source quantities refresh without rebuilding the route fields', `return document.querySelector('[data-load-stock="0"]').textContent.includes('4개');`);
    await js(`window.nameStore=tw.place('storage',1,4,0);tw.setDock(ta,nameStore.id);nameStore.inBuf.set('tin-ore',9);
      tw.setPlan(tv,[{item:'tin-ore',cap:5}],120,false);ui.update();`);
    await check('planned loading includes the connected warehouse', `const r=document.querySelector('[data-load-stock="0"]');return r.textContent.includes('주석광석')&&r.textContent.includes('9개')&&r.textContent.includes('정류장·창고 재고');`);
    await js(`game.input.selectedVehicle=null;game.input.selectedId=ta.id;ui.update();document.querySelector('[data-transport-section="settings"]').open=true;const f=document.querySelector('[data-act="station-name"]');f.value='주석 출발지';f.dispatchEvent(new Event('change',{bubbles:true}));`);
    await check('station name is editable and used by its information header', `return ta.stationName==='주석 출발지'&&document.querySelector('#info h3').textContent.includes('주석 출발지');`);
    await js(`game.input.selectedId=null;game.input.selectedVehicle=tv.id;ui.update();`);
    await shot('named-truck-source-stock');
    win.setSize(400,750);await js(`ui.update();`);
    await check('names and source stocks fit in a narrow information panel', `const p=document.getElementById('info');return p.scrollWidth<=p.clientWidth+1;`);
    await js(`winUpgradeOriginal={id:tv.id,name:tv.name,stops:JSON.stringify(tv.route),cargo:JSON.stringify([...tv.cargo])};
      tv.tile=tw.stationStops(ta)[0];tv.path=[];tv.state='loading';ta.inBuf.set('truck-kit',1);ui.update();
      document.querySelector('[data-transport-section="manage"]').open=true;
      document.querySelector('[data-act="upgrade-truck"]').click();`);
    await check('truck upgrade button keeps vehicle identity cargo route and name', `return tv.kind==='advanced'&&tv.id===winUpgradeOriginal.id&&tv.name===winUpgradeOriginal.name&&JSON.stringify(tv.route)===winUpgradeOriginal.stops&&JSON.stringify([...tv.cargo])===winUpgradeOriginal.cargo&&document.querySelector('#info h3').textContent.includes('고급 트럭')&&!document.querySelector('[data-act="upgrade-truck"]');`);
    for(const [from,to,x] of [['miner','miner-2',32],['belt','fast-belt',36]]){
      await js(`window.upgradeBuilding=tw.place('${from}',${x},22,3);game.input.selectedVehicle=null;game.input.selectedId=upgradeBuilding.id;ui.update();`);
      await check(from+' upgrade control is folded initially',`return !document.querySelector('[data-transport-section="upgrade"]').open;`);
      await js(`document.querySelector('[data-transport-section="upgrade"]').open=true;document.querySelector('[data-act="upgrade-building"]').click();`);
      await check(from+' upgrade preserves selection and updates the inspector',`return upgradeBuilding.type==='${to}'&&game.input.selectedId===upgradeBuilding.id&&document.querySelector('#info h3').textContent.includes(upgradeBuilding.def.name)&&!document.querySelector('[data-act="upgrade-building"]');`);
    }
    if (errors.length) throw Error(errors.join('\n'));
    fs.writeFileSync(path.join(out,'results.json'),JSON.stringify({passed:true,results,errors},null,2));
    console.log(JSON.stringify({passed:true,checks:results.length,out}));
    await server.close(); app.exit(0);
  } catch(error) {
    fs.writeFileSync(path.join(out,'results.json'),JSON.stringify({passed:false,results,errors,error:String(error)},null,2));
    console.error(error); await server.close(); app.exit(1);
  }
});
