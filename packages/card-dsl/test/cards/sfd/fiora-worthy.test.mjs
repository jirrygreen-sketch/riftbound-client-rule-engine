import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/fiora-worthy.js";
import pitRookie from "../../../dist/cards/ogn/pit-rookie.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import ready from "../../../../engine-core/dist/effects/instructions/effect.ready.js";
import costPay from "../../../../engine-core/dist/effects/instructions/cost.pay.js";
import { bindResolveContext, createActionPipelineHost } from "../../../../engine-core/dist/events/action-adapter.js";
import { deriveMightChangedEmissions } from "../../../../engine-core/dist/events/producers/might-change.js";
import { EventPipeline } from "../../../../engine-core/dist/events/pipeline.js";
import { triggerEventObjectBinding } from "../../../../engine-core/dist/events/pipeline-types.js";
import { matchesMightyTransition, matchesTriggerEvent } from "../../../../engine-core/dist/events/pipeline-match.js";
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

function translatedFioraFilter() {
  return translateTriggerFilter(ability.trigger.filter, "fiora", "might-changed");
}

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

const admitted = { ...program, status: "executable", judgeReason: undefined };

function fullLifecycleFixture({
  power = ["Order"],
  targetMight = 4,
  targetBuffs = 0,
  accept = true
} = {}) {
  const kernel = world()
    .player("A", { energy: 10, power })
    .player("B")
    .hand("fiora", {
      cardId: CANONICAL_ID,
      types: ["unit"],
      might: 3,
      energy: 3,
      power: null,
      exhausted: true
    })
    .hand("pit", {
      cardId: pitRookie.canonicalCardId,
      types: ["unit"],
      might: 2,
      energy: 1,
      power: []
    })
    .unit("target", {
      might: targetMight,
      buffs: targetBuffs,
      exhausted: true,
      location: { type: "battlefield", id: "battlefield-1" }
    })
    .build();
  const requests = [];
  const errors = [];
  const choose = request => {
    requests.push(request);
    if (request.id.startsWith("target:other-unit")) return [kernel.ref("target")];
    if (request.type === "optional" && request.id.startsWith("finalize:trigger:")) return accept;
    if (request.type === "select-objects" && request.min === request.max &&
        request.options.length === request.min) return request.options;
    if (request.type === "mode") return request.options[0];
    throw new Error(`Unexpected production choice ${request.type} ${request.id}`);
  };
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: saved => {
      kernel.restore(saved.state);
      kernel.copyLinkedFrom(saved.links);
    },
    objects: () => kernel.objects,
    perform: action => kernel.perform(action),
    performContract: action => kernel.performContract(action),
    performBatchLeaf: (action, batchId) => kernel.performBatchLeafForCapability(action, batchId),
    choose,
    context: (source, controller, timingPoint) =>
      bindResolveContext(kernel, { source, controller, timingPoint, choose }),
    testTrigger: registration => kernel.test(registration.spec.condition)
  });
  const binding = createProgramBinding({ cardPrograms: [admitted, pitRookie] });
  const engine = new ChainEngine({
    turnOrder: ["A", "B"],
    turnPlayer: "A",
    phase: "main",
    host,
    cleanup: () => false,
    describePlay: binding.describePlay
  });
  binding.attachLifecycle(engine, error => errors.push(error));
  const settle = () => {
    engine.advance();
    for (let guard = 0; engine.items.length; guard++) {
      assert.ok(guard < 30, "the production Chain must settle");
      engine.pass(engine.priority);
    }
  };
  const play = (id, location = { type: "battlefield", id: "battlefield-1" }) => {
    engine.execute(binding.describePlay(
      { type: "play", player: "A", object: kernel.ref(id), location },
      kernel.getObject(id)
    ));
    settle();
  };
  const lay = id => {
    engine.layers.setObjects(kernel.objects);
    return engine.layers.evaluate(kernel.ref(id));
  };
  const enterAccessories = () => {
    play("fiora");
    play("pit");
  };
  return { kernel, engine, binding, requests, errors, play, settle, lay, enterAccessories };
}

function directPipelineFixture({ power = ["Order", "Order"] } = {}) {
  const kernel = world()
    .player("A", { power })
    .player("B")
    .unit("fiora", {
      cardId: CANONICAL_ID,
      might: 3,
      exhausted: true,
      zone: "board",
      location: { type: "battlefield", id: "battlefield-1" }
    })
    .unit("event-unit", {
      cardId: "card:event-unit",
      might: 4,
      exhausted: true,
      zone: "board",
      location: { type: "battlefield", id: "battlefield-1" }
    })
    .build();
  const questions = [];
  const choose = request => {
    questions.push(request);
    if (request.type === "optional") return true;
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
    performContract: action => kernel.performContract(action),
    performBatchLeaf: (action, batchId) => kernel.performBatchLeafForCapability(action, batchId),
    choose,
    context: (source, controller, timingPoint) =>
      bindResolveContext(kernel, { source, controller, timingPoint, choose }),
    testTrigger: registration => kernel.test(registration.spec.condition)
  });
  const engine = new ChainEngine({
    turnOrder: ["A", "B"],
    turnPlayer: "A",
    phase: "main",
    host,
    cleanup: () => false
  });
  // Only metadata is admitted here. The registry receives the card's original
  // trigger and body unchanged.
  const binding = createProgramBinding({ cardPrograms: [admitted] });
  const registered = binding.registerProgramTriggers(engine, kernel.getObject("fiora"));
  return { kernel, engine, host, binding, registered, questions };
}

test("sfd-180-221 Fiora, Worthy: program validates and has expected shape", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.equal(program.status, "judge-required");
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL_ID), program);
  assert.match(program.judgeReason, /typed Mighty transition/);
  assert.match(program.judgeReason, /event:it/);
  assert.match(program.judgeReason, /Finalize Order payment/);
  assert.match(program.judgeReason, /cost\/payment\.ts:120/);
  assert.match(program.judgeReason, /cost\/payment\.ts:132/);
  assert.match(program.judgeReason, /Universal Power/);
  assert.doesNotMatch(program.judgeReason, /authoritative-host proof/);
  assert.doesNotMatch(program.judgeReason, /programs\/filters\.ts rejects/);
  assert.doesNotMatch(program.judgeReason, /does not publish/);
  assert.doesNotMatch(program.judgeReason, /does not accept/);
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

test("sfd-180-221 Fiora, Worthy: the original unmodified trigger IR registers", () => {
  const { engine, kernel } = productionFixture();
  const binding = createProgramBinding({ cardPrograms: [admitted] });
  assert.deepEqual(binding.registry.get(CANONICAL_ID).abilities, program.abilities);
  assert.deepEqual(binding.registry.get(CANONICAL_ID).abilities[0].trigger.filter, ability.trigger.filter);

  const translated = translateTriggerFilter(ability.trigger.filter, "fiora", "might-changed");
  assert.deepEqual(translated, {
    event: "might-changed",
    object: { type: "unit", controller: "self" },
    details: { becomesMighty: true }
  });
  const ids = binding.registerProgramTriggers(engine, kernel.getObject("fiora"));
  assert.equal(ids.length, 1);
  const [registration] = [...engine.pipeline.triggers.values()];
  assert.equal(registration.id, ids[0]);
  assert.deepEqual(registration.spec.filter, translated);
  assert.deepEqual(registration.body.map(instruction => instruction.id), [READY_ID]);
  assert.equal(registration.mayAtFinalize, true);
  assert.deepEqual(registration.cost.cost.payments, [{
    kind: "power",
    amount: { kind: "constant", value: 1 },
    allowedDomains: ["Order"]
  }]);
});

test("sfd-180-221 Fiora, Worthy: a real layer action emits one target 4-to-5 might-changed fact", () => {
  const { engine, kernel, binding } = productionFixture();
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
  assert.ok(engine.trace.some(entry => entry.step === "resolved" && entry.item === "fiora.might-probe"));
  const transitions = engine.pipeline.events.filter(event => event.timingPoint === "might-changed");
  assert.equal(transitions.length, 1);
  const [transition] = transitions;
  assert.deepEqual(transition.object.ref, kernel.ref("target"));
  assert.deepEqual(transition.it.ref, kernel.ref("target"));
  assert.deepEqual(transition.details.before.ref, kernel.ref("target"));
  assert.deepEqual(transition.details.after.ref, kernel.ref("target"));
  assert.equal(transition.details.before.might, 4);
  assert.equal(transition.details.after.might, 5);
  assert.equal(transition.details.previousMight, 4);
  assert.equal(transition.details.currentMight, 5);
  assert.equal(transition.eventId > 0, true);
  assert.equal(matchesTriggerEvent(translatedFioraFilter(), transition, "A"), true);
  assert.equal(matchesTriggerEvent(translatedFioraFilter(), transition, "B"), false);

  // This real layer wave only produces the fact. It must not alter Fiora's
  // readiness or invent a player-selected target.
  assert.equal(kernel.getObject("fiora").exhausted, true);
  assert.equal(kernel.getObject("target").exhausted, true);
  assert.equal(engine.pipeline.events.filter(event => event.timingPoint === "became-target").length, 0);

  // This is the real layer producer. The full card remains blocked until the
  // card's own default lifecycle is independently accepted; the binding here
  // only verifies that this exact production event would match the original IR.
  const admittedBinding = createProgramBinding({ cardPrograms: [admitted] });
  const [registration] = admittedBinding.registry.get(CANONICAL_ID).abilities;
  assert.deepEqual(registration.trigger.filter, ability.trigger.filter);
  assert.equal(binding.registry.inspect(CANONICAL_ID), program);
  // The unadmitted card lifecycle remains detached at this stage, so no Pending
  // item is fabricated from this real fact by the component-level probe.
  assert.equal(engine.items.length, 0);
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

test("sfd-180-221 Fiora, Worthy: the real Might producer freezes before, after and event:it", () => {
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
  assert.deepEqual(derived.details.before.ref, before.ref);
  assert.deepEqual(derived.details.after.ref, after.ref);
  assert.deepEqual(derived.it.ref, after.ref);
  assert.equal(derived.details.previousMight, 4);
  assert.equal(derived.details.currentMight, 5);
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
  assert.deepEqual(event.it.ref, after.ref);
  assert.equal(event.it.ref.zoneEntryId, before.ref.zoneEntryId);
  assert.equal(captures.length, 1);
  assert.equal(matchesTriggerEvent(translatedFioraFilter(), event, "A"), true);
  assert.equal(matchesTriggerEvent(translatedFioraFilter(), event, "B"), false);
  const binding = triggerEventObjectBinding(captures[0], "it");
  assert.ok(binding);
  assert.deepEqual(binding.ref, after.ref);
  assert.equal(binding.snapshot.might, 5);
});

test("sfd-180-221 Fiora, Worthy: the original trigger resolves payment and readies only event:it", () => {
  // Component-level fixture: admitted metadata bypasses the whole-card status
  // gate so the original trigger/body can be registered unchanged. It is not
  // evidence that Fiora's card is executable end-to-end.
  const f = directPipelineFixture();
  const { kernel, engine, registered } = f;
  const eventUnit = kernel.getObject("event-unit");
  const before = { ...eventUnit, might: 4 };
  const after = { ...eventUnit, might: 5 };
  const derived = deriveMightChangedEmissions([before], [after], {
    batchId: "raw-mighty",
    cause: "layer-recompute",
    source: kernel.getObject("fiora")
  })[0];
  assert.ok(derived);
  assert.equal(registered.length, 1);
  const [event] = engine.pipeline.emitBatch([derived], undefined, "raw-mighty");
  assert.equal(event.eventId > 0, true);
  assert.deepEqual(event.it.ref, kernel.ref("event-unit"));
  assert.deepEqual(event.details.before.ref, kernel.ref("event-unit"));
  assert.deepEqual(event.details.after.ref, kernel.ref("event-unit"));
  assert.equal(engine.items.length, 1);
  assert.equal(engine.items[0].status, "pending");
  assert.deepEqual(engine.items[0].trigger.event, event);
  assert.equal(engine.items[0].trigger.event.eventId, event.eventId);
  assert.deepEqual(engine.items[0].trigger.event.it.ref, event.it.ref);

  engine.advance();
  assert.equal(engine.items[0].status, "finalized");
  assert.deepEqual(kernel.player("A").power, ["Order"]);
  assert.equal(engine.items[0].payment.paid, true);
  assert.deepEqual(engine.items[0].payment.total.power, [{ amount: 1, allowedDomains: ["Order"] }]);
  assert.equal(kernel.getObject("event-unit").exhausted, true);
  assert.equal(kernel.getObject("fiora").exhausted, true);

  engine.pass("A");
  engine.pass("B");
  assert.equal(engine.items.length, 0);
  assert.equal(kernel.getObject("event-unit").exhausted, false);
  assert.equal(kernel.getObject("fiora").exhausted, true);
  assert.deepEqual(f.questions.map(request => [request.type, request.id]), [
    ["optional", "finalize:trigger:1:optional"]
  ]);
  const readyEvents = engine.pipeline.events.filter(candidate => candidate.timingPoint === "object-readied");
  assert.equal(readyEvents.length, 1);
  assert.deepEqual(readyEvents[0].object.ref, kernel.ref("event-unit"));
  assert.equal(engine.pipeline.events.filter(candidate => candidate.timingPoint === "became-target").length, 0);
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

test("sfd-180-221 Fiora, Worthy: effect.ready consumes exact event:it and fails closed otherwise", () => {
  assert.equal(ready.argsSchema.safeParse({ objects: { event: "it" } }).success, true);
  assert.equal(ready.argsSchema.safeParse({ objects: { event: "it", target: "other" } }).success, false);

  const make = () => world()
    .unit("fiora", {
      cardId: CANONICAL_ID,
      exhausted: true,
      zone: "board",
      location: { type: "base", player: "A" }
    })
    .unit("event-unit", {
      exhausted: true,
      zone: "board",
      location: { type: "battlefield", id: "battlefield-1" }
    })
    .build();
  const bindingFor = snapshot => Object.freeze({
    eventId: 11,
    role: "it",
    ref: Object.freeze({ ...snapshot.ref }),
    snapshot: Object.freeze(structuredClone(snapshot))
  });
  const contextFor = (kernel, eventObject) => bindResolveContext(kernel, {
    source: kernel.getObject("fiora"),
    controller: "A",
    timingPoint: "chain-item-resolve",
    eventObject,
    choose: () => { throw new Error("event:it must not choose"); }
  });

  const valid = make();
  const validBinding = bindingFor(valid.getObject("event-unit"));
  const validOutcome = resolveChainBody([readyEventIt], contextFor(valid, role => role === "it" ? validBinding : null));
  assert.equal(validOutcome.status, "executed");
  assert.equal(valid.getObject("event-unit").exhausted, false);
  assert.equal(valid.getObject("fiora").exhausted, true);
  assert.deepEqual(validOutcome.linkedValues[`${READY_ID}.readied`], {
    count: 1,
    objects: [validBinding.ref]
  });
  assert.deepEqual(validOutcome.events.map(event => event.action), ["ready"]);

  for (const eventObject of [
    undefined,
    () => null,
    () => ({ ...validBinding, role: "source" }),
    () => ({ ...validBinding, eventId: 0 }),
    () => ({ ...validBinding, ref: { ...validBinding.ref, zoneEntryId: 2 } })
  ]) {
    const kernel = make();
    const before = kernel.stateForTest();
    const context = contextFor(kernel, eventObject);
    const outcome = resolveChainBody([readyEventIt], context);
    assert.equal(outcome.status, "partial");
    assert.deepEqual(outcome.results[0].result, { status: "ignored", reason: "mistargeted" });
    assert.deepEqual(kernel.stateForTest(), before);
  }

  const stale = make();
  const oldBinding = bindingFor(stale.getObject("event-unit"));
  assert.equal(stale.perform({ type: "return-to-hand", object: oldBinding.ref }).status, "done");
  assert.equal(stale.perform({
    type: "move-zone",
    object: stale.ref("event-unit"),
    to: "battlefield",
    location: { type: "battlefield", id: "battlefield-1" }
  }).status, "done");
  const staleBefore = stale.stateForTest();
  const staleOutcome = resolveChainBody([readyEventIt], contextFor(stale, role => role === "it" ? oldBinding : null));
  assert.deepEqual(staleOutcome.results[0].result, { status: "ignored", reason: "mistargeted" });
  assert.equal(stale.getObject("event-unit").exhausted, true);
  assert.equal(stale.getObject("fiora").exhausted, true);
  assert.deepEqual(stale.stateForTest(), staleBefore);
});

test("sfd-180-221 Fiora, Worthy: real Hand/Chain/Board lifecycle pays one Order and readies only event:it", () => {
  const f = fullLifecycleFixture();
  f.enterAccessories();

  const transition = f.engine.pipeline.events.filter(event => event.timingPoint === "might-changed");
  assert.deepEqual(transition.map(event => event.object.ref), [f.kernel.ref("target")]);
  assert.deepEqual(transition.map(event => event.it.ref), [f.kernel.ref("target")]);
  const prompt = f.requests.find(request => request.type === "optional");
  assert.ok(prompt);
  assert.match(prompt.id, /^finalize:trigger:\d+:optional$/);
  assert.equal(prompt.chooser, "A");
  assert.equal(f.requests.some(request => request.id.startsWith("target:fiora")), false);
  assert.deepEqual(f.kernel.player("A").power, []);
  assert.equal(f.kernel.getObject("target").exhausted, false);
  assert.equal(f.kernel.getObject("fiora").exhausted, true);
  assert.deepEqual(f.errors, []);
  assert.equal(f.engine.items.length, 0);
  const readyEvents = f.engine.pipeline.events.filter(event => event.timingPoint === "object-readied");
  assert.deepEqual(readyEvents.map(event => event.object.ref), [f.kernel.ref("target")]);
});

test("sfd-180-221 Fiora, Worthy: declining Finalize pays no Order and does not ready event:it", () => {
  const f = fullLifecycleFixture({ accept: false });
  f.enterAccessories();

  assert.ok(f.requests.some(request => request.type === "optional" && request.chooser === "A"));
  assert.deepEqual(f.kernel.player("A").power, ["Order"]);
  assert.equal(f.kernel.getObject("target").exhausted, true);
  assert.equal(
    f.engine.pipeline.events.filter(event => event.timingPoint === "object-readied").length,
    0
  );
  assert.ok(f.engine.trace.some(entry => entry.step === "removed" && entry.reason === "declined"));
  assert.deepEqual(f.errors, []);
});

test("sfd-180-221 Fiora, Worthy: wrong-domain or absent Power leaves the trigger unperformed", () => {
  for (const power of [[], ["Calm"]]) {
    const f = fullLifecycleFixture({ power });
    f.enterAccessories();

    assert.deepEqual(f.kernel.player("A").power, power);
    assert.equal(f.kernel.getObject("target").exhausted, true);
    assert.equal(f.engine.pipeline.events.filter(event => event.timingPoint === "object-readied").length, 0);
    assert.ok(f.engine.trace.some(entry =>
      entry.step === "removed" && entry.reason === "unperformable-trigger"
    ));
    assert.deepEqual(f.errors, []);
  }
});

test("sfd-180-221 Fiora, Worthy: Universal Power fails closed at the authoritative payment contract", () => {
  const f = fullLifecycleFixture({ power: ["any"] });
  assert.throws(
    () => f.enterAccessories(),
    error => error?.reason === "invalid-cost-plan" &&
      error.message === "Invalid Power domain in player snapshot"
  );
  assert.deepEqual(f.kernel.player("A").power, ["any"]);
  assert.equal(f.kernel.getObject("target").exhausted, true);
  assert.equal(f.kernel.getObject("pit").zone, "hand");
  assert.equal(f.engine.pipeline.events.filter(event => event.timingPoint === "might-changed").length, 0);
  assert.equal(f.engine.pipeline.events.filter(event => event.timingPoint === "object-readied").length, 0);
});

test("sfd-180-221 Fiora, Worthy: 3-to-4 and 5-to-6 Might changes do not trigger", () => {
  for (const [targetMight, targetBuffs] of [[3, 0], [5, 0], [4, 1]]) {
    const f = fullLifecycleFixture({ targetMight, targetBuffs });
    f.enterAccessories();

    assert.equal(f.requests.some(request => request.type === "optional"), false);
    assert.deepEqual(f.kernel.player("A").power, ["Order"]);
    assert.equal(f.kernel.getObject("target").exhausted, true);
    const transition = f.engine.pipeline.events.filter(event => event.timingPoint === "might-changed");
    assert.equal(transition.length, targetBuffs === 1 ? 0 : 1);
    assert.deepEqual(f.errors, []);
  }
});
