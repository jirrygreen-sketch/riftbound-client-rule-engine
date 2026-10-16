// CR v1.5 206 / 204.1.a — scenario costs-printed-null-not-zero.
import assert from 'node:assert/strict';
import test from 'node:test';
import { world, withSource, buildCostPlan, constant, CostPlanError } from './harness.mjs';

test.todo('costs-printed-null-not-zero (reference check half): 场景 UNCERTAIN 的“印 0 触发 / null 不触发”部分需要按印刷费用做触发条件检查的原语接线（与 costs-printed-cost-check-ignores-discount 同一缺口）；本文件只执行可确定的 “null ≠ 免费 0” 费用层语义');

test('costs-printed-null-not-zero: a missing printed Energy cost is not a free [0] cost', () => {
  const kernel = world()
    .player('A', { energy: 1 })
    .player('B', { energy: 0 })
    .hand('legend', { types: ['legend'], energy: null, power: null })
    .build();
  const ctx = withSource(kernel, 'legend');

  assert.throws(
    () => buildCostPlan(ctx, { id: 'play:legend', cost: { kind: 'printed' } }),
    error => error instanceof CostPlanError && error.reason === 'missing-printed-cost'
  );
  assert.equal(ctx.player('A').energy, 1);
});

test('costs-printed-null-not-zero: an explicit alternate cost keeps printed nulls intact', () => {
  const kernel = world()
    .player('A', { energy: 1 })
    .player('B', { energy: 0 })
    .hand('legend', { types: ['legend'], energy: null, power: null })
    .build();
  const ctx = withSource(kernel, 'legend');

  const plan = buildCostPlan(ctx, {
    id: 'play:legend',
    cost: { kind: 'printed' },
    printed: { id: 'legend-printing', cardType: 'Spell', domains: [], energy: null, power: null },
    baseModifications: [{ id: 'alternate', kind: 'alternate', cost: { energy: constant(1) } }]
  });

  assert.deepEqual(plan.printed, { energy: null, power: null });
  assert.equal(plan.base, null);
  assert.equal(plan.total.energy, 1);
});
