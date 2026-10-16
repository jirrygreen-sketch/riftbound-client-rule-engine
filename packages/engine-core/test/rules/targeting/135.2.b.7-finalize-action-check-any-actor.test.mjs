// Scenario: targeting-finalize-action-check-any-actor (CR v1.5 135.2.b.7)
//
// Rampage: after the caster paid an optional additional cost at Finalize and
// another player gains control of the spell, "if you paid the additional cost"
// still holds because it checks the performed game action, not the payer.
import assert from 'node:assert/strict';
import test from 'node:test';
import { constant, instruction, scene, spend } from './harness.mjs';

test('targeting-finalize-action-check-any-actor: resolution can check the Finalize payment action', () => {
  const s = scene(builder => builder
    .player('A', { energy: 2 })
    .player('B', { energy: 0 })
    .hand('spell', { owner: 'A', types: ['spell'] })
    .deck(['d1'], { owner: 'A' })
    .base('a1', { owner: 'A', might: 2 }));
  // "As you play this, you may pay [C]. ... If you paid the additional cost, ..."
  // The resolution-time check reads whether the pay game action happened (135.2.b.7).
  const spell = s.draft('spell', {
    body: [
      { id: 'check', op: 'condition.history', args: { query: constant({ scope: 'turn', action: 'pay' }) } },
      instruction('draw', 'effect.draw', { amount: constant(1) }, {
        condition: {
          kind: 'compare',
          left: { kind: 'linked-value', instructionId: 'check', key: 'count' },
          operator: 'gte',
          right: constant(1)
        }
      })
    ],
    cost: { id: 'cost:spell', cost: { energy: constant(2), power: constant([]) } }
  });
  s.engine.execute(spell);
  spend(s.engine);

  assert.equal(s.kernel.player('A').energy, 0, 'the Finalize payment happened');
  assert.equal(s.kernel.getObject('d1').zone, 'hand', '135.2.b.7: the resolution instruction saw the Finalize pay action');
});

test.todo('targeting-finalize-action-check-any-actor (control-change half): blocked on a chain-item control instruction (135.2.b.7 + 750) — no merged op gains control of a finalized spell, so the "another player paid" case cannot be constructed');
