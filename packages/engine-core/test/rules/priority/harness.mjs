// Shared wiring for the RIFT-622 priority-chapter rule golden tests.
//
// Object under test: the merged, non-duel layers only — the reference test
// kernel (`src/effects/testing`), the action pipeline (`src/events`), the chain
// engine (`src/chain`) and the 1v1 turn driver (`src/turn`). `src/duel/` is
// never the subject; `given` positions are built with the reference kernel's
// world builder, the same convention `test/rules/movement/support.mjs` uses.
//
// Nothing here settles points, edits the score ledger or fakes a Cleanup: the
// turn driver runs its real Cleanup (contested status, staging, Showdown
// opening, control establishment, Conquer) and assertions read the committed
// event sequence or the resulting state.
import { world } from '../../../dist/effects/testing/test-kernel.js';
import { AwaitChoice } from '../../../dist/effects/contract.js';
import { bindResolveContext, createActionPipelineHost } from '../../../dist/events/action-adapter.js';
import { TurnFlow } from '../../../dist/turn/flow.js';

/**
 * TurnFlow over the reference kernel with deterministic decks and rune decks.
 * `fields` are the two Battlefields of the 1v1 driver (CR 487.4-5); a scenario's
 * `given` position is built through `setup`. Unanswered choices are never
 * guessed: the harness throws `AwaitChoice` and the test records the request.
 */
export function turnFixture({ fields, score = {}, setup, deckCount = 8 } = {}) {
  const builder = world().player('A', { score: score.A ?? 0 }).player('B', { score: score.B ?? 0 });
  for (const player of ['A', 'B']) {
    builder.deck(Array.from({ length: deckCount }, (_, index) => `${player}:deck:${index}`), { owner: player });
    builder.rune(Array.from({ length: deckCount }, (_, index) => `${player}:rune:${index}`), { owner: player });
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
  const flow = new TurnFlow({
    host,
    player: id => kernel.player(id),
    turnOrder: ['A', 'B'],
    battlefields: fields ?? [{ id: 'bf1', controller: null }, { id: 'bf2', controller: null }],
  });
  return { kernel, host, flow, answers, choose };
}

/** Every committed pipeline event, in commit order. */
export const eventsOf = f => f.flow.chain.pipeline.events;

/** Mark the current event count so a later assertion can scope to new events. */
export const markEvents = f => eventsOf(f).length;

/** Events committed after `mark`, in commit order. */
export const eventsAfter = (f, mark) => eventsOf(f).slice(mark);

/** Timing points committed after `mark`, in commit order. */
export const timingsAfter = (f, mark) => eventsAfter(f, mark).map(event => event.timingPoint);

/** Assert `expected` appears in `actual` in the given order (YAML `ordered: subsequence`). */
export function assertSubsequence(actual, expected) {
  let cursor = 0;
  for (const entry of expected) {
    const index = actual.indexOf(entry, cursor);
    if (index < 0) throw new Error(`Expected subsequence entry ${JSON.stringify(entry)} after index ${cursor} in ${JSON.stringify(actual)}`);
    cursor = index + 1;
  }
}
