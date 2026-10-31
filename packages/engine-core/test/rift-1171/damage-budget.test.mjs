import assert from 'node:assert/strict';
import test from 'node:test';

import { ChainEngine } from '../../dist/chain/engine.js';
import { CombatFlow } from '../../dist/combat/flow.js';
import { world } from '../../dist/effects/testing/index.js';
import { bindResolveContext, createActionPipelineHost } from '../../dist/events/action-adapter.js';

// Core Rules v1.5 (published 2026-10-09, effective 2026-10-16):
// https://cmsassets.rgpub.io/sanity/files/dsfx7636/news_live/5c7946f7c3b8c6e0faff85ab6dadc6d2e721ea94.pdf
// 467.2.a sums all Attacking Units' current Might, 467.2.b does the same for
// Defending Units, and 467.2.c assigns each side's budget to opposing Units.
// Units elsewhere on the Board neither attack nor defend at this Battlefield.

const FIELD = Object.freeze({ type: 'battlefield', id: 'RIFT-1171-field' });
const OTHER_FIELD = Object.freeze({ type: 'battlefield', id: 'RIFT-1171-other-field' });

function fixture({ attackers, defenders, elsewhere = [] }) {
  const builder = world().player('A').player('B');
  for (const unit of attackers) builder.unit(unit.id, {
    owner: 'A', controller: 'A', types: ['unit'], tags: unit.tags ?? [],
    keywords: [], might: unit.might, energy: null, power: null, location: FIELD,
  });
  for (const unit of defenders) builder.unit(unit.id, {
    owner: 'B', controller: 'B', types: ['unit'], tags: unit.tags ?? [],
    keywords: [], might: unit.might, energy: null, power: null, location: FIELD,
  });
  for (const unit of elsewhere) builder.unit(unit.id, {
    owner: unit.controller, controller: unit.controller, types: ['unit'], tags: unit.tags ?? [],
    keywords: [], might: unit.might, energy: null, power: null,
    location: unit.location ?? OTHER_FIELD,
  });
  for (const player of ['A', 'B']) {
    builder.deck([`${player}:deck:0`, `${player}:deck:1`], { owner: player });
    builder.rune([`${player}:rune:0`, `${player}:rune:1`], { owner: player });
  }
  const kernel = builder.build();
  const choose = request => {
    if (request.type === 'mode') return request.options[0];
    if (request.type === 'select-objects' && request.min === request.max &&
        request.options.length === request.min) return [...request.options];
    throw new Error(`Unexpected RIFT-1171 choice ${request.id}`);
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
    testTrigger: registration => kernel.test(registration.spec.condition),
  });
  const chain = new ChainEngine({
    host, turnOrder: ['A', 'B'], turnPlayer: 'A', phase: 'main', cleanup: () => false,
  });
  chain.initializeBattlefieldControl([{ id: FIELD.id, controller: 'B' }, { id: OTHER_FIELD.id, controller: null }]);
  const combat = new CombatFlow(chain, host,
    [{ id: FIELD.id, controller: 'B' }, { id: OTHER_FIELD.id, controller: null }],
    () => undefined, { events: true, lifecycle: true });
  // Install the given combat position; preparation below still opens the
  // Showdown and freezes damage through CombatFlow's production methods.
  combat.restore({
    ...combat.checkpoint(),
    fields: combat.battlefields.map(field => field.id === FIELD.id
      ? { ...field, contestedBy: 'A', staged: 'combat' }
      : field),
  });
  return { kernel, chain, combat };
}

function prepareDamage(f) {
  assert.equal(f.combat.entered(f.kernel.getObject('attacker-1')).length, 0,
    'the given combat position already contains both sides');
  const started = f.combat.startCombat(FIELD.id);
  assert.deepEqual({ attacker: started.attacker, defender: started.defender },
    { attacker: 'A', defender: 'B' });
  assert.equal(f.chain.focus, 'A');
  f.chain.pass('A');
  assert.equal(f.chain.focus, 'B');
  f.chain.pass('B');
  assert.equal(f.chain.turnState, 'neutral-open');
  return f.combat.prepareDamage();
}

test('RIFT-1171 reports each side of a 2-Might versus 4-Might Combat separately', () => {
  const f = fixture({
    attackers: [{ id: 'attacker-1', might: 2 }],
    defenders: [{ id: 'defender-1', might: 4 }],
  });
  const plan = prepareDamage(f);
  assert.deepEqual(f.combat.damageView(), {
    combatId: 'combat:RIFT-1171-field:1', battlefieldId: FIELD.id,
    attackerPlayerId: 'A', defenderPlayerId: 'B',
    attackerMight: 2, defenderMight: 4, attackerSubmitted: false,
  });
  assert.deepEqual(plan.attacker.targets.map(target => [target.uid, target.currentMight]),
    [['defender-1', 4]]);
  assert.deepEqual(plan.defender.targets.map(target => [target.uid, target.currentMight]),
    [['attacker-1', 2]]);
});

test('RIFT-1171 sums every participating Unit and excludes Units elsewhere', () => {
  const f = fixture({
    attackers: [{ id: 'attacker-1', might: 5 }],
    defenders: [{ id: 'defender-1', might: 5 }],
    elsewhere: [
      { id: 'a-elsewhere', controller: 'A', might: 9 },
      { id: 'b-elsewhere', controller: 'B', might: 11 },
      { id: 'a-base-reserve', controller: 'A', might: 13,
        location: { type: 'base', player: 'A' } },
    ],
  });
  const plan = prepareDamage(f);
  assert.equal(plan.attacker.budget, 5, 'A elsewhere and Base Units do not alter the own-side budget');
  assert.equal(plan.defender.budget, 5, 'B elsewhere does not alter the own-side budget');
  assert.deepEqual(plan.attacker.targets.map(target => target.uid), ['defender-1']);
  assert.deepEqual(plan.defender.targets.map(target => target.uid), ['attacker-1']);
  assert.deepEqual(f.combat.damageView(), {
    combatId: 'combat:RIFT-1171-field:1', battlefieldId: FIELD.id,
    attackerPlayerId: 'A', defenderPlayerId: 'B',
    attackerMight: 5, defenderMight: 5, attackerSubmitted: false,
  });
});

test('RIFT-1171 sums layered current Might after controller-relative auras', () => {
  const f = fixture({
    attackers: [{ id: 'attacker-1', might: 2, tags: ['Mech'] }],
    defenders: [{ id: 'defender-1', might: 4, tags: ['Mech'] }],
    elsewhere: [{ id: 'a-non-mech', controller: 'A', might: 7, tags: [] }],
  });
  f.chain.layers.addContinuous({
    id: 'RIFT-1171:friendly-mech-might', layer: 'arithmetic',
    source: f.kernel.ref('attacker-1'),
    filter: { type: 'unit', tags: ['Mech'], controller: 'self', zone: 'board' },
    effect: { kind: 'continuous.might', mode: 'add', layer: 'arithmetic', amount: 1 },
  }, { type: 'permanent' });
  f.chain.layers.addContinuous({
    id: 'RIFT-1171:enemy-mech-might', layer: 'arithmetic',
    source: f.kernel.ref('defender-1'),
    filter: { type: 'unit', tags: ['Mech'], controller: 'self', zone: 'board' },
    effect: { kind: 'continuous.might', mode: 'add', layer: 'arithmetic', amount: 2 },
  }, { type: 'permanent' });
  const plan = prepareDamage(f);
  assert.equal(plan.attacker.budget, 3, 'the Attacker receives only its controller aura');
  assert.equal(plan.defender.budget, 6, 'the Defender receives only its controller aura');
  assert.deepEqual(plan.attacker.targets.map(target => [target.uid, target.currentMight]),
    [['defender-1', 6]]);
  assert.deepEqual(plan.defender.targets.map(target => [target.uid, target.currentMight]),
    [['attacker-1', 3]]);
});
