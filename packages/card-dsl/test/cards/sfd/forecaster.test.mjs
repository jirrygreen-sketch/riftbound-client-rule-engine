// Golden test for Forecaster (sfd-065-221).
// The static Vision grant needs continuous.grant-keyword (RIFT-91) and the
// Vision keyword expansion (RIFT-83), so execution assertions stay todo.
import test from "node:test";
import assert from "node:assert/strict";
import { validateCardProgram } from "../../../../../packages/card-dsl/dist/ir/index.js";
import program from "../../../../../packages/card-dsl/dist/cards/sfd/forecaster.js";

const CANONICAL = "card.hash-cdeb1c4bb2202d43d0f4ccb7c3e0ddfa25caf4f81c41dde5c8bdaa6bbeddfe40";

test("program passes validateCardProgram and is judge-required", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason ?? "", /continuous\.grant-keyword/);
  assert.match(program.judgeReason ?? "", /RIFT-91/);
  assert.match(program.judgeReason ?? "", /RIFT-83/);
  assert.match(program.sourceText, /Your Mechs have \[Vision\]/);
});

test("static ability grants Vision to friendly Mech units", () => {
  assert.equal(program.abilities.length, 1);
  const [grant] = program.abilities;
  assert.equal(grant.kind, "static");
  assert.equal(grant.effect.kind, "continuous.grant-keyword");
  assert.equal(grant.effect.keyword, "Vision");
  assert.deepEqual(grant.effect.filter, {
    zone: "board",
    controller: "controller",
    tag: "Mech",
    type: "unit"
  });
  assert.equal(grant.condition, undefined);
});

test.todo(
  "expand Vision into its play-triggered Predict (look + optional recycle) via RIFT-83 once continuous.grant-keyword (RIFT-91) is registered"
);
