import test from 'node:test';
import assert from 'node:assert/strict';
import { AwaitChoice } from '../../dist/effects/contract.js';
import { fixture, trigger, draw, damage, c, resolveAll } from '../chain/helpers.mjs';

test('triggers-condition-clause-true', () => {
  const f = fixture(); trigger(f, 'end', { spec: { at: 'turn-end', condition: { kind: 'always' } } });
  f.engine.emit({ timingPoint: 'turn-end' }); f.engine.advance(); resolveAll(f.engine); assert.equal(f.kernel.player('A').handSize, 1);
});
test('triggers-condition-clause-false', () => {
  const f = fixture(); trigger(f, 'end', { spec: { at: 'turn-end', condition: { kind: 'never' } } });
  f.engine.emit({ timingPoint: 'turn-end' }); f.engine.advance(); assert.equal(f.engine.items.length, 0);
});
test('triggers-condition-clause-not-adjacent', () => {
  const f = fixture(); trigger(f, 'end', { spec: { at: 'turn-end' }, body: [{ ...draw(), condition: { kind: 'never' } }] });
  f.engine.emit({ timingPoint: 'turn-end' }); f.engine.advance(); assert.equal(f.engine.items.length, 1); resolveAll(f.engine); assert.equal(f.kernel.player('A').handSize, 0);
});
test('triggers-enters-zone-same-time-as-condition', () => {
  const f = fixture({ cards: [{ id: 'unit', types: ['unit'] }] });
  trigger(f, 'entry', { source: f.kernel.getObject('unit'), spec: { filter: { objectId: 'unit' } } });
  f.engine.execute(f.card('unit', { kind: 'unit', body: [] }));
  assert.equal(f.engine.items[0].trigger.source.zone, 'board'); assert.equal(f.engine.items[0].trigger.source.exhausted, true);
});
test('triggers-leaves-zone-same-time-as-condition', () => {
  const f = fixture(); trigger(f, 'watch', { spec: { at: 'object-enters-trash' } });
  f.engine.commit({ type: 'kill', object: f.kernel.ref('source') }); assert.equal(f.engine.items.length, 0);
});
test('triggers-leaving-board-before-zone-change', () => {
  const f = fixture(); trigger(f, 'leaving', { spec: { at: 'object-leaves-board', filter: { objectId: 'source' } } });
  f.engine.commit({ type: 'return-to-hand', object: f.kernel.ref('source') });
  assert.equal(f.engine.items[0].trigger.source.zone, 'board'); assert.equal(f.engine.items[0].trigger.event.object.zone, 'board');
  assert.equal(f.kernel.getObject('source').zone, 'hand');
});
test('triggers-deathknell-processed-before-trash', () => {
  const f = fixture(); trigger(f, 'death', { spec: { at: 'object-killed', filter: { objectId: 'source' } } });
  f.engine.commit({ type: 'kill', object: f.kernel.ref('source') }); f.engine.advance();
  assert.equal(f.engine.items[0].source.zone, 'board'); resolveAll(f.engine); assert.equal(f.kernel.player('A').handSize, 1);
});
test('triggers-recall-does-not-trigger-move', () => {
  const f = fixture(); trigger(f, 'move', { spec: { at: 'object-moved' } });
  f.engine.commit({ type: 'return-to-hand', object: f.kernel.ref('enemy') }); assert.equal(f.engine.items.length, 0);
});
test('triggers-countered-play-no-trigger', () => {
  const f = fixture({ cards: [{ id: 'spell', types: ['spell'] }] }); trigger(f, 'played', { spec: { at: 'card-played' } });
  f.engine.execute(f.card('spell')); f.engine.commit({ type: 'counter', object: f.engine.items[0].object }); f.engine.advance();
  assert.equal(f.engine.items.length, 0); assert.equal(f.kernel.player('A').energy, 19);
  assert.equal(f.engine.pipeline.events.some(event => event.timingPoint === 'card-played'), false);
});
test('triggers-may-at-finalize-perform', () => {
  const f = fixture({ choose: request => request.type === 'optional' ? true : undefined });
  trigger(f, 'may', { mayAtFinalize: true, spec: { at: 'turn-end' } }); f.engine.emit({ timingPoint: 'turn-end' }); f.engine.advance();
  assert.equal(f.engine.items[0].status, 'finalized'); resolveAll(f.engine); assert.equal(f.kernel.player('A').handSize, 1);
});
test('triggers-may-at-finalize-decline', () => {
  const f = fixture({ choose: request => request.type === 'optional' ? false : undefined }); trigger(f, 'may', { mayAtFinalize: true, spec: { at: 'turn-end' } });
  f.engine.emit({ timingPoint: 'turn-end' }); f.engine.advance(); assert.equal(f.engine.items.length, 0); assert.equal(f.engine.trace.find(event => event.step === 'removed').reason, 'declined');
});
test('triggers-may-inside-effect-resolves-on-resolution', () => {
  const f = fixture({ choose: request => request.type === 'optional' ? false : undefined });
  trigger(f, 'end', { spec: { at: 'turn-end' }, body: [draw('first'), { id: 'may', op: 'choice.optional', args: { body: c([draw('second')]) } }] });
  f.engine.emit({ timingPoint: 'turn-end' }); f.engine.advance(); resolveAll(f.engine); assert.equal(f.kernel.player('A').handSize, 1);
});
test('triggers-no-legal-options-removed', () => {
  const f = fixture(); trigger(f, 'end', { spec: { at: 'turn-end' }, body: [{ ...draw(), targets: [{ id: 'missing', filter: { zone: 'banishment' } }] }] });
  f.engine.emit({ timingPoint: 'turn-end' }); f.engine.advance(); assert.equal(f.engine.items.length, 0);
  assert.equal(f.engine.trace.some(event => event.reason === 'countered'), false);
});
test('triggers-simultaneous-own-choice-order', () => {
  const f = fixture({ choose: request => request.type === 'mode' ? request.options.at(-1) : undefined });
  trigger(f, 'first', { spec: { at: 'turn-end' } }); trigger(f, 'second', { spec: { at: 'turn-end' } });
  f.engine.emit({ timingPoint: 'turn-end' });
  assert.deepEqual(f.engine.items.map(item => item.trigger.registration.id), ['second', 'first']);
});
test('triggers-simultaneous-turn-order', () => {
  const f = fixture({ turnPlayer: 'B' });
  trigger(f, 'A', { spec: { at: 'turn-end' } }); trigger(f, 'B', { controller: 'B', source: f.kernel.getObject('enemy'), spec: { at: 'turn-end' } });
  f.engine.emit({ timingPoint: 'turn-end' }); assert.deepEqual(f.engine.items.map(item => item.controller), ['B', 'A']);
});
test('triggers-once-per-turn-cap', () => {
  const f = fixture(); trigger(f, 'once', { spec: { at: 'card-drawn', once: 'per-turn' } });
  f.engine.commit({ type: 'draw', player: 'A', amount: 1 }); f.engine.advance(); resolveAll(f.engine);
  f.engine.commit({ type: 'draw', player: 'A', amount: 1 }); f.engine.advance(); assert.equal(f.engine.items.length, 0);
  f.engine.emit({ timingPoint: 'turn-start' }); f.engine.commit({ type: 'draw', player: 'A', amount: 1 }); f.engine.advance(); assert.equal(f.engine.items.length, 1);
});
test('triggers-once-per-turn-decline-preserves', () => {
  let accepted = false;
  const f = fixture({ choose: request => request.type === 'optional' ? accepted : undefined });
  trigger(f, 'once', { optional: true, spec: { at: 'card-drawn', once: 'per-turn' } });
  f.engine.commit({ type: 'draw', player: 'A', amount: 1 }); assert.equal(f.engine.items.length, 0);
  accepted = true; f.engine.commit({ type: 'draw', player: 'A', amount: 1 }); f.engine.advance(); assert.equal(f.engine.items.length, 1);
});
test('triggers-attack-trigger-once-per-combat', () => {
  const f = fixture(); trigger(f, 'attack', { spec: { at: 'attack-declared', once: 'per-combat' } });
  f.engine.emit({ timingPoint: 'attack-declared' }); f.engine.advance(); f.engine.emit({ timingPoint: 'attack-declared' });
  assert.equal(f.engine.items.length, 1); f.engine.emit({ timingPoint: 'combat-start' }); f.engine.emit({ timingPoint: 'attack-declared' }); assert.equal(f.engine.items.length, 2);
});
test('triggers-attack-trigger-condition-unmet', () => {
  const f = fixture(); trigger(f, 'attack', { spec: { at: 'attack-declared', once: 'per-combat', condition: { kind: 'never' } } });
  f.engine.emit({ timingPoint: 'attack-declared' }); assert.equal(f.engine.items.length, 0);
});
test('triggers-condition-info-locked-at-trigger', () => {
  const f = fixture(); trigger(f, 'capture', { spec: { at: 'turn-end' } });
  f.engine.emit({ timingPoint: 'turn-end' }); const captured = f.engine.items[0].source;
  f.engine.commit({ type: 'move-location', object: f.kernel.ref('source'), to: { type: 'battlefield', id: 'other' } });
  assert.deepEqual(f.engine.items[0].source.location, captured.location); assert.equal(f.kernel.getObject('source').location.id, 'other');
});
test('triggers-control-change-no-mistarget', () => {
  const f = fixture(); trigger(f, 'capture', { spec: { at: 'turn-end' } });
  f.engine.emit({ timingPoint: 'turn-end' }); f.engine.commit({ type: 'take-control', object: f.kernel.ref('source'), player: 'B' }); f.engine.advance();
  assert.equal(f.engine.items[0].controller, 'A'); resolveAll(f.engine); assert.equal(f.kernel.player('A').handSize, 1); assert.equal(f.kernel.player('B').handSize, 0);
});
test('triggers-reflexive-single', () => {
  const f = fixture(); trigger(f, 'reflexive', { spec: { at: 'card-drawn', once: 'per-game' } });
  f.engine.execute(f.draft('draw')); f.engine.pass('A'); f.engine.pass('B'); assert.equal(f.engine.items[0].kind, 'triggered'); resolveAll(f.engine); assert.equal(f.kernel.player('A').handSize, 2);
});
test('triggers-delayed-source-left-board', () => {
  const f = fixture(); trigger(f, 'delay', { delayed: true, spec: { at: 'turn-end', once: 'per-game' } });
  f.engine.commit({ type: 'banish', object: f.kernel.ref('source') }); f.engine.emit({ timingPoint: 'turn-end' }); f.engine.advance(); resolveAll(f.engine); assert.equal(f.kernel.player('A').handSize, 1);
});
test('triggers-closed-state-can-trigger', () => {
  const f = fixture(); f.engine.execute(f.draft('spell')); trigger(f, 'end', { spec: { at: 'turn-end' } }); f.engine.emit({ timingPoint: 'turn-end' }); assert.equal(f.engine.items.length, 2);
});
test('triggers-trigger-not-priority-action', () => {
  const f = fixture({ phase: 'awaken' }); trigger(f, 'end', { spec: { at: 'turn-end' } });
  assert.equal(f.engine.priority, null); f.engine.emit({ timingPoint: 'turn-end' }); f.engine.advance(); assert.equal(f.engine.items[0].status, 'finalized');
});
test('triggers-permanent-trigger-only-on-board', () => {
  const f = fixture(); trigger(f, 'end', { spec: { at: 'turn-end' } }); f.engine.commit({ type: 'banish', object: f.kernel.ref('source') });
  f.engine.emit({ timingPoint: 'turn-end' }); assert.equal(f.engine.items.length, 0);
});
test('triggers-off-board-self-describing-context', () => {
  const f = fixture(); trigger(f, 'trash', { activeZones: ['trash'], spec: { at: 'turn-end' } });
  f.engine.commit({ type: 'kill', object: f.kernel.ref('source') }); f.engine.emit({ timingPoint: 'turn-end' }); assert.equal(f.engine.items.length, 1);
});
test('triggers-pending-pauses-for-resolution', () => {
  const f = fixture(); trigger(f, 'once', { spec: { at: 'card-drawn', once: 'per-turn' } });
  f.engine.execute(f.draft('two', { body: [draw('one'), draw('two')] })); f.engine.pass('A'); f.engine.pass('B');
  const trace = f.engine.trace;
  const pending = trace.findIndex(event => event.step === 'pending' && event.item !== 'two');
  const resolved = trace.findIndex(event => event.step === 'resolved' && event.item === 'two');
  const finalizeTrigger = trace.findIndex(event => event.step === 'finalized' && event.item !== 'two');
  assert.ok(pending < resolved && resolved < finalizeTrigger); assert.equal(f.engine.items.length, 1);
});

test('pipeline: optional prompt rolls back action, scan, pending items and ids', () => {
  const f = fixture(); trigger(f, 'may', { optional: true, spec: { at: 'card-drawn' } });
  const before = f.kernel.player('A').deckSize;
  let request;
  assert.throws(() => f.engine.commit({ type: 'draw', player: 'A', amount: 1 }), error => { assert.ok(error instanceof AwaitChoice); request = error.request; return true; });
  assert.equal(f.kernel.player('A').deckSize, before); assert.equal(f.engine.items.length, 0); assert.equal(f.engine.pipeline.events.length, 0);
  f.answers.set(request.id, true); f.engine.commit({ type: 'draw', player: 'A', amount: 1 });
  assert.equal(f.kernel.player('A').deckSize, before - 1); assert.equal(f.engine.items[0].id, 'trigger:1');
});
test('triggers-cost-within-instructions-base-cost', () => {
  const f = fixture(); trigger(f, 'cost', { spec: { at: 'turn-end' }, cost: { id: 'leading', cost: { energy: c(2) } } });
  f.engine.emit({ timingPoint: 'turn-end' }); f.engine.advance();
  assert.equal(f.kernel.player('A').energy, 18); assert.equal(f.engine.items[0].payment.paid, true); assert.equal(f.kernel.player('A').handSize, 0);
  resolveAll(f.engine); assert.equal(f.kernel.player('A').handSize, 1);
});
test('triggers-cost-within-instructions-decline-pay', () => {
  const f = fixture({ choose: request => request.type === 'optional' ? false : undefined });
  trigger(f, 'cost', { spec: { at: 'turn-end' }, mayAtFinalize: true, cost: { id: 'leading', cost: { energy: c(2) } } });
  f.engine.emit({ timingPoint: 'turn-end' }); f.engine.advance(); assert.equal(f.engine.items.length, 0); assert.equal(f.kernel.player('A').energy, 20);
});
test('triggers-ekko-deathknell-recycle-cost: leaving-source cost binds current Trash incarnation', () => {
  const f = fixture(); trigger(f, 'death', { spec: { at: 'object-killed', filter: { objectId: 'source' } }, cost: { id: 'recycle', cost: { payments: [{ kind: 'recycle' }] } } });
  const old = f.kernel.ref('source'); f.engine.commit({ type: 'kill', object: old }); f.engine.advance();
  assert.equal(f.kernel.getObject('source').zone, 'deck'); assert.equal(f.engine.items[0].payment.actions.at(-1).action.type, 'recycle');
  assert.equal(f.engine.items[0].source.ref.zoneEntryId, old.zoneEntryId); resolveAll(f.engine); assert.equal(f.kernel.player('A').handSize, 1);
});
test('triggers-delayed-end-of-turn-this-turn', () => {
  const f = fixture(); trigger(f, 'delayed', { delayed: true, expiresAt: 'turn-end', spec: { at: 'turn-end' } });
  f.engine.emit({ timingPoint: 'turn-end' }); f.engine.advance(); resolveAll(f.engine);
  f.engine.emit({ timingPoint: 'turn-start' }); f.engine.emit({ timingPoint: 'turn-end' }); f.engine.advance();
  assert.equal(f.engine.items.length, 0); assert.equal(f.kernel.player('A').handSize, 1);
});
test('triggers-zone-change-removes-granted-text', () => {
  const f = fixture(); trigger(f, 'temporary', { boundToIncarnation: true, spec: { at: 'turn-end' } });
  f.engine.commit({ type: 'return-to-hand', object: f.kernel.ref('source') }); f.engine.commit({ type: 'move-zone', object: f.kernel.ref('source'), to: 'base' });
  f.engine.emit({ timingPoint: 'turn-end' }); assert.equal(f.engine.items.length, 0);
});
test('pipeline: event pattern evaluates player, object, amount and details conjunctively', () => {
  const f = fixture(); trigger(f, 'pattern', { spec: { at: 'score', filter: { event: 'scored', object: { controller: 'opponent' }, player: { playerId: 'B' }, amount: { operator: 'gte', value: 2 }, details: { reason: 'combat' } } } });
  const hit = amount => f.engine.emit({ timingPoint: 'score', kind: 'scored', object: f.kernel.getObject('enemy'), player: 'B', amount, details: { reason: 'combat' } });
  hit(1); assert.equal(f.engine.items.length, 0); hit(2); assert.equal(f.engine.items.length, 1);
});
test('pipeline: all timing aliases of one physical event use a single simultaneous ordering', () => {
  const f = fixture({ turnPlayer: 'B', cards: [{ id: 'unit', types: ['unit'] }] });
  trigger(f, 'A:board', { spec: { at: 'object-enters-board' } });
  trigger(f, 'B:base', { source: f.kernel.getObject('enemy'), controller: 'B', spec: { at: 'object-enters-base' } });
  f.engine.commit({ type: 'move-zone', object: f.kernel.ref('unit'), to: 'base' });
  assert.deepEqual(f.engine.items.map(item => item.controller), ['B', 'A']);
});
test('pipeline: closed EventPattern names map to their declared timing identifiers', () => {
  for (const [at, event] of [['score', 'scored'], ['conquer', 'conquered'], ['hold', 'held'], ['showdown-open', 'showdown-opened'], ['chain-item-finalize', 'chain-item-finalized']]) {
    const f = fixture(); trigger(f, 'pattern', { spec: { at, filter: { event } } });
    f.engine.emit({ timingPoint: at }); assert.equal(f.engine.items.length, 1, event);
  }
});
test('pipeline: a malformed order answer rolls back every generated trigger', () => {
  const f = fixture({ choose: request => request.type === 'mode' ? 'foreign-trigger' : undefined });
  trigger(f, 'one', { spec: { at: 'turn-end' } }); trigger(f, 'two', { spec: { at: 'turn-end' } });
  assert.throws(() => f.engine.emit({ timingPoint: 'turn-end' }), /Invalid trigger order/); assert.equal(f.engine.items.length, 0); assert.equal(f.engine.pipeline.events.length, 0);
});
test('triggers-reflexive-n-times', () => {
  const f = fixture(); trigger(f, 'reflexive', { spec: { at: 'card-drawn' } });
  f.engine.execute(f.draft('repeat', { body: [{ id: 'repeat', op: 'repeat', args: { count: c(3), body: c([draw()]) } }] }));
  f.engine.pass('A'); f.engine.pass('B'); assert.equal(f.kernel.player('A').handSize, 3); assert.equal(f.engine.items.length, 3);
});
test('triggers-reflexive-no-condition-always', () => {
  const f = fixture(); trigger(f, 'reflexive', { spec: { at: 'card-drawn' } });
  f.engine.execute(f.draft('draw')); f.engine.pass('A'); f.engine.pass('B'); assert.equal(f.engine.items[0].kind, 'triggered');
});
test('triggers-play-effect-after-board', () => {
  const f = fixture({ cards: [{ id: 'unit', types: ['unit'] }] });
  trigger(f, 'play', { source: f.kernel.getObject('unit'), spec: { at: 'card-played', filter: { objectId: 'unit' } } });
  f.engine.execute(f.card('unit', { kind: 'unit', body: [] }));
  assert.equal(f.engine.items[0].source.zone, 'board');
  const events = f.engine.pipeline.events.map(event => event.timingPoint);
  assert.ok(events.indexOf('object-enters-board') < events.indexOf('card-played'));
});
test('triggers-other-object-play-not-play-effect', () => {
  const f = fixture({ cards: [{ id: 'unit', types: ['unit'] }] }); trigger(f, 'self-play', { spec: { at: 'card-played', filter: { objectId: 'source' } } });
  f.engine.execute(f.card('unit', { kind: 'unit', body: [] })); assert.equal(f.engine.items.length, 0);
});
test('triggers-targeting-effect', () => {
  const f = fixture(); trigger(f, 'targeted', { spec: { at: 'became-target', filter: { objectId: 'enemy' } } });
  f.engine.execute(f.draft('spell', { body: [damage()] }));
  assert.equal(f.engine.items[1].kind, 'triggered');
  const targeted = f.engine.pipeline.events.find(event => event.timingPoint === 'became-target');
  assert.equal(targeted.target.ref.id, 'enemy'); assert.equal(targeted.source.ref.id, 'source');
});
