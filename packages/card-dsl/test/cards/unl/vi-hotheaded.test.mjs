import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/vi-hotheaded.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
// card-dsl has no dependency edge on engine-core (engine-core depends on
// card-dsl), so golden execution loads the built engine through its workspace
// layout instead of the package name.
import { buildCostPlan } from "../../../../engine-core/dist/cost/cost-plan.js";
import { payCostPlan } from "../../../../engine-core/dist/cost/payment.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL_ID =
  "card.hash-8cb7905705a7f0e4995a084c0d8fa96d23d5387f51a0294a9e8cdc4250cb4b83";
const SOURCE_TEXT =
  "[Deflect] (Opponents must pay :rb_rune_rainbow: to choose me with a spell or ability.)\n" +
  ":rb_energy_2::rb_rune_fury:: Double my Might this turn.";

const [deflect, activated] = program.abilities;
const [doubleMight] = activated.body;

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
  assert.match(program.judgeReason, /RIFT-91/);
  assert.match(program.judgeReason, /RIFT-90/);
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
  assert.equal(doubleMight.id, "vi-hotheaded.double-might");
  // No merged continuous.might primitive exists; the op records the intended
  // arithmetic-layer effect (see judgeReason) and must not be approximated with
  // effect.buff.
  assert.equal(doubleMight.op, "continuous.might");
  // 433.1 / 433.1.a (whose worked example is this wording): the amount is the
  // attribute's CURRENT value, read when the doubling is performed.
  assert.deepEqual(doubleMight.args.amount, {
    kind: "object-property",
    object: "self",
    property: "might"
  });
  assert.deepEqual(doubleMight.args.duration, { kind: "constant", value: "this-turn" });
  assert.deepEqual(doubleMight.args.layer, { kind: "constant", value: "arithmetic" });
  assert.deepEqual(doubleMight.args.mode, { kind: "constant", value: "add" });
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
  assert.deepEqual(ctx.player("A").power, ["Fury"]);
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

test("unl-030-219 Vi, Hotheaded: the doubling amount reads the live Might characteristic", () => {
  // The authored amount is an object-property read of the source's Might, so
  // the instruction cannot be mistaken for a fixed +3; the value is only known
  // at resolution (433.1.a's worked example).
  const kernel = world().unit("vi", { might: 3 }).build();
  const ctx = kernel.clone({ sourceSnapshot: kernel.getObject("vi") });
  assert.equal(ctx.evaluate(doubleMight.args.amount), 3);
  // The card program never writes a substitute fixed amount.
  assert.equal(doubleMight.args.amount.value, undefined);
});

test.todo(
  "unl-030-219 Vi, Hotheaded: perform the 433.1 Doubling as an arithmetic-layer Might modification with a" +
    " this-turn duration and cleanup expiry (CR 433.1.a / 475 / 478; no continuous.might instruction is" +
    " merged — RIFT-91)"
);
test.todo(
  "unl-030-219 Vi, Hotheaded: append the [Deflect] target tax when an opponent chooses this unit (CR 809.1.c;" +
    " RIFT-90 target tax + RIFT-89 cost.pay merge)"
);
