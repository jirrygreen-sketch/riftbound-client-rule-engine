import assert from 'node:assert/strict';
import test from 'node:test';

import { AwaitChoice } from '../../dist/effects/contract.js';
import { world } from '../../dist/effects/testing/index.js';
import { bindResolveContext, createActionPipelineHost } from '../../dist/events/action-adapter.js';
import { ChainEngine } from '../../dist/chain/engine.js';
import { CombatFlow } from '../../dist/combat/flow.js';
import { createProgramBinding } from '../../dist/programs/index.js';
import ahriInquisitive from '../../../card-dsl/dist/cards/ogn/ahri-inquisitive.js';
import duneDrake from '../../../card-dsl/dist/cards/ogn/dune-drake.js';
import sunlitGuardian from '../../../card-dsl/dist/cards/ogn/sunlit-guardian.js';

const field = id => ({ type: 'battlefield', id });
const admitted = program => ({ ...program, status: 'executable', judgeReason: undefined });

function combatFixture({
  attacker = { id: 'attacker', might: 4, cardId: null, keywords: [] },
  defender = { id: 'defender', might: 3, cardId: null, keywords: [] },
  defenderLocation = 'bf1',
  programs = [],
  choose: suppliedChoose,
  cleanup = 'none',
} = {}) {
  const builder = world().player('A').player('B')
    .unit(attacker.id, {
      owner: 'A', controller: 'A', might: attacker.might,
      power: null,
      ...(attacker.cardId ? { cardId: attacker.cardId } : {}),
      keywords: attacker.keywords,
      stunned: attacker.stunned ?? false,
      location: field('bf1'),
    })
    .unit(defender.id, {
      owner: 'B', controller: 'B', might: defender.might,
      power: null,
      ...(defender.cardId ? { cardId: defender.cardId } : {}),
      keywords: defender.keywords,
      stunned: defender.stunned ?? false,
      location: field(defenderLocation),
    });
  for (const player of ['A', 'B']) {
    builder.deck([`${player}:deck:0`, `${player}:deck:1`], { owner: player });
    builder.rune([`${player}:rune:0`, `${player}:rune:1`], { owner: player });
  }
  const kernel = builder.build();
  const answers = new Map();
  const asked = [];
  const choose = request => {
    asked.push(request);
    if (answers.has(request.id)) return answers.get(request.id);
    if (suppliedChoose) {
      const answer = suppliedChoose(request);
      if (answer !== undefined) return answer;
    }
    if (request.type === 'select-objects' && request.min === request.max &&
        request.options.length === request.min) return [...request.options];
    throw new AwaitChoice(request);
  };
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: saved => {
      kernel.restore(saved.state);
      kernel.copyLinkedFrom(saved.links);
    },
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
  const lethalCleanup = engine => {
    let changed = false;
    engine.layers.setObjects(kernel.objects);
    for (const object of engine.layers.evaluateAll()) {
      if (object.zone !== 'board' || !object.types.includes('unit') || object.might === null ||
          object.damage === 0 || object.damage < Math.max(0, object.might)) continue;
      const before = kernel.ref(object.ref.id);
      const outcome = engine.commit({ type: 'kill', object: object.ref });
      if (outcome.status !== 'done') continue;
      const after = kernel.ref(object.ref.id);
      changed ||= before.zoneEntryId !== after.zoneEntryId;
    }
    return changed;
  };
  const chain = new ChainEngine({
    turnOrder: ['A', 'B'], turnPlayer: 'A', phase: 'main', host,
    cleanup: cleanup === 'lethal' ? lethalCleanup : () => false,
  });
  const flow = new CombatFlow(chain, host,
    [{ id: 'bf1', controller: 'B' }, { id: 'bf2', controller: null }],
    () => {}, { events: true, lifecycle: true });
  const binding = createProgramBinding({ cardPrograms: programs.map(admitted) });
  const started = () => {
    flow.entered(kernel.getObject(attacker.id));
    flow.cleanup();
    return flow.startCombat('bf1');
  };
  const closeShowdown = () => {
    assert.equal(chain.focus, 'A');
    chain.pass('A');
    assert.equal(chain.focus, 'B');
    chain.pass('B');
    assert.equal(chain.turnState, 'neutral-open');
  };
  return {
    kernel, chain, flow, binding, answers, asked, started, closeShowdown,
    events: timingPoint => chain.pipeline.events.filter(event => event.timingPoint === timingPoint),
  };
}

function settle(f, budget = 40) {
  let guard = 0;
  while (guard++ < budget) {
    if (f.chain.items.length) {
      assert.notEqual(f.chain.priority, null);
      f.chain.pass(f.chain.priority);
      continue;
    }
    if (f.chain.focus !== null) {
      f.chain.pass(f.chain.focus);
      continue;
    }
    return;
  }
  throw new Error('Combat chain did not settle');
}

test('EG-COMBAT opens a real Combat Showdown, preserves Focus, designates both sides, and fires both timing points', () => {
  const f = combatFixture();
  const result = f.started();

  assert.deepEqual(result, {
    field: 'bf1', combatId: 'combat:bf1:1', attacker: 'A', defender: 'B', focus: 'A',
  });
  assert.equal(f.chain.turnState, 'showdown-open');
  assert.equal(f.chain.focus, 'A');
  assert.equal(f.chain.priority, 'A');
  assert.deepEqual(f.flow.lifecycle, {
    phase: 'showdown', field: 'bf1', combatId: 'combat:bf1:1', attacker: 'A', defender: 'B',
  });
  assert.equal(f.flow.snapshot(f.kernel.getObject('attacker')).combatRole, 'attacker');
  assert.equal(f.flow.snapshot(f.kernel.getObject('defender')).combatRole, 'defender');
  assert.equal(f.events('combat-start').length, 1);
  assert.equal(f.events('showdown-open').length, 1);
  assert.deepEqual(f.events('attack-declared').map(event => event.object.ref.id), ['attacker']);
  assert.deepEqual(f.events('defense-declared').map(event => event.object.ref.id), ['defender']);
  for (const event of f.events('combat-start')) {
    assert.deepEqual(event.details, {
      combatId: 'combat:bf1:1', battlefieldId: 'bf1', attackerId: 'A', defenderId: 'B',
    });
  }
});

test('EG-COMBAT converts an open Non-Combat Showdown into Combat without changing its Focus holder', () => {
  const f = combatFixture({ defenderLocation: 'bf2', choose: request =>
    request.type === 'mode' && request.id.startsWith('engagement:') ? request.options[0] : undefined });
  const startingFocus = 'A';
  f.flow.entered(f.kernel.getObject('attacker'));
  f.flow.cleanup();
  assert.equal(f.flow.battlefields[0].staged, 'showdown');
  assert.equal(f.flow.battlefields[0].contestedBy, 'A');
  f.chain.advance();
  f.flow.advance();
  assert.equal(f.flow.current?.step, 'showdown');
  assert.equal(f.chain.focus, startingFocus);

  assert.equal(f.chain.commit({ type: 'move-location', object: f.kernel.ref('defender'),
    to: field('bf1') }).status, 'done');
  f.flow.cleanup();
  assert.equal(f.flow.battlefields[0].staged, 'showdown');
  f.flow.advance();
  assert.equal(f.flow.battlefields[0].staged, 'none');
  assert.equal(f.flow.lifecycle?.phase, 'showdown');
  assert.equal(f.flow.lifecycle?.attacker, 'A');
  assert.equal(f.flow.lifecycle?.defender, 'B');
  assert.equal(f.events('attack-declared').length, 1);
  assert.equal(f.events('defense-declared').length, 1);
  assert.equal(f.chain.focus, startingFocus);
});

test('EG-COMBAT failed Combat start restores Focus, priority, chain, trigger sequence and event log', () => {
  const f = combatFixture();
  f.flow.entered(f.kernel.getObject('attacker'));
  f.flow.cleanup();
  const before = {
    state: f.kernel.snapshot(), events: f.chain.pipeline.events,
    focus: f.chain.focus, priority: f.chain.priority, turnState: f.chain.turnState,
    items: f.chain.items, trace: f.chain.trace, fields: f.flow.battlefields,
  };
  f.chain.pipeline.onTrigger = () => { throw new Error('combat start trigger scan failed'); };
  f.chain.pipeline.registerTrigger({
    id: 'combat-start-failure', source: f.kernel.getObject('attacker'), controller: 'A',
    spec: { at: 'combat-start', filter: { event: 'combat-start' } }, body: [],
  });
  assert.throws(() => f.flow.startCombat('bf1'), /combat start trigger scan failed/);
  assert.deepEqual(f.kernel.snapshot(), before.state);
  assert.deepEqual(f.chain.pipeline.events, before.events);
  assert.equal(f.chain.focus, before.focus);
  assert.equal(f.chain.priority, before.priority);
  assert.equal(f.chain.turnState, before.turnState);
  assert.deepEqual(f.chain.items, before.items);
  assert.deepEqual(f.chain.trace, before.trace);
  assert.deepEqual(f.flow.battlefields, before.fields);
  assert.equal(f.flow.active, false);
});

test('EG-COMBAT rejects a third combatant before any role or timing is committed', () => {
  const f = combatFixture({ defenderLocation: 'bf2' });
  f.kernel.addPlayer('C');
  f.kernel.addObject({ ...f.kernel.getObject('defender'), ref: { id: 'third', zoneEntryId: 1 },
    owner: 'C', controller: 'C', cardId: 'third', name: 'third', location: field('bf1') }, 'board');
  assert.equal(f.chain.commit({ type: 'move-location', object: f.kernel.ref('defender'),
    to: field('bf1') }).status, 'done');
  f.flow.entered(f.kernel.getObject('attacker'));
  const before = { events: f.chain.pipeline.events, fields: f.flow.battlefields };
  assert.throws(() => f.flow.cleanup(), /multi-player Combat/);
  assert.deepEqual(f.chain.pipeline.events, before.events);
  assert.deepEqual(f.flow.battlefields, before.fields);
  assert.equal(f.flow.active, false);
  assert.equal(f.chain.focus, null);
});

test('EG-COMBAT an unsupported assignment modifier fails closed before either side deals damage', () => {
  const f = combatFixture();
  f.started();
  f.closeShowdown();
  f.chain.layers.addContinuous({
    id: 'unsupported-combat-modifier', layer: 'ability',
    filter: { objectId: 'defender' },
    effect: { kind: 'continuous.bonus-damage', amount: 1 },
  }, { type: 'end-of-combat' });
  const before = { state: f.kernel.snapshot(), events: f.chain.pipeline.events };
  assert.throws(() => f.flow.prepareDamage(), /unsupported modifier/);
  assert.deepEqual(f.kernel.snapshot(), before.state);
  assert.deepEqual(f.chain.pipeline.events, before.events);
  assert.equal(f.flow.current?.step, 'showdown');
});

test('EG-COMBAT zero-Might damage is not applied while the allocation still completes atomically', () => {
  const f = combatFixture({
    attacker: { id: 'attacker', might: 0, cardId: null, keywords: [] },
    defender: { id: 'defender', might: 0, cardId: null, keywords: [] },
  });
  f.started();
  f.closeShowdown();
  f.flow.prepareDamage();
  f.flow.submitAttackerDamage('A', []);
  const result = f.flow.submitDefenderDamage('B', []);
  assert.equal(f.kernel.getObject('attacker').damage, 0);
  assert.equal(f.kernel.getObject('defender').damage, 0);
  assert.equal(f.chain.pipeline.events.filter(event => event.timingPoint === 'damage-dealt').length, 0);
  assert.equal(f.events('combat-damage-before').length, 1);
  assert.equal(f.events('combat-damage-after').length, 1);
  assert.equal(result.batchId, 'combat:bf1:1:damage');
});

test('EG-COMBAT a Stunned attacker contributes no damage while the opposing side still deals normally', () => {
  const f = combatFixture({
    attacker: { id: 'attacker', might: 4, cardId: null, keywords: [], stunned: true },
    defender: { id: 'defender', might: 3, cardId: null, keywords: [] },
  });
  f.started();
  f.closeShowdown();
  const plan = f.flow.prepareDamage();
  assert.equal(plan.attacker.budget, 0);
  assert.equal(plan.defender.budget, 3);
  f.flow.submitAttackerDamage('A', []);
  f.flow.submitDefenderDamage('B', [{ uid: 'attacker', amount: 3 }]);
  assert.equal(f.kernel.getObject('defender').damage, 0);
  assert.equal(f.kernel.getObject('attacker').damage, 3);
});

test('EG-COMBAT default CardProgram assembly runs Dune Drake attack IR and changes the live layer Might', () => {
  const f = combatFixture({
    attacker: { id: 'dune', might: 5, cardId: duneDrake.canonicalCardId, keywords: [] },
    programs: [duneDrake],
  });
  assert.equal(duneDrake.status, 'judge-required');
  assert.deepEqual(
    f.binding.registerProgramTriggers(f.chain, f.kernel.getObject('dune')),
    ['program:dune:1:0'],
  );
  f.started();
  assert.deepEqual(f.chain.items.map(item => [item.id, item.kind, item.status]),
    [['trigger:1', 'triggered', 'finalized']]);
  assert.equal(f.chain.items[0].trigger.event.object.ref.id, 'dune');
  settle(f);
  f.chain.advance();
  f.chain.layers.setObjects(f.kernel.objects.map(object => f.flow.snapshot(object)));
  assert.equal(f.chain.layers.evaluate(f.kernel.ref('dune')).might, 7);
  assert.equal(f.kernel.getObject('dune').might, 5, 'printed Might remains unchanged');
  assert.equal(f.kernel.getObject('dune').power, null, 'null printed power is preserved');
});

test('EG-COMBAT original Ahri IR registers both attack and defense subscriptions without admitting the card', () => {
  const f = combatFixture({
    attacker: { id: 'ahri', might: 3, cardId: ahriInquisitive.canonicalCardId, keywords: [] },
    defender: { id: 'enemy', might: 2, cardId: null, keywords: [] },
    programs: [ahriInquisitive],
  });
  assert.equal(ahriInquisitive.status, 'judge-required');
  const ids = f.binding.registerProgramTriggers(f.chain, f.kernel.getObject('ahri'));
  assert.deepEqual(ids, ['program:ahri:1:0', 'program:ahri:1:1']);
  const checkpoint = f.chain.pipeline.checkpoint();
  assert.throws(() => f.started(), AwaitChoice);
  assert.equal(f.events('attack-declared').length, 1);
  assert.equal(f.chain.items.length, 1);
  assert.equal(f.flow.lifecycle?.phase, 'showdown');
  f.chain.pipeline.restore(checkpoint);
});

test('EG-COMBAT original Sunlit Guardian Tank IR enforces assignment order through the live combat transaction', () => {
  const f = combatFixture({
    attacker: { id: 'attacker', might: 4, cardId: null, keywords: [] },
    defender: { id: 'tank', might: 3, cardId: sunlitGuardian.canonicalCardId,
      keywords: [{ id: 'Tank' }] },
    programs: [sunlitGuardian],
  });
  assert.equal(sunlitGuardian.status, 'judge-required');
  const source = f.kernel.getObject('tank');
  const lifecycle = f.binding.attachLifecycle(f.chain);
  f.chain.pipeline.emit({ timingPoint: 'object-enters-board', object: source, player: 'B' });
  f.started();
  f.closeShowdown();
  const plan = f.flow.prepareDamage();
  assert.deepEqual(plan.attacker.targets.map(target => [target.uid, target.assignmentPriority]),
    [['tank', 'first']]);
  assert.throws(() => f.flow.submitAttackerDamage('A', []), /assigned total/);
  assert.equal(f.flow.damageView().attackerSubmitted, false);
  lifecycle.detach();
});

test('EG-COMBAT legal choices commit both sides in one damage batch; an illegal Defender choice rolls back the Attacker choice state', () => {
  const f = combatFixture();
  f.started();
  f.closeShowdown();
  f.flow.prepareDamage();
  f.flow.submitAttackerDamage('A', [{ uid: 'defender', amount: 4 }]);
  assert.equal(f.flow.damageView().attackerSubmitted, true);
  const beforeState = f.kernel.snapshot();
  const beforeEvents = f.chain.pipeline.events;
  assert.throws(() => f.flow.submitDefenderDamage('B', []), /assigned total/);
  assert.deepEqual(f.kernel.snapshot(), beforeState);
  assert.deepEqual(f.chain.pipeline.events, beforeEvents);
  assert.equal(f.flow.damageView().attackerSubmitted, true);

  const result = f.flow.submitDefenderDamage('B', [{ uid: 'attacker', amount: 3 }]);
  assert.equal(result.batchId, 'combat:bf1:1:damage');
  assert.equal(f.kernel.getObject('attacker').damage, 3);
  assert.equal(f.kernel.getObject('defender').damage, 4);
  const damageEvents = f.chain.pipeline.events.filter(event => event.timingPoint === 'damage-dealt');
  assert.equal(damageEvents.length, 2);
  assert.ok(damageEvents.every(event => event.batchId === result.batchId));
  assert.deepEqual(damageEvents.map(event => [event.target.ref.id, event.amount]),
    [['defender', 4], ['attacker', 3]]);
  assert.equal(f.events('combat-damage-before').length, 1);
  assert.equal(f.events('combat-damage-after').length, 1);
});

test('EG-COMBAT deferred trigger failure restores both Units and the event/layer ledgers before damage is published', () => {
  const f = combatFixture({ choose: request => {
    if (request.id === 'trigger:9:A:order:0') throw new Error('deferred damage scan failed');
    return undefined;
  } });
  f.started();
  f.closeShowdown();
  f.flow.prepareDamage();
  f.flow.submitAttackerDamage('A', [{ uid: 'defender', amount: 4 }]);
  const beforeSnapshot = f.kernel.snapshot();
  const beforeDamageEvents = f.chain.pipeline.events.length;
  f.chain.pipeline.registerTrigger({
    id: 'damage-observer', source: f.kernel.getObject('attacker'), controller: 'A',
    spec: { at: 'damage-dealt', filter: { event: 'damage-dealt' } }, body: [],
  });
  assert.throws(() => f.flow.submitDefenderDamage('B', [{ uid: 'attacker', amount: 3 }]),
    /deferred damage scan failed/);
  assert.equal(f.kernel.getObject('attacker').damage, 0);
  assert.equal(f.kernel.getObject('defender').damage, 0);
  assert.deepEqual(f.kernel.snapshot(), beforeSnapshot);
  assert.equal(f.chain.pipeline.events.length, beforeDamageEvents);
  assert.equal(f.flow.damageView().attackerSubmitted, true);
});

test('EG-COMBAT lethal damage is cleaned, result is scored once, roles clear, and conquer reaches Score', () => {
  const f = combatFixture({ cleanup: 'lethal' });
  f.started();
  f.closeShowdown();
  f.flow.prepareDamage();
  f.flow.submitAttackerDamage('A', [{ uid: 'defender', amount: 4 }]);
  f.flow.submitDefenderDamage('B', [{ uid: 'attacker', amount: 3 }]);

  f.chain.advance();
  f.chain.advance();
  f.flow.advance();
  f.chain.advance();
  f.flow.advance();
  f.flow.advance();
  assert.equal(f.kernel.getObject('defender').zone, 'trash');
  assert.equal(f.kernel.getObject('attacker').damage, 0);
  assert.equal(f.flow.lifecycle?.phase, 'control');
  assert.equal(f.events('control-established').length, 0);
  assert.equal(f.kernel.getObject('attacker').combatRole, null);
  assert.equal(f.events('combat-result').length, 1);
  assert.equal(f.events('combat-end').length, 1);
  assert.equal(f.events('combat-result')[0].details.noResult, false);
  assert.equal(f.events('combat-result')[0].details.winnerId, 'A');
  assert.equal(f.flow.battlefields[0].staged, 'none');
  assert.equal(f.flow.current?.step, 'control');
});

test('EG-COMBAT no-result when both sides are removed produces neither Conquer nor Score', () => {
  const f = combatFixture({
    attacker: { id: 'attacker', might: 3, cardId: null, keywords: [] },
    defender: { id: 'defender', might: 3, cardId: null, keywords: [] },
    cleanup: 'lethal',
  });
  f.started();
  f.closeShowdown();
  f.flow.prepareDamage();
  f.flow.submitAttackerDamage('A', [{ uid: 'defender', amount: 3 }]);
  f.flow.submitDefenderDamage('B', [{ uid: 'attacker', amount: 3 }]);
  f.chain.advance();
  f.flow.advance();
  f.flow.advance();
  f.flow.advance();
  assert.equal(f.kernel.getObject('attacker').zone, 'trash');
  assert.equal(f.kernel.getObject('defender').zone, 'trash');
  assert.equal(f.events('combat-result')[0].details.noResult, true);
  assert.equal(f.events('conquer').length, 0);
  assert.equal(f.events('score').length, 0);
  assert.equal(f.kernel.player('A').score, 0);
  assert.equal(f.flow.active, false);
});
