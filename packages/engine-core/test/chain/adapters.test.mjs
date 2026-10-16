import test from 'node:test';
import assert from 'node:assert/strict';
import { AwaitChoice } from '../../dist/effects/contract.js';
import { validateCardProgram } from '@riftbound/card-dsl';
import { fixture, trigger, draw, damage, add, c, resolveAll } from './helpers.mjs';

test('chain-trigger-cost-declined-not-countered', () => {
  const f = fixture({ choose: request => request.type === 'optional' ? false : undefined });
  trigger(f, 'cost', { spec: { at: 'turn-end' }, mayAtFinalize: true, cost: { id: 'cost', cost: { energy: c(3) } } });
  f.engine.emit({ timingPoint: 'turn-end' }); f.engine.advance();
  assert.equal(f.engine.items.length, 0); assert.equal(f.kernel.player('A').energy, 20);
  assert.equal(f.engine.trace.find(event => event.step === 'removed').reason, 'declined');
});
test('chain-conditional-reaction-checked-at-legality', () => {
  const f = fixture(); f.engine.execute(f.draft('first'));
  f.engine.execute(f.draft('conditional', { speed: 'action', conditionalReaction: { kind: 'always' } }));
  assert.equal(f.engine.items.length, 2);
});
test('chain-conditional-reaction-lost-before-legality', () => {
  let f;
  f = fixture({ cleanup: engine => {
    if (engine.items.some(item => item.id === 'conditional') && !f.kernel.getObject('source').exhausted) {
      engine.commit({ type: 'exhaust', object: f.kernel.ref('source') }); return true;
    }
    return false;
  } });
  f.engine.execute(f.draft('first'));
  assert.throws(() => f.engine.execute(f.draft('conditional', { speed: 'action', conditionalReaction: { kind: 'compare', left: { kind: 'object-property', object: f.kernel.ref('source'), property: 'exhausted' }, operator: 'eq', right: c(false) } })), /no longer applies/);
  assert.equal(f.kernel.getObject('source').exhausted, false); assert.equal(f.engine.items.length, 1);
});
test('chain-non-turn-player-priority-in-closed', () => {
  const f = fixture(); f.engine.execute(f.draft('first')); f.engine.pass('A');
  assert.equal(f.engine.canAct('B', 'reaction'), true); f.engine.execute(f.draft('second', { controller: 'B' })); assert.equal(f.engine.priority, 'B');
});
test('chain-phase-advances-when-no-actions', () => {
  const f = fixture(); f.engine.pass('A'); assert.deepEqual(f.engine.trace.at(-1), { step: 'phase-complete', player: 'A' }); assert.equal(f.engine.priority, null);
});
test('chain-countered-spell-not-played-no-refund', () => {
  const f = fixture({ cards: [{ id: 'spell', types: ['spell'] }] }); trigger(f, 'played', { spec: { at: 'card-played' } });
  f.engine.execute(f.card('spell')); f.engine.commit({ type: 'counter', object: f.engine.items[0].object }); f.engine.advance();
  assert.equal(f.kernel.player('A').energy, 19); assert.equal(f.kernel.getObject('spell').zone, 'trash'); assert.equal(f.engine.items.length, 0);
  assert.equal(f.engine.pipeline.events.some(event => event.timingPoint === 'card-played'), false);
});
test('chain: TargetPlan locks once, emits became-target, appends tax before payment', () => {
  const f = fixture(); trigger(f, 'targeted', { spec: { at: 'became-target', filter: { objectId: 'enemy' } } });
  f.engine.execute(f.draft('spell', { body: [damage()], cost: { id: 'base', cost: { energy: c(1) } }, targets: [{ requirement: damage().targets[0], options: { selected: [f.kernel.ref('enemy')], tax: { kind: 'deflect', amount: 2 } } }] }));
  assert.equal(f.kernel.player('A').energy, 17); assert.equal(f.engine.items[0].targetPlans[0].selected[0].id, 'enemy');
  assert.equal(f.engine.pipeline.events.filter(event => event.timingPoint === 'became-target').length, 1);
  f.engine.commit({ type: 'return-to-hand', object: f.kernel.ref('enemy') });
  f.engine.commit({ type: 'move-zone', object: f.kernel.ref('enemy'), to: 'base' }); f.engine.advance(); resolveAll(f.engine);
  assert.equal(f.kernel.getObject('enemy').damage, 0);
});
test('chain: null printed cost fails without coercion or partial state', () => {
  const f = fixture({ cards: [{ id: 'spell', types: ['spell'], energy: null, power: null }] });
  assert.throws(() => f.engine.execute(f.card('spell')), /no printed Energy/);
  assert.equal(f.kernel.getObject('spell').energy, null); assert.equal(f.kernel.getObject('spell').zone, 'hand'); assert.equal(f.kernel.player('A').energy, 20);
});
test('chain: AwaitChoice after earlier instructions rolls back the entire Resolve and final pass', () => {
  const f = fixture();
  f.engine.execute(f.draft('spell', { body: [draw('first'), { id: 'may', op: 'choice.optional', args: { body: c([draw('second')]) } }] }));
  f.engine.pass('A'); const events = f.engine.pipeline.events;
  const links = f.kernel.linkedSnapshot();
  let request;
  assert.throws(() => f.engine.pass('B'), error => { assert.ok(error instanceof AwaitChoice); request = error.request; return true; });
  assert.equal(f.kernel.player('A').handSize, 0); assert.equal(f.engine.priority, 'B'); assert.deepEqual(f.engine.pipeline.events, events);
  assert.deepEqual(f.kernel.linkedSnapshot(), links);
  f.answers.set(request.id, true); f.engine.pass('B'); assert.equal(f.kernel.player('A').handSize, 2); assert.equal(f.engine.items.length, 0);
});
test('chain: unsupported nested target and mode lifecycles remain explicitly blocked', () => {
  for (const body of [
    [{ id: 'repeat', op: 'repeat', args: { count: c(2), body: c([damage()]) } }],
    [{ id: 'mode', op: 'choice.mode', args: { modes: c([{ id: 'draw', body: [draw()] }]) } }]
  ]) {
    const f = fixture(); assert.throws(() => f.engine.execute(f.draft('blocked', { body })), error => error.status === 'blocked');
    assert.equal(f.engine.items.length, 0); assert.equal(f.engine.pipeline.events.length, 0);
  }
});
test('chain: unsupported trigger costs propagate blocked instead of disappearing as unperformable', () => {
  const f = fixture(); trigger(f, 'unsupported', { spec: { at: 'turn-end' }, cost: { id: 'unsupported', cost: { payments: [{ kind: 'unimplemented-official-cost' }] } } });
  f.engine.emit({ timingPoint: 'turn-end' });
  assert.throws(() => f.engine.advance(), error => error.status === 'blocked');
  assert.equal(f.engine.items[0].status, 'pending'); assert.equal(f.engine.trace.some(event => event.step === 'removed'), false);
});
test('chain: validated EffectIR metadata and dynamic Expr reach the unchanged primitive schema', () => {
  const f = fixture();
  const body = [{ ...damage(), args: { amount: c(2), target: c('victim') } }];
  const validated = validateCardProgram({ canonicalCardId: 'synthetic:pipe', rulesetVersion: 'core-1.5', status: 'executable', sourceText: 'synthetic', abilities: [{ kind: 'play', body }] });
  assert.equal(validated.ok, true, JSON.stringify(validated));
  f.engine.execute(f.draft('spell', { body: validated.value.abilities[0].body })); resolveAll(f.engine);
  assert.equal(f.kernel.getObject('enemy').damage, 2);
});
test('chain: entry triggers cannot become the origin or precede the card that opened the chain', () => {
  const f = fixture({ cards: [{ id: 'spell', types: ['spell'] }] });
  f.engine.openShowdown('A'); trigger(f, 'entry', { spec: { at: 'object-enters-chain' } });
  f.engine.execute(f.card('spell', { speed: 'action' }));
  assert.deepEqual(f.engine.items.map(item => item.kind), ['spell', 'triggered']);
  assert.deepEqual(f.engine.trace.filter(event => event.step === 'pending').map(event => event.item), ['spell', 'trigger:1']);
  resolveAll(f.engine); assert.equal(f.engine.focus, 'B');
});
test('chain: Add interrupts payment and resumes its parent Finalize without Priority transfer', () => {
  let f;
  f = fixture({ energy: 1, choose: request => {
    if (request.id === 'parent:base') { f.engine.activateAddDuringPayment(f.draft('resource', { kind: 'add', body: [add()] })); return 'normal'; }
  } });
  f.engine.execute(f.draft('parent', { cost: { id: 'parent', cost: { energy: c(3) }, baseChoices: [{ id: 'normal', cost: { energy: c(3) } }] } }));
  assert.equal(f.kernel.player('A').energy, 0);
  assert.deepEqual(f.engine.trace.filter(event => event.step === 'resolved').map(event => event.item), ['resource']);
  const trace = f.engine.trace, start = trace.findIndex(event => event.item === 'resource'), end = trace.findIndex(event => event.step === 'finalized' && event.item === 'parent');
  assert.equal(trace.slice(start, end + 1).some(event => event.step === 'priority-granted'), false);
  assert.equal(f.engine.items[0].id, 'parent');
});
test('chain: requirements and restrictions are checked during Finalize', () => {
  for (const field of ['requirements', 'restrictions']) {
    const f = fixture(); assert.throws(() => f.engine.execute(f.draft('illegal', { [field]: [{ kind: 'never' }] })), /legality/); assert.equal(f.engine.items.length, 0);
  }
});
test('chain: layers are read by target queries and expire at the registered timing', () => {
  const f = fixture(); f.engine.layers.addContinuous({ id: 'boost', layer: 'arithmetic', filter: { objectId: 'enemy' }, effect: { kind: 'add', property: 'might', value: c(2) } }, { type: 'end-of-turn' });
  f.engine.layers.setObjects(f.kernel.objects); assert.equal(f.engine.layers.evaluate(f.kernel.ref('enemy')).might, 7);
  trigger(f, 'layered-source', { source: f.kernel.getObject('enemy'), controller: 'B', spec: { at: 'main-end' } });
  f.engine.emit({ timingPoint: 'main-end' }); assert.equal(f.engine.items[0].source.might, 7);
  f.engine.emit({ timingPoint: 'turn-end' }); assert.equal(f.engine.layers.evaluate(f.kernel.ref('enemy')).might, 5);
});
