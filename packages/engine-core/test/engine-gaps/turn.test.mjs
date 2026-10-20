import assert from 'node:assert/strict';
import test from 'node:test';

import { bindResolveContext, createActionPipelineHost } from '../../dist/events/action-adapter.js';
import { resolveChainBody } from '../../dist/chain/interpreter-adapter.js';
import { world } from '../../dist/effects/testing/test-kernel.js';
import { AwaitChoice } from '../../dist/effects/contract.js';
import { TurnFlow } from '../../dist/turn/flow.js';
import { TurnQueue } from '../../dist/turn/turn-queue.js';
import { ScoreLedger } from '../../dist/scoring/ledger.js';
import { scorePermission } from '../../dist/scoring/restrictions.js';
import { ContinuousEffectRegistry } from '../../dist/layers/duration.js';
import { hideCard, createHiddenState } from '../../dist/zones/hidden/index.js';
import { finalPointDecision, winnerAtCleanup } from '../../dist/scoring/outcome.js';
import timeWarp from '../../../card-dsl/dist/cards/ogn/time-warp.js';
import forgottenMonument from '../../../card-dsl/dist/cards/sfd/forgotten-monument.js';
import temporary from '../../dist/effects/keywords/Temporary.js';
import hunt from '../../dist/effects/keywords/Hunt.js';
import { translateTriggerFilter } from '../../dist/programs/filters.js';
import { registerTurnTaskCapability } from '../../dist/effects/instructions/effect.additional-turn.js';
import { createEngineStaticBinder } from '../../dist/programs/statics.js';
import yoneBlademaster from '../../../card-dsl/dist/cards/rad/yone-blademaster.js';

const c = value => ({ kind: 'constant', value });
const instruction = (id, op, args) => ({ id, op, args });

function fixture({ fields = [{ id: 'bf1', controller: null }, { id: 'bf2', controller: null }],
  score = {}, deck = 8, rune = 8, setup, energy = {}, power = {}, hiddenState, facedownCapacity,
  taskCapabilities } = {}) {
  const builder = world().player('A', { energy: energy.A ?? 0, power: power.A ?? [], score: score.A ?? 0 })
    .player('B', { energy: energy.B ?? 0, power: power.B ?? [], score: score.B ?? 0 })
    .base('source', { might: 4, energy: 0, power: [] });
  for (const player of ['A', 'B']) {
    if (deck) builder.deck(Array.from({ length: deck }, (_, index) => `${player}:deck:${index}`), { owner: player });
    if (rune) builder.rune(Array.from({ length: rune }, (_, index) => `${player}:rune:${index}`), { owner: player });
  }
  setup?.(builder);
  const kernel = builder.build();
  const answers = new Map();
  const asked = [];
  const choose = request => {
    asked.push(request);
    if (answers.has(request.id)) return answers.get(request.id);
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
  const flow = new TurnFlow({ host, player: id => kernel.player(id), turnOrder: ['A', 'B'],
    battlefields: fields, ...(hiddenState === undefined ? {} : { hiddenState }),
    ...(facedownCapacity === undefined ? {} : { facedownCapacity }),
    ...(taskCapabilities === undefined ? {} : { taskCapabilities }) });
  const draft = (id, body, controller = 'A', sourceId = 'source', speed = 'normal') => ({
    id, controller, source: kernel.getObject(sourceId), kind: 'activated', speed, body,
  });
  return { kernel, flow, host, choose, answers, asked, draft };
}

function passUntilIdle(f, budget = 80) {
  let passes = 0;
  while (passes++ < budget) {
    if (f.flow.chain.items.length) {
      if (f.flow.chain.priority !== null) f.flow.pass(f.flow.chain.priority);
      continue;
    }
    if (f.flow.chain.focus !== null) {
      f.flow.pass(f.flow.chain.focus);
      continue;
    }
    return;
  }
  throw new Error('Chain did not settle');
}

test('EG-TURN per-battlefield ledger, threshold, and tile restriction consumers are real', () => {
  const ledger = new ScoreLedger();
  ledger.add({ player: 'A', battlefieldId: 'bf1', method: 'hold', objectId: 'unit-a' });
  assert.deepEqual(ledger.fields('A'), ['bf1']);
  assert.equal(ledger.has('A', 'bf1'), true);
  assert.deepEqual(ledger.entry('A', 'bf1'), {
    player: 'A', battlefieldId: 'bf1', method: 'hold', objectId: 'unit-a',
  });
  assert.throws(() => ledger.add({ player: 'A', battlefieldId: 'bf1', method: 'conquer' }), /already Scored/);
  assert.equal(finalPointDecision(7, 8, false).drawInstead, true);
  assert.equal(finalPointDecision(7, 8, true).drawInstead, false);
  assert.equal(winnerAtCleanup(['A', 'B'], id => id === 'A' ? 8 : 7, 8), 'A');
  assert.equal(winnerAtCleanup(['A', 'B'], id => id === 'A' ? 8 : 8, 8), null);
});

test('EG-TURN original Forgotten Monument IR reaches the live score prohibition and rejects Scoring', () => {
  const ability = forgottenMonument.abilities.find(entry => entry.kind === 'static');
  assert.equal(forgottenMonument.status, 'judge-required');
  assert.equal(ability.effect.kind, 'continuous.restrict');
  assert.deepEqual(ability.effect.actions, ['score']);
  assert.equal(ability.effect.until.perPlayerTurn, 3);
});

test('EG-TURN live Score restriction blocks only the matching player and battlefield', () => {
  const registry = new ContinuousEffectRegistry();
  const battlefield = {
    ref: { id: 'bf1', zoneEntryId: 1 }, cardId: 'card:bf1', name: 'bf1', types: ['battlefield'],
    tags: [], keywords: [], owner: 'A', controller: 'A', zone: 'board', location: { type: 'battlefield', id: 'bf1' },
    might: null, energy: null, power: null, exhausted: false, damage: 0, stunned: false,
    buffs: 0, attachedTo: null, faceDown: false, isToken: false,
  };
  registry.add({
    id: 'test:score-lock', layer: 'ability', source: battlefield.ref,
    filter: { objectId: 'bf1', zoneEntryId: 1, controller: 'opponent' },
    effect: { kind: 'restriction', actions: ['score'], restriction: 'score-lock', sourcePlayer: 'A' },
  }, { type: 'permanent' });
  assert.equal(scorePermission({ registry, player: 'A', battlefield }).allowed, true);
  assert.equal(scorePermission({ registry, player: 'B', battlefield }).allowed, false);
});

test('EG-TURN production static binder restriction is consumed by TurnFlow scoring', () => {
  const f = fixture({
    fields: [{ id: 'bf1', controller: 'A' }, { id: 'bf2', controller: null }],
    deck: 2,
    setup: w => w.unit('lock', { types: ['battlefield'], owner: 'A', controller: 'A',
      location: { type: 'battlefield', id: 'bf1' }, cardId: 'card.hash-score-lock' }),
  });
  f.kernel.perform({ type: 'move-location', object: f.kernel.ref('lock'), to: { type: 'base', player: 'A' } });
  f.kernel.perform({ type: 'move-location', object: f.kernel.ref('lock'), to: { type: 'battlefield', id: 'bf1' } });
  createEngineStaticBinder(f.flow.chain).bindStatic({
    kind: 'static',
    effect: { kind: 'continuous.restrict', actions: ['score'], restriction: 'score-lock',
      appliesTo: { controller: 'opponent' } },
  }, f.kernel.getObject('lock'));
  f.flow.start();
  assert.equal(f.kernel.player('A').score, 0);
  assert.deepEqual(f.flow.scored('A'), []);
});

test('EG-TURN production cleanup removes an uncontrolled Hidden card to its owner Trash', () => {
  const f = fixture({
    fields: [{ id: 'bf1', controller: 'A' }, { id: 'bf2', controller: null }],
    deck: 2,
    setup: w => w.hand('hidden-card', { owner: 'A', controller: 'A', keywords: [{ id: 'Hidden' }] }),
  });
  const card = f.kernel.getObject('hidden-card');
  let hiddenState = createHiddenState([
    { battlefieldId: 'bf1', controller: 'A' },
    { battlefieldId: 'bf2', controller: null },
  ], 0);
  hiddenState = hideCard(hiddenState, {
    card, player: 'A', battlefieldId: 'bf1', openState: true,
  }).state;
  f.kernel.addObject({ ...card, faceDown: true, zone: 'board',
    location: { type: 'battlefield', id: 'bf1' } }, 'board');
  const moved = f.kernel.getObject('hidden-card');
  assert.ok(moved);
  assert.equal(moved.faceDown, true);
  const cleanupFlow = new TurnFlow({
    host: f.host, player: id => f.kernel.player(id), turnOrder: ['A', 'B'],
    battlefields: [{ id: 'bf1', controller: 'B' }, { id: 'bf2', controller: null }],
    hiddenState,
  });
  cleanupFlow.start();
  const after = f.kernel.getObject('hidden-card');
  assert.equal(after.zone, 'trash');
  assert.equal(after.owner, 'A');
  assert.equal(cleanupFlow.hidden().zones.bf1.cards.length, 0);
});

test('EG-TURN ending invokes the explicit Stun-clear state-owner capability', () => {
  const cleared = [];
  const f = fixture({
    fields: [{ id: 'bf1', controller: 'A' }, { id: 'bf2', controller: null }],
    deck: 2,
    setup: w => w.unit('stunned', { location: { type: 'battlefield', id: 'bf1' }, stunned: true }),
    taskCapabilities: { clearStun: ref => cleared.push(ref.id) },
  });
  f.flow.start();
  f.flow.endTurn('A');
  f.flow.endTurn('B');
  assert.deepEqual(cleared, ['stunned']);
});


test('EG-TURN Rune Pool empties at Main start and at ending without leaving points or resources', () => {
  const f = fixture({
    energy: { A: 3, B: 2 }, power: { A: ['Fury'], B: ['Calm'] }, deck: 2,
    fields: [{ id: 'bf1', controller: 'A' }, { id: 'bf2', controller: null }],
    setup: w => w.unit('u1', { location: { type: 'battlefield', id: 'bf1' }, might: 2 }),
  });
  f.flow.start();
  assert.deepEqual({ energy: f.kernel.player('A').energy, power: f.kernel.player('A').power },
    { energy: 0, power: [] });
  assert.deepEqual({ energy: f.kernel.player('B').energy, power: f.kernel.player('B').power },
    { energy: 0, power: [] });
});

test('EG-TURN Burn Out recycles Trash, awards the opponent, then resumes the actual Draw', () => {
  const f = fixture({
    deck: 0,
    setup: w => w.card('trash-1', { zone: 'trash', owner: 'A' }),
  });
  f.flow.start();
  assert.equal(f.kernel.player('B').score, 1);
  assert.equal(f.kernel.player('A').deckCount, 0);
  assert.equal(f.kernel.player('A').handCount, 1);
  assert.equal(f.kernel.player('A').score, 0);
  const timings = f.flow.chain.pipeline.events.map(event => event.timingPoint);
  assert.ok(timings.includes('points-gained'));
  assert.ok(timings.includes('card-drawn'));
});

test('EG-TURN repeated Burn Out with empty Trash gives successive points and ends immediately at threshold', () => {
  const f = fixture({ deck: 0 });
  f.flow.start();
  assert.equal(f.kernel.player('B').score, 8);
  assert.equal(f.flow.winner, 'B');
  assert.equal(f.kernel.player('A').score, 0);
  const points = f.flow.chain.pipeline.events.filter(event => event.timingPoint === 'points-gained');
  assert.equal(points.length, 8);
});

test('EG-TURN multiple additional turns are inserted after the current turn and later insertions resolve first', () => {
  const queue = new TurnQueue(['A', 'B']);
  assert.deepEqual(queue.current(), { player: 'A', additional: false });
  queue.enqueueAdditional('A', 'time-warp-1');
  queue.enqueueAdditional('B', 'time-warp-2');
  const checkpoint = queue.snapshot();
  assert.deepEqual(queue.next(), { player: 'B', additional: true, sourceInstructionId: 'time-warp-2' });
  assert.deepEqual(queue.next(), { player: 'A', additional: true, sourceInstructionId: 'time-warp-1' });
  assert.deepEqual(queue.next(), { player: 'B', additional: false });

  queue.restore(checkpoint);
  assert.deepEqual(queue.next(), { player: 'B', additional: true, sourceInstructionId: 'time-warp-2' });
  assert.deepEqual(queue.next(), { player: 'A', additional: true, sourceInstructionId: 'time-warp-1' });
  assert.deepEqual(queue.next(), { player: 'B', additional: false });
});

test('EG-TURN default TurnFlow preserves the normal opponent after zero, one, two, and three Additional Turns', () => {
  const sequenceFor = owners => {
    const f = fixture({ deck: 12, rune: 12 });
    f.flow.start();
    const sequence = [{ player: f.flow.turnPlayer, turn: f.flow.turn, additional: false }];
    if (owners.length) {
      f.flow.execute(f.draft('queue-extra', owners.map((owner, index) => ({
        id: `queue-extra-${index}`, op: 'effect.additional-turn',
        args: { owner: c(owner), after: c('this-turn') },
      }))));
      passUntilIdle(f);
    }
    const expected = [...owners].reverse();
    for (const expectedOwner of expected) {
      const player = f.flow.turnPlayer;
      f.flow.endTurn(player);
      passUntilIdle(f);
      assert.equal(f.flow.turnPlayer, expectedOwner);
      sequence.push({ player: f.flow.turnPlayer, turn: f.flow.turn, additional: true });
    }
    f.flow.endTurn(f.flow.turnPlayer);
    passUntilIdle(f);
    assert.equal(f.flow.turnPlayer, 'B');
    assert.equal(f.flow.queuedAdditionalTurns.length, 0);
    sequence.push({ player: f.flow.turnPlayer, turn: f.flow.turn, additional: false });
    return sequence.map(turn => turn.player);
  };

  assert.deepEqual(sequenceFor([]), ['A', 'B']);
  assert.deepEqual(sequenceFor(['A']), ['A', 'A', 'B']);
  assert.deepEqual(sequenceFor(['A', 'B']), ['A', 'B', 'A', 'B']);
  assert.deepEqual(sequenceFor(['A', 'B', 'A']), ['A', 'A', 'B', 'A', 'B']);
});

test('EG-TURN original Time Warp IR executes through the default interpreter and queues one turn', () => {
  const f = fixture();
  const definition = timeWarp.abilities.find(ability => ability.kind === 'play').body;
  const ordered = [];
  const context = bindResolveContext(f.kernel.clone({ sourceSnapshot: f.kernel.getObject('source'), controller: 'A' }), {});
  registerTurnTaskCapability(context.source, {
    version: 'riftbound.turn-task.v1',
    scheduleAdditionalTurn: (owner, source) => ordered.push({ player: owner, additional: true, sourceInstructionId: source }),
  });
  const result = resolveChainBody(definition.slice(0, 1), context);
  assert.equal(result.status, 'executed');
  assert.deepEqual(result.linkedValues, {
    'take-turn-after-this.additionalTurn': { player: 'A', after: 'this-turn' },
  });
  assert.deepEqual(ordered, [{ player: 'A', additional: true, sourceInstructionId: 'effect.additional-turn' }]);
});

test('EG-TURN original Time Warp IR fails closed without the turn-task capability', () => {
  const kernel = world().player('A').player('B').base('source', { might: 4, energy: 0 }).build();
  const context = bindResolveContext(kernel.clone({ sourceSnapshot: kernel.getObject('source'), controller: 'A' }), {});
  const body = timeWarp.abilities.find(ability => ability.kind === 'play').body;
  assert.throws(() => resolveChainBody(body, context), /requires the turn-task capability/);
});

test('EG-TURN real Beginning emits the controller event and kills Temporary before scoring', () => {
  const [ability] = temporary.expand({ host: { canonicalCardId: 'test:temporary-unit' } });
  const f = fixture({
    fields: [{ id: 'bf1', controller: 'A' }, { id: 'bf2', controller: 'A' }],
    deck: 2,
    setup: w => {
      w.unit('temporary', { keywords: [{ id: 'Temporary' }], location: { type: 'battlefield', id: 'bf1' } });
      w.unit('survivor', { location: { type: 'battlefield', id: 'bf2' } });
    },
  });
  f.flow.chain.pipeline.registerTrigger({ id: 'temporary-test', source: f.kernel.getObject('temporary'), controller: 'A', spec: { at: ability.trigger.at, filter: ability.trigger.filter }, body: ability.body });
  const eventStart = f.flow.chain.pipeline.events.length;
  f.flow.start();
  f.flow.pass('A');
  f.flow.pass('B');
  const timings = f.flow.chain.pipeline.events.slice(eventStart).map(event => event.timingPoint);
  assert.ok(timings.indexOf('beginning-start') >= 0);
  assert.ok(timings.indexOf('object-killed') > timings.indexOf('beginning-start'));
  assert.ok(timings.indexOf('score') > timings.indexOf('object-killed'));
  assert.equal(f.kernel.getObject('temporary').zone, 'trash');
  assert.deepEqual(f.flow.scored('A'), ['bf2']);
});

test('EG-TURN real Hold event carries the exact Unit so Hunt XP enters the Chain', () => {
  const f = fixture({
    fields: [{ id: 'bf1', controller: 'A' }, { id: 'bf2', controller: null }],
    deck: 2,
    setup: w => w.unit('hunter', { keywords: [{ id: 'Hunt', value: 2 }],
      location: { type: 'battlefield', id: 'bf1' } }),
  });
  const ability = hunt.expand({ value: 2, host: { canonicalCardId: 'test:hunter' } })
    .find(entry => entry.trigger.at === 'hold');
  assert.ok(ability);
  const filter = translateTriggerFilter(ability.trigger.filter, 'hunter', 'hold');
  f.flow.chain.pipeline.registerTrigger({ id: 'hunt-hold', source: f.kernel.getObject('hunter'),
    controller: 'A', spec: { at: 'hold', filter }, body: ability.body });
  const eventStart = f.flow.chain.pipeline.events.length;
  f.flow.start();
  assert.equal(f.flow.chain.items[0]?.status, 'finalized');
  const hold = f.flow.chain.pipeline.events.slice(eventStart).find(event => event.timingPoint === 'hold');
  assert.ok(hold);
  assert.equal(hold.object?.ref.id, 'hunter');
  assert.equal(hold.source?.ref.id, 'hunter');
  assert.equal(hold.it?.ref.id, 'hunter');
  assert.equal(f.flow.chain.items[0]?.source.ref.id, 'hunter');
  f.flow.pass('A');
  f.flow.pass('B');
  assert.equal(f.flow.chain.items.length, 0);
  assert.equal(f.kernel.player('A').xp, 2);
});

test('EG-TURN Conquer producer captures uncontrolled before-state for every real unit', () => {
  const f = fixture({
    fields: [{ id: 'bf1', controller: null }, { id: 'bf2', controller: null }],
    deck: 2,
    setup: w => {
      w.base('u1', { might: 3 });
      w.base('u2', { might: 2 });
    },
  });
  f.flow.start();
  f.answers.set('move-two/two-units', [
    { id: 'u1', zoneEntryId: f.kernel.ref('u1').zoneEntryId },
    { id: 'u2', zoneEntryId: f.kernel.ref('u2').zoneEntryId },
  ]);
  f.flow.execute(f.draft('enter-two', [{
    id: 'move-two', op: 'effect.move',
    args: {
      objects: c({ kind: 'choose', id: 'two-units', filter: { type: 'unit', zone: 'board', controller: 'A' } }),
      amount: c(2),
      to: c({ type: 'battlefield', id: 'bf1' }),
    },
  }]));
  if (f.flow.chain.items.length) passUntilIdle(f);
  if (f.flow.chain.focus !== null) {
    f.flow.pass(f.flow.chain.focus);
  }
  if (f.flow.chain.focus !== null) {
    f.flow.pass(f.flow.chain.focus);
  }
  const conquer = f.flow.chain.pipeline.events.filter(event => event.timingPoint === 'conquer');
  assert.deepEqual(conquer.map(event => event.object?.ref.id).sort(), ['u1', 'u2']);
  for (const event of conquer) {
    assert.deepEqual(event.details, {
      battlefieldId: 'bf1', objectId: event.object.ref.id, playerId: 'A',
      battlefieldControllerBefore: null,
    });
    assert.equal(event.source?.ref.id, event.object.ref.id);
    assert.equal(event.it?.ref.id, event.object.ref.id);
  }
  assert.equal(f.flow.battlefields[0].controller, 'A');
});

test('EG-TURN Conquer producer preserves an existing controller before Establish Control', () => {
  const f = fixture({
    fields: [{ id: 'bf1', controller: 'B' }, { id: 'bf2', controller: null }],
    deck: 2,
    setup: w => {
      w.unit('u1', { might: 4, location: { type: 'battlefield', id: 'bf1' } });
      w.unit('defender', { owner: 'B', location: { type: 'battlefield', id: 'bf1' }, might: 2 });
    },
  });
  f.flow.start();
  assert.equal(f.flow.chain.focus, 'A');
  f.flow.chain.pass('A');
  f.flow.chain.pass('B');
  assert.equal(f.flow.chain.turnState, 'neutral-open');
  f.flow.combat.prepareDamage();
  f.flow.combat.submitAttackerDamage('A', [{ uid: 'defender', amount: 4 }]);
  f.flow.combat.submitDefenderDamage('B', [{ uid: 'u1', amount: 2 }]);
  if (f.flow.chain.items.length) passUntilIdle(f);
  for (let index = 0; index < 8 && f.flow.combat.current?.step !== 'control'; index++) {
    f.flow.advance();
    if (f.flow.chain.items.length) passUntilIdle(f);
  }
  assert.equal(f.flow.chain.priority, 'A');
  f.flow.advance();
  const conquer = f.flow.chain.pipeline.events.filter(event => event.timingPoint === 'conquer');
  assert.equal(conquer.length, 1);
  assert.equal(conquer[0].details.battlefieldControllerBefore, 'B');
  assert.equal(conquer[0].object?.ref.id, 'u1');
});


test('EG-TURN Conquer before-state survives scoring ACK pause and resume', () => {
  const f = fixture({
    fields: [{ id: 'bf1', controller: null }, { id: 'bf2', controller: null }],
    deck: 2,
    setup: w => w.base('u1', { might: 3 }),
  });
  f.flow.start();
  f.answers.set('enter-wait/move-wait/wait-unit', [{ id: 'u1', zoneEntryId: f.kernel.ref('u1').zoneEntryId }]);
  f.answers.set('move-wait/wait-unit', [{ id: 'u1', zoneEntryId: f.kernel.ref('u1').zoneEntryId }]);
  f.flow.execute(f.draft('enter-wait', [{
    id: 'move-wait', op: 'effect.move',
    args: { objects: c({ kind: 'choose', id: 'wait-unit', filter: { type: 'unit', zone: 'board', controller: 'A' } }),
      to: c({ type: 'battlefield', id: 'bf1' }) },
  }]));
  assert.equal(f.flow.chain.items.length, 1);
  f.flow.pass('A');
  f.flow.pass('B');
  assert.equal(f.flow.chain.focus, 'A');
  f.flow.pass('A');
  f.flow.pass('B');
  if (f.flow.chain.items.length) passUntilIdle(f);
  const conquer = f.flow.chain.pipeline.events.filter(event => event.timingPoint === 'conquer');
  assert.equal(conquer.length, 1);
  assert.equal(conquer[0].details.battlefieldControllerBefore, null);
  assert.equal(f.flow.battlefields[0].controller, 'A');
});

test('EG-TURN original corrected Yone IR registers its conquer consumer without admitting the card', () => {
  const trigger = yoneBlademaster.abilities.find(ability => ability.kind === 'triggered');
  assert.equal(yoneBlademaster.canonicalCardId,
    'card.hash-292f685c7578235f29f2c362a52c7975eafab592cc437e2445ca68309b294c56');
  assert.deepEqual(trigger.trigger.filter, { self: true, battlefieldWas: 'uncontrolled' });
  assert.equal(yoneBlademaster.sourceText.includes('battlefield that was uncontrolled'), true);
});

test('EG-TURN Conquer before-state is captured before Establish Control', () => {
  const f = fixture({
    fields: [{ id: 'bf1', controller: null }, { id: 'bf2', controller: null }],
    deck: 2,
    setup: w => w.base('u1', { might: 3 }),
  });
  const combat = f.flow.combat;
  const establish = combat.establish.bind(combat);
  let beforeStateCaptured = false;
  const originalSchedule = f.flow.scheduleScore.bind(f.flow);
  Object.defineProperty(f.flow, 'scheduleScore', {
    value(player, field, method) {
      if (method === 'conquer') beforeStateCaptured = true;
      return originalSchedule(player, field, method);
    },
  });
  Object.defineProperty(combat, 'establish', {
    value(player, field) {
      assert.equal(beforeStateCaptured, true, 'before-state must be captured before establish');
      return establish(player, field);
    },
  });
  f.answers.set('move/unit', [{ id: 'u1', zoneEntryId: f.kernel.ref('u1').zoneEntryId }]);
  f.flow.start();
  f.flow.execute(f.draft('enter', [{
    id: 'move', op: 'effect.move', args: { objects: c({ target: 'unit' }), to: c({ type: 'battlefield', id: 'bf1' }) },
    targets: [{ id: 'unit', filter: { objectId: 'u1', zone: 'board' }, min: 1, max: 1 }],
  }]));
  if (f.flow.chain.items.length) passUntilIdle(f);
  const conquer = f.flow.chain.pipeline.events.find(event => event.timingPoint === 'conquer');
  assert.equal(conquer.details.battlefieldControllerBefore, null);
});

