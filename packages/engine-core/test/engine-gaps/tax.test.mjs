import assert from "node:assert/strict";
import test from "node:test";

import { bindResolveContext, createActionPipelineHost } from "../../dist/events/action-adapter.js";
import { finalizeTargetTax } from "../../dist/chain/finalize/target-tax.js";
import { ChainEngine } from "../../dist/chain/engine.js";
import { EventPipeline } from "../../dist/events/pipeline.js";
import { bindReplacement } from "../../dist/replacement/index.js";
import { finalizeTargetPlan, TargetSelectionError } from "../../dist/target/target-plan.js";
import { CostPlanError } from "../../dist/cost/plan-types.js";
import { DUEL_DOMAINS, planDuelRunePayment } from "../../dist/cost/resources.js";
import { world } from "../../dist/effects/testing/index.js";
import { createProgramBinding, createEngineStaticBinder } from "../../dist/programs/index.js";
import { KeywordGrantLayerEngine } from "../../dist/programs/keyword-grants.js";
import { matchesObjectFilter } from "../../dist/layers/filter.js";
import poutyPoro from "../../../card-dsl/dist/cards/ogn/pouty-poro.js";
import bird from "../../../card-dsl/dist/cards/unl/bird.js";
import fiora from "../../../card-dsl/dist/cards/ogn/fiora-victorious.js";

const c = value => ({ kind: "constant", value });
const requirement = (id = "target") => ({
  id,
  filter: { type: "unit", zone: "board" },
  min: 1,
  max: 1,
  selection: "one",
});

function context({ energy = 1, power = ["Calm"], enemyKeywords = [{ id: "Deflect" }], program, spellEnergy = 1 } = {}) {
  const kernel = world()
    .player("A", { energy, power })
    .player("B")
    .hand("spell", { types: ["spell"], energy: spellEnergy, power: [] })
    .unit("enemy", {
      owner: "B", controller: "B", might: 5,
      keywords: program ? [] : enemyKeywords,
      ...(program ? { cardId: program.canonicalCardId } : {}),
      ...(program === bird ? { energy: null, power: null } : {}),
    })
    .unit("other", { owner: "B", controller: "B", keywords: [{ id: "Deflect", value: 1 }] })
    .unit("gear", { owner: "A", controller: "A", types: ["gear"] })
    .build();
  return kernel.clone({ sourceSnapshot: kernel.object(kernel.ref("spell")) });
}

// Inspect uses the production keyword expander without bypassing the
// registry's judge-required execution guard. The static/Chain owners still
// need to connect this bound set to the default Chain Finalize entry point.
function printedTaxes(ctx, program) {
  const target = ctx.ref("enemy");
  const binding = createProgramBinding({ cardPrograms: [program] });
  return binding.inspect(ctx.object(target)).abilities.flatMap((ability, index) =>
    ability.kind === "static" && ability.effect.kind === "target.tax"
      ? [{ id: `printed:${index}`, target, effect: ability.effect }]
      : []);
}

function printedCost() {
  return { id: "play", cost: { kind: "printed" } };
}

function selectedTarget(ctx, id = "target", object = "enemy") {
  return { requirement: requirement(id), options: { selected: [ctx.ref(object)] } };
}

function withRollback(ctx, pipeline) {
  return bindResolveContext(ctx, {
    perform: action => pipeline.commit(action),
    transaction(run) {
      const checkpoint = ctx.snapshot();
      const events = pipeline.checkpoint();
      try {
        return run();
      } catch (error) {
        ctx.restore(checkpoint);
        pipeline.restore(events);
        throw error;
      }
    },
  });
}

for (const program of [poutyPoro, bird]) {
  test(`EG-TAX original ${program === bird ? "Bird" : "Pouty Poro"} IR expands and pays any-domain Power through the Finalize consumer`, () => {
    const ctx = context({ program });
    const result = finalizeTargetTax({
      context: ctx,
      kind: "spell",
      cost: printedCost(),
      effects: printedTaxes(ctx, program),
      targets: [selectedTarget(ctx)],
    });

    assert.deepEqual(result.targetPlans[0].selected, [ctx.ref("enemy")]);
    assert.deepEqual(result.costPlan.total, {
      energy: 1,
      power: [{ amount: 1, allowedDomains: DUEL_DOMAINS }],
      xp: 0,
      actions: [],
    });
    assert.deepEqual(result.payment.actions[0].action.plan, {
      finalized: true,
      energy: 1,
      power: ["Calm"],
    });
    assert.deepEqual(ctx.player("A").power, []);
    assert.equal(ctx.player("A").energy, 0);
    if (program === bird) {
      assert.equal(ctx.object(ctx.ref("enemy")).energy, null);
      assert.equal(ctx.object(ctx.ref("enemy")).power, null);
    }
  });
}

test("EG-TAX keeps a tax requirement distinct from a Universal source", () => {
  const ctx = context({ power: ["Mind", "Fury"], enemyKeywords: [{ id: "Deflect", value: 2 }] });
  const result = finalizeTargetTax({
    context: ctx,
    kind: "ability",
    cost: { id: "ability", cost: { energy: c(0) } },
    targets: [selectedTarget(ctx)],
    pay: false,
  });
  assert.deepEqual(result.costPlan.total.power, [{ amount: 2, allowedDomains: DUEL_DOMAINS }]);
  const allocation = planDuelRunePayment({
    energy: 0,
    power: { Fury: 1, Calm: 0, Mind: 0, Body: 0, Chaos: 0, Order: 0, any: 1 },
  }, { energy: result.costPlan.total.energy, power: result.costPlan.total.power });
  assert.deepEqual(allocation.power, [
    { requirementIndex: 0, from: "Fury", amount: 1 },
    { requirementIndex: 0, from: "any", amount: 1 },
  ]);
  assert.deepEqual(result.costPlan.total.power, [{ amount: 2, allowedDomains: DUEL_DOMAINS }]);
});

test("EG-TAX ignoreDeflect suppresses only value-based Deflect for this payment", () => {
  const ctx = context({ power: [], enemyKeywords: [{ id: "Deflect", value: 2 }] });
  const result = finalizeTargetTax({
    context: ctx,
    kind: "spell",
    cost: printedCost(),
    ignoreDeflect: true,
    targets: [selectedTarget(ctx)],
  });
  assert.deepEqual(result.costPlan.total.power, []);
  assert.equal(result.payment.actions[0].action.plan.energy, 1);

  assert.throws(() => finalizeTargetTax({
    context: ctx, kind: "ability", targets: [selectedTarget(ctx)],
  }), error => error instanceof TargetSelectionError && error.code === "no-legal-targets");

  const otherContext = context({ power: [] });
  const explicit = finalizeTargetTax({
    context: otherContext,
    kind: "spell",
    cost: { id: "play", cost: { energy: c(0) } },
    ignoreTax: true,
    effects: [{
      id: "card-tax",
      target: otherContext.ref("enemy"),
      effect: { kind: "target.tax", cost: { energy: c(1) }, appliesTo: "spells" },
    }],
    targets: [selectedTarget(otherContext)],
    pay: false,
  });
  assert.equal(explicit.costPlan.total.energy, 1);
});

test("EG-TAX keeps the explicit target-tax hook inside the same ignore window", () => {
  const ctx = context({ program: poutyPoro, power: [] });
  const amount = printedTaxes(ctx, poutyPoro)[0].effect.value.value;
  const ignored = finalizeTargetTax({ context: ctx, kind: "ability", ignoreTax: true, pay: false });
  const options = { selected: [ctx.ref("enemy")], tax: { kind: "deflect", amount } };
  const selected = finalizeTargetPlan(ctx, requirement(), { ...options, taxAdapter: ignored.adapter });
  assert.deepEqual(selected.selected, [ctx.ref("enemy")]);
  assert.deepEqual(ignored.adapter.costPlan.total.power, []);
  const active = finalizeTargetTax({ context: ctx, kind: "ability", pay: false });
  const before = active.adapter.costPlan;
  assert.throws(() => finalizeTargetPlan(ctx, requirement(), { ...options, taxAdapter: active.adapter }),
    error => error instanceof TargetSelectionError && error.code === "target-tax-unpayable");
  assert.equal(active.adapter.costPlan, before);
  assert.deepEqual(ctx.player("A").power, []);
});

test("EG-TAX rejects a combined unaffordable selection before target notifications", () => {
  const ctx = context({ power: ["Calm"] });
  const events = [];
  assert.throws(
    () => finalizeTargetTax({
      context: ctx,
      kind: "spell",
      cost: printedCost(),
      targets: [{
        requirement: { ...requirement("many"), selection: "any", max: 2 },
        options: {
          selected: [ctx.ref("enemy"), ctx.ref("other")],
          onTargetsFinalized: event => events.push(event),
          onTargeted: event => events.push(event),
        },
      }],
    }),
    error => error instanceof TargetSelectionError && error.code === "target-tax-unpayable",
  );
  assert.deepEqual(events, []);
  assert.deepEqual(ctx.player("A"), {
    id: "A", energy: 1, power: ["Calm"], runePool: [], runes: [], xp: 0, score: 0,
    handSize: 1, handCount: 1, deckSize: 0, deckCount: 0, runeDeckSize: 0, runeDeckCount: 0,
  });
});

test("EG-TAX resolve rechecks a locked target without collecting or refunding its tax", () => {
  const ctx = context({ program: poutyPoro });
  const result = finalizeTargetTax({
    context: ctx,
    kind: "spell",
    cost: printedCost(),
    effects: printedTaxes(ctx, poutyPoro),
    targets: [selectedTarget(ctx)],
  });
  const paidPlan = result.adapter.costPlan;
  assert.equal(paidPlan.components.filter(component => component.stage === "mandatory-additional").length, 1);
  const locked = result.targetPlans[0];
  assert.equal(ctx.perform({ type: "move-zone", object: ctx.ref("enemy"), to: "hand" }).status, "done");
  const resolution = result.adapter.resolveTargetPlan(locked);
  assert.equal(resolution.status, "ignored");
  assert.equal(result.adapter.costPlan, paidPlan);
  assert.equal(result.adapter.costPlan.total.power[0].amount, 1);
  assert.deepEqual(ctx.player("A").power, []);
  assert.equal(ctx.player("A").energy, 0);
});

test("EG-TAX outer Finalize transaction rolls back payment prevented by real replacement IR", () => {
  const raw = context({ program: poutyPoro });
  const host = createActionPipelineHost({
    checkpoint: () => raw.snapshot(), restore: snapshot => raw.restore(snapshot),
    objects: () => raw.objects, perform: action => raw.perform(action),
    choose: request => raw.choose(request),
    context: (source, controller, timingPoint) => bindResolveContext(raw, { source, controller, timingPoint }),
  });
  const pipeline = new EventPipeline(host, ["A", "B"], "A");
  bindReplacement({
    replaces: {},
    with: [{ id: "replace-exhaust", op: "replacement.event", args: {
      event: c({ event: "object-exhausted", filter: { objectId: "gear" } }),
      // The production replacement planner interprets an empty instead body
      // as prevention; no callback substitutes for replacement processing.
      instead: [],
    } }],
  }, raw.ref("gear"), {
    host: { object: ref => raw.object(ref), objects: host.objects, context: host.context }, pipeline,
  });
  const ctx = withRollback(raw, pipeline);
  const gear = ctx.ref("gear");
  const before = raw.snapshot();
  const eventsBefore = pipeline.events;
  assert.throws(
    () => finalizeTargetTax({
      context: ctx,
      kind: "spell",
      effects: printedTaxes(ctx, poutyPoro),
      cost: {
        id: "play",
        cost: {
          payments: [
            { kind: "energy", amount: c(1) },
            { kind: "exhaust", object: gear },
          ],
        },
      },
      targets: [selectedTarget(ctx)],
    }),
    error => error instanceof CostPlanError && error.reason === "cannot-pay-cost" &&
      error.failedAction?.action.type === "exhaust" && error.outcome?.status === "prevented",
  );
  assert.deepEqual(raw.snapshot(), before);
  assert.deepEqual(pipeline.events, eventsBefore);
});

test("EG-TAX reselects the same original-IR target once per choice and preserves the prior plan on refusal", () => {
  const ctx = context({ power: ["Calm", "Mind"], program: poutyPoro });
  const result = finalizeTargetTax({
    context: ctx, kind: "ability", effects: printedTaxes(ctx, poutyPoro),
    targets: [selectedTarget(ctx)], pay: false,
  });
  const first = result.targetPlans[0];
  const events = [];
  const second = result.adapter.reselectTargetPlan(first, {
    selected: [ctx.ref("enemy")], onTargetsFinalized: event => events.push(event),
  });
  assert.equal(events[0].reselected, true);
  assert.deepEqual(second.selected, first.selected);
  assert.equal(result.adapter.costPlan.total.power.reduce((sum, cost) => sum + cost.amount, 0), 2);
  const previous = result.adapter.costPlan;
  assert.throws(() => result.adapter.reselectTargetPlan(second, { selected: [ctx.ref("enemy")] }),
    error => error instanceof TargetSelectionError && error.code === "invalid-target-choice");
  assert.equal(result.adapter.costPlan, previous);
  assert.deepEqual(ctx.player("A").power, ["Calm", "Mind"]);
});

test("EG-TAX retains a strict base Domain while allocating an any-domain tax", () => {
  const ctx = context({ power: ["Calm", "Fury"], program: poutyPoro });
  const result = finalizeTargetTax({
    context: ctx, kind: "spell", effects: printedTaxes(ctx, poutyPoro),
    cost: { id: "strict", cost: { payments: [{ kind: "power", amount: c(1), allowedDomains: ["Fury"] }] } },
    targets: [selectedTarget(ctx)],
  });
  assert.deepEqual(result.costPlan.total.power, [
    { amount: 1, allowedDomains: ["Fury"] },
    { amount: 1, allowedDomains: DUEL_DOMAINS },
  ]);
  assert.deepEqual(ctx.player("A").power, []);
});

test("EG-TAX rejects a stale original-IR zone entry without paying", () => {
  const ctx = context({ program: poutyPoro });
  const targets = [selectedTarget(ctx)];
  const effects = printedTaxes(ctx, poutyPoro);
  assert.equal(ctx.perform({ type: "move-zone", object: ctx.ref("enemy"), to: "hand" }).status, "done");
  assert.equal(ctx.perform({ type: "move-zone", object: ctx.ref("enemy"), to: "board" }).status, "done");
  const before = ctx.snapshot();
  assert.throws(() => finalizeTargetTax({ context: ctx, kind: "spell", cost: printedCost(), targets, effects }),
    error => error instanceof TargetSelectionError && error.code === "invalid-target-choice");
  assert.deepEqual(ctx.snapshot(), before);
});

test("EG-TAX does not replace a missing printed cost with zero", () => {
  const ctx = context({ spellEnergy: null });
  const before = ctx.snapshot();
  assert.throws(() => finalizeTargetTax({
    context: ctx, kind: "spell", cost: printedCost(), targets: [selectedTarget(ctx)],
  }), error => error instanceof CostPlanError && error.reason === "missing-printed-cost");
  assert.throws(() => finalizeTargetTax({
    context: ctx, kind: "spell", targets: [selectedTarget(ctx)],
  }), error => error instanceof CostPlanError && error.reason === "missing-printed-cost");
  assert.deepEqual(ctx.snapshot(), before);
  assert.equal(ctx.source.energy, null);
});

test("EG-TAX uses a spell's printed cost when the caller omits a cost override", () => {
  const ctx = context({ program: poutyPoro });
  const result = finalizeTargetTax({
    context: ctx, kind: "spell", effects: printedTaxes(ctx, poutyPoro),
    targets: [selectedTarget(ctx)],
  });
  assert.equal(result.costPlan.total.energy, 1);
  assert.equal(ctx.player("A").energy, 0);
  assert.deepEqual(ctx.player("A").power, []);
});

test("EG-TAX opens the enclosing transaction before the real base-cost choice", () => {
  const raw = context({ program: poutyPoro });
  raw.setAnswers({ "activation:base": "energy" });
  let active = false;
  const choices = [];
  const ctx = bindResolveContext(raw, {
    choose(request) {
      choices.push({ id: request.id, active });
      return raw.choose(request);
    },
  });
  const result = finalizeTargetTax({
    context: ctx, kind: "ability", effects: printedTaxes(ctx, poutyPoro),
    cost: {
      id: "activation", cost: { kind: "activated" },
      baseChoices: [{ id: "energy", cost: { energy: c(1) } }],
    },
    targets: [selectedTarget(ctx)],
    payment: { transaction(run) {
      const checkpoint = raw.snapshot();
      active = true;
      try { return run(); }
      catch (error) { raw.restore(checkpoint); throw error; }
      finally { active = false; }
    } },
  });
  assert.deepEqual(choices, [{ id: "activation:base", active: true }]);
  assert.equal(result.payment.paid, true);
  assert.equal(active, false);
  assert.equal(raw.player("A").energy, 0);
  assert.deepEqual(raw.player("A").power, []);
});

test("EG-TAX reads Fiora's original conditional grant from current layers and revokes it on unbind", () => {
  const ctx = context({ program: fiora });
  const layers = new KeywordGrantLayerEngine(ctx.objects, {
    context: source => bindResolveContext(ctx, { source, controller: source.controller }),
  });
  const host = createActionPipelineHost({
    checkpoint: () => ctx.snapshot(), restore: snapshot => ctx.restore(snapshot),
    objects: () => ctx.objects, perform: action => ctx.perform(action),
    choose: request => ctx.choose(request),
    context: (source, controller, timingPoint) => bindResolveContext(ctx, { source, controller, timingPoint }),
  });
  const engine = new ChainEngine({ host, layers, turnOrder: ["A", "B"], turnPlayer: "A", phase: "main" });
  const handle = createEngineStaticBinder(engine).bindStatic(fiora.abilities[0], ctx.object(ctx.ref("enemy")));
  const layered = bindResolveContext(ctx, {
    object: ref => layers.snapshot(ref),
    query: filter => layers.evaluateAll().filter(object => matchesObjectFilter(filter, object)),
  });
  const result = finalizeTargetTax({ context: layered, kind: "ability", targets: [selectedTarget(ctx)] });
  assert.equal(result.costPlan.total.power[0].amount, 1);
  assert.deepEqual(ctx.player("A").power, []);
  handle.unbind();
  assert.deepEqual(layers.snapshot(ctx.ref("enemy")).keywords, []);
  const next = finalizeTargetTax({ context: layered, kind: "ability", targets: [selectedTarget(ctx)] });
  assert.equal(next.costPlan, undefined);
});
