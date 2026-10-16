import assert from "node:assert/strict";
import test from "node:test";
import { EFFECT_IR_V2_RULESET, validateCardProgram } from "@riftbound/card-dsl";
import reaction from "../../../src/effects/keywords/Reaction.ts";

const host = { canonicalCardId: "test-reaction-host" };
const EXPANDED_ABILITY = {
  kind: "static",
  effect: {
    kind: "continuous.timing",
    grants: ["showdown", "closed-state"],
    appliesTo: ["card", "activated-ability"]
  }
};

function wrapProgram(abilities, overrides = {}) {
  return {
    canonicalCardId: "test-reaction-host",
    rulesetVersion: EFFECT_IR_V2_RULESET,
    status: "executable",
    abilities,
    sourceText: "[Reaction]",
    ...overrides
  };
}

test("Reaction: KeywordDef identity — keyword/valued/stacking (v1.5 813)", () => {
  assert.equal(reaction.keyword, "Reaction");
  // 813.1 defines no numeric value; printed as "[Reaction]".
  assert.equal(reaction.valued, false);
  // 813.2/813.3: a permission is boolean; duplicates do not stack numerically.
  assert.equal(reaction.stacking, "single");
});

test("Reaction: ruleRefs cite the v1.5 definition (813 and 159.2.b)", () => {
  assert.ok(Array.isArray(reaction.ruleRefs));
  assert.ok(reaction.ruleRefs.includes("813.1"));
  assert.ok(reaction.ruleRefs.includes("813.1.b"));
  assert.ok(reaction.ruleRefs.includes("813.1.c"));
  assert.ok(reaction.ruleRefs.includes("813.2"));
  assert.ok(reaction.ruleRefs.includes("813.3"));
  assert.ok(reaction.ruleRefs.includes("813.5"));
  assert.ok(reaction.ruleRefs.includes("159.2.b"));
});

test("Reaction: expand returns exactly one continuous.timing static ability (813.1.c)", () => {
  const abilities = reaction.expand({ host });
  assert.equal(abilities.length, 1);
  assert.deepEqual(abilities[0], EXPANDED_ABILITY);
});

test("Reaction: expansion grants closed-state and implies showdown via Action (813.1.b)", () => {
  const [ability] = reaction.expand({ host });
  assert.equal(ability.kind, "static");
  assert.equal(ability.effect.kind, "continuous.timing");
  // 813.1.b grants all of Action's permissions; 813.1.c adds Closed States.
  assert.deepEqual(ability.effect.grants, ["showdown", "closed-state"]);
});

test("Reaction: expansion passes validateCardProgram inside a minimal CardProgram", () => {
  const result = validateCardProgram(wrapProgram([...reaction.expand({ host })]));
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("Reaction: expand ignores value (not a valued keyword) and host identity", () => {
  const withoutValue = reaction.expand({ host });
  const withValue = reaction.expand({ value: 5, host });
  const otherHost = reaction.expand({ host: { canonicalCardId: "other-card" } });
  assert.deepEqual(withValue, withoutValue);
  assert.deepEqual(otherHost, withoutValue);
});

test("Reaction: stacking 'single' — duplicate copies collapse to one permission", () => {
  // 813.2: the permission is inclusive of all other timings; a second copy adds nothing.
  const copies = [reaction.expand({ host })[0], reaction.expand({ host })[0]];
  const merged = reaction.stacking === "single" ? [copies[0]] : copies;
  assert.equal(merged.length, 1);
  const result = validateCardProgram(wrapProgram(merged));
  assert.equal(result.ok, true);
  assert.deepEqual(merged[0], EXPANDED_ABILITY);
});

test("Reaction: expansion stays judge-safe — no instructions, no chain flow of its own", () => {
  const [ability] = reaction.expand({ host });
  // A static ability carries no body/instructions; flow belongs to chain/ & layers.
  assert.equal(ability.kind, "static");
  assert.ok(!("body" in ability));
  assert.ok(!("trigger" in ability));
  assert.ok(!("cost" in ability));
});
