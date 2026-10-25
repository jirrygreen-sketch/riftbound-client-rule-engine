// RIFT-1067: Rumble's leading may is accepted at Finalize, then its recycle
// cost has no eligible unit. Core Rules v1.5 (published 2026-10-09, effective
// 2026-10-16; https://cmsassets.rgpub.io/sanity/files/dsfx7636/news_live/
// 5c7946f7c3b8c6e0faff85ab6dadc6d2e721ea94.pdf) says:
// - 383.3.a: the controller decides the leading may during Finalize.
// - 383.3.b.1 / 404.1.b.1: the following cost within instructions is the base
//   cost and must be paid to finalize the triggered ability.
// - 403.4: a Triggered Ability already on the Chain with too few legal choices
//   is removed without becoming Finalized; 403.4.a says this is not a counter.
// Rumble, Hotheaded is canonical card.hash-11c889b9d655c822e7ce3ec82c5a5f1e2d716ac6d3c2ed6fb9bb7b22c32ce870.
// Minefield is canonical card.hash-0c36f22df8ffa7bed49f59fd138d24b9b0a52a7b8ad4c720afcaa12ec816eee4.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { cardPrograms } from '../../../card-dsl/dist/cards/registry.generated.js';
import minefield from '../../../card-dsl/dist/cards/sfd/minefield.js';
import rumbleHotheaded from '../../../card-dsl/dist/cards/sfd/rumble-hotheaded.js';
import { CostPlanError } from '../../dist/cost/plan-types.js';
import { AwaitChoice } from '../../dist/effects/contract.js';
import { world } from '../../dist/effects/testing/index.js';
import { bindResolveContext, createActionPipelineHost } from '../../dist/events/action-adapter.js';
import { createMatch } from '../../dist/game/lifecycle.js';
import { createProgramBinding } from '../../dist/programs/index.js';
import { fixture } from '../chain/helpers.mjs';

const RULES = Object.freeze({
  version: '1.5',
  published: '2026-10-09',
  effective: '2026-10-16',
  clauses: ['383.3.a', '383.3.b.1', '403.4', '403.4.a', '404.1.b.1'],
});
const PLAN_URL = new URL('../../../../docs/plans/m1-decks.json', import.meta.url);
const CATALOG_URL = new URL('../../../card-data/data/deck-catalog.json', import.meta.url);
const plan = JSON.parse(readFileSync(PLAN_URL, 'utf8'));
const catalog = JSON.parse(readFileSync(CATALOG_URL, 'utf8'));
const catalogById = new Map(catalog.cards.map(card => [card.canonicalCardId, card]));
const printedCatalog = [...catalogById.values()];
const RUMBLE = rumbleHotheaded.canonicalCardId;
const MINEFIELD = minefield.canonicalCardId;
const BREAKNECK = 'card.hash-cb2ea7576d42c76d8ecf8fa3cdb082f007639b144aecc69402230df6bcc131ab';
const constant = value => ({ kind: 'constant', value });

function preconDeck(id, seat) {
  const candidate = plan.candidates.find(entry => entry.id === id);
  assert.ok(candidate, `M1 precon ${id} exists`);
  const entries = zone => candidate.recommendedCardList.filter(entry => entry.zone === zone);
  const expand = zone => entries(zone).flatMap(entry => {
    const printed = catalogById.get(entry.canonicalCardId);
    assert.ok(printed, `trusted catalog row for ${entry.name}`);
    return Array.from({ length: entry.quantity }, (_, index) => ({
      id: `${seat}:${zone}:${index}:${entry.canonicalCardId}`,
      cardId: printed.id,
      canonicalCardId: entry.canonicalCardId,
      name: printed.name,
      cardType: printed.cardType,
      types: [printed.cardType.toLowerCase()],
      tags: printed.tags,
      domains: printed.domains,
      energy: printed.energy,
      power: printed.power,
      might: printed.might,
    }));
  });
  const legends = expand('legend');
  const champions = expand('champion');
  const battlefields = expand('battlefields');
  assert.equal(legends.length, 1);
  assert.equal(champions.length, 1);
  assert.equal(battlefields.length, 3);
  return {
    mainDeck: expand('mainDeck'),
    runeDeck: expand('runes'),
    championLegend: legends[0],
    chosenChampion: champions[0],
    battlefields,
  };
}

function impossibleRecycleCost() {
  return {
    id: 'cost:RIFT-1067-recycle',
    cost: {
      energy: constant(0),
      payments: [{
        kind: 'recycle',
        choice: {
          id: 'RIFT-1067.trash-unit',
          options: [],
          filter: { zone: 'trash', controller: 'controller', type: 'unit' },
          min: 1,
          max: 1,
          selection: 'one',
        },
      }],
    },
  };
}

function settleProduction(flow) {
  for (let guard = 0; guard < 200; guard++) {
    if (flow.chain.items.some(item => item.status === 'pending')) {
      flow.advance();
      continue;
    }
    if (flow.chain.items.length) {
      assert.ok(flow.chain.priority, 'a Finalized Chain item grants Priority');
      flow.pass(flow.chain.priority);
      continue;
    }
    if (flow.chain.focus !== null) {
      flow.pass(flow.chain.focus);
      continue;
    }
    if (flow.combat.active) {
      flow.advance();
      continue;
    }
    return;
  }
  throw new Error('RIFT-1067 production Conquer did not settle');
}

test('RIFT-1067 real Rumble precon removes an unpayable Finalize may, then Minefield resolves', () => {
  assert.deepEqual(RULES, {
    version: '1.5',
    published: '2026-10-09',
    effective: '2026-10-16',
    clauses: ['383.3.a', '383.3.b.1', '403.4', '403.4.a', '404.1.b.1'],
  });
  const kernel = world().player('A').player('B').build();
  const asked = [];
  let rumbleRef;
  const choose = request => {
    asked.push(structuredClone(request));
    if (request.type === 'optional') return true;
    if (request.type === 'mode' && request.id.includes(':order:')) {
      const rumbleOption = request.options.find(option => rumbleRef !== undefined &&
        option.startsWith(`program:${rumbleRef.id}:${rumbleRef.zoneEntryId}:`));
      return rumbleOption ?? request.options[0];
    }
    if (request.type === 'select-objects' && request.id === 'target:rumble.mech-in-trash') {
      return request.options.filter(ref => kernel.getObject(ref.id).cardId === BREAKNECK);
    }
    if (request.type === 'select-objects' && request.id.endsWith(':pick:rumble.fodder')) {
      throw new Error('RIFT-1067 must not ask for a recycle object when the candidate set is empty');
    }
    if (request.type === 'mode') return request.options[0];
    if (request.type === 'select-objects' && request.min === request.max && request.options.length === request.min) {
      return [...request.options];
    }
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
    testTrigger: registration => kernel.test(registration.spec.condition),
  });
  host.player = id => kernel.player(id);
  const binding = createProgramBinding({ cardPrograms, printedCatalog });
  const match = createMatch({
    host,
    decks: [preconDeck('rumble-sfd', 'A'), preconDeck('fiora-sfd', 'B')],
    programs: binding,
    seed: 'RIFT-990-m1-seed-014',
    battlefieldChoice: [0, 0],
    mulligans: [[], []],
    firstPlayer: 0,
    victoryScore: 20,
  });
  const lifecycle = binding.attachLifecycle(match.flow.chain, error => { throw error; });
  try {
    const minefieldObject = kernel.objects.find(object => object.cardId === MINEFIELD && object.zone === 'board');
    assert.ok(minefieldObject, 'the real Rumble precon put Minefield on the Board');
    assert.equal(minefieldObject.location?.type, 'battlefield');
    const minefieldId = minefieldObject.location.id;
    assert.ok(match.flow.chain.pipeline.registeredTriggers().some(registration =>
      registration.source.ref.id === minefieldObject.ref.id && registration.spec.at === 'conquer'));

    const rumbleCard = kernel.objects.find(object => object.owner === 'A' && object.zone === 'deck' &&
      object.cardId === RUMBLE && object.types.includes('unit'));
    const trashMech = kernel.objects.find(object => object.owner === 'A' && object.zone === 'deck' &&
      object.cardId === BREAKNECK && object.types.includes('unit'));
    assert.ok(rumbleCard, 'the real Rumble precon contains a Main Deck Rumble card');
    assert.ok(trashMech, 'the real Rumble precon contains a Main Deck Breakneck Mech');
    assert.equal(match.flow.chain.commit({
      type: 'move-zone', object: rumbleCard.ref, to: 'hand',
    }).status, 'done');
    assert.equal(match.flow.chain.commit({
      type: 'move-zone', object: trashMech.ref, to: 'trash',
    }).status, 'done');
    assert.equal(match.flow.chain.commit({ type: 'gain-energy', player: 'A', amount: 10 }).status, 'done');
    const handRumble = kernel.getObject(rumbleCard.ref.id);
    assert.equal(handRumble.zone, 'hand');
    match.flow.execute(binding.describePlay(
      { type: 'play', player: 'A', object: handRumble.ref }, handRumble,
    ));
    settleProduction(match.flow);
    const playedRumble = kernel.getObject(rumbleCard.ref.id);
    rumbleRef = playedRumble.ref;
    assert.equal(playedRumble.zone, 'board');
    assert.deepEqual(playedRumble.location, { type: 'base', player: 'A' });
    assert.equal(match.flow.chain.pipeline.registeredTriggers().some(registration =>
      registration.source.ref.id === rumbleRef.id && registration.source.ref.zoneEntryId === rumbleRef.zoneEntryId),
    true, 'play lifecycle binds the played Rumble incarnation');
    assert.equal(kernel.objects.filter(object => object.zone === 'board' && object.types.includes('unit') &&
      object.owner === 'A').length, 1, 'Rumble is the only friendly Unit, so it cannot recycle itself');

    match.flow.endTurn('A');
    settleProduction(match.flow);
    assert.equal(match.flow.turnPlayer, 'B');
    match.flow.endTurn('B');
    settleProduction(match.flow);
    assert.equal(match.flow.turnPlayer, 'A');
    assert.equal(kernel.getObject(rumbleRef.id).exhausted, false);

    const deckBefore = kernel.objectsInZone('A', 'deck').map(ref => ref.id);
    const trashBefore = kernel.objectsInZone('A', 'trash').map(ref => ref.id);
    match.flow.move('A', kernel.getObject(rumbleRef.id).ref, minefieldId);
    while (match.flow.combat.current?.step === 'showdown') {
      assert.ok(match.flow.chain.focus);
      match.flow.pass(match.flow.chain.focus);
    }
    settleProduction(match.flow);

    const orderRequest = asked.find(request => request.type === 'mode' && request.id.includes(':order:'));
    assert.ok(orderRequest, 'the simultaneous Conquer wave asks for legal trigger order');
    assert.equal(orderRequest.options.includes(`program:${rumbleRef.id}:${rumbleRef.zoneEntryId}:1`), true);
    assert.ok(asked.some(request => request.id === 'finalize:trigger:1:optional'));
    assert.ok(asked.some(request => request.id === 'target:rumble.mech-in-trash'));
    assert.equal(asked.some(request => request.id.endsWith(':pick:rumble.fodder')), false);

    const lifecycleTrace = item => match.flow.chain.trace
      .filter(entry => entry.item === item)
      .map(entry => `${entry.step}${entry.reason === undefined ? '' : `(${entry.reason})`}`);
    assert.deepEqual(lifecycleTrace('trigger:1'), ['pending', 'removed(unperformable-trigger)']);
    assert.deepEqual(lifecycleTrace('trigger:2'), [
      'pending', 'finalize-start', 'finalized', 'resolve-start', 'resolved', 'removed(resolved)',
    ]);
    assert.equal(match.flow.chain.trace.some(entry => entry.item === 'trigger:1' && entry.reason === 'countered'), false);
    assert.equal(match.flow.chain.trace.some(entry => entry.item === 'trigger:2' && entry.step === 'finalized'), true);
    assert.equal(match.flow.chain.items.length, 0);

    const deckAfter = kernel.objectsInZone('A', 'deck').map(ref => ref.id);
    const trashAfter = kernel.objectsInZone('A', 'trash').map(ref => ref.id);
    assert.equal(deckAfter.length, deckBefore.length - 2, 'Minefield still burns two cards');
    assert.deepEqual(trashAfter, [...trashBefore, ...deckBefore.slice(0, 2)],
      'Minefield resolve, rather than Rumble, produces the committed burn');
    assert.equal(kernel.getObject(trashMech.ref.id).zone, 'trash',
      'the failed may never plays or recycles its selected Mech');
    assert.deepEqual(kernel.getObject(rumbleRef.id).location, { type: 'battlefield', id: minefieldId });
  } finally {
    lifecycle.detach();
  }
});

test('RIFT-1067 keeps direct Play and non-may invalid costs fail-closed', () => {
  const direct = fixture({ cards: [{ id: 'spell', types: ['spell'], energy: 0, power: [] }] });
  assert.throws(
    () => direct.engine.execute(direct.card('spell', { cost: impossibleRecycleCost() })),
    error => error instanceof CostPlanError && error.reason === 'invalid-cost-plan' &&
      error.message === 'Cost choice cannot be completed from the current zone',
  );
  assert.equal(direct.kernel.getObject('spell').zone, 'hand');

  const ordinaryTrigger = fixture();
  ordinaryTrigger.engine.pipeline.registerTrigger({
    id: 'RIFT-1067-non-may',
    source: ordinaryTrigger.kernel.getObject('source'),
    controller: 'A',
    spec: { at: 'card-drawn', filter: { event: 'card-drawn' } },
    body: [],
    cost: impossibleRecycleCost(),
  });
  ordinaryTrigger.engine.commit({ type: 'draw', player: 'A', amount: 1 });
  assert.throws(
    () => ordinaryTrigger.engine.advance(),
    error => error instanceof CostPlanError && error.reason === 'invalid-cost-plan',
    'the CR 403.4 adapter stays scoped to triggered Finalize may costs',
  );
});
