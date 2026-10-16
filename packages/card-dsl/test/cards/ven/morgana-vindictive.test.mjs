import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ven/morgana-vindictive.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL_ID =
  "card.hash-6b5c19257cf27d1dd9fba350525b81aaed82f21aacca46a1c0920853f044a5b4";
const SOURCE_TEXT =
  "[Ambush] (You may play me as a [Reaction] to a battlefield where you have units.)\n" +
  "When you play me, deal damage to a unit equal to the damage marked on it.";

const [ambush, playEffect] = program.abilities;
const [dealDamage] = playEffect.body;
const damageTargetSpec = dealDamage.targets[0];

/**
 * Execute the card's own body with the Finalize-locked target supplied to the
 * kernel (the merged pit-rookie / blind-monk convention): Finalize locks the
 * one chosen unit, so the card's instruction runs unmodified.
 */
function runBody(kernel) {
  const instructions = playEffect.body.map(({ targets, ...rest }) => rest);
  kernel.setTargets(damageTargetSpec.id, [kernel.ref("marked")]);
  return resolveChainBody(instructions, kernel);
}

const damagedWorld = (damage) =>
  world()
    .unit("morgana", { controller: "A", might: 5 })
    .unit("marked", { controller: "B", might: 5, damage })
    .build();

test("ven-017-166 Morgana, Vindictive: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("ven-017-166 Morgana: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /Ambush/);
  assert.match(program.judgeReason, /822/);
  assert.match(program.judgeReason, /play-location-permission/);
  assert.match(program.judgeReason, /continuous\.timing/);
});

test("ven-017-166 Morgana: [Ambush] is declared and its expansion is merged", () => {
  assert.deepEqual(ambush, { kind: "keyword", keyword: "ambush" });
  // 822.1.b/822.1.c: keywords/Ambush.ts (RIFT-266) expands Ambush into the
  // play-location permission plus the conditional Reaction timing. Both of
  // those declarations still lack a consumer (822.3 Finalize re-check,
  // chain canAct), which is exactly the judgeReason.
  assert.ok(keywordDefinitionsById.get("Ambush"), "the Ambush KeywordDef is merged");
  assert.equal(keywordDefinitionsById.get("Ambush").valued, false);
  assert.equal(keywordDefinitionsById.get("Ambush").stacking, "single");
});

test("ven-017-166 Morgana: the card-played play effect deals the marked damage back", () => {
  assert.equal(playEffect.kind, "triggered");
  assert.equal(playEffect.optional, false);
  // 383.4.a / 420.4.a: a Play Effect is put on the Chain once the play is done.
  assert.equal(playEffect.trigger.at, "card-played");
  assert.deepEqual(playEffect.trigger.filter, {
    event: "card-played",
    filter: { source: "self" }
  });
  assert.equal(playEffect.trigger.condition, undefined);

  assert.equal(dealDamage.id, "morgana.damage-equal-to-marked-damage");
  assert.equal(dealDamage.op, "effect.damage");
  // 418.1.b / 142.3: "equal to the damage marked on it" is read from the
  // chosen unit's current damage at resolution, never hard-coded.
  assert.deepEqual(dealDamage.args.amount, {
    kind: "object-property",
    object: { target: "morgana.unit" },
    property: "damage"
  });
  assert.deepEqual(dealDamage.args.target, { kind: "constant", value: "morgana.unit" });
  assert.equal(dealDamage.linkedTo, undefined);
  assert.equal(dealDamage.picks, undefined);
  // 355.9.a.1 / 355.10: "a unit" is a Finalize Choice, so one TargetSpec.
  assert.deepEqual(damageTargetSpec, {
    id: "morgana.unit",
    filter: { type: "unit", zone: "board" },
    min: 1,
    max: 1,
    selection: "one"
  });
});

test("ven-017-166 golden: a unit with 3 damage marked takes 3 more (418.1.b)", () => {
  const kernel = damagedWorld(3);
  const outcome = runBody(kernel);

  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.results.map((entry) => [entry.id, entry.result.status]), [
    ["morgana.damage-equal-to-marked-damage", "executed"]
  ]);
  assert.equal(kernel.getObject("marked").damage, 6);
  assert.deepEqual(outcome.events.map((event) => event.action), ["damage"]);
  assert.equal(outcome.linkedValues["morgana.damage-equal-to-marked-damage.dealt"], 3);
});

test("ven-017-166 golden: an undamaged unit takes no damage at all (418.1.e.1)", () => {
  const kernel = damagedWorld(0);
  const outcome = runBody(kernel);

  // 418.1.e/418.1.e.1: only positive damage is dealt, so the instruction is
  // negated (impossible) and no damage is marked.
  assert.deepEqual(outcome.results.map((entry) => [entry.result.status, entry.result.reason]), [
    ["negated", "impossible"]
  ]);
  assert.equal(kernel.getObject("marked").damage, 0);
  assert.deepEqual(kernel.events, []);
});

test("ven-017-166 golden: a target that left the board makes the damage ignored (359.3.e.7)", () => {
  const kernel = damagedWorld(2);
  const stale = kernel.ref("marked");
  assert.equal(kernel.perform({ type: "kill", object: stale }).status, "done");
  const instructions = playEffect.body.map(({ targets, ...rest }) => rest);
  kernel.setTargets(damageTargetSpec.id, [stale]);
  const outcome = resolveChainBody(instructions, kernel);

  assert.deepEqual(outcome.results.map((entry) => [entry.result.status, entry.result.reason]), [
    ["ignored", "mistargeted"]
  ]);
  assert.equal(kernel.getObject("marked").zone, "trash");
  assert.equal(kernel.getObject("marked").damage, 2);
});

test.todo(
  "ven-017-166 Morgana: [Ambush] play-location permission and conditional Reaction timing " +
    "(822.1.b/822.1.c) are consumed by Finalize location choice and chain canAct — the Ambush " +
    "KeywordDef's own header records both consumers as unmerged"
);

test.todo(
  "ven-017-166 Morgana: 822.3's pre-Finalize re-check (no friendly unit left at the chosen " +
    "battlefield) is enforced by the same Finalize location consumer"
);
