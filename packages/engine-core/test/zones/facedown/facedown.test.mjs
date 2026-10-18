import assert from 'node:assert/strict';
import test from 'node:test';
import {
  FacedownError, buildFacedownPlayCost, createFacedownZone, facedownCapacity,
  facedownReveals, hiddenTargetOptions, planFacedownCleanup, planHiddenPlay,
  planHide, prepareHide,
} from '../../../dist/zones/facedown/index.js';
import { world } from '../../../dist/effects/testing/index.js';
import { ContinuousEffectRegistry } from '../../../dist/layers/duration.js';
import { payHiddenCostPlan } from '../../../dist/cost/kinds/hidden.js';
import hidden from '../../../dist/effects/keywords/Hidden.js';
import bandleTree from '../../../../card-dsl/dist/cards/ogn/bandle-tree.js';
import fightOrFlight from '../../../../card-dsl/dist/cards/ogn/fight-or-flight.js';
import hiddenBlade from '../../../../card-dsl/dist/cards/ogn/hidden-blade.js';
import blastconeFae from '../../../../card-dsl/dist/cards/ogn/blastcone-fae.js';
import hourglass from '../../../../card-dsl/dist/cards/ogn/zhonyas-hourglass.js';

const timing = (extra = {}) => ({ turn: 1, actor: 'A', turnPlayer: 'A', priorityHolder: 'A', stateOpen: true, showdown: false, ...extra });
const failure = reason => error => error instanceof FacedownError && error.reason === reason;

function setup(sourceValues = {}, playerValues = {}) {
  const kernel = world().player('A', { energy: 10, power: ['Mind'], ...playerValues })
    .card('field', { zone: 'board', types: ['battlefield'], location: { type: 'battlefield', id: 'field' }, cardId: bandleTree.canonicalCardId })
    .card('other-field', { zone: 'board', types: ['battlefield'], location: { type: 'battlefield', id: 'other-field' } })
    .hand('source', { types: ['spell'], keywords: [{ id: 'hidden' }], energy: 5, power: ['Order'], ...sourceValues })
    .hand('second', { types: ['unit'], keywords: [{ id: 'hidden' }] })
    .unit('local', { location: { type: 'battlefield', id: 'field' } })
    .unit('local-second', { location: { type: 'battlefield', id: 'field' } })
    .unit('elsewhere', { location: { type: 'battlefield', id: 'other-field' } })
    .unit('base', { location: { type: 'base', player: 'A' } }).build();
  const ctx = kernel.clone({ sourceSnapshot: kernel.object(kernel.ref('source')) });
  return { ctx, source: ctx.source, battlefield: kernel.object(kernel.ref('field')), empty: createFacedownZone('field') };
}

function capacityRule(registry, battlefield, amount, id = 'extra-slot', fields = {}) {
  // Trusted initial layer state, using the existing normalized registration shape.
  registry.register({ id, layer: 'ability', source: battlefield.ref,
    filter: { objectId: battlefield.ref.id, zoneEntryId: battlefield.ref.zoneEntryId },
    effect: { kind: 'restriction', restriction: bandleTree.abilities[0].effect.restriction, amount, ...fields },
  }, { type: 'permanent' });
}

test('Hide plans a private entry with a fresh identity, without opening a chain or mutating Hand', () => {
  const { ctx, source, battlefield, empty } = setup();
  const before = ctx.snapshot();
  const plan = planHide(empty, source, battlefield, timing());
  assert.equal(plan.opensChain, false);
  assert.deepEqual(plan.from, source.ref);
  assert.deepEqual(plan.entry.ref, { id: 'source', zoneEntryId: 2 });
  assert.equal(plan.zone.cards.length, 1);
  assert.equal(plan.entry.hiddenOnTurn, 1);
  assert.equal(plan.entry.front.cardId, source.cardId);
  assert.equal(empty.cards.length, 0);
  assert.deepEqual(ctx.snapshot(), before);
  assert.ok(Object.isFrozen(plan.zone.cards[0].front.keywords));
});

test('cost.hidden expansion is consumed without treating another static ability as permission', () => {
  const { source, battlefield, empty } = setup({ keywords: [] });
  assert.throws(() => planHide(empty, source, battlefield, timing()), failure('illegal-hide'));
  const abilities = hidden.expand({ host: { canonicalCardId: source.cardId } });
  assert.equal(abilities[0].effect.kind, 'cost.hidden');
  assert.equal(planHide(empty, source, battlefield, timing(), { abilities }).zone.cards.length, 1);
  assert.throws(() => planHide(empty, source, battlefield, timing(), {
    abilities: [{ kind: 'static', effect: { kind: 'timing', grants: ['reaction'] } }],
  }), failure('illegal-hide'));
  assert.throws(() => planHide(empty, source, battlefield, timing(), {
    abilities: [{ ...abilities[0], condition: { kind: 'constant', value: false } }],
  }), failure('judge-required'));
});

test('Hide validates own turn, Priority, Open State and battlefield control', () => {
  const { source, battlefield, empty } = setup();
  for (const changed of [{ turnPlayer: 'B' }, { priorityHolder: 'B' }, { priorityHolder: null },
    { stateOpen: false }, { showdown: true, focusHolder: 'B' }]) {
    assert.throws(() => planHide(empty, source, battlefield, timing(changed)), failure('illegal-hide'));
  }
  assert.throws(() => planHide(empty, source, { ...battlefield, controller: 'B' }, timing()), failure('illegal-hide'));
  assert.throws(() => planHide(empty, { ...source, owner: 'B' }, battlefield, timing()), failure('illegal-hide'));
  assert.throws(() => planHide(empty, source, { ...battlefield, ref: { id: 'other', zoneEntryId: 1 } }, timing()), failure('invalid-state'));
});

test('Hide rejects other zones, facedown cards and noncard objects; Champion planning is supported', () => {
  const { source, battlefield, empty } = setup();
  for (const zone of ['deck', 'trash', 'board', 'chain', 'banishment']) {
    assert.throws(() => planHide(empty, { ...source, zone }, battlefield, timing()), failure('illegal-hide'));
  }
  for (const changed of [{ isToken: true }, { faceDown: true }, { cardId: null }, { types: ['rune'] }]) {
    assert.throws(() => planHide(empty, { ...source, ...changed }, battlefield, timing()), failure('illegal-hide'));
  }
  assert.equal(planHide(empty, { ...source, zone: 'champion', types: ['unit'] }, battlefield, timing()).zone.cards.length, 1);
});

test('default capacity rejects a second card and rejects a duplicate physical card', () => {
  const { ctx, source, battlefield, empty } = setup();
  const first = planHide(empty, source, battlefield, timing());
  assert.equal(facedownCapacity(empty, battlefield), 1);
  assert.throws(() => planHide(first.zone, ctx.object(ctx.ref('second')), battlefield, timing()), failure('zone-full'));
  assert.throws(() => planHide(first.zone, source, battlefield, timing()), failure('invalid-state'));
  assert.equal(first.zone.cards.length, 1);
});

test('Bandle Tree additional slot is scoped to its battlefield and still requires Hidden', () => {
  const { ctx, source, battlefield, empty } = setup();
  const registry = new ContinuousEffectRegistry();
  assert.equal(bandleTree.sourceText, 'You may hide an additional card here.');
  capacityRule(registry, battlefield, bandleTree.abilities[0].effect.amount);
  assert.equal(facedownCapacity(empty, battlefield, registry), 2);
  const other = ctx.object(ctx.ref('other-field'));
  assert.equal(facedownCapacity(createFacedownZone('other-field'), other, registry), 1);
  const first = planHide(empty, source, battlefield, timing(), { registry });
  const second = planHide(first.zone, ctx.object(ctx.ref('second')), battlefield, timing(), { registry });
  assert.equal(second.zone.cards.length, 2);
  const secondCtx = ctx.clone({ sourceSnapshot: ctx.object(ctx.ref('second')) });
  const paidSecond = prepareHide(secondCtx, first.zone, battlefield, timing(), 'additional-hide', { registry });
  assert.deepEqual(paidSecond.payment.actions[0].action.plan.power, ['Mind']);
  assert.throws(() => planHide(first.zone, { ...ctx.object(ctx.ref('second')), keywords: [] }, battlefield, timing(), { registry }), failure('illegal-hide'));
});

test('capacity handles reductions, cancellation and malformed registered amounts', () => {
  const { battlefield, empty, source } = setup();
  const registry = new ContinuousEffectRegistry();
  capacityRule(registry, battlefield, -1);
  assert.equal(facedownCapacity(empty, battlefield, registry), 0);
  assert.throws(() => planHide(empty, source, battlefield, timing(), { registry }), failure('zone-full'));
  capacityRule(registry, battlefield, 0, 'cancel', { cancels: true });
  assert.equal(facedownCapacity(empty, battlefield, registry), 1);
  registry.remove('cancel');
  registry.remove('extra-slot');
  capacityRule(registry, battlefield, 0.5);
  assert.throws(() => facedownCapacity(empty, battlefield, registry), failure('judge-required'));
});

test('Hide cost bridge locks one any-domain Power, retaining null printed costs', () => {
  const { ctx, battlefield, empty } = setup({ energy: null, power: null });
  const before = ctx.snapshot();
  const prepared = prepareHide(ctx, empty, battlefield, timing(), 'hide');
  assert.equal(prepared.cost.total.energy, 0);
  assert.deepEqual(prepared.cost.printed, { energy: null, power: null });
  assert.deepEqual(prepared.payment.actions[0].action, {
    type: 'pay', player: 'A', plan: { finalized: true, energy: 0, power: ['Mind'] },
  });
  assert.deepEqual(ctx.snapshot(), before);
  const receipt = payHiddenCostPlan(ctx, prepared.cost);
  assert.equal(receipt.paid, true);
  assert.deepEqual(receipt.actions[0].action.plan.power, ['Mind']);
  // Reference-kernel Power deduction is an upstream gap, not a passing lifecycle assertion.
});

test('insufficient Hide Power rejects before a transition can be returned', () => {
  const { ctx, battlefield, empty } = setup({}, { power: [] });
  const before = ctx.snapshot();
  assert.throws(() => prepareHide(ctx, empty, battlefield, timing(), 'hide'), error => error.reason === 'cannot-pay-cost');
  assert.deepEqual(ctx.snapshot(), before);
  assert.equal(empty.cards.length, 0);
});

test('full capacity is rejected before Hide cost planning or payment', () => {
  const { ctx, source, battlefield, empty } = setup();
  const first = planHide(empty, source, battlefield, timing());
  const secondCtx = ctx.clone({ sourceSnapshot: ctx.object(ctx.ref('second')) });
  const before = secondCtx.snapshot();
  assert.throws(() => prepareHide(secondCtx, first.zone, battlefield, timing(), 'second-hide'), failure('zone-full'));
  assert.deepEqual(secondCtx.snapshot(), before);
});

test('Hide cost bridge refuses last-known source snapshots after the source really changes zones', () => {
  const { ctx, battlefield, empty } = setup();
  assert.equal(ctx.perform({ type: 'move-zone', object: ctx.source.ref, to: 'trash' }).status, 'done');
  const before = ctx.snapshot();
  assert.throws(() => prepareHide(ctx, empty, battlefield, timing(), 'stale-hide'), failure('stale-reference'));
  assert.deepEqual(ctx.snapshot(), before);
});

for (const [name, program, type] of [
  ['Fight or Flight', fightOrFlight, 'spell'], ['Hidden Blade', hiddenBlade, 'spell'],
  ['Blastcone Fae', blastconeFae, 'unit'], ["Zhonya's Hourglass", hourglass, 'gear'],
]) {
  test(`${name}: Hidden zone transition and next-turn Reaction plan (${program.canonicalCardId})`, () => {
    const { source, battlefield, empty } = setup({ cardId: program.canonicalCardId, types: [type], keywords: [] });
    const declaration = program.abilities.find(ability => ability.kind === 'keyword' && ability.keyword === 'hidden');
    assert.ok(declaration);
    const abilities = hidden.expand({ host: { canonicalCardId: program.canonicalCardId } });
    const hide = planHide(empty, source, battlefield, timing(), { abilities });
    assert.throws(() => planHiddenPlay(hide.zone, hide.entry.ref, battlefield, timing()), failure('illegal-play'));
    const play = planHiddenPlay(hide.zone, hide.entry.ref, battlefield,
      timing({ turn: 2, turnPlayer: 'B', stateOpen: false }));
    assert.equal(play.opensChain, true);
    assert.equal(play.speed, 'reaction');
    assert.equal(play.card.reaction, true);
    assert.equal(play.card.zone, 'chain');
    assert.equal(play.card.faceDown, false);
    assert.deepEqual(play.card.ref, { id: 'source', zoneEntryId: 3 });
    assert.equal(play.zone.cards.length, 0);
    assert.equal(hide.zone.cards.length, 1);
    assert.equal(play.reveal.cardId, program.canonicalCardId);
    assert.deepEqual(play.location, type === 'spell' ? undefined : { type: 'battlefield', id: 'field' });
    assert.equal(program.status, 'judge-required');
  });
}

test('Hidden play rechecks current control, Priority, Showdown Focus and entry identity', () => {
  const { source, battlefield, empty } = setup();
  const hide = planHide(empty, source, battlefield, timing());
  const next = timing({ turn: 2 });
  assert.throws(() => planHiddenPlay(hide.zone, source.ref, battlefield, next), failure('stale-reference'));
  assert.throws(() => planHiddenPlay(hide.zone, hide.entry.ref, { ...battlefield, controller: 'B' }, next), failure('illegal-play'));
  for (const changed of [{ priorityHolder: 'B' }, { turnPlayer: 'B' }, { showdown: true, focusHolder: 'B' }]) {
    assert.throws(() => planHiddenPlay(hide.zone, hide.entry.ref, battlefield, timing({ turn: 2, ...changed })), failure('illegal-play'));
  }
  assert.equal(planHiddenPlay(hide.zone, hide.entry.ref, battlefield, timing({ turn: 5, turnPlayer: 'B', stateOpen: false })).speed, 'reaction');
});

test('Hidden permanents cannot be sent to Base or another battlefield', () => {
  const { source, battlefield, empty } = setup({ types: ['gear'] });
  const hide = planHide(empty, source, battlefield, timing());
  for (const location of [{ type: 'base', player: 'A' }, { type: 'battlefield', id: 'other-field' }, null]) {
    assert.throws(() => planHiddenPlay(hide.zone, hide.entry.ref, battlefield, timing({ turn: 2 }), { location }), failure('illegal-play'));
  }
});

test('each target is restricted to the origin; an empty local board never permits remote targets', () => {
  const { ctx, source, battlefield, empty } = setup();
  const local = ctx.object(ctx.ref('local'));
  const remote = ctx.object(ctx.ref('elsewhere'));
  const base = ctx.object(ctx.ref('base'));
  const localSecond = ctx.object(ctx.ref('local-second'));
  assert.deepEqual(hiddenTargetOptions('field', [remote, local, base]), [local]);
  assert.deepEqual(hiddenTargetOptions('field', [remote, base]), []);
  const hide = planHide(empty, source, battlefield, timing());
  const target = { id: 'unit', min: 1, max: 1, options: [local, remote], chosen: [local.ref] };
  const play = options => planHiddenPlay(hide.zone, hide.entry.ref, battlefield, timing({ turn: 2 }), options);
  assert.equal(play({ targets: [target] }).opensChain, true);
  for (const changed of [{ chosen: [remote.ref] }, { chosen: [] }, { options: [remote], chosen: [remote.ref] },
    { chosen: [{ ...local.ref, zoneEntryId: 99 }] }, { chosen: [local.ref, local.ref] },
    { chosen: [local.ref, { zoneEntryId: local.ref.zoneEntryId, id: local.ref.id }] }]) {
    assert.throws(() => play({ targets: [{ ...target, ...changed }] }), failure('illegal-play'));
  }
  assert.throws(() => play({ targets: [{ ...target, options: [local, localSecond], chosen: [local.ref, localSecond.ref] }] }), failure('illegal-play'));
  assert.throws(() => play({ targets: [target, { ...target, id: 'second', chosen: [remote.ref] }] }), failure('illegal-play'));
});

test('Pending cost bridge ignores base costs and really pays retained additional Energy', () => {
  const { source, battlefield, empty } = setup();
  const hide = planHide(empty, source, battlefield, timing());
  const play = planHiddenPlay(hide.zone, hide.entry.ref, battlefield, timing({ turn: 2 }));
  // Initial Pending state for the cost adapter test; this does not simulate a Hide/Chain transaction.
  const kernel = world().player('A', { energy: 3, power: [] }).card('source', {
    zone: 'chain', ref: play.card.ref, energy: 5, power: ['Order'], types: ['spell'],
  }).build();
  const ctx = kernel.clone({ sourceSnapshot: kernel.object(kernel.ref('source')) });
  const plan = buildFacedownPlayCost(ctx, play, { id: 'hidden-play',
    mandatoryAdditional: [{ id: 'fee', cost: { energy: { kind: 'constant', value: 2 } } }],
  });
  assert.equal(plan.printed.energy, 5);
  assert.equal(plan.total.energy, 2);
  assert.deepEqual(plan.total.power, []);
  payHiddenCostPlan(ctx, plan);
  assert.equal(ctx.player('A').energy, 1);
  assert.throws(() => buildFacedownPlayCost(setup().ctx, play, { id: 'stale' }), failure('stale-reference'));
  assert.equal(ctx.perform({ type: 'move-zone', object: ctx.source.ref, to: 'trash' }).status, 'done');
  assert.throws(() => buildFacedownPlayCost(ctx, play, { id: 'departed' }), failure('stale-reference'));
});

test('capacity shrink requires the controller to select exactly the overflow and reveals Trash entries', () => {
  const { ctx, source, battlefield, empty } = setup();
  const registry = new ContinuousEffectRegistry();
  capacityRule(registry, battlefield, 1);
  const first = planHide(empty, source, battlefield, timing(), { registry });
  const second = planHide(first.zone, ctx.object(ctx.ref('second')), battlefield, timing(), { registry });
  registry.remove('extra-slot');
  assert.throws(() => planFacedownCleanup(second.zone, battlefield), failure('invalid-state'));
  const discard = [first.entry.ref];
  assert.throws(() => planFacedownCleanup(second.zone, battlefield, { discard, chooser: 'B' }), failure('invalid-state'));
  assert.throws(() => planFacedownCleanup(second.zone, battlefield, { discard: [source.ref], chooser: 'A' }), failure('invalid-state'));
  const cleanup = planFacedownCleanup(second.zone, battlefield, { discard, chooser: 'A' });
  assert.deepEqual(cleanup.zone.cards.map(entry => entry.ref.id), ['second']);
  assert.equal(cleanup.exits[0].zone, 'trash');
  assert.equal(cleanup.exits[0].owner, 'A');
  assert.equal(cleanup.exits[0].ref.zoneEntryId, 3);
  assert.equal(cleanup.exits[0].reveal.cardId, source.cardId);
  assert.equal(second.zone.cards.length, 2);
});

test('losing battlefield control plans reveal and owner-Trash during Cleanup, without transferring cards', () => {
  const { source, battlefield, empty } = setup();
  const hide = planHide(empty, source, battlefield, timing());
  const lost = { ...battlefield, controller: 'B' };
  assert.throws(() => planHide(hide.zone, { ...source, ref: { id: 'new', zoneEntryId: 1 }, owner: 'B', controller: 'B' },
    lost, timing({ actor: 'B', turnPlayer: 'B', priorityHolder: 'B' })), failure('illegal-hide'));
  const cleanup = planFacedownCleanup(hide.zone, lost);
  assert.equal(cleanup.zone.cards.length, 0);
  assert.equal(cleanup.exits[0].owner, 'A');
  assert.equal(cleanup.exits[0].reveal.cardId, source.cardId);
  assert.equal(hide.zone.cards[0].controller, 'A');
  assert.deepEqual(facedownReveals(hide.zone), [{ ref: hide.entry.ref, ...hide.entry.front }]);
});

test('invalid turn ordinals and exhausted identity counters fail before a transition is returned', () => {
  const { source, battlefield, empty } = setup();
  for (const turn of [-1, 1.5, NaN, Infinity]) {
    assert.throws(() => planHide(empty, source, battlefield, timing({ turn })), failure('invalid-state'));
  }
  assert.throws(() => planHide(empty, { ...source, ref: { id: 'source', zoneEntryId: Number.MAX_SAFE_INTEGER } }, battlefield, timing()), failure('invalid-state'));
});
