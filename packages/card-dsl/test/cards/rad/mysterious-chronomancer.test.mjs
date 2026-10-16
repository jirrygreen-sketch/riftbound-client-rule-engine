import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/rad/mysterious-chronomancer.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";

const CANONICAL = "card.hash-6b0bcf2f0d70419ac960f2e10f95b86b212de65ad51127d9ca67749bf9316641";
const SOURCE_TEXT =
  "When you play me, [Predict 2]. (Look at the top 2 cards of your Main Deck. " +
  "Recycle any of them and put the rest back in any order.)\n" +
  "[Disarm 2] (When I attack, give an enemy unit here -2 :rb_might: this turn.)";

const [predict, disarm] = program.abilities;

test("rad-050-167 Mysterious Chronomancer: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("rad-050-167 Mysterious Chronomancer: identity, ruleset, status, judgeReason and sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /Predict/);
  assert.match(program.judgeReason, /437/);
  assert.match(program.judgeReason, /Disarm/);
  assert.match(program.judgeReason, /831/);
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL), program);
});

test("rad-050-167 Mysterious Chronomancer: [Predict 2] is declared with its printed value", () => {
  assert.equal(program.abilities.length, 2);
  // README 第 5 节：关键词只声明，不重写展开；437.3 的 X = 2。
  assert.deepEqual(predict, { kind: "keyword", keyword: "predict", value: 2 });
});

test("rad-050-167 Mysterious Chronomancer: [Disarm 2] is declared with its printed value (831.1.c)", () => {
  assert.deepEqual(disarm, { kind: "keyword", keyword: "disarm", value: 2 });
});

test("rad-050-167 Mysterious Chronomancer: neither keyword has a merged KeywordDef", () => {
  assert.equal(keywordDefinitionsById.get("predict"), undefined);
  assert.equal(keywordDefinitionsById.get("disarm"), undefined);
});

test.todo(
  "rad-050-167 Mysterious Chronomancer: expand [Predict 2] (look at the top 2, recycle any, put the rest back in any " +
    "order — CR 437.1 / 437.1.a / 437.3) into a reusable kw-predict KeywordDef; RIFT-83's Vision only inlines Predict 1 " +
    "(no assigned task for the shared keyword)"
);

test.todo(
  "rad-050-167 Mysterious Chronomancer: expand [Disarm 2] (attack trigger + give an enemy unit here -2 Might this turn, " +
    "CR 831.1.d) — the Disarm KeywordDef and its continuous.might primitive are unmerged (no assigned task; RIFT-91 layers)"
);

test.todo(
  "rad-050-167 Mysterious Chronomancer: fire the play trigger that carries the Predict keyword (CR 420.4.a) — depends on " +
    "the keyword-trigger wiring plus RIFT-120 chain/event integration"
);
