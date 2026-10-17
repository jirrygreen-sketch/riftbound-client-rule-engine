import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/forbidding-waste.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
const CANONICAL = "card.hash-62355f7fd2699dda34a1601a315ab1ee9095ff67da700d49567b54955780324f";
const SOURCE_TEXT =
  "While a unit here is defending alone, it has -2 :rb_might:. " +
  "(It's alone if there are no other friendly units here.)";

const [ability] = program.abilities;
const [defending, alone] = ability.condition.conditions;

test("unl-210-219 Forbidding Waste: program passes validateCardProgram and is registered", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.equal(cardRegistryById.get(program.canonicalCardId), program);
});

test("unl-210-219 Forbidding Waste: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  // All three gaps survived the dependency merge: no card-static -> layer
  // registration, no sameLocationAs anchor in the layer filter, and no
  // evaluation of the defending/alone conditions.
  assert.match(program.judgeReason, /sameLocationAs/);
  assert.match(program.judgeReason, /combatRole/);
  assert.match(program.judgeReason, /bindStatic/);
  assert.match(program.judgeReason, /RIFT-257/);
});

test("unl-210-219 Forbidding Waste: one static arithmetic -2 Might for units here", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "static");

  // 479.4/479.4.e.1: a Might reduction is an arithmetic-layer effect; the
  // merged engine applies increases before decreases.
  assert.equal(ability.effect.kind, "continuous.might");
  assert.equal(ability.effect.mode, "add");
  assert.equal(ability.effect.layer, "arithmetic");
  assert.deepEqual(ability.effect.amount, { kind: "constant", value: -2 });

  // 053.3/199.1: "here" is this Battlefield; the layer filter does not
  // implement the anchor (the judged gap).
  assert.deepEqual(ability.effect.filter, {
    type: "unit",
    zone: "board",
    sameLocationAs: "self"
  });
});

test("unl-210-219 Forbidding Waste: the conditional passive gate is defending + alone", () => {
  // 364.3/364.3.a: "While …" is a Conditional Passive Ability.
  assert.equal(ability.condition.kind, "all");
  assert.equal(ability.condition.conditions.length, 2);

  // 814.1.d/466.2.c.3: the unit holds the Defender designation during Combat;
  // the merged combat flow never sets contract §3.8’s combatRole.
  assert.deepEqual(defending, {
    kind: "expression",
    value: { kind: "constant", value: "self-is-defending" }
  });

  // 740.2.a: alone = no other friendly units at the same location. The
  // parenthetical only restates the definition (135.2.b).
  assert.equal(alone.kind, "compare");
  assert.equal(alone.operator, "eq");
  assert.deepEqual(alone.right, { kind: "constant", value: 0 });
  assert.equal(alone.left.kind, "count");
  assert.equal(alone.left.subject, "other-friendly-units-here");
  assert.deepEqual(alone.left.filter, {
    type: "unit",
    zone: "board",
    controller: "self",
    sameLocationAs: "self",
    exclude: "self"
  });
});

test.todo(
  "unl-210-219 Forbidding Waste: register the static ability as a ContinuousEffectSpec — " +
    "programs/statics.ts only exposes the bindStatic callback seam and registerContinuousEffect has no " +
    "production caller (RIFT-257 / RIFT-91 follow-up)"
);

test.todo(
  "unl-210-219 Forbidding Waste: make the layer engine evaluate the 740.2.a alone predicate and the " +
    "053.3 sameLocationAs anchor (RIFT-91 follow-up; layers/engine.ts conditionMatches currently returns " +
    "true for compare and the layer filter reads no location anchors)"
);

test.todo(
  "unl-210-219 Forbidding Waste: add the Defender designation/combatRole characteristic (contract §3.8) " +
    "and wire it from combat so 814.1.d's 'is defending' can be evaluated — the merged combat flow never " +
    "sets combatRole (RIFT-124 follow-up)"
);
