import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ven/butcher-of-the-sands.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { buildCostPlan } from "../../../../engine-core/dist/cost/cost-plan.js";
import { payCostPlan } from "../../../../engine-core/dist/cost/payment.js";
import { CostPlanError } from "../../../../engine-core/dist/cost/plan-types.js";
import { createProgramBinding } from "../../../../engine-core/dist/programs/index.js";
import { instructionDefinitionsById } from "../../../../engine-core/dist/effects/instructions/registry.generated.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL_ID =
  "card.hash-fd135b06be83d09c3f8ab5d01c8c2625b0ae9ea0392ea903d7ac2fae20d61237";
const SOURCE_TEXT =
  "[Reaction][>] :rb_rune_rainbow::rb_rune_rainbow:, :rb_exhaust:: [Add] :rb_energy_2:. " +
  "Spend this Energy only to play units or activated abilities of units.";

const [ability] = program.abilities;

const ALL_SIX_DOMAINS = ["Fury", "Calm", "Mind", "Body", "Chaos", "Order"];

const butcherWorld = (power = []) => {
  const kernel = world()
    .player("A", { power })
    .unit("butcher", { types: ["legend"], zone: "board" })
    .build();
  return kernel.clone({ sourceSnapshot: kernel.getObject("butcher") });
};

test("ven-141-166 Butcher of the Sands: validateCardProgram passes and identity is verbatim", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /only to play units or activated abilities of units/);
  // 复核后：[A] 的支付形状已由合并费用管线支持，旧的「六域封闭集合无法表达」已删除。
  assert.doesNotMatch(program.judgeReason, /无法表达/);
  assert.match(program.judgeReason, /allowedDomains/);
  // The current, measured form of the restricted-resource gap.
  assert.match(program.judgeReason, /gain-energy/);
  assert.match(program.judgeReason, /purpose/);
  assert.match(program.judgeReason, /continuous\.restrict/);
  assert.equal(cardRegistryById.get(program.canonicalCardId), program);
});

test("ven-141-166: the Add Energy body is registrable while the spend restriction has no shape", () => {
  // The ability costs and body all bind through the production program surface.
  // This card is judge-required, so the registry needs an executable projection
  // of the very same program object to exercise that surface; the body, cost and
  // restriction shapes under test are the card's own.
  const binding = createProgramBinding({
    cardPrograms: [{ ...program, status: "executable", judgeReason: undefined }]
  });
  const kernel = world()
    .player("A", { power: ["Order", "Fury"] })
    .unit("butcher", { types: ["legend"], zone: "board", owner: "A", controller: "A", cardId: CANONICAL_ID })
    .build();
  const draft = binding.describeActivate(kernel.getObject("butcher"), "A", 0);
  assert.equal(draft.speed, "reaction");
  assert.deepEqual(draft.body.map(instruction => instruction.op), ["effect.resources"]);

  // The spend restriction itself would need a purpose-tagged resource shape. The
  // primitive set has the untagged Add, and no registered op expresses a
  // restricted resource pool; the card therefore authors no fake restriction.
  assert.equal(instructionDefinitionsById.has("effect.resources"), true);
  for (const op of ["effect.restricted-resources", "continuous.spend-limit", "restriction.energy-use"]) {
    assert.equal(instructionDefinitionsById.has(op), false, op);
  }
  assert.equal("restriction" in ability, false);
});

test("ven-141-166: [Reaction][>] Add ability with the printed two [A] plus Exhaust cost", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "activated");
  // 813.1.c / 813.1.d：[Reaction][>] 的许可按契约 3.1 记在 activated.timing。
  assert.equal(ability.timing, "reaction");
  // 204.1.b / 415.5：「:」前的两个 :rb_rune_rainbow: 与 :rb_exhaust: 组成 Base Cost。
  // 135.2.e.5.a：每个 [A] 由任意域 Power 支付 = allowedDomains 覆盖六域的 1 点需求。
  assert.deepEqual(ability.cost, {
    kind: "activated",
    payments: [
      { kind: "power", amount: { kind: "constant", value: 1 }, allowedDomains: ALL_SIX_DOMAINS },
      { kind: "power", amount: { kind: "constant", value: 1 }, allowedDomains: ALL_SIX_DOMAINS },
      { kind: "exhaust", object: "self" }
    ]
  });
  // 本卡没有印刷 Energy 费用；energy 字段缺省，绝不写成 0。
  assert.equal("energy" in ability.cost, false);
});

test("ven-141-166: body is the single [Add] :rb_energy_2: instruction", () => {
  assert.equal(ability.body.length, 1);
  const [addEnergy] = ability.body;
  assert.equal(addEnergy.id, "butcher-of-the-sands.add-energy");
  assert.equal(addEnergy.op, "effect.resources");
  // 430.1 / 430.5 / 168：Add 2 Energy 到控制者 Rune Pool。
  assert.deepEqual(addEnergy.args, { energy: { kind: "constant", value: 2 } });
  assert.equal(addEnergy.targets, undefined);
  assert.equal(addEnergy.picks, undefined);
  assert.equal(addEnergy.linkedTo, undefined);
  // 「Spend this Energy only to …」的用途限制没有可表达的 IR 形状，
  // 因此不写伪造的 restriction（见 judgeReason 第 2 条）。
  assert.equal("restriction" in ability, false);
});

test("ven-141-166 golden: [Add] :rb_energy_2: adds two Energy to the controller", () => {
  const kernel = world()
    .unit("butcher", { types: ["legend"], zone: "board" })
    .build();
  const context = kernel.clone({ sourceSnapshot: kernel.getObject("butcher") });

  const outcome = resolveChainBody(ability.body, context);

  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.results.map(result => [result.id, result.result.status]), [
    ["butcher-of-the-sands.add-energy", "executed"]
  ]);
  assert.equal(context.player("A").energy, 2);
  assert.deepEqual(context.events.map(event => event.action), ["gain-energy"]);
  assert.deepEqual(outcome.linkedValues["butcher-of-the-sands.add-energy.resources"], {
    player: "A",
    energy: 2,
    power: []
  });
});

test("ven-141-166 golden: the two [A] are payable by Power of any Domain (135.2.e.5.a)", () => {
  // 135.2.e.5.b：任意域的两点 Power 付得起两个 [A]，与域的组合无关。
  for (const power of [["Order", "Order"], ["Mind", "Fury"], ["Body", "Chaos"]]) {
    const context = butcherWorld(power);
    const plan = buildCostPlan(context, { id: "cost", cost: ability.cost });

    // 两条各 1 点的需求分别保留完整六域候选（不是一个 2 点需求）。
    assert.deepEqual(plan.total.power, [
      { amount: 1, allowedDomains: ALL_SIX_DOMAINS },
      { amount: 1, allowedDomains: ALL_SIX_DOMAINS }
    ], JSON.stringify(power));
    assert.deepEqual(plan.total.actions.map(entry => entry.action), [
      { type: "exhaust", object: context.ref("butcher") }
    ]);

    const receipt = payCostPlan(context, plan);
    assert.equal(receipt.paid, true, JSON.stringify(power));
    assert.deepEqual(receipt.actions.map(entry => [entry.action.type, entry.status]), [
      ["pay", "done"],
      ["exhaust", "done"]
    ]);
    assert.equal(context.getObject("butcher").exhausted, true);
    // 支付回执把每个 [A] 归属到实际使用的域。
    assert.equal(receipt.power.power.length, 2, JSON.stringify(power));
    assert.ok(receipt.power.power.every(allocation => power.includes(allocation.from)), JSON.stringify(power));
  }
});

test("ven-141-166 golden: fewer than two Power of any Domain cannot pay the printed cost", () => {
  for (const power of [[], ["Mind"]]) {
    const context = butcherWorld(power);
    assert.throws(
      () => payCostPlan(context, buildCostPlan(context, { id: "cost", cost: ability.cost })),
      error => error instanceof CostPlanError && error.reason === "cannot-pay-cost",
      JSON.stringify(power)
    );
    assert.equal(context.getObject("butcher").exhausted, false, JSON.stringify(power));
  }
});

test("ven-141-166 golden: an already-exhausted source cannot pay the Exhaust half (415.4)", () => {
  const kernel = world()
    .player("A", { power: ["Order", "Fury"] })
    .unit("butcher", { types: ["legend"], zone: "board", exhausted: true })
    .build();
  const context = kernel.clone({ sourceSnapshot: kernel.getObject("butcher") });
  assert.throws(
    () => payCostPlan(context, buildCostPlan(context, { id: "cost", cost: ability.cost })),
    error => error instanceof CostPlanError && error.reason === "cannot-pay-cost"
  );
});

test.todo(
  "ven-141-166: 'Spend this Energy only to play units or activated abilities of units' — the " +
    "closed GameAction set has an untagged gain-energy only; no restricted-resource shape exists"
);
