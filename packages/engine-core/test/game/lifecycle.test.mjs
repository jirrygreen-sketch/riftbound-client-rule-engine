import test from 'node:test';
import assert from 'node:assert/strict';
import { world } from '../../dist/effects/testing/test-kernel.js';
import { bindResolveContext, createActionPipelineHost } from '../../dist/events/action-adapter.js';
import { createMatch, concede } from '../../dist/game/lifecycle.js';

function card(id, types = ['unit']) {
  return { id, cardId: 'card:' + id, types };
}

function deck() {
  return {
    mainDeck: Array.from({ length: 16 }, (_, index) => card('a' + index)),
    runeDeck: Array.from({ length: 4 }, (_, index) => card('r' + index, ['rune'])),
    championLegend: card('legend-A', ['legend']),
    chosenChampion: card('champion-A', ['champion']),
    battlefields: [card('bfA1', ['battlefield']), card('bfA2', ['battlefield']), card('bfA3', ['battlefield'])],
  };
}

function makeHost() {
  const kernel = world().player('A').player('B').build();
  const pipelineHost = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: saved => {
      kernel.restore(saved.state);
      kernel.copyLinkedFrom(saved.links);
    },
    objects: () => kernel.objects,
    perform: action => kernel.perform(action),
    choose: () => {
      throw new Error('match setup made no choices');
    },
    context: (source, controller, timingPoint) => bindResolveContext(kernel, { source, controller, timingPoint }),
    testTrigger: () => false,
  });
  return {
    host: Object.assign(Object.create(Object.getPrototypeOf(pipelineHost)), pipelineHost, {
      player: id => kernel.player(id),
    }),
    kernel,
  };
}

function match(overrides = {}) {
  const made = makeHost();
  const options = {
    decks: [deck(), deck()],
    seed: 'test-seed',
    host: made.host,
    ...overrides,
  };
  return { match: createMatch(options), kernel: made.kernel };
}

function zoneCards(kernel, player, zone) {
  return kernel.objectsInZone(player, zone).map(ref => kernel.getObject(ref.id).cardId);
}

function playUnitToBattlefield(match, kernel, player, handCardId, fieldId) {
  const handCard = kernel.objects.find(object =>
    object.controller === player && object.zone === 'hand' && object.cardId === 'card:' + handCardId);
  if (!handCard) throw new Error('playUnitToBattlefield: ' + handCardId + ' not in ' + player + ' hand');
  const snapshot = kernel.getObject(handCard.ref.id);
  match.flow.execute({
    id: 'entry:' + handCard.ref.id,
    controller: player,
    source: snapshot,
    kind: 'unit',
    body: [],
    cost: { id: 'cost:entry', cost: { energy: { kind: 'constant', value: 0 }, power: { kind: 'constant', value: [] } } },
    location: { type: 'battlefield', id: fieldId },
  });
}

function firstUnitInHand(match, kernel, player) {
  const found = kernel.objects.find(object =>
    object.controller === player && object.zone === 'hand' &&
    kernel.getObject(object.ref.id).types.includes('unit'));
  if (!found) throw new Error('no unit card in ' + player + ' hand');
  return found.cardId.slice('card:'.length);
}

function idleBattlefieldLoop(match, kernel, entryPlayer, entryCardId) {
  let entered = !entryPlayer;
  let guard = 0;
  while (!match.result().winner) {
    if (++guard > 1000) throw new Error('Match did not finish');
    const flow = match.flow;
    const active = flow.turnPlayer;
    if (!entered && active === entryPlayer && flow.phase === 'main' && !flow.chain.items.length && !flow.combat.active &&
        flow.chain.priority === active && flow.chain.canAct(active, 'normal')) {
      playUnitToBattlefield(
        match, kernel, active,
        entryCardId ?? firstUnitInHand(match, kernel, active),
        match.setup.battlefields[0].id);
      entered = true;
      continue;
    }
    if (flow.chain.items.length || flow.combat.active) {
      flow.pass(flow.chain.priority);
    } else {
      flow.endTurn(flow.turnPlayer);
    }
  }
}

test('setup-legend-and-champion-zones-populated', () => {
  const { match: m, kernel } = match();
  assert.deepEqual(m.setup.legendZone.A, ['card:legend-A']);
  assert.deepEqual(m.setup.championZone.A, ['card:champion-A']);
  const legend = kernel.objects.find(object => object.cardId === 'card:legend-A' && object.owner === 'A');
  assert.equal(legend.zone, 'legend');
  assert.deepEqual(legend.types, ['legend']);
  const champion = kernel.objects.find(object => object.cardId === 'card:champion-A' && object.owner === 'A');
  assert.equal(champion.zone, 'chain');
  assert.deepEqual(champion.types, ['champion']);
});

test('setup-carries-printed-card-characteristics into every created object', () => {
  const printedUnit = {
    ...card('printed-unit', ['unit']),
    cardType: 'Unit',
    tags: ['Mech', 'Champion'],
    domains: ['Fury'],
    energy: 4,
    power: 2,
    might: 5,
  };
  const unprintedRune = {
    ...card('printed-rune', ['rune']),
    cardType: 'Rune',
    tags: ['Basic'],
    domains: ['Mind'],
    energy: null,
    power: null,
    might: null,
  };
  const printedSpell = {
    ...card('printed-spell'),
    types: undefined,
    cardType: 'Spell',
    domains: ['Calm'],
    energy: 1,
    power: null,
    might: null,
  };
  const domainlessUnit = {
    ...card('domainless-unit', ['unit']),
    cardType: 'Unit',
    domains: [],
    energy: 2,
    power: 1,
    might: 3,
  };
  const first = deck();
  const second = deck();
  first.mainDeck = [printedUnit, printedSpell, domainlessUnit, ...first.mainDeck.slice(3)];
  first.runeDeck = [unprintedRune, ...first.runeDeck.slice(1)];
  const { kernel } = match({ decks: [first, second], battlefieldChoice: [0, 0], mulligans: [[], []] });
  const unit = kernel.objects.find(object => object.cardId === 'card:printed-unit');
  assert.ok(unit);
  assert.deepEqual(unit.types, ['unit']);
  assert.deepEqual(unit.tags, ['Mech', 'Champion']);
  assert.equal(unit.energy, 4);
  assert.deepEqual(unit.power, ['Fury']);
  assert.equal(unit.might, 5);
  const spell = kernel.objects.find(object => object.cardId === 'card:printed-spell');
  assert.ok(spell);
  assert.deepEqual(spell.types, ['spell']);
  assert.equal(spell.energy, 1);
  assert.equal(spell.power, null);
  const domainless = kernel.objects.find(object => object.cardId === 'card:domainless-unit');
  assert.ok(domainless);
  assert.deepEqual(domainless.power, ['Fury', 'Calm', 'Mind', 'Body', 'Chaos', 'Order']);
  const rune = kernel.objects.find(object => object.cardId === 'card:printed-rune');
  assert.ok(rune);
  assert.deepEqual(rune.types, ['rune']);
  assert.deepEqual(rune.tags, ['Basic']);
  assert.equal(rune.energy, null);
  assert.equal(rune.power, null);
});

test('setup-legend-not-shuffled-into-deck', () => {
  const { match: m, kernel } = match();
  const main = zoneCards(kernel, 'A', 'deck');
  assert.equal(m.setup.mainDeckCount.A, 16);
  assert.equal(main.length, 11);
  assert.ok(!main.includes('card:legend-A'));
  assert.ok(!main.includes('card:champion-A'));
  assert.ok(m.setup.legendZone.A.includes('card:legend-A'));
});

test('setup-battlefield-selection-duel-random with explicit choices', () => {
  const { match: m, kernel } = match({ battlefieldChoice: [1, 2] });
  assert.deepEqual(m.setup.battlefields.map(field => field.cardId), ['card:bfA2', 'card:bfA3']);
  for (const field of m.setup.battlefields) {
    const object = kernel.getObject(field.id);
    assert.equal(object.zone, 'board');
    assert.deepEqual(object.location, { type: 'battlefield', id: object.ref.id });
  }
  assert.deepEqual(m.setup.removedBattlefields.A, ['card:bfA1', 'card:bfA3']);
  assert.deepEqual(m.setup.removedBattlefields.B, ['card:bfA1', 'card:bfA2']);
});

test('setup-main-and-rune-decks-shuffled-separately', () => {
  const { match: m, kernel } = match({ battlefieldChoice: [0, 0] });
  assert.deepEqual([m.setup.mainDeckCount.A, m.setup.runeDeckCount.A], [16, 4]);
  const first = zoneCards(kernel, 'A', 'deck').slice(0, 4);
  assert.equal(first.length, 4);
  assert.ok(first.every(cardId => cardId.startsWith('card:a')));
  const runes = zoneCards(kernel, 'A', 'rune-deck');
  assert.equal(m.setup.runeDeckCount.A, 4);
  assert.equal(runes.length, 2);
});

test('setup-first-player-takes-first-turn', () => {
  const { match: m } = match({ firstPlayer: 1 });
  assert.deepEqual(m.turnOrder, ['B', 'A']);
  assert.equal(m.firstPlayer, 'B');
  assert.equal(m.flow.turnPlayer, 'B');
  assert.equal(m.flow.turn, 1);
  assert.equal(m.flow.phase, 'main');
});

test('setup-opening-draw-four', () => {
  const { match: m, kernel } = match({ battlefieldChoice: [0, 0], mulligans: [[], []] });
  assert.deepEqual(m.setup.openingHands.A.length, 4);
  assert.deepEqual(m.setup.openingHands.B.length, 4);
  assert.equal(kernel.player('A').handCount, 5);
  assert.equal(kernel.player('B').handCount, 4);
  assert.equal(m.setup.hands.A.length, 5);
});

test('setup-mulligan-partial-two', () => {
  const { match: m, kernel } = match({ battlefieldChoice: [0, 0], mulligans: [['card:a3', 'card:a5'], []] });
  const hand = zoneCards(kernel, 'A', 'hand');
  assert.equal(hand.length, 5);
  assert.ok(!hand.includes('card:a5'));
  assert.ok(!hand.includes('card:a3'));
  const bottom = zoneCards(kernel, 'A', 'deck').slice(-2);
  assert.deepEqual(bottom.sort(), ['card:a3', 'card:a5']);
  assert.deepEqual(m.setup.mulligans.A, ['card:a3', 'card:a5']);
  assert.deepEqual(m.setup.mulligans.B, []);
});

test('setup-mulligan-keep-all', () => {
  const { match: m } = match({ battlefieldChoice: [0, 0], mulligans: [[], []] });
  assert.deepEqual(m.setup.openingHands.A, ['card:a3', 'card:a5', 'card:a10', 'card:a13']);
});

test('setup-mulligan-max-two rejects three cards', () => {
  assert.throws(
    () => match({ mulligans: [['card:a0', 'card:a3', 'card:a5'], []] }),
    /at most two/,
  );
});

test('setup-mulligan-with-empty-deck still completes the draw', () => {
  const { kernel } = match({ battlefieldChoice: [0, 0], mulligans: [['card:a3', 'card:a5'], []] });
  assert.equal(kernel.player('A').handCount, 5);
  assert.ok(!zoneCards(kernel, 'A', 'hand').includes('card:a3'));
});

test('setup-battlefield-selection-match-choice keeps turn-1 main phase', () => {
  const { match: m } = match({ battlefieldChoice: [2, 0], firstPlayer: 0 });
  assert.deepEqual(m.setup.battlefields.map(field => field.cardId), ['card:bfA3', 'card:bfA1']);
  assert.equal(m.flow.turnPlayer, 'A');
  assert.equal(m.flow.phase, 'main');
});

test('seeded match is deterministic for shuffle order', () => {
  const first = match({ battlefieldChoice: [0, 0] });
  const second = match({ battlefieldChoice: [0, 0] });
  assert.equal(first.match.seedSource, 'given');
  assert.equal(first.match.seed, second.match.seed);
  assert.deepEqual(zoneCards(first.kernel, 'A', 'deck'), zoneCards(second.kernel, 'A', 'deck'));
  assert.deepEqual(zoneCards(first.kernel, 'A', 'rune-deck'), zoneCards(second.kernel, 'A', 'rune-deck'));
});

test('different seeds shuffle differently', () => {
  const first = match({ seed: 'seed-one', battlefieldChoice: [0, 0] }).match;
  const second = match({ seed: 'seed-two', battlefieldChoice: [0, 0] }).match;
  assert.notEqual(first.seed, second.seed);
});

test('unit entry through the chain puts a real unit on the battlefield', () => {
  const { match: m, kernel } = match({ battlefieldChoice: [0, 0], firstPlayer: 0 });
  const fieldId = m.setup.battlefields[0].id;
  playUnitToBattlefield(m, kernel, 'A', firstUnitInHand(m, kernel, 'A'), fieldId);
  const entered = kernel.objects.find(object => object.zone === 'board' && object.controller === 'A' && object.types.includes('unit'));
  assert.equal(entered.zone, 'board');
  assert.deepEqual(entered.location, { type: 'battlefield', id: fieldId });
});

test('idle turns end by Hold scoring at the victory threshold', () => {
  const { match: m, kernel } = match({
    battlefieldChoice: [0, 0],
    firstPlayer: 0,
    mulligans: [[], []],
    victoryScore: 2,
  });
  idleBattlefieldLoop(m, kernel, 'A');
  assert.equal(m.result().winner, 'A');
  const events = m.flow.chain.pipeline.events.map(event => event.timingPoint);
  assert.ok(events.includes('hold'));
  assert.ok(events.includes('score'));
  assert.ok(events.includes('turn-start'));
  assert.ok(kernel.player('A').score >= 2);
  assert.ok(m.result().turnNumber >= 3);
});

test('idle turns end by Conquer at score one', () => {
  const { match: m, kernel } = match({
    battlefieldChoice: [0, 0],
    firstPlayer: 0,
    mulligans: [[], []],
    victoryScore: 1,
  });
  idleBattlefieldLoop(m, kernel, 'A');
  assert.equal(m.result().winner, 'A');
  assert.ok(kernel.player('A').score >= 1);
});

test('concede-ends-game', () => {
  const { match: m } = match({ battlefieldChoice: [0, 0], firstPlayer: 0 });
  concede(m, 'B');
  assert.equal(m.result().winner, 'A');
  assert.throws(() => concede(m, 'A'), /already over/);
});

test('rulesetVersion rejects other versions', () => {
  const made = makeHost();
  assert.throws(
    () => createMatch({ decks: [deck(), deck()], seed: 'test-seed', host: made.host, rulesetVersion: 'core-1.4' }),
    /Unsupported ruleset/,
  );
});
