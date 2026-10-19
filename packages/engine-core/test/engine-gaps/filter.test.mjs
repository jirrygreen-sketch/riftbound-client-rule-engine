import assert from 'node:assert/strict';
import test from 'node:test';

import { translateObjectFilter, translateTriggerFilter, translateInstructionTargets } from '../../dist/programs/filters.js';
import { ProgramBindingError } from '../../dist/programs/errors.js';
import { ProgramRegistry } from '../../dist/programs/registry.js';
import { queryObjects } from '../../dist/effects/interpreter/selectors.js';
import { world } from '../../dist/effects/testing/index.js';
import { matchesTriggerEvent } from '../../dist/events/pipeline-match.js';
import { validateTriggerSpec } from '../../dist/events/trigger-spec.js';
import { fixture, cardProgram, settle } from '../rules/keywords/support.mjs';
import kinkouMonk from '../../../card-dsl/dist/cards/ogn/kinkou-monk.js';
import piercingLight from '../../../card-dsl/dist/cards/sfd/piercing-light.js';
import crackshotCorsair from '../../../card-dsl/dist/cards/ogn/crackshot-corsair.js';
import ruinedRex from '../../../card-dsl/dist/cards/unl/ruined-rex.js';
import yoneBlademaster from '../../../card-dsl/dist/cards/rad/yone-blademaster.js';
import { createProgramBinding } from '../../dist/programs/index.js';
import { createActionPipelineHost, bindResolveContext } from '../../dist/events/action-adapter.js';
import { ChainEngine } from '../../dist/chain/engine.js';

const field = id => ({ type: 'battlefield', id });
const c = value => ({ kind: 'constant', value });
const triggered = program => program.abilities.find(ability => ability.kind === 'triggered');
const playBody = program => program.abilities.find(ability => ability.kind === 'play').body;
const env = (context, host) => ({ context, host, linked: id => context.linked(id), canLookBack: () => false, isIgnored: () => false });
const ids = objects => objects.map(object => object.ref.id);

// Only admission is synthetic. Each selected ability/body below is the shipped
// IR, unchanged, executed by the production binding, ChainEngine and interpreter.
// Whole-card judge-required guards and all unsupported costs/abilities remain.
const admitAbility = (id, ability) => cardProgram(id, [], [ability]);

function monkFixture(selected = ['ally']) {
  const program = admitAbility('test:eg-filter-monk', triggered(kinkouMonk));
  return fixture({
    programs: [program], energy: { A: 4 }, power: { A: ['Body'] },
    answers: { 'target:kinkou.other-friendly-units': selected },
    setup(builder) {
      builder.hand('monk', { cardId: program.canonicalCardId, energy: 4, power: ['Body'], might: 4 });
      builder.unit('ally', { might: 3, energy: null, power: null, location: field('one') });
      builder.unit('enemy', { owner: 'B', might: 4, location: field('one') });
    }
  });
}

function spellFixture(selected = ['second']) {
  const program = cardProgram('test:eg-filter-piercing-body', playBody(piercingLight));
  return fixture({
    programs: [program], energy: { A: 2 }, power: { A: ['Fury'] },
    answers: {
      'target:piercing-light.battlefield-unit': ['first'],
      'target:piercing-light.other-unit': selected
    },
    setup(builder) {
      builder.hand('spell', { cardId: program.canonicalCardId, types: ['spell'], energy: 2, power: ['Fury'] });
      builder.unit('first', { owner: 'B', might: 5, location: field('one') });
      builder.unit('second', { owner: 'B', might: 5, location: field('one') });
    }
  });
}

test('EG-FILTER preserves self/host separately from source and never invents a target', () => {
  const kernel = world()
    .unit('source', { location: field('one') })
    .unit('host', { location: field('two') })
    .unit('near-host', { location: field('two') })
    .unit('near-source', { location: field('one') }).build();
  const context = kernel.clone({ sourceSnapshot: kernel.getObject('source') });
  const environment = env(context, kernel.ref('host'));
  const input = { type: 'unit', here: true, other: true };
  const before = structuredClone(input);
  assert.deepEqual(translateObjectFilter(input), { type: 'unit', sameLocationAs: 'self', exclude: 'self' });
  assert.deepEqual(ids(queryObjects(translateObjectFilter(input), environment)), ['near-host']);
  assert.deepEqual(ids(queryObjects(translateObjectFilter({ source: 'source' }), environment)), ['source']);
  assert.deepEqual(ids(queryObjects(translateObjectFilter({ self: true }), environment)), ['host']);
  assert.deepEqual(ids(queryObjects(translateObjectFilter({ sameLocationAs: 'source', exclude: 'source' }), environment)), ['near-source']);
  assert.deepEqual(input, before);
  assert.deepEqual(context.targets('self'), []);
});

test('EG-FILTER normalizes role, scalar aliases and conjunctions without order-dependent loss', () => {
  const expected = { controller: 'self', exclude: 'self', type: ['unit'], states: ['ready', 'stunned'], tags: ['Ionia', 'Yordle'] };
  assert.deepEqual(translateObjectFilter({ role: 'other-friendly', types: ['unit'], state: 'ready', states: ['stunned'], tag: 'Ionia', tags: ['Yordle'] }), expected);
  assert.deepEqual(translateObjectFilter({ 'object.id': 'self', objectId: 'self' }), { object: 'self' });
  for (const input of [{ type: 'unit', types: ['gear'] }, { role: 'other-friendly', controller: 'opponent' }, { here: true, sameLocationAs: 'source' }]) {
    assert.throws(() => translateObjectFilter(input), error => error instanceof ProgramBindingError && error.code === 'invalid-program');
  }
});

test('EG-FILTER preserves concrete Bases, Battlefield ids, location types and zoneEntryId', () => {
  const kernel = world().base('a').base('b', { owner: 'B' }).unit('u', { location: field('one') }).build();
  const context = kernel.clone({ sourceSnapshot: kernel.getObject('u') });
  assert.deepEqual(ids(queryObjects(translateObjectFilter({ location: { type: 'base', player: 'A' } }), env(context))), ['a']);
  assert.deepEqual(ids(queryObjects(translateObjectFilter({ location: 'one', locationType: 'battlefield' }), env(context))), ['u']);
  assert.deepEqual(ids(queryObjects(translateObjectFilter({ locationType: 'battlefield' }), env(context))), ['u']);
  const old = kernel.ref('u');
  const filter = translateObjectFilter({ objectId: old.id, zoneEntryId: old.zoneEntryId });
  assert.deepEqual(queryObjects(filter, env(context)).map(object => object.ref), [old]);
  assert.equal(context.perform({ type: 'return-to-hand', object: old }).status, 'done');
  assert.equal(context.perform({ type: 'move-zone', object: context.ref('u'), to: 'battlefield', location: field('one') }).status, 'done');
  assert.notDeepEqual(context.ref('u'), old);
  assert.deepEqual(queryObjects(filter, env(context)), []);
});

test('EG-FILTER source location follows its live incarnation and falls back to its own LKI', () => {
  const kernel = world().unit('source', { location: field('old'), energy: null, power: null })
    .unit('old-neighbor', { location: field('old') }).unit('new-neighbor', { location: field('new') }).build();
  const snapshot = kernel.getObject('source');
  const context = kernel.clone({ sourceSnapshot: snapshot });
  const filter = translateObjectFilter({ zone: 'board', sameLocationAs: 'source', exclude: 'source' });
  assert.equal(context.perform({ type: 'move-location', object: snapshot.ref, to: field('new') }).status, 'done');
  assert.deepEqual(ids(queryObjects(filter, env(context))), ['new-neighbor']);
  assert.equal(context.perform({ type: 'return-to-hand', object: snapshot.ref }).status, 'done');
  assert.deepEqual(ids(queryObjects(filter, env(context))), ['old-neighbor']);
  assert.equal(context.source.energy, null);
  assert.equal(context.source.power, null);
});

test('EG-FILTER rejects unknown semantics and runtime references in static selector positions', () => {
  assert.throws(() => translateObjectFilter({ fromHidden: true }), error => error instanceof ProgramBindingError && error.code === 'judge-required');
  assert.throws(() => translateObjectFilter({ exclude: { id: 'unit', zoneEntryId: 1 } }), error => error instanceof ProgramBindingError && error.code === 'invalid-program');
  assert.throws(() => translateObjectFilter({ relation: { relation: 'adjacent', object: 'self' } }), error => error instanceof ProgramBindingError && error.code === 'judge-required');
});

test('EG-FILTER nested EventPattern keeps type, identity and all sibling constraints', () => {
  const f = monkFixture();
  f.play('monk');
  const event = f.engine.pipeline.events.find(event => event.timingPoint === 'card-played');
  assert.ok(event);
  const filter = translateTriggerFilter({ event: 'card-played', filter: { source: 'self', type: 'unit', controller: 'you', zone: 'board' }, player: 'controller' }, 'monk');
  assert.deepEqual(filter, { event: 'card-played', player: 'self', object: { objectId: 'monk', type: 'unit', controller: 'self', zone: 'board' } });
  assert.equal(validateTriggerSpec({ at: 'card-played', filter }).ok, true);
  assert.equal(matchesTriggerEvent(filter, event, 'A'), true);
  assert.equal(matchesTriggerEvent(translateTriggerFilter({ event: 'card-played', filter: { source: 'self', type: 'gear' } }, 'monk'), event, 'A'), false);
  assert.equal(matchesTriggerEvent(translateTriggerFilter({ event: 'card-played', filter: { source: 'self', controller: 'opponent' } }, 'monk'), event, 'A'), false);
  assert.equal(matchesTriggerEvent(translateTriggerFilter({ event: 'card-played', filter: { source: 'self', zone: 'trash' } }, 'monk'), event, 'A'), false);
});

test('EG-FILTER distinguishes object types from event discriminants and preserves independent event roles', () => {
  assert.deepEqual(translateTriggerFilter({ type: 'unit', controller: 'controller' }, 'source'), { type: 'unit', controller: 'self' });
  assert.deepEqual(translateTriggerFilter({ type: 'card-played', filter: { type: 'unit' }, source: { type: 'spell' }, target: { type: 'gear' }, player: 'A' }, 'source'), {
    type: 'card-played', source: { type: 'spell' }, target: { type: 'gear' }, player: { playerId: 'A' }, object: { type: 'unit' }
  });
  assert.deepEqual(translateTriggerFilter({ event: 'conquered', type: 'conquer' }, 'source'), { event: 'conquered', type: 'conquer' });
  assert.deepEqual(translateTriggerFilter({ event: 'card-played', filter: { type: 'unit', player: 'controller' } }, 'source'), { event: 'card-played', player: 'self', object: { type: 'unit' } });
  assert.throws(() => translateTriggerFilter({ event: 'card-played', type: 'held' }, 'source'), error => error instanceof ProgramBindingError && error.code === 'invalid-program');
});

test('EG-FILTER admits Yone battlefieldWas only as the authoritative conquer pre-control condition', () => {
  const source = world().unit('yone').build().getObject('yone');
  const [trigger] = yoneBlademaster.abilities.filter(ability => ability.kind === 'triggered');
  const filter = translateTriggerFilter(trigger.trigger.filter, source.ref.id, trigger.trigger.at);
  assert.deepEqual(filter, {
    event: 'conquer',
    details: { battlefieldControllerBefore: null },
    object: { objectId: 'yone' },
  });
  assert.equal(validateTriggerSpec({ at: 'conquer', filter }).ok, true);
  assert.deepEqual(yoneBlademaster.abilities.filter(ability => ability.kind === 'triggered')[0].trigger.filter, {
    self: true,
    battlefieldWas: 'uncontrolled',
  });
  for (const invalid of [
    { event: 'hold', battlefieldWas: 'uncontrolled' },
    { event: 'conquer', battlefieldWas: 'controlled' },
    { event: 'conquer', battlefieldWas: 'open' },
    { event: 'conquer', battlefieldWas: true },
  ]) {
    assert.throws(() => translateTriggerFilter(invalid, 'yone'), error =>
      error instanceof ProgramBindingError && error.code === 'judge-required');
  }
  assert.throws(() => translateObjectFilter({ battlefieldWas: 'uncontrolled' }), error =>
    error instanceof ProgramBindingError && error.code === 'judge-required');
});

test('EG-FILTER original Yone IR clears the first default program-binding block and registers the conquer consumer', () => {
  const program = { ...yoneBlademaster, status: 'executable', judgeReason: undefined };
  const kernel = world().player('A').player('B').unit('yone', { cardId: program.canonicalCardId, might: 4 }).build();
  const binding = createProgramBinding({ cardPrograms: [program] });
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: saved => { kernel.restore(saved.state); kernel.copyLinkedFrom(saved.links); },
    objects: () => kernel.objects,
    perform: action => kernel.perform(action),
    choose: request => { throw new Error(`unexpected choice ${request.id}`); },
    context: (source, controller, timingPoint) => bindResolveContext(kernel, { source, controller, timingPoint, choose: request => { throw new Error(`unexpected choice ${request.id}`); } }),
  });
  const engine = new ChainEngine({ turnOrder: ['A', 'B'], turnPlayer: 'A', phase: 'main', host, cleanup: () => false });
  const registered = binding.registerProgramTriggers(engine, kernel.getObject('yone'));
  assert.equal(registered.length, 2, 'Yone conquer plus the shipped Weaponmaster expansion');
  const trigger = engine.pipeline.registeredTriggers().find(item => item.spec.at === 'conquer');
  assert.ok(trigger);
  assert.deepEqual(trigger.spec.filter, {
    event: 'conquer',
    details: { battlefieldControllerBefore: null },
    object: { objectId: 'yone' },
  });
  assert.equal(trigger.spec.at, 'conquer');
});

test('EG-FILTER Yone consumer accepts only uncontrolled pre-control and rejects missing/controlled/stale facts', () => {
  const object = world().unit('yone', { might: 4 }).build().getObject('yone');
  const base = {
    type: 'task-resolved', seq: 1, eventId: 1, turnNumber: 1, activePlayerId: 'A',
    taskId: 'conquer:yone', sourceCardId: 'card:yone', reason: 'conquer', autoResolved: true,
    timingPoint: 'conquer', kind: 'conquer', player: 'A', batchId: 'conquer-wave',
    object, source: object, it: object,
  };
  const filter = { event: 'conquer', object: { objectId: 'yone' }, details: { battlefieldControllerBefore: null } };
  const valid = { ...base, details: { battlefieldId: 'bf1', objectId: 'yone', playerId: 'A', battlefieldControllerBefore: null } };
  assert.equal(matchesTriggerEvent(filter, valid, 'A'), true);
  assert.equal(matchesTriggerEvent(filter, { ...valid, details: { ...valid.details, battlefieldControllerBefore: 'B' } }, 'A'), false);
  assert.equal(matchesTriggerEvent(filter, { ...valid, details: { battlefieldId: 'bf1', objectId: 'yone', playerId: 'A' } }, 'A'), false);
  assert.equal(matchesTriggerEvent(filter, { ...valid, details: { ...valid.details, battlefieldId: undefined } }, 'A'), false);
  assert.equal(matchesTriggerEvent(filter, { ...valid, object: { ...object, ref: { ...object.ref, zoneEntryId: 2 } }, source: object, it: object }, 'A'), false);
});

test('EG-FILTER registered Yone trigger consumes only an uncontrolled conquer emission', () => {
  const program = { ...yoneBlademaster, status: 'executable', judgeReason: undefined };
  const kernel = world().player('A').player('B').unit('yone', { cardId: program.canonicalCardId, might: 4 })
    .unit('enemy', { owner: 'B', controller: 'B', location: { type: 'base', player: 'B' } }).build();
  const binding = createProgramBinding({ cardPrograms: [program] });
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: saved => { kernel.restore(saved.state); kernel.copyLinkedFrom(saved.links); },
    objects: () => kernel.objects,
    perform: action => kernel.perform(action),
    choose: request => request.type === 'select-objects' ? [...request.options] : true,
    context: (source, controller, timingPoint) => bindResolveContext(kernel, { source, controller, timingPoint }),
  });
  const engine = new ChainEngine({ turnOrder: ['A', 'B'], turnPlayer: 'A', phase: 'main', host, cleanup: () => false });
  binding.registerProgramTriggers(engine, kernel.getObject('yone'));
  const object = kernel.getObject('yone');
  const details = { battlefieldId: 'bf1', objectId: 'yone', playerId: 'A', battlefieldControllerBefore: null };
  engine.pipeline.emitBatch([{ timingPoint: 'conquer', kind: 'conquer', object, source: object, it: object, player: 'A', details, batchId: 'real-conquer-wave' }]);
  assert.equal(engine.items.filter(item => item.trigger?.registration.spec.at === 'conquer').length, 1);

  const checkpoint = engine.pipeline.checkpoint();
  const triggerCount = engine.items.length;
  const eventsBefore = engine.pipeline.events.length;
  engine.pipeline.emitBatch([{
    timingPoint: 'conquer', kind: 'conquer', object, source: object, it: object, player: 'A', batchId: 'controlled-wave',
    details: { battlefieldId: 'bf1', objectId: 'yone', playerId: 'A', battlefieldControllerBefore: 'B' },
  }]);
  assert.equal(engine.pipeline.events.length, eventsBefore + 1, 'the real conquer fact remains logged');
  assert.equal(engine.pipeline.events.at(-1).details.battlefieldControllerBefore, 'B');
  assert.equal(engine.items.length, triggerCount);
});

test('EG-FILTER Yone consumer is independent per conquer source and rolls a failed matching wave back', () => {
  const program = { ...yoneBlademaster, status: 'executable', judgeReason: undefined };
  const kernel = world().player('A').player('B')
    .unit('left-yone', { cardId: program.canonicalCardId, might: 4, location: { type: 'battlefield', id: 'left' } })
    .unit('right-yone', { cardId: program.canonicalCardId, might: 4, location: { type: 'battlefield', id: 'right' } })
    .build();
  const binding = createProgramBinding({ cardPrograms: [program] });
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: saved => { kernel.restore(saved.state); kernel.copyLinkedFrom(saved.links); },
    objects: () => kernel.objects,
    perform: action => kernel.perform(action),
    choose: () => true,
    context: (source, controller, timingPoint) => bindResolveContext(kernel, { source, controller, timingPoint }),
  });
  const engine = new ChainEngine({ turnOrder: ['A', 'B'], turnPlayer: 'A', phase: 'main', host, cleanup: () => false });
  binding.registerProgramTriggers(engine, kernel.getObject('left-yone'));
  binding.registerProgramTriggers(engine, kernel.getObject('right-yone'));
  const left = kernel.getObject('left-yone');
  const right = kernel.getObject('right-yone');
  const wave = [
    { timingPoint: 'conquer', kind: 'conquer', object: left, source: left, it: left, player: 'A', batchId: 'two-conquer',
      details: { battlefieldId: 'left', objectId: 'left-yone', playerId: 'A', battlefieldControllerBefore: null } },
    { timingPoint: 'conquer', kind: 'conquer', object: right, source: right, it: right, player: 'A', batchId: 'two-conquer',
      details: { battlefieldId: 'right', objectId: 'right-yone', playerId: 'A', battlefieldControllerBefore: 'B' } },
  ];
  engine.pipeline.emitBatch(wave);
  assert.deepEqual(engine.items.filter(item => item.trigger?.registration.spec.at === 'conquer').map(item => item.trigger.event.details.objectId), ['left-yone']);

  const checkpoint = engine.pipeline.checkpoint();
  const items = engine.items.length;
  const original = engine.pipeline.onTrigger;
  engine.pipeline.onTrigger = () => { throw new Error('matching conquer rejected after scan'); };
  assert.throws(() => engine.emit(wave[0]), /matching conquer rejected after scan/);
  assert.equal(engine.items.length, items);
  assert.equal(engine.pipeline.events.length, checkpoint.log.length);
  assert.deepEqual([...engine.pipeline.checkpoint().consumed.entries()], [...checkpoint.consumed.entries()]);
  engine.pipeline.onTrigger = original;
});

test('EG-FILTER battlefieldWas matches only a strict authoritative conquer event snapshot', () => {
  const object = world().unit('yone').build().getObject('yone');
  const event = {
    type: 'task-resolved', seq: 1, eventId: 1, turnNumber: 1, activePlayerId: 'A',
    taskId: 'conquer:test', sourceCardId: 'card:yone', reason: 'conquer', autoResolved: true,
    timingPoint: 'conquer', kind: 'conquer', player: 'A', batchId: 'wave',
    object,
    source: object,
    it: object,
    details: { battlefieldId: 'bf1', objectId: 'yone', playerId: 'A', battlefieldControllerBefore: null },
  };
  const filter = { event: 'conquer', details: { battlefieldControllerBefore: null } };
  assert.equal(matchesTriggerEvent(filter, event, 'A'), true);
  assert.equal(matchesTriggerEvent(filter, {
    ...event, details: { ...event.details, battlefieldControllerBefore: 'B' },
  }, 'A'), false);
  assert.equal(matchesTriggerEvent(filter, {
    ...event, details: { battlefieldId: 'bf1', objectId: 'yone', playerId: 'A' },
  }, 'A'), false);
  assert.equal(matchesTriggerEvent(filter, {
    ...event, details: { ...event.details, battlefieldId: undefined },
  }, 'A'), false);
  assert.equal(matchesTriggerEvent(filter, {
    ...event, details: { ...event.details, objectId: 'other' },
  }, 'A'), false);
  assert.equal(matchesTriggerEvent(filter, {
    ...event, object: { ...event.object, ref: { ...event.object.ref, zoneEntryId: 2 } },
  }, 'A'), false);
  assert.equal(matchesTriggerEvent(filter, {
    ...event, timingPoint: 'hold', kind: 'hold',
  }, 'A'), false);
});

test('EG-FILTER translates nested bodies, modes, picks and count filters without rewriting literal data', () => {
  const leaf = { id: 'leaf', op: 'effect.damage', args: { amount: c(1), domains: c(['Fury', 'Mind']), refs: c([{ id: 'x', zoneEntryId: 7 }]) }, targets: [{ id: 'chosen', filter: { type: 'unit', here: true } }], picks: [{ id: 'cost', options: [], filter: { role: 'other-friendly' } }] };
  const body = [{ id: 'outer', op: 'sequence', args: { body: c([leaf]), modes: c([{ id: 'm', body: [leaf] }]), amount: { kind: 'count', subject: 'objects', filter: { types: ['unit'], here: true } } }, condition: { kind: 'compare', left: { kind: 'count', subject: 'objects', filter: { here: true } }, operator: 'gte', right: c(1) } }];
  const before = structuredClone(body);
  const [translated] = translateInstructionTargets(body);
  const nested = translated.args.body.value[0];
  assert.deepEqual(nested.args.domains, c(['Fury', 'Mind']));
  assert.deepEqual(nested.args.refs, c([{ id: 'x', zoneEntryId: 7 }]));
  assert.deepEqual(nested.targets[0].filter, { type: 'unit', sameLocationAs: 'self' });
  assert.deepEqual(nested.picks[0].filter, { controller: 'self', exclude: 'self' });
  assert.deepEqual(translated.args.modes.value[0].body, [nested]);
  assert.deepEqual(translated.args.amount.filter, { type: ['unit'], sameLocationAs: 'self' });
  assert.deepEqual(translated.condition.left.filter, { sameLocationAs: 'self' });
  assert.equal(translated.targets, undefined);
  assert.deepEqual(body, before);
});

test('EG-FILTER Kinkou Monk original trigger and body buff a chosen other friendly Unit through the production chain', () => {
  const f = monkFixture();
  f.play('monk');
  settle(f.engine);
  assert.equal(f.get('ally').buffs, 1);
  assert.equal(f.get('monk').buffs, 0);
  assert.equal(f.get('enemy').buffs, 0);
  assert.equal(f.get('ally').energy, null);
  assert.equal(f.get('ally').power, null);
  assert.equal(f.kernel.player('A').energy, 0);
  assert.deepEqual(f.kernel.player('A').power, []);
  assert.deepEqual(f.errors, []);
  assert.equal(f.engine.pipeline.events.filter(event => event.timingPoint === 'buff-added').length, 1);
});

test('EG-FILTER Kinkou Monk original up-to declaration accepts zero and revalidates a departed target', () => {
  const zero = monkFixture([]);
  zero.play('monk');
  settle(zero.engine);
  assert.equal(zero.get('ally').buffs, 0);
  const stale = monkFixture();
  stale.play('monk');
  const before = stale.ref('ally');
  assert.equal(stale.engine.commit({ type: 'return-to-hand', object: before }).status, 'done');
  stale.engine.advance();
  settle(stale.engine);
  assert.equal(stale.get('ally').buffs, 0);
  assert.notDeepEqual(stale.ref('ally'), before);
  assert.equal(stale.engine.pipeline.events.filter(event => event.timingPoint === 'buff-added').length, 0);
});

test('EG-FILTER Kinkou Monk rejects a foreign-controller answer and rolls back the play transaction', () => {
  const f = monkFixture(['enemy']);
  const before = f.kernel.stateForTest();
  assert.throws(() => f.play('monk'), /target|candidate|selection/i);
  assert.deepEqual(f.kernel.stateForTest(), before);
  assert.equal(f.engine.items.length, 0);
  assert.equal(f.engine.pipeline.events.length, 0);
  assert.equal(f.get('monk').zone, 'hand');
});

test('EG-FILTER Piercing Light original body deals both printed 2s to distinct locked targets', () => {
  const f = spellFixture();
  f.play('spell');
  settle(f.engine);
  assert.equal(f.get('first').damage, 2);
  assert.equal(f.get('second').damage, 2);
  assert.equal(f.get('spell').zone, 'trash');
  assert.deepEqual(f.errors, []);
});

test('EG-FILTER Piercing Light original second up-to target may be empty or become a new zone incarnation', () => {
  const zero = spellFixture([]);
  zero.play('spell');
  settle(zero.engine);
  assert.equal(zero.get('first').damage, 2);
  assert.equal(zero.get('second').damage, 0);
  const stale = spellFixture();
  stale.play('spell');
  const original = stale.ref('second');
  assert.equal(stale.engine.commit({ type: 'return-to-hand', object: original }).status, 'done');
  assert.equal(stale.engine.commit({ type: 'move-zone', object: stale.ref('second'), to: 'battlefield', location: field('one') }).status, 'done');
  stale.engine.advance();
  settle(stale.engine);
  assert.equal(stale.get('first').damage, 2);
  assert.equal(stale.get('second').damage, 0);
  assert.notDeepEqual(stale.ref('second'), original);
});

test('EG-FILTER Crackshot Corsair original target/body uses the source current location on resolve', () => {
  function start() {
    const f = fixture({ answers: { 'target:crackshot.enemy-unit-here': ['enemy'] }, setup(builder) {
      builder.unit('source', { might: 3, location: field('one') });
      builder.unit('enemy', { owner: 'B', might: 5, location: field('one') });
    } });
    // The attack producer is outside this seam. Submit the unchanged body as
    // an ability of a real Board source through the default Chain assembly.
    f.engine.execute({ id: 'crackshot-body', controller: 'A', source: f.get('source'), kind: 'activated', speed: 'normal', body: translateInstructionTargets(triggered(crackshotCorsair).body) });
    return f;
  }
  const f = start();
  settle(f.engine);
  assert.equal(f.get('enemy').damage, 1);
  const moved = start();
  assert.equal(moved.engine.commit({ type: 'move-location', object: moved.ref('enemy'), to: field('two') }).status, 'done');
  moved.engine.advance();
  settle(moved.engine);
  assert.equal(moved.get('enemy').damage, 0);
});

test('EG-FILTER Ruined Rex original self trigger resolves from a real kill LKI snapshot', () => {
  const program = admitAbility('test:eg-filter-rex-trigger', triggered(ruinedRex));
  const f = fixture({ programs: [program], answers: { 'target:ruined-rex.enemy-unit': ['enemy'] }, setup(builder) {
    builder.unit('rex', { cardId: program.canonicalCardId, might: 5, location: field('one') });
    builder.unit('enemy', { owner: 'B', might: 6, location: field('one') });
  } });
  f.binding.registerProgramTriggers(f.engine, f.get('rex'));
  const ref = f.ref('rex');
  assert.equal(f.engine.commit({ type: 'kill', object: ref }).status, 'done');
  const killed = f.engine.pipeline.events.find(event => event.timingPoint === 'object-killed');
  assert.deepEqual(killed.object.ref, ref);
  assert.equal(killed.object.zone, 'board');
  f.engine.advance();
  settle(f.engine);
  assert.equal(f.get('enemy').damage, 4);
  assert.equal(f.get('rex').zone, 'trash');
  assert.notDeepEqual(f.ref('rex'), ref);
  assert.deepEqual(f.errors, []);
});

test('EG-FILTER keeps the original official admission guards and raw IR untouched', () => {
  for (const program of [kinkouMonk, piercingLight, crackshotCorsair, ruinedRex]) {
    const before = structuredClone(program);
    for (const ability of program.abilities) if ('body' in ability) translateInstructionTargets(ability.body);
    assert.deepEqual(program, before);
    assert.equal(program.status, 'judge-required');
    assert.throws(() => new ProgramRegistry([program]).get(program.canonicalCardId), error => error instanceof ProgramBindingError && error.code === 'judge-required');
  }
});
