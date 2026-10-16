// Scenario: movement-no-contested-on-own-battlefield (CR v1.5 190.3.a.1, 452)
import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, moveInstruction, settle, timings } from './support.mjs';

test('movement-no-contested-on-own-battlefield: moving into a Battlefield it already controls applies no Contested', () => {
  const f = fixture({
    fields: [{ id: 'bf1', controller: 'A' }, { id: 'bf2', controller: null }],
    setup: w => w.base('u1', { might: 2 }).unit('u2', { location: { type: 'battlefield', id: 'bf1' } }),
  });
  f.flow.start();
  f.flow.execute(f.activated('move-ability', [moveInstruction('move', 'u1', { type: 'battlefield', id: 'bf1' })]));
  settle(f.flow);

  assert.equal(timings(f.flow).filter(timingPoint => timingPoint === 'object-moved').length, 1);
  assert.equal(timings(f.flow).filter(timingPoint => timingPoint === 'contested-applied').length, 0);
  assert.equal(f.flow.battlefields[0].contestedBy, null);
  assert.equal(f.flow.battlefields[0].staged, 'none');
  assert.equal(f.flow.chain.turnState, 'neutral-open');
});
