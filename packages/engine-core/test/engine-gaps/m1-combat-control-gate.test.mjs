import assert from 'node:assert/strict';
import test from 'node:test';

import minefield from '../../../card-dsl/dist/cards/sfd/minefield.js';
import { AwaitChoice } from '../../dist/effects/contract.js';
import { world } from '../../dist/effects/testing/index.js';
import { bindResolveContext, createActionPipelineHost } from '../../dist/events/action-adapter.js';
import { createMatch } from '../../dist/game/lifecycle.js';
import { prioritizedHeadlessCommands } from '../../../integration-tests/src/headless/duel.ts';
import { createProgramBinding } from '../../dist/programs/index.js';

function card(id, types, extra = {}) {
  return { id, cardId: id, canonicalCardId: id, types, ...extra };
}

function deck(player, battlefieldId) {
  return {
    mainDeck: Array.from({ length: 20 }, (_, index) => card('${player}:unit:${index}', ['unit'], {
      cardId: 'synthetic:control-gate-unit',
      canonicalCardId: 'synthetic:control-gate-unit',
      energy: 0, power: [], might: 3,
    })),
    runeDeck: Array.from({ length: 8 }, (_, index) => card('${player}:rune:${index}', ['rune'], {
      energy: null, power: null, might: null,
    })),
    championLegend: card('${player}:legend', ['legend'], { energy: null, power: null, might: null }),
    chosenChampion: card('${player}:champion', ['champion'], { energy: null, power: null, might: null }),
    battlefields: Array.from({ length: 3 }, (_, index) => card(
      '${player}:battlefield:${index}', ['battlefield'],
      { cardId: battlefieldId, canonicalCardId: battlefieldId, energy: null, power: null, might: null },
    )),
  };
}

function setup() {
  const unitProgram = {
    canonicalCardId: 'synthetic:control-gate-unit',
    rulesetVersion: 'core-1.5',
    status: 'executable',
    sourceText: 'Synthetic Unit used only to reach the production Conquer path.',
    abilities: [],
  };
  const binding = createProgramBinding({ cardPrograms: [unitProgram, minefield] });
  const kernel = world().player('A').player('B').build();
  const errors = [];
  const choose = request => {
    if (request.type === 'mode' && request.id.startsWith('engagement:')) return request.options[0];
    if (request.type === 'optional') return true;
    if (request.type === 'select-objects' && request.min === request.max &&
        request.options.length === request.min) return [...request.options];
    throw new AwaitChoice(request);
  };
  const host = createActionPipelineHost({
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
  const match = createMatch({
    host: { ...host, player: id => kernel.player(id) },
    decks: [deck('A', minefield.canonicalCardId), deck('B', 'synthetic:other-battlefield')],
    programs: binding,
    seed: 'RIFT-1029-control-gate',
    battlefieldChoice: [0, 0],
    mulligans: [[], []],
    firstPlayer: 0,
  });
  binding.attachLifecycle(match.flow.chain, error => errors.push(error));
  return { kernel, binding, match, errors };
}

function settleChain(flow) {
  for (let guard = 0; flow.chain.items.length; guard++) {
    assert.ok(guard < 20, 'the real Chain must settle');
    assert.ok(flow.chain.priority, 'a finalized Chain item must preserve its Priority owner');
    flow.pass(flow.chain.priority);
  }
}

function driveControlStep(flow) {
  for (let index = 0; index < 10; index++) {
    if (!flow.chain.items.length) return;
    const command = prioritizedHeadlessCommands([], {
      turnState: flow.chain.turnState,
      priority: flow.chain.priority,
    }, flow.combat)[0];
    assert.equal(command.type, 'pass',
      'CR 312.2.c-d: finalized Control FEPR stays Open only through its next Priority pass');
    assert.equal(command.player, flow.chain.priority,
      'the driver passes only the authoritative Priority holder');
    flow.pass(flow.chain.priority);
  }
  assert.equal(flow.chain.items.length, 0, 'Control FEPR must converge');
}

test('RIFT-1029 production Conquer releases Control only after finalized priority resolves', () => {
  // CR v1.5 (2026-10-09, effective 2026-10-16):
  // https://cmsassets.rgpub.io/sanity/files/dsfx7636/news_live/5c7946f7c3b8c6e0faff85ab6dadc6d2e721ea94.pdf
  // 312.2.c/d grants Priority to the next Chain controller and then Turn Order.
  // 468.5 establishes Control and begins Conquer; 468.6 requires the resulting
  // FEPR to finish before 468.7 ends Combat. Minefield's canonical id is
  // card.hash-0c36f22df8ffa7bed49f59fd138d24b9b0a52a7b8ad4c720afcaa12ec816eee4.
  const { kernel, binding, match, errors } = setup();
  const flow = match.flow;
  assert.equal(minefield.canonicalCardId,
    'card.hash-0c36f22df8ffa7bed49f59fd138d24b9b0a52a7b8ad4c720afcaa12ec816eee4');
  assert.equal(minefield.status, 'executable');
  assert.deepEqual(errors, []);
  assert.ok([...flow.chain.pipeline.checkpoint().triggers.values()]
    .some(registration => registration.source.cardId === minefield.canonicalCardId));

  const unit = kernel.objects.find(object => object.controller === 'A' && object.zone === 'hand' &&
    object.cardId === 'synthetic:control-gate-unit');
  assert.ok(unit);
  flow.execute(binding.describePlay({ type: 'play', player: 'A', object: unit.ref }, unit));
  settleChain(flow);
  assert.equal(kernel.getObject(unit.ref.id).zone, 'board');

  flow.endTurn('A');
  flow.endTurn('B');
  assert.equal(flow.turnPlayer, 'A');
  assert.equal(flow.turn, 3);
  assert.equal(kernel.getObject(unit.ref.id).exhausted, false);

  const target = flow.battlefields.find(battlefield => battlefield.controller === null);
  assert.ok(target);
  flow.move('A', kernel.ref(unit.ref.id), target.id);
  assert.equal(flow.combat.current?.step, 'showdown');
  assert.equal(flow.chain.focus, 'A');
  flow.pass('A');
  flow.pass('B');

  const deckBefore = kernel.objects.filter(object => object.owner === 'A' && object.zone === 'deck').length;
  const trigger = flow.chain.items.find(item =>
    item.status === 'finalized' && item.source.cardId === minefield.canonicalCardId);
  assert.ok(trigger, 'CR 383.4.c.2: Conquer places Minefield on the real Chain');
  assert.equal(flow.chain.priority, 'A');
  assert.deepEqual(flow.combat.current, {
    field: target.id,
    step: 'control',
    scorer: 'A',
    queued: true,
    controlEstablished: true,
    controlGateReleased: false,
  });
  assert.equal(flow.chain.turnState, 'neutral-closed');
  assert.equal(kernel.objects.filter(object => object.owner === 'A' && object.zone === 'deck').length, deckBefore,
    'the Minefield effect has not resolved while Control remains gated');

  driveControlStep(flow);

  assert.equal(flow.combat.active, false, 'CR 468.7 follows completed Control FEPR');
  assert.equal(flow.chain.turnState, 'neutral-open');
  assert.equal(flow.chain.priority, 'A');
  assert.equal(kernel.objects.filter(object => object.owner === 'A' && object.zone === 'deck').length,
    deckBefore - 2, 'Minefield really resolved after both players passed Priority');
  assert.equal(kernel.objects.filter(object => object.owner === 'A' && object.zone === 'trash').length, 2);
  const timings = match.events().map(event => event.timingPoint);
  assert.ok(timings.includes('control-established'));
  assert.ok(timings.includes('chain-item-pending'));
  assert.ok(timings.includes('chain-item-resolve'));
  const controlEvent = match.events().find(event => event.timingPoint === 'control-established');
  assert.ok(controlEvent);
  const resolvedAfterControl = match.events().filter(event =>
    event.timingPoint === 'chain-item-resolve' && event.eventId > controlEvent.eventId);
  assert.equal(resolvedAfterControl.length, 1,
    'the Control trigger resolved after establishment');

  flow.endTurn('A');
  assert.equal(flow.turn, 4);
  assert.equal(flow.turnPlayer, 'B');
  assert.equal(flow.phase, 'main');
  assert.equal(flow.chain.turnState, 'neutral-open');
});

test('RIFT-1029 Control driver passes finalized Priority before advancing an Open State', () => {
  const combat = { current: { step: 'control' } };
  assert.deepEqual(prioritizedHeadlessCommands([], {
    turnState: 'neutral-closed',
    priority: 'A',
  }, combat), [{ type: 'pass', player: 'A' }]);
  assert.deepEqual(prioritizedHeadlessCommands([], {
    turnState: 'neutral-open',
    priority: 'A',
  }, combat), [{ type: 'advance' }]);
});
