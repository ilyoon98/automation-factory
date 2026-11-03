import { expect, it } from 'vitest';
import { ITEM_IDS } from '../data/items';
import { TICK_RATE, World } from './world';

function yard() {
  const w=new World(100,40);w.rules='regional-v1';w.createHub(0,0);
  for(const t of w.techs)w.applyTech(t.id);
  for(const item of ITEM_IDS)w.stock.set(item,1000);
  for(let x=50;x<=75;x++)w.place('road',x,22,0);
  const a=w.place('station',52,20,0)!,b=w.place('station',72,20,0)!;
  w.setStationMode(b,'unload');const v=w.buildTruck(a)!;
  w.setStops(v,[{id:a.id,act:'load'},{id:b.id,act:'unload'}]);w.setDispatch(v,['coal'],5);
  return {w,a,b,v};
}
function run(w:World,seconds:number){for(let i=0;i<seconds*TICK_RATE;i++)w.tick();}

it('전력망 밖 두 정류장도 이전 배터리 0에서 실제 배송을 완료한다',()=>{
  const {w,a,b,v}=yard();a.inBuf.set('coal',50);v.battery=0;v.charger=true;
  expect(w.netOf(a)).toBe(0);expect(w.netOf(b)).toBe(0);
  run(w,25);
  expect(b.outBuf.get('coal')).toBe(50);
  expect(w.stats.delivered).toBe(50);expect(w.power.charge).toBe(0);
  expect(v.charger).toBe(false);expect(v.receivedCharge).toBe(0);
});

it('목적지 마지막 한 칸을 두 트럭이 중복 예약하지 않는다',()=>{
  const {w,a,b,v}=yard();a.inBuf.set('coal',100);b.outBuf.set('stone',199);b.targets.set('coal',0);
  const other=w.buildTruck(a)!;w.setStops(other,v.stops);w.setDispatch(other,['coal'],5);
  run(w,2);
  expect(w.inReserved(b,'coal')).toBe(1);
  expect(v.load+other.load).toBe(1);
  run(w,20);
  expect(b.outBuf.get('coal')).toBe(1);
  expect((b.outBuf.get('stone')??0)+(b.outBuf.get('coal')??0)).toBe(200);
});
