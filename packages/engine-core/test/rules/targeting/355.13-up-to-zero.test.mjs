// Scenario: targeting-up-to-zero-targets-legal (CR v1.5 355.13, 355.8)
//
// "up to N" may choose zero objects; the spell is still played, finalizes with
// an empty target set and resolves without affecting anything.
import assert from 'node:assert/strict';
import test from 'node:test';
import { atBattlefield, constant, scene, spend } from './harness.mjs';

test('targeting-up-to-zero-targets-legal: zero targets still finalizes and resolves', () => {
  const s = scene(builder => builder
    .player('A', { energy: 1 })
    .player('B', { energy: 0 })
    .hand('spell', { owner: 'A', types: ['spell'] })
    .base('u1', { owner: 'A', might: 2 })
    .unit('b1', { owner: 'A', might: 2, location: atBattlefield('bf1') }));
  const spell = s.draft('spell', {
    body: [{ id: 'move', op: 'effect.zone', args: { target: 'us', to: constant('base') } }],
    targets: [{
      requirement: { id: 'us', filter: { type: 'unit', zone: 'board', controller: 'A', location: 'battlefield' }, selection: 'up-to', max: 2 },
      options: { chosen: [] }
    }],
    cost: { id: 'cost:spell', cost: { energy: constant(1), power: constant([]) } }
  });
  s.engine.execute(spell);

  const item = s.engine.items[0];
  assert.equal(item.status, 'finalized');
  assert.deepEqual(item.targetPlans[0].selected, []);
  assert.equal(s.kernel.player('A').energy, 0, 'the printed cost was paid');
  assert.deepEqual(s.engine.pipeline.events.filter(event => event.timingPoint === 'became-target'), []);

  spend(s.engine);
  assert.equal(s.kernel.getObject('spell').zone, 'trash');
  assert.equal(s.kernel.getObject('b1').location.id, 'bf1', 'nothing was moved for zero targets');
  assert.deepEqual(s.engine.trace.filter(event => event.step === 'resolved').map(event => event.item), ['spell']);
});
