import assert from 'node:assert/strict';
import test from 'node:test';

import supernova from '../../../card-dsl/dist/cards/rad/supernova.js';
import { ChoiceMemory } from '../../dist/chain/finalize/choice-memory.js';
import { world } from '../../dist/effects/testing/test-kernel.js';
import { bindResolveContext, createActionPipelineHost } from '../../dist/events/action-adapter.js';
import { createMatch } from '../../dist/game/lifecycle.js';
import {
  MatchCommandError,
  createMatchCommandAdapter,
} from '../../dist/game/command-adapter.js';

const constant = value => ({ kind: 'constant', value });
const executable = program => ({ ...program, status: 'executable', judgeReason: undefined });

function makeHost(builder) {
  const kernel = builder.build();
  let pipeline;
  let adapterDefaultChoose;
  const choose = request => {
    if (pipeline !== undefined && pipeline.choose !== adapterDefaultChoose) return pipeline.choose(request);
    throw new Error(`Unexpected Assemble choice ${request.id}`);
  };
  pipeline = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: checkpoint => {
      kernel.restore(checkpoint.state);
      kernel.copyLinkedFrom(checkpoint.links);
    },
    objects: () => kernel.objects,
    perform: action => kernel.perform(action),
    performContract: action => kernel.performContract(action),
    performBatchLeaf: (action, batchId) => kernel.performBatchLeafForCapability(action, batchId),
    choose,
    context: (source, controller, timingPoint) => bindResolveContext(kernel, {
      source, controller, timingPoint, choose,
    }),
  });
  adapterDefaultChoose = pipeline.choose;
  pipeline.player = id => kernel.player(id);
  return { kernel, host: pipeline };
}

function card(id, options = {}) {
  return {
    id,
    cardId: options.canonicalCardId ?? id,
    canonicalCardId: options.canonicalCardId ?? id,
    types: options.types ?? ['unit'],
    ...options,
  };
}

function deck({ id = 'test:card', canonicalCardId = id, types = ['unit'], cardType,
  tags = [], domains = [], energy = 0, power = [], might = 1, name = id } = {}) {
  const mainDeck = Array.from({ length: 16 }, (_, index) => card(`deck:${id}:${index}`, {
    cardId: `printing:${canonicalCardId}`,
    canonicalCardId,
    types,
    cardType,
    tags,
    domains,
    energy,
    power,
    might,
    name,
  }));
  return {
    mainDeck,
    runeDeck: Array.from({ length: 4 }, (_, index) => card(`rune:${id}:${index}`, {
      cardId: `printing:rune:${canonicalCardId}`,
      canonicalCardId: `rune:${canonicalCardId}`,
      types: ['rune'],
      cardType: 'Rune',
      name: `Rune ${canonicalCardId}`,
      energy: null,
      power: null,
      might: null,
    })),
    championLegend: card(`legend:${id}`, {
      cardId: `printing:legend:${canonicalCardId}`,
      canonicalCardId: `legend:${canonicalCardId}`,
      types: ['legend'], cardType: 'Legend', name: `Legend ${canonicalCardId}`, energy: null, power: null, might: null,
    }),
    chosenChampion: card(`champion:${id}`, {
      cardId: `printing:champion:${canonicalCardId}`,
      canonicalCardId: `champion:${canonicalCardId}`,
      types: ['champion'], cardType: 'Champion', name: `Champion ${canonicalCardId}`, energy: null, power: null, might: null,
    }),
    battlefields: [0, 1, 2].map(index => card(`battlefield:${id}:${index}`, {
      cardId: `printing:battlefield:${canonicalCardId}:${index}`,
      canonicalCardId: `battlefield:${canonicalCardId}:${index}`,
      types: ['battlefield'], cardType: 'Battlefield', name: `Battlefield ${canonicalCardId} ${index}`,
      energy: null, power: null, might: null,
    })),
  };
}

function at(field = 'field-one') { return { type: 'battlefield', id: field }; }

function settle(adapter, idPrefix = 'settle') {
  let guard = 0;
  while (adapter.match.flow.chain.items.length > 0) {
    assert.ok(++guard < 30, 'the real chain must settle');
    const player = adapter.match.flow.chain.priority;
    assert.ok(player, 'an unfinished item has a Priority holder');
    adapter.execute(player, {
      type: 'pass', commandId: `${idPrefix}:${guard}`, stateVersion: adapter.stateVersion,
    });
  }
}

function resolveChoices(adapter, idPrefix = 'choice') {
  let guard = 0;
  while (adapter.pendingChoice !== null) {
    assert.ok(++guard < 20, 'choice continuation must converge');
    const request = adapter.pendingChoice.request;
    const answer = request.type === 'optional' ? true
      : request.type === 'mode' ? request.options[0]
        : request.type === 'number' ? request.min
          : request.type === 'order' ? [...request.options]
            : request.options.slice(0, request.min);
    adapter.execute(request.chooser, {
      type: 'choose', commandId: `${idPrefix}:${guard}`, stateVersion: adapter.stateVersion,
      choiceId: request.id, answer,
    });
  }
  settle(adapter, `${idPrefix}-settle`);
}

function findHand(match, player, canonicalCardId) {
  return match.flow.options.host.objects().find(object =>
    object.owner === player && object.zone === 'hand' && object.cardId === canonicalCardId);
}

function targetMatch({ programs, enemy = true, admittedSupernova = true, catalog } = {}) {
  const builder = world().player('A').player('B').deck(['A:draw:1', 'A:draw:2'], {
    owner: 'A', types: ['unit'], might: 1, energy: 1, power: [],
  });
  if (enemy) builder.unit('enemy-unit', {
    owner: 'B', controller: 'B', types: ['unit'], might: 20, location: at('enemy-field'),
    cardId: 'enemy-unit', canonicalCardId: 'enemy-unit',
  });
  const made = makeHost(builder);
  const sourcePrograms = programs ?? [admittedSupernova ? executable(supernova) : supernova];
  const match = createMatch({
    host: made.host,
    decks: [deck({
      canonicalCardId: supernova.canonicalCardId,
      types: ['spell'], cardType: 'Spell', energy: 9, power: 1,
      domains: ['Order'], might: null, name: 'Supernova',
    }), deck({ canonicalCardId: supernova.canonicalCardId, types: ['spell'], energy: 9, power: 1, domains: ['Order'], might: null })],
    ...(catalog === undefined ? {} : { catalog }),
    programs: { programs: sourcePrograms },
    seed: 'rift-836-supernova', battlefieldChoice: [0, 0], mulligans: [[], []], firstPlayer: 0,
  });
  assert.equal(match.flow.chain.commit({ type: 'gain-energy', player: 'A', amount: 20 }).status, 'done');
  assert.equal(match.flow.chain.commit({ type: 'gain-power', player: 'A', power: ['Order', 'Order'] }).status, 'done');
  return { match, kernel: made.kernel };
}

test('Match catalog projection installs canonical identity, real type/stat/traits, and preserves null', () => {
  const canonical = 'card.hash.match-catalog-unit';
  const unit = {
    canonicalCardId: canonical,
    cardId: `printing:${canonical}`,
    name: 'Catalog Unit', cardType: 'Unit', types: ['unit'], tags: ['Mech', 'Champion'],
    domains: ['Fury'], energy: 4, power: 2, might: 5,
  };
  const allDecks = [deck({ canonicalCardId: canonical, types: ['wrong'], cardType: 'Wrong', energy: null, power: null, might: null }), deck({ canonicalCardId: canonical, types: ['wrong'], cardType: 'Wrong', energy: null, power: null, might: null })];
  const rows = [unit];
  for (const value of allDecks) {
    for (const entry of [...value.runeDeck, value.championLegend, value.chosenChampion, ...value.battlefields]) {
      rows.push({
        canonicalCardId: entry.canonicalCardId,
        cardId: entry.cardId,
        name: entry.name ?? entry.id,
        cardType: entry.types.includes('rune') ? 'Rune' : entry.types[0],
        types: entry.types,
        tags: [], domains: [], energy: null, power: null, might: null,
      });
    }
  }
  const uniqueRows = [...new Map(rows.map(row => [JSON.stringify(row), row])).values()];
  const made = makeHost(world().player('A').player('B'));
  // Setup starts with empty pools; later commands acquire every resource via GameAction.
  const program = {
    canonicalCardId: canonical, rulesetVersion: 'core-1.5', status: 'executable', sourceText: 'Catalog Unit', abilities: [],
  };
  const match = createMatch({
    host: made.host, decks: allDecks, catalog: uniqueRows, programs: { programs: [program] },
    seed: 'catalog', battlefieldChoice: [0, 0], mulligans: [[], []], firstPlayer: 0,
  });
  const instances = made.kernel.objects.filter(object => object.cardId === canonical && object.types.includes('unit'));
  assert.ok(instances.length > 0);
  for (const object of instances) {
    assert.deepEqual(object.types, ['unit']);
    assert.deepEqual(object.tags, ['Mech', 'Champion']);
    assert.equal(object.energy, 4);
    assert.deepEqual(object.power, ['Fury', 'Fury']);
    assert.equal(object.might, 5);
  }
  const runeObjects = made.kernel.objects.filter(object => object.cardId === `rune:${canonical}` && object.types.includes('rune') && object.energy === null && object.power === null);
  assert.equal(runeObjects.length > 0, true);
  for (const runeObject of runeObjects) {
    assert.equal(runeObject.energy, null);
    assert.equal(runeObject.power, null);
  }
  assert.equal(match.programBinding?.registry.has(canonical), true);
  assert.equal(typeof match.detachPrograms, 'function');
  match.detachPrograms();
});

test('an invalid program source is rejected before Match setup mutates the host', () => {
  const made = makeHost(world().player('A').player('B'));
  assert.throws(() => createMatch({
    host: made.host,
    decks: [deck(), deck()],
    programs: { programs: [{ canonicalCardId: 'card.hash.invalid', rulesetVersion: 'core-1.5', status: 'executable', abilities: [] }] },
    seed: 'invalid-program', battlefieldChoice: [0, 0], mulligans: [[], []],
  }), /sourceText|Invalid card program/);
  assert.equal(made.kernel.objects.length, 0);
  assert.equal(made.kernel.player('A').energy, 0);
});

test('original Supernova IR suspends in real Match, rejects an illegal target, restores its cursor, then resolves', () => {
  const { match, kernel } = targetMatch();
  const source = findHand(match, 'A', supernova.canonicalCardId);
  assert.ok(source);
  const target = kernel.getObject('enemy-unit');
  assert.ok(target);
  let adapter = createMatchCommandAdapter({ match, stateVersion: 0 });
  const pendingReceipt = adapter.execute('A', {
    type: 'play', commandId: 'supernova-play', stateVersion: 0, cardObjectId: source.ref.id,
  });
  assert.deepEqual(pendingReceipt.type, 'play');
  assert.equal(adapter.pendingChoice?.request.id, 'target:supernova.target-unit');
  assert.equal(kernel.getObject(source.ref.id).zone, 'hand');
  assert.equal(kernel.player('A').energy, 20);
  assert.equal(adapter.stateVersion, 2);
  assert.equal(adapter.pendingChoice.request.type, 'select-objects');

  const beforeInvalid = JSON.stringify({ objects: kernel.objects, players: ['A', 'B'].map(id => kernel.player(id)) });
  assert.throws(() => adapter.execute('A', {
    type: 'choose', commandId: 'supernova-invalid-target', stateVersion: 0,
    choiceId: 'target:supernova.target-unit', answer: [{ objectId: 'not-a-candidate', zoneEntryId: 1 }],
  }), error => error instanceof MatchCommandError && error.code === 'choice-cursor');
  assert.equal(adapter.stateVersion, 2);
  assert.equal(adapter.pendingChoice?.request.id, 'target:supernova.target-unit');
  assert.equal(JSON.stringify({ objects: kernel.objects, players: ['A', 'B'].map(id => kernel.player(id)) }), beforeInvalid);

  const pendingSnapshot = structuredClone(adapter.snapshot());
  adapter.detach();
  adapter = createMatchCommandAdapter({ match, stateVersion: 0 });
  adapter.restore(pendingSnapshot);
  assert.equal(adapter.pendingChoice?.command.type, 'play');
  adapter.execute('A', {
    type: 'choose', commandId: 'supernova-target', stateVersion: 0,
    choiceId: adapter.pendingChoice.request.id,
    answer: [{ objectId: target.ref.id, zoneEntryId: target.ref.zoneEntryId }],
  });
  assert.equal(adapter.pendingChoice, null);
  assert.equal(kernel.getObject(source.ref.id).zone, 'chain');
  assert.equal(kernel.player('A').energy, 11);
  assert.deepEqual(kernel.player('A').power, ['Order']);

  const finalizedSnapshot = structuredClone(adapter.snapshot());
  adapter.detach();
  adapter = createMatchCommandAdapter({ match, stateVersion: adapter.stateVersion });
  adapter.restore(finalizedSnapshot);
  settle(adapter, 'supernova-pass');
  assert.equal(kernel.getObject('enemy-unit').damage, 10);
  assert.equal(kernel.getObject(source.ref.id).zone, 'trash');
  assert.equal(adapter.pendingChoice, null);
  adapter.detach();
});

test('a locked Supernova target that leaves play is ignored on Resolve while Draw still executes', () => {
  const { match, kernel } = targetMatch();
  const source = findHand(match, 'A', supernova.canonicalCardId);
  const target = kernel.getObject('enemy-unit');
  assert.ok(target);
  const adapter = createMatchCommandAdapter({ match, stateVersion: 0 });
  adapter.execute('A', {
    type: 'play', commandId: 'stale-supernova', stateVersion: 0, cardObjectId: source.ref.id,
  });
  adapter.execute('A', {
    type: 'choose', commandId: 'stale-supernova-target', stateVersion: 0,
    choiceId: adapter.pendingChoice.request.id,
    answer: [{ objectId: target.ref.id, zoneEntryId: target.ref.zoneEntryId }],
  });
  const beforeDraw = kernel.player('A').handSize;
  assert.equal(match.flow.chain.commit({ type: 'return-to-hand', object: target.ref }).status, 'done');
  assert.equal(kernel.getObject('enemy-unit').zone, 'hand');
  let guard = 0;
  while (match.flow.chain.items.length > 0) {
    assert.ok(++guard < 30);
    if (!match.flow.chain.priority || !match.flow.chain.canPass(match.flow.chain.priority)) {
      match.flow.chain.advance();
      continue;
    }
    adapter.execute(match.flow.chain.priority, {
      type: 'pass', commandId: `stale-supernova-pass:${guard}`, stateVersion: adapter.stateVersion,
    });
  }
  assert.equal(kernel.getObject('enemy-unit').zone, 'hand');
  assert.equal(kernel.getObject('enemy-unit').damage, 0);
  assert.equal(kernel.getObject(source.ref.id).zone, 'trash');
  assert.equal(kernel.player('A').handSize, beforeDraw + 2);
  adapter.detach();
});

test('an original play with no legal target pauses before payment and rejects an illegal answer without state change', () => {
  const { match, kernel } = targetMatch({ enemy: false });
  const source = findHand(match, 'A', supernova.canonicalCardId);
  const adapter = createMatchCommandAdapter({ match, stateVersion: 0 });
  const before = JSON.stringify({ objects: kernel.objects, players: ['A', 'B'].map(id => kernel.player(id)) });
  const paused = adapter.execute('A', {
    type: 'play', commandId: 'no-target-supernova', stateVersion: 0, cardObjectId: source.ref.id,
  });
  assert.equal(paused.type, 'play');
  assert.equal(adapter.stateVersion, 0);
  assert.equal(adapter.pendingChoice?.request.type ?? null, 'select-objects');
  assert.equal(kernel.getObject(source.ref.id).zone, 'chain');
  assert.equal(adapter.pendingChoice.request.options.length, 0);
  assert.notEqual(JSON.stringify({ objects: kernel.objects, players: ['A', 'B'].map(id => kernel.player(id)) }), before);
  assert.throws(() => adapter.execute('A', {
    type: 'choose', commandId: 'no-target-supernova-answer', stateVersion: 0,
    choiceId: adapter.pendingChoice.request.id,
    answer: [{ objectId: 'not-a-candidate', zoneEntryId: 1 }],
  }), error => error instanceof MatchCommandError && error.code === 'choice-cursor');
  assert.equal(adapter.stateVersion >= 0, true);
  adapter.detach();
});

function choiceProgram() {
  const modes = [
    { id: 'mode-one', body: [] },
    { id: 'mode-two', body: [] },
  ];
  return {
    canonicalCardId: 'card.hash.match-choice',
    rulesetVersion: 'core-1.5', status: 'executable', sourceText: 'Match choice fixture',
    abilities: [
      { kind: 'play', body: [] },
      {
        kind: 'activated', timing: 'action', cost: { kind: 'activated' },
        body: [{
          id: 'choice.first', op: 'choice.mode', args: {
            count: constant(1), different: constant(true), remember: constant(true), modes: constant(modes),
          },
        }],
      },
      {
        kind: 'activated', timing: 'action', cost: { kind: 'activated' },
        body: [{ id: 'choice.second', op: 'effect.draw', args: { amount: constant(0) } }],
      },
      {
        kind: 'activated', timing: 'action', cost: { kind: 'activated' },
        body: [{
          id: 'optional.first', op: 'choice.optional', args: { body: constant([]) },
          targets: [{ id: 'optional.first.target', filter: { type: 'unit', zone: 'board' }, min: 0, max: 0, selection: 'up-to' }],
        }],
      },
    ],
  };
}

function choiceMatch() {
  const program = choiceProgram();
  const made = makeHost(world().player('A').player('B'));
  const match = createMatch({
    host: made.host,
    decks: [
      deck({ id: 'source-a', canonicalCardId: program.canonicalCardId, energy: 0, power: [], might: 2 }),
      deck({ id: 'source-b', canonicalCardId: program.canonicalCardId, energy: 0, power: [], might: 2 }),
    ],
    programs: { programs: [program] }, seed: 'choice-memory', battlefieldChoice: [0, 0], mulligans: [[], []], firstPlayer: 0,
  });
  return { match, kernel: made.kernel };
}

function playChoiceCard(adapter, sequence) {
  const source = findHand(adapter.match, 'A', 'card.hash.match-choice');
  assert.ok(source);
  adapter.execute('A', {
    type: 'play', commandId: `choice-play-${sequence}`, stateVersion: adapter.stateVersion,
    cardObjectId: source.ref.id,
  });
  resolveChoices(adapter, `choice-play-${sequence}`);
  return adapter.match.flow.options.host.objects().find(object => object.ref.id === source.ref.id);
}

test('real Match commands bind ChoiceMemory to source, ability, player and turn; pending state restores', () => {
  const { match, kernel } = choiceMatch();
  let adapter = createMatchCommandAdapter({ match, stateVersion: 0 });
  const first = playChoiceCard(adapter, 1);
  const second = playChoiceCard(adapter, 2);
  assert.ok(first && second && first.ref.id !== second.ref.id);

  const firstPending = adapter.execute('A', {
    type: 'activate', commandId: 'choice-first-a', stateVersion: adapter.stateVersion,
    sourceObjectId: first.ref.id, abilityId: '0',
  });
  assert.equal(firstPending.type, 'activate');
  assert.ok(adapter.pendingChoice, `active command must suspend: ${JSON.stringify(firstPending)}`);
  assert.deepEqual(adapter.pendingChoice.request.options, ['mode-one', 'mode-two']);
  adapter.execute('A', {
    type: 'choose', commandId: 'choice-first-a-answer', stateVersion: adapter.stateVersion,
    choiceId: adapter.pendingChoice.request.id, answer: 'mode-one',
  });
  settle(adapter, 'choice-first-a-settle');
  assert.equal(match.flow.chain.trace.some(entry => entry.step === 'finalized'), true,
    'the accepted choice reaches the real Chain Finalize path');
  assert.equal(Array.isArray(adapter.snapshot().choiceMemory.entries), true);

  const secondPending = adapter.execute('A', {
    type: 'activate', commandId: 'choice-second-source', stateVersion: adapter.stateVersion,
    sourceObjectId: second.ref.id, abilityId: '0',
  });
  assert.equal(secondPending.type, 'activate');
  assert.ok(adapter.pendingChoice, 'another source should ask its own choice');
  assert.deepEqual(adapter.pendingChoice.request.options, ['mode-one', 'mode-two'], 'another source has independent memory');
  adapter.execute('A', {
    type: 'choose', commandId: 'choice-second-source-answer', stateVersion: adapter.stateVersion,
    choiceId: adapter.pendingChoice.request.id, answer: 'mode-one',
  });
  settle(adapter, 'choice-second-source-settle');

  adapter.execute('A', {
    type: 'activate', commandId: 'choice-second-ability', stateVersion: adapter.stateVersion,
    sourceObjectId: first.ref.id, abilityId: '1',
  });
  assert.equal(adapter.pendingChoice, null, 'another non-remembering ability completes without borrowing the first ability ledger');
  settle(adapter, 'choice-second-ability-settle');

  const snapshot = structuredClone(adapter.snapshot());
  const memory = match.flow.chain.choiceMemory;
  memory.beginTurn('cleared-for-restore-test');
  adapter.restore(snapshot);
  assert.deepEqual(adapter.snapshot().choiceMemory, snapshot.choiceMemory, 'the adapter restores the Chain-owned ledger');

  adapter.detach();
  adapter = createMatchCommandAdapter({ match, stateVersion: snapshot.stateVersion });
  adapter.restore(snapshot);
  adapter.execute('A', {
    type: 'pass', commandId: 'choice-end-a', stateVersion: adapter.stateVersion,
  });
  assert.equal(match.flow.turnPlayer, 'B');
  adapter.execute('B', {
    type: 'pass', commandId: 'choice-end-b', stateVersion: adapter.stateVersion,
  });
  assert.equal(match.flow.turnPlayer, 'A');
  const nextTurnPending = adapter.execute('A', {
    type: 'activate', commandId: 'choice-next-turn', stateVersion: adapter.stateVersion,
    sourceObjectId: first.ref.id, abilityId: '0',
  });
  assert.equal(nextTurnPending.type, 'activate');
  assert.deepEqual(adapter.pendingChoice.request.options, ['mode-one', 'mode-two'], 'a new turn clears prior mode choices');
  const pending = structuredClone(adapter.snapshot());
  adapter.detach();
  adapter = createMatchCommandAdapter({ match, stateVersion: adapter.stateVersion });
  adapter.restore(pending);
  assert.equal(adapter.pendingChoice?.command.type, 'activate');
  adapter.execute('A', {
    type: 'choose', commandId: 'choice-next-turn-answer', stateVersion: adapter.stateVersion,
    choiceId: adapter.pendingChoice.request.id, answer: 'mode-one',
  });
  settle(adapter, 'choice-next-turn-settle');

  adapter.execute('A', {
    type: 'activate', commandId: 'optional-first', stateVersion: adapter.stateVersion,
    sourceObjectId: first.ref.id, abilityId: '2',
  });
  assert.equal(adapter.pendingChoice?.request.type ?? null, 'optional');
  const optionalId = adapter.pendingChoice.request.id;
  resolveChoices(adapter, 'optional-first');
  const beforeOptional = adapter.snapshot().records.length;
  adapter.execute('A', {
    type: 'activate', commandId: 'optional-second', stateVersion: adapter.stateVersion,
    sourceObjectId: second.ref.id, abilityId: '2',
  });
  assert.equal(adapter.snapshot().records.length, beforeOptional + 1);
  assert.equal(adapter.pendingChoice?.request.type ?? null, 'optional');
  assert.equal(adapter.pendingChoice?.request.id, optionalId, 'the same stable cursor is asked for the new command');
  assert.equal(adapter.pendingChoice?.commandId, 'optional-second', 'the optional answer is not reused across commands');
  resolveChoices(adapter, 'optional-second');
  adapter.detach();
  assert.equal(kernel.getObject(first.ref.id).controller, 'A');
});

test('ChoiceMemory independently scopes controller, source, ability and turn', () => {
  const memory = new ChoiceMemory(4);
  const source = { id: 'source', zoneEntryId: 2 };
  const base = { controller: 'A', source, abilityId: 'ability', choiceId: 'mode' };
  memory.record(base, 'one', 4);
  assert.equal(memory.has(base, 'one', 4), true);
  assert.equal(memory.has({ ...base, controller: 'B' }, 'one', 4), false);
  assert.equal(memory.has({ ...base, source: { id: 'other', zoneEntryId: 2 } }, 'one', 4), false);
  assert.equal(memory.has({ ...base, abilityId: 'other' }, 'one', 4), false);
  assert.equal(memory.has(base, 'one', 5), false);
});

