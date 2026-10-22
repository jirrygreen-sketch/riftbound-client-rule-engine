// RIFT-931 official evidence (CR v1.5 published 2026-10-09, effective
// 2026-10-16): /root/swarm-rift/shared/rules/CR-v1.5.txt
// - 810.1.c adds Battlefield-to-Battlefield to a Unit's Standard Move; 810.2
//   makes duplicate Ganking instances redundant.
// - 817.2/817.2.a require each Vision instance to trigger separately.
// - 317.1.a invokes end-of-turn effects and 317.2.c expires all "this turn"
//   effects simultaneously in the Expiration Step.
// Production timelines below are Play -> Pending -> Finalize -> Resolve ->
// Board entry/layer query, and granted Ganking -> Standard Move -> turn-end ->
// Standard Move rejection.
import assert from 'node:assert/strict';
import test from 'node:test';

import { AwaitChoice, world } from '../../dist/effects/testing/index.js';
import { ChainEngine } from '../../dist/chain/engine.js';
import { bindResolveContext, createActionPipelineHost } from '../../dist/events/action-adapter.js';
import { movement } from '../../dist/layers/rules/query.js';
import { createProgramBinding } from '../../dist/programs/index.js';
import { moveDuelUnitsStandard } from '../../dist/zones/movement.js';
import { duelWorld, mainTiming, readinessFor } from '../rules/movement/support.mjs';
import forecaster from '../../../card-dsl/dist/cards/sfd/forecaster.js';
import gemJammer from '../../../card-dsl/dist/cards/sfd/gem-jammer.js';

const admitted = program => ({ ...program, status: 'executable', judgeReason: undefined });

function runtime(builder, programs = [], answers = {}) {
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
  const engine = new ChainEngine({
    turnOrder: ['A', 'B'], turnPlayer: 'A', phase: 'main', host, cleanup: () => false,
    describePlay: binding.describePlay,
  });
  binding.attachLifecycle(engine, error => { throw error; });
  const settle = () => {
    for (let guard = 0; engine.items.length; guard++) {
      assert.ok(guard < 40, 'the production chain settles');
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
  return { kernel, engine, binding, asked, settle, enter, snapshot };
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
        cardId: 'card:enemy', types: ['unit'], tags: ['Mech'], controller: 'B', owner: 'B',
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
  f.engine.advance();
  f.settle();
  assert.equal(visionPrompts(f.asked), 1, 'Forecaster grants itself one Vision instance');

  f.enter('printed-vision-mech');
  assert.deepEqual(f.snapshot('printed-vision-mech').keywords.map(keyword => keyword.id), ['Vision']);
  assert.equal(visionPrompts(f.asked), 3,
    'the printed Vision and one Forecaster grant each trigger separately exactly once');

  f.enter('granted-vision-mech');
  assert.equal(visionPrompts(f.asked), 4, 'one granted Vision triggers once, not twice');

  f.enter('plain-ally');
  f.enter('enemy-mech');
  assert.equal(visionPrompts(f.asked), 4, 'non-Mech and opposing Mechs receive no Vision');
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
  );
  assert.equal(f.engine.commit({
    type: 'play', object: f.kernel.ref('gem'), player: 'A', location: { type: 'base', player: 'A' },
  }).status, 'done');
  f.engine.advance();
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

  f.engine.emit({ timingPoint: 'turn-end', player: 'A' });
  const expired = f.snapshot('target');
  assert.deepEqual(expired.keywords, []);
  assert.equal(movement(f.engine.layers.registry, expired.ref, expired, 'B').canGank, false);
  assert.equal(f.engine.layers.registry.lifecycleRuleEffects().filter(entry =>
    entry.effect.effect.kind === 'continuous.movement' && entry.effect.filter.objectId === 'target').length, 0);

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
