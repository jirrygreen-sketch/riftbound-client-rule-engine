import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/fiora-worthy.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import ready from "../../../../engine-core/dist/effects/instructions/effect.ready.js";
import costPay from "../../../../engine-core/dist/effects/instructions/cost.pay.js";
import { bindResolveContext, createActionPipelineHost } from "../../../../engine-core/dist/events/action-adapter.js";
import { deriveMightChangedEmissions } from "../../../../engine-core/dist/events/producers/might-change.js";
import { EventPipeline } from "../../../../engine-core/dist/events/pipeline.js";
import { triggerEventObjectBinding } from "../../../../engine-core/dist/events/pipeline-types.js";
import { matchesMightyTransition } from "../../../../engine-core/dist/events/pipeline-match.js";
import { ChainEngine } from "../../../../engine-core/dist/chain/engine.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { createProgramBinding, translateTriggerFilter } from "../../../../engine-core/dist/programs/index.js";
import { translateInstructionTargets } from "../../../../engine-core/dist/programs/filters.js";
import { adaptLeadingChoice } from "../../../../engine-core/dist/programs/trigger-adapters/leading-choice.js";
import { costPayArgsToCostSpec } from "../../../../engine-core/dist/programs/trigger-adapters/finalize-cost.js";
import { planDuelRunePayment } from "../../../../engine-core/dist/cost/resources.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL_ID =
  "card.hash-261f97a75639fd51dc63b8c4b2a577b52d5bd6893227a1a3a13da5375880fe6f";
const SOURCE_TEXT =
  "When a unit you control becomes [Mighty], you may pay :rb_rune_order: to ready it. " +
  "(A unit is Mighty while it has 5+ :rb_might:.)";
const OPTIONAL_ID = "fiora-worthy.opt-in";
const PAY_ID = "fiora-worthy.pay-order";
const READY_ID = "fiora-worthy.ready-event-it";
const [ability] = program.abilities;
const [optional] = ability.body;
const [payOrder, readyEventIt] = optional.args.body.value;

function productionFixture() {
  const kernel = world()
    .player("A", { power: ["Order"] })
    .player("B")
    .unit("fiora", {
      cardId: CANONICAL_ID,
      might: 3,
      exhausted: true,
      location: { type: "battlefield", id: "battlefield-1" }
    })
    .unit("target", {
      might: 4,
      exhausted: true,
      location: { type: "battlefield", id: "battlefield-1" }
    })
    .build();
  const binding = createProgramBinding({ cardPrograms: [program] });
  const questions = [];
  const choose = request => {
    questions.push(request);
    throw new Error(`Unexpected production choice ${request.id}`);
  };
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: saved => {
      kernel.restore(saved.state);
      kernel.copyLinkedFrom(saved.links);
    },
    objects: () => kernel.objects,
    perform: action => kernel.perform(action),
    choose,
    context: (source, controller, timingPoint) =>
      bindResolveContext(kernel, { source, controller, timingPoint, choose })
  });
  const engine = new ChainEngine({
    turnOrder: ["A", "B"],
    turnPlayer: "A",
    phase: "main",
    host,
    cleanup: () => false
  });
  const errors = [];
  binding.attachLifecycle(engine, error => errors.push(error));
  return { kernel, binding, engine, errors, questions };
}

test("sfd-180-221 Fiora, Worthy: program validates and has expected shape", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.equal(program.status, "judge-required");
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL_ID), program);
  assert.match(program.judgeReason, /becomesMighty/);
  assert.match(program.judgeReason, /might-changed/);
  assert.match(program.judgeReason, /event `it`/);
  assert.match(program.judgeReason, /effect\.ready/);
  assert.match(program.judgeReason, /Universal Power/);
});

test("sfd-180-221 Fiora, Worthy: might-changed trigger filtered to friendly units becoming Mighty", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "triggered");
  assert.equal(ability.trigger.at, "might-changed");
  assert.deepEqual(ability.trigger.filter, {
    event: "might-changed",
    object: {
      type: "unit",
      controller: "self",
      becomesMighty: true
    }
  });
  // The trigger is mandatory. The printed "you may" is represented by the
  // leading choice and moved to Finalize by the default adapter.
  assert.equal(ability.optional, false);
  assert.equal(ability.trigger.once, undefined);
  assert.equal(ability.trigger.condition, undefined);
});

test("sfd-180-221 Fiora, Worthy: leading may pays one Order Power and readies event:it", () => {
  assert.equal(ability.body.length, 1);
  assert.equal(optional.id, OPTIONAL_ID);
  assert.equal(optional.op, "choice.optional");
  assert.deepEqual(optional.args.body.value.map(instruction => [instruction.id, instruction.op]), [
    [PAY_ID, "cost.pay"],
    [READY_ID, "effect.ready"]
  ]);
  assert.deepEqual(payOrder.args.payments, {
    kind: "constant",
    value: { power: ["Order"] }
  });
  assert.equal(payOrder.args.energy, undefined);
  assert.deepEqual(costPayArgsToCostSpec(payOrder.args), {
    payments: [{
      kind: "power",
      amount: { kind: "constant", value: 1 },
      allowedDomains: ["Order"]
    }]
  });

  assert.equal(readyEventIt.op, "effect.ready");
  assert.deepEqual(readyEventIt.args.objects, {
    kind: "constant",
    value: { event: "it" }
  });
  assert.equal(readyEventIt.targets, undefined);
  assert.equal(readyEventIt.picks, undefined);
  assert.equal(readyEventIt.linkedTo, undefined);
});

test("sfd-180-221 Fiora, Worthy: the default leading-choice adapter moves may/pay to Finalize", () => {
  const kernel = world().unit("fiora", { cardId: CANONICAL_ID }).build();
  const translated = translateInstructionTargets(ability.body);
  const adapted = adaptLeadingChoice(kernel.getObject("fiora"), translated, ability.trigger);
  assert.ok(adapted);
  assert.equal(adapted.mayAtFinalize, true);
  assert.deepEqual(adapted.cost, {
    id: `cost:fiora:${kernel.ref("fiora").zoneEntryId}:${OPTIONAL_ID}`,
    cost: {
      payments: [{
        kind: "power",
        amount: { kind: "constant", value: 1 },
        allowedDomains: ["Order"]
      }]
    }
  });
  assert.deepEqual(adapted.body.map(instruction => instruction.id), [READY_ID]);
  assert.equal(adapted.body.some(instruction => instruction.op === "cost.pay"), false);
  assert.deepEqual(adapted.body[0].args.objects, {
    kind: "constant",
    value: { event: "it" }
  });
  assert.deepEqual(adapted.targets, []);
  // The legacy `source` spelling is not retained as a fallback.
  assert.equal(adapted.body.some(instruction =>
    JSON.stringify(instruction.args).includes('"kind":"source"')), false);
});

test("sfd-180-221 Fiora, Worthy: effect.ready body readies an exhausted unit via the merged primitive", () => {
  const kernel = world()
    .unit("mighty-unit", {
      zone: "board",
      location: { type: "battlefield", id: "battlefield-1" },
      might: 5,
      exhausted: true
    })
    .build();
  const scoped = kernel.clone({ sourceSnapshot: kernel.getObject("mighty-unit") });
  const run = runInstruction(
    ready,
    { objects: { kind: "constant", value: { kind: "source" } } },
    { world: scoped }
  );
  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.readied.count, 1);
  assert.equal(scoped.getObject("mighty-unit").exhausted, false);
  assert.equal(run.events[0].action, "ready");
});

test("sfd-180-221 Fiora, Worthy: the default trigger translator rejects becomesMighty on the unmodified program", () => {
  const { binding, engine, kernel } = productionFixture();
  assert.throws(
    () => translateTriggerFilter(ability.trigger.filter, "fiora", "might-changed"),
    error => error?.code === "judge-required" && /Unsupported filter field becomesMighty/.test(error.message)
  );
  assert.throws(
    () => binding.registerProgramTriggers(engine, kernel.getObject("fiora")),
    error => error?.code === "judge-required" && /default production path is incomplete/.test(error.message)
  );
  assert.equal(binding.registry.inspect(CANONICAL_ID), program);
  assert.equal(kernel.getObject("fiora").zone, "board");
});

test("sfd-180-221 Fiora, Worthy: a real layer action currently emits no scanned might-changed production event", () => {
  const { engine, kernel } = productionFixture();
  engine.advance();
  engine.execute({
    id: "fiora.might-probe",
    source: kernel.getObject("target"),
    controller: "A",
    kind: "activated",
    speed: "action",
    body: [{
      id: "fiora.add-one-might",
      op: "continuous.might",
      args: {
        amount: { kind: "constant", value: 1 },
        duration: { kind: "constant", value: "this-turn" },
        objects: { kind: "constant", value: { kind: "source" } }
      }
    }]
  });
  while (engine.items.length) engine.pass(engine.priority);
  engine.layers.setObjects(kernel.objects);
  assert.equal(engine.layers.evaluate(kernel.ref("target")).might, 5);
  assert.deepEqual(engine.pipeline.events.filter(event => event.timingPoint === "might-changed"), []);
  assert.ok(engine.trace.some(entry => entry.step === "resolved" && entry.item === "fiora.might-probe"));
});

test("sfd-180-221 Fiora, Worthy: the Mighty matcher implements the exact transition and incarnation boundary", () => {
  const before = {
    might: 4,
    ref: { id: "event-unit", zoneEntryId: 7 },
    zone: "board",
    types: ["unit"],
    controller: "A"
  };
  const after = { ...before, might: 5 };
  assert.equal(matchesMightyTransition(true, before, after), true);
  assert.equal(matchesMightyTransition(true, { ...before, might: 3 }, { ...before, might: 4 }), false);
  assert.equal(matchesMightyTransition(true, after, { ...after, might: 6 }), false);
  assert.equal(matchesMightyTransition(true, after, { ...after, might: 4 }), false);
  assert.equal(matchesMightyTransition(true, before, { ...after, controller: "B" }), false);
  assert.equal(matchesMightyTransition(true, before, { ...after, ref: { id: "event-unit", zoneEntryId: 8 } }), false);
  assert.equal(matchesMightyTransition(true, { ...before, might: null }, after), false);
});

test("sfd-180-221 Fiora, Worthy: raw might-changed events have before/after but no event:it", () => {
  const kernel = world()
    .unit("fiora", {
      cardId: CANONICAL_ID,
      might: 3,
      zone: "board",
      location: { type: "base", player: "A" }
    })
    .unit("event-unit", {
      exhausted: true,
      might: 4,
      location: { type: "battlefield", id: "battlefield-1" }
    })
    .build();
  const before = structuredClone(kernel.getObject("event-unit"));
  const after = { ...before, might: 5 };
  const derived = deriveMightChangedEmissions([before], [after], {
    batchId: "fiora-mighty",
    cause: "layer-recompute"
  })[0];
  assert.ok(derived);
  const pipeline = new EventPipeline(createActionPipelineHost({
    checkpoint: () => null,
    restore: () => {},
    objects: () => [kernel.getObject("fiora"), after],
    perform: () => ({ status: "impossible", events: [] }),
    choose: () => { throw new Error("event:it must not choose"); },
    context: () => ({})
  }), ["A", "B"], "A");
  const captures = [];
  pipeline.onTrigger = snapshot => captures.push(snapshot);
  pipeline.registerTrigger({
    id: "fiora-transition-observer",
    source: kernel.getObject("fiora"),
    controller: "A",
    spec: { at: "might-changed", filter: {} },
    body: []
  });
  const event = pipeline.emitBatch([derived], undefined, "fiora-mighty")[0];
  assert.equal(event.details.previousMight, 4);
  assert.equal(event.details.currentMight, 5);
  assert.deepEqual(event.details.before.ref, before.ref);
  assert.deepEqual(event.details.after.ref, after.ref);
  assert.equal(event.it, undefined);
  assert.equal(captures.length, 1);
  assert.equal(triggerEventObjectBinding(captures[0], "it"), null);
});

test("sfd-180-221 Fiora, Worthy: a real producer without event:it cannot arm Fiora's ready", () => {
  const before = {
    ref: { id: "target", zoneEntryId: 1 },
    cardId: "target",
    name: "target",
    types: ["unit"],
    tags: [],
    keywords: [],
    owner: "A",
    controller: "A",
    zone: "board",
    location: { type: "battlefield", id: "battlefield-1" },
    might: 4,
    energy: null,
    power: null,
    exhausted: true,
    damage: 0,
    stunned: false,
    buffs: 0,
    attachedTo: null,
    faceDown: false,
    isToken: false
  };
  const after = { ...before, might: 5 };
  const kernel = world()
    .unit("fiora", {
      cardId: CANONICAL_ID,
      controller: "A",
      zone: "board",
      location: { type: "base", player: "A" }
    })
    .unit("target", {
      owner: "A",
      controller: "A",
      might: 4,
      exhausted: true,
      zone: "board",
      location: { type: "battlefield", id: "battlefield-1" }
    })
    .build();
  const derived = deriveMightChangedEmissions([before], [after], {
    batchId: "raw-mighty",
    cause: "layer-recompute"
  })[0];
  assert.ok(derived);
  assert.equal(derived.it, undefined);
  const eventPipeline = new EventPipeline(createActionPipelineHost({
    checkpoint: () => null,
    restore: () => {},
    objects: () => [kernel.getObject("fiora"), kernel.getObject("target")],
    perform: () => ({ status: "impossible", events: [] }),
    choose: () => { throw new Error("unexpected choice"); },
    context: () => ({})
  }), ["A", "B"], "A");
  const seen = [];
  eventPipeline.onTrigger = snapshot => seen.push(snapshot);
  eventPipeline.registerTrigger({
    id: "fiora-raw-observer",
    source: kernel.getObject("fiora"),
    controller: "A",
    spec: { at: "might-changed", filter: {} },
    body: []
  });
  const event = eventPipeline.emitBatch([derived], undefined, "raw-mighty")[0];
  // The generic event itself is observable, but its raw worker emission has
  // no pronoun snapshot. This is the producer-side gap, independent of the
  // trigger filter and ready schema.
  assert.equal(event.it, undefined);
  assert.equal(seen.length, 1);
  assert.equal(triggerEventObjectBinding(seen[0], "it"), null);
});

test("sfd-180-221 Fiora, Worthy: accepting the leading cost pays exactly one Order Power once", () => {
  const kernel = world()
    .player("A", { power: ["Order", "Order"] })
    .unit("fiora", { cardId: CANONICAL_ID, might: 3, exhausted: true })
    .unit("target", { might: 4, exhausted: true })
    .build();
  const questions = [];
  const choose = request => {
    questions.push(request);
    if (request.type === "optional") return true;
    throw new Error(`Unexpected choice ${request.id}`);
  };
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: saved => { kernel.restore(saved.state); kernel.copyLinkedFrom(saved.links); },
    objects: () => kernel.objects,
    perform: action => kernel.perform(action),
    choose,
    context: (source, controller, timingPoint) => bindResolveContext(kernel, { source, controller, timingPoint, choose })
  });
  const engine = new ChainEngine({
    turnOrder: ["A", "B"], turnPlayer: "A", phase: "main", host, cleanup: () => false
  });
  const adapted = adaptLeadingChoice(
    kernel.getObject("fiora"),
    translateInstructionTargets(ability.body),
    ability.trigger
  );
  assert.ok(adapted);
  engine.enqueue({
    id: "fiora-finalize-cost-probe",
    source: kernel.getObject("fiora"),
    controller: "A",
    kind: "triggered",
    body: adapted.body,
    cost: adapted.cost,
    mayAtFinalize: adapted.mayAtFinalize
  });
  engine.advance();
  assert.deepEqual(questions.map(request => [request.type, request.id]), [
    ["optional", "finalize:fiora-finalize-cost-probe:optional"]
  ]);
  assert.equal(engine.items[0].status, "finalized");
  assert.equal(engine.items[0].payment.paid, true);
  assert.deepEqual(kernel.player("A").power, ["Order"]);
  const payment = engine.items[0].payment;
  assert.equal(payment.paid, true);
  assert.deepEqual(payment.total.power, [{
    amount: 1,
    allowedDomains: ["Order"]
  }]);
  assert.deepEqual(payment.actions.map(entry => entry.action), [{
    type: "pay",
    player: "A",
    plan: { finalized: true, energy: 0, power: ["Order"] }
  }]);
  assert.equal(engine.trace.some(entry => entry.step === "resolved"), false);
  assert.equal(payOrder.op, "cost.pay");
  assert.doesNotThrow(() => costPay.argsSchema.parse(payOrder.args));
});

test("sfd-180-221 Fiora, Worthy: declining the Finalize may removes the item before payment and Resolve", () => {
  const kernel = world()
    .player("A", { power: ["Order"] })
    .unit("fiora", { cardId: CANONICAL_ID, might: 3, exhausted: true })
    .build();
  const choose = request => request.type === "optional" ? false : (() => { throw new Error(`Unexpected choice ${request.id}`); })();
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: saved => { kernel.restore(saved.state); kernel.copyLinkedFrom(saved.links); },
    objects: () => kernel.objects,
    perform: action => kernel.perform(action),
    choose,
    context: (source, controller, timingPoint) => bindResolveContext(kernel, { source, controller, timingPoint, choose })
  });
  const engine = new ChainEngine({ turnOrder: ["A", "B"], turnPlayer: "A", phase: "main", host, cleanup: () => false });
  const adapted = adaptLeadingChoice(
    kernel.getObject("fiora"),
    translateInstructionTargets(ability.body),
    ability.trigger
  );
  assert.ok(adapted);
  engine.enqueue({
    id: "fiora-finalize-decline",
    source: kernel.getObject("fiora"),
    controller: "A",
    kind: "triggered",
    body: adapted.body,
    cost: adapted.cost,
    mayAtFinalize: adapted.mayAtFinalize
  });
  engine.advance();
  assert.equal(engine.items.length, 0);
  assert.deepEqual(kernel.player("A").power, ["Order"]);
  assert.equal(engine.trace.some(entry => entry.step === "resolved"), false);
  assert.ok(engine.trace.some(entry => entry.step === "removed" && entry.item === "fiora-finalize-decline" && entry.reason === "declined"));
});

test("sfd-180-221 Fiora, Worthy: an accepted but unpayable Finalize removes the trigger without a payment", () => {
  const kernel = world()
    .player("A", { power: [] })
    .unit("fiora", { cardId: CANONICAL_ID, might: 3, exhausted: true })
    .build();
  const choose = request => request.type === "optional" ? true : (() => { throw new Error(`Unexpected choice ${request.id}`); })();
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: saved => { kernel.restore(saved.state); kernel.copyLinkedFrom(saved.links); },
    objects: () => kernel.objects,
    perform: action => kernel.perform(action),
    choose,
    context: (source, controller, timingPoint) => bindResolveContext(kernel, { source, controller, timingPoint, choose })
  });
  const engine = new ChainEngine({ turnOrder: ["A", "B"], turnPlayer: "A", phase: "main", host, cleanup: () => false });
  const adapted = adaptLeadingChoice(
    kernel.getObject("fiora"),
    translateInstructionTargets(ability.body),
    ability.trigger
  );
  assert.ok(adapted);
  engine.enqueue({
    id: "fiora-finalize-unpayable",
    source: kernel.getObject("fiora"),
    controller: "A",
    kind: "triggered",
    body: adapted.body,
    cost: adapted.cost,
    mayAtFinalize: adapted.mayAtFinalize
  });
  engine.advance();
  assert.equal(engine.items.length, 0);
  assert.deepEqual(kernel.player("A").power, []);
  assert.equal(engine.trace.some(entry => entry.step === "finalized" && entry.item === "fiora-finalize-unpayable"), false);
  assert.equal(engine.trace.some(entry => entry.step === "resolved"), false);
  assert.ok(engine.trace.some(entry => entry.step === "removed" && entry.item === "fiora-finalize-unpayable" && entry.reason === "unperformable-trigger"));
});

test("sfd-180-221 Fiora, Worthy: declining the leading may pays nothing and does not ready", () => {
  const kernel = world()
    .player("A", { power: ["Order"] })
    .unit("fiora", { cardId: CANONICAL_ID, might: 3, exhausted: false })
    .build();
  const context = kernel.clone({ sourceSnapshot: kernel.getObject("fiora"), controller: "A" });
  context.setAnswers({ [`${OPTIONAL_ID}/optional`]: false });
  const outcome = resolveChainBody([optional], context);
  assert.equal(outcome.status, "partial");
  assert.deepEqual(outcome.results.map(entry => [entry.id, entry.result.status, entry.result.reason]), [
    [OPTIONAL_ID, "negated", "skipped"]
  ]);
  assert.deepEqual(context.player("A").power, ["Order"]);
  assert.deepEqual(context.events, []);
  assert.equal(context.getObject("fiora").exhausted, false);
});

test("sfd-180-221 Fiora, Worthy: a non-Order Power is insufficient even though it is Power", () => {
  const kernel = world()
    .player("A", { power: ["Calm"] })
    .unit("fiora", { cardId: CANONICAL_ID, might: 3, exhausted: true })
    .build();
  const before = kernel.snapshot();
  assert.throws(
    () => runInstruction(costPay, payOrder.args, { world: kernel }),
    error => error?.reason === "cannot-pay-cost" && /insufficient matching Power/.test(error.message)
  );
  assert.deepEqual(kernel.snapshot(), before);
  assert.deepEqual(kernel.player("A").power, ["Calm"]);
  assert.equal(kernel.getObject("fiora").exhausted, true);
});

test("sfd-180-221 Fiora, Worthy: Universal Power can satisfy the exact Order requirement in the cost model", () => {
  const plan = planDuelRunePayment({
    energy: 0,
    power: { Fury: 0, Calm: 0, Mind: 0, Body: 0, Chaos: 0, Order: 0, any: 1 }
  }, {
    energy: 0,
    power: [{ amount: 1, allowedDomains: ["Order"] }]
  });
  assert.deepEqual(plan, {
    power: [{ requirementIndex: 0, from: "any", amount: 1 }]
  });
  // The merger is explicit about preferred allocations; the important rule is
  // that a Universal lot is accepted for a named-domain requirement.
  assert.equal(plan.power[0].from, "any");
  assert.equal(plan.power[0].requirementIndex, 0);
});

test("sfd-180-221 Fiora, Worthy: the current effect.ready schema cannot consume event:it (shared bridge required)", () => {
  // The IR is valid as an Expr at the program layer, but the primitive parses
  // only the evaluated selection. This is the exact missing selector consumer.
  assert.equal(ready.argsSchema.safeParse({ objects: { event: "it" } }).success, false);
});

test.todo(
  "sfd-180-221 Fiora, Worthy: end-to-end 4-to-5 production trigger, Finalize choice/payment, and event-it ready " +
    "remain blocked by the shared programs/filters.ts transition translation, the default layer-to-event producer, " +
    "the generic TriggerSnapshot event:it assignment, and effect.ready's event selector schema (CR 383.3.a/.b.1, 709)"
);
