// Scenario: movement-control-preserved-during-ongoing-showdown (CR v1.5 190.4.b, 190.4.c)
import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, moveInstruction, pendingItems, settle, timings } from './support.mjs';

// The YAML `given` (controller A together with contestedBy A) contradicts CR 190.3.a/452,
// which require the player applying Contested not to control the Battlefield. This test
// therefore builds the rule-legal equivalent: B controlled bf1, the turn player A applied
// Contested, and the ongoing Showdown freezes the battlefield state (190.4.b).
test('movement-control-preserved-during-ongoing-showdown: Control is frozen while a Showdown is ongoing', () => {
  const f = fixture({
    fields: [{ id: 'bf1', controller: 'B' }, { id: 'bf2', controller: null }],
    setup: w => w.base('u1', { might: 2 }).hand('rx', { types: ['spell'] }),
  });
  f.flow.start();
  f.flow.execute(f.activated('enter', [moveInstruction('enter', 'u1', { type: 'battlefield', id: 'bf1' })]));
  settle(f.flow);
  assert.equal(f.flow.chain.turnState, 'showdown-open');
  const controlLostBefore = timings(f.flow).filter(timingPoint => timingPoint === 'control-lost').length;

  // B holds Focus after A passed (347.2.b) and reacts its own enemy-removal spell.
  f.flow.pass('A');
  assert.equal(f.flow.chain.focus, 'B');
  f.flow.execute(f.reaction('rx', [moveInstruction('out', 'u1', { type: 'base', player: 'A' })]));
  settle(f.flow);

  assert.deepEqual(f.kernel.getObject('u1').location, { type: 'base', player: 'A' });
  assert.equal(timings(f.flow).filter(timingPoint => timingPoint === 'object-moved').length, 2);
  assert.equal(
    timings(f.flow).filter(timingPoint => timingPoint === 'control-lost').length,
    controlLostBefore,
    '190.4.b: no Control change while the Showdown is ongoing',
  );
  assert.equal(
    f.flow.battlefields[0].contestedBy,
    'A',
    '190.3.b.1: Contested is not removed because a Showdown is ongoing there',
  );
  assert.equal(f.flow.chain.turnState, 'showdown-open');
  assert.deepEqual(pendingItems(f.flow), ['enter', 'reaction-rx']);
});
