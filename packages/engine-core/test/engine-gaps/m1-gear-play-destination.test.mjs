import assert from 'node:assert/strict';
import test from 'node:test';

import { AwaitChoice } from '../../dist/effects/contract.js';
import { world } from '../../dist/effects/testing/index.js';
import { bindResolveContext, createActionPipelineHost } from '../../dist/events/action-adapter.js';
import { createProgramBinding } from '../../dist/programs/index.js';
import { TurnFlow } from '../../dist/turn/flow.js';

const FIELD = { type: 'battlefield', id: 'field' };
const OTHER_FIELD = { type: 'battlefield', id: 'other-field' };

function playProgram(canonicalCardId, sourceText = canonicalCardId, abilities = []) {
  return {
    canonicalCardId,
    rulesetVersion: 'core-1.5',
    status: 'executable',
    sourceText,
    abilities: [{ kind: 'play', cost: { kind: 'printed' }, body: [] }, ...abilities],
  };
}

function scenario({ programs, setup, fieldController = null }) {
  const binding = createProgramBinding({ cardPrograms: programs });
  const builder = world()
    .player('A', { energy: 10 })
    .player('B', { energy: 10 })
    .battlefield('field', { controller: null, location: FIELD })
    .battlefield('other-field', { controller: null, location: OTHER_FIELD })
    .deck(['A:deck:1', 'A:deck:2'], { owner: 'A' })
    .deck(['B:deck:1', 'B:deck:2'], { owner: 'B' })
    .rune(['A:rune:1', 'A:rune:2'], { owner: 'A' })
    .rune(['B:rune:1', 'B:rune:2'], { owner: 'B' });
  setup?.(builder);
  const kernel = builder.build();
  const choose = request => {
    if (request.type === 'mode' && request.id.startsWith('engagement:')) return request.options[0];
    throw new AwaitChoice(request);
  };
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: saved => { kernel.restore(saved.state); kernel.copyLinkedFrom(saved.links); },
    objects: () => kernel.objects,
    perform: action => kernel.perform(action),
    choose,
    context: (source, controller, timingPoint) => bindResolveContext(kernel, {
      source, controller, timingPoint, choose,
    }),
    testTrigger: registration => kernel.test(registration.spec.condition),
  });
  const flow = new TurnFlow({
    host,
    player: id => kernel.player(id),
    turnOrder: ['A', 'B'],
    battlefields: [
      { id: 'field', controller: fieldController },
      { id: 'other-field', controller: null },
    ],
    describePlay: binding.describePlay,
  });
  const errors = [];
  const lifecycle = binding.attachLifecycle(flow.chain, error => errors.push(error));
  flow.chain.initializeBattlefieldControl(flow.battlefields.map(field => ({
    id: field.id,
    controller: field.controller,
  })));
  flow.start();
  // Both Battlefields begin uncontested. Resolve each staged Showdown through
  // the real two-player pass sequence before exercising the Main Phase action.
  for (let guard = 0; flow.phase !== 'main'; guard++) {
    if (guard > 8) throw new Error('TurnFlow did not reach Main Phase');
    if (flow.chain.turnState.startsWith('showdown')) {
      const focus = flow.chain.focus;
      if (focus !== null) flow.chain.pass(focus);
    }
    flow.advance();
  }
  assert.equal(flow.chain.commit({ type: 'gain-energy', player: 'A', amount: 10 }).status, 'done');
  return { binding, errors, flow, kernel, lifecycle };
}

function play(f, id, location) {
  const source = f.kernel.getObject(id);
  const action = { type: 'play', player: 'A', object: source.ref, ...(location === undefined ? {} : { location }) };
  return f.flow.execute(f.binding.describePlay(action, source));
}

function settle(flow) {
  let guard = 0;
  while (flow.chain.items.length) {
    if (++guard > 50) throw new Error('Nonterminating test chain');
    const priority = flow.chain.priority;
    if (priority === null) throw new Error('Pending Chain item has no Priority holder');
    flow.chain.pass(priority);
  }
}

function assertRejectedAtomically(f, id, location) {
  const before = f.kernel.getObject(id);
  const energy = f.kernel.player('A').energy;
  assert.throws(() => play(f, id, location), /Play destination is not legally allowed/);
  assert.deepEqual(f.kernel.getObject(id), before);
  assert.equal(f.kernel.player('A').energy, energy);
  assert.equal(f.flow.chain.items.length, 0);
  assert.equal(f.flow.chain.pipeline.events.some(event => event.timingPoint === 'card-played'), false);
}

test('RIFT-1068 Non-Unit Gear cannot enter its controller Battlefield without an effect', () => {
  const f = scenario({
    programs: [playProgram('gear-own-field')],
    fieldController: 'A',
    setup: b => b.hand('gear', { cardId: 'gear-own-field', types: ['gear'], energy: 1, power: [] }),
  });
  assert.equal(f.flow.battlefields.find(field => field.id === 'field').controller, 'A');
  assertRejectedAtomically(f, 'gear', FIELD);
  f.lifecycle.detach();
});

test('RIFT-1068 Non-Unit Gear still enters its controller Base', () => {
  const f = scenario({
    programs: [playProgram('gear-base')],
    fieldController: 'A',
    setup: b => b.hand('gear', { cardId: 'gear-base', types: ['gear'], energy: 1, power: [] }),
  });
  play(f, 'gear', { type: 'base', player: 'A' });
  settle(f.flow);
  assert.deepEqual(f.kernel.getObject('gear').location, { type: 'base', player: 'A' });
  assert.equal(f.kernel.getObject('gear').zone, 'board');
  f.lifecycle.detach();
});

test('RIFT-1068 Deploy still permits Non-Unit Gear to enter a Battlefield', () => {
  const f = scenario({
    programs: [playProgram('gear-deploy', '[Deploy]')],
    fieldController: 'A',
    setup: b => b.hand('gear', {
      cardId: 'gear-deploy', types: ['gear'], keywords: [{ id: 'Deploy' }], energy: 1, power: [],
    }),
  });
  play(f, 'gear', FIELD);
  settle(f.flow);
  assert.deepEqual(f.kernel.getObject('gear').location, FIELD);
  assert.equal(f.kernel.getObject('gear').zone, 'board');
  f.lifecycle.detach();
});

test('RIFT-1068 Unit+Gear retains the Unit Battlefield destination rule', () => {
  const f = scenario({
    programs: [playProgram('unit-gear')],
    fieldController: 'A',
    setup: b => b.hand('unit-gear', {
      cardId: 'unit-gear', types: ['unit', 'gear'], energy: 1, power: [],
    }),
  });
  play(f, 'unit-gear', FIELD);
  settle(f.flow);
  assert.deepEqual(f.kernel.getObject('unit-gear').location, FIELD);
  assert.equal(f.kernel.getObject('unit-gear').zone, 'board');
  f.lifecycle.detach();
});
