// Scenario: combat-focus-does-not-pass-after-trigger-opened-chain
// CR v1.5 346, 346.1, 347.1, 347.2.b, 466.2.d.1.
//
// Executed slice: a chain a triggered ability opened during a Showdown does not
// hand Focus on when it closes (346.1). The trigger enters the chain as a real
// Pending item through the shared event pipeline, HOT FEPR finalizes and resolves
// it, and the Focus holder keeps Focus afterwards.
//
// The scenario's own trigger is "When I attack, draw 1." (383.4.e). Attack triggers
// need the Attacker designation, which the merged kernel cannot assign yet, so that
// version stays a todo below; nothing here approximates it.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  drainChain, drawInstruction, flowFixture, moveInstruction, timingsAfter, traceSteps,
} from './harness.mjs';

test('combat-focus-does-not-pass-after-trigger-opened-chain (346.1): a trigger-opened chain closing during a Showdown keeps the Focus holder', () => {
  const f = flowFixture({
    fields: [{ id: 'bf1', controller: 'B' }, { id: 'bf2', controller: null }],
    setup: w => w.base('u1', { might: 2 }),
  });
  // A real rules trigger on the frozen showdown-open timing point (345 / 466.2.b).
  f.trigger('watch-showdown', 'showdown-open', [drawInstruction('trigger-draw', 1)]);
  f.flow.start();
  const mark = f.flow.chain.pipeline.events.length;

  // A moves u1 into B's Battlefield: Contested is applied on entry, Cleanup stages
  // a Non-Combat Showdown and opens it for the Contested player (345, 348.2).
  f.flow.execute(f.activated('enter', [moveInstruction('m', 'u1', { type: 'battlefield', id: 'bf1' })]));
  f.flow.pass(f.flow.chain.priority);   // A passes Priority
  f.flow.pass(f.flow.chain.priority);   // B passes: the Move resolves, Cleanup opens

  const opened = timingsAfter(f, mark);
  assert.ok(opened.includes('showdown-open'), 'Cleanup opens the Non-Combat Showdown (345)');
  assert.ok(opened.indexOf('contested-applied') < opened.indexOf('showdown-open'),
    '452 / 323.11: Contested is applied by the actual entry before Cleanup opens the Showdown');
  assert.equal(f.flow.chain.turnState, 'showdown-closed', 'the trigger-opened chain holds the closed state');
  assert.equal(f.flow.chain.focus, 'A', 'the Contested player gains Focus when the Showdown opens (345)');
  assert.deepEqual(f.flow.chain.items.map(item => [item.id, item.status, item.kind]),
    [['trigger:1', 'pending', 'triggered']], 'the trigger becomes a Pending chain item (354.2)');
  const handBefore = f.kernel.player('A').handSize;

  drainChain(f);

  // 346.1: the chain opened because a triggered ability was added, so Focus does
  // not pass; 347.1 still lets the same player act and the Showdown stays open.
  assert.equal(f.flow.chain.focus, 'A');
  assert.equal(f.flow.chain.priority, 'A');
  assert.equal(f.flow.chain.turnState, 'showdown-open');
  assert.equal(f.kernel.player('A').handSize, handBefore + 1, 'the trigger resolved its real effect');
  assert.equal(f.flow.chain.items.length, 0);
  assert.equal(traceSteps(f, 'chain-closed').length, 2, 'both chains closed through the real HOT FEPR path');
});

test.todo(
  'combat-focus-does-not-pass-after-trigger-opened-chain (383.4.e / 466.2.d.1): the scenario\'s own '
  + 'ATTACK trigger ("When I attack, draw 1.") needs the atomic Combat start task — the merged '
  + 'src/combat/flow.ts must open the Combat, emit combat-start and combat.attack-declared '
  + '(± defense-declared) and assign the Attacker/Defender designation (CR 466.2.c) before attack '
  + 'triggers can become Pending (466.2.d.1). Today it throws '
  + 'TurnCombatBlockedError("combat-start-transaction"), so 346.1 is only reachable through a rules '
  + 'trigger on an already-open Showdown',
);
