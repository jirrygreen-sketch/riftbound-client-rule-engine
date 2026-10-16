import assert from "node:assert/strict";
import test from "node:test";
import { validateCardProgram } from "@riftbound/card-dsl";
import control from "../../../src/effects/instructions/effect.control.ts";
import { runAbilityBody } from "../../../dist/effects/interpreter.js";
import { MissingInformation } from "../../../src/effects/interpreter/values.ts";
import { AwaitChoice, runInstruction, world } from "../../../src/effects/testing/index.ts";

const literal = value => ({ kind: "constant", value });
const target = id => literal({ target: id });
const pick = id => literal({ pick: id });
const choose = (id, filter, min) => literal({ kind: "choose", id, filter, ...(min === undefined ? {} : { min }) });
const battlefield = { type: "battlefield", id: "battlefield-1" };
const args = { objects: target("victims") };
const enemy = { owner: "B", location: battlefield };
const setup = () => world().unit("source").unit("victim", enemy).build();
const options = kernel => ({ world: kernel, targets: { victims: [kernel.ref("victim")] } });
const empty = { count: 0, objects: [], changes: [] };
const withSource = (kernel, id) => kernel.clone({ sourceSnapshot: kernel.getObject(id) });

test("effect.control changes the controller and links the actual owner, old controller and new controller", () => {
  const kernel = setup();
  const before = kernel.getObject("victim");
  const run = runInstruction(control, args, options(kernel));
  assert.equal(control.op, "effect.control");
  assert.equal(run.result.status, "executed");
  assert.deepEqual(kernel.getObject("victim"), { ...before, controller: "A" });
  assert.deepEqual(run.linked.controlled, {
    count: 1, objects: [before.ref],
    changes: [{ object: before.ref, owner: "B", from: "B", to: "A" }]
  });
  assert.deepEqual(run.result.linkedValues, run.linked);
  assert.deepEqual(run.events.map(event => event.action), ["take-control"]);
});

test("effect.control defaults to the source, with player and linkKey evaluated as Exprs", () => {
  const kernel = withSource(setup(), "source");
  const run = runInstruction(control, { player: literal("B"), linkKey: literal("stolen") }, { world: kernel });
  assert.equal(run.result.status, "executed");
  assert.equal(kernel.getObject("source").controller, "B");
  assert.equal(kernel.getObject("source").owner, "A");
  assert.deepEqual(run.linked.stolen.objects, [kernel.ref("source")]);
  assert.equal(run.linked.controlled, undefined);
});

for (const status of ["replaced", "prevented", "impossible"]) {
  test(`effect.control returns negated when take-control is ${status}`, () => {
    const kernel = setup();
    kernel.addReplacement(action => action.type === "take-control" ? status : null);
    const run = runInstruction(control, args, options(kernel));
    assert.equal(run.result.status, "negated");
    assert.equal(run.result.reason, status === "prevented" ? "skipped" : status);
    assert.equal(kernel.getObject("victim").controller, "B");
    assert.deepEqual(run.linked.controlled, empty);
    assert.equal(run.events[0].outcome, status);
    assert.equal(kernel.continuousEffects.length, 0);
    assert.equal(kernel.delayedTriggers.length, 0);
  });
}

test("effect.control ignores all targets invalidated by exit and re-entry", () => {
  const kernel = setup();
  const locked = options(kernel);
  assert.equal(kernel.perform({ type: "return-to-hand", object: kernel.ref("victim") }).status, "done");
  assert.equal(kernel.perform({ type: "move-zone", object: kernel.ref("victim"), to: "battlefield", location: battlefield }).status, "done");
  const before = kernel.stateForTest();
  const run = runInstruction(control, args, locked);
  assert.deepEqual(run.result, { status: "ignored", reason: "mistargeted" });
  assert.deepEqual(run.linked, {});
  assert.deepEqual(run.events, []);
  assert.deepEqual(kernel.stateForTest(), before);
  assert.notDeepEqual(kernel.ref("victim"), locked.targets.victims[0]);
});

test("effect.control ignores an empty target set and a current target that is no longer on Board", () => {
  for (const refs of [[], ["victim"]]) {
    const kernel = setup();
    assert.equal(kernel.perform({ type: "kill", object: kernel.ref("victim") }).status, "done");
    const run = runInstruction(control, args, { world: kernel, targets: { victims: refs.map(id => kernel.ref(id)) } });
    assert.deepEqual(run.result, { status: "ignored", reason: "mistargeted" });
    assert.deepEqual(run.events, []);
  }
});

test("effect.control retains valid targets, deduplicates and links partial success after replacement", () => {
  const kernel = world().unit("source").unit("blocked", enemy).unit("victim", enemy).build();
  kernel.addReplacement(action => action.type === "take-control" && action.object.id === "blocked" ? "replaced" : null);
  const run = runInstruction(control, { ...args, amount: literal(99) }, {
    world: kernel, targets: { victims: [kernel.ref("blocked"), { id: "gone", zoneEntryId: 1 }, kernel.ref("victim"), kernel.ref("victim")] }
  });
  assert.equal(run.result.status, "negated");
  assert.equal(run.result.reason, "replaced");
  assert.deepEqual(run.events.map(event => event.outcome ?? "done"), ["replaced", "done"]);
  assert.equal(kernel.getObject("blocked").controller, "B");
  assert.deepEqual(run.linked.controlled.objects, [kernel.ref("victim")]);
  assert.equal(run.linked.controlled.count, 1);
});

test("effect.control zero amount does not request a choice or attempt a control action", () => {
  const kernel = setup();
  const before = kernel.stateForTest();
  const run = runInstruction(control, {
    objects: choose("objects", { controller: "B" }), amount: literal(0),
    duration: literal({ type: "end-of-turn" })
  }, { world: kernel });
  assert.equal(run.result.status, "executed");
  assert.equal(run.asked, null);
  assert.deepEqual(run.linked.controlled, empty);
  assert.deepEqual(kernel.stateForTest(), before);
});

test("effect.control clamps an oversized count to distinct available objects", () => {
  const kernel = setup();
  const run = runInstruction(control, { ...args, amount: literal(Number.MAX_SAFE_INTEGER) }, {
    world: kernel, targets: { victims: [kernel.ref("victim"), kernel.ref("victim")] }
  });
  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.controlled.count, 1);
  assert.equal(run.events.length, 1);
});

test("effect.control count is an upper bound in the supplied target order", () => {
  const kernel = world().unit("source").unit("z", enemy).unit("a", enemy).build();
  const run = runInstruction(control, args, { world: kernel, targets: { victims: [kernel.ref("z"), kernel.ref("a")] } });
  assert.equal(run.result.status, "executed");
  assert.deepEqual(run.linked.controlled.objects, [kernel.ref("z")]);
  assert.equal(kernel.getObject("a").controller, "B");
});

test("effect.control does not count an already-controlled object as a control change", () => {
  const kernel = setup();
  const run = runInstruction(control, { objects: literal("self") }, { world: kernel });
  assert.equal(run.result.status, "executed");
  assert.deepEqual(run.linked.controlled, empty);
  assert.deepEqual(run.events, []);
});

test("effect.control reads non-target picks and treats stale picks as impossible", () => {
  const kernel = setup();
  const locked = kernel.ref("victim");
  const run = runInstruction(control, { objects: pick("chosen") }, {
    world: kernel, picks: { chosen: ["not-an-object", locked, locked] }
  });
  assert.equal(run.result.status, "executed");
  assert.deepEqual(run.linked.controlled.objects, [locked]);
  assert.equal(kernel.perform({ type: "return-to-hand", object: locked }).status, "done");
  const stale = runInstruction(control, { objects: pick("chosen") }, { world: kernel, picks: { chosen: [locked] } });
  assert.equal(stale.result.status, "negated");
  assert.equal(stale.result.reason, "impossible");
  assert.deepEqual(stale.linked.controlled, empty);
});

test("effect.control an unknown recipient is impossible through the kernel action", () => {
  const kernel = setup();
  const run = runInstruction(control, { ...args, player: literal("missing-player") }, options(kernel));
  assert.equal(run.result.status, "negated");
  assert.equal(run.result.reason, "impossible");
  assert.equal(run.events[0].outcome, "impossible");
  assert.deepEqual(run.linked.controlled, empty);
  assert.equal(kernel.getObject("victim").controller, "B");
});

test("effect.control suspends a non-target choice without mutation and replays the answer deterministically", () => {
  const kernel = world().unit("source").unit("z", enemy).unit("a", enemy).build();
  const selectedArgs = { objects: choose("control-choice", { type: "unit", controller: "B" }) };
  const before = kernel.stateForTest();
  const asked = runInstruction(control, selectedArgs, { world: kernel });
  assert.ok(asked.asked instanceof AwaitChoice);
  assert.equal(asked.result, null);
  assert.deepEqual(asked.asked.request, {
    id: "control-choice", type: "select-objects", chooser: "A", visibility: "public",
    options: [kernel.ref("a"), kernel.ref("z")], min: 1, max: 1
  });
  assert.deepEqual(kernel.stateForTest(), before);
  assert.deepEqual(asked.linked, {});
  const replayOptions = { world: kernel, answers: { "control-choice": [kernel.ref("z")] } };
  const duplicate = kernel.clone();
  const run = runInstruction(control, selectedArgs, replayOptions);
  const repeat = runInstruction(control, selectedArgs, { ...replayOptions, world: duplicate });
  assert.equal(run.result.status, "executed");
  assert.deepEqual(run.events, repeat.events);
  assert.deepEqual(run.linked, repeat.linked);
  assert.deepEqual(kernel.stateForTest(), duplicate.stateForTest());
  assert.equal(kernel.getObject("a").controller, "B");
  assert.equal(kernel.getObject("z").controller, "A");
});

test("effect.control up-to choices allow zero objects, including when there are no candidates", () => {
  for (const filter of [{ controller: "B" }, { type: "gear" }]) {
    const kernel = setup();
    const run = runInstruction(control, { objects: choose("up-to", filter, 0), amount: literal(2) }, {
      world: kernel, answers: { "up-to": [] }
    });
    assert.equal(run.result.status, "executed");
    assert.deepEqual(run.events, []);
    assert.deepEqual(run.linked.controlled, empty);
  }
});

test("effect.control rejects invalid choice answers transactionally", () => {
  const kernel = world().unit("source").unit("z", enemy).unit("a", enemy).build();
  const before = kernel.stateForTest();
  const selectedArgs = { objects: choose("choice", { controller: "B" }), amount: literal(2) };
  for (const answer of [[], [kernel.ref("a")], [kernel.ref("a"), kernel.ref("a")],
    [kernel.ref("a"), kernel.ref("source")], [kernel.ref("a"), { id: "z", zoneEntryId: 999 }], "a"]) {
    assert.throws(() => runInstruction(control, selectedArgs, { world: kernel, answers: { choice: answer } }), /choice answer/);
    assert.deepEqual(kernel.stateForTest(), before);
  }
});

test("effect.control supports current Rune objects and finalized Chain targets", () => {
  const kernel = world().unit("source")
    .object("rune", { owner: "B", controller: "B", zone: "rune-zone", types: ["rune"] })
    .object("trigger", { owner: "B", controller: "B", zone: "chain", types: ["ability"] }).build();
  const run = runInstruction(control, { ...args, amount: literal(2) }, {
    world: kernel, targets: { victims: [kernel.ref("rune"), kernel.ref("trigger")] }
  });
  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.controlled.count, 2);
  assert.equal(kernel.getObject("rune").controller, "A");
  assert.equal(kernel.getObject("trigger").controller, "A");
});

test("effect.control local choices exclude Chain objects without Pending/Finalize metadata", () => {
  const kernel = world().unit("source").object("chain", { owner: "B", zone: "chain", types: ["spell"] }).build();
  const run = runInstruction(control, { objects: choose("chain-choice", { zone: "chain" }) }, { world: kernel });
  assert.equal(run.result.status, "negated");
  assert.equal(run.result.reason, "impossible");
  assert.equal(run.asked, null);
  assert.equal(kernel.getObject("chain").controller, "B");
});

test("effect.control keeps attached Gear ownership and controller independent from the host (718.5.e-f)", () => {
  const kernel = world().unit("source").unit("victim", enemy)
    .object("gear", { owner: "B", zone: "board", types: ["gear"], location: battlefield, energy: null, power: null }).build();
  assert.equal(kernel.perform({ type: "attach", object: kernel.ref("gear"), host: kernel.ref("victim") }).status, "done");
  const gear = kernel.getObject("gear");
  const run = runInstruction(control, args, options(kernel));
  assert.equal(run.result.status, "executed");
  assert.deepEqual(kernel.getObject("gear"), gear);
  assert.equal(kernel.getObject("victim").controller, "A");
  assert.equal(gear.energy, null);
  assert.equal(gear.power, null);
});

test("effect.control does not change ownership: a controlled Unit still dies to its owner's Trash", () => {
  const kernel = setup();
  assert.equal(runInstruction(control, args, options(kernel)).result.status, "executed");
  assert.equal(kernel.perform({ type: "kill", object: kernel.ref("victim") }).status, "done");
  assert.deepEqual(kernel.zone("B", "trash"), [kernel.ref("victim")]);
  assert.deepEqual(kernel.zone("A", "trash"), []);
});

test("effect.control evaluates symbolic object-property, linked, count and arithmetic Exprs", () => {
  const kernel = setup();
  const run = runInstruction(control, {
    ...args, player: { kind: "object-property", object: "source", property: "controller" },
    amount: { kind: "arithmetic", operator: "min", operands: [
      { kind: "count", subject: "objects", filter: { controller: "B", zone: "board" } },
      { kind: "linked-value", instructionId: "prior", key: "limit" }
    ] }
  }, { ...options(kernel), linked: { limit: 1 } });
  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.controlled.count, 1);
});

test("ogn-203-298 Possession control instruction preserves the battlefield and statuses for the separate Recall", () => {
  const kernel = world().object("possession", { cardId: "ogn-203-298", types: ["spell"], zone: "chain" })
    .unit("victim", { ...enemy, exhausted: true, damage: 2, stunned: true, energy: null, power: null }).build();
  const before = kernel.getObject("victim");
  const run = runInstruction(control, args, options(kernel));
  assert.equal(run.result.status, "executed");
  assert.deepEqual(kernel.getObject("victim"), { ...before, controller: "A" });
  assert.deepEqual(run.events.map(event => event.action), ["take-control"]);
  assert.equal(kernel.continuousEffects.length, 0);
  assert.equal(kernel.delayedTriggers.length, 0);
});

const akshan = () => withSource(world().unit("akshan", { cardId: "sfd-109-221" })
  .object("gear", { owner: "B", types: ["gear"], zone: "board", location: { type: "base", player: "A" } }).build(), "akshan");
const akshanArgs = { objects: target("gear"), duration: literal({ type: "while-source-in-zone" }) };

test("sfd-109-221 Akshan live-source temporary control remains explicitly blocked without an expiry contract", () => {
  const kernel = akshan();
  const before = kernel.stateForTest();
  const run = runInstruction(control, akshanArgs, { world: kernel, targets: { gear: [kernel.ref("gear")] } });
  assert.equal(run.result.status, "negated");
  assert.equal(run.result.reason, "impossible");
  assert.match(run.linked.controlled.blockedReason, /duration-aware take-control/);
  assert.equal(run.linked.controlled.count, 0);
  assert.deepEqual(run.events, []);
  assert.deepEqual(kernel.stateForTest(), before);
  assert.equal(kernel.continuousEffects.length, 0);
  assert.equal(kernel.delayedTriggers.length, 0);
});

for (const reenter of [false, true]) {
  test(`sfd-109-221 Akshan already left the Board${reenter ? " and re-entered" : ""}: control is ignored (359.3.e.16)`, () => {
    const kernel = akshan();
    assert.equal(kernel.perform({ type: "kill", object: kernel.ref("akshan") }).status, "done");
    if (reenter) assert.equal(kernel.perform({ type: "move-zone", object: kernel.ref("akshan"), to: "base" }).status, "done");
    const before = kernel.stateForTest();
    const run = runInstruction(control, akshanArgs, { world: kernel, targets: { gear: [kernel.ref("gear")] } });
    assert.deepEqual(run.result, { status: "ignored", reason: "linked-ignored" });
    assert.deepEqual(run.linked, {});
    assert.deepEqual(run.events, []);
    assert.deepEqual(kernel.stateForTest(), before);
    assert.equal(kernel.getObject("gear").controller, "B");
  });
}

for (const lifetime of [{ type: "end-of-turn" }, { type: "end-of-combat" }, { type: "until", at: "turn-end", player: "B" }]) {
  test(`effect.control ${lifetime.type} remains blocked instead of becoming permanent`, () => {
    const kernel = setup();
    const before = kernel.stateForTest();
    const run = runInstruction(control, { ...args, duration: literal(lifetime) }, options(kernel));
    assert.equal(run.result.status, "negated");
    assert.equal(run.result.reason, "impossible");
    assert.match(run.linked.controlled.blockedReason, /expiry\/restoration/);
    assert.deepEqual(kernel.stateForTest(), before);
    assert.deepEqual(run.events, []);
  });
}

test("effect.control rejects invalid amounts, evaluated arguments and static schemas before any mutation", () => {
  const kernel = setup();
  const before = kernel.stateForTest();
  const invalid = [null, [], { unknown: literal(1) }, { player: () => "B" }, { objects: literal({ id: "victim", zoneEntryId: 1 }) },
    ...[-1, 0.5, Number.MAX_SAFE_INTEGER + 1, "1", null, Infinity, NaN].map(amount => ({ ...args, amount: literal(amount) })),
    { ...args, player: literal("") }, { ...args, player: literal(null) }, { ...args, linkKey: literal(" ") },
    { ...args, duration: literal({ type: "unknown" }) }, { ...args, duration: literal({ type: "permanent", extra: true }) },
    { ...args, duration: literal({ type: "until", at: "not-a-timing-point" }) },
    { ...args, duration: literal({ type: "while-source-in-zone", source: "self" }) },
    { objects: choose("choice", {}, 2), amount: literal(1) },
    { ...args, player: { kind: "object-property", object: kernel.ref("source"), property: "controller" } },
    { ...args, amount: { kind: "arithmetic", operator: "sub", operands: [literal(1)] } }
  ];
  const cyclic = { kind: "arithmetic", operator: "add", operands: [] };
  cyclic.operands.push(cyclic);
  invalid.push({ ...args, amount: cyclic });
  for (const candidate of invalid) {
    assert.throws(() => runInstruction(control, candidate, options(kernel)), TypeError);
    assert.deepEqual(kernel.stateForTest(), before);
  }
});

test("effect.control canonical EffectIR validates and executes through the real interpreter registry", () => {
  const kernel = setup();
  const instruction = { id: "possession-control", op: "effect.control", args: {
    ...args, player: { kind: "object-property", object: "source", property: "controller" },
    amount: literal(1), duration: literal({ type: "permanent" }), linkKey: literal("result")
  } };
  const program = { canonicalCardId: "test:control", rulesetVersion: "core-1.5", status: "executable",
    sourceText: "Take control of it.", abilities: [{ kind: "play", body: [instruction] }] };
  const validated = validateCardProgram(program);
  assert.equal(validated.ok, true, JSON.stringify(validated));
  const invalid = validateCardProgram({ ...program, abilities: [{ kind: "play", body: [{
    ...instruction, args: { objects: { target: "victims" }, player: "A" }
  }] }] });
  assert.equal(invalid.ok, false, "raw runtime normalization must not weaken canonical IR validation");
  kernel.setTargets("victims", [kernel.ref("victim")]);
  const run = runAbilityBody([instruction], kernel);
  assert.equal(run.status, "executed");
  assert.equal(kernel.getObject("victim").controller, "A");
  assert.equal(run.results[0].result.status, "executed");
  assert.equal(run.linkedValues["possession-control.result"].count, 1);
  assert.deepEqual(run.events.map(event => event.action), ["take-control"]);
});

test("effect.control interpreter scopes preserve separate results and ignore linked instructions after mistargeting", () => {
  const kernel = setup();
  kernel.setTargets("victims", [kernel.ref("victim")]);
  kernel.setTargets("missing", []);
  const run = runAbilityBody([
    { id: "first", op: "effect.control", args },
    { id: "back", op: "effect.control", args: { ...args, player: literal("B") } },
    { id: "lost", op: "effect.control", args: { objects: target("missing") } },
    { id: "linked", op: "effect.control", linkedTo: "lost", args }
  ], kernel);
  assert.equal(run.status, "partial");
  assert.equal(run.linkedValues["first.controlled"].changes[0].to, "A");
  assert.equal(run.linkedValues["back.controlled"].changes[0].to, "B");
  assert.deepEqual(run.results[2].result, { status: "ignored", reason: "mistargeted" });
  assert.deepEqual(run.results[3].result, { status: "ignored", reason: "linked-ignored" });
  assert.deepEqual(run.events.map(event => event.action), ["take-control", "take-control"]);
  assert.equal(kernel.getObject("victim").controller, "B");
});

test("effect.control preserves missing printed characteristics instead of treating null as zero", () => {
  const kernel = world().unit("source").unit("victim", { ...enemy, energy: null, power: null }).build();
  const before = kernel.stateForTest();
  assert.throws(() => runInstruction(control, {
    ...args, amount: { kind: "arithmetic", operator: "add", operands: [
      { kind: "object-property", object: { target: "victims" }, property: "energy" }, literal(1)
    ] }
  }, options(kernel)), error => error instanceof MissingInformation && error.message === "Cannot calculate with a null characteristic");
  assert.deepEqual(kernel.stateForTest(), before);
  assert.equal(kernel.getObject("victim").energy, null);
  assert.equal(kernel.getObject("victim").power, null);
});
