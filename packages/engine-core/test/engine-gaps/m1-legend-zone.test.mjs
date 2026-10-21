// RIFT-891: Champion Legends are established in the public Legend Zone and
// their Passive/Triggered/Activated abilities live from that zone (CR v1.5
// 107.4.c, 111, 112, 174.2.b, 174.6-174.8). The production setup path creates
// the object through createMatch, then MatchCommandAdapter installs the normal
// program lifecycle over the authoritative ChainEngine.
//
// Official source: Core Rules v1.5 (updated 2026-10-09), effective under the
// 2026-10-16 Radiance policy:
// https://cmsassets.rgpub.io/sanity/files/dsfx7636/news_live/5c7946f7c3b8c6e0faff85ab6dadc6d2e721ea94.pdf
// Timeline: setup creates a Champion Legend in `legend` (CR 111, 174.2.b) ->
// lifecycle installs its exact-incarnation static/triggered surface -> layer
// evaluation grants Shield only to controlled Mech Units -> Grand Duelist binds
// its might-changed trigger in `legend` -> a real zone departure unbinds. The
// public Legend Zone is identity-visible in all projection views (CR 107.4.c,
// 108.3.e, 355.10.a.1). Canonical IDs:
// Mechanized Menace card.hash-fadaa09c681d3d967954f99504cd9d3d749242dc99dbc40d60adfa60bf53cca7
// Grand Duelist    card.hash-ccfc067dad8a1bf92c6ae1aa5f7110e9d211a1842a9254bb9320705c2f96c6c4
import assert from 'node:assert/strict';
import test from 'node:test';

import grandDuelist from '../../../card-dsl/dist/cards/sfd/grand-duelist.js';
import mechanizedMenace from '../../../card-dsl/dist/cards/sfd/mechanized-menace.js';
import { ChainEngine } from '../../dist/chain/engine.js';
import { world } from '../../dist/effects/testing/test-kernel.js';
import { bindResolveContext, createActionPipelineHost } from '../../dist/events/action-adapter.js';
import { createMatch } from '../../dist/game/lifecycle.js';
import { createMatchCommandAdapter } from '../../dist/game/command-adapter.js';
import { projectFor } from '../../dist/projection/v2/index.js';
import { createProgramBinding } from '../../dist/programs/index.js';
import { normalizeLegacyEventTrigger } from '../../dist/programs/lifecycle.js';
import { queryTargetCandidates } from '../../dist/target/target-plan.js';

const MECHANIZED_MENACE = mechanizedMenace.canonicalCardId;
const GRAND_DUELIST = grandDuelist.canonicalCardId;

// RIFT-889 retained the real case-sensitive Mech tag and marked the program
// judge-required only because this Legend lifecycle did not exist yet. The
// card-dsl source remains outside this task's write scope, so this test uses
// the admitted view of that same program while production ownership restores
// its status after integration.
const executableMechanizedMenace = {
  ...mechanizedMenace,
  status: 'executable',
  judgeReason: undefined,
};

function card(id, options = {}) {
  return {
    id,
    cardId: options.canonicalCardId ?? id,
    canonicalCardId: options.canonicalCardId ?? id,
    types: options.types ?? ['unit'],
    ...options,
  };
}

function deck(legendId) {
  return {
    mainDeck: Array.from({ length: 16 }, (_, index) => card(`main:${legendId}:${index}`, {
      canonicalCardId: `main:${legendId}:${index}`,
      cardType: 'Unit', types: ['unit'], energy: 1, power: [], might: 1,
    })),
    runeDeck: Array.from({ length: 4 }, (_, index) => card(`rune:${legendId}:${index}`, {
      canonicalCardId: `rune:${legendId}:${index}`,
      cardType: 'Rune', types: ['rune'], energy: null, power: null, might: null,
    })),
    championLegend: card(`legend:${legendId}`, {
      canonicalCardId: legendId, cardId: legendId,
      cardType: 'Legend', types: ['legend'], name: legendId,
      energy: null, power: null, might: null,
    }),
    chosenChampion: card(`champion:${legendId}`, {
      canonicalCardId: `champion:${legendId}`,
      cardType: 'Champion', types: ['champion'], energy: null, power: null, might: null,
    }),
    battlefields: [0, 1, 2].map(index => card(`battlefield:${legendId}:${index}`, {
      canonicalCardId: `battlefield:${legendId}:${index}`,
      cardType: 'Battlefield', types: ['battlefield'], energy: null, power: null, might: null,
    })),
  };
}

function makeHost(builder) {
  const kernel = builder.build();
  let pipeline;
  let adapterDefaultChoose;
  const choose = request => {
    if (pipeline !== undefined && pipeline.choose !== adapterDefaultChoose) return pipeline.choose(request);
    throw new Error(`Unexpected setup choice ${request.id}`);
  };
  pipeline = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: saved => {
      kernel.restore(saved.state);
      kernel.copyLinkedFrom(saved.links);
    },
    objects: () => kernel.objects,
    perform: action => kernel.perform(action),
    performContract: action => kernel.performContract(action),
    performBatchLeaf: (action, batchId) => kernel.performBatchLeafForCapability(action, batchId),
    choose,
    context: (source, controller, timingPoint) => bindResolveContext(kernel, {
      source, controller, timingPoint, choose,
    }),
    testTrigger: registration => kernel.test(registration.spec.condition),
  });
  adapterDefaultChoose = pipeline.choose;
  pipeline.player = id => kernel.player(id);
  return { kernel, host: pipeline };
}

function makeMatch(legendProgram, setup) {
  const builder = world().player('A').player('B');
  setup?.(builder);
  // Seat B has no registered program. Keeping that object unbacked is the
  // production no-effect case, not a synthetic lifecycle closure.
  const genericLegend = card('generic-legend', {
    canonicalCardId: 'trained:generic-legend', cardId: 'trained:generic-legend',
    cardType: 'Legend', types: ['legend'], name: 'Trained Generic Legend',
    energy: null, power: null, might: null,
  });
  assert.equal(genericLegend.canonicalCardId, 'trained:generic-legend');
  const secondDeck = deck('trained:generic-legend');
  secondDeck.championLegend = genericLegend;
  const registry = new Map([
    [mechanizedMenace.canonicalCardId, executableMechanizedMenace],
    [grandDuelist.canonicalCardId, grandDuelist],
  ]);
  registry.set(legendProgram.canonicalCardId, legendProgram);
  const made = makeHost(builder);
  const match = createMatch({
    decks: [deck(legendProgram.canonicalCardId), secondDeck],
    programs: { programs: registry },
    host: made.host,
    seed: `rift-891:${legendProgram.canonicalCardId}`,
    battlefieldChoice: [0, 0],
    mulligans: [[], []],
    firstPlayer: 0,
  });
  return { ...made, match };
}

function legendObject(kernel, cardId) {
  const found = kernel.objects.find(object => object.cardId === cardId && object.types.includes('legend'));
  assert.ok(found, `Legend ${cardId} exists`);
  return found;
}

function layerKeywords(match, kernel, id) {
  match.flow.chain.layers.setObjects(kernel.objects);
  return match.flow.chain.layers.evaluate(kernel.ref(id)).keywords;
}

test('RIFT-891 createMatch establishes the Champion Legend in legend and the real Mechanized Menace shape grants Shield only to friendly Mechs', () => {
  const made = makeMatch(executableMechanizedMenace, builder => {
    builder.unit('friendly-mech', { controller: 'A', tags: ['Mech'], might: 3 })
      .unit('friendly-plain', { controller: 'A', tags: [], might: 3 })
      .unit('enemy-mech', { owner: 'B', controller: 'B', tags: ['Mech'], might: 3 });
  });
  const { kernel, match } = made;
  const legend = legendObject(kernel, MECHANIZED_MENACE);

  assert.equal(legend.owner, 'A');
  assert.equal(legend.controller, 'A');
  assert.equal(legend.zone, 'legend');
  assert.deepEqual(kernel.objectsInZone('A', 'legend').map(ref => ref.id), [legend.ref.id]);
  assert.equal(kernel.objects.some(object => object.ref.id === legend.ref.id && object.zone === 'board'), false);

  const adapter = createMatchCommandAdapter({ match, stateVersion: 0 });
  try {
    assert.ok(layerKeywords(match, kernel, 'friendly-mech').some(keyword =>
      keyword.id.toLowerCase() === 'shield' && keyword.value === 1));
    assert.ok(layerKeywords(match, kernel, 'friendly-plain').every(keyword => keyword.id.toLowerCase() !== 'shield'));
    assert.ok(layerKeywords(match, kernel, 'enemy-mech').every(keyword => keyword.id.toLowerCase() !== 'shield'));
    assert.equal(layerKeywords(match, kernel, legend.ref.id).some(keyword => keyword.id.toLowerCase() === 'shield'), false,
      'the Legend is not a Unit and does not grant Shield to itself');
  } finally {
    adapter.detach();
  }
});

test('RIFT-891 Legend Zone identity is public to both seats, spectator and replay', () => {
  const { kernel, match } = makeMatch(executableMechanizedMenace);
  const legend = legendObject(kernel, MECHANIZED_MENACE);
  const players = ['A', 'B'].map(id => ({
    ...kernel.player(id),
    id,
    name: id,
    ...Object.fromEntries(['chain', 'legend'].map(zone => [
      zone,
      kernel.objectsInZone(id, zone).map(ref => kernel.getObject(ref.id)),
    ])),
  }));
  const state = {
    players,
    objects: kernel.objects.map(object => ({ ...object, id: object.ref.id })),
    chain: match.flow.chain.items,
  };
  for (const viewer of ['A', 'B', 'spectator', 'replay']) {
    const zone = projectFor(state, viewer).players.A.legendZone;
    assert.equal(zone.count, 1, `${viewer} sees the public Legend Zone entry`);
    assert.equal(zone.cards[0]?.id, legend.ref.id, `${viewer} sees the Legend identity`);
    assert.equal(zone.cards[0]?.visibility, 'identity');
  }
});

test('RIFT-891 Grand Duelist trigger binds against its exact Legend-zone incarnation', () => {
  const { kernel, match } = makeMatch(grandDuelist);
  const legend = legendObject(kernel, GRAND_DUELIST);
  assert.equal(legend.zone, 'legend');

  const adapter = createMatchCommandAdapter({ match, stateVersion: 0 });
  try {
    const registration = match.flow.chain.pipeline.registeredTriggers().find(candidate =>
      candidate.source.ref.id === legend.ref.id && candidate.spec.at === 'might-changed');
    assert.ok(registration, 'Grand Duelist registered its might-changed trigger');
    assert.deepEqual(registration.source.ref, legend.ref);
    assert.equal(registration.source.zone, 'legend');
    assert.deepEqual(registration.activeZones, ['legend']);
    assert.deepEqual(registration.spec.filter, {
      event: 'might-changed',
      object: { type: 'unit', controller: 'self' },
      details: { becomesMighty: true },
    });
  } finally {
    adapter.detach();
  }
});

test('RIFT-891 legacy becameMighty normalization preserves the source and typed event predicate', () => {
  const [sourceAbility] = grandDuelist.abilities;
  const normalized = normalizeLegacyEventTrigger(sourceAbility);
  assert.deepEqual(normalized.trigger.filter, {
    event: 'might-changed',
    filter: { type: 'unit', controller: 'controller' },
    details: { becomesMighty: true },
  });
  assert.deepEqual(normalized.body, sourceAbility.body);
  assert.equal(normalized.optional, sourceAbility.optional);
});

test('RIFT-891 a Legend is outside Board Unit, attack-target and public Standard Move sets', () => {
  const { kernel, match } = makeMatch(executableMechanizedMenace, builder => {
    builder.unit('friendly-mech', { controller: 'A', tags: ['Mech'], might: 3 });
  });
  const legend = legendObject(kernel, MECHANIZED_MENACE);
  const adapter = createMatchCommandAdapter({ match, stateVersion: 0 });
  try {
    match.flow.chain.layers.setObjects(kernel.objects);
    const layered = match.flow.chain.layers.evaluateAll();
    assert.equal(layered.some(object => object.ref.id === legend.ref.id && object.zone === 'board'), false);
    assert.equal(layered.some(object => object.ref.id === legend.ref.id &&
      object.zone === 'board' && object.types.includes('unit')), false);

    const context = match.flow.options.host.context(legend, 'A', 'main-start');
    const unitTargets = queryTargetCandidates(context, {
      id: 'attack-candidate', filter: { type: 'unit', zone: 'board' }, min: 0, max: null, selection: 'any',
    });
    assert.equal(unitTargets.some(ref => ref.id === legend.ref.id), false);

    const before = kernel.ref(legend.ref.id);
    assert.throws(() => adapter.execute('A', {
      type: 'move', commandId: 'legend-standard-move', stateVersion: adapter.stateVersion,
      objectId: legend.ref.id,
      to: { zone: 'battlefield', locationId: match.setup.battlefields[0].id },
    }), error => error?.code === 'illegal-unit');
    assert.deepEqual(kernel.ref(legend.ref.id), before);
    assert.equal(kernel.getObject(legend.ref.id).zone, 'legend');
  } finally {
    adapter.detach();
  }
});

test('RIFT-891 a Champion Legend rejects every attempted departure without changing state', () => {
  const { kernel } = makeMatch(executableMechanizedMenace, builder => {
    builder.unit('friendly-mech', { controller: 'A', tags: ['Mech'], might: 3 });
  });
  const legend = legendObject(kernel, MECHANIZED_MENACE);
  const actions = [
    { type: 'move-zone', object: legend.ref, to: 'battlefield', location: { type: 'battlefield', id: 'legend-forbidden-field' } },
    { type: 'move-zone', object: legend.ref, to: 'banishment' },
    { type: 'move-zone', object: legend.ref, to: 'hand' },
    { type: 'banish', object: legend.ref },
    { type: 'kill', object: legend.ref },
    { type: 'return-to-hand', object: legend.ref },
    { type: 'discard', object: legend.ref },
    { type: 'recycle', object: legend.ref },
    { type: 'counter', object: legend.ref },
    { type: 'play', object: legend.ref, player: 'A' },
  ];
  for (const action of actions) {
    const before = kernel.getObject(legend.ref.id);
    assert.equal(kernel.perform(action).status, 'prevented', action.type);
    assert.deepEqual(kernel.getObject(legend.ref.id), before);
    assert.deepEqual(kernel.objectsInZone('A', 'legend').map(ref => ref.id), [legend.ref.id]);
  }
});

test('RIFT-891 a non-Champion Legend may enter Banishment and unbinds its static', () => {
  const kernel = world().player('A').player('B')
    .unit('friendly-mech', { controller: 'A', tags: ['Mech'], might: 3 }).build();
  const created = kernel.perform({ type: 'create-token', player: 'A', to: 'legend', token: {
    cardId: MECHANIZED_MENACE, name: 'Removable Legend', types: ['legend'], tags: [], keywords: [],
    might: null, energy: null, power: null,
  } });
  assert.equal(created.status, 'done');
  const removable = kernel.getObject(created.result.id);
  const choose = request => { throw new Error(`Unexpected choice ${request.id}`); };
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: saved => { kernel.restore(saved.state); kernel.copyLinkedFrom(saved.links); },
    objects: () => kernel.objects, perform: action => kernel.perform(action),
    performContract: action => kernel.performContract(action),
    performBatchLeaf: (action, batchId) => kernel.performBatchLeafForCapability(action, batchId), choose,
    context: (source, controller, timingPoint) => bindResolveContext(kernel, { source, controller, timingPoint, choose }),
    testTrigger: registration => kernel.test(registration.spec.condition),
  });
  host.player = id => kernel.player(id);
  const engine = new ChainEngine({ turnOrder: ['A', 'B'], turnPlayer: 'A', phase: 'main', host, cleanup: () => false });
  const lifecycle = createProgramBinding({ cardPrograms: [executableMechanizedMenace] }).attachLifecycle(engine, error => { throw error; });
  try {
    assert.equal(engine.layers.registry.list().length, 1);
    assert.equal(engine.commit({ type: 'move-zone', object: removable.ref, to: 'hand' }).status, 'prevented');
    assert.equal(engine.commit({ type: 'move-zone', object: removable.ref, to: 'banishment' }).status, 'done');
    assert.equal(kernel.getObject(removable.ref.id).zone, 'banishment');
    assert.equal(engine.layers.registry.list().length, 0);
  } finally { lifecycle.detach(); }
});


const constant = value => ({ kind: 'constant', value });
const ACTIVATING_LEGEND = 'trained:activating-legend';
const ACTIVATING_UNIT = 'trained:activating-unit';

const activatedLegend = {
  canonicalCardId: ACTIVATING_LEGEND, rulesetVersion: 'core-1.5', status: 'executable',
  sourceText: 'Synthetic Champion Legend activated draw fixture.',
  abilities: [{ kind: 'activated', timing: 'action', cost: { kind: 'activated' },
    body: [{ id: 'legend.draw', op: 'effect.draw', args: { amount: constant(1) } }] }],
};
const activatedUnit = {
  canonicalCardId: ACTIVATING_UNIT, rulesetVersion: 'core-1.5', status: 'executable',
  sourceText: 'Synthetic Unit activated draw fixture.',
  abilities: [{ kind: 'activated', timing: 'action', cost: { kind: 'activated' },
    body: [{ id: 'unit.draw', op: 'effect.draw', args: { amount: constant(1) } }] }],
};

function r891Card(id, values = {}) {
  return { id, cardId: values.canonicalCardId ?? id, canonicalCardId: values.canonicalCardId ?? id,
    types: values.types ?? ['unit'], ...values };
}
function r891Deck(legendId) {
  return {
    mainDeck: Array.from({ length: 16 }, (_, index) => r891Card(`main:${legendId}:${index}`, {
      canonicalCardId: `main:${legendId}:${index}`, types: ['unit'], energy: 1, power: [], might: 1,
    })),
    runeDeck: Array.from({ length: 4 }, (_, index) => r891Card(`rune:${legendId}:${index}`, {
      canonicalCardId: `rune:${legendId}:${index}`, types: ['rune'], energy: null, power: null, might: null,
    })),
    championLegend: r891Card(`legend:${legendId}`, {
      canonicalCardId: legendId, cardId: legendId, types: ['legend'], name: legendId,
      energy: null, power: null, might: null,
    }),
    chosenChampion: r891Card(`champion:${legendId}`, {
      canonicalCardId: `champion:${legendId}`, types: ['champion'], energy: null, power: null, might: null,
    }),
    battlefields: [0, 1, 2].map(index => r891Card(`battlefield:${legendId}:${index}`, {
      canonicalCardId: `battlefield:${legendId}:${index}`, types: ['battlefield'], energy: null, power: null, might: null,
    })),
  };
}
function r891RecheckMatch(program, setup) {
  const builder = world().player('A').player('B');
  setup?.(builder);
  const kernel = builder.build();
  let pipeline;
  let adapterDefaultChoose;
  const choose = request => {
    if (pipeline !== undefined && pipeline.choose !== adapterDefaultChoose) return pipeline.choose(request);
    throw new Error(`Unexpected match choice ${request.id}`);
  };
  pipeline = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: saved => { kernel.restore(saved.state); kernel.copyLinkedFrom(saved.links); },
    objects: () => kernel.objects, perform: action => kernel.perform(action),
    performContract: action => kernel.performContract(action),
    performBatchLeaf: (action, batchId) => kernel.performBatchLeafForCapability(action, batchId), choose,
    context: (source, controller, timingPoint) => bindResolveContext(kernel, { source, controller, timingPoint, choose }),
    testTrigger: registration => kernel.test(registration.spec.condition),
  });
  adapterDefaultChoose = pipeline.choose;
  pipeline.player = id => kernel.player(id);
  const programs = new Map([[program.canonicalCardId, program],
    [ACTIVATING_LEGEND, activatedLegend], [ACTIVATING_UNIT, activatedUnit]]);
  const match = createMatch({ decks: [r891Deck(program.canonicalCardId), r891Deck('trained:generic-legend')],
    programs: { programs }, host: pipeline, seed: `rift-891:${program.canonicalCardId}`,
    battlefieldChoice: [0, 0], mulligans: [[], []], firstPlayer: 0 });
  return { kernel, match };
}
function r891Settle(adapter) {
  let guard = 0;
  while (adapter.match.flow.chain.items.length) {
    assert.ok(++guard < 20);
    adapter.execute(adapter.match.flow.chain.priority, { type: 'pass', commandId: `settle-${guard}`, stateVersion: adapter.stateVersion });
  }
}

test('RIFT-891 real Activate executes a Legend ability from Legend', () => {
  const { kernel, match } = r891RecheckMatch(activatedLegend);
  const source = kernel.objects.find(object =>
    object.cardId === ACTIVATING_LEGEND && object.owner === 'A' && object.zone === 'legend');
  assert.ok(source);
  const adapter = createMatchCommandAdapter({ match, stateVersion: 0 });
  try {
    const handBefore = kernel.player('A').handCount;
    assert.equal(source.zone, 'legend');
    adapter.execute('A', { type: 'activate', commandId: 'legend-activate', stateVersion: adapter.stateVersion,
      sourceObjectId: source.ref.id, abilityId: '0' });
    r891Settle(adapter);
    assert.equal(kernel.player('A').handCount, handBefore + 1, 'the activated body draws exactly once');
    assert.deepEqual(kernel.ref(source.ref.id), source.ref);
    assert.equal(kernel.getObject(source.ref.id).zone, 'legend');
  } finally { adapter.detach(); }
});

test('RIFT-891 non-Legend Hand Unit cannot activate across zones', () => {
  const { kernel, match } = r891RecheckMatch(activatedUnit, builder => {
    builder.hand('hand-unit', { cardId: ACTIVATING_UNIT, types: ['unit'], energy: 0, power: [], might: 2 });
  });
  const source = kernel.getObject('hand-unit');
  const adapter = createMatchCommandAdapter({ match, stateVersion: 0 });
  try {
    assert.throws(() => adapter.execute('A', { type: 'activate', commandId: 'unit-activate',
      stateVersion: adapter.stateVersion, sourceObjectId: source.ref.id, abilityId: '0' }),
    error => error?.code === 'illegal-activation-zone');
    assert.equal(kernel.getObject(source.ref.id).zone, 'hand');
  } finally { adapter.detach(); }
});
