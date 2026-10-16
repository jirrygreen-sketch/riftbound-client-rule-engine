import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/rad/one-two-punch.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { instructionDefinitionsById } from "../../../../engine-core/dist/effects/instructions/registry.generated.js";
import buff from "../../../../engine-core/dist/effects/instructions/effect.buff.js";
import stun from "../../../../engine-core/dist/effects/instructions/effect.stun.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL = "card.hash-15c799fb843cf43317c0acc853801b4a8356da97f5897cf1a654cc4ac6954dd6";
const SOURCE_TEXT =
  "[Action] (Play on your turn or in showdowns.)\n" +
  "[Buff] a friendly unit and [Stun] an enemy unit. (Give the friendly unit a +1 :rb_might: buff " +
  "if it doesn't have one. The enemy unit doesn't deal combat damage this turn.)";

const [keyword, play] = program.abilities;
const [buffInstruction, stunInstruction] = play.body;
// The reference kernel's filter vocabulary compares controller placeholders
// verbatim ("controller" / "opponent" are contract-layer anchors the Finalize
// target system resolves). Golden execution therefore locks the targets through
// the kernel and runs the instruction bodies without their TargetSpecs, the
// pit-rookie / facebreaker convention; the card's own TargetSpecs are asserted
// separately above.
const executableBody = play.body.map(({ targets, ...rest }) => rest);

test("One-Two Punch program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("One-Two Punch identity, ruleset, status and printed text", () => {
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "executable");
  assert.equal(program.judgeReason, undefined);
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(program.canonicalCardId), program);
});

test("One-Two Punch structure: [Action], printed cost, buff then stun as independent sentences", () => {
  assert.deepEqual(keyword, { kind: "keyword", keyword: "action" });
  assert.equal(keyword.value, undefined);
  assert.equal(play.kind, "play");
  // Catalog printing: 3 energy, no printed power, no domains.
  assert.deepEqual(play.cost, {
    kind: "cost.printed",
    energy: { kind: "constant", value: 3 }
  });
  assert.deepEqual(
    play.body.map((instruction) => [instruction.id, instruction.op]),
    [
      ["one-two-punch.buff-friendly-unit", "effect.buff"],
      ["one-two-punch.stun-enemy-unit", "effect.stun"]
    ]
  );

  // "[Buff] a friendly unit": one friendly target with the merged mode "buff"
  // (427.1.b / 427.3 / 702.2.a).
  assert.deepEqual(buffInstruction.args.mode, { kind: "constant", value: "buff" });
  assert.deepEqual(buffInstruction.args.target, {
    kind: "constant",
    value: "one-two-punch.friendly-unit"
  });
  assert.deepEqual(buffInstruction.targets, [
    {
      id: "one-two-punch.friendly-unit",
      filter: { type: "unit", controller: "controller" },
      min: 1,
      max: 1,
      selection: "one"
    }
  ]);

  // "[Stun] an enemy unit": one enemy target with the merged effect.stun
  // (424.1 / 424.1.a.1).
  assert.deepEqual(stunInstruction.args.target, {
    kind: "constant",
    value: "one-two-punch.enemy-unit"
  });
  assert.deepEqual(stunInstruction.targets, [
    {
      id: "one-two-punch.enemy-unit",
      filter: { type: "unit", controller: "opponent" },
      min: 1,
      max: 1,
      selection: "one"
    }
  ]);

  // "and" joins two independent sentences: neither instruction is linked to
  // the other (055 / 359.3.e.11 — resolve as much as possible).
  assert.equal(buffInstruction.linkedTo, undefined);
  assert.equal(stunInstruction.linkedTo, undefined);
  assert.equal(instructionDefinitionsById.get("effect.buff"), buff);
  assert.equal(instructionDefinitionsById.get("effect.stun"), stun);
});

test("One-Two Punch golden: the interpreter buffs the friendly unit and stuns the enemy unit", () => {
  const kernel = world()
    .unit("ally", { owner: "A", might: 2 })
    .unit("enemy", { owner: "B", might: 4 })
    .build();
  kernel.setTargets("one-two-punch.friendly-unit", [kernel.ref("ally")]);
  kernel.setTargets("one-two-punch.enemy-unit", [kernel.ref("enemy")]);

  const outcome = runAbilityBody(executableBody, kernel);

  assert.equal(outcome.status, "executed");
  assert.equal(kernel.getObject("ally").buffs, 1);
  assert.equal(kernel.getObject("enemy").stunned, true);
  assert.deepEqual(
    outcome.results.map((entry) => entry.result.status),
    ["executed", "executed"]
  );
  assert.deepEqual(
    outcome.events.map((event) => event.action),
    ["buff", "stun"]
  );
  // An existing Buff is chosen legally but places nothing (427.1.c / 702.3.a).
  assert.equal(kernel.getObject("ally").exhausted, false);
});

test("One-Two Punch golden: a friendly unit that already has a Buff is not buffed twice (427.1.c / 702.3.a)", () => {
  const kernel = world()
    .unit("ally", { owner: "A", might: 2, buffs: 1 })
    .unit("enemy", { owner: "B", might: 4 })
    .build();
  kernel.setTargets("one-two-punch.friendly-unit", [kernel.ref("ally")]);
  kernel.setTargets("one-two-punch.enemy-unit", [kernel.ref("enemy")]);

  const outcome = runAbilityBody(executableBody, kernel);

  // The Buff clause is a legal no-op (negated/skipped); the Stun clause is a
  // separate sentence and still resolves (055 / 359.3.e.11).
  assert.equal(outcome.status, "partial");
  assert.equal(kernel.getObject("ally").buffs, 1);
  assert.deepEqual(outcome.results[0].result, { status: "negated", reason: "skipped", events: [] });
  assert.equal(kernel.getObject("enemy").stunned, true);
  assert.deepEqual(kernel.events.filter((event) => event.action === "stun").length, 1);
});

test("One-Two Punch golden: a stale friendly target ignores only the Buff clause (359.3.e.7)", () => {
  const kernel = world()
    .unit("ally", { owner: "A", might: 2 })
    .unit("enemy", { owner: "B", might: 4 })
    .build();
  const stale = kernel.ref("ally");
  assert.equal(kernel.perform({ type: "kill", object: stale }).status, "done");
  kernel.setTargets("one-two-punch.friendly-unit", [stale]);
  kernel.setTargets("one-two-punch.enemy-unit", [kernel.ref("enemy")]);

  const outcome = runAbilityBody(executableBody, kernel);

  assert.equal(outcome.status, "partial");
  assert.deepEqual(outcome.results[0].result, { status: "ignored", reason: "mistargeted" });
  assert.equal(kernel.getObject("enemy").stunned, true);
});

test.todo(
  "One-Two Punch: the printed [Action] Showdown permission needs the continuous.timing consumer and the " +
    "chain's canAct wiring (CR 806 / 159.2.a) — RIFT-85 / RIFT-120 follow-up"
);

test.todo(
  "One-Two Punch: the Stunned state consequence and expiry — no combat damage in the combat damage step " +
    "(CR 424.1.b) and removal in step 3d of the end-of-turn cleanup (424.1.a.2) — belong to combat / turn"
);
