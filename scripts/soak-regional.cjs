// 대형 공장을 두 세계에서 장시간 진행하며 중간 참가·해시·저장 상태를 비교한다.
const {app,BrowserWindow}=require('electron');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
app.setPath('userData',fs.mkdtempSync(path.join(os.tmpdir(),'factory-soak-')));
app.commandLine.appendSwitch('disable-gpu');
const seconds=Number(process.env.SOAK_SECONDS||1800);
app.whenReady().then(async()=>{
  const {createServer}=await import('vite');const server=await createServer({server:{host:'127.0.0.1',port:0}});
  const win=new BrowserWindow({show:false,webPreferences:{offscreen:true,backgroundThrottling:false}});
  const js=code=>win.webContents.executeJavaScript(`(async()=>{${code}})()`);
  const started=Date.now();
  try{
    if(!Number.isSafeInteger(seconds)||seconds<1)throw Error('SOAK_SECONDS must be a positive integer');
    await server.listen();await win.loadURL(server.resolvedUrls.local[0]);
    const fixture=await js(`window.requestAnimationFrame=()=>0;game.setSpeed(0);
      const {generateRegionalWorld}=await import('/src/sim/regional-map.ts');window.World=(await import('/src/sim/world.ts')).World;
      window.hostWorld=generateRegionalWorld(2026);const w=hostWorld;w.revealSites(['*']);
      for(const t of w.techs)w.applyTech(t.id);for(const i of (await import('/src/data/items.ts')).ITEM_IDS)w.stock.set(i,1e9);
      window.machineIds=[];window.generatorIds=[];
      for(let y=4;y<250&&machineIds.length<1000;y+=3)for(let x=4;x<250&&machineIds.length<1000;x+=3){
        if((x+y)%30===2){const g=w.place('generator',x,y,0);if(g){g.fuel=5;generatorIds.push(g.id);}continue;}
        const m=w.place('smelter',x,y,0);if(m){w.setRecipe(m,'iron-plate');m.inBuf.set('iron-ore',1e6);machineIds.push(m.id);}
      }
      let trucks=0;for(let k=0;k<40&&trucks<64;k++){const y=5+k*6;
        for(let x=2;x<254;x++)if(w.canPlace('road',x,y).ok)w.place('road',x,y,0);
        const a=w.place('station',20,y-2,0),b=w.place('station',220,y-2,0);if(!a||!b)continue;
        w.setStationMode(b,'unload');a.inBuf.set('stone',200);for(let n=0;n<2;n++)if(w.buildTruck(a))trucks++;
      }
      const {weatherEvents}=await import('/src/sim/weather-v1.ts');const storm=weatherEvents(w.seed,720*80).find(e=>e.kind==='storm');
      w.time=storm.start+10;window.checkpoint=JSON.parse(JSON.stringify(w.snapshot()));window.guestWorld=World.fromSnapshot(checkpoint);
      return {machines:machineIds.length,trucks,buildings:w.buildings.size,weatherStart:w.time};`);
    if(fixture.machines!==1000||fixture.trucks!==64)throw Error('incomplete load fixture');
    console.log(JSON.stringify({fixture,simulationSeconds:seconds}));
    const ticks=seconds*60,chunk=600;
    for(let done=0;done<ticks;done+=chunk){
      const n=Math.min(chunk,ticks-done);
      await js(`for(let i=0;i<${n};i++){
        for(const w of [hostWorld,guestWorld]){for(const id of machineIds)w.buildings.get(id).outBuf.clear();
          if(i%60===0)for(const id of generatorIds)w.buildings.get(id).fuel=5;w.tick();}
      }
      if(hostWorld.checksum()!==guestWorld.checksum())throw Error('lockstep mismatch at '+hostWorld.tickCount);
      for(const w of [hostWorld,guestWorld])for(const v of w.vehicles.values())if(!Number.isFinite(v.battery)||!Number.isFinite(v.load)||v.load<0)throw Error('invalid vehicle');`);
      if((done+n)%3600===0){
        await js(`checkpoint=JSON.parse(JSON.stringify(hostWorld.snapshot()));guestWorld=World.fromSnapshot(checkpoint);if(guestWorld.checksum()!==hostWorld.checksum())throw Error('snapshot mismatch');`);
        console.log(`PASS ${Math.round((done+n)/60)} simulated seconds · ${Math.round((Date.now()-started)/1000)}s elapsed`);
      }
    }
    const result=await js(`const save=hostWorld.serialize(),copy=World.deserialize(JSON.parse(JSON.stringify(save)));
      if(JSON.stringify(copy.serialize())!==JSON.stringify(save))throw Error('save roundtrip mismatch');
      return {ticks:hostWorld.tickCount,hash:hostWorld.checksum(),vehicles:hostWorld.vehicles.size,buildings:hostWorld.buildings.size};`);
    const out=path.resolve('artifacts/playtest-simulation');fs.mkdirSync(out,{recursive:true});
    fs.writeFileSync(path.join(out,'soak-regional.json'),JSON.stringify({passed:true,fixture,result,seconds,elapsedMs:Date.now()-started},null,2));
    console.log(JSON.stringify({passed:true,result,elapsedSeconds:(Date.now()-started)/1000}));await server.close();app.exit(0);
  }catch(error){console.error(error);
    try{const data=await js(`return {checkpoint,host:hostWorld.serialize(),guest:guestWorld.serialize()};`);
      const out=path.resolve('artifacts/playtest-simulation');fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'soak-failure.json'),JSON.stringify(data));
    }catch{}
    await server.close();app.exit(1);}
}).catch(error=>{console.error(error);app.exit(1);});
