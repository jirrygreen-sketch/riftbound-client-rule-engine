import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ven/defender-of-tomorrow.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { buildCostPlan } from "../../../../engine-core/dist/cost/cost-plan.js";
import { payCostPlan } from "../../../../engine-core/dist/cost/payment.js";
import { CostPlanError } from "../../../../engine-core/dist/cost/plan-types.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL_ID =
  "card.hash-a83f38e4a2af89564ecd6ceb9b9d1eb607e58af4d10927e697cd6eb4c95fe037";
const SOURCE_TEXT =
  "[Empower] :rb_energy_2::rb_rune_rainbow::rb_rune_rainbow: " +
  "(:rb_energy_2::rb_rune_rainbow::rb_rune_rainbow:: Empower me. Use only if not Empowered.)\n" +
  ":rb_energy_1:, :rb_exhaust:: Ready a gear.\n" +
  "[Empowered][>] :rb_energy_1:, :rb_exhaust:: Ready 2 gear.";

const [empower, readyOne, readyTwo] = program.abilities;

const ALL_SIX_DOMAINS = ["Fury", "Calm", "Mind", "Body", "Chaos", "Order"];

/** 827.1.c.1 的「2 Energy + 2 [A]」：印刷在 Empower 关键词上的费用（见文件注释）。 */
const EMPOWER_COST = {
  kind: "activated",
  energy: { kind: "constant", value: 2 },
  payments: [
    { kind: "power", amount: { kind: "constant", value: 1 }, allowedDomains: ALL_SIX_DOMAINS },
    { kind: "power", amount: { kind: "constant", value: 1 }, allowedDomains: ALL_SIX_DOMAINS }
  ]
};

const legendWorld = (energy, power) => {
  const kernel = world()
    .player("A", { energy, power })
    .unit("legend", { types: ["legend"], zone: "board" })
    .build();
  return kernel.clone({ sourceSnapshot: kernel.getObject("legend") });
};

test("ven-149-166 Defender of Tomorrow: validateCardProgram passes and identity is verbatim", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL_ID), program);
  // 复核后：缺的只是 Empower/Empowered 关键词与 442.1.a 的状态谓词（[A] 的支付形状已可表达）。
  assert.match(program.judgeReason, /empower/i);
  assert.match(program.judgeReason, /442\.1\.a/);
  assert.match(program.judgeReason, /828\.1\.b\.1/);
  assert.match(program.judgeReason, /135\.2\.e\.5\.a/);
  assert.doesNotMatch(program.judgeReason, /六域封闭 Domain 集合无法表达/);
  assert.ok(!/待实现|需要裁定/.test(program.judgeReason));
});

test("ven-149-166: [Empower] is declared as a bare keyword (no card-side expansion)", () => {
  assert.equal(program.abilities.length, 3);
  // 827.1.c.1's "[Cost]: Empower me. Use only if not Empowered." is the
  // keyword's expansion; the card declares the keyword only, exactly like the
  // other keyword-only programs (contract 3.7). The printed cost (2 Energy +
  // 2 [A]) is recorded in the header and judgeReason because KeywordAbility
  // has no params field to carry it (contract change request).
  assert.deepEqual(empower, { kind: "keyword", keyword: "empower" });
});

test("ven-149-166: 'Ready a gear' is one 1-Energy + Exhaust action ability targeting a gear", () => {
  assert.equal(readyOne.kind, "activated");
  assert.equal(readyOne.timing, "action");
  assert.deepEqual(readyOne.cost.energy, { kind: "constant", value: 1 });
  assert.deepEqual(readyOne.cost.payments, [{ kind: "exhaust", object: "self" }]);
  assert.equal(readyOne.body.length, 1);
  const [instruction] = readyOne.body;
  assert.equal(instruction.id, "defender-of-tomorrow.ready-gear");
  assert.equal(instruction.op, "effect.ready");
  assert.deepEqual(instruction.args.objects, {
    kind: "constant",
    value: { kind: "target", id: "defender-of-tomorrow.gear" }
  });
  assert.deepEqual(instruction.args.amount, { kind: "constant", value: 1 });
  assert.deepEqual(instruction.targets, [
    {
      id: "defender-of-tomorrow.gear",
      filter: { type: "gear", zone: "board" },
      min: 1,
      max: 1,
      selection: "one"
    }
  ]);
});

test("ven-149-166: the [Empowered] clause is a second ability gated by the dependent keyword", () => {
  assert.equal(readyTwo.kind, "activated");
  assert.equal(readyTwo.timing, "action");
  // 828.1.b.1: "While I have the Empowered status, this card gains [Text]."
  assert.deepEqual(readyTwo.restriction, { kind: "dependent-keyword", keyword: "empowered" });
  const [instruction] = readyTwo.body;
  assert.equal(instruction.id, "defender-of-tomorrow.ready-2-gear");
  assert.equal(instruction.op, "effect.ready");
  assert.deepEqual(instruction.args.amount, { kind: "constant", value: 2 });
  // "Ready 2 gear": exactly two gear, not "up to" (355.13 would allow zero).
  assert.equal(instruction.targets[0].id, "defender-of-tomorrow.gears");
  assert.equal(instruction.targets[0].selection, "any");
  assert.equal(instruction.targets[0].min, 2);
  assert.equal(instruction.targets[0].max, 2);
});

test("ven-149-166 golden: 'Ready a gear' readies an exhausted gear through the interpreter", () => {
  const kernel = world()
    .unit("legend", { types: ["legend"], zone: "board" })
    .unit("gear-1", { types: ["gear"], exhausted: true })
    .build();
  kernel.setTargets("defender-of-tomorrow.gear", [kernel.ref("gear-1")]);

  const outcome = runAbilityBody(readyOne.body, kernel, undefined, {
    host: kernel.ref("legend")
  });
  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.results.map(result => result.id), [
    "defender-of-tomorrow.ready-gear"
  ]);
  assert.equal(kernel.getObject("gear-1").exhausted, false);
  assert.deepEqual(kernel.events.map(event => event.action), ["ready"]);
});

test("ven-149-166 golden: the [Empowered] clause readies exactly two exhausted gear", () => {
  const kernel = world()
    .unit("legend", { types: ["legend"], zone: "board" })
    .unit("gear-1", { types: ["gear"], exhausted: true })
    .unit("gear-2", { types: ["gear"], exhausted: true })
    .unit("gear-3", { types: ["gear"], exhausted: true })
    .build();
  kernel.setTargets("defender-of-tomorrow.gears", [
    kernel.ref("gear-1"),
    kernel.ref("gear-2"),
    kernel.ref("gear-3")
  ]);

  const outcome = runAbilityBody(readyTwo.body, kernel, undefined, {
    host: kernel.ref("legend")
  });
  assert.equal(outcome.status, "executed");
  const readied = outcome.results[0].result.linkedValues.readied;
  assert.equal(readied.count, 2);
  assert.equal(kernel.getObject("gear-1").exhausted, false);
  assert.equal(kernel.getObject("gear-2").exhausted, false);
  assert.equal(kernel.getObject("gear-3").exhausted, true);
});

test("ven-149-166 golden: the printed Empower cost (2 Energy + 2 [A]) pays with any-domain Power", () => {
  // 135.2.e.5.a：每个 [A] 都能用任意域的 Power 支付；这里用 Mind/Body 两点付掉，
  // 再确认单域两点不足时被拒（不是把所有 Power 当成任意域）。
  const context = legendWorld(5, ["Mind", "Body"]);
  const plan = buildCostPlan(context, { id: "empower", cost: EMPOWER_COST });
  assert.deepEqual(plan.total.power, [
    { amount: 1, allowedDomains: ALL_SIX_DOMAINS },
    { amount: 1, allowedDomains: ALL_SIX_DOMAINS }
  ]);

  const receipt = payCostPlan(context, plan);
  assert.equal(receipt.paid, true);
  assert.equal(receipt.power.power.length, 2);
  assert.ok(receipt.power.power.every(allocation => ["Mind", "Body"].includes(allocation.from)));
});

test("ven-149-166 golden: the Empower cost is still gated by its printed Energy and Power amounts", () => {
  // 只有 1 点任意域 Power 时付不起两个 [A]。
  const onePower = legendWorld(5, ["Order"]);
  assert.throws(
    () => payCostPlan(onePower, buildCostPlan(onePower, { id: "empower", cost: EMPOWER_COST })),
    error => error instanceof CostPlanError && error.reason === "cannot-pay-cost"
  );
  // 只有 1 点 Energy 时付不起印刷的 2 Energy。
  const oneEnergy = legendWorld(1, ["Order", "Calm"]);
  assert.throws(
    () => payCostPlan(oneEnergy, buildCostPlan(oneEnergy, { id: "empower", cost: EMPOWER_COST })),
    error => error instanceof CostPlanError && error.reason === "cannot-pay-cost"
  );
});

test.todo(
  "ven-149-166: Empower/Empowered keyword expansion (827.1.c.1 activation + 'only if not Empowered' " +
    "restriction, 828.1.b.1 dependent ability) — needs the printed-cost activation, the " +
    "442.1.a Empowered state predicate and dependent-ability binding"
);
