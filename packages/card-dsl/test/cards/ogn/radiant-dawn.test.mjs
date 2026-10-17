import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/ogn/radiant-dawn.js";
// card-dsl has no dependency edge on engine-core (engine-core depends on
// card-dsl), so golden execution loads the built engine through its workspace
// layout instead of the package name.
const engineCore = new URL("../../../../engine-core/dist/", import.meta.url);
const { runAbilityBody } = await import(new URL("effects/interpreter.js", engineCore));
const { world } = await import(new URL("effects/testing/index.js", engineCore));
const { validateTriggerSpec } = await import(new URL("events/trigger-spec.js", engineCore));

const ability = program.abilities[0];
const buff = ability.body[0];
const targetSpec = buff.targets[0];

test("radiant-dawn program is valid EffectIR v2 data", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.issues, null, 2));
});

test("radiant-dawn identity: canonicalCardId, ruleset, judge-required status and verbatim text", () => {
  assert.equal(
    program.canonicalCardId,
    "card.hash-5d02f70104295cfce7c17c88cd891af0271f665b937919cca5601f8273c83284"
  );
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /412\.4/);
  assert.match(program.judgeReason, /412\.5/);
  assert.match(program.judgeReason, /one or more/);
  assert.match(program.judgeReason, /testTrigger/);
  // RIFT-257 is merged; the remaining authoring gap is the missing event-name
  // discriminant plus per-batch grouping, not the program binding.
  assert.match(program.judgeReason, /卡牌触发绑定已合入/);
  assert.match(program.judgeReason, /per-batch/);
  assert.equal(
    program.sourceText,
    "When you stun one or more enemy units, buff a friendly unit. (If it doesn't have a buff, it gets a +1 :rb_might: buff.)"
  );
});

test("radiant-dawn structure: mandatory unit-stunned trigger with enemy-unit payload filter", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "triggered");
  assert.equal(ability.trigger.at, "unit-stunned");
  // The merged event vocabulary has no "unit-stunned" EventPattern name, so the
  // filter is the bare ObjectFilter the matcher applies to the event payload
  // object; validateTriggerSpec accepts it.
  assert.deepEqual(ability.trigger.filter, {
    type: "unit",
    zone: "board",
    controller: "opponent"
  });
  const validated = validateTriggerSpec(ability.trigger);
  assert.equal(validated.ok, true, JSON.stringify(validated.ok ? [] : validated.issues));
  assert.equal(ability.optional, false);
  assert.equal(ability.trigger.once, undefined);
});

test("radiant-dawn structure: one mandatory friendly-unit buff target", () => {
  assert.equal(buff.id, "radiant-dawn.buff");
  assert.equal(buff.op, "effect.buff");
  assert.deepEqual(buff.args.mode, { kind: "constant", value: "buff" });
  assert.deepEqual(buff.args.target, { kind: "constant", value: "friendly-unit" });
  assert.equal(buff.args.amount, undefined);
  assert.equal(buff.linkedTo, undefined);
  assert.equal(buff.picks, undefined);
  assert.equal(targetSpec.id, "friendly-unit");
  assert.deepEqual(targetSpec.filter, { type: "unit", controller: "controller", zone: "board" });
  assert.equal(targetSpec.min, 1);
  assert.equal(targetSpec.max, 1);
  assert.equal(targetSpec.selection, "one");
});

test("radiant-dawn golden: the buff body places exactly one buff through the real kernel", () => {
  const body = ability.body.map(({ targets, ...rest }) => rest);
  const kernel = world().unit("ally", { buffs: 0 }).build();
  kernel.setTargets("friendly-unit", [kernel.ref("ally")]);
  const outcome = runAbilityBody(body, kernel);
  assert.equal(outcome.status, "executed");
  assert.equal(kernel.getObject("ally").buffs, 1);
  assert.equal(outcome.results.length, 1);
  assert.equal(outcome.results[0].result.status, "executed");
  assert.equal(outcome.results[0].result.linkedValues.buffedCount, 1);
  assert.deepEqual(outcome.results[0].result.linkedValues.buffed, [kernel.ref("ally")]);
  assert.deepEqual(outcome.events.map(event => event.action), ["buff"]);
});

test("radiant-dawn golden: an already-buffed unit is not buffed again (CR 702.3.a)", () => {
  const body = ability.body.map(({ targets, ...rest }) => rest);
  const kernel = world().unit("ally", { buffs: 1 }).build();
  kernel.setTargets("friendly-unit", [kernel.ref("ally")]);
  const outcome = runAbilityBody(body, kernel);
  assert.equal(kernel.getObject("ally").buffs, 1);
  assert.equal(outcome.results[0].result.status, "negated");
  assert.equal(outcome.results[0].result.reason, "skipped");
  assert.deepEqual(outcome.events, []);
});

test("radiant-dawn golden: a target that left the board makes the instruction ignored", () => {
  const body = ability.body.map(({ targets, ...rest }) => rest);
  const kernel = world().unit("ally", { buffs: 0 }).build();
  const stale = kernel.ref("ally");
  kernel.perform({ type: "kill", object: stale });
  kernel.setTargets("friendly-unit", [stale]);
  const outcome = runAbilityBody(body, kernel);
  assert.equal(outcome.results[0].result.status, "ignored");
  assert.equal(outcome.results[0].result.reason, "mistargeted");
  assert.equal(outcome.events.length, 0);
});

test.todo(
  "radiant-dawn \"When you stun\" responsibility (CR 412.4/412.5): filter the Stun action by " +
    "the player responsible for it; the stun GameAction carries no player (contract 3.6), so the " +
    "emitted event's player falls back to the stunned unit's controller (engine batch 4 trigger.state work)."
);

test.todo(
  "radiant-dawn \"one or more enemy units\": one trigger per Stun action/batch even when it " +
    "stuns several enemy units; needs batch grouping on the stun timing point plus a per-batch " +
    "lifetime (the CardProgram→TriggerRegistration binder itself is merged)."
);
