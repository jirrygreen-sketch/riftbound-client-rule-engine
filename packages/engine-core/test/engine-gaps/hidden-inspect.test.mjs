// RIFT-1120 production coverage for the S7 Hidden/Facedown, permission and
// private-disclosure boundary.
//
// Official rules: Riftbound Core Rules v1.5, published 2026-10-09,
// effective 2026-10-16 under the Radiance policy,
// https://cmsassets.rgpub.io/sanity/files/dsfx7636/news_live/5c7946f7c3b8c6e0faff85ab6dadc6d2e721ea94.pdf
// Local verified copy: /root/swarm-rift/shared/rules/CR-v1.5.txt.
// Timeline exercised below:
// - Hide (CR 422, 811.1.b-c, 124.1): a Hand card pays its Hide cost and enters
//   a battlefield Facedown Zone without opening a Chain. Its new incarnation
//   never retains Temporary Modifications from the Hand object. Capacity is
//   read from the zone's controlling Battlefield at that action; the second
//   Hide succeeds on Bandle Tree and a third is rejected before payment.
// - Finalize (CR 337, 355.2.b): the structured play-location predicate is
//   re-read against the current destination, and the card's own consistently
//   matched permission remains bound after its Hand -> Chain incarnation.
// - Reveal/Resolve (CR 420.3, 425.1-a.2-.3): an effect Play goes through
//   ordinary Finalize and Resolve; Reveal remains in its current zone and is
//   public only through the reveal grant for that resolution.
// - Cleanup (CR 107.3.b.1-.2, 107.3.d): control loss and insufficient capacity
//   are settled through the Hidden sidecar before another Hide is accepted.
// Canonical cards use the local deck-catalog data and shipped programs:
// - ogn-193-298 Miss Fortune, Buccaneer.
// - ogn-278-298 Bandle Tree.
// - sfd-122-221 Called Shot (private ordered look golden only; its Repeat cost
//   remains judge-required and is never converted to a free play).
import assert from 'node:assert/strict';
import test from 'node:test';

import bandleTree from '../../../card-dsl/dist/cards/ogn/bandle-tree.js';
import calledShot from '../../../card-dsl/dist/cards/sfd/called-shot.js';
import missFortune from '../../../card-dsl/dist/cards/ogn/miss-fortune-buccaneer.js';
import { AwaitChoice } from '../../dist/effects/contract.js';
import { world } from '../../dist/effects/testing/test-kernel.js';
import { bindResolveContext, createActionPipelineHost } from '../../dist/events/action-adapter.js';
import { ChainEngine } from '../../dist/chain/engine.js';
import { projectFor } from '../../dist/projection/v2/index.js';
import { createProgramBinding } from '../../dist/programs/index.js';
import { createEngineStaticBinder } from '../../dist/programs/statics.js';
import { TurnFlow } from '../../dist/turn/flow.js';
import {
  createHiddenState,
  hiddenCapacityFor,
  hideCard,
} from '../../dist/zones/hidden/index.js';
import { createFacedownZone, facedownCapacity } from '../../dist/zones/facedown/index.js';
import { playPermissions } from '../../dist/programs/play-permissions.js';

const field = id => ({ type: 'battlefield', id });
function runtime({ programs = [], builder, choose, battlefields = [] } = {}) {
  const kernel = (builder ?? world().player('A', { energy: 10 }).player('B'))().build();
  const requests = [];
  const decide = request => {
    requests.push(structuredClone(request));
    const explicit = choose?.(request);
    if (explicit !== undefined) return structuredClone(explicit);
    if (request.type === 'select-objects' && request.min === request.max && request.options.length === request.min) {
      return [...request.options];
    }
    if (request.type === 'select-objects' && request.min === 0) return [];
    throw new AwaitChoice(request);
  };
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: saved => { kernel.restore(saved.state); kernel.copyLinkedFrom(saved.links); },
    objects: () => kernel.objects,
    perform: action => kernel.perform(action),
    performContract: action => kernel.performContract(action),
    performBatchLeaf: (action, id) => kernel.performBatchLeafForCapability(action, id),
    choose: decide,
    context: (source, controller, timingPoint) => bindResolveContext(kernel, {
      source, controller, timingPoint, choose: decide,
    }),
    testTrigger: registration => kernel.test(registration.spec.condition),
  });
  const binding = createProgramBinding({ cardPrograms: programs });
  const engine = new ChainEngine({
    turnOrder: ['A', 'B'], turnPlayer: 'A', phase: 'main', host,
    cleanup: () => false, describePlay: binding.describePlay,
  });
  if (battlefields.length > 0) engine.initializeBattlefieldControl(battlefields);
  binding.attachLifecycle(engine, error => { throw error; });
  return { kernel, host, binding, engine, requests };
}

function settle(engine) {
  for (let guard = 0; engine.items.length; guard++) {
    assert.ok(guard < 30, 'Chain must settle');
    if (engine.items.some(item => item.status === 'pending')) {
      engine.advance();
      continue;
    }
    assert.ok(engine.priority, 'a finalized Chain item must have Priority');
    engine.pass(engine.priority);
  }
}

test('Bandle Tree production restrict raises the current Battlefield Facedown cap only', () => {
  const canonical = 'card.hash-5440d378426747276f389ce3e9731d1378a3a303a7309d785ef183114d2c326c';
  const f = runtime({
    builder: () => world().player('A').player('B')
      .card('tree', { cardId: canonical, zone: 'board', owner: 'A', controller: 'A', types: ['battlefield'], location: field('tree') })
      .card('other', { zone: 'board', owner: 'A', controller: 'A', types: ['battlefield'], location: field('other') })
      .hand('first-hidden', { owner: 'A', controller: 'A', types: ['spell'], keywords: [{ id: 'Hidden' }] })
      .hand('second-hidden', { owner: 'A', controller: 'A', types: ['spell'], keywords: [{ id: 'Hidden' }] }),
  });
  const tree = f.kernel.getObject('tree');
  const handle = createEngineStaticBinder(f.engine).bindStatic(bandleTree.abilities[0], tree);

  assert.equal(facedownCapacity(createFacedownZone('tree'), tree, f.engine.layers.registry), 2);
  assert.equal(facedownCapacity(createFacedownZone('other'), f.kernel.getObject('other'), f.engine.layers.registry), 1);
  let state = createHiddenState([{ battlefieldId: 'tree', controller: 'A' }, { battlefieldId: 'other', controller: 'A' }], 2);
  assert.equal(hiddenCapacityFor(state.zones.tree, { battlefield: tree, registry: f.engine.layers.registry }), 2);
  assert.equal(hiddenCapacityFor(state.zones.other, { battlefield: f.kernel.getObject('other'), registry: f.engine.layers.registry }), 1);
  state = hideCard(state, {
    card: f.kernel.getObject('first-hidden'), player: 'A', battlefieldId: 'tree', openState: true,
    capacityRuleSource: { battlefield: tree, registry: f.engine.layers.registry },
  }).state;
  state = hideCard(state, {
    card: f.kernel.getObject('second-hidden'), player: 'A', battlefieldId: 'tree', openState: true,
    capacityRuleSource: { battlefield: tree, registry: f.engine.layers.registry },
  }).state;
  assert.equal(state.zones.tree.cards.length, 2);

  handle.unbind();
  assert.equal(facedownCapacity(createFacedownZone('tree'), tree, f.engine.layers.registry), 1);
});

test('a production play-location permission revalidates the final destination after Hand -> Chain', () => {
  const admitted = { ...missFortune, status: 'executable', judgeReason: undefined };
  const f = runtime({
    programs: [admitted],
    builder: () => world().player('A', { energy: 10 }).player('B')
      .hand('buccaneer', { cardId: admitted.canonicalCardId, owner: 'A', controller: 'A', types: ['unit'], energy: 4, power: [] })
      .card('open', { zone: 'board', owner: 'A', controller: null, types: ['battlefield'], location: field('open') })
      .card('occupied', { zone: 'board', owner: 'B', controller: 'B', types: ['battlefield'], location: field('occupied') })
    .unit('enemy', { owner: 'B', controller: 'B', types: ['unit'], location: field('occupied'), might: 2 }),
    battlefields: [{ id: 'open', controller: null }, { id: 'occupied', controller: 'B' }],
  });
  const source = f.kernel.getObject('buccaneer');
  const draft = f.binding.describePlay({
    type: 'play', player: 'A', object: source.ref,
    location: field('open'),
  }, source);

  f.engine.execute(draft);
  assert.equal(f.engine.items.length, 0, 'the production Chain Finalizes and immediately Resolves a Unit');
  assert.ok(f.engine.trace.some(entry => entry.step === 'finalize-start'));
  assert.ok(f.engine.trace.some(entry => entry.step === 'resolved'));
  assert.equal(f.kernel.getObject('buccaneer').zone, 'board');
  assert.deepEqual(f.kernel.getObject('buccaneer').location, field('open'));

  const onBoard = f.kernel.getObject('buccaneer');
  const permissions = playPermissions(f.engine.layers.registry, onBoard);
  assert.equal(permissions.length, 2, 'self and friendly-unit destination grants remain distinct');
  assert.equal(permissions.every(permission => permission.location?.occupied === false &&
    permission.location.controlled === false && permission.location.type === 'battlefield'), true);
  assert.equal(permissions.every(permission => permission.objectRefs.length === 1 &&
    permission.objectRefs[0].id === onBoard.ref.id &&
    permission.objectRefs[0].zoneEntryId === onBoard.ref.zoneEntryId), true,
  'both live grants bind the current Chain/Board incarnation');

  const rejected = runtime({
    programs: [admitted],
    builder: () => world().player('A', { energy: 10 }).player('B')
      .hand('buccaneer', { cardId: admitted.canonicalCardId, owner: 'A', controller: 'A', types: ['unit'], energy: 4, power: [] })
      .card('occupied', { zone: 'board', owner: 'B', controller: 'B', types: ['battlefield'], location: field('occupied') })
      .unit('enemy', { owner: 'B', controller: 'B', types: ['unit'], location: field('occupied'), might: 2 }),
    battlefields: [{ id: 'occupied', controller: 'B' }],
  });
  const rejectedSource = rejected.kernel.getObject('buccaneer');
  const illegal = rejected.binding.describePlay({
    type: 'play', player: 'A', object: rejectedSource.ref, location: field('occupied'),
  }, rejectedSource);
  const before = rejected.kernel.snapshot();
  assert.throws(() => rejected.engine.execute(illegal), /legally allowed|Finalize|destination/i);
  assert.deepEqual(rejected.kernel.snapshot(), before);
  assert.equal(rejected.kernel.getObject('buccaneer').zone, 'hand');
});

test('Hide uses the production Facedown cap and updates the current incarnation after a real zone move', () => {
  const canonical = bandleTree.canonicalCardId;
  const program = {
    canonicalCardId: 'synthetic:rift-1120-hidden', rulesetVersion: 'core-1.5', status: 'executable',
    sourceText: '[Hidden]', abilities: [{ kind: 'keyword', keyword: 'hidden' }],
  };
  const kernel = world().player('A', { power: ['Mind'] }).player('B')
    .deck(['a1', 'a2', 'a3', 'a4'], { owner: 'A' })
    .deck(['b1', 'b2', 'b3', 'b4'], { owner: 'B' })
    .card('tree', { cardId: canonical, zone: 'board', owner: 'A', controller: 'A', isToken: true, types: ['battlefield'], location: field('tree') })
    .card('other', { zone: 'board', owner: 'A', controller: 'A', types: ['battlefield'], location: field('other') })
    .hand('first', { cardId: program.canonicalCardId, owner: 'A', controller: 'A', types: ['spell'], keywords: [{ id: 'Hidden' }], energy: null, power: null })
    .hand('second', { cardId: program.canonicalCardId, owner: 'A', controller: 'A', types: ['spell'], keywords: [{ id: 'Hidden' }], energy: null, power: null })
    .hand('third', { cardId: program.canonicalCardId, owner: 'A', controller: 'A', types: ['spell'], keywords: [{ id: 'Hidden' }], energy: null, power: null })
    .build();
  const capacityReads = [];
  const choose = request => {
    if (request.type === 'select-objects' && request.options.length) return [request.options[0]];
    throw new AwaitChoice(request);
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
  const binding = createProgramBinding({ cardPrograms: [
    { ...bandleTree, status: 'executable', judgeReason: undefined }, program,
  ] });
  const flow = new TurnFlow({
    host: { ...host, player: id => kernel.player(id) },
    player: id => kernel.player(id), turnOrder: ['A', 'B'],
    battlefields: [{ id: 'tree', controller: 'A' }, { id: 'other', controller: 'A' }],
    victoryScore: 20, describePlay: binding.describePlay,
    facedownCapacity: id => {
      const battlefield = kernel.getObject(id);
      const capacity = hiddenCapacityFor(createHiddenState([{ battlefieldId: id, controller: 'A' }], flow.chain.pipeline.clock.turn).zones[id], {
        battlefield: { ...battlefield, types: ['battlefield'] },
        registry: flow.chain.layers.registry,
      });
      capacityReads.push({ id, capacity });
      return capacity;
    },
  });
  binding.attachLifecycle(flow.chain, error => { throw error; });
  flow.start();
  for (let guard = 0; flow.phase !== 'main'; guard++) {
    assert.ok(guard < 100, 'setup reaches Main');
    flow.advance();
  }
  flow.chain.commit({ type: 'gain-power', player: 'A', power: ['Mind'] });
  const firstRef = kernel.ref('first');
  const hidden = flow.hide({ type: 'hide', object: firstRef, player: 'A', location: field('tree') });
  assert.equal(hidden.status, 'done');
  assert.equal(capacityReads.some(entry => entry.id === 'tree' && entry.capacity === 2), true,
    'attachLifecycle binds Bandle Tree before Cleanup reads the current Facedown cap');
  assert.equal(capacityReads.some(entry => entry.id === 'other' && entry.capacity === 1), true);
  assert.equal(flow.hidden().zones.tree.cards.length, 1);
  assert.notEqual(kernel.ref('first').zoneEntryId, firstRef.zoneEntryId, 'the canonical Hide zone move creates a new incarnation');
  assert.equal(flow.objects().find(object => object.ref.id === 'first')?.faceDown, true);
});

test('look and reveal retain ordered private sets and never accept an out-of-range pick', () => {
  const f = runtime({
    builder: () => world().player('A').player('B').deck(['first', 'second', 'tail'], { owner: 'A' }),
  });
  const top = f.kernel.zoneSlice('A', 'deck', 'top', 2).map(object => object.ref);
  const look = f.host.context(f.kernel.getObject('first'), 'A', 'main-start').perform({
    type: 'look', objects: top, player: 'A',
  });
  assert.equal(look.status, 'done');
  assert.deepEqual(look.result, top);
  const state = {
    players: [{
      id: 'A',
      deck: top,
    }, { id: 'B' }],
    objects: f.kernel.objects,
    visibility: [{ kind: 'look', player: 'A', objects: top }],
  };
  const owner = projectFor(state, 'A');
  const opponent = projectFor(state, 'B');
  assert.deepEqual(owner.objects.filter(object => object.zone === 'deck' && object.visibility === 'identity')
    .map(object => object.id), top.map(ref => ref.id));
  assert.equal(opponent.objects.some(object => top.some(ref => ref.id === object.id)), false);
  assert.equal(opponent.objects.some(object => top.some(ref => ref.id === object.cardId)), false);

  const reveal = f.host.context(f.kernel.getObject('first'), 'A', 'main-start').perform({ type: 'reveal', object: top[0] });
  assert.equal(reveal.status, 'done');
  assert.deepEqual(reveal.result, [top[0]]);
  assert.equal(f.kernel.getObject('first').zone, 'deck', 'Reveal is not a zone change (425.1.a.2)');
});

test('the production Called Shot look body links the exact ordered top-two set only on Resolve', () => {
  const admitted = { ...calledShot, status: 'executable', judgeReason: undefined };
  // Its Repeat cost remains unsupported. This test supplies the explicit
  // decline through the real Finalize choice instead of turning that choice
  // into a free spell; the body remains the shipped Called Shot body.
  const f = runtime({
    programs: [admitted],
    builder: () => world().player('A', { energy: 10, power: ['Chaos'] }).player('B')
      .deck(['top-a', 'top-b', 'tail'], { owner: 'A' })
      .hand('shot', { cardId: admitted.canonicalCardId, owner: 'A', controller: 'A', types: ['spell'], energy: 0, power: ['Chaos'] }),
    choose: request => request.type === 'optional' ? false :
      request.id === 'called-shot.look-top-two/called-shot.draw-choice' ? [request.options[0]] :
      request.type === 'select-objects' ? [request.options[0]] : undefined,
  });
  const source = f.kernel.getObject('shot');
  const draft = f.binding.describePlay({ type: 'play', player: 'A', object: source.ref }, source);
  f.engine.execute(draft);
  const locked = f.engine.items[0].pickPlans?.[0]?.refs;
  assert.deepEqual(locked?.map(ref => ref.id), ['top-a', 'top-b']);
  settle(f.engine);
  assert.deepEqual(f.kernel.linked('called-shot.look-top-two.looked'), locked);
  assert.equal(f.requests.some(request => request.id === 'called-shot.look-top-two/called-shot.draw-choice'), true);
});

test('Called Shot rejects a pick outside the locked top two and commits nothing', () => {
  const admitted = { ...calledShot, status: 'executable', judgeReason: undefined };
  let outside;
  const f = runtime({
    programs: [admitted],
    builder: () => world().player('A', { energy: 10, power: ['Chaos'] }).player('B')
      .deck(['top-a', 'top-b', 'outside'], { owner: 'A' })
      .hand('shot', { cardId: admitted.canonicalCardId, owner: 'A', controller: 'A', types: ['spell'], energy: 0, power: ['Chaos'] }),
    choose: request => request.type === 'optional' ? false :
      request.id === 'called-shot.look-top-two/called-shot.draw-choice' ? [outside] : undefined,
  });
  outside = f.kernel.ref('outside');
  const before = f.kernel.stateForTest();
  const source = f.kernel.getObject('shot');
  f.engine.execute(f.binding.describePlay({ type: 'play', player: 'A', object: source.ref }, source));
  assert.throws(() => settle(f.engine), /invalid choice answer/);
  const after = f.kernel.stateForTest();
  const beforeIds = new Set(before.players[0].zones.hand);
  const afterIds = new Set(after.players[0].zones.chain);
  assert.equal([...beforeIds].every(id => afterIds.has(id)), true, 'the selected card retains its logical identity on Chain');
  assert.equal(after.players[0].zones.deck.includes('outside'), true);
  assert.equal(f.kernel.getObject('shot').zone, 'chain');
  assert.equal(f.kernel.linked('called-shot.look-top-two.looked'), undefined);
});
