import assert from 'node:assert/strict';
import test from 'node:test';

import dauntlessVanguard from '../../../card-dsl/dist/cards/sfd/dauntless-vanguard.js';
import ambush from '../../dist/effects/keywords/Ambush.js';
import { AwaitChoice } from '../../dist/effects/contract.js';
import { world } from '../../dist/effects/testing/index.js';
import { bindResolveContext, createActionPipelineHost } from '../../dist/events/action-adapter.js';
import { ChainEngine } from '../../dist/chain/engine.js';
import { createProgramBinding } from '../../dist/programs/index.js';

const FIELD = { type: 'battlefield', id: 'field' };
const OTHER_FIELD = { type: 'battlefield', id: 'other-field' };

function playProgram(canonicalCardId) {
  return {
    canonicalCardId,
    rulesetVersion: 'core-1.5',
    status: 'executable',
    sourceText: canonicalCardId,
    abilities: [{ kind: 'play', cost: { kind: 'printed' }, body: [] }],
  };
}

function scenario({ setup, programs = [], choose, controllers = new Map([['field', null], ['other-field', null]]) } = {}) {
  const binding = createProgramBinding({ cardPrograms: programs });
  const builder = world().player('A', { energy: 10 }).player('B', { energy: 10 })
    .battlefield('field', { controller: undefined, types: ['battlefield'], location: FIELD })
    .battlefield('other-field', { controller: undefined, types: ['battlefield'], location: OTHER_FIELD });
  setup?.(builder);
  const kernel = builder.build();
  const answer = request => {
    const custom = choose?.(request);
    if (custom !== undefined) return custom;
    throw new AwaitChoice(request);
  };
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: saved => { kernel.restore(saved.state); kernel.copyLinkedFrom(saved.links); },
    objects: () => kernel.objects,
    perform: action => kernel.perform(action),
    choose: answer,
    context: (source, controller, timingPoint) => bindResolveContext(kernel, {
      source, controller, timingPoint, choose: answer,
    }),
    testTrigger: registration => kernel.test(registration.spec.condition),
  });
  const engine = new ChainEngine({
    turnOrder: ['A', 'B'], turnPlayer: 'A', phase: 'main', host,
    cleanup: () => false, describePlay: binding.describePlay,
  });
  engine.initializeBattlefieldControl([
    { id: 'field', controller: controllers.get('field') },
    { id: 'other-field', controller: controllers.get('other-field') },
  ]);
  const errors = [];
  const lifecycle = binding.attachLifecycle(engine, error => errors.push(error));
  return { binding, engine, kernel, lifecycle, errors };
}

function setChainBattlefieldControl(f, controller, battlefieldId = 'field') {
  f.engine.setBattlefieldController(battlefieldId, controller);
}

function controlWithFixtureUnit(builder, battlefieldId = 'field') {
  return builder.unit(`control:${battlefieldId}`, {
    controller: 'A',
    location: { type: 'battlefield', id: battlefieldId },
  });
}

function play(f, id, location) {
  const source = f.kernel.getObject(id);
  f.engine.execute(f.binding.describePlay({
    type: 'play',
    player: 'A',
    object: f.kernel.ref(id),
    ...(location === undefined ? {} : { location }),
  }, source));
}

function assertRejectedWithoutEffects(f, id, location) {
  const before = f.kernel.getObject(id);
  const energy = f.kernel.player('A').energy;
  assert.throws(() => play(f, id, location), /Play destination is not legally allowed/);
  assert.equal(f.kernel.player('A').energy, energy);
  assert.deepEqual(f.kernel.getObject(id), before);
  assert.equal(f.engine.items.length, 0);
  assert.equal(f.engine.pipeline.events.some(event => event.timingPoint === 'card-played'), false);
}


test('RIFT-969 Unit enters own Base or a Battlefield controlled by its controller', () => {
  const cardId = 'unit-own-locations';
  const ownBase = scenario({
    programs: [playProgram(cardId)],
    setup: b => b.hand('unit', { cardId, types: ['unit'], energy: 1, power: [] })
      .unit('controller', { controller: 'A', location: FIELD }),
  });
  play(ownBase, 'unit', { type: 'base', player: 'A' });
  assert.deepEqual(ownBase.kernel.getObject('unit').location, { type: 'base', player: 'A' });
  ownBase.lifecycle.detach();

  const ownField = scenario({
    controllers: new Map([['field', 'A'], ['other-field', null]]),
    programs: [playProgram(cardId)],
    setup: b => controlWithFixtureUnit(b.hand('unit', { cardId, types: ['unit'], energy: 1, power: [] })),
  });
  play(ownField, 'unit', FIELD);
  assert.deepEqual(ownField.kernel.getObject('unit').location, FIELD);
  ownField.lifecycle.detach();
});

test('RIFT-969 omitted destination defaults to the controller Base', () => {
  const cardId = 'unit-default-base';
  const f = scenario({
    programs: [playProgram(cardId)],
    setup: b => b.hand('unit', { cardId, types: ['unit'], energy: 1, power: [] }),
  });
  play(f, 'unit');
  assert.deepEqual(f.kernel.getObject('unit').location, { type: 'base', player: 'A' });
  f.lifecycle.detach();
});

test('RIFT-969 uncontrolled, enemy-controlled, and foreign Base destinations reject atomically', () => {
  const cardId = 'unit-illegal-locations';
  for (const { setup, location } of [
    { setup: b => b.hand('unit', { cardId, types: ['unit'], energy: 1, power: [] }), location: FIELD },
    { setup: b => b.hand('unit', { cardId, types: ['unit'], energy: 1, power: [] })
      .unit('enemy-controller', { owner: 'B', controller: 'B', location: FIELD }), location: FIELD },
    { setup: b => b.hand('unit', { cardId, types: ['unit'], energy: 1, power: [] }), location: { type: 'base', player: 'B' } },
  ]) {
    const f = scenario({
      programs: [playProgram(cardId)],
      setup,
    });
    if (location.type === 'battlefield') setChainBattlefieldControl(f, undefined);
    assertRejectedWithoutEffects(f, 'unit', location);
    f.lifecycle.detach();
  }
});

test('RIFT-969 Gear needs an explicit permission for a Battlefield', () => {
  const cardId = 'gear-default-destination';
  const f = scenario({
    programs: [playProgram(cardId)],
    setup: b => b.hand('gear', { cardId, types: ['gear'], energy: 1, power: [] }),
  });
  assertRejectedWithoutEffects(f, 'gear', FIELD);
  f.lifecycle.detach();
});

test('RIFT-969 Dauntless while-in-hand permission accepts an occupied enemy Battlefield', () => {
  const cardId = dauntlessVanguard.canonicalCardId;
  const f = scenario({
    controllers: new Map([['field', 'B'], ['other-field', null]]),
    programs: [dauntlessVanguard],
    setup: b => b.hand('dauntless', { cardId, types: ['unit'], energy: 1, power: [] })
      .unit('enemy', { owner: 'B', controller: 'B', location: FIELD }),
  });
  assert.deepEqual(f.errors, []);
  assert.equal(f.engine.controlsBattlefield('A', 'field'), false);
  play(f, 'dauntless', FIELD);
  assert.deepEqual(f.kernel.getObject('dauntless').location, FIELD);
  assert.equal(f.kernel.getObject('dauntless').zone, 'board');
  f.lifecycle.detach();
});

test('RIFT-969 explicit enemy control rejects a Unit even with an unowned fixture occupant', () => {
  const cardId = 'unit-explicit-control';
  const f = scenario({
    programs: [playProgram(cardId)],
    setup: b => b.hand('unit', { cardId, types: ['unit'], energy: 1, power: [] })
      .unit('fixture-occupant', { owner: 'A', controller: 'A', location: FIELD }),
  });
  setChainBattlefieldControl(f, 'B');
  assertRejectedWithoutEffects(f, 'unit', FIELD);
  f.lifecycle.detach();
});

test('RIFT-969 Dauntless permission rejects open and enemy-controlled empty Battlefields', () => {
  const cardId = dauntlessVanguard.canonicalCardId;
  for (const setup of [
    b => b.hand('dauntless-open', { cardId, types: ['unit'], energy: 1, power: [] }),
    b => b.hand('dauntless-enemy', { cardId, types: ['unit'], energy: 1, power: [] })
      .unit('enemy-controller', { owner: 'B', controller: 'B', location: FIELD }),
  ]) {
    const f = scenario({
      programs: [dauntlessVanguard],
      setup,
    });
    setChainBattlefieldControl(f, undefined);
    const id = [...f.kernel.objects].find(object => object.zone === 'hand').ref.id;
    assertRejectedWithoutEffects(f, id, FIELD);
    f.lifecycle.detach();
  }
});

test('RIFT-969 Dauntless rejects an enemy-controlled occupied Battlefield without the friendly Unit predicate', () => {
  const f = scenario({
    controllers: new Map([['field', 'B'], ['other-field', null]]),
    programs: [dauntlessVanguard],
    setup: b => b.hand('dauntless', { cardId: dauntlessVanguard.canonicalCardId, types: ['unit'], energy: 1, power: [] })
      .unit('enemy', { owner: 'B', controller: 'B', location: FIELD }),
  });
  setChainBattlefieldControl(f, undefined);
  assertRejectedWithoutEffects(f, 'dauntless', FIELD);
  f.lifecycle.detach();
});

test('RIFT-969 a Battlefield carrier marked enemy-controlled rejects a Unit', () => {
  const cardId = 'unit-carrier-control';
  const f = scenario({
    controllers: new Map([['field', undefined], ['other-field', null]]),
    programs: [playProgram(cardId)],
    setup: b => b.hand('unit', { cardId, types: ['unit'], energy: 1, power: [] }),
  });
  const snapshot = f.kernel.snapshot();
  const stored = snapshot.objects.get('field');
  if (!stored) throw new Error('missing field carrier');
  snapshot.objects.set('field', { ...stored, controller: 'B' });
  f.kernel.restore(snapshot);
  setChainBattlefieldControl(f, undefined);
  assertRejectedWithoutEffects(f, 'unit', FIELD);
  f.lifecycle.detach();
});

test('RIFT-969 Ambush permission uses the keyword friendly-Unit predicate', () => {
  const canonicalCardId = 'ambush-unit';
  const ambushProgram = {
    canonicalCardId,
    rulesetVersion: 'core-1.5',
    status: 'executable',
    sourceText: '[Ambush]',
    abilities: [{ kind: 'play', cost: { kind: 'printed' }, body: [] }, ...ambush.expand({ host: { canonicalCardId } })],
  };
  const legal = scenario({
    programs: [ambushProgram],
    setup: b => b.hand('ambush', { cardId: canonicalCardId, types: ['unit'], keywords: [{ id: 'Ambush' }], energy: 1, power: [] })
      .unit('ally', { controller: 'A', location: FIELD }),
  });
  legal.engine.initializeBattlefieldControl([{ id: 'field', controller: null }, { id: 'other-field', controller: null }]);
  assert.equal(legal.engine.controlsBattlefield('A', 'field'), false);
  assert.deepEqual(legal.errors, []);
  play(legal, 'ambush', FIELD);
  assert.deepEqual(legal.kernel.getObject('ambush').location, FIELD);
  legal.lifecycle.detach();

  const illegal = scenario({
    programs: [ambushProgram],
    setup: b => b.hand('ambush', { cardId: canonicalCardId, types: ['unit'], keywords: [{ id: 'Ambush' }], energy: 1, power: [] })
      .unit('ally-elsewhere', { controller: 'A', location: OTHER_FIELD }),
  });
  assertRejectedWithoutEffects(illegal, 'ambush', FIELD);
  illegal.lifecycle.detach();
});

test('RIFT-969 Finalize rechecks a while-in-hand permission after its registration leaves the source', () => {
  const f = scenario({
    controllers: new Map([['field', 'B'], ['other-field', null]]),
    programs: [dauntlessVanguard],
    setup: b => b.hand('dauntless', {
      cardId: dauntlessVanguard.canonicalCardId, types: ['unit'], energy: 1, power: [],
    }).unit('enemy', { owner: 'B', controller: 'B', location: FIELD }),
  });
  const before = f.kernel.getObject('dauntless');
  const draft = f.binding.describePlay({ type: 'play', player: 'A', object: f.kernel.ref('dauntless'), location: FIELD }, before);
  f.engine.execute(draft);
  const entered = f.kernel.getObject('dauntless');
  assert.equal(entered.zone, 'board');
  assert.equal(f.engine.items.length, 0);
  f.lifecycle.detach();
});

test('RIFT-969 CR 806.3 Action timing does not allow an enemy-controlled Battlefield', () => {
  const cardId = 'action-unit-destination';
  const actionUnit = {
    canonicalCardId: cardId,
    rulesetVersion: 'core-1.5',
    status: 'executable',
    sourceText: '[Action]',
    abilities: [{ kind: 'play', cost: { kind: 'printed' }, body: [] }],
  };
  const f = scenario({
    programs: [actionUnit],
    setup: b => b.hand('unit', {
      cardId, types: ['unit'], keywords: [{ id: 'Action' }], energy: 1, power: [],
    }).unit('enemy-controller', { owner: 'B', controller: 'B', location: FIELD }),
  });
  setChainBattlefieldControl(f, undefined);
  const source = f.kernel.getObject('unit');
  const draft = f.binding.describePlay({ type: 'play', player: 'A', object: source.ref, location: FIELD }, source);
  assert.equal(draft.speed, 'action');
  assertRejectedWithoutEffects(f, 'unit', FIELD);
  f.lifecycle.detach();
});

test('RIFT-969 a transient source outside the Chain cannot satisfy a blocked destination', () => {
  const f = scenario({
    programs: [dauntlessVanguard],
    setup: b => b.hand('dauntless', {
      cardId: dauntlessVanguard.canonicalCardId, types: ['unit'], energy: 1, power: [],
    }).unit('enemy', { owner: 'B', controller: 'B', location: FIELD }),
  });
  const before = f.kernel.getObject('dauntless');
  const draft = f.binding.describePlay({ type: 'play', player: 'A', object: f.kernel.ref('dauntless'), location: FIELD }, before);
  setChainBattlefieldControl(f, undefined);
  assert.throws(() => f.engine.execute(draft), /Play destination is not legally allowed/);
  assert.equal(f.kernel.getObject('dauntless').zone, 'hand');
  assert.equal(f.engine.items.length, 0);
  assert.equal(f.kernel.player('A').energy, 10);
  f.lifecycle.detach();
});
