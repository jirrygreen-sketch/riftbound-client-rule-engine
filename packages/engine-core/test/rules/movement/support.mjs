// Shared harness for the RIFT-276 movement rule golden tests.
//
// Object under test: the merged new-layer modules only
// (effects/testing reference kernel, events/*, chain/*, turn/*, zones/*).
// The `src/duel/` tree is never the subject; where `zones/movement.ts` still
// consumes a DuelBoard, the duel module is used exclusively as the `given`
// board factory, exactly like `test/zones/standard-move.test.mjs` does.
import { world } from '../../../dist/effects/testing/test-kernel.js';
import { AwaitChoice } from '../../../dist/effects/contract.js';
import { bindResolveContext, createActionPipelineHost } from '../../../dist/events/action-adapter.js';
import { TurnFlow } from '../../../dist/turn/flow.js';
import {
  applyOpenDuelCleanup, beginDuelShowdown, createDuelBoard, placeDuelUnit, selectDuelBattlefields,
} from '../../../dist/duel/battlefields.js';
import { moveDuelUnitsStandard } from '../../../dist/zones/movement.js';

/** Constant expression used by every EffectIR argument. */
export const c = value => ({ kind: 'constant', value });
/** effect.move of one explicit target to a fixed destination (CR 451). */
export const moveInstruction = (id, objectId, to) => ({
  id, op: 'effect.move', args: { objects: c({ target: id }), to: c(to) },
  targets: [{ id, filter: { objectId }, min: 1, max: 1 }],
});

/**
 * Two-player world over the real TurnFlow -> ChainEngine -> EventPipeline ->
 * interpreter -> primitives path (same wiring as `test/turn/helpers.mjs`).
 */
export function fixture({
  fields = [{ id: 'bf1', controller: null }, { id: 'bf2', controller: null }],
  score = {}, setup, deck = true, runes = true,
} = {}) {
  const builder = world().player('A', { score: score.A ?? 0 }).player('B', { score: score.B ?? 0 })
    .base('source', { might: 4, energy: 0, power: [] })
    .base('enemy', { owner: 'B', might: 4, energy: 0, power: [] });
  if (deck) for (const player of ['A', 'B']) {
    builder.deck(Array.from({ length: 8 }, (_, index) => `${player}:deck:${index}`), { owner: player });
  }
  if (runes) for (const player of ['A', 'B']) {
    builder.rune(Array.from({ length: 8 }, (_, index) => `${player}:rune:${index}`), { owner: player });
  }
  setup?.(builder);
  const kernel = builder.build();
  const answers = new Map();
  const choose = request => {
    if (answers.has(request.id)) return answers.get(request.id);
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
  const flow = new TurnFlow({ host, player: id => kernel.player(id), turnOrder: ['A', 'B'], battlefields: fields });
  /** Rules-generated `add` ability: resolves immediately on Finalize (430.2). */
  const add = body => ({
    id: `add-${kernel.events.length}`, controller: 'A', source: kernel.getObject('source'),
    kind: 'add', speed: 'normal', body,
  });
  /** Activated ability of the turn player's own Main Phase (CR 316.5.b). */
  const activated = (id, body, options = {}) => ({
    id, controller: 'A', source: kernel.getObject('source'), kind: 'activated', speed: 'normal', body, ...options,
  });
  /** Playing a hand card; `location` is the chosen Play Destination (CR 355.2). */
  const play = (id, kind, location) => ({
    id: `play-${id}`, controller: 'A', source: kernel.getObject(id), kind, speed: 'normal', body: [],
    ...(location === undefined ? {} : { location }),
  });
  /** Reaction-speed spell of the non-turn player with an explicit free cost. */
  const reaction = (id, body) => ({
    id: `reaction-${id}`, controller: 'B', source: kernel.getObject(id), kind: 'spell', speed: 'reaction', body,
    cost: { id: `cost:${id}`, cost: { energy: c(0), power: c([]) } },
  });
  return { kernel, host, flow, answers, add, activated, play, reaction };
}

/** Run HOT FEPR to quiescence through the real driver. */
export function settle(flow) {
  let budget = 0;
  while (flow.chain.items.length) {
    if (++budget > 100) throw new Error('Nonterminating test chain');
    flow.pass(flow.chain.priority);
  }
  flow.advance();
}

/**
 * Resolve the pending chain through the real HOT FEPR pass/resolve path without
 * letting the driver step into a staged Combat (which is still blocked).
 */
export function resolveChainOnly(flow) {
  let budget = 0;
  while (flow.chain.items.length) {
    if (++budget > 100) throw new Error('Nonterminating test chain');
    flow.chain.pass(flow.chain.priority);
  }
}

export const timings = flow => flow.chain.pipeline.events.map(event => event.timingPoint);
export const eventsOf = (flow, timingPoint) => flow.chain.pipeline.events.filter(event => event.timingPoint === timingPoint);
export const pendingItems = flow => flow.chain.trace.filter(event => event.step === 'pending').map(event => event.item);

// ---------------------------------------------------------------------------
// zones-layer Standard Move kernel (src/zones/movement.ts).
// The duel board factory is `given` construction only; the subject is the
// merged zones kernel, mirroring test/zones/standard-move.test.mjs.
// ---------------------------------------------------------------------------
const SEATS = () => [
  { playerId: 'A', battlefields: [{ instanceId: 'a-1', cardId: 'printing-x' }, { instanceId: 'a-2', cardId: 'printing-y' }, { instanceId: 'a-3', cardId: 'printing-z' }] },
  { playerId: 'B', battlefields: [{ instanceId: 'b-1', cardId: 'printing-x' }, { instanceId: 'b-2', cardId: 'printing-y' }, { instanceId: 'b-3', cardId: 'printing-z' }] },
];

/** Real 485.4-5 selection + createDuelBoard, with A's battlefield first. */
export function duelWorld() {
  const board = createDuelBoard(selectDuelBattlefields(SEATS(), () => 0));
  const baseA = board.bases.find(base => base.ownerPlayerId === 'A').locationId;
  const baseB = board.bases.find(base => base.ownerPlayerId === 'B').locationId;
  return {
    board, baseA, baseB,
    bf1: board.battlefields[0].locationId,
    bf2: board.battlefields[1].locationId,
    place: (current, objectId, controller, locationId) => placeDuelUnit(current, { objectId, controllerPlayerId: controller, locationId }),
  };
}

/** Trusted timing derived by the caller; 312.2.a grants Priority to the turn player. */
export const mainTiming = (actor, overrides = {}) => ({
  phase: 'main', stateOpen: true, turnPlayerId: actor, priorityPlayerId: actor, ...overrides,
});

/** Readiness mirrors board.units exactly; `ganking`/`exhausted` list objectIds. */
export const readinessFor = (board, { ganking = [], exhausted = [] } = {}) => board.units.map(unit => ({
  objectId: unit.objectId,
  readied: !exhausted.includes(unit.objectId),
  hasGanking: ganking.includes(unit.objectId),
}));

/** One Standard Move group action through the merged zones kernel (CR 144). */
export function performStandardMove(board, readiness, actor, unitUIDs, destinationLocationId, timing = mainTiming(actor)) {
  return moveDuelUnitsStandard(board, readiness, { actor, unitUIDs, destinationLocationId, timing });
}

export { applyOpenDuelCleanup, beginDuelShowdown, moveDuelUnitsStandard };
