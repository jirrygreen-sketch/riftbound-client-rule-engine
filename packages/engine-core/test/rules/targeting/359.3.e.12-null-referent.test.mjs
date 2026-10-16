// Scenario: targeting-null-referent-ignores-linked (CR v1.5 359.3.e.12, 359.3.f.2.a)
//
// After the target became illegal, information read from it returns null; the
// instruction that depends on that value is ignored too.
import assert from 'node:assert/strict';
import test from 'node:test';
import { atBattlefield, property, runBody, statuses, reasons } from './harness.mjs';
import { world } from '../../../dist/effects/testing/index.js';

test('targeting-null-referent-ignores-linked: a null referent ignores the dependent instruction', () => {
  const kernel = world()
    .unit('t1', { owner: 'B', might: 3, location: atBattlefield('bf1') })
    .unit('lg', { owner: 'B', types: ['legend'], might: null, location: { type: 'base', player: 'B' } })
    .build();
  kernel.setTargets('t1', [kernel.ref('t1')]);
  kernel.setTargets('lg', [kernel.ref('lg')]);
  // Reaction stand-in: the unit leaves its battlefield, so its Might is null.
  kernel.perform({ type: 'move-location', object: kernel.ref('t1'), to: { type: 'base', player: 'B' } });

  const outcome = runBody([
    { id: 'kill', op: 'effect.kill', args: { target: 't1' }, targets: [{ id: 't1', filter: { type: 'unit', zone: 'board', location: 'battlefield' } }] },
    {
      id: 'strike',
      op: 'effect.damage',
      args: { amount: property({ target: 't1' }, 'might'), target: 'lg' },
      targets: [{ id: 'lg', filter: { type: 'legend', zone: 'board' } }]
    }
  ], kernel);

  assert.deepEqual(statuses(outcome), { kill: 'ignored', strike: 'ignored' });
  assert.equal(reasons(outcome).kill, 'mistargeted');
  assert.equal(kernel.getObject('lg').damage, 0, '359.3.e.12: the null Might reference ignores the damage');
  assert.equal(kernel.getObject('t1').damage, 0);
});
