// RIFT-931 official evidence (CR v1.5 published 2026-10-09, Radiance target
// effective 2026-10-16): /root/swarm-rift/shared/rules/CR-v1.5.txt
// https://cmsassets.rgpub.io/sanity/files/dsfx7636/news_live/5c7946f7c3b8c6e0faff85ab6dadc6d2e721ea94.pdf
// https://playriftbound.com/en-us/news/announcements/core-rules-radiance-patch-notes-effective-october-16-2026/
// - 810.1.c adds Battlefield-to-Battlefield to a Unit's Standard Move; 810.2
//   makes duplicate Ganking instances redundant.
// - 817.2/817.2.a require each Vision instance to trigger separately.
// - 317.1.a invokes end-of-turn effects and 317.2.c expires all "this turn"
//   effects simultaneously in the Expiration Step.
// Forecaster (card.hash-cdeb1c4bb2202d43d0f4ccb7c3e0ddfa25caf4f81c41dde5c8bdaa6bbeddfe40)
// timeline: Play -> Pending -> Finalize -> Resolve -> Board entry -> effective
// keyword expansion -> one actual trigger per Vision instance.
// Gem Jammer (card.hash-f0ac9d90de705764ec57a50fb7483a35117949080af9f6a959eb42a7b887c9e9)
// timeline: Play -> Pending -> Finalize lock target -> Resolve grant -> layer
// re-expansion -> Standard Move -> turn-end Expiration -> rejected Standard Move.
// The SFD source snapshot has no applicable errata for either interaction.
import assert from 'node:assert/strict';
import test from 'node:test';

import { AwaitChoice, world } from '../../dist/effects/testing/index.js';
import { ChainEngine } from '../../dist/chain/engine.js';
import { bindResolveContext, createActionPipelineHost } from '../../dist/events/action-adapter.js';
import { movement } from '../../dist/layers/rules/query.js';
import { createProgramBinding } from '../../dist/programs/index.js';
import { TurnPhaseLayers } from '../../dist/turn/phase-layers.js';
import { moveDuelUnitsStandard } from '../../dist/zones/movement.js';
import { duelWorld, mainTiming, readinessFor } from '../rules/movement/support.mjs';
import forecaster from '../../../card-dsl/dist/cards/sfd/forecaster.js';
import gemJammer from '../../../card-dsl/dist/cards/sfd/gem-jammer.js';

const admitted = program => ({ ...program, status: 'executable', judgeReason: undefined });

function runtime(builder, programs = [], answers = {}, options = {}) {
  const kernel = builder.build();
  const answerMap = new Map(Object.entries(answers));
  const asked = [];
  const choose = request => {
    asked.push(request);
    if (answerMap.has(request.id)) {
      return answerMap.get(request.id).map(value => typeof value === 'string' ? kernel.ref(value) : value);
    }
    if (request.type === 'mode') return request.options.at(-1);
    if (request.type === 'optional') return true;
    if (request.type === 'select-objects' && request.id?.includes('vision')) return [];
    if (request.type === 'select-objects' && request.min === request.max && request.options.length === request.min) {
      return [...request.options];
    }
    if (request.type === 'select-objects' && request.min === 0) return [];
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
  });
  const binding = createProgramBinding({ cardPrograms: programs.map(admitted) });
  const layers = options.turnPhaseLayers === true ? new TurnPhaseLayers(kernel.objects) : undefined;
  const engine = new ChainEngine({
    turnOrder: ['A', 'B'], turnPlayer: 'A', phase: 'main', host, cleanup: () => false,
    ...(layers === undefined ? {} : { layers }),
    describePlay: binding.describePlay,
  });
  binding.attachLifecycle(engine, error => { throw error; });
  const settle = () => {
    engine.advance();
    for (let guard = 0; engine.items.length; guard++) {
      assert.ok(guard < 40, 'the production chain settles');
      if (engine.priority === null) break;
      engine.pass(engine.priority);
    }
  };
  const enter = id => {
    assert.equal(engine.commit({ type: 'move-zone', object: kernel.ref(id), to: 'chain' }).status, 'done');
    assert.equal(engine.commit({
      type: 'move-zone', object: kernel.ref(id), to: 'base',
      location: { type: 'base', player: kernel.getObject(id).controller },
    }).status, 'done');
    engine.advance();
    settle();
  };
  const snapshot = id => { engine.layers.setObjects(kernel.objects); return engine.layers.evaluate(kernel.ref(id)); };
  return { kernel, engine, binding, asked, layers: engine.layers, settle, enter, snapshot };
}

function visionPrompts(asked) {
  return asked.filter(request => request.type === 'select-objects' &&
    request.id?.includes('vision') && request.options?.length > 0).length;
}

test('Forecaster counts a printed Vision plus the single grant as two triggering instances', () => {
  const printed = 'card:printed-vision-mech';
  const f = runtime(
    world().player('A', { energy: 10, power: [] }).player('B', { energy: 0, power: [] })
      .deck(['a-top', 'a-second'], { owner: 'A' })
      .hand('forecaster', {
        cardId: forecaster.canonicalCardId, types: ['unit'], tags: ['Mech'], might: 2, energy: 0, power: [],
      })
      .hand('printed-vision-mech', {
        cardId: printed, types: ['unit'], tags: ['Mech'], controller: 'A', owner: 'A',
        might: 3, energy: null, power: null, keywords: [{ id: 'Vision' }],
      })
      .hand('granted-vision-mech', {
        cardId: 'card:granted-vision-mech', types: ['unit'], tags: ['Mech'], controller: 'A', owner: 'A',
        might: 3, energy: null, power: null,
      })
      .hand('plain-ally', {
        cardId: 'card:plain', types: ['unit'], tags: [], controller: 'A', owner: 'A',
        might: 3, energy: null, power: null,
      })
      .hand('enemy-mech', {
        cardId: 'card:enemy', types: ['unit'], tags: ['Mech'], controller: 'A', owner: 'A',
        might: 3, energy: null, power: null,
      }),
    [forecaster, {
      canonicalCardId: printed, rulesetVersion: 'core-1.5', status: 'executable',
      sourceText: '[RIFT-931 printed Vision host]', abilities: [],
    }],
  );

  assert.equal(f.engine.commit({
    type: 'play', object: f.kernel.ref('forecaster'), player: 'A', location: { type: 'base', player: 'A' },
  }).status, 'done');
  f.settle();
  assert.equal(visionPrompts(f.asked), 1, 'Forecaster grants itself one Vision instance');

  f.enter('printed-vision-mech');
  assert.deepEqual(f.snapshot('printed-vision-mech').keywords.map(keyword => keyword.id), ['Vision']);
  assert.equal(visionPrompts(f.asked), 2,
    'the printed Vision and one Forecaster grant each trigger separately exactly once');

  f.enter('granted-vision-mech');
  assert.equal(visionPrompts(f.asked), 3, 'one granted Vision triggers once, not twice');

  const beforeNonMech = visionPrompts(f.asked);
  f.enter('plain-ally');
  assert.equal(visionPrompts(f.asked), beforeNonMech, 'a non-Mech receives no Vision');
  const beforeOpposingMech = visionPrompts(f.asked);
  f.enter('enemy-mech');
  assert.equal(visionPrompts(f.asked), beforeOpposingMech + 1, 'an opposing Mech receives exactly one grant');
});

test('Gem Jammer Ganking expires with its derived Standard Move permission and pays no expired cost', () => {
  const given = duelWorld();
  const board = given.place(given.board, 'target', 'B', given.bf1);
  const f = runtime(
    world().player('A', { energy: 2, power: [] }).player('B', { energy: 0, power: [] })
      .deck(['a-top', 'a-second'], { owner: 'A' })
      .deck(['b-top', 'b-second'], { owner: 'B' })
      .hand('gem', { cardId: gemJammer.canonicalCardId, types: ['unit'], might: 2, energy: 2, power: [] })
      .unit('target', {
        cardId: 'card:target', types: ['unit'], controller: 'B', owner: 'B', might: 2, energy: null, power: null,
        location: { type: 'base', player: 'B' },
      }),
    [gemJammer],
    { 'target:gem-jammer.unit': ['target'] },
    { turnPhaseLayers: true },
  );
  assert.equal(f.engine.commit({
    type: 'play', object: f.kernel.ref('gem'), player: 'A', location: { type: 'base', player: 'A' },
  }).status, 'done');
  f.settle();

  const active = f.snapshot('target');
  assert.deepEqual(active.keywords.map(keyword => keyword.id), ['Ganking']);
  assert.equal(movement(f.engine.layers.registry, active.ref, active, 'B').canGank, true);
  const moved = moveDuelUnitsStandard(board, readinessFor(board), {
    actor: 'B', unitUIDs: ['target'], destinationLocationId: given.bf2, timing: mainTiming('B'),
  }, {
    registry: f.engine.layers.registry,
    refForUnit: unit => f.kernel.ref(unit.objectId),
    objectForUnit: unit => f.snapshot(unit.objectId),
  });
  assert.equal(moved.board.units.find(unit => unit.objectId === 'target').locationId, given.bf2);

  f.engine.pipeline.emit({ timingPoint: 'turn-end', player: 'A' });
  const ending = f.snapshot('target');
  assert.deepEqual(ending.keywords.map(keyword => keyword.id), ['Ganking'],
    'CR 317.1.a keeps the this-turn grant through the Ending Step');
  assert.equal(movement(f.engine.layers.registry, ending.ref, ending, 'B').canGank, true);
  const movementRules = () => f.engine.layers.registry.lifecycleRuleEffects().filter(entry =>
    entry.effect.effect.kind === 'continuous.movement' && entry.effect.filter.objectId === 'target');
  assert.equal(movementRules().length, 1, 'the Ending Step retains the derived permission');

  assert.ok(f.layers.expireTurn('A').length > 0, 'the Expiration Step removes the grant');
  const expired = f.snapshot('target');
  assert.deepEqual(expired.keywords, []);
  assert.equal(movement(f.engine.layers.registry, expired.ref, expired, 'B').canGank, false);
  assert.equal(movementRules().length, 0);

  const beforeBoard = structuredClone(moved.board);
  const beforeReadiness = readinessFor(moved.board);
  assert.throws(() => moveDuelUnitsStandard(moved.board, beforeReadiness, {
    actor: 'B', unitUIDs: ['target'], destinationLocationId: given.bf1, timing: mainTiming('B'),
  }, {
    registry: f.engine.layers.registry,
    refForUnit: unit => f.kernel.ref(unit.objectId),
    objectForUnit: unit => f.snapshot(unit.objectId),
  }), /needs Ganking/);
  assert.deepEqual(moved.board, beforeBoard, 'the rejected Standard Move has no board side effect');
  assert.deepEqual(readinessFor(moved.board), beforeReadiness, 'the rejected Move pays no Exhaust cost');
});
