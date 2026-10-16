// CR v1.5 809.1.c / 809.1.c.1 / 356.2.a.2 — scenario costs-deflect-mandatory-power.
// The target layer reports the Deflect tax for the chosen object; the merged cost
// layer then pays it as a mandatory additional Power cost of any Domain. The
// ChainEngine's current target-tax bridge only carries Energy, so these tests
// execute the real target + cost layers instead of that incomplete wiring.
import assert from 'node:assert/strict';
import test from 'node:test';
import { world, withSource, buildCostPlan, payCostPlan, finalizeTargetPlan, constant, DUEL_DOMAINS } from './harness.mjs';

test.todo('costs-deflect-mandatory-power (chain wiring): ChainEngine 的 target-tax 桥把税额一律转成 energy mandatoryAdditional（chain/engine.ts），缺少 809.1.c.1 的任意领域 Power 税；接好该桥后才能端到端执行本场景');

test('costs-deflect-mandatory-power: Deflect reports the tax and any-Domain Power pays it', () => {
  const kernel = world()
    .player('A', { energy: 1, power: ['Mind'] })
    .player('B', { energy: 0 })
    .hand('spell', { types: ['spell'], energy: 1, power: [] })
    .unit('d1', { owner: 'B', controller: 'B', keywords: [{ id: 'Deflect', value: 1 }], location: { type: 'battlefield', id: 'bf1' } })
    .deck(['A:deck:1'], { owner: 'A' })
    .deck(['B:deck:1'], { owner: 'B' })
    .build();
  const ctx = withSource(kernel, 'spell');

  // The typed Deflect expansion (effects/keywords/Deflect.ts) is a target tax;
  // the target layer must surface exactly one request for the chosen object.
  const requested = [];
  finalizeTargetPlan(ctx, { id: 'target', filter: { type: 'unit', zone: 'board' }, min: 1, max: 1 }, {
    selected: [kernel.ref('d1')],
    tax: { kind: 'deflect', amount: 1, payer: 'A' },
    taxAdapter: { appendTargetTax: tax => { requested.push(tax); } }
  });
  assert.deepEqual(requested.map(tax => [tax.kind, tax.amount, tax.payer]), [['deflect', 1, 'A']]);

  // 809.1.c.1: the Power used may be of any Domain.
  const plan = buildCostPlan(ctx, {
    id: 'cost:spell',
    cost: { energy: constant(1) },
    mandatoryAdditional: [{
      id: 'deflect',
      cost: { payments: [{ kind: 'power', amount: constant(1), allowedDomains: [...DUEL_DOMAINS] }] }
    }]
  });
  const receipt = payCostPlan(ctx, plan);
  assert.deepEqual(plan.total.power, [{ amount: 1, allowedDomains: [...DUEL_DOMAINS] }]);
  assert.deepEqual(receipt.actions[0].action.plan.power, ['Mind']);
  assert.deepEqual(receipt.power.power, [{ requirementIndex: 0, from: 'Mind', amount: 1 }]);
});

test('costs-deflect-unpaid-fails: no Power at all cannot pay the Deflect tax', () => {
  const kernel = world()
    .player('A', { energy: 1, power: [] })
    .player('B', { energy: 0 })
    .hand('spell', { types: ['spell'], energy: 1, power: [] })
    .unit('d1', { owner: 'B', controller: 'B', keywords: [{ id: 'Deflect', value: 1 }], location: { type: 'battlefield', id: 'bf1' } })
    .deck(['A:deck:1'], { owner: 'A' })
    .deck(['B:deck:1'], { owner: 'B' })
    .build();
  const ctx = withSource(kernel, 'spell');

  assert.throws(
    () => payCostPlan(ctx, buildCostPlan(ctx, {
      id: 'cost:spell',
      cost: { energy: constant(1) },
      mandatoryAdditional: [{
        id: 'deflect',
        cost: { payments: [{ kind: 'power', amount: constant(1), allowedDomains: [...DUEL_DOMAINS] }] }
      }]
    })),
    error => error.reason === 'cannot-pay-cost'
  );

  assert.equal(kernel.player('A').energy, 1);
});
