// RIFT-1052: a Combat Showdown may close after a Unit leaves, so the Damage
// Step must be skipped when fewer than two designated sides remain.
//
// Official evidence: Core Rules v1.5 (2026-10-09, effective 2026-10-16),
// https://cmsassets.rgpub.io/sanity/files/dsfx7636/news_live/5c7946f7c3b8c6e0faff85ab6dadc6d2e721ea94.pdf
// CR 467.1 gates the Damage Step on both Attacking and Defending Units still
// being present; CR 467.3 then proceeds to Resolution; CR 468.1-468.7 owns the
// special Cleanup, result, control, and end tasks. Core Rules Radiance patch
// (effective 2026-10-16),
// https://playriftbound.com/en-us/news/announcements/core-rules-radiance-patch-notes-effective-october-16-2026/
// is the current effective-rules notice used by the production regression.

import assert from 'node:assert/strict';
import test from 'node:test';

import fallingComet from '../../../card-dsl/dist/cards/ogn/falling-comet.js';
import { AwaitChoice } from '../../dist/effects/contract.js';
import { world } from '../../dist/effects/testing/index.js';
import { bindResolveContext, createActionPipelineHost } from '../../dist/events/action-adapter.js';
import { createProgramBinding } from '../../dist/programs/index.js';
import { TurnFlow } from '../../dist/turn/flow.js';

const COMBAT_FIELD = { type: 'battlefield', id: 'combat-field' };
const OTHER_FIELD = { type: 'battlefield', id: 'other-field' };
const COMET_CARD = fallingComet.canonicalCardId;
const COMET_PRINTED = Object.freeze({
  id: 'ogn-085-298',
  canonicalCardId: COMET_CARD,
  cardType: 'Spell',
  domains: Object.freeze(['Mind']),
  energy: 5,
  power: null,
});

function productionFixture() {
  const kernel = world().player('A').player('B', { energy: 5 })
    .deck(['a:deck:0', 'a:deck:1', 'a:deck:2', 'a:deck:3'], { owner: 'A' })
    .deck(['b:deck:0', 'b:deck:1', 'b:deck:2', 'b:deck:3'], { owner: 'B' })
    .object('combat-field-card', {
      types: ['battlefield'], zone: 'board', location: COMBAT_FIELD,
      owner: 'B', controller: 'B', might: null, energy: null, power: null,
    })
    .object('other-field-card', {
      types: ['battlefield'], zone: 'board', location: OTHER_FIELD,
      owner: 'A', controller: null, might: null, energy: null, power: null,
    })
    .hand('comet', {
      cardId: COMET_CARD, name: fallingComet.sourceText,
      types: ['spell'], energy: 5, power: null, might: null,
    })
    .unit('attacker', {
      owner: 'A', controller: 'A', might: 4, location: { type: 'base', player: 'A' },
      energy: null, power: null,
    })
    .unit('defender', {
      owner: 'B', controller: 'B', might: 2, location: { type: 'base', player: 'B' },
      energy: null, power: null,
    })
    .base('attacker-source', { owner: 'A', controller: 'A', might: 1, energy: null, power: null })
    .base('defender-source', { owner: 'B', controller: 'B', might: 1, energy: null, power: null })
    .build();

  const requests = [];
  const choose = request => {
    requests.push(request);
    if (request.type === 'select-objects' && request.id === 'target:falling-comet.unit') {
      return request.options.filter(ref => ref.id === 'defender');
    }
    if (request.type === 'select-objects' && request.min === request.max &&
        request.options.length === request.min) return [...request.options];
    if (request.type === 'mode') return request.options[0];
    if (request.type === 'order') return [...request.options];
    throw new AwaitChoice(request);
  };
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: saved => { kernel.restore(saved.state); kernel.copyLinkedFrom(saved.links); },
    objects: () => kernel.objects,
    perform: action => kernel.perform(action),
    performContract: action => kernel.performContract(action),
    performBatchLeaf: (action, id) => kernel.performBatchLeafForCapability(action, id),
    choose,
    context: (source, controller, timingPoint) => bindResolveContext(kernel, {
      source, controller, timingPoint, choose,
    }),
    testTrigger: registration => kernel.test(registration.spec.condition),
  });
  const binding = createProgramBinding({
    cardPrograms: [fallingComet],
    printedCatalog: [{ ...COMET_PRINTED, canonicalCardId: COMET_CARD }],
  });
  const flow = new TurnFlow({
    host: { ...host, player: id => kernel.player(id) },
    player: id => kernel.player(id),
    turnOrder: ['A', 'B'],
    battlefields: [
      { id: COMBAT_FIELD.id, controller: 'B' },
      { id: OTHER_FIELD.id, controller: null },
    ],
    victoryScore: 20,
    describePlay: binding.describePlay,
  });
  flow.chain.initializeBattlefieldControl([
    { id: COMBAT_FIELD.id, controller: 'B' },
    { id: OTHER_FIELD.id, controller: null },
  ]);
  binding.attachLifecycle(flow.chain, error => { throw error; });
  flow.start();
  for (let guard = 0; flow.phase !== 'main' && guard < 100; guard++) {
    if (flow.chain.items.length) flow.pass(flow.chain.priority);
    else flow.advance();
  }
  assert.equal(flow.phase, 'main', 'the production setup completes its Main entry');
  assert.equal(flow.turnPlayer, 'A', 'the production setup enters the first Main');
  assert.equal(flow.chain.priority, 'A');
  assert.equal(fallingComet.status, 'executable');
  assert.equal(flow.chain.commit({ type: 'gain-energy', player: 'B', amount: 5 }).status, 'done');
  assert.equal(kernel.player('B').energy, 5);

  // Reach the Combat through committed Board Moves after the game has entered
  // Main, matching the headless M1 path rather than freezing setup in a
  // pre-existing engagement.
  assert.equal(flow.chain.commit({ type: 'move-location', object: kernel.ref('defender'),
    to: COMBAT_FIELD }).status, 'done');
  flow.advance();
  assert.equal(flow.chain.commit({ type: 'move-location', object: kernel.ref('attacker'),
    to: COMBAT_FIELD }).status, 'done');
  flow.advance();
  assert.equal(flow.turnPlayer, 'A');
  assert.equal(flow.chain.turnState, 'showdown-open');
  return { kernel, binding, flow, requests };
}

function settleChain(flow) {
  for (let guard = 0; flow.chain.items.length; guard++) {
    assert.ok(guard < 30, 'the production Chain settles');
    assert.ok(flow.chain.priority, 'a finalized item keeps its Priority owner');
    flow.pass(flow.chain.priority);
  }
}

test('RIFT-1052 production Combat skips damage when its defender leaves during Showdown', () => {
  const { kernel, binding, flow, requests } = productionFixture();
  assert.equal(flow.combat.current?.step, 'showdown');
  assert.equal(flow.combat.current?.attacker, 'B');
  assert.equal(flow.combat.current?.defender, 'A');
  assert.equal(flow.chain.focus, 'B');

  const comet = kernel.getObject('comet');
  const cometDraft = binding.describePlay({ type: 'play', player: 'B', object: comet.ref }, comet);
  flow.execute(cometDraft);
  settleChain(flow);
  assert.equal(kernel.getObject('defender').zone, 'trash');
  assert.equal(kernel.getObject('defender').damage, 6);
  assert.ok(requests.some(request => request.id === 'target:falling-comet.unit' &&
    request.options.some(ref => ref.id === 'defender')));
  assert.equal(flow.combat.current?.step, 'showdown');

  for (let guard = 0; flow.combat.active && flow.chain.turnState === 'showdown-open' && guard < 4; guard++) {
    const focus = flow.chain.focus;
    assert.ok(focus);
    flow.pass(focus);
  }
  for (let guard = 0; flow.combat.active && guard < 12; guard++) {
    if (flow.chain.items.length) settleChain(flow);
    else flow.advance();
  }
  const events = () => flow.chain.pipeline.events;
  assert.equal(events().some(event => event.timingPoint === 'damage-dealt' &&
    event.details?.combat === true), false, 'CR 467.1 forbids a one-sided Combat Damage Step');
  assert.equal(events().filter(event => event.timingPoint === 'showdown-close').length, 1);
  assert.equal(events().filter(event => event.timingPoint === 'combat-result').length, 1);
  const result = events().find(event => event.timingPoint === 'combat-result');
  assert.equal(result?.details?.noResult, false, 'CR 468.3: one side remains');
  assert.equal(result?.details?.winnerId, 'A', 'the only side remaining wins the Combat');
  assert.equal(result?.details?.loserId, 'B');
  assert.equal(flow.combat.active, false);
  assert.equal(flow.battlefields.find(field => field.id === COMBAT_FIELD.id)?.controller, 'A',
    'CR 468.5.d: the remaining Defender establishes Control and begins Conquer');
  assert.deepEqual(kernel.getObject('attacker').location, COMBAT_FIELD,
    'CR 468.1.a.2 does not recall a sole side when no Defenders remain');
  assert.equal(kernel.player('A').score, 1);
  assert.equal(kernel.player('B').score, 0);
});
