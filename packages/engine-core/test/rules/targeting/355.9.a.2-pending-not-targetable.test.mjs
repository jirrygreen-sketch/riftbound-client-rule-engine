// Scenario: targeting-pending-item-not-targetable (CR v1.5 355.9.a.2, 426)
//
// "Spell" as a target means a finalized chain item. A Pending item cannot be
// chosen, so the counter has no legal target while the first spell finalizes.
import assert from 'node:assert/strict';
import test from 'node:test';
import { constant, scene } from './harness.mjs';

test('targeting-pending-item-not-targetable: a Pending chain item is not a legal target', () => {
  const s = scene(builder => builder
    .player('A', { energy: 3 })
    .player('B', { energy: 0 })
    .hand('big', { owner: 'A', types: ['spell'] })
    .unit('t1', { owner: 'B', might: 6, location: { type: 'battlefield', id: 'bf1' } }));
  const counter = s.draft('big', {
    id: 'counter',
    body: [{ id: 'counter', op: 'effect.counter', args: { target: 'chain' } }],
    targets: [{ requirement: { id: 'chain', filter: { type: 'spell', zone: 'chain' } } }],
    cost: { id: 'cost:counter', cost: { energy: constant(3), power: constant([]) } }
  });

  // enqueue places a Pending trigger on the chain before anything is finalized.
  s.engine.enqueue({ ...counter, id: 'counter', kind: 'triggered' });
  assert.equal(s.engine.items[0].status, 'pending');
  assert.equal(s.engine.isPending(s.engine.items[0].object), true);

  // Finalize legality for the pending counter finds no target: the ability is removed.
  s.engine.advance();
  assert.deepEqual(s.engine.items, []);
  assert.deepEqual(
    s.engine.trace.filter(event => event.step === 'removed').map(event => [event.item, event.reason]),
    [['counter', 'unperformable-trigger']]
  );
  assert.equal(s.kernel.player('A').energy, 3, 'no cost was paid');
});
