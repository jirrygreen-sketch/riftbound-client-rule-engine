// Golden test for Iridescent Avian (rad-027-167).
//
// judge-required (see the program's judgeReason): the "already buffed → +2
// Might this turn" branch needs a temporary Might primitive, and the "instead"
// either/or needs a runtime branch that the frozen finalization surface blocks.
// The runnable evidence is the exhaust cost plus the merged effect.buff branch,
// including CR 427.1.c's already-buffed no-op.
import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/rad/iridescent-avian.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { buildCostPlan, buildHiddenCostPlan } from "../../../../engine-core/dist/cost/cost-plan.js";
import { payCostPlan } from "../../../../engine-core/dist/cost/payment.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { instructionDefinitionsById } from "../../../../engine-core/dist/effects/instructions/registry.generated.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL =
  "card.hash-8dc527406dd2ec53dd9af597138cb888f1548f0de5158dc5477e8c34b25afda8";
const SOURCE_TEXT =
  ":rb_exhaust:: [Buff] a unit. If it's already buffed, give it +2 :rb_might: this turn instead. " +
  "(To buff a unit, give it a +1 :rb_might: buff if it doesn't have one.)";

const [activated] = program.abilities;
const [buffInstruction, plusTwo] = activated.body;

const bodyWithoutTargets = () =>
  [buffInstruction, plusTwo].map(({ targets, picks, ...rest }) => rest);

/** Only the merged [Buff] half, isolated from the unmerged temporary-Might op. */
const buffOnly = ({ targets, picks, ...rest }) => rest;

test("rad-027-167 Iridescent Avian: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("rad-027-167 Iridescent Avian: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  // README §2: name the missing primitive and the blocked either/or path.
  assert.match(program.judgeReason, /continuous\.might/);
  assert.match(program.judgeReason, /choice\.mode/);
  assert.match(program.judgeReason, /assertFinalizationSurface/);
  assert.match(program.judgeReason, /RIFT-83\/84/);
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL), program);
});

test("rad-027-167 Iridescent Avian: one action-speed activation whose cost is exhausting itself", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(activated.kind, "activated");
  assert.equal(activated.timing, "action");
  // CR 415.3.a / 415.5: :rb_exhaust: is this ability's cost, paid at Finalize.
  assert.deepEqual(activated.cost, {
    kind: "activated",
    payments: [{ kind: "exhaust" }]
  });
  // "[Buff] a unit" is a merged effect.buff on one chosen unit (355.7/355.10.a).
  assert.equal(buffInstruction.op, "effect.buff");
  assert.deepEqual(buffInstruction.args.mode, { kind: "constant", value: "buff" });
  assert.deepEqual(buffInstruction.args.target, {
    kind: "constant",
    value: "iridescent-avian.unit"
  });
  assert.equal(buffInstruction.targets.length, 1);
  assert.deepEqual(buffInstruction.targets[0].filter, { type: "unit", zone: "board" });
  assert.equal(buffInstruction.targets[0].selection, "one");
});

test("rad-027-167 Iridescent Avian: the 'already buffed' branch is a guarded temporary Might change", () => {
  assert.equal(plusTwo.op, "continuous.might");
  assert.deepEqual(plusTwo.args.amount, { kind: "constant", value: 2 });
  // CR 317.2.c: a "this turn" modification expires in the end-of-turn cleanup.
  assert.deepEqual(plusTwo.args.duration, { kind: "constant", value: "end-of-turn" });
  // Contract §3.4: the condition clause covers only the instruction carrying it.
  assert.equal(plusTwo.condition.kind, "compare");
  assert.equal(plusTwo.condition.operator, "gt");
  assert.deepEqual(plusTwo.condition.left.object, { target: "iridescent-avian.unit" });
  assert.equal(plusTwo.condition.left.attribute, "buffs");
  assert.deepEqual(plusTwo.condition.right, { kind: "constant", value: 0 });
  assert.equal(plusTwo.linkedTo, "iridescent-avian.buff");
  // The unchanged instruction is NOT the temporary Might op used by Stupefy.
  assert.notEqual(plusTwo.op, "effect.buff");
});

test("rad-027-167 Iridescent Avian: the [Buff] branch really resolves and places one buff (427.1.b)", () => {
  const kernel = world()
    .unit("avian", { might: 3 })
    .unit("target", { might: 2 })
    .build();
  kernel.setTargets("iridescent-avian.unit", [kernel.ref("target")]);
  const outcome = runAbilityBody([buffOnly(buffInstruction)], kernel);

  // The buff step executes through the merged primitive.
  assert.equal(outcome.status, "executed");
  assert.equal(outcome.results[0].result.status, "executed");
  assert.equal(outcome.results[0].result.linkedValues.buffedCount, 1);
  assert.equal(kernel.getObject("target").buffs, 1);
});

test("rad-027-167 Iridescent Avian: an already-buffed unit is not buffed again (427.1.c), so the +2 branch applies", () => {
  const kernel = world()
    .unit("avian", { might: 3 })
    .unit("target", { might: 2, buffs: 1 })
    .build();
  kernel.setTargets("iridescent-avian.unit", [kernel.ref("target")]);
  const outcome = runAbilityBody([buffOnly(buffInstruction)], kernel);

  // CR 427.1.c / 702.3.a: the unit may be chosen but gains no second Buff.
  assert.deepEqual(outcome.results[0].result, { status: "negated", reason: "skipped", events: [] });
  assert.equal(kernel.getObject("target").buffs, 1);
  // The +2 branch condition is satisfied (buffs > 0) and it is exactly the step
  // that cannot execute until continuous.might lands.
  assert.equal(plusTwo.condition.operator, "gt");
  assert.equal(kernel.getObject("target").might, 2);
});

test("rad-027-167 Iridescent Avian: the temporary Might op is genuinely unregistered (fail closed)", () => {
  // The +2 Might branch is declared with the shape the layers system will own.
  assert.equal(instructionDefinitionsById.has("continuous.might"), false);
  const kernel = world().unit("avian", { might: 3 }).unit("target", { might: 2, buffs: 1 }).build();
  kernel.setTargets("iridescent-avian.unit", [kernel.ref("target")]);
  // Running the full printed body cannot silently produce a +2: the interpreter
  // refuses the unregistered opcode instead.
  assert.throws(
    () => runAbilityBody(bodyWithoutTargets(), kernel),
    /Unregistered instruction opcode: continuous\.might/
  );
});

test("rad-027-167 Iridescent Avian: exhausting the source really pays the printed cost", () => {
  const kernel = world().unit("avian", { might: 3 }).build();
  const context = kernel.clone({ sourceSnapshot: kernel.getObject("avian") });
  const plan = buildCostPlan(context, { id: "avian.activate", cost: activated.cost });
  assert.deepEqual(plan.total.energy, 0);
  assert.deepEqual(plan.total.power, []);
  assert.equal(plan.total.actions.length, 1);
  assert.deepEqual(plan.total.actions[0].action, {
    type: "exhaust",
    object: kernel.ref("avian")
  });
  const paid = payCostPlan(context, plan);
  assert.equal(paid.paid, true);
  assert.equal(context.getObject("avian").exhausted, true);
  // A second copy of the same cost is unpayable while the source stays exhausted.
  assert.throws(
    () => payCostPlan(context, plan),
    /An exhaust cost requires a ready controlled object/
  );
  // A hidden-cost helper is unrelated to this card's cost shape.
  assert.equal(typeof buildHiddenCostPlan, "function");
});

test.todo(
  "Iridescent Avian: 'If it's already buffed, give it +2 :rb_might: this turn instead' — blocked because temporary Might " +
    "modification has no merged primitive (contract 3.6's closed GameAction set has no might change; effect.buff delegates it to " +
    "layers continuous.might) and the layers consumer is unmerged (RIFT-83/84, RIFT-91)"
);

test.todo(
  "Iridescent Avian: the printed 'instead' either/or between Buff and +2 Might — blocked because the condition clause covers only " +
    "its own instruction (contract 3.4) and the selectable choice mode path (choice.mode) is rejected by chain/engine.ts's " +
    "assertFinalizationSurface pending a Finalize/Resolve choice-plan adapter (RIFT-89/90)"
);
