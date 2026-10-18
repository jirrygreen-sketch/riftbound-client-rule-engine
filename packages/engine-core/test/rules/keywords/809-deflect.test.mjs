// docs/rules/scenarios/keywords.yaml — Deflect (CR v1.5 809.1.c, 809.1.c.1, 809.1.d, 809.2).
//
// The merged Deflect handling is split across two real layers: the printed keyword
// is summed by src/target/tax/collect.ts (`deflectAmount`), and the mandatory
// additional Power cost is planned and paid by the merged cost layer through
// `TargetTaxCostAdapter` (src/target/tax/adapter.ts). The scenarios below drive
// those layers directly, because the ChainEngine’s own target-tax bridge is still
// incomplete (it converts every tax into an Energy component; see src/chain/engine.ts).
import assert from 'node:assert/strict';
import test from 'node:test';
import { assessCostPayment, payCostPlan } from '../../../dist/cost/payment.js';
import { DUEL_DOMAINS } from '../../../dist/cost/resources.js';
import { bindResolveContext } from '../../../dist/events/action-adapter.js';
import { TargetTaxCostAdapter } from '../../../dist/target/tax/adapter.js';
import { collectTargetTaxes, deflectAmount, deflectCost } from '../../../dist/target/tax/collect.js';
import { TargetSelectionError } from '../../../dist/target/target-plan.js';
import { c, world } from './support.mjs';

const DEFLECTED = 'deflected';

/**
 * B’s [Deflect] unit on a Battlefield plus A’s spell in Hand. The returned
 * `state` is the same world the ResolveContext performs against, so payments are
 * observable there.
 */
const position = ({ deflect = [{ id: 'Deflect', value: 2 }], power = [], energy = 1, might = 3 } = {}) => {
  const kernel = world().player('A', { energy, power }).player('B')
    .hand('spell', { types: ['spell'], energy: 1, power: [] })
    .unit(DEFLECTED, { owner: 'B', controller: 'B', might, keywords: deflect, location: { type: 'battlefield', id: 'bf1' } })
    .deck(['A:deck:1'], { owner: 'A' }).deck(['B:deck:1'], { owner: 'B' }).build();
  const state = kernel.clone({ sourceSnapshot: kernel.getObject('spell'), controller: 'A' });
  const context = bindResolveContext(state, { controller: 'A' });
  return { kernel, state, context };
};

const targetSpec = id => ({ id, filter: { type: 'unit', zone: 'board' }, min: 1, max: 1 });
const anyDomainPower = (amount = 1) => ({ payments: [{ kind: 'power', amount: c(amount), allowedDomains: [...DUEL_DOMAINS] }] });

test('keywords-deflect-mandatory-additional-power-cost: Deflect 2 surfaces as a mandatory additional Power cost of any Domain (CR 809.1.c)', () => {
  const { state, context } = position({ power: ['Fury', 'Fury'], deflect: [{ id: 'Deflect', value: 2 }] });

  assert.equal(deflectAmount(state.getObject(DEFLECTED)), 2);
  const [tax] = collectTargetTaxes(context, state.getObject(DEFLECTED), { kind: 'spell' });
  assert.equal(tax.stage, 'mandatory-additional');
  assert.deepEqual(tax.cost.payments, [{ kind: 'power', amount: c(2), allowedDomains: [...DUEL_DOMAINS] }]);

  // The adapter folds the tax into the spell’s cost plan; the whole cost is payable.
  const adapter = new TargetTaxCostAdapter(context, { id: 'cost:spell', cost: { energy: c(1) } }, { kind: 'spell' });
  const plan = adapter.finalizeTargetPlan(targetSpec('target'), { selected: [state.ref(DEFLECTED)] });
  assert.deepEqual(plan.selected.map(ref => ref.id), [DEFLECTED]);
  assert.equal(adapter.costPlan.total.energy, 1);
  assert.deepEqual(adapter.costPlan.total.power, [{ amount: 2, allowedDomains: [...DUEL_DOMAINS] }]);
  assert.equal(assessCostPayment(context, adapter.costPlan).payable, true);

  const receipt = payCostPlan(context, adapter.costPlan);
  assert.equal(receipt.paid, true);
  assert.equal(state.player('A').energy, 0);
  assert.deepEqual(receipt.power.power, [{ requirementIndex: 0, from: 'Fury', amount: 2 }]);
});

test('keywords-deflect-power-any-domain: the additional Power may be of any Domain, independent of either card’s Domain (CR 809.1.c.1)', () => {
  const { state, context } = position({ power: ['Chaos'], deflect: [{ id: 'Deflect', value: 1 }] });
  const [tax] = collectTargetTaxes(context, state.getObject(DEFLECTED), { kind: 'spell' });
  assert.deepEqual(tax.cost.payments[0].allowedDomains, [...DUEL_DOMAINS], 'a Chaos Power can pay the tax on an Order unit for a Fury spell');

  const adapter = new TargetTaxCostAdapter(context, { id: 'cost:spell', cost: { energy: c(1) } }, { kind: 'spell' });
  adapter.finalizeTargetPlan(targetSpec('target'), { selected: [state.ref(DEFLECTED)] });
  const receipt = payCostPlan(context, adapter.costPlan);
  assert.deepEqual(receipt.power.power, [{ requirementIndex: 0, from: 'Chaos', amount: 1 }]);
  assert.equal(state.player('A').energy, 0);
});

test('keywords-deflect-insufficient-power-rejected: an unpayable mandatory additional cost makes the choice illegal (CR 809.1.d)', () => {
  const { state, context } = position({ power: [], deflect: [{ id: 'Deflect', value: 2 }] });

  const adapter = new TargetTaxCostAdapter(context, { id: 'cost:spell', cost: { energy: c(1) } }, { kind: 'spell' });
  // The adapter’s candidate filter drops the unpayable object before selection,
  // so the plan is rejected as “no legal target”; an explicit tax append reports
  // the same fact as `target-tax-unpayable`.
  assert.throws(
    () => adapter.finalizeTargetPlan(targetSpec('target'), { selected: [state.ref(DEFLECTED)] }),
    error => error instanceof TargetSelectionError && ['no-legal-targets', 'target-tax-unpayable'].includes(error.code)
  );
  // The explicit append path reports the same rejection without publishing a plan.
  const explicit = adapter.appendTargetTax({ kind: 'deflect', target: state.ref(DEFLECTED), payer: 'A', amount: 2, targetPlan: { selected: [state.ref(DEFLECTED)] } });
  assert.equal(explicit.status, 'unpayable');
  assert.equal(state.player('A').energy, 1, 'nothing was paid');
  assert.equal(adapter.costPlan.total.energy, 1, 'the rejected tax never entered the plan');
  assert.deepEqual(adapter.costPlan.total.power, []);
});

test('keywords-deflect-multiple-times-chosen-cost-multiplies: choosing the same Deflect object twice charges the tax twice (CR 809.1.c)', () => {
  const { state, context } = position({ power: ['Fury', 'Fury', 'Fury'], deflect: [{ id: 'Deflect', value: 1 }] });
  const adapter = new TargetTaxCostAdapter(context, { id: 'cost:spell', cost: { energy: c(1) } }, { kind: 'spell' });

  adapter.finalizeTargetPlan(targetSpec('first'), { selected: [state.ref(DEFLECTED)] });
  adapter.finalizeTargetPlan(targetSpec('second'), { selected: [state.ref(DEFLECTED)] });

  assert.deepEqual(adapter.costPlan.total.power, [
    { amount: 1, allowedDomains: [...DUEL_DOMAINS] },
    { amount: 1, allowedDomains: [...DUEL_DOMAINS] }
  ]);
  assert.equal(assessCostPayment(context, adapter.costPlan).payable, true, 'three Power cover the doubled 1-cost tax');
});

test('keywords-deflect-stacks-from-multiple-sources: printed Deflect 1 plus a granted Deflect 2 read as Deflect 3 (CR 809.2)', () => {
  const { state, context } = position({
    power: ['Fury', 'Fury', 'Fury'],
    deflect: [{ id: 'Deflect', value: 1 }, { id: 'Deflect', value: 2 }]
  });
  assert.equal(deflectAmount(state.getObject(DEFLECTED)), 3);
  const [tax] = collectTargetTaxes(context, state.getObject(DEFLECTED), { kind: 'spell' });
  assert.deepEqual(tax.cost.payments, [{ kind: 'power', amount: c(3), allowedDomains: [...DUEL_DOMAINS] }]);

  const adapter = new TargetTaxCostAdapter(context, { id: 'cost:spell', cost: { energy: c(1) } }, { kind: 'spell' });
  adapter.finalizeTargetPlan(targetSpec('target'), { selected: [state.ref(DEFLECTED)] });
  const receipt = payCostPlan(context, adapter.costPlan);
  // One requirement of three Power, allocated as a single Fury payment.
  assert.deepEqual(receipt.power.power, [{ requirementIndex: 0, from: 'Fury', amount: 3 }]);
});

test('keywords-deflect-*: a chooser already controlling the object never charges the tax (CR 809.1.c)', () => {
  const kernel = world().player('A', { energy: 1, power: ['Fury'] })
    .hand('spell', { types: ['spell'], energy: 1, power: [] })
    .unit('own', { controller: 'A', might: 3, keywords: [{ id: 'Deflect', value: 2 }], location: { type: 'base', player: 'A' } })
    .build();
  const context = bindResolveContext(kernel.clone({ sourceSnapshot: kernel.getObject('spell') }), { controller: 'A' });
  assert.equal(deflectAmount(kernel.getObject('own')), 2);
  assert.deepEqual(collectTargetTaxes(context, kernel.getObject('own'), { kind: 'spell' }), []);
  assert.deepEqual(deflectCost(2).payments, anyDomainPower(2).payments);
});

test.todo('keywords-deflect-* (chain wiring): ChainEngine’s target-tax bridge converts every TargetTaxRequest into an Energy component (src/chain/engine.ts) so an end-to-end Spell Play cannot charge 809.1.c.1’s any-Domain Power yet; the cost/target layers asserted above are the merged path');
