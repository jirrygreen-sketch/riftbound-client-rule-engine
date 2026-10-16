// Scenario: movement-unit-played-to-own-controlled-battlefield (CR v1.5 355.2.a)
import test from 'node:test';
import assert from 'node:assert/strict';
import { eventsOf, fixture, settle } from './support.mjs';

test('movement-unit-played-to-own-controlled-battlefield: a Unit may enter a Battlefield its controller already controls', () => {
  const f = fixture({
    fields: [{ id: 'bf1', controller: 'A' }, { id: 'bf2', controller: null }],
    setup: w => w.unit('guard', { location: { type: 'battlefield', id: 'bf1' } })
      .hand('c1', { types: ['unit'], might: 3, energy: 2, power: [] }),
  });
  f.flow.start();
  f.flow.execute(f.activated('gain-resources', [{ id: 'gain', op: 'effect.resources', args: { energy: { kind: 'constant', value: 3 } } }]));
  settle(f.flow);
  f.flow.execute(f.play('c1', 'unit', { type: 'battlefield', id: 'bf1' }));
  settle(f.flow);

  const unit = f.kernel.getObject('c1');
  assert.deepEqual(unit.location, { type: 'battlefield', id: 'bf1' });
  assert.equal(unit.exhausted, true, 'a Unit enters Exhausted');
  assert.equal(eventsOf(f.flow, 'object-enters-battlefield').length, 1);
  assert.equal(f.flow.battlefields[0].controller, 'A');
  assert.equal(eventsOf(f.flow, 'contested-applied').length, 0, '452: the controller already controls the Battlefield');
  assert.deepEqual(f.kernel.query({ zone: 'board', location: { type: 'battlefield', id: 'bf1' } }).map(object => object.ref.id).sort(), ['c1', 'guard']);
});
