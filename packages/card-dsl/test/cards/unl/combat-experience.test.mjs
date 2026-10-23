import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/combat-experience.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { createLayerEngine } from "../../../../engine-core/dist/layers/index.js";
import might from "../../../../engine-core/dist/effects/instructions/continuous.might.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

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
  // The current gap is the missing default dispatch for the new player-state
  // expression, refreshed 2026-10-18.
  assert.match(program.judgeReason, /player-property/);
  assert.match(program.judgeReason, /expr-ext\/evaluate\.ts/);
  assert.match(program.judgeReason, /Unsupported expression/);
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
  assert.deepEqual(plusOne.args.objects, {
    kind: "constant",
    value: { kind: "target", id: "combat-experience.unit" }
  });
  assert.deepEqual(plusThreeInstead.args.objects, plusOne.args.objects);
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
  assert.deepEqual(plusThreeInstead.condition.left, {
    kind: "player-property",
    player: "controller",
    property: "xp"
  });
  assert.equal(plusOne.linkedTo, undefined);
  assert.equal(plusThreeInstead.linkedTo, undefined);
});

test("unl-031-219 Combat Experience golden: the non-Level branch registers +1 Might until turn end", () => {
  // The default card-program condition path remains blocked by the XP gate;
  // execute the merged continuous.might primitive directly to retain evidence
  // for the printed +1 branch without bypassing that gate.
  const kernel = world().unit("unit", { owner: "A", controller: "A", might: 4 }).build();
  const outcome = runInstruction(might, plusOne.args, {
    world: kernel,
    targets: { "combat-experience.unit": [kernel.ref("unit")] }
  });
  assert.equal(outcome.result.status, "executed");
  assert.equal(kernel.continuousEffects.length, 1);
  assert.equal(kernel.continuousEffects[0].effect.effect.kind, "continuous.might");
  assert.equal(kernel.continuousEffects[0].effect.effect.amount, 1);
  assert.deepEqual(kernel.continuousEffects[0].duration, { type: "end-of-turn" });
  const engine = createLayerEngine(kernel.objects, kernel.continuousEffects.map(entry => ({
    effect: entry.effect,
    duration: entry.duration,
    timestamp: 1
  })));
  assert.equal(engine.evaluate(kernel.ref("unit")).might, 5);
  assert.equal(engine.expireAt("turn-end").length, 1);
  assert.equal(engine.evaluate(kernel.ref("unit")).might, 4);
});

test("unl-031-219 Combat Experience golden: the production predicate reads controller XP", () => {
  for (const [xp, expected] of [[0, false], [5, false], [6, true], [10, true]]) {
    const kernel = world().player("A", { xp }).unit("unit", { might: 4 }).build();
    const scoped = kernel.clone({ sourceSnapshot: kernel.getObject("unit"), controller: "A" });
    const outcome = resolveChainBody([{
      id: "check-level-six",
      op: "condition.predicate",
      args: { condition: { kind: "constant", value: plusThreeInstead.condition } }
    }], scoped);
    assert.equal(outcome.status, "executed");
    assert.equal(outcome.linkedValues["check-level-six.value"], expected);
  }
});


test("unl-031-219 Combat Experience golden: the printed +3 primitive modifies Might and expires without adding a Buff", () => {
  // This proves the Level branch's primitive only; live XP gating remains a TODO.
  const kernel = world().unit("unit", { might: 4 }).build();
  const run = runInstruction(might, plusThreeInstead.args, {
    world: kernel,
    targets: { "combat-experience.unit": [kernel.ref("unit")] }
  });
  assert.equal(run.result.status, "executed");
  assert.equal(kernel.continuousEffects.length, 1);
  assert.equal(kernel.getObject("unit").buffs, 0);
  assert.deepEqual(run.events, []);
  const layers = createLayerEngine(kernel.objects, kernel.continuousEffects.map(entry => ({
    effect: entry.effect, duration: entry.duration, timestamp: 1
  })));
  assert.equal(layers.evaluate(kernel.ref("unit")).might, 7);
  assert.equal(layers.expireAt("turn-end").length, 1);
  assert.equal(layers.evaluate(kernel.ref("unit")).might, 4);
});
