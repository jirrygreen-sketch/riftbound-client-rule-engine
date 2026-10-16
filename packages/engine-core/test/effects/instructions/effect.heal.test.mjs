import assert from "node:assert/strict";
import test from "node:test";
import heal from "../../../dist/effects/instructions/effect.heal.js";
import { AwaitChoice, runInstruction, world } from "../../../dist/effects/testing/index.js";

const literal = value => ({ kind: "constant", value });
const target = id => literal({ kind: "target", id });
const pick = id => literal({ kind: "pick", id });
const query = filter => literal({ kind: "query", filter });
const choose = (id, filter = {}, bounds = {}) => literal({ kind: "choose", id, filter, ...bounds });
const battlefield = { type: "battlefield", id: "battlefield-1" };
const setup = () => {
  const kernel = world().unit("unit", { might: 8, damage: 5 }).build();
  return kernel.clone({ sourceSnapshot: kernel.getObject("unit") });
};
const runTarget = (kernel, args = {}) => runInstruction(heal, { objects: target("unit"), ...args }, {
  world: kernel, targets: { unit: [kernel.ref("unit")] }
});
const noHealing = kernel => assert.equal(kernel.history({ action: "heal" }), 0);

test("effect.heal clears a bounded amount through the heal action and links actual results", () => {
  const kernel = setup();
  const before = kernel.getObject("unit");
  const run = runTarget(kernel, { amount: literal(2) });
  assert.equal(heal.op, "effect.heal");
  assert.equal(run.result.status, "executed");
  assert.deepEqual(kernel.getObject("unit"), { ...before, damage: 3 });
  assert.deepEqual(run.events.map(event => event.action), ["heal"]);
  assert.equal(kernel.history({ action: "heal" }), 1);
  assert.deepEqual(run.linked.healed, { amount: 2, count: 1, objects: [kernel.ref("unit")] });
  assert.deepEqual(run.result.linkedValues, run.linked);
});

test("effect.heal defaults to its source and clears all currently marked damage", () => {
  const kernel = setup();
  const run = runInstruction(heal, {}, { world: kernel });
  assert.equal(run.result.status, "executed");
  assert.equal(kernel.getObject("unit").damage, 0);
  assert.equal(run.linked.healed.amount, 5);
});

for (const status of ["replaced", "prevented", "impossible"]) {
  test("effect.heal negates a " + status + " heal action without claiming healing", () => {
    const kernel = setup();
    kernel.addReplacement(action => action.type === "heal" ? status : null);
    const run = runTarget(kernel);
    assert.equal(run.result.status, "negated");
    assert.equal(run.result.reason, status === "prevented" ? "skipped" : status);
    assert.equal(kernel.getObject("unit").damage, 5);
    assert.deepEqual(run.linked.healed, { amount: 0, count: 0, objects: [] });
    assert.deepEqual(run.result.events, run.events);
    assert.equal(run.events[0].outcome, status);
    noHealing(kernel);
  });
}

test("effect.heal continues after replacement and links only actual partial success", () => {
  const kernel = world().unit("blocked", { damage: 2 }).unit("unit", { damage: 4 }).build();
  kernel.addReplacement(action => action.type === "heal" && action.object.id === "blocked" ? "replaced" : null);
  const run = runInstruction(heal, { objects: target("units") }, {
    world: kernel, targets: { units: [kernel.ref("blocked"), kernel.ref("unit")] }
  });
  assert.equal(run.result.status, "negated");
  assert.equal(run.result.reason, "replaced");
  assert.deepEqual(run.events.map(event => event.outcome ?? "done"), ["replaced", "done"]);
  assert.equal(kernel.getObject("blocked").damage, 2);
  assert.equal(kernel.getObject("unit").damage, 0);
  assert.deepEqual(run.linked.healed, { amount: 4, count: 1, objects: [kernel.ref("unit")] });
});

test("effect.heal ignores stale targets even after the same card returns with a new identity", () => {
  const kernel = setup();
  const locked = kernel.ref("unit");
  assert.equal(kernel.perform({ type: "return-to-hand", object: locked }).status, "done");
  assert.equal(kernel.perform({ type: "move-zone", object: kernel.ref("unit"), to: "battlefield", location: battlefield }).status, "done");
  assert.notDeepEqual(kernel.ref("unit"), locked);
  const before = kernel.stateForTest();
  const run = runInstruction(heal, { objects: target("unit") }, { world: kernel, targets: { unit: [locked] } });
  assert.deepEqual(run.result, { status: "ignored", reason: "mistargeted" });
  assert.deepEqual(run.linked, {});
  assert.deepEqual(run.events, []);
  assert.deepEqual(kernel.stateForTest(), before);
});

test("effect.heal ignores an empty revalidated target set before evaluating target-dependent amounts", () => {
  for (const args of [{}, { amount: literal(0) }, {
    amount: { kind: "linked-value", instructionId: "lost-target", key: "unavailable" }
  }]) {
    const kernel = setup();
    const run = runInstruction(heal, { objects: target("lost"), ...args }, { world: kernel });
    assert.deepEqual(run.result, { status: "ignored", reason: "mistargeted" });
    assert.deepEqual(run.linked, {});
    noHealing(kernel);
  }
});

test("effect.heal skips stale targets and duplicate references while healing each live Unit", () => {
  const kernel = world().unit("first", { damage: 2 }).unit("second", { damage: 5 }).build();
  const refs = [kernel.ref("second"), { id: "gone", zoneEntryId: 1 }, kernel.ref("first"), kernel.ref("second")];
  const run = runInstruction(heal, { objects: target("units") }, { world: kernel, targets: { units: refs } });
  assert.equal(run.result.status, "executed");
  assert.deepEqual(run.linked.healed, { amount: 7, count: 2, objects: [kernel.ref("second"), kernel.ref("first")] });
  assert.equal(kernel.getObject("first").damage, 0);
  assert.equal(kernel.getObject("second").damage, 0);
  assert.equal(run.events.length, 2);
});

test("effect.heal clamps oversized amounts to actual damage without adding negative damage", () => {
  const kernel = setup();
  const run = runTarget(kernel, { amount: literal(Number.MAX_SAFE_INTEGER) });
  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.healed.amount, 5);
  assert.equal(kernel.getObject("unit").damage, 0);
});

test("effect.heal zero amount performs no action or choice and links zero", () => {
  const kernel = setup();
  const before = kernel.stateForTest();
  const run = runInstruction(heal, { objects: choose("heal-choice"), amount: literal(0) }, { world: kernel });
  assert.equal(run.result.status, "executed");
  assert.equal(run.asked, null);
  assert.deepEqual(run.events, []);
  assert.deepEqual(run.linked.healed, { amount: 0, count: 0, objects: [] });
  assert.deepEqual(kernel.stateForTest(), before);
});

test("effect.heal does not invent a healing action for an undamaged Unit", () => {
  const kernel = world().unit("unit").build();
  const run = runTarget(kernel);
  assert.equal(run.result.status, "executed");
  assert.deepEqual(run.linked.healed, { amount: 0, count: 0, objects: [] });
  assert.deepEqual(run.events, []);
  noHealing(kernel);
});

test("effect.heal consumes non-target picks and never treats player ids as Units", () => {
  const kernel = setup();
  const players = [kernel.player("A"), kernel.player("B")];
  const run = runInstruction(heal, { objects: pick("affected") }, {
    world: kernel, picks: { affected: ["A", kernel.ref("unit"), "B", kernel.ref("unit")] }
  });
  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.healed.amount, 5);
  assert.deepEqual([kernel.player("A"), kernel.player("B")], players);
  assert.deepEqual(run.events.map(event => event.action), ["heal"]);
});

test("effect.heal cannot heal a stale non-target pick or a source that has left the Board", () => {
  for (const objects of [pick("affected"), literal({ kind: "source" })]) {
    const kernel = setup();
    const ref = kernel.ref("unit");
    assert.equal(kernel.perform({ type: "return-to-hand", object: ref }).status, "done");
    const run = runInstruction(heal, { objects }, { world: kernel, picks: { affected: [ref] } });
    assert.equal(run.result.status, "negated");
    assert.equal(run.result.reason, "impossible");
    assert.equal(run.linked.healed.amount, 0);
    noHealing(kernel);
  }
});

test("effect.heal queries all matching Board Units in deterministic order", () => {
  const kernel = world().unit("z", { damage: 3 }).unit("a", { damage: 1 })
    .unit("enemy", { owner: "B", damage: 2 })
    .object("gear", { types: ["gear"], zone: "board", damage: 9 })
    .hand("hand", { types: ["unit"], damage: 9 }).build();
  const run = runInstruction(heal, { objects: query({ controller: "A" }) }, { world: kernel });
  assert.equal(run.result.status, "executed");
  assert.deepEqual(run.linked.healed, { amount: 4, count: 2, objects: [kernel.ref("a"), kernel.ref("z")] });
  assert.equal(kernel.getObject("enemy").damage, 2);
  assert.equal(kernel.getObject("gear").damage, 9);
  assert.equal(kernel.getObject("hand").damage, 9);
});

test("effect.heal empty all-Units query executes with zero actual result", () => {
  const kernel = setup();
  const run = runInstruction(heal, { objects: query({ controller: "missing" }) }, { world: kernel });
  assert.equal(run.result.status, "executed");
  assert.deepEqual(run.linked.healed, { amount: 0, count: 0, objects: [] });
  noHealing(kernel);
});

test("effect.heal suspends a non-target choice without mutation, then replays the chosen healing", () => {
  const kernel = world().unit("z", { damage: 3 }).unit("a", { damage: 2 })
    .unit("enemy", { owner: "B", damage: 4 }).build();
  const args = { objects: choose("heal-choice", { controller: "A" }), amount: literal(1) };
  const before = kernel.stateForTest();
  const run = runInstruction(heal, args, { world: kernel });
  assert.ok(run.asked instanceof AwaitChoice);
  assert.equal(run.result, null);
  assert.deepEqual(run.asked.request, {
    id: "heal-choice", type: "select-objects", chooser: "A", visibility: "public",
    options: [kernel.ref("a"), kernel.ref("z")], min: 1, max: 1
  });
  assert.deepEqual(kernel.stateForTest(), before);
  assert.deepEqual(run.linked, {});
  const replayed = runInstruction(heal, args, { world: kernel, answers: { "heal-choice": [kernel.ref("z")] } });
  assert.equal(replayed.asked, null);
  assert.equal(replayed.result.status, "executed");
  assert.equal(kernel.getObject("z").damage, 2);
  assert.equal(kernel.getObject("a").damage, 2);
  assert.equal(kernel.getObject("enemy").damage, 4);
  assert.deepEqual(replayed.linked.healed, { amount: 1, count: 1, objects: [kernel.ref("z")] });
});

test("effect.heal choice bounds handle unavailable Units, zero, and optional empty answers", () => {
  for (const bounds of [{ min: 0, max: 0 }, { min: 0, max: 1 }]) {
    const kernel = setup();
    const run = runInstruction(heal, { objects: choose("optional", {}, bounds) }, {
      world: kernel, answers: { optional: [] }
    });
    assert.equal(run.result.status, "executed");
    assert.equal(run.linked.healed.count, 0);
    noHealing(kernel);
  }
  const kernel = setup();
  const args = { objects: choose("many", {}, { min: 99, max: 99 }) };
  const asked = runInstruction(heal, args, { world: kernel });
  assert.equal(asked.asked.request.min, 1);
  assert.equal(asked.asked.request.max, 1);
  const run = runInstruction(heal, args, { world: kernel, answers: { many: [kernel.ref("unit")] } });
  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.healed.amount, 5);
  const unavailable = runInstruction(heal, { objects: choose("none", { controller: "missing" }) }, { world: kernel });
  assert.equal(unavailable.result.status, "negated");
  assert.equal(unavailable.asked, null);
});

test("effect.heal rejects invalid choice answers before any action commits", () => {
  const kernel = world().unit("a", { damage: 3 }).unit("b", { damage: 4 }).build();
  const args = { objects: choose("choice", {}, { min: 1, max: 2 }) };
  const before = kernel.stateForTest();
  for (const answer of [null, "A", [], [kernel.ref("a"), kernel.ref("a")],
    [{ id: "missing", zoneEntryId: 1 }], [kernel.ref("a"), null],
    [kernel.ref("a"), kernel.ref("b"), kernel.ref("a")]]) {
    assert.throws(() => runInstruction(heal, args, { world: kernel, answers: { choice: answer } }), /choice answer/);
    assert.deepEqual(kernel.stateForTest(), before);
    noHealing(kernel);
  }
});

test("effect.heal evaluates linked arithmetic amounts and a custom link key at resolution", () => {
  const kernel = setup();
  const run = runInstruction(heal, {
    objects: target("unit"),
    amount: { kind: "arithmetic", operator: "add", operands: [
      { kind: "linked-value", instructionId: "prior", key: "amount" }, literal(1)
    ] }, linkKey: { kind: "literal", value: "cleared" }
  }, { world: kernel, targets: { unit: [kernel.ref("unit")] }, linked: { amount: 1 } });
  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.cleared.amount, 2);
  assert.equal(kernel.getObject("unit").damage, 3);
  assert.equal(run.linked.healed, undefined);
});

test("effect.heal identical replay inputs yield identical events, links, and world state", () => {
  const kernel = setup();
  const other = kernel.clone();
  const args = { objects: choose("choice"), amount: literal(2) };
  const answers = { choice: [kernel.ref("unit")] };
  const left = runInstruction(heal, args, { world: kernel, answers });
  const right = runInstruction(heal, args, { world: other, answers });
  assert.deepEqual(left.result, right.result);
  assert.deepEqual(left.events, right.events);
  assert.deepEqual(left.linked, right.linked);
  assert.deepEqual(kernel.stateForTest(), other.stateForTest());
});

test("sfd-173-221 Soraka, Wanderer: replacement healing clause clears the affected non-target Unit", () => {
  const kernel = world().unit("soraka", { cardId: "sfd-173-221", might: 4 })
    .unit("saved", { might: 3, damage: 2 }).unit("bystander", { damage: 1 }).build();
  // Card text: "instead heal it, exhaust it, and recall it". The enclosing
  // replacement owns its condition and affected-Unit binding (355.10.c).
  const before = kernel.getObject("saved");
  const run = runInstruction(heal, { objects: pick("affected-unit") }, {
    world: kernel, picks: { "affected-unit": [kernel.ref("saved")] }
  });
  assert.equal(run.result.status, "executed");
  assert.deepEqual(kernel.getObject("saved"), { ...before, damage: 0 });
  assert.equal(kernel.getObject("bystander").damage, 1);
  assert.deepEqual(run.events.map(event => event.action), ["heal"]);
  assert.equal(run.linked.healed.amount, 2);
});

test("unl-175-219 Tactical Retreat: deferred replacement healing preserves printed null costs", () => {
  const kernel = world().object("retreat", {
    cardId: "unl-175-219", types: ["spell"], zone: "chain", energy: 2, power: null
  }).unit("saved", { might: 6, damage: 4, energy: null, power: null }).build();
  // "Choose a friendly unit. The next time it would die this turn, heal it,
  // exhaust it, and recall it instead." Test only the already-bound heal clause;
  // scheduling the replacement and its exhaust/recall instructions are separate.
  const before = kernel.getObject("saved");
  const source = kernel.getObject("retreat");
  const run = runInstruction(heal, { objects: pick("protected-unit") }, {
    world: kernel, picks: { "protected-unit": [kernel.ref("saved")] }
  });
  assert.equal(run.result.status, "executed");
  assert.deepEqual(kernel.getObject("saved"), { ...before, damage: 0 });
  assert.deepEqual(kernel.getObject("retreat"), source);
  assert.deepEqual(run.linked.healed, { amount: 4, count: 1, objects: [kernel.ref("saved")] });
  assert.deepEqual(run.events.map(event => event.action), ["heal"]);
});

test("effect.heal argsSchema rejects malformed arguments without coercion", () => {
  for (const args of [null, [], { target: literal("unit") }, { objects: "unit" },
    { objects: literal("A") }, { objects: literal({ kind: "target", id: "" }) },
    { objects: choose("bad", {}, { min: 2, max: 1 }) },
    { objects: choose("bad", {}, { min: null }) },
    { objects: choose("bad", {}, { min: -1 }) }, { linkKey: literal("") },
    { amount: { kind: "unknown" } }, { amount: { kind: "constant" } },
    { amount: { kind: "arithmetic", operator: "sub", operands: [literal(1)] } }]) {
    assert.throws(() => heal.argsSchema.parse(args), TypeError);
  }
  for (const amount of [-1, 0.5, Number.NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, null, "2"]) {
    assert.throws(() => heal.argsSchema.parse({ amount: literal(amount) }), TypeError);
    const kernel = setup();
    const before = kernel.stateForTest();
    assert.throws(() => runInstruction(heal, {
      amount: { kind: "linked-value", instructionId: "prior", key: "bad" }
    }, { world: kernel, linked: { bad: amount } }), /nonnegative safe integer/);
    assert.deepEqual(kernel.stateForTest(), before);
  }
  const cyclic = { kind: "arithmetic", operator: "add", operands: [] };
  cyclic.operands.push(cyclic);
  assert.throws(() => heal.argsSchema.parse({ amount: cyclic }), TypeError);
});
