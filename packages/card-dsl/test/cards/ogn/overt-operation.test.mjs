import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import overtOperation from "../../../dist/cards/ogn/overt-operation.js";
import buff from "../../../../engine-core/dist/effects/instructions/effect.buff.js";
import ready from "../../../../engine-core/dist/effects/instructions/effect.ready.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const [speed, play] = overtOperation.abilities;
const [perUnitChoice, buffAll] = play.body;
const [maySpendAndReady] = perUnitChoice.args.body.value;
const [spendBuff, readyUnit] = maySpendAndReady.args.body.value;

test("Overt Operation program is structurally valid and judge-required", () => {
  const result = validateCardProgram(overtOperation);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(overtOperation.status, "judge-required");
  assert.match(overtOperation.judgeReason, /355\.10\.d/);
  assert.match(overtOperation.judgeReason, /effect\.buff/);
  assert.equal(overtOperation.rulesetVersion, "core-1.5");
  assert.equal(
    overtOperation.canonicalCardId,
    "card.hash-2a0e259ebeb4ceb04dc1f72b99b0174e76881f50e0d426f34c74b36057fffb88"
  );
  assert.equal(
    overtOperation.sourceText,
    "[Action] (Play on your turn or in showdowns.)\n" +
      "For each friendly unit, you may spend its buff to ready it. Then buff all friendly units. " +
      "(Each one that doesn't have a buff gets a +1 :rb_might: buff.)"
  );
});

test("Overt Operation structure: [Action] keyword + per-unit optional clause + buff-all clause", () => {
  assert.equal(overtOperation.abilities.length, 2);
  // [Action] (806) is a speed keyword ability expanded by the keyword registry.
  assert.deepEqual(speed, { kind: "keyword", keyword: "action" });
  assert.equal(play.kind, "play");
  assert.deepEqual(play.cost, {
    kind: "cost.printed",
    energy: { kind: "constant", value: 5 },
    power: { kind: "constant", value: 2 }
  });
  assert.deepEqual(
    play.body.map((instruction) => [instruction.id, instruction.op]),
    [
      ["overt-operation.per-unit-choice", "repeat"],
      ["overt-operation.buff-all", "effect.buff"]
    ]
  );

  // "For each friendly unit": the iteration count is the number of friendly
  // units on the board, evaluated at resolution.
  assert.deepEqual(perUnitChoice.args.count, {
    kind: "count",
    subject: "unit",
    filter: { type: "unit", controller: "controller", zone: "board" }
  });
  assert.equal(perUnitChoice.args.body.kind, "constant");

  // "you may spend its buff to ready it": the choice wraps the selected
  // instructions in its body (contract 3.9), never a choice plus linkedTo.
  assert.equal(maySpendAndReady.op, "choice.optional");
  assert.equal(maySpendAndReady.linkedTo, undefined);
  assert.deepEqual(
    maySpendAndReady.args.body.value.map((instruction) => [instruction.id, instruction.op]),
    [
      ["overt-operation.spend-buff", "effect.buff"],
      ["overt-operation.ready-unit", "effect.ready"]
    ]
  );
  assert.deepEqual(spendBuff.args.mode, { kind: "constant", value: "spend" });
  assert.equal(spendBuff.targets[0].id, "overt-operation.friendly-unit");
  assert.equal(spendBuff.targets[0].selection, "one");
  // "spend its buff to ready it": the ready only resolves once the spend
  // actually removed a counter (427.1.c: follow-ups read the per-unit result),
  // so it is guarded by the spend's linked spentCount and not by linkedTo.
  assert.equal(readyUnit.linkedTo, undefined);
  assert.deepEqual(readyUnit.condition, {
    kind: "compare",
    left: {
      kind: "linked-value",
      instructionId: "overt-operation.spend-buff",
      key: "spentCount"
    },
    operator: "gte",
    right: { kind: "constant", value: 1 }
  });
  assert.deepEqual(readyUnit.args.objects, {
    kind: "constant",
    value: { kind: "target", id: "overt-operation.friendly-unit" }
  });
});

test("Overt Operation structure: 'buff all friendly units' declares no TargetSpec", () => {
  // 355.10.d/355.10.d.1: the members of "all friendly units" are selected by
  // their characteristics with no choice ever possible, so they are not
  // targets and must not fire "becomes a target" triggers (355.7, 754).
  assert.equal(buffAll.op, "effect.buff");
  assert.equal(buffAll.targets, undefined);
  assert.equal(buffAll.picks, undefined);
  assert.deepEqual(buffAll.args.mode, { kind: "constant", value: "buff" });
  assert.deepEqual(buffAll.args.objects, {
    kind: "constant",
    value: {
      kind: "query",
      filter: { type: "unit", controller: "controller", zone: "board" }
    }
  });
});

test("Overt Operation golden: spending a buff then readying the same unit", () => {
  const kernel = world().unit("buffed-unit", { owner: "A", buffs: 1, exhausted: true }).build();
  const target = kernel.ref("buffed-unit");
  const spent = runInstruction(
    buff,
    { mode: spendBuff.args.mode.value, target: spendBuff.targets[0].id },
    { world: kernel, targets: { "overt-operation.friendly-unit": [target] } }
  );
  assert.equal(spent.result.status, "executed");
  // CR 702.2.b: one Buff counter is removed.
  assert.equal(kernel.getObject("buffed-unit").buffs, 0);
  assert.equal(spent.linked.spentCount, 1);

  const readied = runInstruction(
    ready,
    { objects: readyUnit.args.objects, amount: readyUnit.args.amount },
    { world: kernel, targets: { "overt-operation.friendly-unit": [target] } }
  );
  assert.equal(readied.result.status, "executed");
  // CR 416.1: the unit becomes ready.
  assert.equal(kernel.getObject("buffed-unit").exhausted, false);
  assert.equal(readied.linked.readied.count, 1);
});

test("Overt Operation golden: a unit without a buff cannot be spent from (702.2.b.1)", () => {
  const kernel = world().unit("unbuffed-unit", { owner: "A", buffs: 0, exhausted: true }).build();
  const target = kernel.ref("unbuffed-unit");
  const spent = runInstruction(
    buff,
    { mode: spendBuff.args.mode.value, target: spendBuff.targets[0].id },
    { world: kernel, targets: { "overt-operation.friendly-unit": [target] } }
  );
  // Nothing spendable: the instruction reports skipped and the unit stays
  // exhausted, so the optional clause simply does nothing for that unit.
  assert.equal(spent.result.status, "negated");
  assert.equal(spent.result.reason, "skipped");
  assert.equal(kernel.getObject("unbuffed-unit").buffs, 0);
  assert.equal(kernel.getObject("unbuffed-unit").exhausted, true);
});

test("Overt Operation golden: buffing all friendly units adds one Buff to each unbuffed unit", () => {
  const kernel = world()
    .unit("plain-ally", { owner: "A", buffs: 0 })
    .unit("buffed-ally", { owner: "A", buffs: 1 })
    .build();
  const run = runInstruction(
    buff,
    { mode: buffAll.args.mode.value, target: "overt-operation.buff-all" },
    {
      world: kernel,
      targets: {
        "overt-operation.buff-all": [kernel.ref("plain-ally"), kernel.ref("buffed-ally")]
      }
    }
  );
  assert.equal(run.result.status, "executed");
  // CR 702.3/702.3.a: a unit can only have one Buff, so the already-buffed unit
  // simply is not buffed again (427.1.c).
  assert.equal(kernel.getObject("plain-ally").buffs, 1);
  assert.equal(kernel.getObject("buffed-ally").buffs, 1);
  assert.equal(run.linked.buffedCount, 1);
  assert.deepEqual(run.linked.buffed, [{ id: "plain-ally", zoneEntryId: 1 }]);
});

test("Overt Operation golden: enemy units are outside the recorded friendly filter", () => {
  // The recorded set filter keeps only the controller's units; the merged
  // effect.buff still needs a supplied set (see judgeReason).
  assert.deepEqual(buffAll.args.objects.value.filter, {
    type: "unit",
    controller: "controller",
    zone: "board"
  });
  const kernel = world()
    .unit("friendly", { owner: "A", buffs: 0 })
    .unit("enemy", { owner: "B", buffs: 0 })
    .build();
  const run = runInstruction(
    buff,
    { mode: buffAll.args.mode.value, target: "overt-operation.buff-all" },
    { world: kernel, targets: { "overt-operation.buff-all": [kernel.ref("friendly")] } }
  );
  assert.equal(run.result.status, "executed");
  assert.equal(kernel.getObject("friendly").buffs, 1);
  assert.equal(kernel.getObject("enemy").buffs, 0);
});

test.todo(
  "Overt Operation per-unit clause: a per-object optional iteration must visit each " +
    "friendly unit exactly once with its buff spend bound to that same unit (702.2.b, 416.1). " +
    "The merged repeat control repeats one body with default target reselection and no " +
    "per-object binding, and the chain blocks nested targets until the interpreter " +
    "target-selection lifecycle adapter exists (chain/README.md 契约变更请求 2)"
);

test.todo(
  "Overt Operation buff-all clause: effect.buff needs the non-target {kind:'query'} selection " +
    "form that effect.ready / effect.heal already accept (355.10.d/355.10.d.1), so 'then buff " +
    "all friendly units' resolves without targeting any unit (355.7, 754)"
);

test("Overt Operation cast surface keeps the printed cost and Action keyword declarative", () => {
  assert.deepEqual(play.cost, {
    kind: "cost.printed",
    energy: { kind: "constant", value: 5 },
    power: { kind: "constant", value: 2 }
  });
  assert.deepEqual(speed, { kind: "keyword", keyword: "action" });
});

