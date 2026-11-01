import { expect, it } from 'vitest';
import { Building } from '../sim/building';
import type { PlaceResult } from '../sim/commands';
import { Vehicle } from '../sim/vehicle';
import { World } from '../sim/world';
import { packReply, unpackReply, type PackedReply } from './replies';

const network = (reply: PackedReply): PackedReply => JSON.parse(JSON.stringify(reply));

it('동기화 전에 놓은 건물 응답은 Map과 건물 동작을 복원하고 세계를 다시 변경하지 않는다', () => {
  const w = new World(40,30), b = new Building(7,'smelter',6,6,1);
  b.inBuf.set('iron-ore',3);b.targets.set('motor',12);
  const reply = network(packReply({t:'place',tool:'smelter',x:6,y:6,dir:1,initial:true,setting:null},{ok:true,building:b}));
  const hash = w.checksum();
  const result = unpackReply(reply,w) as PlaceResult;
  expect(result.building).toBeInstanceOf(Building);
  expect(result.building!.def.type).toBe('smelter');expect(result.building!.contains(6,6)).toBe(true);
  expect(result.building!.inBuf.get('iron-ore')).toBe(3);expect(result.building!.targets.get('motor')).toBe(12);
  expect(w.buildings.size).toBe(0);expect(w.checksum()).toBe(hash);
});

it('차량 생성 응답은 노선 getter와 화물 Map을 복원하며 차량을 중복 생성하지 않는다', () => {
  const w = new World(40,30), v = new Vehicle(8,20,w.width);
  v.stops=[{id:3,act:'load'},{id:4,act:'unload'}];v.cargo.set('coal',5);
  const reply=network(packReply({t:'build-truck',station:3},v));
  const result=unpackReply(reply,w) as Vehicle;
  expect(result).toBeInstanceOf(Vehicle);expect(result.loadId).toBe(3);expect(result.unloadId).toBe(4);
  expect(result.load).toBe(5);expect(result.cargo.get('coal')).toBe(5);expect(w.vehicles.size).toBe(0);
});

it('수신 세계의 같은 id 차량이 오래된 상태여도 응답은 호스트의 실제 결과를 사용한다', () => {
  const w=new World(40,30),local=new Vehicle(8,20,w.width),host=new Vehicle(8,20,w.width);
  local.stops=[{id:77,act:'load'},{id:88,act:'unload'}];host.stops=[{id:3,act:'load'},{id:4,act:'unload'}];w.vehicles.set(local.id,local);
  const result=unpackReply(network(packReply({t:'clone-truck',id:host.id},host)),w) as Vehicle;
  expect(result.loadId).toBe(3);expect(result.unloadId).toBe(4);expect(local.loadId).toBe(77);expect(w.vehicles.size).toBe(1);
});

it.each([undefined,null,false,true,0])('값 %s도 JSON을 거친 뒤 명령을 다시 실행하지 않고 복원한다',value=>{
  const w=new World(40,30);
  expect(unpackReply(network(packReply({t:'end'},value)),w)).toBe(value);
});

it('회수 결과는 나중에 원본 수량이 바뀌어도 실제 처리 시점의 수량을 보존한다', () => {
  const result={ok:true,items:[['coal',5]],moved:5};
  const packed=packReply({t:'pile-collect',rid:'one',tile:20},result);result.items[0][1]=99;
  expect(unpackReply(network(packed),new World(40,30))).toEqual({ok:true,items:[['coal',5]],moved:5});
});
