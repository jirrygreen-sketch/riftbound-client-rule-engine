// Shared rules-golden harness for docs/rules/scenarios/turn.yaml (CR v1.5 301-324).
//
// Everything here drives the merged, non-duel kernel layers through their public
// APIs only:
//   * src/effects/testing/test-kernel.ts — the reference test kernel
//   * src/events/action-adapter.ts       — the single event pipeline host
//   * src/chain/engine.ts                — ChainEngine (HOT FEPR, Cleanups)
//   * src/turn/flow.ts (TurnFlow)        — the CR v1.5 turn driver
//
// Positions are built through the builder or through real committed GameActions.
// No scenario edits damage, zones, resources or scores behind the kernel's back,
// and every assertion reads the committed event sequence or the layer's state.
import { world } from '../../../dist/effects/testing/test-kernel.js';
import { AwaitChoice } from '../../../dist/effects/contract.js';
import { bindResolveContext, createActionPipelineHost } from '../../../dist/events/action-adapter.js';
import { TurnFlow } from '../../../dist/turn/flow.js';

export { AwaitChoice, TurnFlow, world };

/** card-dsl constant expression */
export const c = value => ({ kind: 'constant', value });

/** effect.draw instruction */
export const draw = (id, amount = 1) => ({ id, op: 'effect.draw', args: { amount: c(amount) } });

/** effect.damage instruction against one explicit board object (CR 418). */
export const damage = (id, objectId, amount) => ({
  id, op: 'effect.damage', args: { amount: c(amount), target: 'target' },
  targets: [{ id: 'target', filter: { objectId, type: 'unit', zone: 'board' }, min: 1, max: 1 }],
});

/** effect.move instruction to an explicit destination (CR 451). */
export const moveTo = (id, destination) => ({ id, op: 'effect.move', args: { to: c(destination) } });

const STARTING_DECK = 8;

/**
 * Deterministic two-player world on the real TurnFlow → ChainEngine →
 * EventPipeline → interpreter path. `fields` are the two Duel Battlefields with
 * their initial controlling player (CR 487.4-5).
 */
export function turnFixture({ fields, score = {}, turnOrder = ['A', 'B'], victoryScore, setup, deck = STARTING_DECK, runes = STARTING_DECK } = {}) {
  const builder = world().player('A', { score: score.A ?? 0 }).player('B', { score: score.B ?? 0 })
    .base('source', { might: 4, energy: 0, power: [] })
    .base('enemy', { owner: 'B', might: 4, energy: 0, power: [] });
  for (const player of turnOrder) {
    if (deck) builder.deck(Array.from({ length: deck }, (_, i) => `${player}:deck:${i}`), { owner: player });
    if (runes) builder.rune(Array.from({ length: runes }, (_, i) => `${player}:rune:${i}`), { owner: player });
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
    objects: () => kernel.objects,
    perform: action => kernel.perform(action),
    choose,
    context: (source, controller, timingPoint) => bindResolveContext(kernel, { source, controller, timingPoint, choose }),
    testTrigger: registration => kernel.test(registration.spec.condition),
  });
  const options = {
    host, player: id => kernel.player(id), turnOrder,
    battlefields: fields ?? [{ id: 'bf1', controller: null }, { id: 'bf2', controller: null }],
  };
  if (victoryScore !== undefined) options.victoryScore = victoryScore;
  const flow = new TurnFlow(options);
  /** ChainDraft for an activated ability of a Board object (CR 316.5.b). */
  const activated = (id, body, overrides = {}) => ({
    id, controller: 'A', source: kernel.getObject('source'), kind: 'activated', speed: 'normal', body, ...overrides,
  });
  /** ChainDraft for playing a Hand card; `location` is its Play Destination (CR 355.2). */
  const spell = (id, body, overrides = {}) => ({
    id: `play-${id}`, controller: 'A', source: kernel.getObject(id), kind: 'spell', speed: 'normal', body,
    cost: { id: `cost:${id}`, cost: { energy: c(0), power: c([]) } }, ...overrides,
  });
  /** Mandatory trigger registered on the real event pipeline (CR 383). */
  const trigger = (id, at, body, overrides = {}) => flow.chain.pipeline.registerTrigger({
    id, source: kernel.getObject(overrides.sourceId ?? 'source'), controller: overrides.controller ?? 'A',
    spec: { at, filter: overrides.filter ?? {} }, body,
  });
  return { kernel, host, flow, answers, choose, activated, spell, trigger };
}

/** Every committed pipeline event, in commit order. */
export const eventsOf = f => f.flow.chain.pipeline.events;

/** Mark the current event count so a later assertion can scope to new events. */
export const markEvents = f => eventsOf(f).length;

/** Committed events after `mark`, in commit order. */
export const eventsAfter = (f, mark) => eventsOf(f).slice(mark);

/** Timing points committed after `mark`. */
export const timingsAfter = (f, mark) => eventsAfter(f, mark).map(event => event.timingPoint);

/** Every committed timing point, in commit order. */
export const timings = f => eventsOf(f).map(event => event.timingPoint);

/** Committed events for a single timing point. */
export const eventsAt = (f, timingPoint) => eventsOf(f).filter(event => event.timingPoint === timingPoint);

/** Chain lifecycle trace reduced to `<step>:<item>` pairs. */
export const stages = f => f.flow.chain.trace
  .filter(event => ['pending', 'finalized', 'resolved', 'removed'].includes(event.step))
  .map(event => `${event.step}:${event.item}`);

/** Assert `expected` appears in `actual` in order (the YAML `ordered: subsequence`). */
export function assertSubsequence(actual, expected) {
  let cursor = 0;
  for (const entry of expected) {
    const index = actual.indexOf(entry, cursor);
    if (index < 0) throw new Error(`Expected subsequence entry ${JSON.stringify(entry)} at or after ${cursor} in ${JSON.stringify(actual)}`);
    cursor = index + 1;
  }
}

/** Pass Priority/Focus until the chain and any Showdown are idle again (CR 334). */
export function settle(f, budget = 60) {
  let guard = 0;
  while (guard++ < budget) {
    if (f.flow.chain.items.length) { f.flow.pass(f.flow.chain.priority); continue; }
    const focus = f.flow.chain.focus;
    if (focus) { f.flow.pass(focus); continue; }
    return;
  }
  throw new Error('settle did not reach an idle chain');
}

/** Pass Priority until only the Chain is idle, without closing a Showdown. */
export function resolveChainOnly(f, budget = 60) {
  let guard = 0;
  while (f.flow.chain.items.length) {
    if (guard++ > budget) throw new Error('resolveChainOnly did not reach an idle chain');
    f.flow.chain.pass(f.flow.chain.priority);
  }
}

export const CHAIN_TIMINGS = ['chain-item-pending', 'chain-item-finalize', 'chain-item-resolve'];

/** Committed timing points without the pipeline's high-frequency cleanup pair. */
export const nonCleanup = f => timings(f).filter(id => !id.startsWith('cleanup-'));
