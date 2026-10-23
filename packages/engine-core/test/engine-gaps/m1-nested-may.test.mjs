// RIFT-970: an outer leading may belongs to Finalize while a later may belongs
// to Resolve (CR v1.5 383.3.a and 383.3.a.3). These tests use the production
// ProgramBinding, ChainEngine/TurnFlow, event scan, target planner, interpreter
// and lifecycle; assertions read committed actions and final authoritative state.
import assert from 'node:assert/strict';
import test from 'node:test';

import veiledTemple from '../../../card-dsl/dist/cards/sfd/veiled-temple.js';
import { AwaitChoice } from '../../dist/effects/contract.js';
import { world } from '../../dist/effects/testing/index.js';
import { bindResolveContext, createActionPipelineHost } from '../../dist/events/action-adapter.js';
import { createProgramBinding, ProgramBindingError } from '../../dist/programs/index.js';
import { triggerRegistrations } from '../../dist/programs/triggers.js';
import { queryPickCandidates } from '../../dist/target/picks/plan.js';
import { TurnFlow } from '../../dist/turn/flow.js';

const field = id => ({ type: 'battlefield', id });
const constant = value => ({ kind: 'constant', value });
const CANONICAL = veiledTemple.canonicalCardId;
const RULES = Object.freeze({
  url: 'https://cmsassets.rgpub.io/sanity/files/dsfx7636/news_live/5c7946f7c3b8c6e0faff85ab6dadc6d2e721ea94.pdf',
  version: '1.5',
  published: '2026-10-09',
  effective: '2026-10-16',
  clauses: ['355.12', '383.3.a', '383.3.a.3', '416.1.c', '436.1', '436.3'],
});

function liveProgram() {
  const program = structuredClone(veiledTemple);
  program.status = 'executable';
  delete program.judgeReason;
  const [outerMay] = program.abilities[0].body;
  const [, detachMay] = outerMay.args.body.value;
  const [detach] = detachMay.args.body.value;
  // The card task owns this final edit. The engine already accepts the existing
  // target selector vocabulary; a linked-state receipt cannot represent "it"
  // when 416.1.c makes readying an already-ready gear a no-op.
  detach.picks = [{
    id: 'veiled-temple.detached-gear',
    options: [{ kind: 'target', id: 'veiled-temple.gear' }],
    // The existing filter field revalidates the locked target's current
    // incarnation without widening the source to a global board query.
    filter: { type: 'gear', zone: 'board' },
    min: 1,
    max: 1,
    selection: 'one',
  }];
  return program;
}

function runtime({ outer = true, inner = true, exhausted = true } = {}) {
  const program = liveProgram();
  const builder = world()
    .player('A')
    .player('B')
    .battlefield('temple', {
      cardId: CANONICAL,
      types: ['battlefield'],
      controller: null,
      owner: 'A',
      isToken: true,
      zone: 'board',
      location: field('bf1'),
      energy: null,
      power: null,
      might: null,
    })
    .base('mover', {
      owner: 'A',
      controller: 'A',
      might: 3,
      exhausted: false,
      location: { type: 'base', player: 'A' },
    })
    .unit('host', {
      owner: 'A',
      controller: 'A',
      types: ['unit'],
      location: { type: 'base', player: 'A' },
    })
    .unit('gear', {
      owner: 'A',
      controller: 'A',
      types: ['gear'],
      tags: ['Equipment'],
      zone: 'board',
      location: { type: 'base', player: 'A' },
      energy: null,
      power: null,
      might: null,
      exhausted,
      attachedTo: { id: 'host', zoneEntryId: 1 },
    });
  for (const player of ['A', 'B']) {
    builder.deck(Array.from({ length: 8 }, (_, index) => `${player}:deck:${index}`), { owner: player });
    builder.rune(Array.from({ length: 8 }, (_, index) => `${player}:rune:${index}`), { owner: player });
  }
  const kernel = builder.build();
  const requests = [];
  let outerSeen = false;
  let innerSeen = false;
  const choose = request => {
    requests.push(structuredClone(request));
    if (request.type === 'optional' && !outerSeen) {
      outerSeen = true;
      return outer;
    }
    if (request.type === 'optional') {
      innerSeen = true;
      return inner;
    }
    if (request.type === 'select-objects' && request.id === 'target:veiled-temple.gear') {
      return request.options.filter(ref => ref.id === 'gear');
    }
    if (request.type === 'select-objects' && request.id.includes(':pick:veiled-temple.detached-gear')) {
      return request.options.filter(ref => ref.id === 'gear');
    }
    if (request.type === 'mode' && request.id.includes(':order:')) return request.options[0];
    if (request.type === 'select-objects' && request.min === request.max && request.options.length === request.min) return [...request.options];
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
    testTrigger: registration => kernel.test(registration.spec.condition),
  });
  const binding = createProgramBinding({ cardPrograms: [program] });
  const flow = new TurnFlow({
    host,
    player: id => kernel.player(id),
    turnOrder: ['A', 'B'],
    battlefields: [{ id: 'bf1', controller: null }, { id: 'bf2', controller: null }],
    describePlay: binding.describePlay,
  });
  const lifecycle = binding.attachLifecycle(flow.chain, error => { throw error; });
  flow.start();
  return { kernel, flow, binding, lifecycle, requests, program, seen: () => ({ outerSeen, innerSeen }) };
}

function conquerAtTemple(f) {
  f.flow.execute({
    id: 'nested-may-conquer',
    controller: 'A',
    source: f.kernel.getObject('mover'),
    kind: 'activated',
    speed: 'normal',
    body: [{
      id: 'move-to-temple',
      op: 'effect.move',
      args: { to: constant(field('bf1')) },
    }],
  });
}

function settle(f) {
  for (let guard = 0; guard < 80; guard++) {
    if (f.flow.chain.items.length) {
      if (f.flow.chain.priority !== null) {
        f.flow.pass(f.flow.chain.priority);
        continue;
      }
      f.flow.advance();
      continue;
    }
    if (f.flow.chain.focus !== null) {
      f.flow.pass(f.flow.chain.focus);
      continue;
    }
    return;
  }
  throw new Error('nested-may production flow did not settle');
}

test('RIFT-970 binds only the outer leading may to Finalize and exports its target', () => {
  const f = runtime();
  const [registration] = triggerRegistrations(f.binding.registry, f.kernel.getObject('temple'));
  assert.equal(registration.mayAtFinalize, true);
  assert.deepEqual(registration.targets?.map(entry => entry.requirement.id), ['veiled-temple.gear']);
  assert.equal(registration.body.some(instruction => instruction.op === 'choice.optional'), true,
    'the later may remains in the Resolve body');
  assert.equal(registration.body[0].op, 'effect.ready');
  assert.equal(registration.body[1].op, 'choice.optional');
  assert.equal(registration.body[1]['__riftbound.resolve-optional'], true);
  assert.equal(registration.body[1].targets, undefined);
  f.lifecycle.detach();
});

test('RIFT-970 declining the outer Finalize may removes the ability before targets or Resolve', () => {
  assert.deepEqual(RULES.clauses, ['355.12', '383.3.a', '383.3.a.3', '416.1.c', '436.1', '436.3']);
  const f = runtime({ outer: false });
  conquerAtTemple(f);
  settle(f);
  assert.deepEqual(f.requests.map(request => request.id), ['finalize:trigger:1:optional']);
  assert.deepEqual(f.kernel.getObject('gear').attachedTo, f.kernel.ref('host'));
  assert.deepEqual(f.seen(), { outerSeen: true, innerSeen: false });
  assert.equal(f.flow.chain.items.length, 0);
  f.lifecycle.detach();
});

test('RIFT-970 accepts the outer may and asks the later may only during Resolve', () => {
  const f = runtime({ inner: false });
  conquerAtTemple(f);
  settle(f);
  const optionalIds = f.requests.filter(request => request.type === 'optional').map(request => request.id);
  assert.equal(optionalIds.length, 2);
  assert.match(optionalIds[0], /^finalize:/);
  assert.equal(optionalIds[1], 'veiled-temple.detach-opt/optional');
  assert.equal(f.requests.some(request => request.id === 'target:veiled-temple.gear'), true);
  assert.equal(f.kernel.getObject('gear').exhausted, false);
  assert.deepEqual(f.kernel.getObject('gear').attachedTo, f.kernel.ref('host'));
  assert.ok(f.flow.chain.trace.some(entry => entry.step === 'targets-finalized' && entry.item === 'trigger:1'));
  f.lifecycle.detach();
});

test('RIFT-970 accepting both may clauses resolves detach from the locked Finalize target', () => {
  const f = runtime({ inner: true, exhausted: true });
  conquerAtTemple(f);
  settle(f);
  assert.equal(f.kernel.getObject('gear').exhausted, false);
  assert.deepEqual(f.seen(), { outerSeen: true, innerSeen: true });
  assert.equal(f.kernel.getObject('gear').attachedTo, null,
    'the target-backed pick carries the locked gear into effect.detach');
  f.lifecycle.detach();
});

test('RIFT-970 an already-ready Equipment keeps the locked "it" available to detach', () => {
  const f = runtime({ inner: true, exhausted: false });
  conquerAtTemple(f);
  settle(f);
  assert.equal(f.requests.some(request => request.id === 'target:veiled-temple.gear'), true);
  assert.deepEqual(f.seen(), { outerSeen: true, innerSeen: true });
  assert.equal(f.kernel.getObject('gear').exhausted, false);
  assert.equal(f.kernel.getObject('gear').attachedTo, null);
  const target = f.requests.find(request => request.id === 'target:veiled-temple.gear');
  assert.deepEqual(target.options, [f.kernel.ref('gear')], 'the outer may locked the exact gear');
  f.lifecycle.detach();
});

test('RIFT-970 fails closed when a target-backed pick has no locked target', () => {
  const kernel = world().player('A').player('B').base('source').build();
  const context = bindResolveContext(kernel, { source: kernel.getObject('source'), controller: 'A' });
  const spec = { id: 'target-backed', options: [{ kind: 'target', id: 'locked-target' }], min: 1, max: 1, selection: 'one' };
  assert.throws(() => queryPickCandidates(context, spec), error =>
    error instanceof Error && error.code === 'missing-source' && /target is unavailable/.test(error.message));
});

export { CANONICAL, RULES };
