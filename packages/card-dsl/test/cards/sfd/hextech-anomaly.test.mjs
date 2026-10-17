import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/hextech-anomaly.js";
const ENGINE = new URL("../../../../engine-core/dist/", import.meta.url);
const { runInstruction, world } = await import(new URL("effects/testing/index.js", ENGINE));
const resources = (await import(new URL("effects/instructions/effect.resources.js", ENGINE))).default;
const { buildCostPlan, payCostPlan } = await import(new URL("cost/index.js", ENGINE));

const CARD_ID = "card.hash-58dcd4ef13c8ed65c72940c3d6474f1160275091a8b05488aa6bcbab5c57c2ef";
const EXPECTED_SOURCE =
  ":rb_exhaust:: [Reaction] — Pay any amount of :rb_rune_rainbow: to [Add] that much Energy. " +
  "(Abilities that add resources can't be reacted to.)";

const [reaction, ability] = program.abilities;
const [payAnyAmount, addEnergy] = ability.body;

function fixture() {
  const kernel = world()
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
  assert.match(program.judgeReason, /RIFT-261/);
  assert.ok(!/待实现|需要裁定/.test(program.judgeReason));
});

test("sfd-083-221 Hextech Anomaly: identity, ruleset, status and verbatim source text", () => {
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.sourceText, EXPECTED_SOURCE);
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

test.todo(
  "sfd-083-221 Hextech Anomaly: the resolve-time any-amount payment of CR 204.3/204.3.a needs a merged instruction " +
    "primitive that lets the controller choose the amount and publishes the amount actually paid (RIFT-261); " +
    "cost.pay only covers Finalize cost plans today"
);
test.todo(
  "sfd-083-221 Hextech Anomaly: :rb_rune_rainbow: is Universal Power [A] (CR 135.2.e.5.a / 163.2.b); the closed " +
    "six-domain Domain set cannot carry it, so the paid Power composition cannot be recorded or replayed without a " +
    "contract extension"
);
test.todo(
  "sfd-083-221 Hextech Anomaly: the activated-ability -> chain wiring (contract 3.5) and the 430.3 window that lets a " +
    "Reaction Add start while costs are being paid are not merged (RIFT-261/120)"
);
