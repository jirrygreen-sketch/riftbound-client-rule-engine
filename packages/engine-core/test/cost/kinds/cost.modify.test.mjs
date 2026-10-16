import assert from 'node:assert/strict';
import test from 'node:test';
import { DUEL_DOMAINS } from '../../../dist/cost/resources.js';
import costModify from '../../../dist/effects/instructions/cost.modify.js';
import weaponmaster from '../../../dist/effects/keywords/Weaponmaster.js';
import { runAbilityBody } from '../../../dist/effects/interpreter.js';
import { runInstruction, world } from '../../../dist/effects/testing/index.js';

const constant = value => ({ kind: 'constant', value });
const printed = (values = {}) => ({ id: 'source', cardType: 'Spell', energy: 3, power: 0, domains: ['Fury'], ...values });

function withSource(builder, id) {
  const ctx = builder.build();
  return ctx.clone({ sourceSnapshot: ctx.object(ctx.ref(id)) });
}

const fixture = (values = {}) => withSource(
  world().player('A', { energy: 20, ...(values.player ?? {}) }).hand('source', { types: ['spell'], energy: values.sourceEnergy ?? 3, power: [] }),
  'source'
);

const modify = (args, ctx = fixture()) => runInstruction(costModify, args, { world: ctx });

test('cost.modify parses args strictly and rejects malformed modifiers', () => {
  assert.throws(() => modify({}), /id/);
  assert.throws(() => modify({ id: 'plan', extra: 1 }), /extra/);
  assert.throws(() => modify({ id: 'plan', modifiers: 'nope' }), /array/);
  assert.throws(() => modify({ id: 'plan', modifier: { kind: 'reduce', resource: 'energy' } }), /amount/);
  assert.throws(() => modify({ id: 'plan', modifier: { kind: 'halve', resource: 'energy', amount: constant(1) } }), /reduce, increase/);
});

test('cost.modify defaults to the printed base and freezes the linked plan', () => {
  const run = modify({ id: 'plan' });
  assert.equal(run.result.status, 'executed');
  const plan = run.linked['cost'];
  assert.equal(plan.player, 'A');
  assert.equal(plan.total.energy, 3);
  assert.deepEqual(plan.total.power, []);
  assert.ok(Object.isFrozen(plan));
  assert.ok(Object.isFrozen(plan.total));
});

test('cost.modify honors per-discount minima and floors excess discounts at zero', () => {
  const run = modify({
    id: 'plan',
    printed: printed({ energy: 8 }),
    modifiers: [
      { id: 'eager', kind: 'reduce', resource: 'energy', amount: constant(1), minimum: constant(1) },
      { id: 'splitter', kind: 'reduce', resource: 'energy', amount: constant(7) }
    ],
    discountOrder: ['splitter', 'eager']
  });
  const plan = run.linked['cost'];
  assert.equal(plan.total.energy, 1);
  assert.deepEqual(plan.discounts.map(value => [value.id, value.before, value.after]), [
    ['splitter', 8, 1],
    ['eager', 1, 1]
  ]);
});

test('cost.modify excess discounts never create resources', () => {
  const ctx = fixture({ player: { energy: 0 } });
  const run = modify({ id: 'plan', modifiers: [{ id: 'large', kind: 'reduce', resource: 'energy', amount: constant(10) }] }, ctx);
  assert.equal(run.linked['cost'].total.energy, 0);
  assert.equal(ctx.player('A').energy, 0);
});

test('cost.modify applies increases before discounts in CR order', () => {
  const run = modify({
    id: 'plan',
    modifiers: [
      { id: 'tax', kind: 'increase', resource: 'energy', amount: constant(2) },
      { id: 'reduce', kind: 'reduce', resource: 'energy', amount: constant(4) }
    ]
  });
  const plan = run.linked['cost'];
  assert.equal(plan.total.energy, 1);
  assert.deepEqual(plan.stages, ['base', 'alternate', 'optional-additional', 'mandatory-additional', 'increase', 'discount', 'total']);
});

test('cost.modify generic reduction discounts universal Power while Energy stays intact', () => {
  const run = modify({
    id: 'plan',
    printed: printed({ energy: 3, power: 2, domains: [] }),
    modifier: { id: 'equip', kind: 'reduce', resource: 'power', amount: constant(1) }
  });
  const plan = run.linked['cost'];
  assert.equal(plan.total.energy, 3);
  assert.deepEqual(plan.total.power, [{ amount: 1, allowedDomains: DUEL_DOMAINS }]);
  assert.deepEqual(plan.discounts.map(value => value.id), ['equip']);
});

test('cost.modify ignoreAllCosts rewrites the total to zero (356.5.a)', () => {
  const run = modify({ id: 'plan', printed: printed({ energy: 6, power: 1 }), ignoreAllCosts: true });
  const plan = run.linked['cost'];
  assert.equal(plan.total.energy, 0);
  assert.deepEqual(plan.total.power, []);
});

test('cost.modify linkKey renames the linked frozen plan', () => {
  const run = modify({ id: 'plan', linkKey: 'weapon' });
  const plan = run.linked['weapon'];
  assert.equal(run.result.status, 'executed');
  assert.ok(plan);
  assert.equal(run.linked['cost'], undefined);
  assert.ok(Object.isFrozen(plan));
  assert.equal(plan.total.energy, 3);
});

test('cost.modify keeps unsupported official modifications judge-required', () => {
  const ctx = fixture();
  const before = ctx.snapshot();
  assert.throws(
    () => costModify.execute(ctx, costModify.argsSchema.parse({ id: 'plan2', optionalAdditional: [{ id: 'mystery', kind: 'mystery' }] })),
    /cost.modify failed: judge-required/
  );
  assert.deepEqual(ctx.snapshot(), before);
});

for (const power of [['Fury'], 2]) {
  test(`Weaponmaster discount stays judge-required without symbol provenance (${JSON.stringify(power)})`, () => {
    const ctx = fixture();
    const before = ctx.snapshot();
    assert.throws(() => modify({
      id: 'equip', printed: printed({ energy: 0, power, domains: [] }),
      modifier: { kind: 'reduce-equip-cost', resource: 'power', amount: constant(1) }
    }, ctx), error => error.reason === 'judge-required' && /821.1.c.3.*original \[A\] symbols/.test(error.message));
    assert.deepEqual(ctx.snapshot(), before);
    assert.equal(ctx.linked('cost'), undefined);
  });
}

test('cost.modify accepts the actual Weaponmaster selector, implicit id, numeric amount and domain alias', () => {
  const [ability] = weaponmaster.expand({ host: { canonicalCardId: 'weaponmaster-source' } });
  const cost = ability.body[0].args.body.value[0];
  const args = Object.fromEntries(Object.entries(cost.args).map(([key, expr]) => [key, expr.value]));
  const parsed = costModify.argsSchema.parse(args);
  assert.deepEqual(parsed.source, { kind: 'target', id: 'weaponmaster-equipment' });
  assert.deepEqual(parsed.modifier.amount, constant(1));
  assert.equal(parsed.modifier.resource, 'power');
  assert.equal(parsed.id, undefined);
  assert.throws(() => costModify.argsSchema.parse({ ...args, modifier: { ...args.modifier, domain: 'Fury' } }), /domain/);
});

test('real Weaponmaster expanded cost/payment/attachment body blocks when the authoritative Equip cost is unavailable', () => {
  const ctx = withSource(world().player('A', { energy: 10, power: ['Fury'] })
    .unit('weaponmaster-source')
    .object('equipment', {
      types: ['gear'], tags: ['Equipment'], zone: 'board',
      keywords: [{ id: 'Equip' }], energy: 0, power: [],
      location: { type: 'base', player: 'A' }
    }), 'weaponmaster-source');
  // The cost integration boundary receives the targeting owner's real locked
  // selection. Run the original keyword sub-body with no rewritten arguments.
  ctx.setTargets('weaponmaster-equipment', [ctx.ref('equipment')]);
  const [ability] = weaponmaster.expand({ host: { canonicalCardId: 'weaponmaster-source' } });
  const body = ability.body[0].args.body.value;
  const before = ctx.snapshot();
  assert.throws(() => runAbilityBody(body, ctx), error =>
    error.reason === 'judge-required' && /missing authoritative Equip-cost binding for equipment/.test(error.message));
  assert.deepEqual(ctx.snapshot(), before);
  assert.deepEqual(ctx.linkedSnapshot(), {});
  assert.equal(ctx.getObject('equipment').attachedTo, null);
  assert.equal(ctx.player('A').energy, 10);
});

test('Weaponmaster source adapter refuses a missing selection without using the Unit printed cost', () => {
  const ctx = fixture();
  const [ability] = weaponmaster.expand({ host: { canonicalCardId: 'weaponmaster-source' } });
  const before = ctx.snapshot();
  assert.throws(() => runAbilityBody(ability.body[0].args.body.value, ctx), error =>
    error.reason === 'cannot-pay-cost' && /one current controlled Equipment/.test(error.message));
  assert.deepEqual(ctx.snapshot(), before);
  assert.deepEqual(ctx.linkedSnapshot(), {});
});
