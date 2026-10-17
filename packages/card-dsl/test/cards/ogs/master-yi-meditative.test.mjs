// RIFT-667 single-card golden: validation, identity, the key IR structure of
// Master Yi, Meditative, and the merged condition/arithmetic halves. The
// whole-card execution evidence (its own scenario through the generic card harness
// plus the measured outcome of binding its own static ability with the production
// binder) lives in `test/cards/templates/static-667.test.mjs`.
//
// The card stays judge-required: the static binder evaluates the declared
// condition, but its count query passes filter.controller "controller" into
// layers/filter.ts literally, so the host controller's runes count as 0. Nothing
// here approximates the printed effect.
import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ogs/master-yi-meditative.js";
import { cardProgramsById } from "../../../dist/cards/registry.generated.js";
import { createLayerEngine } from "../../../../engine-core/dist/layers/index.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL = "card.hash-87c4e90c814243a78c356216704a1ec163c6f16ccaba9de6697847335b8f6601";
const SOURCE_TEXT = "While you have 8+ runes, I have +4 :rb_might:.";
const [ability] = program.abilities;

/** The reference kernel compares filter fields exactly; production resolves the
 *  symbolic "controller" anchor. Substituting the acting player is the same
 *  convention as the sibling count-condition goldens. */
function substituteController(value, playerId) {
  if (Array.isArray(value)) return value.map(item => substituteController(item, playerId));
  if (value === null || typeof value !== "object") return value === "controller" ? playerId : value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, substituteController(item, playerId)]));
}

test("ogs-004-024 Master Yi, Meditative: program validates and keeps identity", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.issues));
  assert.deepEqual(result.issues, []);
  assert.equal(cardProgramsById.get(CANONICAL), program);
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
});

test("ogs-004-024 Master Yi, Meditative: static +4 Might gated on the controller having 8+ runes", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "static");
  // 143.2 / 478.1.a: +4 Might is a self-scoped arithmetic-layer modification.
  assert.equal(ability.effect.kind, "continuous.might");
  assert.equal(ability.effect.mode, "add");
  assert.equal(ability.effect.layer, "arithmetic");
  assert.deepEqual(ability.effect.appliesTo, { kind: "constant", value: "self" });
  assert.deepEqual(ability.effect.amount, { kind: "constant", value: 4 });
  // 133.5.a.1 / 161.1.a / 431.1: the gate counts runes in the rune zone.
  assert.equal(ability.condition.kind, "compare");
  assert.equal(ability.condition.operator, "gte");
  assert.deepEqual(ability.condition.left, {
    kind: "count",
    subject: "runes",
    filter: { type: "rune", controller: "controller", zone: "rune-zone" }
  });
  assert.deepEqual(ability.condition.right, { kind: "constant", value: 8 });
});

test("ogs-004-024 Master Yi, Meditative component: the declared condition and +4 both really evaluate", () => {
  // The count vocabulary and the arithmetic layer are merged; only the relative
  // player binding inside the production static query is missing (judgeReason).
  const kernel = world().rune(["r1", "r2", "r3", "r4", "r5", "r6", "r7", "r8", "r9"]).build();
  assert.equal(kernel.perform({ type: "channel-rune", player: "A", amount: 8 }).status, "done");
  const condition = substituteController(ability.condition, kernel.controller);
  assert.equal(kernel.evaluate(condition.left), 8);
  assert.equal(kernel.test(condition), true);
  // Below the printed threshold the condition is false.
  const below = world().rune(["r1", "r2", "r3"]).build();
  assert.equal(below.perform({ type: "channel-rune", player: "A", amount: 3 }).status, "done");
  assert.equal(below.test(substituteController(ability.condition, below.controller)), false);
  // The +4 arithmetic half, applied to the host with a matching filter.
  const host = world().unit("master-yi-meditative", { might: 4, zone: "board" }).build();
  const layered = createLayerEngine(host.objects, [{
    effect: {
      id: "probe",
      layer: "arithmetic",
      source: host.ref("master-yi-meditative"),
      filter: { objectId: "master-yi-meditative", zone: "board" },
      effect: { kind: "continuous.might", amount: 4 }
    },
    duration: { type: "permanent" },
    timestamp: 1
  }]).evaluate(host.ref("master-yi-meditative"));
  assert.equal(layered.might, 8);
});

test("ogs-004-024 Master Yi, Meditative: judgeReason names the measured relative-controller gap", () => {
  // Re-probed 2026-10-17 (RIFT-667): eight runes in the rune zone still grant +0
  // through the production binding, while the identical count with a concrete
  // player id really applies the +4.
  assert.match(program.judgeReason, /controller/);
  assert.match(program.judgeReason, /matchesObjectFilter/);
});

test.todo(
  "ogs-004-024 Master Yi, Meditative: +4 Might must apply while the controller has 8+ runes " +
    "(CR 143.2 / 478.1.a / 133.5.a.1 / 431.1) - the production static condition query must bind the relative " +
    "controller anchor to the ability source's controller (contract change request)"
);
