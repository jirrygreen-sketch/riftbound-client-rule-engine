// RIFT-1116 / RIFT-1111-B: S4 event producer and payload matrix.
//
// Official evidence block
// -----------------------
// Riftbound Core Rules v1.5, updated 2026-10-09:
// https://cmsassets.rgpub.io/sanity/files/dsfx7636/news_live/5c7946f7c3b8c6e0faff85ab6dadc6d2e721ea94.pdf
// Verified local copy: /root/swarm-rift/shared/rules/CR-v1.5.txt.
// - CR 053.3: "here" denotes the Battlefield related to the source.
// - CR 383.1-.4: an event satisfies a condition, then the Triggered Ability is
//   placed Pending, Finalized, and Resolved. Conquer/Hold abilities belong to
//   Units present during that real Score action; CR 383.4.c.2.c and
//   383.4.d.2.c keep those events live when the point gain is replaced.
// - CR 412.4-.5: "you" is the player responsible for the action; attribution
//   to an effect object is distinct from that responsibility.
// - CR 449.1-.2: a Move is defined by its Origin and Destination.
// - CR 466.2: Combat/Showdown identity is established by the rules process.
// - CR 470-.473: Scoring, Hold, and Conquer are events distinct from merely
//   gaining points, and happen at their real rules timings.
// Timeline: a committed GameAction is snapshotted before/after -> EventPipeline
// publishes one immutable batch -> trigger conditions run -> Pending -> Finalize
// -> Resolve. No event or state transition in these tests is hand-settled.
//
// Card text source: packages/card-data/data/deck-catalog.json (printings named
// at each test). Card metadata is lifted to executable only to drive its
// already-published IR through production; no card body or status is changed.
import assert from 'node:assert/strict';
import test from 'node:test';

import eclipseHerald from '../../../card-dsl/dist/cards/ogn/eclipse-herald.js';
import noxianDrummer from '../../../card-dsl/dist/cards/ogn/noxian-drummer.js';
import radiantDawn from '../../../card-dsl/dist/cards/ogn/radiant-dawn.js';
import treasureHunter from '../../../card-dsl/dist/cards/sfd/treasure-hunter.js';
import inviolusVox from '../../../card-dsl/dist/cards/unl/inviolus-vox.js';
import trevorSnoozebottom from '../../../card-dsl/dist/cards/unl/trevor-snoozebottom.js';
import { ChainEngine } from '../../dist/chain/engine.js';
import { AwaitChoice, requireContractActionCapability } from '../../dist/effects/contract.js';
import { world } from '../../dist/effects/testing/index.js';
import { bindResolveContext, createActionPipelineHost } from '../../dist/events/action-adapter.js';
import { matchesTriggerEvent } from '../../dist/events/pipeline-match.js';
import { canonicalEventPatternType, validateTriggerSpec } from '../../dist/events/trigger-spec.js';
import { getTimingPoint } from '../../dist/events/timing-points.js';
import { createProgramBinding } from '../../dist/programs/index.js';
import { translateTriggerFilter } from '../../dist/programs/filters.js';
import { TurnFlow } from '../../dist/turn/flow.js';

const PRINTING_BY_CANONICAL_ID = Object.freeze({
  [inviolusVox.canonicalCardId]: 'unl-027-219',
  [trevorSnoozebottom.canonicalCardId]: 'unl-048-219',
  [noxianDrummer.canonicalCardId]: 'ogn-222-298',
  [treasureHunter.canonicalCardId]: 'sfd-130-221',
  [eclipseHerald.canonicalCardId]: 'ogn-059-298',
  [radiantDawn.canonicalCardId]: 'ogn-261-298',
});

const field = id => ({ type: 'battlefield', id });
const base = player => ({ type: 'base', player });
const c = value => ({ kind: 'constant', value });
const admitted = program => ({ ...program, status: 'executable', judgeReason: undefined });

function runtime({ programs = [], setup, choose } = {}) {
  const builder = world().player('A').player('B');
  for (const player of ['A', 'B']) {
    builder.deck(Array.from({ length: 6 }, (_, index) => `${player}:deck:${index}`), { owner: player });
    builder.rune(Array.from({ length: 4 }, (_, index) => `${player}:rune:${index}`), { owner: player });
  }
  setup?.(builder);
  const kernel = builder.build();
  const asked = [];
  const decide = request => {
    asked.push(structuredClone(request));
    const answer = choose?.(request);
    if (answer !== undefined) return answer;
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
    performBatchLeaf: (action, batchId) => kernel.performBatchLeafForCapability(action, batchId),
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
  const errors = [];
  const lifecycle = binding.attachLifecycle(engine, error => errors.push(error));
  return { kernel, host, binding, engine, lifecycle, errors, asked };
}

function turnRuntime(options) {
  const r = runtime(options);
  const flow = new TurnFlow({
    host: r.host,
    player: id => r.kernel.player(id),
    turnOrder: ['A', 'B'],
    battlefields: [{ id: 'bf1', controller: 'A' }, { id: 'bf2', controller: null }],
    describePlay: r.binding.describePlay,
  });
  let lifecycle = r.binding.attachLifecycle(flow.chain, error => r.errors.push(error));
  return { ...r, flow, lifecycle };
}

function settle(engine) {
  engine.advance();
  for (let count = 0; engine.items.length > 0; count++) {
    assert.ok(count < 80, 'the production Chain must settle');
    engine.pass(engine.priority);
  }
}

function triggerIds(engine, id) {
  return engine.pipeline.registeredTriggers()
    .filter(registration => registration.source.ref.id === id)
    .map(registration => registration.id);
}

test('RIFT-1116 event matrix: canonical producers retain immutable fields and aliases', () => {
  const r = runtime({
    setup(builder) {
      builder.unit('mover', { owner: 'A', controller: 'A', zone: 'board', location: base('A'), might: 3 });
      builder.unit('victim', { owner: 'B', controller: 'B', zone: 'board', location: field('bf1'), might: 2 });
      builder.unit('stunnee', { owner: 'B', controller: 'B', zone: 'board', location: field('bf1'), might: 2 });
      builder.unit('caster', { owner: 'A', controller: 'A', zone: 'board', location: field('bf1'), might: 3 });
      builder.hand('look-a', { owner: 'A', types: ['unit'] });
      builder.deck(['look-b'], { owner: 'A', types: ['gear'] });
    },
  });
  const source = r.kernel.getObject('victim');
  r.host.context(r.kernel.getObject('caster'), 'A', 'chain-item-resolve');
  const moved = r.engine.commit({ type: 'move-location', object: r.kernel.ref('mover'), to: field('bf2') });
  assert.equal(moved.status, 'done');
  const move = r.engine.pipeline.events.find(event => event.timingPoint === 'object-moved');
  assert.ok(move);
  assert.equal(move.kind, 'object-moved');
  assert.deepEqual(move.object.ref, r.kernel.ref('mover'));
  assert.deepEqual(move.before.ref, move.object.ref);
  assert.deepEqual(move.details.before.ref, move.object.ref);
  assert.deepEqual(move.details.after.ref, move.object.ref);
  assert.deepEqual(move.objects.map(object => object.ref), [r.kernel.ref('mover')]);
  assert.deepEqual(move.details.objectIds, ['mover']);
  assert.equal(move.details.objectCount, 1);
  assert.equal(move.fromZone, 'base');
  assert.equal(move.toZone, 'battlefield');
  assert.equal(move.details.fromZone, 'base');
  assert.equal(move.details.toZone, 'battlefield');
  assert.equal(move.details.fromKind, 'base');
  assert.equal(move.details.toKind, 'battlefield');
  assert.equal(move.details.fromLocationId, 'A');
  assert.equal(move.details.toLocationId, 'bf2');
  assert.equal(move.details.responsiblePlayerId, 'A');
  assert.equal(move.details.affectedPlayerId, 'A');
  assert.equal(move.batchId, move.actionId);
  assert.equal(move.batchIndex, 0);

  const killed = r.engine.commit({ type: 'kill', object: r.kernel.ref('victim') });
  assert.equal(killed.status, 'done');
  const death = r.engine.pipeline.events.find(event => event.timingPoint === 'object-killed');
  assert.ok(death);
  assert.deepEqual(death.object.ref, moveSourceRef('victim'));
  // A direct primitive Kill uses `object`; the Chain's death-boundary path adds
  // the separate `it` role before trigger scanning. Both retain source LKI.
  assert.equal(death.it, undefined);
  assert.deepEqual(death.details.before.ref, death.object.ref);
  assert.deepEqual(death.details.after.ref, { id: 'victim', zoneEntryId: 2 });
  assert.equal(death.details.after.zone, 'trash');
  assert.equal(death.details.responsiblePlayerId, 'A');
  assert.equal(death.details.affectedPlayerId, 'B');

  const looked = r.engine.commit({ type: 'look', objects: [r.kernel.ref('look-a'), r.kernel.ref('look-b')], player: 'A' });
  assert.equal(looked.status, 'done');
  const look = r.engine.pipeline.events.find(event => event.timingPoint === 'cards-looked-at');
  assert.ok(look);
  assert.deepEqual(look.objects.map(object => object.ref.id), ['look-a', 'look-b']);
  assert.deepEqual(look.details.objectIds, ['look-a', 'look-b']);
  assert.equal(look.details.objectCount, 2);
  assert.equal(look.details.visibility, 'A');
  assert.equal(look.details.playerId, 'A');

  const stunSource = r.kernel.getObject('caster');
  r.host.context(stunSource, 'A', 'chain-item-resolve');
  const stunned = r.engine.commit({ type: 'stun', object: r.kernel.ref('stunnee') });
  assert.equal(stunned.status, 'done');
  const stun = r.engine.pipeline.events.find(event => event.timingPoint === 'unit-stunned');
  assert.ok(stun);
  assert.equal(stun.kind, 'unit-stunned');
  assert.equal(stun.player, 'A');
  assert.equal(stun.details.playerId, 'A');
  assert.equal(stun.details.responsiblePlayerId, 'A');
  assert.equal(stun.details.effectControllerPlayerId, 'A');
  assert.equal(stun.details.affectedPlayerId, 'B');
  assert.equal(matchesTriggerEvent({ event: 'unit-stunned', player: 'self' }, stun, 'A'), true);
  assert.equal(matchesTriggerEvent({ event: 'unit-stunned', player: 'self' }, stun, 'B'), false);
  assert.equal(stun.details.cause, 'stun');
  assert.equal(r.errors.length, 0);

  for (const [alias, canonical] of [
    ['conquered', 'conquer'], ['held', 'hold'], ['scored', 'score'],
    ['object-entered-zone', 'object-enters-zone'], ['object-left-zone', 'object-leaves-zone'],
    ['showdown-opened', 'showdown-open'], ['chain-item-finalized', 'chain-item-finalize'],
  ]) {
    assert.equal(canonicalEventPatternType(alias), canonical, alias);
    assert.equal(matchesTriggerEvent({ event: alias }, {
      type: 'task-resolved', seq: 1, eventId: 1, turnNumber: 1, activePlayerId: 'A',
      taskId: 'alias', sourceCardId: '', reason: canonical, autoResolved: true,
      timingPoint: canonical, max: 0,
    }, 'A'), true, alias);
  }

  for (const timing of ['conquer', 'hold', 'object-moved', 'object-killed', 'cards-looked-at', 'unit-stunned']) {
    assert.doesNotThrow(() => getTimingPoint(timing));
    assert.equal(typeof getTimingPoint(timing).payloadType, 'string');
  }
  for (const [timing, fields] of [
    ['conquer', ['batchId', 'battlefieldId', 'objectId', 'playerId', 'participatingUnits', 'battlefieldControllerBefore']],
    ['hold', ['batchId', 'battlefieldId', 'objectId', 'playerId', 'participatingUnits']],
    ['object-moved', ['objectIds', 'fromZone', 'toZone', 'fromKind', 'fromLocationId', 'toKind', 'toLocationId']],
    ['object-killed', ['objectId', 'responsiblePlayerId', 'affectedPlayerId', 'cause']],
    ['cards-looked-at', ['objectIds', 'objectCount', 'visibility']],
    ['unit-stunned', ['responsiblePlayerId', 'effectControllerPlayerId', 'affectedPlayerId', 'unitId']],
  ]) {
    assert.deepEqual(getTimingPoint(timing).payloadFields?.filter(field => fields.includes(field)).sort(), [...fields].sort());
  }
});

function moveSourceRef(id) {
  return { id, zoneEntryId: 1 };
}

test('RIFT-1116 matrix: Conquer and Hold production waves bind exact Unit abilities', () => {
  const programs = [admitted(inviolusVox), admitted(trevorSnoozebottom)];
  assert.deepEqual([inviolusVox, trevorSnoozebottom].map(program => PRINTING_BY_CANONICAL_ID[program.canonicalCardId]), [
    'unl-027-219', 'unl-048-219',
  ]);
  const r = turnRuntime({
    programs,
    choose: request => request.type === 'optional' ? true :
      request.type === 'select-objects' && request.id.includes('inviolus-vox.friendly-unit')
        ? [request.options[0]]
        : undefined,
    setup(builder) {
      builder.unit('vox', {
        cardId: inviolusVox.canonicalCardId, owner: 'A', controller: 'A', zone: 'board',
        location: base('A'), might: 8,
      });
      builder.unit('trevor', {
        cardId: trevorSnoozebottom.canonicalCardId, owner: 'A', controller: 'A', zone: 'board',
        location: field('bf1'), might: 3,
      });
    },
  });
  // Installing lifecycle over already-created Board objects is exactly the
  // MatchCommandAdapter attachment point. Register the authored triggers through
  // the public binding while the production host/lifecycle remain active.
  r.lifecycle.detach();
  r.lifecycle = r.binding.attachLifecycle(r.flow.chain, error => r.errors.push(error));
  r.binding.registerProgramTriggers(r.flow.chain, r.kernel.getObject('vox'));
  r.binding.registerProgramTriggers(r.flow.chain, r.kernel.getObject('trevor'));
  assert.equal(triggerIds(r.flow.chain, 'vox').length, 1);
  assert.equal(triggerIds(r.flow.chain, 'trevor').length, 1);
  r.flow.start();

  const hold = r.flow.chain.pipeline.events.find(event => event.timingPoint === 'hold');
  assert.ok(hold);
  assert.equal(hold.kind, undefined);
  assert.deepEqual(hold.object.ref, moveSourceRef('trevor'));
  assert.deepEqual(hold.source.ref, hold.object.ref);
  assert.deepEqual(hold.it.ref, hold.object.ref);
  assert.deepEqual(hold.details, { battlefieldId: 'bf1', objectId: 'trevor', playerId: 'A' });
  assert.ok(hold.batchId);
  const holdScore = r.flow.chain.pipeline.events.find(event => event.timingPoint === 'score' && event.batchId === hold.batchId);
  assert.ok(holdScore);
  assert.deepEqual(holdScore.details.participatingUnits, [moveSourceRef('trevor')]);
  settle(r.flow.chain);

  const conquering = r.kernel.getObject('vox');
  r.flow.execute({
    id: 'rift-1116:conquer', controller: 'A', source: conquering, kind: 'activated', speed: 'normal',
    body: [{
      id: 'move-vox', op: 'effect.move', args: { to: c(field('bf2')) },
    }],
  });
  for (let count = 0; count < 80 && !r.flow.chain.pipeline.events.some(event => event.timingPoint === 'conquer'); count++) {
    if (r.flow.chain.items.length) r.flow.pass(r.flow.chain.priority);
    else if (r.flow.chain.focus !== null) r.flow.pass(r.flow.chain.focus);
    else r.flow.advance();
  }
  const conquer = r.flow.chain.pipeline.events.find(event => event.timingPoint === 'conquer');
  assert.ok(conquer);
  assert.equal(conquer.kind, undefined);
  assert.deepEqual(conquer.object.ref, moveSourceRef('vox'));
  assert.deepEqual(conquer.source.ref, conquer.object.ref);
  assert.deepEqual(conquer.it.ref, conquer.object.ref);
  assert.deepEqual(conquer.details, {
    battlefieldId: 'bf2', objectId: 'vox', playerId: 'A', battlefieldControllerBefore: null,
  });
  assert.ok(conquer.batchId);
  const score = r.flow.chain.pipeline.events.find(event => event.timingPoint === 'score' && event.batchId === conquer.batchId);
  assert.ok(score);
  assert.deepEqual(score.details.participatingUnits, [moveSourceRef('vox')]);
  assert.ok(r.flow.chain.pipeline.events.some(event => event.timingPoint === 'chain-item-pending' && event.batchId !== undefined));
  assert.equal(r.errors.length, 0);
  for (const program of [inviolusVox, trevorSnoozebottom]) {
    const printing = PRINTING_BY_CANONICAL_ID[program.canonicalCardId];
    assert.equal(program.status, 'judge-required', `${printing} remains judge-required until its owner closes remaining semantics`);
  }
});

test('RIFT-1116 matrix: Look and Stun aliases drive real public programs without invented actors', () => {
  assert.deepEqual([noxianDrummer, treasureHunter, eclipseHerald, radiantDawn]
    .map(program => PRINTING_BY_CANONICAL_ID[program.canonicalCardId]), [
    'ogn-222-298', 'sfd-130-221', 'ogn-059-298', 'ogn-261-298',
  ]);
  const r = runtime({
    programs: [admitted(noxianDrummer), admitted(treasureHunter), admitted(eclipseHerald), admitted(radiantDawn)],
    choose: request => request.type === 'optional' ? true : undefined,
    setup(builder) {
      builder.unit('drummer', {
        cardId: noxianDrummer.canonicalCardId, owner: 'A', controller: 'A', zone: 'board',
        location: base('A'), might: 3,
      });
      builder.unit('hunter', {
        cardId: treasureHunter.canonicalCardId, owner: 'A', controller: 'A', zone: 'board',
        location: field('bf1'), might: 1,
      });
      builder.unit('herald', {
        cardId: eclipseHerald.canonicalCardId, owner: 'A', controller: 'A', zone: 'board',
        location: field('bf1'), might: 7, exhausted: true,
      });
      builder.unit('foe', { owner: 'B', controller: 'B', zone: 'board', location: field('bf1'), might: 2 });
      builder.hand('seen', { owner: 'A', types: ['unit'] });
    },
  });
  for (const [id, program] of [
    ['drummer', noxianDrummer], ['hunter', treasureHunter], ['herald', eclipseHerald],
  ]) {
    assert.deepEqual(r.binding.registerProgramTriggers(r.engine, r.kernel.getObject(id)), [
      `program:${id}:1:${program.abilities.findIndex(ability => ability.kind === 'triggered')}`,
    ]);
  }

  const drummerFilter = translateTriggerFilter(noxianDrummer.abilities[0].trigger.filter, 'drummer', 'object-moved');
  assert.deepEqual(drummerFilter, {
    event: 'object-moved', object: { objectId: 'drummer' }, toZone: 'battlefield',
  });
  assert.equal(validateTriggerSpec({ at: 'object-moved', filter: drummerFilter }).ok, true);
  assert.equal(r.engine.commit({ type: 'move-location', object: r.kernel.ref('drummer'), to: field('bf2') }).status, 'done');
  const move = r.engine.pipeline.events.find(event => event.timingPoint === 'object-moved' && event.object.ref.id === 'drummer');
  assert.ok(move);
  assert.equal(move.fromZone, 'base');
  assert.equal(move.toZone, 'battlefield');
  assert.equal(move.details.toZone, 'battlefield');
  assert.equal(matchesTriggerEvent(drummerFilter, move, 'A', r.kernel.getObject('drummer')), true);
  assert.ok(r.engine.items.length >= 1);

  const r2 = runtime({
    programs: [admitted(noxianDrummer)],
    setup(builder) {
      builder.unit('drummer', {
        cardId: noxianDrummer.canonicalCardId, owner: 'A', controller: 'A', zone: 'board',
        location: base('A'), might: 3,
      });
    },
  });
  assert.equal(r2.engine.commit({ type: 'move-location', object: r2.kernel.ref('drummer'), to: field('bf1') }).status, 'done');
  const drummerMove = r2.engine.pipeline.events.find(event => event.timingPoint === 'object-moved');
  assert.ok(drummerMove);
  assert.equal(drummerMove.fromZone, 'base');
  assert.equal(drummerMove.toZone, 'battlefield');
  assert.equal(drummerMove.details.toZone, 'battlefield');
  assert.equal(drummerMove.details.toLocationId, 'bf1');
  assert.deepEqual(drummerMove.objects.map(object => object.ref.id), ['drummer']);

  const contractHost = createActionPipelineHost({
    checkpoint: () => ({ state: r2.kernel.snapshot(), links: r2.kernel.clone() }),
    restore: saved => { r2.kernel.restore(saved.state); r2.kernel.copyLinkedFrom(saved.links); },
    objects: () => r2.kernel.objects,
    perform: action => r2.kernel.perform(action),
    performContract: action => r2.kernel.performContract(action),
    choose: () => undefined,
    context: (source, controller, timingPoint) => bindResolveContext(r2.kernel, {
      source, controller, timingPoint,
    }),
  });
  const contractMove = contractHost.executeContract({
    type: 'move-location', object: r2.kernel.ref('drummer'), to: field('bf2'),
  });
  assert.equal(contractMove.outcome.status, 'done');
  const [contractMoved] = contractMove.emissions.filter(event => event.timingPoint === 'object-moved');
  assert.ok(contractMoved);
  assert.equal(contractMoved.fromZone, 'battlefield');
  assert.equal(contractMoved.toZone, 'battlefield');
  assert.deepEqual(contractMoved.before.ref, moveSourceRef('drummer'));
  assert.deepEqual(contractMoved.after.ref, moveSourceRef('drummer'));
  assert.deepEqual(contractMoved.objects.map(object => object.ref), [moveSourceRef('drummer')]);
  assert.deepEqual(contractMoved.objectIds, ['drummer']);
  assert.equal(contractMoved.objectCount, 1);
  assert.equal(contractMoved.details.fromZone, 'battlefield');
  assert.equal(contractMoved.details.toZone, 'battlefield');
  assert.equal(contractMoved.details.fromLocationId, 'bf1');
  assert.equal(contractMoved.details.toLocationId, 'bf2');

  const hunterFilter = translateTriggerFilter(treasureHunter.abilities[0].trigger.filter, 'hunter', 'object-moved');
  assert.deepEqual(hunterFilter, { event: 'object-moved', object: { objectId: 'hunter' } });
  assert.equal(validateTriggerSpec({ at: 'object-moved', filter: hunterFilter }).ok, true);
  assert.equal(r.engine.commit({ type: 'move-location', object: r.kernel.ref('hunter'), to: field('bf2') }).status, 'done');
  assert.ok(r.engine.pipeline.events.some(event => event.timingPoint === 'object-moved' && event.object.ref.id === 'hunter'));

  const looked = r.engine.commit({ type: 'look', objects: [r.kernel.ref('seen')], player: 'A' });
  assert.equal(looked.status, 'done');
  const look = r.engine.pipeline.events.find(event => event.timingPoint === 'cards-looked-at');
  assert.ok(look);
  assert.deepEqual(look.details.objectIds, ['seen']);
  assert.deepEqual(look.objects.map(object => object.ref.id), ['seen']);
  assert.equal(look.details.visibility, 'A');
  assert.equal(validateTriggerSpec({ at: 'cards-looked-at', filter: { event: 'cards-looked-at' } }).ok, true);

  const source = r.kernel.getObject('herald');
  r.host.context(r.kernel.getObject('herald'), 'A', 'chain-item-resolve');
  assert.equal(r.engine.commit({ type: 'stun', object: r.kernel.ref('foe') }).status, 'done');
  const stun = r.engine.pipeline.events.find(event => event.timingPoint === 'unit-stunned');
  assert.ok(stun);
  assert.deepEqual(stun.object.ref, moveSourceRef('foe'));
  assert.equal(stun.player, 'A');
  assert.equal(stun.details.playerId, 'A');
  assert.equal(stun.details.responsiblePlayerId, 'A');
  assert.equal(stun.details.effectControllerPlayerId, 'A');
  assert.equal(stun.details.affectedPlayerId, 'B');
  assert.ok(r.engine.items.some(item => item.source.ref.id === 'herald'));

  const contract = requireContractActionCapability(r.host.context(r.kernel.getObject('herald'), 'A', 'chain-item-resolve'));
  assert.equal(contract.version, 'riftbound.contract-actions.v1');
  assert.equal(matchesTriggerEvent({ event: 'unit-stunned' }, stun, 'A'), true);
  assert.equal(matchesTriggerEvent({ event: 'unit-stunned', player: 'self' }, stun, 'B'), false);
  assert.equal(matchesTriggerEvent({ event: 'unit-stunned', player: 'self' }, stun, 'A'), true);
  assert.equal(r.errors.length, 0);
  assert.equal(eclipseHerald.status, 'judge-required');
  assert.equal(radiantDawn.status, 'judge-required');
});

test('RIFT-1116 matrix: Stun without a captured effect controller does not invent responsibility', () => {
  const r = runtime({ setup(builder) {
    builder.unit('victim', { owner: 'B', controller: 'B', zone: 'board', location: field('bf1'), might: 2 });
  } });
  const outcome = r.engine.commit({ type: 'stun', object: r.kernel.ref('victim') });
  assert.equal(outcome.status, 'done');
  const stun = r.engine.pipeline.events.find(event => event.timingPoint === 'unit-stunned');
  assert.ok(stun);
  assert.equal(stun.player, undefined);
  assert.equal(stun.details.playerId, 'B');
  assert.equal(stun.details.responsiblePlayerId, undefined);
  assert.equal(stun.details.effectControllerPlayerId, undefined);
  assert.equal(stun.details.affectedPlayerId, 'B');
  assert.equal(stun.details.cause, 'stun');
  assert.equal(matchesTriggerEvent({ event: 'unit-stunned', player: 'self' }, stun, 'B'), false);
});

test('RIFT-1116 matrix: multi-object Look matches any publisher-owned object in canonical order', () => {
  const r = runtime({ setup(builder) {
    builder.hand('first', { owner: 'A', types: ['unit'] });
    builder.deck(['second'], { owner: 'A', types: ['gear'] });
  } });
  assert.equal(r.engine.commit({
    type: 'look', objects: [r.kernel.ref('first'), r.kernel.ref('second')], player: 'A',
  }).status, 'done');
  const look = r.engine.pipeline.events.find(event => event.timingPoint === 'cards-looked-at');
  assert.ok(look);
  assert.deepEqual(look.object.ref, moveSourceRef('first'));
  assert.deepEqual(look.objects.map(object => object.ref), [moveSourceRef('first'), moveSourceRef('second')]);
  assert.equal(matchesTriggerEvent({
    event: 'cards-looked-at', object: { objectId: 'second' }, player: 'self',
  }, look, 'A'), true);
  assert.equal(matchesTriggerEvent({
    event: 'cards-looked-at', object: { objectId: 'foreign' },
  }, look, 'A'), false);
});
