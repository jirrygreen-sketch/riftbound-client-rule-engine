// Scenario chain-play-effects-after-unit-boarded (CR v1.5 383.4.a.2, 383.4.a.4, 337.2).
//
// A Play Effect goes on the Chain only once the Permanent that has it is on the
// Board (383.4.a.2), so its Pending item appears after the entry and behind the
// permanent it came from; it Finalizes and Resolves later. Abilities that Trigger
// on another object being played are not Play Effects (383.4.a.4).
import test from 'node:test';
import assert from 'node:assert/strict';
import { chainFixture, damageInstruction, registerTrigger, resolveAll, eventsOf, stages } from './support.mjs';

test('chain-play-effects-after-unit-boarded: the Play Effect enters the Chain after the Unit is on Board', () => {
  const f = chainFixture({
    energy: { A: 3 },
    cards: [{ id: 'u1', owner: 'A', types: ['unit'], energy: 2, power: [], might: 2 }],
    board: builder => builder.unit('u2', { owner: 'B', might: 2, types: ['unit'], location: { type: 'battlefield', id: 'bf1' } }),
  });
  // "When you play me, deal 1 to a unit" - the effect belongs to u1 itself.
  registerTrigger(f.engine, f.kernel, {
    id: 'u1-play-effect', source: 'u1', controller: 'A',
    spec: { at: 'object-enters-board', filter: { objectId: 'u1' } },
    body: [damageInstruction('hit', 1, 'u2')],
  });

  f.engine.execute(f.unit('u1', []));

  // 337.2: the Unit itself already Resolved onto the Board; only the Play Effect
  // is left waiting on the Chain.
  assert.equal(f.kernel.getObject('u1').zone, 'board');
  assert.equal(f.engine.items.length, 1);
  assert.equal(f.engine.items[0].kind, 'triggered');

  const events = eventsOf(f.engine);
  const at = (timingPoint, item) => events.findIndex(event =>
    event.timingPoint === timingPoint && (item === undefined || event.details?.item === item));
  const boarded = at('object-enters-board');
  const effectPending = at('chain-item-pending', 'trigger:1');
  const unitResolved = at('chain-item-resolve', 'u1');
  assert.ok(boarded >= 0 && effectPending >= 0 && unitResolved >= 0);
  assert.ok(boarded < effectPending, '383.4.a.2: the Play Effect is appended only after the Unit is on Board');
  assert.ok(effectPending < unitResolved, '383.4.a.2: the Play Effect waits behind the permanent that produced it');
  assert.equal(f.kernel.getObject('u2').damage, 0, 'the Play Effect has not resolved yet');

  resolveAll(f.engine);

  assert.equal(f.kernel.getObject('u2').damage, 1);
  assert.equal(f.kernel.player('A').energy, 1, 'the Unit paid its printed cost');
  assert.deepEqual(stages(f.engine), [
    'pending:u1', 'finalized:u1', 'pending:trigger:1',
    'resolved:u1', 'removed:u1(resolved)',
    'finalized:trigger:1', 'resolved:trigger:1', 'removed:trigger:1(resolved)',
  ]);
});
