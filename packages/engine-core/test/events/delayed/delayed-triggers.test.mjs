import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, draw, resolveAll } from '../../chain/helpers.mjs';
import { registerDelayedTrigger, resetDelayedTriggerSequence } from '../../../dist/events/delayed/registry.js';
import {
  DELAYED_DURATION_ALIASES,
  delayedDuration,
  delayedExpiresAt,
} from '../../../dist/events/delayed/duration.js';

const cloneSource = (source) => ({ ...source, ref: { ...source.ref } });

function delayed(f, id, options = {}) {
  const source = f.kernel.getObject(options.sourceId ?? 'source');
  return registerDelayedTrigger(f.engine.pipeline, {
    id,
    source: cloneSource(source),
    controller: options.controller ?? 'A',
    spec: { at: options.at ?? 'turn-end', filter: options.filter ?? {} },
    body: [draw(options.bodyId ?? 'delayed-draw')],
    ...(options.duration ? { duration: options.duration } : {}),
  });
}

test('a this-turn registration fires on turn-end once and then expires', () => {
  resetDelayedTriggerSequence();
  const f = fixture();
  delayed(f, 'gold', { duration: { kind: 'this-turn' } });
  f.engine.emit({ timingPoint: 'turn-end' });
  f.engine.advance();
  assert.equal(f.engine.items.length, 1);
  assert.equal(f.engine.items[0].controller, 'A');
  resolveAll(f.engine);
  assert.equal(f.kernel.player('A').handSize, 1);
  f.engine.emit({ timingPoint: 'turn-end' });
  f.engine.advance();
  assert.equal(f.engine.items.length, 0);
});

test('an until-main-phase registration ignores turn-end and fires on its opening', () => {
  resetDelayedTriggerSequence();
  const f = fixture();
  delayed(f, 'rally', { at: 'main-start', duration: { kind: 'until', at: 'main-start' } });
  f.engine.emit({ timingPoint: 'turn-end' });
  f.engine.advance();
  assert.equal(f.engine.items.length, 0);
  f.engine.emit({ timingPoint: 'main-start' });
  f.engine.advance();
  assert.equal(f.engine.items.length, 1);
  resolveAll(f.engine);
  assert.equal(f.kernel.player('A').handSize, 1);
  assert.equal(f.engine.pipeline.events.filter((event) => event.timingPoint === 'main-start').length, 1);
});

test('a delayed registration keeps firing after its source leaves the board', () => {
  resetDelayedTriggerSequence();
  const f = fixture();
  delayed(f, 'lingering', { duration: { kind: 'this-turn' } });
  f.engine.commit({ type: 'banish', object: f.kernel.ref('source') });
  assert.equal(f.kernel.getObject('source').zone, 'banishment');
  f.engine.emit({ timingPoint: 'turn-end' });
  f.engine.advance();
  assert.equal(f.engine.items.length, 1);
  assert.equal(f.engine.items[0].controller, 'A');
  resolveAll(f.engine);
  assert.equal(f.kernel.player('A').handSize, 1);
});

test('a delayed registration keeps the source snapshot captured at creation', () => {
  resetDelayedTriggerSequence();
  const f = fixture();
  const capturedLocation = f.kernel.getObject('source').location;
  delayed(f, 'lki', { duration: { kind: 'this-turn' } });
  f.engine.commit({ type: 'move-location', object: f.kernel.ref('source'), to: { type: 'battlefield', id: 'other' } });
  f.engine.commit({ type: 'take-control', object: f.kernel.ref('source'), player: 'B' });
  const registration = f.engine.pipeline.checkpoint().triggers.get('lki');
  assert.deepEqual(registration.source.location, capturedLocation);
  assert.equal(registration.source.controller, 'A');
  assert.equal(registration.controller, 'A');
});

test('expiry runs after the wave scan, so a same-point window still fires', () => {
  resetDelayedTriggerSequence();
  const f = fixture();
  delayed(f, 'gold', { at: 'main-start', duration: { kind: 'until', at: 'main-start' } });
  f.engine.emit({ timingPoint: 'main-start' });
  f.engine.advance();
  assert.equal(f.engine.items.length, 1);
  resolveAll(f.engine);
  f.engine.emit({ timingPoint: 'main-start' });
  f.engine.advance();
  assert.equal(f.engine.items.length, 0);
});

test('duration aliases map windows to registrations that expire on that point', () => {
  resetDelayedTriggerSequence();
  assert.deepEqual(delayedDuration('this-turn'), { kind: 'this-turn' });
  assert.deepEqual(delayedDuration('end-of-turn'), { kind: 'this-turn' });
  assert.deepEqual(delayedDuration('next-main-phase'), { kind: 'until', at: 'main-start' });
  assert.deepEqual(delayedDuration('next-combat-phase'), { kind: 'until', at: 'combat-start' });
  assert.deepEqual(delayedDuration({ kind: 'until', at: 'main-start' }), { kind: 'until', at: 'main-start' });
  assert.deepEqual(delayedDuration({ kind: 'maybe' }), undefined);
  assert.deepEqual(delayedDuration('next-summer'), undefined);
  assert.equal(delayedExpiresAt(DELAYED_DURATION_ALIASES['this-turn']), 'turn-end');
  assert.equal(delayedExpiresAt(DELAYED_DURATION_ALIASES['next-main-phase']), 'main-start');
  assert.equal(delayedExpiresAt(undefined), undefined);
  const f = fixture();
  delayed(f, 'from-alias', { duration: delayedDuration('end-of-turn') });
  const registration = f.engine.pipeline.checkpoint().triggers.get('from-alias');
  assert.equal(registration.expiresAt, 'turn-end');
  assert.equal(registration.delayed, true);
});

test('the once scope consumes only the first matching wave', () => {
  resetDelayedTriggerSequence();
  const f = fixture();
  delayed(f, 'once', { duration: { kind: 'this-turn' } });
  f.engine.emit({ timingPoint: 'turn-end' });
  f.engine.advance();
  const first = f.engine.items.length;
  resolveAll(f.engine);
  f.engine.emit({ timingPoint: 'turn-end' });
  f.engine.advance();
  assert.equal(first, 1);
  assert.equal(f.engine.items.length, 0);
});
