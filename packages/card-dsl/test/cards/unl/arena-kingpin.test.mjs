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
import { createProgramBinding } from "../../../../engine-core/dist/programs/index.js";
import { fixture, resolveAll } from "../../../../engine-core/test/chain/helpers.mjs";

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

test("unl-001-219 Arena Kingpin: identity, executable status and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "executable");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(program.judgeReason, undefined);
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

function boundKingpin() {
  const binding = createProgramBinding({ cardPrograms: [program] });
  const requests = [];
  const f = fixture({
    cards: [
      { id: "kingpin", cardId: CANONICAL_ID, types: ["unit"], energy: 5, power: null, might: 3 },
      { id: "other", owner: "B", controller: "B", types: ["unit"], might: 2 }
    ],
    describePlay: binding.describePlay,
    choose: request => {
      requests.push(request);
      if (request.type === "select-objects") {
        const selected = request.options.find(ref => ref.id === "other");
        assert.ok(selected, "the printed 'a unit' includes an opponent's unit");
        return [selected];
      }
    }
  });
  f.engine.commit({ type: "move-zone", object: f.kernel.ref("other"), to: "battlefield", location: { type: "battlefield", id: "battlefield-1" } });
  f.engine.advance();
  const errors = [];
  binding.attachLifecycle(f.engine, error => errors.push(error));
  f.engine.commit({ type: "play", object: f.kernel.ref("kingpin"), player: "A", location: { type: "battlefield", id: "battlefield-1" } });
  f.engine.advance();
  resolveAll(f.engine);
  assert.deepEqual(errors, []);
  return { ...f, binding, requests };
}

test("unl-001-219 Arena Kingpin golden: production play applies the entry replacement before Board entry", () => {
  const f = boundKingpin();
  assert.equal(f.kernel.getObject("kingpin").zone, "board");
  assert.equal(f.kernel.getObject("kingpin").exhausted, false);
  assert.equal(f.kernel.player("A").energy, 15);
  const entry = f.engine.pipeline.events.find(event => event.timingPoint === "object-enters-board" && event.object?.ref.id === "kingpin");
  assert.equal(entry.object.exhausted, false, "the first Board snapshot is already ready");
  assert.equal(f.engine.pipeline.events.filter(event =>
    ["object-readied", "object-exhausted"].includes(event.timingPoint) && event.object?.ref.id === "kingpin"
  ).length, 0, "entry orientation produces no intermediate ready/exhaust event on Board");
});

test("unl-001-219 Arena Kingpin golden: production activation pays Exhaust, locks a unit and grants +3 Might", () => {
  const f = boundKingpin();
  f.engine.execute(f.binding.describeActivate(f.kernel.getObject("kingpin"), "A"));
  assert.equal(f.kernel.getObject("kingpin").exhausted, true);
  assert.equal(f.engine.layers.snapshot(f.kernel.ref("other")).might, 2, "the grant waits for resolution");
  assert.deepEqual(f.requests.at(-1).options.map(ref => ref.id).sort(), ["enemy", "kingpin", "other", "source"]);
  resolveAll(f.engine);
  f.engine.layers.setObjects(f.kernel.objects);
  assert.equal(f.engine.layers.snapshot(f.kernel.ref("other")).might, 5);
  assert.equal(f.engine.layers.snapshot(f.kernel.ref("kingpin")).might, 3);
  assert.equal(f.kernel.player("A").energy, 15);
  assert.equal(f.engine.pipeline.events.filter(event =>
    event.timingPoint === "object-exhausted" && event.object?.ref.id === "kingpin"
  ).length, 1);
  assert.throws(() => f.engine.execute(f.binding.describeActivate(f.kernel.getObject("kingpin"), "A")), /exhaust|cost|pay/i);
});

test("unl-001-219 Arena Kingpin golden: a locked target leaving Board keeps the paid activation cost", () => {
  const f = boundKingpin();
  f.engine.execute(f.binding.describeActivate(f.kernel.getObject("kingpin"), "A"));
  f.engine.commit({ type: "kill", object: f.kernel.ref("other") });
  f.engine.advance();
  resolveAll(f.engine);
  assert.equal(f.kernel.getObject("other").zone, "trash");
  assert.equal(f.kernel.getObject("kingpin").exhausted, true);
  assert.equal(f.engine.layers.registry.list().length, 0);
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
  // This is the isolated ready primitive. The production entry tests above
  // verify that the same declaration rewrites orientation before Board entry.
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

