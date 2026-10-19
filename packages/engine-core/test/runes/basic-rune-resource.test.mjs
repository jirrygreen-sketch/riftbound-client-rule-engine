// CR v1.5 164.2.a-b / 166.1 / 357.1.a / 417.1.b / 430.2-430.3.
// Every state transition below is produced by ChainEngine, the shared cost
// layer, and the registered effect.resources instruction.
import assert from 'node:assert/strict';
import test from 'node:test';
import { world } from '../../dist/effects/testing/test-kernel.js';
import { AwaitChoice } from '../../dist/effects/contract.js';
import { bindResolveContext, createActionPipelineHost } from '../../dist/events/action-adapter.js';
import { ChainEngine } from '../../dist/chain/engine.js';
import {
  BasicRuneResourceError,
  executeBasicRuneResourcePlan,
  planBasicRuneResourceActivation,
} from '../../dist/runes/index.js';

const FURY = {
  cardId: 'ogn-007-298',
  canonicalCardId: 'card.hash-30497c69657abd1d3abf17f9b3766e7d064817473a88828ca2ef4ab9b51f7902',
  domain: 'Fury',
};
const CALM = {
  cardId: 'ogn-042-298',
  canonicalCardId: 'card.hash-efe5e5f4811f4089cd86b83cd6b8385613b0f469b2c2ae9f6b74a55ceb5cf0ed',
  domain: 'Calm',
};

function trustedRune(identity = FURY, extra = {}) {
  return {
    ref: { id: 'rune', zoneEntryId: 1 },
    cardId: identity.cardId,
    name: 'Fury Rune',
    types: ['rune'],
    tags: ['Basic'],
    keywords: [],
    owner: 'A',
    controller: 'A',
    zone: 'rune-zone',
    location: null,
    might: null,
    energy: null,
    power: null,
    exhausted: false,
    damage: 0,
    stunned: false,
    buffs: 0,
    attachedTo: null,
    faceDown: false,
    isToken: false,
    ...extra,
  };
}

function fixture(options = {}) {
  const rune = options.rune ?? trustedRune();
  const builder = world().player('A', { energy: 0 }).player('B', { energy: 0 })
    .base('source', { energy: 0, power: [], might: 1, types: ['unit'] });
  if (options.existingRuneDeck) builder.rune('existing-rune', { owner: 'A' });
  builder.object(rune.ref.id, rune);
  if (options.opponentRune) builder.object('enemy-rune', { ...trustedRune(FURY, options.opponentRune), owner: 'B', controller: 'B' });
  if (options.extra) builder.object('non-rune', options.extra);
  const kernel = builder.build();
  const decide = request => {
    if (options.choose) {
      const answer = options.choose(request, kernel);
      if (answer !== undefined) return answer;
    }
    if (request.type === 'select-objects' && request.min === request.max && request.options.length === request.min) {
      return [...request.options];
    }
    throw new AwaitChoice(request);
  };
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: checkpoint => { kernel.restore(checkpoint.state); kernel.copyLinkedFrom(checkpoint.links); },
    objects: () => kernel.objects,
    perform: action => kernel.perform(action),
    choose: decide,
    context: (source, controller, timingPoint) => bindResolveContext(kernel, { source, controller, timingPoint, choose: decide }),
    testTrigger: registration => kernel.test(registration.spec.condition),
  });
  const engine = new ChainEngine({
    turnOrder: ['A', 'B'],
    turnPlayer: options.turnPlayer ?? 'A',
    phase: options.phase ?? 'main',
    host,
    cleanup: options.cleanup ?? (() => false),
  });
  const state = {
    objects: () => kernel.objects,
    player: playerId => kernel.player(playerId),
  };
  return { kernel, engine, state, rune };
}

function request(type, overrides = {}) {
  return {
    actor: 'A',
    activationId: `rune:${type}`,
    intent: { type, runeObjectId: 'rune', zoneEntryId: 1 },
    window: { kind: 'priority' },
    ...overrides,
  };
}

function identityResolver(identity = FURY) {
  return cardId => cardId === identity.cardId ? identity : null;
}

function plan(f, type = 'rune-energy', overrides = {}, identity = FURY) {
  return planBasicRuneResourceActivation({
    chain: f.engine,
    state: f.state,
    resolveIdentity: identityResolver(identity),
    request: request(type, overrides),
  });
}

function code(expected) {
  return error => error instanceof BasicRuneResourceError && error.code === expected;
}

test('rune-energy exhausts exactly once and adds exactly one Energy through Chain/cost/action', () => {
  const f = fixture();
  const activation = plan(f);
  assert.deepEqual(activation.draft.cost.cost.payments, [{ kind: 'exhaust', object: { id: 'rune', zoneEntryId: 1 } }]);
  assert.equal(activation.draft.kind, 'add');
  assert.equal(activation.draft.speed, 'reaction');
  assert.equal(activation.rune.domain, 'Fury');
  assert.equal(activation.rune.printedEnergy, null);
  assert.equal(activation.rune.printedPower, null);

  const receipt = executeBasicRuneResourcePlan(activation);
  assert.equal(f.kernel.player('A').energy, 1);
  assert.deepEqual(f.kernel.player('A').power, []);
  assert.equal(f.kernel.getObject('rune').exhausted, true);
  assert.equal(f.kernel.getObject('rune').zone, 'rune-zone');
  assert.equal(receipt.energyAdded, 1);
  assert.deepEqual(receipt.powerAdded, []);
  assert.equal(receipt.runeZoneAfter, 'rune-zone');
  assert.throws(() => executeBasicRuneResourcePlan(activation), code('plan-consumed'));
  assert.equal(f.kernel.player('A').energy, 1, 'the same plan never adds twice');
});

test('rune-power recycles this Rune to the Rune Deck and adds its frozen Domain', () => {
  const f = fixture({ rune: trustedRune(FURY, { exhausted: true }), existingRuneDeck: true });
  const activation = plan(f, 'rune-power');
  assert.deepEqual(activation.draft.cost.cost.payments, [{ kind: 'recycle', object: { id: 'rune', zoneEntryId: 1 } }]);
  assert.deepEqual(activation.draft.body[0].args.power, { kind: 'constant', value: ['Fury'] });

  const receipt = executeBasicRuneResourcePlan(activation);
  assert.equal(f.kernel.player('A').energy, 0);
  assert.deepEqual(f.kernel.player('A').power, ['Fury']);
  assert.equal(f.kernel.getObject('rune').zone, 'rune-deck');
  assert.deepEqual(f.kernel.objectsInZone('A', 'rune-deck').map(ref => ref.id), ['existing-rune', 'rune'],
    '417.1.b: Recycle places the Rune at the bottom of its owner Rune Deck');
  assert.deepEqual(f.kernel.objectsInZone('A', 'rune-zone'), []);
  assert.equal(receipt.runeAfter.zoneEntryId, 2);
  assert.deepEqual(receipt.powerAdded, ['Fury']);
});

test('exhaust then recycle consumes the new incarnation, never reusing the stale ref', () => {
  const f = fixture();
  executeBasicRuneResourcePlan(plan(f, 'rune-energy'));
  const recycled = f.kernel.ref('rune');
  assert.equal(recycled.zoneEntryId, 1, 'Exhaust preserves the Rune incarnation');
  const power = plan(f, 'rune-power', { activationId: 'rune:power' });
  assert.equal(power.rune.zoneEntryId, 1);
  executeBasicRuneResourcePlan(power);
  assert.equal(f.kernel.player('A').energy, 1);
  assert.deepEqual(f.kernel.player('A').power, ['Fury']);
  assert.equal(f.kernel.getObject('rune').ref.zoneEntryId, 2);
  assert.throws(() => plan(f, 'rune-power', {
    activationId: 'rune:stale',
    intent: { type: 'rune-power', runeObjectId: 'rune', zoneEntryId: 1 },
  }), code('stale-incarnation'));
});

test('controller, non-Rune, stale incarnation, ready/exhausted costs and window are checked without mutation', () => {
  const foreign = fixture({ rune: trustedRune(FURY, { owner: 'B', controller: 'B' }) });
  assert.throws(() => plan(foreign), code('wrong-controller'));
  assert.equal(foreign.kernel.player('A').energy, 0);
  assert.equal(foreign.kernel.getObject('rune').exhausted, false);

  const gear = fixture({ extra: { ...trustedRune(FURY), ref: { id: 'non-rune', zoneEntryId: 1 }, cardId: 'ogn-001-298', types: ['gear'], zone: 'board' } });
  assert.throws(() => plan(gear, 'rune-energy', {
    intent: { type: 'rune-energy', runeObjectId: 'non-rune', zoneEntryId: 1 },
  }), code('not-rune'));

  const stale = fixture();
  assert.throws(() => plan(stale, 'rune-energy', {
    intent: { type: 'rune-energy', runeObjectId: 'rune', zoneEntryId: 99 },
  }), code('stale-incarnation'));

  const tired = fixture({ rune: trustedRune(FURY, { exhausted: true }) });
  assert.throws(() => plan(tired), code('exhausted-rune'));
  assert.equal(tired.kernel.player('A').energy, 0);

  const notTurn = fixture({ turnPlayer: 'B' });
  assert.throws(() => plan(notTurn), code('illegal-window'));
  assert.equal(notTurn.kernel.player('A').energy, 0);
  assert.equal(notTurn.kernel.getObject('rune').exhausted, false);
});

test('Domain is frozen from trusted identity and cannot be changed by cost power or legend data', () => {
  const f = fixture({ rune: trustedRune(CALM, { power: ['Fury'], location: { type: 'legend', id: 'fake' } }) });
  assert.throws(() => plan(f, 'rune-power', {}, CALM), code('untrusted-rune'),
    'non-null printed power is rejected even when a resolver claims a Domain');

  const trusted = fixture({ rune: trustedRune(CALM) });
  const activation = plan(trusted, 'rune-power', {}, CALM);
  assert.equal(activation.rune.domain, 'Calm');
  assert.deepEqual(activation.draft.body[0].args.power, { kind: 'constant', value: ['Calm'] });
  assert.equal(Object.isFrozen(activation.rune), true);
  assert.throws(() => { activation.rune.domain = 'Fury'; }, TypeError);
});

test('a trusted resolver Domain change after planning is rejected before execution', () => {
  const f = fixture({ rune: trustedRune(CALM) });
  const identity = { ...CALM };
  const activation = planBasicRuneResourceActivation({
    chain: f.engine,
    state: f.state,
    resolveIdentity: cardId => cardId === CALM.cardId ? identity : null,
    request: request('rune-power'),
  });
  identity.domain = 'Fury';
  const before = f.kernel.stateForTest();
  assert.throws(() => executeBasicRuneResourcePlan(activation), code('domain-changed'));
  assert.deepEqual(f.kernel.stateForTest(), before);
  assert.deepEqual(f.kernel.player('A').power, []);
});

test('a plan that becomes stale before execution rolls back and the activation identity cannot be retried', () => {
  const f = fixture();
  const activation = plan(f);
  // Commit a real move through the host before Finalize, creating a new
  // incarnation while retaining the same id. This is not a hand-settled plan.
  assert.equal(f.kernel.perform({ type: 'move-zone', object: f.kernel.ref('rune'), to: 'rune-deck' }).status, 'done');
  const before = f.kernel.stateForTest();
  assert.throws(() => executeBasicRuneResourcePlan(activation), code('stale-incarnation'));
  assert.deepEqual(f.kernel.stateForTest(), before);
  assert.throws(() => executeBasicRuneResourcePlan(activation), code('stale-incarnation'));
  assert.equal(f.kernel.player('A').energy, 0);
});

test('payment-window activation is accepted only through the Chain payment seam', () => {
  const f = fixture();
  const activation = plan(f, 'rune-energy', { window: { kind: 'payment' } });
  const before = f.kernel.stateForTest();
  assert.throws(() => executeBasicRuneResourcePlan(activation), /Only Reaction Add is allowed during payment/);
  assert.deepEqual(f.kernel.stateForTest(), before);
  assert.equal(f.kernel.player('A').energy, 0);
  assert.equal(f.kernel.getObject('rune').exhausted, false);
});

test('rune-energy resolves inside a real parent Pay Costs step and funds that cost', () => {
  let activation;
  let receipt;
  const f = fixture({
    choose: request => {
      if (request.id.endsWith(':base')) {
        receipt = executeBasicRuneResourcePlan(activation);
        return 'normal';
      }
      return undefined;
    },
  });
  activation = plan(f, 'rune-energy', {
    activationId: 'rune:payment',
    window: { kind: 'payment' },
  });

  f.engine.execute({
    id: 'parent-cost',
    controller: 'A',
    source: f.kernel.getObject('source'),
    kind: 'activated',
    speed: 'normal',
    body: [],
    cost: {
      id: 'cost:parent',
      cost: { kind: 'printed' },
      baseChoices: [{
        id: 'normal',
        cost: {
          energy: { kind: 'constant', value: 1 },
          power: { kind: 'constant', value: [] },
        },
      }],
    },
  });

  assert.equal(receipt.energyAdded, 1);
  assert.equal(f.kernel.player('A').energy, 0, 'the parent cost consumed the added Energy');
  assert.equal(f.kernel.getObject('rune').exhausted, true);
  assert.deepEqual(
    f.engine.trace.filter(event => event.item === 'rune:payment' && ['pending', 'finalized', 'resolved'].includes(event.step))
      .map(event => event.step),
    ['pending', 'finalized', 'resolved'],
  );
  assert.equal(
    f.engine.trace.some(event => event.item === 'rune:payment' && event.step === 'priority-granted'),
    false,
    '430.2.a: the Add does not pass Priority',
  );
});

test('an illegal finalization rolls the paid cost back and allows a corrected retry', () => {
  let failAfterPayment = true;
  const f = fixture({
    cleanup: () => {
      if (failAfterPayment && f.kernel.getObject('rune').exhausted) {
        failAfterPayment = false;
        throw new Error('late cleanup failure');
      }
      return false;
    },
  });
  const activation = plan(f, 'rune-energy', { activationId: 'rune:rollback' });
  assert.throws(() => executeBasicRuneResourcePlan(activation), /late cleanup failure/);
  assert.equal(f.kernel.player('A').energy, 0);
  assert.equal(f.kernel.getObject('rune').exhausted, false);
  const receipt = executeBasicRuneResourcePlan(activation);
  assert.equal(receipt.energyAdded, 1);
  assert.equal(f.kernel.player('A').energy, 1);
  assert.equal(f.kernel.getObject('rune').exhausted, true);
});
