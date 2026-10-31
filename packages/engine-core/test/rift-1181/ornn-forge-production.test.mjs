import assert from 'node:assert/strict';
import test from 'node:test';

import doransBlade from '../../../card-dsl/dist/cards/sfd/dorans-blade.js';
import ornnsForge from '../../../card-dsl/dist/cards/sfd/ornns-forge.js';
import warmogsArmor from '../../../card-dsl/dist/cards/sfd/warmogs-armor.js';
import { ChainEngine } from '../../dist/chain/engine.js';
import { AwaitChoice } from '../../dist/effects/contract.js';
import { world } from '../../dist/effects/testing/test-kernel.js';
import { bindResolveContext, createActionPipelineHost } from '../../dist/events/action-adapter.js';
import { createMatchCommandAdapter } from '../../dist/game/command-adapter.js';
import { createMatch } from '../../dist/game/lifecycle.js';
import { createProgramBinding } from '../../dist/programs/index.js';
import { staticCostSources } from '../../dist/programs/static-adapters/capabilities.js';

// Official evidence:
// - Core Rules v1.5, published 2026-10-09 and effective 2026-10-16:
//   https://cmsassets.rgpub.io/sanity/files/dsfx7636/news_live/5c7946f7c3b8c6e0faff85ab6dadc6d2e721ea94.pdf
//   185.3.a tokens have no printed cost; 186.1 tokens can exist only on the
//   Board or Chain; 190.6 assigns a controlled Battlefield's abilities to its
//   controller; 356.4 applies discounts supplied by another card; 420.4.b
//   determines card-play conditions from successful Finalize history.
// - Ornn's Forge (sfd-213-221), zh_CN gallery read 2026-10-31:
//   https://content.publishing.riotgames.com/publishing-content/v2.0/public/channel/riftbound_website/list/riftbound_gallery_cards?locale=zh_CN
//   "While you control this battlefield, the first friendly non-token gear
//   played each turn costs 1 Energy less."

const FORGE = ornnsForge.canonicalCardId;
const WARMO_G = warmogsArmor.canonicalCardId;
const DORAN = doransBlade.canonicalCardId;

function card(id, canonicalCardId, types, extra = {}) {
  return {
    id,
    cardId: canonicalCardId,
    canonicalCardId,
    name: extra.name ?? id,
    types,
    cardType: extra.cardType,
    energy: extra.energy ?? null,
    power: extra.power ?? null,
    might: extra.might ?? null,
    tags: extra.tags ?? [],
    domains: extra.domains ?? [],
  };
}

function deck(prefix, forge = false) {
  const mainDeck = Array.from({ length: 20 }, (_, index) => {
    const warmog = index % 2 === 0;
    return warmog
      ? card(`${prefix}:main:${index}`, WARMO_G, ['gear'], {
          name: "Warmog's Armor", cardType: 'Gear', energy: 1, power: null, might: 1,
          tags: ['Equipment'], domains: ['Body'],
        })
      : card(`${prefix}:main:${index}`, DORAN, ['gear'], {
          name: "Doran's Blade", cardType: 'Gear', energy: 2, power: null, might: 2,
          tags: ['Equipment'], domains: ['Body'],
        });
  });
  return {
    mainDeck,
    runeDeck: Array.from({ length: 8 }, (_, index) => card(
      `${prefix}:rune:${index}`, `synthetic:rune:${prefix}:${index}`, ['rune'], { cardType: 'Rune' },
    )),
    championLegend: card(`${prefix}:legend`, `synthetic:legend:${prefix}`, ['legend'], { cardType: 'Legend' }),
    chosenChampion: card(`${prefix}:champion`, `synthetic:champion:${prefix}`, ['champion'], { cardType: 'Champion' }),
    battlefields: Array.from({ length: 3 }, (_, index) => forge && index === 0
      ? card(`A:field:${index}`, FORGE, ['battlefield'], {
          name: "Ornn's Forge", cardType: 'Battlefield',
        })
      : card(`${prefix}:field:${index}`, `synthetic:field:${prefix}:${index}`, ['battlefield'], {
          cardType: 'Battlefield',
        })),
  };
}

function makeHost(builder = world().player('A').player('B')) {
  const kernel = builder.build();
  let pipeline;
  let adapterDefaultChoose;
  const choose = request => {
    if (pipeline !== undefined && pipeline.choose !== adapterDefaultChoose) return pipeline.choose(request);
    if (request.type === 'optional') return false;
    if (request.type === 'mode') return request.options[0];
    if (request.type === 'select-objects' && request.min === request.max && request.options.length === request.min) {
      return [...request.options];
    }
    throw new AwaitChoice(request);
  };
  pipeline = createActionPipelineHost({
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
  adapterDefaultChoose = pipeline.choose;
  pipeline.player = id => kernel.player(id);
  return { kernel, host: pipeline };
}

function settle(adapter) {
  for (let guard = 0; adapter.match.flow.chain.items.length > 0; guard += 1) {
    assert.ok(guard < 30, 'the production Chain must settle');
    if (adapter.pendingChoice !== null) throw new Error('unexpected pending choice');
    adapter.execute(adapter.match.flow.chain.priority, {
      type: 'pass', commandId: `RIFT-1181:pass:${guard}`, stateVersion: adapter.stateVersion,
    });
  }
}

test("RIFT-1181 setup Battlefield static enters real Finalize; first Gear is discounted once", () => {
  const made = makeHost();
  const binding = createProgramBinding({ cardPrograms: [ornnsForge, warmogsArmor, doransBlade] });
  const match = createMatch({
    host: made.host,
    decks: [deck('A', true), deck('B')],
    programs: binding,
    seed: 'RIFT-1181-engine-production',
    battlefieldChoice: [0, 0],
    mulligans: [[], []],
    firstPlayer: 0,
    victoryScore: 20,
  });
  assert.equal(match.flow.phase, 'main');
  assert.equal(match.flow.turnPlayer, 'A');

  const forge = made.kernel.objects.find(object => object.cardId === FORGE && object.zone === 'board');
  assert.ok(forge);
  assert.equal(forge.isToken, true, 'the selected setup Battlefield is the production setup token');
  assert.deepEqual(forge.location, { type: 'battlefield', id: forge.ref.id });

  const adapter = createMatchCommandAdapter({ match, stateVersion: 0 });
  const chain = match.flow.chain;
  try {
    chain.layers.setObjects(made.host.objects());
    const sources = staticCostSources(chain);
    assert.equal(sources.length, 1);
    assert.equal(sources[0].source.id, forge.ref.id);
    assert.equal(sources[0].source.zoneEntryId, forge.ref.zoneEntryId);

    assert.equal(chain.commit({ type: 'gain-energy', player: 'A', amount: 10 }).status, 'done');
    const hand = made.kernel.objects.filter(object => object.owner === 'A' && object.zone === 'hand');
    const warmog = hand.find(object => object.cardId === WARMO_G);
    const doran = hand.find(object => object.cardId === DORAN);
    assert.ok(warmog, JSON.stringify(hand.map(object => object.cardId)));
    assert.ok(doran, JSON.stringify(hand.map(object => object.cardId)));
    assert.equal(warmog.isToken, true, 'the fixture reproduces the runtime setup-card carrier flag');
    assert.equal(warmog.tags.includes('Token'), false);
    assert.equal(warmog.energy, 1);

    const plans = [];
    const finalize = chain.finalize.bind(chain);
    chain.finalize = item => {
      finalize(item);
      if (item.costPlan !== undefined) plans.push(structuredClone(item.costPlan));
    };
    try {
      adapter.execute('A', {
        type: 'play', commandId: 'RIFT-1181:first', stateVersion: adapter.stateVersion,
        cardObjectId: warmog.ref.id,
      });
      settle(adapter);
      assert.equal(made.kernel.player('A').energy, 10);
      assert.deepEqual(chain.finalizedCardPlaysThisTurn().map(record => ({
        cardId: record.object.cardId,
        isToken: record.object.isToken,
      })), [{ cardId: WARMO_G, isToken: false }]);

      adapter.execute('A', {
        type: 'play', commandId: 'RIFT-1181:second', stateVersion: adapter.stateVersion,
        cardObjectId: doran.ref.id,
      });
      settle(adapter);
      assert.equal(made.kernel.player('A').energy, 8);

      assert.equal(plans.length, 2);
      assert.equal(plans[0].printed.energy, 1);
      assert.equal(plans[0].total.energy, 0);
      assert.deepEqual(plans[0].discounts.map(discount => ({
        id: discount.id, resource: discount.resource, amount: discount.amount,
      })), [{ id: 'program-cost:' + forge.ref.id + ':' + forge.ref.zoneEntryId + ':0:0:total',
        resource: 'energy', amount: 1 }]);
      assert.equal(plans[1].printed.energy, 2);
      assert.equal(plans[1].total.energy, 2);
      assert.deepEqual(plans[1].discounts, []);
    } finally {
      chain.finalize = finalize;
    }
  } finally {
    adapter.detach();
  }
});

test('RIFT-1181 legacy Battlefield-zone shape keeps carrier token history unchanged', () => {
  const made = makeHost(world().player('A').player('B').hand('legacy-warmog', {
    cardId: WARMO_G, types: ['gear'], energy: 1, power: null, might: 1,
    tags: ['Equipment'], isToken: true,
  }));
  const binding = createProgramBinding({ cardPrograms: [warmogsArmor] });
  const chain = new ChainEngine({
    turnOrder: ['A', 'B'], turnPlayer: 'A', phase: 'main', host: made.host,
    cleanup: () => false, describePlay: binding.describePlay,
  });
  binding.attachLifecycle(chain, error => { throw error; });
  assert.equal(chain.commit({ type: 'gain-energy', player: 'A', amount: 10 }).status, 'done');
  const source = made.kernel.getObject('legacy-warmog');
  const draft = binding.describePlay({ type: 'play', player: 'A', object: source.ref }, source);
  // This is an .mjs test; access the engine's private seam directly to check
  // its pure normalization behavior without inventing a Play or turn state.
  const internal = chain;
  const item = { ...draft, object: source.ref, status: 'pending', targetPlans: [] };
  const legacy = internal.finalizeCardSource(item, source);
  assert.equal(legacy, source, 'a legacy Battlefield-zone host receives no source rewrite');
  const current = internal.finalizeCardSource(item, { ...source, isToken: false });
  assert.equal(current.isToken, false, 'already-card sources remain unchanged');
  assert.equal(chain.finalizedCardPlaysThisTurn().length, 0,
    'legacy replay publishes no Finalize history');
});
