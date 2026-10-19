import assert from 'node:assert/strict';
import test from 'node:test';

import { ChainEngine } from '../../dist/chain/engine.js';
import { activateReactionAddDuringPayment, AddWindowError } from '../../dist/chain/finalize/add-window.js';
import { AwaitChoice } from '../../dist/effects/contract.js';
import { world } from '../../dist/effects/testing/test-kernel.js';
import { bindResolveContext, createActionPipelineHost } from '../../dist/events/action-adapter.js';
import { activatedAddAbilities, describeAddActivation, describeTriggeredAdd, triggeredAddAbilities } from '../../dist/programs/add.js';
import { triggerRegistrations } from '../../dist/programs/triggers.js';
import akaliBrash from '../../../card-dsl/dist/cards/rad/akali-brash.js';
import { createProgramBinding } from '../../dist/programs/index.js';
import daughterOfTheVoid from '../../../card-dsl/dist/cards/ogn/daughter-of-the-void.js';
import handOfNoxus from '../../../card-dsl/dist/cards/ogn/hand-of-noxus.js';
import sealOfRage from '../../../card-dsl/dist/cards/ogn/seal-of-rage.js';
import dragonsoulSage from '../../../card-dsl/dist/cards/unl/dragonsoul-sage.js';

const constant = value => ({ kind: 'constant', value });
const executableView = program => ({ ...program, status: 'executable', judgeReason: undefined });

function scene(program, { energy = 0, power = [], exhausted = false, onPayment } = {}) {
  const kernel = world()
    .player('A', { energy, power })
    .player('B')
    .base('source', {
      cardId: program.canonicalCardId,
      types: ['gear'],
      energy: null,
      power: null,
      exhausted,
    })
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

function parentDraft(f, cost = { energy: constant(1) }) {
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
  };
}

test('raw Seal of Rage IR is recognized as Add and preserves its exact cost, purpose and body', () => {
  const f = scene(sealOfRage);
  const records = activatedAddAbilities(f.binding.registry, f.kernel.getObject('source'));
  assert.equal(records.length, 1);
  assert.deepEqual(records[0].resourceInstructionIds, ['seal-of-rage.add-fury']);
  const activation = describeAddActivation(f.binding.registry, f.kernel.getObject('source'), 'A');
  assert.equal(activation.draft.kind, 'add');
  assert.equal(activation.draft.speed, 'reaction');
  assert.deepEqual(activation.draft.body, sealOfRage.abilities[0].body);
  assert.deepEqual(activation.draft.cost, {
    id: activation.draft.cost.id,
    cost: sealOfRage.abilities[0].cost,
    domains: [],
  });
});

test('raw Dragonsoul Sage Add finalizes and resolves immediately without transferring priority', () => {
  const f = scene(dragonsoulSage);
  const activation = describeAddActivation(f.binding.registry, f.kernel.getObject('source'), 'A');
  f.engine.execute(activation.draft);
  assert.equal(f.kernel.player('A').energy, 1);
  assert.equal(f.kernel.getObject('source').exhausted, true);
  assert.equal(f.engine.items.length, 0);
  assert.deepEqual(
    f.engine.trace.filter(event => event.item === activation.draft.id).map(event => `${event.step}${event.reason ? `:${event.reason}` : ''}`),
    ['pending', 'finalize-start', 'finalized', 'resolve-start', 'resolved', 'removed:resolved'],
  );
  assert.equal(f.engine.trace.some(event => event.item === activation.draft.id && event.step === 'priority-granted'), false);
});

test('raw Seal of Rage Add pays the parent Power cost and returns source, purpose and cost evidence', () => {
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
});

test('an Add activation outside the parent Pay Costs step is rejected without mutation', () => {
  const f = scene(sealOfRage);
  const before = f.kernel.snapshot();
  assert.throws(
    () => activateReactionAddDuringPayment({
      engine: f.engine,
      registry: f.binding.registry,
      source: f.kernel.getObject('source'),
      controller: 'A',
    }),
    error => error instanceof AddWindowError && error.code === 'not-paying',
  );
  assert.deepEqual(f.kernel.snapshot(), before);
  assert.equal(f.engine.items.length, 0);
});

test('an exhausted Add source fails its real cost inside parent payment and rolls everything back', () => {
  const f = scene(sealOfRage, {
    exhausted: true,
    onPayment: ({ engine, binding, kernel }) => activateReactionAddDuringPayment({
      engine,
      registry: binding.registry,
      source: kernel.getObject('source'),
      controller: 'A',
    }),
  });
  const before = f.kernel.snapshot();
  const beforeTrace = f.engine.trace;
  assert.throws(() => f.engine.execute(parentDraft(f)), error => error?.reason === 'cannot-pay-cost');
  assert.deepEqual(f.kernel.snapshot(), before);
  assert.equal(f.engine.items.length, 0);
  assert.deepEqual(f.engine.trace, beforeTrace);
});

test('raw daughter of the void IR is classified as Add while its unsupported purpose stays judge-required', () => {
  const f = scene(daughterOfTheVoid);
  const records = activatedAddAbilities(f.binding.registry, f.kernel.getObject('source'));
  assert.equal(records.length, 1);
  assert.deepEqual(records[0].resourceInstructionIds, ['daughter-of-the-void.add-universal-power']);
  assert.deepEqual(records[0].sourcePurpose, { kind: 'use-only-to-play-spells' });
  assert.deepEqual(records[0].ability.body[0].args.power.value, ['rainbow']);
  assert.equal(daughterOfTheVoid.status, 'judge-required');
  assert.throws(
    () => describeAddActivation(f.binding.registry, f.kernel.getObject('source'), 'A'),
    error => error?.code === 'judge-required' && /use-only-to-play-spells/.test(error.message),
  );
  assert.equal(f.engine.items.length, 0);
});

test('raw Hand of Noxus Add is recognized while its unsupported Legion gate remains judge-required', () => {
  const f = scene(handOfNoxus);
  const records = activatedAddAbilities(f.binding.registry, f.kernel.getObject('source'));
  assert.equal(records.length, 1);
  assert.deepEqual(records[0].resourceInstructionIds, ['hand-of-noxus.add-energy']);
  assert.equal(records[0].sourcePurpose.kind, 'legion');
  assert.equal(handOfNoxus.status, 'judge-required');
  assert.throws(
    () => describeAddActivation(f.binding.registry, f.kernel.getObject('source'), 'A'),
    error => error?.code === 'judge-required',
  );
  assert.equal(f.engine.items.length, 0);
});

test('raw triggered Add IR is classified without promoting its unresolved event and Power semantics', () => {
  const f = scene(akaliBrash);
  const records = triggeredAddAbilities(f.binding.registry, f.kernel.getObject('source'));
  assert.equal(records.length, 1);
  assert.equal(records[0].abilityIndex, 0);
  assert.deepEqual(records[0].resourceInstructionIds, ['akali-brash.add-first-move']);
  assert.deepEqual(records[0].ability.body[0].args.power.value, ['rainbow']);
  assert.equal(akaliBrash.status, 'judge-required');
  assert.equal(f.engine.items.length, 0);
});

test('the original Akali trigger registration becomes an immediate Add draft without rewriting its event or body', () => {
  const f = scene(akaliBrash);
  const source = f.kernel.getObject('source');
  const [registration] = triggerRegistrations(f.binding.registry, source);
  assert.ok(registration);
  const trigger = {
    id: registration.id,
    controller: registration.controller,
    source: registration.source,
    registration,
    event: {
      type: 'task-resolved',
      seq: 1,
      eventId: 1,
      turnNumber: 1,
      activePlayerId: 'A',
      taskId: 'test:object-moved',
      sourceCardId: akaliBrash.canonicalCardId,
      reason: 'object-moved',
      autoResolved: true,
      timingPoint: 'object-moved',
    },
  };
  const draft = describeTriggeredAdd({
    id: `trigger:${registration.id}`,
    controller: registration.controller,
    source,
    body: registration.body,
    trigger,
    ...(registration.cost === undefined ? {} : { cost: registration.cost }),
    ...(registration.targets === undefined ? {} : { targets: registration.targets }),
    ...(registration.mayAtFinalize === undefined ? {} : { mayAtFinalize: registration.mayAtFinalize }),
  });
  assert.equal(draft.kind, 'add');
  assert.deepEqual(draft.trigger, trigger);
  assert.deepEqual(draft.body, registration.body);
  assert.equal(akaliBrash.status, 'judge-required');
  assert.equal(f.engine.items.length, 0);
});

test('the original Akali trigger registration settles immediately through the real Add chain while rainbow remains negated', () => {
  const f = scene(akaliBrash);
  const source = f.kernel.getObject('source');
  const [registration] = triggerRegistrations(f.binding.registry, source);
  assert.ok(registration);
  const trigger = {
    id: registration.id,
    controller: registration.controller,
    source: registration.source,
    registration,
    event: {
      type: 'task-resolved',
      seq: 1,
      eventId: 1,
      turnNumber: 1,
      activePlayerId: 'A',
      taskId: 'test:object-moved',
      sourceCardId: akaliBrash.canonicalCardId,
      reason: 'object-moved',
      autoResolved: true,
      timingPoint: 'object-moved',
    },
  };
  const draft = describeTriggeredAdd({
    id: `trigger:${registration.id}`,
    controller: registration.controller,
    source,
    body: registration.body,
    trigger,
    ...(registration.cost === undefined ? {} : { cost: registration.cost }),
    ...(registration.targets === undefined ? {} : { targets: registration.targets }),
    ...(registration.mayAtFinalize === undefined ? {} : { mayAtFinalize: registration.mayAtFinalize }),
  });
  f.engine.enqueue(draft);
  f.engine.advance();
  assert.deepEqual(f.engine.trace
    .filter(event => event.item === draft.id && ['pending', 'finalized', 'resolved', 'removed'].includes(event.step))
    .map(event => `${event.step}${event.reason === undefined ? '' : `:${event.reason}`}`), [
    'pending', 'finalized', 'resolved', 'removed:resolved',
  ]);
  assert.deepEqual(f.kernel.player('A').power, []);
  assert.equal(f.kernel.player('A').energy, 0);
  assert.equal(f.engine.items.length, 0);
  assert.equal(f.engine.trace.some(event => event.item === draft.id && event.step === 'priority-granted'), false);
});

test('a stale source identity fails closed before the Chain can issue an Add item', () => {
  const f = scene(sealOfRage);
  const source = f.kernel.getObject('source');
  const stale = { ...source, ref: { ...source.ref, zoneEntryId: source.ref.zoneEntryId + 1 } };
  assert.throws(
    () => activateReactionAddDuringPayment({
      engine: f.engine,
      registry: f.binding.registry,
      source: stale,
      controller: 'A',
    }),
    error => error?.code === 'stale-source',
  );
  assert.equal(f.engine.items.length, 0);
});
