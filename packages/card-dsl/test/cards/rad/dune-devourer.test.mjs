import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/rad/dune-devourer.js";
import Deflect from "../../../../engine-core/dist/effects/keywords/Deflect.js";
import { buildCostPlan } from "../../../../engine-core/dist/cost/cost-plan.js";
import { finalizeCostPlan } from "../../../../engine-core/dist/cost/discounts/index.js";
import { CostPlanError } from "../../../../engine-core/dist/cost/plan-types.js";
import { payCostPlan } from "../../../../engine-core/dist/cost/payment.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import { createEngineStaticBinder } from "../../../../engine-core/dist/programs/statics.js";
import { createProgramBinding } from "../../../../engine-core/dist/programs/index.js";

const CANONICAL = "card.hash-f33da6b768e700ee188122bbd6f6aad4f17db64d49c416a3c437ddb6d98ad07b";

test("rad-125-167 Dune Devourer: program validates and has expected identity", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /translateCost/);
  assert.match(program.judgeReason, /Unsupported play cost field optional/);
  assert.match(program.judgeReason, /cost\/discounts\/collect\.ts/);
  assert.match(program.judgeReason, /356\.4\.f\.1/);
  assert.match(program.judgeReason, /target\.tax/);
  assert.match(program.judgeReason, /layerFor/);
  assert.match(program.judgeReason, /continuous\.cost-modification/);
  assert.equal(program.judgeReason.includes("Deflect"), true);
  assert.equal(
    program.sourceText,
    "You may kill a friendly unit as an additional cost to play me. If you do, I cost :rb_energy_2: less.\n" +
      "[Deflect] (Opponents must pay :rb_rune_rainbow: to choose me with a spell or ability.)"
  );
});

test("rad-125-167 Dune Devourer: [Deflect] 声明 + 可选附加费用 + 条件折扣", () => {
  assert.equal(program.abilities.length, 3);
  const [deflect, play, discount] = program.abilities;

  // [Deflect]（809）由 effects/keywords/Deflect.ts 展开为 target.tax。
  assert.deepEqual(deflect, { kind: "keyword", keyword: "deflect" });
  assert.equal(Deflect.keyword, "Deflect");
  assert.equal(Deflect.valued, true);

  // "You may kill a friendly unit as an additional cost to play me"：204.2 附加费用；
  // 355.10.c 明确这类"作为附加费用消灭"不指定目标 → PickSpec 而非 TargetSpec。
  assert.equal(play.kind, "play");
  assert.deepEqual(play.body, []);
  assert.equal(play.cost.kind, "additional");
  assert.equal(play.cost.optional, true);
  assert.equal(play.cost.payments.length, 1);
  const payment = play.cost.payments[0];
  assert.equal(payment.kind, "kill");
  assert.deepEqual(payment.choice, {
    id: "dune-devourer.friendly-unit",
    options: ["friendly-unit-you-control"],
    min: 1,
    max: 1,
    selection: "one",
    filter: { zone: "board", type: "unit", controller: "controller" }
  });
  assert.equal(payment.target, undefined);

  // "If you do, I cost 2 less"：356.4.f.1 的条件折扣（可选附加费用被"决定支付"即成立）。
  assert.equal(discount.kind, "static");
  assert.equal(discount.effect.kind, "continuous.cost-modification");
  assert.deepEqual(discount.effect.amount, { kind: "constant", value: -2 });
  assert.equal(discount.effect.resource, "energy");
  assert.equal(discount.condition.kind, "expression");
  assert.equal(
    discount.condition.value.value,
    "optional-additional-cost-paid:kill-a-friendly-unit"
  );
});

test("rad-125-167 Dune Devourer: [Deflect] 展开本体可校验，但卡牌侧不重复实现", () => {
  const expanded = Deflect.expand({ host: { canonicalCardId: CANONICAL } });
  assert.equal(expanded.length, 1);
  assert.equal(expanded[0].kind, "static");
  assert.equal(expanded[0].effect.kind, "target.tax");
  // 卡牌程序只写 keyword 声明；展开结果不属于本文件的数据。
  assert.equal(program.abilities.filter(ability => ability.kind === "static" && ability.effect.kind === "target.tax").length, 0);
});

test("Dune Devourer: the optional kill payment executes once its non-target choice is locked", () => {
  for (const selected of [true, false]) {
    const kernel = world().player("A", { energy: 6 })
      .hand("devourer", { types: ["unit"], energy: 4, power: [] })
      .unit("friendly").unit("enemy", { owner: "B" }).build();
    const scoped = kernel.clone({ sourceSnapshot: kernel.getObject("devourer") });
    const [payment] = program.abilities[1].cost.payments;
    const locked = { ...payment, choice: { ...payment.choice, options: [scoped.ref("friendly")] } };
    scoped.setPicks(payment.choice.id, [scoped.ref("friendly")]);
    // Only the base and kill payment components are exercised. The production
    // additional-cost/discount adapter remains pending below.
    const plan = buildCostPlan(scoped, {
      id: "devourer-kill-component", cost: { kind: "printed" },
      optionalAdditional: [{ id: "kill-friendly", kind: "additional", selected, cost: { payments: [locked] } }]
    });
    const receipt = payCostPlan(scoped, plan);
    assert.equal(receipt.paid, true);
    assert.equal(scoped.player("A").energy, 2);
    assert.equal(scoped.getObject("friendly").zone, selected ? "trash" : "board");
    assert.equal(scoped.getObject("enemy").zone, "board");
    assert.equal(scoped.getObject("devourer").zone, "hand");
    assert.deepEqual(receipt.additional, selected ? [{ id: "kill-friendly", kind: "additional", paid: true }] : []);
    assert.deepEqual(scoped.events.map(event => event.action), selected ? ["pay", "kill"] : ["pay"]);
    assert.equal(scoped.events.some(event => event.timingPoint === "became-target"), false);
  }
});

test("Dune Devourer: the merged collector really kills the chosen friendly unit for the optional cost", () => {
  // CR 356.2.b.1: the merged collector resolves the non-target PickSpec with
  // ctx.picks/ctx.choose and charges the kill through the real payment path.
  // This is the executable half of the printed card; the decision-gated
  // discount is asserted separately below.
  const [payment] = program.abilities[1].cost.payments;
  const kernel = world()
    .player("A", { energy: 6 })
    .hand("devourer", { types: ["unit"], energy: 4, power: [] })
    .unit("friendly", { controller: "A" })
    .unit("enemy", { owner: "B", controller: "B" })
    .build();
  const ctx = kernel.clone({ sourceSnapshot: kernel.getObject("devourer") });
  const pick = { ...payment.choice, options: [ctx.ref("friendly")] };
  ctx.setPicks(pick.id, [ctx.ref("friendly")]);
  const plan = finalizeCostPlan(ctx, {
    id: "play",
    cost: { kind: "printed" },
    optionalAdditional: [{ id: "kill-friendly", kind: "additional", selected: true, cost: { payments: [{ ...payment, choice: pick }] } }]
  });
  const receipt = payCostPlan(ctx, plan);
  assert.equal(receipt.paid, true);
  assert.deepEqual(receipt.additional, [{ id: "kill-friendly", kind: "additional", paid: true }]);
  assert.equal(ctx.getObject("friendly").zone, "trash", "the chosen friendly unit is killed");
  assert.equal(ctx.getObject("enemy").zone, "board", "the non-target cost choice never touches another player's unit");
  assert.equal(ctx.player("A").energy, 2);
  assert.deepEqual(ctx.events.map(event => event.action), ["pay", "kill"]);
});

test("Dune Devourer: the printed decision-gated -2 Energy discount still fails closed in the merged collector", () => {
  // 356.4.d vs 356.4.f.1: the printed text discounts the TOTAL cost only when the
  // player decided to pay. The merged collector's component scope
  // (optional-additional-costs-you-pay) discounts only that component, so a
  // 0-Energy kill component keeps the total at 4; a plain total-cost discount
  // fires even when the player declined, and the descriptive gate is refused.
  const [payment] = program.abilities[1].cost.payments;
  const discount = program.abilities[2];
  const setup = () => {
    const kernel = world()
      .player("A", { energy: 6 })
      .hand("devourer", { types: ["unit"], energy: 4, power: [] })
      .unit("friendly", { controller: "A" })
      .build();
    const ctx = kernel.clone({ sourceSnapshot: kernel.getObject("devourer") });
    const pick = { ...payment.choice, options: [ctx.ref("friendly")] };
    ctx.setPicks(pick.id, [ctx.ref("friendly")]);
    return { ctx, pick };
  };
  const sources = (ctx, ability) => ({ statics: [{ id: "dune-devourer:2", source: ctx.ref("devourer"), ability }] });
  const input = (pick, selected) => ({
    id: "play",
    cost: { kind: "printed" },
    optionalAdditional: [{ id: "kill-friendly", kind: "additional", selected, cost: { payments: [{ ...payment, choice: pick }] } }]
  });

  const paid = setup();
  assert.throws(
    () => finalizeCostPlan(paid.ctx, input(paid.pick, true), sources(paid.ctx, discount)),
    error => error instanceof CostPlanError && error.reason === "judge-required" &&
      /Descriptive cost predicates require an authoritative condition adapter/.test(error.message),
    "the authored gate is descriptive, so it is refused instead of silently applied"
  );

  const declared = setup();
  const componentScoped = { ...discount, condition: undefined, effect: { ...discount.effect, appliesTo: "optional-additional-costs-you-pay" } };
  const componentPlan = finalizeCostPlan(declared.ctx, input(declared.pick, true), sources(declared.ctx, componentScoped));
  assert.equal(componentPlan.total.energy, 4, "the component scope cannot subtract 2 from a 0-Energy kill component");
  assert.deepEqual(componentPlan.discounts.map(entry => [entry.component, entry.amount, entry.after]), [["kill-friendly", 2, 0]]);

  const declined = setup();
  const ungated = { ...discount, condition: undefined };
  const declinedPlan = finalizeCostPlan(declined.ctx, input(declined.pick, false), sources(declined.ctx, ungated));
  assert.equal(declinedPlan.total.energy, 2, "an ungated total discount fires even when the cost was declined (356.4.f.1 wants the decision)");
  assert.deepEqual(declinedPlan.declinedAdditional, ["kill-friendly"]);
});

test("Dune Devourer: production play binding preserves the optional additional cost", () => {
  const kernel = world()
    .hand("devourer", { cardId: CANONICAL, types: ["unit"], energy: 4, power: [] })
    .unit("friendly", { controller: "A" })
    .build();
  const source = kernel.getObject("devourer");
  const binding = createProgramBinding({
    cardPrograms: [{ ...program, status: "executable", judgeReason: undefined }]
  });
  const draft = binding.describePlay({ type: "play", object: source.ref, player: "A" }, source);
  assert.equal(draft.cost.optionalAdditional[0].kind, "additional");
});

test("Dune Devourer: merged Deflect and cost-modification declarations still stop at the static binder", () => {
  const source = world().unit("devourer", { types: ["unit"], controller: "A" }).build().getObject("devourer");
  const binder = createEngineStaticBinder({});
  assert.throws(
    () => binder.bindStatic(program.abilities[2], source),
    /Static ability kind continuous\.cost-modification has no layer mapping/
  );
  const [deflectStatic] = Deflect.expand({ host: { canonicalCardId: CANONICAL } });
  assert.throws(
    () => binder.bindStatic(deflectStatic, source),
    /Static ability kind target\.tax has no layer mapping/
  );
});

test.todo(
  'Dune Devourer: bind the optional kill cost from the CardProgram into Finalize and apply the printed total-cost -2 only when the player decided to pay (CR 356.2.b/356.2.b.1/356.4.d/356.4.f.1) — programs/play.ts translateCost rejects the declared cost, and the collector has no paid-decision predicate for a total-cost discount'
);
test.todo('Dune Devourer: bind Deflect target.tax through the program static layer and collect it at Finalize (CR 809.1.c)');
