import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/rad/shimmering-swimmer.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import damage from "../../../../engine-core/dist/effects/instructions/effect.damage.js";
import kill from "../../../../engine-core/dist/effects/instructions/effect.kill.js";

const COST_PICK = "shimmering-swimmer.additional-cost";
const DAMAGE_ID = "shimmering-swimmer.deal-2";
const DAMAGE_TARGET = "shimmering-swimmer.unit";

test("rad-014-167 Shimmering Swimmer: program validates and has expected identity", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.equal(program.status, "judge-required");
  assert.equal(
    program.canonicalCardId,
    "card.hash-05acd78d132bf8780fd8fba892925f17226694182298a6fdeac69e8a824941e1"
  );
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(
    program.sourceText,
    "You may kill a friendly unit or gear as an additional cost to play me.\n" +
      "When you play me, if you paid the additional cost, deal 2 to a unit."
  );
  assert.match(program.judgeReason, /附加费用/);
  assert.match(program.judgeReason, /paid/);
});

test("rad-014-167: play cost declares the optional kill additional cost via a non-target pick", () => {
  assert.equal(program.abilities.length, 1);
  const [ability] = program.abilities;
  assert.equal(ability.kind, "play");
  assert.equal(ability.cost.kind, "additional");
  assert.equal(ability.cost.payments.length, 1);
  const [payment] = ability.cost.payments;
  assert.equal(payment.kind, "kill");
  // 费用内的对象选择不是目标（355.10.c），所以是 PickSpec 而不是 TargetSpec。
  assert.equal(payment.choice.id, COST_PICK);
  assert.deepEqual(payment.choice.filter, {
    controller: "controller",
    type: ["unit", "gear"]
  });
  assert.equal(payment.choice.min, 1);
  assert.equal(payment.choice.max, 1);
  assert.equal(payment.choice.selection, "one");
});

test("rad-014-167: the paid-cost condition guards a targeted 2-damage instruction", () => {
  const [ability] = program.abilities;
  assert.equal(ability.body.length, 1);
  const [instruction] = ability.body;
  assert.equal(instruction.id, DAMAGE_ID);
  assert.equal(instruction.op, "effect.damage");
  assert.deepEqual(instruction.args.amount, { kind: "constant", value: 2 });
  assert.deepEqual(instruction.args.target, { kind: "constant", value: DAMAGE_TARGET });
  assert.equal(instruction.targets.length, 1);
  const [spec] = instruction.targets;
  assert.equal(spec.id, DAMAGE_TARGET);
  assert.deepEqual(spec.filter, { zone: "board", type: "unit" });
  assert.equal(spec.min, 1);
  assert.equal(spec.max, 1);
  assert.equal(spec.selection, "one");

  // “if you paid the additional cost”：356.2.b 的费用承诺，当前只能用审查用占位 subject。
  assert.equal(instruction.condition.kind, "compare");
  assert.deepEqual(instruction.condition.left, {
    kind: "count",
    subject: "additional-cost-paid",
    filter: { zone: "cost-receipt" }
  });
  assert.equal(instruction.condition.operator, "gte");
  assert.deepEqual(instruction.condition.right, { kind: "constant", value: 1 });
});

test("rad-014-167: the kill additional cost is executable through the real effect.kill primitive", () => {
  const kernel = world()
    .object("friendly-gear", {
      name: "friendly-gear",
      types: ["gear"],
      zone: "board",
      location: { type: "battlefield", id: "bf-1" },
      energy: null,
      power: null
    })
    .unit("friendly-unit", { might: 3 })
    .build();
  const run = runInstruction(
    kill,
    { picks: COST_PICK, reason: "additional-cost" },
    { world: kernel, picks: { [COST_PICK]: [kernel.ref("friendly-gear")] } }
  );
  assert.equal(run.result.status, "executed");
  assert.equal(kernel.getObject("friendly-gear").zone, "trash");
  assert.equal(kernel.getObject("friendly-unit").zone, "board");
  assert.deepEqual(run.linked.killed, [{ id: "friendly-gear", zoneEntryId: 1 }]);
});

test("rad-014-167: the damage instruction deals 2 to a locked unit", () => {
  const [ability] = program.abilities;
  const instruction = ability.body[0];
  const kernel = world().unit("enemy", { owner: "B", might: 4 }).build();
  const run = runInstruction(
    damage,
    { amount: instruction.args.amount, target: DAMAGE_TARGET },
    { world: kernel, targets: { [DAMAGE_TARGET]: [kernel.ref("enemy")] } }
  );
  assert.equal(run.result.status, "executed");
  assert.equal(kernel.getObject("enemy").damage, 2);
  assert.equal(run.linked.dealt, 2);
  assert.equal(run.linked.dealtCount, 1);
});

test("rad-014-167: the un-executable condition skips the damage when the cost is unpaid", () => {
  // 条件求值依赖 “paid” 凭证：占位 subject + 不存在的 zone 在参考内核里计为 0，
  // 因此指令按“未支付”路径被 skipped（不结算伤害）。支付路径需要 RIFT-89/90 的凭证管线。
  const kernel = world().unit("enemy", { owner: "B", might: 4 }).build();
  kernel.setTargets(DAMAGE_TARGET, [kernel.ref("enemy")]);
  const outcome = resolveChainBody(program.abilities[0].body, kernel);
  assert.equal(outcome.status, "partial");
  assert.equal(outcome.results[0].result.status, "negated");
  assert.equal(outcome.results[0].result.reason, "skipped");
  assert.equal(kernel.getObject("enemy").damage, 0);
});

test.todo(
  "rad-014-167 Shimmering Swimmer: 可选附加费用（356.2.b 的 kill 付款）在 Finalize 的费用计划中" +
    "收取与记账，依赖 RIFT-89~91（cost.plan / buildCostPlan 接线）"
);
test.todo(
  "rad-014-167 Shimmering Swimmer: “if you paid the additional cost” 的费用凭证条件" +
    "（condition.result）缺少可用谓词，依赖 RIFT-89/90"
);
