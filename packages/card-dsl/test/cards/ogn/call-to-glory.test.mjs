// Execution evidence: ../templates/keyword-play-continuous-might-683.test.mjs
// (RIFT-683). Each row of that suite runs this program's original abilities,
// target predicate, printed base cost and continuous.might body through the real
// card scenario harness; the measured-gate test there executes the optional
// spend-buff cost and the ignore-base rewrite and asserts their real rejection.
// This file keeps the validation, identity, structure and primitive-level
// evidence; the whole-card scenarios live in the template suite.
import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/ogn/call-to-glory.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import buff from "../../../../engine-core/dist/effects/instructions/effect.buff.js";
import might from "../../../../engine-core/dist/effects/instructions/continuous.might.js";
import { createLayerEngine } from "../../../../engine-core/dist/layers/index.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { translateObjectFilter } from "../../../../engine-core/dist/programs/filters.js";
import { buildCostPlan, payCostPlan } from "../../../../engine-core/dist/cost/index.js";
import { collectCostModifications } from "../../../../engine-core/dist/cost/discounts/index.js";

const CARD_ID = "card.hash-9eef9a0508648141992bbe70aa56b64551bbd00d06fd8be401c85dda6f542339";
const [reaction, optionalCost, costRewrite, play] = program.abilities;
const [mightInstruction] = play.body;
const mightSpec = mightInstruction.targets[0];

test("Call to Glory program is valid EffectIR v2 data", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("Call to Glory identity and judge-required status match the printing", () => {
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(program.judgeReason.includes("356.2.b"), true);
  assert.equal(program.judgeReason.includes("356.1.b"), true);
  assert.equal(program.judgeReason.includes("702.2.b"), true);
  assert.match(program.judgeReason, /可选追加费用/);
  assert.match(program.judgeReason, /ignore-base/);
  assert.match(program.judgeReason, /baseModifications\.ignore-base/);
  assert.match(program.judgeReason, /optionalCostPaid/);
  assert.equal(
    program.sourceText,
    "[Reaction] (Play any time, even before spells and abilities resolve.)\n" +
      "As you play this, you may spend a buff as an additional cost. If you do, ignore this spell's cost.\n" +
      "Give a unit +3 :rb_might: this turn."
  );
  assert.equal(cardRegistryById.get(program.canonicalCardId), program);
});

test("Call to Glory structure: Reaction, the optional spend-buff cost and the conditional ignore-base rewrite", () => {
  assert.deepEqual(reaction, { kind: "keyword", keyword: "reaction" });

  // 356.2.b.1: the Optional Additional Cost is specified by a Passive Ability on
  // the card being played, so it is declared as a static cost.additional effect
  // rather than inline on the play CostSpec (see the file header).
  assert.equal(optionalCost.kind, "static");
  assert.equal(optionalCost.effect.kind, "cost.additional");
  assert.equal(optionalCost.effect.appliesTo, "self");
  assert.equal(optionalCost.effect.optional, true);
  assert.equal(optionalCost.effect.stage, "optional-additional");
  const payment = optionalCost.effect.payments[0];
  assert.equal(payment.kind, "spend-buff");
  assert.deepEqual(payment.amount, { kind: "constant", value: 1 });
  assert.equal(payment.choice.id, "call-to-glory.spend-buff-payment");
  // 355.10.c.1: the buff's unit is not a target, so the cost carries a non-target
  // pick whose option set is resolved at Finalize (702.2.b.2).
  assert.equal(payment.choice.selection, "one");
  assert.equal(payment.choice.min, 1);
  assert.equal(payment.choice.max, 1);
  assert.deepEqual(payment.choice.options, ["buffed-unit-you-control"]);

  // 356.1.b.1: "ignore this spell's cost" zeroes the base cost, gated on the
  // optional payment being chosen (356.4.f.1); 356.1.b.3 keeps later costs.
  assert.equal(costRewrite.kind, "static");
  assert.equal(costRewrite.effect.kind, "continuous.cost-modification");
  assert.equal(costRewrite.effect.appliesTo, "self");
  assert.deepEqual(costRewrite.effect.amount, { kind: "constant", value: "ignore-base" });
  assert.deepEqual(costRewrite.effect.when, {
    kind: "constant",
    value: { optionalCostPaid: "call-to-glory.spend-buff-payment" }
  });

  // The play ability carries only the printed base cost: 3 Energy with no
  // printed Power (never rewritten to 0).
  assert.equal(play.kind, "play");
  assert.deepEqual(play.cost, { kind: "cost.printed", energy: { kind: "constant", value: 3 } });
});

test("Call to Glory structure: the +3 Might instruction with its single-unit target", () => {
  assert.equal(play.body.length, 1);
  assert.equal(mightInstruction.id, "call-to-glory.grant-might");
  assert.equal(mightInstruction.op, "continuous.might");
  assert.deepEqual(mightInstruction.args.amount, { kind: "literal", value: 3 });
  assert.deepEqual(mightInstruction.args.duration, { kind: "literal", value: "this-turn" });
  assert.deepEqual(mightInstruction.args.objects, {
    kind: "constant", value: { kind: "target", id: mightSpec.id }
  });
  assert.deepEqual(mightSpec, {
    id: "call-to-glory.unit",
    filter: { type: "unit", zone: "board" },
    min: 1,
    max: 1,
    selection: "one"
  });
  // "Give a unit ..." is a target (355.7), so it is a TargetSpec and never a pick.
  assert.equal(mightInstruction.picks, undefined);
});

test("Call to Glory target filter excludes unit cards outside the Board (355.9.a.1)", () => {
  const kernel = world()
    .unit("friendly", { owner: "A" })
    .unit("enemy", { owner: "B" })
    .card("hand-unit", { owner: "A", types: ["unit"], zone: "hand" })
    .card("trash-unit", { owner: "B", types: ["unit"], zone: "trash" })
    .card("board-gear", { owner: "A", types: ["gear"], zone: "board" })
    .build();
  assert.deepEqual(
    kernel.query(translateObjectFilter(mightSpec.filter)).map(object => object.ref.id).sort(),
    ["enemy", "friendly"]
  );
});

test("Call to Glory golden: the merged spend-buff payment consumes exactly one buff (702.2.b)", () => {
  // 702.2.b / 702.2.b.1 / 702.2.b.2 are implemented by effect.buff spend mode:
  // one counter leaves a unit the paying player controls, and a unit with no
  // buff is skipped rather than drained below zero.
  const kernel = world()
    .unit("buffed-unit", { owner: "A", controller: "A", buffs: 1 })
    .unit("unbuffed-unit", { owner: "A", controller: "A" })
    .build();
  const run = runInstruction(
    buff,
    { mode: "spend", target: "buff-holder", amount: { kind: "constant", value: 1 } },
    {
      world: kernel,
      targets: { "buff-holder": [kernel.ref("buffed-unit"), kernel.ref("unbuffed-unit")] }
    }
  );

  assert.equal(run.result.status, "executed");
  assert.equal(kernel.getObject("buffed-unit").buffs, 0);
  assert.equal(kernel.getObject("unbuffed-unit").buffs, 0);
  assert.deepEqual(run.events.map(event => event.action), ["spend-buff"]);
  assert.equal(run.linked.spentCount, 1);
});

test("Call to Glory golden: spending without any buff is a no-op, not an invented payment", () => {
  const kernel = world().unit("unbuffed-unit", { owner: "A", controller: "A" }).build();
  const run = runInstruction(
    buff,
    { mode: "spend", target: "buff-holder", amount: { kind: "constant", value: 1 } },
    { world: kernel, targets: { "buff-holder": [kernel.ref("unbuffed-unit")] } }
  );

  // 702.2.b.1: a buff cannot be spent from a Unit that does not have one, so
  // nothing happens and the payment cannot be claimed as made.
  assert.equal(run.result.status, "negated");
  assert.equal(run.result.reason, "skipped");
  assert.equal(kernel.getObject("unbuffed-unit").buffs, 0);
  assert.deepEqual(run.events, []);
});

test("Call to Glory golden: a stale buff pick leaves the unit untouched", () => {
  const kernel = world()
    .unit("buffed-unit", { owner: "A", controller: "A", buffs: 1 })
    .build();
  const stale = kernel.ref("buffed-unit");
  kernel.perform({ type: "return-to-hand", object: stale });
  const run = runInstruction(
    buff,
    { mode: "spend", target: "buff-holder", amount: { kind: "constant", value: 1 } },
    { world: kernel, targets: { "buff-holder": [stale] } }
  );

  assert.deepEqual(run.result, { status: "ignored", reason: "mistargeted" });
  assert.equal(kernel.getObject("buffed-unit").buffs, 1);
});

test("Call to Glory golden: the printed +3 Might executes through continuous.might and expires at end of turn", () => {
  const kernel = world()
    .unit("call-to-glory", { owner: "A", types: ["spell"], zone: "chain" })
    .unit("buffed-unit", { owner: "A", controller: "A", might: 2 })
    .build();
  const run = runInstruction(
    might,
    {
      amount: mightInstruction.args.amount,
      duration: mightInstruction.args.duration,
      target: mightSpec.id
    },
    { world: kernel, targets: { [mightSpec.id]: [kernel.ref("buffed-unit")] } }
  );

  assert.equal(run.result.status, "executed");
  assert.equal(kernel.continuousEffects.length, 1);
  assert.deepEqual(kernel.continuousEffects[0].duration, { type: "end-of-turn" });
  const engine = createLayerEngine(
    [kernel.getObject("buffed-unit")],
    kernel.continuousEffects.map((entry, index) => ({ ...entry, timestamp: index + 1 }))
  );
  const ref = kernel.ref("buffed-unit");
  assert.equal(engine.evaluate(ref).might, 5);
  // 317.2.c: "this turn" expires at the end-of-turn cleanup.
  engine.advance({ id: "turn-end" });
  assert.equal(engine.evaluate(ref).might, 2);
});

test.todo(
  "Call to Glory: binding the optional spend-buff cost and the conditional ignore-base rewrite into \"" +
    "the play cost plan (356.2.b/356.1.b.1/356.1.b.3) needs a CardProgram-to-CostPlanInput adapter with a " +
    "Finalize-time buff-holder option set; measured in keyword-play-continuous-might-683.test.mjs."
);

test("Call to Glory: the original Might body resolves through the production interpreter adapter", () => {
  const kernel = world().unit("chosen", { might: 2, buffs: 1 }).unit("other", { might: 4 }).build();
  kernel.setTargets(mightSpec.id, [kernel.ref("chosen")]);
  const result = resolveChainBody(play.body, kernel);
  assert.equal(result.status, "executed");
  const layers = createLayerEngine(kernel.objects, kernel.continuousEffects);
  assert.equal(layers.evaluate(kernel.ref("chosen")).might, 5);
  assert.equal(layers.evaluate(kernel.ref("other")).might, 4);
  assert.equal(kernel.getObject("chosen").buffs, 1);
  layers.advance({ id: "turn-end" });
  assert.equal(layers.evaluate(kernel.ref("chosen")).might, 2);
});

test("Call to Glory: the original body does not grant Might when its finalized target has left", () => {
  const kernel = world().unit("chosen", { might: 2 }).unit("other", { might: 4 }).build();
  const stale = kernel.ref("chosen");
  assert.equal(kernel.perform({ type: "return-to-hand", object: stale }).status, "done");
  kernel.setTargets(mightSpec.id, [stale]);
  const result = resolveChainBody(play.body, kernel);
  assert.equal(result.status, "partial");
  assert.equal(result.results[0].result.status, "ignored");
  assert.equal(kernel.continuousEffects.length, 0);
  assert.equal(kernel.getObject("chosen").zone, "hand");
  assert.equal(kernel.getObject("other").might, 4);
  assert.deepEqual(result.events, []);
});

test("Call to Glory supported cost plan ignores only the base and keeps the selected buff payment and later fees", () => {
  // Runtime options/baseModifications are cost-layer inputs; their CardProgram adapter remains missing.
  for (const selected of [true, false]) {
    const initial = world().player("A", { energy: 10 })
      .hand("glory", { cardId: CARD_ID, types: ["spell"], energy: 3, power: null })
      .unit("buffed", { buffs: 1 }).build();
    const ctx = initial.clone({ sourceSnapshot: initial.getObject("glory") });
    const payment = optionalCost.effect.payments[0];
    ctx.setPicks(payment.choice.id, [ctx.ref("buffed")]);
    const plan = buildCostPlan(ctx, {
      id: "glory:cost", cost: { kind: "printed" },
      ...(selected ? { baseModifications: [{ kind: "ignore-base", ignore: "resources" }] } : {}),
      optionalAdditional: [{
        id: optionalCost.effect.id, kind: "additional", selected,
        cost: { payments: [{ ...payment, choice: { ...payment.choice, options: [ctx.ref("buffed")] } }] }
      }],
      mandatoryAdditional: [{ id: "later-fee", cost: { energy: { kind: "constant", value: 2 } } }]
    });
    assert.deepEqual(plan.printed, { energy: 3, power: null });
    assert.equal(plan.total.energy, selected ? 2 : 5);
    assert.deepEqual(plan.total.power, []);
    assert.deepEqual(plan.selectedAdditional.map(entry => entry.id), selected ? [optionalCost.effect.id] : []);
    const receipt = payCostPlan(ctx, plan);
    assert.equal(receipt.paid, true);
    assert.deepEqual(receipt.additional, selected ? [{ id: optionalCost.effect.id, kind: "additional", paid: true }] : []);
    assert.deepEqual(receipt.events.map(event => event.action), selected ? ["pay", "spend-buff"] : ["pay"]);
    assert.equal(ctx.getObject("buffed").buffs, selected ? 0 : 1);
    assert.equal(ctx.player("A").energy, selected ? 8 : 5);
    assert.equal(ctx.getObject("glory").power, null);
  }
});

test("Call to Glory cost collector cannot interpret its declared optionalCostPaid gate", () => {
  const initial = world().hand("glory", { cardId: CARD_ID, types: ["spell"], energy: 3, power: null }).build();
  const ctx = initial.clone({ sourceSnapshot: initial.getObject("glory") });
  const before = ctx.snapshot();
  assert.throws(() => collectCostModifications(ctx, { id: "glory:cost", cost: { kind: "printed" } }, {
    statics: [{ id: "glory:rewrite", source: ctx.ref("glory"), ability: costRewrite }]
  }), error => error.reason === "judge-required" && /Unsupported cost condition/.test(error.message));
  assert.deepEqual(ctx.snapshot(), before);
});
