import assert from 'node:assert/strict';
import test from 'node:test';

import hiddenKeyword from '../../dist/effects/keywords/Hidden.js';
import { bindResolveContext } from '../../dist/events/action-adapter.js';
import { world } from '../../dist/effects/testing/test-kernel.js';
import { ContinuousEffectRegistry } from '../../dist/layers/duration.js';
import bandleTree from '../../../card-dsl/dist/cards/ogn/bandle-tree.js';
import blastconeFae from '../../../card-dsl/dist/cards/ogn/blastcone-fae.js';
import emperorsDivide from '../../../card-dsl/dist/cards/sfd/emperors-divide.js';
import { expandProgram } from '../../dist/programs/keywords.js';
import { createEngineStaticBinder } from '../../dist/programs/statics.js';
import {
  HiddenZoneError,
  createHiddenState,
  cleanupLostControl,
  findHiddenCard,
  getFacedownZone,
  hideCard,
  hideWithCost,
  hiddenCapacityFor,
  hiddenReactionTiming,
  isHiddenReactionUnlocked,
  isHiddenTargetLegal,
  playFromHidden,
  playFromHiddenWithCost,
  registerHiddenCapacityRule,
  restoreHiddenState,
  setBattlefieldController,
  setFacedownCapacity,
  setTurn,
} from '../../dist/zones/hidden/index.js';

const card = (id, values = {}) => ({
  ref: { id, zoneEntryId: 1 },
  cardId: `card:${id}`,
  name: id,
  types: ['unit'],
  tags: [],
  keywords: [{ id: 'Hidden' }],
  owner: 'A',
  controller: 'A',
  zone: 'hand',
  location: null,
  might: 2,
  energy: 2,
  power: [],
  exhausted: false,
  damage: 0,
  stunned: false,
  buffs: 0,
  attachedTo: null,
  faceDown: false,
  isToken: false,
  ...values,
});

function sourceContext(snapshot, { power = [], energy = 20 } = {}) {
  const kernel = world()
    .player('A', { power, energy })
    .player('B')
    .card(snapshot.ref.id, snapshot)
    .build();
  return { kernel, context: bindResolveContext(kernel.clone({ sourceSnapshot: snapshot, controller: 'A' }), { controller: 'A' }) };
}

test('EG-HIDDEN keeps the keyword IR additive while exposing the full rule references', () => {
  assert.deepEqual(hiddenKeyword.expand({ host: { canonicalCardId: 'card:hidden' } }), [{
    kind: 'static', effect: { kind: 'cost.hidden' }
  }]);
  assert.equal(hiddenKeyword.stacking, 'single');
  assert.ok(hiddenKeyword.ruleRefs.includes('811.1.d.2'));
  assert.ok(hiddenKeyword.ruleRefs.includes('811.6.a'));
});

test('EG-HIDDEN production keyword expansion authorizes Hide while conditional Hidden stays judge-required', () => {
  const snapshot = card('expanded-permission', { keywords: [] });
  const state = createHiddenState([{ battlefieldId: 'bf-1', controller: 'A' }], 2);
  const expanded = hiddenKeyword.expand({ host: { canonicalCardId: snapshot.cardId } });
  const hidden = hideCard(state, {
    card: snapshot,
    player: 'A',
    battlefieldId: 'bf-1',
    abilities: expanded
  });
  assert.equal(hidden.card.ref.id, snapshot.ref.id);

  const conditional = [{ ...expanded[0], condition: { kind: 'constant', value: true } }];
  assert.throws(
    () => hideCard(state, {
      card: snapshot,
      player: 'A',
      battlefieldId: 'bf-1',
      abilities: conditional
    }),
    error => error instanceof HiddenZoneError && error.code === 'judge-required'
  );
});

test('EG-HIDDEN representative raw card IR is admitted by keyword expansion and remains blocked only at the shared static binder', () => {
  for (const program of [blastconeFae, emperorsDivide]) {
    const source = card(program.canonicalCardId, {
      types: program === blastconeFae ? ['unit'] : ['spell'],
      keywords: []
    });
    const expanded = expandProgram(program, source);
    assert.ok(expanded.expanded.some(ability => ability.kind === 'static' && ability.effect.kind === 'cost.hidden'));

    const binding = createEngineStaticBinder({
      layers: { addContinuous() {}, removeContinuous() {} },
      pipeline: { host: { objects: () => [], context() { throw new Error('not reached'); } } }
    });
    assert.throws(
      () => binding.bindStatic(expanded.expanded.find(ability => ability.kind === 'static' && ability.effect.kind === 'cost.hidden'), source),
      error => error?.code === 'judge-required' && /cost\.hidden has no layer mapping/.test(error.message)
    );
  }
});

test('EG-HIDDEN Hide pays [A], occupies one Facedown Zone, and does not open a Chain', () => {
  const snapshot = card('hidden-unit');
  const { kernel, context } = sourceContext(snapshot, { power: ['Fury'] });
  const initial = createHiddenState([{ battlefieldId: 'bf-1', controller: 'A' }], 4);
  const result = hideWithCost(initial, {
    card: snapshot,
    player: 'A',
    battlefieldId: 'bf-1',
    ctx: context,
    costId: 'hide:hidden-unit'
  });

  assert.equal(result.receipt.paid, true);
  assert.deepEqual(result.receipt.power.power, [{ requirementIndex: 0, from: 'Fury', amount: 1 }]);
  assert.deepEqual(result.result.transition, {
    reason: 'hide',
    object: snapshot.ref,
    from: 'hand',
    to: 'facedown',
    battlefieldId: 'bf-1',
    player: 'A',
    opensChain: false,
    revealsToAll: false
  });
  assert.equal(getFacedownZone(result.state, 'bf-1').cards.length, 1);
  assert.equal(kernel.player('A').power.length, 1, 'the immutable pre-payment fixture is untouched');
  assert.equal(result.state.turn, 4);
});

test('EG-HIDDEN rejects an occupied Facedown Zone before paying and preserves resources', () => {
  const first = card('first');
  const second = card('second');
  const { context } = sourceContext(second, { power: ['Fury'] });
  let state = createHiddenState([{ battlefieldId: 'bf-1', controller: 'A' }], 2);
  state = hideCard(state, { card: first, player: 'A', battlefieldId: 'bf-1' }).state;
  assert.throws(
    () => hideWithCost(state, { card: second, player: 'A', battlefieldId: 'bf-1', ctx: context, costId: 'hide:second' }),
    error => error instanceof HiddenZoneError && error.code === 'occupied'
  );
  assert.equal(getFacedownZone(state, 'bf-1').cards[0].ref.id, 'first');
});

test('EG-HIDDEN Bandle Tree production restriction raises only its own Facedown Zone cap', () => {
  const battlefield = card('bf-1', {
    zone: 'board',
    types: ['battlefield'],
    location: { type: 'battlefield', id: 'bf-1' },
    keywords: []
  });
  const registry = new ContinuousEffectRegistry();
  const bound = registerHiddenCapacityRule(registry, {
    id: 'bandle-tree:extra-slot',
    battlefield,
    amount: bandleTree.abilities[0].effect.amount
  });

  const state = createHiddenState([
    { battlefieldId: 'bf-1', controller: 'A' },
    { battlefieldId: 'bf-2', controller: 'A' }
  ], 2);
  assert.equal(hiddenCapacityFor(getFacedownZone(state, 'bf-1'), { battlefield, registry }), 2);
  assert.throws(
    () => hiddenCapacityFor(getFacedownZone(state, 'bf-2'), { battlefield, registry }),
    error => error instanceof HiddenZoneError && error.code === 'invalid-state'
  );
  const first = card('first');
  const second = card('second');
  let filled = hideCard(state, { card: first, player: 'A', battlefieldId: 'bf-1' }).state;
  filled = hideCard(filled, {
    card: second,
    player: 'A',
    battlefieldId: 'bf-1',
    capacityRuleSource: { battlefield, registry }
  }).state;
  assert.equal(getFacedownZone(filled, 'bf-1').cards.length, 2);
  bound.unbind();
  assert.equal(hiddenCapacityFor(getFacedownZone(filled, 'bf-1'), { battlefield, registry }), 1);
});

test('EG-HIDDEN failed [A] payment rolls back the proposed Hide transition', () => {
  const snapshot = card('unpaid');
  const { context } = sourceContext(snapshot, { energy: 20 });
  const state = createHiddenState([{ battlefieldId: 'bf-1', controller: 'A' }], 2);

  assert.throws(
    () => hideWithCost(state, {
      card: snapshot,
      player: 'A',
      battlefieldId: 'bf-1',
      ctx: context,
      costId: 'hide:unpaid'
    }),
    error => error?.name === 'CostPlanError' && error.reason === 'cannot-pay-cost'
  );
  assert.equal(getFacedownZone(state, 'bf-1').cards.length, 0);
});

test('EG-HIDDEN rejects a stale current source before planning or payment', () => {
  const snapshot = card('stale-hide');
  const { context } = sourceContext(snapshot, { power: ['Fury'] });
  const state = createHiddenState([{ battlefieldId: 'bf-1', controller: 'A' }], 2);
  assert.throws(
    () => hideWithCost(state, {
      card: snapshot,
      source: null,
      player: 'A',
      battlefieldId: 'bf-1',
      ctx: context,
      costId: 'hide:stale'
    }),
    error => error instanceof HiddenZoneError && error.code === 'stale-reference'
  );
  assert.equal(getFacedownZone(state, 'bf-1').cards.length, 0);
});

test('EG-HIDDEN from-Hidden play ignores base cost but pays a declared additional fee', () => {
  const snapshot = card('fee-bearing', { energy: 7 });
  const { context } = sourceContext(snapshot);
  let state = createHiddenState([{ battlefieldId: 'bf-1', controller: 'A' }], 2);
  state = hideCard(state, { card: snapshot, player: 'A', battlefieldId: 'bf-1' }).state;
  state = setTurn(state, 3);

  const result = playFromHiddenWithCost(state, {
    object: snapshot.ref,
    player: 'A',
    destinationBattlefieldId: 'bf-1',
    turn: 3,
    ctx: context,
    costId: 'play:fee-bearing',
    mandatoryAdditional: [{ id: 'tax', cost: { energy: { kind: 'constant', value: 1 } } }]
  });

  assert.equal(result.plan.base.energy, 7);
  assert.equal(result.plan.total.energy, 1);
  assert.equal(result.receipt.total.energy, 1);
  assert.equal(result.result.destination, 'battlefield');
});

test('EG-HIDDEN next-turn play removes the card, opens the Chain, and retains origin Battlefield scope', () => {
  const snapshot = card('hidden-unit');
  let state = createHiddenState([{ battlefieldId: 'bf-1', controller: 'A' }], 5);
  state = hideCard(state, { card: snapshot, player: 'A', battlefieldId: 'bf-1' }).state;
  state = setTurn(state, 6);

  assert.equal(isHiddenReactionUnlocked(5, 5), false);
  assert.equal(isHiddenReactionUnlocked(5, 6), true);
  const result = playFromHidden(state, {
    object: snapshot.ref,
    player: 'A',
    destinationBattlefieldId: 'bf-1',
    turn: 6
  });

  assert.equal(result.destination, 'battlefield');
  assert.equal(result.transition.opensChain, true);
  assert.equal(result.transition.revealsToAll, true);
  assert.equal(result.transition.to, 'chain', 'the card is public on the Chain before it resolves to the Battlefield');
  assert.equal(getFacedownZone(result.state, 'bf-1').cards.length, 0);
  assert.equal(result.provenance.battlefieldId, 'bf-1');
  assert.equal(hiddenReactionTiming(result.provenance), 'reaction');
  assert.equal(isHiddenTargetLegal(result.provenance, {
    ref: { id: 'target-1', zoneEntryId: 1 },
    location: { type: 'battlefield', id: 'bf-1' }
  }), true);
  assert.equal(isHiddenTargetLegal(result.provenance, {
    ref: { id: 'target-2', zoneEntryId: 1 },
    location: { type: 'battlefield', id: 'bf-2' }
  }), false);
});

test('EG-HIDDEN rejects current-turn play, wrong permanent destination, and out-of-scope targets', () => {
  const snapshot = card('hidden-unit');
  let state = createHiddenState([{ battlefieldId: 'bf-1', controller: 'A' }], 3);
  state = hideCard(state, { card: snapshot, player: 'A', battlefieldId: 'bf-1' }).state;
  assert.throws(
    () => playFromHidden(state, { object: snapshot.ref, player: 'A', destinationBattlefieldId: 'bf-1' }),
    error => error instanceof HiddenZoneError && error.code === 'not-unlocked'
  );
  state = setTurn(state, 4);
  assert.throws(
    () => playFromHidden(state, { object: snapshot.ref, player: 'A', destinationBattlefieldId: 'bf-2' }),
    error => error instanceof HiddenZoneError && error.code === 'invalid-destination'
  );

  const spell = card('hidden-spell', { types: ['spell'] });
  let spellState = createHiddenState([{ battlefieldId: 'bf-1', controller: 'A' }], 3);
  spellState = hideCard(spellState, { card: spell, player: 'A', battlefieldId: 'bf-1' }).state;
  spellState = setTurn(spellState, 4);
  assert.throws(
    () => playFromHidden(spellState, {
      object: spell.ref,
      player: 'A',
      turn: 4,
      requiresTargets: true,
      targets: [{ ref: { id: 'other', zoneEntryId: 1 }, location: { type: 'battlefield', id: 'bf-2' } }]
    }),
    error => error instanceof HiddenZoneError && error.code === 'invalid-target'
  );
  const bypassed = playFromHidden(spellState, {
    object: spell.ref,
    player: 'A',
    turn: 4,
    requiresTargets: true,
    explicitlyBypassesTargetScope: true,
    targets: [{ ref: { id: 'other', zoneEntryId: 1 }, location: { type: 'battlefield', id: 'bf-2' } }]
  });
  assert.equal(bypassed.provenance.targetScope.bypassedByExplicitRestriction, true);
});

test('EG-HIDDEN from-Hidden play rejects a stale source before opening the Chain', () => {
  const snapshot = card('stale-play');
  let state = createHiddenState([{ battlefieldId: 'bf-1', controller: 'A' }], 3);
  state = hideCard(state, { card: snapshot, player: 'A', battlefieldId: 'bf-1' }).state;
  state = setTurn(state, 4);
  assert.throws(
    () => playFromHidden(state, {
      object: snapshot.ref,
      source: null,
      player: 'A',
      destinationBattlefieldId: 'bf-1'
    }),
    error => error instanceof HiddenZoneError && error.code === 'stale-reference'
  );
  assert.equal(getFacedownZone(state, 'bf-1').cards.length, 1);
});

test('EG-HIDDEN capacity reduction and loss of Battlefield control recover cards at the rule-defined boundary', () => {
  const a = card('a');
  const b = card('b');
  let state = createHiddenState([{ battlefieldId: 'bf-1', controller: 'A', capacity: 2 }], 1);
  state = hideCard(state, { card: a, player: 'A', battlefieldId: 'bf-1' }).state;
  state = hideCard(state, { card: b, player: 'A', battlefieldId: 'bf-1' }).state;
  const reduced = setFacedownCapacity(state, 'bf-1', 1);
  assert.deepEqual(reduced.discarded.map(item => item.ref.id), ['b']);
  assert.equal(getFacedownZone(reduced.state, 'bf-1').cards.length, 1);

  const controlled = setBattlefieldController(reduced.state, 'bf-1', 'B').state;
  // `controlled` is the sidecar after the control change; the canonical board
  // must still report the loss even when it briefly changes hands back.
  const cleaned = cleanupLostControl(controlled, { 'bf-1': 'B' });
  assert.deepEqual(cleaned.discarded.map(item => item.ref.id), ['a']);
  assert.equal(cleaned.transitions[0].revealsToAll, true);
  assert.equal(getFacedownZone(cleaned.state, 'bf-1').cards.length, 0);
  assert.equal(findHiddenCard(cleaned.state, a.ref), null);
});

test('EG-HIDDEN cleanup uses the canonical Battlefield control snapshot and fails closed when it is missing', () => {
  const hidden = card('snapshot-control');
  let state = createHiddenState([{ battlefieldId: 'bf-1', controller: 'A' }], 1);
  state = hideCard(state, { card: hidden, player: 'A', battlefieldId: 'bf-1' }).state;
  state = setBattlefieldController(state, 'bf-1', 'B').state;

  assert.throws(
    () => cleanupLostControl(state, {}),
    error => error instanceof HiddenZoneError && error.code === 'invalid-state'
  );
  const retained = cleanupLostControl(state, { 'bf-1': 'A' });
  assert.equal(retained.discarded.length, 1, '107.3.d records the loss; regaining control before Cleanup does not cancel it');
  assert.equal(getFacedownZone(retained.state, 'bf-1').cards.length, 0);
});

test('EG-HIDDEN restored sidecars are detached and preserve next-turn provenance', () => {
  const hidden = card('restored');
  let state = createHiddenState([{ battlefieldId: 'bf-1', controller: 'A' }], 2);
  state = hideCard(state, { card: hidden, player: 'A', battlefieldId: 'bf-1' }).state;
  const restored = restoreHiddenState(structuredClone(state));

  assert.deepEqual(restored, state);
  assert.notEqual(restored.zones['bf-1'].cards, state.zones['bf-1'].cards);
  assert.throws(
    () => restoreHiddenState({
      ...state,
      pendingControlLoss: ['unknown-battlefield']
    }),
    error => error instanceof HiddenZoneError && error.code === 'invalid-state'
  );
});

