import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "@riftbound/card-dsl";
import level from "../../../dist/effects/keywords/Level.js";
import { keywordDefinitionsById } from "../../../dist/effects/keywords/registry.generated.js";

const HOST = Object.freeze({ canonicalCardId: "unl-151-219" });

function wrapProgram(abilities) {
  return {
    canonicalCardId: HOST.canonicalCardId,
    rulesetVersion: EFFECT_IR_V2_RULESET,
    status: "executable",
    abilities,
    sourceText: "[Level 3][>] ..."
  };
}

function expansion(value) {
  return value === undefined ? level.expand({ host: HOST }) : level.expand({ host: HOST, value });
}

function predicate(value) {
  return expansion(value)[0].effect;
}

test("Level declares the v1.5 keyword identity and rule coverage", () => {
  assert.equal(level.keyword, "Level");
  assert.equal(level.valued, true);
  assert.equal(level.stacking, "separate");
  for (const ref of ["824", "824.1", "824.1.a", "824.1.b.1", "824.1.c", "824.1.c.1", "824.1.d", "824.2"]) {
    assert.ok(level.ruleRefs.includes(ref), `missing rule ref ${ref}`);
  }
});

test("Level expands to one static active XP predicate for its host", () => {
  const abilities = expansion(3);
  assert.equal(abilities.length, 1);
  const [ability] = abilities;
  assert.equal(ability.kind, "static");
  assert.deepEqual(ability.condition, { kind: "always" });
  assert.equal(ability.effect.kind, "condition.predicate");
  assert.equal(ability.effect.id, "level:unl-151-219:3:predicate");
  assert.equal(ability.effect.link, "active");
  assert.equal(ability.effect.predicate, "level-active");
  assert.equal(ability.effect.subject, "self");
  assert.equal(ability.effect.controller, "controller");
  assert.equal(ability.effect.characteristic, "xp");
  assert.equal(ability.effect.query, "controller-xp");
  assert.equal(ability.effect.operator, "gte");
  assert.deepEqual(ability.effect.threshold, { kind: "constant", value: 3 });
});

test("Level expansion validates inside a minimal CardProgram", () => {
  const result = validateCardProgram(wrapProgram(expansion(3)));
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.deepEqual(result.issues, []);
});

test("Level preserves the zero threshold boundary instead of applying a default", () => {
  assert.deepEqual(predicate(0).threshold, { kind: "constant", value: 0 });
  const result = validateCardProgram(wrapProgram(expansion(0)));
  assert.equal(result.ok, true, JSON.stringify(result));
});

test("Level preserves large finite thresholds without clamping", () => {
  const threshold = Number.MAX_SAFE_INTEGER;
  assert.deepEqual(predicate(threshold).threshold, { kind: "constant", value: threshold });
  assert.equal(validateCardProgram(wrapProgram(expansion(threshold))).ok, true);
});

test("Level has no printed numeric default: an omitted value remains missing information", () => {
  assert.deepEqual(predicate(undefined).threshold, { kind: "constant", value: null });
  assert.equal(validateCardProgram(wrapProgram(expansion(undefined))).ok, true);
});

test("Level instances stay separate and retain their independent thresholds", () => {
  assert.equal(level.stacking, "separate");
  const abilities = [...expansion(3), ...expansion(6)];
  assert.equal(abilities.length, 2);
  assert.equal(abilities[0].effect.threshold.value, 3);
  assert.equal(abilities[1].effect.threshold.value, 6);
  assert.notEqual(abilities[0].effect.threshold.value, abilities[1].effect.threshold.value);
  assert.equal(validateCardProgram(wrapProgram(abilities)).ok, true);
});

test("Level predicate ids are scoped to the hosting card", () => {
  const other = level.expand({ host: { canonicalCardId: "unl-152-219" }, value: 3 })[0];
  assert.equal(other.effect.id, "level:unl-152-219:3:predicate");
  assert.equal(other.effect.subject, "self");
});

test("the generated keyword registry indexes Level", () => {
  assert.equal(keywordDefinitionsById.get("Level"), level);
});
