// RIFT-988: effect.mill completes a short Main Deck through the same CR 432
// Burn Out continuation as draw. These tests execute the production primitive
// through ChainEngine's Resolve context and the state-owner capability; no zone,
// score, event, or terminal result is settled by the fixture.
import assert from 'node:assert/strict';
import test from 'node:test';

import effectMill from '../../dist/effects/instructions/effect.mill.js';
import { ChainEngine } from '../../dist/chain/engine.js';
import { bindResolveContext, createActionPipelineHost } from '../../dist/events/action-adapter.js';
import { world } from '../../dist/effects/testing/index.js';
import { createProgramBinding } from '../../dist/programs/index.js';
import { bindBurnOutInstructionCapability } from '../../dist/turn/burn-out.js';
import { fixture as turnFixture } from '../turn/helpers.mjs';

const c = value => ({ kind: 'constant', value });

function program(amount) {
  return {
    canonicalCardId: `test:m1-mill-burn-out:${amount}`,
    rulesetVersion: 'core-1.5',
    status: 'executable',
    sourceText: `Burn ${amount}.`,
    abilities: [{
      kind: 'activated', timing: 'action', cost: { kind: 'activated', energy: c(0) },
      body: [{ id: 'mill', op: 'effect.mill', args: { amount: c(amount) } }],
    }],
  };
}

function runtime({ amount, deck = [], trash = [], score = {}, victoryScore = 20 }) {
  const cardProgram = program(amount);
  const binding = createProgramBinding({ cardPrograms: [cardProgram] });
  const builder = world()
    .player('A', { score: score.A ?? 0 })
    .player('B', { score: score.B ?? 0 })
    .base('mill-source', {
      cardId: cardProgram.canonicalCardId, types: ['gear'], energy: null, power: null, might: null,
    });
  if (deck.length > 0) builder.deck(deck);
  for (const id of trash) builder.card(id, { owner: 'A', zone: 'trash' });
  const kernel = builder.build();
  kernel.setBurnOutVictoryScore(victoryScore);
  const asked = [];
  const choose = request => {
    asked.push(structuredClone(request));
    if (request.type === 'optional') return true;
    if (request.type === 'mode') return request.options[0];
    if (request.type === 'select-objects' && request.min === request.max && request.options.length === request.min) {
      return [...request.options];
    }
    throw new Error(`Unexpected production choice ${request.type} ${request.id}`);
  };
  const pipeline = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: saved => { kernel.restore(saved.state); kernel.copyLinkedFrom(saved.links); },
    objects: () => kernel.objects,
    perform: action => kernel.perform(action),
    choose,
    context: (source, controller, timingPoint) => bindResolveContext(kernel, {
      source: bindBurnOutInstructionCapability(source, kernel.burnOutInstructionCapability()),
      controller, timingPoint, choose,
    }),
    testTrigger: registration => kernel.test(registration.spec.condition),
  });
  const engine = new ChainEngine({
    turnOrder: ['A', 'B'], turnPlayer: 'A', phase: 'main', host: pipeline, cleanup: () => false,
  });
  binding.attachLifecycle(engine, error => { throw error; });
  return { kernel, binding, engine, asked };
}

function activate(f) {
  const draft = f.binding.describeActivate(f.kernel.getObject('mill-source'), 'A');
  f.engine.execute(draft);
  while (f.engine.items.length) f.engine.pass(f.engine.priority);
  return draft;
}

const ids = (kernel, player, zone) => kernel.zone(player, zone).map(ref => ref.id);
const actions = kernel => kernel.actionHistory.map(entry => entry.action).filter(action =>
  action.type !== 'discard' && action.type !== 'pay' && !(action.type === 'move-zone' && action.to === 'chain'));

test('RIFT-988 Main Deck at least two: mill moves exactly the top two without Burn Out', () => {
  const f = runtime({ amount: 2, deck: ['a-top', 'a-next', 'a-rest'], trash: ['old-trash'] });
  activate(f);
  assert.deepEqual(ids(f.kernel, 'A', 'deck'), ['a-rest']);
  assert.deepEqual(ids(f.kernel, 'A', 'trash'), ['old-trash', 'a-top', 'a-next']);
  assert.deepEqual(actions(f.kernel).map(entry => entry.type), ['mill']);
  assert.equal(f.kernel.player('B').score, 0);
});

test('RIFT-988 one remaining card: move it, recycle and randomize Trash, award opponent, then burn the remainder', () => {
  const f = runtime({ amount: 2, deck: ['only-deck'], trash: ['old-a'] });
  activate(f);
  const direct = world().deck(['only-deck']).card('old-a', { owner: 'A', zone: 'trash' }).build();
  const context = bindResolveContext(direct, {
    source: bindBurnOutInstructionCapability(direct.source, direct.burnOutInstructionCapability()),
    controller: 'A', timingPoint: 'chain-item-resolve',
  });
  const result = effectMill.execute(context, effectMill.argsSchema.parse({ amount: c(2) }));
  assert.equal(result.linkedValues.burnedCount, 2,
    'the linked result counts the initial burn and the post-Burn Out remainder');
  assert.deepEqual(result.linkedValues.burned.map(ref => ref.id), ['only-deck'],
    'linked card identities remain limited to deck-top references observed before Burn Out');
  assert.deepEqual(f.kernel.zone('A', 'trash').map(ref => ref.id).toSorted(),
    direct.zone('A', 'trash').map(ref => ref.id).toSorted());
  const history = actions(f.kernel);
  assert.equal(f.kernel.player('B').score, 1);
  assert.equal(ids(f.kernel, 'A', 'deck').length, 1, 'the sole recycled card remains because only the initial card was moved');
  assert.equal(ids(f.kernel, 'A', 'trash').length, 1, 'the original one-card mill remains in Trash');
  assert.deepEqual([...new Set(history.map(entry => entry.type))], ['mill', 'recycle', 'shuffle', 'score']);
  const firstMill = history.findIndex(entry => entry.type === 'mill');
  const recycle = history.findIndex(entry => entry.type === 'recycle');
  const shuffle = history.findIndex(entry => entry.type === 'shuffle');
  const score = history.findIndex(entry => entry.type === 'score');
  const remainder = history.findLastIndex(entry => entry.type === 'mill');
  assert.ok(firstMill < recycle && recycle < shuffle && shuffle < score && score < remainder);
});

test('RIFT-988 empty Main Deck with Trash burns out and completes the entire remainder', () => {
  const f = runtime({ amount: 2, deck: [], trash: ['first', 'second', 'third'] });
  activate(f);
  const history = actions(f.kernel);
  assert.equal(f.kernel.player('B').score, 1);
  assert.equal(history.filter(entry => entry.type === 'score').length, 1);
  assert.deepEqual(history.map(entry => entry.type), ['mill', 'recycle', 'recycle', 'recycle', 'shuffle', 'score', 'mill']);
});

test('RIFT-988 repeated empty-deck Burn Out stops immediately when the opponent reaches Victory Score', () => {
  const f = runtime({ amount: 2, deck: [], trash: [], score: { B: 7 }, victoryScore: 8 });
  activate(f);
  assert.equal(f.kernel.player('B').score, 9);
  assert.equal(ids(f.kernel, 'A', 'deck').length, 0);
  assert.equal(ids(f.kernel, 'A', 'trash').length, 0);
  assert.equal(actions(f.kernel).filter(entry => entry.type === 'score').length, 2,
    'CR 432.3.c: the point that reaches Victory Score stops the continuation immediately');
  assert.equal(f.kernel.events.some(event => 'action' in event && event.action === 'win'), true);
});

test('RIFT-988 mill and draw share the same Burn Out score, recycle, shuffle, and continuation order', () => {
  const mill = runtime({ amount: 2, deck: [], trash: ['one', 'two'], victoryScore: 20 });
  activate(mill);
  const millActions = actions(mill.kernel).map(entry => entry.type);
  assert.deepEqual(millActions, ['mill', 'recycle', 'recycle', 'shuffle', 'score', 'mill']);
  const sharedBurnOut = millActions.slice(1);
  assert.deepEqual(sharedBurnOut, ['recycle', 'recycle', 'shuffle', 'score', 'mill']);
  assert.equal(mill.kernel.player('B').score, 1);

  const draw = turnFixture({
    deck: false,
    setup: builder => builder.card('one', { zone: 'trash' }).card('two', { zone: 'trash' }),
  });
  draw.flow.start();
  const drawActions = draw.kernel.actionHistory.map(entry => entry.action.type);
  assert.deepEqual(drawActions, ['channel-rune', 'recycle', 'recycle', 'shuffle', 'score', 'draw']);
  assert.equal(draw.kernel.player('B').score, 1);
  assert.equal(draw.kernel.player('A').handCount, 1);
  assert.deepEqual(drawActions.slice(1, 5), sharedBurnOut.slice(0, 4));
});
