// RIFT-963: the production keyword lifecycle re-expands every keyword whose
// KeywordDef contributes a live combat rule. Shield's +X Might is the live
// dynamic-grant case opened by RIFT-962.
//
// Official evidence (CR v1.5, updated 2026-10-09 and effective under the
// 2026-10-16 Radiance policy):
// https://cmsassets.rgpub.io/sanity/files/dsfx7636/news_live/5c7946f7c3b8c6e0faff85ab6dadc6d2e721ea94.pdf
// - 478.1-478.4 require layer dependencies and ability grants to be rechecked.
// - 801.3.a applies the granted Keyword's own definition and duration.
// - 814.1.b.3, 814.1.c and 814.1.d.1 make Shield omitted-value 1 and add that
//   value to Might only while the host has the Defender designation.
// - 814.2 sums separate Shield sources; 814.3 makes Shield readable.
// M1 audit: the two precon ability sets contain Shield, Assault, Ganking,
// Deflect, Vision, Accelerate, Reaction, Hidden, Repeat, Weaponmaster, Equip,
// Legion, Deathknell, Mighty, Action and Quick-Draw. The production dynamic
// re-expansion path owns Shield/Assault/Ganking/Deflect/Vision: the first four
// derive layer rules and Vision derives the lifecycle trigger. The remaining
// declarative keywords have their own chain/cost/static consumers and are not
// granted-only layer rules. Tank is absent from these precon texts; it remains
// on the declared combat-rule path until a granted-Tank production assignment
// consumer is proven.
// The Mechanized Menace source is packages/card-data/data/deck-catalog.json,
// printing sfd-181-221, canonicalCardId
// card.hash-fadaa09c681d3d967954f99504cd9d3d749242dc99dbc40d60adfa60bf53cca7.
import assert from 'node:assert/strict';
import test from 'node:test';

import mechanizedMenace from '../../../card-dsl/dist/cards/sfd/mechanized-menace.js';
import stalwartPoro from '../../../card-dsl/dist/cards/ogn/stalwart-poro.js';
import { AwaitChoice } from '../../dist/effects/contract.js';
import { world } from '../../dist/effects/testing/index.js';
import { bindResolveContext, createActionPipelineHost } from '../../dist/events/action-adapter.js';
import { createProgramBinding } from '../../dist/programs/index.js';
import { TurnFlow } from '../../dist/turn/flow.js';

const MECHANIZED_MENACE = mechanizedMenace.canonicalCardId;
const FIELD = Object.freeze({ type: 'battlefield', id: 'bf1' });
const admitted = program => ({ ...program, status: 'executable', judgeReason: undefined });

function scene({ attackerController = 'B', attackerTags = ['Mech'], defenderController = 'A',
  defenderCardId, defenderFromHand = false, defenderTags = ['Mech'], defenderKeywords = [] } = {}) {
  const builder = world().player('A', { energy: 10, power: [] }).player('B')
    .unit('attacker', {
      owner: attackerController, controller: attackerController, might: 3,
      tags: attackerTags, energy: null, power: null, keywords: [], location: FIELD,
    });
  if (defenderFromHand) builder.hand('defender', {
    cardId: defenderCardId, owner: defenderController, types: ['unit'], tags: defenderTags,
    might: 3, energy: 2, power: [], keywords: defenderKeywords,
  });
  else builder.unit('defender', {
    owner: defenderController, controller: defenderController, might: 3, tags: defenderTags,
    ...(defenderCardId === undefined ? {} : { cardId: defenderCardId }),
    energy: null, power: null, keywords: defenderKeywords, location: FIELD,
  });
  for (const player of ['A', 'B']) {
    builder.deck([`${player}:deck:0`, `${player}:deck:1`], { owner: player });
    builder.rune([`${player}:rune:0`, `${player}:rune:1`], { owner: player });
  }
  const kernel = builder.build();
  const requests = [];
  const choose = request => {
    requests.push(request);
    if (request.type === 'select-objects' && request.min === request.max &&
        request.options.length === request.min) return [...request.options];
    throw new AwaitChoice(request);
  };
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: saved => { kernel.restore(saved.state); kernel.copyLinkedFrom(saved.links); },
    objects: () => kernel.objects,
    perform: action => kernel.perform(action),
    choose,
    context: (source, controller, timingPoint) => bindResolveContext(kernel, { source, controller, timingPoint, choose }),
    testTrigger: registration => kernel.test(registration.spec.condition),
  });
  const binding = createProgramBinding({ cardPrograms: [admitted(mechanizedMenace), admitted(stalwartPoro)] });
  const flow = new TurnFlow({
    host, player: id => kernel.player(id), turnOrder: ['A', 'B'],
    battlefields: [{ id: 'bf1', controller: null }, { id: 'bf2', controller: null }],
    describePlay: binding.describePlay,
  });
  const legend = flow.chain.commit({ type: 'create-token', player: 'A', to: 'legend', token: {
    cardId: MECHANIZED_MENACE, name: 'Mechanized Menace', types: ['legend'], tags: ['Rumble'],
    championLegend: true, keywords: [], might: null, energy: null, power: null,
  } });
  assert.equal(legend.status, 'done');
  binding.attachLifecycle(flow.chain, error => { throw error; });
  if (defenderFromHand) {
    assert.equal(flow.chain.commit({ type: 'play', player: defenderController,
      object: kernel.ref('defender'), location: FIELD }).status, 'done');
    flow.chain.advance();
    while (flow.chain.items.length) flow.chain.pass(flow.chain.priority);
    assert.equal(kernel.getObject('defender').zone, 'board');
  }
  return { kernel, requests, flow, binding };
}

function planDefenderDamage(f) {
  const attacker = f.kernel.getObject('attacker');
  f.flow.combat.entered(attacker);
  f.flow.combat.cleanup();
  f.flow.chain.advance();
  f.flow.combat.startCombat('bf1');
  while (f.flow.chain.items.length) f.flow.chain.pass(f.flow.chain.priority);
  while (f.flow.chain.focus !== null) f.flow.chain.pass(f.flow.chain.focus);
  return f.flow.combat.prepareDamage();
}

function shieldArithmetic(f, id) {
  return f.flow.chain.layers.registry.lifecycleRuleEffects().filter(entry =>
    entry.effect.source?.id === id && entry.effect.effect.kind === 'continuous.might' &&
    entry.effect.id.startsWith('program-keyword:'));
}

test('RIFT-963 Mechanized Menace grants one Shield and its real Defender damage budget is 4', () => {
  const f = scene();
  const plan = planDefenderDamage(f);
  const [shieldRule] = shieldArithmetic(f, 'defender');
  const combatDefender = f.flow.combat.snapshot(f.kernel.getObject('defender'));
  assert.equal(shieldRule?.effect.effect.amount, 1, 'the Shield KeywordDef emits +1 Might');
  assert.equal(shieldRule?.effect.effect.condition(combatDefender), true,
    'the published Shield condition reads the live Defender designation');
  assert.equal(plan.attacker.budget, 3, 'the opposing Attacker does not receive the grant');
  assert.equal(plan.defender.budget, 4, 'the granted friendly Mech adds one Might as Defender');
  assert.equal(shieldArithmetic(f, 'defender').length, 1,
    'the lifecycle publishes exactly one derived Shield Might rule');
  assert.equal(f.requests.length, 0);
});

test('RIFT-963 granted Shield grants no Might to a non-Mech or an Attacker', () => {
  const nonMech = scene({ defenderTags: [], defenderKeywords: [] });
  const nonMechPlan = planDefenderDamage(nonMech);
  assert.equal(nonMechPlan.defender.budget, 3, 'the non-Mech Defender suppresses the Shield grant');
  const defender = nonMech.kernel.getObject('defender');
  nonMech.flow.chain.layers.setObjects(nonMech.kernel.objects);
  assert.equal(nonMech.flow.chain.layers.evaluate(defender.ref).keywords.some(keyword => keyword.id.toLowerCase() === 'shield'), false);

  const mechAttacker = scene({ attackerController: 'A', attackerTags: ['Mech'], defenderController: 'B' });
  const attackerPlan = planDefenderDamage(mechAttacker);
  assert.equal(attackerPlan.attacker.budget, 3,
    'the friendly Mech Attacker has Shield but Shield does not add Might');
  assert.equal(attackerPlan.defender.budget, 3);
  assert.equal(shieldArithmetic(mechAttacker, 'attacker').length, 1,
    'the lifecycle publishes its derived rule even though the Attacker condition is false');
});

test('RIFT-963 printed Shield also contributes exactly one Defender Might', () => {
  const f = scene({ defenderCardId: stalwartPoro.canonicalCardId, defenderFromHand: true, defenderTags: [] });
  const plan = planDefenderDamage(f);
  assert.equal(plan.attacker.budget, 3);
  assert.equal(plan.defender.budget, 4, 'printed Shield adds exactly one Might in the real plan');
  assert.equal(f.flow.chain.layers.registry.list().filter(entry => entry.effect.source?.id === 'defender' &&
    entry.effect.effect.kind === 'continuous.might').length, 1,
    'printed Shield contributes one derived Might rule');
});
