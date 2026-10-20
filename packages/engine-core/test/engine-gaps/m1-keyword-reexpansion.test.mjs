// RIFT-881: production lifecycle consumes dynamically granted keywords.
//
// Official evidence (checked 2026-10-20 against CR v1.5, published
// 2026-10-09 and effective 2026-10-16):
// https://cmsassets.rgpub.io/sanity/files/dsfx7636/news_live/5c7946f7c3b8c6e0faff85ab6dadc6d2e721ea94.pdf
// - 478.1-478.4 require layer dependencies and ability grants to be rechecked.
// - 801.3.a grants a keyword according to its definition; 807.1.c/807.1.d,
//   809.1.c/809.1.c.1, 810.1.c, 817.1.b-817.1.c and 437.1/437.3.a define
//   the four consumers exercised below.
// - 355.5/355.7/355.10 distinguish a chosen target from a programmatic set;
//   Gem Jammer's "a unit" is therefore a finalize-time TargetSpec.
// - 369.3 permits an entry-orientation replacement and 143.4 must remain the
//   default when its condition is false.
// Official source snapshots:
// https://playriftbound.com/en-us/news/announcements/core-rules-radiance-patch-notes-effective-october-16-2026/
// https://playriftbound.com/en-us/rules-hub/
import assert from 'node:assert/strict';
import test from 'node:test';

import { AwaitChoice, world } from '../../dist/effects/testing/index.js';
import { ChainEngine } from '../../dist/chain/engine.js';
import { bindResolveContext, createActionPipelineHost } from '../../dist/events/action-adapter.js';
import { movement } from '../../dist/layers/rules/query.js';
import { createProgramBinding } from '../../dist/programs/index.js';
import { boundTargetTaxes } from '../../dist/programs/statics.js';
import { collectTargetTaxes } from '../../dist/target/tax/index.js';
import { moveDuelUnitsStandard } from '../../dist/zones/movement.js';
import { duelWorld, mainTiming, readinessFor } from '../rules/movement/support.mjs';
import forecaster from '../../../card-dsl/dist/cards/sfd/forecaster.js';
import gemJammer from '../../../card-dsl/dist/cards/sfd/gem-jammer.js';
import breakneckMech from '../../../card-dsl/dist/cards/sfd/breakneck-mech.js';
import rumbleHotheaded from '../../../card-dsl/dist/cards/sfd/rumble-hotheaded.js';

const field = id => ({ type: 'battlefield', id });
const admitted = program => ({ ...program, status: 'executable', judgeReason: undefined });

function runtime(builder, programs = [], overrides = {}) {
  const kernel = builder.build();
  const answers = new Map(Object.entries(overrides.answers ?? {}));
  const asked = [];
  const choose = request => {
    asked.push(request);
    if (answers.has(request.id)) {
      const answer = answers.get(request.id);
      return Array.isArray(answer)
        ? answer.map(value => typeof value === 'string' ? kernel.ref(value) : value)
        : answer;
    }
    if (request.type === 'mode') return request.options[0];
    if (request.type === 'optional') return true;
    if (request.type === 'select-objects' && request.min === request.max && request.options.length === request.min) return [...request.options];
    if (request.type === 'select-objects' && request.min === 0) return [];
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
  const binding = createProgramBinding({ cardPrograms: programs.map(admitted) });
  const engine = new ChainEngine({
    turnOrder: ['A', 'B'], turnPlayer: 'A', phase: 'main', host, cleanup: () => false,
    describePlay: binding.describePlay,
  });
  const errors = [];
  const lifecycle = binding.attachLifecycle(engine, error => { errors.push(error); });
  const layers = () => { engine.layers.setObjects(kernel.objects); return engine.layers; };
  const settle = () => {
    engine.advance();
    for (let steps = 0; engine.items.length; steps++) {
      assert.ok(steps < 40, 'the production chain settles');
      engine.pass(engine.priority);
    }
  };
  const enter = id => {
    if (kernel.getObject(id).zone === 'hand') assert.equal(engine.commit({ type: 'move-zone', object: kernel.ref(id), to: 'chain' }).status, 'done');
    return engine.commit({ type: 'move-zone', object: kernel.ref(id), to: 'base', location: { type: 'base', player: kernel.getObject(id).controller } });
  };
  return { kernel, engine, binding, host, errors, asked, answers, lifecycle, layers, settle, enter };
}

function keywordIds(f, id) {
  return f.layers().snapshot(f.kernel.ref(id)).keywords.map(keyword => keyword.id);
}

function assertActionableGrant(f, id) {
  const snapshot = f.layers().snapshot(f.kernel.ref(id));
  assert.equal(movement(f.engine.layers.registry, snapshot.ref, snapshot, snapshot.controller).canGank, true);
}

test('Forecaster: default lifecycle grants Vision to the controller Mechs and executes Predict through the real chain', () => {
  const top = 'top-card';
  const f = runtime(
    world().player('A', { energy: 10, power: [] }).player('B')
      .deck(['top-card', 'second-card'], { owner: 'A' })
      .hand('forecaster', { cardId: forecaster.canonicalCardId, types: ['unit'], tags: ['Mech'], might: 2, energy: 0, power: [] })
      .unit('friendly-mech', { cardId: 'card:not-forecaster', types: ['unit'], tags: ['Mech'], controller: 'A', owner: 'A', might: 3, energy: null, power: null })
      .unit('plain-ally', { cardId: 'card:plain', types: ['unit'], tags: [], controller: 'A', owner: 'A', might: 3, energy: null, power: null })
      .unit('enemy-mech', { cardId: 'card:enemy', types: ['unit'], tags: ['Mech'], controller: 'B', owner: 'B', might: 3, energy: null, power: null }),
    [forecaster],
    { answers: {
      'vision-look%3Akeyword%3Avision%3Acard.hash-cdeb1c4bb2202d43d0f4ccb7c3e0ddfa25caf4f81c41dde5c8bdaa6bbeddfe40%3A0/vision-select%3Akeyword%3Avision%3Acard.hash-cdeb1c4bb2202d43d0f4ccb7c3e0ddfa25caf4f81c41dde5c8bdaa6bbeddfe40%3A0': [top],
      'vision-look%3Akeyword%3Avision%3Acard.hash-cdeb1c4bb2202d43d0f4ccb7c3e0ddfa25caf4f81c41dde5c8bdaa6bbeddfe40%3A1/vision-select%3Akeyword%3Avision%3Acard.hash-cdeb1c4bb2202d43d0f4ccb7c3e0ddfa25caf4f81c41dde5c8bdaa6bbeddfe40%3A1': [top],
    } },
  );
  assert.equal(f.enter('friendly-mech').status, 'done');
  assert.equal(f.enter('plain-ally').status, 'done');
  assert.equal(f.enter('enemy-mech').status, 'done');
  assert.equal(f.engine.commit({ type: 'play', object: f.kernel.ref('forecaster'), player: 'A', location: { type: 'base', player: 'A' } }).status, 'done');
  f.settle();
  assert.equal(f.errors.length, 0);
  assert.deepEqual(keywordIds(f, 'friendly-mech'), ['Vision']);
  assert.deepEqual(keywordIds(f, 'plain-ally'), []);
  assert.deepEqual(keywordIds(f, 'enemy-mech'), []);
  assert.deepEqual(keywordIds(f, 'forecaster'), ['Vision']);
  assert.ok(f.asked.some(request => request.type === 'select-objects'), 'the real Vision trigger performed Predict');
  assert.equal(f.kernel.zone('A', 'deck')[0].id, 'second-card');
});

for (const [otherMech, expectedReady] of [[false, false], [true, true]]) {
  test(`Breakneck Mech: ${otherMech ? 'another Mech enables' : 'no other Mech denies'} the entry-ready replacement`, () => {
    const builder = world().player('A', { energy: 10, power: [] }).player('B')
      .hand('mech', { cardId: breakneckMech.canonicalCardId, types: ['unit'], tags: ['Mech'], might: 2, energy: 2, power: [] });
    if (otherMech) builder.unit('other-mech', { cardId: 'card:other-mech', types: ['unit'], tags: ['Mech'], controller: 'A', owner: 'A', might: 2, energy: null, power: null });
    const f = runtime(builder, [breakneckMech]);
    assert.equal(f.engine.commit({ type: 'play', object: f.kernel.ref('mech'), player: 'A', location: field('bf1') }).status, 'done');
    f.settle();
    assert.deepEqual(f.errors.map(error => error.code), []);
    assert.equal(f.kernel.getObject('mech').zone, 'board');
    assert.equal(f.kernel.getObject('mech').exhausted, !expectedReady);
    assert.deepEqual(keywordIds(f, 'mech'), ['Deflect', 'Ganking']);
    assertActionableGrant(f, 'mech');
    if (otherMech) {
      const taxes = boundTargetTaxes(f.engine);
      assert.equal(taxes.some(tax => tax.target.id === 'mech' && tax.target.zoneEntryId === f.kernel.ref('mech').zoneEntryId), true);
      assert.equal(taxes.some(tax => tax.target.id === 'other-mech'), true, 'every friendly Mech receives the grant');
      assert.equal(taxes.every(tax => tax.effect.value.kind === 'constant' && tax.effect.value.value === 1), true);
      const context = f.host.context(f.kernel.getObject('mech'), 'B', 'chain-item-finalize');
      const collected = collectTargetTaxes(context, f.kernel.getObject('mech'), { kind: 'spell', effects: taxes });
      assert.equal(collected.reduce((sum, tax) => sum + (tax.cost.payments?.reduce((total, payment) => total + (payment.amount?.value ?? 0), 0) ?? 0), 0), 1);
      assert.equal(collectTargetTaxes(f.host.context(f.kernel.getObject('mech'), 'A', 'chain-item-finalize'), f.kernel.getObject('mech'), { kind: 'spell', effects: taxes }).length, 0, 'a controller targeting its own Mech does not pay Deflect');
    }
  });
}

for (const role of ['attacker', undefined, 'defender']) {
  test(`Rumble, Hotheaded: default lifecycle re-expands Assault for ${role ?? 'no combat role'}`, () => {
    const builder = world().player('A').player('B')
      .unit('rumble', { cardId: rumbleHotheaded.canonicalCardId, types: ['unit'], tags: ['Mech'], controller: 'A', owner: 'A', might: 3, combatRole: role, energy: null, power: null });
    const f = runtime(builder, [rumbleHotheaded]);
    assert.equal(f.enter('rumble').status, 'done');
    if (role !== undefined) {
      const current = f.kernel.getObject('rumble');
      const designated = { ...current, combatRole: role };
      const registration = f.engine.layers.registry.list().find(entry => entry.effect.id.startsWith('program-keyword:'));
      const conditioned = registration?.effect.effect.condition;
      assert.equal(typeof conditioned, 'function');
      assert.equal(conditioned(designated), role === 'attacker', 'Assault condition reads the current designation');
    }
    assert.deepEqual(f.errors.map(error => error.code), []);
    assert.deepEqual(keywordIds(f, 'rumble'), ['Assault']);
    assert.equal(f.layers().snapshot(f.kernel.ref('rumble')).might, 3);
    assert.equal(f.engine.pipeline.checkpoint().triggers.size, 1, 'the conquer trigger is registered by the keyword lifecycle path');
  });
}

test('Gem Jammer: the production trigger grants actionable Ganking until the turn ends', () => {
  const given = duelWorld();
  const board = given.place(given.board, 'target', 'B', given.bf1);
  const f = runtime(
    world().player('A', { energy: 20, power: [] }).player('B')
      .hand('gem', { cardId: gemJammer.canonicalCardId, types: ['unit'], might: 2, energy: 2, power: [] })
      .unit('target', { cardId: 'card:target', types: ['unit'], controller: 'B', owner: 'B', might: 2, energy: null, power: null, location: { type: 'battlefield', id: given.bf1 } }),
    [gemJammer],
    { answers: { 'target:gem-jammer.unit': ['target'] } },
  );
  assert.equal(f.engine.commit({ type: 'play', object: f.kernel.ref('gem'), player: 'A', location: { type: 'battlefield', id: given.bf1 } }).status, 'done');
  f.settle();
  assert.equal(f.errors.length, 0);
  assert.deepEqual(keywordIds(f, 'target'), ['Ganking']);
  assertActionableGrant(f, 'target');
  const moved = moveDuelUnitsStandard(board, readinessFor(board), {
    actor: 'B', unitUIDs: ['target'], destinationLocationId: given.bf2, timing: mainTiming('B'),
  }, {
    registry: f.engine.layers.registry,
    refForUnit: unit => f.kernel.ref(unit.objectId),
    objectForUnit: unit => f.layers().snapshot(f.kernel.ref(unit.objectId)),
  });
  assert.equal(moved.board.units[0].locationId, given.bf2);
  f.engine.emit({ timingPoint: 'turn-end', player: 'A' });
  assert.deepEqual(keywordIds(f, 'target'), []);
});
