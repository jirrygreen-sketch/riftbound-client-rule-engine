import assert from "node:assert/strict";
import test from "node:test";

import fanfare from "../../../card-dsl/dist/cards/rad/fanfare.js";
import imperialDecree from "../../../card-dsl/dist/cards/ogn/imperial-decree.js";
import siphoningStrike from "../../../card-dsl/dist/cards/ven/siphoning-strike.js";
import tacticalRetreat from "../../../card-dsl/dist/cards/unl/tactical-retreat.js";
import { bindResolveContext, createActionPipelineHost } from "../../dist/events/action-adapter.js";
import { ChainEngine } from "../../dist/chain/engine.js";
import { resolveChainBody } from "../../dist/chain/interpreter-adapter.js";
import { instructionDefinitionsById } from "../../dist/effects/instructions/registry.generated.js";
import { bindReplacementRegistrationDependencies } from "../../dist/effects/instructions/replacement.register.js";
import {
  bindDelayedRegistrationCapability,
  createDelayedRegistrationCapability,
} from "../../dist/effects/delayed/capability.js";
import { world } from "../../dist/effects/testing/index.js";

const c = value => ({ kind: "constant", value });

function runtime(builder, { capability = false, choose: answer } = {}) {
  const kernel = builder.build();
  const choose = request => {
    const selected = answer?.(request);
    if (selected !== undefined) return selected;
    if (request.type === "select-objects" && request.min === 0) return [];
    if (request.type === "select-objects" && request.min === request.max && request.options.length === request.min) {
      return [...request.options];
    }
    throw new Error(`Unexpected choice ${request.id}`);
  };
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: saved => { kernel.restore(saved.state); kernel.copyLinkedFrom(saved.links); },
    objects: () => kernel.objects,
    perform: action => kernel.perform(action),
    choose,
    context: (source, controller, timingPoint) => bindResolveContext(kernel, {
      source, controller, timingPoint, choose,
    }),
    testTrigger: registration => kernel.test(registration.spec.condition),
  });
  const engine = new ChainEngine({
    turnOrder: ["A", "B"], turnPlayer: "A", phase: "main", host, cleanup: () => false,
  });
  if (capability) {
    const delayedRegistration = createDelayedRegistrationCapability(engine.pipeline);
    const originalContext = host.context.bind(host);
    host.context = (source, controller, timingPoint) => {
      const context = originalContext(source, controller, timingPoint);
      return context.source !== null && typeof context.source === "object"
        ? bindDelayedRegistrationCapability(context, delayedRegistration)
        : context;
    };
  }
  return { kernel, engine, host, choose };
}

function rawDelayed(program, path) {
  let value = program.abilities;
  for (const key of path) value = value[key];
  assert.equal(value.op, "trigger.delayed");
  return value;
}

let actionSequence = 0;

function activateDelayed(f, body, source = "source") {
  f.engine.execute({
    id: `delayed-activation:${++actionSequence}`,
    controller: "A",
    source: f.kernel.getObject(source),
    kind: "activated",
    speed: "normal",
    body,
  });
  // An activated item remains pending until the Chain resolves it. The helper
  // settles through ordinary Priority passes; it never invokes the interpreter
  // directly or edits the pipeline registry.
  settle(f);
}

function playUnit(f, id) {
  const source = f.kernel.getObject(id);
  if (source === null) {
    assert.equal(f.engine.commit({ type: "move-zone", object: f.kernel.ref(id), to: "base", location: { type: "base", player: "A" } }).status, "done");
    assert.equal(f.engine.commit({ type: "return-to-hand", object: f.kernel.ref(id) }).status, "done");
  }
  const playable = f.kernel.getObject(id);
  f.engine.execute({
    id: `play-unit:${id}:${++actionSequence}`,
    controller: "A",
    source: playable,
    kind: "unit",
    speed: "normal",
    body: [],
    cost: {
      id: `cost:${id}:${actionSequence}`,
      cost: { energy: c(0), power: c([]) },
    },
  });
  settle(f);
}

function settle(f, budget = 40) {
  f.engine.advance();
  let attempts = 0;
  while (f.engine.items.length) {
    assert.ok(++attempts < budget, "the real Chain reaches a fixed point");
    f.engine.pass(f.engine.priority);
    f.engine.advance();
  }
}

test("EG-DELAYED registers the original Fanfare IR through an installed production capability", () => {
  const instruction = rawDelayed(fanfare, [0, "body", 0]);
  const f = runtime(world().player("A").player("B"), { capability: true });
  const result = resolveChainBody([instruction], f.host.context(f.kernel.source, "A", "chain-item-resolve"));
  assert.equal(result.results[0].result.status, "executed", JSON.stringify(result.results[0].result));
  const registrations = [...f.engine.pipeline.checkpoint().triggers.values()];
  assert.equal(registrations.length, 1);
  assert.equal(registrations[0].expiresAt, "turn-end");
  assert.equal(registrations[0].maxPerScope, 3);
  assert.equal(registrations[0].controller, "A");
  assert.equal(registrations[0].source.ref.id, "source");
  assert.deepEqual(registrations[0].spec.filter, {
    event: "card-played",
    player: "self",
    object: { type: "unit" },
  });
});

test("EG-DELAYED Fanfare consumes three real card-played waves and expires at turn-end", () => {
  const instruction = rawDelayed(fanfare, [0, "body", 0]);
  const builder = world().player("A").player("B")
    .hand("caster", { types: ["spell"], energy: 0, power: [] })
    .deck(["draw-1", "draw-2", "draw-3", "draw-4"], { owner: "A" });
  for (const id of ["unit-1", "unit-2", "unit-3", "unit-4", "unit-5"]) {
    builder.hand(id, { types: ["unit"], energy: 0, power: [] });
  }
  const f = runtime(builder, { capability: true });

  activateDelayed(f, [instruction], "caster");
  assert.ok(f.engine.trace.some(entry => entry.step === "resolved" && entry.item.startsWith("delayed-activation:")));
  const [registrationId] = f.engine.pipeline.checkpoint().triggers.keys();
  const registration = f.engine.pipeline.checkpoint().triggers.get(registrationId);
  assert.equal(registration.maxPerScope, 3);
  assert.equal(registration.expiresAt, "turn-end");

  for (const id of ["unit-1", "unit-2", "unit-3"]) playUnit(f, id);
  assert.equal(f.kernel.player("A").deckSize, 1, "three qualifying unit plays draw three cards");
  assert.equal(f.engine.pipeline.checkpoint().triggers.has(registrationId), true);

  playUnit(f, "unit-4");
  assert.equal(f.kernel.player("A").deckSize, 1, "the fourth qualifying play is not consumed");
  assert.equal(f.engine.pipeline.checkpoint().triggers.has(registrationId), true);

  f.engine.emit({ timingPoint: "turn-end", player: "A" });
  f.engine.advance();
  assert.equal(f.engine.pipeline.checkpoint().triggers.has(registrationId), false);

  playUnit(f, "unit-5");
  assert.equal(f.kernel.player("A").deckSize, 1, "the expired registration cannot draw again");
});

test("EG-DELAYED next-main-phase expires on the controller's opening and rejects opponents", () => {
  const f = runtime(world().player("A").player("B")
    .unit("source")
    .deck(["draw-1", "draw-2"], { owner: "A" }), { capability: true });
  activateDelayed(f, [{
    id: "next-main-delay",
    op: "trigger.delayed",
    args: {
      at: c("main-start"),
      body: c([{ id: "next-main-draw", op: "effect.draw", args: { amount: c(1) } }]),
      window: c("next-main-phase"),
    },
  }]);
  const [registrationId] = f.engine.pipeline.checkpoint().triggers.keys();
  const registration = f.engine.pipeline.checkpoint().triggers.get(registrationId);
  assert.equal(registration.expiresAt, undefined, "a player-relative window is not an absolute main-start expiry");
  assert.deepEqual(registration.spec.filter, { event: "main-start", player: "self" });

  f.engine.emit({ timingPoint: "main-start", player: "B" });
  f.engine.advance();
  assert.equal(f.engine.items.length, 0);
  assert.equal(f.engine.pipeline.checkpoint().triggers.has(registrationId), true);
  assert.equal(f.kernel.player("A").deckSize, 2);

  f.engine.emit({ timingPoint: "main-start", player: "A" });
  settle(f);
  assert.equal(f.kernel.player("A").deckSize, 1);
  assert.equal(f.engine.pipeline.checkpoint().triggers.has(registrationId), false);

  f.engine.emit({ timingPoint: "main-start", player: "A" });
  f.engine.advance();
  assert.equal(f.engine.items.length, 0);
  assert.equal(f.kernel.player("A").deckSize, 1);
});

test("EG-DELAYED rejects Fanfare in the default assembly because expiry and uses cannot be persisted", () => {
  const instruction = rawDelayed(fanfare, [0, "body", 0]);
  const f = runtime(world().player("A").player("B"));
  const result = resolveChainBody([instruction], f.host.context(f.kernel.source, "A", "chain-item-resolve"));
  assert.deepEqual(result.results[0].result, { status: "negated", reason: "impossible", events: [] });
  assert.equal(f.engine.pipeline.checkpoint().triggers.size, 0);
});

test("EG-DELAYED keeps eventFilter as an EventPattern and never treats a timing name as objectId", () => {
  const f = runtime(world().player("A").player("B"), { capability: true });
  const context = f.host.context(f.kernel.source, "A", "chain-item-resolve");
  const invalid = resolveChainBody([{
    id: "bad-delay",
    op: "trigger.delayed",
    args: {
      at: c("card-played"),
      body: c([]),
      eventFilter: c("turn-end"),
      once: c("per-game"),
    },
  }], context);
  assert.deepEqual(invalid.results[0].result, { status: "negated", reason: "impossible", events: [] });
  assert.equal(f.engine.pipeline.checkpoint().triggers.size, 0);

  const valid = resolveChainBody([{
    id: "valid-delay",
    op: "trigger.delayed",
    args: {
      at: c("card-played"),
      body: c([]),
      eventFilter: c({ event: "card-played", object: { type: "unit" } }),
      once: c("per-game"),
      duration: c("this-turn"),
    },
  }], context);
  assert.equal(valid.results[0].result.status, "executed", JSON.stringify(valid.results[0].result));
  const registration = [...f.engine.pipeline.checkpoint().triggers.values()][0];
  assert.deepEqual(registration.spec.filter, { event: "card-played", object: { type: "unit" } });
});

test("EG-DELAYED locks a target incarnation and materializes a linked count at registration", () => {
  const f = runtime(world().player("A").player("B")
    .unit("victim", { owner: "B", controller: "B" }), { capability: true });
  f.kernel.setTargets("unit", [f.kernel.ref("victim")]);
  const body = [{
    id: "lock-delay",
    op: "trigger.delayed",
    args: {
      at: c("object-killed"),
      body: c([{ id: "later", op: "effect.draw", args: { amount: { kind: "linked-value", instructionId: "lock-delay", key: "count" } } }]),
      filter: c({ event: "object-killed" }),
      objects: c({ target: "unit" }),
      count: c(2),
      window: c("this-turn"),
    },
  }];
  const result = resolveChainBody(body, f.host.context(f.kernel.source, "A", "chain-item-resolve"));
  assert.equal(result.results[0].result.status, "executed", JSON.stringify(result.results[0].result));
  const registration = [...f.engine.pipeline.checkpoint().triggers.values()][0];
  assert.deepEqual(registration.spec.filter, { event: "object-killed", object: { objectId: "victim" } });
  assert.deepEqual(registration.body[0].args.amount, { kind: "constant", value: 2 });
  assert.equal(registration.expiresAt, "turn-end");
});

test("EG-DELAYED stores an exact locked incarnation in a dedicated trigger rule", () => {
  const f = runtime(world().player("A").player("B")
    .unit("victim", { owner: "B", controller: "B" }), { capability: true });
  f.kernel.setTargets("unit", [f.kernel.ref("victim")]);
  const result = resolveChainBody([{
    id: "lki-filter",
    op: "trigger.delayed",
    args: {
      at: c("object-killed"),
      body: c([]),
      filter: c({ event: "object-killed" }),
      objects: c({ target: "unit" }),
      count: c(1),
      window: c("this-turn"),
    },
  }], f.host.context(f.kernel.source, "A", "chain-item-resolve"));
  assert.equal(result.results[0].result.status, "executed");
  const registration = [...f.engine.pipeline.checkpoint().triggers.values()][0];
  assert.deepEqual(registration.spec.filter, { event: "object-killed", object: { objectId: "victim" } });
  const rules = f.engine.pipeline.checkpoint().rules;
  assert.equal(rules.size, 1);
  const rule = [...rules.values()][0];
  const old = { ...f.kernel.getObject("victim"), ref: { id: "victim", zoneEntryId: 1 } };
  const replacement = { ...f.kernel.getObject("victim"), ref: { id: "victim", zoneEntryId: 2 } };
  const contextFor = object => ({
    registration,
    source: registration.source,
    controller: "A",
    event: { object, target: object, eventId: 1, timingPoint: "object-killed", batchId: "test" },
  });
  assert.equal(rule.matches(contextFor(old)), false);
  assert.equal(rule.matches(contextFor(replacement)), true);
  f.engine.pipeline.emit({ timingPoint: "object-killed", object: old, player: "A", batchId: "old-death" });
  assert.equal(f.engine.items.length, 1);
  f.engine.pipeline.emit({ timingPoint: "object-killed", object: replacement, player: "A", batchId: "new-death" });
  assert.equal(f.engine.items.length, 1);
});

test("EG-DELAYED keeps source LKI after move and control change", () => {
  const f = runtime(world().player("A").player("B")
    .unit("source", { owner: "A", controller: "A" }), { capability: true });
  const context = f.host.context(f.kernel.getObject("source"), "A", "chain-item-resolve");
  const result = resolveChainBody([{
    id: "lki-delay",
    op: "trigger.delayed",
    args: { at: c("turn-end"), body: c([]), window: c("this-turn") },
  }], context);
  assert.equal(result.results[0].result.status, "executed");
  const moved = f.engine.commit({ type: "move-location", object: f.kernel.ref("source"), to: { type: "battlefield", id: "battlefield-2" } });
  assert.equal(moved.status, "done");
  f.engine.commit({ type: "take-control", object: f.kernel.ref("source"), player: "B" });
  const registration = [...f.engine.pipeline.checkpoint().triggers.values()][0];
  assert.equal(registration.source.controller, "A");
  assert.deepEqual(registration.source.location, { type: "battlefield", id: "battlefield-1" });
  assert.equal(registration.controller, "A");
});

test("EG-DELAYED rejects an already-ended this-turn window", () => {
  const f = runtime(world().player("A").player("B"), { capability: true });
  const context = f.host.context(f.kernel.source, "A", "turn-end");
  const result = resolveChainBody([{
    id: "late-delay",
    op: "trigger.delayed",
    args: { at: c("turn-end"), body: c([]), window: c("this-turn") },
  }], context);
  assert.deepEqual(result.results[0].result, { status: "negated", reason: "impossible", events: [] });
  assert.equal(f.engine.pipeline.checkpoint().triggers.size, 0);
});

test("EG-DELAYED rejects unsupported referent and non-consuming uses forms atomically", () => {
  const f = runtime(world().player("A").player("B"), { capability: true });
  const context = f.host.context(f.kernel.source, "A", "chain-item-resolve");
  assert.throws(() => resolveChainBody([{
    id: "referent-delay",
    op: "trigger.delayed",
    args: { at: c("turn-end"), body: c([]), referent: c("held-battlefield") },
  }], context), /referent/);
  assert.equal(f.engine.pipeline.checkpoint().triggers.size, 0);
});

test("EG-DELAYED production capability stores a second same-source registration with a stable distinct id", () => {
  const f = runtime(world().player("A").player("B"), { capability: true });
  const context = f.host.context(f.kernel.source, "A", "chain-item-resolve");
  const body = [{ id: "same-body", op: "effect.draw", args: { amount: c(1) } }];
  const registration = {
    id: "same",
    op: "trigger.delayed",
    args: { at: c("turn-end"), body: c(body), window: c("this-turn") },
  };
  assert.equal(resolveChainBody([registration], context).results[0].result.status, "executed");
  assert.equal(resolveChainBody([registration], context).results[0].result.status, "executed");
  const ids = [...f.engine.pipeline.checkpoint().triggers.keys()];
  assert.equal(ids.length, 2);
  assert.notEqual(ids[0], ids[1]);
});

test("EG-DELAYED rejects the original Siphoning Strike until an event:it capability is installed", () => {
  const instruction = rawDelayed(siphoningStrike, [0, "body", 2]);
  const f = runtime(world().player("A").player("B").unit("victim", { owner: "B" }), {
    capability: true,
    choose: request => request.type === "select-objects" ? [f.kernel.ref("victim")] : undefined,
  });
  assert.throws(() => resolveChainBody([instruction], f.host.context(f.kernel.source, "A", "chain-item-resolve")), /link|objects\/target/);
  assert.equal(f.engine.pipeline.checkpoint().triggers.size, 0);
});

test("EG-DELAYED replacement.register refuses a default context and installs through the replacement seam", () => {
  const f = runtime(world().player("A").player("B")
    .unit("host", { owner: "A" })
    .unit("victim", { owner: "B", controller: "B" }));
  f.kernel.setTargets("tactical-retreat.chosen-unit", [f.kernel.ref("victim")]);
  const args = {
    event: c({ event: "object-killed" }),
    instead: c([]),
    object: c({ target: "tactical-retreat.chosen-unit" }),
    duration: c("this-turn"),
    uses: c(1),
  };
  const context = f.host.context(f.kernel.getObject("host"), "A", "chain-item-resolve");
  let defaultError;
  try { resolveChainBody([{ id: "replacement-register", op: "replacement.register", args }], context); }
  catch (error) { defaultError = error; }
  assert.match(defaultError?.message ?? "", /replacement.register requires replacement dependencies/);
  assert.equal(f.engine.pipeline.checkpoint().replacements.size, 0);

  const replacement = {
    host: {
      object: ref => f.kernel.object(ref),
      objects: () => f.kernel.objects,
      context: (source, controller) => f.host.context(source, controller, "cleanup-start"),
    },
    pipeline: f.engine.pipeline,
  };
  const installed = bindReplacementRegistrationDependencies(context, replacement);
  const result = resolveChainBody([{ id: "replacement-register", op: "replacement.register", args }], installed);
  assert.equal(result.results[0].result.status, "executed");
  assert.equal(f.engine.pipeline.checkpoint().replacements.size, 1);
  const registration = [...f.engine.pipeline.checkpoint().replacements.values()][0];
  assert.match(registration.id, /^replacement:host:1:register:/);
});

test("EG-DELAYED replacement.register executes once for its exact target and rolls back on rejection", () => {
  const f = runtime(world().player("A").player("B")
    .unit("host", { owner: "A" })
    .unit("victim", { owner: "B", controller: "B" }));
  f.kernel.setTargets("chosen", [f.kernel.ref("victim")]);
  const replacement = {
    host: {
      object: ref => f.kernel.object(ref),
      objects: () => f.kernel.objects,
      context: (source, controller) => f.host.context(source, controller, "cleanup-start"),
    },
    pipeline: f.engine.pipeline,
  };
  const context = bindReplacementRegistrationDependencies(
    f.host.context(f.kernel.getObject("host"), "A", "chain-item-resolve"),
    replacement,
  );
  const result = resolveChainBody([{
    id: "replacement-register",
    op: "replacement.register",
    args: {
      event: c({ event: "object-killed" }),
      instead: c([]),
      duration: c("this-turn"),
      uses: c(1),
    },
  }], context);
  assert.equal(result.results[0].result.status, "executed");
  assert.equal(f.engine.commit({ type: "kill", object: f.kernel.ref("victim") }).status, "prevented");
  assert.equal(f.kernel.getObject("victim").zone, "board");
  assert.equal(f.engine.commit({ type: "kill", object: f.kernel.ref("victim") }).status, "done");
  assert.equal(f.kernel.getObject("victim").zone, "trash");
});

test("EG-DELAYED replacement.register rolls back through the real Chain transaction on a later failure", () => {
  const f = runtime(world().player("A").player("B")
    .unit("host", { owner: "A" })
    .unit("victim", { owner: "B", controller: "B" }));
  f.kernel.setTargets("chosen", [f.kernel.ref("victim")]);
  const replacement = {
    host: {
      object: ref => f.kernel.object(ref),
      objects: () => f.kernel.objects,
      context: (source, controller) => f.host.context(source, controller, "cleanup-start"),
    },
    pipeline: f.engine.pipeline,
  };
  const originalContext = f.host.context.bind(f.host);
  f.host.context = (source, controller, timingPoint) => bindReplacementRegistrationDependencies(
    originalContext(source, controller, timingPoint), replacement,
  );
  const register = {
    id: "replacement-register",
    op: "replacement.register",
    args: {
      event: c({ event: "object-killed" }),
      instead: c([]),
      duration: c("this-turn"),
      uses: c(1),
    },
  };
  const failing = {
    id: "failing-after-register",
    op: "trigger.delayed",
    args: { at: c("turn-end"), body: c([]), referent: c("unsupported") },
  };
  const beforeState = f.kernel.stateForTest();
  const beforeEventCount = f.engine.pipeline.events.length;
  assert.throws(() => {
    f.engine.execute({
      id: "replacement-rollback",
      controller: "A",
      source: f.kernel.getObject("host"),
      kind: "activated",
      speed: "normal",
      body: [register, failing],
    });
    settle(f);
  }, /referent/);
  assert.equal(f.engine.pipeline.checkpoint().replacements.size, 0);
  assert.equal(f.engine.items.length, 1);
  assert.equal(f.engine.items[0].status, "finalized");
  assert.deepEqual(f.kernel.stateForTest(), beforeState);
  assert.equal(f.engine.pipeline.events.length, beforeEventCount + 6);
  assert.equal(f.engine.pipeline.events.some(event => event.timingPoint === "chain-item-resolve"), false);
});

test("EG-DELAYED replacement.register rejects multi-use replacement without a pipeline use counter", () => {
  const f = runtime(world().player("A").player("B").unit("host").unit("victim", { owner: "B" }));
  f.kernel.setTargets("chosen", [f.kernel.ref("victim")]);
  const context = bindReplacementRegistrationDependencies(
    f.host.context(f.kernel.getObject("host"), "A", "chain-item-resolve"),
    {
      host: {
        object: ref => f.kernel.object(ref),
        objects: () => f.kernel.objects,
        context: (source, controller) => f.host.context(source, controller, "cleanup-start"),
      },
      pipeline: f.engine.pipeline,
    },
  );
  assert.throws(() => resolveChainBody([{
    id: "replacement-register",
    op: "replacement.register",
    args: {
      event: c({ event: "object-killed" }),
      instead: c([]),
      object: c({ target: "chosen" }),
      duration: c("this-turn"),
      uses: c(2),
    },
  }], context), /pipeline-persisted use counter/);
  assert.equal(f.engine.pipeline.checkpoint().replacements.size, 0);
});

test("EG-DELAYED leaves judge-required cards untouched", () => {
  for (const program of [fanfare, imperialDecree, siphoningStrike, tacticalRetreat]) {
    assert.equal(program.status, "judge-required");
  }
  assert.equal(instructionDefinitionsById.has("trigger.delayed"), true);
  assert.equal(instructionDefinitionsById.has("replacement.register"), true);
});

test("EG-DELAYED original representative cards remain fail-closed before their unrelated program gaps", () => {
  const representatives = [
    [imperialDecree, [1, "body", 0]],
    [fanfare, [0, "body", 0]],
  ];
  for (const [program, path] of representatives) {
    assert.equal(program.status, "judge-required");
    const instruction = rawDelayed(program, path);
    assert.equal(instruction.op, "trigger.delayed");
    assert.equal(instruction.args.at.kind, "constant");
  }
});
