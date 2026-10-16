import type { ChainEngine } from '../chain/engine.js';
import type { ObjectSnapshot } from '../effects/contract.js';
import type { TimingEmission } from '../events/pipeline-types.js';
import { bindReplacementAbility, bindStaticAbility, type ProgramStaticBinder, type StaticBindingHandle } from './statics.js';
import { ProgramRegistry } from './registry.js';
import { registerProgramTriggers, unregisterProgramTriggers } from './triggers.js';
import { expandProgram } from './keywords.js';

export interface ProgramLifecycleHandle { readonly detach: () => void; }

export function attachProgramLifecycle(engine: ChainEngine, registry: ProgramRegistry, binder: ProgramStaticBinder = {}, onError?: (error: unknown, source: ObjectSnapshot) => void): ProgramLifecycleHandle {
  const triggerIds = new Map<string, readonly string[]>();
  const staticHandles = new Map<string, StaticBindingHandle[]>();
  const pipeline = engine.pipeline;
  const original = pipeline.emit.bind(pipeline);
  const key = (source: ObjectSnapshot) => `${source.ref.id}:${source.ref.zoneEntryId}`;
  const attach = (source: ObjectSnapshot) => {
    const k = key(source);
    try {
      if (!triggerIds.has(k)) triggerIds.set(k, registerProgramTriggers(registry, engine, source));
    } catch (error) { onError?.(error, source); }
    try {
      if (!staticHandles.has(k)) {
        const handles: StaticBindingHandle[] = [];
        for (const ability of expandProgram(registry.get(source.cardId), source).abilities) {
          if (ability.kind === 'static') handles.push(bindStaticAbility(binder, ability, source));
          if (ability.kind === 'replacement') handles.push(bindReplacementAbility(binder, ability, source));
        }
        staticHandles.set(k, handles);
      }
    } catch (error) { onError?.(error, source); }
  };
  const detachSource = (source: ObjectSnapshot) => {
    const k = key(source);
    const ids = triggerIds.get(k);
    if (ids) unregisterProgramTriggers(engine, ids);
    triggerIds.delete(k);
    for (const handle of staticHandles.get(k) ?? []) handle.unbind();
    staticHandles.delete(k);
  };
  pipeline.emit = ((emission: TimingEmission, action?: any) => {
    const enters = emission.timingPoint === 'object-enters-board' || emission.timingPoint === 'object-enters-chain';
    const leaves = emission.timingPoint === 'object-leaves-board' || emission.timingPoint === 'object-leaves-chain' || emission.timingPoint === 'object-killed';
    if (enters && emission.object) {
      const isSpell = emission.object.types.some(type => type.toLowerCase() === 'spell');
      const shouldAttach = emission.timingPoint === 'object-enters-chain' ? isSpell : !isSpell;
      if (shouldAttach) attach(emission.object);
    }
    const event = original(emission, action);
    if (leaves && emission.object) detachSource(emission.object);
    return event;
  }) as typeof pipeline.emit;
  return { detach() { pipeline.emit = original; for (const source of [...triggerIds.keys()]) { const [id, zoneEntryId] = source.split(':'); void id; void zoneEntryId; } triggerIds.clear(); for (const handles of staticHandles.values()) for (const handle of handles) handle.unbind(); staticHandles.clear(); } };
}
