import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, resolveAll, createProgramBinding, cardProgramsById } from './helpers.mjs';
import { restrictions } from '../../dist/layers/rules/query.js';

const constant = value => ({ kind: 'constant', value });
const card = (canonicalCardId, abilities) => ({
  canonicalCardId,
  rulesetVersion: 'core-1.5',
  status: 'executable',
  sourceText: canonicalCardId,
  abilities,
});

function board(f, id, location = { type: 'battlefield', id: 'battlefield-1' }) {
  f.engine.commit({ type: 'move-zone', object: f.kernel.ref(id), to: 'battlefield', location });
}

test('default program binding connects static layers, live conditions, aura rules, and entry replacement', () => {
  const mergedCards = [
    'card.hash-cf0b322a78010676e3d8b287830194a3bdc8970e65a141578ae8a3074ebd956f',
    'card.hash-1504d8f14af5ce1b9f7a3663c23e6ef7cb57d59a6274dc921cd9296ee8e2494b',
    'card.hash-fadaa09c681d3d967954f99504cd9d3d749242dc99dbc40d60adfa60bf53cca7',
  ].map(id => cardProgramsById.get(id));
  assert.equal(mergedCards.every(Boolean), true, 'the merged card programs are present');
  const programs = [
    ...mergedCards,
    card('card.static-might', [{
      kind: 'static',
      effect: { kind: 'continuous.might', layer: 'arithmetic', appliesTo: 'self', amount: constant(2) },
    }]),
    card('card.conditional-might', [{
      kind: 'static',
      effect: { kind: 'continuous.might', layer: 'arithmetic', appliesTo: 'self', amount: constant(3) },
      condition: {
        kind: 'compare',
        left: { kind: 'object-property', object: 'self', property: 'exhausted' },
        operator: 'eq',
        right: constant(false),
      },
    }]),
    card('card.aura-restriction', [{
      kind: 'static',
      effect: {
        kind: 'continuous.restrict',
        actions: ['reveal'],
        restriction: 'cannot-reveal-friendly-units',
        filter: { type: 'unit', controller: 'controller', zone: 'board' },
      },
    }]),
    card('card.entry-ready', [
      { kind: 'play', body: [] },
      {
        kind: 'replacement',
        replaces: { event: 'object-enters-board', filter: { self: true } },
        with: [{ id: 'entry-ready', op: 'effect.ready', args: { objects: constant({ kind: 'source' }) } }],
      },
    ]),
  ];
  const binding = createProgramBinding({ cardPrograms: programs });
  const f = fixture({
    cards: [
      { id: 'might', cardId: 'card.static-might', types: ['unit'], might: 2 },
      { id: 'conditional', cardId: 'card.conditional-might', types: ['unit'], might: 2 },
      { id: 'aura', cardId: 'card.aura-restriction', types: ['unit'], might: 2 },
      { id: 'keyword', cardId: 'card.hash-fadaa09c681d3d967954f99504cd9d3d749242dc99dbc40d60adfa60bf53cca7', types: ['unit'], tags: ['Mech'], might: 2 },
      { id: 'entry', cardId: 'card.entry-ready', types: ['unit'], might: 2 },
      { id: 'ally', types: ['unit'], tags: ['Mech'], might: 2 },
    ],
    describePlay: binding.describePlay,
  });
  binding.attachLifecycle(f.engine);

  for (const id of ['might', 'conditional', 'aura', 'keyword', 'ally']) board(f, id);
  f.engine.layers.setObjects(f.kernel.objects);

  assert.equal(f.engine.layers.snapshot(f.kernel.ref('might')).might, 4, 'static Might is read through arithmetic layers');
  assert.equal(f.engine.layers.snapshot(f.kernel.ref('conditional')).might, 5, 'condition is true while ready');

  f.engine.commit({ type: 'exhaust', object: f.kernel.ref('conditional') });
  f.engine.layers.setObjects(f.kernel.objects);
  assert.equal(f.engine.layers.snapshot(f.kernel.ref('conditional')).might, 2, 'condition is re-evaluated after the object changes');

  const ally = f.engine.layers.snapshot(f.kernel.ref('ally'));
  assert.ok(ally.keywords.some(keyword => keyword.id.toLowerCase() === 'shield' && keyword.value === 1), 'aura keyword is applied to a friendly Mech');
  const auraRestrictions = restrictions(f.engine.layers.registry, 'reveal', f.kernel.ref('ally'), ally, 'A');
  assert.equal(auraRestrictions.length, 1);
  assert.equal(auraRestrictions[0].name, 'cannot-reveal-friendly-units');

  f.engine.commit({ type: 'kill', object: f.kernel.ref('aura') });
  f.engine.layers.setObjects(f.kernel.objects);
  const afterAuraLeaves = f.engine.layers.snapshot(f.kernel.ref('ally'));
  assert.equal(restrictions(f.engine.layers.registry, 'reveal', f.kernel.ref('ally'), afterAuraLeaves, 'A').length, 0, 'aura restriction is removed on exit');

  f.engine.commit({ type: 'play', object: f.kernel.ref('entry'), player: 'A', location: { type: 'battlefield', id: 'battlefield-1' } });
  f.engine.advance();
  resolveAll(f.engine);
  assert.equal(f.kernel.getObject('entry').zone, 'board');
  assert.equal(f.kernel.getObject('entry').exhausted, false, 'replacement readies a unit that would enter exhausted');
});
