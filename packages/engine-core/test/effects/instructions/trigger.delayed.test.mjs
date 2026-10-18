import test from 'node:test';
import assert from 'node:assert/strict';
import instruction from '../../../dist/effects/instructions/trigger.delayed.js';
import { runInstruction, world } from '../../../dist/effects/testing/index.js';

const c = (value) => ({ kind: 'constant', value });
const draw = (id = 'draw') => ({ id, op: 'effect.draw', args: { amount: c(1) } });

function registered(built, options = {}) {
  return runInstruction(instruction, {
    at: c(options.at ?? 'turn-end'),
    body: c([draw('delayed-draw')]),
    ...(options.window ? { window: c(options.window) } : {}),
    ...(options.once ? { once: c(options.once) } : {}),
    ...(options.filter ? { filter: c(options.filter) } : {}),
  }, { world: built });
}

test('a windowed trigger stays fail-closed while the production bridge lacks expiry', () => {
  const built = world().player('A').deck(['a1', 'a2']).build();
  const outcome = registered(built, { window: 'this-turn' });
  assert.deepEqual(outcome.result, { status: 'negated', reason: 'impossible', events: [] });
  assert.equal(built.delayedTriggers.length, 0);
  assert.equal(built.linked('registered'), undefined);
});

test('expired this-turn window is not generated during the ending phase', () => {
  const built = world().player('A').deck(['a1']).build();
  const cl = built.clone({ timingPoint: 'turn-end' });
  const outcome = runInstruction(instruction, {
    at: c('turn-end'),
    body: c([draw('late')]),
    window: c('this-turn'),
  }, { world: cl });
  assert.deepEqual(outcome.result, { status: 'negated', reason: 'impossible', events: [] });
  assert.equal(cl.delayedTriggers.length, 0);
});

test('a future next-window also fails closed instead of becoming unbounded', () => {
  const built = world().player('A').build();
  const cl = built.clone({ timingPoint: 'main-start' });
  const outcome = runInstruction(instruction, {
    at: c('main-end'),
    body: c([draw('later')]),
    window: c('next-main-phase'),
  }, { world: cl });
  assert.deepEqual(outcome.result, { status: 'negated', reason: 'impossible', events: [] });
  assert.equal(cl.delayedTriggers.length, 0);
  assert.deepEqual(built.delayedTriggers, []);
});

test('unknown window and unknown once scope fail closed', () => {
  const built = world().player('A').build();
  for (const window of ['next-summer', { kind: 'sometimes' }]) {
    const outcome = registered(built, { window });
    assert.deepEqual(outcome.result, { status: 'negated', reason: 'impossible', events: [] });
    assert.equal(built.delayedTriggers.length, 0);
  }
  const once = registered(built, { once: 'whenever' });
  assert.deepEqual(once.result, { status: 'negated', reason: 'impossible', events: [] });
  assert.equal(built.delayedTriggers.length, 0);
});

test('card filters spell the controller as controller and the pipeline does not', () => {
  const built = world().player('A').unit('ally').build();
  const outcome = registered(built, { filter: { controller: 'controller', zone: 'board' } });
  assert.equal(outcome.result.status, 'executed');
  const spec = built.delayedTriggers[0].at;
  assert.deepEqual(spec.filter, { controller: 'self', zone: 'board' });
  const link = built.linked('registered');
  assert.deepEqual(link.filter, { controller: 'self', zone: 'board' });
});

test('non-timing at and non-instruction body fail closed', () => {
  const built = world().player('A').build();
  const badAt = runInstruction(instruction, { at: c('somewhere'), body: c([draw('x')]) }, { world: built });
  assert.deepEqual(badAt.result, { status: 'negated', reason: 'impossible', events: [] });
  const badBody = runInstruction(instruction, { at: c('turn-end'), body: c(['draw']) }, { world: built });
  assert.deepEqual(badBody.result, { status: 'negated', reason: 'impossible', events: [] });
  assert.equal(built.delayedTriggers.length, 0);
});

test('missing at or body throws instead of half-registering', () => {
  const built = world().player('A').build();
  assert.throws(() => runInstruction(instruction, { at: c('turn-end') }, { world: built }), TypeError);
  assert.throws(() => runInstruction(instruction, { body: c([draw('x')]) }, { world: built }), TypeError);
  assert.equal(built.delayedTriggers.length, 0);
});

test('unknown argument keys throw', () => {
  const built = world().player('A').build();
  assert.throws(
    () => runInstruction(instruction, { at: c('turn-end'), body: c([draw('x')]), rogue: c(1) }, { world: built }),
    TypeError
  );
  assert.equal(built.delayedTriggers.length, 0);
});
