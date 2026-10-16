// Golden tests for the Deploy keyword's opponent-Hold hook — CR v1.5 830.1.b.
//
// Scenario ids covered here (docs/rules/scenarios/scoring.yaml):
//   scoring-deploy-gear-destroyed-on-opponent-hold  todo (blocked)
//   scoring-deploy-gear-survives-own-hold           todo (blocked)
//   scoring-deploy-gear-survives-conquer            todo (blocked)
//
// The merged Deploy keyword (src/effects/keywords/Deploy.ts) already expands to the
// 830.1.b “When an opponent holds here, kill this.” triggered ability. Wiring it to real
// Gear on a real Battlefield needs three not-yet-merged pieces, recorded here as the
// blocking reasons rather than approximated:
//   1. the trigger filter `{ event: 'hold', here: true, player: 'opponent' }` is rejected by
//      the frozen TriggerSpec validator in src/events/trigger-spec.ts (`here` is not an
//      EventPattern field), so the expanded ability cannot be registered as-is;
//   2. the `continuous.location` consumer that lets Deploy Gear be played/created to any
//      Battlefield is not merged (the Deploy source itself records this dependency);
//   3. the Cleanup Recall exemption for non-Unit Deploy Gear (830.1.b.3 / 323.6) is not
//      implemented — src/turn/flow.ts throws the recall-action block for any unattached
//      non-Unit object at a Battlefield.
//
// The expansion itself is covered by test/effects/keywords/Deploy.test.mjs; nothing here
// re-implements the keyword or asserts that the feature is absent.
import test from 'node:test';
import assert from 'node:assert/strict';

import { deploy } from './harness.mjs';

test('scoring-deploy-gear-destroyed-on-opponent-hold (830.1.b): expansion shape is registered as the expected hold-triggered self-kill', () => {
  const abilities = deploy.expand({ host: { canonicalCardId: 'test-deploy-gear' } });
  assert.equal(abilities.length, 2);
  const [location, trigger] = abilities;
  assert.equal(location.kind, 'static');
  assert.equal(location.effect.kind, 'continuous.location');
  assert.equal(trigger.kind, 'triggered');
  assert.equal(trigger.optional, false);
  assert.equal(trigger.trigger.at, 'hold');
  assert.deepEqual(trigger.trigger.filter, { event: 'hold', here: true, player: 'opponent' });
  assert.deepEqual(trigger.body.map(instruction => instruction.op), ['effect.kill']);
});

test.todo('scoring-deploy-gear-destroyed-on-opponent-hold (830.1.b): opponent Hold kills the Deploy Gear — blocked: the Deploy trigger filter { event: "hold", here: true, player: "opponent" } is rejected by src/events/trigger-spec.ts (EventPattern has no `here` field), and the trigger registration / continuous.location gear-placement consumer is not merged');

test.todo('scoring-deploy-gear-survives-own-hold (830.1.b): the controller’s own Hold leaves their Deploy Gear alone — blocked: same unregistered hold-trigger as above; the negative case cannot run until the opponent-scoped trigger registers, so the merged kernel cannot distinguish “no trigger” from “trigger not wired”');

test.todo('scoring-deploy-gear-survives-conquer (830.1.b): a Conquer does not trigger the Deploy hold hook — blocked: same unregistered hold-trigger; additionally the Cleanup Recall exemption for non-Unit Deploy Gear at a Battlefield (830.1.b.3 / 323.6) is missing, so src/turn/flow.ts throws the recall-action block for that Gear before a Conquer can complete');
