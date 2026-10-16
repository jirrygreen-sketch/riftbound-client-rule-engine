import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/combat-experience.js";

const CANONICAL_ID =
  "card.hash-9e75e74352d500dfa1b7c1192957a26c7b4c5e2cc9471eb6057e9d0147ebf803";
const SOURCE_TEXT =
  "[Reaction] (Play any time, even before spells and abilities resolve.)\n" +
  "Give a unit +1 :rb_might: this turn.\n" +
  "[Level 6][>] Give it +3 :rb_might: this turn instead. (While you have 6+ XP, get the effect.)";

const [reaction, play] = program.abilities;
const [plusOne, plusThreeInstead] = play.body;

test("unl-031-219 Combat Experience: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("unl-031-219 Combat Experience: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /continuous\.might/);
  assert.match(program.judgeReason, /824\.1/);
  assert.match(program.judgeReason, /XP/);
  assert.match(program.judgeReason, /Buff/);
});

test("unl-031-219 Combat Experience: [Reaction] plus the +1/+3 instead branches on one chosen unit", () => {
  assert.deepEqual(reaction, { kind: "keyword", keyword: "reaction" });
  // Printed 1 Energy and no printed Power value (catalog power: null).
  assert.deepEqual(play.cost, {
    kind: "cost.printed",
    energy: { kind: "constant", value: 1 }
  });
  assert.equal(Object.hasOwn(play.cost, "power"), false);
  assert.deepEqual(play.body.map(instruction => [instruction.id, instruction.op]), [
    ["combat-experience.give-plus-1", "continuous.might"],
    ["combat-experience.give-plus-3-instead", "continuous.might"]
  ]);

  // Both branches are temporary Might modifications (143.2.a / 317.2.c), never Buff counters.
  assert.deepEqual(plusOne.args.amount, { kind: "constant", value: 1 });
  assert.deepEqual(plusThreeInstead.args.amount, { kind: "constant", value: 3 });
  assert.deepEqual(plusOne.args.duration, { kind: "constant", value: "this-turn" });
  assert.deepEqual(plusThreeInstead.args.duration, { kind: "constant", value: "this-turn" });
  assert.equal(Object.hasOwn(plusOne.args, "buff"), false);

  // 824.1.c / 824.1.d: the Level 6 gate is the XP threshold; the second branch replaces the
  // first ("instead") and both reference the same TargetSpec ("it", 355.10.c.1).
  assert.deepEqual(plusThreeInstead.targets, plusOne.targets);
  assert.deepEqual(plusOne.targets, [
    {
      id: "combat-experience.unit",
      filter: { type: "unit", zone: "board" },
      min: 1,
      max: 1,
      selection: "one"
    }
  ]);
  assert.deepEqual(plusOne.condition, { kind: "not", condition: plusThreeInstead.condition });
  assert.equal(plusThreeInstead.condition.kind, "compare");
  assert.equal(plusThreeInstead.condition.operator, "gte");
  assert.deepEqual(plusThreeInstead.condition.right, { kind: "constant", value: 6 });
  assert.equal(plusThreeInstead.condition.left.kind, "count");
  assert.equal(plusThreeInstead.condition.left.subject, "controller-xp");
  assert.equal(plusOne.linkedTo, undefined);
  assert.equal(plusThreeInstead.linkedTo, undefined);
});

test.todo("unl-031-219 Combat Experience: apply the temporary Might modification through the arithmetic layer (CR 143.2.a, 317.2.c) — needs the card-side continuous.might entry that calls ResolveContext.addContinuous (RIFT-83/84-family primitive)");
test.todo("unl-031-219 Combat Experience: the [Level 6][>] gate needs an evaluable XP predicate with dynamic Active/Inactive behaviour (CR 824.1.b.1 / 824.1.c / 824.1.d) and the kw-level expansion (RIFT-87/90 family)");
test.todo("unl-031-219 Combat Experience: the [Reaction] continuous.timing permission must admit the card during Closed States (813.1.c / 309.1.a / 159.2.b.3) — RIFT-85 / RIFT-120 follow-up");

