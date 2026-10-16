import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/ogn/wielder-of-water.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";

const CANONICAL =
  "card.hash-2cbbc0b067da2370a522b50188aead6aa06a594259be55b5951e6f51601e59ef";
const SOURCE_TEXT = "While I'm attacking or defending alone, I have +2 :rb_might:.";

const [staticAbility] = program.abilities;

test("ogn-055-298 Wielder of Water: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues, null, 2));
});

test("ogn-055-298 Wielder of Water: identity, ruleset, status, judgeReason and source text", () => {
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /continuous\.might/);
  assert.match(program.judgeReason, /combatRole/);
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(program.canonicalCardId), program);
});

test("ogn-055-298 Wielder of Water: the +2 Might is a static arithmetic-layer effect on self", () => {
  // 364.3/364.3.a: a Conditional Passive Ability; 365.1: active while on the
  // Board. The effect never enters the chain (contract 3.4).
  assert.equal(program.abilities.length, 1);
  assert.equal(staticAbility.kind, "static");
  assert.equal(staticAbility.effect.kind, "continuous.might");
  assert.equal(staticAbility.effect.mode, "add");
  assert.equal(staticAbility.effect.layer, "arithmetic");
  assert.equal(staticAbility.effect.appliesTo, "self");
  assert.deepEqual(staticAbility.effect.amount, { kind: "constant", value: 2 });
  assert.equal(staticAbility.effect.value, undefined);
});

test("ogn-055-298 Wielder of Water: the condition is combat role plus the lone predicate", () => {
  const condition = staticAbility.condition;
  assert.equal(condition.kind, "all");
  assert.equal(condition.conditions.length, 2);

  // "I'm attacking or defending": the merged IR has no designation field
  // (contract 3.8 combatRole); the program states the predicate it needs.
  const combat = condition.conditions[0];
  assert.equal(combat.kind, "expression");
  assert.deepEqual(combat.value, {
    kind: "constant",
    value: "self-in-combat-as-attacker-or-defender"
  });

  // "alone" (740.2.a): no other friendly unit at the same location.
  const lone = condition.conditions[1];
  assert.equal(lone.kind, "compare");
  assert.equal(lone.operator, "eq");
  assert.deepEqual(lone.right, { kind: "constant", value: 0 });
  assert.equal(lone.left.kind, "count");
  assert.deepEqual(lone.left.filter, {
    type: "unit",
    controller: "self",
    sameLocationAs: "self",
    exclude: "self"
  });
});

test.todo(
  "ogn-055-298 Wielder of Water: the conditional +2 Might needs a merged layers consumer for " +
    "continuous.might with a card-program registration path; contract 3.6's closed GameAction " +
    "set has no might-modification action and effect.buff is the single +1 Buff counter " +
    "(702.3/703) — RIFT-91 layers-continuous"
);

test.todo(
  "ogn-055-298 Wielder of Water: the 'attacking or defending' half needs the combat designation " +
    "on ObjectSnapshot (contract 3.8 combatRole); engine-core's effects/contract.ts has no such " +
    "field yet, and the layers engine evaluates no compare condition"
);

test.todo(
  "ogn-055-298 Wielder of Water: the 'alone' predicate (740.2.a, no other friendly unit at the " +
    "same location) has no merged evaluator: the layers filter resolves type/zone/controller/tag " +
    "and characteristics, and sameLocationAs anchors are resolved by the interpreter, not by the " +
    "static-effect layer path"
);

test.todo(
  "ogn-055-298 Wielder of Water: no merged code turns a card program's static ability into a " +
    "registered continuous layer effect (no addContinuous caller in the card-program path)"
);
