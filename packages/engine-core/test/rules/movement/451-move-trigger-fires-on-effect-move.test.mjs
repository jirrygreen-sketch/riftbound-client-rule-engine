// Scenario: movement-trigger-fires-on-effect-move (CR v1.5 451, 448.1)
import test from 'node:test';
import assert from 'node:assert/strict';
import { c, fixture, moveInstruction, pendingItems, settle, timings } from './support.mjs';

test('movement-trigger-fires-on-effect-move: an effect Move is still a Move and triggers "when I move"', () => {
  const f = fixture({
    fields: [{ id: 'bf1', controller: 'A' }, { id: 'bf2', controller: null }],
    setup: w => w.unit('u1', { location: { type: 'battlefield', id: 'bf1' } }),
  });
  f.flow.start();
  const before = f.kernel.player('A').handSize;
  f.flow.chain.pipeline.registerTrigger({
    id: 'when-i-move', source: f.kernel.getObject('u1'), controller: 'A',
    spec: { at: 'object-moved', filter: {} }, body: [{ id: 'draw', op: 'effect.draw', args: { amount: c(1) } }],
  });
  f.flow.execute(f.activated('move-ability', [moveInstruction('move', 'u1', { type: 'battlefield', id: 'bf2' })]));
  settle(f.flow);

  // 451.1: the source effect defines Destination legality, so Battlefield -> Battlefield is legal here.
  assert.deepEqual(f.kernel.getObject('u1').location, { type: 'battlefield', id: 'bf2' });
  assert.equal(timings(f.flow).filter(timingPoint => timingPoint === 'object-moved').length, 1);
  assert.deepEqual(pendingItems(f.flow), ['move-ability', 'trigger:1'], 'the Move trigger enters the Chain');
  assert.equal(f.kernel.player('A').handSize, before + 1, 'the trigger actually resolved');
});
