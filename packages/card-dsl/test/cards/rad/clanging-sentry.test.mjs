import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/rad/clanging-sentry.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";

const CANONICAL = "card.hash-664329985c0c826779032a079e87a5c433f6be42cbfb4f724f81fd89fcc9a90a";
const SOURCE_TEXT =
  "Your Mechs have [Disarm]. (When each of us attacks, give an enemy unit there -1 :rb_might: this turn.)";

const [grant] = program.abilities;

test("rad-055-167 Clanging Sentry: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("rad-055-167 Clanging Sentry: identity, ruleset, status, judgeReason and sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /Disarm/);
  assert.match(program.judgeReason, /continuous\.grant-keyword/);
  assert.match(program.judgeReason, /RIFT-91/);
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL), program);
});

test("rad-055-167 Clanging Sentry: one static grant of unvalued Disarm to every friendly Mech", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(grant.kind, "static");
  assert.deepEqual(grant.effect, {
    kind: "continuous.grant-keyword",
    keyword: "disarm",
    // 831.1.c.3：印刷省略 Disarm 值，按 1；831.2 由关键词注册表把多个来源相加。
    value: { kind: "constant", value: 1 },
    filter: { type: "unit", tag: "Mech", controller: "controller", zone: "board" }
  });
  assert.equal(grant.condition, undefined);
});

test("rad-055-167 Clanging Sentry: the granted Disarm keyword has no merged KeywordDef", () => {
  // 831.2 的官方例证正是本卡：两张 Clanging Sentry 让 Mech 的 Disarm 值相加为 2。
  assert.equal(keywordDefinitionsById.get("disarm"), undefined);
});

test.todo(
  "rad-055-167 Clanging Sentry: expand [Disarm] (831.1.d attack trigger: give an enemy unit there -1 Might this turn) " +
    "once a Disarm KeywordDef exists (no assigned task) — its Might modification also needs continuous.might / " +
    "continuous.duration (RIFT-91)"
);

test.todo(
  "rad-055-167 Clanging Sentry: evaluate the continuous.grant-keyword layer so friendly Mechs actually gain Disarm, " +
    "with the 831.2 summing semantics — the CardProgram static path into the layer engine is unmerged (RIFT-91 follow-up)"
);
