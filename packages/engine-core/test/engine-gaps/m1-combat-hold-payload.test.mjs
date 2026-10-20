import assert from 'node:assert/strict';
import test from 'node:test';

import { bindResolveContext, createActionPipelineHost } from '../../dist/events/action-adapter.js';
import { matchesTriggerEvent } from '../../dist/events/pipeline-match.js';
import { validateTriggerSpec } from '../../dist/events/trigger-spec.js';
import { world } from '../../dist/effects/testing/index.js';
import { AwaitChoice } from '../../dist/effects/contract.js';
import { TurnFlow } from '../../dist/turn/flow.js';
import { ProgramBindingError } from '../../dist/programs/errors.js';
import { createProgramBinding } from '../../dist/programs/index.js';
import { translateTriggerFilter } from '../../dist/programs/filters.js';

import lucianMerciless from '../../../card-dsl/dist/cards/sfd/lucian-merciless.js';
import minefield from '../../../card-dsl/dist/cards/sfd/minefield.js';
import plunderingPoro from '../../../card-dsl/dist/cards/sfd/plundering-poro.js';
import ravenbloomConservatory from '../../../card-dsl/dist/cards/sfd/ravenbloom-conservatory.js';
import rumbleHotheaded from '../../../card-dsl/dist/cards/sfd/rumble-hotheaded.js';
import rumbleScrapper from '../../../card-dsl/dist/cards/sfd/rumble-scrapper.js';
import sunkenTemple from '../../../card-dsl/dist/cards/sfd/sunken-temple.js';
import treasureHoard from '../../../card-dsl/dist/cards/sfd/treasure-hoard.js';
import veiledTemple from '../../../card-dsl/dist/cards/sfd/veiled-temple.js';
import laurentDuelist from '../../../card-dsl/dist/cards/sfd/laurent-duelist.js';
import fioraPeerless from '../../../card-dsl/dist/cards/sfd/fiora-peerless.js';

const c = value => ({ kind: 'constant', value });
const field = id => ({ type: 'battlefield', id });
const triggered = program => program.abilities.filter(ability => ability.kind === 'triggered');
const admittedAbility = (program, ability) => ({
  ...program,
  status: 'executable',
  judgeReason: undefined,
  abilities: [ability],
});

function scoreFixture({ fields = [{ id: 'bf1', controller: null }, { id: 'bf2', controller: null }],
  setup, answers = {} } = {}) {
  const builder = world().player('A').player('B').base('trigger-source', { might: 4, energy: 0, power: [] });
  for (const player of ['A', 'B']) {
    builder.deck(Array.from({ length: 8 }, (_, index) => `${player}:deck:${index}`), { owner: player });
    builder.rune(Array.from({ length: 8 }, (_, index) => `${player}:rune:${index}`), { owner: player });
  }
  setup?.(builder);
  const kernel = builder.build();
  const responses = new Map(Object.entries(answers));
  const choose = request => {
    if (responses.has(request.id)) return responses.get(request.id);
    if (request.type === 'mode' && request.id.includes(':order:')) return request.options[0];
    if (request.type === 'mode' && request.id.startsWith('engagement:')) return request.options[0];
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
    choose,
    context: (source, controller, timingPoint) => bindResolveContext(kernel, {
      source, controller, timingPoint, choose,
    }),
    testTrigger: registration => kernel.test(registration.spec.condition),
  });
  const flow = new TurnFlow({ host, player: id => kernel.player(id), turnOrder: ['A', 'B'], battlefields: fields });
  const activated = (id, body, sourceId = 'trigger-source', controller = 'A') => ({
    id, controller, source: kernel.getObject(sourceId), kind: 'activated', speed: 'normal', body,
  });
  const settle = (budget = 40) => {
    for (let index = 0; index < budget; index++) {
      if (flow.chain.items.length) { flow.pass(flow.chain.priority); continue; }
      if (flow.chain.focus !== null) { flow.pass(flow.chain.focus); continue; }
      return;
    }
    throw new Error('score chain did not settle');
  };
  return { kernel, host, flow, responses, activated, settle };
}

function testProgramBindings(f) {
  void f;
  return {
    soldier: admittedAbility(plunderingPoro, triggered(plunderingPoro)[0]),
    holdUnit: admittedAbility(rumbleScrapper, triggered(rumbleScrapper)[0]),
    conquestSite: admittedAbility(minefield, triggered(minefield)[0]),
    uncontrolledSite: admittedAbility(veiledTemple, triggered(veiledTemple)[0]),
  };
}

function triggerFilter(f, id, sourceId, at, filter, controller) {
  const source = f.kernel.getObject(sourceId);
  const translated = translateTriggerFilter(filter, sourceId, at);
  f.flow.chain.pipeline.registerTrigger({ id, source, controller: controller ?? source.controller,
    spec: { at, filter: translated }, body: [] });
  return source;
}

function pendingTriggerItems(f) {
  return f.flow.chain.trace.filter(entry => entry.step === 'pending' && String(entry.item ?? '').startsWith('trigger:'));
}

function moveAndAdvance(f, objectId, battlefieldId) {
  assert.equal(f.flow.chain.commit({ type: 'move-location', object: f.kernel.ref(objectId),
    to: field(battlefieldId) }).status, 'done');
  f.flow.advance();
}

test('RIFT-878 conquer emits exact battlefield and Unit incarnation for the original Poro IR', () => {
  const f = scoreFixture({
    setup: w => w.unit('poro', { cardId: plunderingPoro.canonicalCardId, might: 3,
      location: { type: 'base', player: 'A' } }),
  });
  const program = testProgramBindings(f).soldier;
  const binding = createProgramBinding({ cardPrograms: [program] });
  const poro = f.kernel.getObject('poro');
  assert.deepEqual(binding.registerProgramTriggers(f.flow.chain, poro), ['program:poro:1:0']);
  f.flow.start();
  f.flow.execute(f.activated('poro-conquers', [{
    id: 'move-poro', op: 'effect.move', args: { to: c(field('bf1')) },
  }], 'poro'));
  f.settle();

  const wave = f.flow.chain.pipeline.events.filter(event => event.timingPoint === 'conquer');
  assert.equal(wave.length, 1);
  assert.deepEqual(wave[0].object.ref, poro.ref);
  assert.deepEqual(wave[0].source.ref, poro.ref);
  assert.deepEqual(wave[0].it.ref, poro.ref);
  assert.deepEqual(wave[0].details, {
    battlefieldId: 'bf1', objectId: 'poro', playerId: 'A', battlefieldControllerBefore: null,
  });
  assert.equal(f.flow.chain.items.length, 0);
  assert.deepEqual(f.flow.scoreLedgerSnapshot('A'), [{
    player: 'A', battlefieldId: 'bf1', method: 'conquer', objectId: 'poro',
  }]);
  assert.equal(plunderingPoro.status, 'judge-required');
  assert.equal(rumbleScrapper.status, 'judge-required');
  assert.equal(ravenbloomConservatory.status, 'judge-required');
  assert.equal(treasureHoard.status, 'judge-required');
  assert.equal(laurentDuelist.status, 'judge-required');
  // RIFT-877 made Fiora, Peerless executable through its own production goldens.
  assert.equal(fioraPeerless.status, 'executable');
});

test('RIFT-878 conquer aggregate Score payload records every participating Unit and exact battlefield', () => {
  const f = scoreFixture({
    setup: w => {
      w.base('a1', { might: 2 });
      w.base('a2', { might: 3 });
    },
  });
  f.flow.start();
  const refs = [f.kernel.ref('a1'), f.kernel.ref('a2')];
  f.responses.set('move-two/two', refs);
  f.flow.execute(f.activated('enter-two', [{
    id: 'move-two', op: 'effect.move',
    args: {
      objects: c({ kind: 'choose', id: 'two', filter: { type: 'unit', zone: 'board', controller: 'A' } }),
      amount: c(2), to: c(field('bf1')),
    },
  }]));
  f.settle();
  const score = f.flow.chain.pipeline.events.filter(event => event.timingPoint === 'score');
  assert.equal(score.length, 1);
  assert.deepEqual(score[0].details, {
    battlefieldId: 'bf1', battlefieldControllerBefore: null, participatingUnits: refs,
  });
});

test('RIFT-878 Hold uses an exact Unit payload and aggregate Score payload', () => {
  const f = scoreFixture({
    fields: [{ id: 'bf1', controller: 'A' }, { id: 'bf2', controller: null }],
    setup: w => w.unit('scrapper', { cardId: rumbleScrapper.canonicalCardId, tags: ['Mech'],
      location: field('bf1') }),
  });
  const program = testProgramBindings(f).holdUnit;
  const binding = createProgramBinding({ cardPrograms: [program] });
  const scrapper = f.kernel.getObject('scrapper');
  assert.deepEqual(binding.registerProgramTriggers(f.flow.chain, scrapper), ['program:scrapper:1:0']);
  f.flow.start();
  const holds = f.flow.chain.pipeline.events.filter(event => event.timingPoint === 'hold');
  assert.equal(holds.length, 1);
  assert.deepEqual(holds[0].object.ref, scrapper.ref);
  assert.deepEqual(holds[0].details, { battlefieldId: 'bf1', objectId: 'scrapper', playerId: 'A' });
  const score = f.flow.chain.pipeline.events.find(event => event.timingPoint === 'score');
  assert.deepEqual(score.details, { battlefieldId: 'bf1', participatingUnits: [scrapper.ref] });
});

test('RIFT-878 Unit self Conquer filters use the real emitted Unit incarnation', () => {
  const filters = [
    [plunderingPoro, 'poro-filter', plunderingPoro.abilities[0].trigger.filter],
    [rumbleHotheaded, 'rumble-filter', rumbleHotheaded.abilities[1].trigger.filter],
    [lucianMerciless, 'lucian-filter', lucianMerciless.abilities[1].trigger.filter],
  ];
  const positive = scoreFixture({
    setup: w => {
      w.base('poro', { cardId: plunderingPoro.canonicalCardId, might: 3 });
      w.base('rumble', { cardId: rumbleHotheaded.canonicalCardId, might: 4 });
      w.base('lucian', { cardId: lucianMerciless.canonicalCardId, might: 3 });
    },
  });
  for (const [, id, filter] of filters) triggerFilter(positive, id, id.replace('-filter', ''), 'conquer', filter);
  positive.flow.start();
  positive.flow.execute(positive.activated('triple-conquer', [{
    id: 'move-three', op: 'effect.move',
    args: {
      objects: c({ kind: 'choose', id: 'three', filter: { type: 'unit', zone: 'board', controller: 'A' } }),
      amount: c(3), to: c(field('bf1')),
    },
  }]));
  const refs = ['poro', 'rumble', 'lucian'].map(id => positive.kernel.ref(id));
  positive.responses.set('move-three/three', refs);
  positive.settle();
  const conquerPayloads = positive.flow.chain.pipeline.events
    .filter(event => event.timingPoint === 'conquer')
    .map(event => [event.object.ref, event.source.ref, event.it.ref, event.details.battlefieldId]);
  assert.deepEqual(conquerPayloads.sort(), refs.map(ref => [ref, ref, ref, 'bf1']).sort());
  assert.equal(pendingTriggerItems(positive).length, 3);

  const negative = scoreFixture({
    setup: w => {
      w.base('poro', { cardId: plunderingPoro.canonicalCardId });
      w.base('rumble', { cardId: rumbleHotheaded.canonicalCardId });
      w.base('lucian', { cardId: lucianMerciless.canonicalCardId });
      w.base('other', { might: 3 });
    },
  });
  for (const [, id, filter] of filters) triggerFilter(negative, id, id.replace('-filter', ''), 'conquer', filter);
  negative.flow.start();
  negative.flow.execute(negative.activated('other-conquer', [{ id: 'move-other', op: 'effect.move',
    args: { to: c(field('bf1')) } }], 'other'));
  negative.settle();
  assert.equal(negative.flow.chain.pipeline.events.filter(event => event.timingPoint === 'conquer').length, 1);
  assert.equal(pendingTriggerItems(negative).length, 0);
});

test('RIFT-878 Hold self filter ignores an unrelated holding Unit', () => {
  const negative = scoreFixture({
    fields: [{ id: 'bf1', controller: 'A' }, { id: 'bf2', controller: null }],
    setup: w => {
      w.unit('scrapper', { cardId: rumbleScrapper.canonicalCardId, location: { type: 'base', player: 'A' } });
      w.unit('holder', { location: field('bf1') });
    },
  });
  triggerFilter(negative, 'scrapper-hold', 'scrapper', 'hold', rumbleScrapper.abilities[1].trigger.filter);
  negative.flow.start();
  const hold = negative.flow.chain.pipeline.events.find(event => event.timingPoint === 'hold');
  assert.deepEqual(hold.object.ref, negative.kernel.ref('holder'));
  assert.equal(pendingTriggerItems(negative).length, 0);
});

test('RIFT-878 here matches only the source battlefield and fails closed on missing or stale facts', () => {
  const f = scoreFixture({
    fields: [{ id: 'bf1', controller: 'A' }, { id: 'bf2', controller: null }],
    setup: w => {
      w.unit('scrapper', { cardId: rumbleScrapper.canonicalCardId, location: field('bf1') });
      w.unit('other', { cardId: rumbleScrapper.canonicalCardId, location: field('bf2') });
    },
  });
  const program = testProgramBindings(f).holdUnit;
  const translated = translateTriggerFilter(program.abilities[0].trigger.filter, 'scrapper', 'hold');
  assert.deepEqual(translated, { event: 'held', object: { objectId: 'scrapper' } });
  const here = translateTriggerFilter({ event: 'held', here: true, filter: { source: 'self' } }, 'scrapper', 'hold');
  assert.deepEqual(here, { event: 'held', here: true, object: { objectId: 'scrapper' } });
  const source = f.kernel.getObject('scrapper');
  const other = f.kernel.getObject('other');
  const event = (object, battlefieldId = 'bf1') => ({
    type: 'task-resolved', seq: 1, eventId: 1, turnNumber: 1, activePlayerId: 'A',
    taskId: 'hold', sourceCardId: '', reason: 'hold', autoResolved: true,
    timingPoint: 'hold', kind: 'held', player: 'A', object, source: object, it: object,
    details: { battlefieldId, objectId: object.ref.id, playerId: 'A' },
  });
  assert.equal(matchesTriggerEvent(here, event(source), 'A', source), true);
  assert.equal(matchesTriggerEvent(here, event(other, 'bf2'), 'A', source), false);
  assert.equal(matchesTriggerEvent(here, event(source, 'bf2'), 'A', source), false);
  assert.equal(matchesTriggerEvent(here, { ...event(source), details: undefined }, 'A', source), false);
  assert.equal(matchesTriggerEvent(here, event({ ...source, ref: { ...source.ref, zoneEntryId: 2 } }), 'A', source), false);
  assert.equal(matchesTriggerEvent(here, event(source), 'A', { ...source, location: field('bf2') }), false);
});

test('RIFT-878 original battlefield IR accepts its own here and rejects another or unknown keys', () => {
  const f = scoreFixture({
    setup: w => w.unit('mine', { cardId: minefield.canonicalCardId, types: ['battlefield'],
      location: field('bf1'), energy: null, power: null }),
  });
  const program = testProgramBindings(f).conquestSite;
  const trigger = program.abilities[0].trigger;
  const validated = validateTriggerSpec(trigger);
  assert.equal(validated.ok, true, JSON.stringify(validated.issues));
  const binding = createProgramBinding({ cardPrograms: [program] });
  const mine = f.kernel.getObject('mine');
  assert.deepEqual(binding.registerProgramTriggers(f.flow.chain, mine), ['program:mine:1:0']);
  const translated = translateTriggerFilter(trigger.filter, 'mine', 'conquer');
  assert.deepEqual(translated, { event: 'conquered', here: true, player: 'self' });
  const conquer = event => ({
    type: 'task-resolved', seq: 1, eventId: 1, turnNumber: 1, activePlayerId: 'A',
    taskId: 'conquer', sourceCardId: '', reason: 'conquer', autoResolved: true,
    timingPoint: 'conquer', kind: 'conquer', player: 'A', object: mine,
    details: { battlefieldId: event, participatingUnits: [] },
  });
  assert.equal(matchesTriggerEvent(translated, conquer('bf1'), 'A', mine), true);
  assert.equal(matchesTriggerEvent(translated, conquer('bf2'), 'A', mine), false);
  assert.throws(() => translateTriggerFilter({ event: 'conquered', here: 'yes' }, 'mine', 'conquer'),
    error => error instanceof ProgramBindingError && error.code === 'judge-required');
  assert.throws(() => translateTriggerFilter({ event: 'conquered', unknownAnchor: true, here: true }, 'mine', 'conquer'),
    error => error instanceof ProgramBindingError && error.code === 'judge-required' && /unknownAnchor/.test(error.message));
  const nestedHere = { event: 'conquered', filter: { source: 'self', here: true } };
  assert.equal(validateTriggerSpec({ at: 'conquer', filter: { event: 'conquered', here: true, player: 'self' } }).ok, true);
  assert.equal(translateTriggerFilter({ event: 'conquered', object: { here: true }, player: 'self' }, 'mine', 'conquer').object.here, true);
  assert.throws(() => translateTriggerFilter(nestedHere, 'mine', 'conquer'),
    error => error instanceof ProgramBindingError && error.code === 'judge-required');
  assert.equal(minefield.status, 'judge-required');
  assert.equal(veiledTemple.status, 'judge-required');
  assert.equal(sunkenTemple.status, 'judge-required');
  assert.equal(lucianMerciless.status, 'judge-required');
  assert.equal(rumbleHotheaded.status, 'judge-required');
});

test('RIFT-878 battlefield here triggers match their own real Conquer event only', () => {
  const cards = [
    [minefield, 'mine', minefield.abilities[0].trigger.filter],
    [veiledTemple, 'veiled', veiledTemple.abilities[0].trigger.filter],
    [treasureHoard, 'hoard', treasureHoard.abilities[0].trigger.filter],
    [sunkenTemple, 'sunken', sunkenTemple.abilities[0].trigger.filter],
  ];
  const positive = scoreFixture({
    answers: { 'engagement:positive': undefined },
    setup: w => {
      for (const [, id] of cards) w.battlefield(id, { types: ['battlefield'], location: field('bf1'),
        energy: null, power: null });
      w.base('mover', { might: 3 });
    },
  });
  for (const [, id, filter] of cards) triggerFilter(positive, `${id}-here`, id, 'conquer', filter);
  positive.flow.start();
  positive.flow.execute(positive.activated('enter-here', [{ id: 'move-here', op: 'effect.move',
    args: { to: c(field('bf1')) } }], 'mover'));
  positive.settle();
  assert.equal(positive.flow.chain.pipeline.events.filter(event => event.timingPoint === 'conquer').length, 1);
  assert.equal(pendingTriggerItems(positive).length, cards.length);

  const negative = scoreFixture({
    setup: w => {
      for (const [, id] of cards) w.battlefield(id, { types: ['battlefield'], location: field('bf2'),
        energy: null, power: null });
      w.base('mover', { might: 3 });
    },
  });
  for (const [, id, filter] of cards) triggerFilter(negative, `${id}-here`, id, 'conquer', filter);
  negative.flow.start();
  negative.flow.execute(negative.activated('enter-elsewhere', [{ id: 'move-elsewhere', op: 'effect.move',
    args: { to: c(field('bf1')) } }], 'mover'));
  negative.settle();
  assert.equal(negative.flow.chain.pipeline.events.filter(event => event.timingPoint === 'conquer').length, 1);
  assert.equal(pendingTriggerItems(negative).length, 0);
});

test('RIFT-878 Ravenbloom here follows the actual defended Battlefield', () => {
  const positive = scoreFixture({
    fields: [{ id: 'bf1', controller: 'B' }, { id: 'bf2', controller: null }],
    setup: w => {
      w.battlefield('conservatory', { cardId: ravenbloomConservatory.canonicalCardId,
        types: ['battlefield'], controller: 'B', location: field('bf1'), energy: null, power: null });
      w.unit('attacker', { might: 4, location: field('bf1') });
      w.unit('defender', { owner: 'B', controller: 'B', might: 3, location: field('bf2') });
    },
  });
  triggerFilter(positive, 'ravenbloom-defense', 'conservatory', 'defense-declared',
    ravenbloomConservatory.abilities[0].trigger.filter);
  positive.flow.start();
  moveAndAdvance(positive, 'defender', 'bf1');
  const defense = positive.flow.chain.pipeline.events.find(event => event.timingPoint === 'defense-declared');
  assert.equal(defense.object.ref.id, 'defender');
  assert.equal(defense.details.battlefieldId, 'bf1');
  assert.equal(pendingTriggerItems(positive).length, 1);

  const negative = scoreFixture({
    fields: [{ id: 'bf1', controller: 'B' }, { id: 'bf2', controller: null }],
    setup: w => {
      w.battlefield('conservatory', { cardId: ravenbloomConservatory.canonicalCardId,
        types: ['battlefield'], controller: 'B', location: field('bf2'), energy: null, power: null });
      w.unit('attacker', { might: 4, location: field('bf1') });
      w.unit('defender', { owner: 'B', controller: 'B', might: 3, location: field('bf2') });
    },
  });
  triggerFilter(negative, 'ravenbloom-defense', 'conservatory', 'defense-declared',
    ravenbloomConservatory.abilities[0].trigger.filter);
  negative.flow.start();
  moveAndAdvance(negative, 'defender', 'bf1');
  assert.equal(negative.flow.chain.pipeline.events.filter(event => event.timingPoint === 'defense-declared').length, 1);
  assert.equal(pendingTriggerItems(negative).length, 0);
});

test('RIFT-878 a real Board Battlefield is the aggregate Score object', () => {
  const f = scoreFixture({
    fields: [{ id: 'bf1', controller: 'A' }, { id: 'bf2', controller: null }],
    setup: w => {
      w.battlefield('mine', { cardId: minefield.canonicalCardId, types: ['battlefield'],
        location: field('bf1'), energy: null, power: null });
      w.unit('holder', { location: field('bf1') });
    },
  });
  f.flow.start();
  const score = f.flow.chain.pipeline.events.find(event => event.timingPoint === 'score');
  assert.deepEqual(score.object.ref, f.kernel.ref('mine'));
  assert.equal(score.details.battlefieldId, 'bf1');
  assert.deepEqual(score.details.participatingUnits, [f.kernel.ref('holder')]);
});

test('RIFT-878 the remaining triaged originals bind without status changes', () => {
  const programs = [
    { program: laurentDuelist, ability: laurentDuelist.abilities[0] },
    { program: fioraPeerless, ability: fioraPeerless.abilities[0] },
    { program: fioraPeerless, ability: fioraPeerless.abilities[1] },
    { program: rumbleHotheaded, ability: rumbleHotheaded.abilities[1] },
    { program: ravenbloomConservatory, ability: ravenbloomConservatory.abilities[0] },
    { program: treasureHoard, ability: treasureHoard.abilities[0] },
    { program: sunkenTemple, ability: sunkenTemple.abilities[0] },
  ];
  for (const { program, ability } of programs) {
    const lifted = {
      ...program, status: 'executable', judgeReason: undefined,
      abilities: [ability],
    };
    assert.doesNotThrow(() => createProgramBinding({ cardPrograms: [lifted] }).registry.get(program.canonicalCardId));
  }
});
