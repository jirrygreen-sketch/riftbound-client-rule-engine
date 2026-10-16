// CR v1.5 356.4.g — scenario costs-variable-discount-checked-at-finalize.
import assert from 'node:assert/strict';
import test from 'node:test';
import { world, withSource, buildCostPlan, payCostPlan } from './harness.mjs';

test('costs-variable-discount-checked-at-finalize: the Trash count is locked into the plan', () => {
  const kernel = world()
    .player('A', { energy: 6 })
    .player('B', { energy: 0 })
    .hand('spell', { types: ['spell'], energy: 9, power: [] })
    .card('trash-1', { zone: 'trash' })
    .card('trash-2', { zone: 'trash' })
    .card('trash-3', { zone: 'trash' })
    .deck(['A:deck:1', 'A:deck:2'], { owner: 'A' })
    .build();
  const ctx = withSource(kernel, 'spell');

  const plan = buildCostPlan(ctx, {
    id: 'play:spell',
    cost: { kind: 'printed' },
    discounts: [{ id: 'trash-count', resource: 'energy', amount: { kind: 'count', filter: { zone: 'trash', owner: 'A' } } }]
  });
  assert.equal(plan.total.energy, 6);

  ctx.perform({ type: 'mill', player: 'A', amount: 2 });
  assert.equal(ctx.objectsInZone('A', 'trash').length, 5);
  assert.equal(payCostPlan(ctx, plan).total.energy, 6);
  assert.equal(ctx.player('A').energy, 0);
});
