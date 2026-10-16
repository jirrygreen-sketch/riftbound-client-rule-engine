import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, trigger, draw, c, resolveAll } from '../chain/helpers.mjs';

test('triggers-replacement-instead-basic', () => {
  const f = fixture(); trigger(f, 'death', { spec: { at: 'object-killed' } });
  f.engine.pipeline.registerReplacement({ id: 'save', matches: action => action.type === 'kill', apply: action => ({ status: 'replace', actions: [{ type: 'return-to-hand', object: action.object }] }) });
  const outcome = f.engine.commit({ type: 'kill', object: f.kernel.ref('enemy') });
  assert.equal(outcome.status, 'replaced'); assert.equal(f.kernel.getObject('enemy').zone, 'hand'); assert.equal(f.engine.items.length, 0);
  assert.equal(f.engine.pipeline.events.some(event => event.timingPoint === 'object-killed'), false);
});
test('triggers-replacement-enters-ready', () => {
  const f = fixture({ cards: [{ id: 'unit', types: ['unit'] }] });
  trigger(f, 'enters', { source: f.kernel.getObject('unit'), spec: { filter: { objectId: 'unit' } } });
  f.engine.pipeline.registerReplacement({ id: 'enter-ready', matches: action => action.type === 'move-zone' && action.to === 'base', apply: action => ({ status: 'replace', actions: [{ type: 'ready', object: action.object }, action] }) });
  f.engine.execute(f.card('unit', { kind: 'unit', body: [] }));
  assert.equal(f.kernel.getObject('unit').exhausted, false); assert.equal(f.engine.items[0].source.exhausted, false);
});
test('triggers-replacement-once-per-event', () => {
  const f = fixture(); let applications = 0;
  f.engine.pipeline.registerReplacement({ id: 'double', matches: action => action.type === 'damage', apply: action => { applications++; return { status: 'rewrite', action: { ...action, amount: action.amount * 2 } }; } });
  const outcome = f.engine.commit({ type: 'damage', source: f.kernel.ref('source'), target: f.kernel.ref('enemy'), amount: 1, combat: false });
  assert.equal(outcome.status, 'replaced'); assert.equal(applications, 1); assert.equal(f.kernel.getObject('enemy').damage, 2);
});
test('triggers-replacement-order-by-controller', () => {
  const choices = [];
  const f = fixture({ choose: request => { if (request.type === 'mode') { choices.push(request.chooser); return 'double'; } } });
  f.engine.pipeline.registerReplacement({ id: 'plus', matches: action => action.type === 'damage', apply: action => ({ status: 'rewrite', action: { ...action, amount: action.amount + 1 } }) });
  f.engine.pipeline.registerReplacement({ id: 'double', matches: action => action.type === 'damage', apply: action => ({ status: 'rewrite', action: { ...action, amount: action.amount * 2 } }) });
  f.engine.commit({ type: 'damage', source: f.kernel.ref('source'), target: f.kernel.ref('enemy'), amount: 1, combat: false });
  assert.deepEqual(choices, ['B']); assert.equal(f.kernel.getObject('enemy').damage, 3);
});
test('triggers-replacement-inherits-modifications', () => {
  const f = fixture(); const observed = [];
  f.engine.pipeline.registerReplacement({ id: 'plus', matches: action => action.type === 'damage' && action.amount === 1, apply: (action, original) => { observed.push([action.amount, original.amount]); return { status: 'rewrite', action: { ...action, amount: 2 } }; } });
  f.engine.pipeline.registerReplacement({ id: 'second', matches: action => action.type === 'damage' && action.amount === 2, apply: (action, original) => { observed.push([action.amount, original.amount]); return { status: 'rewrite', action: { ...action, amount: 3 } }; } });
  f.engine.commit({ type: 'damage', source: f.kernel.ref('source'), target: f.kernel.ref('enemy'), amount: 1, combat: false });
  assert.deepEqual(observed, [[1, 1], [2, 1]]); assert.equal(f.kernel.getObject('enemy').damage, 3);
});
test('triggers-replacement-not-applied-preserves-turn', () => {
  let accept = false;
  const f = fixture({ choose: request => request.type === 'optional' ? accept : undefined });
  f.engine.pipeline.registerReplacement({ id: 'save', optional: true, oncePerTurn: true, matches: action => action.type === 'damage', apply: () => ({ status: 'prevent' }) });
  const hit = () => f.engine.commit({ type: 'damage', source: f.kernel.ref('source'), target: f.kernel.ref('enemy'), amount: 1, combat: false });
  assert.equal(hit().status, 'done'); accept = true; assert.equal(hit().status, 'prevented'); assert.equal(hit().status, 'done'); assert.equal(f.kernel.getObject('enemy').damage, 2);
});
test('pipeline: fully prevented damage has no damage timing or trigger', () => {
  const f = fixture(); trigger(f, 'hurt', { spec: { at: 'damage-dealt' } });
  f.engine.pipeline.registerReplacement({ id: 'prevent', matches: action => action.type === 'damage', apply: () => ({ status: 'prevent' }) });
  const outcome = f.engine.commit({ type: 'damage', source: f.kernel.ref('source'), target: f.kernel.ref('enemy'), amount: 3, combat: false });
  assert.equal(outcome.status, 'prevented'); assert.equal(outcome.events.length, 0); assert.equal(f.kernel.getObject('enemy').damage, 0); assert.equal(f.engine.items.length, 0);
});
test('pipeline: replacement order re-prompts after a rewrite exposes candidates', () => {
  const f = fixture({ choose: request => request.type === 'mode' ? request.options[0] : undefined });
  f.engine.pipeline.registerReplacement({ id: 'one', matches: action => action.type === 'damage' && action.amount === 1, apply: action => ({ status: 'rewrite', action: { ...action, amount: 2 } }) });
  f.engine.pipeline.registerReplacement({ id: 'two', matches: action => action.type === 'damage' && action.amount >= 2, apply: action => ({ status: 'rewrite', action: { ...action, amount: action.amount + 1 } }) });
  f.engine.commit({ type: 'damage', source: f.kernel.ref('source'), target: f.kernel.ref('enemy'), amount: 1, combat: false });
  assert.equal(f.kernel.getObject('enemy').damage, 3);
});
test('pipeline: replaced primitive is negated but a linked instruction still executes', () => {
  const f = fixture(); f.engine.pipeline.registerReplacement({ id: 'replace-draw', matches: action => action.type === 'draw', apply: action => ({ status: 'replace', actions: [{ type: 'gain-energy', player: action.player, amount: 2 }] }) });
  f.engine.execute(f.draft('spell', { body: [draw('replaced'), { id: 'linked', op: 'effect.repeat', linkedTo: 'replaced', args: { count: c(1), action: { type: 'gain-energy', player: c('A'), amount: c(1) } } }] }));
  resolveAll(f.engine); assert.equal(f.kernel.player('A').handSize, 0); assert.equal(f.kernel.player('A').energy, 23);
});
test('pipeline: structural play also passes through replacement interception', () => {
  let f; f = fixture({ cards: [{ id: 'unit', types: ['unit'] }], describePlay: () => f.card('unit', { kind: 'unit', body: [] }) });
  f.engine.pipeline.registerReplacement({ id: 'prevent-play', matches: action => action.type === 'play', apply: () => ({ status: 'prevent' }) });
  assert.equal(f.engine.commit({ type: 'play', object: f.kernel.ref('unit'), player: 'A' }).status, 'prevented');
  assert.equal(f.kernel.getObject('unit').zone, 'hand'); assert.equal(f.engine.items.length, 0);
});
test('triggers-replacement-must-be-in-zone-before-event', () => {
  const f = fixture();
  f.engine.pipeline.registerReplacement({ id: 'trash-save', source: f.kernel.getObject('source'), activeZones: ['trash'], matches: action => action.type === 'kill', apply: () => ({ status: 'prevent' }) });
  assert.equal(f.engine.commit({ type: 'kill', object: f.kernel.ref('source') }).status, 'done');
  assert.equal(f.engine.commit({ type: 'kill', object: f.kernel.ref('enemy') }).status, 'prevented');
  assert.equal(f.kernel.getObject('enemy').zone, 'board');
});
test('pipeline: once-per-turn replacement belongs to a zone incarnation', () => {
  const f = fixture(); f.engine.pipeline.registerReplacement({ id: 'once', source: f.kernel.getObject('source'), oncePerTurn: true, matches: action => action.type === 'damage', apply: () => ({ status: 'prevent' }) });
  const hit = () => f.engine.commit({ type: 'damage', source: f.kernel.ref('source'), target: f.kernel.ref('enemy'), amount: 1, combat: false });
  assert.equal(hit().status, 'prevented'); assert.equal(hit().status, 'done');
  f.engine.commit({ type: 'return-to-hand', object: f.kernel.ref('source') }); f.engine.commit({ type: 'move-zone', object: f.kernel.ref('source'), to: 'base' });
  assert.equal(hit().status, 'prevented'); assert.equal(f.kernel.getObject('enemy').damage, 1);
});
