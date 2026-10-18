// Scenario chain-cost-cannot-pay-finalize-fails (CR v1.5 358.2, 358.5, 445.2.a).
//
// 358.2 requires every cost to be paid; when payment is impossible 358.5 undoes
// the whole play, so the card returns to Hand and nothing is committed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { chainFixture, damageInstruction, c } from './support.mjs';

test('chain-cost-cannot-pay-finalize-fails: an unpayable cost rolls the play back', () => {
  const f = chainFixture({
    energy: { A: 1 },
    cards: [{ id: 'spell', owner: 'A', types: ['spell'], energy: 2, power: [] }],
    board: builder => builder.unit('u1', { owner: 'A', might: 4, types: ['unit'], location: { type: 'battlefield', id: 'bf1' } }),
  });
  const eventsBefore = f.engine.pipeline.events.length;
  const spell = f.spell('spell', [damageInstruction('hit', 2, 'u1')], {
    cost: { id: 'cost:spell', cost: { energy: c(2), power: c([]) } },
  });

  assert.throws(() => f.engine.execute(spell), /Energy|cost/i);

  // 358.5: the actions taken while playing are undone and the card is back in Hand.
  assert.equal(f.kernel.getObject('spell').zone, 'hand');
  assert.equal(f.kernel.player('A').energy, 1, 'nothing was paid');
  assert.equal(f.kernel.getObject('u1').damage, 0, 'no instruction ran');
  assert.equal(f.engine.items.length, 0, 'no Chain item was left behind');
  assert.equal(f.engine.pipeline.events.length, eventsBefore, 'no event was committed');
});
