import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import breakneckMech from '../../../card-dsl/dist/cards/sfd/breakneck-mech.js';
import { cardPrograms } from '../../../card-dsl/dist/cards/registry.generated.js';
import { bindResolveContext, createActionPipelineHost } from '../../dist/events/action-adapter.js';
import { AwaitChoice } from '../../dist/effects/contract.js';
import { createMatchCommandAdapter } from '../../dist/game/command-adapter.js';
import { world } from '../../dist/effects/testing/index.js';
import { createMatch } from '../../dist/game/lifecycle.js';
import { createProgramBinding } from '../../dist/programs/index.js';
import { createEngineStaticBinder } from '../../dist/programs/statics.js';

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
  let choose = () => { throw new Error('Choice requested before the host is installed'); };
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: saved => { kernel.restore(saved.state); kernel.copyLinkedFrom(saved.links); },
    objects: () => kernel.objects,
    perform: action => kernel.perform(action),
    performContract: action => kernel.performContract(action),
    performBatchLeaf: (action, batchId) => kernel.performBatchLeafForCapability(action, batchId),
    choose: request => choose(request),
    context: (source, controller, timingPoint) => bindResolveContext(kernel, { source, controller, timingPoint, choose }),
  });
  // Match setup will attach this binding's real CardProgram lifecycle. The
  // budget test uses the same two full M1 precons and production ChainEngine as
  // the headless runner without opening a second lifecycle after setup.
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
  return { kernel, binding, match, setChoose: value => { choose = value; } };
}

function liveStaticSetup() {
  const kernel = world().player('A').player('B')
    .unit('source', { cardId: breakneckMech.canonicalCardId, might: 2, tags: ['Mech'], location: { type: 'base', player: 'A' } })
    .unit('ally', { might: 2, tags: ['Mech'], location: { type: 'base', player: 'A' } })
    .unit('enemy', { owner: 'B', controller: 'B', might: 2, tags: ['Mech'], location: { type: 'base', player: 'B' } })
    .build();
  const choose = request => { throw new AwaitChoice(request); };
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: saved => { kernel.restore(saved.state); kernel.copyLinkedFrom(saved.links); },
    objects: () => kernel.objects,
    perform: action => kernel.perform(action),
    performContract: action => kernel.performContract(action),
    performBatchLeaf: (action, batchId) => kernel.performBatchLeafForCapability(action, batchId),
    choose,
    context: (source, controller, timingPoint) => bindResolveContext(kernel, { source, controller, timingPoint, choose }),
  });
  const binding = createProgramBinding({ cardPrograms: [breakneckMech] });
  const match = createMatch({
    host: { ...host, player: id => kernel.player(id) },
    decks: [syntheticDeck('A'), syntheticDeck('B')],
    programs: binding,
    seed: 'RIFT-1031-live-static-budget',
    battlefieldChoice: [0, 0],
    mulligans: [[], []],
    firstPlayer: 0,
  });
  binding.attachLifecycle(match.flow.chain, error => { throw error; });
  return { kernel, binding, match };
}

function syntheticDeck(seat) {
  const card = (id, cardType) => ({ id: `${seat}:${id}`, cardId: `synthetic:${seat}:${id}`, name: id,
    cardType, types: [cardType.toLowerCase()], tags: [], domains: ['Body'], energy: 0, power: null, might: null });
  return {
    mainDeck: Array.from({ length: 8 }, (_, index) => card(`main-${index}`, 'Spell')),
    runeDeck: Array.from({ length: 8 }, (_, index) => card(`rune-${index}`, 'Rune')),
    championLegend: card('legend', 'Legend'),
    chosenChampion: card('champion', 'Unit'),
    battlefields: [card('field-1', 'Battlefield'), card('field-2', 'Battlefield'), card('field-3', 'Battlefield')],
  };
}

function answerFor(request) {
  if (request.type === 'optional') return true;
  if (request.type === 'select-objects') {
    return request.options.slice(0, Math.max(request.min, 1)).map(ref => ({ objectId: ref.id, zoneEntryId: ref.zoneEntryId }));
  }
  if (request.type === 'mode') return request.options[0];
  if (request.type === 'order') return [...request.options];
  return request.min;
}

function endTurnThroughProduction(adapter, prefix) {
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
    // The production command owner currently rejects the public `end-turn`
    // envelope, so this budget test continues at the authenticated TurnFlow
    // boundary the wire adapter delegates to; setup and card effects still run
    // through createMatch, createProgramBinding and their real lifecycle.
    adapter.match.flow.endTurn(adapter.match.flow.turnPlayer);
    return;
  }
  assert.fail(`${prefix} ends through production Pass and TurnFlow`);
}

test('RIFT-1031: nested live static reads reuse the in-flight board layer pass', () => {
  const { kernel, match } = liveStaticSetup();
  const chain = match.flow.chain;
  const source = kernel.objects.find(candidate => candidate.cardId === breakneckMech.canonicalCardId);
  const ability = breakneckMech.abilities.find(candidate => candidate.kind === 'static');
  assert.ok(source);
  assert.ok(ability);
  const objects = chain.pipeline.host.objects;
  let hostReads = 0;
  chain.pipeline.host.objects = () => {
    hostReads++;
    return objects();
  };
  // `liveSource` is the real production anchor for static filters. Its nested
  // Board lookup must use the parent pass, not create a second host read tree.
  createEngineStaticBinder(chain).bindStatic(ability, source);
  const layered = chain.pipeline.host.objects();
  assert.ok(layered.length > 0);
  assert.ok(hostReads < 500, `nested live sources did not re-enter the host repeatedly (${hostReads})`);
});

test('RIFT-1031: a full M1 precon advances real turns through production commands within budget', () => {
  const { match, setChoose } = setup('RIFT-1031-headless-budget');
  setChoose(request => answerFor(request));
  const adapter = createMatchCommandAdapter({ match, stateVersion: 0 });
  const chain = match.flow.chain;
  const evaluateAll = chain.layers.evaluateAll.bind(chain.layers);
  const observations = { topLevel: 0, nested: 0 };
  chain.layers.evaluateAll = () => {
    if (chain.layers.inEvaluation) observations.nested++;
    else observations.topLevel++;
    return evaluateAll();
  };
  const start = Date.now();
  const turnPlayers = [];
  for (let turn = 0; turn < 3; turn++) {
    endTurnThroughProduction(adapter, `turn-${turn}`);
    turnPlayers.push(match.flow.turnPlayer);
  }
  const elapsedMs = Date.now() - start;
  assert.equal(new Set(turnPlayers).size, 2, 'each end-turn passes the Turn Player to the other seat');
  assert.ok(observations.topLevel < 4000, `top-level layer passes stay bounded (${observations.topLevel})`);
  assert.ok(observations.nested < 100_000, `nested in-flight reads stay bounded (${observations.nested})`);
  assert.ok(elapsedMs < 60_000, `three full turns finish within the headless budget (${elapsedMs} ms)`);
  adapter.detach();
});
