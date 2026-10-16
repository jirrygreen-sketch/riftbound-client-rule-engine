import type { ObjectRef } from '../effects/contract.js';

export interface DuelCombatObjectIdentity {
  readonly uid: string;
  readonly zoneEpoch: number;
}

export function toDuelCombatObjectRef(uid: string, zoneEpoch: number): ObjectRef {
  return Object.freeze({ id: uid, zoneEntryId: zoneEpoch });
}

export function fromDuelCombatObjectRef(ref: ObjectRef): DuelCombatObjectIdentity {
  return Object.freeze({ uid: ref.id, zoneEpoch: ref.zoneEntryId });
}
