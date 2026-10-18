// EG-MODIFIERS tests (RIFT-819): Bonus Damage (CR 712-715.4), lethal threshold
// overrides (142.4.c), additional Might reductions (479.4.b), and the Shield
// Value reader (814.1.b/814.2). Every scenario runs the original card IR or
// the real instruction registry over the reference kernel; assertions read
// registrations, linked values, layered snapshots and produced GameActions -
// no hand settlement anywhere.
import assert from 'node:assert/strict';
import test from 'node:test';
import { runInstruction, world } from '../../dist/effects/testing/index.js';
import { instructionDefinitionsById } from '../../dist/effects/instructions/registry.generated.js';
import { ContinuousEffectRegistry, durationExpiryTiming } from '../../dist/layers/duration.js';
import { LayerEngine } from '../../dist/layers/engine.js';
import {
  bonusDamageForDeal, bonusDamageGrantsForDeal, lethalThresholdFor, additionalMightReductions,
} from '../../dist/effects/modifiers/query.js';
import ntofo from '../../node_modules/@riftbound/card-dsl/dist/cards/rad/ntofo-strikes.js';
import ravenborn from '../../node_modules/@riftbound/card-dsl/dist/cards/ogn/ravenborn-tome.js';

const c = value => ({ kind: 'constant', value });
const bonusOp = instructionDefinitionsById.get('continuous.bonus-damage');
const thresholdOp = instructionDefinitionsById.get('continuous.lethal-threshold');
const mightReductionOp = instructionDefinitionsById.get('continuous.modify-might-reduction');
const shieldValueOp = instructionDefinitionsById.get('effect.shield-value');
const grantKeywordOp = instructionDefinitionsById.get('continuous.grant-keyword');
const damageOp = instructionDefinitionsById.get('effect.damage');

const build = (setup) => {
  const b = world().player('A', { energy: 3 }).player('B');
  b.base('Abase', { energy: 0, power: [], might: 2 }).base('Bbase', { owner: 'B', energy: 0, power: [], might: 5 });
  b.unit('ally', { might: 4 }).unit('foe', { owner: 'B', might: 5 });
  setup?.(b);
  return b.build();
};

// runInstruction executes on a clone of the given world and restores the
// clone's state back onto it. The source ref must be materialised through
// sourceSnapshot (a bare ref is overridden by the clone's source fallback).
// Successful runs are synced back onto the scenario kernel so successive
// registrations accumulate in one world, exactly as they do inside one ability
// resolution on the chain. Thrown argument errors and awaited choices leave
// the kernel untouched (transactional primitive rule).
function runOn(kernel, op, args, source = kernel.ref('Abase'), controller = 'A') {
  const context = kernel.clone({ sourceSnapshot: kernel.object(source), controller });
  const run = runInstruction(op, args, { world: context });
  if (run.result !== null) {
    kernel.restore(context.snapshot());
    kernel.copyLinkedFrom(context);
  }
  return { ...run, world: context };
}
const runBonus = (kernel, args, source, controller) => runOn(kernel, bonusOp, args, source, controller);
const runThreshold = (kernel, args, source, controller) => runOn(kernel, thresholdOp, args, source, controller);
const runReduction = (kernel, args, source, controller) => runOn(kernel, mightReductionOp, args, source, controller);
const runShield = (kernel, args, source, controller) => runOn(kernel, shieldValueOp, args, source, controller);

const registryFrom = (kernel) => {
  const registry = new ContinuousEffectRegistry();
  for (const entry of kernel.continuousEffects) registry.register(entry.effect, entry.duration);
  return registry;
};

test('modifiers-primitives: bonus/threshold/reduction register with duration and linked receipt (CR 713, 142.4.c, 479.4.b)', () => {
  const kernel = build();
  const bonus = runBonus(kernel, { amount: c(2), appliesTo: c('next-spell-you-play'), duration: c('end-of-turn') });
  assert.equal(bonus.result.status, 'executed');
  const bonusEntry = bonus.world.continuousEffects[0];
  assert.equal(bonusEntry.effect.effect.kind, 'continuous.bonus-damage');
  assert.equal(bonusEntry.effect.effect.amount, 2);
  assert.equal(bonusEntry.effect.source.id, 'Abase');
  assert.deepEqual(bonusEntry.duration, { type: 'end-of-turn' });
  assert.deepEqual(bonus.linked.registered, { id: bonusEntry.effect.id, amount: 2 });

  const threshold = runThreshold(kernel, { amount: c(7) });
  assert.equal(threshold.result.status, 'executed');
  assert.equal(threshold.world.continuousEffects[1].effect.effect.kind, 'continuous.lethal-threshold');
  assert.equal(threshold.world.continuousEffects[1].effect.effect.amount, 7);
  assert.equal(durationExpiryTiming(threshold.world.continuousEffects[1].duration), null);

  const reduction = runReduction(kernel, { mode: c('additional'), amount: c(-1) });
  assert.equal(reduction.result.status, 'executed');
  assert.equal(reduction.world.continuousEffects[2].effect.effect.kind, 'continuous.modify-might-reduction');
  assert.equal(reduction.world.continuousEffects[2].effect.effect.mode, 'additional');
  assert.equal(reduction.world.continuousEffects[2].effect.effect.amount, -1);
});

test('modifiers-primitives: impossible / invalid-argument boundaries reject without registering (CR 714.1, 142.4.c)', () => {
  for (const [op, args] of [
    [bonusOp, { amount: c(0) }],
    [bonusOp, { amount: c(-1) }],
    [thresholdOp, { amount: c(0) }],
    [thresholdOp, { }],
    [mightReductionOp, { mode: c('halve'), amount: c(-1) }],
    [mightReductionOp, { mode: c('additional') }],
  ]) {
    const kernel = build();
    const run = runOn(kernel, op, args);
    assert.deepEqual(run.result, { status: 'negated', reason: 'impossible', events: [] });
    assert.equal(kernel.continuousEffects.length, 0);
  }
  for (const [op, args, message] of [
    [bonusOp, { amount: c(1.5) }, 'safe integer'],
    [bonusOp, { amount: c('2') }, 'safe integer'],
    [bonusOp, { amount: c(1), bogus: c(1) }, 'Invalid continuous.bonus-damage argument'],
    [bonusOp, { amount: c(1), duration: c('until-forever') }, 'duration is not a known alias'],
    [thresholdOp, { amount: c(1.5) }, 'safe integer'],
    [mightReductionOp, { mode: c('additional'), amount: c(-1.5) }, 'safe integer'],
    [mightReductionOp, { mode: c('additional'), amount: c(-1), extra: c(1) }, 'Invalid continuous.modify-might-reduction argument'],
  ]) {
    const kernel = build();
    assert.throws(() => runOn(kernel, op, args), error => error instanceof TypeError && String(error).includes(message));
    assert.equal(kernel.continuousEffects.length, 0);
  }
});

test('modifiers-primitives: dead/mistargeted references stay ignored and register nothing (CR 359.3.e)', () => {
  const kernel = build();
  kernel.perform({ type: 'kill', object: kernel.ref('ally') });
  const deadRef = kernel.ref('ally');
  const dead = runBonus(kernel, { amount: c(3), target: c({ id: deadRef.id, zoneEntryId: deadRef.zoneEntryId }) });
  // The dead ref fails the live-object check and bindTarget fails closed, so
  // the registration never happens.
  assert.equal(dead.result.status, 'ignored');
  assert.equal(dead.result.reason, 'mistargeted');
  assert.equal(dead.world.continuousEffects.length, 0);

  const kernel2 = build();
  const shield = runShield(kernel2, { object: c({ kind: 'source' }) }, kernel2.ref('foe'));
  assert.equal(shield.result.status, 'executed');
  assert.equal(shield.linked.shieldValue, 0);
  const missing = runShield(kernel2, { object: c({ target: 'nowhere' }) });
  assert.equal(missing.result.status, 'ignored');
  assert.equal(missing.result.reason, 'mistargeted');
});

test('modifiers-primitives: all four ops are wired into the production registry', () => {
  for (const op of ['continuous.bonus-damage', 'continuous.lethal-threshold', 'continuous.modify-might-reduction', 'effect.shield-value']) {
    assert.ok(instructionDefinitionsById.has(op), op + ' is registered');
  }
});

test('modifiers-queries: controller, appliesTo, filter anchors and windows select registrations (CR 714, 142.4.c, 479.4.b)', () => {
  const kernel = build();
  runBonus(kernel, { amount: c(2), appliesTo: c('next-spell-you-play'), duration: c('end-of-turn') });
  runBonus(kernel, { amount: c(3), appliesTo: c('any') });
  runThreshold(kernel, { amount: c(7), duration: c('end-of-turn') });
  runReduction(kernel, { mode: c('additional'), amount: c(-2), duration: c('end-of-turn') });
  const registry = registryFrom(kernel);
  const objects = ref => kernel.object(ref);

  const spellScope = { controller: 'A', appliesTo: 'next-spell-you-play' };
  // CR 714: instances are summed per Deal action; an 'any'-scoped grant
  // applies to the same Deal as the spell-scoped grant.
  assert.deepEqual(bonusDamageForDeal(registry, spellScope, objects), 5);
  assert.deepEqual(bonusDamageForDeal(registry, { controller: 'A', appliesTo: 'deal-actions' }, objects), 3);
  assert.deepEqual(bonusDamageGrantsForDeal(registry, spellScope, objects).map(g => g.amount), [2, 3]);
  assert.deepEqual(bonusDamageForDeal(registry, { controller: 'A' }, objects), 0);
  assert.deepEqual(bonusDamageForDeal(registry, { controller: 'B', appliesTo: 'next-spell-you-play' }, objects), 0);
  assert.deepEqual(lethalThresholdFor(registry, { controller: 'A' }, objects).map(g => g.amount), [7]);
  assert.deepEqual(additionalMightReductions(registry, { controller: 'A' }, objects).map(g => g.amount), [-2]);

  registry.expireAt({ id: 'turn-end', player: 'A' }, objects);
  // The end-of-turn grants expire; the permanent 'any' grant keeps applying.
  assert.deepEqual(bonusDamageForDeal(registry, spellScope, objects), 3);
  assert.deepEqual(lethalThresholdFor(registry, { controller: 'A' }, objects), []);
  assert.deepEqual(additionalMightReductions(registry, { controller: 'A' }, objects), []);
});

test('modifiers-queries: registration filters anchor on the queried object (CR 715.2)', () => {
  const kernel = build();
  runBonus(kernel, { amount: c(1), appliesTo: c('deal-actions'), filter: c({ objectId: 'foe' }) });
  const registry = registryFrom(kernel);
  const objects = ref => kernel.object(ref);
  const scope = { controller: 'A', appliesTo: 'deal-actions', source: kernel.ref('foe') };
  assert.deepEqual(bonusDamageForDeal(registry, scope, objects), 1);
  assert.deepEqual(bonusDamageForDeal(registry, { controller: 'A', appliesTo: 'deal-actions', source: kernel.ref('ally') }, objects), 0);
});

test('effect.shield-value: sums Shield instances, bare Shield reads 1, absent Shield reads 0 (CR 814.1.b.3, 814.2)', () => {
  const variants = [
    [[{ id: 'Shield', value: 2 }], 2],
    [[{ id: 'shield', value: 3 }], 3],
    [[{ id: 'Shield' }], 1],
    [[{ id: 'Shield', value: 2 }, { id: 'Shield', value: 2 }], 4],
    [[], 0],
    [[{ id: 'Ward' }], 0],
  ];
  for (const [keywords, expected] of variants) {
    const kernel = build(b => b.unit('shielded', { keywords }));
    const run = runShield(kernel, { object: c({ kind: 'source' }) }, kernel.ref('shielded'));
    assert.equal(run.result.status, 'executed');
    assert.equal(run.linked.shieldValue, expected);
  }
});

// rad/ntofo-strikes original IR: grant Shield 2 to a friendly unit, read its
// Shield Value, then deal damage equal to that value to an enemy unit.
// (CR 814.1.b / 814.2: the granted keyword is what the value reader sees.)
//
// Stage-one boundary note: the card program is judge-required because the
// default chain adapter does not yet (a) bind the IR TargetSpec as the grant
// object selector and (b) hand instruction contexts layer-evaluated object
// snapshots. Both adapter halves are contract change requests for the owner
// tasks. The steps below execute the production primitives and the production
// layer engine only; no value is computed by hand.
test('card rad/ntofo-strikes: original play body executes grant -> shield-value -> deal through the production registry', () => {
  const play = ntofo.abilities.find(a => a.kind === 'play');
  assert.equal(play.body.length, 3);
  assert.equal(play.body[0].op, 'continuous.grant-keyword');
  assert.equal(play.body[1].op, 'effect.shield-value');
  assert.equal(play.body[2].op, 'effect.damage');
  const kernel = build();
  kernel.setTargets('ntofo-strikes.friendly-unit', [kernel.ref('ally')]);
  kernel.setTargets('ntofo-strikes.enemy-unit', [kernel.ref('foe')]);

  // 1. continuous.grant-keyword: Give a friendly unit [Shield 2] this turn.
  //    The IR args carry no selector; the target spec id is the selector the
  //    chain adapter will bind (contract change request, stage two).
  const friendlyId = play.body[0].targets[0].id;
  assert.equal(friendlyId, 'ntofo-strikes.friendly-unit');
  const grant = runOn(kernel, grantKeywordOp, { ...play.body[0].args, objects: { kind: 'target', id: friendlyId } });
  assert.equal(grant.result.status, 'executed');

  // The production layer engine applies the registration; the evaluated
  // snapshot is exactly what a layer-aware resolve context would hand on.
  const layer = new LayerEngine([...kernel.objects]);
  for (const entry of kernel.continuousEffects) layer.addContinuous(entry.effect, entry.duration);
  const layeredAlly = layer.evaluate(kernel.ref('ally'));
  assert.deepEqual(layeredAlly.keywords.filter(k => k.id.toLowerCase() === 'shield'), [{ id: 'Shield', value: 2 }]);

  // 2-3. Reader and Deal run against a world whose objects are the layered
  //      view (stage-two adapter). shield-value reads the IR constant
  //      selector; the deal amount is the IR linked-value expression over the
  //      reader receipt, and its constant target spec id is unwrapped the way
  //      the production interpreter unwraps literal fields before dispatch.
  const readerKernel = build();
  readerKernel.addObject(layeredAlly);
  readerKernel.setTargets('ntofo-strikes.friendly-unit', [readerKernel.ref('ally')]);
  readerKernel.setTargets('ntofo-strikes.enemy-unit', [readerKernel.ref('foe')]);
  const reader = runOn(readerKernel, shieldValueOp, play.body[1].args);
  assert.equal(reader.result.status, 'executed');
  assert.equal(reader.linked.shieldValue, 2);

  const deal = runOn(readerKernel, damageOp, { ...play.body[2].args, target: play.body[2].args.target.value });
  assert.equal(deal.result.status, 'executed');
  assert.deepEqual(deal.linked.dealtTo, [{ target: { id: 'foe', zoneEntryId: 1 }, amount: 2 }]);
  assert.equal(readerKernel.getObject('foe').damage, 2);
});

// ogn/ravenborn-tome original activated body: the grant half registers Bonus
// Damage for the next spell you play this turn; the passive consumer pipeline
// is a separate stage-two gap.
test('card ogn/ravenborn-tome: original activated body registers the next-spell Bonus Damage grant (CR 713)', () => {
  const ability = ravenborn.abilities.find(a => a.kind === 'activated');
  assert.ok(Array.isArray(ability.body) && ability.body[0].op === 'continuous.bonus-damage');
  const kernel = build(b => b.unit('tome'));
  const run = runBonus(kernel, ability.body[0].args, kernel.ref('tome'));
  assert.equal(run.result.status, 'executed');
  const entry = run.world.continuousEffects[0];
  assert.equal(entry.effect.effect.kind, 'continuous.bonus-damage');
  assert.equal(entry.effect.effect.amount, 1);
  assert.equal(entry.effect.effect.appliesTo, 'next-spell-you-play');
  assert.equal(entry.effect.effect.scope, 'each-instance');
  assert.equal(entry.effect.source.id, 'tome');
  assert.deepEqual(entry.duration, { type: 'end-of-turn' });
  assert.deepEqual(run.linked.registered, { id: entry.effect.id, amount: 1 });
});
