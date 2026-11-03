import { describe, expect, it } from 'vitest';
import { ITEM_IDS } from '../data/items';
import { applyCommand } from './commands';
import { TICK_RATE, World } from './world';

function yard() {
  const w=new World(40,30);w.rules='regional-v1';w.createHub(0,9);
  for(const tech of w.techs)w.applyTech(tech.id);
  for(const item of ITEM_IDS)w.stock.set(item,1000);
  for(let x=5;x<=17;x++)w.place('road',x,12,0);
  const a=w.place('station',5,10,0)!,b=w.place('station',15,10,0)!;
  w.setStationMode(b,'unload');
  const v=w.buildTruck(a)!;w.setStops(v,[{id:a.id,act:'load',item:'coal'},{id:b.id,act:'unload'}]);
  v.path=[];v.state='loading';v.tile=w.stationStops(a)[0];
  return {w,a,b,v};
}
function run(w:World,seconds:number){for(let i=0;i<Math.round(seconds*TICK_RATE);i++)w.tick();}
function depart(w:World,id:number,max=40){
  for(let i=0;i<max*TICK_RATE&&w.vehicles.get(id)!.state==='loading';i++)w.tick();
  expect(w.vehicles.get(id)!.state).toBe('to-unload');return w.time;
}

describe('만차 또는 도착 후 짧은 대기 출발',()=>{
  it('만차면 대기 시간이 남아도 즉시 출발한다',()=>{
    const {w,a,v}=yard();a.inBuf.set('coal',200);w.setDispatch(v,[],30);
    const time=depart(w,v.id);expect(v.load).toBe(w.truckCapacity(v));expect(time).toBeLessThan(6);
  });
  for(const wait of [5,10,15,30])it(`${wait}초 후 부분 적재로 출발한다`,()=>{
    const {w,a,v}=yard();a.inBuf.set('coal',3);expect(w.setDispatch(v,[],wait)).toBe(true);
    run(w,wait-.1);expect(v.state).toBe('loading');
    const time=depart(w,v.id);expect(time).toBeCloseTo(wait,1);expect(v.load).toBe(3);
  });
  it('계속 짐이 들어와도 도착 시점 기준 10초에 출발한다',()=>{
    const {w,a,v}=yard();
    for(let s=0;s<10;s++){a.inBuf.set('coal',(a.inBuf.get('coal')??0)+1);run(w,1);}
    const time=depart(w,v.id);expect(time).toBeLessThan(10.1);expect(v.load).toBe(10);
  });
  it('정차 중 대기 시간을 바꿔도 이미 기다린 시간이 초기화되지 않는다',()=>{
    const {w,a,v}=yard();a.inBuf.set('coal',3);w.setDispatch(v,['coal'],15);run(w,4);
    w.setDispatch(v,['coal'],5);expect(depart(w,v.id)).toBeLessThan(5.1);
  });
  it('품목별 상한 없이 한 품목이 비어 있어도 다른 품목으로 만차 적재한다',()=>{
    const {w,a,v}=yard();a.inBuf.set('coal',100);w.setDispatch(v,['coal','copper-plate'],15);
    const time=depart(w,v.id);expect(time).toBeLessThan(6);expect(v.load).toBe(w.truckCapacity(v));
    expect(v.cargo.get('coal')).toBe(w.truckCapacity(v));
  });
  it('계획 품목도 새 물량을 추가로 싣고 제한 시간에 출발한다',()=>{
    const {w,a,v}=yard();a.inBuf.set('coal',2);w.setDispatch(v,['coal'],10);
    run(w,4);expect(v.state).toBe('loading');a.inBuf.set('coal',5);
    const time=depart(w,v.id);expect(time).toBeLessThan(10.1);expect(v.load).toBe(7);
    run(w,15);expect(w.poolCount(bOf(w), 'coal')).toBe(7);
  });
  it('빈 차는 제한 시간이 지나도 빈 왕복을 하지 않는다',()=>{
    const {w,v}=yard();w.setDispatch(v,['coal'],5);run(w,35);
    expect(v.state).toBe('loading');expect(v.load).toBe(0);
  });
  it('저장·중간 참가 후에도 대기 경과와 새 규칙이 유지된다',()=>{
    const {w,a,v}=yard();a.inBuf.set('coal',3);w.setDispatch(v,['coal'],10);run(w,4);
    const save=JSON.parse(JSON.stringify(w.serialize()));const resumed=World.deserialize(save);
    const guest=World.fromSnapshot(JSON.parse(JSON.stringify(w.snapshot())));
    expect(guest.checksum()).toBe(w.checksum());
    expect(resumed.vehicles.get(v.id)?.departureWait).toBe(10);
    expect(depart(resumed,v.id)).toBeLessThan(10.1);
    expect(depart(guest,v.id)).toBeLessThan(10.1);
  });
  it('복제·되돌리기도 새 출발 기준을 보존한다',()=>{
    const {w,v}=yard();w.setDispatch(v,['coal'],15);
    const copy=applyCommand(w,0,{t:'clone-truck',id:v.id})!;
    expect(copy.departureWait).toBe(15);expect(copy.plan).toEqual(v.plan);
    applyCommand(w,0,{t:'undo'});applyCommand(w,0,{t:'redo'});
    expect([...w.vehicles.values()].every(v=>v.departureWait===15)).toBe(true);
  });
  it('잘못된 시간·중복 품목·잘못된 품목은 기존 설정을 바꾸지 않는다',()=>{
    const {w,v}=yard();w.setDispatch(v,['coal'],5);
    const before=JSON.stringify(w.serialize());
    expect(w.setDispatch(v,['coal'],60)).toBe(false);
    expect(w.setDispatch(v,['coal','coal'],5)).toBe(false);
    expect(w.setDispatch(v,['invalid' as never],5)).toBe(false);
    expect(JSON.stringify(w.serialize())).toBe(before);
  });
  it('이전 저장은 기존 배차 규칙을 유지하고 새 출발값 선택 시 전환한다',()=>{
    const {w,v}=yard();w.setPlan(v,[{item:'coal',cap:12}],120,true);
    const saved=w.serialize();const copy=World.deserialize(JSON.parse(JSON.stringify(saved)));
    const cv=copy.vehicles.get(v.id)!;expect(cv.departureWait).toBeNull();expect(cv.period).toBe(120);
    expect(copy.setDispatch(cv,['coal'],10)).toBe(true);expect(cv.departureWait).toBe(10);expect(cv.period).toBe(0);
  });
});
function bOf(w:World){return w.stations().find(s=>s.x===15)!;}
