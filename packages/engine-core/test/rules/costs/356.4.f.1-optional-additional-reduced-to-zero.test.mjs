// CR v1.5 356.4.f / 356.4.f.1 / 135.2.b.7 — scenario costs-optional-additional-reduced-to-zero.
import assert from 'node:assert/strict';
import test from 'node:test';
import { world, withSource, buildCostPlan, payCostPlan, constant } from './harness.mjs';

test('costs-optional-additional-reduced-to-zero: the decision to pay still counts as paid', () => {
  const kernel = world()
    .player('A', { energy: 2 })
    .player('B', { energy: 0 })
    .hand('unit', { types: ['unit'], energy: 2, power: [] })
    .deck(['A:deck:1'], { owner: 'A' })
    .deck(['B:deck:1'], { owner: 'B' })
    .build();
  const ctx = withSource(kernel, 'unit');

  const plan = buildCostPlan(ctx, {
    id: 'play:unit',
    cost: { kind: 'printed' },
    optionalAdditional: [{
      id: 'keeper',
      kind: 'additional',
      cost: { payments: [{ kind: 'power', amount: constant(1), allowedDomains: ['Fury'] }] },
      selected: true
    }],
    discounts: [{ id: 'power-discount', resource: 'power', amount: constant(1) }]
  });

  assert.deepEqual(plan.total.power, []);
  assert.deepEqual(plan.selectedAdditional, [{ id: 'keeper', kind: 'additional' }]);
  const receipt = payCostPlan(ctx, plan);
  assert.deepEqual(receipt.additional, [{ id: 'keeper', kind: 'additional', paid: true }]);
  assert.equal(receipt.paid, true);
});
