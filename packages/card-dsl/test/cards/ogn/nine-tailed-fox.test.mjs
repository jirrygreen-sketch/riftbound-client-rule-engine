import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ogn/nine-tailed-fox.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL_ID =
  "card.hash-1e014c6eec053a33481b4f7adeabd0de2ec5684e450291208a419881b3d6aa9c";
const SOURCE_TEXT =
  "When an enemy unit attacks a battlefield you control, give it -1 :rb_might: this turn, " +
  "to a minimum of 1 :rb_might:.";

const [ability] = program.abilities;
const [debuff] = ability.body;

test("ogn-255-298 Nine-Tailed Fox: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("ogn-255-298 Nine-Tailed Fox: identity, status, and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /continuous\.might/);
  assert.match(program.judgeReason, /minimum of 1/);
  assert.match(program.judgeReason, /RIFT-83\/84/);
});

test("ogn-255-298 Nine-Tailed Fox: attack-declared trigger for an enemy unit", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "triggered");
  // 383.4.e / 323.2: the closed "attack-declared" timing point.
  assert.equal(ability.trigger.at, "attack-declared");
  assert.deepEqual(ability.trigger.filter, {
    event: "attack-declared",
    object: { type: "unit", controller: "opponent" }
  });
  // “When an enemy unit attacks …”: mandatory, not “you may”.
  assert.equal(ability.optional, false);
  // “a battlefield you control” needs battlefield control state, which the
  // merged attack-declared payload does not carry (see judgeReason).
  assert.equal(ability.trigger.condition, undefined);
});

test("ogn-255-298 Nine-Tailed Fox: -1 Might this turn with the printed minimum of 1", () => {
  assert.equal(ability.body.length, 1);
  assert.equal(debuff.id, "nine-tailed-fox.debuff-attacker");
  // The debuff is a temporary Might modification: continuous.might belongs to
  // the layers system (RIFT-83/84) and is not a merged instruction opcode; the
  // golden documents the intended shape and its failure evidence.
  assert.equal(debuff.op, "continuous.might");
  assert.deepEqual(debuff.args.amount, { kind: "constant", value: -1 });
  assert.deepEqual(debuff.args.duration, { kind: "constant", value: "this-turn" });
  assert.deepEqual(debuff.args.minimum, { kind: "constant", value: 1 });
  assert.equal(debuff.linkedTo, undefined);

  // “it” = the attacking unit from the trigger event; the merged
  // ObjectSelector set has no event-object selector, so the TargetSpec is a
  // shape-only anchor (383.2.c.3.b / 359.3.f.3).
  assert.equal(debuff.targets.length, 1);
  assert.deepEqual(debuff.targets[0], {
    id: "attacking-unit",
    filter: { type: "unit", controller: "opponent" },
    min: 1,
    max: 1,
    selection: "one"
  });
});

test("ogn-255-298 Nine-Tailed Fox: the debuff cannot execute — no opcode, no Might change", async () => {
  // Two independent pieces of locked negative evidence:
  // 1. continuous.might is not a registered instruction opcode, so no merged
  //    primitive can apply the -1 Might (or the minimum-of-1 clamp).
  // 2. Driving the program's own body through the merged interpreter must not
  //    change the attacker's Might: the target anchor is re-checked against the
  //    kernel's filter spelling, and the instruction is ignored rather than
  //    applying anything hand-rolled.
  const { instructionDefinitionsById } = await import(
    "../../../../engine-core/dist/effects/instructions/registry.generated.js"
  );
  assert.equal(instructionDefinitionsById.has("continuous.might"), false);
  assert.equal(instructionDefinitionsById.has("continuous.might-modify"), false);

  const kernel = world()
    .unit("attacker", { owner: "B", controller: "B", zone: "board", might: 4 })
    .build();
  const ctx = kernel.clone({ sourceSnapshot: kernel.object(kernel.ref("attacker")) });
  const outcome = runAbilityBody(ability.body, ctx);
  assert.deepEqual(outcome.results.map(result => [result.id, result.result]), [
    ["nine-tailed-fox.debuff-attacker", { status: "ignored", reason: "mistargeted" }]
  ]);
  assert.equal(kernel.getObject("attacker").might, 4);
  assert.equal(kernel.getObject("attacker").damage, 0);
  assert.equal(kernel.getObject("attacker").buffs, 0);
});

test.todo(
  "ogn-255-298: apply -1 Might this turn with the minimum-of-1 clamp (CR 478.1.c example) and " +
    "end-of-turn expiry through the layers continuous.might system (RIFT-83/84, expiry RIFT-91)"
);

test.todo(
  "ogn-255-298: restrict the trigger to a battlefield the controller controls and bind “it” to the " +
    "attacking unit from the event (383.2.c.3.b / 359.3.f.3) — trigger payload and event-object binding (RIFT-87/90)"
);
