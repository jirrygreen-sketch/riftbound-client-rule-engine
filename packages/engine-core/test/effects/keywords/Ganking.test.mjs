import test from "node:test";
import assert from "node:assert/strict";
import { validateCardProgram, EFFECT_IR_V2_RULESET } from "@riftbound/card-dsl";
import Ganking from "../../../dist/effects/keywords/Ganking.js";
import { keywordDefinitionsById } from "../../../dist/effects/keywords/registry.generated.js";

const HOST = { canonicalCardId: "ogn-205-298" };

function wrapProgram(abilities) {
  return {
    canonicalCardId: HOST.canonicalCardId,
    rulesetVersion: EFFECT_IR_V2_RULESET,
    status: "executable",
    abilities,
    sourceText: "[Ganking]"
  };
}

function expansion(value) {
  return Ganking.expand(value === undefined ? { host: HOST } : { value, host: HOST });
}

test("definition: non-valued keyword with v1.5 rule refs and single stacking (810.2)", () => {
  assert.equal(Ganking.keyword, "Ganking");
  assert.equal(Ganking.valued, false);
  assert.equal(Ganking.stacking, "single");
  for (const ref of ["810", "810.1", "810.1.c", "810.2", "810.3", "144.4.c", "144.4.c.1"]) {
    assert.ok(Ganking.ruleRefs.includes(ref), `missing ruleRef ${ref}`);
  }
});

test("expands to exactly one static continuous.movement ability (810.1 passive)", () => {
  const abilities = expansion();
  assert.equal(abilities.length, 1);
  const ability = abilities[0];
  assert.equal(ability.kind, "static");
  assert.equal(ability.effect.kind, "continuous.movement");
  assert.equal(ability.effect.permission, "battlefield-to-battlefield");
  assert.equal(ability.effect.source, "battlefield");
  assert.equal(ability.effect.destination, "battlefield");
  assert.equal(ability.effect.move, "standard");
  assert.equal(ability.effect.addsPermission, true);
});

test("expansion passes validateCardProgram inside a minimal CardProgram", () => {
  const result = validateCardProgram(wrapProgram([...expansion()]));
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
});

test("stacking single: two Ganking copies collapse into one ability (810.2)", () => {
  // stacking "single" means the registry layer counts the keyword once; each expand
  // call returns one ability and duplicate copies are redundant.
  const first = expansion();
  const second = expansion();
  assert.equal(first.length, 1);
  assert.equal(second.length, 1);
  assert.deepEqual(first[0], second[0], "redundant copies expand identically");
});

test("valued boundary: a spurious value is ignored, expansion stays value-free", () => {
  const withValue = expansion(3);
  const without = expansion();
  assert.deepEqual(withValue, without);
  assert.equal(withValue[0].effect.value, undefined);
  assert.equal(withValue.length, 1, "value must not create extra copies (810.2)");
});

test("each expansion returns a fresh object graph (no shared mutable state)", () => {
  const first = expansion();
  const second = expansion();
  assert.notEqual(first[0], second[0]);
  assert.notEqual(first[0].effect, second[0].effect);
  assert.deepEqual(first, second);
});

test("registry exposes the Ganking definition by keyword id", () => {
  assert.equal(keywordDefinitionsById.get("Ganking"), Ganking);
});
