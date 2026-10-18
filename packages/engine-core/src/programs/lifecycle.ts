import type { ChainEngine } from '../chain/engine.js';
import type { GameAction, ObjectSnapshot } from '../effects/contract.js';
import type { PipelineEvent, TimingEmission } from '../events/pipeline-types.js';
import { bindReplacementAbility, bindStaticAbility, createEngineStaticBinder, type ProgramStaticBinder, type StaticBindingHandle } from './statics.js';
import { ProgramRegistry } from './registry.js';
import { registerProgramTriggers, unregisterProgramTriggers } from './triggers.js';
import { expandProgram } from './keywords.js';

export interface ProgramLifecycleHandle { readonly detach: () => void; }

interface SourceBindings {
  readonly source: ObjectSnapshot;
  readonly triggerIds: readonly string[];
  readonly staticHandles: readonly StaticBindingHandle[];
  readonly replacementHandles: readonly StaticBindingHandle[];
  readonly staticEffectIds: readonly string[];
  readonly replacementIds: readonly string[];
  readonly signature: string;
}

type Undo = () => void;

export function attachProgramLifecycle(engine: ChainEngine, registry: ProgramRegistry, binder?: ProgramStaticBinder, onError?: (error: unknown, source: ObjectSnapshot) => void): ProgramLifecycleHandle {
  const effectiveBinder = binder ?? createEngineStaticBinder(engine);
  const bindReplacementOnChain = binder === undefined;
  const bindings = new Map<string, SourceBindings>();
  const pipeline = engine.pipeline;
  const originalEmitBatch = pipeline.emitBatch.bind(pipeline);
  const originalCommit = pipeline.commit.bind(pipeline);
  const originalOnEvent = pipeline.onEvent;
  const transactionUndo: Undo[][] = [];
  let detached = false;

  const key = (source: ObjectSnapshot) => `${source.ref.id}:${source.ref.zoneEntryId}`;
  const signature = (source: ObjectSnapshot) => JSON.stringify({ owner: source.owner, controller: source.controller, zone: source.zone, location: source.location });
  const report = (error: unknown, source: ObjectSnapshot) => { onError?.(error, source); };
  const recordUndo = (undo: Undo) => { transactionUndo.at(-1)?.push(undo); };
  const transaction = <T>(run: () => T): T => {
    const undo: Undo[] = [];
    transactionUndo.push(undo);
    try { return run(); }
    catch (error) {
      for (const action of undo.reverse()) {
        try { action(); } catch { /* Preserve the authoritative failure. */ }
      }
      throw error;
    } finally { transactionUndo.pop(); }
  };
  const triggers = () => pipeline.checkpoint().triggers;
  const replacements = () => pipeline.checkpoint().replacements;
  const effects = () => engine.layers.registry.list();
  const inspectable = (source: ObjectSnapshot) => registry.inspect(source.cardId) !== undefined;

  const detach = (source: ObjectSnapshot) => {
    const k = key(source);
    const binding = bindings.get(k);
    if (!binding) return;
    unregisterProgramTriggers(engine, binding.triggerIds);
    for (const handle of binding.staticHandles) {
      try { handle.unbind(); } catch (error) { report(error, source); }
    }
    for (const handle of binding.replacementHandles) {
      try { handle.unbind(); } catch (error) { report(error, source); }
    }
    bindings.delete(k);
  };

  const attach = (source: ObjectSnapshot, bindStatic: boolean, bindReplacement: boolean): SourceBindings | undefined => {
    if (!inspectable(source)) { detach(source); return undefined; }
    const k = key(source);
    const existing = bindings.get(k);
    if (existing && existing.signature === signature(source)) return existing;
    if (existing) detach(source);

    const triggerIds: string[] = [];
    try {
      for (const id of registerProgramTriggers(registry, engine, source)) triggerIds.push(id);
    } catch (error) {
      unregisterProgramTriggers(engine, triggerIds);
      report(error, source);
      return undefined;
    }

    const staticHandles: StaticBindingHandle[] = [];
    const staticEffectIds: string[] = [];
    const replacementHandles: StaticBindingHandle[] = [];
    const replacementIds: string[] = [];
    try {
      if (bindStatic) {
        const before = new Set(effects().map(entry => entry.effect.id));
        for (const ability of expandProgram(registry.get(source.cardId), source).abilities) {
          if (ability.kind !== 'static') continue;
          try { staticHandles.push(bindStaticAbility(effectiveBinder, ability, source)); }
          catch (error) { report(error, source); }
        }
        for (const entry of effects()) if (!before.has(entry.effect.id)) staticEffectIds.push(entry.effect.id);
      }
      if (bindReplacement) {
        const before = new Set(replacements().keys());
        for (const ability of expandProgram(registry.get(source.cardId), source).abilities) {
          if (ability.kind !== 'replacement') continue;
          try { replacementHandles.push(bindReplacementAbility(effectiveBinder, ability, source)); }
          catch (error) { report(error, source); }
        }
        for (const id of replacements().keys()) if (!before.has(id)) replacementIds.push(id);
      }
    } catch (error) {
      unregisterProgramTriggers(engine, triggerIds);
      for (const handle of staticHandles) { try { handle.unbind(); } catch { /* best-effort */ } }
      for (const handle of replacementHandles) { try { handle.unbind(); } catch { /* best-effort */ } }
      report(error, source);
      return undefined;
    }

    const binding = { source, triggerIds, staticHandles, replacementHandles, staticEffectIds, replacementIds, signature: signature(source) };
    bindings.set(k, binding);
    recordUndo(() => {
      if (bindings.get(k) !== binding) return;
      unregisterProgramTriggers(engine, binding.triggerIds);
      for (const handle of binding.staticHandles) { try { handle.unbind(); } catch { /* best-effort */ } }
      for (const handle of binding.replacementHandles) { try { handle.unbind(); } catch { /* best-effort */ } }
      bindings.delete(k);
    });
    return binding;
  };

  const ensure = (source: ObjectSnapshot) => {
    if (!inspectable(source)) { detach(source); return; }
    const current = pipeline.host.objects().find(object => object.ref.id === source.ref.id);
    if (!current || (current.zone !== 'board' && current.zone !== 'chain')) { detach(source); return; }
    const isBoard = current.zone === 'board';
    const k = key(current);
    const existing = bindings.get(k);
    if (existing && existing.signature === signature(current)) return;
    if (existing) detach(existing.source);
    attach(current, isBoard, isBoard || bindReplacementOnChain);
  };

  const isEntry = (emission: TimingEmission) => emission.timingPoint === 'object-enters-board' || emission.timingPoint === 'object-enters-chain';
  const isExit = (emission: TimingEmission) => emission.timingPoint === 'object-leaves-board' || emission.timingPoint === 'object-killed';

  const observe = (emissions: readonly TimingEmission[], run: () => readonly PipelineEvent[]) => transaction(() => {
    for (const emission of emissions) if (emission.object && isEntry(emission)) ensure(emission.object);
    const events = run();
    for (const emission of emissions) if (emission.object && isExit(emission)) detach(emission.object);
    return events;
  });

  const observedEmitBatch = ((emissions: readonly TimingEmission[], action?: GameAction, batchId?: string) =>
    observe(emissions, () => originalEmitBatch(emissions, action, batchId))) as typeof pipeline.emitBatch;
  pipeline.emitBatch = observedEmitBatch;

  // publish() invokes the pipeline's private batch path directly. These sinks
  // expose the real state and registration boundaries to the lifecycle without
  // synthesizing another event or changing the pipeline's scanner.
  pipeline.onEvent = event => {
    transaction(() => {
      if (event.object && isEntry(event)) {
        // The engine's private publish() commits state before calling
        // emitBatch. Reconcile there first so only the event boundary that
        // actually precedes the scanner performs the lifecycle attach.
        if (event.batchIndex === 0) ensure(event.object);
      }
      originalOnEvent?.(event);
      if (event.object && isExit(event)) detach(event.object);
    });
  };

  if (bindReplacementOnChain) {
    pipeline.commit = ((action: GameAction) => {
      if (action.type === 'move-zone' && action.to === 'chain') {
        const source = pipeline.host.objects().find(object => object.ref.id === action.object.id && object.ref.zoneEntryId === action.object.zoneEntryId);
        if (source && inspectable(source)) attach(source, false, true);
      }
      return originalCommit(action);
    }) as typeof pipeline.commit;
  }

  transaction(() => {
    for (const source of pipeline.host.objects()) if (source.zone === 'board' || source.zone === 'chain') ensure(source);
  });

  return {
    detach() {
      if (detached) return;
      detached = true;
      pipeline.emitBatch = originalEmitBatch;
      pipeline.commit = originalCommit;
      pipeline.onEvent = originalOnEvent;
      for (const binding of [...bindings.values()]) detach(binding.source);
    }
  };
}
