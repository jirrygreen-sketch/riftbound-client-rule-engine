// Scenario: targeting-conditional-clause-scopes-sentence (CR v1.5 135.2.b.5.b)
//
// Rogue Assassin structure: the leading condition governs the rest of the
// sentence, while a later "if I'm Empowered" clause only governs the single
// instruction that follows it.
import assert from 'node:assert/strict';
import test from 'node:test';
import { atBattlefield, constant, runBody, statuses, instruction } from './harness.mjs';
import { world } from '../../../dist/effects/testing/index.js';

test('targeting-conditional-clause-scopes-sentence: the outer condition covers the sentence, the inner one only its clause', () => {
  const kernel = world()
    .player('A', {})
    .player('B', {})
    .unit('u1', { owner: 'A', exhausted: true, location: atBattlefield('bf1') })
    .build();
  kernel.setTargets('u1', [kernel.ref('u1')]);

  // "If it's your turn, move a friendly unit in a showdown to base and if I'm Empowered, ready it."
  const outcome = runBody([{
    id: 'sentence',
    op: 'sequence',
    condition: { kind: 'always' },
    args: {
      body: constant([
        instruction('move', 'effect.zone', { target: 'u1', to: constant('base') }),
        instruction('ready', 'effect.ready', { objects: { kind: 'target', id: 'u1' } }, { condition: { kind: 'never' } })
      ])
    }
  }], kernel);

  assert.deepEqual(statuses(outcome), { move: 'executed', ready: 'negated', sentence: 'executed' });
  assert.deepEqual(kernel.getObject('u1').location, { type: 'base', player: 'A' }, 'the move executed');
  assert.equal(kernel.getObject('u1').exhausted, true, 'the Empowered clause was false, so the ready was skipped');
});
