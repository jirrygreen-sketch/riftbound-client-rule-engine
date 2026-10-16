import assert from "node:assert/strict";
import test from "node:test";
import { EFFECT_IR_V2_RULESET, validateCardProgram } from "@riftbound/card-dsl";
import action from "../../../src/effects/keywords/Action.ts";

const host = { canonicalCardId: "test-action-host" };
const EXPANDED_ABILITY = {
  kind: "static",
  effect: {
    kind: "continuous.timing",
    grants: ["showdown"],
    appliesTo: ["card", "activated-ability"]
  }
};

function wrapProgram(abilities, overrides = {}) {
  return {
    canonicalCardId: "test-action-host",
    rulesetVersion: EFFECT_IR_V2_RULESET,
    status: "executable",
    abilities,
    sourceText: "[Action]",
    ...overrides
  };
}

test("Action: KeywordDef identity — keyword/valued/stacking (v1.5 806)", () => {
  assert.equal(action.keyword, "Action");
  // 806.1 defines no numeric value; printed as "[Action]".
  assert.equal(action.valued, false);
  // 806.2/806.3: a permission is boolean; duplicates do not stack numerically.
  assert.equal(action.stacking, "single");
});

test("Action: ruleRefs cite the v1.5 definition (806 and 159.2.a)", () => {
  assert.ok(Array.isArray(action.ruleRefs));
  assert.ok(action.ruleRefs.includes("806.1"));
  assert.ok(action.ruleRefs.includes("806.1.b"));
  assert.ok(action.ruleRefs.includes("806.1.c"));
  assert.ok(action.ruleRefs.includes("806.2"));
  assert.ok(action.ruleRefs.includes("806.3"));
  assert.ok(action.ruleRefs.includes("806.5"));
  assert.ok(action.ruleRefs.includes("159.2.a"));
});

test("Action: expand returns exactly one continuous.timing static ability (806.1.c)", () => {
  const abilities = action.expand({ host });
  assert.equal(abilities.length, 1);
  assert.deepEqual(abilities[0], EXPANDED_ABILITY);
});

test("Action: expansion grants showdown timing, not closed-state (806 vs 813)", () => {
  const [ability] = action.expand({ host });
  assert.equal(ability.kind, "static");
  assert.equal(ability.effect.kind, "continuous.timing");
  assert.deepEqual(ability.effect.grants, ["showdown"]);
  assert.ok(!ability.effect.grants.includes("closed-state"));
});

test("Action: expansion passes validateCardProgram inside a minimal CardProgram", () => {
  const result = validateCardProgram(wrapProgram([...action.expand({ host })]));
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("Action: expand ignores value (not a valued keyword) and host identity", () => {
  const withoutValue = action.expand({ host });
  const withValue = action.expand({ value: 3, host });
  const otherHost = action.expand({ host: { canonicalCardId: "other-card" } });
  assert.deepEqual(withValue, withoutValue);
  assert.deepEqual(otherHost, withoutValue);
});

test("Action: stacking 'single' — duplicate copies collapse to one permission", () => {
  // 806.2: the permission is inclusive; a second copy adds nothing new.
  // Simulating the registry-level merge for stacking "single": one ability survives.
  const copies = [action.expand({ host })[0], action.expand({ host })[0]];
  const merged = action.stacking === "single" ? [copies[0]] : copies;
  assert.equal(merged.length, 1);
  const result = validateCardProgram(wrapProgram(merged));
  assert.equal(result.ok, true);
  assert.deepEqual(merged[0], EXPANDED_ABILITY);
});

test("Action: expansion stays judge-safe — no instructions, no chain flow of its own", () => {
  const [ability] = action.expand({ host });
  // A static ability carries no body/instructions; flow belongs to chain/ & layers.
  assert.equal(ability.kind, "static");
  assert.ok(!("body" in ability));
  assert.ok(!("trigger" in ability));
  assert.ok(!("cost" in ability));
});
