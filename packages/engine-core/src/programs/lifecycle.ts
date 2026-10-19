import type { ChainEngine } from '../chain/engine.js';
import type { ContractGameAction, GameAction, ObjectSnapshot } from '../effects/contract.js';
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
  const originalCommitContract = pipeline.commitContract.bind(pipeline);
  const originalDeferTriggerScan = pipeline.deferTriggerScan.bind(pipeline);
  const originalOnEvent = pipeline.onEvent;
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
  const effectList = () => engine.layers.registry.list();
  const programExists = (source: ObjectSnapshot) => registry.inspect(source.cardId) !== undefined;
  const currentForRef = (ref: ObjectSnapshot['ref']) => pipeline.host.objects().find(object => object.ref.id === ref.id && object.ref.zoneEntryId === ref.zoneEntryId) ?? null;
  const currentFor = (source: ObjectSnapshot) => currentForRef(source.ref);
  const active = (source: ObjectSnapshot) => source.zone === 'board' || source.zone === 'chain';

  const unregisterReplacementRegistrations = (ids: readonly string[]) => {
    if (ids.length === 0 || !ids.some(id => pipeline.hasReplacementRegistration(id))) return;
    const checkpoint = pipeline.checkpoint();
    for (const id of ids) checkpoint.replacements.delete(id);
    pipeline.restore(checkpoint);
  };

  const detach = (source: ObjectSnapshot) => {
    const k = refKey(source);
    const binding = bindings.get(k);
    if (!binding) return;
    unregisterProgramTriggers(engine, binding.triggerIds);
    for (const handle of binding.staticHandles) { try { handle.unbind(); } catch (error) { report(error, binding.source); } }
    for (const handle of binding.replacementHandles) { try { handle.unbind(); } catch (error) { report(error, binding.source); } }
    unregisterReplacementRegistrations(binding.replacementIds);
    bindings.delete(k);
  };

  const bindingIntact = (binding: Binding): boolean => {
    if (binding.triggerIds.some(id => !pipeline.hasTriggerRegistration(id))) return false;
    if (binding.staticEffectIds.some(id => engine.layers.registry.get(id) === undefined)) return false;
    if (binding.replacementIds.some(id => !pipeline.hasReplacementRegistration(id))) return false;
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
    const abilities = expandProgram(registry.get(source.cardId), source).abilities;
    const replacementAbilities = abilities.filter((ability): ability is Extract<typeof ability, { kind: 'replacement' }> => ability.kind === 'replacement');
    const expectedReplacementIds = bindReplacementOnChain && replacementAbilities.length > 0
      ? [`replacement:${source.ref.id}:${source.ref.zoneEntryId}`]
      : [];
    const replacementBefore = bindReplacement && !bindReplacementOnChain && replacementAbilities.length > 0
      ? pipeline.checkpoint().replacements
      : undefined;
    const staticHandles: StaticBindingHandle[] = [];
    const staticEffectIds: string[] = [];
    const replacementHandles: StaticBindingHandle[] = [];
    const replacementIds: string[] = [];
    try {
      if (bindStatic) {
        const before = new Set(effectList().map(entry => entry.effect.id));
        for (const ability of abilities) {
          if (ability.kind !== 'static') continue;
          try { staticHandles.push(bindStaticAbility(effectiveBinder, ability, source)); }
          catch (error) { report(error, source); }
        }
        for (const entry of effectList()) if (!before.has(entry.effect.id)) staticEffectIds.push(entry.effect.id);
      }
      if (bindReplacement) {
        for (const ability of replacementAbilities) {
          try {
            const handle = bindReplacementAbility(effectiveBinder, ability, source);
            replacementHandles.push(handle);
          }
          catch (error) { report(error, source); }
        }
        if (expectedReplacementIds.length > 0) {
          for (const id of expectedReplacementIds) if (pipeline.hasReplacementRegistration(id)) replacementIds.push(id);
        }
        else if (replacementBefore !== undefined) {
          const after = pipeline.checkpoint().replacements;
          for (const id of after.keys()) if (!replacementBefore.has(id)) replacementIds.push(id);
        }
      }
    } catch (error) {
      unregisterProgramTriggers(engine, triggerIds);
      for (const handle of staticHandles) { try { handle.unbind(); } catch { /* best effort */ } }
      for (const handle of replacementHandles) { try { handle.unbind(); } catch { /* best effort */ } }
      if (expectedReplacementIds.length > 0) {
        unregisterReplacementRegistrations(expectedReplacementIds);
      }
      else if (replacementBefore !== undefined) {
        const after = pipeline.checkpoint().replacements;
        unregisterReplacementRegistrations([...after.keys()].filter(id => !replacementBefore.has(id)));
      }
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
      unregisterReplacementRegistrations(binding.replacementIds);
      bindings.delete(k);
    });
    return binding;
  };

  const ensure = (source: ObjectSnapshot) => {
    const k = refKey(source);
    const existing = bindings.get(k);
    const current = effectiveBinder.sourceFor?.(source) ?? currentFor(source);
    if (!current || !programExists(current) || !active(current)) { if (existing) detach(existing.source); return; }
    if (existing && existing.signature === signature(current) && bindingIntact(existing)) return;
    if (existing) detach(existing.source);
    // Replacement abilities must be admitted while a permanent is on Chain.
    // The Chain commit hook installs them before its state transition. Static
    // layers become active only once the Board entry is authoritative.
    attach(current, current.zone === 'board', current.zone === 'board' || bindReplacementOnChain);
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
  }

  const syncCurrent = (source: ObjectSnapshot) => {
    const binding = bindings.get(refKey(source));
    if (!binding || !active(source) || binding.signature === signature(source)) return;
    detach(binding.source);
    attach(source, source.zone === 'board', source.zone === 'board' || bindReplacementOnChain);
  };
  const syncAction = (action: GameAction | ContractGameAction) => {
    if (action.type === 'batch') {
      for (const leaf of action.actions) syncAction(leaf);
      return;
    }
    if (!('object' in action) || action.type !== 'take-control') return;
    const current = currentForRef(action.object);
    if (current) syncCurrent(current);
  };

  const isEntry = (event: TimingEmission) => event.timingPoint === 'object-enters-board' || event.timingPoint === 'object-enters-chain';
  const isExit = (event: TimingEmission) => event.timingPoint === 'object-leaves-board' || event.timingPoint === 'object-killed';

  const observe = (emissions: readonly TimingEmission[], run: () => readonly PipelineEvent[]) => transaction(() => {
    // A lifecycle attached after initial setup can encounter a pre-existing
    // Board source in its first real event. Resolve only the emitted objects,
    // never the entire derived host view; entries install before publication,
    // and exits retain their registration through the suspended scan wave.
    for (const emission of emissions) if (emission.object && isEntry(emission)) ensure(emission.object);
    const events = run();
    for (const emission of emissions) if (emission.object && isExit(emission)) queueExit(emission.object);
    return events;
  });

  pipeline.emitBatch = ((emissions: readonly TimingEmission[], action?: GameAction, batchId?: string) =>
    observe(emissions, () => originalEmitBatch(emissions, action, batchId))) as typeof pipeline.emitBatch;
  pipeline.commit = ((action: GameAction) => transaction(() => {
    if (bindReplacementOnChain && action.type === 'move-zone' && action.to === 'chain') {
      const source = currentForRef(action.object);
      if (source && programExists(source)) {
        attach(source, false, true);
      }
    }
    const outcome = originalCommit(action);
    if (outcome.status === 'done' || outcome.status === 'replaced') syncAction(action);
    return outcome;
  })) as typeof pipeline.commit;
  pipeline.commitContract = ((action: ContractGameAction) => transaction(() => {
    // Initial Board objects have no earlier lifecycle edge. Resolve the exact
    // action objects once at the production transaction boundary so their
    // triggers exist before the suspended batch scan, without a per-event
    // evaluateAll over the host-derived layer view.
    const leaves = action.type === 'batch' ? action.actions : [action];
    for (const leaf of leaves) {
      if (!('object' in leaf)) continue;
      const source = currentForRef(leaf.object);
      if (source && programExists(source)) ensure(source);
    }
    const outcome = originalCommitContract(action);
    if (outcome.status === 'done' || outcome.status === 'replaced') syncAction(action);
    return outcome;
  })) as typeof pipeline.commitContract;
  pipeline.onEvent = event => {
    transaction(() => {
      // Leave events carry the pre-transition incarnation. Keep their source
      // registration installed through the whole suspended publish wave so it
      // can collect its own death trigger; flushExits detaches after scanning.
      if (event.object && !isExit(event)) syncCurrent(event.object);
      originalOnEvent?.(event);
      if (event.object && isEntry(event)) ensure(event.object);
      if (event.object && isExit(event)) queueExit(event.object);
    });
  };
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
      pipeline.commitContract = originalCommitContract;
      pipeline.onEvent = originalOnEvent;
      pipeline.deferTriggerScan = originalDeferTriggerScan;
      pendingExits.clear();
      for (const binding of [...bindings.values()]) detach(binding.source);
    }
  };
}
