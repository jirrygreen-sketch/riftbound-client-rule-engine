import type { ChainEngine } from '../chain/engine.js';
import type { ObjectSnapshot } from '../effects/contract.js';
import type { TimingEmission } from '../events/pipeline-types.js';
import { bindReplacementAbility, bindStaticAbility, createEngineStaticBinder, type ProgramStaticBinder, type StaticBindingHandle } from './statics.js';
import { ProgramRegistry } from './registry.js';
import { registerProgramTriggers, unregisterProgramTriggers } from './triggers.js';
import { expandProgram } from './keywords.js';

export interface ProgramLifecycleHandle { readonly detach: () => void; }

export function attachProgramLifecycle(engine: ChainEngine, registry: ProgramRegistry, binder?: ProgramStaticBinder, onError?: (error: unknown, source: ObjectSnapshot) => void): ProgramLifecycleHandle {
  const effectiveBinder = binder ?? createEngineStaticBinder(engine);
  const bindReplacementOnChain = binder === undefined;
  const triggerIds = new Map<string, readonly string[]>();
  const staticHandles = new Map<string, StaticBindingHandle[]>();
  const replacementHandles = new Map<string, StaticBindingHandle[]>();
  const pipeline = engine.pipeline;
  const original = pipeline.emit.bind(pipeline);
  const originalCommit = pipeline.commit.bind(pipeline);
  const key = (source: ObjectSnapshot) => `${source.ref.id}:${source.ref.zoneEntryId}`;
  const attach = (source: ObjectSnapshot, bindStatic = false, bindReplacement = false) => {
    const k = key(source);
    try {
      if (!triggerIds.has(k)) triggerIds.set(k, registerProgramTriggers(registry, engine, source));
    } catch (error) { onError?.(error, source); }
    if (bindStatic) {
      try {
        if (!staticHandles.has(k)) {
          const handles: StaticBindingHandle[] = [];
          for (const ability of expandProgram(registry.get(source.cardId), source).abilities) {
            if (ability.kind !== 'static') continue;
            try { handles.push(bindStaticAbility(effectiveBinder, ability, source)); }
            catch (error) { onError?.(error, source); }
          }
          staticHandles.set(k, handles);
        }
      } catch (error) { onError?.(error, source); }
    }
    if (bindReplacement && !replacementHandles.has(source.ref.id)) {
      try {
        const handles: StaticBindingHandle[] = [];
        for (const ability of expandProgram(registry.get(source.cardId), source).abilities) {
          if (ability.kind !== 'replacement') continue;
          try { handles.push(bindReplacementAbility(effectiveBinder, ability, source)); }
          catch (error) { onError?.(error, source); }
        }
        replacementHandles.set(source.ref.id, handles);
      } catch (error) { onError?.(error, source); }
    }
  };
  const detachSource = (source: ObjectSnapshot) => {
    const k = key(source);
    const ids = triggerIds.get(k);
    if (ids) unregisterProgramTriggers(engine, ids);
    triggerIds.delete(k);
    for (const handle of staticHandles.get(k) ?? []) handle.unbind();
    staticHandles.delete(k);
    const replacements = replacementHandles.get(source.ref.id);
    if (replacements) {
      for (const replacement of replacements) replacement.unbind();
      replacementHandles.delete(source.ref.id);
    }
  };
  pipeline.emit = ((emission: TimingEmission, action?: any) => {
    const entersBoard = emission.timingPoint === 'object-enters-board';
    const entersChain = emission.timingPoint === 'object-enters-chain';
    const leavesBoard = emission.timingPoint === 'object-leaves-board' || emission.timingPoint === 'object-killed';
    if (emission.object && (entersBoard || entersChain)) {
      // Replacement abilities must be registered while a permanent is on the
      // Chain so they can rewrite the move that carries it onto the Board.
      // Static layer effects become active only after the Board entry.
      attach(emission.object, entersBoard, entersBoard || (entersChain && bindReplacementOnChain));
    }
    const event = original(emission, action);
    if (leavesBoard && emission.object) detachSource(emission.object);
    return event;
  }) as typeof pipeline.emit;
  if (bindReplacementOnChain) {
    pipeline.commit = ((action: any) => {
      if (action?.type === 'move-zone' && action.to === 'chain' && !replacementHandles.has(action.object.id)) {
        const source = pipeline.host.objects().find(object => object.ref.id === action.object.id && object.ref.zoneEntryId === action.object.zoneEntryId);
        if (source) attach(source, false, true);
      }
      return originalCommit(action);
    }) as typeof pipeline.commit;
  }
  return {
    detach() {
      pipeline.emit = original;
      pipeline.commit = originalCommit;
      for (const ids of triggerIds.values()) unregisterProgramTriggers(engine, ids);
      triggerIds.clear();
      for (const handles of staticHandles.values()) for (const handle of handles) handle.unbind();
      staticHandles.clear();
      for (const handles of replacementHandles.values()) for (const handle of handles) handle.unbind();
      replacementHandles.clear();
    }
  };
}
