import assert from "node:assert/strict";
import test from "node:test";
import { validateCardProgram } from "@riftbound/card-dsl";
import banish from "../../../dist/effects/instructions/effect.banish.js";
import play from "../../../dist/effects/instructions/effect.play.js";
import { runAbilityBody } from "../../../dist/effects/interpreter.js";
import { AwaitChoice, runInstruction, world } from "../../../dist/effects/testing/index.js";

const literal = value => ({ kind: "constant", value });
const target = id => literal({ target: id });
const pick = id => literal({ pick: id });
const choose = (id, filter, extra = {}) => literal({ choose: id, filter, ...extra });
const battlefield = { type: "battlefield", id: "battlefield-1" };
const withSource = (kernel, id) => kernel.clone({ sourceSnapshot: kernel.getObject(id) });
const zoneIds = (kernel, player, zone) => kernel.zoneSlice(player, zone, "top").map(object => object.ref.id);
const locked = kernel => ({ victims: [kernel.ref("victim")] });
const args = { objects: target("victims") };

test("effect.banish uses only banish and links the new owner-zone reference", () => {
  const kernel = world().unit("victim", { owner: "B", controller: "A", energy: null, power: null }).build();
  const old = kernel.ref("victim");
  const run = runInstruction(banish, args, { world: kernel, targets: locked(kernel) });
  assert.equal(banish.op, "effect.banish");
  assert.equal(run.result.status, "executed");
  assert.deepEqual(run.events.map(event => event.action), ["banish"]);
  assert.equal(kernel.history({ action: "banish" }), 1);
  assert.equal(kernel.history({ action: "kill" }), 0);
  assert.equal(kernel.history({ action: "discard" }), 0);
  assert.deepEqual(zoneIds(kernel, "B", "banishment"), ["victim"]);
  assert.deepEqual(zoneIds(kernel, "A", "banishment"), []);
  assert.equal(kernel.object(old), null);
  assert.notDeepEqual(kernel.ref("victim"), old);
  assert.deepEqual(run.linked.banished, { count: 1, objects: [kernel.ref("victim")], source: kernel.source.ref });
  assert.equal(run.linked.banishedCount, 1);
  assert.deepEqual(run.linked.banishedObjects, [kernel.ref("victim")]);
  assert.deepEqual(run.linked.banishedObject, kernel.ref("victim"));
  assert.deepEqual(run.result.linkedValues, run.linked);
  assert.equal(kernel.getObject("victim").energy, null);
  assert.equal(kernel.getObject("victim").power, null);
});

for (const [status, reason] of [["replaced", "replaced"], ["prevented", "skipped"], ["impossible", "impossible"]]) {
  test("effect.banish maps " + status + " to negated and links zero actual successes", () => {
    const kernel = world().unit("victim").build();
    kernel.addReplacement(action => action.type === "banish" ? status : null);
    const run = runInstruction(banish, args, { world: kernel, targets: locked(kernel) });
    assert.equal(run.result.status, "negated");
    assert.equal(run.result.reason, reason);
    assert.equal(kernel.getObject("victim").zone, "board");
    assert.equal(run.linked.banished.count, 0);
    assert.deepEqual(run.linked.banished.objects, []);
    assert.equal(run.linked.banishedCount, 0);
    assert.deepEqual(run.linked.banishedObjects, []);
    assert.equal(run.linked.banishedObject, null);
    assert.equal(run.events[0].outcome, status);
    assert.deepEqual(run.result.events, run.events);
    assert.equal(kernel.history({ action: "banish" }), 0);
  });
}

test("effect.banish continues after a replacement and links partial actual results", () => {
  const kernel = world().unit("first").unit("blocked").unit("last").build();
  kernel.addReplacement(action => action.type === "banish" && action.object.id === "blocked" ? "replaced" : null);
  const run = runInstruction(banish, args, {
    world: kernel, targets: { victims: ["first", "blocked", "last"].map(id => kernel.ref(id)) }
  });
  assert.equal(run.result.status, "negated");
  assert.equal(run.result.reason, "replaced");
  assert.deepEqual(run.events.map(event => event.outcome ?? "done"), ["done", "replaced", "done"]);
  assert.equal(kernel.getObject("blocked").zone, "board");
  assert.deepEqual(run.linked.banished.objects, [kernel.ref("first"), kernel.ref("last")]);
  assert.equal(run.linked.banished.count, 2);
  assert.equal(run.linked.banishedCount, 2);
  assert.equal(run.linked.banishedObject, null);
});

test("effect.banish ignores a target that left and returned with a new zoneEntryId", () => {
  const kernel = world().unit("victim").build();
  const targets = locked(kernel);
  assert.equal(kernel.perform({ type: "return-to-hand", object: kernel.ref("victim") }).status, "done");
  assert.equal(kernel.perform({ type: "move-zone", object: kernel.ref("victim"), to: "battlefield", location: battlefield }).status, "done");
  const before = kernel.stateForTest();
  const run = runInstruction(banish, args, { world: kernel, targets });
  assert.deepEqual(run.result, { status: "ignored", reason: "mistargeted" });
  assert.deepEqual(run.events, []);
  assert.deepEqual(run.linked, {});
  assert.deepEqual(kernel.stateForTest(), before);
});

test("effect.banish handles partially stale targets using only surviving targets", () => {
  const kernel = world().unit("victim").unit("gone").build();
  const gone = kernel.ref("gone");
  assert.equal(kernel.perform({ type: "return-to-hand", object: gone }).status, "done");
  const run = runInstruction(banish, args, { world: kernel, targets: { victims: [gone, kernel.ref("victim")] } });
  assert.equal(run.result.status, "executed");
  assert.deepEqual(run.linked.banished.objects, [kernel.ref("victim")]);
  assert.equal(kernel.getObject("gone").zone, "hand");
  assert.deepEqual(run.events.map(event => event.action), ["banish"]);
});

test("effect.banish picks ignore player ids and duplicates without becoming targets", () => {
  const kernel = world().hand("picked").hand("untouched").build();
  const ref = kernel.ref("picked");
  const run = runInstruction(banish, { objects: pick("cards") }, {
    world: kernel, picks: { cards: ["A", ref, ref] }, targets: { cards: [kernel.ref("untouched")] }
  });
  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.banished.count, 1);
  assert.deepEqual(run.linked.banished.objects, [kernel.ref("picked")]);
  assert.equal(kernel.getObject("untouched").zone, "hand");
  assert.equal(run.events.length, 1);
});

test("effect.banish stale non-target picks are impossible rather than mistargeted", () => {
  const kernel = world().hand("picked").build();
  const ref = kernel.ref("picked");
  assert.equal(kernel.perform({ type: "return-to-hand", object: ref }).status, "done");
  const run = runInstruction(banish, { objects: pick("cards") }, { world: kernel, picks: { cards: [ref] } });
  assert.equal(run.result.status, "negated");
  assert.equal(run.result.reason, "impossible");
  assert.deepEqual(run.events, []);
  assert.equal(run.linked.banished.count, 0);
});

test("effect.banish cannot banish an object already in Banishment", () => {
  const kernel = world().card("already", { zone: "banishment" }).build();
  const before = kernel.ref("already");
  const run = runInstruction(banish, args, { world: kernel, targets: { victims: [before] } });
  assert.equal(run.result.status, "negated");
  assert.equal(run.result.reason, "impossible");
  assert.deepEqual(kernel.ref("already"), before);
  assert.equal(run.linked.banished.count, 0);
  assert.deepEqual(run.events, []);
});

test("effect.banish zero amount performs no action and requests no choice", () => {
  const kernel = world().hand("card").build();
  const before = kernel.stateForTest();
  const run = runInstruction(banish, { objects: choose("select", { zone: "hand" }), amount: literal(0) }, { world: kernel });
  assert.equal(run.result.status, "executed");
  assert.equal(run.asked, null);
  assert.equal(run.linked.banished.count, 0);
  assert.deepEqual(run.linked.banished.objects, []);
  assert.deepEqual(run.events, []);
  assert.deepEqual(kernel.stateForTest(), before);
});

test("effect.banish zero does not revive an invalid target", () => {
  const run = runInstruction(banish, { ...args, amount: literal(0) }, { world: world().build(), targets: { victims: [] } });
  assert.deepEqual(run.result, { status: "ignored", reason: "mistargeted" });
  assert.deepEqual(run.linked, {});
});

test("effect.banish oversized safe counts act on every distinct available object", () => {
  const kernel = world().unit("one").unit("two").build();
  const run = runInstruction(banish, { ...args, amount: literal(Number.MAX_SAFE_INTEGER) }, {
    world: kernel, targets: { victims: [kernel.ref("one"), kernel.ref("one"), kernel.ref("two")] }
  });
  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.banished.count, 2);
  assert.equal(run.events.length, 2);
});

for (const [from, expected, remainder] of [
  ["top", ["z-top", "a-middle"], ["m-bottom"]],
  ["bottom", ["a-middle", "m-bottom"], ["z-top"]]
]) {
  test("effect.banish reads actual deck " + from + " order via zoneSlice", () => {
    const kernel = world().deck(["z-top", "a-middle", "m-bottom"], { owner: "B" }).build();
    const run = runInstruction(banish, {
      objects: literal({ zone: "deck", player: "B", from }), amount: literal(2)
    }, { world: kernel });
    assert.equal(run.result.status, "executed");
    assert.deepEqual(run.linked.banished.objects, expected.map(id => kernel.ref(id)));
    assert.deepEqual(zoneIds(kernel, "B", "deck"), remainder);
    assert.deepEqual(zoneIds(kernel, "B", "banishment"), expected);
  });
}

test("effect.banish zone amount exceeding deck size banishes as many as possible", () => {
  const kernel = world().deck(["top", "bottom"]).build();
  const run = runInstruction(banish, { objects: literal({ zone: "deck" }), amount: literal(5) }, { world: kernel });
  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.banished.count, 2);
  assert.deepEqual(zoneIds(kernel, "A", "deck"), []);
});

test("effect.banish distinguishes an empty entire zone from an impossible positive count", () => {
  for (const amount of [undefined, 0, 1]) {
    const kernel = world().build();
    const run = runInstruction(banish, {
      objects: literal({ zone: "trash" }), ...(amount === undefined ? {} : { amount: literal(amount) })
    }, { world: kernel });
    assert.equal(run.result.status, amount === 1 ? "negated" : "executed");
    if (amount === 1) assert.equal(run.result.reason, "impossible");
    assert.equal(run.linked.banished.count, 0);
    assert.deepEqual(run.events, []);
  }
});

test("effect.banish non-target selection suspends without mutation and replays deterministically", () => {
  const kernel = world().hand("z").hand("a").hand("opponent", { owner: "B" }).build();
  const selectionArgs = { objects: choose("hand-card", { zone: "hand", owner: "A" }) };
  const before = kernel.stateForTest();
  const run = runInstruction(banish, selectionArgs, { world: kernel });
  assert.ok(run.asked instanceof AwaitChoice);
  assert.equal(run.result, null);
  assert.deepEqual(run.asked.request, {
    id: "hand-card", type: "select-objects", chooser: "A", visibility: "chooser-only",
    options: [kernel.ref("a"), kernel.ref("z")], min: 1, max: 1
  });
  assert.deepEqual(kernel.stateForTest(), before);
  assert.deepEqual(run.linked, {});
  const replayWorld = kernel.clone();
  const answers = { "hand-card": [kernel.ref("z")] };
  const resolved = runInstruction(banish, selectionArgs, { world: kernel, answers });
  const replayed = runInstruction(banish, selectionArgs, { world: replayWorld, answers });
  assert.equal(resolved.result.status, "executed");
  assert.deepEqual(resolved.result, replayed.result);
  assert.deepEqual(resolved.linked, replayed.linked);
  assert.deepEqual(kernel.stateForTest(), replayWorld.stateForTest());
  assert.equal(kernel.getObject("a").zone, "hand");
  assert.equal(kernel.getObject("opponent").zone, "hand");
});

test("effect.banish public choice supports an explicit chooser and canonical action order", () => {
  const kernel = world().unit("z", { owner: "B" }).unit("a", { owner: "B" }).build();
  const selectionArgs = { objects: choose("units", { type: "unit", owner: "B" }, { chooser: "B", visibility: "public" }), amount: literal(5) };
  const asked = runInstruction(banish, selectionArgs, { world: kernel });
  assert.equal(asked.asked.request.chooser, "B");
  assert.equal(asked.asked.request.visibility, "public");
  assert.equal(asked.asked.request.min, 2);
  assert.equal(asked.asked.request.max, 2);
  const run = runInstruction(banish, selectionArgs, { world: kernel, answers: { units: [kernel.ref("z"), kernel.ref("a")] } });
  assert.equal(run.result.status, "executed");
  assert.deepEqual(run.linked.banished.objects, [kernel.ref("a"), kernel.ref("z")]);
});

test("effect.banish rejects forged, duplicate, stale, and wrong-sized choice answers transactionally", () => {
  for (const form of ["empty", "unknown", "duplicate", "stale", "string", "too-many"]) {
    const kernel = world().unit("a").unit("b").build();
    const answer = form === "empty" ? [] : form === "unknown" ? [{ id: "unknown", zoneEntryId: 1 }] :
      form === "duplicate" ? [kernel.ref("a"), kernel.ref("a")] : form === "stale" ? [{ id: "a", zoneEntryId: 99 }] :
        form === "string" ? "a" : [kernel.ref("a"), kernel.ref("b")];
    const before = kernel.stateForTest();
    assert.throws(() => runInstruction(banish, {
      objects: choose("units", { type: "unit" }), amount: literal(form === "duplicate" ? 2 : 1)
    }, { world: kernel, answers: { units: answer } }), TypeError);
    assert.deepEqual(kernel.stateForTest(), before);
  }
});

test("effect.banish missing non-target choice options negate without hanging", () => {
  const run = runInstruction(banish, { objects: choose("units", { type: "unit" }) }, { world: world().build() });
  assert.equal(run.result.status, "negated");
  assert.equal(run.result.reason, "impossible");
  assert.equal(run.asked, null);
  assert.equal(run.linked.banished.count, 0);
});

test("effect.banish evaluates arithmetic amounts and linked result keys", () => {
  const kernel = world().unit("victim").build();
  const run = runInstruction(banish, {
    ...args,
    amount: { kind: "arithmetic", operator: "add", operands: [literal(0), { kind: "linked-value", instructionId: "prior", key: "amount" }] },
    linkKey: { kind: "linked", instructionId: "prior", key: "key" }
  }, { world: kernel, targets: locked(kernel), linked: { amount: 1, key: "removed" } });
  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.removed.count, 1);
  assert.equal(run.linked.removedCount, 1);
  assert.deepEqual(run.linked.removedObject, kernel.ref("victim"));
  assert.equal(run.linked.banished, undefined);
});

test("effect.banish links can feed a subsequent zone action with the new reference", () => {
  const kernel = world().deck(["top", "rest"]).build();
  const run = runInstruction(banish, { objects: literal({ zone: "deck" }), amount: literal(1) }, { world: kernel });
  const [ref] = run.linked.banished.objects;
  assert.equal(kernel.object(ref).zone, "banishment");
  assert.equal(kernel.perform({ type: "return-to-hand", object: ref }).status, "done");
  assert.deepEqual(zoneIds(kernel, "A", "hand"), ["top"]);
  const stale = runInstruction(banish, { objects: literal({ linked: "banished" }) }, { world: kernel });
  assert.equal(stale.result.status, "negated");
  assert.equal(stale.result.reason, "impossible");
  assert.equal(stale.linked.banished.count, 0);
  assert.equal(kernel.getObject("top").zone, "hand");
});

test("effect.banish single-object link feeds the existing effect.play through an actual linked-value Expr", () => {
  const kernel = world().deck(["card", "rest"], { types: ["unit"] }).build();
  const removed = runInstruction(banish, { objects: literal({ zone: "deck" }), amount: literal(1) }, { world: kernel });
  const banishedRef = removed.linked.banishedObject;
  const played = runInstruction(play, {
    object: { kind: "linked-value", instructionId: "remove", key: "banishedObject" }
  }, { world: kernel });
  assert.equal(played.result.status, "executed");
  assert.equal(played.linked.played, 1);
  assert.deepEqual(played.events.map(event => event.action), ["play"]);
  assert.equal(kernel.getObject("card").zone, "board");
  assert.equal(kernel.object(banishedRef), null);
  assert.deepEqual(zoneIds(kernel, "A", "deck"), ["rest"]);
});

test("effect.banish linked non-target selections consume current refs captured by earlier effects", () => {
  const kernel = world().hand("chosen").hand("other").build();
  const run = runInstruction(banish, { objects: literal({ linked: "inspected-pick" }) }, {
    world: kernel, linked: { "inspected-pick": [kernel.ref("chosen")] }
  });
  assert.equal(run.result.status, "executed");
  assert.deepEqual(run.linked.banished.objects, [kernel.ref("chosen")]);
  assert.equal(kernel.getObject("other").zone, "hand");
});

test("ogn-122-298 Time Warp: Banish this removes its source directly from the Chain", () => {
  // "Take a turn after this one. Banish this." 此处只验收放逐子句。
  const kernel = withSource(world().card("time-warp", { cardId: "ogn-122-298", types: ["spell"], zone: "chain" }).build(), "time-warp");
  const originalSource = kernel.source.ref;
  const run = runInstruction(banish, {}, { world: kernel });
  assert.equal(run.result.status, "executed");
  assert.deepEqual(zoneIds(kernel, "A", "chain"), []);
  assert.deepEqual(zoneIds(kernel, "A", "banishment"), ["time-warp"]);
  assert.deepEqual(run.linked.banished.source, originalSource);
  assert.deepEqual(run.linked.banished.objects, [kernel.ref("time-warp")]);
  assert.deepEqual(run.events.map(event => event.action), ["banish"]);
});

test("ven-106-166 Wind and Ghosts: its interpreter condition banishes a battlefield Unit with Might 3 or less", () => {
  // "Choose a unit at a battlefield. If it has 3 Might or less, banish it."
  for (const might of [3, 4]) {
    const kernel = world().unit("victim", { owner: "B", might, location: battlefield }).build();
    kernel.setTargets("unit", [kernel.ref("victim")]);
    const result = runAbilityBody([{
      id: "wind-banish", op: "effect.banish", args: { objects: target("unit") },
      targets: [{ id: "unit", filter: { type: "unit", zone: "board", location: battlefield } }],
      condition: { kind: "compare", operator: "lte", left: { kind: "object-property", object: { target: "unit" }, property: "might" }, right: literal(3) }
    }], kernel);
    assert.equal(kernel.getObject("victim").zone, might === 3 ? "banishment" : "board");
    assert.equal(result.results[0].result.status, might === 3 ? "executed" : "negated");
    assert.deepEqual(result.events.map(event => event.action), might === 3 ? ["banish"] : []);
  }
});

test("effect.banish interpreter links isolate separate instructions instead of merging by card name", () => {
  const kernel = world().unit("one", { name: "Same Name" }).unit("two", { name: "Same Name" }).build();
  kernel.setTargets("one", [kernel.ref("one")]);
  kernel.setTargets("two", [kernel.ref("two")]);
  const run = runAbilityBody([
    { id: "first", op: "effect.banish", args: { objects: target("one") } },
    { id: "second", op: "effect.banish", args: { objects: target("two") } }
  ], kernel);
  assert.equal(run.results.length, 2);
  assert.deepEqual(run.linkedValues["first.banished"].objects, [kernel.ref("one")]);
  assert.deepEqual(run.linkedValues["second.banished"].objects, [kernel.ref("two")]);
});

test("effect.banish rejects malformed Expr args, selectors, link keys, and unsafe counts before mutation", () => {
  for (const invalid of [null, [], { amount: () => 1 }, { objects: "unknown" }, { extra: literal(1) }, { amount: { kind: "unknown" } },
    { amount: { kind: "arithmetic", operator: "neg", operands: [] } }, { objects: { kind: "linked" } }]) {
    assert.throws(() => banish.argsSchema.parse(invalid), TypeError);
  }
  for (const invalid of [
    ...[-1, 0.5, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1, "1", null].map(amount => ({ ...args, amount: literal(amount) })),
    ...["", 3, null].map(linkKey => ({ ...args, linkKey: literal(linkKey) })),
    ...[{ target: "" }, { target: "victims", pick: "cards" }, { id: "victim", zoneEntryId: 1 },
      { zone: "unknown" }, { zone: "deck", from: "middle" }, { choose: "units", filter: {}, visibility: [3] }]
      .map(objects => ({ objects: literal(objects) }))
  ]) {
    const kernel = world().unit("victim").build();
    const before = kernel.stateForTest();
    assert.throws(() => runInstruction(banish, invalid, { world: kernel, targets: locked(kernel) }), TypeError);
    assert.deepEqual(kernel.stateForTest(), before);
  }
});

test("effect.banish canonical EffectIR requires Expr args while interpreter values normalize internally", () => {
  const program = args => ({
    rulesetVersion: "core-1.5", canonicalCardId: "banish-test", status: "executable", sourceText: "Banish this.",
    abilities: [{ kind: "play", body: [{ id: "banish", op: "effect.banish", args }] }]
  });
  for (const invalid of [{ amount: 1 }, { objects: "self" }]) {
    const result = validateCardProgram(program(invalid));
    assert.equal(result.ok, false);
    assert.ok(result.issues.some(issue => issue.path.endsWith(".args." + Object.keys(invalid)[0])));
  }
  assert.equal(validateCardProgram(program({ objects: literal("self"), amount: literal(1) })).ok, true);
  assert.deepEqual(banish.argsSchema.parse({ objects: { target: "victims" }, amount: 1, linkKey: "removed" }), {
    objects: target("victims"), amount: literal(1), linkKey: literal("removed")
  });
});
