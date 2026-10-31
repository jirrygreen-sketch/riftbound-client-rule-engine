// RIFT-1168 -- Long Sword Quick-Draw attachment, Might, and co-location.
//
// Official rules: Riftbound Core Rules v1.5, published 2026-10-09 and effective
// 2026-10-16.
// https://cmsassets.rgpub.io/sanity/files/dsfx7636/news_live/5c7946f7c3b8c6e0faff85ab6dadc6d2e721ea94.pdf
// CR 137.3/435.1.d: an Attached Equipment's printed Might Bonus modulates its
// Top-Most card. CR 718.5.c/719.3.a: Attached cards travel with the Top-Most
// card and cannot move separately. CR 819.1.d: Long Sword attaches on play.
// CR 821.1.b-.c: Weaponmaster's paid Equip also attaches. CR 448.1: co-location
// with the Top-Most card is not a separate Move and therefore publishes no
// separate object-moved occurrence for the attachment.
import assert from 'node:assert/strict';
import test from 'node:test';

import longSword from '../../../card-dsl/dist/cards/sfd/long-sword.js';
import weaponmaster from '../../dist/effects/keywords/Weaponmaster.js';
import { AwaitChoice } from '../../dist/effects/contract.js';
import { world } from '../../dist/effects/testing/index.js';
import { bindResolveContext, createActionPipelineHost } from '../../dist/events/action-adapter.js';
import { createProgramBinding } from '../../dist/programs/index.js';
import { TurnFlow } from '../../dist/turn/flow.js';

const BASE_A = Object.freeze({ type: 'base', player: 'A' });
const BASE_B = Object.freeze({ type: 'base', player: 'B' });
const FIELD = Object.freeze({ type: 'battlefield', id: 'field-1' });
const OTHER_FIELD = Object.freeze({ type: 'battlefield', id: 'field-2' });
const constant = value => ({ kind: 'constant', value });
const admitted = program => ({ ...program, status: 'executable', judgeReason: undefined });

function deck(cardId, types) {
  const card = id => ({ id, cardId, types, energy: types.includes('rune') ? null : 0,
    power: types.includes('rune') ? null : [], might: types.includes('unit') ? 1 : null });
  return {
    mainDeck: Array.from({ length: 16 }, (_, index) => card(`filler-${types.join('-')}-${index}`)),
    runeDeck: Array.from({ length: 12 }, (_, index) => ({ id: `rune-${index}`, cardId: 'rune-card', types: ['rune'] })),
    championLegend: { id: 'legend', cardId: 'legend-card', types: ['legend'] },
    chosenChampion: { id: 'champion', cardId: 'champion-card', types: ['champion'] },
    battlefields: [0, 1, 2].map(index => ({ id: `field-source-${index}`, cardId: `field-card-${index}`, types: ['battlefield'] })),
  };
}

function scene({ programs, setup, choose }) {
  const builder = world().player('A', { energy: 0, power: [] }).player('B', { energy: 0, power: [] });
  for (const player of ['A', 'B']) {
    builder.deck(Array.from({ length: 16 }, (_, index) => `${player}:deck:${index}`), { owner: player });
    builder.rune(Array.from({ length: 12 }, (_, index) => `${player}:rune:${index}`), { owner: player });
  }
  setup(builder);
  const kernel = builder.build();
  const questions = [];
  const answer = request => {
    questions.push(structuredClone(request));
    const selected = choose?.(request);
    if (selected !== undefined) return selected;
    if (request.type === 'select-objects' && request.options.length === request.min) return [...request.options];
    throw new AwaitChoice(request);
  };
  const pipeline = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: saved => { kernel.restore(saved.state); kernel.copyLinkedFrom(saved.links); },
    objects: () => kernel.objects,
    perform: action => kernel.perform(action),
    performContract: action => kernel.performContract(action),
    performBatchLeaf: (action, batchId) => kernel.performBatchLeafForCapability(action, batchId),
    choose: answer,
    context: (source, controller, timingPoint) => bindResolveContext(kernel, {
      source, controller, timingPoint, choose: answer,
    }),
  });
  const binding = createProgramBinding({ cardPrograms: programs });
  const flow = new TurnFlow({
    host: pipeline,
    player: id => kernel.player(id),
    turnOrder: ['A', 'B'],
    battlefields: [{ id: FIELD.id, controller: null }, { id: OTHER_FIELD.id, controller: null }],
    describePlay: binding.describePlay,
  });
  binding.attachLifecycle(flow.chain, error => { throw error; });
  flow.start();
  assert.equal(flow.phase, 'main', 'real TurnFlow reached Main before play');
  assert.equal(flow.chain.commit({ type: 'gain-energy', player: 'A', amount: 10 }).status, 'done');
  assert.equal(flow.chain.commit({ type: 'gain-power', player: 'A', power: ['Fury', 'Fury'] }).status, 'done');
  const settle = () => {
    for (let guard = 0; flow.chain.items.length; guard++) {
      assert.ok(guard < 50, 'chain settles');
      flow.pass(flow.chain.priority);
    }
  };
  const play = (id, player, location) => {
    const source = kernel.getObject(id);
    flow.execute(binding.describePlay({ type: 'play', player, object: source.ref, location }, source));
    settle();
  };
  const might = id => {
    flow.layers.setObjects(kernel.objects);
    return flow.layers.evaluate(kernel.ref(id)).might;
  };
  return { binding, flow, kernel, might, play, questions, settle };
};

function longSwordScene() {
  return scene({
    programs: [admitted(longSword)],
    setup: builder => builder
      .hand('long-sword', {
        cardId: longSword.canonicalCardId, name: 'Long Sword', types: ['gear'], tags: ['Equipment'],
        energy: 2, power: ['Fury'], might: 2, keywords: [],
      })
      .base('rumble', { cardId: 'rift-1168:rumble-instance', might: 4, energy: null, power: null })
      .base('enemy', { cardId: 'rift-1168:enemy-instance', owner: 'B', controller: 'B', might: 4,
        energy: null, power: null }),
  });
}

test('RIFT-1168 Quick-Draw attaches Long Sword, grants +2, and follows a Standard Move as co-location (CR 137.3, 435.1.d, 448.1, 718.5.c, 719.3.a, 819.1.d)', () => {
  const f = longSwordScene();
  const playStart = f.flow.chain.pipeline.events.length;
  f.play('long-sword', 'A', BASE_A);

  const gear = f.kernel.getObject('long-sword');
  assert.equal(gear.zone, 'board');
  assert.deepEqual(gear.attachedTo, f.kernel.ref('rumble'));
  assert.equal(f.might('rumble'), 6, 'base Might 4 plus Long Sword Might Bonus 2');
  assert.ok(f.questions.some(request => request.id === 'target:quick-draw-unit'),
    'Quick-Draw Finalize really chose a friendly Unit');
  assert.ok(f.flow.chain.pipeline.events.slice(playStart).some(event => event.timingPoint === 'object-attached'));

  const hostRef = f.kernel.ref('rumble');
  const gearRef = f.kernel.ref('long-sword');
  const moveStart = f.flow.chain.pipeline.events.length;
  const moved = f.flow.chain.commit({ type: 'move-location', object: hostRef, to: FIELD });
  assert.equal(moved.status, 'done');
  assert.deepEqual(f.kernel.getObject('rumble').location, FIELD);
  assert.deepEqual(f.kernel.getObject('long-sword').location, FIELD,
    'the Attached Equipment shares its Top-Most card location (CR 719.3)');
  assert.deepEqual(f.kernel.getObject('long-sword').attachedTo, f.kernel.ref('rumble'),
    'co-location does not detach the Equipment (CR 718.5.c)');
  assert.deepEqual(f.kernel.ref('long-sword'), gearRef, 'following is not a zone change');
  assert.equal(f.might('rumble'), 6, 'the bonus remains active after moving');
  const movedEvents = f.flow.chain.pipeline.events.slice(moveStart).filter(event => event.timingPoint === 'object-moved');
  assert.deepEqual(movedEvents.map(event => event.object.ref.id), ['rumble'],
    'the attachment changes location without a separate Move occurrence (CR 448.1)');
});

test('RIFT-1168 Long Sword from the paid Equip/Weaponmaster path has the same attach, Might, and co-location result (CR 821.1.b-.c)', () => {
  const canonicalCardId = 'rift-1168:weaponmaster';
  const program = {
    canonicalCardId, rulesetVersion: 'core-1.5', status: 'executable', sourceText: 'Weaponmaster',
    abilities: [{ kind: 'play', cost: { kind: 'printed', energy: constant(0), power: constant([]) }, body: [] },
      ...weaponmaster.expand({ host: { canonicalCardId } })],
  };
  const f = scene({
    programs: [program, admitted(longSword)],
    choose: request => request.id === 'target:weaponmaster-equipment'
      ? request.options.filter(ref => ref.id === 'long-sword') : undefined,
    setup: builder => builder
      .hand('lucian', { cardId: canonicalCardId, name: 'Lucian', types: ['unit'], energy: 0, power: [], might: 3 })
      .object('long-sword', {
        cardId: longSword.canonicalCardId, name: 'Long Sword', types: ['gear'], tags: ['Equipment'],
        zone: 'board', location: OTHER_FIELD, energy: 2, power: ['Fury'], might: 2,
        keywords: longSword.abilities.filter(ability => ability.kind === 'keyword').map(ability => ({
          id: ability.keyword, ...(ability.value === undefined ? {} : { value: ability.value }),
          ...(ability.params === undefined ? {} : { params: structuredClone(ability.params) }),
        })),
      }),
  });
  const power = [...f.kernel.player('A').power];
  f.play('lucian', 'A', BASE_A);
  assert.deepEqual(f.kernel.getObject('long-sword').attachedTo, f.kernel.ref('lucian'));
  assert.deepEqual(f.kernel.getObject('long-sword').location, BASE_A,
    'attaching from another Board location co-locates the Equipment (CR 435.4)');
  assert.ok(f.kernel.player('A').power.length < power.length, 'Weaponmaster paid the printed Equip cost');
  assert.equal(f.might('lucian'), 5, 'base Might 3 plus Long Sword Might Bonus 2');

  assert.equal(f.flow.chain.commit({ type: 'move-location', object: f.kernel.ref('lucian'), to: FIELD }).status, 'done');
  assert.deepEqual(f.kernel.getObject('long-sword').location, FIELD);
  assert.deepEqual(f.kernel.getObject('long-sword').attachedTo, f.kernel.ref('lucian'));
  assert.equal(f.might('lucian'), 5);
});

test('RIFT-1168 a Top-Most card leaving the Board detaches its Equipment in place (CR 719.5)', () => {
  const f = longSwordScene();
  f.play('long-sword', 'A', BASE_A);
  const hostRef = f.kernel.ref('rumble');
  assert.equal(f.flow.chain.commit({ type: 'kill', object: hostRef }).status, 'done');
  assert.equal(f.kernel.getObject('rumble').zone, 'trash');
  assert.deepEqual(f.kernel.getObject('long-sword').location, BASE_A,
    'the Equipment remains at the host\'s last Board location');
  assert.equal(f.kernel.getObject('long-sword').attachedTo, null,
    'the Equipment is no longer Attached after its host changes zones');
});

test('RIFT-1168 a replaced Kill that moves the host does not detach or misclassify the Gear', () => {
  const f = longSwordScene();
  f.play('long-sword', 'A', BASE_A);
  const hostRef = f.kernel.ref('rumble');
  f.flow.chain.pipeline.registerReplacement({
    id: 'rift-1168-kill-to-move',
    matches: action => action.type === 'kill' && action.object.id === hostRef.id,
    apply: () => ({ status: 'replace', actions: [{ type: 'move-location', object: hostRef, to: FIELD }] }),
  });
  const outcome = f.flow.chain.commit({ type: 'kill', object: hostRef });
  assert.equal(outcome.status, 'replaced');
  assert.equal(f.kernel.getObject('rumble').zone, 'board');
  assert.deepEqual(f.kernel.getObject('rumble').location, FIELD);
  assert.deepEqual(f.kernel.getObject('long-sword').attachedTo, f.kernel.ref('rumble'),
    'the replacement did not leave the Board, so the attached Gear stays attached');
  assert.deepEqual(f.kernel.getObject('long-sword').location, FIELD,
    'the replacement Move still co-locates the attachment');
});
