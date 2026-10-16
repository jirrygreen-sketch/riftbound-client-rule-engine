import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/ogn/noxus-saboteur.js";
import { cardProgramsById } from "../../../dist/cards/registry.generated.js";

const CARD_ID = "card.hash-e5d5e81a865437ba16c7a9dd066d67dc5f437867e4ec858ae5245045cc548caf";
const [restriction] = program.abilities;

test("noxus-saboteur: passes validateCardProgram and is indexed by canonicalCardId", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues, null, 2));
  assert.equal(cardProgramsById.get(CARD_ID), program);
});

test("noxus-saboteur: identity, ruleset, status and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /continuous\.restrict/);
  assert.match(program.judgeReason, /425\.2\.a/);
  assert.match(program.judgeReason, /811\.5\.a/);
  assert.equal(program.sourceText, "Your opponents' [Hidden] cards can't be revealed here.");
});

test("noxus-saboteur: a single static continuous restriction forbids revealing opponent Hidden cards", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(restriction.kind, "static");
  assert.equal(restriction.condition, undefined);
  assert.equal(restriction.effect.kind, "continuous.restrict");
  assert.equal(restriction.effect.operation, "reveal");
  assert.equal(restriction.effect.forbidden, true);
});

test("noxus-saboteur: the restricted set is the opponents' Hidden cards at this location (811.5, 421.1)", () => {
  assert.deepEqual(restriction.effect.filter, {
    tag: "Hidden",
    controller: "opponent",
    zone: "board",
    sameLocationAs: "self"
  });
  // 811.1.a: Hidden appears on Spells, Units, and Gear, so the restriction must
  // not be narrowed to one card type (811.5 lets effects check the characteristic).
  assert.equal(restriction.effect.filter.type, undefined);
});

test.todo(
  "noxus-saboteur: the continuous.restrict primitive (RIFT-9, depends on condition.predicate) and a kernel consumer " +
    "that blocks the reveal action (425.2.a) are required; neither is merged"
);
test.todo(
  "noxus-saboteur: facedown cards are not Hidden (811.5.a), which the restriction's card characteristic check must respect"
);
