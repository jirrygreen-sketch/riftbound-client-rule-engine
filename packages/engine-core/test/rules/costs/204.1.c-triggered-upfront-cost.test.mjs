// CR v1.5 204.1.c / 203.1 — scenario costs-triggered-upfront-cost.
import assert from 'node:assert/strict';
import test from 'node:test';
import { world, makeEngine, constant } from './harness.mjs';

test('costs-triggered-upfront-cost: paying the leading kill-me cost finalizes the ability', () => {
  const kernel = world()
    .player('A', { energy: 0 })
    .player('B', { energy: 0 })
    .unit('f1', { might: 2, location: { type: 'battlefield', id: 'bf1' } })
    .deck(['A:deck:1'], { owner: 'A' })
    .deck(['B:deck:1'], { owner: 'B' })
    .build();
  const { engine } = makeEngine(kernel, { answers: { 'finalize:trigger:1:optional': true } });

  engine.pipeline.registerTrigger({
    id: 'defend-trigger',
    source: kernel.getObject('f1'),
    controller: 'A',
    mayAtFinalize: true,
    spec: { at: 'card-drawn', filter: {} },
    body: [{ id: 'draw', op: 'effect.draw', args: { amount: constant(1) } }],
    cost: { id: 'cost:defend', cost: { payments: [{ kind: 'kill', object: 'self' }] } }
  });
  engine.commit({ type: 'draw', player: 'A', amount: 1 });
  engine.advance();

  assert.equal(kernel.getObject('f1').zone, 'trash');
  assert.equal(kernel.objectsInZone('A', 'trash').length, 1);
  assert.ok(engine.trace.some(event => event.step === 'finalized' && event.item === 'trigger:1'));
  assert.deepEqual(
    kernel.events.filter(event => event.action === 'kill' || event.action === 'pay').map(event => event.action),
    ['pay', 'kill']
  );
});

test('costs-triggered-upfront-declined: declining the optional leading cost removes the ability', () => {
  const kernel = world()
    .player('A', { energy: 0 })
    .player('B', { energy: 0 })
    .unit('f1', { might: 2, location: { type: 'battlefield', id: 'bf1' } })
    .deck(['A:deck:1'], { owner: 'A' })
    .deck(['B:deck:1'], { owner: 'B' })
    .build();
  const { engine } = makeEngine(kernel, { answers: { 'finalize:trigger:1:optional': false } });

  engine.pipeline.registerTrigger({
    id: 'defend-trigger',
    source: kernel.getObject('f1'),
    controller: 'A',
    mayAtFinalize: true,
    spec: { at: 'card-drawn', filter: {} },
    body: [{ id: 'draw', op: 'effect.draw', args: { amount: constant(1) } }],
    cost: { id: 'cost:defend', cost: { payments: [{ kind: 'kill', object: 'self' }] } }
  });
  engine.commit({ type: 'draw', player: 'A', amount: 1 });
  engine.advance();

  assert.equal(kernel.getObject('f1').zone, 'board');
  assert.equal(engine.items.length, 0);
  assert.equal(engine.trace.some(event => event.step === 'finalized' && event.item === 'trigger:1'), false);
});
