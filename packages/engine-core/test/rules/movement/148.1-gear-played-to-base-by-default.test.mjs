// Scenario: movement-gear-played-to-base-by-default (CR v1.5 148.1.a.1, 149.2)
import test from 'node:test';
import assert from 'node:assert/strict';
import { eventsOf, fixture, settle } from './support.mjs';

test('movement-gear-played-to-base-by-default: Gear without a permission effect enters at its controller Base', () => {
  const f = fixture({ setup: w => w.hand('g1', { types: ['gear'], energy: 1, power: [] }) });
  f.flow.start();
  f.flow.execute(f.activated('gain-resources', [{ id: 'gain', op: 'effect.resources', args: { energy: { kind: 'constant', value: 3 } } }]));
  settle(f.flow);
  f.flow.execute(f.play('g1', 'gear'));
  settle(f.flow);

  const gear = f.kernel.getObject('g1');
  assert.deepEqual(gear.location, { type: 'base', player: 'A' });
  assert.equal(gear.zone, 'board');
  assert.equal(eventsOf(f.flow, 'object-enters-base').length, 1);
  assert.equal(f.kernel.player('A').energy, 2, 'the printed Energy cost was paid');
  assert.equal(f.kernel.player('A').handSize, 1, 'only the Draw Step card is left in Hand');
});
