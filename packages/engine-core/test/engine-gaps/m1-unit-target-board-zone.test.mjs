// RIFT-1063 production regression: a TargetSpec that says "another friendly
// unit" must use the implicit Board meaning of "unit". Cards with that type in
// Hand or Trash are Unit cards, not targets for an effect that names a Unit.
//
// Official evidence: Core Rules v1.5 (published 2026-10-09, effective
// 2026-10-16 under the Radiance policy):
// https://cmsassets.rgpub.io/sanity/files/dsfx7636/news_live/
//   5c7946f7c3b8c6e0faff85ab6dadc6d2e721ea94.pdf
// - 133.3.a: an unqualified characteristic such as "unit" refers to an object
//   on the Board unless the effect implicitly or explicitly names another zone.
// - 141.1.a/.b: a Unit is a Board Game Object; in Trash it is a Unit card and
//   cannot be affected as a Unit on the Board.
// - 355.9.a.1: "Unit" (as also "Gear") means an object on the Board unless
//   specified otherwise.
// - 403.4/.a: if a Triggered Ability has too few options at its choice step, it
//   is removed and never becomes Finalized; this is not a counter.
//
// Canonical cards from the shipped M1 fiora-sfd precon/catalog:
// - Pit Rookie ogn-136-298
//   card.hash-e2638655ff5ed3a1e60a501be3c23d74e46ef7f1900bed31b436f1a579b316ed
// - Laurent Duelist sfd-156-221
//   card.hash-7cbc2a92adfe5cf5c7126a8d72869cf933d006002fe1f46b4804c2040a51c9c6
// - Fiora, Peerless sfd-110-221
//   card.hash-6bde2e2c542ff8fc1a7a2f9204df7e6c58a05a53ad98c0a31d69927be053b77f
// This exercises the real CardProgram -> ProgramBinding -> ChainEngine ->
// lifecycle path; the Fiora death is a committed engine action and targets are
// selected by the production Finalize prompt.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import fioraPeerless from '../../../card-dsl/dist/cards/sfd/fiora-peerless.js';
import laurentDuelist from '../../../card-dsl/dist/cards/sfd/laurent-duelist.js';
import pitRookie from '../../../card-dsl/dist/cards/ogn/pit-rookie.js';
import { ChainEngine } from '../../dist/chain/engine.js';
import { AwaitChoice } from '../../dist/effects/contract.js';
import { world } from '../../dist/effects/testing/index.js';
import { bindResolveContext, createActionPipelineHost } from '../../dist/events/action-adapter.js';
import { createProgramBinding } from '../../dist/programs/index.js';

const BASE_A = { type: 'base', player: 'A' };
const BATTLEFIELD = { type: 'battlefield', id: 'bf1' };
const CATALOG = JSON.parse(readFileSync(
  new URL('../../../../packages/card-data/data/deck-catalog.json', import.meta.url), 'utf8'));
const M1_DECKS = JSON.parse(readFileSync(
  new URL('../../../../docs/plans/m1-decks.json', import.meta.url), 'utf8'));
const FIORA_PRECON = M1_DECKS.candidates.find(candidate => candidate.id === 'fiora-sfd');
const CATALOG_BY_CANONICAL = new Map(CATALOG.cards.map(card => [card.canonicalCardId, card]));

function preconPhysicalCard(id, program) {
  const entry = FIORA_PRECON.recommendedCardList.find(card => card.canonicalCardId === program.canonicalCardId);
  assert.ok(entry, `${program.sourceText} is a physical card in the shipped M1 fiora-sfd precon`);
  const printed = CATALOG_BY_CANONICAL.get(entry.canonicalCardId);
  assert.ok(printed, `the trusted catalog contains ${entry.canonicalCardId}`);
  return {
    id,
    cardId: printed.canonicalCardId,
    name: printed.name,
    types: [printed.cardType.toLowerCase()],
    energy: printed.energy,
    power: printed.power,
    might: printed.might,
  };
}

const rookieCard = preconPhysicalCard('rookie', pitRookie);
const laurentCard = preconPhysicalCard('laurent', laurentDuelist);
const fioraCard = preconPhysicalCard('fiora', fioraPeerless);

function scene({ withBoardTarget }) {
  const builder = world()
    .player('A', { energy: 2, power: [] })
    .player('B')
    .hand('rookie', { ...rookieCard, owner: 'A', zone: 'hand', location: null })
    // The reported live case had this copy still in Hand while Fiora was in
    // Trash. Both retain Unit as a type but are not Board Units.
    .hand('laurent-hand', { ...laurentCard, id: 'laurent-hand', owner: 'A', zone: 'hand', location: null })
    .unit('fiora', { ...fioraCard, owner: 'A', controller: 'A', zone: 'board', location: BATTLEFIELD });
  if (withBoardTarget) {
    builder.base('laurent-board', { ...laurentCard, id: 'laurent-board', owner: 'A', controller: 'A', location: BASE_A });
  }
  const kernel = builder.build();
  const requests = [];
  const lifecycleErrors = [];
  const choose = request => {
    requests.push(structuredClone(request));
    if (request.type === 'select-objects' && request.id === 'target:other-unit') {
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
    choose,
    context: (source, controller, timingPoint) => bindResolveContext(kernel, {
      source, controller, timingPoint, choose,
    }),
  });
  const binding = createProgramBinding({
    cardPrograms: [pitRookie, laurentDuelist, fioraPeerless],
  });
  const engine = new ChainEngine({
    turnOrder: ['A', 'B'],
    turnPlayer: 'A',
    phase: 'main',
    host,
    cleanup: () => false,
    describePlay: binding.describePlay,
  });
  const lifecycle = binding.attachLifecycle(engine, error => lifecycleErrors.push(error));

  // Use the same real kill action as the reported combat loss. In particular,
  // the Fiora candidate that leaked into the old prompt still has type Unit and
  // owner/controller A, but its current zone is Trash.
  assert.equal(engine.commit({ type: 'kill', object: kernel.ref('fiora') }).status, 'done');
  engine.advance();
  assert.equal(kernel.getObject('fiora').zone, 'trash');

  const source = kernel.getObject('rookie');
  assert.ok(source);
  const draft = binding.describePlay({
    type: 'play', player: 'A', object: source.ref, location: BASE_A,
  }, source);
  engine.execute(draft);

  for (let guard = 0; guard < 40 && engine.items.length; guard++) {
    if (engine.items.some(item => item.status === 'pending')) engine.advance();
    else engine.pass(engine.priority);
  }
  assert.equal(engine.items.length, 0, 'the real Chain settles on both branches');
  return { binding, draft, engine, kernel, lifecycle, lifecycleErrors, requests };
}

function stepsFor(engine, item) {
  return engine.trace.filter(entry => entry.item === item).map(entry => entry.step);
}

function triggerItem(engine) {
  const id = engine.trace.find(entry => entry.step === 'pending' && entry.item?.startsWith('trigger:'))?.item;
  assert.ok(id, 'Pit Rookie created its real triggered ability');
  return id;
}

function assertSubsequence(actual, expected) {
  let cursor = 0;
  for (const step of expected) {
    cursor = actual.indexOf(step, cursor);
    assert.notEqual(cursor, -1, `expected ${expected.join(' -> ')} in ${actual.join(' -> ')}`);
    cursor++;
  }
}

test('RIFT-1063 Pit Rookie Finalize ignores same-type Unit cards in Hand and Trash', () => {
  const f = scene({ withBoardTarget: true });
  const [target] = f.requests.filter(request => request.id === 'target:other-unit');
  assert.ok(target);
  assert.deepEqual(target.options, [f.kernel.ref('laurent-board')]);
  assert.equal(target.options.some(ref => ref.id === 'laurent-hand'), false);
  assert.equal(target.options.some(ref => ref.id === 'fiora'), false);
  assert.equal(f.kernel.getObject('laurent-hand').buffs, 0);
  assert.equal(f.kernel.getObject('fiora').buffs, 0);
  assert.equal(f.kernel.getObject('laurent-board').buffs, 1);
  assert.equal(f.binding.inspect(f.kernel.getObject('laurent-board')).abilities[0].keyword,
    'assault', 'the selected Board Unit uses the real precon card program');

  const trigger = triggerItem(f.engine);
  assert.deepEqual(stepsFor(f.engine, f.draft.id).filter(step =>
    ['pending', 'finalized', 'resolve-start', 'resolved'].includes(step)), [
    'pending', 'finalized', 'resolve-start', 'resolved',
  ]);
  assertSubsequence(stepsFor(f.engine, trigger), [
    'pending', 'finalize-start', 'targets-finalized', 'finalized', 'resolve-start', 'resolved', 'removed',
  ]);
  assert.deepEqual(f.lifecycleErrors, []);
  f.lifecycle.detach();
});

test('RIFT-1063 Pit Rookie with only Hand and Trash Unit cards has no illegal target prompt', () => {
  const f = scene({ withBoardTarget: false });
  assert.deepEqual(f.requests.filter(request => request.type === 'select-objects'), []);
  assert.equal(f.kernel.getObject('laurent-hand').buffs, 0);
  assert.equal(f.kernel.getObject('fiora').buffs, 0);
  assert.equal(f.kernel.getObject('rookie').zone, 'board');
  assert.equal(f.engine.pipeline.events.some(event => event.timingPoint === 'card-played'), true,
    'Pit Rookie reached the real card-played trigger boundary');

  const trigger = triggerItem(f.engine);
  const triggerSteps = stepsFor(f.engine, trigger);
  assert.deepEqual(triggerSteps, ['pending', 'removed'],
    'CR 403.4 removes the Pending trigger when its attempted Finalize finds no option');
  assert.equal(f.engine.trace.find(entry => entry.item === trigger && entry.step === 'removed')?.reason,
    'unperformable-trigger');
  assert.equal(f.engine.trace.some(entry => entry.item === trigger && entry.reason === 'countered'), false,
    'CR 403.4.a: removal is not a counter');
  assert.deepEqual(f.lifecycleErrors, []);
  f.lifecycle.detach();
});
