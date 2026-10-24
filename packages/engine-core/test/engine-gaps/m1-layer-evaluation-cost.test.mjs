// RIFT-1041: layer evaluation keeps the CR 478.1-478.4 fixed point while
// removing repeated whole-board work around it. The fixture drives the real
// ProgramBinding -> ChainEngine/TurnFlow lifecycle and the same full M1 decks
// used by the headless runner; it is a cost regression, not a second rules
// implementation.
//
// Core Rules v1.5 (published 2026-10-09):
// https://cmsassets.rgpub.io/sanity/files/dsfx7636/news_live/5c7946f7c3b8c6e0faff85ab6dadc6d2e721ea94.pdf
// 478.1.a-c require dependencies to be evaluated and loops to use the minimum
// dependent set; 478.2-478.4 require each effect to apply once with separate
// disqualification; 479 defines Copy, Trait, Ability and Arithmetic layers;
// 480-482 define dependency and timestamp ordering. M1 sources covering these
// paths include Rumble, Hotheaded
// card.hash-11c889b9d655c822e7ce3ec82c5a5f1e2d716ac6d3c2ed6fb9bb7b22c32ce870
// and Fiora, Peerless
// card.hash-6bde2e2c542ff8fc1a7a2f9204df7e6c58a05a53ad98c0a31d69927be053b77f.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { cardPrograms } from '../../../card-dsl/dist/cards/registry.generated.js';
import { bindResolveContext, createActionPipelineHost } from '../../dist/events/action-adapter.js';
import { world } from '../../dist/effects/testing/index.js';
import { createMatchCommandAdapter } from '../../dist/game/command-adapter.js';
import { createMatch } from '../../dist/game/lifecycle.js';
import { createProgramBinding } from '../../dist/programs/index.js';

const PLAN_URL = new URL('../../../../docs/plans/m1-decks.json', import.meta.url);
const CATALOG_URL = new URL('../../../card-data/data/deck-catalog.json', import.meta.url);
const plan = JSON.parse(readFileSync(PLAN_URL, 'utf8'));
const catalog = JSON.parse(readFileSync(CATALOG_URL, 'utf8'));
const catalogById = new Map(catalog.cards.map(card => [card.canonicalCardId, card]));

function deck(id, seat) {
  const candidate = plan.candidates.find(value => value.id === id);
  assert.ok(candidate, `M1 deck ${id} exists`);
  const zone = name => candidate.recommendedCardList.filter(entry => entry.zone === name);
  const cards = name => zone(name).flatMap(entry => {
    const source = catalogById.get(entry.canonicalCardId);
    assert.ok(source, `catalog row for ${entry.name}`);
    return Array.from({ length: entry.quantity }, (_, index) => ({
      id: `${seat}:${name}:${index}:${entry.canonicalCardId}`,
      cardId: source.id,
      canonicalCardId: entry.canonicalCardId,
      name: source.name,
      cardType: source.cardType,
      types: [source.cardType.toLowerCase()],
      tags: source.tags,
      domains: source.domains,
      energy: source.energy,
      power: source.power,
      might: source.might,
    }));
  });
  const legends = cards('legend');
  const champions = cards('champion');
  const battlefields = cards('battlefields');
  assert.equal(legends.length, 1);
  assert.equal(champions.length, 1);
  assert.equal(battlefields.length, 3);
  return { mainDeck: cards('mainDeck'), runeDeck: cards('runes'),
    championLegend: legends[0], chosenChampion: champions[0], battlefields };
}

function setup(seed) {
  const kernel = world().player('A').player('B').build();
  let choose = () => { throw new Error('Choice requested before host installation'); };
  let hostObjectsReads = 0;
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: saved => {
      kernel.restore(saved.state);
      kernel.copyLinkedFrom(saved.links);
    },
    objects: () => { hostObjectsReads++; return kernel.objects; },
    perform: action => kernel.perform(action),
    performContract: action => kernel.performContract(action),
    performBatchLeaf: (action, batchId) => kernel.performBatchLeafForCapability(action, batchId),
    choose: request => choose(request),
    context: (source, controller, timingPoint) => bindResolveContext(kernel, { source, controller, timingPoint, choose }),
  });
  const binding = createProgramBinding({ cardPrograms });
  const match = createMatch({
    host: { ...host, player: id => kernel.player(id) },
    decks: [deck('rumble-sfd', 'A'), deck('fiora-sfd', 'B')],
    programs: binding,
    seed,
    battlefieldChoice: [1, 1],
    mulligans: [[], []],
    firstPlayer: 0,
  });
  // createMatch already attached the binding's real lifecycle. Count only
  // layer work after that setup boundary.
  hostObjectsReads = 0;
  return { kernel, binding, match, hostObjectsReads: () => hostObjectsReads,
    setChoose: value => { choose = value; } };
}

function answerFor(request) {
  if (request.type === 'optional') return true;
  if (request.type === 'select-objects') {
    return request.options.slice(0, Math.max(request.min, 1)).map(ref => ({
      objectId: ref.id, zoneEntryId: ref.zoneEntryId,
    }));
  }
  if (request.type === 'mode') return request.options[0];
  if (request.type === 'order') return [...request.options];
  return request.min;
}

function endTurn(adapter, prefix) {
  for (let step = 0; step < 300; step++) {
    if (adapter.pendingChoice !== null) {
      const request = adapter.pendingChoice.request;
      adapter.execute(request.chooser, {
        type: 'choose', commandId: `${prefix}:choice:${step}`, stateVersion: adapter.stateVersion,
        choiceId: request.id, answer: answerFor(request),
      });
      continue;
    }
    const chain = adapter.match.flow.chain;
    if (chain.items.length) {
      assert.ok(chain.priority, `${prefix} has a Priority holder`);
      adapter.execute(chain.priority, {
        type: 'pass', commandId: `${prefix}:pass:${step}`, stateVersion: adapter.stateVersion,
      });
      continue;
    }
    assert.equal(adapter.match.flow.phase, 'main', `${prefix} reached Main`);
    adapter.match.flow.endTurn(adapter.match.flow.turnPlayer);
    return;
  }
  assert.fail(`${prefix} ends through production Pass and TurnFlow`);
}

test('RIFT-1041 a new host boundary invalidates cached attachment facts', () => {
  const fixture = setup('RIFT-1041-layer-invalidation');
  const layers = fixture.match.flow.chain.layers;
  const mech = fixture.kernel.objects.find(object => object.owner === 'A' && object.zone === 'deck' &&
    object.tags.includes('Mech'));
  const gear = fixture.kernel.objects.find(object => object.owner === 'A' && object.zone === 'deck' &&
    object.types.includes('gear') && object.tags.includes('Equipment') && object.might !== null);
  assert.ok(mech, 'the precon contains a printed Mech');
  assert.ok(gear, 'the precon contains a printed Equipment bonus');
  const hostile = { ...mech, ref: { id: 'hostile-boundary', zoneEntryId: 1 }, zone: 'board',
    location: { type: 'base', player: 'A' }, attachedTo: null };
  const attached = { ...gear, ref: { id: 'attachment-boundary', zoneEntryId: 1 }, zone: 'board',
    location: { type: 'base', player: 'A' }, attachedTo: { ...hostile.ref } };
  layers.setObjects([hostile]);
  assert.equal(layers.evaluate(hostile.ref).might, hostile.might, 'no attachment on the first host view');
  layers.setObjects([hostile, attached]);
  assert.equal(layers.evaluate(hostile.ref).might, hostile.might + attached.might,
    'the next exact host boundary applies the Equipment Might Bonus');
  layers.setObjects([hostile]);
  assert.equal(layers.evaluate(hostile.ref).might, hostile.might,
    'a later boundary removing the attachment invalidates the prior layered result');
});

test('RIFT-1041 an in-place raw attachment mutation invalidates attachment facts', () => {
  const fixture = setup('RIFT-1041-layer-in-place');
  const layers = fixture.match.flow.chain.layers;
  const mech = fixture.kernel.objects.find(object => object.owner === 'A' && object.zone === 'deck' &&
    object.tags.includes('Mech'));
  const gear = fixture.kernel.objects.find(object => object.owner === 'A' && object.zone === 'deck' &&
    object.types.includes('gear') && object.tags.includes('Equipment') && object.might !== null);
  assert.ok(mech, 'the precon contains a printed Mech');
  assert.ok(gear, 'the precon contains a printed Equipment bonus');
  const host = { ...mech, ref: { id: 'mutable-host', zoneEntryId: 1 }, zone: 'board',
    location: { type: 'base', player: 'A' }, attachedTo: null };
  const attachment = { ...gear, ref: { id: 'mutable-attachment', zoneEntryId: 1 }, zone: 'board',
    location: { type: 'base', player: 'A' }, attachedTo: { ...host.ref } };
  layers.setObjects([host, attachment]);
  assert.equal(layers.evaluate(host.ref).might, host.might + attachment.might, 'attachment starts active');
  attachment.attachedTo = null;
  assert.equal(layers.evaluate(host.ref).might, host.might,
    'an in-place detachment cannot reuse the prior attachment cache');
});

test('RIFT-1041 real M1 turns keep layer evaluation count and work within budget', () => {
  const fixture = setup('RIFT-1041-layer-cost');
  fixture.setChoose(request => answerFor(request));
  const adapter = createMatchCommandAdapter({ match: fixture.match, stateVersion: 0 });
  const chain = fixture.match.flow.chain;
  const evaluateAll = chain.layers.evaluateAll.bind(chain.layers);
  const evaluations = { topLevel: 0, nested: 0 };
  chain.layers.evaluateAll = () => {
    if (chain.layers.inEvaluation) evaluations.nested++;
    else evaluations.topLevel++;
    return evaluateAll();
  };
  const start = Date.now();
  const players = [];
  for (let turn = 0; turn < 2; turn++) {
    endTurn(adapter, `RIFT-1041:turn-${turn}`);
    players.push(fixture.match.flow.turnPlayer);
  }
  const elapsedMs = Date.now() - start;
  assert.equal(new Set(players).size, 2, 'TurnFlow passes turn control between the real seats');
  assert.ok(evaluations.topLevel < 6000, `top-level layer passes remain bounded (${evaluations.topLevel})`);
  assert.ok(evaluations.nested < 120_000, `nested layer reads remain bounded (${evaluations.nested})`);
  assert.ok(fixture.hostObjectsReads() < 6000, `host object views remain bounded (${fixture.hostObjectsReads()})`);
  assert.ok(elapsedMs < 180_000, `two full precon turns complete within a generous lane budget (${elapsedMs} ms)`);
  assert.ok(fixture.match.events().length > 0, 'real lifecycle events were committed');
  adapter.detach();
});
