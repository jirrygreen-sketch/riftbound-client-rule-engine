// RIFT-667 single-card golden: validation, identity and the key IR structure of
// Vilemaw's Lair. The real execution evidence for this card (its own scenario
// through the generic card harness, the rule-query reads, and the measured outcome
// of binding its own static ability with the production binder) lives in
// `test/cards/templates/static-667.test.mjs`.
//
// The card stays judge-required: the merged rule query really serves the
// prohibition for Standard Move, but effect.move submits a move-location action
// whose path never consults it, and no production caller supplies a
// DuelMovementRuleContext. Nothing here approximates the printed effect.
import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ogn/vilemaws-lair.js";
import { cardProgramsById } from "../../../dist/cards/registry.generated.js";

const CANONICAL = "card.hash-3e2d969f2528a782a98c698fc45d9937d376dd06244c444271adf9cbd4100e77";
const SOURCE_TEXT = "Units can't move from here to base.";
const [ability] = program.abilities;

test("ogn-295-298 Vilemaw's Lair: program validates and keeps identity", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.issues));
  assert.deepEqual(result.issues, []);
  assert.equal(cardProgramsById.get(CANONICAL), program);
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
});

test("ogn-295-298 Vilemaw's Lair: one passive movement restriction on units here", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "static");
  assert.equal(ability.condition, undefined);
  // 144.4.b names the Battlefield-to-Base Standard Move route this removes.
  assert.equal(ability.effect.kind, "continuous.movement");
  // Both spellings ship: layers/rules/query.ts movement() reads the plural,
  // layers/engine.ts applyAbility folds the singular (053.3 scope / 054.1).
  assert.equal(ability.effect.restriction, "move-from-here-to-base");
  assert.deepEqual(ability.effect.restrictions, ["move-from-here-to-base"]);
  // 054.1: a prohibition only removes options; it grants nothing.
  assert.equal(ability.effect.addsPermission, false);
  assert.equal(ability.effect.permission, undefined);
  assert.deepEqual(ability.effect.filter, {
    type: "unit",
    zone: "board",
    sameLocationAs: "self"
  });
});

test("ogn-295-298 Vilemaw's Lair: judgeReason names the measured consumers that are still missing", () => {
  // Re-probed 2026-10-17 (RIFT-667): both players' Standard Moves from here are
  // prohibited through the rule query, while an effect Move from here to base
  // still succeeds with the restriction registered in the same world.
  assert.match(program.judgeReason, /054\.1/);
  assert.match(program.judgeReason, /358\.3\.a/);
  assert.match(program.judgeReason, /move-location/);
  assert.match(program.judgeReason, /effect\.move/);
});

test.todo(
  "ogn-295-298 Vilemaw's Lair: the printed prohibition must also stop an effect Move from here to base " +
    "(CR 054.1 / 358.3.a / 359.3.e.14.b) - effect.move must consult layers/rules movement restrictions, and the " +
    "Standard Move production path (duel/standard-move-executor-v2.ts) must supply a DuelMovementRuleContext"
);
