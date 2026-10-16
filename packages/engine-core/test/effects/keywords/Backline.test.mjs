import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "@riftbound/card-dsl";

import backline from "../../../dist/effects/keywords/Backline.js";
import { keywordDefinitionsById } from "../../../dist/effects/keywords/registry.generated.js";

const HOST = Object.freeze({ canonicalCardId: "sfd-173-221" });

function wrapProgram(abilities) {
  return {
    canonicalCardId: HOST.canonicalCardId,
    rulesetVersion: EFFECT_IR_V2_RULESET,
    status: "executable",
    abilities,
    sourceText: "[Backline]"
  };
}

function expansion(value) {
  return value === undefined ? backline.expand({ host: HOST }) : backline.expand({ value, host: HOST });
}

test("Backline identity is non-valued and single-stacking (CR 826.1 / 826.5)", () => {
  assert.equal(backline.keyword, "Backline");
  assert.equal(backline.valued, false);
  assert.equal(backline.stacking, "single");
  for (const ref of ["826", "826.3", "826.4.b", "826.5", "826.6"]) {
    assert.ok(backline.ruleRefs.includes(ref), `missing rule ref ${ref}`);
  }
});

test("Backline expands to one static continuous.combat ability", () => {
  const abilities = expansion();
  assert.equal(abilities.length, 1);
  const [ability] = abilities;
  assert.equal(ability.kind, "static");
  assert.equal(ability.effect.kind, "continuous.combat");
  assert.equal(ability.effect.appliesTo, "self");
  assert.equal(ability.effect.mode, "damage-assignment");
  assert.equal(ability.effect.priority, "last");
});

test("Backline carries the lethal, same-controller, non-Backline restriction (CR 826.3)", () => {
  const [ability] = expansion();
  assert.equal(ability.effect.damage, "lethal");
  assert.equal(ability.effect.controllerScope, "same-controller");
  assert.equal(ability.effect.excludesKeyword, "Backline");
});

test("Backline expansion passes validateCardProgram", () => {
  const result = validateCardProgram(wrapProgram(expansion()));
  assert.equal(result.ok, true, result.ok ? "" : JSON.stringify(result.issues));
  assert.deepEqual(result.issues, []);
});

test("Backline stacking is single: repeated instances produce one equivalent permission", () => {
  const first = expansion();
  const second = expansion();
  assert.equal(first.length, 1);
  assert.equal(second.length, 1);
  assert.deepEqual(first, second);
  const merged = backline.stacking === "single" ? [first[0]] : [...first, ...second];
  assert.equal(merged.length, 1);
  assert.equal(validateCardProgram(wrapProgram(merged)).ok, true);
});

test("Backline is not valued: omitted, zero, and stray numeric values do not change its expansion", () => {
  assert.deepEqual(expansion(0), expansion());
  assert.deepEqual(expansion(99), expansion());
  assert.equal(expansion()[0].effect.priority, "last");
});

test("Backline ignores host catalog identity because the runtime binds the self selector", () => {
  const other = backline.expand({ host: { canonicalCardId: "unl-090-219" } });
  assert.deepEqual(other, expansion());
  assert.equal(other[0].effect.appliesTo, "self");
});

test("Backline returns a fresh static effect object on each expansion", () => {
  const first = expansion();
  const second = expansion();
  assert.notEqual(first[0], second[0]);
  assert.notEqual(first[0].effect, second[0].effect);
  assert.deepEqual(first, second);
});

test("Backline is available from the generated keyword registry", () => {
  assert.equal(keywordDefinitionsById.get("Backline"), backline);
});
