import assert from "node:assert/strict";
import test from "node:test";
import copy from "../../../src/effects/instructions/effect.copy.ts";
import { AwaitChoice, runInstruction, world } from "../../../src/effects/testing/index.ts";

const literal = value => ({ kind: "literal", value });
const target = id => literal({ target: id });
const pick = id => literal({ pick: id });
const base = { type: "base", player: "A" };
const battlefield = { type: "battlefield", id: "battlefield-1" };
const args = overrides => ({ source: target("model"), location: literal(base), ...overrides });
const targets = kernel => ({ model: [kernel.ref("model")] });
const setup = () => world().unit("model", {
  name: "Original", cardId: "test-model", might: 4, energy: 3, power: ["Mind"],
  tags: ["Test"], keywords: [{ id: "ganking" }]
}).build();
const copies = kernel => kernel.objects.filter(object => object.ref.id.startsWith("copy-"));

test("effect.copy creates a distinct object through the copy action and links actual references", () => {
  const kernel = setup();
  const original = kernel.getObject("model");
  const actions = [];
  kernel.addReplacement(action => { actions.push(action); return null; });
  const run = runInstruction(copy, args(), { world: kernel, targets: targets(kernel) });
  assert.equal(copy.op, "effect.copy");
  assert.equal(run.result.status, "executed");
  const [created] = copies(kernel);
  assert.notDeepEqual(created.ref, original.ref);
  for (const key of ["cardId", "name", "types", "tags", "keywords", "might", "energy", "power"]) {
    assert.deepEqual(created[key], original[key]);
  }
  assert.equal(created.isToken, true);
  assert.equal(created.owner, "A");
  assert.equal(created.controller, "A");
  assert.deepEqual(created.location, base);
  assert.deepEqual(kernel.getObject("model"), original);
  assert.deepEqual(actions, [{ type: "copy", source: original.ref, player: "A", location: base }]);
  assert.deepEqual(run.linked.copied, {
    amount: 1, objects: [created.ref], sources: [original.ref], objectsComplete: true
  });
  assert.deepEqual(run.linked["copied.objects"], [created.ref]);
  assert.equal(kernel.evaluate({ kind: "linked", instructionId: "prior", key: "copied.amount" }), 1);
  assert.deepEqual(run.result.linkedValues, run.linked);
  assert.deepEqual(run.result.events, run.events);
  assert.deepEqual(run.events.map(event => event.action), ["copy"]);
  assert.deepEqual(kernel.continuousEffects, []);
  assert.deepEqual(kernel.pendingItems, []);
});

test("effect.copy retains null printed energy and power rather than deriving zero costs", () => {
  const kernel = world().unit("model", { cardId: null, isToken: true, energy: null, power: null }).build();
  const run = runInstruction(copy, args(), { world: kernel, targets: targets(kernel) });
  assert.equal(run.result.status, "executed");
  const [created] = copies(kernel);
  assert.equal(created.energy, null);
  assert.equal(created.power, null);
  assert.equal(created.cardId, null);
});

for (const status of ["replaced", "prevented", "impossible"]) {
  test("effect.copy maps the " + status + " action outcome to negated with zero actual copies", () => {
    const kernel = setup();
    kernel.addReplacement(action => action.type === "copy" ? status : null);
    const run = runInstruction(copy, args(), { world: kernel, targets: targets(kernel) });
    assert.equal(run.result.status, "negated");
    assert.equal(run.result.reason, status === "replaced" ? "replaced" : "impossible");
    assert.equal(run.linked.copied.amount, 0);
    assert.equal(run.linked["copied.amount"], 0);
    assert.deepEqual(copies(kernel), []);
    assert.deepEqual(run.events.map(event => event.outcome), [status]);
    assert.deepEqual(run.result.events, run.events);
  });
}

test("effect.copy ignores all invalid targets and does not reuse an object's new zone identity", () => {
  const kernel = setup();
  const old = kernel.ref("model");
  assert.equal(kernel.perform({ type: "return-to-hand", object: old }).status, "done");
  assert.equal(kernel.object(old), null);
  const before = kernel.stateForTest();
  const run = runInstruction(copy, args(), { world: kernel, targets: { model: [old, { id: "missing", zoneEntryId: 1 }] } });
  assert.deepEqual(run.result, { status: "ignored", reason: "mistargeted" });
  assert.deepEqual(run.linked, {});
  assert.deepEqual(run.events, []);
  assert.deepEqual(kernel.stateForTest(), before);
});

test("effect.copy removes stale and duplicate targets while preserving legal source order", () => {
  const kernel = setup().clone();
  const run = runInstruction(copy, args({ amount: literal(2) }), {
    world: kernel, targets: { model: [{ id: "missing", zoneEntryId: 1 }, kernel.ref("model"), kernel.ref("model")] }
  });
  assert.equal(run.result.status, "executed");
  assert.equal(copies(kernel).length, 2);
  assert.equal(run.linked.copied.amount, 2);
  assert.deepEqual(run.linked.copied.sources, [kernel.ref("model"), kernel.ref("model")]);
});

test("effect.copy zero amount executes without actions, choices or new identities", () => {
  const kernel = setup();
  const before = kernel.stateForTest();
  const run = runInstruction(copy, args({ source: pick("models"), choiceId: literal("choose-model"), amount: literal(0) }), {
    world: kernel, picks: { models: [kernel.ref("model")] }
  });
  assert.equal(run.result.status, "executed");
  assert.equal(run.asked, null);
  assert.equal(run.linked.copied.amount, 0);
  assert.deepEqual(run.events, []);
  assert.deepEqual(kernel.stateForTest(), before);
});

test("effect.copy amount is per distinct source and does not truncate multiple originals", () => {
  const kernel = world().unit("z").unit("a").build();
  const run = runInstruction(copy, args({ source: pick("models"), amount: literal(2) }), {
    world: kernel, picks: { models: [kernel.ref("z"), "A", kernel.ref("a"), kernel.ref("z")] }
  });
  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.copied.amount, 4);
  assert.deepEqual(run.linked.copied.sources, [kernel.ref("z"), kernel.ref("z"), kernel.ref("a"), kernel.ref("a")]);
  assert.deepEqual(copies(kernel).map(object => object.name), ["z", "z", "a", "a"]);
});

test("effect.copy preserves partial actual copies and events when a later action is replaced", () => {
  const kernel = setup();
  kernel.addReplacement((action, context) => action.type === "copy" && context.history({ action: "copy" }) === 1 ? "replaced" : null);
  const run = runInstruction(copy, args({ amount: literal(2) }), { world: kernel, targets: targets(kernel) });
  assert.equal(run.result.status, "negated");
  assert.equal(run.result.reason, "replaced");
  assert.equal(run.linked.copied.amount, 1);
  assert.deepEqual(run.linked.copied.objects, copies(kernel).map(object => object.ref));
  assert.deepEqual(run.events.map(event => event.outcome ?? "done"), ["done", "replaced"]);
  assert.deepEqual(run.result.events, run.events);
});

test("effect.copy suspends a non-target choice and deterministically replays it once answered", () => {
  const build = () => world().unit("z").unit("a").build();
  const kernel = build();
  const chosen = args({ source: pick("models"), choiceId: literal("copy-model"), amount: literal(2) });
  const options = { world: kernel, picks: { models: [kernel.ref("z"), kernel.ref("a")] } };
  const before = kernel.stateForTest();
  const asked = runInstruction(copy, chosen, options);
  assert.ok(asked.asked instanceof AwaitChoice);
  assert.equal(asked.result, null);
  assert.deepEqual(asked.asked.request, {
    id: "copy-model", type: "select-objects", chooser: "A", visibility: "public",
    options: [kernel.ref("a"), kernel.ref("z")], min: 1, max: 1
  });
  assert.deepEqual(kernel.stateForTest(), before);
  assert.deepEqual(asked.linked, {});
  const answered = { "copy-model": [kernel.ref("z")] };
  const run = runInstruction(copy, chosen, { ...options, answers: answered });
  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.copied.amount, 2);
  assert.deepEqual(copies(kernel).map(object => object.name), ["z", "z"]);
  const independent = build();
  const replay = runInstruction(copy, chosen, { ...options, world: independent, answers: answered });
  assert.deepEqual(replay.result, run.result);
  assert.deepEqual(replay.linked, run.linked);
  assert.deepEqual(independent.stateForTest(), kernel.stateForTest());
});

test("effect.copy rejects forged, duplicate, stale and empty resolution-time answers transactionally", () => {
  for (const answer of [[], ["model"], [{ id: "missing", zoneEntryId: 1 }], [{ id: "model", zoneEntryId: 9 }],
    [{ id: "model", zoneEntryId: 1 }, { id: "model", zoneEntryId: 1 }]]) {
    const kernel = setup();
    const before = kernel.stateForTest();
    assert.throws(() => runInstruction(copy, args({ source: pick("models"), choiceId: literal("model-choice") }), {
      world: kernel, picks: { models: [kernel.ref("model")] }, answers: { "model-choice": answer }
    }), TypeError);
    assert.deepEqual(kernel.stateForTest(), before);
  }
});

test("effect.copy an empty non-target pick is impossible, while an empty target is ignored", () => {
  for (const [source, expected] of [[pick("models"), "negated"], [target("models"), "ignored"]]) {
    const kernel = setup();
    const run = runInstruction(copy, args({ source }), { world: kernel });
    assert.equal(run.result.status, expected);
    assert.deepEqual(copies(kernel), []);
    if (expected === "negated") assert.equal(run.linked.copied.amount, 0);
    else assert.deepEqual(run.linked, {});
  }
});

test("effect.copy accepts symbolic self and linked sources with dynamic amount and result key", () => {
  const initial = setup();
  const kernel = initial.clone({ sourceSnapshot: initial.getObject("model") });
  const first = runInstruction(copy, args({ source: literal("self") }), { world: kernel });
  assert.equal(first.result.status, "executed");
  const run = runInstruction(copy, args({
    source: literal({ linked: "copied.objects" }), linkKey: literal("again"),
    amount: { kind: "arithmetic", operator: "add", operands: [literal(1), { kind: "linked-value", instructionId: "prior", key: "copied.amount" }] }
  }), { world: kernel });
  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.again.amount, 2);
  assert.deepEqual(run.linked.again.sources, [first.linked.copied.objects[0], first.linked.copied.objects[0]]);
  assert.equal(copies(kernel).length, 3);
});

test("effect.copy symbolic object-property arguments support the controller-independent destination", () => {
  const initial = world().unit("model", { owner: "B", controller: "B" }).build();
  const kernel = initial.clone({ sourceSnapshot: initial.getObject("model") });
  const run = runInstruction(copy, args({
    source: literal("source"), player: { kind: "object-property", object: "source", property: "owner" },
    location: literal({ type: "base", player: "B" })
  }), { world: kernel });
  assert.equal(run.result.status, "executed");
  const [created] = copies(kernel);
  assert.equal(created.owner, "B");
  assert.equal(created.controller, "B");
  assert.deepEqual(created.location, { type: "base", player: "B" });
});

test("effect.copy refuses to create a unit at another player's Base", () => {
  const kernel = setup();
  const run = runInstruction(copy, args({ location: literal({ type: "base", player: "B" }) }), {
    world: kernel, targets: targets(kernel)
  });
  assert.equal(run.result.status, "negated");
  assert.equal(run.result.reason, "impossible");
  assert.equal(run.linked.copied.amount, 0);
  assert.deepEqual(run.events, []);
});

test("ven-137-166 Shady Spectacles stays blocked for equipped-unit copying until detachment is expressible", () => {
  // Card text: the equipped unit becomes a copy of another friendly unit for
  // as long as Shady Spectacles is attached to it. This must not spawn a token.
  const kernel = world().object("spectacles", {
    cardId: "ven-137-166", types: ["gear"], zone: "board", location: battlefield
  }).unit("equipped").unit("model", { might: 5 }).build();
  assert.equal(kernel.perform({ type: "attach", object: kernel.ref("spectacles"), host: kernel.ref("equipped") }).status, "done");
  const before = kernel.stateForTest();
  const run = runInstruction(copy, {
    source: pick("friendly-other"), mode: literal("effect"), onto: pick("equipped"),
    duration: literal({ type: "while-attached", source: "source", host: { pick: "equipped" } })
  }, { world: kernel, picks: { "friendly-other": [kernel.ref("model")], equipped: [kernel.ref("equipped")] } });
  assert.equal(run.result.status, "negated");
  assert.equal(run.result.reason, "impossible");
  assert.match(run.linked.copied.blockedReason, /attachment-duration-unavailable/);
  assert.deepEqual(kernel.stateForTest(), before);
  assert.deepEqual(kernel.continuousEffects, []);
  assert.deepEqual(run.events, []);
});

test("unl-086-219 Zilean Time Mage does not approximate an additional played token with Board creation", () => {
  // Card text: once each turn, while Zilean is at a battlefield, optionally
  // replace playing a token unit with playing that token and an additional copy.
  const kernel = world().unit("zilean", { cardId: "unl-086-219", location: battlefield }).build();
  const original = kernel.perform({ type: "create-token", player: "A", to: "chain", token: {
    name: "Mech", types: ["unit"], might: 3, energy: null, power: null
  } });
  assert.equal(original.status, "done");
  const before = kernel.stateForTest();
  const pending = kernel.pendingItems;
  const run = runInstruction(copy, args({ source: pick("token-being-played"), mode: literal("play") }), {
    world: kernel, picks: { "token-being-played": [original.result] }
  });
  assert.equal(run.result.status, "negated");
  assert.equal(run.linked.copied.blockedReason, "copy-action-cannot-create-a-pending-chain-object");
  assert.deepEqual(kernel.stateForTest(), before);
  assert.deepEqual(kernel.pendingItems, pending);
  assert.equal(kernel.history({ action: "play" }), 0);
  assert.deepEqual(run.events, []);
});

test("effect.copy rejects malformed Expr arguments, runtime references and unsupported exceptions", () => {
  const cycle = { kind: "arithmetic", operator: "neg", operands: [] };
  cycle.operands.push(cycle);
  for (const invalid of [null, {}, { source: "source" }, args({ amount: 1 }), args({ extra: literal(1) }),
    args({ amount: { kind: "unknown" } }), args({ amount: cycle }), args({ amount: { kind: "literal" } }),
    args({ amount: { kind: "arithmetic", operator: "sub", operands: [literal(1)] } }),
    args({ player: { kind: "object-property", object: { id: "model", zoneEntryId: 1 }, property: "owner" } }),
    args({ exceptions: literal({ might: 5 }) })]) {
    assert.throws(() => copy.argsSchema.parse(invalid), TypeError);
  }
  const kernel = setup();
  assert.throws(() => runInstruction(copy, args({ source: literal(kernel.ref("model")) }), { world: kernel }), TypeError);
  assert.deepEqual(copies(kernel), []);
});

test("effect.copy validates quantity, mode, location and choice arguments before performing any actions", () => {
  for (const overrides of [
    ...[-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, "1", null].map(amount => ({ amount: literal(amount) })),
    { mode: literal("approximate") }, { player: literal(1) }, { linkKey: literal("") }, { choiceId: literal("") },
    { choiceId: literal("cannot-reselect-target") }, { location: literal(null) }, { location: literal({ type: "somewhere" }) }
  ]) {
    const kernel = setup();
    const before = kernel.stateForTest();
    assert.throws(() => runInstruction(copy, args(overrides), { world: kernel, targets: targets(kernel) }), TypeError);
    assert.deepEqual(kernel.stateForTest(), before);
  }
  const kernel = world().unit("a").unit("b").build();
  assert.throws(() => runInstruction(copy, args({ source: pick("models"), amount: literal(Number.MAX_SAFE_INTEGER) }), {
    world: kernel, picks: { models: [kernel.ref("a"), kernel.ref("b")] }
  }), TypeError);
  assert.equal(kernel.events.length, 0);
});

test("effect.copy cannot silently treat an existing-object duration as a creation request", () => {
  const kernel = setup();
  const run = runInstruction(copy, args({ duration: literal({ type: "end-of-turn" }) }), {
    world: kernel, targets: targets(kernel)
  });
  assert.equal(run.result.status, "negated");
  assert.equal(run.linked.copied.blockedReason, "copy-create-cannot-transform-an-existing-object");
  assert.deepEqual(copies(kernel), []);
});

test("effect.copy keeps spell and rune creation blocked rather than placing them on the Board", () => {
  for (const type of ["spell", "rune"]) {
    const kernel = world().hand("model", { types: [type] }).build();
    const run = runInstruction(copy, args(), { world: kernel, targets: targets(kernel) });
    assert.equal(run.result.status, "negated");
    assert.equal(run.linked.copied.blockedReason, "copy-action-only-supports-board-permanents");
    assert.deepEqual(copies(kernel), []);
    assert.deepEqual(run.events, []);
  }
});

test("effect.copy checks surviving source and recipient targets before reporting an unsupported layer", () => {
  const kernel = setup();
  const unsupported = { source: target("model"), onto: target("recipient"), mode: literal("effect") };
  const ignored = runInstruction(copy, unsupported, { world: kernel });
  assert.deepEqual(ignored.result, { status: "ignored", reason: "mistargeted" });
  const partiallyLive = runInstruction(copy, unsupported, { world: kernel, targets: { recipient: [kernel.ref("model")] } });
  assert.equal(partiallyLive.result.status, "negated");
  assert.match(partiallyLive.linked.copied.blockedReason, /copy-layer/);
  assert.deepEqual(copies(kernel), []);
});
