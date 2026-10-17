import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import { createLayerEngine } from "../../../../engine-core/dist/layers/index.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import program from "../../../dist/cards/ogs/master-yi-meditative.js";

const CANONICAL =
  "card.hash-87c4e90c814243a78c356216704a1ec163c6f16ccaba9de6697847335b8f6601";

/** Replace the card's symbolic "controller" filter value with a concrete player id. */
function substituteController(value, playerId) {
  if (Array.isArray(value)) return value.map(item => substituteController(item, playerId));
  if (value === null || typeof value !== "object") return value === "controller" ? playerId : value;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, substituteController(item, playerId)])
  );
}

test("ogs-004-024 Master Yi, Meditative: program validates and is judge-required", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, "While you have 8+ runes, I have +4 :rb_might:.");
});

test("ogs-004-024 Master Yi, Meditative: judgeReason names the RIFT-257 binding and the unevaluated compare guard", () => {
  assert.match(program.judgeReason, /continuous\.might/);
  assert.match(program.judgeReason, /RIFT-257/);
  assert.match(program.judgeReason, /conditionMatches/);
  assert.match(program.judgeReason, /runes/);
});

test("ogs-004-024 Master Yi, Meditative: static +4 Might gated on the controller having 8+ runes", () => {
  assert.equal(program.abilities.length, 1);
  const [ability] = program.abilities;
  assert.equal(ability.kind, "static");
  assert.equal(ability.effect.kind, "continuous.might");
  assert.equal(ability.effect.mode, "add");
  assert.equal(ability.effect.layer, "arithmetic");
  assert.deepEqual(ability.effect.appliesTo, { kind: "constant", value: "self" });
  assert.deepEqual(ability.effect.amount, { kind: "constant", value: 4 });

  const condition = ability.condition;
  assert.equal(condition.kind, "compare");
  assert.equal(condition.operator, "gte");
  assert.deepEqual(condition.right, { kind: "constant", value: 8 });
  assert.equal(condition.left.kind, "count");
  assert.equal(condition.left.subject, "runes");
  // Runes stay on the board in the rune zone after channeling (CR 133.5.a.1, 431.1).
  assert.deepEqual(condition.left.filter, {
    type: "rune",
    controller: "controller",
    zone: "rune-zone"
  });
});

test("ogs-004-024 Master Yi, Meditative: channeled runes are counted in the rune zone by the reference kernel", () => {
  // The layer grant itself is judge-required; this locks the shape of the
  // condition's rune query against the merged channel/zone behavior.
  const kernel = world().rune(["r1", "r2", "r3", "r4", "r5", "r6", "r7", "r8", "r9"]).build();
  assert.equal(
    kernel.perform({ type: "channel-rune", player: "A", amount: 8 }).status,
    "done"
  );
  // The reference kernel compares filter fields exactly, so the card's symbolic
  // "controller" placeholder is substituted with the acting player here (the same
  // convention as sfd/show-of-strength.test.mjs); production resolves it.
  const condition = substituteController(program.abilities[0].condition, kernel.controller);
  assert.equal(kernel.evaluate(condition.left), 8);
  assert.equal(kernel.test(condition), true);
  assert.equal(
    kernel.query({ type: "rune", controller: kernel.controller, zone: "rune-zone" }).length,
    8
  );
});

test("ogs-004-024 Master Yi, Meditative: the condition is false below 8 runes", () => {
  const kernel = world().rune(["r1", "r2", "r3"]).build();
  assert.equal(kernel.perform({ type: "channel-rune", player: "A", amount: 3 }).status, "done");
  const condition = substituteController(program.abilities[0].condition, kernel.controller);
  assert.equal(kernel.evaluate(condition.left), 3);
  assert.equal(kernel.test(condition), false);
});

test("ogs-004-024 Master Yi, Meditative: the merged arithmetic layer would add +4 for this declared effect", () => {
  // The primitive and the arithmetic layer both execute; what is missing is the
  // production path that registers this card's static ability (RIFT-257) and a
  // layer condition evaluator for the "8+ runes" guard (see judgeReason). This
  // golden runs the declared effect shape through the real layer engine to show
  // the +4 arithmetic half itself is merged.
  const kernel = world().unit("master-yi-meditative", { might: 4, zone: "board" }).build();
  const registration = {
    effect: {
      id: "probe",
      layer: "arithmetic",
      source: kernel.ref("master-yi-meditative"),
      filter: { objectId: "master-yi-meditative", zone: "board" },
      effect: { kind: "continuous.might", amount: 4 }
    },
    duration: { type: "permanent" },
    timestamp: 1
  };
  const layered = createLayerEngine(kernel.objects, [registration]).evaluate(kernel.ref("master-yi-meditative"));
  assert.equal(layered.might, 8);
});

test.todo(
  "ogs-004-024 Master Yi, Meditative: +4 Might enters the arithmetic layer while the controller has " +
    "8+ runes (CR 143.2, 133.5.a.1, 431.1) — the CardProgram-to-layers registration is RIFT-257 and " +
    "layers/engine.ts conditionMatches does not evaluate the declared compare/count guard (RIFT-91 follow-up)"
);
