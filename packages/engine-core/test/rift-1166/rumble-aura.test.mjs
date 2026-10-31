import assert from 'node:assert/strict';
import test from 'node:test';

import mechanizedMenace from '../../../card-dsl/dist/cards/sfd/mechanized-menace.js';
import rumbleHotheaded from '../../../card-dsl/dist/cards/sfd/rumble-hotheaded.js';
import { ChainEngine } from '../../dist/chain/engine.js';
import { CombatFlow } from '../../dist/combat/flow.js';
import { createActionPipelineHost, bindResolveContext } from '../../dist/events/action-adapter.js';
import { world } from '../../dist/effects/testing/index.js';
import { createProgramBinding } from '../../dist/programs/index.js';

// Core Rules v1.5 (published 2026-10-09, effective 2026-10-16):
// https://cmsassets.rgpub.io/sanity/files/dsfx7636/news_live/5c7946f7c3b8c6e0faff85ab6dadc6d2e721ea94.pdf
// 174.6 lets a Legend have Passive Abilities; 363-365 make the on-Board
// permanent passive active; 366.1 requires a non-Board passive to describe
// its own zone. 478 keeps re-evaluating layers. 466.2.c.3 gives the combat
// designations and 467.2 sums current Might. 801.3.a applies a granted keyword's
// own definition; Assault is 807.1.c/d.1 and Shield is 814.1.b.3/c/d.1.
// The Legend is in the Legend Zone (107.4.c, 174.6), while Rumble is active
// only after it enters the Board. In the Champion Zone, Rumble's text does not
// self-describe that zone, so CR 365.1/366.1 leaves its passive inactive.

const LEGEND = mechanizedMenace.canonicalCardId;
const RUMBLE = rumbleHotheaded.canonicalCardId;
const FIELD = Object.freeze({ type: 'battlefield', id: 'RIFT-1166-field' });

function keywordIds(object, id) {
  return object.keywords.filter(keyword => keyword.id.toLowerCase() === id.toLowerCase());
}

function runtime({ legend = true, legendController = 'A', rumble = 'board', defenderMech = true,
  attackerController = 'A', defenderController = 'B', reportedPoros = false } = {}) {
  const builder = world().player('A').player('B')
    .unit('ally-mech', {
      owner: 'A', controller: 'A', cardId: 'RIFT-1166-ally-mech',
      types: ['unit'], tags: ['Mech'], might: 3, keywords: [], location: { type: 'base', player: 'A' },
    })
    .unit('ally-non-mech', {
      owner: 'A', controller: 'A', cardId: 'RIFT-1166-ally-non-mech',
      types: ['unit'], tags: ['Poro'], might: 3, keywords: [], location: { type: 'base', player: 'A' },
    })
    .unit('enemy-mech', {
      owner: 'B', controller: 'B', cardId: 'RIFT-1166-enemy-mech',
      types: ['unit'], tags: ['Mech'], might: 3, keywords: [], location: { type: 'base', player: 'B' },
    })
    .unit('attacker', {
      owner: attackerController, controller: attackerController, cardId: 'RIFT-1166-attacker',
      types: ['unit'], tags: reportedPoros ? ['Poro'] : ['Mech'], might: reportedPoros ? 2 : 3,
      keywords: [], location: FIELD,
    })
    .unit('defender', {
      owner: defenderController, controller: defenderController, cardId: 'RIFT-1166-defender',
      types: ['unit'], tags: defenderMech ? ['Mech'] : ['Poro'], might: reportedPoros ? 2 : 3,
      keywords: [], location: FIELD,
    });
  if (rumble !== null) builder.card('rumble', {
    owner: 'A', controller: 'A', cardId: RUMBLE, types: ['unit'], tags: ['Mech'],
    might: 4, keywords: [], zone: rumble, location: null,
  });
  for (const player of ['A', 'B']) {
    builder.deck(`${player}:deck:0`, { owner: player });
    builder.rune(`${player}:rune:0`, { owner: player });
  }
  const kernel = builder.build();
  const requests = [];
  const choose = request => {
    requests.push(request);
    if (request.type === 'mode' && request.id.startsWith('engagement:')) return request.options[0];
    if (request.type === 'select-objects' && request.options.length === request.min) return [...request.options];
    throw new Error(`Unexpected RIFT-1166 choice ${request.id}`);
  };
  const pipelineHost = createActionPipelineHost({
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
  const programs = [mechanizedMenace, rumbleHotheaded];
  const binding = createProgramBinding({ cardPrograms: programs });
  const chain = new ChainEngine({
    host: pipelineHost, turnOrder: ['A', 'B'], turnPlayer: 'A', phase: 'main',
    cleanup: () => false, describePlay: binding.describePlay,
  });
  const flow = new CombatFlow(chain, pipelineHost,
    [{ id: FIELD.id, controller: defenderController }, { id: 'RIFT-1166-unused', controller: null }],
    () => undefined, { events: true, lifecycle: true });
  binding.attachLifecycle(chain, error => { throw error; });
  if (legend) {
    const created = chain.commit({ type: 'create-token', player: legendController, to: 'legend', token: {
      cardId: LEGEND, name: 'Mechanized Menace', types: ['legend'], tags: ['Rumble'],
      championLegend: true, keywords: [], might: null, energy: null, power: null,
    } });
    assert.equal(created.status, 'done');
  }
  if (rumble === 'board' || rumble === 'chain') {
    assert.equal(chain.commit({ type: 'move-zone', object: kernel.ref('rumble'), to: rumble,
      ...(rumble === 'board' ? { location: { type: 'base', player: 'A' } } : {}) }).status, 'done');
    chain.advance();
  }
  chain.layers.setObjects(kernel.objects);
  const evaluate = id => {
    chain.layers.setObjects(kernel.objects);
    return chain.layers.evaluate(kernel.ref(id));
  };
  return { kernel, binding, chain, flow, requests, evaluate };
}

function finishShowdown(f) {
  f.flow.entered(f.kernel.getObject('attacker'));
  f.flow.cleanup();
  f.chain.advance();
  const started = f.flow.startCombat(FIELD.id);
  assert.equal(started.attacker, 'A');
  assert.equal(started.defender, 'B');
  for (let guard = 0; guard < 40 && f.chain.items.length > 0; guard++) {
    f.chain.pass(f.chain.priority);
  }
  assert.equal(f.chain.items.length, 0);
  for (let guard = 0; guard < 4 && f.chain.focus !== null; guard++) f.chain.pass(f.chain.focus);
  assert.equal(f.chain.turnState, 'neutral-open');
}

test('RIFT-1166 a Legend in Legend Zone grants Shield only to its controller Mech defender', () => {
  const f = runtime({ rumble: null, defenderMech: false });
  f.chain.layers.setObjects(f.kernel.objects);
  const ally = f.chain.layers.evaluate(f.kernel.ref('ally-mech'));
  assert.deepEqual(keywordIds(ally, 'Shield').map(keyword => keyword.value), [1]);
  assert.equal(ally.might, 3, 'Shield does not add Might outside the Defender designation');

  const ownDefender = runtime({ rumble: null, defenderMech: true,
    legendController: 'B', attackerController: 'A', defenderController: 'B' });
  ownDefender.chain.layers.setObjects(ownDefender.kernel.objects);
  assert.deepEqual(keywordIds(ownDefender.chain.layers.evaluate(ownDefender.kernel.ref('ally-non-mech')), 'Shield'), []);
  assert.deepEqual(keywordIds(ownDefender.chain.layers.evaluate(ownDefender.kernel.ref('enemy-mech')), 'Shield'),
    [{ id: 'shield', value: 1 }], 'B controls both the Legend and enemy-mech relative to A');
  finishShowdown(ownDefender);
  const plan = ownDefender.flow.prepareDamage();
  assert.equal(plan.defender.budget, 4, 'the friendly Mech Defender receives Shield 1 under CR 814.1.c');
  assert.equal(plan.attacker.budget, 3, 'Shield cannot add Might to the Attacker');
  assert.deepEqual(ownDefender.requests, []);
});

test('RIFT-1166 Rumble on Board grants Assault only to its controller Mech attacker', () => {
  const f = runtime({ legend: false });
  f.chain.layers.setObjects(f.kernel.objects);
  const ally = f.chain.layers.evaluate(f.kernel.ref('ally-mech'));
  assert.deepEqual(keywordIds(ally, 'Assault').map(keyword => keyword.value), [1]);
  assert.equal(ally.might, 3, 'Assault does not add Might outside the Attacker designation');
  assert.deepEqual(keywordIds(f.chain.layers.evaluate(f.kernel.ref('ally-non-mech')), 'Assault'), []);
  assert.deepEqual(keywordIds(f.chain.layers.evaluate(f.kernel.ref('enemy-mech')), 'Assault'), []);

  finishShowdown(f);
  const plan = f.flow.prepareDamage();
  assert.equal(plan.attacker.budget, 4, 'the friendly Mech Attacker receives Assault 1 under CR 807.1.c');
  assert.deepEqual(f.requests, []);
});

test("RIFT-1166 Rumble's passive is inactive in Champion Zone under CR 365.1 and 366.1", () => {
  const f = runtime({ rumble: 'champion' });
  finishShowdown(f);
  assert.equal(f.flow.prepareDamage().attacker.budget, 3,
    'Champion Zone Rumble does not self-describe a zone-wide passive; it cannot grant Assault');
});

test('RIFT-1166 reported Plundering Poro battle stays at Might 2 per side', () => {
  const f = runtime({ legend: true, rumble: 'board', defenderMech: false, reportedPoros: true });
  assert.deepEqual(f.kernel.getObject('attacker').tags, ['Poro']);
  assert.deepEqual(f.kernel.getObject('defender').tags, ['Poro']);
  finishShowdown(f);
  const plan = f.flow.prepareDamage();
  assert.equal(plan.attacker.budget, 2);
  assert.equal(plan.defender.budget, 2);
  assert.deepEqual(f.requests, []);
});
