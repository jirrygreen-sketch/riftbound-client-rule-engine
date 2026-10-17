import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/arena-kingpin.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { buildCostPlan } from "../../../../engine-core/dist/cost/cost-plan.js";
import { payCostPlan, prepareCostPayment } from "../../../../engine-core/dist/cost/payment.js";
import { CostPlanError } from "../../../../engine-core/dist/cost/plan-types.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import ready from "../../../../engine-core/dist/effects/instructions/effect.ready.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import { createLayerEngine } from "../../../../engine-core/dist/layers/index.js";
import { bindReplacement } from "../../../../engine-core/dist/replacement/index.js";

const CANONICAL_ID =
  "card.hash-42a7a3191d0a9e6cd6ac270c7dc6e9f36ee510fbfccf82e3b005ffd797864187";
const SOURCE_TEXT = "I enter ready.\n:rb_exhaust:: Give a unit +3 :rb_might: this turn.";

const [enterReady, activated] = program.abilities;
const [grantMight] = activated.body;
const targetSpec = grantMight.targets[0];

test("unl-001-219 Arena Kingpin: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("unl-001-219 Arena Kingpin: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /369\.3/);
  assert.match(program.judgeReason, /continuous\.might/);
  assert.match(program.judgeReason, /415\.5/);
  // The Might half is merged (RIFT-258) and verified by execution below; the
  // remaining gap is the RIFT-257 binding of the entry replacement.
  assert.match(program.judgeReason, /RIFT-257/);
  assert.doesNotMatch(program.judgeReason, /effects\/instructions\/ 下没有该 op/);
});

test("unl-001-219 Arena Kingpin: 'I enter ready' is an entry replacement, not a post-entry ready", () => {
  assert.equal(program.abilities.length, 2);
  assert.equal(enterReady.kind, "replacement");
  // 143.4 / 359.2.c: units enter the Board exhausted; 369.3 describes the
  // replacement by how the unit enters, filtered to this card's own entry.
  assert.deepEqual(enterReady.replaces, {
    event: "object-enters-board",
    filter: { self: true, exhausted: true }
  });
  assert.equal(enterReady.condition, undefined);
  assert.equal(enterReady.with.length, 1);
  assert.equal(enterReady.with[0].id, "arena-kingpin.enter-ready");
  assert.equal(enterReady.with[0].op, "effect.ready");
  assert.deepEqual(enterReady.with[0].args.objects, {
    kind: "constant",
    value: { kind: "source" }
  });
});

test("unl-001-219 Arena Kingpin: the printed cost is 'Exhaust me' at Action speed", () => {
  assert.equal(activated.kind, "activated");
  // 145.2 / 377.1: a colon after the cost introduces the activated ability; no
  // [Reaction] is printed, so it uses the default Action timing.
  assert.equal(activated.timing, "action");
  assert.deepEqual(activated.cost, {
    kind: "activated",
    payments: [{ kind: "exhaust", object: "self" }]
  });
  // 415.5: [E] is the "Exhaust this" cost; there is no printed Energy cost and
  // the omitted Energy is never written as 0.
  assert.equal(activated.cost.energy, undefined);
  assert.equal(activated.restriction, undefined);
});

test("unl-001-219 Arena Kingpin: 'Give a unit +3 Might this turn' targets one unit on the Board", () => {
  assert.deepEqual(activated.body.map(instruction => instruction.id), ["arena-kingpin.grant-might"]);
  // RIFT-258's continuous.might takes objects/mode/amount/duration; the older
  // `layer` argument is rejected by the merged arg schema.
  assert.equal(grantMight.op, "continuous.might");
  assert.deepEqual(grantMight.args.mode, { kind: "constant", value: "add" });
  assert.equal(grantMight.args.layer, undefined);
  assert.deepEqual(grantMight.args.amount, { kind: "constant", value: 3 });
  assert.deepEqual(grantMight.args.duration, { kind: "constant", value: "end-of-turn" });
  assert.deepEqual(grantMight.args.objects, {
    kind: "constant",
    value: { kind: "target", id: "arena-kingpin.unit" }
  });
  // 355.9 / 355.10: "a unit" is chosen by the controller, so it is a target and
  // not a pick; no controller restriction is printed.
  assert.deepEqual(targetSpec, {
    id: "arena-kingpin.unit",
    filter: { zone: "board", type: "unit" },
    min: 1,
    max: 1,
    selection: "one"
  });
  assert.equal(grantMight.picks, undefined);
  assert.equal(grantMight.linkedTo, undefined);
});

test("unl-001-219 Arena Kingpin golden: +3 Might registers in the arithmetic layer and expires at end of turn", () => {
  // 143.2.a / 475 / 478: the merged continuous.might primitive writes one
  // arithmetic-layer registration with the end-of-turn duration; the layer
  // engine then reports the modified Might (RIFT-258).
  const kernel = world()
    .unit("kingpin", { controller: "A", location: { type: "battlefield", id: "bf-1" }, might: 3 })
    .unit("other", { controller: "B", location: { type: "battlefield", id: "bf-1" }, might: 2 })
    .build();
  kernel.setTargets("arena-kingpin.unit", [kernel.ref("other")]);
  const ctx = kernel.clone({ sourceSnapshot: kernel.getObject("kingpin"), controller: "A" });

  const outcome = resolveChainBody([grantMight], ctx);
  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.results.map(entry => [entry.id, entry.result.status]), [
    ["arena-kingpin.grant-might", "executed"]
  ]);
  assert.equal(ctx.continuousEffects.length, 1);
  const [registration] = ctx.continuousEffects;
  assert.equal(registration.effect.layer, "arithmetic");
  assert.equal(registration.effect.effect.kind, "continuous.might");
  assert.equal(registration.effect.effect.amount, 3);
  // RIFT-258 registers one per-object spec: the filter pins the resolved ref.
  assert.equal(registration.effect.filter.objectId, "other");
  assert.deepEqual(registration.duration, { type: "end-of-turn" });

  const layers = createLayerEngine(ctx.objects, ctx.continuousEffects.map(entry => ({ ...entry })));
  assert.equal(layers.evaluate(ctx.ref("other")).might, 5);
  const expired = layers.expireAt("turn-end");
  assert.equal(expired.length, 1);
  assert.equal(layers.evaluate(ctx.ref("other")).might, 2);
});

test("unl-001-219 Arena Kingpin golden: a target that left the Board is ignored (359.3.e.6)", () => {
  const kernel = world()
    .unit("kingpin", { controller: "A", location: { type: "battlefield", id: "bf-1" }, might: 3 })
    .unit("other", { controller: "B", location: { type: "battlefield", id: "bf-1" }, might: 2 })
    .build();
  const stale = kernel.ref("other");
  kernel.perform({ type: "kill", object: stale });
  kernel.setTargets("arena-kingpin.unit", [stale]);
  const ctx = kernel.clone({ sourceSnapshot: kernel.getObject("kingpin"), controller: "A" });

  const outcome = resolveChainBody([grantMight], ctx);
  assert.equal(outcome.status, "partial");
  assert.deepEqual(outcome.results[0].result, { status: "ignored", reason: "mistargeted" });
  assert.equal(ctx.continuousEffects.length, 0);
});

test.todo(
  "unl-001-219 Arena Kingpin: register 'I enter ready' as a board-entry replacement (CR 143.4 / 359.2.c / 369.3) — " +
    "the merged bindReplacement binds it (asserted below) but RIFT-257's attachLifecycle only calls the static " +
    "binder during object-enters-board, after the zone change already happened, so a card's replacement never " +
    "matches its own entry"
);

test("unl-001-219 Arena Kingpin golden: the merged replacement module accepts and applies the entry rewrite", () => {
  // The card's replacement shape is executable once it is bound before the
  // entry (Accelerate-class, RIFT-260); the golden binds it directly to show the
  // declared IR is real, not illustrative. Production binding is the RIFT-257
  // gap recorded above.
  const kernel = world()
    .unit("kingpin", { zone: "chain", controller: "A", exhausted: true })
    .build();
  const bound = bindReplacement(
    { replaces: enterReady.replaces, with: enterReady.with },
    kernel.ref("kingpin"),
    {
      host: { object: ref => kernel.object(ref), objects: () => kernel.objects, context: () => kernel },
      pipeline: { clock: { turn: 1 }, registerReplacement: () => {} }
    }
  );
  // The entry declaration is bound as the CR 369.3 orientation rewrite rather
  // than as a board-state action; the pipeline registration id is stable.
  assert.equal(bound.registration.id, "replacement:kingpin:1");
  assert.deepEqual(bound.registration.source.ref, { id: "kingpin", zoneEntryId: 1 });
  bound.cancel();
});

test("unl-001-219 Arena Kingpin: the printed 'Exhaust me' cost is payable through the merged cost pipeline", () => {
  const kernel = world()
    .player("A", { energy: 3 })
    .unit("kingpin", { zone: "board", types: ["unit"], controller: "A", exhausted: false })
    .build();
  const ctx = kernel.clone({ sourceSnapshot: kernel.object(kernel.ref("kingpin")) });
  const plan = buildCostPlan(ctx, { id: "arena-kingpin", cost: activated.cost });
  const receipt = payCostPlan(ctx, plan);
  assert.equal(receipt.paid, true);
  assert.equal(receipt.total.energy, 0);
  assert.deepEqual(receipt.actions.map(action => action.action.type), ["pay", "exhaust"]);
  assert.equal(ctx.object(ctx.ref("kingpin")).exhausted, true);
  assert.equal(ctx.player("A").energy, 3);
});

test("unl-001-219 Arena Kingpin: an already-exhausted source cannot pay the cost (CR 415.4)", () => {
  const kernel = world()
    .unit("kingpin", { zone: "board", types: ["unit"], controller: "A", exhausted: true })
    .build();
  const ctx = kernel.clone({ sourceSnapshot: kernel.object(kernel.ref("kingpin")) });
  const plan = buildCostPlan(ctx, { id: "arena-kingpin", cost: activated.cost });
  assert.throws(() => prepareCostPayment(ctx, plan), CostPlanError);
  assert.equal(ctx.object(ctx.ref("kingpin")).exhausted, true);
});

test("unl-001-219 Arena Kingpin: effect.ready in the replacement body readies the source", () => {
  // The replacement body's instruction uses a registered primitive and the
  // contract 3.6 symbolic selector; the entry-replacement pipeline that would
  // register and run it during board entry is still missing (judgeReason).
  const kernel = world()
    .unit("kingpin", { zone: "board", controller: "A", exhausted: true })
    .build();
  const ctx = kernel.clone({ sourceSnapshot: kernel.object(kernel.ref("kingpin")) });
  const outcome = runAbilityBody(enterReady.with, ctx);
  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.results.map(entry => [entry.id, entry.result.status]), [
    ["arena-kingpin.enter-ready", "executed"]
  ]);
  assert.deepEqual(ctx.events.map(event => event.action), ["ready"]);
  assert.equal(ctx.object(ctx.ref("kingpin")).exhausted, false);

  // 416.1.b/416.1.c: an already-ready object is not readied again.
  const readyKernel = world()
    .unit("kingpin", { zone: "board", controller: "A", exhausted: false })
    .build();
  const readyRun = runInstruction(
    ready,
    { objects: { kind: "source" } },
    { world: readyKernel.clone({ sourceSnapshot: readyKernel.object(readyKernel.ref("kingpin")) }) }
  );
  assert.equal(readyRun.result.status, "executed");
  assert.equal(readyRun.linked.readied.count, 0);
  assert.deepEqual(readyRun.events, []);
});

test("unl-001-219 Arena Kingpin: the generated card registry exposes the program under its canonical id", () => {
  assert.equal(cardRegistryById.get(CANONICAL_ID), program);
});

