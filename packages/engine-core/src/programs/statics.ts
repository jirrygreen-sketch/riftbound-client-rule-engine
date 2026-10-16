import type { Ability, EventPattern, Instruction } from '@riftbound/card-dsl';
import type { ObjectSnapshot } from '../effects/contract.js';

export interface StaticBindingHandle { readonly unbind: () => void; }
export interface ProgramStaticBinder {
  bindStatic?(ability: Extract<Ability, { kind: 'static' }>, source: ObjectSnapshot): StaticBindingHandle | void;
  bindReplacement?(ability: Extract<Ability, { kind: 'replacement' }>, source: ObjectSnapshot): StaticBindingHandle | void;
}
export const noopStaticBinder: ProgramStaticBinder = {};

export function bindStaticAbility(binder: ProgramStaticBinder, ability: Extract<Ability, { kind: 'static' }>, source: ObjectSnapshot): StaticBindingHandle {
  return binder.bindStatic?.(ability, source) ?? { unbind() {} };
}
export function bindReplacementAbility(binder: ProgramStaticBinder, ability: Extract<Ability, { kind: 'replacement' }>, source: ObjectSnapshot): StaticBindingHandle {
  return binder.bindReplacement?.(ability, source) ?? { unbind() {} };
}
export type ReplacementBinding = { id: string; source: ObjectSnapshot; replaces: EventPattern; body: readonly Instruction[] };
