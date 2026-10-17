// Golden test for Mageseeker Warden (ogn-070-298).
//
// Execution evidence (the real play/ready scenarios through the merged chain,
// the no-legal-target boundary and the fail-closed production static bind)
// lives in the RIFT-675 parameterized template golden:
// test/cards/templates/static-static-675.test.mjs.
// This file keeps validation, identity, verbatim text, declared status and the
// key structure of both battlefield-conditioned restrictions.
import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ogn/mageseeker-warden.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";

const CANONICAL = "card.hash-b2b0dc0db7b4646ebf76c4865cc10fb826a643400e758e6396dfeca70062a616";

test("ogn-070-298 Mageseeker Warden: program validates and is registered by canonicalCardId", () => {
  const validation = validateCardProgram(program);
  assert.equal(validation.ok, true, JSON.stringify(validation.issues));
  assert.deepEqual(validation.issues, []);
  assert.equal(cardRegistryById.get(CANONICAL), program);
});

test("ogn-070-298 Mageseeker Warden: identity, exact source text, pure data and explicit blocked status", () => {
  const validation = validateCardProgram(program);
  assert.equal(validation.ok, true, JSON.stringify(validation.issues));
  assert.deepEqual(validation.issues, []);
  assert.equal(program.canonicalCardId, "card.hash-b2b0dc0db7b4646ebf76c4865cc10fb826a643400e758e6396dfeca70062a616");
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /continuous.restrict|Finalize/);
  // Restored pre-resweep assertion /动态读取|相对 opponent|ready cause/, kept
  // as equivalent semantics because the refreshed reason names the same gaps.
  assert.match(program.judgeReason, /relative-player|相对玩家|opponent/);
  assert.match(program.judgeReason, /battlefield/);
  assert.match(program.judgeReason, /causes/);
  assert.equal(program.sourceText, "While I'm at a battlefield, opponents can only play units to their base.\nWhile I'm at a battlefield, spells and abilities can't ready enemy units and gear.");
  assert.deepEqual(JSON.parse(JSON.stringify(program)), program);
});

test("Mageseeker Warden: two independent static restrictions with identical battlefield conditions", () => {
  assert.equal(program.abilities.length, 2);
  const expectedCondition = { kind: "compare", left: { kind: "count", subject: "objects", filter: { object: "self", location: "battlefield" } }, operator: "gte", right: { kind: "constant", value: 1 } };
  for (const ability of program.abilities) {
    assert.equal(ability.kind, "static");
    assert.deepEqual(ability.condition, expectedCondition);
    assert.equal(ability.effect.kind, "continuous.restrict");
  }
});

test("Mageseeker Warden: opponent unit plays go only to the playing player's base", () => {
  assert.deepEqual(program.abilities[0].effect, { kind: "continuous.restrict", action: "play", filter: { type: "unit", controller: "opponent" }, allowedDestination: "acting-player-base" });
});

test("Mageseeker Warden: only spell/ability ready actions on enemy units OR gear are forbidden", () => {
  assert.deepEqual(program.abilities[1].effect, { kind: "continuous.restrict", action: "ready", filter: { type: ["unit", "gear"], controller: "opponent" }, causes: ["spell", "ability"], allowed: false });
  assert.equal(program.abilities[1].effect.causes.includes("awaken"), false);
});

test.todo(
  "ogn-070-298 Mageseeker Warden: deny enemy battlefield unit plays at Finalize, allow their base and end the " +
    "restriction after Warden leaves (355.17.b; relative-player binding plus an acting-player-base destination consumer)"
);
test.todo(
  "ogn-070-298 Mageseeker Warden: forbid spell/ability ready of enemy units/gear while preserving Awaken and " +
    "friendly ready actions (416; continuous.restrict cause filtering)"
);
