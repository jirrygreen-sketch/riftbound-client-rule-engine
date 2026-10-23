import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/vi-hotheaded.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
// card-dsl has no dependency edge on engine-core (engine-core depends on
// card-dsl), so golden execution loads the built engine through its workspace
// layout instead of the package name.
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { buildCostPlan } from "../../../../engine-core/dist/cost/cost-plan.js";
import { payCostPlan } from "../../../../engine-core/dist/cost/payment.js";
import { createLayerEngine } from "../../../../engine-core/dist/layers/index.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import { createEngineStaticBinder } from "../../../../engine-core/dist/programs/statics.js";
import { boundTargetTaxes } from "../../../../engine-core/dist/programs/static-adapters/capabilities.js";
import { fixture } from "../../../../engine-core/test/chain/helpers.mjs";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL_ID =
  "card.hash-8cb7905705a7f0e4995a084c0d8fa96d23d5387f51a0294a9e8cdc4250cb4b83";
const SOURCE_TEXT =
  "[Deflect] (Opponents must pay :rb_rune_rainbow: to choose me with a spell or ability.)\n" +
  ":rb_energy_2::rb_rune_fury:: Double my Might this turn.";

const [deflect, activated] = program.abilities;
const [readMight, doubleMight] = activated.body;

test("unl-030-219 Vi, Hotheaded: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("unl-030-219 Vi, Hotheaded: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL_ID), program);
  assert.match(program.judgeReason, /433\.1/);
  assert.match(program.judgeReason, /continuous\.might/);
  assert.match(program.judgeReason, /target\.tax/);
  // The refreshed reason names the two observed gaps instead of a task number.
  assert.match(program.judgeReason, /no layer mapping/);
  assert.match(program.judgeReason, /809\.1\.c\.1/);
  assert.doesNotMatch(program.judgeReason, /RIFT-/);
});

test("unl-030-219 Vi, Hotheaded: [Deflect] declared without a value (CR 809.1.b.3 presumes 1)", () => {
  assert.equal(program.abilities.length, 2);
  assert.deepEqual(deflect, { kind: "keyword", keyword: "deflect" });
  assert.equal(deflect.value, undefined);
});

test("unl-030-219 Vi, Hotheaded: 2 Energy + 1 Fury Power at Action speed", () => {
  assert.equal(activated.kind, "activated");
  // 381 / 381.1: no [Action]/[Reaction] is printed, so the default Open-State
  // Action timing applies.
  assert.equal(activated.timing, "action");
  // 404.1.a / 415.5: the printed ":rb_energy_2::rb_rune_fury:" is the cost.
  assert.deepEqual(activated.cost, {
    kind: "activated",
    energy: { kind: "constant", value: 2 },
    power: { kind: "constant", value: ["Fury"] }
  });
  assert.equal(activated.restriction, undefined);
});

test("unl-030-219 Vi, Hotheaded: Doubling reads the source's current Might at resolution", () => {
  // 433.1 / 433.1.a：增量是结算时的当前值。第一步用 condition.value 绑定原语读出 source.might，
  // 第二步以 linked-value 作为 continuous.might 的 amount，避免把数值写死成印刷值。
  assert.equal(readMight.id, "vi-hotheaded.read-might");
  assert.equal(readMight.op, "condition.value");
  assert.deepEqual(readMight.args.value, {
    kind: "object-property",
    object: "self",
    property: "might"
  });
  assert.deepEqual(readMight.args.key, { kind: "constant", value: "might" });
  assert.equal(readMight.targets, undefined);
  assert.equal(readMight.picks, undefined);
  assert.equal(readMight.linkedTo, undefined);

  assert.equal(activated.body.length, 2);
  assert.equal(doubleMight.id, "vi-hotheaded.double-might");
  assert.equal(doubleMight.op, "continuous.might");
  assert.deepEqual(doubleMight.args.amount, {
    kind: "linked-value",
    instructionId: "vi-hotheaded.read-might",
    key: "might"
  });
  assert.deepEqual(doubleMight.args.duration, { kind: "constant", value: "this-turn" });
  assert.deepEqual(doubleMight.args.mode, { kind: "constant", value: "add" });
  assert.equal(doubleMight.args.layer, undefined);
  // "my Might" is a self-reference (355.10.g), so no TargetSpec is written and
  // the instruction cannot register a "becomes targeted" event.
  assert.equal(doubleMight.targets, undefined);
  assert.equal(doubleMight.picks, undefined);
  assert.equal(doubleMight.linkedTo, undefined);
});

test("unl-030-219 Vi, Hotheaded golden: the printed 2 Energy + 1 Fury cost is really payable", () => {
  const kernel = world()
    .player("A", { energy: 3, power: ["Fury"] })
    .unit("vi", { might: 3 })
    .build();
  const ctx = kernel.clone({ sourceSnapshot: kernel.getObject("vi") });
  const plan = buildCostPlan(ctx, { id: "vi-hotheaded", cost: activated.cost });
  const receipt = payCostPlan(ctx, plan);

  assert.equal(receipt.paid, true);
  assert.equal(receipt.total.energy, 2);
  assert.deepEqual(receipt.total.power[0].allowedDomains, ["Fury"]);
  assert.deepEqual(receipt.actions.map(action => action.action.type), ["pay"]);
  assert.equal(ctx.player("A").energy, 1);
  assert.deepEqual(ctx.player("A").power, []);
});

test("unl-030-219 Vi, Hotheaded golden: a non-Fury Power pool cannot pay the printed cost", () => {
  const kernel = world()
    .player("A", { energy: 3, power: ["Calm"] })
    .unit("vi", { might: 3 })
    .build();
  const ctx = kernel.clone({ sourceSnapshot: kernel.getObject("vi") });
  const plan = buildCostPlan(ctx, { id: "vi-hotheaded", cost: activated.cost });
  assert.throws(
    () => payCostPlan(ctx, plan),
    error => error.name === "CostPlanError" && error.reason === "cannot-pay-cost"
  );
  assert.equal(ctx.player("A").energy, 3);
  assert.deepEqual(ctx.player("A").power, ["Calm"]);
});

test("unl-030-219 Vi, Hotheaded golden: Doubling registers the live Might as an end-of-turn arithmetic change", () => {
  const kernel = world().unit("vi", { might: 4 }).build();
  const ctx = kernel.clone({ sourceSnapshot: kernel.getObject("vi") });
  const outcome = resolveChainBody(activated.body, ctx);

  assert.equal(outcome.status, "executed");
  assert.deepEqual(
    outcome.results.map(entry => [entry.id, entry.result.status]),
    [["vi-hotheaded.read-might", "executed"], ["vi-hotheaded.double-might", "executed"]]
  );
  // 433.1.a: the +N amount is the attribute's current value (here 4), not the
  // printed 3 (143.2.a: Might means effective/current Might).
  assert.equal(ctx.continuousEffects.length, 1);
  const [registration] = ctx.continuousEffects;
  assert.equal(registration.effect.layer, "arithmetic");
  assert.equal(registration.effect.effect.kind, "continuous.might");
  assert.equal(registration.effect.effect.amount, 4);
  assert.deepEqual(registration.effect.filter.objectId, "vi");
  assert.deepEqual(registration.duration, { type: "end-of-turn" });

  const registrations = ctx.continuousEffects.map(entry => ({ effect: entry.effect, duration: entry.duration, timestamp: 1 }));
  const engine = createLayerEngine(ctx.objects, registrations);
  assert.equal(engine.evaluate(ctx.ref("vi")).might, 8);
  // 317.1.a / 468.7.c: "this turn" expires in the Expiration Step.
  assert.equal(engine.expireAt("turn-end").length, 1);
  assert.equal(engine.evaluate(ctx.ref("vi")).might, 4);
});

test("unl-030-219 Vi, Hotheaded golden: Doubling reflects a smaller live Might instead of a fixed amount", () => {
  // 433.1.a (Last Stand example): the amount follows the current value, so a
  // 2-Might Vi doubles to 4 — the program never writes a substitute constant.
  const kernel = world().unit("vi", { might: 2 }).build();
  const ctx = kernel.clone({ sourceSnapshot: kernel.getObject("vi") });
  resolveChainBody(activated.body, ctx);
  assert.equal(ctx.continuousEffects[0].effect.effect.amount, 2);
  const engine = createLayerEngine(ctx.objects, ctx.continuousEffects.map(entry => ({ effect: entry.effect, duration: entry.duration, timestamp: 1 })));
  assert.equal(engine.evaluate(ctx.ref("vi")).might, 4);
});

test("unl-030-219 Vi, Hotheaded: the expanded Deflect declaration joins the production tax set", () => {
  const expansion = keywordDefinitionsById.get("Deflect").expand({ value: 1, host: { canonicalCardId: CANONICAL_ID } });
  assert.deepEqual(expansion.map(ability => [ability.kind, ability.effect.kind]), [
    ["static", "target.tax"]
  ]);
  const f = fixture({ cards: [{ id: "vi", cardId: CANONICAL_ID, types: ["unit"], might: 3 }] });
  f.engine.commit({ type: "move-zone", object: f.kernel.ref("vi"), to: "board" });
  const source = f.kernel.getObject("vi");
  const handle = createEngineStaticBinder(f.engine).bindStatic(expansion[0], source);
  assert.deepEqual(boundTargetTaxes(f.engine), [{
    id: "program-target-tax:vi:2:0",
    target: source.ref,
    effect: expansion[0].effect
  }]);
  handle.unbind();
});

test("unl-030-219 Vi, Hotheaded gap: the Deflect tax is booked as Energy, not any-domain Power", () => {
  // 809.1.c.1 requires the tax to be Power of any Domain. The chain Finalize
  // still converts whatever a caller supplies through the tax adapter into an
  // Energy component (chain/engine.ts), so the cost plan reports energy instead
  // of power. This is the second observed gap in judgeReason.
  const f = fixture({ choose: request => request.type === "select-objects" ? [f.kernel.ref("enemy")] : undefined });
  f.engine.execute({
    id: "vi-deflect-tax",
    controller: "A",
    source: f.kernel.getObject("source"),
    kind: "activated",
    speed: "action",
    body: [{ id: "draw", op: "effect.draw", args: { amount: { kind: "constant", value: 1 } } }],
    targets: [{
      requirement: { id: "vi-tax-target", filter: { type: "unit" }, min: 0, max: 1 },
      options: { tax: { kind: "deflect", amount: 2 } }
    }]
  });
  const item = f.engine.items[0];
  assert.deepEqual(item.costPlan.total, { energy: 2, power: [], xp: 0, actions: [] });
});

test.todo(
  "unl-030-219 Vi, Hotheaded: append the [Deflect] target tax when an opponent chooses this unit (CR 809.1.c;" +
    " target.tax consumer + any-domain Power payment"
);
