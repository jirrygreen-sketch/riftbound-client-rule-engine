import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ogn/mageseeker-warden.js";


test("ogn-070-298: identity, exact source text, pure data and explicit blocked status", () => {
  const validation = validateCardProgram(program);
  assert.equal(validation.ok, true, JSON.stringify(validation.issues));
  assert.deepEqual(validation.issues, []);
  assert.equal(program.canonicalCardId, "card.hash-b2b0dc0db7b4646ebf76c4865cc10fb826a643400e758e6396dfeca70062a616");
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /continuous.restrict|Finalize/);
  assert.match(program.judgeReason, /动态读取|相对 opponent|ready cause/);
  assert.equal(program.sourceText, "While I'm at a battlefield, opponents can only play units to their base.\nWhile I'm at a battlefield, spells and abilities can't ready enemy units and gear.");
  assert.deepEqual(JSON.parse(JSON.stringify(program)), program);
});

test("Mageseeker Warden: two independent static restrictions with identical battlefield conditions", () => {
  assert.equal(program.abilities.length, 2);
  const expectedCondition = { kind: "compare", left: { kind: "count", subject: "objects", filter: { object: "self", zone: "battlefield" } }, operator: "gte", right: { kind: "constant", value: 1 } };
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

test.todo("Mageseeker Warden: deny enemy battlefield unit plays at Finalize, allow their base and end restriction after Warden leaves (CR 355.17.b; dynamic battlefield and relative-player binding)");
test.todo("Mageseeker Warden: forbid spell/ability ready of enemy units/gear while preserving Awaken and friendly ready actions (continuous.restrict action-cause binding)");
