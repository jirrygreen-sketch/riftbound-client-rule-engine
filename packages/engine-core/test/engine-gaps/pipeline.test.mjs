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
import { matchesMightyTransition } from '../../dist/events/pipeline-match.js';
import { deriveMightChangedEmissions } from '../../dist/events/producers/might-change.js';
import { triggerEventObjectBinding } from '../../dist/events/pipeline-types.js';
import { EventPipeline } from '../../dist/events/pipeline.js';
import { createActionPipelineHost } from '../../dist/events/action-adapter.js';
import { bindResolveContext } from '../../dist/events/action-adapter.js';
import { AwaitChoice } from '../../dist/effects/contract.js';
import { world } from '../../dist/effects/testing/index.js';
// Official ordering evidence (checked 2026-10-19): CR v1.5 (2026-10-09)
// https://cmsassets.rgpub.io/sanity/files/dsfx7636/news_live/5c7946f7c3b8c6e0faff85ab6dadc6d2e721ea94.pdf
// 303.2.a / 383.3.d / 383.3.d.1: simultaneous triggers are placed by turn
// order from the current turn player; each controller chooses its own order.
// Radiance patch notes (published 2026-10-09, effective 2026-10-16):
// https://playriftbound.com/en-us/news/announcements/core-rules-radiance-patch-notes-effective-october-16-2026/
// Its Chronobreak ruling gives each player control of their own units' order;
// the players place their groups in turn order. This is not one global FIFO or
// LIFO order, and no card receives a hard-coded numeric priority.
import frigidJewel from '../../../card-dsl/dist/cards/unl/frigid-jewel.js';
import karthusEternal from '../../../card-dsl/dist/cards/ogn/karthus-eternal.js';
import chronobreak from '../../../card-dsl/dist/cards/rad/chronobreak.js';

function f_event(emission, batchId) {
  if (emission === undefined) return null;
  return Object.freeze({
    type: 'task-resolved', seq: 1, eventId: 1, turnNumber: 1, activePlayerId: 'A',
    taskId: 'mighty-test', sourceCardId: emission.object.cardId ?? '',
    reason: 'might-changed', autoResolved: true, timingPoint: emission.timingPoint,
    kind: emission.kind, object: emission.object, it: emission.object, player: 'A',
    batchId, details: { ...emission.details, before: emission.before, after: emission.after },
  });
}

test('EG-PIPELINE: one per-batch trigger is collected for an atomic multi-object draw, then a new batch is independent', () => {
  const f = fixture({ choose: request => request.type === 'mode' ? request.options[0] : undefined });
  trigger(f, 'once-per-batch', { body: [], spec: { at: 'card-drawn', once: 'per-batch' } });

  f.engine.commit({ type: 'draw', player: 'A', amount: 2 });
  assert.equal(f.engine.items.length, 2);
  assert.equal(f.engine.items[0].trigger.batchId, f.engine.pipeline.events.find(event => event.timingPoint === 'card-drawn').batchId);
  assert.notEqual(f.engine.items[0].trigger.event.eventId, f.engine.items[1].trigger.event.eventId);

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
  let validOrder = false;
  const f = fixture({ choose: request => request.type === 'mode' ? (validOrder ? request.options[0] : 'missing') : undefined });
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
  validOrder = true;
  f.engine.pipeline.unregisterTrigger('two');
  f.engine.emit({ timingPoint: 'turn-end' });
  assert.equal(f.engine.pipeline.events.filter(event => event.timingPoint === 'turn-end').length, 1);
  assert.equal(f.engine.items.length, 2);
  f.engine.advance();
  assert.equal(f.engine.items.length, 1);
});

test('EG-PIPELINE: original Frigid Jewel IR reaches the production binding and fires once for a two-card draw', () => {
  const program = { ...frigidJewel, status: 'executable', judgeReason: undefined };
  const f = fixture({
    choose: request => {
      if (request.type === 'mode' && /order/.test(request.id)) return request.options[0];
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
  // Two card-drawn instances are preserved so the controller can choose the
  // instance serving as the Nth-time condition; Finalize consumes once.
  assert.equal(f.engine.items.length, 2);
  assert.equal(f.engine.items[0].trigger.registration.id, 'program:jewel:1:0');
  assert.equal(f.engine.items[0].trigger.batchId, f.engine.pipeline.events.find(event => event.timingPoint === 'card-drawn').batchId);
  assert.notEqual(f.engine.items[0].trigger.event.eventId, f.engine.items[1].trigger.event.eventId);

  f.engine.advance();
  assert.equal(f.engine.items.length, 1);
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

test('EG-PIPELINE: simultaneous controllers are ordered by turn order and choose only their own groups', () => {
  const f = fixture({ choose: request => {
    if (request.type !== 'mode') return undefined;
    // Deliberately reverse the insertion order. The controller decision, not
    // registration/event array order, must determine each player's group.
    return request.options.at(-1);
  } });
  const ownA = f.kernel.getObject('source');
  f.kernel.addObject({
    ...ownA, ref: { id: 'b-source', zoneEntryId: 1 }, cardId: 'card:b-source',
    controller: 'B', owner: 'B', zone: 'board', location: { type: 'base', player: 'B' },
  }, 'board');
  for (const id of ['a-first', 'a-second']) {
    f.engine.pipeline.registerTrigger({
      id, source: ownA, controller: 'A',
      spec: { at: 'turn-end', filter: {} }, body: [],
    });
  }
  for (const id of ['b-first', 'b-second']) {
    f.engine.pipeline.registerTrigger({
      id, source: f.kernel.getObject('b-source'), controller: 'B',
      spec: { at: 'turn-end', filter: {} }, body: [],
    });
  }

  f.engine.pipeline.emitBatch([{ timingPoint: 'turn-end', player: 'A', batchId: 'official-order-wave' }]);
  assert.deepEqual(f.engine.items.map(item => item.trigger.registration.id),
    ['a-second', 'a-first', 'b-second', 'b-first']);
  assert.deepEqual(f.engine.items.map(item => item.controller), ['A', 'A', 'B', 'B']);
  assert.ok(f.engine.items.every(item => item.trigger.event.batchId === 'official-order-wave'));
  assert.equal(new Set(f.engine.items.map(item => item.trigger.event.eventId)).size, 1);
});

test('EG-PIPELINE: official Chronobreak ruling anchors player-grouped turn order to its canonical card', () => {
  assert.equal(chronobreak.canonicalCardId, 'card.hash-2875b065844462e761acfeb152cf2feea180924a496740b05903caac24a3d795');
  assert.equal(chronobreak.rulesetVersion, 'core-1.5');
  assert.equal(chronobreak.status, 'judge-required', 'ordering evidence alone does not make the unsupported card executable');
  assert.match(chronobreak.sourceText, /You choose the order/);
});

test('EG-PIPELINE: registeredTriggers returns immutable snapshots and named activation is neutral and deferred', () => {
  // Official evidence (checked 2026-10-19): CR v1.5 383.4.g.1/.g.2 requires
  // checking the remaining conditions while the named portion is treated as
  // fulfilled, with no actual named event. Core Rules updated 2026-10-09,
  // effective 2026-10-16.
  // https://cmsassets.rgpub.io/sanity/files/dsfx7636/news_live/5c7946f7c3b8c6e0faff85ab6dadc6d2e721ea94.pdf
  // Timeline: choose legal live trigger -> prepare neutral activation ->
  // install Pending in the caller transaction -> consume once at Finalize.
  const f = fixture();
  const source = f.kernel.getObject('source');
  f.engine.pipeline.registerTrigger({
    id: 'named-once', source, controller: 'A',
    spec: { at: 'conquer', filter: { event: 'conquer', object: { objectId: 'source' } }, once: 'per-turn' },
    body: [],
  });
  const listed = f.engine.pipeline.registeredTriggers();
  assert.equal(listed.length, 1);
  assert.equal(listed[0].id, 'named-once');
  assert.equal(Object.isFrozen(listed), true);
  assert.equal(Object.isFrozen(listed[0]), true);
  assert.throws(() => { listed[0].spec.once = 'per-game'; }, TypeError);

  const beforeEvents = f.engine.pipeline.events.length;
  const beforeConsumed = f.engine.pipeline.checkpoint().consumed.size;
  const activation = f.engine.pipeline.activateTrigger('named-once');
  assert.ok(activation);
  assert.equal(activation.kind, 'named-trigger-activation');
  assert.equal('event' in activation, false);
  assert.equal('eventId' in activation, false);
  assert.equal(f.engine.pipeline.events.length, beforeEvents);
  assert.equal(f.engine.pipeline.checkpoint().consumed.size, beforeConsumed);
  assert.equal(activation.consume(), true);
  assert.equal(activation.consume(), false, 'one activation transaction can consume only once');
  assert.equal(f.engine.pipeline.activateTrigger('named-once'), null, 'frequency is exhausted only after commit');
});

test('EG-PIPELINE: named activation rejects stale, inactive, condition-false and real-event-dependent registrations without side effects', () => {
  const f = fixture();
  const source = f.kernel.getObject('source');
  f.engine.pipeline.registerTrigger({
    id: 'named-bound', source, controller: 'A', boundToIncarnation: true, activeZones: ['board'],
    spec: { at: 'hold', filter: { event: 'hold' } }, body: [],
  });
  f.engine.pipeline.registerTrigger({
    id: 'named-hold-base', source, controller: 'A', activeZones: ['board'],
    spec: { at: 'hold', filter: { event: 'hold' } }, body: [],
  });
  f.engine.pipeline.registerTrigger({
    id: 'named-false', source, controller: 'A',
    spec: { at: 'hold', filter: { event: 'hold' }, condition: { kind: 'never' } }, body: [],
  });
  f.engine.pipeline.registerTrigger({
    id: 'named-event-dependent', source, controller: 'A',
    spec: { at: 'hold', filter: { event: 'hold' } },
    body: [{ id: 'needs-event-it', op: 'condition.value', args: { value: { kind: 'event-it', object: 'it' } } }],
  });
  const before = f.engine.pipeline.checkpoint();
  assert.equal(f.engine.pipeline.activateTrigger('named-false'), null);
  assert.equal(f.engine.pipeline.activateTrigger('named-event-dependent'), null);
  assert.equal(f.engine.pipeline.activateTrigger('named-hold-base'), null, 'a named hold is present only at a battlefield');
  f.engine.commit({ type: 'move-zone', object: source.ref, to: 'hand' });
  const afterMove = f.engine.pipeline.checkpoint();
  assert.equal(f.engine.pipeline.activateTrigger('named-bound'), null);
  assert.equal(f.engine.pipeline.checkpoint().consumed.size, afterMove.consumed.size);
  assert.equal(f.engine.pipeline.events.some(event => event.kind === 'named-trigger-activation'), false);
  assert.ok(before.triggers.has('named-bound'));
});

test('EG-PIPELINE: named activation rollback restores frequency and sequence', () => {
  const f = fixture();
  f.engine.pipeline.registerTrigger({
    id: 'named-rollback', source: f.kernel.getObject('source'), controller: 'A',
    spec: { at: 'conquer', filter: { event: 'conquer' }, once: 'per-turn' }, body: [],
  });
  const before = f.engine.pipeline.checkpoint();
  const activation = f.engine.pipeline.activateTrigger('named-rollback');
  assert.ok(activation);
  assert.equal(activation.consume(), true);
  f.engine.pipeline.restore(before);
  const retry = f.engine.pipeline.activateTrigger('named-rollback');
  assert.ok(retry);
  assert.equal(retry.consume(), true);
});

test('EG-PIPELINE: restore permanently invalidates prepared handles without blocking rebuilt transactions', () => {
  const f = fixture();
  const source = f.kernel.getObject('source');
  for (const id of ['first', 'second']) {
    f.engine.pipeline.registerTrigger({
      id, source, controller: 'A',
      spec: { at: 'conquer', filter: { event: 'conquer' }, once: 'per-turn' }, body: [],
    });
  }
  const checkpoint = f.engine.pipeline.checkpoint();
  const beforeEvents = f.engine.pipeline.events.length;
  const staleFirst = f.engine.pipeline.activateTrigger('first');
  assert.ok(staleFirst);
  f.engine.pipeline.restore(checkpoint);
  const liveSecond = f.engine.pipeline.activateTrigger('second');
  assert.ok(liveSecond);
  assert.notEqual(staleFirst.transaction.id, liveSecond.transaction.id);
  assert.equal(staleFirst.consume(), false);
  assert.deepEqual([...f.engine.pipeline.checkpoint().consumed.entries()], []);
  assert.equal(liveSecond.consume(), true);
  assert.equal(liveSecond.consume(), false);
  const consumed = [...f.engine.pipeline.checkpoint().consumed.entries()];
  assert.equal(consumed.length, 1);
  assert.match(consumed[0][0], /"second"/);
  assert.equal(f.engine.pipeline.events.length, beforeEvents);
});

test('EG-PIPELINE: repeated restore invalidates handles created between restores and preserves checkpoint reuse', () => {
  const f = fixture();
  const source = f.kernel.getObject('source');
  f.engine.pipeline.registerTrigger({
    id: 'repeat', source, controller: 'A',
    spec: { at: 'conquer', filter: { event: 'conquer' }, once: 'per-turn' }, body: [],
  });
  const checkpoint = f.engine.pipeline.checkpoint();
  const first = f.engine.pipeline.activateTrigger('repeat');
  f.engine.pipeline.restore(checkpoint);
  const second = f.engine.pipeline.activateTrigger('repeat');
  f.engine.pipeline.restore(checkpoint);
  const third = f.engine.pipeline.activateTrigger('repeat');
  assert.ok(first && second && third);
  assert.equal(new Set([first.transaction.id, second.transaction.id, third.transaction.id]).size, 3);
  assert.equal(first.consume(), false);
  assert.equal(second.consume(), false);
  assert.equal(third.consume(), true);
  assert.equal(third.consume(), false);
  assert.equal(f.engine.pipeline.checkpoint().consumed.size, 1);
  f.engine.pipeline.restore(checkpoint);
  assert.equal(f.engine.pipeline.checkpoint().consumed.size, 0, 'the original checkpoint remains reusable');
  const retry = f.engine.pipeline.activateTrigger('repeat');
  assert.ok(retry);
  assert.equal(retry.consume(), true);
});

test('EG-PIPELINE: independent handles for one registration consume in order and failed retries do not leak frequency', () => {
  const f = fixture();
  f.engine.pipeline.registerTrigger({
    id: 'two-live-tokens', source: f.kernel.getObject('source'), controller: 'A', maxPerScope: 2,
    spec: { at: 'conquer', filter: { event: 'conquer' }, once: 'per-turn' }, body: [],
  });
  const checkpoint = f.engine.pipeline.checkpoint();
  const first = f.engine.pipeline.activateTrigger('two-live-tokens');
  const second = f.engine.pipeline.activateTrigger('two-live-tokens');
  assert.ok(first && second);
  assert.notEqual(first.transaction.id, second.transaction.id);
  assert.equal(first.consume(), true);
  assert.equal(first.consume(), false);
  f.engine.pipeline.restore(checkpoint);
  assert.equal(first.consume(), false);
  assert.equal(second.consume(), false);
  const retry = f.engine.pipeline.activateTrigger('two-live-tokens');
  assert.ok(retry);
  assert.equal(retry.consume(), true);
  assert.equal(retry.consume(), false);
  assert.equal(f.engine.pipeline.checkpoint().consumed.size, 1);
});

test('EG-PIPELINE: post-prepare rejection leaves handles and restored frequency untouched', () => {
  const f = fixture();
  f.engine.pipeline.registerTrigger({
    id: 'post-prepare', source: f.kernel.getObject('source'), controller: 'A',
    spec: { at: 'conquer', filter: { event: 'conquer' }, once: 'per-turn' }, body: [],
  });
  const checkpoint = f.engine.pipeline.checkpoint();
  const rejected = f.engine.pipeline.activateTrigger('post-prepare');
  assert.ok(rejected);
  f.engine.pipeline.restore(checkpoint);
  assert.equal(rejected.consume(), false);
  assert.equal(f.engine.pipeline.checkpoint().consumed.size, 0);
  const accepted = f.engine.pipeline.activateTrigger('post-prepare');
  assert.ok(accepted);
  assert.equal(accepted.consume(), true);
  assert.equal(accepted.consume(), false);
  assert.equal(f.engine.pipeline.checkpoint().consumed.size, 1);
  assert.notEqual(rejected.consume(), true, 'rejection cannot revive after a valid transaction');
});

test('EG-PIPELINE: Mighty transition matcher is typed, frozen to one incarnation, and distinct from static current Might', () => {
  const kernel = world().unit('fiora-target', { might: 4 }).build();
  const before = kernel.getObject('fiora-target');
  const after = { ...before, might: 5 };
  assert.equal(matchesMightyTransition(true, before, after), true);
  assert.equal(matchesMightyTransition(true, { ...before, might: 5 }, { ...after, might: 6 }), false);
  assert.equal(matchesMightyTransition(true, { ...before, might: 5 }, { ...after, might: 4 }), false);
  assert.equal(matchesMightyTransition(true, before, { ...after, controller: 'B' }), false);
  assert.equal(matchesMightyTransition(true, { ...before, ref: { id: before.ref.id, zoneEntryId: 2 } }, after), false);
  assert.equal(matchesMightyTransition(true, { ...before, might: null }, after), false);
  assert.equal(matchesMightyTransition(false, before, after), false);
});

test('EG-PIPELINE: Mighty transition matches a real might-changed emission with frozen before/after/it', () => {
  // Official evidence (checked 2026-10-19): Core Rules v1.5 updated
  // 2026-10-09, effective 2026-10-16, rules 709/710/711 and E-007.
  // https://cmsassets.rgpub.io/sanity/files/dsfx7636/news_live/5c7946f7c3b8c6e0faff85ab6dadc6d2e721ea94.pdf
  // Fiora, Worthy canonical identity:
  // card.hash-261f97a75639fd51dc63b8c4b2a577b52d5bd6893227a1a3a13da5375880fe6f
  // Timeline: board current Might crosses <5 to >=5; freeze before/after and
  // event.it on that incarnation; condition is checked before Pending/Finalize.
  const kernel = world().unit('target', { might: 4 }).build();
  const before = kernel.getObject('target');
  const after = { ...before, might: 5 };
  const derived = deriveMightChangedEmissions([before], [after], { batchId: 'mighty-wave', cause: 'layer-recompute' })[0];
  assert.ok(derived);
  const emission = { ...derived, it: structuredClone(after) };
  assert.ok(emission);
  const events = new EventPipeline(createActionPipelineHost({
    checkpoint: () => null, restore: () => {}, objects: () => [after], perform: () => ({ status: 'impossible', events: [] }),
    choose: () => { throw new Error('unexpected choice'); }, context: () => ({}),
  }), ['A', 'B'], 'A');
  const event = events.emitBatch([emission], undefined, 'mighty-wave')[0];
  assert.equal(matchesTriggerEvent({
    event: 'might-changed', object: { type: 'unit', controller: 'self', becomesMighty: true },
  }, event, 'A'), true);
  assert.deepEqual(event.details.before.ref, before.ref);
  assert.deepEqual(event.details.after.ref, after.ref);
  assert.deepEqual(event.it.ref, after.ref);
  const repeated = f_event(deriveMightChangedEmissions([after], [{ ...after, might: 6 }], { batchId: 'mighty-repeat' })[0], 'mighty-repeat');
  assert.equal(matchesTriggerEvent({
    event: 'might-changed', object: { type: 'unit', controller: 'self', becomesMighty: true },
  }, repeated, 'A'), false);
  const illegal = f_event(deriveMightChangedEmissions([before], [{ ...before, might: 4 }], { batchId: 'mighty-noop' })[0], 'mighty-noop');
  assert.equal(illegal, null);
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

test('EG-PIPELINE: commitContract publishes the host Batch emissions through one trigger scan', () => {
  const kernel = world()
    .unit('source', { might: 2, location: { type: 'base', player: 'A' } })
    .unit('enemy', { owner: 'B', controller: 'B', location: { type: 'battlefield', id: 'battlefield-1' } })
    .build();
  const choose = request => { throw new AwaitChoice(request); };
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: checkpoint => { kernel.restore(checkpoint.state); kernel.copyLinkedFrom(checkpoint.links); },
    objects: () => kernel.objects,
    perform: action => kernel.perform(action),
    performContract: action => kernel.performContract(action),
    performBatchLeaf: (action, batchId) => kernel.performBatchLeafForCapability(action, batchId),
    choose,
    context: (source, controller, timingPoint) => bindResolveContext(kernel, { source, controller, timingPoint, choose }),
    testTrigger: registration => kernel.test(registration.spec.condition),
  });
  const checkpoint = host.checkpoint();
  const pipeline = new EventPipeline(host, ['A', 'B'], 'A');
  const observed = [];
  pipeline.registerTrigger({
    id: 'typed-batch-observer',
    source: kernel.getObject('source'),
    controller: 'A',
    spec: { at: 'object-killed', filter: { event: 'object-killed' }, once: 'per-batch' },
    body: [],
  });
  pipeline.onTrigger = snapshot => observed.push({
    eventId: snapshot.event.eventId,
    batchId: snapshot.batchId,
    objectId: snapshot.event.object.ref.id,
    bothInTrash: kernel.getObject('source').zone === 'trash' && kernel.getObject('enemy').zone === 'trash',
  });
  const outcome = pipeline.commitContract({
    type: 'batch',
    transactionId: 'typed:pipeline-wave',
    actions: [
      { type: 'kill', object: kernel.ref('source') },
      { type: 'kill', object: kernel.ref('enemy') },
    ],
  });
  assert.equal(outcome.status, 'done');
  assert.equal(outcome.receipt.status, 'committed');
  assert.equal(pipeline.events.filter(event => event.timingPoint === 'object-killed').length, 2);
  // The registered observer is once-per-batch; the controller chooses one of
  // the two source events, so only that chosen instance reaches Finalize.
  assert.equal(observed.length, 1);
  assert.ok(observed.every(hit => hit.batchId === 'typed:pipeline-wave' && hit.bothInTrash));
  host.restore(checkpoint);
});

test('EG-PIPELINE: commitContract fails closed when the typed host seam is absent', () => {
  const kernel = world().unit('source').build();
  const f = fixture();
  const checkpoint = f.host.checkpoint();
  const pipeline = new EventPipeline({ ...f.host, executeContract: undefined }, ['A', 'B'], 'A');
  assert.throws(() => pipeline.commitContract({
    type: 'batch',
    transactionId: 'typed:missing-host',
    actions: [{ type: 'kill', object: f.kernel.ref('source') }],
  }), /Contract action execution is unavailable/);
  assert.equal(pipeline.events.length, 0);
  f.host.restore(checkpoint);
  assert.equal(f.kernel.getObject('source').zone, 'board');
});

test('EG-PIPELINE: commitContract rolls back host state and pipeline snapshots when scanning fails', () => {
  const kernel = world()
    .unit('source', { location: { type: 'base', player: 'A' } })
    .unit('enemy', { owner: 'B', controller: 'B', location: { type: 'battlefield', id: 'battlefield-1' } })
    .build();
  const choose = request => request.type === 'mode' ? 'invalid' : (() => { throw new AwaitChoice(request); })();
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: checkpoint => { kernel.restore(checkpoint.state); kernel.copyLinkedFrom(checkpoint.links); },
    objects: () => kernel.objects,
    perform: action => kernel.perform(action),
    performContract: action => kernel.performContract(action),
    performBatchLeaf: (action, batchId) => kernel.performBatchLeafForCapability(action, batchId),
    choose,
    context: (source, controller, timingPoint) => bindResolveContext(kernel, { source, controller, timingPoint, choose }),
    testTrigger: registration => kernel.test(registration.spec.condition),
  });
  const checkpoint = host.checkpoint();
  const pipeline = new EventPipeline(host, ['A', 'B'], 'A');
  pipeline.registerTrigger({
    id: 'one', source: kernel.getObject('source'), controller: 'A',
    spec: { at: 'object-killed', filter: { event: 'object-killed' } }, body: [],
  });
  pipeline.registerTrigger({
    id: 'two', source: kernel.getObject('enemy'), controller: 'B',
    spec: { at: 'object-killed', filter: { event: 'object-killed' } }, body: [],
  });
  pipeline.onTrigger = () => { throw new Error('typed scan failed'); };
  assert.throws(() => pipeline.commitContract({
    type: 'batch', transactionId: 'typed:rollback',
    actions: [
      { type: 'kill', object: kernel.ref('source') },
      { type: 'kill', object: kernel.ref('enemy') },
    ],
  }), /typed scan failed/);
  assert.equal(pipeline.events.length, 0);
  assert.equal(kernel.getObject('source').zone, 'board');
  assert.equal(kernel.getObject('enemy').zone, 'board');
  host.restore(checkpoint);
});

test('EG-PIPELINE: registration probes are O(1) reads and follow checkpoint restore without side effects', () => {
  const f = fixture();
  const pipeline = f.engine.pipeline;
  const trigger = {
    id: 'probe-trigger',
    source: f.kernel.getObject('source'),
    controller: 'A',
    spec: { at: 'card-drawn', filter: {} },
    body: [],
  };
  const replacement = {
    id: 'probe-replacement',
    matches: action => action.type === 'draw',
    apply: () => ({ status: 'prevent' }),
  };
  const beforeEvents = pipeline.events;
  const beforeClock = structuredClone(pipeline.clock);
  const checkpoint = pipeline.checkpoint.bind(pipeline);
  let checkpointCalls = 0;
  pipeline.checkpoint = () => { checkpointCalls += 1; return checkpoint(); };
  const empty = pipeline.checkpoint();

  assert.equal(pipeline.hasTriggerRegistration(trigger.id), false);
  assert.equal(pipeline.hasReplacementRegistration(replacement.id), false);
  pipeline.registerTrigger(trigger);
  pipeline.registerReplacement(replacement);
  assert.equal(pipeline.hasTriggerRegistration(trigger.id), true);
  assert.equal(pipeline.hasReplacementRegistration(replacement.id), true);

  const saved = pipeline.checkpoint();
  pipeline.unregisterTrigger(trigger.id);
  assert.equal(pipeline.hasTriggerRegistration(trigger.id), false);
  assert.equal(pipeline.hasReplacementRegistration(replacement.id), true);
  pipeline.restore(empty);
  assert.equal(pipeline.hasTriggerRegistration(trigger.id), false);
  assert.equal(pipeline.hasReplacementRegistration(replacement.id), false);
  pipeline.restore(saved);
  assert.equal(pipeline.hasTriggerRegistration(trigger.id), true);
  assert.equal(pipeline.hasReplacementRegistration(replacement.id), true);

  assert.deepEqual(pipeline.events, beforeEvents);
  assert.deepEqual(pipeline.clock, beforeClock);
  assert.equal(pipeline.hasTriggerRegistration(trigger.id), true);
  assert.equal(pipeline.hasReplacementRegistration(replacement.id), true);
  assert.equal(checkpointCalls, 2, 'probes must not snapshot the pipeline');
});
