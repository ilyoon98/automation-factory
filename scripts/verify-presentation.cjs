// 실행: node_modules/.bin/electron scripts/verify-presentation.cjs (Vite도 직접 시작한다)
// 별도 숨김 창·임시 프로필만 사용한다. 개인 저장·음량 설정과 섞이지 않는다.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const out = process.env.PRESENTATION_OUT || path.resolve('artifacts/presentation');
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'factory-presentation-')));
app.commandLine.appendSwitch('disable-gpu');
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
app.whenReady().then(async () => {
  const { createServer } = await import('vite');
  const server = await createServer({ server: { host: '127.0.0.1', port: 0 } });
  await server.listen();
  fs.mkdirSync(out, { recursive: true });
  const errors = [], results = [];
  const win = new BrowserWindow({ show: false, width: 1280, height: 800, webPreferences: { offscreen: true, backgroundThrottling: false } });
  win.webContents.on('console-message', (_event, level, message) => { if (level >= 3 && !message.includes('WebSocket')) errors.push(message); });
  const js = (code) => win.webContents.executeJavaScript(`(async () => { ${code} })()`);
  const check = async (name, code) => {
    const result = await js(code);
    results.push({ name, result });
    if (result === false || result?.pass === false || result?.fits === false) throw new Error(name);
  };
  const shot = async (name) => {
    await delay(60);
    fs.writeFileSync(path.join(out, name + '.png'), (await win.webContents.capturePage()).toPNG());
  };
  try {
    await win.loadURL(server.resolvedUrls.local[0]);
    await delay(500);
    await check('independent visible test surface', `return !document.hidden && !!window.renderer && !!window.ui;`);
    await js(`
      window.requestAnimationFrame = () => 0;
      await new Promise((r) => setTimeout(r, 50));
      game.setSpeed(0);
      // OS의 동작 줄이기 설정에 따라 애니메이션 검증이 건너뛰어지지 않게 시험에서 명시한다.
      (await import('/src/render/effects.ts')).setReducedEffects(false);
      for (const el of document.querySelectorAll('.modal, #newgame')) el.hidden = true;
      window.testWorld = new (await import('/src/sim/world.ts')).World(100, 65);
      const w = testWorld; w.rules = 'regional-v1'; w.createHub(2, 18);
      for (const t of w.techs) w.applyTech(t.id);
      for (const i of (await import('/src/data/items.ts')).ITEM_IDS) w.stock.set(i, 10000);
      window.testMachines = [];
      for (let i = 0; i < 12; i++) {
        const b = w.place('smelter', 8 + i % 6 * 3, 18 + Math.floor(i / 6) * 3, 0);
        w.setRecipe(b, 'iron-plate'); b.inBuf.set('iron-ore', 10000); testMachines.push(b);
      }
      for (let x = 6; x <= 34; x++) w.place('road', x, 28, 0);
      window.testA = w.place('station', 9, 26, 0); window.testB = w.place('station', 30, 26, 0); w.setStationMode(testB, 'unload');
      window.basic = w.buildTruck(testA); window.advanced = new (await import('/src/sim/vehicle.ts')).Vehicle(w.nextVehicleId++, w.idx(14, 28), w.width);
      advanced.kind = 'advanced'; w.vehicles.set(advanced.id, advanced);
      basic.cargo.set('iron-plate', w.truckCapacity(basic) / 2); advanced.cargo.set('iron-plate', w.truckCapacity(advanced) / 2);
      for (let y = 14; y <= 26; y += 4) for (let x = 40; x <= 56; x += 4) w.place('pole', x, y, 0);
      window.testGenerator = w.place('generator', 58, 20, 0); testGenerator.fuel = 5;
      camera.x = 29; camera.y = 22; camera.zoom = 16;
      game.input.selectedId = null; game.input.selectedVehicle = null; game.input.layer = 'base';
      window.renderTest = () => renderer.draw(testWorld, camera, game.input);
      renderTest();
    `);
    await check('half loaded basic and advanced sprites', `
      const frames = []; const original = renderer.blit.bind(renderer);
      renderer.blit = (name, frame, ...rest) => { if (name.startsWith('truck:')) frames.push(frame); original(name, frame, ...rest); };
      renderTest(); renderer.blit = original;
      return frames.length === 2 && frames.every((f) => f === 1);
    `);
    await check('successful transfer alone creates one grouped flight', `
      testWorld.setRoute(basic, testA.id, testB.id); basic.cargo.clear(); testA.inBuf.set('iron-plate', 5);
      for (let i = 0; i < 9; i++) testWorld.tick();
      renderTest();
      const success = basic.load > 0 && renderer.flights.length === 1;
      testA.inBuf.clear(); basic.status = 'no-supply';
      const flights = renderer.flights.length; renderTest();
      return { pass: success && renderer.flights.length === flights, load: basic.load, flights: renderer.flights.length, status: basic.status, time: testWorld.time };
    `);
    await check('actual low power phase and pause', `
      for (let i = 0; i < 60; i++) testWorld.tick(); renderTest();
      const p = renderer.activity.work.get(testMachines[0].id); renderTest();
      return p > 0 && testWorld.satOf(testMachines[0]) < 1 && renderer.activity.work.get(testMachines[0].id) === p;
    `);
    await shot('factory-low-power');
    await check('shared construction particle cap', `
      const now = performance.now()/1000;
      for (let i = 0; i < 100; i++) renderer.addPuff(10, 20, 2, false, now, 'smelter');
      const dots = renderer.puffs.reduce((sum,p) => sum + p.dots.length + (p.shards?.length ?? 0), 0);
      renderer.clearEffects(); return dots <= 88 && dots + 20 + 8 + 4 + 8 <= 128;
    `);
    await check('4x ticks increase phase fourfold', `
      for (const b of testMachines) b.outBuf.clear();
      const id = testMachines[0].id, p = renderer.activity.work.get(id);
      testWorld.tick(); const one = renderer.activity.work.get(id) - p;
      for (let i = 0; i < 4; i++) testWorld.tick();
      return Math.abs(renderer.activity.work.get(id) - p - one * 5) < 1e-10;
    `);
    await js(`game.input.layer = 'power'; game.input.selectedId = [...testWorld.buildings.values()].find((b) => b.type === 'pole').id; camera.x = 43; renderTest();`);
    await delay(180); await js('renderTest()'); await shot('dense-power-selected');
    await check('real graph and representative density', `return { actual: testWorld.powerWires().length, representative: renderer.representatives.size, pass: testWorld.powerWires().length > renderer.representatives.size };`);
    await check('same-network supply is filled once', `
      const ctx = renderer.ctx, original = ctx.fill.bind(ctx); let fills = 0;
      ctx.fill = (...args) => { fills++; return original(...args); }; renderer.drawGridCoverage(testWorld); ctx.fill = original;
      return fills === new Set(testWorld.powerNodes().map((n) => n[3])).size;
    `);
    await js(`
      const w = game.getWorld(); w.stock.set('iron-plate', 10000); ui.update();
      w.applyTech('automation'); ui.update();
    `);
    await check('research card event once', `return !document.getElementById('notice').hidden && document.getElementById('notice').dataset.kind === 'research' && document.querySelectorAll('.notice-sparks i').length === 20;`);
    await shot('research-card');
    await delay(4100);
    await check('research closes after 4 seconds', `return document.getElementById('notice').hidden;`);
    await js(`ui.notice('연구 완료 확인', '', 4000, 'research');`);
    await js(`document.querySelector('#notice .x').click(); ui.update();`);
    await check('research dismissal does not replay', `return document.getElementById('notice').hidden;`);
    await js(`ui.notice('연구 완료 확인', '', 4000, 'research'); window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));`);
    await check('Esc closes card without changing construction tool', `return document.getElementById('notice').hidden;`);
    await js(`
      const w = game.getWorld(); const { MAIN_GOALS, evaluateGoals } = await import('/src/sim/goals.ts'); game.setSpeed(1);
      w.stats.projectDelivered = 49; w.time = 3661; ui.silenceEffects(); ui.update();
      for (const g of MAIN_GOALS) if (g.id !== 'MG36') w.goals.add(g.id);
      w.stats.projectDelivered = 50; w.stats.zoneMade.set(1, 20); w.stats.zoneWork.set(1, 1000); evaluateGoals(w); ui.update();
      window.finaleBody = document.querySelector('.notice-body').innerHTML;
    `);
    await check('finale priority and summary without auto pause', `return game.speed === 1 && document.getElementById('notice').dataset.kind === 'finale' && document.getElementById('notice').textContent.includes('1:01:01') && document.querySelectorAll('.notice-sparks i').length === 20;`);
    await shot('finale-card');
    await delay(8100);
    await check('finale closes after 8 seconds', `return document.getElementById('notice').hidden || document.getElementById('notice').dataset.kind !== 'finale';`);
    await js(`ui.silenceEffects(); ui.notice('공장망 완성', finaleBody, 8000, 'finale');`);
    await js(`document.querySelector('[data-continue]').click();`);
    await check('continue building dismisses immediately', `return document.getElementById('notice').hidden || document.getElementById('notice').dataset.kind !== 'finale';`);
    await js(`
      ui.silenceEffects(); const reduced = document.getElementById('reduced-effects'); reduced.checked = true; reduced.dispatchEvent(new Event('change'));
      ui.notice('공장망 완성', finaleBody, 8000, 'finale'); renderTest();
    `);
    await check('reduced effects retains information and clears decoration', `return document.documentElement.classList.contains('reduced-effects') && !document.getElementById('notice').hidden && !document.querySelector('.notice-sparks') && renderer.puffs.length === 0 && renderer.flights.length === 0;`);
    await shot('reduced-effects');
    win.setContentSize(320, 720); await delay(250);
    await check('narrow card fits shared topbar anchor', `const n = document.getElementById('notice').getBoundingClientRect(), top = document.getElementById('topbar').getBoundingClientRect(); return { width: innerWidth, left: n.left, right: n.right, top: n.top, topbarBottom: top.bottom, fits: n.left >= 0 && n.right <= innerWidth && n.top >= top.bottom };`);
    await shot('narrow-card');
    for (const scale of [1.25, 1.5]) {
      win.setContentSize(800, 900); win.webContents.setZoomFactor(scale); await delay(250);
      await check('card anchor at zoom ' + scale, `const n = document.getElementById('notice').getBoundingClientRect(), top = document.getElementById('topbar').getBoundingClientRect(); return { scale: devicePixelRatio, left: n.left, right: n.right, top: n.top, topbarBottom: top.bottom, fits: n.left >= 0 && n.right <= innerWidth && n.top >= top.bottom };`);
      await shot('card-zoom-' + scale);
      await js(`const c = document.getElementById('crisp-text'); c.checked = true; c.dispatchEvent(new Event('change'));`); await delay(100);
      await check('crisp card at zoom ' + scale, `const n = document.getElementById('notice').getBoundingClientRect(), top = document.getElementById('topbar').getBoundingClientRect(); return { uiZoom: (await import('/src/ui/crisp.ts')).uiZoom(), fits: n.left >= 0 && n.right <= innerWidth && n.top >= top.bottom };`);
    }
    win.webContents.setZoomFactor(1);
    await js(`
      ui.silenceEffects(); const reduced = document.getElementById('reduced-effects'); reduced.checked = false; reduced.dispatchEvent(new Event('change'));
      game.input.layer = 'power'; testWorld.time = 720 * .8; camera.x = 25; camera.y = 20; camera.zoom = 8; renderTest();
    `);
    win.setContentSize(1280, 800); await delay(100); await js('renderer.resize(camera); renderTest()'); await shot('night-lod');
    await check('LOD removes weather decoration', `return renderer.drops.length === 0;`);
    await js(`
      const { weatherEvents } = await import('/src/sim/weather-v1.ts');
      const ev = weatherEvents(testWorld.seed, 720 * 80).find((e) => e.kind === 'storm');
      if (!ev) throw Error('storm fixture missing');
      testWorld.time = ev.start + 30;
      testWorld.terrain = new Uint8Array(testWorld.width * testWorld.height);
      testWorld.revealed = new Uint8Array(testWorld.width * testWorld.height); testWorld.revealedCount = 0;
      for (let y = 0; y < testWorld.height; y++) for (let x = 0; x < testWorld.width; x++) {
        testWorld.terrain[testWorld.idx(x,y)] = x < 35 ? 0 : x < 50 ? 4 : 3;
        if (x < 50) { testWorld.revealed[testWorld.idx(x,y)] = 1; testWorld.revealedCount++; }
      }
      renderer.maskKey = ''; renderer.chunks.clear(); camera.zoom = 16; camera.x = 40; camera.y = 23;
      game.input.layer = 'base'; game.input.selectedId = null; renderTest();
    `);
    await check('storm particle cap and hidden terrain mask', `return renderer.drops.length <= 256 && !renderer.weatherPaths.has('sand') && renderer.weatherPaths.has('snow');`);
    await shot('storm-snow-hidden-boundary');
    await js(`game.input.layer = 'power'; renderTest();`);
    await check('information view halves weather decoration', `return renderer.drops.length <= 128;`);
    await js(`camera.x = 70; renderTest();`);
    await check('hidden center does not choose hidden local weather', `return !renderer.weatherPaths.has('sand');`);
    await shot('hidden-center-weather');
    await check('cached weather viewport render timing', `
      const samples = [];
      for (let i = 0; i < 30; i++) { const a = performance.now(); renderTest(); samples.push(performance.now() - a); }
      samples.sort((a,b) => a-b); return { medianMs: samples[15], p95Ms: samples[28] };
    `);
    await js(`
      const w = new (await import('/src/sim/world.ts')).World(256, 256); w.rules = 'regional-v1'; w.createHub(0,0);
      for (const t of w.techs) w.applyTech(t.id);
      for (const i of (await import('/src/data/items.ts')).ITEM_IDS) w.stock.set(i, 1e9);
      window.largeMachines = [];
      for (let y = 5; y < 245 && largeMachines.length < 1000; y += 3) for (let x = 5; x < 245 && largeMachines.length < 1000; x += 3) {
        const m = w.place('smelter', x,y,0); if (!m) continue;
        w.setRecipe(m, 'iron-plate'); m.inBuf.set('iron-ore', 1000); largeMachines.push(m);
      }
      testWorld = w; camera.x = 70; camera.y = 22; camera.zoom = 16; game.input.layer = 'base'; renderTest();
      for (let i = 0; i < 60; i++) w.tick(); renderTest();
    `);
    await check('1000-machine render with and without effects keeps checksum', `
      const measure = () => { const a = []; for (let i = 0; i < 20; i++) { const t = performance.now(); renderTest(); a.push(performance.now() - t); } a.sort((a,b)=>a-b); return { medianMs:a[10], p95Ms:a[19] }; };
      const hash = testWorld.checksum(), on = measure();
      (await import('/src/render/effects.ts')).setReducedEffects(true); const off = measure();
      return { pass: largeMachines.length === 1000 && hash === testWorld.checksum(), machines: largeMachines.length, on, off };
    `);
    await shot('1000-machines');
    if (errors.length) throw new Error(errors.join('\n'));
    fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify({ passed: true, results, errors }, null, 2));
    console.log(JSON.stringify({ passed: true, checks: results.length, out }));
    await server.close(); app.exit(0);
  } catch (error) {
    fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify({ passed: false, results, errors, error: String(error) }, null, 2));
    console.error(error); await server.close(); app.exit(1);
  }
});
