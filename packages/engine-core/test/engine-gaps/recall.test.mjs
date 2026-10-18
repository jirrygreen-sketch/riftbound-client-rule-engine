import assert from "node:assert/strict";
import test from "node:test";

import move from "../../dist/effects/instructions/effect.move.js";
import swap from "../../dist/effects/instructions/effect.swap-location.js";
import { resolveChainBody } from "../../dist/chain/interpreter-adapter.js";
import { queryMoveDestinations } from "../../dist/target/location/candidates.js";
import { createLayerEngine } from "../../dist/layers/engine.js";
import { cardProgram, fixture as programFixture } from "../rules/keywords/support.mjs";
import { AwaitChoice, runInstruction, world } from "../../dist/effects/testing/index.js";
import { bindResolveContext } from "../../dist/events/action-adapter.js";
import { asValue } from "../../dist/effects/interpreter/values.js";
import conscription from "../../../card-dsl/dist/cards/unl/conscription.js";
import glowstone from "../../../card-dsl/dist/cards/ven/glowstone.js";
import smokeAndMirrors from "../../../card-dsl/dist/cards/unl/smoke-and-mirrors.js";

const c = value => ({ kind: "constant", value });
const battlefield = { type: "battlefield", id: "battlefield-1" };
const second = { type: "battlefield", id: "battlefield-2" };
const contested = { type: "battlefield", id: "battlefield-3" };
const base = player => ({ type: "base", player });
const withSource = (kernel, id) => kernel.clone({ sourceSnapshot: kernel.getObject(id) });
const recallArgs = (to = "controller-base") => ({
  objects: c({ target: "units" }), to: c(to), mode: c("recall"), linkKey: c("recalled"),
});

function scenario() {
  return withSource(world()
    .unit("hero", { might: 4, damage: 2, exhausted: true, stunned: true, buffs: 1 })
    .unit("anchor", { location: second })
    .unit("enemy", { owner: "B" })
    .hand("kept")
    .build(), "hero");
}

const targets = kernel => ({ units: [kernel.ref("hero")] });
const recallRun = (kernel, to = "controller-base") =>
  runInstruction(move, recallArgs(to), { world: kernel, targets: targets(kernel) });

/** A capability-only test port. It changes positions but never invokes perform. */
function withContractActions(kernel, perform) {
  return bindResolveContext(kernel, {
    contractActions: { version: "riftbound.contract-actions.v1", perform },
  });
}

function runWithContractActions(def, args, kernel, options, perform) {
  const target = kernel.clone();
  for (const [id, refs] of Object.entries(options.targets ?? {})) target.setTargets(id, refs);
  target.setAnswers(options.answers ?? {});
  const context = withContractActions(target, perform);
  const result = def.execute(context, def.argsSchema.parse(args));
  kernel.restore(target.snapshot());
  kernel.copyLinkedFrom(target);
  return { result, events: result?.events ?? [], linked: target.linkedSnapshot(), asked: null };
}

function recallCapability(calls, status = "done") {
  return action => {
    calls.push(structuredClone(action));
    return status === "done"
      ? { status: "done", events: [], receipt: { status: "committed", actions: [{ type: "recall", status: "done" }] } }
      : { status, events: [] };
  };
}

function mutateRecall(kernel, action) {
  const object = kernel.getObject(action.object.id);
  if (object === null) return null;
  const from = object.location;
  object.location = base(object.controller);
  kernel.addObject(object, "board");
  return { object, from };
}

function recallWithCapability(kernel, { status = "done", throwError } = {}) {
  const calls = [];
  const context = withContractActions(kernel, action => {
    calls.push(structuredClone(action));
    if (throwError !== undefined) throw throwError;
    if (status === "done") {
      kernel.link("recall.calls", asValue(calls));
      const changed = mutateRecall(kernel, action);
      if (changed === null) return { status: "impossible", events: [] };
      const { object, from } = changed;
      const event = {
        type: "task-resolved", seq: calls.length, turnNumber: 1, activePlayerId: "A",
        taskId: `recall:${calls.length}`, sourceCardId: "test-capability", reason: "recall",
        autoResolved: true, timingPoint: "object-recalled", action: structuredClone(action),
        object: { ...object, location: from }, from, to: object.location,
      };
      return { status: "done", events: [event], receipt: { status: "committed", actions: [{ type: "recall", status: "done" }] } };
    }
    return { status, events: [] };
  });
  return { calls, context };
}

function withRecallCapability(kernel, { status = "done", throwError } = {}) {
  const calls = [];
  const perform = action => {
    calls.push(structuredClone(action));
    if (throwError !== undefined) throw throwError;
    if (status !== "done") return { status, events: [] };
    const changed = mutateRecall(kernel, action);
    if (changed === null) return { status: "impossible", events: [] };
    const { object, from } = changed;
    const event = {
      type: "task-resolved", seq: calls.length, turnNumber: 1, activePlayerId: "A",
      taskId: `recall:${calls.length}`, sourceCardId: "test-capability", reason: "recall",
      autoResolved: true, timingPoint: "object-recalled", action: structuredClone(action),
      object: { ...object, location: from }, from, to: object.location,
    };
    return { status: "done", events: [event], receipt: { status: "committed", actions: [{ type: "recall", status: "done" }] } };
  };
  return { calls, perform };
}

test("EG-RECALL moves a Board Permanent to its controller Base without a destination choice", () => {
  const kernel = scenario();
  const before = kernel.getObject("hero");
  const { calls, perform } = withRecallCapability(kernel);
  const run = runWithContractActions(move, recallArgs(), kernel, { targets: targets(kernel) }, perform);
  assert.equal(run.result.status, "executed");
  assert.deepEqual(calls, [{ type: "recall", object: before.ref, player: "A" }]);
  assert.deepEqual(run.events.map(event => event.action.type), ["recall"]);
  assert.deepEqual(kernel.getObject("hero"), { ...before, location: base("A") });
  assert.equal(kernel.history({ action: "move-location", object: before.ref }), 0);
  assert.deepEqual(run.linked.recalled, {
    count: 1,
    objects: [before.ref],
    movements: [{ object: before.ref, from: battlefield, to: base("A") }],
    mode: "recall",
  });
});

test("EG-RECALL preserves statuses and relocates only its bound selection", () => {
  const kernel = scenario();
  const anchor = kernel.getObject("anchor");
  const enemy = kernel.getObject("enemy");
  const { perform } = withRecallCapability(kernel);
  const run = runWithContractActions(move, recallArgs(), kernel, { targets: targets(kernel) }, perform);
  assert.equal(kernel.getObject("hero").exhausted, true);
  assert.equal(kernel.getObject("hero").damage, 2);
  assert.equal(kernel.getObject("hero").stunned, true);
  assert.equal(kernel.getObject("hero").buffs, 1);
  assert.deepEqual(kernel.getObject("anchor"), anchor);
  assert.deepEqual(kernel.getObject("enemy"), enemy);
  assert.deepEqual(run.result.linkedValues.recalled.count, 1);
});

test("EG-RECALL recalls an enemy unit to its current controller Base (B's Base)", () => {
  const kernel = scenario();
  const { calls, perform } = withRecallCapability(kernel);
  const run = runWithContractActions(move, recallArgs("controller-base"), kernel, {
    targets: { units: [kernel.ref("enemy")] },
  }, perform);
  assert.equal(run.result.status, "executed");
  assert.deepEqual(calls, [{ type: "recall", object: kernel.ref("enemy"), player: "B" }]);
  assert.deepEqual(kernel.getObject("enemy").location, base("B"));
  assert.deepEqual(run.linked.recalled.movements, [{ object: kernel.ref("enemy"), from: battlefield, to: base("B") }]);
});

test("EG-RECALL rejects an explicit destination that is not the object's controller Base", () => {
  for (const to of [{ type: "base", player: "B" }, second]) {
    const kernel = scenario();
    const before = kernel.stateForTest();
    const run = recallRun(kernel, to);
    assert.equal(run.result.status, "negated");
    assert.equal(run.result.reason, "impossible");
    assert.deepEqual(run.linked.recalled, { count: 0, objects: [], movements: [], mode: "recall" });
    assert.deepEqual(kernel.stateForTest(), before);
  }
});

test("EG-RECALL honors an explicit controller Base destination only for the matching controller", () => {
  const kernel = scenario();
  const { perform } = withRecallCapability(kernel);
  const run = runWithContractActions(move, recallArgs({ type: "base", player: "A" }), kernel, {
    targets: targets(kernel),
  }, perform);
  assert.equal(run.result.status, "executed");
  assert.deepEqual(kernel.getObject("hero").location, base("A"));
});

test("EG-RECALL ignores non-Board zones and non-permanent types", () => {
  const kernel = scenario();
  const spell = kernel.getObject("hero");
  spell.types = ["spell"];
  kernel.addObject(spell, "board");
  const before = kernel.stateForTest();
  const spellRun = runInstruction(move, recallArgs("controller-base"), {
    world: kernel, targets: { units: [kernel.ref("hero")] },
  });
  assert.equal(spellRun.result.status, "negated");
  assert.equal(spellRun.result.reason, "impossible");
  const staleRun = runInstruction(move, recallArgs("controller-base"), {
    world: kernel, targets: { units: [kernel.ref("kept")] },
  });
  assert.equal(staleRun.result.status, "ignored");
  assert.equal(staleRun.result.reason, "mistargeted");
  assert.deepEqual(kernel.stateForTest(), before);
  assert.equal(kernel.getObject("hero").types.includes("spell"), true);
  assert.equal(kernel.getObject("kept").zone, "hand");
});


test("EG-RECALL treats an object already at its controller Base as no recall outcome", () => {
  const kernel = withSource(world().unit("home", { location: base("A") }).build(), "home");
  const before = kernel.stateForTest();
  const run = runInstruction(move, recallArgs("controller-base"), {
    world: kernel, targets: { units: [kernel.ref("home")] },
  });
  assert.equal(run.result.status, "executed");
  assert.equal(run.events.length, 0);
  assert.deepEqual(run.linked.recalled, { count: 0, objects: [], movements: [], mode: "recall" });
  assert.deepEqual(kernel.stateForTest(), before);
});

test("EG-RECALL recalls a Gear permanent to its controller Base", () => {
  const kernel = withSource(world().unit("gear", { types: ["gear"], might: 2, damage: 1 }).build(), "gear");
  const { perform } = withRecallCapability(kernel);
  const run = runWithContractActions(move, recallArgs("controller-base"), kernel, {
    targets: { units: [kernel.ref("gear")] },
  }, perform);
  assert.equal(run.result.status, "executed");
  assert.deepEqual(kernel.getObject("gear").location, base("A"));
  assert.equal(kernel.getObject("gear").damage, 1);
  assert.deepEqual(run.linked.recalled.count, 1);
});

test("EG-RECALL zero amount performs no object choice, action or destination lookup", () => {
  const kernel = scenario();
  const before = kernel.stateForTest();
  const run = runInstruction(move, { ...recallArgs("controller-base"), amount: c(0) }, {
    world: kernel, targets: targets(kernel),
  });
  assert.equal(run.result.status, "executed");
  assert.equal(run.asked, null);
  assert.equal(run.events.length, 0);
  assert.deepEqual(run.linked.recalled, { count: 0, objects: [], movements: [], mode: "recall" });
  assert.deepEqual(kernel.stateForTest(), before);
});

test("EG-RECALL never chooses a Recall destination because Recall is not a Move (CR 457)", () => {
  const kernel = scenario();
  const before = kernel.stateForTest();
  assert.throws(() => runInstruction(move, recallArgs({ kind: "choose", id: "destination", options: [second] }), {
    world: kernel, targets: targets(kernel),
  }), /cannot choose a destination/);
  assert.deepEqual(kernel.stateForTest(), before);
});

test("EG-RECALL keeps Move restrictions on effect.move while Recall bypasses them (CR 458.3)", () => {
  const kernel = scenario();
  kernel.addContinuous({
    id: "restrict-hero", layer: "ability", source: kernel.ref("hero"), filter: {},
    effect: { kind: "movement", restrictions: ["cannot-move"] },
  }, "permanent");
  const layers = createLayerEngine(kernel.objects, kernel.continuousEffects);
  const restricted = queryMoveDestinations(kernel, [kernel.ref("hero")], {}, { registry: layers.registry });
  assert.deepEqual(restricted, []);
  const before = kernel.stateForTest();
  const { perform } = withRecallCapability(kernel);
  const recall = runWithContractActions(move, recallArgs("controller-base"), kernel, {
    targets: targets(kernel),
  }, perform);
  assert.equal(recall.result.status, "executed");
  assert.deepEqual(kernel.getObject("hero").location, base("A"));
});


test("EG-RECALL swap executes one atomic action with receipts and unchanged zone entries", () => {
  const kernel = scenario();
  const a = kernel.getObject("hero");
  const b = kernel.getObject("anchor");
  const run = runInstruction(swap, { objects: c([{ target: "a" }, { target: "b" }]) }, {
    world: kernel, targets: { a: [kernel.ref("hero")], b: [kernel.ref("anchor")] },
  });
  assert.equal(run.result.status, "executed");
  assert.equal(run.events.length, 2);
  assert.deepEqual(run.events.map(event => event.action), ["move-location", "move-location"]);
  assert.deepEqual(kernel.getObject("hero").location, second);
  assert.deepEqual(kernel.getObject("anchor").location, battlefield);
  assert.equal(kernel.getObject("hero").ref.zoneEntryId, a.ref.zoneEntryId);
  assert.equal(kernel.getObject("anchor").ref.zoneEntryId, b.ref.zoneEntryId);
  assert.equal(kernel.getObject("hero").damage, 2);
  assert.deepEqual(run.linked.swapped, {
    count: 2,
    objects: [a.ref, b.ref],
    movements: [
      { object: a.ref, from: battlefield, to: second },
      { object: b.ref, from: second, to: battlefield },
    ],
  });
  assert.equal(kernel.history({ action: "move-location", object: a.ref }), 1);
  assert.equal(kernel.history({ action: "move-location", object: b.ref }), 1);
});

test("EG-RECALL swap of same-location objects performs no action", () => {
  const kernel = scenario();
  const a = kernel.getObject("hero");
  const b = kernel.getObject("anchor");
  kernel.addObject({ ...b, location: battlefield }, "board");
  const before = kernel.stateForTest();
  const run = runInstruction(swap, { objects: c([{ target: "a" }, { target: "b" }]) }, {
    world: kernel, targets: { a: [kernel.ref("hero")], b: [kernel.ref("anchor")] },
  });
  assert.equal(run.result.status, "executed");
  assert.equal(run.events.length, 0);
  assert.deepEqual(run.linked.swapped, { count: 0, objects: [a.ref, b.ref], movements: [] });
  assert.deepEqual(kernel.stateForTest(), before);
});

test("EG-RECALL swap rejects two references to the same object", () => {
  const kernel = scenario();
  const a = kernel.getObject("hero");
  const before = kernel.stateForTest();
  assert.throws(() => runInstruction(swap, { objects: c([{ target: "a" }, { target: "b" }]) }, {
    world: kernel, targets: { a: [kernel.ref("hero")], b: [kernel.ref("hero")] },
  }), /two distinct objects/);
  assert.deepEqual(kernel.stateForTest(), before);
});

test("EG-RECALL swap rejects selector lists whose length is not exactly two", () => {
  const kernel = scenario();
  for (const objects of [[{ target: "a" }], [{ target: "a" }, { target: "b" }, { target: "hero" }], [{ id: "a", zoneEntryId: 1 }, { id: "b", zoneEntryId: 1 }]]) {
    assert.throws(() => runInstruction(swap, { objects: c(objects) }, {
      world: kernel, targets: { a: [kernel.ref("hero")], b: [kernel.ref("anchor")] },
    }), TypeError);
  }
});

test("EG-RECALL swap negates impossible destinations before committing either relocation", () => {
  const kernel = scenario();
  // CR 451.2 needs two other controllers represented: A's mover is bound to
  // second, which already holds B's anchor; C's units make that destination
  // held by two players other than the mover.
  kernel.addPlayer("C", {});
  const enemy = kernel.getObject("enemy");
  kernel.addObject({ ...enemy, ref: { id: "raider", zoneEntryId: 1 }, location: second }, "board");
  kernel.addObject({ ...enemy, ref: { id: "neutral", zoneEntryId: 1 }, owner: "C", controller: "C", location: second }, "board");
  const hero = kernel.getObject("hero");
  const anchor = kernel.getObject("anchor");
  const before = kernel.stateForTest();
  const run = runInstruction(swap, { objects: c([{ target: "a" }, { target: "b" }]) }, {
    world: kernel,
    targets: { a: [kernel.ref("hero")], b: [kernel.ref("anchor")] },
  });
  assert.equal(run.result.status, "negated");
  assert.equal(run.result.reason, "impossible");
  assert.deepEqual(kernel.stateForTest(), before);
  assert.deepEqual(kernel.getObject("hero").location, hero.location);
  assert.deepEqual(kernel.getObject("anchor").location, anchor.location);
});


test("EG-RECALL swap rolls back the first relocation when the second is prevented", () => {
  const kernel = scenario();
  const hero = kernel.getObject("hero");
  const anchor = kernel.getObject("anchor");
  const before = kernel.stateForTest();
  kernel.addReplacement(action => action.type === "move-location" && action.object.id === "anchor" ? "prevented" : null);
  assert.throws(() => runInstruction(swap, { objects: c([{ target: "a" }, { target: "b" }]) }, {
    world: kernel, targets: { a: [kernel.ref("hero")], b: [kernel.ref("anchor")] },
  }), /rolling back/);
  assert.deepEqual(kernel.getObject("hero"), hero);
  assert.deepEqual(kernel.getObject("anchor"), anchor);
  assert.deepEqual(kernel.stateForTest(), before);
});

test("EG-RECALL swap rolls back the whole transaction in the production ChainEngine when the second relocation fails", () => {
  // resolveChainBody has no transaction; ChainEngine.resolve is the
  // production path whose atomic rollback turns the prevented second leg
  // into an error for the whole instruction.
  const program = cardProgram("test:swap-rollback", [{
    id: "swap", op: "effect.swap-location",
    args: { objects: c([{ target: "a" }, { target: "b" }]) },
    targets: [
      { id: "a", filter: { objectId: "a" }, min: 1, max: 1 },
      { id: "b", filter: { objectId: "b" }, min: 1, max: 1 },
    ],
  }]);
  const f = programFixture({
    programs: [program], energy: { A: 0 }, power: { A: [] },
    setup(builder) {
      builder.hand("spell", { cardId: program.canonicalCardId, types: ["spell"], energy: 0, power: [] });
      builder.unit("a", { location: battlefield });
      builder.unit("b", { location: second });
    },
  });
  f.kernel.addReplacement(action => action.type === "move-location" && action.object.id === "b" ? "prevented" : null);
  f.play("spell");
  assert.throws(() => {
    f.engine.pass("A");
    f.engine.pass("B");
  }, /rolling back/);
  assert.deepEqual(f.get("a").location, battlefield);
  assert.deepEqual(f.get("b").location, second);
});

test("EG-RECALL swap invalid destination in production rejects the whole instruction before any relocation", () => {
  const kernel = world()
    .unit("a", { location: battlefield })
    .unit("b", { location: second })
    .unit("c", { location: contested })
    .build();
  // Same CR 451.2 shape as the primitive case above: B's and C's units hold
  // b's origin, so A's mover cannot enter the swap's first destination.
  kernel.addPlayer("C", {});
  const enemy = kernel.getObject("b");
  kernel.addObject({ ...enemy, ref: { id: "raider", zoneEntryId: 1 }, owner: "B", controller: "B", location: second }, "board");
  kernel.addObject({ ...enemy, ref: { id: "neutral", zoneEntryId: 1 }, owner: "C", controller: "C", location: second }, "board");
  const source = kernel.getObject("a");
  const before = kernel.stateForTest();
  const outcome = resolveChainBody([{ id: "swap", op: "effect.swap-location", args: { objects: c([{ target: "a" }, { target: "b" }]) } }],
    kernel.clone({ sourceSnapshot: source, targets: new Map([["a", [kernel.ref("a")]], ["b", [kernel.ref("b")]]]) }));
  assert.equal(outcome.results[0].result.status, "negated");
  assert.equal(outcome.results[0].result.reason, "impossible");
  assert.deepEqual(outcome.linkedValues.swap, undefined);
  assert.deepEqual(kernel.stateForTest(), before);
});


test("EG-RECALL runs the original Conscription recall instruction through the default production assembly", () => {
  const ability = conscription.abilities.find(item => item.kind === "play");
  const recall = ability.body[2];
  const { linkedTo, ...standalone } = recall;
  assert.equal(recall.op, "effect.move");
  assert.equal(recall.args.mode.value, "recall");
  assert.deepEqual(recall.args.to, c("controller-base"));
  // The printed target lives on the take-control instruction; this stripped
  // fixture exercises only the recall leg, without changing the original IR.
  // The card's mightLte restriction stays judge-required and is not faked.
  assert.equal(recall.targets, undefined);
  standalone.targets = [{
    id: "conscription.enemy-unit",
    filter: { type: "unit", zone: "board", controller: "opponent", location: "battlefield" },
    min: 1, max: 1,
  }];
  const program = cardProgram("test:recall-conscription", [standalone]);
  const f = programFixture({
    programs: [program], energy: { A: 5 }, power: { A: [] },
    answers: { "target:conscription.enemy-unit": ["stolen"] },
    setup(builder) {
      builder.hand("spell", { cardId: program.canonicalCardId, types: ["spell"], energy: 0, power: [] });
      builder.unit("stolen", { owner: "B" });
    },
  });
  f.play("spell");
  f.engine.pass("A");
  f.engine.pass("B");
  assert.deepEqual(f.get("stolen").location, base("B"));
  assert.equal(f.engine.pipeline.events.filter(event => event.timingPoint === "object-moved").length, 1);
  assert.equal(f.errors.length, 0);
});

test("EG-RECALL runs the original Glowstone recall instruction through the default production assembly", () => {
  const ability = glowstone.abilities.find(item => item.kind === "activated");
  const recall = ability.body[1];
  const { linkedTo, ...standalone } = recall;
  assert.equal(recall.op, "effect.move");
  assert.equal(recall.args.objects.value, "source");
  assert.equal(recall.args.to.value, "controller-base");
  assert.equal(recall.args.mode.value, "recall");
  assert.equal(standalone.args.objects.value, "source");
  // The printed cost includes unbound disempower and a chained give-control
  // leg; the fixture keeps only the real exhaust payment so it can drive the
  // untouched recall instruction, while those unsupported parts remain
  // judge-required on the card and are not faked.
  const program = cardProgram("test:recall-glowstone", [], [{
    kind: "activated", timing: "action",
    cost: { kind: "activated", payments: [{ kind: "exhaust", object: "self" }] },
    body: [standalone],
  }]);
  const f = programFixture({
    programs: [program], energy: { A: 0 }, power: { A: [] },
    setup(builder) {
      builder.unit("glow", { cardId: program.canonicalCardId, energy: 0, power: [] });
    },
  });
  f.activate("glow");
  f.engine.pass("A");
  f.engine.pass("B");
  assert.deepEqual(f.get("glow").location, base("A"));
  assert.equal(f.engine.pipeline.events.filter(event => event.timingPoint === "object-moved").length, 1);
  assert.equal(f.errors.length, 0);
});

test("EG-RECALL runs the original Smoke and Mirrors swap instruction through the default production assembly", () => {
  const ability = smokeAndMirrors.abilities.find(item => item.kind === "play");
  const swap = ability.body[0];
  const { condition, ...standalone } = swap;
  assert.equal(swap.op, "effect.swap-location");
  assert.deepEqual(swap.args.objects.value, [{ target: "smoke-and-mirrors.unit-a" }, { target: "smoke-and-mirrors.unit-b" }]);
  // The printed unit-b filter uses exclude/locationRelation, which the current
  // TargetPlan contract does not consume; those unsupported relationship fields
  // remain judge-required and are not faked. The fixture's separate locked
  // answers select the same printed pair for this execution evidence without
  // changing the original targets.
  standalone.targets = swap.targets.map(target => target.id === "smoke-and-mirrors.unit-b"
    ? { ...target, filter: { zone: "board", type: "unit", controller: "controller" } }
    : { ...target });
  const program = cardProgram("test:swap-smoke-and-mirrors", [standalone]);
  const f = programFixture({
    programs: [program], energy: { A: 5 }, power: { A: [] },
    answers: { "target:smoke-and-mirrors.unit-a": ["one"], "target:smoke-and-mirrors.unit-b": ["two"] },
    setup(builder) {
      builder.hand("spell", { cardId: program.canonicalCardId, types: ["spell"], energy: 0, power: [] });
      builder.unit("one");
      builder.unit("two", { location: second });
      builder.object("destination", { types: ["battlefield"], energy: null, power: null });
    },
  });
  f.play("spell");
  f.engine.pass("A");
  f.engine.pass("B");
  assert.deepEqual(f.get("one").location, second);
  assert.deepEqual(f.get("two").location, battlefield);
  assert.equal(f.engine.pipeline.events.filter(event => event.timingPoint === "object-moved").length, 2);
  assert.equal(f.errors.length, 0);
});

