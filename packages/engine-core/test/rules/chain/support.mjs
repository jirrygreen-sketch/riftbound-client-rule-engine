// Shared harness for the RIFT-621 chain-chapter rule golden tests.
//
// Object under test: only the merged, non-duel layers
//   * src/effects/testing/test-kernel.js  — RIFT-46 reference kernel (`world`)
//   * src/events/action-adapter.js        — the single event pipeline host
//   * src/events/pipeline.js + src/chain/engine.js — HOT FEPR (Pending → Finalize → Resolve)
//   * src/turn/flow.js                    — the CR v1.5 turn driver over ChainEngine
// The legacy src/duel/ tree is never the subject of these tests.
//
// Positions are built only through the kernel builder; every settlement goes
// through a real committed GameAction or the ChainEngine driver. The cleanup
// hook below commits the ordinary lethal-damage Kill action (CR 323.4) rather
// than editing damage or zones by hand.
import { world } from '../../../dist/effects/testing/test-kernel.js';
import { AwaitChoice } from '../../../dist/effects/contract.js';
import { bindResolveContext, createActionPipelineHost } from '../../../dist/events/action-adapter.js';
import { ChainEngine } from '../../../dist/chain/engine.js';
import { TurnFlow } from '../../../dist/turn/flow.js';

export { world, AwaitChoice, ChainEngine, TurnFlow };

/** card-dsl constant expression */
export const c = value => ({ kind: 'constant', value });

/** `effect.draw` — a Draw action performed by the resolving context's controller. */
export const drawInstruction = (id = 'draw', amount = 1) => ({
  id, op: 'effect.draw', args: { amount: c(amount) },
});

/** `effect.damage` of one explicit object, so no unrelated Unit can be chosen. */
export const damageInstruction = (id, amount, objectId, targetId = 'victim') => ({
  id, op: 'effect.damage', args: { amount: c(amount), target: targetId },
  targets: [{ id: targetId, filter: { objectId }, max: 1 }],
});

/** `effect.counter` of one explicit finalized Chain Item (CR 355.9.a.2). */
export const counterInstruction = (id, objectId, targetId = 'spell') => ({
  id, op: 'effect.counter', args: { target: targetId },
  targets: [{ id: targetId, filter: { zone: 'chain', type: 'spell', objectId }, max: 1 }],
});

/** `gain-energy` inside `effect.repeat` — the merged op that Adds resources. */
export const addEnergyInstruction = (id, player = 'A', amount = 1) => ({
  id, op: 'effect.repeat',
  args: { count: c(1), action: { type: 'gain-energy', player: c(player), amount: c(amount) } },
});

/**
 * A two-player reference kernel plus a ChainEngine over the real pipeline.
 * `board(builder)` adds the given Objects; `choose` may answer ChoiceRequests,
 * otherwise the call suspends with `AwaitChoice` so the test can answer later.
 */
export function chainFixture({ energy = { A: 0, B: 0 }, cards = [], board, deck = 6, runes = 0, choose, turnPlayer = 'A' } = {}) {
  const builder = world()
    .player('A', { energy: energy.A ?? 0 })
    .player('B', { energy: energy.B ?? 0 })
    .base('source', { energy: 0, power: [], might: 3, types: ['unit'] })
    .base('enemy', { owner: 'B', might: 5, energy: 0, power: [], types: ['unit'] });
  for (const player of ['A', 'B']) {
    builder.deck(Array.from({ length: deck }, (_, index) => `${player}:deck:${index}`), { owner: player });
    if (runes) builder.rune(Array.from({ length: runes }, (_, index) => `${player}:rune:${index}`), { owner: player });
  }
  for (const card of cards) builder.hand(card.id, { energy: 1, power: [], ...card });
  board?.(builder);
  const kernel = builder.build();

  const answers = new Map();
  const asked = [];
  const decide = request => {
    asked.push(request);
    if (answers.has(request.id)) return answers.get(request.id);
    if (choose) {
      const answer = choose(request, kernel);
      if (answer !== undefined) return answer;
    }
    if (request.type === 'select-objects' && request.min === request.max && request.options.length === request.min) {
      return [...request.options];
    }
    throw new AwaitChoice(request);
  };
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: checkpoint => { kernel.restore(checkpoint.state); kernel.copyLinkedFrom(checkpoint.links); },
    objects: () => kernel.objects,
    perform: action => kernel.perform(action),
    choose: decide,
    context: (source, controller, timingPoint) => bindResolveContext(kernel, { source, controller, timingPoint, choose: decide }),
    testTrigger: registration => kernel.test(registration.spec.condition),
  });
  /** CR 323.4: a Cleanup kills a Unit whose damage is at least its Might, via a real Kill. */
  const lethalCleanup = engine => {
    let changed = false;
    engine.layers.setObjects(kernel.objects);
    for (const object of engine.layers.evaluateAll()) {
      if (object.zone === 'board' && object.types.includes('unit') && object.might !== null &&
        (object.might <= 0 || object.damage >= object.might)) {
        const before = kernel.ref(object.ref.id);
        engine.commit({ type: 'kill', object: object.ref });
        changed ||= kernel.ref(object.ref.id).zoneEntryId !== before.zoneEntryId;
      }
    }
    return changed;
  };
  const engine = new ChainEngine({ turnOrder: ['A', 'B'], turnPlayer, phase: 'main', host, cleanup: lethalCleanup });

  /** Activated ability of the fixture's own Board object (Board source). */
  const activated = (id, body = [], options = {}) => ({
    id, controller: 'A', source: kernel.getObject('source'), kind: 'activated', speed: 'reaction', body, ...options,
  });
  /** Play a card from Hand; `options.cost` overrides the printed cost when needed. */
  const spell = (id, body = [], options = {}) => ({
    id, controller: 'A', source: kernel.getObject(id), kind: 'spell', speed: 'normal', body, ...options,
  });
  /** Play a Unit from Hand into Base by default (CR 355.2). */
  const unit = (id, body = [], options = {}) => ({
    id, controller: 'A', source: kernel.getObject(id), kind: 'unit', speed: 'normal', body,
    location: { type: 'base', player: 'A' }, ...options,
  });
  return { kernel, host, engine, answers, asked, activated, spell, unit };
}

/** Register one triggered ability on the real pipeline. */
export function registerTrigger(engine, kernel, { id, source = 'source', controller = 'A', spec, body, ...rest }) {
  return engine.pipeline.registerTrigger({
    id, source: kernel.getObject(source), controller, spec, body, ...rest,
  });
}

/** The committed `PipelineEvent`s of this engine, in commit order. */
export const eventsOf = engine => engine.pipeline.events;

/** Committed timing points, in commit order. */
export const timings = engine => eventsOf(engine).map(event => event.timingPoint);

/** Chain lifecycle reduced to `step:item` pairs (`removed` keeps its reason). */
export const stages = engine => engine.trace
  .filter(event => ['pending', 'finalized', 'resolved', 'removed'].includes(event.step))
  .map(event => `${event.step}:${event.item}${event.reason ? `(${event.reason})` : ''}`);

/** Pass Priority until the Chain is empty (LIFO resolution, CR 340.1). */
export function resolveAll(engine, budget = 60) {
  let guard = 0;
  while (engine.items.length) {
    if (++guard > budget) throw new Error('Nonterminating test chain');
    engine.pass(engine.priority);
  }
}

/**
 * Run the HOT FEPR to quiescence: advance the Finalize step, then pass Priority
 * until the Chain is empty. Used when items were added by a commit rather than
 * by execute(), which already advances.
 */
export function settle(engine, budget = 60) {
  let guard = 0;
  while (true) {
    if (++guard > budget) throw new Error('Nonterminating test chain');
    if (!engine.items.length) return;
    engine.advance();
    engine.pass(engine.priority);
  }
}

/** Assert that `expected` appears inside `actual` in order (YAML `ordered: subsequence`). */
export function assertSubsequence(actual, expected) {
  let cursor = 0;
  for (const entry of expected) {
    const index = actual.indexOf(entry, cursor);
    if (index < 0) throw new Error(`Missing ${JSON.stringify(entry)} after index ${cursor} in ${JSON.stringify(actual)}`);
    cursor = index + 1;
  }
}

/**
 * A TurnFlow over the reference kernel, for the scenarios whose driver is the
 * CR v1.5 turn structure (305/335) rather than the bare ChainEngine.
 */
export function turnFixture({ energy = { A: 0, B: 0 }, cards = [], deck = 4, runes = 2, board, choose } = {}) {
  const builder = world()
    .player('A', { energy: energy.A ?? 0 })
    .player('B', { energy: energy.B ?? 0 })
    .base('source', { energy: 0, power: [], might: 4, types: ['unit'] });
  for (const player of ['A', 'B']) {
    builder.deck(Array.from({ length: deck }, (_, index) => `${player}:deck:${index}`), { owner: player });
    if (runes) builder.rune(Array.from({ length: runes }, (_, index) => `${player}:rune:${index}`), { owner: player });
  }
  for (const card of cards) builder.hand(card.id, { energy: 0, power: [], ...card });
  board?.(builder);
  const kernel = builder.build();
  const answers = new Map();
  const decide = request => {
    if (answers.has(request.id)) return answers.get(request.id);
    if (choose) {
      const answer = choose(request, kernel);
      if (answer !== undefined) return answer;
    }
    if (request.type === 'select-objects' && request.min === request.max && request.options.length === request.min) {
      return [...request.options];
    }
    throw new AwaitChoice(request);
  };
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: checkpoint => { kernel.restore(checkpoint.state); kernel.copyLinkedFrom(checkpoint.links); },
    objects: () => kernel.objects,
    perform: action => kernel.perform(action),
    choose: decide,
    context: (source, controller, timingPoint) => bindResolveContext(kernel, { source, controller, timingPoint, choose: decide }),
    testTrigger: registration => kernel.test(registration.spec.condition),
  });
  const flow = new TurnFlow({
    host, player: id => kernel.player(id), turnOrder: ['A', 'B'],
    battlefields: [{ id: 'bf1', controller: null }, { id: 'bf2', controller: null }],
  });
  return { kernel, host, flow, answers };
}
