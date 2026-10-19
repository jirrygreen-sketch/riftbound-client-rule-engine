import type { ChainEngine } from '../chain/engine.js';
import type { GameAction, ObjectSnapshot } from '../effects/contract.js';
import type { PipelineEvent, TimingEmission } from '../events/pipeline-types.js';
import { bindReplacementAbility, bindStaticAbility, createEngineStaticBinder, type ProgramStaticBinder, type StaticBindingHandle } from './statics.js';
import { ProgramRegistry } from './registry.js';
import { registerProgramTriggers, unregisterProgramTriggers } from './triggers.js';
import { expandProgram } from './keywords.js';

export interface ProgramLifecycleHandle { readonly detach: () => void; }

interface Binding {
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
  const pipeline = engine.pipeline;
  const bindings = new Map<string, Binding>();
  const pendingExits = new Map<string, ObjectSnapshot>();
  const undoStack: Undo[][] = [];
  const originalEmitBatch = pipeline.emitBatch.bind(pipeline);
  const originalCommit = pipeline.commit.bind(pipeline);
  const originalDeferTriggerScan = pipeline.deferTriggerScan.bind(pipeline);
  let depth = 0;
  let detached = false;

  const refKey = (source: ObjectSnapshot) => `${source.ref.id}:${source.ref.zoneEntryId}`;
  const signature = (source: ObjectSnapshot) => JSON.stringify({ owner: source.owner, controller: source.controller, zone: source.zone, location: source.location });
  const report = (error: unknown, source: ObjectSnapshot) => { onError?.(error, source); };
  const recordUndo = (undo: Undo) => { for (const stack of undoStack) stack.push(undo); };
  const transaction = <T>(run: () => T): T => {
    const undo: Undo[] = [];
    undoStack.push(undo);
    depth++;
    let succeeded = false;
    try {
      const result = run();
      succeeded = true;
      return result;
    }
    catch (error) {
      for (const action of undo.reverse()) {
        try { action(); } catch { /* Preserve the authoritative failure. */ }
      }
      throw error;
    } finally {
      depth--;
      undoStack.pop();
      if (depth === 0 && succeeded) flushExits();
    }
  };
  const triggerMap = () => pipeline.checkpoint().triggers;
  const replacementMap = () => pipeline.checkpoint().replacements;
  const effectList = () => engine.layers.registry.list();
  const programExists = (source: ObjectSnapshot) => registry.inspect(source.cardId) !== undefined;
  const currentFor = (source: ObjectSnapshot) => pipeline.host.objects().find(object => object.ref.id === source.ref.id && object.ref.zoneEntryId === source.ref.zoneEntryId) ?? null;
  const active = (source: ObjectSnapshot) => source.zone === 'board' || source.zone === 'chain';

  const detach = (source: ObjectSnapshot) => {
    const k = refKey(source);
    const binding = bindings.get(k);
    if (!binding) return;
    unregisterProgramTriggers(engine, binding.triggerIds);
    for (const handle of binding.staticHandles) { try { handle.unbind(); } catch (error) { report(error, binding.source); } }
    for (const handle of binding.replacementHandles) { try { handle.unbind(); } catch (error) { report(error, binding.source); } }
    bindings.delete(k);
  };

  const bindingIntact = (binding: Binding): boolean => {
    if (binding.triggerIds.some(id => !triggerMap().has(id))) return false;
    if (binding.staticEffectIds.some(id => engine.layers.registry.get(id) === undefined)) return false;
    if (binding.replacementIds.some(id => !replacementMap().has(id))) return false;
    return true;
  };

  const attach = (source: ObjectSnapshot, bindStatic: boolean, bindReplacement: boolean): Binding | undefined => {
    if (!programExists(source)) { detach(source); return undefined; }
    const k = refKey(source);
    const existing = bindings.get(k);
    if (existing && existing.signature === signature(source) && bindingIntact(existing)) return existing;
    if (existing) detach(existing.source);

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
        const before = new Set(effectList().map(entry => entry.effect.id));
        for (const ability of expandProgram(registry.get(source.cardId), source).abilities) {
          if (ability.kind !== 'static') continue;
          try { staticHandles.push(bindStaticAbility(effectiveBinder, ability, source)); }
          catch (error) { report(error, source); }
        }
        for (const entry of effectList()) if (!before.has(entry.effect.id)) staticEffectIds.push(entry.effect.id);
      }
      if (bindReplacement) {
        const before = new Set(replacementMap().keys());
        for (const ability of expandProgram(registry.get(source.cardId), source).abilities) {
          if (ability.kind !== 'replacement') continue;
          try { replacementHandles.push(bindReplacementAbility(effectiveBinder, ability, source)); }
          catch (error) { report(error, source); }
        }
        for (const id of replacementMap().keys()) if (!before.has(id)) replacementIds.push(id);
      }
    } catch (error) {
      unregisterProgramTriggers(engine, triggerIds);
      for (const handle of staticHandles) { try { handle.unbind(); } catch { /* best effort */ } }
      for (const handle of replacementHandles) { try { handle.unbind(); } catch { /* best effort */ } }
      report(error, source);
      return undefined;
    }
    const binding = { source, triggerIds, staticHandles, replacementHandles, staticEffectIds, replacementIds, signature: signature(source) };
    bindings.set(k, binding);
    recordUndo(() => {
      if (bindings.get(k) !== binding) return;
      unregisterProgramTriggers(engine, binding.triggerIds);
      for (const handle of binding.staticHandles) { try { handle.unbind(); } catch { /* best effort */ } }
      for (const handle of binding.replacementHandles) { try { handle.unbind(); } catch { /* best effort */ } }
      bindings.delete(k);
    });
    return binding;
  };

  const ensure = (source: ObjectSnapshot) => {
    const k = refKey(source);
    const existing = bindings.get(k);
    const current = currentFor(source);
    if (!current || !programExists(current) || !active(current)) { if (existing) detach(existing.source); return; }
    if (existing && existing.signature === signature(current) && bindingIntact(existing)) return;
    if (existing) detach(existing.source);
    // Replacement abilities must be admitted while a permanent is on Chain.
    // The Chain commit hook installs them before its state transition. Static
    // layers become active only once the Board entry is authoritative.
    attach(current, current.zone === 'board', current.zone === 'board' || bindReplacementOnChain);
  };

  const reconcile = () => {
    for (const binding of [...bindings.values()]) {
      const current = currentFor(binding.source);
      if (!current || !programExists(current) || !active(current) || binding.signature !== signature(current) || !bindingIntact(binding)) detach(binding.source);
    }
    for (const source of pipeline.host.objects()) {
      if (!active(source)) continue;
      const existing = bindings.get(refKey(source));
      if (!existing || existing.signature !== signature(source) || !bindingIntact(existing)) ensure(source);
    }
  };

  const queueExit = (source: ObjectSnapshot) => {
    if (!bindings.has(refKey(source))) return;
    const k = refKey(source);
    pendingExits.set(k, source);
    recordUndo(() => { if (pendingExits.get(k) === source) pendingExits.delete(k); });
  };
  function flushExits() {
    if (depth !== 0 || !pendingExits.size) return;
    const exits = [...pendingExits.values()];
    pendingExits.clear();
    for (const source of exits) detach(source);
    reconcile();
  }

  const isEntry = (event: TimingEmission) => event.timingPoint === 'object-enters-board' || event.timingPoint === 'object-enters-chain';
  const isExit = (event: TimingEmission) => event.timingPoint === 'object-leaves-board' || event.timingPoint === 'object-killed';

  const observe = (emissions: readonly TimingEmission[], run: () => readonly PipelineEvent[]) => transaction(() => {
    for (const emission of emissions) if (emission.object && isEntry(emission)) ensure(emission.object);
    const events = run();
    for (const emission of emissions) if (emission.object && isExit(emission)) queueExit(emission.object);
    return events;
  });

  pipeline.emitBatch = ((emissions: readonly TimingEmission[], action?: GameAction, batchId?: string) =>
    observe(emissions, () => originalEmitBatch(emissions, action, batchId))) as typeof pipeline.emitBatch;
  pipeline.commit = ((action: GameAction) => transaction(() => {
    if (bindReplacementOnChain && action.type === 'move-zone' && action.to === 'chain') {
      const source = pipeline.host.objects().find(object => object.ref.id === action.object.id && object.ref.zoneEntryId === action.object.zoneEntryId);
      if (source && programExists(source)) attach(source, false, true);
    }
    return originalCommit(action);
  })) as typeof pipeline.commit;
  pipeline.deferTriggerScan = (<T>(run: () => T): T => {
    return transaction(() => originalDeferTriggerScan(run));
  }) as typeof pipeline.deferTriggerScan;

  // Do not pre-bind existing Board objects: legacy callers may deliberately
  // install a static through the public binder, and eager lifecycle ownership
  // would turn that supported path into a duplicate registration. Existing
  // objects are reconciled on their next real lifecycle boundary.

  return {
    detach() {
      if (detached) return;
      detached = true;
      pipeline.emitBatch = originalEmitBatch;
      pipeline.commit = originalCommit;
      pipeline.deferTriggerScan = originalDeferTriggerScan;
      pendingExits.clear();
      for (const binding of [...bindings.values()]) detach(binding.source);
    }
  };
}
