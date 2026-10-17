import assert from "node:assert/strict";
import test from "node:test";
import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../dist/index.js";

const constant = value => ({ kind: "constant", value });
const program = condition => ({
  canonicalCardId: "test.condition-predicates",
  rulesetVersion: EFFECT_IR_V2_RULESET,
  status: "executable",
  sourceText: "synthetic",
  abilities: [{ kind: "play", body: [{ id: "branch", op: "test.gain", args: { amount: constant(1) }, condition }] }]
});

test("EffectIR accepts play-origin, event-printed, and result conditions", () => {
  const conditions = [
    { kind: "played-from-hand", object: "object" },
    { kind: "played-from-zone", object: "object", zone: "trash" },
    {
      kind: "event-printed",
      object: "object",
      characteristic: "power",
      operator: "gte",
      right: constant(2)
    },
    { kind: "result", result: "additional-cost-paid", id: "boost" }
  ];
  for (const condition of conditions) {
    const result = validateCardProgram(program(condition));
    assert.equal(result.ok, true, JSON.stringify(result));
  }
});

test("EffectIR rejects malformed predicate members", () => {
  const invalid = [
    { kind: "played-from-zone", zone: "" },
    { kind: "event-printed", object: "payload", characteristic: "power", operator: "gte", right: constant(2) },
    { kind: "event-printed", object: "object", characteristic: "power", operator: "gte" },
    { kind: "result", result: "additional-cost-paid", operator: "maybe", right: constant(true) },
    { kind: "result", result: "not a symbol" }
  ];
  for (const condition of invalid) {
    const result = validateCardProgram(program(condition));
    assert.equal(result.ok, false, JSON.stringify(condition));
  }
});
