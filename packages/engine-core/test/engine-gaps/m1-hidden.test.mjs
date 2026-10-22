// RIFT-961 production Hidden slice.
// Core Rules v1.5 (published 2026-10-09, effective 2026-10-16):
// https://cmsassets.rgpub.io/sanity/files/dsfx7636/news_live/
//   5c7946f7c3b8c6e0faff85ab6dadc6d2e721ea94.pdf
// Interaction: Hide -> pay [A] -> private facedown sidecar; next turn ->
// Reaction Play -> Finalize target/token restrictions -> Chain -> Resolve.
// Clauses: 309, 422.2, 422.4, 811.1.b-.d (including .3.a/.4/.5), 811.6.
// Canonical fixture: synthetic:rift-961-hidden.
import assert from 'node:assert/strict';
import test from 'node:test';

import { world } from '../../dist/effects/testing/test-kernel.js';
import { bindResolveContext, createActionPipelineHost } from '../../dist/events/action-adapter.js';
import { projectFor } from '../../dist/projection/v2/index.js';
import { createProgramBinding } from '../../dist/programs/index.js';
import { withHiddenSource } from '../../dist/programs/play.js';
import { TurnCombatBlockedError, TurnFlow } from '../../dist/turn/flow.js';
import { createHiddenState } from '../../dist/zones/hidden/index.js';

const CARD = 'synthetic:rift-961-hidden';
const constant = value => ({ kind: 'constant', value });
const field = id => ({ type: 'battlefield', id });

function program(body = []) {
  return {
    canonicalCardId: CARD,
    rulesetVersion: 'core-1.5',
    status: 'executable',
    sourceText: '[Hidden]',
    abilities: [{ kind: 'keyword', keyword: 'hidden' }, ...(body.length ? [{ kind: 'play', body }] : [])],
  };
}

function setup({ body = [], power = ['Fury'], guard = false, remote = false } = {}) {
  let builder = world().player('A', { energy: 10 }).player('B')
    .deck(['a1', 'a2', 'a3', 'a4', 'a5'], { owner: 'A' })
    .deck(['b1', 'b2', 'b3', 'b4', 'b5'], { owner: 'B' })
    .card('bf1', { zone: 'board', owner: 'A', controller: 'A', types: ['battlefield'],
      location: field('bf1'), might: null, energy: null, power: null })
    .card('bf2', { zone: 'board', owner: 'B', controller: null, types: ['battlefield'],
      location: field('bf2'), might: null, energy: null, power: null })
    .hand('hidden', { cardId: CARD, owner: 'A', controller: 'A', types: ['spell'],
      energy: 2, power: ['Fury'], might: 2 });
  if (guard) builder = builder.unit('guard', { owner: 'A', controller: 'A', might: 1,
    keywords: guard === 'ganking' ? [{ id: 'Ganking' }] : [], location: field('bf1'), energy: null, power: null });
  if (remote) builder = builder.unit('remote', { owner: 'B', controller: 'B', might: 1,
    location: { type: 'base', player: 'B' }, energy: null, power: null });
  const kernel = builder.build();
  const choose = request => {
    if (request.type === 'select-objects' && request.options?.length) return request.options.slice(0, request.min);
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
  });
  const binding = createProgramBinding({ cardPrograms: [program(body)] });
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
  binding.attachLifecycle(flow.chain);
  flow.start();
  for (let count = 0; flow.phase !== 'main'; count++) {
    assert.ok(count < 100, 'setup must reach Main Phase');
    flow.advance();
  }
  for (let count = 0; flow.turnPlayer !== 'A'; count++) {
    assert.ok(count < 10, 'setup must reach turn player A');
    const holder = flow.chain.priority;
    if (holder !== null) flow.pass(holder); else flow.advance();
  }
  if (power.length) {
    flow.chain.commit({ type: 'gain-power', player: 'A', power });
    flow.advance();
  }
  return { kernel, flow, binding };
}

function hide(f) {
  return f.flow.hide({ type: 'hide', object: f.kernel.ref('hidden'), player: 'A', location: field('bf1') });
}

function hiddenSource(f) { return f.flow.objects().find(object => object.ref.id === 'hidden'); }

function playDraft(f, location = 'bf1') {
  const concealed = hiddenSource(f);
  assert.ok(concealed);
  const source = f.kernel.getObject(concealed.ref.id);
  assert.ok(source);
  return withHiddenSource(f.flow, () => f.binding.describePlay(
    { type: 'play', player: 'A', object: concealed.ref, location: field(location) }, source));
}

function nextTurn(f) {
  const hiddenTurn = f.flow.chain.pipeline.clock.turn;
  f.flow.pass('A');
  f.flow.pass('B');
  assert.ok(f.flow.chain.pipeline.clock.turn > hiddenTurn);
  assert.equal(f.flow.turnPlayer, 'A');
}

test('RIFT-961 Hide pays [A], records a private facedown card, and does not open a Chain', () => {
  const f = setup();
  const paid = hide(f);
  assert.equal(paid.status, 'done');
  assert.equal(paid.plan.total.power.length, 1);
  assert.equal(paid.costReceipt.paid, true);
  assert.deepEqual(f.kernel.player('A').power, []);
  assert.equal(f.flow.hidden().zones.bf1.cards.length, 1);
  assert.equal(f.flow.hidden().zones.bf1.cards[0].ref.zoneEntryId, f.kernel.ref('hidden').zoneEntryId);
  assert.equal(f.flow.chain.items.length, 0);
  assert.equal(hiddenSource(f).faceDown, true);
  assert.deepEqual(hiddenSource(f).facedownLocation, field('bf1'));
});

test('RIFT-961 Hide is accepted through the contract-action bridge', () => {
  const f = setup();
  const outcome = f.flow.chain.pipeline.commitContract({
    type: 'hide', object: f.kernel.ref('hidden'), player: 'A', location: field('bf1'),
  });
  assert.equal(outcome.status, 'done');
  assert.equal(f.flow.hidden().zones.bf1.cards.length, 1);
  assert.equal(f.flow.chain.items.length, 0);
  assert.equal(f.kernel.player('A').power.length, 0);
});

test('RIFT-961 Hide rejects a source outside Hand or the Champion Zone atomically', () => {
  const f = setup();
  const before = { kernel: f.kernel.snapshot(), hidden: f.flow.hidden(), events: f.flow.chain.pipeline.events };
  const outcome = f.flow.chain.pipeline.commitContract({
    type: 'hide', object: f.kernel.ref('bf1'), player: 'A', location: field('bf1'),
  });
  assert.notEqual(outcome.status, 'done');
  assert.deepEqual(f.kernel.snapshot(), before.kernel);
  assert.deepEqual(f.flow.hidden(), before.hidden);
  assert.deepEqual(f.flow.chain.pipeline.events, before.events);
});

test('RIFT-961 Hide rejection is atomic for timing and insufficient [A]', () => {
  const f = setup({ power: [] });
  const before = { kernel: f.kernel.snapshot(), hidden: f.flow.hidden(), events: f.flow.chain.pipeline.events };
  assert.throws(() => hide(f), error => error?.name === 'CostPlanError' && error.reason === 'cannot-pay-cost');
  assert.deepEqual(f.kernel.snapshot(), before.kernel);
  assert.deepEqual(f.flow.hidden(), before.hidden);
  assert.deepEqual(f.flow.chain.pipeline.events, before.events);

  assert.throws(() => f.flow.hide({ type: 'hide', object: f.kernel.ref('hidden'), player: 'B', location: field('bf1') }),
    error => error instanceof TurnCombatBlockedError && error.code === 'hidden-timing');
  f.flow.chain.pipeline.host.executeContract({ type: 'hide', object: f.kernel.ref('hidden'), player: 'A',
    location: { type: 'base', player: 'A' } });
});

test('RIFT-961 Hidden play waits for the next turn, then enters the real Chain as Reaction', () => {
  const f = setup({ guard: true });
  hide(f);
  assert.throws(() => f.flow.execute(playDraft(f)), error => error?.code === 'not-unlocked');
  assert.equal(f.flow.hidden().zones.bf1.cards.length, 1);
  nextTurn(f);
  const draft = playDraft(f);
  assert.equal(draft.speed, 'reaction');
  assert.equal(draft.cost.total?.energy ?? draft.cost.energy ?? 0, 0);
  f.flow.execute(draft);
  assert.equal(f.flow.chain.items.length, 1);
  assert.equal(f.flow.chain.items[0].kind, 'spell');
  assert.equal(f.flow.chain.items[0].speed, 'reaction');
  assert.equal(f.kernel.getObject('hidden').zone, 'chain');
  assert.equal(f.flow.hidden().zones.bf1.cards.length, 0);
  assert.equal(f.flow.objects().find(object => object.ref.id === 'hidden')?.faceDown, false);
});

test('RIFT-961 Hidden target and token Play locations are restricted to the source Battlefield', () => {
  const body = [{
    id: 'token', op: 'effect.token',
    args: { token: constant('recruit'), mode: constant('play'), locations: constant([field('bf1'), field('bf2')]), choiceId: constant('token-place') },
    targets: [{ id: 'enemy', filter: { type: 'unit', zone: 'board', controller: 'B' },
      location: { type: 'battlefield' }, min: 1, max: 1 }],
  }];
  const f = setup({ body, guard: true });
  hide(f);
  nextTurn(f);
  const concealed = hiddenSource(f);
  const source = f.kernel.getObject(concealed.ref.id);
  const draft = withHiddenSource(f.flow, () => f.binding.describePlay(
    { type: 'play', player: 'A', object: concealed.ref, location: field('bf1') }, source));
  assert.deepEqual(draft.targets?.map(target => target.requirement.location), [field('bf1')]);
  assert.deepEqual(draft.body[0].args.location, constant(field('bf1')));
  assert.equal(Object.hasOwn(draft.body[0].args, 'locations'), false);

  const noTarget = setup({ body, guard: true, remote: true });
  hide(noTarget);
  nextTurn(noTarget);
  const noTargetDraft = playDraft(noTarget);
  assert.throws(() => noTarget.flow.execute(noTargetDraft), error => error?.code === 'hidden-target');
  assert.equal(noTarget.flow.hidden().zones.bf1.cards.length, 1);
});

test('RIFT-961 Hidden target scope narrows a generic battlefield location filter', () => {
  const body = [{
    id: 'damage', op: 'effect.damage',
    args: { amount: constant(1), target: constant('enemy') },
    targets: [{ id: 'enemy', filter: { type: 'unit', zone: 'board', controller: 'B' },
      location: { type: 'battlefield' }, min: 1, max: 1 }],
  }];
  const f = setup({ body, guard: true, remote: true });
  hide(f);
  nextTurn(f);
  const draft = playDraft(f);
  assert.deepEqual(draft.targets?.[0]?.requirement.location, field('bf1'));
  assert.throws(() => f.flow.execute(draft), error => error?.code === 'hidden-target');
  assert.equal(f.flow.hidden().zones.bf1.cards.length, 1);
});

test('RIFT-961 Hidden target scope fails closed inside a nested choice body', () => {
  const body = [{
    id: 'choose', op: 'choice.mode',
    args: {
      count: constant(1), different: constant(false),
      modes: constant([
        { id: 'chosen', body: [{ id: 'damage', op: 'effect.damage',
          args: { amount: constant(1), target: constant('enemy') },
          targets: [{ id: 'enemy', filter: { type: 'unit', zone: 'board', controller: 'B' }, min: 1, max: 1 }] }] },
        { id: 'other', body: [] },
      ]),
    },
  }];
  const f = setup({ body, guard: true, remote: true });
  assert.throws(() => playDraft(f), error => error?.name === 'ProgramBindingError' &&
    error.code === 'judge-required' &&
    /Nested instruction targets|Mode choices require/.test(error.message));
});

test('RIFT-961 a blocked Gold token Play fails closed before any Hidden mutation', () => {
  const body = [{
    id: 'gold', op: 'effect.token',
    args: { token: constant('gold'), mode: constant('play') },
  }];
  const f = setup({ body });
  hide(f);
  assert.throws(() => playDraft(f), error => error?.name === 'ProgramBindingError' &&
    error.code === 'judge-required' && /Gold|token/.test(error.message));
});

test('RIFT-961 cleanup removes a Hidden card after real Battlefield control loss', () => {
  const f = setup({ guard: 'ganking' });
  hide(f);
  assert.equal(f.flow.hidden().zones.bf1.cards.length, 1);
  f.flow.move('A', f.kernel.ref('guard'), 'bf2');
  assert.equal(f.flow.battlefields.find(field => field.id === 'bf1')?.controller, null);
  assert.equal(f.flow.hidden().zones.bf1.cards.length, 0);
  assert.equal(f.kernel.getObject('hidden').zone, 'trash');
});


test('RIFT-961 opponent projection omits the hidden card identity', () => {
  const f = setup();
  hide(f);
  const objects = f.flow.objects().map(object => object.faceDown ?
    { ...object, id: object.ref.id, cardId: 'secret-hidden-identity', name: 'Secret Hidden Identity' } : object);
  const state = {
    players: [{ id: 'A', facedown: objects.filter(object => object.owner === 'A' && object.faceDown) }, { id: 'B' }],
    objects,
  };
  const opponent = projectFor(state, 'B');
  const serialized = JSON.stringify(opponent);
  assert.equal(serialized.includes('secret-hidden-identity'), false);
  assert.equal(serialized.includes('Secret Hidden Identity'), false);
  const face = opponent.objects.find(object => object.faceDown && object.owner === 'A');
  assert.ok(face);
  assert.equal(face.visibility, 'face-down');
  assert.equal(face.cardId, undefined);
  assert.equal(face.name, undefined);
});

test('RIFT-961 card-hidden provides the private identity only inside the authoritative event', () => {
  const f = setup();
  hide(f);
  const event = f.flow.chain.pipeline.events.find(candidate => candidate.timingPoint === 'card-hidden');
  assert.ok(event);
  assert.equal(event.object?.cardId, CARD);
  assert.equal(event.details?.battlefieldId, 'bf1');
});
