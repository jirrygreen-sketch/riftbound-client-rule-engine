// RIFT-1007 production regression for a Hidden spell's played Gear token.
//
// Official evidence: Core Rules v1.5 (published 2026-10-09, effective
// 2026-10-16 under the Radiance rule policy):
// https://cmsassets.rgpub.io/sanity/files/dsfx7636/news_live/
//   5c7946f7c3b8c6e0faff85ab6dadc6d2e721ea94.pdf
// Radiance patch notes (effective 2026-10-16):
// https://playriftbound.com/en-us/news/announcements/core-rules-radiance-patch-notes-effective-october-16-2026/
//
// CR 811.1.d.5 rewrites the destination only when a Hidden spell or a play
// effect of a hidden permanent causes a Unit to be played. CR 811.2 leaves
// other instructions unchanged. CR 359.2.d puts a Non-Unit Gear at its
// controller's Base; CR 184.1 permits an effect to override its entry state.
// Canonical card: sfd-070-221 Wages of Pain
// (card.hash-431738fdce44471075e7d0f77a009dde71d56c7be7e2c9ef022d6b124a857a3c).
//
// Timeline: Hide -> next-turn Reaction Play -> Pending -> Finalize lock and
// recheck of the battlefield Unit target -> Resolve damage -> create/play Gold
// -> the Gold's own Play enters the real Chain -> Finalize -> Resolve at Base.
// These tests inspect declarations and outcomes across those production steps.
import assert from 'node:assert/strict';
import test from 'node:test';

import gold from '../../../card-dsl/dist/cards/sfd/gold.js';
import wagesOfPain from '../../../card-dsl/dist/cards/sfd/wages-of-pain.js';
import { world } from '../../dist/effects/testing/test-kernel.js';
import { bindResolveContext, createActionPipelineHost } from '../../dist/events/action-adapter.js';
import { createProgramBinding } from '../../dist/programs/index.js';
import { withHiddenSource } from '../../dist/programs/play.js';
import { TurnFlow } from '../../dist/turn/flow.js';
import { createHiddenState } from '../../dist/zones/hidden/index.js';

const SOURCE_ID = 'synthetic:RIFT-1007:hidden-wages';
const CARD_OBJECT_ID = 'hidden-wages';
const GOLD_ID = gold.canonicalCardId;
const constant = value => ({ kind: 'constant', value });
const field = id => ({ type: 'battlefield', id });
const base = player => ({ type: 'base', player });

// Only admission metadata and the synthetic identity change. Both instructions
// retain Wages of Pain's shipped play body exactly.
const originalPlay = wagesOfPain.abilities.find(ability => ability.kind === 'play');
assert.ok(originalPlay?.kind === 'play');
const playBody = originalPlay.body;
const sourceProgram = {
  ...wagesOfPain,
  canonicalCardId: SOURCE_ID,
  status: 'executable',
  judgeReason: undefined,
  abilities: wagesOfPain.abilities.map(ability => ability === originalPlay ? { ...ability, body: playBody } : ability),
};

function setup({ extraInstructions = [] } = {}) {
  const kernel = world().player('A', { energy: 10 }).player('B')
    .deck(['a1', 'a2', 'a3', 'a4', 'a5'], { owner: 'A' })
    .deck(['b1', 'b2', 'b3', 'b4', 'b5'], { owner: 'B' })
    .card('bf1', { zone: 'board', owner: 'A', controller: 'A', types: ['battlefield'],
      location: null, might: null, energy: null, power: null })
    .card('bf2', { zone: 'board', owner: 'B', controller: null, types: ['battlefield'],
      location: null, might: null, energy: null, power: null })
    .hand(CARD_OBJECT_ID, { cardId: SOURCE_ID, owner: 'A', controller: 'A', types: ['spell'],
      energy: 3, power: [], might: null })
    .unit('target', { owner: 'A', controller: 'A', might: 4, location: field('bf1'),
      energy: null, power: null })
    .build();
  const choices = [];
  const choose = request => {
    choices.push(structuredClone(request));
    if (request.type === 'select-objects' && request.min === request.max) {
      const wanted = request.options.find(option => option.id === 'target');
      if (wanted !== undefined) return [wanted];
      if (request.options.length === request.min) return [...request.options];
    }
    throw new Error(`Unexpected production choice: ${request.id}`);
  };
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: saved => { kernel.restore(saved.state); kernel.copyLinkedFrom(saved.links); },
    objects: () => kernel.objects,
    perform: action => kernel.perform(action),
    performContract: action => kernel.performContract(action),
    performBatchLeaf: (action, id) => kernel.performBatchLeafForCapability(action, id),
    choose,
    context: (source, controller, timingPoint) => bindResolveContext(kernel, {
      source, controller, timingPoint, choose,
    }),
    testTrigger: registration => kernel.test(registration.spec.condition),
  });
  const playAbility = sourceProgram.abilities.find(ability => ability.kind === 'play');
  assert.ok(playAbility);
  const program = { ...sourceProgram, abilities: sourceProgram.abilities.map(ability => ability === playAbility
    ? { ...ability, body: [...ability.body, ...extraInstructions] }
    : ability) };
  const binding = createProgramBinding({ cardPrograms: [program, gold] });
  const flow = new TurnFlow({
    host: { ...host, player: id => kernel.player(id) },
    player: id => kernel.player(id),
    turnOrder: ['A', 'B'],
    battlefields: [{ id: 'bf1', controller: 'A' }, { id: 'bf2', controller: null }],
    victoryScore: 20,
    describePlay: binding.describePlay,
    hiddenState: createHiddenState([
      { battlefieldId: 'bf1', controller: 'A' }, { battlefieldId: 'bf2', controller: null },
    ], 0),
  });
  binding.attachLifecycle(flow.chain, error => { throw error; });
  flow.start();
  for (let count = 0; flow.phase !== 'main'; count++) {
    assert.ok(count < 100, 'setup reaches Main');
    flow.advance();
  }
  for (let count = 0; flow.turnPlayer !== 'A'; count++) {
    assert.ok(count < 10, 'setup reaches player A');
    const holder = flow.chain.priority;
    if (holder !== null) flow.pass(holder); else flow.advance();
  }
  assert.equal(flow.chain.commit({ type: 'gain-power', player: 'A', power: ['universal'] }).status, 'done');
  return { binding, choices, flow, kernel };
}

function hideThenReachNextTurn(f) {
  f.flow.hide({ type: 'hide', object: f.kernel.ref(CARD_OBJECT_ID), player: 'A', location: field('bf1') });
  const hiddenTurn = f.flow.chain.pipeline.clock.turn;
  f.flow.pass('A');
  f.flow.pass('B');
  assert.ok(f.flow.chain.pipeline.clock.turn > hiddenTurn);
  assert.equal(f.flow.turnPlayer, 'A');
}

function draftForHidden(f) {
  const concealed = f.flow.objects().find(object => object.ref.id === CARD_OBJECT_ID);
  assert.ok(concealed?.faceDown);
  const source = f.kernel.getObject(concealed.ref.id);
  assert.ok(source);
  return withHiddenSource(f.flow, () => f.binding.describePlay(
    { type: 'play', player: 'A', object: concealed.ref, location: field('bf1') }, source));
}

function settle(f) {
  for (let guard = 0; guard < 200; guard++) {
    if (f.flow.chain.items.length) {
      if (f.flow.chain.items.some(item => item.status === 'pending')) {
        f.flow.advance();
        continue;
      }
      const holder = f.flow.chain.priority;
      assert.ok(holder, 'a finalized Chain has a Priority holder');
      f.flow.pass(holder);
      continue;
    }
    if (f.flow.chain.focus !== null) { f.flow.pass(f.flow.chain.focus); continue; }
    if (f.flow.chain.priority !== null) return;
    if (f.flow.combat.active) { f.flow.advance(); continue; }
    return;
  }
  throw new Error('RIFT-1007 production Chain did not settle');
}

function assertGoldAtControllerBase(f) {
  const tokens = f.kernel.objects.filter(object => object.zone === 'board' && object.isToken && object.cardId === GOLD_ID);
  assert.equal(tokens.length, 1, 'Wages of Pain played exactly one Gold token');
  assert.deepEqual(tokens[0].location, base('A'), 'CR 811.2 + 359.2.d preserve the Gold destination');
  assert.equal(tokens[0].energy, null, 'the token has no printed Energy');
  assert.equal(tokens[0].power, null, 'the token has no printed Power');
  return tokens[0];
}

test('RIFT-1007 Hidden Wages plays Gold at Base while target and Unit-token scope stay bounded by the battlefield', () => {
  const f = setup();
  hideThenReachNextTurn(f);
  const declared = draftForHidden(f);
  assert.equal(declared.kind, 'spell');
  assert.equal(declared.speed, 'reaction');
  assert.deepEqual(declared.targets?.map(target => target.requirement.filter.location), [field('bf1')]);
  const instruction = declared.body.find(candidate => candidate.id === 'play-gold-token');
  assert.ok(instruction);
  assert.deepEqual(instruction.args.location, constant(base('controller')));
  assert.deepEqual(instruction.args.entersExhausted, constant(true));

  f.flow.execute(declared);
  const pending = f.flow.chain.items[0];
  assert.ok(pending);
  assert.match(pending.status, /^(pending|finalized)$/,
    'the spell reached the real Chain and either waits for Priority or has already finalized');
  assert.equal(pending.controller, 'A');
  assert.equal(pending.kind, 'spell');
  assert.equal(f.kernel.getObject(CARD_OBJECT_ID).zone, 'chain');
  assert.equal(f.flow.hidden().zones.bf1.cards.length, 0);
  settle(f);

  assert.equal(f.kernel.getObject(CARD_OBJECT_ID).zone, 'trash');
  assert.equal(f.kernel.getObject('target').damage, 3);
  const playedGold = assertGoldAtControllerBase(f);
  assert.deepEqual(f.choices.filter(request => request.id === 'target:damaged-unit').map(request => request.options.map(option => option.id)),
    [['target']]);
  const trace = f.flow.chain.trace;
  const chainTrace = trace.filter(entry => entry.item?.startsWith(`play:${CARD_OBJECT_ID}:`) ||
    entry.item === declared.id);
  assert.ok(chainTrace.some(entry => entry.step === 'pending'), 'the Hidden spell entered the real Chain');
  assert.ok(chainTrace.some(entry => entry.step === 'finalized'), 'the spell locked its target and finalized');
  assert.ok(chainTrace.some(entry => entry.step === 'resolved'), 'Priority passing resolved the spell');
  assert.ok(trace.some(entry => entry.step === 'resolved' && entry.item?.startsWith(`play:${playedGold.ref.id}:`)),
    'Gold entered the real Chain as its own Permanent Play');
});

test('RIFT-1007 a Hidden played Unit token remains restricted to the source Battlefield', () => {
  const extraInstructions = [{
    id: 'rift-1007-unit-token',
    op: 'effect.token',
    args: {
      token: constant('recruit'),
      mode: constant('play'),
      locations: constant([field('bf1'), field('bf2')]),
      choiceId: constant('rift-1007-unit-token-location'),
    },
  }];
  const f = setup({ extraInstructions });
  hideThenReachNextTurn(f);
  const declared = draftForHidden(f);
  const instruction = declared.body.find(candidate => candidate.id === 'rift-1007-unit-token');
  assert.ok(instruction);
  assert.deepEqual(instruction.args.location, constant(field('bf1')), 'CR 811.1.d.5 forces the Unit token to the Hidden Battlefield');
  assert.equal(Object.hasOwn(instruction.args, 'locations'), false);

  f.flow.execute(declared);
  settle(f);
  assert.equal(f.kernel.getObject('target').damage, 3);
  assertGoldAtControllerBase(f);
  const recruits = f.kernel.objects.filter(object => object.zone === 'board' && object.isToken && object.name === 'Recruit');
  assert.equal(recruits.length, 1);
  assert.deepEqual(recruits[0].location, field('bf1'));
  assert.equal(recruits[0].exhausted, true);
});

test('RIFT-1007 creating a non-Play Gold during Hidden resolution follows the original Base instruction', () => {
  const extraInstructions = [{
    id: 'rift-1007-create-gold',
    op: 'effect.token',
    args: {
      token: constant('gold'),
      mode: constant('create'),
      location: constant(base('controller')),
    },
  }];
  const f = setup({ extraInstructions });
  hideThenReachNextTurn(f);
  const declared = draftForHidden(f);
  const instruction = declared.body.find(candidate => candidate.id === 'rift-1007-create-gold');
  assert.ok(instruction);
  assert.deepEqual(instruction.args.location, constant(base('controller')),
    'CR 811.1.d.5 does not apply to token creation that is not a Unit Play');
  f.flow.execute(declared);
  settle(f);
  assert.equal(f.kernel.getObject('target').damage, 3);
  const golds = f.kernel.objects.filter(object => object.zone === 'board' && object.isToken && object.cardId === GOLD_ID);
  assert.equal(golds.length, 2);
  assert.ok(golds.every(token => JSON.stringify(token.location) === JSON.stringify(base('A'))));
});

test('RIFT-1007 effect Play rewrites a Unit selection but preserves a Gear destination', () => {
  const unitPlay = {
    id: 'rift-1007-effect-play-unit',
    op: 'effect.play',
    args: {
      pick: constant('rift-1007-unit-pick'),
      location: constant(field('bf2')),
      cost: constant({ finalized: true, energy: 0, power: [] }),
    },
    picks: [{ id: 'rift-1007-unit-pick', options: ['dynamic:unit'], filter: { type: 'unit', zone: 'hand' }, min: 1, max: 1 }],
  };
  const gearPlay = {
    id: 'rift-1007-effect-play-gear',
    op: 'effect.play',
    args: {
      pick: constant('rift-1007-gear-pick'),
      location: constant(base('A')),
      cost: constant({ finalized: true, energy: 0, power: [] }),
    },
    picks: [{ id: 'rift-1007-gear-pick', options: ['dynamic:gear'], filter: { type: 'gear', zone: 'hand' }, min: 1, max: 1 }],
  };
  const f = setup({ extraInstructions: [unitPlay, gearPlay] });
  hideThenReachNextTurn(f);
  const declared = draftForHidden(f);
  const unit = declared.body.find(instruction => instruction.id === unitPlay.id);
  const gear = declared.body.find(instruction => instruction.id === gearPlay.id);
  assert.ok(unit);
  assert.ok(gear);
  assert.deepEqual(unit.args.location, constant(field('bf1')),
    'CR 811.1.d.5 applies to a Unit selected by effect.play');
  assert.deepEqual(gear.args.location, constant(base('A')),
    'CR 811.2 preserves a Gear effect Play destination');
});

test('RIFT-1007 effect Play fails closed when its selected object type is not statically known', () => {
  const unresolved = {
    id: 'rift-1007-effect-play-unresolved',
    op: 'effect.play',
    args: { pick: constant('rift-1007-unresolved-pick'), location: constant(base('A')) },
    picks: [{ id: 'rift-1007-unresolved-pick', options: ['dynamic:card'], filter: { zone: 'hand' }, min: 1, max: 1 }],
  };
  const f = setup({ extraInstructions: [unresolved] });
  hideThenReachNextTurn(f);
  assert.throws(() => draftForHidden(f), error => error?.name === 'ProgramBindingError' &&
    error.code === 'judge-required' && /does not identify a Unit/.test(error.message));
});

test('RIFT-1007 an unadjudicated Play token fails closed before Hidden mutation', () => {
  const unknown = {
    id: 'rift-1007-unknown-token',
    op: 'effect.token',
    args: {
      token: constant('unadjudicated-token'),
      mode: constant('play'),
      location: constant(base('controller')),
    },
  };
  const f = setup({ extraInstructions: [unknown] });
  hideThenReachNextTurn(f);
  assert.throws(() => draftForHidden(f), error => error?.name === 'ProgramBindingError' &&
    error.code === 'judge-required' && /no adjudicated definition/.test(error.message));
  assert.equal(f.flow.hidden().zones.bf1.cards.length, 1);
});
