// Shared harness for the RIFT-625 combat rule golden tests
// (docs/rules/scenarios/combat.yaml, CR v1.5 chapters 346-348 / 462-468 / 808 / 815-831).
//
// Subject under test: merged new-kernel layers only
//   * src/effects/testing/test-kernel.js  — the reference ResolveContext world
//   * src/events/                        — single event pipeline (trigger scan, action adapter)
//   * src/chain/                         — Pending / Finalize / Resolve, HOT FEPR, Focus
//   * src/turn/flow.js                   — TurnFlow driver over ChainEngine
//   * src/layers/                        — continuous effects (might arithmetic)
//   * src/combat/base-combat-allocation  — the merged combat-damage assignment kernel
//
// `src/duel/battlefields.js` is imported only as the canonical board factory that
// builds the `given` combat position for the assignment kernel, exactly like
// test/rules/scoring/harness.mjs and test/rules/movement/support.mjs do. The duel
// runtime is never the tested object here.
//
// No scenario settles damage, points or control by hand: positions come from the
// real entry/cleanup/Showdown path or from the canonical board factory, and every
// assertion reads a committed pipeline event, a trace step or a kernel snapshot.
import { world } from '../../../dist/effects/testing/test-kernel.js';
import { AwaitChoice } from '../../../dist/effects/contract.js';
import { bindResolveContext, createActionPipelineHost } from '../../../dist/events/action-adapter.js';
import { TurnFlow } from '../../../dist/turn/flow.js';
import { LayerEngine } from '../../../dist/layers/index.js';
import {
  assertDuelBaseCombatPlan, completeDuelBaseCombatAllocation, createTrustedDuelBaseCombatFacts,
  planDuelBaseCombatDamage, validateDuelBaseCombatAllocation, DuelBaseCombatBlockedError,
} from '../../../dist/combat/base-combat-allocation.js';
import {
  applyOpenDuelCleanup, assertDuelBoard, beginDuelCombat, createDuelBoard, placeDuelUnit,
} from '../../../dist/duel/battlefields.js';

export {
  AwaitChoice, DuelBaseCombatBlockedError, LayerEngine, assertDuelBaseCombatPlan,
  completeDuelBaseCombatAllocation, createTrustedDuelBaseCombatFacts, planDuelBaseCombatDamage,
  validateDuelBaseCombatAllocation, world,
};

/** card-dsl constant expression. */
export const c = value => ({ kind: 'constant', value });
/** effect.draw of a fixed amount (used by triggered abilities in the test scenes). */
export const drawInstruction = (id, amount = 1) => ({ id, op: 'effect.draw', args: { amount: c(amount) } });
/** effect.move of one explicit target to a fixed destination (CR 451). */
export const moveInstruction = (id, objectId, to) => ({
  id, op: 'effect.move', args: { objects: c({ target: id }), to: c(to) },
  targets: [{ id, filter: { objectId }, min: 1, max: 1 }],
});
/** effect.kill of one explicit target (CR 429.1.a.1). */
export const killInstruction = (id, objectId) => ({
  id, op: 'effect.kill', args: { target: id },
  targets: [{ id, filter: { objectId }, min: 1, max: 1 }],
});

const STARTING_ZONE_SIZE = 8;

/**
 * Real TurnFlow → ChainEngine → EventPipeline → interpreter wiring over the
 * reference kernel (same arrangement as test/turn/helpers.mjs).
 * `fields` are the two duel Battlefields with their initial controllers.
 */
export function flowFixture({ fields, setup, choose: chooseOption } = {}) {
  const builder = world().player('A').player('B')
    .base('source', { might: 2 }).base('enemySource', { owner: 'B', might: 2 });
  for (const player of ['A', 'B']) {
    builder.deck(Array.from({ length: STARTING_ZONE_SIZE }, (_, i) => `${player}:deck:${i}`), { owner: player });
    builder.rune(Array.from({ length: STARTING_ZONE_SIZE }, (_, i) => `${player}:rune:${i}`), { owner: player });
  }
  setup?.(builder);
  const kernel = builder.build();
  const answers = new Map();
  const asked = [];
  const choose = request => {
    asked.push(request);
    if (answers.has(request.id)) return answers.get(request.id);
    const supplied = chooseOption?.(request);
    if (supplied !== undefined) return supplied;
    if (request.type === 'select-objects' && request.min === request.max && request.options.length === request.min) {
      return [...request.options];
    }
    throw new AwaitChoice(request);
  };
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: saved => { kernel.restore(saved.state); kernel.copyLinkedFrom(saved.links); },
    objects: () => kernel.objects, perform: action => kernel.perform(action), choose,
    context: (source, controller, timingPoint) => bindResolveContext(kernel, { source, controller, timingPoint, choose }),
    testTrigger: registration => kernel.test(registration.spec.condition),
  });
  const flow = new TurnFlow({
    host, player: id => kernel.player(id), turnOrder: ['A', 'B'],
    battlefields: fields ?? [{ id: 'bf1', controller: null }, { id: 'bf2', controller: null }],
  });
  /** Activated ability of the turn player's own Main Phase (CR 316.5.b). */
  const activated = (id, body, options = {}) => ({
    id, controller: 'A', source: kernel.getObject('source'), kind: 'activated', speed: 'action', body, ...options,
  });
  /** Spell draft for a card in Hand; omitted `cost` uses the printed cost (CR 206). */
  const spell = (id, body, options = {}) => ({
    id: `spell-${id}`, controller: 'A', source: kernel.getObject(id), kind: 'spell', speed: 'reaction',
    body, ...options,
  });
  /** Mandatory trigger registered on the real shared event pipeline. */
  const trigger = (id, at, body, options = {}) => flow.chain.pipeline.registerTrigger({
    id, source: kernel.getObject(options.sourceId ?? 'source'), controller: options.controller ?? 'A',
    spec: { at, filter: options.filter ?? {} }, body,
  });
  return { kernel, host, flow, answers, asked, activated, spell, trigger };
}

/** Every committed pipeline event, in commit order. */
export const eventsOf = f => f.flow.chain.pipeline.events;
/** Mark the current event count so a later assertion can scope to new events. */
export const markEvents = f => eventsOf(f).length;
/** Timing points committed after `mark`. */
export const timingsAfter = (f, mark) => eventsOf(f).slice(mark).map(event => event.timingPoint);
/** Committed events for one timing point. */
export const eventsAt = (f, timingPoint) => eventsOf(f).filter(event => event.timingPoint === timingPoint);
/** Chain trace steps for one step name. */
export const traceSteps = (f, step) => f.flow.chain.trace.filter(entry => entry.step === step);

/**
 * Resolve the chain to emptiness through the turn driver: Pending items go
 * through HOT FEPR and finalized items through real Priority passes. Focus is
 * never passed, so a Showdown that opens stays open with its Focus holder.
 */
export function drainChain(f, budget = 60) {
  let guard = 0;
  while (guard++ < budget) {
    if (f.flow.chain.items.some(item => item.status === 'pending')) { f.flow.advance(); continue; }
    if (f.flow.chain.items.length) { f.flow.pass(f.flow.chain.priority); continue; }
    return;
  }
  throw new Error('drainChain did not reach an idle chain');
}

// ---------------------------------------------------------------------------
// Combat-damage assignment kernel (src/combat/base-combat-allocation.ts).
// The canonically shaped board is built through the duel board factory as the
// `given` position; the tested object is the merged assignment kernel.
// ---------------------------------------------------------------------------
/**
 * Build an actually-active Combat at the first Battlefield with the given Units.
 * `attackers` are controlled by A (the player who applied Contested, CR 466.2.c.1),
 * `defenders` by B. `marks` are damage already marked on the Unit (CR 143.3).
 */
export function combatScene({ attackers = [], defenders = [], stateVersion = 7 } = {}) {
  let board = createDuelBoard({
    selected: [
      { playerId: 'A', instanceId: 'field:1', cardId: 'field-print:1' },
      { playerId: 'B', instanceId: 'field:2', cardId: 'field-print:2' },
    ],
    removedByPlayer: [
      { playerId: 'A', battlefields: [{ instanceId: 'field:3', cardId: 'field-print:3' }, { instanceId: 'field:4', cardId: 'field-print:4' }] },
      { playerId: 'B', battlefields: [{ instanceId: 'field:5', cardId: 'field-print:5' }, { instanceId: 'field:6', cardId: 'field-print:6' }] },
    ],
  });
  const fieldId = board.battlefields[0].locationId;
  const unitMeta = {};
  const declared = new Map();
  const place = (unit, controller) => {
    board = placeDuelUnit(board, { objectId: unit.uid, controllerPlayerId: controller, locationId: fieldId });
    unitMeta[unit.uid] = {
      ownerPlayerId: controller, readied: true,
      trait: { kind: 'unit', name: unit.uid, baseMight: unit.might, tags: [] },
      damageMarks: (unit.marks ?? []).map(amount => ({ amount, responsiblePlayerId: controller === 'A' ? 'B' : 'A', sourceObjectIds: ['spell:scene'] })),
    };
    declared.set(unit.uid, unit.might);
  };
  for (const unit of attackers) place({ ...unit, might: unit.might ?? 0 }, 'A');
  for (const unit of defenders) place({ ...unit, might: unit.might ?? 0 }, 'B');
  board = applyOpenDuelCleanup(board);
  board = beginDuelCombat(board, fieldId);
  assertDuelBoard(board);
  return {
    state: { stateVersion, board, unitMeta }, fieldId, might: declared,
    attackerIds: attackers.map(unit => unit.uid), defenderIds: defenders.map(unit => unit.uid),
  };
}

/**
 * Trusted assignment facts bound to one scene (CR 467.2.c.2). `currentMight`
 * mirrors what a sourced evaluator returns for each Unit; tests override it to
 * model a merged layer result (for example the arithmetic layer's Might floor).
 */
export function bindScene(scene, { currentMight, proveBasicCombat } = {}) {
  return createTrustedDuelBaseCombatFacts(scene.state.stateVersion, scene.fieldId, {
    currentMight: unit => (currentMight ? currentMight(unit) : scene.might.get(unit.uid)),
    proveBasicCombat: proveBasicCombat ?? (() => ({
      currentMight: 'validated', assignmentModifier: 'proven-none',
      preventionReplacement: 'proven-none', keywordPriority: 'proven-none',
    })),
  });
}

/** `{ uid, amount }` allocation entry. */
export const amount = (uid, points) => ({ uid, amount: points });

/** Capture the explicit blocked code of a rejected allocation (never a silent failure). */
export function blockedCode(callback) {
  try { callback(); }
  catch (error) {
    if (error instanceof DuelBaseCombatBlockedError) return error.code;
    throw error;
  }
  throw new Error('Expected the assignment kernel to reject this allocation');
}

/**
 * Evaluate a merged continuous-layer scene: base snapshots plus registered
 * arithmetic effects, read back through src/layers.
 */
export function layeredMight(base, effects) {
  const kernel = world()
    .player('A').player('B')
    .unit(base.id, { owner: base.owner ?? 'A', might: base.might, location: base.location ?? { type: 'battlefield', id: 'bf1' } })
    .build();
  const engine = new LayerEngine(kernel.objects);
  for (const entry of effects) {
    engine.registry.register(entry.effect, entry.duration ?? { type: 'end-of-combat' }, entry.timestamp ?? 1);
  }
  engine.setObjects(kernel.objects);
  return { kernel, engine, snapshot: engine.evaluate(kernel.ref(base.id)) };
}
