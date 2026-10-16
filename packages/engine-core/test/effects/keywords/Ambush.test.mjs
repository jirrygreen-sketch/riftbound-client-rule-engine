import assert from "node:assert/strict";
import test from "node:test";
import { EFFECT_IR_V2_RULESET, validateCardProgram } from "@riftbound/card-dsl";
import ambush from "../../../dist/effects/keywords/Ambush.js";
import { keywordDefinitionsById } from "../../../dist/effects/keywords/registry.generated.js";

const HOST = { canonicalCardId: "test-ambush-unit" };

const program = abilities => ({
  canonicalCardId: HOST.canonicalCardId,
  rulesetVersion: EFFECT_IR_V2_RULESET,
  status: "executable",
  abilities,
  sourceText: "[Ambush]"
});

test("Ambush metadata identifies its v1.5 definition and redundant stacking", () => {
  assert.equal(ambush.keyword, "Ambush");
  assert.equal(ambush.valued, false);
  assert.equal(ambush.stacking, "single");
  for (const ref of ["822", "822.1", "822.1.b", "822.1.c", "822.2", "822.3", "822.3.a", "822.4"]) {
    assert.ok(ambush.ruleRefs.includes(ref), `missing rule reference ${ref}`);
  }
});

test("Ambush expands to a hand play-location permission for a friendly occupied battlefield", () => {
  const abilities = ambush.expand({ host: HOST });
  assert.equal(abilities.length, 2);
  assert.deepEqual(abilities[0], {
    kind: "static",
    effect: {
      kind: "play-location-permission",
      value: {
        kind: "constant",
        value: {
          zone: "battlefield",
          battlefield: { occupied: true, controller: "controller" },
          appliesTo: "self"
        }
      },
      duration: "while-in-hand"
    }
  });
});

test("Ambush expands its conditional Reaction permission as continuous.timing", () => {
  const [, timing] = ambush.expand({ host: HOST });
  assert.equal(timing.kind, "static");
  assert.equal(timing.effect.kind, "continuous.timing");
  assert.deepEqual(timing.effect.grants, ["showdown", "closed-state"]);
  assert.deepEqual(timing.effect.appliesTo, ["card"]);
  assert.deepEqual(timing.effect.location, {
    zone: "battlefield",
    battlefield: { occupied: true, controller: "controller" },
    appliesTo: "self"
  });
});

test("Ambush expansion validates as a minimal executable CardProgram", () => {
  const result = validateCardProgram(program(ambush.expand({ host: HOST })));
  assert.equal(result.ok, true, JSON.stringify(result.issues));
  assert.deepEqual(result.issues, []);
});

test("Ambush is unvalued and ignores accidental numeric values and host ids", () => {
  const base = ambush.expand({ host: HOST });
  assert.deepEqual(ambush.expand({ value: 0, host: HOST }), base);
  assert.deepEqual(ambush.expand({ value: Number.MAX_SAFE_INTEGER, host: HOST }), base);
  assert.deepEqual(ambush.expand({ host: { canonicalCardId: "other-unit" } }), base);
});

test("Ambush duplicate instances collapse to one permission under single stacking", () => {
  const first = ambush.expand({ host: HOST });
  const second = ambush.expand({ host: HOST });
  assert.equal(ambush.stacking, "single");
  const merged = ambush.stacking === "single" ? first : [...first, ...second];
  assert.equal(merged.length, 2);
  assert.deepEqual(merged, second);
  assert.equal(validateCardProgram(program(merged)).ok, true);
});

test("Ambush expansion has no instructions or independent chain flow", () => {
  for (const ability of ambush.expand({ host: HOST })) {
    assert.equal(ability.kind, "static");
    assert.equal("body" in ability, false);
    assert.equal("trigger" in ability, false);
    assert.equal("with" in ability, false);
  }
});

test("Ambush is present in the generated keyword registry", () => {
  assert.equal(keywordDefinitionsById.get("Ambush"), ambush);
});
