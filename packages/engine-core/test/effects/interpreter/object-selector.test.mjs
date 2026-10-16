import assert from "node:assert/strict";
import test from "node:test";
import { validateCardProgram } from "@riftbound/card-dsl";
import { runAbilityBody } from "../../../dist/effects/interpreter.js";
import { world } from "../../../dist/effects/testing/index.js";
import { constant, compare, instruction, property, registry, repeat, resultFor, transaction } from "./helpers.mjs";

const readValue = (id, expression, extra = {}) => instruction(id, "condition.value", { value: expression }, extra);
const read = (selector, characteristic = "might", extra = {}) => readValue("read", property(selector, characteristic), extra);
const target = { id: "unit", filter: { zone: "board", type: "unit" }, selection: "any" };
const pick = { id: "chosen", options: ["dynamic:units"] };
const run = (body, context, options = {}) => runAbilityBody(body, context, registry, options);
const validate = body => {
  const result = validateCardProgram({ canonicalCardId: "test.selector", rulesetVersion: "core-1.5", status: "executable", sourceText: "synthetic", abilities: [{ kind: "play", body }] });
  assert.equal(result.ok, true, JSON.stringify(result));
};

test("self reads the live host while source reads the distinct ability source", () => {
  const initial = world().unit("host", { might: 4 }).unit("source", { might: 8 }).build();
  const context = initial.clone({ sourceSnapshot: initial.getObject("source") });
  const body = [read("self"), readValue("source", property("source", "might"))];
  validate(body);
  const outcome = run(body, context, { host: context.ref("host") });
  assert.equal(outcome.linkedValues["read.value"], 4);
  assert.equal(outcome.linkedValues["source.value"], 8);
});

test("self defaults to the source identity when no separate host is supplied", () => {
  const initial = world().unit("host", { might: 6 }).build();
  const context = initial.clone({ sourceSnapshot: initial.getObject("host") });
  assert.equal(run([read("self")], context).linkedValues["read.value"], 6);
});

test("departed source uses its supplied last-known snapshot, preserving null printed values", () => {
  const initial = world().unit("source", { might: 7, energy: null, power: null }).build();
  const snapshot = initial.getObject("source");
  initial.perform({ type: "kill", object: snapshot.ref });
  const context = initial.clone({ sourceSnapshot: snapshot });
  const body = [read("source"), readValue("energy", property("source", "energy")), readValue("power", property("source", "power"))];
  validate(body);
  const outcome = run(body, context);
  assert.equal(context.object(snapshot.ref), null);
  assert.notDeepEqual(context.ref("source"), snapshot.ref);
  assert.equal(outcome.linkedValues["read.value"], 7);
  assert.equal(outcome.linkedValues["energy.value"], null);
  assert.equal(outcome.linkedValues["power.value"], null);
});

test("source uses live characteristics until it leaves its zone", () => {
  const initial = world().unit("source", { damage: 0 }).build();
  const context = initial.clone({ sourceSnapshot: initial.getObject("source") });
  context.perform({ type: "damage", source: context.source.ref, target: context.source.ref, amount: 2, combat: false });
  assert.equal(run([read("source", "damage")], context).linkedValues["read.value"], 2);
});

test("a mistargeted source still supplies source last-known information", () => {
  const initial = world().unit("source", { might: 7 }).build();
  const context = initial.clone({ sourceSnapshot: initial.getObject("source") });
  context.setTargets("unit", [context.source.ref]);
  context.perform({ type: "kill", object: context.source.ref });
  const body = [read("source", "might", { targets: [target] })];
  validate(body);
  const outcome = run(body, context);
  assert.equal(outcome.linkedValues["read.value"], 7);
  assert.equal(outcome.status, "partial");
});

test("a stale self identity cannot silently bind to the host's new zone entry", () => {
  const initial = world().unit("host", { might: 6 }).build();
  const ref = initial.ref("host");
  const context = initial.clone({ sourceSnapshot: initial.getObject("host") });
  context.perform({ type: "return-to-hand", object: ref });
  assert.equal(resultFor(run([read("self")], context, { host: ref }), "read").status, "ignored");
  assert.equal(run([read("self")], context, { host: context.ref("host") }).linkedValues["read.value"], 6);
});

test("target properties use the first legal finalized object in selection order", () => {
  const context = world().unit("one", { might: 3 }).unit("two", { might: 9 }).build();
  context.setTargets("unit", [context.ref("two"), context.ref("one")]);
  const body = [read({ target: "unit" }, "might", { targets: [target] })];
  validate(body);
  assert.equal(run(body, context).linkedValues["read.value"], 9);
});

test("invalidated targets are discarded and never rebound by id or read through lastKnown", () => {
  const context = world().unit("one", { might: 3 }).unit("two", { might: 9 }).build();
  const old = context.ref("one");
  context.setTargets("unit", [old, context.ref("two")]);
  context.perform({ type: "return-to-hand", object: old });
  const body = [read({ target: "unit" }, "might", { targets: [target] })];
  const partial = run(body, context);
  assert.equal(partial.linkedValues["read.value"], 9);
  assert.equal(partial.status, "partial");
  context.setTargets("unit", [old]);
  const lost = run(body, context);
  assert.equal(resultFor(lost, "read").status, "ignored");
  assert.equal(lost.linkedValues["read.value"], undefined);
});

test("a target failing its declared filter is not read as an expression", () => {
  const context = world().unit("one", { might: 9 }).unit("two", { might: 3 }).build();
  context.setTargets("unit", [context.ref("one"), context.ref("two")]);
  context.perform({ type: "take-control", object: context.ref("one"), player: "B" });
  const spec = { ...target, filter: { ...target.filter, controller: "A" } };
  assert.equal(run([read({ target: "unit" }, "might", { targets: [spec] })], context).linkedValues["read.value"], 3);
});

test("repeat expressions consume independently reselected targets rather than the original locks", () => {
  const context = world().unit("one", { might: 3 }).unit("two", { might: 9 }).build();
  context.setTargets("unit", [context.ref("one")]);
  const body = [repeat("loop", 2, [read({ target: "unit" }, "might", { targets: [{ ...target, selection: "one" }] })])];
  validate(body);
  const result = transaction(body, context, {
    "loop/0/read/target%3Aunit": [context.ref("two")],
    "loop/1/read/target%3Aunit": [context.ref("one")]
  });
  assert.equal(result.asked, null);
  assert.equal(result.outcome.linkedValues["loop/0/read.value"], 9);
  assert.equal(result.outcome.linkedValues["loop/1/read.value"], 3);
});

test("later expressions in a repeat share that iteration's target bindings", () => {
  const context = world().unit("one", { might: 3 }).unit("two", { might: 9 }).build();
  context.setTargets("unit", [context.ref("one")]);
  const body = [repeat("loop", 2, [
    instruction("damage", "test.damage", { amount: constant(1) }, { targets: [{ ...target, selection: "one" }] }),
    read({ target: "unit" })
  ])];
  validate(body);
  const result = transaction(body, context, {
    "loop/0/damage/target%3Aunit": [context.ref("two")],
    "loop/1/damage/target%3Aunit": [context.ref("one")]
  });
  assert.equal(result.asked, null);
  assert.equal(result.outcome.linkedValues["loop/0/read.value"], 9);
  assert.equal(result.outcome.linkedValues["loop/1/read.value"], 3);
});

test("a target-dependent condition sees the validated reselected target", () => {
  const context = world().unit("one", { might: 3 }).unit("two", { might: 9 }).build();
  context.setTargets("unit", [context.ref("one")]);
  const body = [repeat("loop", 1, [read({ target: "unit" }, "might", {
    targets: [{ ...target, selection: "one" }],
    condition: compare(property({ target: "unit" }, "might"), "gte", constant(5))
  })])];
  validate(body);
  const result = transaction(body, context, { "loop/0/read/target%3Aunit": [context.ref("two")] });
  assert.equal(result.asked, null);
  assert.equal(result.outcome.linkedValues["loop/0/read.value"], 9);
});

test("picks read the first object-valued selection without turning it into a target", () => {
  const context = world().unit("one", { might: 3 }).unit("two", { might: 9 }).build();
  context.setPicks("chosen", ["A", context.ref("two"), context.ref("one")]);
  const body = [read({ pick: "chosen" }, "might", { picks: [pick] })];
  validate(body);
  assert.equal(run(body, context).linkedValues["read.value"], 9);
  assert.deepEqual(context.targets("chosen"), []);
});

test("empty, scalar-only, and stale picks ignore characteristic reads", () => {
  const context = world().unit("one", { might: 3 }).build();
  const old = context.ref("one");
  context.perform({ type: "kill", object: old });
  for (const picks of [[], ["A"], [old]]) {
    context.setPicks("chosen", picks);
    assert.equal(resultFor(run([read({ pick: "chosen" }, "might", { picks: [pick] })], context), "read").status, "ignored");
  }
});

test("linked selectors read an actual reference produced by a preceding expression", () => {
  const context = world().unit("one", { might: 3 }).build();
  context.setPicks("chosen", [context.ref("one")]);
  const body = [readValue("before", property({ pick: "chosen" }, "ref"), { picks: [pick] }), read({ linked: "before" })];
  validate(body);
  assert.equal(run(body, context).linkedValues["read.value"], 3);
});

test("linked reference lists from a real look action use the first reference for properties and all for counts", () => {
  const context = world().unit("one", { might: 3 }).unit("two", { might: 9 }).build();
  context.setTargets("unit", [context.ref("two"), context.ref("one")]);
  const look = {
    op: "test.look", argsSchema: { parse: args => args },
    execute(ctx) {
      const result = ctx.perform({ type: "look", objects: ctx.targets("unit"), player: ctx.controller });
      assert.equal(result.status, "done");
      return { status: "executed", events: result.events, linkedValues: { objects: result.result } };
    }
  };
  const body = [instruction("before", look.op, {}, { targets: [target] }), read({ linked: "before" }),
    readValue("count", { kind: "count", subject: "objects", filter: { object: { linked: "before" } } })];
  validate(body);
  const outcome = runAbilityBody(body, context, new Map([...registry, [look.op, look]]));
  assert.deepEqual(outcome.linkedValues["before.objects"], [context.ref("one"), context.ref("two")]);
  assert.equal(outcome.linkedValues["read.value"], 3);
  assert.equal(outcome.linkedValues["count.value"], 2);
  assert.equal(context.events[0].action, "look");
});

test("linked scalar values cannot masquerade as object references", () => {
  assert.equal(resultFor(run([readValue("before", constant(3)), read({ linked: "before" })], world().build()), "read").status, "ignored");
});

test("target and pick anchors use every selection without double-counting matching objects", () => {
  const context = world().unit("one").unit("two").unit("three").build();
  const refs = [context.ref("two"), context.ref("one"), context.ref("two")];
  context.setTargets("unit", refs);
  context.setPicks("chosen", refs);
  const body = [
    readValue("targets", { kind: "count", subject: "objects", filter: { object: { target: "unit" } } }, { targets: [target] }),
    readValue("picks", { kind: "count", subject: "objects", filter: { object: { pick: "chosen" } } }, { picks: [pick] })
  ];
  validate(body);
  const outcome = run(body, context);
  assert.equal(outcome.linkedValues["targets.value"], 2);
  assert.equal(outcome.linkedValues["picks.value"], 2);
});

test("attachment, location, and exclusion anchors resolve symbolic object identities", () => {
  const context = world().unit("host").unit("other").object("gear", { types: ["gear"], zone: "board" }).build();
  context.perform({ type: "attach", object: context.ref("gear"), host: context.ref("host") });
  context.setPicks("chosen", [context.ref("host")]);
  const body = [
    readValue("attached", { kind: "count", subject: "objects", filter: { attachedTo: { pick: "chosen" } } }, { picks: [pick] }),
    readValue("near", { kind: "count", subject: "objects", filter: { type: "unit", sameLocationAs: { pick: "chosen" }, exclude: { pick: "chosen" } } }, { picks: [pick] })
  ];
  validate(body);
  const outcome = run(body, context);
  assert.equal(outcome.linkedValues["attached.value"], 1);
  assert.equal(outcome.linkedValues["near.value"], 1);
});

test("conditions evaluate selectors and preserve null characteristics", () => {
  const context = world().unit("one", { energy: null }).build();
  context.setPicks("chosen", [context.ref("one")]);
  const body = [read({ pick: "chosen" }, "energy", { picks: [pick], condition: compare(property({ pick: "chosen" }, "energy"), "eq", constant(null)) })];
  validate(body);
  assert.equal(run(body, context).linkedValues["read.value"], null);
});

test("runtime ObjectRefs in object expressions are rejected even when bypassing CardProgram validation", () => {
  const context = world().unit("one").build();
  assert.throws(() => run([read(context.ref("one"))], context), /ObjectSelector/);
});
