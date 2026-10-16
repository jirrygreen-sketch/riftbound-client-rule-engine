import assert from "node:assert/strict";
import test from "node:test";
import ready from "../../../src/effects/instructions/effect.ready.ts";
import { AwaitChoice, runInstruction, world } from "../../../src/effects/testing/index.ts";

const literal = (value) => ({ kind: "constant", value });
const target = (id) => literal({ kind: "target", id });
const pick = (id) => literal({ kind: "pick", id });
const source = literal({ kind: "source" });
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
