import assert from "node:assert/strict";
import test from "node:test";
import { EFFECT_IR_V2_RULESET, validateCardProgram } from "@riftbound/card-dsl";
import Hidden from "../../../src/effects/keywords/Hidden.ts";

const host = { canonicalCardId: "card.hidden.test" };
const program = (abilities) => ({
  canonicalCardId: host.canonicalCardId,
  rulesetVersion: EFFECT_IR_V2_RULESET,
  status: "executable",
  abilities,
  sourceText: "[Hidden]"
});

test("Hidden declares its keyword metadata and rule coverage", () => {
  assert.equal(Hidden.keyword, "Hidden");
  assert.equal(Hidden.valued, false);
  assert.equal(Hidden.stacking, "single");
  assert.ok(Hidden.ruleRefs.includes("811.1"));
  assert.ok(Hidden.ruleRefs.includes("811.1.b"));
  assert.ok(Hidden.ruleRefs.includes("811.1.d.1.a"));
  assert.ok(Hidden.ruleRefs.includes("811.6"));
});

test("Hidden expands to one static hidden-cost ability", () => {
  assert.deepEqual(Hidden.expand({ host }), [{
    kind: "static",
    effect: { kind: "cost.hidden" }
  }]);
});

test("Hidden has no numeric payload", () => {
  const [ability] = Hidden.expand({ host, value: 99 });
  assert.equal(ability.kind, "static");
  assert.equal(ability.effect.kind, "cost.hidden");
  assert.equal("value" in ability.effect, false);
});

test("Hidden repeated instances remain one permission", () => {
  const first = Hidden.expand({ host });
  const second = Hidden.expand({ host });
  assert.equal(Hidden.stacking, "single");
  assert.deepEqual(second, first);
  assert.equal(first.length, 1);
});

test("Hidden expansion is independent between calls", () => {
  const first = Hidden.expand({ host });
  const second = Hidden.expand({ host });
  assert.notEqual(first, second);
  assert.notEqual(first[0], second[0]);
  assert.notEqual(first[0].effect, second[0].effect);
});

test("Hidden expansion is a valid executable CardProgram", () => {
  const result = validateCardProgram(program(Hidden.expand({ host })));
  assert.equal(result.ok, true, JSON.stringify(result));
});
