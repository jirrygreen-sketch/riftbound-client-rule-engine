// RIFT-1173 production regression.
// Card evidence: Gem Jammer (sfd-007-221), "When you play me, give a unit
// [Ganking] this turn." "A unit" includes Gem Jammer itself.
// Core Rules v1.5, published 2026-10-09 and effective 2026-10-16:
// https://cmsassets.rgpub.io/sanity/files/dsfx7636/news_live/5c7946f7c3b8c6e0faff85ab6dadc6d2e721ea94.pdf
// - 144.2-144.4: exhausting a Unit is the Standard Move cost; 144.4.c.1
//   permits a Ganking Unit to use that Standard Move from Battlefield to
//   Battlefield.
// - 810.1-810.3: Ganking adds a Standard Move permission, grants no extra
//   movement, stacks redundantly, and is a readable Unit characteristic.
// - 317.1.a and 317.2.c: the this-turn grant survives the Ending Step and
//   expires with all other "this turn" effects in the Expiration Step.
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
import gemJammer from '../../../card-dsl/dist/cards/sfd/gem-jammer.js';

const admitted = program => ({ ...program, status: 'executable', judgeReason: undefined });

function harness(builder, answer) {
  const kernel = builder.build();
  const asked = [];
  const choose = request => {
    asked.push(request);
    if (request.id === 'target:gem-jammer.unit') {
      return [kernel.ref(answer)];
    }
    if (request.type === 'optional') return true;
    if (request.type === 'mode') return request.options[0];
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
    context: (source, controller, timingPoint) => bindResolveContext(kernel, {
      source, controller, timingPoint, choose,
    }),
  });
  const binding = createProgramBinding({ cardPrograms: [admitted(gemJammer)] });
  const turnLayers = new TurnPhaseLayers(kernel.objects);
  const engine = new ChainEngine({
    turnOrder: ['A', 'B'], turnPlayer: 'A', phase: 'main', host, layers: turnLayers, cleanup: () => false,
    describePlay: binding.describePlay,
  });
  binding.attachLifecycle(engine, error => { throw error; });
  const settle = () => {
    engine.advance();
    for (let guard = 0; engine.items.length; guard++) {
      assert.ok(guard < 40, 'the production Chain settles');
      engine.pass(engine.priority);
    }
  };
  const snapshot = id => {
    engine.layers.setObjects(kernel.objects);
    return engine.layers.evaluate(kernel.ref(id));
  };
  const playGem = () => {
    assert.equal(engine.commit({
      type: 'play', object: kernel.ref('gem'), player: 'A', location: { type: 'base', player: 'A' },
    }).status, 'done');
    settle();
  };
  return { kernel, engine, turnLayers, asked, settle, snapshot, playGem };
}

function builderWithGem() {
  return world().player('A', { energy: 2, power: [] }).player('B', { energy: 0, power: [] })
    .hand('gem', {
      cardId: gemJammer.canonicalCardId, types: ['unit'], might: 2, energy: 2, power: [],
    });
}

for (const target of ['gem', 'other']) {
  test(`Gem Jammer grants Ganking to ${target === 'gem' ? 'itself' : 'another unit'} and unlocks Battlefield to Battlefield`, () => {
    const given = duelWorld();
    const builder = builderWithGem().unit('other', {
      cardId: 'card:other-unit', types: ['unit'], controller: 'A', owner: 'A',
      might: 2, energy: null, power: null, location: { type: 'battlefield', id: given.bf1 },
    });
    const f = harness(builder, target);
    f.playGem();

    const effective = f.snapshot(target);
    assert.deepEqual(effective.keywords.map(keyword => keyword.id), ['Ganking']);
    assert.equal(movement(f.engine.layers.registry, effective.ref, effective, 'A').canGank, true);

    const board = target === 'gem'
      ? given.place(given.board, 'gem', 'A', given.bf1)
      : given.place(given.board, 'other', 'A', given.bf1);
    const moved = moveDuelUnitsStandard(board, readinessFor(board, { ganking: [target] }), {
      actor: 'A', unitUIDs: [target], destinationLocationId: given.bf2, timing: mainTiming('A'),
    }, {
      registry: f.engine.layers.registry,
      refForUnit: unit => f.kernel.ref(unit.objectId),
      objectForUnit: unit => f.snapshot(unit.objectId),
    });
    assert.equal(moved.board.units.find(unit => unit.objectId === target).locationId, given.bf2);
    assert.deepEqual(moved.readiness, [{
      objectId: target, readied: false, hasGanking: true,
    }], 'CR 144.2 Standard Move exhaust cost; Ganking grants no extra movement (810.1.c.3)');
  });
}

test('Gem Jammer Ganking expires after the current turn', () => {
  const f = harness(builderWithGem(), 'gem');
  f.playGem();
  const granted = f.snapshot('gem');
  assert.deepEqual(granted.keywords.map(keyword => keyword.id), ['Ganking']);
  f.engine.pipeline.emit({ timingPoint: 'turn-end', player: 'A' });
  assert.ok(f.turnLayers.expireTurn('A').length > 0, 'the Expiration Step removes the grant');
  const nextTurn = f.snapshot('gem');
  assert.deepEqual(nextTurn.keywords, []);
  assert.equal(movement(f.engine.layers.registry, nextTurn.ref, nextTurn, 'A').canGank, false);
});
