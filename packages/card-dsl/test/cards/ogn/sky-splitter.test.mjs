import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ogn/sky-splitter.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const [speed, costModifier, play] = program.abilities;
const damageInstruction = play.body[0];
const targetSpec = damageInstruction.targets[0];

test("Sky Splitter program is valid EffectIR v2 data and judge-required", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(program.status, "judge-required");
  // The reason must name the real gaps: no card-declarable discount consumer and
  // no max-aggregate expression.
  assert.match(program.judgeReason, /CostPlanInput\.discounts|readCost/);
  assert.match(program.judgeReason, /356\.4/);
  assert.match(program.judgeReason, /聚合|aggregate/);
});

test("Sky Splitter identity, status and sourceText match the printing", () => {
  assert.equal(
    program.canonicalCardId,
    "card.hash-94735882304ffe96826dd127aea87fdfaac6f979e3b075524de966b982a9c89f"
  );
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(
    program.sourceText,
    "[Action] (Play on your turn or in showdowns.)\n" +
      "This spell's Energy cost is reduced by the highest Might among units you control.\n" +
      "Deal 5 to a unit at a battlefield."
  );
});

test("Sky Splitter structure: [Action], a descriptive cost reduction, one 5-damage target", () => {
  assert.deepEqual(speed, { kind: "keyword", keyword: "action" });

  // "This spell's Energy cost is reduced by ..." is declared as the cost
  // modification shape (356.4.b) with a descriptive amount, because no merged
  // expression kind can express a maximum over a filtered set.
  assert.equal(costModifier.kind, "static");
  assert.equal(costModifier.effect.kind, "cost.modify");
  assert.equal(costModifier.effect.resource, "energy");
  assert.equal(costModifier.effect.component, "total");
  assert.equal(costModifier.effect.appliesTo, "self");
  assert.equal(costModifier.effect.amount.kind, "aggregate");
  assert.equal(costModifier.effect.amount.operator, "max");
  assert.equal(costModifier.effect.amount.property, "might");
  assert.deepEqual(costModifier.effect.amount.filter, {
    type: "unit",
    zone: "board",
    controller: "controller"
  });

  // The printed cost (8 Energy + 1 Fury power) is unchanged by the discount
  // (206 / 204.1); the discount only lowers the amount actually paid.
  assert.deepEqual(play.cost, {
    kind: "cost.printed",
    energy: { kind: "constant", value: 8 },
    power: { kind: "constant", value: 1 }
  });

  assert.deepEqual(
    play.body.map(instruction => [instruction.id, instruction.op]),
    [["sky-splitter.deal-5", "effect.damage"]]
  );
  assert.deepEqual(damageInstruction.args.amount, { kind: "constant", value: 5 });
  assert.deepEqual(damageInstruction.args.target, {
    kind: "constant",
    value: "sky-splitter.unit-at-battlefield"
  });
  assert.equal(damageInstruction.linkedTo, undefined);
  assert.equal(damageInstruction.targets.length, 1);
  assert.equal(targetSpec.id, "sky-splitter.unit-at-battlefield");
  assert.deepEqual(targetSpec.filter, { type: "unit", zone: "board" });
  assert.deepEqual(targetSpec.location, { type: "battlefield" });
  assert.equal(targetSpec.min, 1);
  assert.equal(targetSpec.max, 1);
  assert.equal(targetSpec.selection, "one");
});

test("Sky Splitter golden execution: the damage half deals exactly 5 to the locked unit", () => {
  // A 7-Might friendly unit is on the board, which is the 356.4.e example's
  // discount source; the damage clause itself does not depend on it.
  const kernel = world()
    .unit("seven-might-unit", { owner: "A", might: 7 })
    .unit("enemy-at-battlefield", { owner: "B", might: 9 })
    .build();
  kernel.setTargets("sky-splitter.unit-at-battlefield", [kernel.ref("enemy-at-battlefield")]);

  const outcome = resolveChainBody(play.body, kernel);

  assert.equal(outcome.status, "executed");
  assert.equal(outcome.results[0].result.status, "executed");
  assert.equal(outcome.results[0].result.linkedValues.dealt, 5);
  assert.equal(kernel.getObject("enemy-at-battlefield").damage, 5);
});

test("Sky Splitter golden execution: a stale target is ignored and the cost clause stays inert", () => {
  const kernel = world().unit("enemy-at-battlefield", { owner: "B", might: 9 }).build();
  const stale = kernel.ref("enemy-at-battlefield");
  kernel.perform({ type: "move-zone", object: stale, to: "hand" });
  kernel.setTargets("sky-splitter.unit-at-battlefield", [stale]);

  const outcome = resolveChainBody(play.body, kernel);

  assert.equal(outcome.status, "partial");
  assert.deepEqual(outcome.results[0].result, { status: "ignored", reason: "mistargeted" });
  assert.equal(kernel.getObject("enemy-at-battlefield").damage, 0);
});

test.todo(
  "Sky Splitter: applying the printed-cost discount at Finalize needs a " +
    "card-declarable discounts entry in the cost plan (RIFT-89; the merged " +
    "applyDiscount only accepts caller-supplied CostPlanInput.discounts) and a " +
    "max-aggregate expression over a filtered set, so the 8 Energy cost can drop " +
    "by the highest Might among the controller's units."
);

test.todo(
  "Sky Splitter: 356.4.e ordering and minimum semantics (a discount's own " +
    "minimum binds only that discount and other discounts may still reach 0) " +
    "belong to the same merged cost-plan consumer."
);
