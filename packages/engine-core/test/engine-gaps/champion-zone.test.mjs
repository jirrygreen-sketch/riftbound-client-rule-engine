import assert from 'node:assert/strict';
import test from 'node:test';

import { world } from '../../dist/effects/testing/test-kernel.js';
import { bindResolveContext, createActionPipelineHost } from '../../dist/events/action-adapter.js';
import { createMatch } from '../../dist/game/lifecycle.js';

// Core Rules v1.5, published 2026-10-09 and effective 2026-10-16:
// https://cmsassets.rgpub.io/sanity/files/dsfx7636/news_live/5c7946f7c3b8c6e0faff85ab6dadc6d2e721ea94.pdf
// 103.3.a.1/103.3.a.3: the specific Chosen Champion card begins in the
// Champion Zone. 108.3.b/d/e: it is public and can be played as normal.
// 112: setup separates and places it there. CR 420.1.a confirms Champion Zone
// is a default card-play source.

const EVIDENCE = Object.freeze({
  ruleset: 'core-1.5',
  published: '2026-10-09',
  effective: '2026-10-16',
  url: 'https://cmsassets.rgpub.io/sanity/files/dsfx7636/news_live/5c7946f7c3b8c6e0faff85ab6dadc6d2e721ea94.pdf',
  rules: Object.freeze(['103.3.a.1', '103.3.a.3', '108.3.b', '108.3.d', '108.3.e', '112', '420.1.a']),
});

const program = Object.freeze({
  canonicalCardId: 'card.hash-champion-zone-unit',
  rulesetVersion: 'core-1.5',
  status: 'executable',
  sourceText: 'Play me.',
  abilities: Object.freeze([Object.freeze({
    kind: 'play',
    body: Object.freeze([]),
  })]),
});

function card(id, zone, cardType = 'Unit') {
  const champion = zone === 'champion' ? cardType === 'Champion' : false;
  return {
    id,
    cardId: champion ? 'printing:' + program.canonicalCardId : `printing:${zone}:${id}`,
    canonicalCardId: champion ? program.canonicalCardId : `canonical:${zone}:${id}`,
    name: champion ? 'Champion Zone Unit' : `${cardType} ${id}`,
    cardType,
    types: [zone === 'champion' ? 'champion' : cardType.toLowerCase()],
    tags: champion ? ['Champion Tag'] : [],
    domains: ['Fury'],
    energy: zone === 'champion' ? 2 : cardType === 'Unit' ? 0 : null,
    power: zone === 'champion' ? 1 : cardType === 'Unit' ? 0 : null,
    might: zone === 'champion' ? 4 : cardType === 'Unit' ? 1 : null,
  };
}

function deck() {
  return {
    mainDeck: Array.from({ length: 16 }, (_, index) => card(`main-${index}`, 'mainDeck')),
    runeDeck: Array.from({ length: 4 }, (_, index) => card(`rune-${index}`, 'runes', 'Rune')),
    championLegend: card('legend', 'legend', 'Legend'),
    chosenChampion: card('champion', 'champion', 'Champion'),
    battlefields: [0, 1, 2].map(index => card(`field-${index}`, 'battlefields', 'Battlefield')),
  };
}

function makeMatch() {
  const kernel = world().player('A').player('B').build();
  const pipelineHost = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: saved => {
      kernel.restore(saved.state);
      kernel.copyLinkedFrom(saved.links);
    },
    objects: () => kernel.objects,
    perform: action => kernel.perform(action),
    choose: () => { throw new Error('Champion Zone setup made an unexpected choice'); },
    context: (source, controller, timingPoint) => bindResolveContext(kernel, {
      source, controller, timingPoint,
    }),
  });
  const host = Object.assign(Object.create(Object.getPrototypeOf(pipelineHost)), pipelineHost, {
    player: id => kernel.player(id),
  });
  const match = createMatch({
    decks: [deck(), deck()],
    host,
    programs: { programs: [program] },
    seed: 'RIFT-1152-champion-zone',
    firstPlayer: 0,
    battlefieldChoice: [0, 0],
    mulligans: [[], []],
  });
  return { match, kernel };
}

test('RIFT-1152 setup places the Chosen Champion as a printable Unit card in its Champion Zone', () => {
  const { match, kernel } = makeMatch();
  assert.deepEqual(match.setup.championZone.A, ['printing:card.hash-champion-zone-unit']);
  assert.deepEqual(match.setup.championZone.B, ['printing:card.hash-champion-zone-unit']);

  for (const player of ['A', 'B']) {
    const champion = kernel.objectsInZone(player, 'champion')
      .map(ref => kernel.getObject(ref.id))
      .find(object => object.cardId === program.canonicalCardId);
    assert.ok(champion, `${player} has a materialized Champion Zone card`);
    assert.equal(champion.zone, 'champion');
    assert.equal(champion.owner, player);
    assert.equal(champion.isToken, false, 'the Chosen Champion is a card, not a token');
    assert.deepEqual(champion.types, ['unit']);
    assert.deepEqual(champion.tags, ['Champion Tag']);
    assert.equal(champion.energy, 2);
    assert.deepEqual(champion.power, ['Fury']);
    assert.equal(champion.might, 4);
  }
  assert.equal(kernel.player('A').handCount, 5,
    'the real turn draw adds exactly one card and Champion Zone placement changes no Hand count');
  assert.equal(match.setup.mainDeckCount.A, 16,
    'the setup report counts the 16-card Main Deck, excluding the Chosen Champion');
  assert.equal(match.programBinding?.registry.has(program.canonicalCardId), true,
    'the same canonical id resolves to the bound card program');
  assert.deepEqual(EVIDENCE.rules, ['103.3.a.1', '103.3.a.3', '108.3.b', '108.3.d', '108.3.e', '112', '420.1.a']);
});

test('RIFT-1152 a Chosen Champion is played from Champion Zone through the real Chain and leaves it', () => {
  const { match, kernel } = makeMatch();
  const championRef = kernel.objectsInZone('A', 'champion')[0];
  const champion = kernel.getObject(championRef.id);
  assert.ok(champion);
  const base = { type: 'base', player: 'A' };
  kernel.addPlayer('A', { energy: 2, power: ['Fury'] });
  const draft = match.programBinding.describePlay({
    type: 'play', object: champion.ref, player: 'A', location: base,
  }, champion);
  match.flow.execute(draft);
  assert.deepEqual(kernel.objectsInZone('A', 'champion'), [], 'Champion Zone is empty after Play');
  assert.ok(match.events().some(event => event.timingPoint === 'object-leaves-zone' &&
    event.object?.ref.id === champion.ref.id && event.object.zone === 'champion'),
  'the Card left Champion Zone through the real lifecycle edge');
  const played = kernel.objects.find(object => object.ref.id === champion.ref.id);
  assert.ok(played);
  assert.equal(played.zone, 'board');
  assert.deepEqual(played.location, base);
  assert.deepEqual(kernel.objectsInZone('A', 'champion'), [], 'Finalize does not return the card to Champion Zone');
});
