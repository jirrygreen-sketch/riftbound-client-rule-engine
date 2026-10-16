import assert from 'node:assert/strict';
import test from 'node:test';
import { runAbilityBody } from '../../../dist/effects/interpreter.js';
import costModify from '../../../dist/effects/instructions/cost.modify.js';
import costPay from '../../../dist/effects/instructions/cost.pay.js';
import effectXp from '../../../dist/effects/instructions/effect.xp.js';
import { CostPlanError } from '../../../dist/cost/plan-types.js';
import { DUEL_DOMAINS } from '../../../dist/cost/resources.js';
import { runInstruction, world } from '../../../dist/effects/testing/index.js';

const constant = value => ({ kind: 'constant', value });
const linkedValue = (instructionId, key = 'value') => ({ kind: 'linked-value', instructionId, key });
const instruction = (id, op, args = {}) => ({ id, op, args });
const printed = (values = {}) => ({ id: 'source', cardType: 'Spell', energy: 3, power: 0, domains: ['Fury'], ...values });

function withSource(builder, id) {
  const ctx = builder.build();
  return ctx.clone({ sourceSnapshot: ctx.object(ctx.ref(id)) });
}

const fixture = (values = {}) => withSource(
  world().player('A', { energy: 20, ...(values.player ?? {}) }).hand('source', { types: ['spell'], energy: values.sourceEnergy ?? 3, power: [] }),
  'source'
);

const pay = (args, ctx) => runInstruction(costPay, args, { world: ctx });
const resultFor = (outcome, id) => outcome.results.find(result => result.id === id).result;
const cannotPay = error => error instanceof CostPlanError && error.reason === 'cannot-pay-cost';

// Use the real primitive transaction; throwing must discard its cloned state,
// events and linked values. No custom state writes or payment callbacks.
function executeAbility(body, kernel, answers = {}) {
  let outcome;
  const definition = {
    op: 'test.cost-ability-transaction',
    argsSchema: { parse: value => value },
    execute(context) {
      outcome = runAbilityBody(body, context);
      return { status: 'executed', events: [...outcome.events] };
    }
  };
  return { ...runInstruction(definition, {}, { world: kernel, answers }), outcome };
}

// The frozen XP primitive receives an Expr at dispatch; the outer constant is
// evaluated by the interpreter and the inner one by the real XP primitive.
const gainXp = (linkedTo) => ({
  ...instruction('reward', effectXp.op, { amount: constant(constant(1)) }),
  ...(linkedTo ? { linkedTo } : {})
});

test('cost.pay rejects contradictory and malformed arguments', () => {
  const ctx = fixture();
  assert.throws(() => costPay.execute(ctx, costPay.argsSchema.parse({ cost: constant(1), payments: constant(1) })), /either cost or payments/);
  assert.throws(() => costPay.argsSchema.parse({ cost: 1 }), /Expr/);
  assert.throws(() => costPay.execute(ctx, costPay.argsSchema.parse({})), /requires cost or payments/);
  assert.throws(() => costPay.argsSchema.parse({ linkKey: '' }), /linkKey/);
  assert.throws(() => pay({ cost: constant(2) }, ctx), cannotPay);
  assert.equal(ctx.player('A').energy, 20);
});

test('cost.pay pays Energy and Power resources exactly', () => {
  const ctx = fixture({ player: { energy: 5, power: ['Fury'] } });
  const run = pay({ payments: constant({ energy: 2, power: ['Fury'] }) }, ctx);
  assert.equal(run.result.status, 'executed');
  assert.equal(ctx.player('A').energy, 3);
  const receipt = run.linked['payment'];
  assert.equal(receipt.planId, 'source:cost-pay');
  assert.equal(receipt.paid, true);
  assert.deepEqual(receipt.actions[0].action.plan.power, ['Fury']);
  assert.deepEqual(receipt.total.power, [{ amount: 1, allowedDomains: ['Fury'] }]);
  assert.equal(run.asked, null);
});

test('cost.pay with insufficient resources aborts and rolls back', () => {
  const ctx = fixture({ player: { energy: 1 } });
  const before = ctx.snapshot();
  assert.throws(() => pay({ payments: constant({ energy: 2 }) }, ctx), cannotPay);
  assert.deepEqual(ctx.snapshot(), before);
  assert.equal(ctx.linked('payment'), undefined);
});

test('cost.pay numeric Power is one universal [A] allocation per point', () => {
  const ctx = fixture({ player: { energy: 1, power: ['Calm', 'Mind'] } });
  const run = pay({ payments: constant({ energy: 1, power: 2 }) }, ctx);
  assert.equal(run.result.status, 'executed');
  assert.equal(ctx.player('A').energy, 0);
  assert.deepEqual(run.linked.payment.total.power, [{ amount: 2, allowedDomains: DUEL_DOMAINS }]);
  assert.deepEqual(run.linked.payment.actions[0].action.plan.power, ['Calm', 'Mind']);
});

test('cost.pay exhausts and recycles after resources in CR 357.2 order', () => {
  const ctx = withSource(
    world().player('A')
      .card('stays', { zone: 'trash' })
      .card('gear', { zone: 'board', location: { type: 'battlefield', id: 'battlefield-1' } })
      .hand('source', { types: ['spell'], energy: 3, power: [] }),
    'source'
  );
  const run = pay({
    cost: constant({ finalized: true, exhaust: [ctx.ref('gear')], recycle: [ctx.ref('stays')] })
  }, ctx);
  assert.equal(run.result.status, 'executed');
  assert.deepEqual(run.result.events.map(event => event.action), ['pay', 'exhaust', 'recycle']);
  assert.equal(ctx.getObject('gear').exhausted, true);
  assert.deepEqual(ctx.zone('A', 'deck').map(ref => ref.id), ['stays']);
  assert.equal(ctx.objectsInZone('A', 'trash').length, 0);
});

test('cost.pay rejects stale or invalid payment objects without paying', () => {
  const ctx = fixture();
  const before = ctx.snapshot();
  assert.throws(() => pay({ cost: constant({ finalized: true, exhaust: [{ id: 'gone', zoneEntryId: 0 }] }) }, ctx), cannotPay);
  assert.deepEqual(ctx.snapshot(), before);
  assert.equal(ctx.linked('payment'), undefined);
});

test('cost.pay settles a plan linked by cost.modify and rolls back without resources', () => {
  const registry = new Map([[costModify.op, costModify], [costPay.op, costPay]]);
  const body = [
    instruction('modify', 'cost.modify', {
      id: constant('expensive'),
      cost: constant({ kind: 'printed' }),
      modifier: constant({ kind: 'reduce', resource: 'energy', amount: constant(2) })
    }),
    instruction('settle', 'cost.pay', { cost: { kind: 'linked-value', instructionId: 'modify', key: 'cost' } })
  ];
  const transaction = (kernel, answers = {}) => {
    let outcome;
    const definition = {
      op: 'test.ability-transaction',
      argsSchema: { parse: value => value },
      execute(context) {
        outcome = runAbilityBody(body, context, registry);
        return { status: 'executed', events: [...outcome.events] };
      }
    };
    return { ...runInstruction(definition, {}, { world: kernel, answers }), outcome };
  };
  const able = fixture({ player: { energy: 5 } });
  const ableRun = transaction(able);
  assert.equal(ableRun.outcome.status, 'executed');
  assert.equal(resultFor(ableRun.outcome, 'settle').status, 'executed');
  assert.equal(able.player('A').energy, 4);
  assert.equal(able.linked('settle.payment').planId, 'expensive');
  assert.equal(able.linked('settle.payment').total.energy, 1);

  const short = fixture({ player: { energy: 0 } });
  const before = short.snapshot();
  assert.throws(() => transaction(short), cannotPay);
  assert.equal(short.player('A').energy, 0);
  assert.equal(short.linked('settle.payment'), undefined);
  assert.deepEqual(short.snapshot(), before);
});

test('printed costs are never invented: printed 0 stays zero and printed null is not coerced', () => {
  const zero = runInstruction(costModify, { id: 'plan', printed: printed({ energy: 0 }) }, { world: fixture() });
  assert.equal(zero.linked['cost'].printed.energy, 0);
  assert.equal(zero.linked['cost'].total.energy, 0);
  const ctx = fixture();
  const run = pay({ cost: constant({ finalized: true }) }, ctx);
  assert.equal(run.result.status, 'executed');
  assert.equal(ctx.player('A').energy, 20);
});

for (const linkedTo of [undefined, 'settle']) {
  test(`failed payment stops optional body before real XP effect (linked=${Boolean(linkedTo)})`, () => {
    const ctx = fixture({ player: { energy: 0, xp: 0 } });
    const before = ctx.snapshot();
    const links = ctx.linkedSnapshot();
    const body = [instruction('offer', 'choice.optional', { body: constant([
      instruction('settle', 'cost.pay', { payments: constant({ energy: 1 }) }),
      gainXp(linkedTo)
    ]) })];
    assert.throws(() => executeAbility(body, ctx, { 'offer/optional': true }), cannotPay);
    assert.equal(ctx.player('A').xp, 0);
    assert.equal(ctx.player('A').energy, 0);
    assert.deepEqual(ctx.snapshot(), before);
    assert.deepEqual(ctx.linkedSnapshot(), links);
  });
}

test('accepted optional body pays before its real XP effect; declining pays and gains nothing', () => {
  const body = [instruction('offer', 'choice.optional', { body: constant([
    instruction('settle', 'cost.pay', { payments: constant({ energy: 1 }) }),
    gainXp('settle')
  ]) })];
  const ctx = fixture({ player: { energy: 2, xp: 0 } });
  const accepted = executeAbility(body, ctx, { 'offer/optional': true });
  assert.equal(accepted.outcome.status, 'executed');
  assert.equal(ctx.player('A').energy, 1);
  assert.equal(ctx.player('A').xp, 1);
  assert.deepEqual(accepted.events.map(event => event.action), ['pay', 'gain-xp']);
  assert.equal(ctx.linked('offer/settle.payment').paid, true);
  const declined = fixture({ player: { energy: 0, xp: 0 } });
  const before = declined.snapshot();
  executeAbility(body, declined, { 'offer/optional': false });
  assert.deepEqual(declined.snapshot(), before);
  assert.equal(declined.linked('offer/settle.payment'), undefined);
});

for (const outcome of ['prevented', 'impossible']) {
  test(`late ${outcome} payment aborts the real ability transaction without partial Energy/XP/effects`, () => {
    const ctx = withSource(world().player('A', { energy: 5, xp: 3 })
      .unit('gear').card('spent', { zone: 'trash' })
      .hand('source', { types: ['spell'], energy: 3, power: [] }), 'source');
    ctx.addReplacement(action => action.type === 'recycle' ? outcome : null);
    const before = ctx.snapshot();
    const links = ctx.linkedSnapshot();
    const body = [instruction('offer', 'choice.optional', { body: constant([
      instruction('settle', 'cost.pay', { cost: constant({
        finalized: true, energy: 2, xp: 1,
        exhaust: [ctx.ref('gear')], recycle: [ctx.ref('spent')]
      }) }),
      gainXp('settle')
    ]) })];
    assert.throws(() => executeAbility(body, ctx, { 'offer/optional': true }),
      error => cannotPay(error) && error.outcome.status === outcome);
    assert.equal(ctx.player('A').energy, 5);
    assert.equal(ctx.player('A').xp, 3);
    assert.equal(ctx.getObject('gear').exhausted, false);
    assert.deepEqual(ctx.objectsInZone('A', 'trash'), [ctx.ref('spent')]);
    assert.deepEqual(ctx.snapshot(), before);
    assert.deepEqual(ctx.linkedSnapshot(), links);
  });
}

test('a prevented exhaust after Energy payment escapes rather than committing a partial payment', () => {
  const ctx = withSource(world().player('A', { energy: 5 }).unit('gear')
    .hand('source', { types: ['spell'], energy: 3, power: [] }), 'source');
  ctx.addReplacement(action => action.type === 'exhaust' ? 'prevented' : null);
  const before = ctx.snapshot();
  assert.throws(() => pay({ cost: constant({ finalized: true, energy: 2, exhaust: [ctx.ref('gear')] }) }, ctx),
    error => cannotPay(error) && error.outcome.status === 'prevented');
  assert.equal(ctx.player('A').energy, 5);
  assert.deepEqual(ctx.snapshot(), before);
  assert.equal(ctx.linked('payment'), undefined);
});

test('numeric Power allocation still rejects insufficient resources without any payment', () => {
  const ctx = fixture({ player: { energy: 1, power: ['Calm'] } });
  const before = ctx.snapshot();
  assert.throws(() => pay({ payments: constant({ energy: 1, power: 2 }) }, ctx), cannotPay);
  assert.deepEqual(ctx.snapshot(), before);
});

test('zero numeric Power and an empty domain list are free of Power requirements', () => {
  for (const power of [0, []]) {
    const ctx = fixture({ player: { power: [] } });
    const run = pay({ payments: constant({ power }) }, ctx);
    assert.equal(run.result.status, 'executed');
    assert.deepEqual(run.linked.payment.total.power, []);
    assert.deepEqual(run.linked.payment.actions[0].action.plan.power, []);
  }
});
