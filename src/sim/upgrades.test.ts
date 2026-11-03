import { describe, expect, it } from 'vitest';
import { BUILDINGS } from '../data/buildings';
import { ITEM_IDS } from '../data/items';
import { TECH_ADVANCED_TRUCK } from '../data/tech';
import { applyCommand } from './commands';
import { World } from './world';

function setup() {
  const w = new World(40, 30); w.rules = 'regional-v1'; w.createHub(0, 10);
  for (const t of w.techs) w.applyTech(t.id);
  for (const item of ITEM_IDS) w.stock.set(item, 1000);
  return w;
}
function truckSetup() {
  const w = setup();
  const st = w.place('station', 5, 4, 0)!;
  for (let x=5;x<18;x++) w.place('road',x,6,0);
  const dest = w.place('station',15,4,0)!;
  const v = w.edit(()=>w.buildTruck(st))!;
  w.setStops(v,[{id:st.id,act:'load'},{id:dest.id,act:'unload'}]);
  v.tile=w.stationStops(st)[0]; v.path=[];v.state='loading';
  v.cargo.set('iron-plate',12);v.name='운반차';v.battery=25;
  w.setPlan(v,[{item:'iron-plate',cap:20}],120,true);
  st.inBuf.set('truck-kit',2);
  return {w,st,dest,v};
}

describe('설비 제자리 업그레이드',()=>{
  for (const [from,to] of [['miner','miner-2'],['belt','fast-belt']] as const) {
    it(`${from}: id·방향·재고·진행·연결 보존, 비용 정산, 되돌리기`,()=>{
      const w=setup(),b=w.place(from,6,8,3)!;
      b.outBuf.set('iron-ore',3); b.progress=.4;b.node=w.hub!.id;
      if(from==='belt')b.items=[{item:'coal',pos:.6,n:2}];
      const stock=[...w.stock],state={id:b.id,dir:b.dir,items:structuredClone(b.items),out:[...b.outBuf],node:b.node};
      expect(applyCommand(w,0,{t:'upgrade-building',id:b.id}).ok).toBe(true);
      expect(w.buildings.get(b.id)).toBe(b);expect(b.type).toBe(to);
      expect({id:b.id,dir:b.dir,items:b.items,out:[...b.outBuf],node:b.node}).toEqual(state);
      expect(b.progress).toBe(.4);
      for(const item of ITEM_IDS)expect(w.stockOf(item)).toBe((new Map(stock).get(item)??0)+(BUILDINGS[from].cost.find(c=>c.item===item)?.count??0)-(BUILDINGS[to].cost.find(c=>c.item===item)?.count??0));
      expect(w.undo()?.skipped).toBe(0);expect(b.type).toBe(from);expect([...w.stock]).toEqual(stock);
      expect(w.redo()?.skipped).toBe(0);expect(b.type).toBe(to);
      const save=w.serialize();expect(World.deserialize(JSON.parse(JSON.stringify(save))).serialize()).toEqual(save);
    });
  }
  it('연구·재료 부족·중복 업그레이드는 상태를 바꾸지 않는다',()=>{
    const w=setup(),b=w.place('miner',6,8,0)!;
    w.unlockedBuildings.delete('miner-2');
    let before=JSON.stringify(w.serialize());
    expect(w.upgradeBuilding(b).ok).toBe(false);expect(JSON.stringify(w.serialize())).toBe(before);
    w.unlockedBuildings.add('miner-2');w.stock.set('steel',0);before=JSON.stringify(w.serialize());
    expect(w.upgradeBuilding(b).ok).toBe(false);expect(JSON.stringify(w.serialize())).toBe(before);
    w.stock.set('steel',10);expect(w.upgradeBuilding(b).ok).toBe(true);
    before=JSON.stringify(w.serialize());expect(w.upgradeBuilding(b).ok).toBe(false);expect(JSON.stringify(w.serialize())).toBe(before);
  });
  it('고급 채굴기 덧깔기와 신규 배치를 모두 지원한다',()=>{
    const w=setup(),b=w.place('miner',6,8,2)!;
    expect(applyCommand(w,0,{t:'place',tool:'miner-2',x:7,y:9,dir:0,initial:true,setting:null}).ok).toBe(true);
    expect(w.buildingAt(6,8)).toBe(b);expect(b.type).toBe('miner-2');expect(b.dir).toBe(2);
    expect(w.place('miner-2',12,8,1)).not.toBeNull();
  });
});

describe('기본 트럭 업그레이드',()=>{
  it('동일 명령과 재전송 이후 호스트·손님의 체크섬이 일치한다',()=>{
    const {w,st,v}=truckSetup();
    const miner=w.place('miner',22,12,1)!;
    const guest=World.fromSnapshot(JSON.parse(JSON.stringify(w.snapshot())));
    for(const cmd of [{t:'upgrade-building',id:miner.id},{t:'upgrade-truck',rid:'net:upgrade',id:v.id,station:st.id,key:''},{t:'upgrade-truck',rid:'net:upgrade',id:v.id,station:st.id,key:''}] as const){
      expect(applyCommand(w,2,cmd)).toEqual(applyCommand(guest,2,cmd));expect(guest.checksum()).toBe(w.checksum());
    }
  });
  it('조립품 1개로 동일 차량 개조, 노선·화물·운행 계약·실제 전력량 보존',()=>{
    const {w,st,v}=truckSetup();
    const before=structuredClone({...v});
    const cmd={t:'upgrade-truck',rid:'upgrade:1',id:v.id,station:st.id,key:''} as const;
    expect(applyCommand(w,0,cmd)).toMatchObject({ok:true,vehicle:v.id});
    expect({...v,kind:before.kind,kit:before.kit,home:before.home}).toEqual(before);
    expect(v.kind).toBe('advanced');expect(st.inBuf.get('truck-kit')).toBe(1);
    expect(w.vehicles.size).toBe(1);expect(w.vehicles.get(v.id)).toBe(v);
    expect(applyCommand(w,0,cmd).ok).toBe(true);expect(st.inBuf.get('truck-kit')).toBe(1);
    expect(w.upgradeTruck(v,st,'').ok).toBe(false);
    const copy=World.fromSnapshot(JSON.parse(JSON.stringify(w.snapshot())));
    expect(copy.checksum()).toBe(w.checksum());
    expect(copy.vehicles.get(v.id)?.kind).toBe('advanced');
  });
  it('정차·연구·현지 조립품 조건 불충족 시 원자적으로 실패한다',()=>{
    const {w,st,v}=truckSetup();
    for(const alter of [()=>{v.state='to-load';},()=>{v.state='loading';w.researched.delete(TECH_ADVANCED_TRUCK);},()=>{w.researched.add(TECH_ADVANCED_TRUCK);st.inBuf.clear();}]){
      alter();const before=JSON.stringify(w.serialize());
      expect(w.upgradeTruck(v,st,'').ok).toBe(false);expect(JSON.stringify(w.serialize())).toBe(before);
    }
  });
  it('다른 트럭이 예약한 조립품을 소비하지 않는다',()=>{
    const {w,st,v}=truckSetup();
    w.reservations.push({v:999,holder:st.id,item:'truck-kit',n:2,dir:'out'});
    expect(w.upgradeTruck(v,st,'').ok).toBe(false);expect(st.inBuf.get('truck-kit')).toBe(2);
  });
  it('붙은 창고에서 소비하고 철거 시 조립품과 화물을 한 번만 회수한다',()=>{
    const {w,st,v}=truckSetup();st.inBuf.clear();
    const storage=w.place('storage',3,4,0)!;storage.inBuf.set('truck-kit',1);
    const group=w.touchingStorageGroups(st)[0];
    expect(w.upgradeTruck(v,st,'stale').ok).toBe(false);
    expect(w.upgradeTruck(v,st,group.key).ok).toBe(true);expect(storage.inBuf.get('truck-kit')??0).toBe(0);
    // 업그레이드 전에 만든 기본 차량의 undo로 개조 비용을 복제할 수 없다.
    expect(w.undo()?.skipped).toBe(1);expect(w.vehicles.get(v.id)).toBe(v);
    w.removeVehicle(v);expect(w.piles.filter(p=>p.item==='truck-kit').reduce((n,p)=>n+p.n,0)).toBe(1);
    expect(w.piles.filter(p=>p.item==='iron-plate').reduce((n,p)=>n+p.n,0)).toBe(12);
  });
});
