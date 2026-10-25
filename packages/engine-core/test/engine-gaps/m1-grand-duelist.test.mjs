// RIFT-1032 production regression: Grand Duelist's leading optional ability,
// leading exhaust base cost, linked channel, and Rune entry state.
//
// Official evidence: Core Rules v1.5 (published 2026-10-09), effective under
// the Radiance policy on 2026-10-16:
// https://cmsassets.rgpub.io/sanity/files/dsfx7636/news_live/5c7946f7c3b8c6e0faff85ab6dadc6d2e721ea94.pdf
// https://playriftbound.com/en-us/news/announcements/core-rules-radiance-patch-notes-effective-october-16-2026/
// Local source: /root/swarm-rift/shared/rules/CR-v1.5.txt.
//
// CR 107.4.c places the Champion Legend Game Object in the Legend Zone;
// 383.3.a/383.3.a.2 decides a leading "you may" at Finalize; 383.3.b/
// 383.3.b.1 makes the immediately following "exhaust me" the base cost;
// 405.2 removes an incurred cost rather than resolving it when declined;
// 415.4/415.5 forbids paying with an already-exhausted Legend. A finalized
// trigger reaches Resolve through CR 337/338-340. CR 431.2 requires the Rune to
// enter the Board exhausted.
// Canonical card: sfd-205-221 Grand Duelist
// (card.hash-ccfc067dad8a1bf92c6ae1aa5f7110e9d211a1842a9254bb9320705c2f96c6c4).
//
// Timeline: friendly Unit 4 -> 5 Might -> might-changed Pending -> Finalize
// optional may/base cost -> two Priority passes -> Resolve linked channel.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

import grandDuelist from '../../../card-dsl/dist/cards/sfd/grand-duelist.js';
import { resolveChainBody } from '../../dist/chain/interpreter-adapter.js';
import { AwaitChoice } from '../../dist/effects/contract.js';
import channel from '../../dist/effects/instructions/effect.channel.js';
import { runInstruction, world } from '../../dist/effects/testing/index.js';
import { bindResolveContext, createActionPipelineHost } from '../../dist/events/action-adapter.js';
import { createMatch } from '../../dist/game/lifecycle.js';
import { createProgramBinding } from '../../dist/programs/index.js';

// The game-server host is the production owner of Rune entry state. TestWorld's
// channel-rune action tests the instruction seam but does not apply its
// exhausted flag, so only the production host below proves that stipulation.
// Reuse game-server's existing tsx dependency; engine-core needs no new import.
const gameServerRequire = createRequire(new URL('../../../../apps/game-server/package.json', import.meta.url));
const tsxPackage = gameServerRequire.resolve('tsx/package.json');
const { tsImport } = await import(pathToFileURL(tsxPackage.replace(/package\.json$/, 'dist/esm/api/index.mjs')).href);
const { EngineRuntimeHost } = await tsImport(
  new URL('../../../../apps/game-server/src/engine-runtime/host.ts', import.meta.url).href,
  import.meta.url,
);

const CANONICAL = grandDuelist.canonicalCardId;
const constant = value => ({ kind: 'constant', value });
const legend = (id, cardId = CANONICAL) => ({
  id, cardId, canonicalCardId: cardId, name: cardId, cardType: 'Legend', types: ['legend'],
  energy: null, power: null, might: null,
});
const card = (id, values) => ({ id, cardId: id, canonicalCardId: id, name: id, ...values });

function deck(label) {
  return {
    mainDeck: Array.from({ length: 12 }, (_, index) => card(`${label}:main:${index}`, {
      cardType: 'Unit', types: ['unit'], energy: 1, power: [], might: 1,
    })),
    runeDeck: Array.from({ length: 4 }, (_, index) => card(`${label}:rune:${index}`, {
      cardType: 'Rune', types: ['rune'], energy: null, power: null, might: null,
    })),
    championLegend: label === 'A' ? legend('legend:A') : legend('legend:B', 'trained:legend:B'),
    chosenChampion: card(`champion:${label}`, {
      cardType: 'Champion', types: ['champion'], energy: null, power: null, might: null,
    }),
    battlefields: Array.from({ length: 3 }, (_, index) => card(`bf:${label}:${index}`, {
      cardType: 'Battlefield', types: ['battlefield'], energy: null, power: null, might: null,
    })),
  };
}

function productionRuntime({ accept = true, legendExhausted = false } = {}) {
  const requests = [];
  const state = new EngineRuntimeHost({ A: 'A', B: 'B' }, request => {
    requests.push(structuredClone(request));
    if (request.type === 'optional') return accept;
    if (request.type === 'mode' || request.type === 'order') return request.options[0];
    if (request.type === 'select-objects') return [...request.options];
    throw new AwaitChoice(request);
  });
  const host = createActionPipelineHost({
    checkpoint: () => state.checkpoint(), restore: checkpoint => state.restore(checkpoint),
    objects: () => state.objects(), perform: action => state.perform(action),
    performContract: action => state.performContract(action),
    performWithDeathBoundary: (action, boundary) => state.performWithDeathBoundary(action, boundary),
    performKillBatchWithDeathBoundary: (actions, batchId, boundary) =>
      state.performKillBatchWithDeathBoundary(actions, batchId, boundary),
    choose: request => state.choose(request),
    context: (source, controller, timingPoint) => state.context(source, controller, timingPoint),
  });
  const binding = createProgramBinding({ cardPrograms: [grandDuelist] });
  const match = createMatch({
    host: { ...host, player: id => state.player(id) },
    decks: [deck('A'), deck('B')], programs: binding,
    seed: 'RIFT-1032:grand-duelist-production', battlefieldChoice: [0, 0],
    mulligans: [[], []], firstPlayer: 0,
  });
  const ally = state.addCard('A', {
    id: 'ally', cardId: 'synthetic:grand-duelist-ally', name: 'Allied Unit',
    types: ['unit'], might: 4, energy: null, power: null,
  }, 'board');
  assert.equal(state.perform({
    type: 'move-location', object: ally, to: { type: 'battlefield', id: match.setup.battlefields[0].id },
  }).status, 'done');
  const lifecycle = binding.attachLifecycle(match.flow.chain, error => { throw error; });
  match.flow.chain.advance();
  const registration = match.flow.chain.pipeline.registeredTriggers().find(candidate =>
    candidate.source.cardId === CANONICAL && candidate.spec.at === 'might-changed');
  assert.ok(registration, 'Grand Duelist bound its real might-changed trigger');
  if (legendExhausted) {
    const manuallyExhausted = match.flow.chain.commit({ type: 'exhaust', object: registration.source.ref });
    assert.equal(manuallyExhausted.status, 'done');
    match.flow.chain.advance();
  }
  const top = state.zoneObjects('A', 'rune-deck')[0];
  assert.ok(top, 'production deck has a top Rune');
  return { lifecycle, match, registration, requests, state, top };
}

function raiseAlly(f) {
  const ally = f.state.objects().find(object => object.ref.id === 'ally');
  assert.ok(ally);
  f.match.flow.chain.execute({
    id: 'RIFT-1032:raise-to-mighty', controller: 'A', source: ally,
    kind: 'activated', speed: 'action', body: [{
      id: 'ally.might', op: 'continuous.might', args: {
        amount: constant(1), duration: constant('this-turn'),
        objects: constant({ kind: 'source' }),
      },
    }],
  });
}

function settle(f) {
  const chain = f.match.flow.chain;
  for (let guard = 0; guard < 240; guard++) {
    if (chain.items.length) {
      if (chain.items.some(item => item.status === 'pending')) chain.advance();
      else if (chain.priority !== null) chain.pass(chain.priority);
      else throw new Error('Finalized Grand Duelist Chain lost Priority');
      continue;
    }
    if (chain.priority !== null) {
      chain.pass(chain.priority);
      continue;
    }
    return;
  }
  throw new Error('Grand Duelist Chain did not settle');
}

function stateOf(f) {
  const legendObject = f.state.objects().find(object => object.ref.id === f.registration.source.ref.id);
  const top = f.state.objects().find(object => object.ref.id === f.top.ref.id);
  assert.ok(legendObject);
  assert.ok(top);
  return {
    legend: { zone: legendObject.zone, exhausted: legendObject.exhausted },
    top: { zone: top.zone, exhausted: top.exhausted, zoneEntryId: top.ref.zoneEntryId },
    runeDeck: f.state.player('A').runeDeckSize,
  };
}

test('RIFT-1032 production pays Grand Duelist and channels the Rune exhausted', () => {
  const f = productionRuntime();
  const before = stateOf(f);
  raiseAlly(f);
  settle(f);

  assert.equal(f.requests.filter(request => request.type === 'optional').length, 1);
  const optionalRequests = f.requests.filter(request => request.type === 'optional').map(request => request.id);
  assert.equal(optionalRequests.length, 1);
  assert.match(optionalRequests[0], /^trigger:\d+:program:.*:optional$/);
  assert.equal(f.match.flow.chain.pipeline.events.some(event =>
    event.timingPoint === 'might-changed' && event.details.previousMight === 4 &&
    event.details.currentMight === 5), true);
  assert.deepEqual(stateOf(f), {
    legend: { zone: 'legend', exhausted: true },
    top: { zone: 'rune-zone', exhausted: true, zoneEntryId: before.top.zoneEntryId + 1 },
    runeDeck: before.runeDeck - 1,
  });
  const trace = f.match.flow.chain.trace;
  assert.deepEqual(trace.filter(entry => entry.item === 'trigger:1').map(entry => entry.step), [
    'pending', 'finalize-start', 'finalized', 'resolve-start', 'resolved', 'removed',
  ]);
  const finalized = trace.findIndex(entry => entry.step === 'finalized' && entry.item === 'trigger:1');
  const resolved = trace.findIndex(entry => entry.step === 'resolve-start' && entry.item === 'trigger:1');
  assert.equal(trace.slice(finalized, resolved).filter(entry => entry.step === 'pass').length >= 2, true);
  f.lifecycle.detach();
});
test('RIFT-1032 production declining the leading may leaves Legend and Rune Deck unchanged', () => {
  const f = productionRuntime({ accept: false });
  const before = stateOf(f);
  raiseAlly(f);
  settle(f);
  assert.deepEqual(stateOf(f), before);
  assert.ok(f.match.flow.chain.trace.some(entry =>
    entry.step === 'removed' && entry.item === 'trigger:1' && entry.reason === 'declined'));
  f.lifecycle.detach();
});
test('RIFT-1032 production exhausted Legend cannot pay the leading exhaust cost', () => {
  const f = productionRuntime({ legendExhausted: true });
  const before = stateOf(f);
  raiseAlly(f);
  settle(f);
  assert.deepEqual(stateOf(f), before);
  assert.equal(f.requests.some(request => request.type === 'optional'), true);
  assert.ok(f.match.flow.chain.trace.some(entry => entry.item === 'trigger:1' && entry.step === 'removed'));
  assert.equal(f.match.flow.chain.trace.some(entry => entry.item === 'trigger:1' && entry.step === 'resolved'), false);
  f.lifecycle.detach();
});

test('RIFT-1032 effect.channel forwards the exhausted stipulation in the Rune action', () => {
  const instruction = grandDuelist.abilities[0].body[1];
  const kernel = world().player('A').rune(['r1', 'r2'], { owner: 'A' }).build();
  const actions = [];
  kernel.addReplacement(action => {
    if (action.type === 'channel-rune') actions.push(structuredClone(action));
    return null;
  });
  const run = runInstruction(channel, {
    amount: instruction.args.amount, exhausted: instruction.args.exhausted,
  }, { world: kernel });
  assert.equal(run.result.status, 'executed');
  assert.deepEqual(actions, [{ type: 'channel-rune', player: 'A', amount: 1, exhausted: true }]);
});

test('RIFT-1032 effect.exhaust binds an authored source selector without a TargetSpec', () => {
  const exhaust = grandDuelist.abilities[0].body[0];
  const kernel = world().player('A').unit('source', { types: ['legend'], exhausted: false }).build();
  const context = bindResolveContext(kernel, {
    source: kernel.getObject('source'), controller: 'A', timingPoint: 'chain-item-resolve',
  });
  const run = resolveChainBody([exhaust], context);
  assert.equal(run.results[0].result.status, 'executed');
  assert.equal(kernel.getObject('source').exhausted, true);
});
