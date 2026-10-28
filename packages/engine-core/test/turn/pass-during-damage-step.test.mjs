import assert from 'node:assert/strict';
import test from 'node:test';

import { world } from '../../dist/effects/testing/index.js';
import { bindResolveContext, createActionPipelineHost } from '../../dist/events/action-adapter.js';
import { TurnCombatBlockedError, TurnFlow } from '../../dist/turn/flow.js';

const battlefield = id => ({ type: 'battlefield', id });

function fixture() {
  const builder = world().player('A').player('B')
    .unit('attacker', {
      owner: 'A', controller: 'A', might: 4, power: null, keywords: [],
      location: battlefield('bf1'),
    })
    .unit('defender', {
      owner: 'B', controller: 'B', might: 3, power: null, keywords: [],
      location: battlefield('bf2'),
    });
  for (const player of ['A', 'B']) {
    builder.deck([`${player}:deck:0`, `${player}:deck:1`], { owner: player });
    builder.rune([`${player}:rune:0`, `${player}:rune:1`], { owner: player });
  }
  const kernel = builder.build();
  const choose = request => {
    if (request.type === 'mode' && request.id.startsWith('engagement:')) return request.options[0];
    if (request.type === 'select-objects' && request.min === request.max &&
        request.options.length === request.min) return [...request.options];
    throw new Error(`Unexpected choice ${request.id}`);
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
  const flow = new TurnFlow({
    host, player: id => kernel.player(id), turnOrder: ['A', 'B'],
    battlefields: [{ id: 'bf1', controller: null }, { id: 'bf2', controller: null }],
  });
  flow.start();
  assert.equal(flow.chain.commit({
    type: 'move-location', object: kernel.ref('defender'), to: battlefield('bf1'),
  }).status, 'done');
  flow.advance();
  assert.equal(flow.combat.current?.step, 'showdown');
  assert.equal(flow.chain.focus, 'A');
  // CR 347.2/348: these are the real Showdown Focus passes and must retain
  // their existing legal behavior before the Damage Step begins.
  flow.pass('A');
  flow.pass('B');
  assert.equal(flow.chain.turnState, 'neutral-open');
  flow.combat.prepareDamage();
  assert.equal(flow.combat.current?.step, 'damage');
  return { flow, kernel };
}

function snapshot(flow, kernel) {
  return {
    state: kernel.snapshot(), links: kernel.linkedSnapshot(),
    combat: flow.combat.checkpoint(), items: flow.chain.items,
    trace: flow.chain.trace, priority: flow.chain.priority, focus: flow.chain.focus,
    turnState: flow.chain.turnState, events: flow.chain.pipeline.events,
  };
}

function assertDamagePassRejected(flow, kernel, player) {
  const before = snapshot(flow, kernel);
  assert.throws(() => flow.pass(player), error => {
    assert.ok(error instanceof TurnCombatBlockedError);
    assert.equal(error.code, 'pass-not-allowed-during-damage-assignment');
    assert.equal(error.status, 'blocked');
    assert.match(error.message, /467\.2\.c-d/);
    return true;
  });
  assert.deepEqual(snapshot(flow, kernel), before,
    `Pass from ${player} must not mutate or journal the damage-assignment state`);
}

test('RIFT-1105 rejects every Pass while Combat damage is being assigned', () => {
  // CR v1.5 (2026-10-09): 467.2.c assigns damage beginning with the Attacker;
  // 467.2.c.1/.a distinguish assignment, and 467.2.d deals all assigned damage.
  // 312.2 supplies Priority only through the enumerated windows. The mandatory
  // allocation therefore cannot be replaced by a generic Pass.
  const { flow, kernel } = fixture();

  assertDamagePassRejected(flow, kernel, 'A');
  assertDamagePassRejected(flow, kernel, 'B');

  const damage = flow.combat.damageView();
  flow.combat.submitAttackerDamage('A', [{
    uid: 'defender', amount: damage.attackerMight,
  }]);
  assert.equal(flow.combat.damageView().attackerSubmitted, true);

  assertDamagePassRejected(flow, kernel, 'A');
  assertDamagePassRejected(flow, kernel, 'B');
});
