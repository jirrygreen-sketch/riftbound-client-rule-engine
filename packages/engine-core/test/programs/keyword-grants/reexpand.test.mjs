import test from 'node:test';
import assert from 'node:assert/strict';
import { KeywordGrantLayerEngine, expandEffectiveKeywords } from '../../../dist/programs/keyword-grants.js';
import { world } from '../../../dist/effects/testing/index.js';
import { ChainEngine } from '../../../dist/chain/engine.js';
import { bindResolveContext, createActionPipelineHost } from '../../../dist/events/action-adapter.js';
import { createTargetTaxAdapter } from '../../../dist/target/tax/index.js';
import { prepareCostPayment } from '../../../dist/cost/payment.js';
import { movement } from '../../../dist/layers/rules/query.js';
import { matchesObjectFilter } from '../../../dist/layers/filter.js';
import { duelWorld, mainTiming, readinessFor } from '../../rules/movement/support.mjs';
import { moveDuelUnitsStandard } from '../../../dist/zones/movement.js';
import { createEngineStaticBinder } from '../../../dist/programs/statics.js';
import bilgewaterBully from '../../../../card-dsl/dist/cards/ogn/bilgewater-bully.js';
import repairSpecialist from '../../../../card-dsl/dist/cards/ven/repair-specialist.js';
import fioraVictorious from '../../../../card-dsl/dist/cards/ogn/fiora-victorious.js';

const c = value => ({ kind: 'constant', value });
const kw = (id, value) => ({ id, ...(value === undefined ? {} : { value }) });

function fixture({ keywords = [], combatRole = 'attacker', might = 3, location, owner = 'A', power = [], cardId, setup } = {}) {
  const builder = world().player('A', { energy: 20, power }).player('B')
    .base('source', { energy: 0, power: [] })
    .unit('hero', { might, keywords, combatRole, owner, ...(cardId ? { cardId } : {}), ...(location ? { location } : {}) })
    .unit('victim', { owner: 'B', might: 30 });
  setup?.(builder);
  const kernel = builder.build();
  kernel.setAnswers({ 'target:hero': [kernel.ref('hero')], 'target:victim': [kernel.ref('victim')] });
  const context = source => bindResolveContext(kernel, { source, controller: source.controller });
  const layers = new KeywordGrantLayerEngine(kernel.objects, { context });
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: saved => { kernel.restore(saved.state); kernel.copyLinkedFrom(saved.links); },
    objects: () => kernel.objects,
    perform: action => kernel.perform(action),
    choose: request => kernel.choose(request),
    context: (source, controller, timingPoint) => bindResolveContext(kernel, { source, controller, timingPoint }),
  });
  const engine = new ChainEngine({
    host, layers, turnOrder: ['A', 'B'], turnPlayer: 'A', phase: 'main',
    cleanup: current => {
      let changed = false;
      current.layers.setObjects(kernel.objects);
      for (const object of current.layers.evaluateAll()) {
        if (object.zone === 'board' && object.types.includes('unit') && object.might !== null && (object.might <= 0 || object.damage >= object.might)) {
          current.commit({ type: 'kill', object: object.ref });
          changed = true;
        }
      }
      return changed;
    },
  });
  let sequence = 0;
  const resolve = (body, source = 'source') => {
    const id = `ability-${++sequence}`;
    engine.execute({ id, controller: 'A', source: kernel.getObject(source), kind: 'activated', speed: 'reaction', body });
    engine.advance();
    let steps = 0;
    while (engine.items.length) {
      assert.ok(++steps < 30, 'chain settles');
      engine.pass(engine.priority);
    }
    assert.ok(engine.trace.some(event => event.item === id && event.step === 'resolved'));
  };
  const grant = (keyword, value, duration = 'this-turn') => resolve([{
    id: 'grant', op: 'continuous.grant-keyword',
    args: { keyword: c(keyword), ...(value === undefined ? {} : { value: c(value) }), duration: c(duration), settlementId: c(`grant-${sequence + 1}`), objects: c({ kind: 'target', id: 'hero' }) },
    targets: [{ id: 'hero', filter: { objectId: 'hero', type: 'unit', zone: 'board' }, min: 1, max: 1 }],
  }]);
  const hero = () => { layers.setObjects(kernel.objects); return layers.snapshot(kernel.ref('hero')); };
  return { kernel, layers, engine, resolve, grant, hero };
}

test('CR 807: granting Assault runs through KeywordDef and damage reads the increased attacker Might', () => {
  const f = fixture();
  assert.equal(f.hero().might, 3);
  f.grant('Assault', 3);
  assert.deepEqual(f.hero().keywords, [kw('Assault', 3)]);
  assert.equal(f.hero().might, 6);
  assert.equal(f.layers.keywordAbilities(f.kernel.ref('hero'))[0].effect.amount.value, 3);
  f.resolve([{
    id: 'combat-damage', op: 'effect.damage',
    args: { amount: { kind: 'object-property', object: 'self', property: 'might' }, target: c('victim'), combat: c(true) },
    targets: [{ id: 'victim', filter: { objectId: 'victim', zone: 'board' }, min: 1, max: 1 }],
  }], 'hero');
  assert.equal(f.kernel.getObject('victim').damage, 6);
  assert.ok(f.engine.pipeline.events.some(event => event.timingPoint === 'damage-dealt' && event.amount === 6));
});

for (const [printed, expected] of [[[], 3], [[kw('Assault')], 4], [[kw('Assault', 2)], 5]]) {
  test(`CR 807.2: printed ${JSON.stringify(printed)} plus Assault 3 expands once and expires`, () => {
    const f = fixture({ keywords: printed });
    f.grant('Assault', 3);
    assert.deepEqual(f.hero().keywords, [kw('Assault', expected)]);
    assert.equal(f.hero().might, 3 + expected);
    assert.equal(f.layers.keywordAbilities(f.kernel.ref('hero')).length, 1);
    f.layers.advance({ id: 'turn-end', player: 'A' });
    assert.deepEqual(f.hero().keywords, printed.length ? [kw('Assault', printed[0].value ?? 1)] : []);
    assert.equal(f.hero().might, 3 + (printed.length ? printed[0].value ?? 1 : 0));
  });
}

test('several grants, including defaults and zero, sum once and expire independently', () => {
  const f = fixture({ keywords: [kw('assault', 2)] });
  f.grant('Assault', 3, 'this-combat');
  f.grant('ASSAULT', undefined, 'this-turn');
  f.grant('Assault', 0, 'permanent');
  assert.deepEqual(f.hero().keywords, [kw('Assault', 6)]);
  assert.equal(f.hero().might, 9);
  f.layers.advance({ id: 'combat-end' });
  assert.deepEqual(f.hero().keywords, [kw('Assault', 3)]);
  f.layers.advance({ id: 'turn-end' });
  assert.deepEqual(f.hero().keywords, [kw('Assault', 2)]);
});

for (const combatRole of [null, 'defender']) {
  test(`Assault adds no Might when combatRole is ${combatRole}`, () => {
    const f = fixture({ combatRole });
    f.grant('Assault', 4);
    assert.equal(f.hero().might, 3);
  });
}

test('CR 814: Shield is merged and consumed only by defenders, then revoked', () => {
  const f = fixture({ keywords: [kw('Shield')], combatRole: 'defender' });
  f.grant('Shield', 3);
  assert.equal(f.hero().might, 7);
  assert.deepEqual(f.hero().keywords, [kw('Shield', 4)]);
  f.layers.advance({ id: 'turn-end' });
  assert.equal(f.hero().might, 4);
  const attacker = fixture();
  attacker.grant('Shield', 3);
  assert.equal(attacker.hero().might, 3);
});

test('CR 810: granted Ganking permits a real Standard Move and expiry removes the route', () => {
  const given = duelWorld();
  const board = given.place(given.board, 'hero', 'A', given.bf1);
  const f = fixture({ combatRole: null, location: { type: 'battlefield', id: given.bf1 } });
  const attempt = (current = board, readiness = readinessFor(current), destination = given.bf2) => {
    f.hero();
    return moveDuelUnitsStandard(current, readiness, {
      actor: 'A', unitUIDs: ['hero'], destinationLocationId: destination, timing: mainTiming('A'),
    }, {
      registry: f.layers.registry,
      refForUnit: unit => f.kernel.ref(unit.objectId),
      objectForUnit: unit => f.layers.snapshot(f.kernel.ref(unit.objectId)),
    });
  };
  assert.throws(() => attempt(), /needs Ganking/);
  f.grant('Ganking');
  f.grant('ganking');
  assert.deepEqual(f.hero().keywords, [kw('Ganking')]);
  assert.equal(f.layers.keywordAbilities(f.kernel.ref('hero')).length, 1);
  assert.equal(f.hero().movement.canGank, true);
  assert.equal(movement(f.layers.registry, f.kernel.ref('hero'), f.hero(), 'A').canGank, true);
  const moved = attempt();
  assert.equal(moved.board.units[0].locationId, given.bf2);
  assert.equal(moved.group.exhaustedCount, 1);
  assert.equal(moved.readiness[0].readied, false);
  assert.throws(() => attempt(moved.board, moved.readiness, given.bf1), /not readied/);
  f.layers.advance({ id: 'turn-end' });
  assert.equal(f.hero().movement.canGank, false);
  assert.equal(movement(f.layers.registry, f.kernel.ref('hero'), f.hero(), 'A').canGank, false);
  assert.throws(() => attempt(), /needs Ganking/);
});

test('CR 809: target finalization prices effective Deflect once using any-domain Power', () => {
  const f = fixture({ owner: 'B', keywords: [kw('Deflect')], power: ['Calm', 'Mind', 'Body', 'Order'] });
  f.grant('Deflect', 2);
  assert.deepEqual(f.hero().keywords, [kw('Deflect', 3)]);
  const context = bindResolveContext(f.kernel, {
    source: f.kernel.getObject('source'), controller: 'A',
    object: ref => f.layers.snapshot(ref), query: filter => f.layers.evaluateAll().filter(object => matchesObjectFilter(filter, object)),
  });
  const adapter = () => createTargetTaxAdapter(context, { id: 'tax-test', cost: { energy: c(0), power: c([]) } }, { kind: 'ability' });
  const taxed = adapter();
  taxed.finalizeTargetPlan({ id: 'hero', filter: { objectId: 'hero', zone: 'board' } }, { selected: [f.kernel.ref('hero')] });
  assert.equal(taxed.costPlan.total.power.reduce((sum, entry) => sum + entry.amount, 0), 3);
  const payment = prepareCostPayment(context, taxed.costPlan);
  assert.equal(payment.actions[0].action.plan.power.length, 3);
  assert.equal(new Set(payment.actions[0].action.plan.power).size, 3, 'three different Domains can pay Deflect');
  f.layers.advance({ id: 'turn-end' });
  assert.deepEqual(f.hero().keywords, [kw('Deflect', 1)]);
  const after = adapter();
  after.finalizeTargetPlan({ id: 'hero', filter: { objectId: 'hero', zone: 'board' } }, { selected: [f.kernel.ref('hero')] });
  assert.equal(after.costPlan.total.power.reduce((sum, entry) => sum + entry.amount, 0), 1);
});

test('CR 478.3: a Might threshold gains and loses Shield/Ganking/Deflect without sustaining itself', () => {
  const f = fixture({ might: 4, combatRole: 'defender' });
  f.layers.addContinuous({
    id: 'mighty-keywords', layer: 'ability', source: f.kernel.ref('hero'),
    filter: { objectId: 'hero', zone: 'board' },
    effect: { kind: 'continuous.grant-keyword', keywords: [kw('Deflect'), kw('Ganking'), kw('Shield')], condition: object => object.might >= 5 },
  }, { type: 'permanent' });
  assert.equal(f.hero().might, 4);
  assert.deepEqual(f.hero().keywords, []);
  f.layers.addContinuous({ id: 'temporary-might', layer: 'arithmetic', filter: { objectId: 'hero' }, effect: { kind: 'continuous.might', amount: 1 } }, { type: 'end-of-turn' });
  assert.equal(f.hero().might, 6);
  assert.deepEqual(f.hero().keywords, [kw('Deflect', 1), kw('Ganking'), kw('Shield', 1)]);
  f.layers.advance({ id: 'turn-end' });
  assert.equal(f.hero().might, 4);
  assert.deepEqual(f.hero().keywords, []);
  assert.equal(movement(f.layers.registry, f.kernel.ref('hero'), f.hero()).canGank, false);
});

test('Bilgewater Bully: its original static program gains and revokes Ganking as Buffs change', () => {
  assert.equal(bilgewaterBully.status, 'judge-required');
  const f = fixture({ cardId: bilgewaterBully.canonicalCardId });
  createEngineStaticBinder(f.engine).bindStatic(bilgewaterBully.abilities[0], f.kernel.getObject('hero'));
  assert.equal(f.hero().movement.canGank, false);
  f.engine.commit({ type: 'buff', object: f.kernel.ref('hero'), amount: 1 });
  assert.deepEqual(f.hero().keywords, [kw('Ganking')]);
  assert.equal(f.hero().movement.canGank, true);
  f.engine.commit({ type: 'spend-buff', object: f.kernel.ref('hero'), amount: 1 });
  assert.deepEqual(f.hero().keywords, []);
  assert.equal(f.hero().movement.canGank, false);
});

test('Repair Specialist: its original dynamic Assault counts only friendly Board gear and recomputes on exit', () => {
  assert.equal(repairSpecialist.status, 'judge-required');
  const f = fixture({ cardId: repairSpecialist.canonicalCardId, setup: builder => builder
    .base('gear-1', { types: ['gear'] }).base('gear-2', { types: ['gear'] })
    .base('enemy-gear', { types: ['gear'], owner: 'B' }).hand('hand-gear', { types: ['gear'] }),
  });
  createEngineStaticBinder(f.engine).bindStatic(repairSpecialist.abilities[0], f.kernel.getObject('hero'));
  assert.deepEqual(f.hero().keywords, [kw('Assault', 2)]);
  assert.equal(f.hero().might, 5);
  f.engine.commit({ type: 'kill', object: f.kernel.ref('gear-1') });
  assert.deepEqual(f.hero().keywords, [kw('Assault', 1)]);
  assert.equal(f.hero().might, 4);
});

test('Fiora, Victorious: the original static condition rechecks effective Might and revokes all three keywords', () => {
  assert.equal(fioraVictorious.status, 'judge-required');
  const f = fixture({ cardId: fioraVictorious.canonicalCardId, might: 4, combatRole: 'defender' });
  createEngineStaticBinder(f.engine).bindStatic(fioraVictorious.abilities[0], f.kernel.getObject('hero'));
  assert.deepEqual(f.hero().keywords, []);
  f.resolve([{ id: 'raise-might', op: 'continuous.might', args: {
    amount: c(1), mode: c('add'), duration: c('this-turn'), objects: c({ kind: 'target', id: 'hero' }),
  }, targets: [{ id: 'hero', filter: { objectId: 'hero', zone: 'board' }, min: 1, max: 1 }] }]);
  assert.equal(f.hero().might, 6);
  assert.deepEqual(f.hero().keywords, [kw('Deflect', 1), kw('Ganking'), kw('Shield', 1)]);
  f.layers.advance({ id: 'turn-end' });
  assert.equal(f.hero().might, 4);
  assert.deepEqual(f.hero().keywords, []);
});

test('removal revokes expanded abilities and expiry restores the printed keyword', () => {
  const f = fixture({ keywords: [kw('Assault', 2)] });
  assert.equal(f.hero().might, 5);
  f.layers.addContinuous({
    id: 'remove-assault', layer: 'ability', filter: { objectId: 'hero', zoneEntryId: 1 },
    effect: { kind: 'continuous.remove-keyword', keyword: 'assault' },
  }, { type: 'end-of-turn' });
  assert.deepEqual(f.hero().keywords, []);
  assert.equal(f.hero().might, 3);
  assert.deepEqual(f.layers.keywordAbilities(f.kernel.ref('hero')), []);
  f.layers.advance({ id: 'turn-end' });
  assert.equal(f.hero().might, 5);
});

test('zone re-entry does not resurrect a grant bound to the old object reference', () => {
  const f = fixture();
  f.grant('Assault', 4, 'permanent');
  const before = f.kernel.ref('hero');
  f.engine.commit({ type: 'return-to-hand', object: before });
  f.engine.commit({ type: 'move-zone', object: f.kernel.ref('hero'), to: 'base' });
  assert.notEqual(f.kernel.ref('hero').zoneEntryId, before.zoneEntryId);
  assert.equal(f.layers.snapshot(before), null);
  assert.deepEqual(f.hero().keywords, []);
  assert.equal(f.hero().might, 3);
});

test('while-source-in-zone grants disappear when their source leaves', () => {
  const f = fixture();
  f.grant('Ganking', undefined, 'while-source-in-zone');
  assert.equal(f.hero().movement.canGank, true);
  f.engine.commit({ type: 'return-to-hand', object: f.kernel.ref('source') });
  assert.equal(f.hero().movement.canGank, false);
  assert.deepEqual(f.hero().keywords, []);
});

test('Tank is expanded once as a combat declaration and disappears on expiry', () => {
  const f = fixture();
  f.grant('Tank');
  f.grant('tank');
  assert.deepEqual(f.hero().keywords, [kw('Tank')]);
  assert.deepEqual(f.layers.keywordAbilities(f.kernel.ref('hero')).map(ability => [ability.effect.kind, ability.effect.priority]), [['continuous.combat', 'first']]);
  f.layers.advance({ id: 'turn-end' });
  assert.deepEqual(f.layers.keywordAbilities(f.kernel.ref('hero')), []);
});

test('separate keyword stacking retains independent expansions', () => {
  const source = world().unit('hero', { keywords: [kw('Deathknell'), kw('deathknell')] }).build().getObject('hero');
  const expansion = expandEffectiveKeywords(source);
  assert.equal(expansion.keywords.length, 2);
  assert.equal(expansion.abilities.length, 2);
  assert.equal(expansion.abilities.every(ability => ability.kind === 'triggered'), true);
});

test('unknown keywords and unsupported non-static bindings fail closed', () => {
  const f = fixture();
  const source = f.kernel.getObject('hero');
  assert.throws(() => expandEffectiveKeywords(source, [{ kind: 'grant', keywords: [kw('unruled-keyword')] }]), error => error.code === 'judge-required');
  f.layers.addContinuous({ id: 'unsupported', layer: 'ability', filter: { objectId: 'hero' }, effect: { kind: 'continuous.grant-keyword', keyword: 'Deathknell' } }, { type: 'permanent' });
  assert.throws(() => f.hero(), error => error.code === 'judge-required' && /lifecycle/.test(error.message));
  assert.equal(f.layers.registry.list().some(entry => entry.effect.id.startsWith('program-keyword:')), false);
});

test('invalid values and sum overflow are rejected, while an explicit zero remains zero', () => {
  const source = world().unit('hero').build().getObject('hero');
  for (const value of [-1, 0.5, NaN, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => expandEffectiveKeywords(source, [{ kind: 'grant', keywords: [kw('Assault', value)] }]), error => error.code === 'judge-required');
  }
  assert.throws(() => expandEffectiveKeywords({ ...source, keywords: [kw('Assault', Number.MAX_SAFE_INTEGER), kw('Assault')] }), error => error.code === 'judge-required');
  assert.deepEqual(expandEffectiveKeywords(source, [{ kind: 'grant', keywords: [kw('Assault', 0)] }]).keywords, [kw('Assault', 0)]);
});
