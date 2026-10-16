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
  assert.match(program.judgeReason, /grant-keyword/);
  assert.match(program.judgeReason, /RIFT-91/);
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
  assert.equal(staticAbility.effect.kind, "grant-keyword");
  assert.equal(staticAbility.effect.keyword, "vision");
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

test.todo(
  "Gemcraft Seer grant: other friendly units gain [Vision], so each of them triggers its own Predict when it enters " +
    "the Board (817.1.c / 817.2); needs card-program static abilities registered as layer continuous effects (RIFT-91) " +
    "plus the self-exclusion in the grant filter"
);

test.todo(
  "Gemcraft Seer Vision: this card's own Predict 1 with the may-recycle choice (817.1.c, 437.1 / 437.3.a) executes on the " +
    "merged keyword body once the chain subscribes card-program triggers; the keyword body itself already runs on the reference kernel"
);
