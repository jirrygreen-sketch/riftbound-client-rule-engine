import assert from 'node:assert/strict';
import test from 'node:test';

import dangerousDuo from '../../../card-dsl/dist/cards/ogn/dangerous-duo.js';
import sealOfRage from '../../../card-dsl/dist/cards/ogn/seal-of-rage.js';
import ornnsForge from '../../../card-dsl/dist/cards/sfd/ornns-forge.js';
import { ChainEngine } from '../../dist/chain/engine.js';
import { AwaitChoice } from '../../dist/effects/contract.js';
import { world } from '../../dist/effects/testing/index.js';
import { bindResolveContext, createActionPipelineHost } from '../../dist/events/action-adapter.js';
import { validateTriggerSpec } from '../../dist/events/trigger-spec.js';
import { createProgramBinding } from '../../dist/programs/index.js';

const constant = value => ({ kind: 'constant', value });
const base = player => ({ type: 'base', player });
const field = id => ({ type: 'battlefield', id });
const admitted = program => ({ ...program, status: 'executable', judgeReason: undefined });

const playCard = canonicalCardId => ({
  canonicalCardId,
  rulesetVersion: 'core-1.5',
  status: 'executable',
  sourceText: canonicalCardId,
  abilities: [{ kind: 'play', cost: { kind: 'printed' }, body: [] }],
});

const LEGION_GEAR = playCard('synthetic:rift-986:legion-gear');

function runtime({ setup, programs = [], failure = undefined, energy = 30 } = {}) {
  const builder = world().player('A', { energy }).player('B', { energy });
  for (const player of ['A', 'B']) {
    builder.deck(Array.from({ length: 8 }, (_, index) => `${player}:deck:${index}`), { owner: player })
      .rune(Array.from({ length: 8 }, (_, index) => `${player}:rune:${index}`), { owner: player });
  }
  setup?.(builder);
  const kernel = builder.build();
  const requests = [];
  const choose = request => {
    requests.push(structuredClone(request));
    if (request.type === 'select-objects') return request.options.slice(0, request.min);
    if (request.type === 'select-objects' && request.min === request.max && request.options.length === request.min) {
      return [...request.options];
    }
    throw new AwaitChoice(request);
  };
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: saved => { kernel.restore(saved.state); kernel.copyLinkedFrom(saved.links); },
    objects: () => kernel.objects,
    perform: action => failure?.consume(action, kernel) ?? kernel.perform(action),
    performContract: action => kernel.performContract(action),
    choose,
    context: (source, controller, timingPoint) => bindResolveContext(kernel, { source, controller, timingPoint, choose }),
  });
  const binding = createProgramBinding({ cardPrograms: programs });
  const engine = new ChainEngine({
    turnOrder: ['A', 'B'],
    turnPlayer: 'A',
    phase: 'main',
    host,
    cleanup: () => false,
    describePlay: binding.describePlay,
  });
  const errors = [];
  if (programs.length) binding.attachLifecycle(engine, error => errors.push(error));
  const beginTurn = player => {
    engine.pipeline.turnPlayer = player;
    engine.pipeline.emit({ timingPoint: 'turn-start', player });
  };
  return { kernel, host, binding, engine, requests, errors, beginTurn };
}

function play(f, id, player = 'A', location = base(player)) {
  const source = f.kernel.getObject(id);
  assert.ok(source, `missing playable ${id}`);
  const draft = f.binding.describePlay({ type: 'play', player, object: source.ref, location }, source);
  f.engine.execute(draft);
  return draft;
}

function settle(engine) {
  engine.advance();
  for (let guard = 0; engine.items.length; guard++) {
    assert.ok(guard < 30, 'chain must settle');
    engine.pass(engine.priority);
  }
}

function forgeSetup({ tokens = false } = {}) {
  return builder => {
    builder.battlefield('forge', {
      cardId: ornnsForge.canonicalCardId,
      types: ['battlefield'],
      controller: 'A',
      location: field('forge-field'),
    });
    for (const id of ['gear-one', 'gear-two']) {
      builder.hand(id, {
        cardId: 'synthetic:rift-986:ornn-gear-host',
        types: ['gear'],
        energy: 3,
        power: null,
        might: null,
        location: null,
      });
    }
    if (tokens) builder.hand('token-gear', {
      cardId: 'synthetic:rift-986:ornn-gear-host',
      types: ['gear'],
      energy: 1,
      power: null,
      might: null,
      location: null,
      isToken: true,
    });
  };
}

function nextPaymentFailure(builder) {
  let armed = false;
  return {
    arm() { armed = true; },
    consume(action) {
      if (!armed || action.type !== 'pay') return undefined;
      armed = false;
      return { status: 'prevented', events: [] };
    },
  };
}

test('Ornn Finalize history discounts one first friendly non-token Gear per production turn', () => {
  const f = runtime({
    setup: forgeSetup(),
    programs: [admitted(ornnsForge), playCard('synthetic:rift-986:ornn-gear-host')],
  });
  assert.deepEqual(f.errors, []);
  play(f, 'gear-one');
  assert.equal(f.kernel.player('A').energy, 27);
  assert.equal(f.engine.trace.filter(entry => entry.step === 'finalized').length, 1,
    'the first Gear finalized through the production Chain');

  play(f, 'gear-two');
  assert.equal(f.kernel.player('A').energy, 24);
  assert.equal(f.engine.trace.filter(entry => entry.step === 'finalized').length, 2,
    'both Gear plays finalized through the production Chain');
});

test('token Gear and a rolled-back Finalize do not consume the first-Gear discount', () => {
  const f = runtime({
    setup: forgeSetup({ tokens: true }),
    programs: [admitted(ornnsForge), playCard('synthetic:rift-986:ornn-gear-host')],
  });

  // A prevented payment exercises the real Finalize/payment rollback boundary.
  const failure = nextPaymentFailure();
  const rolled = runtime({
    setup: forgeSetup(),
    programs: [admitted(ornnsForge), playCard('synthetic:rift-986:ornn-gear-host')],
    failure,
  });
  failure.arm();
  assert.throws(() => play(rolled, 'gear-one'), /prevented; abort the Finalize transaction/);
  assert.equal(rolled.kernel.getObject('gear-one').zone, 'hand');
  assert.equal(rolled.engine.items.length, 0);
  assert.equal(rolled.engine.trace.filter(entry => entry.step === 'finalized').length, 0,
    'the failed transaction did not publish a card Finalize record');

  play(rolled, 'gear-one');
  assert.equal(rolled.kernel.player('A').energy, 27, 'the retried first Gear still receives its 3 - 1 discount');

  const tokenFirst = runtime({
    setup: forgeSetup({ tokens: true }),
    programs: [admitted(ornnsForge), playCard('synthetic:rift-986:ornn-gear-host')],
  });
  // Token Gear cannot consume the discount because the authoritative filter
  // checks the Finalized snapshot, including isToken, rather than live presence.
  play(tokenFirst, 'token-gear');
  assert.equal(tokenFirst.kernel.player('A').energy, 29, 'the token Gear pays its full printed cost');
  play(tokenFirst, 'gear-one');
  assert.equal(tokenFirst.kernel.player('A').energy, 26, 'the first non-token Gear still receives its discount');
});

test('the production TurnFlow turn-start boundary resets Finalize history', () => {
  const f = runtime({
    setup: forgeSetup(),
    programs: [admitted(ornnsForge), playCard('synthetic:rift-986:ornn-gear-host')],
  });
  play(f, 'gear-one');
  settle(f.engine);
  assert.equal(f.kernel.player('A').energy, 27);
  // scheduleTurn emits this exact event after setting the turn player. Invoke
  // that committed boundary directly so this focused test does not rerun all
  // unrelated Accept/Rune/Draw tasks in TurnFlow.
  f.beginTurn('B');
  f.beginTurn('A');
  play(f, 'gear-two');
  assert.equal(f.kernel.player('A').energy, 24, 'the next turn gets a fresh first-Gear window');
  assert.equal(f.engine.finalizedCardPlaysThisTurn().length, 1,
    'current-turn history contains only the finalize after the reset');
});

test('Dangerous Duo Legion condition reads the current-turn card Finalize history and excludes itself', () => {
  const f = runtime({
    setup: builder => builder.unit('target', { controller: 'A', might: 2, location: base('A') })
      .hand('duo', {
        cardId: dangerousDuo.canonicalCardId,
        types: ['unit'],
        zone: 'hand',
        location: null,
        might: 3,
        energy: 0,
        power: null,
      })
      .hand('legion-host', {
        cardId: LEGION_GEAR.canonicalCardId,
        types: ['gear'],
        zone: 'hand',
        location: null,
        might: null,
        energy: 1,
        power: null,
      }),
    programs: [admitted(dangerousDuo), LEGION_GEAR, sealOfRage],
  });
  // The first card is another card and satisfies Legion for Dangerous Duo.
  play(f, 'legion-host');
  settle(f.engine);
  play(f, 'duo');
  const [registration] = f.engine.pipeline.registeredTriggers().filter(trigger => trigger.source.ref.id === 'duo');
  assert.ok(registration);
  assert.equal(validateTriggerSpec(registration.spec).ok, true, 'the derived trigger specification stays contract-valid');
  assert.deepEqual(registration.spec.conditionHistory, {
    scope: 'turn',
    timingPoint: 'chain-item-finalize',
    player: 'A',
    exclude: 'self',
  });
  assert.equal(f.engine.finalizedCardPlaysThisTurn().length, 2,
    'the other card and the currently Finalizing card are both authoritative current-turn records');

  settle(f.engine);
  assert.equal(f.kernel.getObject('target').zone, 'board');
  assert.ok(f.requests.some(request => request.type === 'select-objects'), 'Legion Finalize asked for its unit target');
});

test('Legion does not trigger from a rolled-back play or without another finalized card', () => {
  const failure = nextPaymentFailure();
  const f = runtime({
    setup: builder => builder.unit('target', { controller: 'A', might: 2, location: base('A') })
      .hand('duo', {
        cardId: dangerousDuo.canonicalCardId,
        types: ['unit'],
        zone: 'hand',
        location: null,
        might: 3,
        energy: 0,
        power: null,
      }),
    programs: [admitted(dangerousDuo), LEGION_GEAR, sealOfRage],
    failure,
  });
  play(f, 'duo');
  settle(f.engine);
  assert.equal(f.requests.filter(request => request.type === 'select-objects').length, 0,
    'without another card the conditioned trigger does not enter the chain');

  // A prevented different-card Finalize rolls back before history is written.
  failure.arm();
  const legion = runtime({
    setup: builder => builder
      .hand('legion-host', {
        cardId: LEGION_GEAR.canonicalCardId,
        types: ['gear'],
        zone: 'hand',
        location: null,
        might: null,
        energy: 1,
        power: null,
      })
      .hand('duo', {
        cardId: dangerousDuo.canonicalCardId,
        types: ['unit'],
        zone: 'hand',
        location: null,
        might: 3,
        energy: 0,
        power: null,
      }),
    programs: [admitted(dangerousDuo), LEGION_GEAR, sealOfRage],
    failure,
  });
  assert.throws(() => play(legion, 'legion-host'), /prevented; abort the Finalize transaction/);
  play(legion, 'duo');
  settle(legion.engine);
  assert.equal(legion.requests.filter(request => request.type === 'select-objects').length, 0,
    'the rolled-back card is absent from the Finalize history used by Legion');
});
