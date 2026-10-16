// Scenario: movement-zone-change-is-not-a-move (CR v1.5 448.2, 421.1)
import test from 'node:test';
import assert from 'node:assert/strict';
import { c, fixture, pendingItems, settle, timings } from './support.mjs';

test('movement-zone-change-is-not-a-move: leaving a non-Board zone never counts as a Move', () => {
  const f = fixture({ setup: w => w.hand('c1', { types: ['unit'], might: 2 }).base('u1', { might: 2 }) });
  f.flow.start();
  // "When another friendly unit moves, draw a card" is modelled as a real Move trigger;
  // it must stay silent for a Hand -> Trash zone change.
  f.flow.chain.pipeline.registerTrigger({
    id: 'move-watch', source: f.kernel.getObject('u1'), controller: 'A',
    spec: { at: 'object-moved', filter: {} }, body: [{ id: 'draw', op: 'effect.draw', args: { amount: c(1) } }],
  });
  f.flow.execute(f.activated('discard-ability', [{ id: 'discard', op: 'effect.discard', args: { amount: c('all') } }]));
  settle(f.flow);

  assert.equal(f.kernel.getObject('c1').zone, 'trash');
  assert.equal(f.kernel.player('A').handSize, 0);
  // Both the scene's unit card and the Draw Step card leave Hand: two zone changes, still no Move.
  assert.equal(timings(f.flow).filter(timingPoint => timingPoint === 'card-discarded').length, 2);
  assert.equal(timings(f.flow).filter(timingPoint => timingPoint === 'object-moved').length, 0);
  assert.deepEqual(pendingItems(f.flow), ['discard-ability'], 'no Move trigger enters the Chain');
  assert.equal(f.kernel.getObject('u1').location.type, 'base');
});
