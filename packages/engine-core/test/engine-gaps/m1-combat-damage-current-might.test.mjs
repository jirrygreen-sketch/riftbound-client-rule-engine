// RIFT-976 production Combat damage consumes the already-layered current Might
// exactly once. Core Rules v1.5, official source effective 2026-10-16:
// https://cmsassets.rgpub.io/sanity/files/dsfx7636/news_live/5c7946f7c3b8c6e0faff85ab6dadc6d2e721ea94.pdf
// CR 467.2 uses current Might; 478.2/478.4 apply each continuous effect once;
// 807.1.c/.d.1 and 814.1.c/.d.1 gate Assault and Shield on their designations;
// 814.2 sums Shield instances.

import assert from 'node:assert/strict';
import test from 'node:test';

import sunlitGuardian from '../../../card-dsl/dist/cards/ogn/sunlit-guardian.js';
import laurentDuelist from '../../../card-dsl/dist/cards/sfd/laurent-duelist.js';
import { AwaitChoice } from '../../dist/effects/contract.js';
import { world } from '../../dist/effects/testing/index.js';
import { bindResolveContext, createActionPipelineHost } from '../../dist/events/action-adapter.js';
import { createProgramBinding } from '../../dist/programs/index.js';
import { createEngineStaticBinder } from '../../dist/programs/statics.js';
import { createCombatDamagePlan } from '../../dist/combat/transactions/damage.js';
import { TurnFlow } from '../../dist/turn/flow.js';

const battlefield = (id) => ({ type: 'battlefield', id });
const executable = program => ({ ...program, status: 'executable', judgeReason: undefined });

function bonusProgram(id, amount) {
  return {
    canonicalCardId: id,
    rulesetVersion: 'core-1.5',
    status: 'executable',
    abilities: [{
      kind: 'static',
      effect: {
        kind: 'continuous.might',
        amount: { kind: 'constant', value: amount },
        filter: { type: 'unit', zone: 'board', controller: 'self' },
      },
    }],
    sourceText: `This Unit has +${amount} Might.`,
  };
}

function dualKeywordProgram() {
  return {
    canonicalCardId: 'test:combat-current-might-dual-keywords',
    rulesetVersion: 'core-1.5',
    status: 'executable',
    abilities: [
      { kind: 'keyword', keyword: 'assault', value: 1 },
      { kind: 'keyword', keyword: 'shield', value: 1 },
    ],
    sourceText: '[Assault 1] (+1 Might while I am an attacker.)\n[Shield] (+1 Might while I am a defender.)',
  };
}

function assembly({ units, programs, fieldController = 'B' }) {
  const builder = world().player('A').player('B');
  // Player cards added after an object move from another player's zone must
  // remain isolated; seed every card before the first Board unit.
  for (const player of ['A', 'B']) {
    builder.deck([`${player}:deck:0`, `${player}:deck:1`], { owner: player });
    builder.rune([`${player}:rune:0`, `${player}:rune:1`], { owner: player });
  }
  for (const [id, unit] of Object.entries(units)) {
    builder.unit(id, {
      cardId: unit.cardId,
      controller: unit.controller,
      owner: unit.controller,
      types: ['unit'],
      tags: unit.tags ?? [],
      keywords: unit.keywords ?? [],
      might: unit.might,
      energy: null,
      power: null,
      buffs: unit.buffs ?? 0,
      stunned: unit.stunned ?? false,
      location: battlefield(unit.locationId ?? 'bf1'),
      ref: { id, zoneEntryId: 1 },
    });
  }
  const kernel = builder.build();
  const choose = request => {
    if (request.type === 'mode' || request.type === 'order') return request.options[0];
    if (request.type === 'select-objects' && request.min === request.max && request.options.length === request.min) {
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
    performBatchLeaf: (action, batchId) => kernel.performBatchLeafForCapability(action, batchId),
    choose,
    context: (source, controller, timingPoint) => bindResolveContext(kernel, {
      source, controller, timingPoint, choose,
    }),
    testTrigger: registration => kernel.test(registration.spec.condition),
  });
  const flow = new TurnFlow({ host, player: id => kernel.player(id), turnOrder: ['A', 'B'],
    battlefields: [{ id: 'bf1', controller: fieldController }, { id: 'bf2', controller: null }] });
  const binding = createProgramBinding({ cardPrograms: programs.map(executable) });
  const lifecycleErrors = [];
  binding.attachLifecycle(flow.chain, error => lifecycleErrors.push(error));
  const staticBinder = createEngineStaticBinder(flow.chain);
  // Explicitly bind only the Characteristic-producing statics needed by these
  // focused damage scenarios. The lifecycle generality is covered elsewhere.
  return { kernel, flow, binding, staticBinder, lifecycleErrors };
}

function startCombat({ attacker, defender, programs, extras = {} }) {
  const units = { attacker, defender, ...extras };
  const f = assembly({ units, programs, fieldController: defender.controller });
  for (const [id] of Object.entries(units)) {
    const source = f.kernel.getObject(id);
    assert.ok(source, `${id} exists in the production Combat fixture`);
    for (const ability of f.binding.inspect(source).abilities) {
      if (ability.kind === 'static') f.staticBinder.bindStatic(ability, source);
    }
  }
  const attackerSnapshot = f.kernel.getObject('attacker');
  assert.ok(attackerSnapshot);
  assert.equal(f.flow.combat.entered(attackerSnapshot).length, 1);
  assert.equal(f.flow.combat.cleanup(), true);
  f.flow.chain.advance();
  assert.equal(f.flow.combat.startCombat('bf1').attacker, attacker.controller);
  assert.deepEqual(f.lifecycleErrors, []);
  assert.equal(f.flow.combat.lifecycle?.attacker, attacker.controller);
  assert.equal(f.flow.combat.lifecycle?.defender, defender.controller);
  const attackerPlayer = f.flow.combat.lifecycle.attacker;
  const defenderPlayer = f.flow.combat.lifecycle.defender;
  f.flow.chain.pass(attackerPlayer);
  assert.equal(f.flow.chain.focus, defenderPlayer);
  f.flow.chain.pass(defenderPlayer);
  assert.equal(f.flow.chain.turnState, 'neutral-open');
  return f;
}

test('RIFT-976 damage plan consumes the current-Might snapshots produced by CombatFlow', () => {
  const byId = new Map([
    ['attacker', Object.freeze({ currentMight: 5, role: 'attacker' })],
    ['defender', Object.freeze({ currentMight: 4, role: 'defender' })],
  ]);
  const runtime = Object.freeze({
    stateVersion: 7,
    fieldId: 'bf1',
    attackerPlayerId: 'A',
    defenderPlayerId: 'B',
    players: Object.freeze(['A', 'B']),
    fields: Object.freeze([{ id: 'bf1', controller: 'B', contestedBy: 'A', staged: 'combat', active: true }]),
    units: Object.freeze([...byId].map(([id, fact]) => Object.freeze({
      object: Object.freeze({
        ref: Object.freeze({ id, zoneEntryId: 1 }), cardId: null, name: id,
        types: Object.freeze(['unit']), tags: Object.freeze([]), keywords: Object.freeze([]),
        owner: id === 'attacker' ? 'A' : 'B', controller: id === 'attacker' ? 'A' : 'B',
        zone: 'board', location: Object.freeze({ type: 'battlefield', id: 'bf1' }),
        combatRole: fact.role, might: fact.currentMight, energy: null, power: null,
        exhausted: false, damage: 0, stunned: false, buffs: 0, attachedTo: null,
        faceDown: false, isToken: false, counters: new Map(), empowered: 0,
      }),
      combatRole: fact.role,
    }))),
    layers: {
      registry: { list: () => [] },
      setObjects() { throw new Error('damage plan must not rebase layered snapshots'); },
    },
    pipeline: { checkpoint: () => ({ replacements: new Map() }) },
    host: { objects: () => [] },
    replacementCount: 0,
    zeroDamageSourceIds: Object.freeze([]),
    fullMightLethalTargetIds: Object.freeze([]),
  });

  const plan = createCombatDamagePlan(runtime);
  assert.equal(plan.attacker.budget, 5);
  assert.equal(plan.defender.budget, 4);
});
test('RIFT-976 Laurent attacker uses layered current Might 5 once instead of applying Assault twice', () => {
  const f = startCombat({
    attacker: { id: 'laurent', controller: 'A', cardId: laurentDuelist.canonicalCardId, might: 3 },
    defender: { id: 'defender', controller: 'B', cardId: 'plain:defender', might: 4 },
    programs: [laurentDuelist],
  });

  const plan = f.flow.combat.prepareDamage();
  const laurent = f.kernel.getObject('attacker');
  assert.equal(f.flow.combat.snapshot(laurent).combatRole, 'attacker');
  assert.equal(f.flow.chain.layers.snapshot(laurent.ref)?.might, 5);
  assert.equal(plan.attacker.budget, 5, 'CR 467.2.a reads current Might once');
  assert.equal(plan.defender.budget, 4);
});

test('RIFT-976 Laurent defender keeps printed Might 3 because Assault is attacker-only', () => {
  const f = startCombat({
    attacker: { id: 'attacker', controller: 'A', cardId: 'plain:attacker', might: 4 },
    defender: { id: 'laurent', controller: 'B', cardId: laurentDuelist.canonicalCardId, might: 3 },
    programs: [laurentDuelist],
  });

  const plan = f.flow.combat.prepareDamage();
  assert.equal(f.flow.combat.snapshot(f.kernel.getObject('defender')).combatRole, 'defender');
  assert.equal(plan.attacker.budget, 4);
  assert.equal(plan.defender.budget, 3, 'CR 807.1.c/.d.1 contributes no Assault while defending');
});

test('RIFT-976 Stunned Laurent lethal requirement is the same once-layered current Might', () => {
  const f = startCombat({
    attacker: {
      id: 'laurent', controller: 'A', cardId: laurentDuelist.canonicalCardId, might: 3, stunned: true,
    },
    defender: { id: 'defender', controller: 'B', cardId: 'plain:defender', might: 4 },
    programs: [laurentDuelist],
  });

  const plan = f.flow.combat.prepareDamage();
  assert.equal(plan.attacker.budget, 0, 'CR 424.1.b prevents a Stunned attacker from dealing damage');
  assert.equal(plan.defender.targets.find(target => target.uid === 'attacker')?.lethalDamage, 5,
    'CR 424.1.c assigns lethal against current Might 5, without a second Assault application');
});

test('RIFT-976 printed Shield adds one only while its controller-designated Unit defends', () => {
  const defending = startCombat({
    attacker: { id: 'attacker', controller: 'A', cardId: 'plain:attacker', might: 4 },
    defender: {
      id: 'guardian', controller: 'B', cardId: sunlitGuardian.canonicalCardId, might: 3,
    },
    programs: [sunlitGuardian],
  });
  const defendingPlan = defending.flow.combat.prepareDamage();
  assert.equal(defendingPlan.defender.budget, 4, 'CR 814.1.c adds Shield 1 while defending');

  const attacking = startCombat({
    attacker: {
      id: 'guardian', controller: 'A', cardId: sunlitGuardian.canonicalCardId, might: 3,
    },
    defender: { id: 'defender', controller: 'B', cardId: 'plain:defender', might: 4 },
    programs: [sunlitGuardian],
  });
  const attackingPlan = attacking.flow.combat.prepareDamage();
  assert.equal(attackingPlan.attacker.budget, 3, 'CR 814.1.c/.d.1 gives no Shield bonus while attacking');
});

test('RIFT-976 printed Assault and Shield apply independently in their own combat roles', () => {
  const program = dualKeywordProgram();
  const defending = startCombat({
    attacker: { id: 'attacker', controller: 'A', cardId: 'plain:attacker', might: 4 },
    defender: {
      id: 'duelist', controller: 'B', cardId: program.canonicalCardId, might: 3,
    },
    programs: [program],
  });
  assert.equal(defending.flow.combat.prepareDamage().defender.budget, 4,
    'Shield contributes in the Defender role while Assault stays inactive');

  const attacking = startCombat({
    attacker: {
      id: 'duelist', controller: 'A', cardId: program.canonicalCardId, might: 3,
    },
    defender: { id: 'defender', controller: 'B', cardId: 'plain:defender', might: 4 },
    programs: [program],
  });
  assert.equal(attacking.flow.combat.prepareDamage().attacker.budget, 4,
    'Assault contributes in the Attacker role while Shield stays inactive');
});

test('RIFT-976 Buff and a production static aura stack with Assault on layered current Might', () => {
  const aura = bonusProgram('test:laurent-static-aura', 2);
  const f = startCombat({
    attacker: {
      id: 'laurent', controller: 'A', cardId: laurentDuelist.canonicalCardId, might: 3, buffs: 1,
    },
    defender: { id: 'defender', controller: 'B', cardId: 'plain:defender', might: 4 },
    programs: [laurentDuelist, aura],
    extras: {
      aura: { id: 'aura', controller: 'A', cardId: aura.canonicalCardId, might: 1, locationId: 'bf2' },
    },
  });

  assert.equal(f.kernel.getObject('attacker').might, 3, 'the host retains printed Might');
  assert.equal(f.kernel.getObject('attacker').buffs, 1, 'the Buff counter remains authoritative state');
  assert.equal(f.flow.chain.layers.snapshot(f.kernel.ref('attacker'))?.might, 8,
    'printed 3 + Buff 1 + static aura 2 + Assault 2');
  assert.equal(f.flow.combat.prepareDamage().attacker.budget, 8,
    'combat consumes the settled current Might without replaying any arithmetic effect');
});
