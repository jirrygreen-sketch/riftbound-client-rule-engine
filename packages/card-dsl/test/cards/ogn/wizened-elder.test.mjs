import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/ogn/wizened-elder.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";

const CANONICAL =
  "card.hash-16335e499c8dc3283d678e27bfe613e02ef16a6babfe209f953b1959c52fd375";
const SOURCE_TEXT = "While I'm buffed, I have an additional +1 :rb_might:.";

const [staticAbility] = program.abilities;

test("ogn-065-298 Wizened Elder: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues, null, 2));
});

test("ogn-065-298 Wizened Elder: identity, ruleset, status, judgeReason and source text", () => {
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /702\.2\.a/);
  assert.match(program.judgeReason, /continuous\.might|continuous Might/);
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(program.canonicalCardId), program);
});

test("ogn-065-298 Wizened Elder: the additional +1 is a static arithmetic effect on self", () => {
  // 364.3/364.3.a: Conditional Passive Ability; 365.1: active while on Board.
  assert.equal(program.abilities.length, 1);
  assert.equal(staticAbility.kind, "static");
  assert.equal(staticAbility.effect.kind, "continuous.might");
  assert.equal(staticAbility.effect.mode, "add");
  assert.equal(staticAbility.effect.layer, "arithmetic");
  assert.equal(staticAbility.effect.appliesTo, "self");
  assert.deepEqual(staticAbility.effect.amount, { kind: "constant", value: 1 });
});

test("ogn-065-298 Wizened Elder: the condition is the buffed predicate, not a Buff counter", () => {
  // 702.2.a: a unit is Buffed for as long as the buff remains on it. The
  // printed +1 is a separate Might increase on top of the Buff's own +1 (703).
  const condition = staticAbility.condition;
  assert.deepEqual(condition, {
    kind: "expression",
    value: { kind: "constant", value: "self-is-buffed" }
  });
});

test("ogn-065-298 Wizened Elder: the program does not model the +1 as a second Buff counter", () => {
  // 702.3: there can only be one Buff on a Unit at a time; 703: each Buff
  // contributes +1 Might. Adding a Buff would be both illegal and a different
  // effect, so the program must not declare an effect.buff instruction.
  // A static ability carries data for the layers consumer and never carries
  // instructions, so assert that no instruction-shaped fields exist.
  assert.equal(program.abilities.length, 1);
  for (const ability of program.abilities) {
    assert.equal(ability.kind, "static");
    assert.equal(ability.effect.kind, "continuous.might");
    assert.equal("op" in ability.effect, false);
    assert.equal("args" in ability.effect, false);
    assert.equal("body" in ability, false);
    assert.equal("trigger" in ability, false);
  }
  // The condition is the named buffed predicate; it never asks the engine to
  // place or spend a Buff counter.
  assert.deepEqual(staticAbility.condition, {
    kind: "expression",
    value: { kind: "constant", value: "self-is-buffed" }
  });
});

test.todo(
  "ogn-065-298 Wizened Elder: the conditional +1 Might needs a merged layers consumer for " +
    "continuous.might plus a card-program registration path (contract 3.6 has no " +
    "might-modification GameAction; effect.buff only places/removes the Buff counter) — " +
    "RIFT-91 layers-continuous"
);

test.todo(
  "ogn-065-298 Wizened Elder: the 'while I'm buffed' predicate (702.2.a) has no merged " +
    "evaluator: layers engine conditionMatches resolves only always/never/type/has-tag/" +
    "has-keyword, and the object filter matcher has no buffed key"
);

test.todo(
  "ogn-065-298 Wizened Elder: no merged code turns a card program's static ability into a " +
    "registered continuous layer effect, so this aura is never evaluated in production"
);
