import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, resolveAll, createProgramBinding, cardProgramsById } from './helpers.mjs';

const SPELL = 'card.hash-6f5f348b612d7d8afb8d38e3f76ed436a62cd1d5d0abcb5a003c48de2e2741fb';
const ETB_UNIT = 'card.hash-31bab80a3ed5d98ccd6492ffb83f0c7d0192f5fdd9a176cd38334395723cf7fc';
const ARENA_BAR = 'card.hash-37383a14ededcbaee2260e042ca4d77c596e88247ee1ca23ff0256f8eb8e3982';

function binding() {
  return createProgramBinding({ cardPrograms: cardProgramsById });
}

function moveToBoard(f, id, location = { type: 'battlefield', id: 'battlefield-1' }) {
  f.engine.commit({ type: 'move-zone', object: f.kernel.ref(id), to: 'battlefield', location });
  return f.kernel.getObject(id);
}

test('program registry rejects judge-required and unknown programs', () => {
  const b = binding();
  assert.throws(() => b.registry.get('missing-card'), error => error.code === 'unknown-program');
  const blocked = [...cardProgramsById.values()].find(program => program.status === 'judge-required');
  assert.ok(blocked);
  assert.throws(() => b.registry.get(blocked.canonicalCardId), error => error.code === 'judge-required');
  const noAbility = [...cardProgramsById.values()].find(program => program.status === 'no-ability');
  assert.ok(noAbility);
  assert.throws(() => b.registry.get(noAbility.canonicalCardId), error => error.code === 'judge-required');
});

test('program keyword expansion preserves stacking and derives speed', () => {
  const b = binding();
  const source = {
    ref: { id: 'kw', zoneEntryId: 1 }, cardId: 'synthetic', name: 'kw', types: ['unit'], tags: [],
    keywords: [{ id: 'assault', value: 1 }, { id: 'assault', value: 2 }, { id: 'reaction' }], owner: 'A', controller: 'A',
    zone: 'board', location: { type: 'battlefield', id: 'battlefield-1' }, might: 1, energy: 1, power: ['Fury'],
    exhausted: false, damage: 0, stunned: false, buffs: 0, attachedTo: null, faceDown: false, isToken: false
  };
  const synthetic = { canonicalCardId: 'synthetic', rulesetVersion: 'core-1.5', status: 'executable', abilities: [], sourceText: 'synthetic' };
  const local = createProgramBinding({ cardPrograms: [synthetic] });
  const inspected = local.inspect(source);
  assert.equal(inspected.abilities[0].kind, 'static');
  assert.equal(inspected.abilities.some(ability => ability.kind === 'static'), true);
  assert.equal(b.registry.has('synthetic'), false);
});

test('spell program builds and resolves a ChainDraft', () => {
  const b = binding();
  const f = fixture({ cards: [{ id: 'spell', cardId: SPELL, types: ['spell'], energy: 4, power: [] }], describePlay: b.describePlay });
  b.attachLifecycle(f.engine);
  f.engine.commit({ type: 'play', object: f.kernel.ref('spell'), player: 'A' });
  f.engine.advance();
  resolveAll(f.engine);
  assert.equal(f.kernel.getObject('spell').zone, 'trash');
  assert.equal(f.kernel.player('A').handSize, 4);
  assert.equal(f.engine.pipeline.events.filter(event => event.timingPoint === 'card-drawn').length, 4);
  assert.deepEqual(f.engine.pipeline.events.filter(event => ['object-enters-chain', 'card-drawn', 'card-drawn', 'card-drawn', 'card-drawn', 'card-played', 'object-enters-trash'].includes(event.timingPoint)).map(event => event.timingPoint), ['object-enters-chain', 'card-drawn', 'card-drawn', 'card-drawn', 'card-drawn', 'card-played', 'object-enters-trash']);
});

test('play requirements and restrictions are forwarded to Chain Finalize', () => {
  const program = { canonicalCardId: 'legality-card', rulesetVersion: 'core-1.5', status: 'executable', sourceText: 'legality', abilities: [
    { kind: 'play', requirements: [{ kind: 'never' }], restriction: { kind: 'always' }, body: [] }
  ] };
  const b = createProgramBinding({ cardPrograms: [program] });
  const f = fixture({ cards: [{ id: 'spell', cardId: 'legality-card', types: ['spell'], energy: 1, power: [] }], describePlay: b.describePlay });
  const draft = b.describePlay({ type: 'play', object: f.kernel.ref('spell'), player: 'A' }, f.kernel.getObject('spell'));
  assert.deepEqual(draft.requirements, [{ kind: 'never' }]);
  assert.deepEqual(draft.restrictions, [{ kind: 'always' }]);
  assert.throws(() => f.engine.execute(draft), /Finalize legality failed/);
});

test('unit program registers its card-played trigger and resolves draw', () => {
  const b = binding();
  const f = fixture({ cards: [{ id: 'unit', cardId: ETB_UNIT, types: ['unit'], energy: 1, power: [], might: 3 }], describePlay: b.describePlay });
  b.attachLifecycle(f.engine);
  f.engine.commit({ type: 'play', object: f.kernel.ref('unit'), player: 'A', location: { type: 'battlefield', id: 'battlefield-1' } });
  f.engine.advance();
  resolveAll(f.engine);
  assert.equal(f.kernel.getObject('unit').zone, 'board');
  assert.equal(f.kernel.player('A').handSize, 1);
  assert.equal(f.engine.pipeline.events.some(event => event.timingPoint === 'card-played'), true);
  assert.equal(f.engine.pipeline.events.some(event => event.timingPoint === 'card-drawn'), true);
  assert.deepEqual(f.engine.pipeline.events.filter(event => ['object-enters-board', 'card-played', 'card-drawn'].includes(event.timingPoint)).map(event => event.timingPoint), ['object-enters-board', 'card-played', 'card-drawn']);
});

test('Arena Bar activation pays exhaust and buffs an exhausted friendly unit', () => {
  const b = binding();
  const f = fixture({ cards: [
    { id: 'arena', cardId: ARENA_BAR, types: ['gear'], energy: 3, power: [] },
    { id: 'target', types: ['unit'], energy: 1, power: [], might: 2 }
  ] });
  b.attachLifecycle(f.engine);
  moveToBoard(f, 'arena', { type: 'base', player: 'A' });
  moveToBoard(f, 'target');
  f.engine.commit({ type: 'exhaust', object: f.kernel.ref('target') });
  f.engine.advance();
  const draft = b.describeActivate(f.kernel.getObject('arena'), 'A');
  f.engine.execute(draft);
  resolveAll(f.engine);
  assert.equal(f.kernel.getObject('arena').exhausted, true);
  assert.equal(f.kernel.getObject('target').buffs, 1);
  assert.equal(f.engine.pipeline.events.some(event => event.timingPoint === 'buff-added'), true);
  assert.deepEqual(f.engine.pipeline.events.filter(event => ['object-exhausted', 'buff-added'].includes(event.timingPoint)).map(event => event.timingPoint), ['object-exhausted', 'object-exhausted', 'buff-added']);
});

test('static and replacement callbacks bind on entry and unbind on exit', () => {
  const calls = [];
  const program = { canonicalCardId: 'static-card', rulesetVersion: 'core-1.5', status: 'executable', sourceText: 'static', abilities: [
    { kind: 'static', effect: { kind: 'continuous.test' } },
    { kind: 'replacement', replaces: { event: 'damage-dealt' }, with: [] }
  ] };
  const b = createProgramBinding({ cardPrograms: [program], staticBinder: {
    bindStatic: (_ability, source) => { calls.push(`static+${source.ref.id}`); return { unbind: () => calls.push(`static-${source.ref.id}`) }; },
    bindReplacement: (_ability, source) => { calls.push(`replacement+${source.ref.id}`); return { unbind: () => calls.push(`replacement-${source.ref.id}`) }; }
  } });
  const f = fixture({ cards: [{ id: 'permanent', cardId: 'static-card', types: ['unit'], energy: 1, power: [] }], describePlay: b.describePlay });
  b.attachLifecycle(f.engine);
  f.engine.commit({ type: 'play', object: f.kernel.ref('permanent'), player: 'A' });
  f.engine.advance();
  assert.deepEqual(calls.slice(0, 2), ['static+permanent', 'replacement+permanent']);
  resolveAll(f.engine);
  f.engine.commit({ type: 'kill', object: f.kernel.ref('permanent') });
  assert.deepEqual(calls.slice(-2), ['static-permanent', 'replacement-permanent']);
});

test('detaching the lifecycle unregisters program triggers and continuous bindings', () => {
  const calls = [];
  const program = { canonicalCardId: 'detach-card', rulesetVersion: 'core-1.5', status: 'executable', sourceText: 'detach', abilities: [
    { kind: 'static', effect: { kind: 'continuous.test' } },
    { kind: 'triggered', trigger: { at: 'card-played', filter: { self: true } }, optional: false, body: [{ id: 'draw', op: 'effect.draw', args: { amount: { kind: 'constant', value: 1 } } }] }
  ] };
  const b = createProgramBinding({ cardPrograms: [program], staticBinder: {
    bindStatic: (_ability, source) => { calls.push(`static+${source.ref.id}`); return { unbind: () => calls.push(`static-${source.ref.id}`) }; }
  } });
  const f = fixture({ cards: [{ id: 'permanent', cardId: 'detach-card', types: ['unit'], energy: 1, power: [] }], describePlay: b.describePlay });
  const lifecycle = b.attachLifecycle(f.engine);
  f.engine.commit({ type: 'play', object: f.kernel.ref('permanent'), player: 'A' });
  f.engine.advance();
  assert.equal(calls.includes('static+permanent'), true);
  resolveAll(f.engine);
  const handAfterPlay = f.kernel.player('A').handSize;
  lifecycle.detach();
  assert.equal(calls.includes('static-permanent'), true);
  f.engine.emit({ timingPoint: 'card-played', object: f.kernel.getObject('permanent'), player: 'A' });
  f.engine.advance();
  assert.equal(f.kernel.player('A').handSize, handAfterPlay);
});
