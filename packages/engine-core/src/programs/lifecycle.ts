import type { CardProgram } from '@riftbound/card-dsl';
import type { ChainEngine } from '../chain/engine.js';
import type { ContractGameAction, GameAction, ObjectSnapshot } from '../effects/contract.js';
import type { PipelineEvent, TimingEmission } from '../events/pipeline-types.js';
import { bindReplacementAbility, bindStaticAbility, createEngineStaticBinder, type ProgramStaticBinder, type StaticBindingHandle } from './statics.js';
import { ProgramRegistry } from './registry.js';
import { triggerRegistrations, unregisterProgramTriggers } from './triggers.js';
import { expandProgram } from './keywords.js';
import { ProgramBindingError } from './errors.js';

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
  const playFollowers = new Set<string>();
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
  // A same-incarnation Move changes only its location. Static filters bind a
  // live source anchor, so rebuilding the registration here would reset its
  // sequence/timestamp and can duplicate a public aura during the transition.
  // Trigger and rule filters also resolve their controller from the live host,
  // so a same-incarnation control change must not rebuild a registered aura.
  // The zone is part of the signature because it selects the trigger's active
  // zone; incarnation is already part of the map key.
  const signature = (source: ObjectSnapshot) => JSON.stringify({ owner: source.owner, zone: source.zone });
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
  const handFollowers = (source: ObjectSnapshot) => [...bindings.values()].filter(binding =>
    binding.source.ref.id === source.ref.id && binding.source.zone === 'hand' &&
    playFollowers.has(refKey(binding.source)));
  const secretZone = (source: ObjectSnapshot) => source.zone === 'deck' || source.zone === 'rune-deck';
  const isLegend = (source: ObjectSnapshot) => source.types.some(type => type.toLowerCase() === 'legend');
  const isActiveLegend = (source: ObjectSnapshot) => isLegend(source) && source.zone === 'legend';
  const active = (source: ObjectSnapshot) => isActiveLegend(source) ||
    !isLegend(source) && (source.zone === 'board' || source.zone === 'chain' || secretZone(source));
  const secretZoneReplacement = (ability: CardProgram['abilities'][number], source: ObjectSnapshot): boolean => {
    if (ability.kind !== 'replacement') return false;
    const pattern = ability.replaces;
    const event = pattern.event ?? pattern.type ?? pattern.kind;
    // A replacement effect is active in a Secret Zone only for an event that
    // involves the host while it is there (CR 370.1.c.1). The published card
    // IR spells this as card-revealed with either a zone filter or a self
    // player/source anchor. Other abilities on the same program are inactive
    // in Deck/Rune Deck and must not make initialization expand their bodies.
    if (event !== 'card-revealed') return false;
    const filter = typeof pattern.filter === 'object' && pattern.filter !== null ? pattern.filter as Record<string, unknown> : undefined;
    const nested = filter && typeof filter.filter === 'object' && filter.filter !== null ? filter.filter as Record<string, unknown> : undefined;
    const zone = filter?.zone ?? nested?.zone;
    const self = filter?.source === 'self' || filter?.player === 'self' || pattern.player === 'self' ||
      nested?.source === 'self' || nested?.player === 'self';
    return zone === source.zone || (zone === undefined && self);
  };
  const secretZoneAbilities = (program: CardProgram, source: ObjectSnapshot): ReturnType<typeof expandProgram>['abilities'] => {
    return program.abilities.filter(ability => secretZoneReplacement(ability, source));
  };

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
    unregisterReplacementRegistrations(binding.replacementIds);
    for (const handle of binding.replacementHandles) { try { handle.unbind(); } catch (error) { report(error, binding.source); } }
    bindings.delete(k);
    playFollowers.delete(k);
  };

  const bindingIntact = (binding: Binding): boolean => {
    if (binding.triggerIds.some(id => !pipeline.hasTriggerRegistration(id))) return false;
    if (binding.staticEffectIds.some(id => engine.layers.registry.get(id) === undefined)) return false;
    if (binding.replacementIds.some(id => !pipeline.hasReplacementRegistration(id))) return false;
    return true;
  };

  const registerTriggersIndividually = (program: ReturnType<ProgramRegistry['get']>, source: ObjectSnapshot, abilities: ReturnType<typeof expandProgram>['abilities']): readonly string[] => {
    const ids: string[] = [];
    for (const [index, ability] of abilities.entries()) {
      if (ability.kind !== 'triggered') continue;
      try {
        // Bind each expanded trigger through the normal program adapter. A
        // keyword skeleton with a currently unsupported filter must not erase
        // an unrelated, executable static or replacement on the same card.
        const isolated = new ProgramRegistry([{ ...program, status: 'executable', sourceText: '[lifecycle isolated trigger]', abilities: [ability] }]);
        const [registration] = triggerRegistrations(isolated, source);
        if (!registration) throw new Error('Trigger adapter returned no registration');
        const id = `program:${source.ref.id}:${source.ref.zoneEntryId}:${index}`;
        // Legends have Passive/Triggered/Activated abilities in the Legend
        // Zone (CR 107.4.c, 174.6-174.8). The generic permanent adapter defaults
        // to Board, so bind this exact Legend incarnation to its actual zone.
        const activeZones = isActiveLegend(source) ? ['legend'] : registration.activeZones;
        try { pipeline.registerTrigger({ ...registration, id, ...(activeZones === undefined ? {} : { activeZones }) }); }
        catch (error) {
          if (!(error instanceof Error) || error.message !== `Duplicate trigger ${id}`) throw error;
        }
        ids.push(id);
      } catch (error) {
        report(error, source);
      }
    }
    return ids;
  };

  const attach = (source: ObjectSnapshot, bindStatic: boolean, bindReplacement: boolean): Binding | undefined => {
    const program = registry.inspect(source.cardId);
    if (!program) {
      // No program means this object contributes no lifecycle surface. Synthetic
      // tokens and neutral setup objects are valid Board/Chain sources; a real
      // registered judge-required program is handled below and still blocks.
      detach(source);
      return undefined;
    }
    if (!secretZone(source) && program.status !== 'executable') {
      const reason = program.status === 'judge-required'
        ? (program.judgeReason ?? `Card program ${program.canonicalCardId} requires a judge`)
        : `Card program ${program.canonicalCardId} has no executable ability`;
      report(new ProgramBindingError('judge-required', reason, program), source);
      detach(source);
      return undefined;
    }
    const k = refKey(source);
    const existing = bindings.get(k);
    if (existing && existing.signature === signature(source) && bindingIntact(existing)) return existing;
    if (existing) detach(existing.source);

    let abilities: ReturnType<typeof expandProgram>['abilities'];
    try {
      if (secretZone(source)) {
        // Only replacement effects that actually operate from this Secret
        // Zone are evaluated. In particular, do not expand unrelated static,
        // triggered, keyword, or play bodies merely because the card happens
        // to be in Deck/Rune Deck.
        abilities = bindReplacement ? secretZoneAbilities(program, source) : [];
        if (abilities.length === 0) { detach(source); return undefined; }
      } else {
        const bound: ReturnType<typeof expandProgram>['abilities'] = expandProgram(program, source).abilities;
        // A Legend is neither a Unit nor Gear. Its live surface consists of its
        // Passive, Triggered, and Activated abilities (CR 174.6-174.8); Play
        // and Replacement abilities must not become active merely because the
        // object shares the generic program lifecycle.
        abilities = isActiveLegend(source)
          ? bound.filter(ability => ability.kind === 'static' || ability.kind === 'triggered' || ability.kind === 'activated')
          : bound;
      }
    } catch (error) {
      report(error, source);
      return undefined;
    }
    const triggerIds = registerTriggersIndividually(program, source, abilities);
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
      unregisterReplacementRegistrations(binding.replacementIds);
      for (const handle of binding.replacementHandles) { try { handle.unbind(); } catch { /* best effort */ } }
      bindings.delete(k);
    });
    return binding;
  };

  const ensure = (source: ObjectSnapshot, useEntryHandoff = false) => {
    // Entry emissions can carry an older incarnation while the authoritative
    // host already exposes the new one. `sourceFor` exists for that hand-off; it
    // must never resolve an exact registered incarnation into a successor.
    const current = useEntryHandoff
      ? effectiveBinder.sourceFor?.(source) ?? currentFor(source)
      : currentFor(source);
    const k = refKey(current ?? source);
    const existing = bindings.get(k);
    if (!current || !active(current)) { if (existing) detach(existing.source); return; }
    // A replacement admitted while the card was in Hand follows its newest
    // incarnation by id. Replacing it with a Chain registration would lose the
    // pre-transition admission needed to replace the later Board entry.
    if (current.zone === 'chain' && handFollowers(current).length > 0) return;
    if (existing && existing.signature === signature(current) && bindingIntact(existing)) return;
    if (existing) detach(existing.source);
    // Replacement abilities must be admitted while a permanent is on Chain.
    // The Chain commit hook installs them before its state transition. Static
    // layers become active only once the Board entry is authoritative.
    const attached = attach(current, current.zone === 'board' || isActiveLegend(current),
      current.zone === 'board' || isActiveLegend(current) ||
      (bindReplacementOnChain && (current.zone === 'chain' || secretZone(current))));
    // The Hand registration follows the card by id only so it can intercept the
    // Board entry move. Once the exact Board incarnation owns its registration,
    // retire the temporary follower so later exits cannot detach the new host.
    if (attached && current.zone === 'board') {
      for (const follower of handFollowers(current)) detach(follower.source);
    }
  };

  const queueExit = (source: ObjectSnapshot) => {
    // A Hand binder is the entry-replacement follower. It remains through
    // Hand -> Chain -> Board; detaching it on the Hand leave would prevent the
    // production replacement adapter from intercepting the Board move.
    if (source.zone === 'hand') return;
    const current = pipeline.host.objects().find(object => object.ref.id === source.ref.id) ?? null;
    // The Chain-to-Board handoff retains its Chain trigger registration in the
    // existing lifecycle contract. It is retired together with the Board
    // incarnation if that host later leaves; ordinary Chain exits still detach.
    if (source.zone === 'chain' && current?.zone === 'board') return;
    const keep = current === null ? null : refKey(current);
    for (const [k, binding] of bindings) {
      if (binding.source.ref.id !== source.ref.id || k === keep) continue;
      pendingExits.set(k, binding.source);
      recordUndo(() => { if (pendingExits.get(k) === binding.source) pendingExits.delete(k); });
    }
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
    // A same-zone snapshot has already crossed its lifecycle entry boundary.
    // Later timing-only emissions must not rebuild registrations merely because
    // the mutable host snapshot no longer carries an incidental field.
    if (binding.source.zone === source.zone) return;
    if (source.zone === 'chain' && handFollowers(source).length > 0) return;
    detach(binding.source);
    attach(source, source.zone === 'board' || isActiveLegend(source),
      source.zone === 'board' || isActiveLegend(source) || bindReplacementOnChain);
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

  const isEntry = (event: TimingEmission) => event.timingPoint === 'object-enters-board' || event.timingPoint === 'object-enters-chain' ||
    event.timingPoint === 'object-enters-deck' || event.timingPoint === 'object-enters-rune-deck' ||
    event.timingPoint === 'object-enters-zone' && event.object?.zone === 'legend';
  const isExit = (event: TimingEmission) => event.timingPoint === 'object-leaves-board' || event.timingPoint === 'object-killed' ||
    event.timingPoint === 'object-leaves-deck' || event.timingPoint === 'object-leaves-rune-deck' ||
    event.timingPoint === 'object-leaves-zone' && event.object?.zone === 'legend';

  const actionLeaves = (action: GameAction | ContractGameAction): readonly (GameAction | ContractGameAction)[] =>
    (action as { type?: string }).type === 'batch'
      ? (action as Extract<ContractGameAction, { type: 'batch' }>).actions
      : [action];
  const canLeaveBoard = (action: GameAction | ContractGameAction): boolean => {
    const leaves = actionLeaves(action);
    if (leaves.length !== 1 || leaves[0] !== action) return leaves.some(canLeaveBoard);
    if (['kill', 'banish', 'return-to-hand', 'discard', 'recycle'].includes(action.type)) return true;
    return action.type === 'move-zone' && !['base', 'battlefield'].includes(action.to);
  };

  const observe = (emissions: readonly TimingEmission[], run: () => readonly PipelineEvent[]) => transaction(() => {
    // A lifecycle attached after initial setup can encounter a pre-existing
    // Board source in its first real event. Resolve only the emitted objects,
    // never the entire derived host view; entries install before publication,
    // and exits retain their registration through the suspended scan wave.
    for (const emission of emissions) if (emission.object && isEntry(emission)) ensure(emission.object, true);
    const events = run();
    for (const emission of emissions) if (emission.object && isExit(emission)) queueExit(emission.object);
    return events;
  });

  pipeline.emitBatch = ((emissions: readonly TimingEmission[], action?: GameAction, batchId?: string) =>
    observe(emissions, () => originalEmitBatch(emissions, action, batchId))) as typeof pipeline.emitBatch;
  pipeline.commit = ((action: GameAction) => transaction(() => {
    if (bindReplacementOnChain && action.type === 'play') {
      const source = currentForRef(action.object);
      if (source?.zone === 'hand' && programExists(source)) {
        const follower = attach(source, false, true);
        if (follower) playFollowers.add(refKey(follower.source));
      }
    }
    if (bindReplacementOnChain && action.type === 'move-zone' && action.to === 'chain') {
      const source = currentForRef(action.object);
      const followsFromHand = source !== null && handFollowers(source).length > 0;
      if (source && !followsFromHand) {
        attach(source, false, true);
      }
    }
    if (canLeaveBoard(action)) {
      const leaves = actionLeaves(action);
      for (const leaf of leaves) {
        if (!('object' in leaf)) continue;
        const source = currentForRef(leaf.object);
        // This pre-commit pass exists only to retain a Board source through its
        // suspended exit wave. Chain and Secret-Zone transitions have their own
        // entry/handoff rules and must not detach an entry follower here.
        if (source?.zone === 'board') ensure(source);
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
      if (source) ensure(source);
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
      if (event.object && isEntry(event)) ensure(event.object, true);
      if (event.object && isExit(event)) queueExit(event.object);
    });
  };
  pipeline.deferTriggerScan = (<T>(run: () => T): T => {
    return transaction(() => originalDeferTriggerScan(run));
  }) as typeof pipeline.deferTriggerScan;

  // Main Deck and Rune Deck replacement effects are active only for an event
  // that involves that same card while it is there (CR 370.1.c.1). Legends
  // established by setup predate lifecycle attachment, so install their live
  // Legend-zone surface during the initial scan too.
  for (const source of pipeline.host.objects()) {
    if (secretZone(source) || isActiveLegend(source)) ensure(source);
  }

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
      playFollowers.clear();
      for (const binding of [...bindings.values()]) detach(binding.source);
    }
  };
}
