import assert from 'node:assert/strict';
import test from 'node:test';
import { AwaitChoice } from '../../../dist/effects/contract.js';
import { DUEL_DOMAINS } from '../../../dist/cost/resources.js';
import { CostPlanError } from '../../../dist/cost/plan-types.js';
import {
  buildAdditionalCostPlan,
  buildDiscardCostPlan,
  buildExhaustCostPlan,
  buildHiddenKindCostPlan,
  buildRecycleCostPlan,
  buildSacrificeCostPlan,
  buildXpCostPlan,
  assessCostPayment,
  canPayCostPlan,
  payAdditionalCostPlan,
  payDiscardCostPlan,
  payExhaustCostPlan,
  payHiddenCostPlan,
  payRecycleCostPlan,
  paySacrificeCostPlan,
  payXpCostPlan
} from '../../../dist/cost/kinds/index.js';
import { world } from '../../../dist/effects/testing/index.js';

const literal = value => ({ kind: 'constant', value });
const printed = (values = {}) => ({ id: 'source', cardType: 'Spell', energy: 3, power: 0, domains: ['Fury'], ...values });
const base = (values = {}) => ({ id: 'kind-cost', ...values });
const failure = reason => error => error instanceof CostPlanError && error.reason === reason;

function withSource(builder, id) {
  const ctx = builder.build();
  return ctx.clone({ sourceSnapshot: ctx.object(ctx.ref(id)) });
}

const fixture = (values = {}) => withSource(
  world().player('A', { energy: 20, ...(values.player ?? {}) }).hand('source', { types: ['spell'], energy: values.sourceEnergy ?? 3, power: [] }),
  'source'
);

test('hidden hide locks the any-domain hiding cost and play ignores the printed base', () => {
  const hideCtx = fixture({ player: { power: ['Fury'] } });
  const hidePlan = buildHiddenKindCostPlan(hideCtx, base({ mode: 'hide' }));
  assert.deepEqual(hidePlan.total.power, [{ amount: 1, allowedDomains: DUEL_DOMAINS }]);
  assert.equal(hidePlan.total.energy, 0);
  assert.ok(Object.isFrozen(hidePlan));
  const hideReceipt = payHiddenCostPlan(hideCtx, hidePlan);
  assert.equal(hideReceipt.actions[0].action.type, 'pay');
  assert.deepEqual(hideReceipt.actions[0].action.plan.power, ['Fury']);
  assert.equal(hideCtx.player('A').energy, 20);

  const playCtx = fixture();
  const playPlan = buildHiddenKindCostPlan(playCtx, base({ mode: 'play' }));
  assert.equal(playPlan.base.energy, 3);
  assert.equal(playPlan.components.find(component => component.id === 'base').original.energy, 0);
  assert.equal(playPlan.total.energy, 0);
  payHiddenCostPlan(playCtx, playPlan);
  assert.equal(playCtx.player('A').energy, 20);
});

test('hidden sideways mode is rejected as an invalid cost plan', () => {
  assert.throws(() => buildHiddenKindCostPlan(fixture(), base({ mode: 'sideways' })), failure('invalid-cost-plan'));
});

test('additional locks the Accelerate default and records declined options', () => {
  const selected = buildAdditionalCostPlan(
    fixture({ player: { energy: 4, power: ['Fury'] } }),
    base({ cost: { kind: 'printed' }, printed: printed() }),
    [{ id: 'accelerate', kind: 'accelerate', selected: true }]
  );
  assert.equal(selected.total.energy, 4);
  assert.deepEqual(selected.total.power, [{ amount: 1, allowedDomains: ['Fury'] }]);
  assert.deepEqual(selected.selectedAdditional, [{ id: 'accelerate', kind: 'accelerate' }]);

  const declined = buildAdditionalCostPlan(fixture(), base({ cost: { kind: 'printed' }, printed: printed() }), [{ id: 'accelerate', kind: 'accelerate', selected: false }]);
  assert.equal(declined.total.energy, 3);
  assert.deepEqual(declined.declinedAdditional, ['accelerate']);
});

test('unanswered additional options suspend for a Finalize choice', () => {
  assert.throws(
    () => buildAdditionalCostPlan(fixture(), base({ cost: { kind: 'printed' }, printed: printed() }), [{ id: 'accelerate', kind: 'accelerate' }]),
    error => error instanceof AwaitChoice && error.request.id === 'kind-cost:optional:accelerate'
  );
});

test('sacrifice kills a friendly unit and blocks repeat payment of the same identity', () => {
  const ctx = withSource(world().player('A').unit('ally').hand('source', { types: ['spell'], energy: 3, power: [] }), 'source');
  const plan = buildSacrificeCostPlan(ctx, ctx.ref('ally'), base({}));
  assert.deepEqual(plan.total.actions.map(action => action.action.type), ['kill']);
  paySacrificeCostPlan(ctx, plan);
  assert.deepEqual(ctx.objectsInZone('A', 'trash').map(ref => ref.id), ['ally']);
  const before = ctx.snapshot();
  assert.throws(() => paySacrificeCostPlan(ctx, plan), failure('cannot-pay-cost'));
  assert.deepEqual(ctx.snapshot(), before);
});

test('xp pays through the spend-xp resource after standard resources', () => {
  const ctx = fixture({ player: { xp: 3 } });
  const plan = buildXpCostPlan(ctx, literal(2), base({}));
  assert.equal(plan.total.xp, 2);
  assert.equal(plan.total.energy, 0);
  const receipt = payXpCostPlan(ctx, plan);
  assert.deepEqual(receipt.actions.map(action => action.action.type), ['pay', 'spend-xp']);
  assert.equal(receipt.total.xp, 2);
  assert.equal(ctx.player('A').xp, 1);
  assert.throws(() => payXpCostPlan(ctx, plan), failure('cannot-pay-cost'));
});

test('discard pays with explicit objects and with a stable object choice', () => {
  const objectCtx = withSource(world().player('A').hand('burn', { types: ['spell'], energy: 1, power: [] }).hand('source', { types: ['spell'], energy: 3, power: [] }), 'source');
  const objectPlan = buildDiscardCostPlan(objectCtx, { object: objectCtx.ref('burn') }, base({}));
  assert.deepEqual(objectPlan.total.actions.map(action => action.action.type), ['discard']);
  payDiscardCostPlan(objectCtx, objectPlan);
  assert.deepEqual(objectCtx.objectsInZone('A', 'trash').map(ref => ref.id), ['burn']);

  const choiceCtx = withSource(world().player('A').hand('burn', { types: ['spell'], energy: 1, power: [] }).hand('keep', { types: ['spell'], energy: 1, power: [] }).hand('source', { types: ['spell'], energy: 3, power: [] }), 'source');
  const choiceSpec = { choice: { id: 'burn-pick', options: [choiceCtx.ref('burn')] } };
  assert.throws(() => buildDiscardCostPlan(choiceCtx, choiceSpec, base({})), error => error instanceof AwaitChoice && error.request.id === 'kind-cost:pick:burn-pick');
  choiceCtx.setPicks('burn-pick', [choiceCtx.ref('burn')]);
  const answeredPlan = buildDiscardCostPlan(choiceCtx, choiceSpec, base({}));
  assert.deepEqual(answeredPlan.total.actions.map(action => action.action.object.id), ['burn']);
  payDiscardCostPlan(choiceCtx, answeredPlan);
  assert.deepEqual(choiceCtx.objectsInZone('A', 'trash').map(ref => ref.id), ['burn']);
});

test('recycle returns an owned Trash card to the deck bottom', () => {
  const ctx = withSource(world().player('A').card('spent', { zone: 'trash' }).card('stays', { zone: 'trash' }).hand('source', { types: ['spell'], energy: 3, power: [] }), 'source');
  const plan = buildRecycleCostPlan(ctx, { objects: [ctx.ref('spent')] }, base({}));
  assert.deepEqual(plan.total.actions.map(action => action.action.type), ['recycle']);
  payRecycleCostPlan(ctx, plan);
  assert.deepEqual(ctx.zone('A', 'deck').map(ref => ref.id), ['spent']);
  assert.deepEqual(ctx.objectsInZone('A', 'trash').map(ref => ref.id), ['stays']);
});

test('exhaust pays a ready permanent and refuses an already exhausted one', () => {
  const ctx = withSource(world().player('A').card('gear', { zone: 'board', location: { type: 'battlefield', id: 'battlefield-1' } }).hand('source', { types: ['spell'], energy: 3, power: [] }), 'source');
  const plan = buildExhaustCostPlan(ctx, { object: ctx.ref('gear') }, base({}));
  assert.deepEqual(plan.total.actions.map(action => action.action.type), ['exhaust']);
  payExhaustCostPlan(ctx, plan);
  assert.equal(ctx.getObject('gear').exhausted, true);
  const before = ctx.snapshot();
  assert.throws(() => payExhaustCostPlan(ctx, plan), failure('cannot-pay-cost'));
  assert.deepEqual(ctx.snapshot(), before);
});

test('declined additional costs record nothing and pay only the base', () => {
  const ctx = fixture();
  const declined = buildAdditionalCostPlan(ctx, base({ cost: { kind: 'printed' }, printed: printed() }), [{ id: 'fee', kind: 'additional', cost: { energy: literal(2) }, selected: false }]);
  assert.equal(declined.total.energy, 3);
  const receipt = payAdditionalCostPlan(ctx, declined);
  assert.equal(receipt.total.energy, 3);
  assert.deepEqual(receipt.additional, []);
  assert.equal(ctx.player('A').energy, 17);
});

test('Finalize callers can assess a locked kind plan without performing payment', () => {
  const ctx = fixture({ player: { energy: 4 } });
  const plan = buildAdditionalCostPlan(ctx, base({ cost: { kind: 'printed' }, printed: printed() }), [
    { id: 'fee', kind: 'additional', cost: { energy: literal(1) }, selected: true }
  ]);
  const assessment = assessCostPayment(ctx, plan);
  assert.equal(assessment.payable, true);
  assert.deepEqual(assessment.prepared.actions.map(action => action.action.type), ['pay']);
  assert.equal(canPayCostPlan(ctx, plan), true);
  assert.equal(ctx.player('A').energy, 4);

  const short = fixture({ player: { energy: 0 } });
  const shortPlan = buildAdditionalCostPlan(short, base({ cost: { kind: 'printed' }, printed: printed() }), [
    { id: 'fee', kind: 'additional', cost: { energy: literal(1) }, selected: true }
  ]);
  const unavailable = assessCostPayment(short, shortPlan);
  assert.equal(unavailable.payable, false);
  assert.equal(unavailable.error.reason, 'cannot-pay-cost');
  assert.equal(canPayCostPlan(short, shortPlan), false);
  assert.equal(short.player('A').energy, 0);
});

test('kind payment delegates can run inside the caller-owned Finalize transaction', () => {
  const ctx = fixture({ player: { energy: 3, xp: 1 } });
  const plan = buildXpCostPlan(ctx, literal(1), base({}));
  let entered = false;
  const receipt = payXpCostPlan(ctx, plan, {
    transaction: run => {
      entered = true;
      return run();
    }
  });
  assert.equal(entered, true);
  assert.equal(receipt.paid, true);
  assert.equal(ctx.player('A').xp, 0);
});
