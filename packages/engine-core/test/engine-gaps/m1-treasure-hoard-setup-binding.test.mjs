// RIFT-1165: the production Match placement of a selected Battlefield must use
// the same Board + location representation that the Program lifecycle scans.
// A mismatch here silently omitted "When you conquer here" registrations and
// left the user with no Finalize optional choice.
//
// Core Rules v1.5 (published 2026-10-09, effective 2026-10-16):
// https://cmsassets.rgpub.io/sanity/files/dsfx7636/news_live/5c7946f7c3b8c6e0faff85ab6dadc6d2e721ea94.pdf
// CR 170.2.b / 199.1: the selected Battlefield is a Board object at its own
// Location. CR 383.4.c.2.b triggers its "you conquer here" ability.
import assert from 'node:assert/strict';
import test from 'node:test';

import treasureHoard from '../../../card-dsl/dist/cards/sfd/treasure-hoard.js';
import { AwaitChoice } from '../../dist/effects/contract.js';
import { world } from '../../dist/effects/testing/test-kernel.js';
import { bindResolveContext, createActionPipelineHost } from '../../dist/events/action-adapter.js';
import { createMatch } from '../../dist/game/lifecycle.js';
import { createProgramBinding } from '../../dist/programs/index.js';

function card(id, type) {
  return { id, cardId: id, canonicalCardId: id, name: id, types: [type], energy: null, power: null, might: null };
}

function deck() {
  return {
    mainDeck: Array.from({ length: 16 }, (_, index) => card(`main-${index}`, 'unit')),
    runeDeck: Array.from({ length: 8 }, (_, index) => card(`rune-${index}`, 'rune')),
    championLegend: card('legend', 'legend'),
    chosenChampion: card('champion', 'champion'),
    battlefields: [
      { ...card('treasure', 'battlefield'), cardId: treasureHoard.canonicalCardId, canonicalCardId: treasureHoard.canonicalCardId },
      card('other-1', 'battlefield'),
      card('other-2', 'battlefield'),
    ],
  };
}

test('RIFT-1165 setup Battlefield is bound once in the production Board lifecycle', () => {
  const kernel = world().player('A').player('B').build();
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
    testTrigger: registration => kernel.test(registration.spec.condition),
  });
  host.player = id => kernel.player(id);
  const binding = createProgramBinding({ cardPrograms: [treasureHoard] });
  const match = createMatch({
    host, decks: [deck(), deck()], programs: binding, seed: 'RIFT-1165-setup-binding',
    battlefieldChoice: [0, 0], mulligans: [[], []], victoryScore: 20,
  });
  const source = match.setup.battlefields.find(field => field.cardId === treasureHoard.canonicalCardId);
  assert.ok(source);
  const object = kernel.getObject(source.id);
  assert.equal(object.zone, 'board');
  assert.deepEqual(object.location, { type: 'battlefield', id: object.ref.id });

  const lifecycle = binding.attachLifecycle(match.flow.chain, error => { throw error; });
  try {
    const registrations = match.flow.chain.pipeline.registeredTriggers().filter(registration =>
      registration.source.cardId === treasureHoard.canonicalCardId);
    const exact = registrations.filter(registration =>
      registration.source.ref.id === source.id && registration.source.ref.zoneEntryId === object.ref.zoneEntryId);
    assert.equal(exact.length, 1);
    assert.equal(exact[0].spec.at, 'conquer');
    assert.equal(exact[0].mayAtFinalize, true);
  } finally {
    lifecycle.detach();
  }
});
