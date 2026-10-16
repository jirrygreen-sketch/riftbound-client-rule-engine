// Scenario: targeting-conditional-scope-false-blocks-sentence (CR v1.5 135.2.b.5.b)
//
// When the leading condition is false the whole sentence is skipped: the spell
// still resolves but neither draws nor discards.
import assert from 'node:assert/strict';
import test from 'node:test';
import { constant, instruction, scene, spend } from './harness.mjs';

test('targeting-conditional-scope-false-blocks-sentence: a false leading condition blocks every following instruction', () => {
  const s = scene(builder => builder
    .player('A', { energy: 1 })
    .player('B', { energy: 0 })
    .hand('spell', { owner: 'A', types: ['spell'] })
    .deck(['d1', 'd2'], { owner: 'A' }));
  // "If you've gained a point this turn, draw 1, then discard 1." - the condition is false.
  const spell = s.draft('spell', {
    body: [{
      id: 'sentence',
      op: 'sequence',
      condition: { kind: 'never' },
      args: { body: constant([
        instruction('draw', 'effect.draw', { amount: constant(1) }),
        instruction('discard', 'effect.discard', { amount: constant(1) })
      ]) }
    }],
    cost: { id: 'cost:spell', cost: { energy: constant(1), power: constant([]) } }
  });
  s.engine.execute(spell);
  assert.deepEqual(s.engine.items[0].targetPlans, []);

  spend(s.engine);

  assert.equal(s.kernel.player('A').handSize, 0, 'nothing was drawn');
  assert.equal(s.kernel.player('A').deckSize, 2, 'the deck is untouched');
  assert.equal(s.kernel.getObject('spell').zone, 'trash', 'the spell resolved');
});
