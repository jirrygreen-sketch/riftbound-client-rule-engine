// Rules golden test — scenario `turn-main-phase-free-order-actions`.
//
// CR v1.5 303 / 316.5 / 316.5.a / 411.1: the Main Phase has no defined structure.
// A player may take any number of Discretionary Actions in any order they are able
// to perform. Both “play then act” and “act then play” are legal and produce
// different positions; nothing forces a fixed sequence inside the phase.
//
// Subject: src/chain/engine.ts `canAct` timing truth table driven by
// src/turn/flow.ts. Both orders use real committed actions through the
// interpreter and the Chain; the assertions read the committed positions.
import test from 'node:test';
import assert from 'node:assert/strict';

import { turnFixture, draw, settle, eventsAt } from './harness.mjs';

test('turn-main-phase-free-order-actions (316.5 / 316.5.a): Discretionary Actions run in any order inside the Main Phase', () => {
  // Order 1: an activated ability first, then a spell.
  const first = turnFixture({
    setup: w => w.hand('c1', { types: ['spell'], energy: 0, power: [] }),
  });
  first.flow.start();
  first.flow.execute(first.activated('act-first', [draw('act')]));
  settle(first);
  first.flow.execute(first.spell('c1', [draw('second')]));
  settle(first);
  const activatedFirst = eventsAt(first, 'card-played').length;
  assert.equal(activatedFirst, 1, 'the spell was still playable after an activated ability resolved');
  assert.equal(first.kernel.getObject('c1').zone, 'trash', 'the played spell left the Chain for the Trash');

  // Order 2: the spell first, then the activated ability. Both are legal; the
  // difference is the resulting position, not the legality of either order.
  const second = turnFixture({
    setup: w => w.hand('c1', { types: ['spell'], energy: 0, power: [] }),
  });
  second.flow.start();
  second.flow.execute(second.spell('c1', [draw('first')]));
  settle(second);
  second.flow.execute(second.activated('act-second', [draw('second')]));
  settle(second);
  assert.equal(eventsAt(second, 'card-played').length, 1, 'the spell was playable before the activated ability');
  assert.equal(second.kernel.getObject('c1').zone, 'trash');

  // Both orders are legal DIscretionary Actions: the phase accepted two real
  // Chain executions in each arrangement (CR 316.5.a).
  assert.equal(first.flow.phase, 'main');
  assert.equal(second.flow.phase, 'main');
  assert.equal(first.flow.chain.items.length, 0);
  assert.equal(second.flow.chain.items.length, 0);
  // The card-played timing is a real committed event in both orders (CR 316.5.a:
  // either arrangement is a legal discretionary sequence), and each order played
  // the card from Hand rather than settling it by hand.
  assert.equal(eventsAt(second, 'card-played').length, 1);
  assert.deepEqual(eventsAt(first, 'card-played').map(event => event.fromZone), ['hand']);
  assert.deepEqual(eventsAt(second, 'card-played').map(event => event.fromZone), ['hand']);
});
