import assert from 'node:assert/strict';
import test from 'node:test';

import { AwaitChoice } from '../../dist/effects/contract.js';
import { world } from '../../dist/effects/testing/index.js';
import { bindResolveContext, createActionPipelineHost, killBatch } from '../../dist/events/action-adapter.js';
import { ChainEngine } from '../../dist/chain/engine.js';
import { createProgramBinding } from '../../dist/programs/index.js';
import ekkoRecurrent from '../../../card-dsl/dist/cards/ogn/ekko-recurrent.js';
import ironBallista from '../../../card-dsl/dist/cards/ogn/iron-ballista.js';
import rumbleHotheaded from '../../../card-dsl/dist/cards/sfd/rumble-hotheaded.js';
import unsungHero from '../../../card-dsl/dist/cards/sfd/unsung-hero.js';
import treasureTrove from '../../../card-dsl/dist/cards/ogn/treasure-trove.js';
import undertitan from '../../../card-dsl/dist/cards/sfd/undertitan.js';
import undercoverAgent from '../../../card-dsl/dist/cards/ogn/undercover-agent.js';
import vanguardAttendant from '../../../card-dsl/dist/cards/ogs/vanguard-attendant.js';

const constant = value => ({ kind: 'constant', value });
const battlefield = { type: 'battlefield', id: 'battlefield-1' };

const admitted = program => ({ ...program, status: 'executable', judgeReason: undefined });
const card = (id, abilities) => ({
  canonicalCardId: id, rulesetVersion: 'core-1.5', status: 'executable', sourceText: id, abilities,
});

function runtime(builder, programs = [], chooseOverride, errorHandler) {
  const kernel = builder.build();
  const asked = [];
  const choose = request => {
    asked.push(request);
    const answer = chooseOverride?.(request);
    if (answer !== undefined) return answer;
    if (request.type === 'mode') return request.options[0];
    if (request.type === 'order') return [...request.options];
    if (request.type === 'optional') return true;
    if (request.type === 'select-objects' && request.min === request.max && request.options.length === request.min) return [...request.options];
    throw new AwaitChoice(request);
  };
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: saved => { kernel.restore(saved.state); kernel.copyLinkedFrom(saved.links); },
    objects: () => kernel.objects,
    perform: action => kernel.perform(action),
    performContract: action => kernel.performContract(action),
    performBatchLeaf: (action, batchId) => kernel.performBatchLeafForCapability(action, batchId),
    choose,
    context: (source, controller, timingPoint) => bindResolveContext(kernel, { source, controller, timingPoint, choose }),
    testTrigger: registration => kernel.test(registration.spec.condition),
  });
  const binding = createProgramBinding({ cardPrograms: programs });
  const engine = new ChainEngine({
    turnOrder: ['A', 'B'], turnPlayer: 'A', phase: 'main', host, cleanup: () => false,
    describePlay: binding.describePlay,
  });
  const errors = [];
  const lifecycle = binding.attachLifecycle(engine, error => {
    errors.push(error);
    errorHandler?.(error);
  });
  const enter = id => {
    const object = kernel.getObject(id);
    if (object.zone === 'hand') assert.equal(engine.commit({ type: 'move-zone', object: kernel.ref(id), to: 'chain' }).status, 'done');
    return engine.commit({ type: 'move-zone', object: kernel.ref(id), to: 'battlefield', location: battlefield });
  };
  const settle = () => {
    engine.advance();
    for (let step = 0; engine.items.length; step++) {
      assert.ok(step < 40, 'the real chain must settle');
      engine.pass(engine.priority);
    }
  };
  return { kernel, engine, binding, lifecycle, errors, asked, enter, settle };
}

test('original Deathknell IR queues a Pending item, preserves source LKI, and resolves once', () => {
  const sourceProgram = admitted(undercoverAgent);
  const f = runtime(world().player('A', { energy: 10, power: ['Order'] }).player('B')
    .hand('agent', { cardId: sourceProgram.canonicalCardId, types: ['unit'] })
    .hand('held-a').hand('held-b')
    .deck(['draw-a', 'draw-b', 'draw-c'], { owner: 'A' }), [sourceProgram]);
  assert.equal(f.enter('agent').status, 'done');
  const oldRef = f.kernel.ref('agent');
  const source = f.kernel.getObject('agent');
  const outcome = f.engine.commit({ type: 'kill', object: oldRef });
  assert.equal(outcome.status, 'done');
  assert.notEqual(f.kernel.ref('agent').zoneEntryId, oldRef.zoneEntryId);
  assert.equal(f.kernel.getObject('agent').zone, 'trash');
  const pending = f.engine.items.find(item => item.trigger?.registration.id === 'program:agent:3:1');
  assert.ok(pending, 'the original card trigger became a real Pending item');
  assert.deepEqual(pending.trigger.source.ref, oldRef);
  assert.equal(pending.trigger.source.zone, 'board');
  assert.deepEqual(pending.trigger.source.location, battlefield);
  assert.deepEqual(pending.trigger.event.object.ref, oldRef);
  assert.equal(pending.trigger.event.object.zone, 'board');
  const pendingEvent = f.engine.pipeline.events.find(event => event.timingPoint === 'chain-item-pending' && event.details?.item === pending.id);
  assert.ok(pendingEvent, 'Pending publication is part of the kill wave');
  assert.ok(pendingEvent.batchId, 'the Pending item retains the real action batch identity');
  assert.equal(f.engine.pipeline.checkpoint().triggers.has('program:agent:3:1'), false, 'the source trigger detaches after its wave is scanned');
  f.settle();
  assert.equal(f.kernel.player('A').handSize, 2, 'discard 2 then draw 2 through the original body');
  assert.equal(f.engine.pipeline.checkpoint().triggers.size, 0, 'no Chain or dead Board trigger registration remains');
  f.lifecycle.detach();
});

test('the original I-enter-ready IR follows a real Hand, Chain, and Board play transition', () => {
  const sourceProgram = admitted(vanguardAttendant);
  const f = runtime(world().player('A', { energy: 10, power: ['Order'] }).player('B')
    .hand('attendant', {
      cardId: sourceProgram.canonicalCardId, types: ['unit'], might: 2, energy: 6, power: ['Order'],
    }), [sourceProgram]);
  const handRef = f.kernel.ref('attendant');
  const outcome = f.engine.commit({
    type: 'play', object: handRef, player: 'A', location: battlefield,
  });
  assert.equal(outcome.status, 'done');
  f.settle();
  const entered = f.kernel.getObject('attendant');
  assert.equal(entered.zone, 'board');
  assert.deepEqual(entered.location, battlefield);
  assert.equal(entered.exhausted, false, 'the production replacement readies the real Board entrant');
  assert.notEqual(entered.ref.zoneEntryId, handRef.zoneEntryId);
  assert.equal(f.engine.pipeline.events.some(event =>
    event.timingPoint === 'object-enters-board' && event.object?.ref.zoneEntryId === entered.ref.zoneEntryId), true);
  assert.equal(f.engine.pipeline.hasReplacementRegistration(`replacement:attendant:${handRef.zoneEntryId}`), false);
  assert.equal(f.engine.pipeline.hasReplacementRegistration(`replacement:attendant:${entered.ref.zoneEntryId}`), true,
    'the exact Board incarnation owns the registration after the Hand follower retires');
  f.lifecycle.detach();
});

test('ordinary and typed multi-source Kill batches install exact sources, scan once, and roll back on failure', () => {
  const observer = card('observer', [{
    kind: 'triggered', trigger: { at: 'object-killed', filter: {} }, optional: false,
    body: [{ id: 'observer.draw', op: 'effect.draw', args: { amount: constant(1) } }],
  }]);
  for (const typed of [false, true]) {
    const f = runtime(world().player('A').player('B')
      .hand('left', { cardId: 'observer' }).hand('right', { cardId: 'observer' })
      .deck(['draw-a', 'draw-b'], { owner: 'A' }), [observer]);
    assert.equal(f.enter('left').status, 'done');
    assert.equal(f.enter('right').status, 'done');
    const refs = [f.kernel.ref('left'), f.kernel.ref('right')];
    const batch = killBatch(refs, typed ? 'typed-wave' : 'ordinary-wave');
    const eventsBeforeKill = f.engine.pipeline.events.length;
    const triggersBeforeKill = f.engine.pipeline.checkpoint().triggers.size;
    const originalOnTrigger = f.engine.pipeline.onTrigger;
    f.engine.pipeline.onTrigger = () => { throw new Error('scan failure'); };
    assert.throws(() => typed ? f.engine.pipeline.commitContract(batch) : f.engine.commit(batch), /scan failure/);
    assert.deepEqual([f.kernel.getObject('left').ref, f.kernel.getObject('right').ref], refs, 'both exact sources roll back');
    assert.equal(f.engine.items.length, 0);
    assert.equal(f.engine.pipeline.checkpoint().triggers.size, triggersBeforeKill, 'trigger registrations survive rollback');
    assert.equal(f.engine.pipeline.events.length, eventsBeforeKill);
    f.engine.pipeline.onTrigger = originalOnTrigger;
    const outcome = typed ? f.engine.pipeline.commitContract(batch) : f.engine.commit(batch);
    assert.equal(outcome.status, 'done');
    const deaths = f.engine.pipeline.events.filter(event => event.timingPoint === 'object-killed');
    assert.deepEqual(deaths.map(event => event.object.ref), refs);
    assert.ok(deaths.every(event => event.batchId === (typed ? 'typed-wave' : 'ordinary-wave')));
    assert.deepEqual(f.engine.items.map(item => item.trigger.source.ref), refs);
    assert.ok(f.engine.items.every(item => item.trigger.event.batchId === (typed ? 'typed-wave' : 'ordinary-wave')));
    assert.equal(f.engine.pipeline.checkpoint().triggers.size, 0, 'the two rollback-restored registrations detach after the successful wave');
    f.lifecycle.detach();
  }
});

test('an illegal typed Kill batch is rejected without publishing deaths or pending triggers', () => {
  const observer = card('observer', [{
    kind: 'triggered', trigger: { at: 'object-killed', filter: {} }, optional: false,
    body: [{ id: 'observer.draw', op: 'effect.draw', args: { amount: constant(1) } }],
  }]);
  const f = runtime(world().player('A').player('B')
    .hand('left', { cardId: 'observer' }).hand('right', { cardId: 'observer' }), [observer]);
  const refs = [f.kernel.ref('left'), f.kernel.ref('right')];
  const eventsBefore = f.engine.pipeline.events.length;
  const outcome = f.engine.pipeline.commitContract(killBatch(refs, 'illegal-wave'));
  assert.equal(outcome.status, 'impossible');
  assert.deepEqual([f.kernel.getObject('left').ref, f.kernel.getObject('right').ref], refs);
  assert.equal(f.engine.items.length, 0);
  assert.equal(f.engine.pipeline.events.length, eventsBefore);
  assert.equal(f.engine.pipeline.checkpoint().triggers.size, 0);
  f.lifecycle.detach();
});

test('a replaced Kill never collects its Deathknell trigger and leaves the original registration intact', () => {
  const sourceProgram = admitted(undercoverAgent);
  const f = runtime(world().player('A').player('B').hand('agent', { cardId: sourceProgram.canonicalCardId, types: ['unit'] }), [sourceProgram]);
  assert.equal(f.enter('agent').status, 'done');
  f.engine.pipeline.registerReplacement({
    id: 'recall-instead',
    matches: action => action.type === 'kill' && action.object.id === 'agent',
    apply: action => ({ status: 'replace', actions: [{ type: 'move-location', object: action.object, to: { type: 'base', player: 'A' } }] }),
  });
  const outcome = f.engine.commit({ type: 'kill', object: f.kernel.ref('agent') });
  assert.equal(outcome.status, 'replaced');
  assert.equal(f.kernel.getObject('agent').zone, 'board');
  assert.deepEqual(f.kernel.getObject('agent').location, { type: 'base', player: 'A' });
  assert.equal(f.engine.items.length, 0);
  assert.equal(f.engine.pipeline.events.some(event => event.timingPoint === 'object-killed'), false);
  assert.equal(f.engine.pipeline.checkpoint().triggers.has('program:agent:3:1'), true);
  f.lifecycle.detach();
});

test('Secret Zones evaluate only replacement abilities active for that zone', () => {
  const f = runtime(world().player('A').player('B')
    .deck('hidden', { cardId: undertitan.canonicalCardId, types: ['unit'] })
    .deck('inactive', { cardId: rumbleHotheaded.canonicalCardId, types: ['unit'] })
    .rune('not-secret-relevant', { cardId: ironBallista.canonicalCardId }),
  [admitted(undertitan), rumbleHotheaded, ironBallista]);
  const hiddenRef = f.kernel.ref('hidden');
  assert.equal(f.engine.pipeline.hasReplacementRegistration(`replacement:hidden:${hiddenRef.zoneEntryId}`), true,
    'the deck-hosted card-revealed replacement is active');
  assert.equal(f.engine.pipeline.checkpoint().replacements.size, 1,
    'non-reveal and inactive-zone abilities are not expanded');
  assert.equal(f.engine.pipeline.checkpoint().triggers.size, 0,
    'inactive Secret-Zone triggers are not registered');
  assert.equal(f.engine.layers.registry.list().length, 0,
    'inactive Secret-Zone statics are not installed');
  assert.equal(f.errors.length, 0, 'unrelated judge-required abilities do not fail Secret-Zone initialization');
  assert.equal(undertitan.status, 'judge-required');
  assert.equal(rumbleHotheaded.status, 'judge-required');
  f.lifecycle.detach();
  assert.equal(f.engine.pipeline.checkpoint().replacements.size, 0);
});

test('a Main Deck replacement built from original IR replaces a real reveal action', () => {
  const sourceProgram = admitted(undertitan);
  const f = runtime(world().player('A').player('B')
    .deck('hidden', { cardId: sourceProgram.canonicalCardId, types: ['unit'] }), [sourceProgram]);
  const reveal = f.kernel.getObject('hidden');
  const registration = `replacement:hidden:${reveal.ref.zoneEntryId}`;
  assert.equal(f.engine.pipeline.hasReplacementRegistration(registration), true);
  assert.equal(f.engine.commit({ type: 'reveal', object: reveal.ref, players: ['A'] }).status, 'replaced');
  assert.equal(f.kernel.player('A').energy, 2, 'the original replacement body adds Energy');
  assert.equal(f.kernel.getObject('hidden').zone, 'deck');
  f.lifecycle.detach();
});

test('Rune Deck replacement matching uses the active zone and leaves unrelated programs untouched', () => {
  const sourceProgram = admitted(undertitan);
  const f = runtime(world().player('A').player('B')
    .rune('rune-hidden', { cardId: sourceProgram.canonicalCardId }), [sourceProgram]);
  const rune = f.kernel.getObject('rune-hidden');
  assert.equal(f.engine.pipeline.hasReplacementRegistration(`replacement:rune-hidden:${rune.ref.zoneEntryId}`), false,
    'a Main Deck reveal replacement is inactive in Rune Deck');
  assert.equal(f.engine.pipeline.checkpoint().replacements.size, 0);
  assert.equal(f.errors.length, 0);
  f.lifecycle.detach();
});

test('a registered judge-required Board program blocks through the real lifecycle hook', () => {
  for (const [id, cardId, patterns] of [
    ['judge', rumbleHotheaded.canonicalCardId, [
      /cost\/payment\.ts:125-129/,
      /effects\/interpreter\.ts:173-180/,
      /cost\.modify=mistargeted/,
    ]],
  ]) {
    const f = runtime(world().player('A').player('B').unit(id, { cardId, types: ['unit'] }), [rumbleHotheaded],
      undefined, error => { throw error; });
    const ref = f.kernel.ref(id);
    const events = f.engine.pipeline.events.length;
    assert.equal(rumbleHotheaded.status, 'judge-required');
    assert.throws(() => f.engine.commit({ type: 'kill', object: ref }), error => {
      for (const pattern of patterns) assert.match(error.message, pattern);
      return true;
    });
    assert.deepEqual(f.kernel.ref(id), ref, 'the blocked source keeps its exact incarnation');
    assert.equal(f.kernel.getObject(id).zone, 'board');
    assert.equal(f.engine.items.length, 0);
    assert.equal(f.engine.pipeline.events.length, events);
    f.lifecycle.detach();
  }
});

test('a neutral Board source with no registered program stays a valid lifecycle no-op', () => {
  const f = runtime(world().player('A').player('B').unit('neutral', {
    cardId: 'synthetic:neutral', types: ['unit'], might: 2,
  }));
  const ref = f.kernel.ref('neutral');
  assert.equal(f.engine.commit({ type: 'kill', object: ref }).status, 'done');
  assert.equal(f.kernel.getObject('neutral').zone, 'trash');
  assert.equal(f.engine.items.length, 0);
  assert.equal(f.errors.length, 0);
  f.lifecycle.detach();
});

test('a supported executable trigger in an active zone remains registered', () => {
  const f = runtime(world().player('A').player('B')
    .hand('hero', { cardId: unsungHero.canonicalCardId, types: ['unit'] }), [unsungHero]);
  assert.equal(f.enter('hero').status, 'done');
  const ref = f.kernel.ref('hero');
  assert.equal(f.engine.pipeline.hasTriggerRegistration(`program:hero:${ref.zoneEntryId}:1`), true);
  assert.equal(f.errors.length, 0);
  f.lifecycle.detach();
});

test('detach restores every hook and original IR remains judge-required', () => {
  const f = runtime(world().player('A').player('B').unit('treasure', {
    cardId: treasureTrove.canonicalCardId, types: ['gear'], energy: null, power: null,
  }).deck(['draw-a'], { owner: 'A' }).rune(['rune-a'], { owner: 'A' }), [admitted(treasureTrove)]);
  assert.equal(f.kernel.getObject('treasure').energy, null);
  assert.equal(f.kernel.getObject('treasure').power, null);
  const hooks = ['emitBatch', 'commit', 'commitContract', 'onEvent', 'deferTriggerScan'];
  const originalHooks = Object.fromEntries(hooks.map(hook => [hook, f.engine.pipeline[hook]]));
  f.lifecycle.detach();
  for (const hook of hooks) assert.equal(typeof f.engine.pipeline[hook], 'function', hook);
  assert.equal(f.engine.pipeline.checkpoint().triggers.size, 0);
  assert.equal(f.engine.pipeline.checkpoint().replacements.size, 0);
  assert.equal(ekkoRecurrent.status, 'judge-required');
  assert.equal(undercoverAgent.status, 'judge-required');
  assert.equal(treasureTrove.status, 'judge-required');
  assert.equal(ironBallista.status, 'executable');
});
