// UI 조작 없이 게임의 명령·틱으로 진행한다. 새 지도와 준비된 운송 공장을 구분해 기록한다.
import { createServer } from 'vite';
import fs from 'node:fs';
import path from 'node:path';
const server = await createServer({ server: { middlewareMode: true, hmr: false } });
const out = path.resolve('artifacts/playtest-simulation');
fs.mkdirSync(out, { recursive: true });
try {
  const { World, TICK_RATE } = await server.ssrLoadModule('/src/sim/world.ts');
  const { generateRegionalWorld } = await server.ssrLoadModule('/src/sim/regional-map.ts');
  const { applyCommand } = await server.ssrLoadModule('/src/sim/commands.ts');
  const { DX, DY } = await server.ssrLoadModule('/src/sim/dir.ts');
  const { ITEM_IDS } = await server.ssrLoadModule('/src/data/items.ts');
  const { STATION_CAPACITY } = await server.ssrLoadModule('/src/data/buildings.ts');
  const { currentStage } = await server.ssrLoadModule('/src/sim/goals.ts');
  const { createRng } = await server.ssrLoadModule('/src/sim/rng.ts');
  const { reachableStations } = await server.ssrLoadModule('/src/ui/transport.ts');
  const command = (w, c) => applyCommand(w, 0, c);
  function build(w, tool, x, y, dir, setting = null) {
    const result = command(w, { t: 'place', tool, x, y, dir, initial: true, setting });
    if (!result.ok) throw Error(`${tool} (${x},${y}): ${result.reason}`);
    return result.building;
  }
  function wait(w, predicate, max = 600) {
    const start = w.time;
    for (let n = 0; n < max * TICK_RATE; n++) {
      if (predicate()) return Math.round((w.time - start) * 10) / 10;
      w.tick();
    }
    throw Error(`진행 정지 ${max}s: ${JSON.stringify([...w.buildings.values()].map(b=>({type:b.type,status:b.status,in:[...b.inBuf],out:[...b.outBuf]})))}`);
  }
  function edges(b, front = true) {
    const cells = [];
    for (let d = 0; d < 4; d++) {
      if (front !== null && (d === b.dir) !== front) continue;
      for (let i = 0; i < b.size; i++) cells.push([
        d === 1 ? b.x + b.size : d === 3 ? b.x - 1 : b.x + i,
        d === 0 ? b.y - 1 : d === 2 ? b.y + b.size : b.y + i,
      ]);
    }
    return cells;
  }
  function pathTo(w, starts, targets, forbidden = new Set()) {
    const goal = new Set(targets.map(([x,y])=>w.idx(x,y)));
    const prev = new Map(), queue = [];
    for (const [x,y] of starts) if (w.canPlace('belt',x,y).ok && !forbidden.has(w.idx(x,y))) {
      const tile=w.idx(x,y); queue.push(tile); prev.set(tile,-1);
    }
    for (let q=0;q<queue.length;q++) {
      const tile=queue[q], x=tile%w.width, y=Math.floor(tile/w.width);
      if (goal.has(tile)) {
        const cells=[];
        for(let k=tile;k!==-1;k=prev.get(k)) cells.push([k%w.width,Math.floor(k/w.width)]);
        return cells.reverse();
      }
      for(let d=0;d<4;d++) {
        const nx=x+DX[d],ny=y+DY[d],next=w.idx(nx,ny);
        if(!w.inBounds(nx,ny)||prev.has(next)||forbidden.has(next)||!w.canPlace('belt',nx,ny).ok) continue;
        prev.set(next,tile);queue.push(next);
      }
    }
    return null;
  }
  function lay(w, cells, target) {
    if(!cells) throw Error('컨베이어 경로 없음');
    return cells.map(([x,y],i)=>{
      const next=cells[i+1];
      const dir=next ? DX.findIndex((dx,d)=>dx===next[0]-x && DY[d]===next[1]-y) :
        [0,1,2,3].find(d=>x+DX[d]>=target.x&&x+DX[d]<target.x+target.size&&y+DY[d]>=target.y&&y+DY[d]<target.y+target.size);
      if(dir===undefined||dir<0)throw Error('컨베이어 출구 방향 없음');
      return build(w,'belt',x,y,dir);
    });
  }
  function freshStart(seed, directSmelting = false) {
    const w=generateRegionalWorld(seed), hub=w.hub;
    const spots=[];
    for(let y=hub.y-15;y<hub.y+17;y++)for(let x=hub.x-15;x<hub.x+17;x++) {
      if(!w.canPlace('miner',x,y).ok)continue;
      const tiles=[w.idx(x,y),w.idx(x+1,y),w.idx(x,y+1),w.idx(x+1,y+1)];
      if(tiles.every(i=>w.resItem[i]==='iron-ore'))spots.push([x,y]);
    }
    spots.sort((a,b)=>Math.abs(a[0]-hub.x)+Math.abs(a[1]-hub.y)-Math.abs(b[0]-hub.x)-Math.abs(b[1]-hub.y));
    if(!spots.length)throw Error('시작 철광맥에 2×2 채굴기 위치 없음');
    const [mx,my]=spots[0];
    const dir=Math.abs(hub.x-mx)>Math.abs(hub.y-my)?hub.x>mx?1:3:hub.y>my?2:0;
    const miner=build(w,'miner',mx,my,dir);
    const milestones={};
    if(!directSmelting) {
      const rawBelts=lay(w,pathTo(w,edges(miner),edges(hub,null)),hub);
      wait(w,()=>w.goals.has('MG01'));milestones.rawOre=Math.round(w.time);
      for(const b of rawBelts)command(w,{t:'remove',id:b.id});
    }
    const chains=[
      {x:hub.x+5,y:hub.y,dir:3,ax:hub.x+3,ay:hub.y},
      {x:hub.x-4,y:hub.y,dir:1,ax:hub.x-2,ay:hub.y},
      {x:hub.x,y:hub.y-4,dir:2,ax:hub.x,ay:hub.y-2},
      {x:hub.x,y:hub.y+5,dir:0,ax:hub.x,ay:hub.y+3},
    ].filter(c=>w.canPlace('smelter',c.x,c.y).ok && [0,1].every(dx=>[0,1].every(dy=>w.canPlace('belt',c.ax+dx,c.ay+dy).ok)));
    chains.sort((a,b)=>Math.abs(a.x-mx)+Math.abs(a.y-my)-Math.abs(b.x-mx)-Math.abs(b.y-my));
    let chosen;
    for(const c of chains) {
      const reserve=new Set([w.idx(c.ax,c.ay),w.idx(c.ax+1,c.ay),w.idx(c.ax,c.ay+1),w.idx(c.ax+1,c.ay+1)]);
      for(let dx=0;dx<2;dx++)for(let dy=0;dy<2;dy++)reserve.add(w.idx(c.x+dx,c.y+dy));
      const p=pathTo(w,edges(miner),edges({...c,size:2},false),reserve);
      if(p){chosen={...c,p,reserve};break;}
    }
    if(!chosen)throw Error('허브 옆 제련/조립 셀 위치 없음');
    const furnace=build(w,'smelter',chosen.x,chosen.y,chosen.dir);
    lay(w,chosen.p,furnace);
    const gap=lay(w,pathTo(w,edges(furnace),edges(hub,null)),hub);
    wait(w,()=> (w.stats.hubIn.get('iron-plate')??0)>=120);
    milestones.iron120=Math.round(w.time);
    if(directSmelting && !w.goals.has('MG01'))throw Error('철판을 허브에 보내도 MG01이 완료되지 않음');
    if(directSmelting) return {seed,mode:'direct-smelting-no-grants',produced:w.stats.made.get('iron-plate'),hubPlates:w.stats.hubIn.get('iron-plate'),
      rawOreInHub:w.stats.hubIn.get('iron-ore')??0,firstGoalDone:w.goals.has('MG01'),
      finding:'채굴기→제련로→허브로 바로 자동화해도 MG01을 완료한다. 원광의 별도 허브 반입은 필요하지 않다.'};
    if(!command(w,{t:'research',id:'automation'}))throw Error('조립 자동화 연구비 부족');
    for(const b of gap)command(w,{t:'remove',id:b.id});
    const assembler=build(w,'assembler',chosen.ax,chosen.ay,chosen.dir,'gear');
    if(!w.unlockedRecipes.has('gear')||assembler.recipe!=='gear')throw Error('기어 설정 실패');
    wait(w,()=>w.goals.has('MG03'));
    milestones.gear20=Math.round(w.time);
    if(!command(w,{t:'research',id:'wind'}))throw Error('풍력 발전 연구비 부족');
    let wind;
    for(let y=hub.y-8;y<hub.y+10&&!wind;y++)for(let x=hub.x-8;x<hub.x+10&&!wind;x++) {
      if(w.canPlace('wind',x,y).ok)wind=build(w,'wind',x,y,0);
    }
    if(!wind)throw Error('초기 재료로 풍력 건설 불가');
    wait(w,()=>w.goals.has('MG04') && currentStage(w)>=1);
    milestones.firstExpansion=Math.round(w.time);
    return {seed,mode:'fresh-start-no-grants',milestones,goals:[...w.goals],regionStage:currentStage(w),stock:[...w.stock],buildings:w.buildings.size,piles:w.piles.length,
      warning:'배치 판단과 입력에 걸리는 사람 시간은 포함하지 않은 시뮬레이션 시간'};
  }
  const fresh=[], seeds=[], symmetries=new Set();
  // 회전·반전 8종에서 하나씩 고른다. 지도 생성과 같은 첫 추첨으로 분류한다.
  for(let seed=1;symmetries.size<8 && seed<1000000;seed+=1009) {
    const symmetry=Math.floor(createRng((seed ^ 0x2f6a1c3d) >>> 0)()*8);
    if(!symmetries.has(symmetry)){symmetries.add(symmetry);seeds.push(seed);}
  }
  for(const seed of seeds) {
    try {fresh.push({passed:true,...freshStart(seed)});}catch(error){fresh.push({seed,passed:false,error:String(error)});}
  }
  function freightFixture() {
    const w=new World(80,40);w.rules='regional-v1';w.createHub(1,10);
    for(const t of w.techs)w.applyTech(t.id);
    for(const item of ITEM_IDS)w.stock.set(item,10000);
    for(let x=6;x<=48;x++)build(w,'road',x,16,1);
    const a=build(w,'station',8,14,2),b=build(w,'station',44,14,2);
    command(w,{t:'config',id:b.id,key:'mode',value:'unload'});
    const truck=command(w,{t:'build-truck',station:a.id});
    if(!truck)throw Error('트럭 생성 실패');
    // 준비된 창고의 실제 화물 60개. 이후 재고/전력/화물/배터리 무료 보충 없음.
    a.inBuf.set('iron-plate',60);
    return {w,a,b,truck};
  }
  const freight=[];
  for(const scenario of ['basic','break-repair','destination-full','planned-short-load','station-stop-role-difference','water-filter']) {
    const {w,a,b,truck}=freightFixture();
    try {
      const observations=[];
      if(scenario==='destination-full') b.outBuf.set('copper-plate',STATION_CAPACITY);
      if(scenario==='station-stop-role-difference') command(w,{t:'config',id:b.id,key:'mode',value:'load'});
      if(scenario==='water-filter') {
        a.inBuf.clear();a.inBuf.set('water',12);a.inBuf.set('iron-ore',5);
        command(w,{t:'route',id:truck.id,stops:[{id:a.id,act:'load',item:'water'},{id:b.id,act:'unload'}]});
      }
      if(scenario==='planned-short-load') {
        a.inBuf.clear();a.inBuf.set('iron-plate',7);a.inBuf.set('copper-plate',5);
        command(w,{t:'truck-plan',id:truck.id,plan:[{item:'iron-plate',cap:20},{item:'copper-plate',cap:20}],period:60,early:true});
      }
      if(scenario==='break-repair') {
        const road=w.buildingAt(24,16);command(w,{t:'remove',id:road.id});
        for(let n=0;n<90*TICK_RATE;n++)w.tick();
        observations.push({phase:'broken',status:truck.status,delivered:w.stats.delivered,choices:reachableStations(w,truck.tile).map(s=>s.stationNo)});
        if(w.stats.delivered!==0)throw Error('끊긴 도로에서 배송됨');
        build(w,'road',24,16,1);
      }
      if(scenario==='destination-full') {
        for(let n=0;n<180*TICK_RATE;n++)w.tick();
        observations.push({phase:'blocked',status:truck.status,delivered:w.stats.delivered,cargo:[...truck.cargo]});
        if(w.stats.delivered!==0)throw Error('가득 찬 도착지에 화물 초과 적재');
        // 사용자가 목적지 화물을 실제로 빼서 다른 곳으로 옮긴 경우를 준비한다.
        b.outBuf.clear();
      }
      wait(w,()=>w.stats.delivered>=(['planned-short-load','water-filter'].includes(scenario)?12:50),360);
      if(scenario==='water-filter' && ((b.outBuf.get('water')??0)!==12 || (a.inBuf.get('iron-ore')??0)!==5))throw Error('물 지정 운송이 다른 화물을 섞음');
      freight.push({passed:true,scenario,mode:'prepared-freight-fixture',elapsed:Math.round(w.time),delivered:w.stats.delivered,
        receiver:[...b.outBuf],receiverMode:b.stationMode,battery:Math.round(truck.battery),status:truck.status,observations,
        ...(scenario==='station-stop-role-difference'?{usabilityFinding:'노선의 내리기와 정류장의 싣기 종류가 달라도 설정/배송은 가능하다. 두 설정의 역할을 사용자가 구분해야 한다.'}:{})});
    }catch(error){freight.push({passed:false,scenario,error:String(error)});}
  }
  const directSmelting=freshStart(1,true);
  const result={method:'직접 컴퓨터/브라우저 조작 없음. 새 지도는 기본 시작 재료만, 운송은 준비된 별도 공장.',fresh,freight,directSmelting};
  fs.writeFileSync(path.join(out,'results.json'),JSON.stringify(result,null,2));
  console.log(JSON.stringify({fresh:fresh.map(r=>({seed:r.seed,passed:r.passed,milestones:r.milestones,error:r.error})),freight,directSmelting},null,2));
  if([...fresh,...freight].some(r=>!r.passed))process.exitCode=1;
} finally { await server.close(); }
