import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ogn/draven-showboat.js";

const CARD_ID = "card.hash-2fce7f4e1db0ed6a111d74a7702d3846593794a9cddf1a1722959543f53ec58e";

test("ogn-028-298 Draven, Showboat: program validates and is judge-required", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /points/);
  assert.match(program.judgeReason, /RIFT-257/);
});

test("ogn-028-298 Draven, Showboat: identity, ruleset and exact source text", () => {
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.sourceText, "My Might is increased by your points.");
  assert.equal(program.judgeReason.includes("continuous.might"), true);
});

test("ogn-028-298 Draven, Showboat: one static arithmetic Might effect sourced from the controller's points", () => {
  assert.equal(program.abilities.length, 1);
  const [ability] = program.abilities;
  assert.equal(ability.kind, "static");
  assert.equal(ability.condition, undefined);
  assert.equal(ability.effect.kind, "continuous.might");
  assert.equal(ability.effect.mode, "add");
  assert.equal(ability.effect.layer, "arithmetic");
  assert.equal(ability.effect.appliesTo, "self");
  // The amount is the controller's current points, recorded as descriptor data
  // because Expr has no player-attribute reader (see judgeReason).
  assert.deepEqual(ability.effect.amountFrom, { player: "controller", property: "points" });
  assert.equal(ability.effect.amount, undefined);
});

test.todo(
  "ogn-028-298 Draven, Showboat: execute 'Might += your points' as a dynamic arithmetic-layer " +
    "Might change and assert the derived Might/combat damage (Expr lacks a player-attribute reader and " +
    "the CardProgram-to-layers binding remains RIFT-257)"
);
