// RIFT-951: CombatFlow's authoritative Unit designations feed the default
// static-condition and layer path without being written into host snapshots.
//
// CR v1.5 (published 2026-10-09, effective 2026-10-16):
// https://cmsassets.rgpub.io/sanity/files/dsfx7636/news_live/5c7946f7c3b8c6e0faff85ab6dadc6d2e721ea94.pdf
// 466.2.c.3 / 466.2.c.3.a designate Units; 468.7.a removes the designations;
// 807.1.c / 807.1.d.1 grant Assault 2 only while a Unit is an Attacker.
import assert from 'node:assert/strict';
import test from 'node:test';

import laurentDuelist from '../../../card-dsl/dist/cards/sfd/laurent-duelist.js';
import { AwaitChoice } from '../../dist/effects/contract.js';
import { world } from '../../dist/effects/testing/index.js';
import { bindResolveContext, createActionPipelineHost } from '../../dist/events/action-adapter.js';
import { ChainEngine } from '../../dist/chain/engine.js';
import { CombatFlow } from '../../dist/combat/flow.js';
import { createProgramBinding } from '../../dist/programs/index.js';
import { createEngineStaticBinder } from '../../dist/programs/statics.js';
import { TurnFlow } from '../../dist/turn/flow.js';

const field = id => ({ type: 'battlefield', id });
const executableLaurent = { ...laurentDuelist, status: 'executable', judgeReason: undefined };

function combatFixture({ laurentRole = 'none' } = {}) {
  const laurentController = laurentRole === 'defender' ? 'B' : 'A';
  const otherController = laurentController === 'A' ? 'B' : 'A';
  const builder = world().player('A').player('B')
    .unit('laurent', {
      owner: laurentController, controller: laurentController,
      cardId: executableLaurent.canonicalCardId,
      types: ['unit'], tags: ['Demacia'], keywords: [],
      might: 3, energy: 4, power: null,
      location: field('bf1'),
    })
    .unit('other', {
      owner: otherController, controller: otherController,
      types: ['unit'], tags: [], keywords: [],
      might: 4, energy: null, power: null,
      location: field('bf1'),
    });
  for (const player of ['A', 'B']) {
    builder.deck([`${player}:deck:0`, `${player}:deck:1`], { owner: player });
    builder.rune([`${player}:rune:0`, `${player}:rune:1`], { owner: player });
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
  const chain = new ChainEngine({
    turnOrder: ['A', 'B'], turnPlayer: 'A', phase: 'main', host,
    cleanup: () => false,
  });
  const combat = new CombatFlow(chain, host,
    [{ id: 'bf1', controller: 'B' }, { id: 'bf2', controller: null }],
    () => {}, { events: true, lifecycle: true });
  const binding = createProgramBinding({ cardPrograms: [executableLaurent] });
  const lifecycleErrors = [];
  binding.attachLifecycle(chain, error => lifecycleErrors.push(error));
  const laurent = kernel.getObject('laurent');
  const assault = binding.inspect(laurent).abilities.find(candidate => candidate.kind === 'static');
  assert.ok(assault, 'Laurent expands the production Assault KeywordDef into a static condition');
  createEngineStaticBinder(chain).bindStatic(assault, laurent);
  return { kernel, host, chain, combat, binding, lifecycleErrors };
}

function startCombat(f) {
  // The Contested status comes from the opponent entering the opponent-owned
  // Battlefield. This makes Laurent the Attacker or Defender in the same real
  // designation path used by CombatFlow's production tests.
  const laurent = f.kernel.getObject('laurent');
  const entrant = laurent.controller === 'A' ? laurent : f.kernel.getObject('other');
  assert.equal(f.combat.entered(entrant).length, 1);
  assert.equal(f.combat.cleanup(), true);
  f.chain.advance();
  const result = f.combat.startCombat('bf1');
  assert.equal(result.attacker, 'A');
  assert.equal(result.defender, 'B');
  assert.equal(f.combat.current?.step, 'showdown');
}

function closeShowdown(f) {
  assert.equal(f.chain.focus, 'A');
  f.chain.pass('A');
  assert.equal(f.chain.focus, 'B');
  f.chain.pass('B');
  assert.equal(f.chain.turnState, 'neutral-open');
}

function advanceUntil(f, predicate, budget = 40) {
  for (let step = 0; step < budget; step++) {
    if (predicate()) return;
    assert.equal(f.chain.items.length, 0, 'test driver expected an idle production chain');
    f.combat.advance();
  }
  assert.fail('Combat did not reach the requested production boundary');
}

function layerMight(f, objectId = 'laurent') {
  return f.chain.layers.snapshot(f.kernel.ref(objectId))?.might;
}

test('RIFT-951 default TurnFlow assembly projects Laurent\'s Attacker designation', () => {
  const builder = world().player('A').player('B')
    .unit('laurent', {
      owner: 'A', controller: 'A', cardId: executableLaurent.canonicalCardId,
      types: ['unit'], tags: ['Demacia'], keywords: [], might: 3,
      energy: 4, power: null, location: field('bf1'),
    })
    .unit('defender', {
      owner: 'B', controller: 'B', types: ['unit'], tags: [], keywords: [],
      might: 4, energy: null, power: null, location: field('bf2'),
    });
  for (const player of ['A', 'B']) {
    builder.deck([`${player}:deck:0`, `${player}:deck:1`], { owner: player });
    builder.rune([`${player}:rune:0`, `${player}:rune:1`], { owner: player });
  }
  const kernel = builder.build();
  const choose = request => request.type === 'mode' && request.id.startsWith('engagement:')
    ? request.options[0]
    : (() => { throw new AwaitChoice(request); })();
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
  const turn = new TurnFlow({
    host, player: id => kernel.player(id), turnOrder: ['A', 'B'],
    battlefields: [{ id: 'bf1', controller: 'B' }, { id: 'bf2', controller: null }],
  });
  const binding = createProgramBinding({ cardPrograms: [executableLaurent] });
  const errors = [];
  binding.attachLifecycle(turn.chain, error => errors.push(error));
  const laurent = kernel.getObject('laurent');
  const assault = binding.inspect(laurent).abilities.find(candidate => candidate.kind === 'static');
  assert.ok(assault);
  createEngineStaticBinder(turn.chain).bindStatic(assault, laurent);

  turn.start();
  assert.equal(turn.chain.layers.snapshot(kernel.ref('laurent'))?.might, 3);
  assert.equal(turn.chain.commit({ type: 'move-location', object: kernel.ref('defender'),
    to: field('bf1') }).status, 'done');
  turn.advance();
  assert.equal(turn.combat.snapshot(laurent).combatRole, 'attacker');
  assert.equal(turn.chain.layers.snapshot(kernel.ref('laurent'))?.might, 5);
  assert.equal(kernel.getObject('laurent').combatRole, null);
  assert.deepEqual(errors, []);
});

test('RIFT-951 production Assault 2 raises Laurent to Might 5 only as an Attacker', () => {
  const f = combatFixture({ laurentRole: 'attacker' });
  assert.equal(layerMight(f), 3, 'Laurent has printed Might 3 outside Combat');
  startCombat(f);

  assert.equal(f.combat.snapshot(f.kernel.getObject('laurent')).combatRole, 'attacker');
  assert.equal(layerMight(f), 5, 'the default static layer reads CombatFlow\'s Attacker designation');
  assert.equal(f.kernel.getObject('laurent').combatRole, null, 'the base host snapshot keeps no role');
  assert.equal(f.host.objects().find(object => object.ref.id === 'laurent').combatRole, null,
    'the chain projection never mutates the underlying host');
  assert.deepEqual(f.lifecycleErrors, []);
});

test('RIFT-951 Laurent receives no Assault bonus as a Defender', () => {
  const f = combatFixture({ laurentRole: 'defender' });
  startCombat(f);

  assert.equal(f.combat.snapshot(f.kernel.getObject('laurent')).combatRole, 'defender');
  assert.equal(f.combat.current?.attacker, 'A');
  assert.equal(f.combat.current?.defender, 'B');
  assert.equal(layerMight(f), 3, 'Assault keys only on the Attacker designation');
  assert.equal(f.kernel.getObject('laurent').combatRole, null);
});

test('RIFT-951 non-Combat Laurent keeps printed Might and no projected designation', () => {
  const f = combatFixture();

  assert.equal(f.combat.active, false);
  assert.equal(f.combat.snapshot(f.kernel.getObject('laurent')).combatRole, null);
  assert.equal(layerMight(f), 3);
  assert.equal(f.kernel.getObject('laurent').combatRole, null);
});

test('RIFT-951 real Combat end removes designation and restores Laurent to Might 3', () => {
  const f = combatFixture({ laurentRole: 'defender' });
  startCombat(f);
  assert.equal(layerMight(f), 3);
  closeShowdown(f);
  f.combat.prepareDamage();

  const view = f.combat.damageView();
  assert.equal(view.attackerMight, 4);
  assert.equal(view.defenderMight, 3);
  f.combat.submitAttackerDamage('A', [{ uid: 'laurent', amount: 4 }]);
  f.combat.submitDefenderDamage('B', [{ uid: 'other', amount: 3 }]);
  f.chain.advance();
  advanceUntil(f, () => f.combat.active === false);

  assert.equal(f.chain.pipeline.events.filter(event => event.timingPoint === 'combat-end').length, 1,
    'the role window closes through CombatFlow\'s real 468.7 event');
  assert.equal(f.kernel.getObject('laurent').zone, 'board', 'the Defender survives Special Cleanup');
  assert.equal(f.combat.snapshot(f.kernel.getObject('laurent')).combatRole, null);
  assert.equal(layerMight(f), 3, 'Assault no longer applies after 468.7.a');
  assert.equal(f.kernel.getObject('laurent').combatRole, null);
});
