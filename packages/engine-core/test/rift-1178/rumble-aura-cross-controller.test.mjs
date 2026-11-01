import assert from 'node:assert/strict';
import test from 'node:test';

import rumbleHotheaded from '../../../card-dsl/dist/cards/sfd/rumble-hotheaded.js';
import rumbleScrapper from '../../../card-dsl/dist/cards/sfd/rumble-scrapper.js';
import { ChainEngine } from '../../dist/chain/engine.js';
import { CombatFlow } from '../../dist/combat/flow.js';
import { bindResolveContext, createActionPipelineHost } from '../../dist/events/action-adapter.js';
import { world } from '../../dist/effects/testing/index.js';
import { createProgramBinding } from '../../dist/programs/index.js';
import { createEngineStaticBinder } from '../../dist/programs/statics.js';
import { KeywordGrantLayerEngine } from '../../dist/programs/keyword-grants.js';

// Riftbound Core Rules v1.5, published 2026-10-09 and effective 2026-10-16:
// https://cmsassets.rgpub.io/sanity/files/dsfx7636/news_live/5c7946f7c3b8c6e0faff85ab6dadc6d2e721ea94.pdf
//
// CR 740.1.a defines friendly Game Objects by their shared controller.
// CR 479.3.a-b place granted abilities and keywords in the ability layer,
// while CR 478.1.a and 478.3 require its applicability to be re-evaluated.
// CR 801.3.a and 801.3.a.3 define the grant and its source lifetime; CR 807.1.c
// and 807.1.d.1 make Assault's Might bonus conditional on the Attacker
// designation. CR 467.2.a-b require the damage budget to use each side's
// current Might. The card source is the official zh_CN gallery read on
// 2026-10-31; its English text is "Your Mechs each have [Assault]."
const CORE_RULES_URL = 'https://cmsassets.rgpub.io/sanity/files/dsfx7636/news_live/5c7946f7c3b8c6e0faff85ab6dadc6d2e721ea94.pdf';
const GALLERY_URL = 'https://content.publishing.riotgames.com/publishing-content/v2.0/public/channel/riftbound_website/list/riftbound_gallery_cards?locale=zh_CN';
const FIELD = Object.freeze({ type: 'battlefield', id: 'RIFT-1178-field' });
const FORECASTER = 'card.hash-cdeb1c4bb2202d43d0f4ccb7c3e0ddfa25caf4f81c41dde5c8bdaa6bbeddfe40';
const DEFENDER_MECH = 'synthetic:rift-1178:defender-mech';

function assaultInstances(object) {
  return object.keywords.filter(keyword => keyword.id.toLowerCase() === 'assault');
}

function runtime({ aRumble = true, bRumble = true } = {}) {
  let builder = world().player('A').player('B')
    .unit('attacker', {
      owner: 'A', controller: 'A', cardId: FORECASTER, types: ['unit'], tags: ['Mech'],
      might: 2, keywords: [], location: FIELD,
    })
    .unit('defender', {
      owner: 'B', controller: 'B', cardId: DEFENDER_MECH, types: ['unit'], tags: ['Mech'],
      might: 2, keywords: [], location: FIELD,
    });
  if (aRumble) builder = builder.hand('rumble-a', {
    owner: 'A', controller: 'A', cardId: rumbleHotheaded.canonicalCardId,
    types: ['unit'], tags: ['Mech'], might: 4, keywords: [],
  });
  if (bRumble) builder = builder.hand('rumble-b', {
    owner: 'B', controller: 'B', cardId: rumbleHotheaded.canonicalCardId,
    types: ['unit'], tags: ['Mech'], might: 4, keywords: [],
  });
  for (const player of ['A', 'B']) {
    builder.deck(`${player}:deck:0`, { owner: player });
    builder.rune(`${player}:rune:0`, { owner: player });
  }
  const kernel = builder.build();
  const choose = request => { throw new Error(`Unexpected RIFT-1178 choice ${request.id}`); };
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
  });
  const binding = createProgramBinding({ cardPrograms: [rumbleHotheaded] });
  const chain = new ChainEngine({
    host, turnOrder: ['A', 'B'], turnPlayer: 'A', phase: 'main',
    cleanup: () => false, describePlay: binding.describePlay,
  });
  chain.initializeBattlefieldControl([{ id: FIELD.id, controller: 'B' }, { id: 'RIFT-1178-unused', controller: null }]);
  const flow = new CombatFlow(chain, host,
    [{ id: FIELD.id, controller: 'B' }, { id: 'RIFT-1178-unused', controller: null }],
    () => undefined, { events: true, lifecycle: true });
  binding.attachLifecycle(chain, error => { throw error; });

  const promoteRumble = (id) => {
    const object = kernel.getObject(id);
    if (object === null) return null;
    const moved = chain.commit({ type: 'move-zone', object: object.ref, to: 'board',
      location: { type: 'base', player: object.controller } });
    assert.equal(moved.status, 'done');
    return kernel.getObject(id).ref;
  };
  const rumbleARef = promoteRumble('rumble-a');
  const rumbleBRef = promoteRumble('rumble-b');
  chain.advance();
  chain.layers.setObjects(kernel.objects);

  const evaluate = id => chain.layers.evaluate(kernel.ref(id));
  const registrations = chain.layers.registry.list().filter(entry => {
    const effect = entry.effect.effect;
    return entry.effect.layer === 'ability' && effect.kind === 'continuous.grant-keyword' &&
      effect.keyword.toLowerCase() === 'assault';
  }).map(entry => ({
    id: entry.effect.id,
    sourceId: entry.effect.source?.id,
    sourceController: kernel.getObject(entry.effect.source?.id)?.controller ?? null,
    effectiveKeyword: entry.effect.effect.keyword,
  }));
  return { kernel, chain, flow, evaluate, registrations, rumbleARef, rumbleBRef };
}

function enterDamageStep(f) {
  assert.equal(f.flow.entered(f.kernel.getObject('attacker')).length, 1);
  assert.equal(f.flow.cleanup(), true);
  f.chain.advance();
  const started = f.flow.startCombat(FIELD.id);
  assert.equal(started.attacker, 'A');
  assert.equal(started.defender, 'B');
  assert.equal(f.chain.focus, 'A');
  f.chain.pass('A');
  assert.equal(f.chain.focus, 'B');
  f.chain.pass('B');
  assert.equal(f.chain.turnState, 'neutral-open');
  return f.flow.prepareDamage();
}

test('both controllers have a Rumble: each Mech receives only its own Assault', () => {
  const f = runtime();
  assert.deepEqual(f.registrations.map(entry => entry.sourceId).sort(),
    [f.rumbleARef.id, f.rumbleBRef.id].sort());
  assert.deepEqual(f.registrations.map(entry => entry.sourceController).sort(), ['A', 'B']);
  assert.deepEqual(f.registrations.map(entry => entry.effectiveKeyword), ['Assault', 'Assault']);
  assert.deepEqual(assaultInstances(f.evaluate('attacker')).map(keyword => keyword.value), [1]);
  assert.deepEqual(assaultInstances(f.evaluate('defender')).map(keyword => keyword.value), [1]);

  const plan = enterDamageStep(f);
  assert.equal(plan.attacker.budget, 3, 'A Forecaster has 2 printed Might plus only A Rumble Assault 1');
  assert.equal(plan.defender.budget, 2, 'B Rumble grants Assault to a defender but Assault adds no Might while defending');
});

test('only the opponent has a Rumble: its Assault never reaches a friendly Mech', () => {
  const f = runtime({ aRumble: false, bRumble: true });
  assert.deepEqual(f.registrations.map(entry => [entry.sourceId, entry.sourceController]),
    [[f.rumbleBRef.id, 'B']]);
  assert.deepEqual(assaultInstances(f.evaluate('attacker')), [], 'A Forecaster is not friendly to B Rumble under CR 740.1.a');
  assert.deepEqual(assaultInstances(f.evaluate('defender')).map(keyword => keyword.value), [1]);

  const plan = enterDamageStep(f);
  assert.equal(plan.attacker.budget, 2, 'the opponent-only Rumble cannot add to A Forecaster');
  assert.equal(plan.defender.budget, 2, 'Assault does not add Might to the B defender');
});

test('only the controller has a Rumble: it grants Assault to its own Mech but not the opponent', () => {
  const f = runtime({ aRumble: true, bRumble: false });
  assert.deepEqual(f.registrations.map(entry => [entry.sourceId, entry.sourceController]),
    [[f.rumbleARef.id, 'A']]);
  assert.deepEqual(assaultInstances(f.evaluate('attacker')).map(keyword => keyword.value), [1]);
  assert.deepEqual(assaultInstances(f.evaluate('defender')), []);

  const plan = enterDamageStep(f);
  assert.equal(plan.attacker.budget, 3);
  assert.equal(plan.defender.budget, 2);
});

test('Rumble, Scrapper continuous Might is also constrained to its controller', () => {
  const kernel = world().player('A').player('B')
    .unit('scrapper', {
      owner: 'B', controller: 'B', cardId: rumbleScrapper.canonicalCardId,
      types: ['unit'], tags: ['Mech'], might: 4, keywords: [],
      location: { type: 'base', player: 'B' },
    })
    .unit('a-mech', {
      owner: 'A', controller: 'A', types: ['unit'], tags: ['Mech'], might: 2, keywords: [],
      location: { type: 'base', player: 'A' },
    })
    .unit('b-mech', {
      owner: 'B', controller: 'B', types: ['unit'], tags: ['Mech'], might: 2, keywords: [],
      location: { type: 'base', player: 'B' },
    })
    .build();
  const choose = request => { throw new Error(`Unexpected RIFT-1178 choice ${request.id}`); };
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: saved => { kernel.restore(saved.state); kernel.copyLinkedFrom(saved.links); },
    objects: () => kernel.objects,
    perform: action => kernel.perform(action),
    choose,
    context: (source, controller, timingPoint) => bindResolveContext(kernel, {
      source, controller, timingPoint, choose,
    }),
  });
  const chain = new ChainEngine({
    host, turnOrder: ['A', 'B'], turnPlayer: 'A', phase: 'main', cleanup: () => false,
  });
  createProgramBinding({ cardPrograms: [rumbleScrapper] }).attachLifecycle(chain, error => { throw error; });
  chain.pipeline.emit({ timingPoint: 'object-enters-board', object: kernel.getObject('scrapper'), player: 'B' });
  chain.layers.enableDiagnostics();
  chain.layers.resetDiagnostics();
  chain.advance();
  chain.layers.setObjects(kernel.objects);
  chain.layers.evaluateAll();
  const might = id => chain.layers.evaluate(kernel.ref(id)).might;
  assert.equal(might('scrapper'), 5, 'B Scrapper includes itself once');
  assert.equal(might('b-mech'), 3, 'B Mech receives its controller Rumble Might');
  assert.equal(might('a-mech'), 2, 'A Mech never receives B Scrapper Might');
  assert.equal(chain.layers.diagnostics.dependencyRestarts, 0,
    'player-relative filtering does not reopen a board-wide dependency cycle');
  assert.equal(chain.layers.diagnostics.multiObjectGroups, 0,
    'the Scrapper source does not merge unrelated controllers into one layer group');
  chain.commit({ type: 'take-control', object: kernel.ref('scrapper'), player: 'A' });
  chain.layers.setObjects(kernel.objects);
  assert.equal(might('scrapper'), 5);
  assert.equal(might('a-mech'), 3, 'the same live aura now follows the new controller');
  assert.equal(might('b-mech'), 2, 'the former controller loses the aura');
  chain.commit({ type: 'move-zone', object: kernel.ref('scrapper'), to: 'trash' });
  chain.layers.setObjects(kernel.objects);
  assert.equal(might('a-mech'), 2, 'a departed Scrapper cannot keep changing enemy or friendly units');
});

test('a departed Rumble source cannot retarget its Assault grant to the old opponent', () => {
  const kernel = world().player('A').player('B')
    .unit('forecaster', {
      owner: 'A', controller: 'A', cardId: FORECASTER,
      types: ['unit'], tags: ['Mech'], might: 2, keywords: [],
      location: { type: 'base', player: 'A' },
    })
    .unit('rumble', {
      owner: 'B', controller: 'B', cardId: rumbleHotheaded.canonicalCardId,
      types: ['unit'], tags: ['Mech'], might: 4, keywords: [],
      location: { type: 'base', player: 'B' },
    })
    .build();
  const choose = request => { throw new Error(`Unexpected RIFT-1178 choice ${request.id}`); };
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: saved => { kernel.restore(saved.state); kernel.copyLinkedFrom(saved.links); },
    objects: () => kernel.objects,
    perform: action => kernel.perform(action),
    choose,
    context: (source, controller, timingPoint) => bindResolveContext(kernel, {
      source, controller, timingPoint, choose,
    }),
  });
  const chain = new ChainEngine({
    host, turnOrder: ['A', 'B'], turnPlayer: 'A', phase: 'main', cleanup: () => false,
  });
  const source = kernel.getObject('rumble');
  createEngineStaticBinder(chain).bindStatic(rumbleHotheaded.abilities[0], source);
  chain.layers.setObjects(kernel.objects);
  assert.deepEqual(assaultInstances(chain.layers.evaluate(kernel.ref('forecaster'))), []);
  assert.equal(chain.commit({ type: 'move-zone', object: source.ref, to: 'trash' }).status, 'done');
  chain.layers.setObjects(kernel.objects);
  assert.deepEqual(assaultInstances(chain.layers.evaluate(kernel.ref('forecaster'))), [],
    'an opponent source must remain scoped to its controller and fail closed after departure');
});

test('the keyword re-expansion layer keeps a live source and fails closed after departure', () => {
  const kernel = world().player('A').player('B')
    .unit('forecaster', {
      owner: 'A', controller: 'A', cardId: FORECASTER,
      types: ['unit'], tags: ['Mech'], might: 2, keywords: [],
    })
    .unit('rumble', {
      owner: 'B', controller: 'B', cardId: rumbleHotheaded.canonicalCardId,
      types: ['unit'], tags: ['Mech'], might: 4, keywords: [],
    })
    .build();
  const choose = request => { throw new Error(`Unexpected RIFT-1178 choice ${request.id}`); };
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: saved => { kernel.restore(saved.state); kernel.copyLinkedFrom(saved.links); },
    objects: () => kernel.objects,
    perform: action => kernel.perform(action),
    choose,
    context: (source, controller, timingPoint) => bindResolveContext(kernel, {
      source, controller, timingPoint, choose,
    }),
  });
  const layers = new KeywordGrantLayerEngine(kernel.objects, {
    context: source => bindResolveContext(kernel, {
      source, controller: source.controller, choose,
    }),
  });
  const engine = new ChainEngine({
    host, layers, turnOrder: ['A', 'B'], turnPlayer: 'A', phase: 'main', cleanup: () => false,
  });
  const source = kernel.getObject('rumble');
  createEngineStaticBinder(engine).bindStatic(rumbleHotheaded.abilities[0], source);
  layers.setObjects(kernel.objects);
  assert.deepEqual(assaultInstances(layers.evaluate(kernel.ref('forecaster'))), [],
    'B Rumble cannot grant Assault to A Forecaster while the source is live');
  const registration = engine.layers.registry.list().find(entry =>
    entry.effect.layer === 'ability' &&
    entry.effect.effect.kind === 'continuous.grant-keyword' &&
    entry.effect.effect.keyword === 'Assault' &&
    entry.effect.source?.id === source.ref.id);
  assert.ok(registration, 'the production binder registered the Rumble grant');
  assert.deepEqual(registration.duration, { type: 'permanent' },
    'the base static registration remains compatible with explicit permanent effects');
  assert.equal(registration.effect.effect.condition?.(layers.evaluate(kernel.ref('forecaster'))), false,
  'the live keyword filter rejects an opponent target even without source-loss anchoring');
  assert.equal(engine.commit({ type: 'move-zone', object: source.ref, to: 'trash' }).status, 'done');
  layers.setObjects(kernel.objects);
  assert.deepEqual(assaultInstances(layers.evaluate(kernel.ref('forecaster'))), [],
    'a stale source registration must fail closed instead of substituting the target');
  assert.deepEqual(registration.duration, { type: 'permanent' },
    'the lifecycle contract retains the registration for explicit detach');
});

test('default game-server layers never replace a departed static source with its target', () => {
  const kernel = world().player('A').player('B')
    .unit('forecaster', {
      owner: 'A', controller: 'A', cardId: FORECASTER,
      types: ['unit'], tags: ['Mech'], might: 2, keywords: [],
    })
    .unit('rumble', {
      owner: 'B', controller: 'B', cardId: rumbleHotheaded.canonicalCardId,
      types: ['unit'], tags: ['Mech'], might: 4, keywords: [],
    })
    .build();
  const choose = request => { throw new Error(`Unexpected RIFT-1178 choice ${request.id}`); };
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: saved => { kernel.restore(saved.state); kernel.copyLinkedFrom(saved.links); },
    objects: () => kernel.objects,
    perform: action => kernel.perform(action),
    choose,
    context: (source, controller, timingPoint) => bindResolveContext(kernel, {
      source, controller, timingPoint, choose,
    }),
  });
  const chain = new ChainEngine({
    host, turnOrder: ['A', 'B'], turnPlayer: 'A', phase: 'main', cleanup: () => false,
  });
  createProgramBinding({ cardPrograms: [rumbleHotheaded] }).attachLifecycle(chain, error => { throw error; });
  chain.pipeline.emit({ timingPoint: 'object-enters-board', object: kernel.getObject('rumble'), player: 'B' });
  chain.layers.setObjects(kernel.objects);
  assert.deepEqual(assaultInstances(chain.layers.evaluate(kernel.ref('forecaster'))), []);
  assert.equal(chain.commit({ type: 'move-zone', object: kernel.ref('rumble'), to: 'trash' }).status, 'done');
  chain.layers.setObjects(kernel.objects);
  assert.deepEqual(assaultInstances(chain.layers.evaluate(kernel.ref('forecaster'))), []);
});

test('a static aura succeeds and then fails closed on its exact source departure', () => {
  const kernel = world().player('A').player('B')
    .unit('forecaster', {
      owner: 'A', controller: 'A', cardId: FORECASTER,
      types: ['unit'], tags: ['Mech'], might: 2, keywords: [],
    })
    .unit('rumble', {
      owner: 'A', controller: 'A', cardId: rumbleHotheaded.canonicalCardId,
      types: ['unit'], tags: ['Mech'], might: 4, keywords: [],
    })
    .build();
  const choose = request => { throw new Error(`Unexpected RIFT-1178 choice ${request.id}`); };
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: saved => { kernel.restore(saved.state); kernel.copyLinkedFrom(saved.links); },
    objects: () => kernel.objects,
    perform: action => kernel.perform(action),
    choose,
    context: (source, controller, timingPoint) => bindResolveContext(kernel, {
      source, controller, timingPoint, choose,
    }),
  });
  const chain = new ChainEngine({
    host, turnOrder: ['A', 'B'], turnPlayer: 'A', phase: 'main', cleanup: () => false,
  });
  createProgramBinding({ cardPrograms: [rumbleHotheaded] }).attachLifecycle(chain, error => { throw error; });
  chain.pipeline.emit({ timingPoint: 'object-enters-board', object: kernel.getObject('rumble'), player: 'A' });
  chain.layers.setObjects(kernel.objects);
  assert.deepEqual(assaultInstances(chain.layers.evaluate(kernel.ref('forecaster'))), [{ id: 'Assault', value: 1 }]);
  assert.equal(chain.commit({ type: 'move-zone', object: kernel.ref('rumble'), to: 'trash' }).status, 'done');
  chain.layers.setObjects(kernel.objects);
  assert.deepEqual(assaultInstances(chain.layers.evaluate(kernel.ref('forecaster'))), []);
});

test('the official rules and gallery sources are pinned for this interaction', () => {
  assert.equal(CORE_RULES_URL, 'https://cmsassets.rgpub.io/sanity/files/dsfx7636/news_live/5c7946f7c3b8c6e0faff85ab6dadc6d2e721ea94.pdf');
  assert.match(GALLERY_URL, /locale=zh_CN$/u);
});
