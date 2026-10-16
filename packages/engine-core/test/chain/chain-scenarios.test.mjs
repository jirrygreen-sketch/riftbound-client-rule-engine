import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, trigger, draw, damage, add, c, resolveAll, stages } from './helpers.mjs';

test('chain-spell-lifecycle-pending-finalize-resolve', () => {
  const f = fixture({ cards: [{ id: 'spell', types: ['spell'] }] });
  f.engine.execute(f.card('spell'));
  assert.deepEqual(stages(f.engine), ['pending:spell', 'finalized:spell']);
  assert.equal(f.kernel.getObject('spell').zone, 'chain');
  resolveAll(f.engine);
  assert.equal(f.kernel.getObject('spell').zone, 'trash');
  assert.equal(f.kernel.player('A').energy, 19);
  assert.equal(f.kernel.player('A').handSize, 1);
  assert.deepEqual(stages(f.engine), ['pending:spell', 'finalized:spell', 'resolved:spell', 'removed:spell']);
});
test('chain-play-creates-closed-state', () => {
  const f = fixture(); f.engine.execute(f.draft('first'));
  assert.equal(f.engine.turnState, 'neutral-closed');
  assert.equal(f.engine.canAct('A', 'normal'), false);
});
test('chain-unit-gear-resolve-immediately-on-finalize', () => {
  for (const kind of ['unit', 'gear']) {
    const f = fixture({ cards: [{ id: kind, types: [kind] }] });
    f.engine.execute(f.card(kind, { kind, body: [] }));
    assert.equal(f.kernel.getObject(kind).zone, 'board');
    assert.equal(f.kernel.getObject(kind).exhausted, kind === 'unit');
    assert.equal(f.engine.items.length, 0);
    assert.equal(f.engine.trace.some(event => event.step === 'pass'), false);
  }
});
test('chain-add-ability-resolves-immediately', () => {
  const f = fixture(); f.engine.execute(f.draft('add', { kind: 'add', body: [add()] }));
  assert.equal(f.kernel.player('A').energy, 22);
  assert.equal(f.engine.items.length, 0);
});
test('chain-lifo-resolution-order', () => {
  const f = fixture(); f.engine.execute(f.draft('older')); f.engine.execute(f.draft('newer'));
  resolveAll(f.engine);
  assert.deepEqual(f.engine.trace.filter(event => event.step === 'resolved').map(event => event.item), ['newer', 'older']);
});
test('chain-pass-not-resolve-if-item-added', () => {
  const f = fixture(); f.engine.execute(f.draft('older')); f.engine.pass('A');
  f.engine.execute(f.draft('newer', { controller: 'B' })); f.engine.pass('B');
  assert.equal(f.kernel.player('B').handSize, 0);
  assert.equal(f.engine.priority, 'A'); f.engine.pass('A');
  assert.equal(f.kernel.player('B').handSize, 1);
  assert.equal(f.engine.items.length, 1);
});
test('chain-reaction-added-restarts-finalize', () => {
  const f = fixture(); f.engine.execute(f.draft('older')); f.engine.execute(f.draft('reaction'));
  assert.deepEqual(stages(f.engine), ['pending:older', 'finalized:older', 'pending:reaction', 'finalized:reaction']);
});
test('chain-simultaneous-triggers-same-player-orders', () => {
  const f = fixture({ choose: req => req.type === 'mode' ? req.options.at(-1) : undefined });
  trigger(f, 'first', { spec: { at: 'card-drawn' } }); trigger(f, 'second', { spec: { at: 'card-drawn' } });
  f.engine.commit({ type: 'draw', player: 'A', amount: 1 });
  assert.deepEqual(f.engine.items.map(item => item.trigger.registration.id), ['second', 'first']);
});
test('chain-simultaneous-triggers-turn-order', () => {
  const f = fixture({ turnOrder: ['A', 'B', 'C'], turnPlayer: 'B' });
  trigger(f, 'A', { spec: { at: 'card-drawn' } });
  trigger(f, 'B', { controller: 'B', source: f.kernel.getObject('enemy'), spec: { at: 'card-drawn' } });
  f.engine.commit({ type: 'draw', player: 'A', amount: 1 });
  assert.deepEqual(f.engine.items.map(item => item.controller), ['B', 'A']);
});
test('chain-trigger-added-during-closed-state', () => {
  const f = fixture(); trigger(f, 'watch', { spec: { at: 'card-drawn' } });
  f.engine.execute(f.draft('first')); f.engine.commit({ type: 'draw', player: 'A', amount: 1 });
  assert.equal(f.engine.items.at(-1).status, 'pending');
  assert.equal(f.engine.items.at(-1).kind, 'triggered');
});
test('chain-optional-trigger-declined-removed', () => {
  const f = fixture({ choose: req => req.type === 'optional' ? false : undefined });
  trigger(f, 'watch', { spec: { at: 'card-drawn' }, optional: true });
  f.engine.commit({ type: 'draw', player: 'A', amount: 1 }); f.engine.advance();
  assert.deepEqual(f.engine.items, []); assert.equal(stages(f.engine).length, 0);
});
test('chain-trigger-no-legal-options-removed', () => {
  const f = fixture(); trigger(f, 'watch', { spec: { at: 'card-drawn' }, body: [{ ...damage(), targets: [{ id: 'victim', filter: { type: 'unit', controller: 'C' } }] }] });
  f.engine.commit({ type: 'draw', player: 'A', amount: 1 }); f.engine.advance();
  assert.equal(f.engine.items.length, 0);
  assert.equal(f.engine.trace.find(event => event.step === 'removed').reason, 'unperformable-trigger');
});
test('chain-action-spell-rejected-in-closed', () => {
  const f = fixture(); f.engine.execute(f.draft('first'));
  assert.throws(() => f.engine.execute(f.draft('action', { speed: 'action' })), /legally timed/);
  assert.equal(f.engine.items.length, 1);
});
test('chain-reaction-spell-allowed-in-closed', () => {
  const f = fixture(); f.engine.execute(f.draft('first')); f.engine.execute(f.draft('reaction'));
  assert.equal(f.engine.items.length, 2);
});
test('chain-non-action-rejected-in-showdown-open', () => {
  const f = fixture(); f.engine.openShowdown('A');
  assert.throws(() => f.engine.execute(f.draft('normal', { speed: 'normal' })), /legally timed/);
});
test('chain-action-spell-allowed-in-showdown-open', () => {
  const f = fixture(); f.engine.openShowdown('A'); f.engine.execute(f.draft('action', { speed: 'action' }));
  assert.equal(f.engine.turnState, 'showdown-closed');
});
test('chain-priority-after-resolve-newest-controller', () => {
  const f = fixture(); f.engine.execute(f.draft('old')); f.engine.pass('A');
  f.engine.execute(f.draft('new', { controller: 'B' })); f.engine.pass('B'); f.engine.pass('A');
  assert.equal(f.engine.priority, 'A'); assert.equal(f.engine.items[0].id, 'old');
});
test('chain-pending-item-not-targetable', () => {
  let f;
  f = fixture({ cards: [{ id: 'spell', types: ['spell'] }], describePlay: () => f.card('spell') });
  f.engine.enqueue(f.draft('watch', { kind: 'triggered', body: [{ ...damage(), targets: [{ id: 'victim', filter: { zone: 'chain' } }] }] }));
  f.engine.commit({ type: 'play', object: f.kernel.ref('spell'), player: 'A' });
  assert.equal(f.engine.isPending(f.engine.items[1].object), true);
  f.engine.advance();
  assert.equal(f.engine.items.length, 1);
  assert.equal(f.engine.items[0].id, 'spell');
  assert.equal(f.engine.trace.find(event => event.step === 'removed').reason, 'unperformable-trigger');
});
test('chain-cost-cannot-pay-finalize-fails', () => {
  const f = fixture({ energy: 0, cards: [{ id: 'spell', types: ['spell'], energy: 3 }] });
  assert.throws(() => f.engine.execute(f.card('spell')), /cost|Energy/i);
  assert.equal(f.kernel.getObject('spell').zone, 'hand');
  assert.equal(f.kernel.player('A').energy, 0); assert.equal(f.engine.items.length, 0);
});
test('chain-no-cleanup-during-resolution', () => {
  const f = fixture(); f.engine.execute(f.draft('spell', { body: [damage('hit', 5), draw()] }));
  resolveAll(f.engine);
  const events = f.engine.pipeline.events.map(event => event.timingPoint);
  const damageIndex = events.indexOf('damage-dealt'), drawIndex = events.indexOf('card-drawn'), resolvedIndex = events.indexOf('chain-item-resolve');
  assert.ok(damageIndex < drawIndex && drawIndex < resolvedIndex);
  assert.ok(!events.slice(damageIndex, resolvedIndex).includes('cleanup-start'));
  assert.equal(f.kernel.getObject('enemy').zone, 'trash');
});
test('chain-cleanup-after-transitions-and-chain-events', () => {
  const f = fixture(); f.engine.execute(f.draft('spell')); resolveAll(f.engine);
  const trace = f.engine.trace;
  for (const step of ['pending', 'finalized', 'removed']) {
    const index = trace.findIndex(event => event.step === step);
    assert.ok(trace.slice(index + 1).some(event => event.timingPoint === 'cleanup-start'));
  }
});
test('chain-cleanup-fixed-point', () => {
  const f = fixture(); trigger(f, 'death', { spec: { at: 'object-killed' } });
  f.engine.commit({ type: 'damage', source: f.kernel.ref('source'), target: f.kernel.ref('enemy'), amount: 5, combat: false });
  f.engine.advance();
  assert.equal(f.kernel.getObject('enemy').zone, 'trash');
  assert.equal(f.engine.items[0].kind, 'triggered');
  const events = f.engine.pipeline.events.map(event => event.timingPoint);
  assert.ok(events.filter(at => at === 'cleanup-start').length >= 2);
  const killed = events.indexOf('object-killed'), pending = events.indexOf('chain-item-pending');
  const firstEnd = events.indexOf('cleanup-end', killed), again = events.indexOf('cleanup-start', firstEnd);
  assert.ok(killed < pending && pending < firstEnd && firstEnd < again && again < events.indexOf('chain-item-finalize'));
});
test('chain-focus-passes-after-showdown-chain', () => {
  const f = fixture(); f.engine.openShowdown('A'); f.engine.execute(f.draft('spell', { speed: 'action' })); resolveAll(f.engine);
  assert.equal(f.engine.focus, 'B'); assert.equal(f.engine.priority, 'B');
});
test('chain-focus-not-passed-after-trigger-opened-chain', () => {
  const f = fixture(); f.engine.openShowdown('A'); f.engine.enqueue(f.draft('trigger', { kind: 'triggered' })); f.engine.advance(); resolveAll(f.engine);
  assert.equal(f.engine.focus, 'A'); assert.equal(f.engine.priority, 'A');
});
test('chain-play-effects-after-unit-boarded: end-to-end entry trigger through interpreter', () => {
  const f = fixture({ cards: [{ id: 'unit', types: ['unit'], might: 3 }] });
  trigger(f, 'entry', { source: f.kernel.getObject('unit'), spec: { filter: { objectId: 'unit' } } });
  f.engine.execute(f.card('unit', { kind: 'unit', body: [] }));
  assert.equal(f.kernel.getObject('unit').zone, 'board');
  assert.equal(f.engine.items[0].kind, 'triggered');
  assert.equal(f.kernel.player('A').handSize, 0);
  f.engine.pass('A'); assert.equal(f.kernel.player('A').handSize, 0);
  f.engine.pass('B'); assert.equal(f.kernel.player('A').handSize, 1);
  assert.deepEqual(f.engine.pipeline.events.map(event => event.timingPoint), [
    'object-leaves-zone', 'object-leaves-hand', 'object-enters-zone', 'object-enters-chain',
    'chain-item-pending', 'cleanup-start', 'cleanup-end', 'chain-item-finalize',
    'cleanup-start', 'cleanup-end',
    'object-leaves-zone', 'object-leaves-chain', 'object-enters-zone', 'object-enters-board', 'object-enters-base', 'chain-item-pending',
    'card-played', 'chain-item-resolve', 'cleanup-start', 'cleanup-end', 'chain-item-finalize', 'cleanup-start', 'cleanup-end',
    'object-leaves-zone', 'object-leaves-deck', 'object-enters-zone', 'object-enters-hand', 'card-drawn', 'chain-item-resolve', 'cleanup-start', 'cleanup-end'
  ]);
  assert.deepEqual(stages(f.engine), ['pending:unit', 'finalized:unit', 'pending:trigger:1', 'resolved:unit', 'removed:unit', 'finalized:trigger:1', 'resolved:trigger:1', 'removed:trigger:1']);
});
test('chain-accelerate-paid-enters-ready', () => {
  const f = fixture({ cards: [{ id: 'unit', types: ['unit'] }] });
  f.engine.execute(f.card('unit', { kind: 'unit', body: [], cost: { id: 'accelerate', cost: { energy: c(1) }, optionalAdditional: [{ id: 'accelerate', kind: 'accelerate', selected: true, cost: { energy: c(2) } }] } }));
  assert.equal(f.kernel.getObject('unit').exhausted, false); assert.equal(f.kernel.player('A').energy, 17);
});
test('chain-multiple-pending-finalized-oldest-first', () => {
  const f = fixture(); for (const id of ['one', 'two', 'three']) f.engine.enqueue(f.draft(id, { kind: 'triggered' }));
  f.engine.advance();
  assert.deepEqual(f.engine.trace.filter(event => event.step === 'finalized').map(event => event.item), ['one', 'two', 'three']);
});
test('chain-reflexive-trigger-added-during-resolution', () => {
  const f = fixture(); trigger(f, 'once', { spec: { at: 'card-drawn', once: 'per-turn' } });
  f.engine.execute(f.draft('draw')); f.engine.pass('A'); f.engine.pass('B');
  assert.equal(f.engine.items.length, 1); assert.equal(f.engine.items[0].kind, 'triggered');
  resolveAll(f.engine); assert.equal(f.kernel.player('A').handSize, 2);
});
test('chain-finalize-does-not-pass-priority', () => {
  const f = fixture(); f.engine.enqueue(f.draft('A', { kind: 'triggered' })); f.engine.enqueue(f.draft('B', { kind: 'triggered', controller: 'B' }));
  f.engine.advance();
  const trace = f.engine.trace, start = trace.findIndex(event => event.step === 'finalize-start'), end = trace.findLastIndex(event => event.step === 'finalized');
  assert.equal(trace.slice(start, end + 1).some(event => event.step === 'priority-granted'), false);
  assert.equal(f.engine.priority, 'B');
});
