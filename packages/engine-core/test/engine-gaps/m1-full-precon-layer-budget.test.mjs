import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { cardPrograms } from '../../../card-dsl/dist/cards/registry.generated.js';
import forecaster from '../../../card-dsl/dist/cards/sfd/forecaster.js';
import gemJammer from '../../../card-dsl/dist/cards/sfd/gem-jammer.js';
import { AwaitChoice } from '../../dist/effects/contract.js';
import { bindResolveContext, createActionPipelineHost } from '../../dist/events/action-adapter.js';
import { world } from '../../dist/effects/testing/index.js';
import { createMatchCommandAdapter } from '../../dist/game/command-adapter.js';
import { createMatch } from '../../dist/game/lifecycle.js';
import { createProgramBinding } from '../../dist/programs/index.js';
import { executeBasicRuneResourcePlan, planBasicRuneResourceActivation } from '../../dist/runes/index.js';

const PLAN_URL = new URL('../../../../docs/plans/m1-decks.json', import.meta.url);
const CATALOG_URL = new URL('../../../card-data/data/deck-catalog.json', import.meta.url);
const plan = JSON.parse(readFileSync(PLAN_URL, 'utf8'));
const catalog = JSON.parse(readFileSync(CATALOG_URL, 'utf8'));
const catalogById = new Map(catalog.cards.map(card => [card.canonicalCardId, card]));
const knownJudgeRequired = new Set(plan.candidates
  .filter(candidate => candidate.id === 'rumble-sfd' || candidate.id === 'fiora-sfd')
  .flatMap(candidate => candidate.recommendedCardList)
  .map(entry => entry.canonicalCardId)
  .filter(id => cardPrograms.find(program => program.canonicalCardId === id)?.status === 'judge-required'));

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
  // The Rumble champion program is deliberately judge-required in integration;
  // keep that fail-closed behavior out of this layer-budget exercise by using
  // the executable legend carrier as the Champion setup object for that seat.
  const chosen = cards('champion');
  const champions = id === 'rumble-sfd' ? legends.map(card => ({ ...card, id: `${seat}:champion:${card.id}` })) : chosen;
  const battlefields = cards('battlefields');
  assert.equal(legends.length, 1);
  assert.equal(champions.length, 1);
  assert.equal(battlefields.length, 3);
  return { mainDeck: cards('mainDeck'), runeDeck: cards('runes'),
    championLegend: legends[0], chosenChampion: champions[0], battlefields };
}

function context(seed, onObjectsRead = () => {}) {
  const kernel = world().player('A').player('B').build();
  let adapterChoose;
  const choose = request => {
    if (adapterChoose !== undefined) return adapterChoose(request);
    throw new AwaitChoice(request);
  };
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: saved => { kernel.restore(saved.state); kernel.copyLinkedFrom(saved.links); },
    objects: () => { onObjectsRead(); return kernel.objects; },
    perform: action => kernel.perform(action),
    performContract: action => kernel.performContract(action),
    performBatchLeaf: (action, batchId) => kernel.performBatchLeafForCapability(action, batchId),
    choose,
    context: (source, controller, timingPoint) => bindResolveContext(kernel, {
      source, controller, timingPoint, choose,
    }),
  });
  adapterChoose = host.choose;
  const executablePreconPrograms = cardPrograms.filter(program => !knownJudgeRequired.has(program.canonicalCardId));
  const binding = createProgramBinding({
    cardPrograms: executablePreconPrograms,
    printedCatalog: [...catalogById.values()],
  });
  const match = createMatch({
    host: { ...host, player: id => kernel.player(id) },
    decks: [deck('rumble-sfd', 'A'), deck('fiora-sfd', 'B')],
    programs: binding,
    seed,
    battlefieldChoice: [0, 0],
    mulligans: [[], []],
    firstPlayer: 0,
  });
  // A full layer pass is a top-level evaluateAll. Reads nested inside an
  // in-flight pass resolve through that pass's dependency cache (RIFT-927)
  // and are counted separately so the cost stays visible.
  const evaluations = { count: 0, nested: 0 };
  const layers = match.flow.chain.layers;
  const evaluateAll = layers.evaluateAll.bind(layers);
  layers.evaluateAll = () => {
    if (layers.inEvaluation) evaluations.nested++;
    else evaluations.count++;
    return evaluateAll();
  };
  return { kernel, binding, match, evaluations };
}

// Answer every pending choice from the server-offered candidates; this test
// measures layer cost, not bot strategy.
function answerFor(request) {
  if (request.type === 'optional') return true;
  // Protocol v2 answers object choices with { objectId, zoneEntryId } (RIFT-943).
  if (request.type === 'select-objects') {
    return request.options.slice(0, Math.max(request.min, 1)).map(ref => ({ objectId: ref.id, zoneEntryId: ref.zoneEntryId }));
  }
  if (request.type === 'mode') return request.options[0];
  if (request.type === 'order') return [...request.options];
  return request.min;
}

function settle(adapter, prefix) {
  let step = 0;
  for (;;) {
    assert.ok(++step < 120, `${prefix} settles`);
    if (adapter.pendingChoice !== null) {
      const request = adapter.pendingChoice.request;
      adapter.execute(request.chooser, {
        type: 'choose', commandId: `${prefix}:choice:${step}`, stateVersion: adapter.stateVersion,
        choiceId: request.id, answer: answerFor(request),
      });
      continue;
    }
    if (adapter.match.flow.chain.items.length === 0) return;
    const player = adapter.match.flow.chain.priority;
    assert.ok(player, `${prefix} has a Priority holder`);
    adapter.execute(player, { type: 'pass', commandId: `${prefix}:pass:${step}`, stateVersion: adapter.stateVersion });
  }
}

function playCard(adapter, kernel, canonicalCardId, prefix) {
  const source = kernel.objects.find(object => object.owner === 'A' && object.zone === 'hand' &&
    object.cardId === canonicalCardId);
  assert.ok(source, `${prefix} source is in hand`);
  adapter.execute('A', {
    type: 'play', commandId: `${prefix}:play`, stateVersion: adapter.stateVersion,
    cardObjectId: source.ref.id,
  });
  settle(adapter, prefix);
  assert.equal(kernel.getObject(source.ref.id).zone, 'board');
}

function gainTwoEnergy(match, kernel) {
  const runes = kernel.objects.filter(object => object.owner === 'A' && object.controller === 'A' &&
    object.zone === 'rune-zone' && object.types.includes('rune'));
  for (const [index, rune] of runes.slice(0, 2).entries()) {
    const source = catalogById.get(rune.cardId);
    assert.ok(source?.domains?.length === 1, 'the Rune has one trusted Domain');
    const plan = planBasicRuneResourceActivation({
      chain: match.flow.chain,
      state: { objects: () => kernel.objects, player: id => kernel.player(id) },
      resolveIdentity: cardId => cardId === rune.cardId ? {
        cardId, canonicalCardId: rune.cardId, domain: source.domains[0],
      } : null,
      request: {
        actor: 'A', activationId: `gem-jammer:energy:${index}`,
        intent: { type: 'rune-energy', runeObjectId: rune.ref.id, zoneEntryId: rune.ref.zoneEntryId },
        window: { kind: 'priority' },
      },
    });
    executeBasicRuneResourcePlan(plan);
  }
  assert.equal(kernel.player('A').energy, 2);
}

test('RIFT-999 full M1 precons remain playable after bounded layer evaluation', () => {
  const objectsReads = { count: 0 };
  const { kernel, binding, match, evaluations } = context('RIFT-999-precon-35', () => { objectsReads.count++; });
  assert.equal(match.programBinding.registry.inspect(
    'card.hash-f0ac9d90de705764ec57a50fb7483a35117949080af9f6a959eb42a7b887c9e9',
  ).status, 'executable');
  assert.equal(kernel.objects.filter(object => object.owner === 'A').length > 0, true);
  assert.ok(match.setup.hands.A.length >= 4);
  assert.ok(match.setup.hands.B.length >= 4);
  const adapter = createMatchCommandAdapter({ match, stateVersion: 0 });
  objectsReads.count = 0;
  evaluations.count = 0;
  evaluations.nested = 0;
  const firstEvent = match.events().length;
  const start = Date.now();
  gainTwoEnergy(match, kernel);
  playCard(adapter, kernel, gemJammer.canonicalCardId, 'gem-jammer');
  const gemDone = Date.now();
  // Gem Jammer spent the channelled Runes; pay Forecaster's printed Energy
  // through an ordinary engine resource action.
  const forecasterEnergy = catalogById.get(forecaster.canonicalCardId)?.energy;
  assert.ok(Number.isSafeInteger(forecasterEnergy), 'Forecaster has printed Energy');
  assert.equal(match.flow.chain.commit({ type: 'gain-energy', player: 'A', amount: forecasterEnergy }).status, 'done');
  playCard(adapter, kernel, forecaster.canonicalCardId, 'forecaster');
  const forecasterDone = Date.now();
  assert.ok(match.events().length > firstEvent, 'both real plays publish events');
  assert.ok(evaluations.nested < 100_000, `nested in-flight reads stay bounded (${evaluations.nested})`);
  assert.ok(evaluations.count < 3000, `layer passes stay below the reproduced regression (${evaluations.count})`);
  assert.ok(objectsReads.count < 3000, `host reads stay below the reproduced regression (${objectsReads.count})`);
  assert.ok(gemDone - start < 120_000, `Gem Jammer settles within budget (${gemDone - start} ms)`);
  assert.ok(forecasterDone - gemDone < 120_000, `Forecaster settles within budget (${forecasterDone - gemDone} ms)`);
  assert.equal(match.programBinding, binding);
  adapter.detach();
});
