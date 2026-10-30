import { describe, expect, it } from 'vitest';
import { ITEM_IDS } from '../data/items';
import { STATION_CAPACITY, STORAGE_CAPACITY } from '../data/buildings';
import { applyCommand } from '../sim/commands';
import type { Activity } from '../sim/activity';
import { World } from '../sim/world';
import {
  queueStationTransfer, stationRoadPreview, stationTransfer, transferEndpoints, transferLabel, transferSample,
  TRANSFER_DURATION, TRANSFER_LIMIT,
} from './station-feedback';

function factory() {
  const w = new World(60, 40); w.rules = 'regional-v1'; w.createHub(0, 9);
  for (const tech of w.techs) w.applyTech(tech.id);
  for (const item of ITEM_IDS) w.stock.set(item, 10000);
  return w;
}

describe('정류장 도로·정차 칸 미리보기', () => {
  it('네 면의 실제 정차 칸을 전부 표시하고 대각선 도로는 포함하지 않는다', () => {
    const w = factory();
    for (const [x,y] of [[10,9],[11,9],[12,10],[12,11],[10,12],[11,12],[9,10],[9,11],[9,9],[12,12]]) w.place('road',x,y,0);
    const before = w.serialize(), hash = w.checksum();
    const preview = stationRoadPreview(w, 10, 10);
    expect(preview.state).toBe('connected'); expect(preview.roads).toHaveLength(8);
    expect(w.serialize()).toEqual(before); expect(w.checksum()).toBe(hash);
    const station = w.place('station',10,10,0)!;
    expect(preview.roads.map((r) => r.tile)).toEqual(w.stationStops(station));
    expect(preview.roads.some((r) => r.tile === w.idx(9,9))).toBe(false);
    expect(preview.roads.some((r) => r.tile === w.idx(12,12))).toBe(false);
  });

  it('한 칸 떨어진 도로는 미연결이며 도로 없이 먼저 정류장을 지을 수 있는 동작은 유지한다', () => {
    const w = factory(); w.place('road',10,8,0);
    const preview = stationRoadPreview(w,10,10);
    expect(preview.state).toBe('no-road'); expect(preview.valid).toBe(true); expect(preview.roads).toEqual([]);
    expect(w.place('station',10,10,0)).not.toBeNull();
  });

  it('몸체가 겹치는 위치와 미공개 도로를 정상 접도로 표시하지 않는다', () => {
    const w = factory(); w.place('road',10,12,0); w.place('storage',10,10,0);
    expect(stationRoadPreview(w,10,10).state).toBe('blocked');
    const other = factory(); other.place('road',10,12,0);
    other.revealed = new Uint8Array(other.width * other.height).fill(1);
    other.revealed[other.idx(10,12)] = 0;
    expect(stationRoadPreview(other,10,10).roads).toEqual([]);
    other.revealed[other.idx(10,10)] = 0;
    expect(stationRoadPreview(other,10,10).state).toBe('blocked');
  });

  it('허브에 붙여 자동으로 회전/내리기로 바뀌어도 실제 배치 후 정차 칸과 일치한다', () => {
    const w = factory(); w.place('road',3,11,0); w.place('road',4,11,0);
    const preview = stationRoadPreview(w,3,9,true);
    const r = applyCommand(w,0,{t:'place',tool:'station',x:3,y:9,dir:0,initial:true,setting:null});
    expect(r.ok).toBe(true);
    expect(r.building!.stationMode).toBe('unload'); expect(r.building!.dir).toBe(3);
    expect(preview.roads.map((p) => p.tile)).toEqual(w.stationStops(r.building!));
  });
});

describe('실제 정류장 입출고 사건', () => {
  it('벨트 입고와 정류장 출고가 성공할 때만 방향이 있는 사건을 만든다', () => {
    const w = factory(), events: Activity[] = [];
    const station = w.place('station',10,10,1)!;
    const belt = w.place('belt',9,10,1)!;
    w.onActivity = (e) => events.push(e);
    belt.items.push({item:'iron-plate',pos:0.99,n:1}); w.tick();
    const input = events.find((e) => e.kind === 'station-port');
    expect(input).toEqual({kind:'station-port',id:station.id,from:belt.id,to:station.id,item:'iron-plate'});
    expect(station.inBuf.get('iron-plate')).toBe(1);
    expect(transferLabel(stationTransfer(w,input!,1)!)).toBe('입고');
    station.inBuf.set('iron-plate',STATION_CAPACITY); events.length=0;
    belt.items.push({item:'iron-plate',pos:0.99,n:1}); w.tick();
    expect(events.filter((e) => e.kind === 'station-port')).toEqual([]);

    const outgoing = factory(), outEvents: Activity[] = [];
    const source = outgoing.place('station',10,10,1)!; outgoing.setStationMode(source,'unload');
    const target = outgoing.place('storage',12,10,0)!;
    target.inBuf.set('stone',STORAGE_CAPACITY); source.outBuf.set('water',2);
    outgoing.onActivity = (e) => outEvents.push(e); outgoing.tick();
    expect(outEvents.filter((e) => e.kind === 'station-port')).toEqual([]);
    target.inBuf.clear(); outgoing.tick();
    const output = outEvents.find((e) => e.kind === 'station-port');
    expect(output).toEqual({kind:'station-port',id:source.id,from:source.id,to:target.id,item:'water'});
    expect(transferLabel(stationTransfer(outgoing,output!,1)!)).toBe('출고');
  });

  it('이동 관찰을 켜도 재고·체크섬·저장이 같고 불러오기는 과거 사건을 재생하지 않는다', () => {
    const a = factory(); const station=a.place('station',10,10,0)!; const belt=a.place('belt',9,10,1)!;
    belt.items.push({item:'iron-plate',pos:0.99,n:2});
    const b=World.fromSnapshot(a.snapshot()), events: Activity[]=[];
    a.onActivity=(e)=>events.push(e);
    for(let i=0;i<60;i++){a.tick();b.tick();}
    expect(events.some((e)=>e.kind==='station-port')).toBe(true);
    expect(a.buildings.get(station.id)!.inBuf).toEqual(b.buildings.get(station.id)!.inBuf);
    expect(a.checksum()).toBe(b.checksum()); expect(a.serialize()).toEqual(b.serialize());
    expect(World.fromSnapshot(a.snapshot()).onActivity).toBeUndefined();
  });

  it('지하 컨베이어로 입고하면 먼 입구가 아니라 실제 출구에서 정류장으로 움직인다', () => {
    const w=factory(), events: Activity[]=[];
    const inlet=w.place('underground',4,10,1)!, outlet=w.place('underground',8,10,1)!;
    const station=w.place('station',9,10,0)!;
    inlet.items.push({item:'iron-plate',pos:w.beltLength(inlet)-0.01,n:1});
    w.onActivity=(e)=>events.push(e); w.tick();
    const event=events.find((e)=>e.kind==='station-port');
    expect(event).toEqual({kind:'station-port',id:station.id,from:outlet.id,to:station.id,item:'iron-plate'});
    const ends=transferEndpoints(w,stationTransfer(w,event!,10)!)!;
    expect(ends.a).toEqual({x:outlet.x+0.5,y:outlet.y+0.5});
    expect(station.inBuf.get('iron-plate')).toBe(1);
  });
});

describe('상하차 이동 경로와 배속 가독성', () => {
  function truckFixture() {
    const w=factory(); const station=w.place('station',10,10,0)!; w.place('road',10,12,0);
    const v=w.buildTruck(station)!;
    return {w,station,v};
  }

  it('상차와 하차 경로가 반대이며 화면에서 줄 선 트럭의 표시 위치를 사용한다', () => {
    const {w,station,v}=truckFixture();
    const loading=stationTransfer(w,{kind:'cargo',id:v.id,station:station.id,item:'water',loading:true},100)!;
    const unloading=stationTransfer(w,{kind:'cargo',id:v.id,station:station.id,item:'water',loading:false},100)!;
    const spots=new Map([[v.id,{x:10.5,y:14.5}]]);
    const loadEnds=transferEndpoints(w,loading,spots)!, unloadEnds=transferEndpoints(w,unloading,spots)!;
    expect(loadEnds.b).toEqual(spots.get(v.id)); expect(unloadEnds.a).toEqual(spots.get(v.id));
    expect(loadEnds.a).toEqual(unloadEnds.b);
    expect(loadEnds.a.y).toBeGreaterThan(station.y); expect(loadEnds.a.y).toBeLessThan(station.y+station.size);
    expect(transferLabel(loading)).toBe('상차'); expect(transferLabel(unloading)).toBe('하차');
    w.remove(station); expect(transferEndpoints(w,loading,spots)).toBeNull();
  });

  it('4배속·게임 시각 변화에도 0.55초 동안 읽을 수 있게 유지하고 실제 완료 사건만 짧게 마무리한다', () => {
    const {w,station,v}=truckFixture();
    const f=stationTransfer(w,{kind:'cargo',id:v.id,station:station.id,item:'iron-plate',loading:true},10)!;
    const ends=transferEndpoints(w,f)!;
    for(const speed of [1,2,4]) {
      w.time=f.gameAt+0.275*speed;
      const sample=transferSample(f,10.275,ends.a,ends.b);
      expect(sample.t).toBeCloseTo(0.5); expect(sample.alpha).toBe(1);
      expect(sample.point.y).toBeLessThan((ends.a.y+ends.b.y)/2);
    }
    expect(transferSample(f,10,ends.a,ends.b).point).toEqual(ends.a);
    const end=transferSample(f,10+TRANSFER_DURATION,ends.a,ends.b);
    expect(end.point.x).toBeCloseTo(ends.b.x); expect(end.point.y).toBeCloseTo(ends.b.y); expect(end.alpha).toBeCloseTo(0);
    expect(stationTransfer(w,{kind:'charge',id:v.id,amount:0},10)).toBeNull();
  });

  it('빈번한 입출고는 진행 중 아이콘을 잘라내지 않고 묶으며 전체 상한을 유지한다', () => {
    const {w,station,v}=truckFixture();
    const f=stationTransfer(w,{kind:'cargo',id:v.id,station:station.id,item:'coal',loading:true},10)!;
    let flights=queueStationTransfer([],f,10);
    for(let i=1;i<20;i++) flights=queueStationTransfer(flights,{...f,born:10+i/100},10+i/100);
    expect(flights).toEqual([f]);
    for(let i=1;i<10;i++) flights=queueStationTransfer(flights,{...f,station:100+i,born:10.2},10.2);
    expect(flights).toHaveLength(TRANSFER_LIMIT); expect(flights[0]).toBe(f);
    const next={...f,born:11}; flights=queueStationTransfer(flights,next,11);
    expect(flights).toEqual([next]);
  });
});
