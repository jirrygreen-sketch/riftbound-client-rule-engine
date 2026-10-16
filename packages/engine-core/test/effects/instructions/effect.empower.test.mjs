import assert from "node:assert/strict";
import test from "node:test";

import empower from "../../../src/effects/instructions/effect.empower.ts";
import { AwaitChoice, runInstruction, world } from "../../../src/effects/testing/index.ts";

const literal = (value) => ({ kind: "constant", value });
const target = (id) => literal({ kind: "target", id });
const pick = (id) => literal({ kind: "pick", id });
const source = literal({ kind: "source" });
const choose = (id, filter, extra = {}) => literal({ kind: "choose", id, filter, ...extra });
const linked = (key) => ({ kind: "linked-value", instructionId: "previous-instruction", key });

const battlefield = { type: "battlefield", id: "battlefield-1" };

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
const empowered = (kernel, id) => kernel.getObject(id).empowered;
const refs = (kernel, ids) => ids.map((id) => kernel.ref(id));

test("effect.empower opcode and default arguments are stable", () => {
  assert.equal(empower.op, "effect.empower");
  assert.equal(typeof empower.argsSchema.parse, "function");
  assert.equal(typeof empower.argsSchema.safeParse, "function");
  assert.equal(empower.argsSchema.safeParse(7).success, false);
});

test("ven-050-166 Grumpy Rockbear: the Empower ability empowers its own source", () => {
  const kernel = withSource(world().unit("rockbear").build(), "rockbear");
  const run = runInstruction(empower, {}, { world: kernel });

  assert.equal(run.result.status, "executed");
  assert.equal(empowered(kernel, "rockbear"), 1);
  assert.deepEqual(run.events.map((event) => event.action), ["empower"]);
  assert.deepEqual(run.linked.empowered, {
    mode: "empower",
    count: 1,
    objects: [kernel.ref("rockbear")]
  });
  assert.equal(run.linked["empowered.count"], 1);
  assert.deepEqual(run.linked["empowered.objects"], [kernel.ref("rockbear")]);
  assert.deepEqual(run.result.linkedValues, run.linked);
});

test("ven-035-166 Sanction: Empower a unit through a finalized target", () => {
  const kernel = world().unit("ally").build();
  const run = runInstruction(empower, { objects: target("unit") }, {
    world: kernel,
    targets: { unit: refs(kernel, ["ally"]) }
  });

  assert.equal(run.result.status, "executed");
  assert.equal(empowered(kernel, "ally"), 1);
  assert.equal(run.linked.empowered.count, 1);
});

test("ven-037-166 Sandstone Chimera: disempower a gear that is already Empowered", () => {
  const kernel = world().object("gear", gear("ven-037-166")).build();
  kernel.perform({ type: "empower", object: kernel.ref("gear") });
  const run = runInstruction(empower, { mode: literal("disempower"), objects: target("gear") }, {
    world: kernel,
    targets: { gear: refs(kernel, ["gear"]) }
  });

  assert.equal(run.result.status, "executed");
  assert.equal(empowered(kernel, "gear"), 0);
  assert.deepEqual(run.linked.disempowered.mode, "disempower");
  assert.deepEqual(run.events.map((event) => event.action), ["disempower"]);
});

test("ven-062-166 Hextech Formula: Empower another gear through a non-target pick", () => {
  const kernel = world()
    .object("formula", gear("ven-062-166"))
    .object("other-gear", gear("other"))
    .build();
  const run = runInstruction(empower, { objects: pick("other-gear-pick") }, {
    world: kernel,
    picks: { "other-gear-pick": refs(kernel, ["other-gear"]) }
  });

  assert.equal(run.result.status, "executed");
  assert.equal(empowered(kernel, "other-gear"), 1);
  assert.equal(empowered(kernel, "formula"), 0);
  assert.deepEqual(run.linked.empowered.objects, [kernel.ref("other-gear")]);
});

test("ven-134-166 Kayle, Radiant Annihilator: a multiple-Empower permission is forwarded with its limit", () => {
  const kernel = withSource(world().unit("kayle").build(), "kayle");
  const args = { multiple: literal(true), limit: literal(3) };
  const first = runInstruction(empower, args, { world: kernel });
  const second = runInstruction(empower, args, { world: kernel });

  assert.equal(first.result.status, "executed");
  assert.equal(second.result.status, "executed");
  // 两次启动都合法：允许被 Empower 三次的许可（CR 442.1.c.1 / 827.1.c.5）由动作层执行。
  assert.equal(empowered(kernel, "kayle"), 2);
  assert.equal(second.linked.empowered.count, 1);
});

test("an amount above one is forwarded to the empower action and links the actual result", () => {
  const kernel = withSource(world().unit("u1").build(), "u1");
  const run = runInstruction(empower, {
    amount: literal(2),
    multiple: literal(true),
    limit: literal(3)
  }, { world: kernel });

  assert.equal(run.result.status, "executed");
  assert.equal(empowered(kernel, "u1"), 2);
  assert.equal(run.linked.empowered.count, 1);
});

test("amount zero performs no action and still executes with an empty receipt (CR 355.13)", () => {
  const kernel = withSource(world().unit("u1").build(), "u1");
  const run = runInstruction(empower, { amount: literal(0) }, { world: kernel });

  assert.equal(run.result.status, "executed");
  assert.equal(run.events.length, 0);
  assert.equal(empowered(kernel, "u1"), 0);
  assert.deepEqual(run.linked.empowered, { mode: "empower", count: 0, objects: [] });
});

test("amount zero skips the choice entirely and asks nothing", () => {
  const kernel = world().unit("u1").build();
  const run = runInstruction(empower, {
    objects: choose("empower-unit", { type: "unit" }),
    amount: literal(0)
  }, { world: kernel });

  assert.equal(run.asked, null);
  assert.equal(run.result.status, "executed");
  assert.equal(run.events.length, 0);
  assert.equal(run.linked.empowered.count, 0);
});

for (const status of ["replaced", "prevented", "impossible"]) {
  test(`a replacement hook returning ${status} negates the instruction`, () => {
    const kernel = withSource(world().unit("u1").build(), "u1");
    kernel.addReplacement((action) => (action.type === "empower" ? status : null));
    const run = runInstruction(empower, {}, { world: kernel });

    assert.equal(run.result.status, "negated");
    assert.equal(run.result.reason, status === "replaced" ? "replaced" : "impossible");
    assert.equal(empowered(kernel, "u1"), 0);
    assert.equal(run.linked.empowered.count, 0);
    assert.equal(run.events[0].outcome, status);
  });
}

test("prevention of one object negates the instruction while the other empower still stands (CR 055)", () => {
  const kernel = world().unit("u1").unit("u2").build();
  kernel.addReplacement((action) =>
    action.type === "empower" && action.object.id === "u2" ? "prevented" : null);
  const run = runInstruction(empower, { objects: target("units") }, {
    world: kernel,
    targets: { units: refs(kernel, ["u1", "u2"]) }
  });

  assert.equal(run.result.status, "negated");
  assert.equal(run.result.reason, "impossible");
  assert.equal(empowered(kernel, "u1"), 1);
  assert.equal(empowered(kernel, "u2"), 0);
  assert.deepEqual(run.linked.empowered.objects, [kernel.ref("u1")]);
});

test("all-stale targets ignore the instruction without events (CR 359.3.e.2/e.4/e.6/e.7)", () => {
  const kernel = world().unit("u1").build();
  const stale = kernel.ref("u1");
  kernel.perform({ type: "move-zone", object: stale, to: "hand" });
  const before = kernel.stateForTest();
  const run = runInstruction(empower, { objects: target("units") }, {
    world: kernel,
    targets: { units: [stale] }
  });

  assert.deepEqual(run.result, { status: "ignored", reason: "mistargeted" });
  assert.equal(run.events.length, 0);
  assert.deepEqual(run.linked, {});
  assert.deepEqual(kernel.stateForTest(), before);
});

test("a partly stale target set still empowers the remaining board object (CR 359.3.e.8)", () => {
  const kernel = world().unit("gone").unit("stays").build();
  const stale = kernel.ref("gone");
  kernel.perform({ type: "kill", object: stale });
  const run = runInstruction(empower, { objects: target("units") }, {
    world: kernel,
    targets: { units: [stale, kernel.ref("stays")] }
  });

  assert.equal(run.result.status, "executed");
  assert.equal(empowered(kernel, "stays"), 1);
  assert.deepEqual(run.linked.empowered.objects, [kernel.ref("stays")]);
});

test("a choose selection suspends without an answer and commits on replay", () => {
  const kernel = world().unit("a-unit").unit("b-unit").build();
  const options = { world: kernel };
  const asked = runInstruction(empower, {
    objects: choose("sanction-unit", { type: "unit" }, { prompt: "Empower a unit" })
  }, options);

  assert.ok(asked.asked instanceof AwaitChoice);
  assert.equal(asked.result, null);
  assert.equal(asked.asked.request.type, "select-objects");
  assert.equal(asked.asked.request.chooser, "A");
  assert.deepEqual(asked.asked.request.options, refs(kernel, ["a-unit", "b-unit"]));
  assert.equal(empowered(kernel, "a-unit"), 0);
  assert.equal(empowered(kernel, "b-unit"), 0);

  const answered = runInstruction(empower, {
    objects: choose("sanction-unit", { type: "unit" }, { prompt: "Empower a unit" })
  }, {
    ...options,
    answers: { [asked.asked.request.id]: [kernel.ref("b-unit")] }
  });
  assert.equal(answered.result.status, "executed");
  assert.equal(empowered(kernel, "a-unit"), 0);
  assert.equal(empowered(kernel, "b-unit"), 1);
});

test("a choose selection with no legal option is negated as impossible", () => {
  const kernel = world().build();
  const run = runInstruction(empower, { objects: choose("empower-unit", { type: "unit" }) }, {
    world: kernel
  });

  assert.equal(run.asked, null);
  assert.deepEqual(run.result, { status: "negated", reason: "impossible", events: [] });
});

test("a query selection empowers every current match deterministically", () => {
  const kernel = world().unit("b-unit").unit("a-unit").build();
  const run = runInstruction(empower, {
    objects: literal({ kind: "query", filter: { type: "unit" } })
  }, { world: kernel });

  assert.equal(run.result.status, "executed");
  assert.equal(empowered(kernel, "a-unit"), 1);
  assert.equal(empowered(kernel, "b-unit"), 1);
  assert.deepEqual(run.linked.empowered.objects, refs(kernel, ["a-unit", "b-unit"]));

  const rerun = runInstruction(empower, {
    objects: literal({ kind: "query", filter: { type: "unit" } })
  }, { world: world().unit("b-unit").unit("a-unit").build() });
  assert.deepEqual(rerun.linked.empowered, run.linked.empowered);
});

test("linkKey renames the receipt while the default key follows the mode", () => {
  const kernel = withSource(world().unit("u1").build(), "u1");
  const run = runInstruction(empower, { linkKey: literal("became-empowered") }, { world: kernel });

  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.empowered, undefined);
  assert.equal(run.linked["became-empowered"].count, 1);

  const disempower = runInstruction(empower, { mode: literal("disempower") }, { world: kernel });
  assert.equal(disempower.result.status, "executed");
  assert.equal(disempower.linked.disempowered.count, 1);
});

test("a consumed linked value from a previous instruction is accepted as the object list", () => {
  const kernel = world().unit("u1").build();
  const run = runInstruction(empower, { objects: linked("objects") }, {
    world: kernel,
    linked: { objects: [kernel.ref("u1")] }
  });

  assert.equal(run.result.status, "executed");
  assert.equal(empowered(kernel, "u1"), 1);
  assert.deepEqual(run.linked.empowered.objects, [kernel.ref("u1")]);
});

test("disempower mode rejects amount, multiple, and limit at the schema boundary", () => {
  const kernel = world().unit("u1").build();
  for (const args of [
    { mode: "disempower", amount: 1 },
    { mode: "disempower", multiple: true },
    { mode: "disempower", limit: 1 }
  ]) {
    assert.throws(
      () => runInstruction(empower, args, { world: kernel }),
      (error) => error instanceof TypeError && /disempower mode/.test(error.message)
    );
  }
});

test("the argument schema rejects unknown keys and malformed selections", () => {
  assert.throws(
    () => empower.argsSchema.parse({ amount: 1, mode: "empower", extra: true }),
    /Invalid effect.empower argument: extra/
  );
  assert.throws(
    () => empower.argsSchema.parse({ objects: { kind: "target" } }),
    /requires a non-empty id/
  );
  assert.throws(
    () => empower.argsSchema.parse({ objects: { kind: "choose", id: "x", filter: {}, extra: 1 } }),
    /Invalid effect.empower choose argument: extra/
  );
  assert.throws(
    () => empower.argsSchema.parse({ mode: "enlighten" }),
    /mode must be "empower" or "disempower"/
  );
  assert.throws(() => empower.argsSchema.parse({ amount: -1 }), /nonnegative safe integer/);
});

test("a non-board source with no permissive pick is ignored", () => {
  const kernel = withSource(world().hand("u1").build(), "u1");
  const run = runInstruction(empower, {}, { world: kernel });

  assert.deepEqual(run.result, { status: "ignored", reason: "mistargeted" });
  assert.equal(run.events.length, 0);
  assert.equal(empowered(kernel, "u1"), 0);
});
