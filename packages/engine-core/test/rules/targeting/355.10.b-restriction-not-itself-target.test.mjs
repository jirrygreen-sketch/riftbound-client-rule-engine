// Scenario: targeting-restriction-not-itself-target (CR v1.5 355.10.b)
//
// "at a battlefield" only restricts which unit is chosen; the Battlefield is
// not itself a target, so a Battlefield targeting trigger does not fire.
import assert from 'node:assert/strict';
import test from 'node:test';
import { atBattlefield, constant, instruction, scene, spend } from './harness.mjs';

const battlefield = (id, owner, text) => ({
  ref: { id, zoneEntryId: 1 },
  cardId: 'card:' + id,
  name: id,
  types: ['battlefield'],
  tags: [],
  keywords: [],
  owner,
  controller: owner,
  zone: 'board',
  location: null,
  might: null,
  energy: null,
  power: null,
  exhausted: false,
  damage: 0,
  stunned: false,
  buffs: 0,
  attachedTo: null,
  faceDown: false,
  isToken: false,
  text
});

test('targeting-restriction-not-itself-target: the restriction keeps the battlefield untargeted', () => {
  const s = scene(builder => builder
    .player('A', { energy: 2 })
    .player('B', { energy: 0 })
    .hand('spell', { owner: 'A', types: ['spell'] })
    .unit('t1', { owner: 'B', might: 2, location: atBattlefield('bf1') }));
  s.kernel.addObject(battlefield('bf1', 'B', 'When this battlefield becomes the target of a spell or ability, draw 1.'), 'board');
  s.watch('bf1-targeting-effect', 'bf1', {
    filter: { target: { objectId: 'bf1' } },
    body: [instruction('mark', 'effect.exhaust', { self: true })]
  });
  const spell = s.draft('spell', {
    body: [{ id: 'kill', op: 'effect.kill', args: { target: 't1' } }],
    targets: [{ requirement: { id: 't1', filter: { type: 'unit', zone: 'board', location: 'battlefield' } } }],
    cost: { id: 'cost:spell', cost: { energy: constant(2), power: constant([]) } }
  });
  s.engine.execute(spell);

  assert.deepEqual(s.engine.items.map(item => item.kind), ['spell'], 'no trigger for the battlefield');
  assert.deepEqual(
    s.engine.pipeline.events.filter(event => event.timingPoint === 'became-target').map(event => event.target.ref.id),
    ['t1']
  );

  spend(s.engine);
  assert.equal(s.kernel.getObject('t1').zone, 'trash');
  assert.equal(s.kernel.getObject('bf1').exhausted, false);
});
