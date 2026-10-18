import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, trigger, resolveAll } from '../chain/helpers.mjs';
import {
  additionalTriggerRule,
  createTriggerRuleStaticBinder,
  multiplyTriggerRule,
  suppressTriggerRule,
  triggerRuleFromStaticEffect,
} from '../../dist/events/trigger-rules/index.js';
import { createProgramBinding } from '../../dist/programs/index.js';
import { matchesTriggerEvent } from '../../dist/events/pipeline-match.js';
import { triggerEventObjectBinding } from '../../dist/events/pipeline-types.js';
import frigidJewel from '../../../card-dsl/dist/cards/unl/frigid-jewel.js';
import karthusEternal from '../../../card-dsl/dist/cards/ogn/karthus-eternal.js';

test('EG-PIPELINE: one per-batch trigger is collected for an atomic multi-object draw, then a new batch is independent', () => {
  const f = fixture();
  trigger(f, 'once-per-batch', { body: [], spec: { at: 'card-drawn', once: 'per-batch' } });

  f.engine.commit({ type: 'draw', player: 'A', amount: 2 });
  assert.equal(f.engine.items.length, 1);
  assert.equal(f.engine.items[0].trigger.batchId, f.engine.pipeline.events.find(event => event.timingPoint === 'card-drawn').batchId);

  f.engine.advance();
  resolveAll(f.engine);
  f.engine.commit({ type: 'draw', player: 'A', amount: 1 });
  assert.equal(f.engine.items.length, 1);
  assert.notEqual(f.engine.items[0].trigger.batchId, f.engine.pipeline.events[0].batchId);
});

test('EG-PIPELINE: relative player filtering uses the authoritative event player', () => {
  const f = fixture();
  trigger(f, 'self-score', { body: [], spec: { at: 'score', filter: { event: 'scored', player: 'self' } } });
  trigger(f, 'opponent-score', { body: [], spec: { at: 'score', filter: { event: 'scored', player: 'opponent' } } });

  f.engine.pipeline.emitBatch([{ timingPoint: 'score', kind: 'scored', player: 'A', amount: 1 }]);
  assert.deepEqual(f.engine.items.map(item => item.trigger.registration.id), ['self-score']);
  f.engine.advance();
  resolveAll(f.engine);
  f.engine.pipeline.emitBatch([{ timingPoint: 'score', kind: 'scored', player: 'B', amount: 1 }]);
  assert.deepEqual(f.engine.items.map(item => item.trigger.registration.id), ['opponent-score']);
});

test('EG-PIPELINE: collection-stage multiplicity creates independent pending items', () => {
  const f = fixture({ choose: request => request.type === 'mode' ? request.options.at(-1) : undefined });
  trigger(f, 'amplified', { body: [], spec: { at: 'card-drawn' } });
  f.engine.pipeline.registerMultiplicityRule(additionalTriggerRule({
    id: 'test-amplifier',
    matches: ({ event }) => event.timingPoint === 'card-drawn' && event.player === 'A',
  }));

  f.engine.commit({ type: 'draw', player: 'A', amount: 1 });
  assert.equal(f.engine.items.length, 2);
  assert.deepEqual(f.engine.items.map(item => item.trigger.registration.id), ['amplified', 'amplified']);
  assert.deepEqual(f.engine.items.map(item => item.trigger.multiplicity), [2, 2]);
});

test('EG-PIPELINE: source-scoped suppression follows zone lifecycle and is collected before chain entry', () => {
  const f = fixture();
  trigger(f, 'temporary', { body: [], activeZones: ['board', 'hand'], spec: { at: 'card-drawn' } });
  f.engine.pipeline.registerSuppressionRule(suppressTriggerRule({
    id: 'test-suppression',
    source: f.kernel.getObject('source'),
    activeZones: ['board'],
    matches: ({ registration, event }) => registration.id === 'temporary' && event.timingPoint === 'card-drawn',
  }));

  f.engine.commit({ type: 'draw', player: 'A', amount: 1 });
  assert.equal(f.engine.items.length, 0);

  f.engine.commit({ type: 'move-zone', object: f.kernel.ref('source'), to: 'hand' });
  f.engine.pipeline.emitBatch([{ timingPoint: 'card-drawn', player: 'A', amount: 1 }]);
  assert.equal(f.engine.items.length, 1);
});

test('EG-PIPELINE: malformed trigger ordering rolls back events, frequency usage, and dynamic rules', () => {
  const f = fixture({ choose: request => request.type === 'mode' ? 'missing' : undefined });
  trigger(f, 'one', { body: [], spec: { at: 'turn-end', once: 'per-turn' } });
  trigger(f, 'two', { body: [], spec: { at: 'turn-end' } });
  f.engine.pipeline.registerTriggerRule(additionalTriggerRule({
    id: 'rollback-rule',
    matches: ({ event }) => event.timingPoint === 'turn-end',
  }));

  assert.throws(() => f.engine.emit({ timingPoint: 'turn-end' }), /Invalid trigger order/);
  assert.equal(f.engine.pipeline.events.length, 0);
  assert.equal(f.engine.items.length, 0);

  // The rule remains registered after a failed action checkpoint, while the
  // failed batch and its once reservation do not.
  const before = f.engine.pipeline.events.length;
  f.engine.pipeline.unregisterTrigger('two');
  f.engine.emit({ timingPoint: 'turn-end' });
  assert.equal(f.engine.pipeline.events.filter(event => event.timingPoint === 'turn-end').length, 1);
  assert.equal(f.engine.items.length, 1);
});

test('EG-PIPELINE: original Frigid Jewel IR reaches the production binding and fires once for a two-card draw', () => {
  const program = { ...frigidJewel, status: 'executable', judgeReason: undefined };
  const f = fixture({
    choose: request => {
      if (request.type === 'select-objects' && request.id === 'target:frigid-jewel.friendly-unit') {
        return [request.options.find(option => option.id === 'ally')];
      }
      return undefined;
    },
  });
  f.kernel.addObject({
    ...f.kernel.getObject('source'),
    ref: { id: 'jewel', zoneEntryId: 1 },
    cardId: program.canonicalCardId,
    types: ['gear'],
    zone: 'board',
    location: { type: 'base', player: 'A' },
  }, 'board');
  f.kernel.addObject({
    ...f.kernel.getObject('source'),
    ref: { id: 'ally', zoneEntryId: 1 },
    cardId: 'card:ally',
    types: ['unit'],
    zone: 'board',
    location: { type: 'base', player: 'A' },
  }, 'board');
  const binding = createProgramBinding({ cardPrograms: [program] });
  assert.deepEqual(binding.registerProgramTriggers(f.engine, f.kernel.getObject('jewel')), ['program:jewel:1:0']);

  assert.equal(f.engine.commit({ type: 'draw', player: 'A', amount: 2 }).status, 'done');
  assert.equal(f.engine.items.length, 1);
  assert.equal(f.engine.items[0].trigger.registration.id, 'program:jewel:1:0');
  assert.equal(f.engine.items[0].trigger.batchId, f.engine.pipeline.events.find(event => event.timingPoint === 'card-drawn').batchId);

  f.engine.advance();
  resolveAll(f.engine);
  const registrations = f.engine.layers.registry.list();
  assert.equal(registrations.length, 1);
  assert.equal(registrations[0].effect.filter.objectId, 'ally');
  assert.equal(f.engine.layers.snapshot(f.kernel.ref('ally')).might, 4);
  assert.deepEqual(program.abilities, frigidJewel.abilities);
  assert.equal(frigidJewel.status, 'judge-required');
});

test('EG-PIPELINE: raw static multiplicity IR binds at entry and unbinds at exit', () => {
  const f = fixture();
  const source = f.kernel.getObject('source');
  const rule = triggerRuleFromStaticEffect(karthusEternal.abilities[0].effect, source);
  assert.equal(rule.mode, 'additional');
  assert.equal(rule.amount, 1);
  const binder = createTriggerRuleStaticBinder(f.engine.pipeline);
  const handle = binder.bindStatic(karthusEternal.abilities[0], source);
  assert.equal(f.engine.pipeline.rules.size, 1);
  handle.unbind();
  assert.equal(f.engine.pipeline.rules.size, 0);
});

test('EG-PIPELINE: evidence-backed static multiplicity applies only to matching Deathknell triggers', () => {
  const f = fixture({ choose: request => request.type === 'mode' ? request.options.at(-1) : undefined });
  const source = f.kernel.getObject('source');
  const rule = triggerRuleFromStaticEffect({
    kind: 'continuous.trigger-multiplicity',
    mode: 'additional',
    amount: { kind: 'constant', value: 1 },
    appliesTo: { keyword: 'deathknell', controller: 'controller', zone: 'board' },
  }, source);
  f.engine.pipeline.registerTriggerRule(rule);
  f.kernel.addObject({ ...source, ref: { id: 'deathknell', zoneEntryId: 1 }, cardId: 'card:deathknell', keywords: [{ id: 'Deathknell' }] }, 'board');
  f.kernel.addObject({ ...source, ref: { id: 'plain', zoneEntryId: 1 }, cardId: 'card:plain', keywords: [] }, 'board');
  f.engine.pipeline.registerTrigger({
    id: 'deathknell', source: f.kernel.getObject('deathknell'), controller: 'A',
    spec: { at: 'object-killed', filter: { objectId: 'deathknell' } }, body: [],
  });
  f.engine.pipeline.registerTrigger({
    id: 'plain', source: f.kernel.getObject('plain'), controller: 'A',
    spec: { at: 'object-killed', filter: { objectId: 'deathknell' } }, body: [],
  });
  f.engine.pipeline.emitBatch([{ timingPoint: 'object-killed', object: f.kernel.getObject('deathknell'), player: 'A', batchId: 'death-batch' }]);
  const ids = f.engine.items.map(item => item.trigger.registration.id);
  assert.equal(ids.filter(id => id === 'deathknell').length, 2);
  assert.equal(ids.filter(id => id === 'plain').length, 1);
});

test('EG-PIPELINE: an invalid static trigger-rule shape fails closed before registration', () => {
  const f = fixture();
  assert.throws(() => triggerRuleFromStaticEffect({
    kind: 'continuous.trigger-multiplicity',
    mode: 'additional',
    amount: { kind: 'constant', value: 1 },
    appliesTo: { keyword: 'deathknell', unsupported: true },
  }, f.kernel.getObject('source')), /Unsupported static trigger appliesTo field unsupported/);
  assert.equal(f.engine.pipeline.rules.size, 0);
});

test('EG-PIPELINE: EventPattern.it matches only the real immutable event-role snapshot', () => {
  const f = fixture();
  const object = f.kernel.getObject('source');
  const it = { ...object, ref: { id: 'event-it', zoneEntryId: 7 }, cardId: 'card:event-it' };
  const event = f.engine.pipeline.emitBatch([{
    timingPoint: 'buff-added', kind: 'buff-added', object, source: object,
    target: object, it, player: 'A', batchId: 'event-it-batch',
  }])[0];
  assert.deepEqual(event.it.ref, it.ref);
  assert.equal(matchesTriggerEvent({ event: 'buff-added', it: { objectId: 'event-it', zoneEntryId: 7 } }, event, 'A'), true);
  assert.equal(matchesTriggerEvent({ event: 'buff-added', it: { objectId: 'source', zoneEntryId: 1 } }, event, 'A'), false);
  assert.equal(matchesTriggerEvent({ event: 'buff-added', it: { objectId: 'event-it', zoneEntryId: 7 } }, { ...event, it: undefined }, 'A'), false);
});

test('EG-PIPELINE: missing EventPattern.it fails closed even when object and target match', () => {
  const f = fixture();
  const object = f.kernel.getObject('source');
  const event = f.engine.pipeline.emitBatch([{
    timingPoint: 'buff-added', kind: 'buff-added', object, source: object,
    target: object, player: 'A', batchId: 'missing-it-batch',
  }])[0];
  assert.equal(matchesTriggerEvent({ event: 'buff-added', it: {} }, event, 'A'), false);
  assert.equal(matchesTriggerEvent({ event: 'buff-added', it: { objectId: object.ref.id, zoneEntryId: object.ref.zoneEntryId } }, event, 'A'), false);
});

test('EG-PIPELINE: relative controller conditions resolve from the trigger-time controller', () => {
  const f = fixture();
  trigger(f, 'relative-condition', {
    body: [],
    spec: {
      at: 'card-drawn',
      condition: {
        kind: 'compare',
        left: { kind: 'count', subject: 'objects', filter: { type: 'unit', controller: 'self', zone: 'board' } },
        operator: 'gte',
        right: { kind: 'constant', value: 1 },
      },
    },
  });
  f.kernel.addObject({
    ...f.kernel.getObject('source'), ref: { id: 'own-unit', zoneEntryId: 1 },
    cardId: 'card:own-unit', types: ['unit'], controller: 'A', owner: 'A', zone: 'board',
  }, 'board');
  f.kernel.addObject({
    ...f.kernel.getObject('source'), ref: { id: 'foreign-unit', zoneEntryId: 1 },
    cardId: 'card:foreign-unit', types: ['unit'], controller: 'B', owner: 'B', zone: 'board',
  }, 'board');

  f.engine.pipeline.emitBatch([{ timingPoint: 'card-drawn', player: 'A', batchId: 'condition-a' }]);
  assert.equal(f.engine.items.length, 1);
  f.engine.advance();
  resolveAll(f.engine);

  // The trigger belongs to A even when the event is authored by B.  Its
  // relative "self" condition remains A's perspective and sees A's unit.
  f.engine.pipeline.emitBatch([{ timingPoint: 'card-drawn', player: 'B', batchId: 'condition-b' }]);
  assert.equal(f.engine.items.length, 1);
  f.engine.advance();
  resolveAll(f.engine);
});

test('EG-PIPELINE: a multiplicity wave gives each independent trigger its own prompt and order identity', () => {
  const requests = [];
  const f = fixture({
    choose: request => {
      requests.push(request);
      if (request.type === 'optional') return true;
      if (request.type === 'mode') return request.options.at(-1);
      return undefined;
    },
  });
  trigger(f, 'optional-amplified', {
    optional: true,
    body: [],
    spec: { at: 'card-drawn' },
  });
  f.engine.pipeline.registerMultiplicityRule(additionalTriggerRule({
    id: 'independent-amplifier',
    matches: ({ event }) => event.timingPoint === 'card-drawn',
  }));

  f.engine.commit({ type: 'draw', player: 'A', amount: 1 });
  assert.equal(f.engine.items.length, 2);
  const optionalRequests = requests.filter(request => request.type === 'optional');
  assert.equal(optionalRequests.length, 2);
  assert.equal(new Set(optionalRequests.map(request => request.id)).size, 2);
  const orderRequests = requests.filter(request => request.type === 'mode');
  assert.equal(orderRequests.length, 1);
  assert.equal(new Set(orderRequests[0].options).size, 2);
});

test('EG-PIPELINE: conflicting explicit batch identities fail before publishing an event', () => {
  const f = fixture();
  assert.throws(() => f.engine.pipeline.emitBatch([
    { timingPoint: 'card-drawn', player: 'A', batchId: 'batch-a' },
    { timingPoint: 'card-drawn', player: 'A', batchId: 'batch-b' },
  ]), /share a batch identity/);
  assert.equal(f.engine.pipeline.events.length, 0);
  assert.equal(f.engine.items.length, 0);
});

test('EG-PIPELINE: a named simultaneous wave remains inside its enclosing atomic action batch', () => {
  const f = fixture();
  trigger(f, 'once-wave', {
    body: [],
    spec: { at: 'conquer', filter: {}, once: 'per-batch' },
  });
  const events = f.engine.pipeline.emitBatch([
    { timingPoint: 'conquer', player: 'A', batchId: 'action-batch', simultaneousGroup: 'score-wave' },
    { timingPoint: 'score', kind: 'scored', player: 'A', batchId: 'action-batch', simultaneousGroup: 'score-wave' },
  ]);
  assert.deepEqual(events.map(event => event.batchId), ['action-batch', 'action-batch']);
  assert.deepEqual(events.map(event => event.simultaneousGroup), ['score-wave', 'score-wave']);
  assert.equal(f.engine.items.length, 1);
});

test('EG-PIPELINE: an explicit once cap permits N finalizations per turn and then stops', () => {
  const f = fixture();
  trigger(f, 'twice-per-turn', {
    body: [],
    maxPerScope: 2,
    spec: { at: 'card-drawn', filter: {}, once: 'per-turn' },
  });

  for (let draw = 0; draw < 2; draw++) {
    f.engine.commit({ type: 'draw', player: 'A', amount: 1 });
    assert.equal(f.engine.items.length, 1);
    f.engine.advance();
    resolveAll(f.engine);
  }
  f.engine.commit({ type: 'draw', player: 'A', amount: 1 });
  assert.equal(f.engine.items.length, 0);
});

test('EG-PIPELINE: malformed trigger caps and rule amounts fail closed at registration', () => {
  const f = fixture();
  const source = f.kernel.getObject('source');
  assert.throws(() => f.engine.pipeline.registerTrigger({
    id: 'invalid-cap',
    source,
    controller: 'A',
    spec: { at: 'card-drawn', filter: {}, once: 'per-turn' },
    body: [],
    maxPerScope: 1.5,
  }), /nonnegative safe integer/);
  assert.equal(f.engine.pipeline.triggers.size, 0);
  assert.throws(() => f.engine.pipeline.registerTriggerRule({
    id: 'invalid-amount',
    mode: 'additional',
    amount: -1,
    matches: () => true,
  }), /nonnegative safe integer/);
  assert.equal(f.engine.pipeline.rules.size, 0);
});

test('EG-PIPELINE: unordered additional and multiply rules roll back instead of choosing an id order', () => {
  const f = fixture();
  trigger(f, 'ordered-by-rule', { body: [], spec: { at: 'card-drawn' } });
  f.engine.pipeline.registerTriggerRule(additionalTriggerRule({
    id: 'z-additional',
    matches: ({ event }) => event.timingPoint === 'card-drawn',
  }));
  f.engine.pipeline.registerTriggerRule(multiplyTriggerRule({
    id: 'a-multiply',
    amount: 2,
    matches: ({ event }) => event.timingPoint === 'card-drawn',
  }));

  const before = f.kernel.player('A').deckSize;
  assert.throws(() => f.engine.commit({ type: 'draw', player: 'A', amount: 1 }), /authoritative ordering/);
  assert.equal(f.kernel.player('A').deckSize, before);
  assert.equal(f.engine.pipeline.events.length, 0);
  assert.equal(f.engine.items.length, 0);
});

test('EG-PIPELINE: event and trigger snapshots preserve the same immutable event identity', () => {
  const f = fixture();
  const object = f.kernel.getObject('source');
  const it = { ...object, ref: { id: 'immutable-it', zoneEntryId: 3 } };
  let liveEvent;
  f.engine.pipeline.onEvent = event => {
    assert.equal(Object.isFrozen(event), true);
    if (event.timingPoint === 'buff-added') {
      liveEvent = event;
      assert.equal(Object.isFrozen(event.it), true);
      assert.equal(Object.isFrozen(event.it.ref), true);
      assert.throws(() => { event.it.ref.id = 'mutated'; }, TypeError);
    }
  };
  f.engine.pipeline.registerTrigger({
    id: 'immutable-hit',
    source: object,
    controller: 'A',
    // The shared EventPattern validator is owned by RIFT-845 and still omits
    // `it`; this test exercises the pipeline snapshot contract without
    // pretending that production registration has accepted the typed field.
    spec: { at: 'buff-added', filter: {} },
    body: [],
  });
  f.engine.pipeline.emitBatch([{
    timingPoint: 'buff-added', kind: 'buff-added', object, source: object, it, player: 'A', batchId: 'immutable-batch',
  }]);
  assert.equal(f.engine.items.length, 1);
  assert.ok(liveEvent);
  const trigger = f.engine.items[0].trigger;
  it.ref.id = 'outside-mutation';
  assert.equal(liveEvent.it.ref.id, 'immutable-it');
  assert.equal(trigger.event.eventId, liveEvent.eventId);
  assert.deepEqual(trigger.event.it.ref, liveEvent.it.ref);
  assert.deepEqual(trigger.event.it.ref, { id: 'immutable-it', zoneEntryId: 3 });
  assert.equal(trigger.event.it.ref.id, 'immutable-it');

  const binding = triggerEventObjectBinding(trigger, 'it');
  assert.ok(binding);
  assert.equal(binding.eventId, trigger.event.eventId);
  assert.equal(binding.role, 'it');
  assert.deepEqual(binding.ref, trigger.event.it.ref);
  assert.deepEqual(binding.snapshot.ref, binding.ref);
  assert.equal(Object.isFrozen(binding), true);
  assert.equal(Object.isFrozen(binding.snapshot.ref), true);

  const oldIt = structuredClone(binding.ref);
  const oldRef = f.kernel.ref('source');
  assert.equal(f.engine.commit({ type: 'move-zone', object: oldRef, to: 'hand' }).status, 'done');
  assert.notEqual(f.kernel.ref('source').zoneEntryId, oldRef.zoneEntryId);
  assert.deepEqual(binding.ref, oldIt);
  assert.deepEqual(triggerEventObjectBinding({ ...trigger, event: { ...trigger.event, it: undefined } }, 'it'), null);
});
