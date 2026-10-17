// docs/rules/scenarios/keywords.yaml — Repeat (CR v1.5 820.1.c.2, 820.1.d, 820.1.d.1, 820.3, 820.3.a).
//
// Two merged pieces exist separately: the cost layer charges one optional Repeat
// instance per `optionalAdditional` entry, and the interpreter’s `repeat` primitive
// executes a body once per paid instance. What is missing is the bridge between the
// Finalize receipt and the Resolve-time repeat count, so the tests below execute both
// real halves and register the end-to-end scenarios as todos.
import assert from 'node:assert/strict';
import test from 'node:test';
import { buildCostPlan } from '../../../dist/cost/cost-plan.js';
import { assessCostPayment, payCostPlan } from '../../../dist/cost/payment.js';
import repeat from '../../../dist/effects/instructions/effect.repeat.js';
import { runInstruction, world } from '../../../dist/effects/testing/index.js';
import { bindResolveContext } from '../../../dist/events/action-adapter.js';
import repeatKeyword from '../../../dist/effects/keywords/Repeat.js';
import { c, fixture, settle } from './support.mjs';

const REPEAT_CARD = 'test:repeat-spell';

/** The spell body: “Deal 1 to a unit.” */
const damageOne = { id: 'hit', op: 'effect.damage', args: { amount: c(1), target: c('victim') }, targets: [{ id: 'victim', filter: { type: 'unit', zone: 'board' }, min: 1, max: 1 }] };

const program = {
  canonicalCardId: REPEAT_CARD,
  rulesetVersion: 'core-1.5',
  status: 'executable',
  sourceText: 'Repeat [2][E]. Deal 1 to a unit.',
  abilities: [{ kind: 'play', cost: { kind: 'printed' }, body: [damageOne] }]
};

test('keywords-repeat-paid-executes-twice / keywords-repeat-not-paid-executes-once: the cost layer charges each Repeat instance once (CR 820.1.c.2)', () => {
  const kernel = world().player('A', { energy: 6 }).player('B')
    .hand('spell', { cardId: REPEAT_CARD, types: ['spell'], energy: 2, power: null, keywords: [{ id: 'Repeat' }] })
    .unit('victim', { owner: 'B', controller: 'B', might: 5 })
    .deck(['A:deck:1'], { owner: 'A' }).deck(['B:deck:1'], { owner: 'B' }).build();
  // The cost layer acts on the context, so the payment is read from that world.
  const state = kernel.clone({ sourceSnapshot: kernel.getObject('spell'), controller: 'A' });
  const context = bindResolveContext(state, { controller: 'A' });
  const repeatCost = { kind: 'explicit', energy: c(2) };

  const declined = buildCostPlan(context, {
    id: 'cost:declined', cost: { kind: 'printed' },
    optionalAdditional: [{ id: 'repeat', kind: 'repeat', cost: repeatCost, selected: false }]
  });
  assert.deepEqual(declined.declinedAdditional, ['repeat']);
  assert.equal(declined.total.energy, 2, 'declining charges only the printed cost');

  const paid = buildCostPlan(context, {
    id: 'cost:paid', cost: { kind: 'printed' },
    optionalAdditional: [{ id: 'repeat', kind: 'repeat', cost: repeatCost, selected: true }]
  });
  assert.deepEqual(paid.selectedAdditional, [{ id: 'repeat', kind: 'repeat' }]);
  assert.equal(paid.total.energy, 4, 'paying adds the Repeat cost exactly once');
  assert.equal(assessCostPayment(context, paid).payable, true);

  const receipt = payCostPlan(context, paid);
  assert.equal(receipt.paid, true);
  assert.equal(state.player('A').energy, 2, '6 minus the printed 2 Energy and the paid 2 Repeat cost');

  // Two separate instances each charge once (CR 820.1.c.2).
  const two = buildCostPlan(context, {
    id: 'cost:two', cost: { kind: 'printed' },
    optionalAdditional: [
      { id: 'repeat-1', kind: 'repeat', cost: { kind: 'explicit', energy: c(2) }, selected: true },
      { id: 'repeat-2', kind: 'repeat', cost: { kind: 'explicit', energy: c(3) }, selected: true }
    ]
  });
  assert.equal(two.total.energy, 7, '2 printed + 2 + 3');
  assert.equal(repeatKeyword.stacking, 'separate', '820.1.c.3: instances stay independent');
});

test('keywords-repeat-paid-executes-twice / keywords-repeat-multiple-instances-paid-separately: the merged repeat primitive executes once per paid instance (CR 820.1.d.1, 820.3)', () => {
  for (const [count, expectedDamage] of [[1, 1], [2, 2], [3, 3]]) {
    const scratch = world().player('A').player('B')
      .unit('victim', { owner: 'B', controller: 'B', might: 9, location: { type: 'battlefield', id: 'bf1' } }).build();
    const scratchContext = scratch.clone({ sourceSnapshot: scratch.getObject('victim'), controller: 'A' });
    scratchContext.setTargets('victim', [scratch.ref('victim')]);
    const run = runInstruction(repeat, {
      actions: [{ type: 'damage', targets: { target: 'victim' }, amount: c(1) }],
      count: c(count)
    }, { world: scratchContext });
    assert.equal(run.result.status, 'executed');
    assert.equal(scratchContext.getObject('victim').damage, expectedDamage, `${count} paid instance(s) → ${expectedDamage} execution(s)`);
    assert.equal(run.linked.repeats, count);
  }
});

test('keywords-repeat-played-only-once: the expansion is a static cost declaration, never a second Play (CR 820.3.a)', () => {
  assert.equal(repeatKeyword.keyword, 'Repeat');
  assert.equal(repeatKeyword.valued, false);
  const [ability] = repeatKeyword.expand({ host: { canonicalCardId: REPEAT_CARD } });
  assert.equal(ability.kind, 'static');
  assert.equal(ability.effect.kind, 'repeat.cost');
  assert.equal(ability.effect.count, 1);
  assert.equal(ability.effect.appliesTo, 'self');
  assert.ok(repeatKeyword.ruleRefs.includes('820.3.a'));

  // The spell still enters the chain once: the Play path is unchanged by the cost.
  const f = fixture({
    programs: [program], energy: { A: 4 },
    setup: w => w.hand('spell', { cardId: REPEAT_CARD, types: ['spell'], energy: 2, power: null, keywords: [{ id: 'Repeat' }] })
      .unit('victim', { owner: 'B', controller: 'B', might: 5 })
  });
  const draft = f.binding.describePlay({ type: 'play', player: 'A', object: f.ref('spell') }, f.get('spell'));
  f.engine.execute(draft);
  settle(f.engine);
  assert.equal(f.get('spell').zone, 'trash');
  assert.equal(f.get('victim').damage, 1, 'exactly one execution, because no Repeat instance was paid');
});

test.todo('keywords-repeat-paid-executes-twice / keywords-repeat-not-paid-executes-once / keywords-repeat-multiple-instances-paid-separately / keywords-repeat-played-only-once (chain wiring): the paid Repeat instance count is not carried from Finalize into Resolve — src/chain/engine.ts resolves the spell body directly (`resolveChainBody(item.body, context, conditionInputs)`) without expanding a `repeat` wrapper from `item.costPlan.selectedAdditional`, and no card-IR adapter rewrites the body for the paid instances; both real halves (the cost receipt and the `effect.repeat` primitive) are asserted above');

test.todo('keywords-repeat-not-paid-executes-once (CR 820.1.d): the executed-once result is asserted through the never-paid Play path above; the YAML’s `choices: { repeat: false }` command vocabulary and its “one Sand Soldier token” body come from the old duel session, and the merged kernel cannot yet express a paid-instance-driven execution count');

test.todo('keywords-repeat-multiple-instances-paid-separately (CR 820.1.c.2, 820.3): the per-instance charging is asserted above (2 + 3 against the printed 2), but “one extra execution per paid instance” needs the same missing Finalize → Resolve bridge');
