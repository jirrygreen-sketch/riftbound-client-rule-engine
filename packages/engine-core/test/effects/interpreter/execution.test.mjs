import assert from "node:assert/strict";
import test from "node:test";
import { runAbilityBody } from "../../../dist/effects/interpreter.js";
import { world } from "../../../dist/effects/testing/index.js";
import {
  constant, gain, instruction, linked, property, registry, repeat, resultFor, sequence, transaction, value
} from "./helpers.mjs";

const target = { id: "unit", filter: { type: "unit", zone: "board" } };
const damage = (id, extra = {}) => instruction(id, "test.damage", { amount: constant(2) }, { targets: [target], ...extra });

test("empty body runs with the empty generated registry", () => {
  assert.deepEqual(runAbilityBody([], world().build()), { status: "executed", results: [], events: [], linkedValues: {} });
});

test("registered primitives run in source order and collect each event once", () => {
  const kernel = world().build();
  const outcome = runAbilityBody([gain("first", 2), gain("second", 3)], kernel, registry);
  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.results.map(entry => entry.id), ["first", "second"]);
  assert.deepEqual(outcome.events, kernel.events);
  assert.equal(kernel.player("A").energy, 5);
});

test("unknown primitives fail without an invented effect", () => {
  const kernel = world().build();
  assert.throws(() => runAbilityBody([instruction("unknown", "effect.unsupported")], kernel), /Unregistered/);
  assert.equal(kernel.events.length, 0);
});

test("registry opcode and definition must agree", () => {
  const mismatched = new Map([["test.gain", registry.get("test.draw")]]);
  assert.throws(() => runAbilityBody([gain("gain")], world().build(), mismatched), /Unregistered/);
});

test("schema validation runs on evaluated arguments before effects", () => {
  const kernel = world().build();
  assert.throws(() => runAbilityBody([instruction("invalid", "test.gain", { amount: constant(null) })], kernel, registry), /Invalid amount/);
  assert.equal(kernel.events.length, 0);
});

test("mistargeted instruction ignores a later linked instruction", () => {
  const kernel = world().unit("unit").build();
  kernel.setPicks("unit", [kernel.ref("unit")]);
  const old = kernel.ref("unit");
  kernel.setTargets("unit", [old]);
  kernel.perform({ type: "return-to-hand", object: old });
  const outcome = runAbilityBody([damage("first"), gain("second", 1, { linkedTo: "first" })], kernel, registry);
  assert.equal(resultFor(outcome, "first").status, "ignored");
  assert.deepEqual(resultFor(outcome, "second"), { status: "ignored", reason: "linked-ignored" });
  assert.equal(kernel.player("A").energy, 0);
  assert.equal(outcome.status, "partial");
});

test("ignored propagation is transitive but does not block unrelated instructions", () => {
  const kernel = world().build();
  const outcome = runAbilityBody([
    damage("first"), gain("second", 1, { linkedTo: "first" }),
    gain("third", 1, { linkedTo: "second" }), gain("independent", 4)
  ], kernel, registry);
  assert.equal(resultFor(outcome, "third").reason, "linked-ignored");
  assert.equal(kernel.player("A").energy, 4);
});

for (const status of ["replaced", "prevented", "impossible"]) {
  test(`${status} actions do not propagate ignored to linked instructions`, () => {
    const kernel = world().build();
    kernel.addReplacement(action => action.type === "draw" ? status : null);
    const outcome = runAbilityBody([
      instruction("draw", "test.draw", { amount: constant(1) }), gain("gain", 3, { linkedTo: "draw" })
    ], kernel, registry);
    assert.equal(resultFor(outcome, "draw").status, "negated");
    assert.equal(resultFor(outcome, "gain").status, "executed");
    assert.equal(kernel.player("A").energy, 3);
  });
}

test("false condition affects one instruction only", () => {
  const kernel = world().build();
  const outcome = runAbilityBody([gain("first", 2, { condition: { kind: "never" } }), gain("second", 3)], kernel, registry);
  assert.equal(resultFor(outcome, "first").reason, "skipped");
  assert.equal(kernel.player("A").energy, 3);
});

test("a condition skipped predecessor permits a linked successor", () => {
  const kernel = world().build();
  runAbilityBody([gain("first", 2, { condition: { kind: "never" } }), gain("second", 3, { linkedTo: "first" })], kernel, registry);
  assert.equal(kernel.player("A").energy, 3);
});

test("sequence condition gates the whole nested group", () => {
  const kernel = world().build();
  const outcome = runAbilityBody([
    sequence("group", [gain("first", 2), gain("second", 3)], { condition: { kind: "never" } }), gain("after")
  ], kernel, registry);
  assert.equal(kernel.player("A").energy, 1);
  assert.deepEqual(outcome.results.map(entry => entry.id), ["group", "after"]);
});

test("inner condition does not leak to other instructions in a sequence", () => {
  const kernel = world().build();
  const outcome = runAbilityBody([sequence("group", [gain("first", 2, { condition: { kind: "never" } }), gain("second", 3)])], kernel, registry);
  assert.equal(kernel.player("A").energy, 3);
  assert.equal(outcome.events.length, 1);
  assert.equal(resultFor(outcome, "group").status, "executed");
  assert.equal(outcome.status, "partial");
});

test("sequence evaluates its condition once before its children", () => {
  const condition = { kind: "compare", left: { kind: "count", subject: "objects", filter: { zone: "deck" } }, operator: "eq", right: constant(1) };
  const deck = world().deck("top").build();
  const outcome = runAbilityBody([sequence("group", [instruction("draw", "test.draw", { amount: constant(1) }), gain("gain", 3)], { condition })], deck, registry);
  assert.equal(deck.player("A").energy, 3);
  assert.equal(outcome.events.length, 2);
});

test("links from a sequence child are visible after the group", () => {
  const kernel = world().build();
  runAbilityBody([sequence("group", [gain("inside", 2)]), instruction("after", "test.gain", { amount: linked("inside") })], kernel, registry);
  assert.equal(kernel.player("A").energy, 4);
});

test("an entirely ignored sequence propagates to its linked successor", () => {
  const kernel = world().build();
  const outcome = runAbilityBody([sequence("group", [damage("damage")]), gain("after", 2, { linkedTo: "group" })], kernel, registry);
  assert.equal(resultFor(outcome, "after").reason, "linked-ignored");
});

test("partial target loss still executes against remaining targets", () => {
  const kernel = world().unit("first").unit("second").build();
  kernel.setTargets("unit", [kernel.ref("first"), kernel.ref("second")]);
  kernel.perform({ type: "kill", object: kernel.ref("second") });
  const outcome = runAbilityBody([damage("damage", { targets: [{ ...target, min: 2, max: 2 }] })], kernel, registry);
  assert.equal(resultFor(outcome, "damage").status, "executed");
  assert.equal(kernel.getObject("first").damage, 2);
  assert.equal(outcome.status, "partial");
});

test("an individually ignored target stays ignored in later linked instructions", () => {
  const kernel = world().unit("first").unit("second").build();
  kernel.setTargets("unit", [kernel.ref("first"), kernel.ref("second")]);
  kernel.perform({ type: "take-control", object: kernel.ref("second"), player: "B" });
  const outcome = runAbilityBody([
    damage("first", { targets: [{ ...target, filter: { ...target.filter, controller: "A" } }] }),
    damage("linked", { linkedTo: "first" }), damage("transitive", { linkedTo: "linked" })
  ], kernel, registry);
  assert.equal(kernel.getObject("first").damage, 6);
  assert.equal(kernel.getObject("second").damage, 0);
  assert.equal(resultFor(outcome, "linked").status, "executed");
});

test("partial target suppression crosses a sequence boundary in either direction", () => {
  const kernel = world().unit("first").unit("second").build();
  kernel.setTargets("unit", [kernel.ref("first"), kernel.ref("second")]);
  kernel.perform({ type: "take-control", object: kernel.ref("second"), player: "B" });
  const outcome = runAbilityBody([
    sequence("group", [damage("first", { targets: [{ ...target, filter: { ...target.filter, controller: "A" } }] })]),
    sequence("linked-group", [damage("linked")], { linkedTo: "group" })
  ], kernel, registry);
  assert.equal(kernel.getObject("first").damage, 4);
  assert.equal(kernel.getObject("second").damage, 0);
  assert.equal(outcome.status, "partial");
});

test("an ignored target does not affect an unrelated sibling in a sequence", () => {
  const kernel = world().unit("first").unit("second").build();
  kernel.setTargets("unit", [kernel.ref("first"), kernel.ref("second")]);
  kernel.perform({ type: "take-control", object: kernel.ref("second"), player: "B" });
  runAbilityBody([sequence("group", [
    damage("first", { targets: [{ ...target, filter: { ...target.filter, controller: "A" } }] }), damage("independent")
  ])], kernel, registry);
  assert.equal(kernel.getObject("first").damage, 4);
  assert.equal(kernel.getObject("second").damage, 2);
});

test("linked characteristic reads of an individually ignored target remain unavailable", () => {
  const kernel = world().unit("first").unit("second").build();
  const ref = kernel.ref("second");
  kernel.setPicks("unit", [ref]);
  kernel.setTargets("unit", [kernel.ref("first"), ref]);
  kernel.perform({ type: "take-control", object: ref, player: "B" });
  const outcome = runAbilityBody([
    damage("first", { targets: [{ ...target, filter: { ...target.filter, controller: "A" } }] }),
    instruction("read", "condition.value", { value: property({ pick: "unit" }, "might") }, { linkedTo: "first" })
  ], kernel, registry);
  assert.equal(resultFor(outcome, "read").status, "ignored");
});

test("targets that no longer match their filter are ignored", () => {
  const kernel = world().unit("unit").build();
  kernel.setPicks("unit", [kernel.ref("unit")]);
  kernel.setTargets("unit", [kernel.ref("unit")]);
  kernel.perform({ type: "take-control", object: kernel.ref("unit"), player: "B" });
  const outcome = runAbilityBody([damage("damage", { targets: [{ ...target, filter: { ...target.filter, controller: "A" } }] })], kernel, registry);
  assert.equal(resultFor(outcome, "damage").status, "ignored");
  assert.equal(kernel.getObject("unit").damage, 0);
});

test("a zero target up-to instruction is legal", () => {
  const outcome = runAbilityBody([damage("damage", { targets: [{ ...target, selection: "up-to", min: 0 }] })], world().build(), registry);
  assert.equal(outcome.status, "executed");
});

test("effect result values and explicit ctx.link writes are captured", () => {
  const kernel = world().build();
  const outcome = runAbilityBody([instruction("bind", "test.link", { amount: constant(4) }), value("read", linked("bind", "X"))], kernel, registry);
  assert.equal(outcome.linkedValues["bind.X"], 4);
  assert.equal(outcome.linkedValues["read.value"], 4);
  assert.equal(kernel.linked("bind.X"), 4);
});

test("an executed draw exposes its actual partial action count", () => {
  const kernel = world().deck("top").build();
  const outcome = runAbilityBody([instruction("draw", "test.draw", { amount: constant(3) }), instruction("gain", "test.gain", { amount: linked("draw") })], kernel, registry);
  assert.equal(outcome.linkedValues["draw.value"], 1);
  assert.equal(kernel.player("A").energy, 1);
});

test("missing result information is ignored without fabricating zero", () => {
  const kernel = world().build();
  const outcome = runAbilityBody([value("unknown", linked("missing")), gain("after", 2, { linkedTo: "unknown" })], kernel, registry);
  assert.equal(resultFor(outcome, "unknown").status, "ignored");
  assert.equal(resultFor(outcome, "after").reason, "linked-ignored");
  assert.equal(kernel.events.length, 0);
});

test("forward dependency and duplicate instruction ids fail closed", () => {
  assert.throws(() => runAbilityBody([gain("first", 1, { linkedTo: "later" }), gain("later")], world().build(), registry), /forward/);
  assert.throws(() => runAbilityBody([gain("same"), gain("same")], world().build(), registry), /Duplicate/);
});

test("repeat executes each body with fresh instruction and choice scopes", () => {
  const kernel = world().build();
  const outcome = runAbilityBody([repeat("repeat", 3, [gain("inside", 2), instruction("linked", "test.gain", { amount: linked("inside") })])], kernel, registry);
  assert.equal(kernel.player("A").energy, 12);
  assert.equal(outcome.events.length, 6);
  assert.equal(outcome.linkedValues["repeat/2/inside.value"], 2);
  assert.equal(outcome.results.filter(entry => entry.id === "inside").length, 3);
});

test("repeat with zero executions has no game actions", () => {
  const kernel = world().build();
  const outcome = runAbilityBody([repeat("repeat", 0, [gain("inside")])], kernel, registry);
  assert.equal(outcome.status, "executed");
  assert.equal(kernel.events.length, 0);
});

test("repeat count may come from a registered effect.repeat declaration", () => {
  const kernel = world().build();
  const declaration = { op: "effect.repeat", argsSchema: { parse: value => value }, execute: (_context, args) => ({ status: "executed", events: [], linkedValues: { count: args.count } }) };
  const custom = new Map([...registry, [declaration.op, declaration]]);
  runAbilityBody([
    instruction("declare", "effect.repeat", { count: constant(2) }),
    instruction("loop", "repeat", { count: linked("declare", "count"), body: constant([gain("inside", 3)]) })
  ], kernel, custom);
  assert.equal(kernel.player("A").energy, 6);
});

for (const count of [-1, 1.5, "2", null]) {
  test(`invalid repeat count ${JSON.stringify(count)} is rejected before actions`, () => {
    const kernel = world().build();
    assert.throws(() => runAbilityBody([repeat("loop", count, [gain("inside")])], kernel, registry), /Repeat count/);
    assert.equal(kernel.events.length, 0);
  });
}

test("instruction transactions preserve errors other than AwaitChoice", () => {
  assert.throws(() => transaction([instruction("unknown", "unknown")], world().build()), /Unregistered/);
});

test("look-back reads a unit killed by an earlier instruction", () => {
  const kernel = world().unit("unit", { might: 5 }).build();
  kernel.setPicks("unit", [kernel.ref("unit")]);
  const ref = kernel.ref("unit");
  const outcome = runAbilityBody([instruction("kill", "test.kill", { object: constant(ref) }), value("might", property({ pick: "unit" }, "might"))], kernel, registry);
  assert.equal(kernel.object(ref), null);
  assert.equal(outcome.linkedValues["might.value"], 5);
});
