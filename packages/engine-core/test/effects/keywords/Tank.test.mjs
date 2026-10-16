import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "@riftbound/card-dsl";

import tank from "../../../dist/effects/keywords/Tank.js";
import { keywordDefinitionsById } from "../../../dist/effects/keywords/registry.generated.js";

const HOST = Object.freeze({ canonicalCardId: "ogn-137-298" });

function wrapProgram(abilities) {
  return {
    canonicalCardId: HOST.canonicalCardId,
    rulesetVersion: EFFECT_IR_V2_RULESET,
    status: "executable",
    abilities,
    sourceText: "[Tank]"
  };
}

function expansion(value) {
  return value === undefined ? tank.expand({ host: HOST }) : tank.expand({ value, host: HOST });
}

test("Tank identity is non-valued and single-stacking (CR 815.1 / 815.2)", () => {
  assert.equal(tank.keyword, "Tank");
  assert.equal(tank.valued, false);
  assert.equal(tank.stacking, "single");
  for (const ref of ["815", "815.1.b", "815.1.c.2", "815.2", "815.3"]) {
    assert.ok(tank.ruleRefs.includes(ref), `missing rule ref ${ref}`);
  }
});

test("Tank expands to one static continuous.combat ability", () => {
  const abilities = expansion();
  assert.equal(abilities.length, 1);
  const [ability] = abilities;
  assert.equal(ability.kind, "static");
  assert.equal(ability.effect.kind, "continuous.combat");
  assert.equal(ability.effect.appliesTo, "self");
  assert.equal(ability.effect.mode, "damage-assignment");
  assert.equal(ability.effect.priority, "first");
});

test("Tank carries the lethal, same-controller, non-Tank restriction (CR 815.1.b)", () => {
  const [ability] = expansion();
  assert.equal(ability.effect.damage, "lethal");
  assert.equal(ability.effect.controllerScope, "same-controller");
  assert.equal(ability.effect.excludesKeyword, "Tank");
});

test("Tank expansion passes validateCardProgram", () => {
  const result = validateCardProgram(wrapProgram(expansion()));
  assert.equal(result.ok, true, result.ok ? "" : JSON.stringify(result.issues));
  assert.deepEqual(result.issues, []);
});

test("Tank stacking is single: repeated instances produce one equivalent permission", () => {
  const first = expansion();
  const second = expansion();
  assert.equal(first.length, 1);
  assert.equal(second.length, 1);
  assert.deepEqual(first, second);
  const merged = tank.stacking === "single" ? [first[0]] : [...first, ...second];
  assert.equal(merged.length, 1);
  assert.equal(validateCardProgram(wrapProgram(merged)).ok, true);
});

test("Tank is not valued: omitted, zero, and stray numeric values do not change its expansion", () => {
  assert.deepEqual(expansion(0), expansion());
  assert.deepEqual(expansion(99), expansion());
  assert.equal(expansion()[0].effect.priority, "first");
});

test("Tank ignores host catalog identity because the runtime binds the self selector", () => {
  const other = tank.expand({ host: { canonicalCardId: "ogn-240-298" } });
  assert.deepEqual(other, expansion());
  assert.equal(other[0].effect.appliesTo, "self");
});

test("Tank returns a fresh static effect object on each expansion", () => {
  const first = expansion();
  const second = expansion();
  assert.notEqual(first[0], second[0]);
  assert.notEqual(first[0].effect, second[0].effect);
  assert.deepEqual(first, second);
});

test("Tank is available from the generated keyword registry", () => {
  assert.equal(keywordDefinitionsById.get("Tank"), tank);
});
