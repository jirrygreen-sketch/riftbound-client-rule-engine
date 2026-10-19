import assert from "node:assert/strict";
import test from "node:test";
import ready from "../../../src/effects/instructions/effect.ready.ts";
import { runAbilityBody } from "../../../dist/effects/interpreter.js";
import { AwaitChoice, runInstruction, world } from "../../../src/effects/testing/index.ts";
import {
  bindResolveContext,
  createActionPipelineHost
} from "../../../dist/events/action-adapter.js";
import { ChainEngine } from "../../../dist/chain/engine.js";
import { EventPipeline } from "../../../dist/events/pipeline.js";
import { triggerEventObjectBinding } from "../../../dist/events/pipeline-types.js";

const literal = (value) => ({ kind: "constant", value });
const FIORA_CANONICAL_ID =
  "card.hash-261f97a75639fd51dc63b8c4b2a577b52d5bd6893227a1a3a13da5375880fe6f";
const target = (id) => literal({ kind: "target", id });
const pick = (id) => literal({ kind: "pick", id });
const source = literal({ kind: "source" });
const eventIt = literal({ event: "it" });
const query = (filter) => literal({ kind: "query", filter });
const choose = (id, filter, extra = {}) => literal({ kind: "choose", id, filter, ...extra });
const linked = (key) => ({ kind: "linked-value", instructionId: "previous-instruction", key });
const battlefield = { type: "battlefield", id: "battlefield-1" };
const mech = (id, values = {}) => ({ name: id, types: ["unit"], tags: ["Mech"], ...values });
const gear = (id, values = {}) => ({
  name: id,
  types: ["gear"],
  zone: "board",
  location: battlefield,
  energy: null,
  power: null,
  ...values
});
const withSource = (kernel, id) => kernel.clone({ sourceSnapshot: kernel.getObject(id) });
const readyAction = (run) => run.events.filter((event) => event.action === "ready");
const readyInstruction = (id = "ready-event-it") => ({
  id,
  op: "effect.ready",
  args: { objects: eventIt, linkKey: literal("readied") }
});
const bindingFor = (snapshot, overrides = {}) => ({
  eventId: 41,
  role: "it",
  ref: { id: snapshot.ref.id, zoneEntryId: snapshot.ref.zoneEntryId },
  snapshot: structuredClone(snapshot),
  ...overrides
});
const eventContext = (kernel, eventObject, overrides = {}) => new Proxy(kernel, {
  get(target, key) {
    if (key === "source") return target.getObject("fiora") ?? target.source;
    if (key === "controller") return "A";
    if (key === "timingPoint") return "might-changed";
    if (key === "eventObject") return eventObject;
    if (key in overrides) return overrides[key];
    const value = Reflect.get(target, key);
    return typeof value === "function" ? value.bind(target) : value;
  }
});

test("effect.ready readies an exhausted current target and links the actual result", () => {
  const kernel = world()
    .unit("exhausted", { exhausted: true })
    .unit("ready")
    .build();
  const run = runInstruction(ready, { objects: target("chosen-unit") }, {
    world: kernel,
    targets: { "chosen-unit": [kernel.ref("exhausted"), kernel.ref("ready")] }
  });
  assert.equal(ready.op, "effect.ready");
  assert.equal(run.result.status, "executed");
  assert.equal(kernel.getObject("exhausted").exhausted, false);
  assert.equal(kernel.getObject("ready").exhausted, false);
  // CR 416.1.b/416.1.c: an already-Ready object is not Readied again.
  assert.equal(readyAction(run).length, 1);
  assert.deepEqual(readyAction(run).map((event) => event.action), ["ready"]);
  assert.equal(run.events.length, 1);
  assert.deepEqual(run.linked.readied, {
    count: 1,
    objects: [kernel.ref("exhausted")]
  });
  assert.deepEqual(run.result.linkedValues, run.linked);
});

test("effect.ready readies the ability source and keeps printed null values", () => {
  const kernel = withSource(
    world().unit("lucian", { exhausted: true, energy: null, power: null }).build(),
    "lucian"
  );
  const run = runInstruction(ready, {}, { world: kernel });
  assert.equal(run.result.status, "executed");
  assert.equal(kernel.getObject("lucian").exhausted, false);
  assert.equal(kernel.getObject("lucian").energy, null);
  assert.equal(kernel.getObject("lucian").power, null);
  assert.deepEqual(run.linked.readied.objects, [kernel.ref("lucian")]);
});

for (const status of ["replaced", "prevented", "impossible"]) {
  test(`effect.ready returns negated when the Ready action is ${status}`, () => {
    const kernel = withSource(world().unit("u1", { exhausted: true }).build(), "u1");
    kernel.addReplacement((action) => (action.type === "ready" ? status : null));
    const run = runInstruction(ready, {}, { world: kernel });
    assert.equal(run.result.status, "negated");
    assert.equal(run.result.reason, status === "replaced" ? "replaced" : "impossible");
    assert.equal(kernel.getObject("u1").exhausted, true);
    assert.equal(kernel.player("A").energy, 0);
    assert.deepEqual(run.linked.readied, { count: 0, objects: [] });
    assert.equal(run.events[0].outcome, status);
  });
}

test("effect.ready is ignored when a locked target left the board and returned", () => {
  const kernel = world().unit("u1", { exhausted: true }).build();
  const locked = [kernel.ref("u1")];
  assert.equal(kernel.perform({ type: "return-to-hand", object: kernel.ref("u1") }).status, "done");
  assert.equal(
    kernel.perform({
      type: "move-zone",
      object: kernel.ref("u1"),
      to: "battlefield",
      location: battlefield
    }).status,
    "done"
  );
  const before = kernel.stateForTest();
  const run = runInstruction(ready, { objects: target("chosen-unit") }, {
    world: kernel,
    targets: { "chosen-unit": locked }
  });
  assert.deepEqual(run.result, { status: "ignored", reason: "mistargeted" });
  assert.equal(run.events.length, 0);
  assert.deepEqual(kernel.stateForTest(), before);
  assert.deepEqual(run.linked, {});
  assert.notDeepEqual(kernel.ref("u1"), locked[0]);
});

test("effect.ready ignores a stale pick while keeping legal members of the group", () => {
  const kernel = world()
    .object("rune-a", gear("rune-a", { types: ["rune"], exhausted: true }))
    .object("rune-b", gear("rune-b", { types: ["rune"], exhausted: true }))
    .build();
  const stale = kernel.ref("rune-a");
  assert.equal(kernel.perform({ type: "recycle", object: stale }).status, "done");
  const run = runInstruction(ready, { objects: pick("runes") }, {
    world: kernel,
    picks: { runes: [stale, kernel.ref("rune-b")] }
  });
  assert.equal(run.result.status, "executed");
  assert.equal(kernel.getObject("rune-b").exhausted, false);
  assert.deepEqual(run.linked.readied.objects, [kernel.ref("rune-b")]);
});

test("effect.ready ignores the instruction when every pick reference is stale", () => {
  const kernel = world().unit("u1", { exhausted: true }).build();
  const stale = kernel.ref("u1");
  assert.equal(kernel.perform({ type: "kill", object: stale }).status, "done");
  const before = kernel.stateForTest();
  const run = runInstruction(ready, { objects: pick("units") }, {
    world: kernel,
    picks: { units: [stale] }
  });
  assert.deepEqual(run.result, { status: "ignored", reason: "mistargeted" });
  assert.deepEqual(kernel.stateForTest(), before);
});

test("effect.ready amount zero performs no action and asks no question", () => {
  const kernel = world().unit("u1", { exhausted: true }).build();
  const before = kernel.stateForTest();
  const run = runInstruction(
    ready,
    { objects: choose("chosen-unit", { type: "unit", controller: "A" }), amount: literal(0) },
    { world: kernel }
  );
  assert.equal(run.result.status, "executed");
  assert.equal(run.asked, null);
  assert.equal(run.events.length, 0);
  assert.equal(kernel.getObject("u1").exhausted, true);
  assert.deepEqual(kernel.stateForTest(), before);
  assert.deepEqual(run.linked.readied, { count: 0, objects: [] });
});

test("effect.ready amount above the available count readies every usable object", () => {
  const kernel = world()
    .unit("a", { exhausted: true })
    .unit("b", { exhausted: true })
    .unit("c")
    .build();
  const run = runInstruction(
    ready,
    { objects: query({ zone: "board", type: "unit", controller: "A" }), amount: literal(99) },
    { world: kernel }
  );
  assert.equal(run.result.status, "executed");
  assert.equal(readyAction(run).length, 2);
  assert.equal(run.linked.readied.count, 2);
  assert.deepEqual(run.linked.readied.objects, [kernel.ref("a"), kernel.ref("b")]);
  for (const id of ["a", "b", "c"]) assert.equal(kernel.getObject(id).exhausted, false);
});

test("effect.ready suspends for a resolution-time choice and replays with the answer", () => {
  const kernel = world()
    .object("z-rune", gear("z-rune", { types: ["rune"], exhausted: true }))
    .object("a-rune", gear("a-rune", { types: ["rune"], exhausted: true }))
    .build();
  const args = { objects: choose("runes", { zone: "board", type: "rune", controller: "A" }) };
  const before = kernel.stateForTest();
  const asked = runInstruction(ready, args, { world: kernel });
  assert.ok(asked.asked instanceof AwaitChoice);
  assert.equal(asked.result, null);
  assert.deepEqual(asked.asked.request, {
    id: "runes",
    type: "select-objects",
    chooser: "A",
    visibility: "public",
    options: [kernel.ref("a-rune"), kernel.ref("z-rune")],
    min: 1,
    max: 1
  });
  assert.deepEqual(kernel.stateForTest(), before);
  const replayed = runInstruction(ready, args, {
    world: kernel,
    answers: { runes: [kernel.ref("z-rune")] }
  });
  assert.equal(replayed.result.status, "executed");
  assert.equal(kernel.getObject("z-rune").exhausted, false);
  assert.equal(kernel.getObject("a-rune").exhausted, true);
  assert.deepEqual(replayed.linked.readied.objects, [kernel.ref("z-rune")]);
});

test("effect.ready rejects malformed arguments and forged choice answers", () => {
  for (const invalid of [null, 7, "runes", { unknown: literal(1) }, { objects: Symbol("x") }]) {
    assert.throws(() => ready.argsSchema.parse(invalid), TypeError);
  }
  // 直接给出的字面值（未经 Expr 包装）在 parse 阶段即完全校验。
  for (const invalid of [
    { amount: -1 },
    { amount: 1.5 },
    { amount: "all" },
    { linkKey: "" },
    { objects: 7 },
    { objects: null },
    { objects: { kind: "nonsense" } },
    { objects: { kind: "choose", id: "x" } }
  ]) {
    assert.throws(() => ready.argsSchema.parse(invalid), TypeError);
  }
  assert.deepEqual(ready.argsSchema.parse({ objects: { kind: "source" }, amount: 0 }), {
    objects: { kind: "source" },
    amount: 0
  });
  for (const invalid of [
    { objects: 7 },
    { objects: literal(null) },
    { objects: { kind: "nonsense" } },
    { objects: { kind: "target" } },
    { objects: { kind: "query" } },
    { objects: { kind: "choose", id: "x" } },
    { objects: { kind: "choose", id: "x", filter: {}, min: 2, max: 1 } },
    { objects: { kind: "choose", id: "x", filter: {}, max: 1.5 } },
    { amount: literal(-1) },
    { amount: literal(1.5) },
    { amount: "all", objects: source },
    { linkKey: literal("") }
  ]) {
    const kernel = world().unit("u1", { exhausted: true }).build();
    assert.throws(() => runInstruction(ready, invalid, { world: kernel }), TypeError);
    assert.equal(kernel.events.length, 0);
    assert.equal(kernel.getObject("u1").exhausted, true);
  }
  for (const answer of [[], [{ id: "unknown", zoneEntryId: 1 }], [{ id: "u1", zoneEntryId: "1" }]]) {
    const kernel = world().unit("u1", { exhausted: true }).build();
    assert.throws(
      () =>
        runInstruction(ready, { objects: choose("unit", { type: "unit" }) }, {
          world: kernel,
          answers: { unit: answer }
        }),
      TypeError
    );
    assert.equal(kernel.getObject("u1").exhausted, true);
  }
});

test("effect.ready accepts only the exact static event:it selector", () => {
  const expected = { objects: { event: "it" } };
  assert.deepEqual(ready.argsSchema.parse(expected), expected);
  assert.deepEqual(
    ready.argsSchema.parse({ objects: { event: "it" }, amount: 1, linkKey: "eventReady" }),
    { objects: { event: "it" }, amount: 1, linkKey: "eventReady" }
  );

  for (const objects of [
    { event: "source" },
    { event: "target" },
    { event: "it", extra: true },
    { event: "it", target: "unit" },
    { event: "it", id: "event-unit", zoneEntryId: 1 },
    { event: 1 },
    { event: null },
    { event: undefined },
    { kind: "event", event: "it" },
    { event: "it", id: "event-unit" },
    { event: "it", zoneEntryId: 1 }
  ]) {
    assert.throws(() => ready.argsSchema.parse({ objects }), TypeError, JSON.stringify(objects));
  }

  const runtimeRef = { id: "event-unit", zoneEntryId: 1 };
  assert.deepEqual(ready.argsSchema.parse({ objects: runtimeRef }), { objects: runtimeRef });
});

test("effect.ready readies the exact event object, not Fiora or the source", () => {
  const kernel = world()
    .unit("fiora", { cardId: FIORA_CANONICAL_ID, might: 5, exhausted: true })
    .unit("becomes-mighty", {
      might: 5,
      exhausted: true,
      location: { type: "battlefield", id: "battlefield-1" }
    })
    .build();
  const eventSnapshot = kernel.getObject("becomes-mighty");
  const binding = bindingFor(eventSnapshot);
  const before = kernel.stateForTest();
  let chooseCalls = 0;
  const ctx = eventContext(kernel, (role) => role === "it" ? binding : null, {
    choose() {
      chooseCalls += 1;
      throw new Error("event:it must not choose a player target");
    }
  });

  const result = ready.execute(ctx, ready.argsSchema.parse({ objects: eventIt }));
  assert.equal(result.status, "executed");
  assert.equal(kernel.getObject("becomes-mighty").exhausted, false);
  assert.equal(kernel.getObject("fiora").exhausted, true);
  assert.deepEqual(result.events.map((event) => event.action), ["ready"]);
  assert.deepEqual(result.linkedValues.readied, {
    count: 1,
    objects: [binding.ref]
  });
  assert.equal(chooseCalls, 0);
  assert.notDeepEqual(kernel.stateForTest(), before);
});

test("event:it ready is idempotent and emits exactly one receipt-backed Ready event", () => {
  const kernel = world().unit("event-unit", { exhausted: true }).build();
  const binding = bindingFor(kernel.getObject("event-unit"));
  const ctx = eventContext(kernel, (role) => role === "it" ? binding : null);
  const args = ready.argsSchema.parse({ objects: eventIt });

  const first = ready.execute(ctx, args);
  const second = ready.execute(ctx, args);
  assert.equal(first.status, "executed");
  assert.equal(second.status, "executed");
  assert.deepEqual(first.events.map((event) => event.action), ["ready"]);
  assert.equal(second.events.length, 0);
  assert.deepEqual(first.linkedValues.readied, { count: 1, objects: [binding.ref] });
  assert.deepEqual(second.linkedValues.readied, { count: 0, objects: [] });
  assert.equal(kernel.events.filter((event) => event.action === "ready").length, 1);
});

test("event:it never follows a stale id into a new incarnation or uses event LKI", () => {
  const kernel = world().unit("event-unit", { exhausted: true }).build();
  const stale = kernel.ref("event-unit");
  const binding = bindingFor(kernel.getObject("event-unit"));
  assert.equal(kernel.perform({ type: "return-to-hand", object: stale }).status, "done");
  assert.equal(
    kernel.perform({
      type: "move-zone",
      object: kernel.ref("event-unit"),
      to: "battlefield",
      location: battlefield
    }).status,
    "done"
  );
  assert.equal(kernel.getObject("event-unit").exhausted, true);
  const before = kernel.stateForTest();
  const ctx = eventContext(kernel, (role) => role === "it" ? binding : null);
  const result = ready.execute(ctx, ready.argsSchema.parse({ objects: eventIt }));

  assert.deepEqual(result, { status: "ignored", reason: "mistargeted" });
  assert.notDeepEqual(kernel.ref("event-unit"), stale);
  assert.equal(kernel.getObject("event-unit").exhausted, true);
  assert.deepEqual(kernel.stateForTest(), before);
});

test("event:it obeys amount zero after validating its frozen binding", () => {
  const kernel = world().unit("event-unit", { exhausted: true }).build();
  const binding = bindingFor(kernel.getObject("event-unit"));
  const before = kernel.stateForTest();
  const result = ready.execute(
    eventContext(kernel, (role) => role === "it" ? binding : null),
    ready.argsSchema.parse({ objects: eventIt, amount: 0 })
  );

  assert.equal(result.status, "executed");
  assert.equal(result.events.length, 0);
  assert.deepEqual(result.linkedValues.readied, { count: 0, objects: [] });
  assert.equal(kernel.getObject("event-unit").exhausted, true);
  assert.deepEqual(kernel.stateForTest(), before);
});

test("event:it rejects missing and forged bindings with no state or resource side effects", () => {
  const validKernel = world().unit("event-unit", { exhausted: true }).build();
  const snapshot = validKernel.getObject("event-unit");
  const malformed = [
    undefined,
    () => null,
    () => bindingFor(snapshot, { role: "source" }),
    () => bindingFor(snapshot, { eventId: 0 }),
    () => bindingFor(snapshot, { ref: { id: snapshot.ref.id, zoneEntryId: snapshot.ref.zoneEntryId + 1 } }),
    () => bindingFor(snapshot, { snapshot: { ...snapshot, ref: { id: snapshot.ref.id, zoneEntryId: snapshot.ref.zoneEntryId + 1 } } })
  ];

  for (const eventObject of malformed) {
    const kernel = world()
      .player("A", { energy: 3, power: ["Order", "Fury"] })
      .unit("fiora", { cardId: FIORA_CANONICAL_ID, exhausted: true })
      .unit("event-unit", { exhausted: true })
      .build();
    const before = kernel.stateForTest();
    const ctx = eventContext(kernel, eventObject);
    assert.throws(
      () => ready.execute(ctx, ready.argsSchema.parse({ objects: eventIt })),
      (error) => error?.name === "Error" && /event object binding|no it object/i.test(error.message),
      String(eventObject)
    );
    assert.deepEqual(kernel.stateForTest(), before);
    assert.deepEqual(kernel.player("A").power, ["Order", "Fury"]);
    assert.equal(kernel.player("A").energy, 3);
    assert.deepEqual(kernel.player("A").runes, []);
    assert.deepEqual(kernel.stateForTest(), before);
    assert.equal(kernel.events.length, 0);
  }

  const zero = world().unit("event-unit", { exhausted: true }).build();
  const zeroBefore = zero.stateForTest();
  assert.throws(
    () => ready.execute(eventContext(zero, () => null), ready.argsSchema.parse({ objects: eventIt, amount: 0 })),
    (error) => error?.name === "Error" && /no it object/i.test(error.message)
  );
  assert.deepEqual(zero.stateForTest(), zeroBefore);
});

test("a later suspension rolls back a prior event:it Ready and its receipt", () => {
  const kernel = world().unit("event-unit", { exhausted: true }).build();
  const binding = bindingFor(kernel.getObject("event-unit"));
  const laterChoice = {
    id: "later-choice",
    op: "choice.optional",
    args: { body: literal([]) }
  };
  const before = kernel.stateForTest();
  const waiting = runInstruction(
    {
      op: "test.ready-then-suspend",
      argsSchema: { parse: (value) => value },
      execute: (current) => runAbilityBody(
        [readyInstruction(), laterChoice],
        new Proxy(current, {
          get(target, key) {
            if (key === "eventObject") return (role) => role === "it" ? binding : null;
            const value = Reflect.get(target, key);
            return typeof value === "function" ? value.bind(target) : value;
          }
        })
      )
    },
    {},
    { world: kernel }
  );

  // runInstruction rolls the TestWorld back when the interpreter suspends.
  assert.ok(waiting.asked instanceof AwaitChoice);
  assert.equal(kernel.getObject("event-unit").exhausted, true);
  assert.deepEqual(kernel.stateForTest(), before);
});

test("interpreter ignores event:it without a binding and rejects an extra selector key", () => {
  const missing = world().unit("source").unit("event-unit", { exhausted: true }).build();
  const missingBefore = missing.stateForTest();
  const ignored = runAbilityBody([readyInstruction()], eventContext(missing, undefined));
  assert.equal(ignored.status, "partial");
  assert.deepEqual(ignored.results[0].result, { status: "ignored", reason: "mistargeted" });
  assert.deepEqual(missing.stateForTest(), missingBefore);

  const invalid = world().unit("source").unit("event-unit", { exhausted: true }).build();
  const invalidBefore = invalid.stateForTest();
  assert.throws(
    () =>
      runAbilityBody(
        [{
          ...readyInstruction(),
          args: { objects: literal({ event: "it", target: "unit" }) }
        }],
        eventContext(invalid, () => bindingFor(invalid.getObject("event-unit")))
      ),
    TypeError
  );
  assert.deepEqual(invalid.stateForTest(), invalidBefore);
});

test("a real EventPipeline trigger carries event:it through Resolve and commits one Ready receipt", () => {
  const kernel = world()
    .unit("fiora", { cardId: FIORA_CANONICAL_ID, might: 5, exhausted: true })
    .unit("event-unit", { exhausted: true })
    .build();
  const asked = [];
  const choose = (request) => {
    asked.push(request);
    throw new AwaitChoice(request);
  };
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: (saved) => {
      kernel.restore(saved.state);
      kernel.copyLinkedFrom(saved.links);
    },
    objects: () => kernel.objects,
    perform: (action) => kernel.perform(action),
    performContract: (action) => kernel.performContract(action),
    performBatchLeaf: (action, batchId) => kernel.performBatchLeafForCapability(action, batchId),
    choose,
    context: (source, controller, timingPoint) => {
      return bindResolveContext(kernel, { source, controller, timingPoint, choose });
    },
    testTrigger: (registration) => kernel.test(registration.spec.condition)
  });
  const pipeline = new EventPipeline(host, ["A", "B"], "A");
  const snapshots = [];
  pipeline.onTrigger = (snapshot) => snapshots.push(snapshot);
  pipeline.registerTrigger({
    id: "fiora-worthy-ready-observer",
    source: kernel.getObject("fiora"),
    controller: "A",
    spec: { at: "might-changed", filter: {} },
    body: [readyInstruction()]
  });

  const eventUnit = kernel.getObject("event-unit");
  const event = pipeline.emit({
    timingPoint: "might-changed",
    kind: "might-changed",
    object: eventUnit,
    it: eventUnit,
    player: "A"
  });
  assert.equal(snapshots.length, 1);
  assert.deepEqual(snapshots[0].event.it.ref, event.it.ref);
  const binding = triggerEventObjectBinding(snapshots[0], "it");
  assert.ok(binding);
  assert.deepEqual(binding.ref, kernel.ref("event-unit"));

  const context = bindResolveContext(
    host.context(kernel.getObject("fiora"), "A", "chain-item-resolve"),
    { eventObject: (role) => role === "it" ? binding : null }
  );
  const before = kernel.stateForTest();
  const outcome = runAbilityBody([readyInstruction()], context);
  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.results[0].result.status, "executed");
  assert.equal(kernel.getObject("event-unit").exhausted, false);
  assert.equal(kernel.getObject("fiora").exhausted, true);
  const readyEvents = outcome.events.filter((candidate) => candidate.action === "ready");
  assert.equal(readyEvents.length, 1);
  // TestWorld's primitive receipt and the default adapter's timing id both
  // identify the committed action; this seam need not invent a pipeline event.
  assert.equal(readyEvents[0].reason, "ready");
  assert.deepEqual(outcome.linkedValues["ready-event-it.readied"], {
    count: 1,
    objects: [binding.ref]
  });
  assert.notDeepEqual(kernel.stateForTest(), before);
  assert.deepEqual(asked, []);

  const beforeReplay = kernel.stateForTest();
  const replay = runAbilityBody([readyInstruction()], context);
  assert.equal(replay.status, "executed");
  assert.equal(replay.events.length, 0);
  assert.deepEqual(replay.linkedValues["ready-event-it.readied"], { count: 0, objects: [] });
  assert.deepEqual(kernel.stateForTest(), beforeReplay);
});

test("default Chain Finalize then Resolve readies event:it exactly once", () => {
  const kernel = world()
    .unit("fiora", { cardId: FIORA_CANONICAL_ID, might: 5, exhausted: true })
    .unit("event-unit", { exhausted: true })
    .build();
  const choose = (request) => { throw new AwaitChoice(request); };
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: (saved) => {
      kernel.restore(saved.state);
      kernel.copyLinkedFrom(saved.links);
    },
    objects: () => kernel.objects,
    perform: (action) => kernel.perform(action),
    performContract: (action) => kernel.performContract(action),
    performBatchLeaf: (action, batchId) => kernel.performBatchLeafForCapability(action, batchId),
    choose,
    context: (source, controller, timingPoint) =>
      bindResolveContext(kernel, { source, controller, timingPoint, choose }),
    testTrigger: (registration) => kernel.test(registration.spec.condition)
  });
  const engine = new ChainEngine({
    turnOrder: ["A", "B"],
    turnPlayer: "A",
    phase: "main",
    host,
    cleanup: () => false
  });
  engine.pipeline.registerTrigger({
    id: "fiora-worthy-ready-default-chain",
    source: kernel.getObject("fiora"),
    controller: "A",
    spec: { at: "might-changed", filter: {} },
    body: [readyInstruction()]
  });
  const eventSnapshot = kernel.getObject("event-unit");
  const emitted = engine.pipeline.emit({
    timingPoint: "might-changed",
    kind: "might-changed",
    object: eventSnapshot,
    it: eventSnapshot,
    player: "A"
  });
  assert.equal(engine.items.length, 1);
  assert.equal(engine.items[0].status, "pending");
  assert.equal(engine.items[0].trigger.event.eventId, emitted.eventId);
  assert.deepEqual(engine.items[0].trigger.event.it.ref, kernel.ref("event-unit"));

  engine.advance();
  assert.equal(engine.items[0].status, "finalized");
  assert.equal(kernel.getObject("event-unit").exhausted, true);
  assert.equal(engine.priority, "A");
  engine.pass("A");
  assert.equal(engine.priority, "B");
  assert.equal(engine.items.length, 1);
  engine.pass("B");

  assert.equal(engine.items.length, 0);
  assert.equal(kernel.getObject("event-unit").exhausted, false);
  assert.equal(kernel.getObject("fiora").exhausted, true);
  const resolved = engine.pipeline.events.filter((candidate) => candidate.timingPoint === "object-readied");
  assert.equal(resolved.length, 1);
  assert.equal(resolved[0].action.type, "ready");
  assert.deepEqual(resolved[0].object.ref, kernel.ref("event-unit"));
  assert.deepEqual(
    engine.pipeline.events.filter((candidate) => candidate.timingPoint === "became-target"),
    []
  );
  assert.equal(kernel.player("A").power.length, 0);
});

test("effect.ready negates an impossible forced choice and caps it to the available amount", () => {
  const empty = world().unit("u1").build();
  const impossible = runInstruction(
    ready,
    { objects: choose("runes", { zone: "board", type: "rune", controller: "A" }, { min: 2, max: 2 }) },
    { world: empty }
  );
  assert.deepEqual(impossible.result, { status: "negated", reason: "impossible", events: [] });
  assert.equal(empty.events.length, 0);

  const kernel = world()
    .object("r1", gear("r1", { types: ["rune"], exhausted: true }))
    .object("r2", gear("r2", { types: ["rune"], exhausted: true }))
    .build();
  const args = { objects: choose("runes", { zone: "board", type: "rune", controller: "A" }, { min: 1, max: 4 }) };
  const asked = runInstruction(ready, args, { world: kernel });
  assert.ok(asked.asked instanceof AwaitChoice);
  // "Ready up to N" is bounded by the actually available objects (359.3.e.11).
  assert.equal(asked.asked.request.max, 2);
  assert.equal(asked.asked.request.min, 1);
  const run = runInstruction(ready, args, {
    world: kernel,
    answers: { runes: [kernel.ref("r1"), kernel.ref("r2")] }
  });
  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.readied.count, 2);
});

test("effect.ready executes an empty collection query without any action", () => {
  const kernel = world().unit("u1").build();
  const before = kernel.stateForTest();
  const run = runInstruction(
    ready,
    { objects: query({ zone: "board", type: "rune", controller: "A" }) },
    { world: kernel }
  );
  assert.equal(run.result.status, "executed");
  assert.equal(run.events.length, 0);
  assert.deepEqual(kernel.stateForTest(), before);
  assert.deepEqual(run.linked.readied, { count: 0, objects: [] });
});

test("effect.ready consumes a linked object list and honours a custom link key", () => {
  const kernel = world().unit("u1", { exhausted: true }).build();
  const run = runInstruction(
    ready,
    { objects: linked("readied"), linkKey: literal("readiedAgain") },
    { world: kernel, linked: { readied: { count: 1, objects: [kernel.ref("u1")] } } }
  );
  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.readiedAgain.count, 1);
  assert.deepEqual(run.linked.readiedAgain.objects, [kernel.ref("u1")]);
  // 输入链接值保持原样，只有 linkKey 指向的新结果被写入。
  assert.deepEqual(run.linked.readied, { count: 1, objects: [kernel.ref("u1")] });
  const again = runInstruction(
    ready,
    { objects: linked("readied"), linkKey: literal("readiedAgain") },
    { world: kernel, linked: { readied: { count: 1, objects: [kernel.ref("u1")] } } }
  );
  assert.equal(again.result.status, "executed");
  assert.equal(again.events.length, 0);
  assert.deepEqual(again.linked.readiedAgain, { count: 0, objects: [] });
});

test("sfd-062-221 Bubble Bot readies another friendly Mech", () => {
  const kernel = withSource(
    world()
      .unit("bubble-bot", mech("bubble-bot", { cardId: "sfd-062-221" }))
      .unit("rumble", mech("rumble", { exhausted: true }))
      .unit("enemy-mech", mech("enemy-mech", { owner: "B", controller: "B", exhausted: true }))
      .build(),
    "bubble-bot"
  );
  const run = runInstruction(ready, { objects: target("another-friendly-mech") }, {
    world: kernel,
    targets: { "another-friendly-mech": [kernel.ref("rumble")] }
  });
  assert.equal(run.result.status, "executed");
  assert.equal(kernel.getObject("rumble").exhausted, false);
  assert.equal(kernel.getObject("bubble-bot").exhausted, false);
  assert.equal(kernel.getObject("enemy-mech").exhausted, true);
  assert.deepEqual(run.linked.readied.objects, [kernel.ref("rumble")]);
  assert.deepEqual(readyAction(run).map((event) => event.action), ["ready"]);
});

test("sfd-221-221 Veiled Temple readies a friendly gear and links it for the detach clause", () => {
  const kernel = world()
    .unit("attacker")
    .object("temple-gear", gear("temple-gear", { exhausted: true }))
    .object("other-gear", gear("other-gear"))
    .build();
  const run = runInstruction(ready, { objects: target("friendly-gear") }, {
    world: kernel,
    targets: { "friendly-gear": [kernel.ref("temple-gear")] }
  });
  assert.equal(run.result.status, "executed");
  assert.equal(kernel.getObject("temple-gear").exhausted, false);
  assert.equal(kernel.getObject("other-gear").exhausted, false);
  assert.deepEqual(run.linked.readied, {
    count: 1,
    objects: [kernel.ref("temple-gear")]
  });
  // "If it's an Equipment, you may detach it." consumes the linked result of this instruction.
  const followUp = runInstruction(ready, { objects: linked("readied") }, {
    world: kernel,
    linked: { readied: run.linked.readied }
  });
  assert.equal(followUp.result.status, "executed");
  assert.equal(followUp.events.length, 0);
  assert.deepEqual(followUp.linked.readied, { count: 0, objects: [] });
});

test("sfd-113-221 Lucian readies itself on conquering without touching resources", () => {
  const kernel = withSource(
    world().unit("lucian", { cardId: "sfd-113-221", exhausted: true, damage: 1 }).build(),
    "lucian"
  );
  const run = runInstruction(ready, { objects: source }, { world: kernel });
  assert.equal(run.result.status, "executed");
  assert.equal(kernel.getObject("lucian").exhausted, false);
  assert.equal(kernel.getObject("lucian").damage, 1);
  assert.equal(kernel.player("A").energy, 0);
  assert.deepEqual(kernel.continuousEffects, []);
  assert.deepEqual(kernel.delayedTriggers, []);
});

test("sfd-180-221 Fiora readies the unit that became Mighty", () => {
  const kernel = world().unit("fiora", { cardId: "sfd-180-221", might: 5, exhausted: true }).build();
  const run = runInstruction(ready, { objects: target("mighty-unit") }, {
    world: kernel,
    targets: { "mighty-unit": [kernel.ref("fiora")] }
  });
  assert.equal(run.result.status, "executed");
  assert.equal(kernel.getObject("fiora").exhausted, false);
  assert.equal(kernel.getObject("fiora").might, 5);
  assert.deepEqual(run.linked.readied.objects, [kernel.ref("fiora")]);
});
