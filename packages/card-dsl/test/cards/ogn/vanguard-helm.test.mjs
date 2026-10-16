import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/ogn/vanguard-helm.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const [ability] = program.abilities;
const [buffInstruction] = ability.body;

/** Instruction body without the TargetSpec; Finalize supplies the locked target. */
const bodyWithoutTargets = ability.body.map(({ targets, ...rest }) => rest);

function helmWorld(values = {}) {
  return world()
    .base("vanguard-helm", { types: ["gear"], energy: 2, power: null, might: null })
    .unit("other-ally", { might: 2, ...values })
    .build();
}

test("vanguard-helm: passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.issues));
  assert.deepEqual(result.issues, []);
});

test("vanguard-helm: identity, ruleset, status, judgeReason and printed text", () => {
  assert.equal(
    program.canonicalCardId,
    "card.hash-508405483bcf2bc67687c4f5d80ef7423b4e9e22a91044db31c0218d8f206753"
  );
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /buffed/);
  assert.match(program.judgeReason, /TriggerRegistration/);
  assert.match(program.judgeReason, /702\.2\.a/);
  assert.equal(
    program.sourceText,
    "When a buffed friendly unit dies, buff another friendly unit. " +
      "(If it doesn't have a buff, it gets a +1 :rb_might: buff.)"
  );
});

test("vanguard-helm: the death trigger subscribes to object-killed with the printed restrictions", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "triggered");
  assert.equal(ability.trigger.at, "object-killed");
  assert.equal(ability.optional, false);
  assert.equal(ability.trigger.once, undefined);

  // "a buffed friendly unit dies": the dying unit is the event object, must be
  // a unit controlled by this ability's controller (740.1.a) and must carry a
  // Buff counter (702.2.a). The buff predicate has no merged filter spelling;
  // the characteristics key below is a review marker only — the merged matcher
  // compares it with ===, which is not 702.2.a's "has a Buff counter".
  assert.deepEqual(ability.trigger.filter, {
    event: "object-killed",
    object: { type: "unit", characteristics: { buffs: 1 } },
    player: "self"
  });
});

test("vanguard-helm: the body is one effect.buff targeting exactly one other friendly unit", () => {
  assert.equal(ability.body.length, 1);
  assert.equal(buffInstruction.id, "vanguard-helm.buff-another-unit");
  assert.equal(buffInstruction.op, "effect.buff");
  assert.deepEqual(buffInstruction.args, {
    mode: { kind: "constant", value: "buff" },
    target: { kind: "constant", value: "vanguard-helm.other-friendly-unit" }
  });
  assert.equal(buffInstruction.picks, undefined);
  assert.equal(buffInstruction.linkedTo, undefined);
  assert.equal(buffInstruction.condition, undefined);

  assert.equal(buffInstruction.targets.length, 1);
  const [target] = buffInstruction.targets;
  assert.equal(target.id, "vanguard-helm.other-friendly-unit");
  // "another" excludes the source (740.1.a); "friendly" is the controller.
  assert.deepEqual(target.filter, { type: "unit", controller: "controller", zone: "board", other: true });
  assert.equal(target.min, 1);
  assert.equal(target.max, 1);
  assert.equal(target.selection, "one");
});

test("vanguard-helm golden: the Buff body places one Buff counter on the chosen friendly unit", () => {
  const kernel = helmWorld();
  kernel.setTargets("vanguard-helm.other-friendly-unit", [kernel.ref("other-ally")]);
  const outcome = runAbilityBody(bodyWithoutTargets, kernel);

  assert.equal(outcome.status, "executed");
  assert.equal(outcome.results.length, 1);
  const [result] = outcome.results;
  assert.equal(result.op, "effect.buff");
  assert.equal(result.result.status, "executed");
  // CR 702.2.a / 427.1.b: one Buff counter, +1 Might is derived by layers (703).
  assert.equal(kernel.getObject("other-ally").buffs, 1);
  assert.equal(result.result.linkedValues.buffedCount, 1);
  assert.deepEqual(result.result.linkedValues.buffed, [
    { id: "other-ally", zoneEntryId: kernel.ref("other-ally").zoneEntryId }
  ]);
});

test("vanguard-helm golden: a unit that already has a Buff is a legal choice that is not buffed again (CR 702.3.a / 427.1.c)", () => {
  const kernel = helmWorld({ buffs: 1 });
  kernel.setTargets("vanguard-helm.other-friendly-unit", [kernel.ref("other-ally")]);
  const outcome = runAbilityBody(bodyWithoutTargets, kernel);

  // effect.buff reports the no-op as negated/skipped: nothing was placed.
  assert.equal(outcome.results[0].result.status, "negated");
  assert.equal(outcome.results[0].result.reason, "skipped");
  assert.equal(kernel.getObject("other-ally").buffs, 1);
});

test("vanguard-helm golden: a target that left the board before resolution is ignored (CR 359.3.e.7)", () => {
  const kernel = helmWorld();
  const stale = kernel.ref("other-ally");
  kernel.perform({ type: "kill", object: stale });
  kernel.setTargets("vanguard-helm.other-friendly-unit", [stale]);
  const outcome = runAbilityBody(bodyWithoutTargets, kernel);

  assert.equal(outcome.results[0].result.status, "ignored");
  assert.equal(outcome.results[0].result.reason, "mistargeted");
});

test.todo(
  "vanguard-helm: collecting the trigger on object-killed with the dying unit's last-known " +
    "characteristics (383.2.c.3.b / 429.1.a.1.b) requires the card-program → TriggerRegistration " +
    "adapter that supplies activeZones and the event-object payload binding (RIFT-120 follow-up)"
);

test.todo(
  "vanguard-helm: a merged 'buffed' trigger predicate (702.2.a: a unit with a Buff counter) instead of " +
    "the descriptive characteristics key; depends on the same trigger-filter vocabulary extension as " +
    "ogn-269-298 The Boss and ogn-090-298 Spirits' Refuge"
);
