/** 설치된 Electron의 독립된 비표시 창에서 배포 산출물을 검증한다. 사용자 저장·열린 창을 건드리지 않는다. */
const { writeFile } = require('node:fs/promises');
const { mkdirSync } = require('node:fs');
const { pathToFileURL } = require('node:url');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
if (!process.versions.electron) {
  const { spawn } = require('node:child_process');
  const electron = require('electron');
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(electron, [__filename], { cwd: root, env, windowsHide: true, stdio: 'inherit' });
  const timer = setTimeout(() => { child.kill(); console.error('UI smoke test timed out'); }, 45000);
  child.on('exit', (code) => { clearTimeout(timer); process.exitCode = code ?? 1; });
} else {
  const { app, BrowserWindow, protocol, net } = require('electron');
  const output = process.env.UI_REVIEW_OUTPUT ?? path.join(root, 'node_modules/.cache/ui-review');
  mkdirSync(output, { recursive: true });
  app.setPath('userData', path.join(output, `profile-${process.pid}`));
  protocol.registerSchemesAsPrivileged([{ scheme: 'review', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
  (async () => {
  await app.whenReady();
  protocol.handle('review', (request) => {
    const pathname = decodeURIComponent(new URL(request.url).pathname);
    const asset = path.resolve(root, 'dist', `.${pathname === '/' ? '/index.html' : pathname}`);
    if (!asset.startsWith(path.join(root, 'dist') + path.sep)) return new Response('Not found', { status: 404 });
    return net.fetch(pathToFileURL(asset).href);
  });
  const win = new BrowserWindow({ width: 1440, height: 900, show: false, webPreferences: { offscreen: true, backgroundThrottling: false, contextIsolation: true } });
  const failures = [];
  win.webContents.on('console-message', (event) => { if (event.level === 'error' && !event.message.includes('WebSocket')) failures.push(event.message); });
  const run = (fn) => win.webContents.executeJavaScript(`(${fn.toString()})()`);
  const check = async (fn, label) => { if (!await run(fn)) throw new Error(label); console.log(`PASS ${label}`); };
  const screenshot = async (name) => { await new Promise((resolve) => setTimeout(resolve, 200)); await writeFile(path.join(output, `${name}.png`), (await win.webContents.capturePage()).toPNG()); };
  try {
    await win.loadURL("review://localhost/");
    await check(() => !!document.querySelector("#guide").textContent.trim(), "game renders");
    for (const id of ["goals", "ach", "research", "stats", "codex"]) {
      await run(() => document.querySelectorAll(".modal").forEach(el => el.hidden = true));
      await win.webContents.executeJavaScript(`document.getElementById(${JSON.stringify("btn-" + id)}).click()`);
      await check(() => !!document.querySelector(".modal:not([hidden]) .panel"), id + " renders");
    }
    await run(() => { document.querySelectorAll(".modal").forEach(el => el.hidden = true); document.getElementById("btn-goals").click(); window.__testPalette = document.getElementById("palette").innerHTML; });
    await run(() => window.dispatchEvent(new KeyboardEvent("keydown", {key: "x", bubbles:true})));
    await check(() => document.getElementById("palette").innerHTML === window.__testPalette, "modal blocks toolbar shortcuts");
    await run(() => { const buttons=[...document.querySelectorAll("#goals button")].filter(el=>!el.disabled && el.getClientRects().length); buttons.at(-1).focus(); buttons.at(-1).dispatchEvent(new KeyboardEvent("keydown", {key: "Tab", bubbles:true,cancelable:true})); });
    await check(() => document.activeElement === [...document.querySelectorAll("#goals button")].find(el=>!el.disabled && el.getClientRects().length), "Tab wraps within dialog");
    await screenshot("goals-060");
    if (failures.length) throw new Error(failures.join("\n"));
    app.exit(0);
  } catch (error) { console.error(error); app.exit(1); }
  })().catch((error) => { console.error(error); app.exit(1); });
}
