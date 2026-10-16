import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, resolveAll, add, trigger } from './helpers.mjs';

test('priority-neutral-open-default-main', () => {
  const f = fixture(); assert.equal(f.engine.turnState, 'neutral-open'); assert.equal(f.engine.priority, 'A'); assert.equal(f.engine.focus, null);
});
test('priority-chain-exists-closes-state', () => {
  const f = fixture(); f.engine.enqueue(f.draft('pending', { kind: 'triggered' }));
  assert.equal(f.engine.turnState, 'neutral-closed'); assert.equal(f.engine.items[0].status, 'pending'); assert.equal(f.engine.canAct('A', 'reaction'), false);
});
test('priority-neutral-closed-no-showdown', () => {
  const f = fixture(); f.engine.execute(f.draft('spell')); assert.equal(f.engine.turnState, 'neutral-closed'); assert.equal(f.engine.focus, null);
});
test('priority-showdown-open-on-contested', () => {
  const f = fixture(); f.engine.openShowdown('B'); assert.equal(f.engine.turnState, 'showdown-open'); assert.equal(f.engine.focus, 'B');
  assert.equal(f.engine.pipeline.events[0].timingPoint, 'showdown-open');
});
test('priority-showdown-closed-during-chain', () => {
  const f = fixture(); f.engine.openShowdown('A'); f.engine.execute(f.draft('spell')); assert.equal(f.engine.turnState, 'showdown-closed');
});
test('priority-no-chain-open-no-showdown-neutral', () => {
  const f = fixture(); f.engine.execute(f.draft('spell')); resolveAll(f.engine); assert.equal(f.engine.turnState, 'neutral-open');
});
test('priority-focus-cleared-when-neutral', () => {
  const f = fixture(); f.engine.openShowdown('A'); f.engine.pass('A'); f.engine.pass('B'); assert.equal(f.engine.focus, null); assert.equal(f.engine.turnState, 'neutral-open');
});
test('priority-no-priority-no-discretionary', () => {
  const f = fixture(); f.engine.requestTask('phase');
  for (const player of ['A', 'B']) for (const speed of ['normal', 'action', 'reaction']) assert.equal(f.engine.canAct(player, speed), false);
  f.engine.completeTask('phase'); f.engine.advance(); assert.equal(f.engine.canAct('A', 'normal'), true);
});
test('priority-non-turn-player-no-priority-neutral-open', () => {
  const f = fixture(); assert.equal(f.engine.canAct('B', 'reaction'), false); assert.throws(() => f.engine.execute(f.draft('B', { controller: 'B' })), /timed/);
});
test('priority-next-chain-controller-gains-priority', () => {
  const f = fixture(); f.engine.enqueue(f.draft('A', { kind: 'triggered' })); f.engine.enqueue(f.draft('B', { kind: 'triggered', controller: 'B' })); f.engine.advance(); assert.equal(f.engine.priority, 'B');
});
test('priority-priority-passes-in-turn-order', () => {
  const f = fixture({ turnOrder: ['A', 'B', 'C'] }); f.engine.execute(f.draft('spell')); f.engine.pass('A'); assert.equal(f.engine.priority, 'B'); f.engine.pass('B'); assert.equal(f.engine.priority, 'C'); assert.equal(f.engine.items.length, 1);
});
test('priority-priority-taken-not-created', () => {
  const f = fixture(); f.engine.execute(f.draft('spell')); f.engine.pass('A');
  assert.equal(f.engine.canAct('A', 'reaction'), false); assert.equal(f.engine.canAct('B', 'reaction'), true);
});
test('priority-awaken-phase-no-priority', () => {
  const f = fixture({ phase: 'awaken' }); assert.equal(f.engine.priority, null); assert.equal(f.engine.canAct('A', 'normal'), false);
});
test('priority-no-priority-during-cleanup', () => {
  const observations = [];
  const f = fixture({ cleanup: engine => {
    observations.push(engine.canAct('A', 'reaction'));
    assert.throws(() => engine.pass('A'), /cannot pass/);
    assert.throws(() => engine.openShowdown('A'), /Outstanding/);
    return false;
  } });
  f.engine.execute(f.draft('spell')); assert.ok(observations.length >= 2); assert.ok(observations.every(value => value === false));
  const trace = f.engine.trace;
  let cleaning = false;
  for (const event of trace) {
    if (event.timingPoint === 'cleanup-start') cleaning = true;
    if (event.timingPoint === 'cleanup-end') cleaning = false;
    if (cleaning) assert.ok(!['priority-granted', 'focus-granted', 'finalized', 'resolved'].includes(event.step));
  }
});
test('priority-contested-player-gains-focus', () => {
  const f = fixture(); f.engine.openShowdown('B'); assert.equal(f.engine.focus, 'B'); assert.equal(f.engine.priority, 'B');
});
test('priority-gaining-focus-grants-priority', () => {
  const f = fixture(); f.engine.openShowdown('A'); f.engine.pass('A'); assert.equal(f.engine.focus, 'B'); assert.equal(f.engine.priority, 'B');
});
test('priority-pass-priority-retains-focus', () => {
  const f = fixture(); f.engine.openShowdown('A'); f.engine.execute(f.draft('spell')); f.engine.pass('A'); assert.equal(f.engine.focus, 'A'); assert.equal(f.engine.priority, 'B');
});
test('priority-focus-needs-priority-to-act', () => {
  const f = fixture(); f.engine.openShowdown('A'); f.engine.execute(f.draft('spell')); f.engine.pass('A'); assert.equal(f.engine.focus, 'A'); assert.equal(f.engine.canAct('A', 'reaction'), false);
});
test('priority-chain-resolution-passes-focus', () => {
  const f = fixture(); f.engine.openShowdown('A'); f.engine.execute(f.draft('spell')); resolveAll(f.engine); assert.equal(f.engine.focus, 'B');
});
test('priority-triggered-chain-no-focus-pass', () => {
  const f = fixture(); f.engine.openShowdown('A'); f.engine.enqueue(f.draft('trigger', { kind: 'triggered' })); f.engine.advance(); resolveAll(f.engine); assert.equal(f.engine.focus, 'A');
});
test('priority-spell-action-open-own-turn', () => {
  const f = fixture(); for (const speed of ['normal', 'action', 'reaction']) assert.equal(f.engine.canAct('A', speed), true);
});
test('priority-spell-no-action-rejected-showdown-open', () => {
  const f = fixture(); f.engine.openShowdown('A'); assert.equal(f.engine.canAct('A', 'normal'), false);
});
test('priority-action-spell-showdown-open', () => {
  const f = fixture(); f.engine.openShowdown('A'); assert.equal(f.engine.canAct('A', 'action'), true); assert.equal(f.engine.canAct('B', 'action'), false);
});
test('priority-action-spell-rejected-closed', () => {
  const f = fixture(); f.engine.execute(f.draft('spell')); assert.equal(f.engine.canAct('A', 'action'), false);
});
test('priority-reaction-spell-closed', () => {
  const f = fixture(); f.engine.execute(f.draft('spell')); assert.equal(f.engine.canAct('A', 'reaction'), true);
});
test('priority-activated-no-action-rejected-showdown', () => {
  const f = fixture(); f.engine.openShowdown('A'); assert.throws(() => f.engine.execute(f.draft('ability', { speed: 'normal' })), /timed/);
});
test('priority-activated-action-showdown', () => {
  const f = fixture(); f.engine.openShowdown('A'); f.engine.execute(f.draft('ability', { speed: 'action' })); assert.equal(f.engine.items[0].kind, 'activated');
});
test('priority-activated-reaction-closed', () => {
  const f = fixture(); f.engine.execute(f.draft('spell')); f.engine.execute(f.draft('ability')); assert.equal(f.engine.items[1].kind, 'activated');
});
test('priority-finalizing-does-not-pass-priority', () => {
  const f = fixture(); f.engine.execute(f.draft('spell'));
  const trace = f.engine.trace, begin = trace.findIndex(e => e.step === 'finalize-start'), end = trace.findIndex(e => e.step === 'finalized');
  assert.equal(trace.slice(begin, end + 1).some(e => e.step === 'priority-granted'), false);
});
test('priority-oldest-pending-finalizes-first', () => {
  const f = fixture(); f.engine.enqueue(f.draft('first', { kind: 'triggered' })); f.engine.enqueue(f.draft('second', { kind: 'triggered' })); f.engine.advance();
  assert.deepEqual(f.engine.trace.filter(e => e.step === 'finalized').map(e => e.item), ['first', 'second']);
});
test('priority-unit-resolves-on-finalize', () => {
  const f = fixture({ cards: [{ id: 'unit', types: ['unit'] }] }); f.engine.execute(f.card('unit', { kind: 'unit', body: [] })); assert.equal(f.kernel.getObject('unit').zone, 'board'); assert.equal(f.engine.items.length, 0);
});
test('priority-add-ability-resolves-on-finalize', () => {
  const f = fixture(); f.engine.execute(f.draft('add', { kind: 'add', body: [add()] })); assert.equal(f.kernel.player('A').energy, 22); assert.equal(f.engine.items.length, 0);
});
test('priority-newest-finalized-resolves-first', () => {
  const f = fixture(); f.engine.execute(f.draft('first')); f.engine.execute(f.draft('second')); f.engine.pass('A'); f.engine.pass('B'); assert.equal(f.engine.items[0].id, 'first'); assert.equal(f.engine.items.length, 1);
});
test('priority-resolve-after-all-pass', () => {
  const f = fixture({ turnOrder: ['A', 'B', 'C'] }); f.engine.execute(f.draft('spell')); f.engine.pass('A'); f.engine.pass('B'); assert.equal(f.kernel.player('A').handSize, 0); f.engine.pass('C'); assert.equal(f.kernel.player('A').handSize, 1);
});
test('priority-priority-returns-after-resolve', () => {
  const f = fixture(); f.engine.execute(f.draft('first')); f.engine.pass('A'); f.engine.execute(f.draft('second', { controller: 'B' })); f.engine.pass('B'); f.engine.pass('A'); assert.equal(f.engine.priority, 'A');
});
test('priority-passes-reset-when-item-added', () => {
  const f = fixture(); f.engine.execute(f.draft('first')); f.engine.pass('A'); f.engine.execute(f.draft('second', { controller: 'B' })); f.engine.pass('B'); assert.equal(f.engine.items.length, 2); f.engine.pass('A'); assert.equal(f.engine.items.length, 1);
});
test('priority-showdown-ends-after-all-pass-focus', () => {
  const f = fixture(); f.engine.openShowdown('A'); f.engine.pass('A'); assert.equal(f.engine.turnState, 'showdown-open'); f.engine.pass('B'); assert.equal(f.engine.turnState, 'neutral-open');
  assert.equal(f.engine.pipeline.events.at(-1).timingPoint, 'showdown-close');
});
test('priority-turn-player-declares-end', () => {
  const f = fixture(); f.engine.pass('A'); assert.equal(f.engine.priority, null); assert.equal(f.engine.trace.at(-1).step, 'phase-complete');
});
test('priority-simultaneous-triggers-turn-order', () => {
  const f = fixture({ turnPlayer: 'B' }); trigger(f, 'A', { spec: { at: 'turn-end' } });
  trigger(f, 'B', { controller: 'B', source: f.kernel.getObject('enemy'), spec: { at: 'turn-end' } });
  f.engine.emit({ timingPoint: 'turn-end' }); f.engine.advance();
  assert.deepEqual(f.engine.items.map(item => item.controller), ['B', 'A']); assert.equal(f.engine.priority, 'A');
});
