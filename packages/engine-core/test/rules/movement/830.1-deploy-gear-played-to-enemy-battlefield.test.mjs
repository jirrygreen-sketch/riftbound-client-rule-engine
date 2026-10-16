// Scenario: movement-deploy-gear-played-to-enemy-battlefield (CR v1.5 830.1.b, 830.1.b.1)
import test from 'node:test';
import assert from 'node:assert/strict';
import { eventsOf, fixture, settle } from './support.mjs';

test('movement-deploy-gear-played-to-enemy-battlefield: Deploy lets Gear enter an enemy-occupied Battlefield', () => {
  const f = fixture({
    fields: [{ id: 'bf1', controller: 'B' }, { id: 'bf2', controller: null }],
    setup: w => w.hand('g1', { types: ['gear'], energy: 1, power: [], keywords: [{ id: 'Deploy' }] })
      .unit('v1', { owner: 'B', might: 2, location: { type: 'battlefield', id: 'bf1' } }),
  });
  f.flow.start();
  f.flow.execute(f.add([{ id: 'gain', op: 'effect.resources', args: { energy: { kind: 'constant', value: 3 } } }]));
  f.flow.execute(f.play('g1', 'gear', { type: 'battlefield', id: 'bf1' }));
  settle(f.flow);

  const gear = f.kernel.getObject('g1');
  assert.deepEqual(gear.location, { type: 'battlefield', id: 'bf1' });
  assert.equal(gear.zone, 'board');
  assert.equal(eventsOf(f.flow, 'object-enters-battlefield').length, 1);
  assert.equal(f.kernel.player('A').energy, 2);
  assert.deepEqual(f.kernel.objects.filter(object => object.location?.id === 'bf1').map(object => object.ref.id).sort(), ['g1', 'v1']);
  // 830.1.b.3 / 323.6: the cleanup that follows the play does not Recall it.
  assert.ok(f.flow.chain.pipeline.events.some(event => event.timingPoint === 'cleanup-start'));
  assert.deepEqual(f.kernel.getObject('g1').location, { type: 'battlefield', id: 'bf1' });
});
