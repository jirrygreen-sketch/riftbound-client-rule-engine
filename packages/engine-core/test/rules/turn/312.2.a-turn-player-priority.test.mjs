// Rules golden test — scenario `turn-turn-player-definition-visible-in-priority`.
//
// CR v1.5 304 / 312 / 312.2.a / 312.3: the Turn Player is the player whose turn is
// in progress. In the Neutral Open State of their own Main Phase, only the Turn
// Player has Priority, which is created for them when the state grants it.
//
// Subject: src/turn/flow.ts phase queue (which grants through src/chain/engine.ts
// `grantIdle`) plus the src/chain `canAct` truth table. The assertions read the
// Turn Player, the Priority holder and the committed Priority grants.
import test from 'node:test';
import assert from 'node:assert/strict';

import { turnFixture, timings, c, markEvents, eventsAfter } from './harness.mjs';

test('turn-turn-player-definition-visible-in-priority (304 / 312.2.a): only the Turn Player holds Priority in their Main Phase', () => {
  const f = turnFixture();
  f.flow.start();

  // 304: the Turn Player is the player whose turn is in progress.
  assert.equal(f.flow.turnPlayer, 'A');
  assert.equal(f.flow.phase, 'main');
  // 312: at most one player holds Priority, and 312.2.a creates it for the Turn Player.
  assert.equal(f.flow.chain.priority, 'A');
  assert.equal(f.flow.chain.turnState, 'neutral-open');

  // The Turn Player can take a Discretionary Action; the opponent cannot.
  assert.equal(f.flow.chain.canAct('A', 'normal'), true);
  assert.equal(f.flow.chain.canAct('B', 'normal'), false);
  assert.throws(
    () => f.flow.execute({ id: 'opponent', controller: 'B', source: f.kernel.getObject('enemy'), kind: 'activated', speed: 'normal', body: [] }),
    /not legally timed/,
  );

  // The Main Phase really began for A, and the only Priority holder the driver
  // ever created for this state was the Turn Player.
  const mark = markEvents(f);
  assert.equal(timings(f).filter(id => id === 'main-start').length, 1);
  const grants = f.flow.chain.trace.filter(event => event.step === 'priority-granted').map(event => event.player);
  assert.equal(grants.at(-1), 'A');
  assert.equal(grants.includes('B'), false);

  // Taking a Discretionary Action keeps the Priority with the resolving player's
  // controller only through the legal Chain flow — the opponent never gains it.
  f.flow.execute(f.activated('act', [{ id: 'noop', op: 'effect.draw', args: { amount: c(0) } }]));
  assert.deepEqual(eventsAfter(f, mark).filter(event => event.player === 'B'), []);
});
