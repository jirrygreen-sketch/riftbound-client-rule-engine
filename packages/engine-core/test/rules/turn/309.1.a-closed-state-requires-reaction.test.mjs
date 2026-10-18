// Rules golden test — scenario `turn-negative-action-spell-in-closed-state`.
//
// CR v1.5 309.1 / 309.1.a / 338.1.a.1 / 338.1.a.2: if a Chain exists the turn is
// in a Closed State, and only cards and abilities with Reaction can be played or
// activated. A normal-speed card must be rejected at that timing, and the same
// timing must accept a Reaction card — the guard rejects the illegal action rather
// than refusing to act at all.
//
// Subject: src/chain/engine.ts `canAct` via the `execute` timing check, driven
// through src/turn/flow.ts. This is the actual legality gate, not a stub: the
// Reaction draft from the same position is accepted and placed on the Chain.
import test from 'node:test';
import assert from 'node:assert/strict';

import { turnFixture, c, markEvents, eventsAfter, settle } from './harness.mjs';

test('turn-negative-action-spell-in-closed-state (309.1.a / 338.1.a): a normal-speed card is rejected while the Chain exists', () => {
  const f = turnFixture({
    setup: w => w.hand('normal', { types: ['spell'], energy: 0, power: [] })
      .hand('reaction', { types: ['spell'], energy: 0, power: [] }),
  });
  f.flow.start();

  // Opening a Chain puts the turn into the Closed State (309.1).
  f.flow.execute(f.activated('opener', [{ id: 'noop', op: 'effect.draw', args: { amount: c(0) } }]));
  assert.equal(f.flow.chain.turnState, 'neutral-closed');
  assert.equal(f.flow.chain.items.length, 1);
  assert.equal(f.flow.chain.priority, 'A');

  // 338.1.a.1 / 338.1.a.2: a card without Reaction is not legally timed here.
  const mark = markEvents(f);
  assert.throws(
    () => f.flow.execute({
      id: 'play-normal', controller: 'A', source: f.kernel.getObject('normal'), kind: 'spell', speed: 'normal',
      body: [], cost: { id: 'cost:normal', cost: { energy: c(0), power: c([]) } },
    }),
    /not legally timed/,
  );
  // The rejection committed nothing: no item, no card-played timing, the card
  // is still in Hand and no Hand position changed.
  assert.deepEqual(eventsAfter(f, mark), []);
  assert.equal(f.flow.chain.items.length, 1);
  assert.equal(f.kernel.getObject('normal').zone, 'hand');

  // The same timing accepts a Reaction card (309.1.a): the guard is specific.
  f.flow.execute({
    id: 'play-reaction', controller: 'A', source: f.kernel.getObject('reaction'), kind: 'spell', speed: 'reaction',
    body: [], cost: { id: 'cost:reaction', cost: { energy: c(0), power: c([]) } },
  });
  assert.equal(f.flow.chain.items.length, 2, 'the Reaction card joined the existing Chain');
  settle(f);
  assert.equal(f.kernel.getObject('reaction').zone, 'trash');
  assert.equal(f.kernel.getObject('normal').zone, 'hand');
});
