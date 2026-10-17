// Rules golden test — scenario `turn-simultaneous-phase-triggers-turn-order`.
//
// CR v1.5 303.2.a / 383.3.d.1 / 315.2.a: simultaneity is ordered in Turn order
// starting with the Turn Player. Several abilities that trigger at the same
// Beginning Step are placed on the Chain by that player, and each player orders
// their own triggers. The ordering is a replayable choice, so the engine must
// suspend before committing the wave and resume without repeating a phase action.
//
// Subjects: src/events/pipeline.ts scanning (the scanner is the single owner of
// trigger placement order) over src/chain/engine.ts and the real src/turn/flow.ts
// driver. Triggers are registered through the public `registerTrigger` entry.
import test from 'node:test';
import assert from 'node:assert/strict';

import { turnFixture, markEvents, eventsAfter, timingsAfter } from './harness.mjs';

test('turn-simultaneous-phase-triggers-turn-order (303.2.a / 383.3.d.1): each side orders its own simultaneous phase triggers', () => {
  const f = turnFixture({
    setup: w => w.base('ally', { might: 2 }),
  });
  // A is the Turn Player and controls two Beginning-Step triggers; B controls one.
  f.trigger('a-draw', 'beginning-start', [{ id: 'draw', op: 'effect.draw', args: { amount: { kind: 'constant', value: 1 } } }], { sourceId: 'source' });
  f.trigger('a-note', 'beginning-start', [{ id: 'note', op: 'effect.draw', args: { amount: { kind: 'constant', value: 0 } } }], { sourceId: 'ally' });
  f.trigger('b-draw', 'beginning-start', [], { sourceId: 'enemy' });

  const mark = markEvents(f);
  // The Turn Player orders their own two triggers and answers “a-note first”.
  assert.throws(() => f.flow.start(), error => {
    const request = error.request;
    assert.equal(request?.type, 'mode');
    assert.equal(request.chooser, 'A');
    // 383.3.d.1: the Turn Player orders only their own simultaneous triggers.
    assert.deepEqual([...request.options].sort(), ['a-draw', 'a-note']);
    f.answers.set(request.id, 'a-note');
    return true;
  });

  // Suspending before the wave means no Beginning-Step event and no partial order.
  assert.equal(eventsAfter(f, mark).filter(event => event.timingPoint === 'beginning-start').length, 0);
  assert.equal(f.flow.turnState, undefined);
  assert.equal(f.flow.chain.items.length, 0);

  f.flow.advance();

  // 303.2.a: A’s two items are placed first, in A’s chosen order, then B’s.
  const pending = f.flow.chain.trace.filter(event => event.step === 'pending').map(event => event.item);
  assert.equal(pending.length, 3);
  assert.deepEqual(f.flow.chain.items.map(item => item.controller), ['A', 'A', 'B']);
  // Exactly one Beginning-Step timing was committed for the whole wave.
  assert.equal(timingsAfter(f, mark).filter(id => id === 'beginning-start').length, 1);
  // The ordering answer is replayed, not re-asked: resuming did not duplicate items.
  assert.equal(f.flow.chain.items.length, 3);
  assert.equal(f.flow.chain.items[0].body.length > 0, true);
});
