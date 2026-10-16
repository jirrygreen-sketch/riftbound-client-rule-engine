import assert from "node:assert/strict";
import test from "node:test";
import { runAbilityBody } from "../../../dist/effects/interpreter.js";
import { AwaitChoice, world } from "../../../dist/effects/testing/index.js";
import {
  constant, gain, instruction, linked, optional, registry, repeat, resultFor, sequence, transaction
} from "./helpers.mjs";

const modes = (id, extra = {}) => instruction(id, "choice.mode", {
  modes: constant([{ id: "small", body: [gain("small-gain", 2)] }, { id: "large", body: [gain("large-gain", 5)] }]),
  ...extra
});

test("may without an answer suspends with a stable optional request", () => {
  const kernel = world().build();
  const run = transaction([optional("may", [gain("inside")])], kernel);
  assert.ok(run.asked instanceof AwaitChoice);
  assert.deepEqual(run.asked.request, { id: "may/optional", type: "optional", chooser: "A", visibility: "public" });
  assert.equal(kernel.events.length, 0);
});

test("may acceptance executes its body and links acceptance", () => {
  const kernel = world().build();
  const run = transaction([optional("may", [gain("inside", 3)])], kernel, { "may/optional": true });
  assert.equal(run.asked, null);
  assert.equal(kernel.player("A").energy, 3);
  assert.equal(run.outcome.linkedValues["may.value"], true);
});

test("may refusal skips its body and allows a following linked instruction", () => {
  const kernel = world().build();
  const run = transaction([optional("may", [gain("inside", 3)]), gain("after", 2, { linkedTo: "may" })], kernel, { "may/optional": false });
  assert.equal(resultFor(run.outcome, "may").status, "negated");
  assert.equal(kernel.player("A").energy, 2);
  assert.equal(run.outcome.status, "partial");
});

test("conditional may that is skipped does not request a decision", () => {
  const body = [{ ...optional("may", [gain("inside")]), condition: { kind: "never" } }];
  const run = transaction(body, world().build());
  assert.equal(run.asked, null);
  assert.equal(resultFor(run.outcome, "may").reason, "skipped");
});

test("choice metadata preserves chooser, visibility and prompt", () => {
  const run = transaction([optional("may", [gain("inside")], {
    chooser: constant("B"), visibility: constant("chooser-only"), prompt: constant("Accept?")
  })], world().build());
  assert.equal(run.asked.request.chooser, "B");
  assert.equal(run.asked.request.visibility, "chooser-only");
  assert.equal(run.asked.request.prompt, "Accept?");
});

test("choice visibility can name an audience", () => {
  const run = transaction([optional("may", [gain("inside")], { visibility: constant(["A"]) })], world().build());
  assert.deepEqual(run.asked.request.visibility, ["A"]);
});

test("invalid optional answers and visibility fail closed", () => {
  assert.throws(() => transaction([optional("may", [gain("inside")])], world().build(), { "may/optional": "yes" }), /must be boolean/);
  assert.throws(() => transaction([optional("may", [gain("inside")], { visibility: constant("secret") })], world().build()), /visibility/);
});

test("whole body suspension rolls back earlier instructions and linked writes", () => {
  const kernel = world().build();
  const body = [instruction("bind", "test.link", { amount: constant(3) }), optional("may", [gain("inside", 2)])];
  const waiting = transaction(body, kernel);
  assert.ok(waiting.asked);
  assert.equal(kernel.player("A").energy, 0);
  assert.equal(kernel.linked("bind.X"), undefined);
  const answered = transaction(body, kernel, { [waiting.asked.request.id]: true });
  assert.equal(kernel.player("A").energy, 5);
  assert.equal(kernel.events.length, 2);
  assert.equal(answered.outcome.events.length, 2);
  assert.equal(kernel.linked("bind.X"), 3);
});

test("successive suspensions recompute each completed action once at commit", () => {
  const kernel = world().build();
  const body = [gain("before", 1), optional("first", [gain("first-action", 2)]), optional("second", [gain("second-action", 4)])];
  const first = transaction(body, kernel);
  const second = transaction(body, kernel, { [first.asked.request.id]: true });
  assert.equal(second.asked.request.id, "second/optional");
  assert.equal(kernel.player("A").energy, 0);
  const complete = transaction(body, kernel, { "first/optional": true, "second/optional": true });
  assert.equal(complete.asked, null);
  assert.equal(kernel.player("A").energy, 7);
  assert.equal(kernel.events.length, 3);
});

test("rollback covers continuous effects and delayed triggers from preceding instructions", () => {
  const kernel = world().build();
  const body = [instruction("register", "test.register"), optional("may", [gain("inside")])];
  assert.ok(transaction(body, kernel).asked);
  assert.equal(kernel.continuousEffects.length, 0);
  assert.equal(kernel.delayedTriggers.length, 0);
  transaction(body, kernel, { "may/optional": true });
  assert.equal(kernel.continuousEffects.length, 1);
  assert.equal(kernel.delayedTriggers.length, 1);
});

test("choose one executes just the selected mode", () => {
  const kernel = world().build();
  const outcome = transaction([modes("mode")], kernel, { "mode/mode%3A0": "large" }).outcome;
  assert.equal(kernel.player("A").energy, 5);
  assert.deepEqual(outcome.linkedValues["mode.value"], ["large"]);
  assert.equal(outcome.results.some(entry => entry.id === "small-gain"), false);
});

test("choose two different modes removes the first choice from the next request", () => {
  const body = [modes("mode", { count: constant(2), different: constant(true) })];
  const kernel = world().build();
  const waiting = transaction(body, kernel, { "mode/mode%3A0": "large" });
  assert.deepEqual(waiting.asked.request.options, ["small"]);
  assert.equal(kernel.player("A").energy, 0);
  const done = transaction(body, kernel, { "mode/mode%3A0": "large", "mode/mode%3A1": "small" });
  assert.equal(kernel.player("A").energy, 7);
  assert.deepEqual(done.outcome.results.filter(entry => entry.op === "test.gain").map(entry => entry.result.linkedValues.value), [2, 5]);
  assert.deepEqual(done.outcome.events, kernel.events);
});

test("a descriptor explicitly permitting repeated modes executes both copies", () => {
  const kernel = world().build();
  transaction([modes("mode", { count: constant(2), different: constant(false) })], kernel, {
    "mode/mode%3A0": "small", "mode/mode%3A1": "small"
  });
  assert.equal(kernel.player("A").energy, 4);
  assert.equal(kernel.events.length, 2);
});

test("invalid or duplicate distinct mode answers are rejected", () => {
  assert.throws(() => transaction([modes("mode")], world().build(), { "mode/mode%3A0": "unknown" }), /Invalid mode/);
  assert.throws(() => transaction([modes("mode", { count: constant(2) })], world().build(), {
    "mode/mode%3A0": "small", "mode/mode%3A1": "small"
  }), /Invalid mode/);
});

test("impossible mode count fails before executing any mode", () => {
  const kernel = world().build();
  assert.throws(() => transaction([modes("mode", { count: constant(3) })], kernel), /Not enough modes/);
  assert.equal(kernel.events.length, 0);
});

test("choice.order returns a chosen permutation for an ordinary action primitive", () => {
  const kernel = world().deck("first").deck("second").deck("third").build();
  const refs = kernel.zone("A", "deck");
  const order = [refs[2], refs[0], refs[1]];
  const body = [instruction("order", "choice.order", { objects: constant(refs) }), instruction("apply", "test.order", { objects: linked("order") })];
  const run = transaction(body, kernel, { "order/order": order });
  assert.deepEqual(kernel.zone("A", "deck"), order);
  assert.deepEqual(run.outcome.linkedValues["order.value"], order);
});

test("choice.order suspends through ctx.choose", () => {
  const kernel = world().deck("card").build();
  const run = transaction([instruction("order", "choice.order", { objects: constant(kernel.zone("A", "deck")) })], kernel);
  assert.equal(run.asked.request.type, "order");
  assert.deepEqual(run.asked.request.options, kernel.zone("A", "deck"));
});

for (const kind of ["duplicate", "missing", "stale"]) {
  test(`choice.order rejects a ${kind} object answer`, () => {
    const kernel = world().deck("first").deck("second").build();
    const refs = kernel.zone("A", "deck");
    const answer = kind === "duplicate" ? [refs[0], refs[0]] : kind === "missing" ? [refs[0]] : [refs[0], { ...refs[1], zoneEntryId: 99 }];
    assert.throws(() => transaction([instruction("order", "choice.order", { objects: constant(refs) })], kernel, { "order/order": answer }), /permutation/);
  });
}

test("primitive choices are scoped by instruction even when request ids are identical", () => {
  const body = [instruction("first", "test.choose-gain"), instruction("second", "test.choose-gain")];
  const kernel = world().build();
  const waiting = transaction(body, kernel, { "first/amount": 1 });
  assert.equal(waiting.asked.request.id, "second/amount");
  transaction(body, kernel, { "first/amount": 1, "second/amount": 3 });
  assert.equal(kernel.player("A").energy, 4);
});

test("repeat permits different targets on each execution and rolls back the first while waiting", () => {
  const kernel = world().unit("first").unit("second").build();
  const body = [repeat("repeat", 2, [instruction("damage", "test.damage", { amount: constant(2) }, {
    targets: [{ id: "unit", filter: { type: "unit", zone: "board" }, selection: "one" }]
  })])];
  const first = transaction(body, kernel);
  assert.equal(first.asked.request.id, "repeat/0/damage/target%3Aunit");
  const answers = { [first.asked.request.id]: [kernel.ref("first")] };
  const second = transaction(body, kernel, answers);
  assert.equal(second.asked.request.id, "repeat/1/damage/target%3Aunit");
  assert.equal(kernel.getObject("first").damage, 0);
  answers[second.asked.request.id] = [kernel.ref("second")];
  const done = transaction(body, kernel, answers);
  assert.equal(done.asked, null);
  assert.equal(kernel.getObject("first").damage, 2);
  assert.equal(kernel.getObject("second").damage, 2);
  assert.equal(kernel.events.length, 2);
});

test("repeat may choose the same legal target on both executions", () => {
  const kernel = world().unit("unit").build();
  const body = [repeat("repeat", 2, [instruction("damage", "test.damage", { amount: constant(2) }, {
    targets: [{ id: "unit", filter: { zone: "board" } }]
  })])];
  const ref = kernel.ref("unit");
  transaction(body, kernel, { "repeat/0/damage/target%3Aunit": [ref], "repeat/1/damage/target%3Aunit": [ref] });
  assert.equal(kernel.getObject("unit").damage, 4);
});

test("repeat target requests use currently legal objects after earlier actions", () => {
  const kernel = world().unit("first").unit("second").build();
  const body = [repeat("repeat", 2, [instruction("kill", "test.kill", {}, { targets: [{ id: "unit", filter: { zone: "board" } }] })])];
  const waiting = transaction(body, kernel, { "repeat/0/kill/target%3Aunit": [kernel.ref("first")] });
  assert.deepEqual(waiting.asked.request.options, [kernel.ref("second")]);
  assert.equal(kernel.getObject("first").zone, "board");
});

test("repeat reselect propagates through a nested sequence", () => {
  const kernel = world().unit("unit").build();
  const body = [repeat("repeat", 1, [sequence("group", [instruction("damage", "test.damage", { amount: constant(2) }, {
    targets: [{ id: "unit", filter: { zone: "board" } }]
  })])])];
  const waiting = transaction(body, kernel);
  assert.equal(waiting.asked.request.id, "repeat/0/group/damage/target%3Aunit");
});

test("repeat revalidates stale finalized target answers and rejects duplicates", () => {
  const kernel = world().unit("unit").build();
  const body = [repeat("repeat", 1, [instruction("damage", "test.damage", { amount: constant(2) }, {
    targets: [{ id: "unit", filter: { zone: "board" }, min: 1, max: 2 }]
  })])];
  const ref = kernel.ref("unit");
  const stale = transaction(body, kernel, { "repeat/0/damage/target%3Aunit": [{ ...ref, zoneEntryId: 99 }] });
  assert.equal(resultFor(stale.outcome, "damage").status, "ignored");
  assert.equal(kernel.getObject("unit").damage, 0);
  assert.throws(() => transaction(body, kernel, { "repeat/0/damage/target%3Aunit": [ref, ref] }), /Invalid target/);
});

test("a target killed on the first repeat is ignored on the second even when another legal unit remains", () => {
  const kernel = world().unit("first").unit("second").build();
  const first = kernel.ref("first");
  const body = [repeat("repeat", 2, [instruction("kill", "test.kill", {}, {
    targets: [{ id: "unit", filter: { zone: "board" } }]
  })])];
  const run = transaction(body, kernel, { "repeat/0/kill/target%3Aunit": [first], "repeat/1/kill/target%3Aunit": [first] });
  assert.deepEqual(run.outcome.results.filter(entry => entry.id === "kill").map(entry => entry.result.status), ["executed", "ignored"]);
  assert.equal(kernel.getObject("second").zone, "board");
  assert.equal(kernel.events.length, 1);
});

test("repeat retains legal members of a finalized multi-target answer after an earlier loss", () => {
  const kernel = world().unit("first").unit("second").build();
  const first = kernel.ref("first");
  const second = kernel.ref("second");
  const body = [instruction("kill", "test.kill", { object: constant(first) }), repeat("repeat", 1, [instruction("damage", "test.damage", { amount: constant(2) }, {
    targets: [{ id: "unit", filter: { zone: "board" }, min: 2, max: 2 }]
  })])];
  const run = transaction(body, kernel, { "repeat/0/damage/target%3Aunit": [first, second] });
  assert.equal(resultFor(run.outcome, "damage").status, "executed");
  assert.equal(kernel.getObject("second").damage, 2);
  assert.equal(run.outcome.status, "partial");
});

test("AwaitChoice is propagated to the transaction owner", () => {
  assert.throws(() => runAbilityBody([optional("may", [gain("inside")])], world().build(), registry), AwaitChoice);
});
