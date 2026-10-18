// Rules golden test — scenario `turn-cleanup-invoked-on-object-entering-board`.
//
// CR v1.5 318 / 319.6 / 323.7 / 344: a Cleanup is made an Outstanding Task after
// Game Objects enter or leave the Board. When a Unit enters an empty Battlefield
// it becomes Contested, the Cleanup marks the Showdown as staged (323.7), and the
// Neutral Open State lets the Turn Player open it (323.11) as a Non-Combat
// Showdown (316.8.b.1).
//
// Subject: src/turn/flow.ts entry emissions + src/combat/flow.ts Cleanup/advance
// over src/chain/engine.ts. The entry is a real effect Move resolved by the
// interpreter; the Contested, staged and opened states are all produced by the
// engine, never written by the test.
import test from 'node:test';
import assert from 'node:assert/strict';

import { turnFixture, moveTo, markEvents, eventsAfter, settle, resolveChainOnly, assertSubsequence } from './harness.mjs';

test('turn-cleanup-invoked-on-object-entering-board (319.6 / 323.7): an entering Unit contests, stages and opens a Non-Combat Showdown', () => {
  const f = turnFixture({ score: { A: 0, B: 0 } });
  f.flow.start();
  assert.equal(f.flow.battlefields[0].controller, null);
  assert.equal(f.kernel.getObject('source').location.type, 'base');

  const mark = markEvents(f);
  f.flow.execute(f.activated('move-out', [moveTo('move', { type: 'battlefield', id: 'bf1' })]));
  // Resolve the Move’s item through the real FEPR; the Showdown stays open so the
  // staged state can be read before it is closed.
  resolveChainOnly(f);
  f.flow.advance();

  // The entry itself applies Contested (CR 452) and the Cleanup that 319.6
  // requests marks the Showdown as staged and then opens it (323.7 / 323.11).
  assertSubsequence(eventsAfter(f, mark).map(event => event.timingPoint), [
    'object-enters-battlefield', 'contested-applied', 'showdown-open',
  ]);

  assert.equal(f.kernel.getObject('source').location.id, 'bf1');
  assert.equal(f.flow.battlefields[0].contestedBy, 'A');
  // 323.7.a: the Showdown stays marked as staged for as long as the Battlefield is
  // Contested; 323.11 then has the Turn Player open it from the Neutral Open State.
  assert.equal(f.flow.battlefields[0].staged, 'showdown');
  assert.equal(f.flow.chain.turnState, 'showdown-open');
  // 316.8.b.1 / 312.2: the entering player holds Focus in the Non-Combat Showdown.
  assert.equal(f.flow.chain.focus, 'A');
  assert.equal(f.flow.chain.priority, 'A');

  // Closing the Showdown establishes control and conquers (348.2) — proof the
  // staged Showdown was a real one, not a marker left behind by the entry.
  settle(f);
  assert.equal(f.flow.chain.turnState, 'neutral-open');
  assert.equal(f.flow.battlefields[0].controller, 'A');
  assert.equal(f.kernel.player('A').score, 1);
});
