import assert from 'node:assert/strict';
import test from 'node:test';

import supernova from '../../../card-dsl/dist/cards/rad/supernova.js';
import { ChoiceMemory } from '../../dist/chain/finalize/choice-memory.js';
import { world } from '../../dist/effects/testing/test-kernel.js';
import { bindResolveContext, createActionPipelineHost } from '../../dist/events/action-adapter.js';
import { createMatch } from '../../dist/game/lifecycle.js';
import { createProgramBinding } from '../../dist/programs/index.js';
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
  let perform = action => kernel.perform(action);
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
    perform: action => perform(action),
    performContract: action => kernel.performContract(action),
    performBatchLeaf: (action, batchId) => kernel.performBatchLeafForCapability(action, batchId),
    choose,
    context: (source, controller, timingPoint) => bindResolveContext(kernel, {
      source, controller, timingPoint, choose,
    }),
  });
  adapterDefaultChoose = pipeline.choose;
  pipeline.player = id => kernel.player(id);
  return {
    kernel, host: pipeline,
    injectPerform(fn) { perform = fn; },
  };
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

function authoritativeState(kernel, match) {
  return structuredClone({
    objects: kernel.objects,
    players: ['A', 'B'].map(id => kernel.player(id)),
    chain: match.flow.chain.items,
    trace: match.flow.chain.trace,
    events: match.events(),
  });
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
  assert.equal(match.flow.chain.commit({ type: 'gain-power', player: 'A', power: ['Order'] }).status, 'done');
  return { match, kernel: made.kernel };
}

function replayableTargetMatch() {
  const builder = world().player('A').player('B').deck(['A:draw:1', 'A:draw:2'], {
    owner: 'A', types: ['unit'], might: 1, energy: 1, power: [],
  });
  builder.unit('enemy-unit', {
    owner: 'B', controller: 'B', types: ['unit'], might: 20, location: at('enemy-field'),
    cardId: 'enemy-unit', canonicalCardId: 'enemy-unit',
  });
  const made = makeHost(builder);
  const match = createMatch({
    host: made.host,
    decks: [deck({
      canonicalCardId: supernova.canonicalCardId,
      types: ['spell'], cardType: 'Spell', energy: 9, power: 1,
      domains: ['Order'], might: null, name: 'Supernova',
    }), deck({ canonicalCardId: supernova.canonicalCardId, types: ['spell'], energy: 9, power: 1, domains: ['Order'], might: null })],
    programs: { programs: [executable(supernova)] },
    seed: 'rift-836-supernova', battlefieldChoice: [0, 0], mulligans: [[], []], firstPlayer: 0,
  });
  assert.equal(match.flow.chain.commit({ type: 'gain-energy', player: 'A', amount: 20 }).status, 'done');
  assert.equal(match.flow.chain.commit({ type: 'gain-power', player: 'A', power: ['Order'] }).status, 'done');
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
    assert.deepEqual(object.power, ['Fury']);
    assert.equal(object.might, 5);
  }
  const runeObjects = made.kernel.objects.filter(object => object.cardId === `rune:${canonical}` && object.types.includes('rune') && object.energy === null && object.power === null);
  assert.equal(runeObjects.length > 0, true);
  for (const runeObject of runeObjects) {
    assert.equal(runeObject.energy, null);
    assert.equal(runeObject.power, null);
  }
  assert.equal(match.programBinding?.registry.has(canonical), true);
  assert.equal(match.programBinding.registry.has(canonical), true);
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

test('an existing ProgramBinding is reused and its lifecycle attach is idempotent on the same Chain', () => {
  const made = makeHost(world().player('A').player('B'));
  const binding = createProgramBinding({ cardPrograms: [{ ...executable(supernova), abilities: [] }] });
  const match = createMatch({
    host: made.host, decks: [deck(), deck()], programs: binding,
    seed: 'binding-reuse', battlefieldChoice: [0, 0], mulligans: [[], []],
  });
  assert.equal(match.programBinding, binding);
  const first = binding.attachLifecycle(match.flow.chain);
  const second = binding.attachLifecycle(match.flow.chain);
  first.detach();
  assert.equal(match.flow.chain.pipeline.checkpoint().triggers.size, 0,
    'the first detach is balanced while the second owner remains installed');
  second.detach();
  const third = binding.attachLifecycle(match.flow.chain);
  assert.equal(match.flow.chain.pipeline.checkpoint().triggers.size, 0,
    'the last detach removes all owned hooks and allows a clean reinstall');
  third.detach();
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
  assert.equal(adapter.stateVersion, 0);
  assert.equal(adapter.pendingChoice.request.type, 'select-objects');

  const beforeInvalid = JSON.stringify({ objects: kernel.objects, players: ['A', 'B'].map(id => kernel.player(id)) });
  assert.throws(() => adapter.execute('A', {
    type: 'choose', commandId: 'supernova-invalid-target', stateVersion: 0,
    choiceId: 'target:supernova.target-unit', answer: [{ objectId: 'not-a-candidate', zoneEntryId: 1 }],
  }), error => error instanceof MatchCommandError && error.code === 'choice-cursor');
  assert.equal(adapter.stateVersion, 0);
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
  assert.deepEqual(kernel.player('A').power, []);
  assert.deepEqual(adapter.snapshot().records.map(record => record.command.type), ['play', 'choose']);

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

test('command records rebuild the accepted Play and Choose through a fresh Match with the same ledger', () => {
  const recorded = replayableTargetMatch();
  const source = findHand(recorded.match, 'A', supernova.canonicalCardId);
  const target = recorded.kernel.getObject('enemy-unit');
  const original = createMatchCommandAdapter({ match: recorded.match, stateVersion: 0 });
  original.execute('A', {
    type: 'play', commandId: 'replay-supernova', stateVersion: 0, cardObjectId: source.ref.id,
  });
  original.execute('A', {
    type: 'choose', commandId: 'replay-supernova-target', stateVersion: 0,
    choiceId: original.pendingChoice.request.id,
    answer: [{ objectId: target.ref.id, zoneEntryId: target.ref.zoneEntryId }],
  });
  const recordedSnapshot = structuredClone(original.snapshot());
  assert.deepEqual(recordedSnapshot.records.map(record => record.command.type), ['play', 'choose']);
  original.detach();

  const replay = replayableTargetMatch();
  const replaySource = findHand(replay.match, 'A', supernova.canonicalCardId);
  const records = recordedSnapshot.records.map(record => ({
    playerId: record.playerId,
    command: structuredClone(record.command),
  }));
  const rebuilt = createMatchCommandAdapter({ match: replay.match, stateVersion: 0 });
  const result = rebuilt.replay(records);
  assert.deepEqual(result, { recordCount: 2, stateVersion: rebuilt.stateVersion, choiceCursor: null });
  assert.equal(replay.kernel.getObject(replaySource.ref.id).zone, 'chain');
  assert.equal(replay.kernel.player('A').energy, 11);
  assert.deepEqual(rebuilt.snapshot().choiceMemory, recordedSnapshot.choiceMemory);
  rebuilt.detach();
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
  const { match, kernel } = targetMatch();
  const source = findHand(match, 'A', supernova.canonicalCardId);
  const receipts = [];
  const adapter = createMatchCommandAdapter({
    match,
    stateVersion: 0,
    onCommand: (record, receipt) => receipts.push({ record, receipt }),
  });
  const beforeRecords = adapter.snapshot().records.length;
  const beforeVersion = adapter.stateVersion;
  const beforeState = authoritativeState(kernel, match);
  const paused = adapter.execute('A', {
    type: 'play', commandId: 'no-target-supernova', stateVersion: 0, cardObjectId: source.ref.id,
  });
  assert.equal(paused.type, 'play');
  assert.equal(adapter.snapshot().records.length, beforeRecords + 1, 'the paused command is journaled exactly once');
  assert.equal(adapter.stateVersion, beforeVersion, 'AwaitChoice does not advance the wire version');
  assert.equal(adapter.pendingChoice?.request.type ?? null, 'select-objects');
  assert.equal(adapter.pendingChoice?.commandId, 'no-target-supernova');
  assert.deepEqual(adapter.pendingChoice.answers, [], 'no unanswered choice is recorded as answered');
  const afterPause = authoritativeState(kernel, match);
  assert.deepEqual(afterPause.objects, beforeState.objects,
    'the captured choice leaves no tentative object mutation');
  assert.deepEqual(afterPause.players, beforeState.players,
    'the captured choice rolls back tentative resource payment');
  assert.deepEqual(afterPause.chain, beforeState.chain,
    'the captured choice rolls back a tentative Chain item');
  assert.deepEqual(afterPause.trace.slice(0, beforeState.trace.length), beforeState.trace,
    'the outer cleanup appends only after the inner command savepoint restores its tentative trace');
  assert.deepEqual(afterPause.events.slice(0, beforeState.events.length), beforeState.events,
    'the outer cleanup appends only after the inner command savepoint restores tentative events');
  assert.ok(afterPause.trace.length > beforeState.trace.length);
  assert.ok(afterPause.events.length > beforeState.events.length,
    'the real TurnFlow cleanup is allowed to publish after the command savepoint');
  assert.equal(receipts.length, 1);
  assert.deepEqual(receipts[0].record.command, { type: 'play', commandId: 'no-target-supernova', stateVersion: 0, cardObjectId: source.ref.id });
  assert.deepEqual(receipts[0].receipt, {
    commandId: 'no-target-supernova', type: 'play',
    previousEventSeq: beforeState.events.length, eventSeq: afterPause.events.length,
    winnerPlayerId: null,
  });
  const pendingBeforeInvalid = adapter.snapshot().pending;
  const recordsBeforeInvalid = adapter.snapshot().records.length;
  assert.throws(() => adapter.execute('A', {
    type: 'choose', commandId: 'no-target-supernova-answer', stateVersion: 0,
    choiceId: adapter.pendingChoice.request.id,
    answer: [{ objectId: 'not-a-candidate', zoneEntryId: 1 }],
  }), error => error instanceof MatchCommandError && error.code === 'choice-cursor');
  assert.equal(adapter.snapshot().records.length, recordsBeforeInvalid, 'an invalid answer is not journaled');
  assert.equal(adapter.stateVersion, beforeVersion);
  assert.deepEqual(adapter.snapshot().pending, pendingBeforeInvalid, 'an invalid answer preserves the exact cursor');
  assert.deepEqual(authoritativeState(kernel, match), afterPause,
    'the rejected answer preserves paused objects, resources, Chain, trace and events exactly');
  assert.equal(receipts.length, 1, 'an invalid answer emits no command receipt');
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
        kind: 'activated', timing: 'action', cost: { kind: 'activated', energy: constant(1) },
        body: [{
          id: 'choice.failing', op: 'choice.optional',
          args: { body: constant([{ id: 'choice.failing.draw', op: 'effect.draw', args: { amount: constant(1) } }]) },
        }],
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
  return { match, kernel: made.kernel, ...made };
}

function opponentChoiceProgram() {
  return {
    canonicalCardId: 'card.hash.parent-opponent-choice',
    rulesetVersion: 'core-1.5', status: 'executable',
    sourceText: 'Synthetic generic command-adapter contract fixture',
    abilities: [
      { kind: 'play', body: [] },
      {
        kind: 'activated', timing: 'action',
        cost: { kind: 'activated', energy: constant(1) },
        body: [
          {
            id: 'parent-opponent-mode', op: 'choice.each-player', args: {
              choosers: constant('each-player'), choose: constant({ kind: 'mode', options: ['left', 'right'] }),
              currentTurnPlayer: constant('A'),
            },
          },
          { id: 'parent-draw-once', op: 'effect.draw', args: { amount: constant(1) } },
        ],
      },
    ],
  };
}

function opponentChoiceMatch() {
  const program = opponentChoiceProgram();
  const made = makeHost(world().player('A').player('B'));
  const match = createMatch({
    host: made.host,
    decks: [
      deck({ id: 'source-a', canonicalCardId: program.canonicalCardId, energy: 0, power: [], might: 2 }),
      deck({ id: 'source-b', canonicalCardId: program.canonicalCardId, energy: 0, power: [], might: 2 }),
    ],
    programs: { programs: [program] },
    seed: 'parent-836-opponent-choice', battlefieldChoice: [0, 0], mulligans: [[], []], firstPlayer: 0,
  });
  assert.equal(match.flow.chain.commit({ type: 'gain-energy', player: 'A', amount: 20 }).status, 'done');
  return { ...made, match, program };
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
  const receipts = [];
  const onCommand = (record, receipt) => receipts.push({ record, receipt });
  let adapter = createMatchCommandAdapter({
    match,
    stateVersion: 0,
    onCommand,
  });
  const first = playChoiceCard(adapter, 1);
  const second = playChoiceCard(adapter, 2);
  assert.ok(first && second && first.ref.id !== second.ref.id);

  const beforeFirstActivate = adapter.snapshot();
  const beforeFirstActivateReceipts = receipts.length;
  const firstPending = adapter.execute('A', {
    type: 'activate', commandId: 'choice-first-a', stateVersion: adapter.stateVersion,
    sourceObjectId: first.ref.id, abilityId: '0',
  });
  const firstPendingSnapshot = adapter.snapshot();
  const firstEventsBefore = adapter.pendingChoice.previousEventSeq;
  assert.equal(firstPending.type, 'activate');
  assert.ok(adapter.pendingChoice, `active command must suspend: ${JSON.stringify(firstPending)}`);
  assert.equal(firstPendingSnapshot.records.length, beforeFirstActivate.records.length + 1,
    'the suspended Activate is journaled exactly once');
  assert.equal(firstPendingSnapshot.stateVersion, beforeFirstActivate.stateVersion);
  assert.equal(receipts.length, beforeFirstActivateReceipts + 1);
  assert.deepEqual(adapter.pendingChoice.request.options, ['mode-one', 'mode-two']);
  const beforeInvalidChoice = {
    state: authoritativeState(kernel, match), records: adapter.snapshot().records,
    pending: adapter.snapshot().pending, version: adapter.stateVersion,
  };
  const choiceRecordsBeforeInvalid = adapter.snapshot().records.length;
  assert.throws(() => adapter.execute('A', {
    type: 'choose', commandId: 'choice-first-invalid', stateVersion: adapter.stateVersion,
    choiceId: adapter.pendingChoice.request.id, answer: 'not-a-mode',
  }), error => error instanceof MatchCommandError && error.code === 'choice-cursor');
  assert.equal(adapter.snapshot().records.length, choiceRecordsBeforeInvalid);
  assert.deepEqual(adapter.snapshot().pending, beforeInvalidChoice.pending);
  assert.equal(adapter.stateVersion, beforeInvalidChoice.version);
  assert.deepEqual(authoritativeState(kernel, match), beforeInvalidChoice.state,
    'an invalid choice preserves objects, resources, Chain, trace and events');
  const choiceReceipt = adapter.execute('A', {
    type: 'choose', commandId: 'choice-first-a-answer', stateVersion: adapter.stateVersion,
    choiceId: adapter.pendingChoice.request.id, answer: 'mode-one',
  });
  assert.equal(receipts.length, beforeFirstActivateReceipts + 2);
  assert.deepEqual(choiceReceipt, {
    commandId: 'choice-first-a-answer', type: 'choose',
    previousEventSeq: firstEventsBefore, eventSeq: choiceReceipt.eventSeq,
    winnerPlayerId: null,
  });
  assert.deepEqual(receipts.at(-1).receipt, choiceReceipt);
  assert.equal(adapter.stateVersion, firstPendingSnapshot.stateVersion + 1, 'a completed continuation advances exactly one version');
  assert.equal(adapter.pendingChoice, null, 'a completed continuation clears its pending cursor');
  settle(adapter, 'choice-first-a-settle');
  assert.equal(match.flow.chain.trace.some(entry => entry.step === 'finalized'), true,
    'the accepted choice reaches the real Chain Finalize path');
  assert.ok(adapter.snapshot().choiceMemory.entries.length > 0, 'the selected mode is recorded in the Chain-owned ledger');

  adapter.execute('A', {
    type: 'activate', commandId: 'choice-first-a-again', stateVersion: adapter.stateVersion,
    sourceObjectId: first.ref.id, abilityId: '0',
  });
  assert.deepEqual(adapter.pendingChoice.request.options, ['mode-two'],
    'the same source and ability excludes the choice already recorded this turn');
  adapter.execute('A', {
    type: 'choose', commandId: 'choice-first-a-again-answer', stateVersion: adapter.stateVersion,
    choiceId: adapter.pendingChoice.request.id, answer: 'mode-two',
  });
  settle(adapter, 'choice-first-a-again-settle');

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
  adapter = createMatchCommandAdapter({ match, stateVersion: snapshot.stateVersion, onCommand });
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
  adapter = createMatchCommandAdapter({ match, stateVersion: adapter.stateVersion, onCommand });
  adapter.restore(pending);
  assert.equal(adapter.pendingChoice?.command.type, 'activate');
  adapter.execute('A', {
    type: 'choose', commandId: 'choice-next-turn-answer', stateVersion: adapter.stateVersion,
    choiceId: adapter.pendingChoice.request.id, answer: 'mode-one',
  });
  settle(adapter, 'choice-next-turn-settle');

  adapter.execute('A', {
    type: 'activate', commandId: 'optional-first', stateVersion: adapter.stateVersion,
    sourceObjectId: first.ref.id, abilityId: '3',
  });
  assert.equal(adapter.pendingChoice?.request.type ?? null, 'optional');
  const optionalId = adapter.pendingChoice.request.id;
  resolveChoices(adapter, 'optional-first');
  const beforeOptional = adapter.snapshot();
  const receiptCount = receipts.length;
  const eventsBeforeOptional = match.events().length;
  const optionalReceipt = adapter.execute('A', {
    type: 'activate', commandId: 'optional-second', stateVersion: adapter.stateVersion,
    sourceObjectId: second.ref.id, abilityId: '3',
  });
  assert.equal(adapter.snapshot().records.length, beforeOptional.records.length + 1,
    'a new command that suspends is journaled exactly once');
  assert.equal(adapter.stateVersion, beforeOptional.stateVersion, 'suspending does not advance the wire version');
  assert.equal(receipts.length, receiptCount + 1, 'the new paused command emits exactly one receipt');
  assert.deepEqual(optionalReceipt, {
    commandId: 'optional-second', type: 'activate',
    previousEventSeq: eventsBeforeOptional, eventSeq: match.events().length, winnerPlayerId: null,
  });
  assert.equal(receipts.at(-1).receipt.previousEventSeq, eventsBeforeOptional,
    'the paused receipt starts at the event cursor before the command');
  assert.equal(receipts.at(-1).receipt.eventSeq, match.events().length,
    'the paused receipt ends at the post-cleanup event cursor');
  assert.ok(receipts.at(-1).receipt.eventSeq >= receipts.at(-1).receipt.previousEventSeq);
  assert.equal(receipts.at(-1).receipt.winnerPlayerId, null, 'pause does not claim a winner');
  assert.equal(adapter.pendingChoice?.request.type ?? null, 'optional');
  assert.equal(adapter.pendingChoice?.request.id, optionalId, 'the same stable cursor is asked for the new command');
  assert.equal(adapter.pendingChoice?.commandId, 'optional-second', 'the optional answer is not reused across commands');
  resolveChoices(adapter, 'optional-second');
  adapter.detach();
  assert.equal(kernel.getObject(first.ref.id).controller, 'A');
});

test('a legal Choose whose replayed command fails restores every authoritative and adapter cursor', () => {
  const made = choiceMatch();
  const { match, kernel } = made;
  const receipts = [];
  const adapter = createMatchCommandAdapter({
    match, stateVersion: 0,
    onCommand: (record, receipt) => receipts.push({ record, receipt }),
  });
  const source = playChoiceCard(adapter, 'rollback');
  assert.ok(source);
  assert.equal(match.flow.chain.commit({ type: 'gain-energy', player: 'A', amount: 1 }).status, 'done');
  const activated = adapter.execute('A', {
    type: 'activate', commandId: 'rollback-activate', stateVersion: adapter.stateVersion,
    sourceObjectId: source.ref.id, abilityId: '2',
  });
  assert.equal(activated.type, 'activate');
  assert.equal(adapter.pendingChoice, null);
  let pass = 0;
  while (adapter.pendingChoice === null) {
    assert.ok(++pass < 10);
    const actor = match.flow.chain.priority;
    assert.ok(actor);
    adapter.execute(actor, {
      type: 'pass', commandId: `rollback-pass-${pass}`, stateVersion: adapter.stateVersion,
    });
  }
  assert.equal(adapter.pendingChoice?.request.type, 'optional');

  const beforeFailure = {
    state: authoritativeState(kernel, match),
    adapter: structuredClone(adapter.snapshot()),
    version: adapter.stateVersion,
    receipts: receipts.length,
  };
  made.injectPerform(action => {
    if (action.type === 'draw') throw new Error('injected continuation failure');
    return kernel.perform(action);
  });
  const answerRequest = adapter.pendingChoice.request.id;
  const answerPlayer = adapter.pendingChoice.chooser;
  try {
    adapter.execute(answerPlayer, {
      type: 'choose', commandId: 'rollback-answer', stateVersion: adapter.stateVersion,
      choiceId: answerRequest, answer: true,
    });
    assert.fail('the accepted answer must reach the injected downstream failure');
  } catch (error) {
    assert.match(String(error), /injected continuation failure/);
    assert.ok(error instanceof Error);
  }
  made.injectPerform(action => kernel.perform(action));

  assert.deepEqual(authoritativeState(kernel, match), beforeFailure.state,
    'a failed replay restores objects, resources, Chain, trace and events');
  assert.deepEqual(adapter.snapshot(), beforeFailure.adapter,
    'a failed replay restores records, pending answers and ChoiceMemory');
  assert.equal(adapter.stateVersion, beforeFailure.version);
  assert.equal(receipts.length, beforeFailure.receipts, 'a failed continuation emits no receipt');
  adapter.detach();
});

test('an opponent choice resumes the original command actor while receipts belong to the actual chooser', () => {
  const made = opponentChoiceMatch();
  const { match, kernel } = made;
  const receipts = [];
  const adapter = createMatchCommandAdapter({
    match, stateVersion: 0,
    onCommand: (record, receipt) => receipts.push({ record, receipt }),
  });
  const source = findHand(match, 'A', made.program.canonicalCardId);
  assert.ok(source);
  adapter.execute('A', {
    type: 'play', commandId: 'opponent-play', stateVersion: adapter.stateVersion, cardObjectId: source.ref.id,
  });
  settle(adapter, 'opponent-play-settle');
  adapter.execute('A', {
    type: 'activate', commandId: 'opponent-activate', stateVersion: adapter.stateVersion,
    sourceObjectId: source.ref.id, abilityId: '0',
  });

  let pass = 0;
  while (adapter.pendingChoice === null) {
    assert.ok(++pass < 10);
    const actor = match.flow.chain.priority;
    assert.ok(actor);
    adapter.execute(actor, {
      type: 'pass', commandId: `opponent-pass-${pass}`, stateVersion: adapter.stateVersion,
    });
  }
  const first = adapter.pendingChoice;
  assert.ok(first);
  assert.equal(first.playerId, 'B');
  assert.equal(first.command.type, 'pass');
  assert.equal(first.request.chooser, 'A');
  assert.equal(first.request.type, 'mode');

  const beforeInvalid = {
    state: authoritativeState(kernel, match), snapshot: structuredClone(adapter.snapshot()),
    receipts: receipts.length,
  };
  assert.throws(() => adapter.execute('B', {
    type: 'choose', commandId: 'opponent-wrong-actor', stateVersion: adapter.stateVersion,
    choiceId: first.request.id, answer: 'left',
  }), error => error instanceof MatchCommandError && error.code === 'choice-cursor');
  assert.deepEqual(authoritativeState(kernel, match), beforeInvalid.state);
  assert.deepEqual(adapter.snapshot(), beforeInvalid.snapshot);
  assert.equal(receipts.length, beforeInvalid.receipts);

  assert.throws(() => adapter.execute('A', {
    type: 'choose', commandId: 'opponent-wrong-choice', stateVersion: adapter.stateVersion,
    choiceId: 'not-the-pending-choice', answer: 'left',
  }), error => error instanceof MatchCommandError && error.code === 'choice-cursor');
  assert.throws(() => adapter.execute('A', {
    type: 'choose', commandId: 'opponent-stale-version', stateVersion: adapter.stateVersion + 1,
    choiceId: first.request.id, answer: 'left',
  }), /stateVersion mismatch/);
  assert.deepEqual(authoritativeState(kernel, match), beforeInvalid.state);
  assert.deepEqual(adapter.snapshot(), beforeInvalid.snapshot);
  assert.equal(receipts.length, beforeInvalid.receipts);

  const beforeDraw = kernel.player('A').handCount;
  const firstReceipt = adapter.execute('A', {
    type: 'choose', commandId: 'opponent-answer-a', stateVersion: adapter.stateVersion,
    choiceId: first.request.id, answer: 'left',
  });
  assert.equal(firstReceipt.commandId, 'opponent-answer-a');
  assert.equal(firstReceipt.type, 'choose');
  assert.equal(receipts.at(-1).record.playerId, 'A');
  assert.equal(receipts.at(-1).record.command.commandId, 'opponent-answer-a');
  const second = adapter.pendingChoice;
  assert.ok(second);
  assert.equal(second.playerId, 'B');
  assert.equal(second.command.type, 'pass');
  assert.equal(second.request.chooser, 'B');
  assert.equal(receipts.length, beforeInvalid.receipts + 1);

  const secondReceipt = adapter.execute('B', {
    type: 'choose', commandId: 'opponent-answer-b', stateVersion: adapter.stateVersion,
    choiceId: second.request.id, answer: 'right',
  });
  assert.equal(secondReceipt.commandId, 'opponent-answer-b');
  assert.equal(secondReceipt.type, 'choose');
  assert.equal(adapter.pendingChoice, null);
  assert.equal(kernel.player('A').handCount, beforeDraw + 1, 'the body draw executes once');
  const paidEnergy = kernel.player('A').energy;
  assert.equal(paidEnergy, 19, 'the one-Energy activation is paid exactly once');
  assert.equal(receipts.at(-1).record.playerId, 'B');
  assert.equal(receipts.at(-1).record.command.commandId, 'opponent-answer-b');

  const records = structuredClone(adapter.snapshot().records);
  const eventSummary = match.events().map(event => ({
    eventId: event.eventId, timingPoint: event.timingPoint, sourceCardId: event.sourceCardId,
  }));
  adapter.detach();
  const replay = opponentChoiceMatch();
  const rebuilt = createMatchCommandAdapter({ match: replay.match, stateVersion: 0 });
  const result = rebuilt.replay(records);
  assert.deepEqual(result, { recordCount: records.length, stateVersion: rebuilt.stateVersion, choiceCursor: null });
  assert.equal(replay.kernel.player('A').handCount, beforeDraw + 1, 'replay draws exactly once');
  assert.equal(replay.kernel.player('A').energy, paidEnergy, 'replay pays the activation cost exactly once');
  assert.equal(rebuilt.snapshot().records.filter(record => record.command.commandId === 'opponent-answer-b').length, 1);
  assert.deepEqual(replay.match.events().map(event => ({
    eventId: event.eventId, timingPoint: event.timingPoint, sourceCardId: event.sourceCardId,
  })), eventSummary);
  rebuilt.detach();
});

test('a failed opponent choice replay restores original actor, pending answers, ChoiceMemory and receipts', () => {
  const made = opponentChoiceMatch();
  const { match, kernel } = made;
  const receipts = [];
  const adapter = createMatchCommandAdapter({
    match, stateVersion: 0,
    onCommand: (record, receipt) => receipts.push({ record, receipt }),
  });
  const source = findHand(match, 'A', made.program.canonicalCardId);
  assert.ok(source);
  const sourceEnergy = source.energy;
  adapter.execute('A', {
    type: 'play', commandId: 'opponent-rollback-play', stateVersion: adapter.stateVersion, cardObjectId: source.ref.id,
  });
  settle(adapter, 'opponent-rollback-play-settle');
  adapter.execute('A', {
    type: 'activate', commandId: 'opponent-rollback-activate', stateVersion: adapter.stateVersion,
    sourceObjectId: source.ref.id, abilityId: '0',
  });
  let pass = 0;
  while (adapter.pendingChoice === null) {
    assert.ok(++pass < 10);
    const actor = match.flow.chain.priority;
    assert.ok(actor);
    adapter.execute(actor, {
      type: 'pass', commandId: `opponent-rollback-pass-${pass}`, stateVersion: adapter.stateVersion,
    });
  }
  const pending = adapter.pendingChoice;
  assert.ok(pending);
  assert.equal(pending.request.chooser, 'A');
  assert.equal(kernel.getObject(source.ref.id).energy, sourceEnergy, 'the original ability is not paid before Finalize resumes');
  const beforeFirstAnswer = {
    state: authoritativeState(kernel, match), snapshot: structuredClone(adapter.snapshot()),
    receipts: receipts.length,
  };
  const firstReceipt = adapter.execute('A', {
    type: 'choose', commandId: 'opponent-rollback-answer-a', stateVersion: adapter.stateVersion,
    choiceId: pending.request.id, answer: 'left',
  });
  assert.equal(firstReceipt.commandId, 'opponent-rollback-answer-a');
  assert.equal(firstReceipt.type, 'choose');
  assert.equal(receipts.at(-1).record.playerId, 'A');
  const secondPending = adapter.pendingChoice;
  assert.ok(secondPending);
  assert.equal(secondPending.playerId, 'B');
  assert.equal(secondPending.command.type, 'pass');
  assert.equal(secondPending.request.chooser, 'B');
  const afterFirstAnswer = {
    state: authoritativeState(kernel, match), snapshot: structuredClone(adapter.snapshot()),
    receipts: receipts.length,
  };
  assert.ok(afterFirstAnswer.receipts > beforeFirstAnswer.receipts);
  assert.notDeepEqual(afterFirstAnswer.snapshot, beforeFirstAnswer.snapshot);

  const observedOpponentActions = [];
  made.injectPerform(action => {
    observedOpponentActions.push(action.type);
    if (action.type === 'draw') throw new Error('injected opponent continuation failure');
    return kernel.perform(action);
  });
  try {
    adapter.execute('B', {
      type: 'choose', commandId: 'opponent-rollback-answer-b', stateVersion: adapter.stateVersion,
      choiceId: secondPending.request.id, answer: 'right',
    });
    assert.fail(`expected downstream failure, observed ${JSON.stringify(observedOpponentActions)}`);
  } catch (error) {
    assert.match(String(error), /injected opponent continuation failure/);
  }
  made.injectPerform(action => kernel.perform(action));
  assert.deepEqual(authoritativeState(kernel, match), afterFirstAnswer.state);
  assert.deepEqual(adapter.snapshot(), afterFirstAnswer.snapshot);
  assert.equal(receipts.length, afterFirstAnswer.receipts);
  assert.equal(adapter.pendingChoice.playerId, secondPending.playerId);
  assert.equal(adapter.pendingChoice.command.type, secondPending.command.type);
  assert.equal(adapter.pendingChoice.chooser, secondPending.request.chooser);
  assert.equal(observedOpponentActions.length, 1, 'the accepted answer reaches the Draw once');
  assert.equal(observedOpponentActions[0], 'draw');
  adapter.detach();
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

