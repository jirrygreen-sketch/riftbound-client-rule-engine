// Scenario: targeting-replaced-linked-if-not-execute (CR v1.5 359.3.e.14.b, 370.1)
//
// Deathgrip structure: when the kill is replaced, the linked instruction that
// directly references the kill action ("if you do") must not execute.
import assert from 'node:assert/strict';
import test from 'node:test';
import { atBase, linked, runBody, statuses, reasons } from './harness.mjs';
import { world } from '../../../dist/effects/testing/index.js';

test('targeting-replaced-linked-if-not-execute: a replaced kill suppresses the "if you do" instruction', () => {
  const kernel = world()
    .unit('u1', { owner: 'A', might: 2, location: atBase('A') })
    .unit('u2', { owner: 'A', might: 2, location: atBase('A') })
    .build();
  kernel.setTargets('u1', [kernel.ref('u1')]);
  kernel.setTargets('u2', [kernel.ref('u2')]);
  // Zhonya's Hourglass stand-in: the death of a friendly unit is replaced.
  kernel.addReplacement(action => action.type === 'kill' ? 'replaced' : null);

  const outcome = runBody([
    { id: 'sac', op: 'effect.kill', args: { target: 'u1' } },
    // "If you do, give the other friendly unit +[M]" references the kill action itself.
    {
      id: 'buff',
      op: 'effect.buff',
      args: { mode: 'buff', target: 'u2' },
      linkedTo: 'sac',
      condition: { kind: 'expression', value: linked('sac', 'killed') }
    }
  ], kernel);

  assert.equal(statuses(outcome).sac, 'negated');
  assert.equal(reasons(outcome).sac, 'replaced', '370.1: the replacement negates the kill');
  assert.notEqual(statuses(outcome).buff, 'executed', '359.3.e.14.b: the "if you do" instruction must not execute');
  assert.equal(kernel.getObject('u1').zone, 'board', 'the death was replaced');
  assert.equal(kernel.getObject('u2').buffs, 0);
});
