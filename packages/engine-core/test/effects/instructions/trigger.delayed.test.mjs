import test from 'node:test';
import assert from 'node:assert/strict';
import instruction from '../../../dist/effects/instructions/trigger.delayed.js';
import { runInstruction, world } from '../../../dist/effects/testing/index.js';
import { resolveChainBody } from '../../../dist/chain/interpreter-adapter.js';

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
  const outcome = registered(built, { filter: { controller: 'controller', zone: 'board' }, once: 'per-game' });
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

test('unconsumed card-IR arguments are rejected rather than silently ignored', () => {
  for (const key of ['objects', 'count', 'uses', 'referent', 'target']) {
    const built = world().player('A').build();
    assert.throws(
      () => runInstruction(instruction, {
        at: c('turn-end'), body: c([draw('delayed-draw')]), [key]: c('unconsumed'),
      }, { world: built }),
      /Unsupported trigger\.delayed argument/
    );
    assert.equal(built.delayedTriggers.length, 0);
  }
});

test('conflicting filter and duration spellings are rejected atomically', () => {
  const built = world().player('A').build();
  assert.throws(() => runInstruction(instruction, {
    at: c('turn-end'), body: c([draw('delayed-draw')]),
    filter: c({ zone: 'board' }), eventFilter: c({ event: 'card-played' }),
  }, { world: built }), /filter or eventFilter/);
  assert.throws(() => runInstruction(instruction, {
    at: c('turn-end'), body: c([draw('delayed-draw')]),
    duration: c('this-turn'), window: c('this-turn'),
  }, { world: built }), /duration or window/);
  assert.equal(built.delayedTriggers.length, 0);
  assert.equal(built.linked('registered'), undefined);
});

test('eventFilter requires a real EventPattern and never becomes an object id', () => {
  for (const eventFilter of ['turn-end', { event: 'not-an-event' }, { zone: 'board' }]) {
    const built = world().player('A').build();
    const outcome = runInstruction(instruction, {
      at: c('turn-end'), body: c([draw('delayed-draw')]), eventFilter: c(eventFilter),
    }, { world: built });
    assert.deepEqual(outcome.result, { status: 'negated', reason: 'impossible', events: [] });
    assert.equal(built.delayedTriggers.length, 0);
  }
  const built = world().player('A').build();
  const outcome = runInstruction(instruction, {
    at: c('card-played'), body: c([draw('delayed-draw')]),
    eventFilter: c({ event: 'card-played', object: { type: 'unit' } }),
    once: c('per-game'),
  }, { world: built });
  assert.equal(outcome.result.status, 'executed');
  assert.deepEqual(built.delayedTriggers[0].at.filter, { event: 'card-played', object: { type: 'unit' } });
});

test('a no-window registration without once fails closed instead of inventing a lifetime', () => {
  const built = world().player('A').build();
  const outcome = registered(built);
  assert.deepEqual(outcome.result, { status: 'negated', reason: 'impossible', events: [] });
  assert.equal(built.delayedTriggers.length, 0);
  assert.equal(built.linked('registered'), undefined);
});

test('unsupported arguments are rejected before a choice or registration can mutate state', () => {
  const built = world().player('A').unit('ally').build();
  const choiceKey = 'trigger.delayed.choice';
  assert.throws(() => runInstruction(instruction, {
    at: c('turn-end'), body: c([draw('delayed-draw')]),
    filter: c({ controller: { kind: 'choose', id: choiceKey, filter: { type: 'unit' } } }),
    uses: c(3),
  }, { world: built }), /Unsupported trigger\.delayed argument/);
  assert.equal(built.linked('registered'), undefined);
  assert.equal(built.delayedTriggers.length, 0);
});

test('the default chain interpreter registers a bounded explicit once scope', () => {
  const built = world().player('A').build();
  const body = [{
    id: 'default-chain-registration',
    op: 'trigger.delayed',
    args: {
      at: c('object-killed'),
      filter: c({ cardId: 'card:victim' }),
      once: c('per-game'),
      body: c([draw('delayed-draw')]),
    },
  }];
  const result = resolveChainBody(body, built);
  assert.equal(result.results[0].result.status, 'executed');
  assert.equal(built.delayedTriggers.length, 1);
  assert.equal(built.delayedTriggers[0].at.at, 'object-killed');
  assert.equal(built.delayedTriggers[0].at.once, 'per-game');
  assert.deepEqual(built.delayedTriggers[0].at.filter, { cardId: 'card:victim' });
});

test('the default chain interpreter leaves no registration when an argument is unsupported', () => {
  const built = world().player('A').build();
  assert.throws(() => resolveChainBody([{
    id: 'unsupported-chain-registration',
    op: 'trigger.delayed',
    args: {
      at: c('turn-end'),
      uses: c(3),
      body: c([draw('delayed-draw')]),
    },
  }], built), /Unsupported trigger\.delayed argument/);
  assert.equal(built.delayedTriggers.length, 0);
  assert.equal(built.linked('registered'), undefined);
});

test('the default chain interpreter passes a real EventPattern through unchanged', () => {
  const built = world().player('A').build();
  const eventPattern = { event: 'card-played', object: { type: 'unit' } };
  const result = resolveChainBody([{
    id: 'event-pattern-registration',
    op: 'trigger.delayed',
    args: {
      at: c('card-played'),
      eventFilter: c(eventPattern),
      once: c('per-game'),
      body: c([draw('delayed-draw')]),
    },
  }], built);
  assert.equal(result.results[0].result.status, 'executed');
  assert.deepEqual(built.delayedTriggers[0].at.filter, eventPattern);
  assert.equal(built.delayedTriggers[0].at.once, 'per-game');
});
