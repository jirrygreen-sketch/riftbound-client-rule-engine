import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/hextech-anomaly.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { instructionDefinitionsById } from "../../../../engine-core/dist/effects/instructions/registry.generated.js";
import { createProgramBinding } from "../../../../engine-core/dist/programs/index.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import resources from "../../../../engine-core/dist/effects/instructions/effect.resources.js";
import { buildCostPlan, CostPlanError, payCostPlan } from "../../../../engine-core/dist/cost/index.js";

const CARD_ID = "card.hash-58dcd4ef13c8ed65c72940c3d6474f1160275091a8b05488aa6bcbab5c57c2ef";
const EXPECTED_SOURCE =
  ":rb_exhaust:: [Reaction] \u2014 Pay any amount of :rb_rune_rainbow: to [Add] that much Energy. " +
  "(Abilities that add resources can't be reacted to.)";

const [reaction, ability] = program.abilities;
const [payAnyAmount, addEnergy] = ability.body;

function fixture() {
  const kernel = world()
    .player("A", { energy: 10, power: ["Mind"] })
    .player("B", { energy: 10 })
    .object("hextech-anomaly", {
      name: "Hextech Anomaly",
      cardId: CARD_ID,
      types: ["gear"],
      zone: "board",
      location: { type: "base", player: "A" },
      energy: 3,
      power: ["Mind"]
    })
    .build();
  return kernel.clone({ sourceSnapshot: kernel.getObject("hextech-anomaly") });
}

test("sfd-083-221 Hextech Anomaly: program validates and is judge-required", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.deepEqual(result.issues, []);
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /204\.3/);
  assert.match(program.judgeReason, /Universal Power|任意域/);
  assert.match(program.judgeReason, /Unregistered instruction opcode: cost\.pay-any/);
  assert.match(program.judgeReason, /activateAddDuringPayment/);
  assert.doesNotMatch(program.judgeReason, /RIFT-261|RIFT-257/);
  assert.ok(!/待实现|需要裁定/.test(program.judgeReason));
});

test("sfd-083-221 Hextech Anomaly: identity, ruleset, status and verbatim source text", () => {
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.sourceText, EXPECTED_SOURCE);
  assert.equal(cardRegistryById.get(CARD_ID), program);
});

test("sfd-083-221 Hextech Anomaly: [Reaction] declaration plus a reaction-timed activated ability", () => {
  assert.equal(program.abilities.length, 2);
  assert.deepEqual(reaction, { kind: "keyword", keyword: "reaction" });
  assert.equal(ability.kind, "activated");
  // 813.1.c.2 / 813.1.d：能力上的 [Reaction] 授予 Closed State 启动许可。
  assert.equal(ability.timing, "reaction");
  // 415.4/415.5：印刷的 :rb_exhaust: 是「横置自身」费用。
  assert.deepEqual(ability.cost, {
    kind: "activated",
    payments: [{ kind: "exhaust", object: "self" }]
  });
});

test("sfd-083-221 Hextech Anomaly: the any-amount payment links its actual amount to the Add instruction", () => {
  // 204.3/204.3.a：金额在结算时由玩家选择，[Add] 的必须是实付额。
  assert.equal(payAnyAmount.id, "hextech-anomaly.pay-any-amount");
  assert.equal(payAnyAmount.op, "cost.pay-any");
  assert.deepEqual(payAnyAmount.args.amount, { kind: "constant", value: "any" });
  assert.deepEqual(payAnyAmount.args.linkKey, { kind: "constant", value: "paid" });
  assert.equal(payAnyAmount.targets, undefined);
  assert.equal(payAnyAmount.linkedTo, undefined);

  assert.equal(addEnergy.id, "hextech-anomaly.add-energy");
  assert.equal(addEnergy.op, "effect.resources");
  assert.equal(addEnergy.linkedTo, "hextech-anomaly.pay-any-amount");
  assert.deepEqual(addEnergy.args.energy, {
    kind: "linked-value",
    instructionId: "hextech-anomaly.pay-any-amount",
    key: "paid"
  });
  assert.deepEqual(addEnergy.args.linkKey, { kind: "constant", value: "added" });
});

test("sfd-083-221 Hextech Anomaly boundary: the any-amount opcode is registered and preserves its paid link", () => {
  // 204.3/204.3a: the amount must be chosen at resolution and published.
  assert.equal(instructionDefinitionsById.has("cost.pay-any"), true);
  assert.equal(instructionDefinitionsById.has("cost.pay"), true);
  assert.equal(instructionDefinitionsById.get("cost.pay-any").op, "cost.pay-any");
});

test("sfd-083-221 Hextech Anomaly boundary: the merged cost.pay cannot choose an amount at resolution", () => {
  // cost.pay accepts exactly { cost, power, nonstandardOrder, payments, linkKey }
  // and every one of them is a fixed plan, so the printed "any amount" has no
  // executable form. Passing "any" is rejected rather than treated as zero.
  const kernel = fixture();
  const attempts = [
    { payments: { kind: "constant", value: { energy: "any" } } },
    { payments: { kind: "constant", value: { power: "any" } } },
    { energy: { kind: "constant", value: "any" } }
  ];
  for (const args of attempts) {
    assert.throws(
      () => resolveChainBody([{ id: "probe", op: "cost.pay", args }], kernel),
      (error) => error.name === "TypeError" || error.name === "CostPlanError"
    );
  }
  assert.equal(kernel.player("A").energy, 10);
  assert.deepEqual(kernel.player("A").power, ["Mind"]);
});

test("sfd-083-221 Hextech Anomaly boundary: [A] is a payable universal Power domain", () => {
  // 135.2.e.5.a / 163.2.b: rainbow normalizes to universal Power and is
  // payable from the current domain Power pool without substituting a domain.
  const kernel = fixture();
  const context = kernel.clone({ source: kernel.getObject("hextech-anomaly") });
  const plan = buildCostPlan(context, {
    id: "hextech-anomaly:universal",
    cost: {
      kind: "activated",
      payments: [{ kind: "power", amount: { kind: "constant", value: 1 }, allowedDomains: ["rainbow"] }]
    }
  });
  assert.deepEqual(plan.total.power, [{ amount: 1, allowedDomains: [
    "Fury", "Calm", "Mind", "Body", "Chaos", "Order"
  ] }]);
  assert.deepEqual(context.player("A").power, ["Mind"]);
});

test("sfd-083-221 Hextech Anomaly: the Add body really adds the caller-supplied paid amount", () => {
  // 430.1/430.5：Add 把资源放进 Rune Pool；此处用调用方提供的实付额（3）驱动本卡自己的参数。
  const kernel = world().player("A", { energy: 0, power: ["Mind"] }).build();
  const run = runInstruction(resources, addEnergy.args, { world: kernel, linked: { paid: 3 } });
  assert.equal(run.result.status, "executed");
  assert.equal(kernel.player("A").energy, 3);
  assert.deepEqual(run.linked.added, { player: "A", energy: 3, power: [] });
  assert.deepEqual(run.events.map((event) => event.action), ["gain-energy"]);
});

test("sfd-083-221 Hextech Anomaly: the exhaust half of the printed cost is really payable", () => {
  // 费用计划使用卡牌自己声明的 payments 条目（本卡印刷费用的可执行半段）。
  const kernel = fixture();
  const plan = buildCostPlan(kernel, {
    id: "hextech-anomaly:activate",
    cost: { kind: "activated", payments: ability.cost.payments }
  });
  const receipt = payCostPlan(kernel, plan);
  assert.equal(receipt.paid, true);
  assert.equal(kernel.getObject("hextech-anomaly").exhausted, true);
  assert.deepEqual(receipt.actions.map((action) => action.action.type), ["pay", "exhaust"]);
});

test("sfd-083-221 Hextech Anomaly: the production binding describes the real reaction activation draft", () => {
  // 契约 3.5 / 430.3：启动能力到链的接线已合入（describeActivate），430.3 的窗口由
  // chain/engine.ts 的 activateAddDuringPayment 提供；草稿的真实断点在 body 的未注册原语。
  const binding = createProgramBinding({
    cardPrograms: [{ ...program, status: "executable", judgeReason: undefined }]
  });
  const kernel = fixture();
  const source = kernel.getObject("hextech-anomaly");
  assert.equal(binding.activationAbilities(source).length, 1);

  const draft = binding.describeActivate(source, "A", 0);
  assert.equal(draft.kind, "activated");
  assert.equal(draft.speed, "reaction");
  assert.deepEqual(draft.cost.cost.payments, [{ kind: "exhaust", object: "self" }]);
  assert.deepEqual(draft.body.map((instruction) => [instruction.id, instruction.op]), [
    ["hextech-anomaly.pay-any-amount", "cost.pay-any"],
    ["hextech-anomaly.add-energy", "effect.resources"]
  ]);
});

test.todo(
  "sfd-083-221 Hextech Anomaly: the resolve-time any-amount payment of CR 204.3/204.3.a needs a merged instruction " +
    "primitive that lets the controller choose the amount and publishes the amount actually paid; cost.pay only " +
    "covers fixed finalized cost plans today"
);
test.todo(
  "sfd-083-221 Hextech Anomaly: :rb_rune_rainbow: is Universal Power [A] (CR 135.2.e.5.a / 163.2.b); the closed " +
    "six-domain Domain set cannot carry it, so the paid Power composition cannot be recorded or replayed without a " +
    "contract extension"
);

