// RIFT-987 production coverage for the CR 187.5 Gold gear token.
//
// Official evidence: Core Rules v1.5 (last updated 2026-10-09, effective
// 2026-10-16 under the 2026-10-16 Radiance policy):
// https://cmsassets.rgpub.io/sanity/files/dsfx7636/news_live/5c7946f7c3b8c6e0faff85ab6dadc6d2e721ea94.pdf
// - 187.5: Gold is the fixed domainless Gear token with
//   "[Reaction][>] Kill this, [E]: [Add] [A]."
// - 135.2.e.5.b, 163.2.b: [A] is Universal Power and pays any named Domain.
// - 167: a Rune Pool empties at Main start and turn end.
// - 185.2.a / 185.3.a.1: a token can be Played through normal Play steps and
//   has no printed cost; that cost is treated as 0.
// - 430.2.a / 430.3 and 813.1.c.2: the Reaction Add resolves immediately and
//   may be used during the opponent's Closed State.
// - 357.2: nonstandard costs are paid in a chosen order; this program uses
//   the published Exhaust then Kill order.
// The SFD errata snapshot reviewed under the official-order policy has no Gold
// correction: https://playriftbound.com/en-us/news/rules-and-releases/riftbound-spiritforged-errata/
import assert from 'node:assert/strict';
import test from 'node:test';

import gold from '../../../card-dsl/dist/cards/sfd/gold.js';
import { ChainEngine } from '../../dist/chain/engine.js';
import { AwaitChoice } from '../../dist/effects/contract.js';
import { world } from '../../dist/effects/testing/index.js';
import { bindResolveContext, createActionPipelineHost } from '../../dist/events/action-adapter.js';
import { createProgramBinding } from '../../dist/programs/index.js';
import { TurnFlow } from '../../dist/turn/flow.js';

const GOLD_CARD_ID = gold.canonicalCardId;
const BASE_A = { type: 'base', player: 'A' };
const BASE_B = { type: 'base', player: 'B' };
const constant = value => ({ kind: 'constant', value });

const tokenSource = (tokenId, id, body = [], extra = {}) => ({
  canonicalCardId: `synthetic:RIFT-987:${tokenId}-${id}`,
  rulesetVersion: 'core-1.5',
  status: 'executable',
  sourceText: `Create or play ${tokenId}.`,
  abilities: [{
    kind: 'play',
    cost: { kind: 'printed', energy: constant(0), power: constant([]) },
    body: [{
      id: `${tokenId}.${id}.token`,
      op: 'effect.token',
      args: {
        token: constant(tokenId),
        mode: constant('play'),
        location: constant({ type: 'base', player: 'A' }),
        linkKey: constant('goldToken'),
      },
    }, ...body],
  }],
  ...extra,
});

const demand = (id, power) => ({
  canonicalCardId: `synthetic:RIFT-987:${id}`,
  rulesetVersion: 'core-1.5',
  status: 'executable',
  sourceText: `Pay ${JSON.stringify(power)} Power.`,
  abilities: [{
    kind: 'play',
    cost: { kind: 'printed', energy: constant(0), power: constant(power) },
    body: [],
  }],
});

const namedDemand = demand('named-demand', ['Order']);
const universalDemand = demand('universal-demand', 1);

function runtime({ programs = [gold, namedDemand, universalDemand], setup, turnPlayer = 'A', phase = 'main' }) {
  const builder = world().player('A').player('B');
  for (const player of ['A', 'B']) {
    builder.deck(Array.from({ length: 8 }, (_, index) => `${player}:deck:${index}`), { owner: player });
    builder.rune(Array.from({ length: 8 }, (_, index) => `${player}:rune:${index}`), { owner: player });
  }
  setup?.(builder);
  const kernel = builder.build();
  const choices = [];
  const choose = request => {
    choices.push(structuredClone(request));
    if (request.type === 'select-objects' && request.min === request.max && request.options.length === request.min) {
      return [...request.options];
    }
    if (request.type === 'select-colors' && request.options.length === 1) return request.options[0];
    throw new AwaitChoice(request);
  };
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: saved => { kernel.restore(saved.state); kernel.copyLinkedFrom(saved.links); },
    objects: () => kernel.objects,
    perform: action => kernel.perform(action),
    performContract: action => kernel.performContract(action),
    performBatchLeaf: (action, batchId) => kernel.performBatchLeafForCapability(action, batchId),
    choose,
    context: (source, controller, timingPoint) => bindResolveContext(kernel, { source, controller, timingPoint, choose }),
    testTrigger: registration => kernel.test(registration.spec.condition),
  });
  const binding = createProgramBinding({ cardPrograms: programs });
  const engine = new ChainEngine({
    turnOrder: ['A', 'B'], turnPlayer, phase, host, cleanup: () => false,
    describePlay: binding.describePlay,
  });
  const errors = [];
  binding.attachLifecycle(engine, error => errors.push(error));
  return { binding, choices, engine, errors, host, kernel };
}

function settle(engine) {
  for (let guard = 0; engine.items.length; guard++) {
    assert.ok(guard < 50, 'the production Chain must settle');
    engine.pass(engine.priority);
  }
}

function play(f, id, player = 'A') {
  const source = f.kernel.getObject(id);
  assert.ok(source, `missing source ${id}`);
  f.engine.execute(f.binding.describePlay(
    { type: 'play', player, object: source.ref, ...(player === 'A' ? {} : {}) },
    source,
  ));
  settle(f.engine);
}

function goldTokens(kernel) {
  return kernel.objects.filter(object => object.isToken && object.cardId === GOLD_CARD_ID);
}

function activate(f, goldObject, controller = 'A') {
  const draft = f.binding.describeActivate(goldObject, controller, 0);
  assert.equal(draft.kind, 'add');
  assert.equal(draft.speed, 'reaction');
  f.engine.execute(draft);
  settle(f.engine);
  return draft;
}

test('RIFT-987 Gold token definition and canonical program are executable', () => {
  assert.equal(gold.status, 'executable');
  assert.equal(gold.abilities.length, 1);
  const [ability] = gold.abilities;
  assert.equal(ability.kind, 'activated');
  assert.equal(ability.timing, 'reaction');
  assert.deepEqual(ability.cost.payments, [
    { kind: 'exhaust', object: 'self' },
    { kind: 'kill', object: 'self' },
  ]);
  assert.deepEqual(ability.body[0]?.args, {
    power: { kind: 'constant', value: ['universal'] },
  });
});

test('RIFT-987 create and play modes expose real Gold carriers with default ready entry', () => {
  const createSource = tokenSource('gold', 'direct');
  const f = runtime({
    programs: [gold, createSource],
    setup: builder => builder.hand('direct', {
      cardId: createSource.canonicalCardId, types: ['spell'], energy: 0, power: [],
    }),
  });
  const source = f.kernel.getObject('direct');
  f.engine.execute(f.binding.describePlay({ type: 'play', player: 'A', object: source.ref }, source));
  settle(f.engine);

  const [created] = goldTokens(f.kernel);
  assert.equal(created.cardId, GOLD_CARD_ID);
  assert.equal(created.isToken, true);
  assert.equal(created.zone, 'board');
  assert.equal(created.exhausted, false);
  assert.deepEqual(f.errors, []);

  const playSource = tokenSource('gold', 'played');
  const playF = runtime({
    programs: [gold, playSource],
    setup: builder => builder
      .hand('played', { cardId: playSource.canonicalCardId, types: ['spell'], energy: 0, power: [] })
      .hand('after', { cardId: namedDemand.canonicalCardId, types: ['spell'], energy: 0, power: [] }),
  });
  play(playF, 'played');
  const [played] = goldTokens(playF.kernel);
  assert.equal(played.cardId, GOLD_CARD_ID);
  assert.equal(played.isToken, true);
  assert.equal(played.zone, 'board');
  assert.equal(played.exhausted, false);
  assert.deepEqual(playF.errors, []);
  const creation = playF.kernel.events.find(event => event.action === 'create-token');
  assert.ok(creation, 'Play mode really created the token on the Chain');
  assert.equal(creation.objectId, played.ref.id);
  assert.equal(playF.engine.trace.some(entry => entry.step === 'resolved' && entry.item?.startsWith(`play:${played.ref.id}:`)), true,
    'the created token went through a real Play');
});

test('RIFT-987 created Gold activates through the lifecycle and adds one Universal Power', () => {
  const createSource = tokenSource('gold', 'activate');
  const f = runtime({
    programs: [gold, createSource],
    setup: builder => builder.hand('activate', {
      cardId: createSource.canonicalCardId, types: ['spell'], energy: 0, power: [],
    }),
  });
  play(f, 'activate');
  const [token] = goldTokens(f.kernel);
  assert.ok(token);
  assert.equal(f.binding.activationAbilities(token).length, 1);

  const draft = activate(f, token);
  assert.deepEqual(f.kernel.player('A').power, ['universal']);
  assert.equal(f.kernel.getObject(token.ref.id).zone, 'trash');
  assert.equal(f.kernel.getObject(token.ref.id).exhausted, true);
  assert.deepEqual(
    f.kernel.events.map(event => event.action).filter(action => typeof action === 'string'),
    ['move-zone', 'pay', 'create-token', 'move-zone', 'pay', 'ready', 'move-zone', 'pay', 'exhaust', 'kill', 'gain-power'],
  );
  assert.equal(f.engine.trace.some(entry => entry.step === 'priority-granted' && entry.item === draft.id), false);
  assert.deepEqual(f.errors, []);
});

test('RIFT-987 Universal Power from Gold pays named-domain and [A] requirements exclusively', () => {
  for (const [name, demandProgram, id] of [
    ['named', namedDemand, 'named'],
    ['universal', universalDemand, 'universal'],
  ]) {
    const createSource = tokenSource('gold', `${id}-source`);
    const f = runtime({
      programs: [gold, createSource, demandProgram],
      setup: builder => builder
        .hand(`${id}-source`, { cardId: createSource.canonicalCardId, types: ['spell'], energy: 0, power: [] })
        .hand(`${id}-demand`, { cardId: demandProgram.canonicalCardId, types: ['spell'], energy: 0, power: [] }),
    });
    play(f, `${id}-source`);
    const [token] = goldTokens(f.kernel);
    activate(f, token);
    assert.deepEqual(f.kernel.player('A').power, ['universal'], `${name}: Gold added Universal`);
    play(f, `${id}-demand`);
    assert.deepEqual(f.kernel.player('A').power, [], `${name}: Universal paid the whole requirement without becoming a named Domain`);
    assert.deepEqual(f.errors, []);
  }
});

test('RIFT-987 a second Gold activation cannot be paid and leaves no extra Power', () => {
  const createSource = tokenSource('gold', 'second');
  const f = runtime({
    programs: [gold, createSource],
    setup: builder => builder.hand('second', { cardId: createSource.canonicalCardId, types: ['spell'], energy: 0, power: [] }),
  });
  play(f, 'second');
  const [token] = goldTokens(f.kernel);
  activate(f, token);
  const spentPower = [...f.kernel.player('A').power];
  const spentState = f.kernel.stateForTest();
  assert.throws(
    () => f.engine.execute(f.binding.describeActivate(token, 'A', 0)),
    error => error.name === 'CostPlanError' && error.reason === 'cannot-pay-cost',
  );
  assert.deepEqual(f.kernel.player('A').power, spentPower);
  assert.deepEqual(f.kernel.stateForTest(), spentState);
});

test('RIFT-987 Gold Reaction is usable on the opponent turn in a Closed State', () => {
  const createSource = tokenSource('gold', 'reaction');
  const ownerSource = demand('owner-closed-source', []);
  const f = runtime({
    programs: [gold, createSource, ownerSource],
    turnPlayer: 'B',
    setup: builder => builder
      .object('gold', {
        cardId: GOLD_CARD_ID, name: 'Gold', isToken: true, types: ['gear'], tags: ['Token'],
        zone: 'board', location: BASE_A, owner: 'A', controller: 'A', exhausted: false,
        energy: null, power: null, might: null,
      })
      .hand('closed-source', { cardId: ownerSource.canonicalCardId, types: ['spell'], energy: 0, power: [] }),
  });
  const source = f.kernel.getObject('closed-source');
  const closed = f.binding.describePlay({ type: 'play', player: 'B', object: source.ref }, source);
  f.engine.execute(closed);
  assert.equal(f.engine.turnState, 'neutral-closed');
  f.engine.pass('B');
  assert.equal(f.engine.priority, 'A');
  const [token] = goldTokens(f.kernel).filter(object => object.zone === 'board');
  assert.ok(token);
  assert.equal(f.binding.describeActivate(token, 'A', 0).speed, 'reaction');
  activate(f, token, 'A');
  assert.deepEqual(f.kernel.player('A').power, ['universal']);
  assert.equal(f.kernel.getObject(token.ref.id).zone, 'trash');
  assert.deepEqual(f.errors, []);
});

test('RIFT-987 TurnFlow clears unspent Gold Universal Power at turn and Main boundaries', () => {
  const createSource = tokenSource('gold', 'cleanup');
  const f = runtime({
    programs: [gold, createSource],
    setup: builder => builder.hand('cleanup', { cardId: createSource.canonicalCardId, types: ['spell'], energy: 0, power: [] }),
  });
  play(f, 'cleanup');
  const [token] = goldTokens(f.kernel);
  activate(f, token);
  assert.deepEqual(f.kernel.player('A').power, ['universal']);

  const flow = new TurnFlow({
    host: f.host,
    player: id => f.kernel.player(id),
    turnOrder: ['A', 'B'],
    battlefields: [{ id: 'bf1', controller: null }, { id: 'bf2', controller: null }],
    describePlay: f.binding.describePlay,
  });
  f.binding.attachLifecycle(flow.chain, error => { throw error; });
  flow.start();
  flow.chain.commit({ type: 'gain-power', player: 'A', power: ['universal'] });
  assert.deepEqual(f.kernel.player('A').power, ['universal']);
  flow.endTurn('A');
  assert.deepEqual(f.kernel.player('A').power, []);
  flow.chain.commit({ type: 'gain-power', player: 'B', power: ['universal'] });
  assert.deepEqual(f.kernel.player('B').power, ['universal']);
  flow.pass('B');
  while (flow.chain.items.length) flow.pass(flow.chain.priority);
  flow.advance();
  assert.deepEqual(f.kernel.player('B').power, []);
  assert.equal(f.kernel.player('A').energy, 0);
  assert.equal(f.kernel.player('B').energy, 0);
});
