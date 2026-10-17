import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ogn/gemcraft-seer.js";

const CANONICAL = "card.hash-636736b78f865097117f9cc183f462f662d5b234a87f487fd261ac54279875c6";

test("Gemcraft Seer program validates and is judge-required", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /静态 grant/);
  assert.match(program.judgeReason, /object\.id/);
  assert.match(program.judgeReason, /exclude:self/);
  assert.equal(
    program.sourceText,
    "[Vision] (When you play me, look at the top card of your Main Deck. You may recycle it.)\n" +
      "Other friendly units have [Vision]."
  );
});

test("Gemcraft Seer structure: Vision keyword plus an other-friendly-units Vision grant", () => {
  assert.equal(program.abilities.length, 2);
  const [keyword, staticAbility] = program.abilities;
  assert.deepEqual(keyword, { kind: "keyword", keyword: "vision" });

  assert.equal(staticAbility.kind, "static");
  assert.equal(staticAbility.effect.kind, "continuous.grant-keyword");
  assert.equal(staticAbility.effect.keyword, "Vision");
  assert.equal(staticAbility.condition, undefined);
  // "Other friendly units": units the controller controls, on the board, with
  // the source itself excluded ("other").
  assert.deepEqual(staticAbility.effect.filter, {
    type: "unit",
    controller: "controller",
    zone: "board",
    exclude: "self"
  });
});
