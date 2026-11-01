import { Building } from '../sim/building';
import { Vehicle } from '../sim/vehicle';
import type { Command, PlaceResult } from '../sim/commands';
import type { World } from '../sim/world';

const buildingData = (b: Building) => ({ ...b, inBuf: [...b.inBuf], outBuf: [...b.outBuf], targets: [...b.targets] });
const vehicleData = (v: Vehicle) => ({ ...v, cargo: [...v.cargo] });

/** 명령 결과를 JSON으로 보관한다. 건물·차량의 Map과 getter는 수신 쪽에서 복원한다. */
export type PackedReply =
  | { kind: 'value'; value: unknown }
  | { kind: 'vehicle'; data: ReturnType<typeof vehicleData> }
  | { kind: 'place'; value: Omit<PlaceResult, 'building'>; building: ReturnType<typeof buildingData> | null };

export function packReply(cmd: Command, result: unknown): PackedReply {
  if (result instanceof Vehicle) return structuredClone({ kind: 'vehicle', data: vehicleData(result) });
  if (cmd.t === 'place') {
    const { building, ...value } = result as PlaceResult;
    return structuredClone({ kind: 'place', value, building: building ? buildingData(building) : null });
  }
  return { kind: 'value', value: structuredClone(result) };
}

export function unpackReply(reply: PackedReply, w: World): unknown {
  if (reply.kind === 'value') return reply.value;
  if (reply.kind === 'vehicle') {
    const d = reply.data;
    return w.vehicles.get(d.id) ?? Object.assign(new Vehicle(d.id, d.tile, w.width), d, { cargo: new Map(d.cargo) });
  }
  const d = reply.building;
  const building = d ? w.buildings.get(d.id) ?? Object.assign(new Building(d.id, d.type, d.x, d.y, d.dir), d,
    { inBuf: new Map(d.inBuf), outBuf: new Map(d.outBuf), targets: new Map(d.targets) }) : undefined;
  return { ...reply.value, ...(building ? { building } : {}) };
}
