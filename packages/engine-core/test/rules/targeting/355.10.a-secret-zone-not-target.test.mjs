// Scenario: targeting-secret-zone-not-target (CR v1.5 355.10.a, 355.8)
//
// Hand is not a public zone, so a card named there is not a target: the spell
// finalizes with no target choice and the unit is picked as the effect resolves.
import assert from 'node:assert/strict';
import test from 'node:test';
import { constant, scene, spend } from './harness.mjs';

test('targeting-secret-zone-not-target: the played-from-hand card is never a target', () => {
  const s = scene(builder => builder
    .player('A', { energy: 3 })
    .player('B', { energy: 0 })
    .hand('spell', { owner: 'A', types: ['spell'] })
    .hand('unit', { owner: 'A', types: ['unit'], might: 2 }), {
    // The chain needs a card-program adapter for Play actions; the program has no target specs.
    describePlay: (action, source) => ({
      id: 'play:' + source.ref.id,
      controller: action.player,
      source,
      kind: 'unit',
      speed: 'action',
      body: [],
      location: action.location ?? { type: 'base', player: action.player }
    })
  });
  const spell = s.draft('spell', {
    // "You may play a unit from your hand, ignoring its costs": the unit is chosen as the effect resolves.
    body: [{
      id: 'may',
      op: 'choice.optional',
      args: {
        body: constant([{
          id: 'play',
          op: 'effect.play',
          args: {
            pick: 'hand-card',
            location: constant({ type: 'base', player: 'A' }),
            cost: constant({ finalized: true, energy: 0, power: [] })
          }
        }])
      }
    }],
    cost: { id: 'cost:spell', cost: { energy: constant(0), power: constant([]) } }
  });
  s.engine.execute(spell);

  assert.deepEqual(s.engine.items[0].targetPlans, [], '355.10.a: nothing in hand is a target');
  assert.equal(s.kernel.getObject('unit').zone, 'hand', 'the hand card is untouched at Finalize');
  assert.deepEqual(s.engine.pipeline.events.filter(event => event.timingPoint === 'became-target'), []);

  s.answers.set('may/optional', true);
  s.kernel.setPicks('hand-card', [s.kernel.ref('unit')]);
  spend(s.engine);

  assert.equal(s.kernel.getObject('unit').zone, 'board', 'the pick played the unit from hand');
  assert.deepEqual(s.engine.pipeline.events.filter(event => event.timingPoint === 'became-target'), []);
});
