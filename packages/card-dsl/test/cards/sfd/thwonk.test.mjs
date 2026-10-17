import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/thwonk.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import stun from "../../../../engine-core/dist/effects/instructions/effect.stun.js";
import { instructionDefinitionsById } from "../../../../engine-core/dist/effects/instructions/registry.generated.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL_ID = "card.hash-e524222421455ebe13a4bfa061de0e5c349605918aaa2b3745828fe2443798e1";
const SOURCE_TEXT =
  "[Action] (Play on your turn or in showdowns.)\n" +
  "[Repeat] :rb_energy_2: (You may pay the additional cost to repeat this spell's effect.)\n" +
  "Stun an attacking unit. (It doesn't deal combat damage this turn.)";

const [action, play] = program.abilities;
const [stunInstruction] = play.body;
const targetSpec = stunInstruction.targets[0];
// The authored TargetSpec pins the Attacker restriction with the contract 3.8
// The golden body locks the finalized target while the structural assertion
// below verifies the merged combatRole filter vocabulary.
const executableBody = play.body.map(({ targets, ...rest }) => rest);

test("sfd-040-221 Thwonk!: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("sfd-040-221 Thwonk!: identity, ruleset, status and verbatim text", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL_ID), program);
});

test("sfd-040-221 Thwonk!: judgeReason names the remaining Repeat wiring", () => {
  assert.match(program.judgeReason, /combatRole/);
  assert.match(program.judgeReason, /740\.2\.c/);
  assert.match(program.judgeReason, /Repeat/);
  assert.match(program.judgeReason, /programs\/play\.ts/);
});

test("sfd-040-221 Thwonk!: [Action] keyword plus the printed [Repeat] additional cost", () => {
  assert.equal(program.abilities.length, 2);
  // 806: permissive speed keyword (the registry owns the Showdown expansion).
  assert.deepEqual(action, { kind: "keyword", keyword: "action" });
  assert.equal(action.value, undefined);

  assert.equal(play.kind, "play");
  // 820.1.a/820.1.c.1: the printed [Repeat] cost is 2 Energy, paid optionally.
  assert.equal(play.cost.kind, "additional");
  assert.equal(play.cost.keyword, "repeat");
  assert.equal(play.cost.optional, true);
  const [payment] = play.cost.payments;
  assert.equal(payment.kind, "energy");
  assert.deepEqual(payment.amount, { kind: "constant", value: 2 });
  assert.equal(payment.choice.id, "thwonk.repeat-payment");
  assert.deepEqual(payment.choice.options, ["pay", "decline"]);
});

test("sfd-040-221 Thwonk!: one targeted effect.stun restricted to an attacking unit", () => {
  assert.equal(play.body.length, 1);
  assert.equal(stunInstruction.id, "thwonk.stun-attacking-unit");
  assert.equal(stunInstruction.op, "effect.stun");
  assert.equal(stunInstruction.linkedTo, undefined);
  assert.equal(stunInstruction.condition, undefined);
  assert.deepEqual(stunInstruction.args, {
    target: { kind: "constant", value: "thwonk.attacking-unit" }
  });

  // 355.5 names "Stun a unit at a battlefield" as a Choice; the printed
  // The Attacker designation is carried by the contract's combatRole
  // characteristic and is consumed by the merged object matcher.
  assert.deepEqual(targetSpec, {
    id: "thwonk.attacking-unit",
    filter: { type: "unit", zone: "board", characteristics: { combatRole: "attacker" } },
    min: 1,
    max: 1,
    selection: "one"
  });
  // The declared primitive is the merged registry entry (RIFT-119).
  assert.equal(instructionDefinitionsById.get("effect.stun"), stun);
});

test("sfd-040-221 Thwonk! golden: the attacking unit becomes Stunned (424.1)", () => {
  const kernel = world().unit("attacker", { owner: "B", exhausted: true, might: 4 }).build();
  kernel.setTargets("thwonk.attacking-unit", [kernel.ref("attacker")]);

  const outcome = runAbilityBody(executableBody, kernel);

  assert.equal(outcome.status, "executed");
  assert.deepEqual(
    outcome.results.map((entry) => [entry.id, entry.result.status]),
    [["thwonk.stun-attacking-unit", "executed"]]
  );
  assert.equal(kernel.getObject("attacker").stunned, true);
  // 424.1.a.1 / 124.2: Stun is not Exhaust, so the status stays independent.
  assert.equal(kernel.getObject("attacker").exhausted, true);
  assert.deepEqual(outcome.events.map((event) => event.action), ["stun"]);
});

test("sfd-040-221 Thwonk! golden: an already-Stunned unit is chosen legally but nothing extra happens (424.1.a.1)", () => {
  const kernel = world().unit("attacker", { owner: "B", stunned: true }).build();
  kernel.setTargets("thwonk.attacking-unit", [kernel.ref("attacker")]);

  const outcome = runAbilityBody(executableBody, kernel);

  assert.equal(outcome.status, "executed");
  assert.equal(outcome.results[0].result.status, "executed");
  assert.equal(outcome.results[0].result.linkedValues.stunned.count, 0);
  assert.equal(outcome.results[0].result.linkedValues.stunned.alreadyStunned, 1);
  assert.equal(kernel.events.filter((event) => event.action === "stun").length, 0);
});

test("sfd-040-221 Thwonk! golden: a unit that left the board is mistargeted (359.3.e.6)", () => {
  const kernel = world().unit("attacker", { owner: "B" }).build();
  const stale = kernel.ref("attacker");
  assert.equal(kernel.perform({ type: "return-to-hand", object: stale }).status, "done");
  kernel.setTargets("thwonk.attacking-unit", [stale]);

  const outcome = runAbilityBody(executableBody, kernel);

  assert.equal(outcome.status, "partial");
  assert.deepEqual(outcome.results[0].result, { status: "ignored", reason: "mistargeted" });
});

test.todo(
  "sfd-040-221 Thwonk!: [Repeat] :rb_energy_2: must be collected at Finalize and the paid instance count fed to the " +
    "interpreter's repeat node (CR 820.1.c.1 / 820.1.d.1; programs/play.ts currently rejects the additional " +
    "play cost and no resolver supplies the paid count)."
);

test.todo(
  "sfd-040-221 Thwonk!: the Stunned consequences and expiry — no combat damage (424.1.b) and removal in the " +
    "end-of-turn cleanup step 3d (424.1.a.2) — belong to combat / turn, not to this card."
);
