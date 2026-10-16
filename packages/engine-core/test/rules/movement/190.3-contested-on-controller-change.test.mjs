// Scenario: movement-contested-on-controller-change (CR v1.5 190.3.a.2)
import test from 'node:test';
import assert from 'node:assert/strict';
import { c, fixture, settle, timings } from './support.mjs';

test('movement-contested-on-controller-change: a Unit changing controller at a Battlefield applies Contested', () => {
  const f = fixture({
    fields: [{ id: 'bf1', controller: 'B' }, { id: 'bf2', controller: null }],
    setup: w => w.unit('v1', { owner: 'B', might: 2, location: { type: 'battlefield', id: 'bf1' } }),
  });
  f.flow.start();
  f.flow.execute(f.activated('take-control', [{
    id: 'take', op: 'effect.control',
    args: { objects: c({ target: 'take' }) },
    targets: [{ id: 'take', filter: { objectId: 'v1' }, min: 1, max: 1 }],
  }]));
  settle(f.flow);

  assert.deepEqual(f.kernel.getObject('v1').controller, 'A');
  assert.equal(timings(f.flow).filter(timingPoint => timingPoint === 'control-established').length, 0);
  assert.equal(f.flow.battlefields[0].contestedBy, 'A');
  assert.equal(timings(f.flow).filter(timingPoint => timingPoint === 'contested-applied').length, 1);
  assert.equal(f.flow.chain.turnState, 'showdown-open', 'the Contested Battlefield stages a non-combat Showdown');
});
