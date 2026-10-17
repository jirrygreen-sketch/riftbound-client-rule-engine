// Shared helpers for the triggers chapter golden tests (RIFT-623).
//
// Every helper here composes merged, non-duel kernel layers through their public
// APIs: src/effects/testing/test-kernel.js, src/events/action-adapter.js,
// src/chain/engine.js (ChainEngine), src/turn/flow.js (TurnFlow), the scoring leaf
// (src/scoring) with the canonical board, and src/programs/ for card programs.
// Nothing settles points, edits zones or resolves a trigger body by hand.
import {
  turnFixture, settle, draw, move, gainPoints, c, eventsOf, markEvents, eventsAfter,
  timingsAfter, timings, nonCleanup, scoreEvents, eventsAt, assertSubsequence,
} from '../scoring/harness.mjs';

export {
  turnFixture, settle, draw, move, gainPoints, c, eventsOf, markEvents, eventsAfter,
  timingsAfter, timings, nonCleanup, scoreEvents, eventsAt, assertSubsequence,
};

/** A minimal executable CardProgram for one synthetic printing. */
export const program = (canonicalCardId, abilities) => ({
  canonicalCardId,
  rulesetVersion: 'core-1.5',
  status: 'executable',
  sourceText: canonicalCardId,
  abilities,
});

/** `effect.draw` instruction body used by synthetic trigger programs. */
export const drawBody = (id = 'draw-1', amount = 1) => [{
  id,
  op: 'effect.draw',
  args: { amount: c(amount) },
}];

/**
 * Pass Priority/Focus until `predicate` holds, exactly as a player would
 * (364/365). Throws instead of looping forever or forcing an illegal pass.
 */
export function passUntil(f, predicate, budget = 40) {
  let guard = 0;
  while (!predicate()) {
    if (++guard > budget) throw new Error('passUntil budget exceeded');
    if (f.flow.chain.items.length) { f.flow.pass(f.flow.chain.priority); continue; }
    const focus = f.flow.chain.focus;
    if (focus) { f.flow.pass(focus); continue; }
    throw new Error('passUntil reached an idle state before the predicate held');
  }
  return guard;
}

/** ChainEngine trace steps for one Chain item. */
export const itemTrace = (engine, itemId) => engine.trace
  .filter(event => event.item === itemId)
  .map(event => event.step);
