// RIFT-1034 regression: Hidden's next-turn Reaction must remain bound after a
// facedown lifecycle rebind.
//
// Official evidence: Core Rules v1.5 (2026-10-09), effective under the
// Radiance patch (2026-10-16):
// https://cmsassets.rgpub.io/sanity/files/dsfx7636/news_live/5c7946f7c3b8c6e0faff85ab6dadc6d2e721ea94.pdf
// https://playriftbound.com/en-us/news/announcements/core-rules-radiance-patch-notes-effective-october-16-2026/
// - 811.1.b-c: Hide pays [A] and is not a Play; playing from facedown opens a
//   Chain.
// - 811.6: from the next turn, a Hidden card gains Reaction.
// - 813.1.b-c.1-.2: Reaction grants card Play and Activated Ability permission
//   during Closed States on any player's turn.
// - 813.2: Reaction also preserves normal/Showdown timing.
// Canonical card: ogn-083-298 Consult the Past
// (card.hash-2ebf1fe6e5ed7bb875f1c112b3e0ed1635b557c0c0ad550d752b8dd376243007).
//
// Timeline: A Hide pays [A] and moves the private facedown card -> turn passes
// to B -> B plays Void Seeker into Closed State -> A plays the facedown card at
// Reaction speed -> its draw instruction resolves. The production lifecycle's
// static binding/rebind path throws into the test if it reports an error.
import assert from 'node:assert/strict';
import test from 'node:test';

import consultThePast from '../../../card-dsl/dist/cards/ogn/consult-the-past.js';
import voidSeeker from '../../../card-dsl/dist/cards/ogn/void-seeker.js';
import { world } from '../../dist/effects/testing/test-kernel.js';
import { bindResolveContext, createActionPipelineHost } from '../../dist/events/action-adapter.js';
import { actionTimings } from '../../dist/layers/rules/query.js';
import { createProgramBinding } from '../../dist/programs/index.js';
import { withHiddenSource } from '../../dist/programs/play.js';
import { bindStaticAbility, createEngineStaticBinder } from '../../dist/programs/statics.js';
import { TurnFlow } from '../../dist/turn/flow.js';
import { createHiddenState } from '../../dist/zones/hidden/index.js';

const CONSULT = consultThePast.canonicalCardId;
const VOID_SEEKER = voidSeeker.canonicalCardId;
const field = id => ({ type: 'battlefield', id });

function setup() {
  const kernel = world()
    .player('A', { energy: 4 })
    .player('B', { energy: 3, power: ['Fury'] })
    .deck(['a1', 'a2', 'a3', 'a4'], { owner: 'A' })
    .deck(['b1', 'b2', 'b3'], { owner: 'B' })
    .rune(['a-rune'], { owner: 'A' })
    .rune(['b-rune'], { owner: 'B' })
    .card('bf1', {
      zone: 'board', owner: 'A', controller: 'A', types: ['battlefield'],
      location: field('bf1'), might: null, energy: null, power: null,
    })
    .card('bf2', {
      zone: 'board', owner: 'B', controller: null, types: ['battlefield'],
      location: field('bf2'), might: null, energy: null, power: null,
    })
    .hand('consult', {
      cardId: CONSULT, owner: 'A', controller: 'A', types: ['spell'],
      energy: 4, power: null, might: null,
    })
    .hand('seeker', {
      cardId: VOID_SEEKER, owner: 'B', controller: 'B', types: ['spell'],
      energy: 3, power: ['Fury'], might: null,
    })
    .unit('target', { owner: 'A', controller: 'A', might: 5, location: field('bf1') })
    .build();
  const requests = [];
  const choose = request => {
    requests.push(structuredClone(request));
    if (request.type === 'select-objects' && request.min === request.max) {
      if (request.options.some(option => option.id === 'target')) {
        return [request.options.find(option => option.id === 'target')];
      }
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
  const binding = createProgramBinding({ cardPrograms: [consultThePast, voidSeeker] });
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
  for (let guard = 0; flow.phase !== 'main'; guard++) {
    assert.ok(guard < 100, 'setup reaches Main');
    flow.advance();
  }
  assert.equal(flow.turnPlayer, 'A');
  assert.equal(flow.chain.commit({ type: 'gain-power', player: 'A', power: ['universal'] }).status, 'done');
  return { kernel, binding, flow, requests };
}

function settle(f) {
  for (let guard = 0; guard < 200; guard++) {
    if (f.flow.chain.items.length) {
      if (f.flow.chain.items.some(item => item.status === 'pending')) {
        f.flow.advance();
        continue;
      }
      const holder = f.flow.chain.priority;
      assert.ok(holder, 'a finalized Chain item has Priority');
      f.flow.pass(holder);
      continue;
    }
    if (f.flow.chain.focus !== null) { f.flow.pass(f.flow.chain.focus); continue; }
    if (f.flow.chain.priority !== null) return;
    if (f.flow.combat.active) { f.flow.advance(); continue; }
    return;
  }
  throw new Error('production Chain did not settle');
}

function hiddenDraft(f, player = 'A') {
  const concealed = f.flow.objects().find(object => object.ref.id === 'consult');
  assert.ok(concealed?.faceDown);
  const source = f.kernel.getObject('consult');
  return withHiddenSource(f.flow, () => f.binding.describePlay(
    { type: 'play', player, object: concealed.ref }, source,
  ));
}

function hideAndReachOpponentTurn(f) {
  const hidden = f.flow.hide({
    type: 'hide', object: f.kernel.ref('consult'), player: 'A', location: field('bf1'),
  });
  assert.equal(hidden.status, 'done');
  assert.deepEqual(f.kernel.player('A').power, [], 'Hide paid the [A] cost');
  assert.equal(f.flow.chain.items.length, 0, 'Hide did not open a Chain (811.1.c.2)');
  const hiddenTurn = f.flow.chain.pipeline.clock.turn;
  f.flow.pass('A');
  f.flow.pass('B');
  for (let guard = 0; f.flow.turnPlayer !== 'B'; guard++) {
    assert.ok(guard < 100, 'the real turn driver reaches B');
    const holder = f.flow.chain.priority;
    if (holder !== null) f.flow.pass(holder); else f.flow.advance();
  }
  assert.ok(f.flow.chain.pipeline.clock.turn > hiddenTurn);
  assert.equal(f.flow.turnPlayer, 'B');
  assert.equal(f.flow.phase, 'main');
}

function startOpponentClosedState(f) {
  f.flow.chain.commit({ type: 'gain-energy', player: 'B', amount: 3 });
  assert.equal(f.flow.chain.commit({ type: 'gain-power', player: 'B', power: ['Fury'] }).status, 'done');
  const seeker = f.binding.describePlay(
    { type: 'play', player: 'B', object: f.kernel.ref('seeker') },
    f.kernel.getObject('seeker'),
  );
  assert.equal(seeker.speed, 'action');
  f.flow.execute(seeker);
  assert.equal(f.flow.chain.turnState, 'neutral-closed');
  f.flow.pass('B');
  assert.equal(f.flow.chain.priority, 'A');
}

test('RIFT-1034 production: Hide Consult the Past then play it from facedown during B\'s Closed State', () => {
  const f = setup();
  hideAndReachOpponentTurn(f);
  startOpponentClosedState(f);

  const draft = hiddenDraft(f);
  assert.equal(draft.speed, 'reaction');
  assert.equal(f.flow.chain.canAct('A', draft.speed, draft.source.ref, draft.source), true);
  f.flow.execute(draft);
  assert.equal(f.flow.chain.items.length, 2, 'Consult and Void Seeker are both on the Chain');
  assert.equal(f.kernel.getObject('consult').zone, 'chain');
  assert.equal(f.flow.hidden().zones.bf1.cards.length, 0);
  const aHandBeforeResolve = f.kernel.zone('A', 'hand').length;
  const aDeckBeforeResolve = f.kernel.zone('A', 'deck').length;
  settle(f);

  assert.equal(f.kernel.getObject('consult').zone, 'trash');
  assert.equal(f.kernel.zone('A', 'hand').length, aHandBeforeResolve + 2,
    'Consult the Past resolved and drew two');
  assert.equal(f.kernel.zone('A', 'deck').length, aDeckBeforeResolve - 2);
  assert.equal(f.kernel.getObject('target').damage, 4, 'the opponent Action still resolved');
  assert.ok(f.flow.chain.trace.some(entry => entry.step === 'resolved' && entry.item?.startsWith('play:consult:')),
    'the facedown Play reached the production Resolve path');
  assert.equal(f.flow.chain.turnState, 'neutral-open');
});

test('RIFT-1034 printed route preserves Reaction while a card without Reaction stays normal', () => {
  const f = setup();
  const draft = f.binding.describePlay(
    { type: 'play', player: 'A', object: f.kernel.ref('consult') },
    f.kernel.getObject('consult'),
  );
  assert.equal(draft.speed, 'reaction', 'the printed [Reaction] permission remains intact');

  const withoutReaction = {
    ...consultThePast,
    canonicalCardId: 'synthetic:rift-1034-without-reaction',
    abilities: consultThePast.abilities.filter(ability =>
      ability.kind !== 'keyword' || ability.keyword.toLowerCase() !== 'reaction'),
  };
  const binding = createProgramBinding({ cardPrograms: [withoutReaction] });
  const source = { ...f.kernel.getObject('consult'), cardId: withoutReaction.canonicalCardId };
  const ordinary = binding.describePlay(
    { type: 'play', player: 'A', object: source.ref }, source,
  );
  assert.equal(ordinary.speed, 'normal');
});

test('RIFT-1034 static adapter preserves card and activated-ability Reaction scopes', () => {
  const f = setup();
  const inspect = f.binding.inspect(f.kernel.getObject('consult'));
  const timing = inspect.abilities.find(ability =>
    ability.kind === 'static' && ability.effect.kind === 'continuous.timing' &&
    Array.isArray(ability.effect.appliesTo) && ability.effect.appliesTo.includes('card'));
  assert.ok(timing);
  assert.deepEqual(timing.effect.appliesTo, ['card', 'activated-ability']);
  assert.deepEqual(timing.effect.grants, ['showdown', 'closed-state']);
  const source = f.kernel.getObject('consult');
  const handle = bindStaticAbility(createEngineStaticBinder(f.flow.chain), timing, source);
  assert.ok(actionTimings(f.flow.chain.layers.registry, source.ref, source, 'A').includes('closed-state'),
    'card Play consumes the 813.1.c.1 scope');
  assert.ok(actionTimings(f.flow.chain.layers.registry, source.ref, source, 'A', 'activate').includes('closed-state'),
    'Activated Ability interacts with the same 813.1.c.2 capability');
  handle.unbind();
  assert.deepEqual(f.requests, []);
});
