import type { BuildingType } from '../data/buildings';
import type { Building } from './building';
import type { Dir } from './dir';

/** Bit masks relative to the building's primary output (dir). Rotation carries the ports with it. */
export interface JunctionPorts { inputs: number; outputs: number }

export function isJunction(type: BuildingType): boolean {
  return ['sorter', 'splitter', 'overflow', 'merger'].includes(type);
}

export function validJunctionPorts(type: BuildingType, value: unknown): value is JunctionPorts {
  if (!isJunction(type) || !value || typeof value !== 'object') return false;
  const { inputs, outputs } = value as JunctionPorts;
  if (!Number.isInteger(inputs) || !Number.isInteger(outputs) || inputs < 1 || inputs > 15 || outputs < 1 || outputs > 15 ||
      (inputs & outputs) !== 0 || !(outputs & 1)) return false;
  return type === 'merger' ? outputs === 1 : (inputs & (inputs - 1)) === 0 && (type !== 'sorter' || outputs !== 1);
}

export function junctionPorts(b: Pick<Building, 'type' | 'junction'>): JunctionPorts {
  return b.junction ?? (b.type === 'merger' ? { inputs: 14, outputs: 1 } : { inputs: 4, outputs: 11 });
}

export function junctionSide(b: Pick<Building, 'type' | 'junction' | 'dir'>, side: Dir, role: keyof JunctionPorts): boolean {
  return !!(junctionPorts(b)[role] & (1 << ((side - b.dir + 4) % 4)));
}
