import assert from 'node:assert/strict';
import test from 'node:test';

import { ChainEngine } from '../../dist/chain/index.js';
import { activateReactionAddDuringPayment, AddWindowError } from '../../dist/chain/index.js';
import { AwaitChoice } from '../../dist/effects/contract.js';
import { world } from '../../dist/effects/testing/test-kernel.js';
import { bindResolveContext, createActionPipelineHost } from '../../dist/events/action-adapter.js';
import { activatedAddAbilities, createProgramBinding, describeAddActivation } from '../../dist/programs/index.js';
import arenaBar from '../../../card-dsl/dist/cards/ogn/arena-bar.js';
import daughterOfTheVoid from '../../../card-dsl/dist/cards/ogn/daughter-of-the-void.js';
import energyConduit from '../../../card-dsl/dist/cards/ogn/energy-conduit.js';
import malzaharFanatic from '../../../card-dsl/dist/cards/ogn/malzahar-fanatic.js';
import sealOfRage from '../../../card-dsl/dist/cards/ogn/seal-of-rage.js';
import dragonsoulSage from '../../../card-dsl/dist/cards/unl/dragonsoul-sage.js';
import ancientHenge from '../../../card-dsl/dist/cards/sfd/ancient-henge.js';

const constant = value => ({ kind: 'constant', value });
const executableView = program => ({ ...program, status: 'executable', judgeReason: undefined });

function scene(program, {
  energy = 0,
  power = [],
  exhausted = false,
  types = ['gear'],
  onPayment,
  onFinalize,
} = {}) {
  const kernel = world()
    .player('A', { energy, power })
    .player('B')
    .base('source', {
      cardId: program.canonicalCardId,
      types,
      energy: null,
      power: null,
      exhausted,
    })
    .base('victim', { owner: 'A', types: ['unit'], exhausted: true })
    .deck(['A:deck:1', 'A:deck:2', 'A:deck:3'], { owner: 'A' })
    .deck(['B:deck:1'], { owner: 'B' })
    .build();
  let engine;
  let binding;
  const choose = request => {
    if (request.id === 'cost:parent:base' && onPayment !== undefined) {
      onPayment({ engine, binding, kernel });
      return 'normal';
    }
    if (request.id === 'finalize:parent:optional' && onFinalize !== undefined) {
      onFinalize({ engine, binding, kernel });
      return true;
    }
    if (request.type === 'select-objects' && request.min === request.max && request.options.length === request.min) {
      return [...request.options];
    }
    throw new AwaitChoice(request);
  };
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: saved => { kernel.restore(saved.state); kernel.copyLinkedFrom(saved.links); },
    objects: () => kernel.objects,
    perform: action => kernel.perform(action),
    choose,
    context: (source, controller, timingPoint) => bindResolveContext(kernel, { source, controller, timingPoint, choose }),
  });
  engine = new ChainEngine({ turnOrder: ['A', 'B'], turnPlayer: 'A', phase: 'main', host, cleanup: () => false });
  binding = createProgramBinding({ cardPrograms: [executableView(program)] });
  return { kernel, engine, binding };
}

function parentDraft(f, cost = { energy: constant(1) }, options = {}) {
  return {
    id: 'parent',
    controller: 'A',
    source: f.kernel.getObject('source'),
    kind: 'activated',
    speed: 'normal',
    body: [],
    cost: {
      id: 'cost:parent',
      cost,
      baseChoices: [{ id: 'normal', cost }],
    },
    ...options,
  };
}

test('default binding classifies only real effect.resources abilities as Add and exposes both barrels', () => {
  const f = scene(sealOfRage);
  const source = f.kernel.getObject('source');
  const records = activatedAddAbilities(f.binding.registry, source);
  assert.equal(records.length, 1);
  assert.deepEqual(records[0].resourceInstructionIds, ['seal-of-rage.add-fury']);
  assert.deepEqual(f.binding.activatedAddAbilities(source), records);

  const draft = f.binding.describeActivate(source, 'A');
  assert.equal(draft.kind, 'add');
  assert.equal(draft.speed, 'reaction');
  assert.deepEqual(draft.source, source);
  assert.equal(draft.controller, 'A');
  assert.deepEqual(draft.body, sealOfRage.abilities[0].body);
  assert.deepEqual(draft.cost, {
    id: draft.cost.id,
    cost: sealOfRage.abilities[0].cost,
    domains: [],
  });
  const explicit = f.binding.describeAddActivation(source, 'A');
  assert.equal(explicit.abilityIndex, 0);
  assert.deepEqual(explicit.resourceInstructionIds, ['seal-of-rage.add-fury']);
  assert.equal(explicit.sourcePurpose, undefined);
  assert.equal(explicit.draft.kind, draft.kind);
  assert.equal(explicit.draft.speed, draft.speed);
  assert.deepEqual(explicit.draft.source, draft.source);
  assert.deepEqual(explicit.draft.body, draft.body);
  assert.notEqual(explicit.draft.id, draft.id);
  assert.notEqual(explicit.draft.cost.id, draft.cost.id);
  assert.equal(typeof describeAddActivation, 'function');
  assert.equal(typeof activateReactionAddDuringPayment, 'function');
});

test('default binding leaves a non-Add activation on the ordinary Chain path', () => {
  const f = scene(arenaBar, { types: ['gear'] });
  const draft = f.binding.describeActivate(f.kernel.getObject('source'), 'A');
  assert.equal(draft.kind, 'activated');
  assert.equal(draft.speed, 'action');
  assert.equal(f.binding.activatedAddAbilities(f.kernel.getObject('source')).length, 0);
  f.engine.execute(draft);
  assert.equal(f.engine.items[0].status, 'finalized');
  assert.equal(f.kernel.getObject('source').exhausted, true);
  assert.equal(f.engine.trace.some(event => event.item === draft.id && event.step === 'resolved'), false);
});

test('default binding keeps nested or mixed resource submissions judge-required', () => {
  const f = scene(ancientHenge);
  const source = f.kernel.getObject('source');
  assert.equal(f.binding.activatedAddAbilities(source).length, 0);
  assert.throws(
    () => f.binding.describeActivate(source, 'A'),
    error => error?.code === 'judge-required' && /unverified Add shape/.test(error.message),
  );
  assert.equal(f.engine.items.length, 0);
});

test('default binding keeps a real single Add body behind an unbound activation purpose judge-required', () => {
  const f = scene(sealOfRage);
  const source = f.kernel.getObject('source');
  const restricted = {
    ...sealOfRage,
    abilities: sealOfRage.abilities.map(ability => ability.kind === 'activated'
      ? { ...ability, restriction: { kind: 'use-only-to-play-spells' } }
      : ability),
  };
  const binding = createProgramBinding({ cardPrograms: [restricted] });
  assert.throws(
    () => binding.describeActivate(source, 'A'),
    error => error?.code === 'judge-required' && /unverified Add shape/.test(error.message),
  );
  assert.equal(f.engine.items.length, 0);
});

test('default binding does not coerce original Universal Power into a named Add resource', () => {
  const f = scene(daughterOfTheVoid, { types: ['legend'] });
  const source = f.kernel.getObject('source');
  assert.equal(daughterOfTheVoid.status, 'judge-required');
  assert.throws(
    () => f.binding.describeActivate(source, 'A'),
    error => error?.code === 'judge-required' && /unverified Add shape/.test(error.message),
  );
  assert.equal(f.engine.items.length, 0);
});

test('default binding classifies original Energy Conduit and exhausts exactly once', () => {
  const f = scene(energyConduit);
  const source = f.kernel.getObject('source');
  const draft = f.binding.describeActivate(source, 'A');
  assert.equal(draft.kind, 'add');
  f.engine.execute(draft);
  assert.equal(f.kernel.player('A').energy, 1);
  assert.equal(f.kernel.getObject('source').exhausted, true);
  assert.equal(f.engine.pipeline.events.filter(event => event.action?.type === 'exhaust').length, 1);
  assert.equal(f.engine.items.length, 0);
});

test('Dragonsoul Sage default Add finalizes and resolves immediately without Priority or Focus', () => {
  const f = scene(dragonsoulSage, { types: ['unit'] });
  const draft = f.binding.describeActivate(f.kernel.getObject('source'), 'A');
  f.engine.execute(draft);
  assert.equal(f.kernel.player('A').energy, 1);
  assert.equal(f.kernel.getObject('source').exhausted, true);
  assert.equal(f.engine.items.length, 0);
  assert.deepEqual(
    f.engine.trace.filter(event => event.item === draft.id).map(event => `${event.step}${event.reason ? `:${event.reason}` : ''}`),
    ['pending', 'finalize-start', 'finalized', 'resolve-start', 'resolved', 'removed:resolved'],
  );
  assert.equal(f.engine.trace.some(event => event.item === draft.id && ['priority-granted', 'focus-granted'].includes(event.step)), false);
});

test('Seal of Rage default Add pays the parent Power cost and returns an immediate public receipt', () => {
  let receipt;
  const f = scene(sealOfRage, {
    onPayment: ({ engine, binding, kernel }) => {
      receipt = activateReactionAddDuringPayment({
        engine,
        registry: binding.registry,
        source: kernel.getObject('source'),
        controller: 'A',
      });
    },
  });
  f.engine.execute(parentDraft(f, { power: constant(['Fury']) }));
  assert.equal(f.kernel.player('A').energy, 0);
  assert.deepEqual(f.kernel.player('A').power, []);
  assert.equal(f.kernel.getObject('source').exhausted, true);
  assert.equal(receipt.status, 'resolved');
  assert.deepEqual(receipt.source, f.kernel.ref('source'));
  assert.deepEqual(receipt.resources, { energy: 0, power: ['Fury'] });
  assert.deepEqual(receipt.resourceInstructionIds, ['seal-of-rage.add-fury']);
  assert.equal(receipt.cost.settled, true);
  assert.deepEqual(receipt.cost.events.map(event => event.action), [{ type: 'exhaust', object: f.kernel.ref('source') }]);
  assert.equal(receipt.priorityTransferred, false);
  assert.deepEqual(receipt.trace.map(event => `${event.step}${event.reason ? `:${event.reason}` : ''}`), [
    'pending', 'finalized', 'resolved', 'removed:resolved',
  ]);
  assert.deepEqual(f.engine.trace
    .filter(event => ['priority-granted', 'focus-granted'].includes(event.step) && event.item === receipt.itemId), []);
  assert.equal(f.engine.pipeline.events.filter(event => event.action?.type === 'exhaust').length, 1);
});

test('public Add window rejects illegal windows, speed, controller and stale incarnation without mutation', () => {
  const f = scene(sealOfRage);
  const source = f.kernel.getObject('source');
  const before = f.kernel.snapshot();
  const invoke = (overrides = {}) => activateReactionAddDuringPayment({
    engine: f.engine,
    registry: f.binding.registry,
    source,
    controller: 'A',
    ...overrides,
  });
  assert.throws(() => invoke(), error => error instanceof AddWindowError && error.code === 'not-paying');
  assert.deepEqual(f.kernel.snapshot(), before);
  assert.equal(f.engine.items.length, 0);

  const nonReaction = { ...source, cardId: null };
  assert.throws(() => invoke({ source: nonReaction }), error => error?.code === 'unknown-program');
  assert.throws(() => invoke({ controller: 'B' }), error => error?.code === 'controller-mismatch');
  const stale = { ...source, ref: { ...source.ref, zoneEntryId: source.ref.zoneEntryId + 1 } };
  assert.throws(() => invoke({ source: stale }), error => error?.code === 'stale-source');
  assert.deepEqual(f.kernel.snapshot(), before);
  assert.equal(f.engine.items.length, 0);
});

test('public Add window rejects a non-Reaction ability and duplicate identity without committing', () => {
  const nonReaction = scene(malzaharFanatic, { types: ['unit'] });
  assert.throws(
    () => activateReactionAddDuringPayment({
      engine: nonReaction.engine,
      registry: nonReaction.binding.registry,
      source: nonReaction.kernel.getObject('source'),
      controller: 'A',
    }),
    error => error instanceof AddWindowError && error.code === 'not-reaction',
  );
  assert.equal(nonReaction.engine.items.length, 0);

  let repeatedError;
  const f = scene(sealOfRage, {
    energy: 1,
    onPayment: ({ engine, binding, kernel }) => {
      const request = {
        engine,
        registry: binding.registry,
        source: kernel.getObject('source'),
        controller: 'A',
      };
      const draft = binding.describeActivate(request.source, 'A');
      engine.activateAddDuringPayment(draft);
      const beforeItems = engine.items.length;
      const beforePower = [...kernel.player('A').power];
      try {
        engine.activateAddDuringPayment(draft);
      } catch (error) {
        repeatedError = error;
      }
      assert.equal(engine.items.length, beforeItems);
      assert.deepEqual(kernel.player('A').power, beforePower);
    },
  });
  f.engine.execute(parentDraft(f));
  assert.match(repeatedError?.message ?? '', /Invalid or reused chain identity/);
  assert.deepEqual(f.kernel.player('A').power, ['Fury']);
  assert.equal(f.kernel.getObject('source').exhausted, true);
  assert.equal(f.engine.items.length, 1);
});

test('parent payment rejection after the public Add rolls back the Add and all state', () => {
  let receipt;
  const f = scene(sealOfRage, {
    energy: 1,
    onPayment: ({ engine, binding, kernel }) => {
      receipt = activateReactionAddDuringPayment({
        engine,
        registry: binding.registry,
        source: kernel.getObject('source'),
        controller: 'A',
      });
    },
  });
  const before = f.kernel.snapshot();
  const beforeTrace = f.engine.trace;
  assert.equal(receipt, undefined);
  assert.throws(
    () => f.engine.execute(parentDraft(f, { energy: constant(2) })),
    error => error?.reason === 'cannot-pay-cost',
  );
  assert.deepEqual(f.kernel.snapshot(), before);
  assert.deepEqual(f.engine.trace, beforeTrace);
  assert.equal(f.engine.items.length, 0);
});
