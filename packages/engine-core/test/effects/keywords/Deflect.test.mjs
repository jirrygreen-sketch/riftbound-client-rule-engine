import assert from "node:assert/strict";
import test from "node:test";
import { EFFECT_IR_V2_RULESET, validateCardProgram } from "@riftbound/card-dsl";
import Deflect from "../../../src/effects/keywords/Deflect.ts";

const host = { canonicalCardId: "card.deflect.test" };
const program = (abilities) => ({
  canonicalCardId: host.canonicalCardId,
  rulesetVersion: EFFECT_IR_V2_RULESET,
  status: "executable",
  abilities,
  sourceText: "[Deflect]"
});

test("Deflect declares its printed keyword metadata", () => {
  assert.equal(Deflect.keyword, "Deflect");
  assert.equal(Deflect.valued, true);
  assert.equal(Deflect.stacking, "sum");
  assert.ok(Deflect.ruleRefs.includes("809.1"));
  assert.ok(Deflect.ruleRefs.includes("809.1.c"));
  assert.ok(Deflect.ruleRefs.includes("809.2"));
});

test("Deflect defaults an omitted value to one", () => {
  assert.deepEqual(Deflect.expand({ host }), [{
    kind: "static",
    effect: {
      kind: "target.tax",
      value: { kind: "constant", value: 1 }
    }
  }]);
});

test("Deflect preserves an explicit zero value", () => {
  const [ability] = Deflect.expand({ host, value: 0 });
  assert.equal(ability.effect.value.value, 0);
});

test("Deflect preserves a large finite value", () => {
  const value = Number.MAX_SAFE_INTEGER;
  const [ability] = Deflect.expand({ host, value });
  assert.equal(ability.effect.value.value, value);
});

test("Deflect stacking is represented by one summed expansion", () => {
  const [ability] = Deflect.expand({ host, value: 5 });
  assert.equal(Deflect.stacking, "sum");
  assert.equal(ability.effect.kind, "target.tax");
  assert.equal(ability.effect.value.value, 5);
});

test("Deflect expansion is a valid executable CardProgram", () => {
  const abilities = Deflect.expand({ host, value: 2 });
  const result = validateCardProgram(program(abilities));
  assert.equal(result.ok, true, JSON.stringify(result));
});
