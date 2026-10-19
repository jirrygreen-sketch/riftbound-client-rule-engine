import assert from "node:assert/strict";
import test from "node:test";

import move from "../../dist/effects/instructions/effect.move.js";
import swap from "../../dist/effects/instructions/effect.swap-location.js";
import { resolveChainBody } from "../../dist/chain/interpreter-adapter.js";
import { queryMoveDestinations } from "../../dist/target/location/candidates.js";
import { createLayerEngine } from "../../dist/layers/engine.js";
import { cardProgram, fixture as programFixture, settle } from "../rules/keywords/support.mjs";
import { runInstruction, world } from "../../dist/effects/testing/index.js";
import { bindResolveContext } from "../../dist/events/action-adapter.js";
import { createContractActionCapability } from "../../dist/events/contract-actions/bridge.js";
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

test("EG-RECALL moves a Board Permanent to its controller Base without a destination choice", () => {
  const kernel = scenario();
  const before = kernel.getObject("hero");
  const run = runInstruction(move, recallArgs(), { world: kernel, targets: targets(kernel) });
  assert.equal(run.result.status, "executed");
  assert.deepEqual(run.linked.recalled.receipt.actions, [{ type: "recall", status: "done" }]);
  assert.equal(run.events.length, 1);
  assert.equal(run.events[0].details.recall, true);
  assert.deepEqual(run.events[0].details.from, battlefield);
  assert.deepEqual(run.events[0].details.to, base("A"));
  assert.deepEqual(kernel.getObject("hero"), { ...before, location: base("A") });
  assert.equal(kernel.history({ action: "move-location", object: before.ref }), 0);
  assert.deepEqual(run.linked.recalled, {
    count: 1,
    objects: [before.ref],
    movements: [{ object: before.ref, from: battlefield, to: base("A") }],
    mode: "recall",
    receipt: { status: "committed", actions: [{ type: "recall", status: "done" }] },
  });
});

test("EG-RECALL preserves statuses and relocates only its bound selection", () => {
  const kernel = scenario();
  const anchor = kernel.getObject("anchor");
  const enemy = kernel.getObject("enemy");
  const run = runInstruction(move, recallArgs(), { world: kernel, targets: targets(kernel) });
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
  const run = runInstruction(move, recallArgs("controller-base"), {
    world: kernel, targets: { units: [kernel.ref("enemy")] },
  });
  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.recalled.receipt.actions[0].type, "recall");
  assert.deepEqual(kernel.getObject("enemy").location, base("B"));
  assert.deepEqual(run.linked.recalled.movements, [{ object: kernel.ref("enemy"), from: battlefield, to: base("B") }]);
});

test("EG-RECALL rejects an explicit destination that is not the object's controller Base", () => {
  for (const to of [{ type: "base", player: "B" }, second]) {
    const kernel = scenario();
    const before = kernel.stateForTest();
    const run = runInstruction(move, recallArgs(to), { world: kernel, targets: targets(kernel) });
    assert.equal(run.result.status, "negated");
    assert.equal(run.result.reason, "impossible");
    assert.deepEqual(run.linked.recalled, { count: 0, objects: [], movements: [], mode: "recall" });
    assert.deepEqual(kernel.stateForTest(), before);
  }
});

test("EG-RECALL honors an explicit controller Base destination only for the matching controller", () => {
  const kernel = scenario();
  const run = runInstruction(move, recallArgs({ type: "base", player: "A" }), {
    world: kernel, targets: targets(kernel),
  });
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
  const run = runInstruction(move, recallArgs("controller-base"), {
    world: kernel, targets: { units: [kernel.ref("gear")] },
  });
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
  }, { type: "permanent" });
  const layers = createLayerEngine(kernel.objects, kernel.continuousEffects);
  const restricted = queryMoveDestinations(kernel, [kernel.ref("hero")], {}, { registry: layers.registry });
  assert.deepEqual(restricted, []);
  const target = kernel.clone();
  target.setTargets("units", [target.ref("hero")]);
  const context = bindResolveContext(target, {
    object: ref => layers.evaluate(ref),
    layers: { registry: layers.registry },
    contractActions: createContractActionCapability(action => target.performContract(action)),
  });
  const blockedMove = {
    result: move.execute(context, move.argsSchema.parse({ objects: c({ target: "units" }), to: c(second) })),
  };
  kernel.restore(target.snapshot());
  assert.equal(blockedMove.result.status, "negated");
  assert.equal(blockedMove.result.reason, "impossible");
  assert.deepEqual(blockedMove.result.events, []);
  assert.deepEqual(kernel.getObject("hero").location, battlefield);
  const recall = runInstruction(move, recallArgs("controller-base"), {
    world: kernel, targets: targets(kernel),
  });
  assert.equal(recall.result.status, "executed");
  assert.equal(recall.events.length, 1);
  assert.equal(recall.events[0].details.recall, true);
  assert.equal(kernel.history({ action: "recall", object: kernel.ref("hero") }), 1);
  assert.equal(kernel.history({ action: "move-location", object: kernel.ref("hero") }), 0);
  assert.deepEqual(kernel.getObject("hero").location, base("A"));
});


test("EG-RECALL swap executes one atomic action with receipts and unchanged zone entries", () => {
  const kernel = scenario();
  const a = kernel.getObject("hero");
  const b = kernel.getObject("anchor");
  const run = runInstruction(swap, { objects: c([{ target: "a" }, { target: "b" }]) }, {
    world: kernel,
    targets: { a: [kernel.ref("hero")], b: [kernel.ref("anchor")] },
  });
  assert.equal(run.result.status, "executed");
  assert.deepEqual(kernel.getObject("hero").location, second);
  assert.deepEqual(kernel.getObject("anchor").location, battlefield);
  assert.equal(kernel.getObject("hero").ref.zoneEntryId, a.ref.zoneEntryId);
  assert.equal(kernel.getObject("anchor").ref.zoneEntryId, b.ref.zoneEntryId);
  assert.equal(kernel.getObject("hero").damage, 2);
  assert.equal(run.linked.swapped.status, "committed");
  assert.equal(run.linked.swapped.count, 2);
  assert.equal(run.linked.swapped.actionReceipt.status, "committed");
  assert.equal(kernel.history({ action: "move-location", object: a.ref }), 2);
  assert.equal(kernel.history({ action: "move-location", object: b.ref }), 2);
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
  const run = runInstruction(swap, { objects: c([{ target: "a" }, { target: "b" }]) }, {
    world: kernel, targets: { a: [kernel.ref("hero")], b: [kernel.ref("anchor")] },
  });
  assert.equal(run.result.status, "negated");
  assert.equal(run.result.reason, "skipped");
  assert.deepEqual(kernel.getObject("hero"), hero);
  assert.deepEqual(kernel.getObject("anchor"), anchor);
  assert.deepEqual(kernel.stateForTest(), before);
});

for (const behavior of ["first-rewrite", "first-prevent", "first-replace", "second-rewrite", "second-prevent", "throw"]) {
  test("EG-RECALL swap never reports committed for batch behavior " + behavior, () => {
    const kernel = scenario();
    const a = kernel.getObject("hero");
    const b = kernel.getObject("anchor");
    const before = kernel.stateForTest();
    kernel.addReplacement(action => {
      if (action.type !== "move-location") return null;
      const target = behavior.startsWith("first") ? "hero" : "anchor";
      if (action.object.id !== target) return null;
      if (behavior === "throw") throw new Error("batch leaf failed");
      if (behavior.endsWith("rewrite")) {
        const current = kernel.getObject(action.object.id).location;
        return { status: "rewrite", action: { ...action, to: current } };
      }
      if (behavior.endsWith("replace")) return "replaced";
      return "prevented";
    });
    const run = runInstruction(swap, { objects: c([{ target: "a" }, { target: "b" }]) }, {
      world: kernel, targets: { a: [kernel.ref("hero")], b: [kernel.ref("anchor")] },
    });
    assert.equal(run.result.status, "negated");
    assert.notEqual(run.result.reason, "executed");
    assert.deepEqual(kernel.getObject("hero"), a);
    assert.deepEqual(kernel.getObject("anchor"), b);
    assert.deepEqual(kernel.stateForTest(), before);
  });
}

test("EG-RECALL swap rolls back the whole transaction in the production ChainEngine when the second relocation fails", () => {
  // The default production context has no BatchAction consumer. The primitive
  // must return a blocked receipt without any relocation or Move observation.
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
  f.play("spell");
  f.engine.pass("A");
  f.engine.pass("B");
  assert.deepEqual(f.get("a").location, battlefield);
  assert.deepEqual(f.get("b").location, second);
  assert.equal(f.engine.pipeline.events.filter(event => event.timingPoint === "object-moved").length, 0);
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


test("EG-RECALL keeps the complete original Conscription body fail-closed at the default Recall bridge", () => {
  const ability = conscription.abilities.find(item => item.kind === "play");
  const recall = ability.body[2];
  assert.equal(recall.op, "effect.move");
  assert.equal(recall.args.mode.value, "recall");
  assert.deepEqual(recall.args.to, c("controller-base"));
  // Keep the complete printed body and target/link relationships. The legal
  // enemy target reaches Finalize, control and exhaust execute, and the default
  // Chain boundary then refuses the Recall rather than substituting a Move.
  const program = cardProgram("test:recall-conscription", ability.body);
  const f = programFixture({
    programs: [program], energy: { A: 5 }, power: { A: [] },
    setup(builder) {
      builder.hand("spell", { cardId: program.canonicalCardId, types: ["spell"], energy: 0, power: [] });
      builder.unit("enemy", { owner: "B", controller: "B", might: 2 });
    },
  });
  f.play("spell");
  assert.deepEqual(f.asked.map(request => request.id), ["target:conscription.enemy-unit"]);
  assert.deepEqual(f.asked[0].options, [f.ref("enemy")]);
  settle(f.engine);
  assert.deepEqual(f.get("enemy").ref, { id: "enemy", zoneEntryId: 1 });
  assert.equal(f.get("enemy").controller, "A");
  assert.equal(f.get("enemy").exhausted, true);
  assert.deepEqual(f.get("enemy").location, battlefield);
  assert.match(
    String(f.kernel.linked("conscription.recall.recalled")?.blockedReason ?? ""),
    /RecallAction consumer unavailable/,
  );
  assert.equal(f.engine.pipeline.events.filter(event => event.timingPoint === "object-moved").length, 0);
  assert.equal(f.kernel.history({ action: "move-location" }), 0);
  assert.equal(f.kernel.history({ action: "recall" }), 0);
});

test("EG-RECALL runs the original Glowstone recall instruction through the default production assembly", () => {
  const ability = glowstone.abilities.find(item => item.kind === "activated");
  const recall = ability.body[1];
  assert.equal(recall.op, "effect.move");
  assert.equal(recall.args.objects.value, "source");
  assert.equal(recall.args.to.value, "controller-base");
  assert.equal(recall.args.mode.value, "recall");
  // Keep the complete activated ability and its printed Disempower cost.
  const program = { ...glowstone, abilities: [ability] };
  const f = programFixture({
    programs: [program], energy: { A: 0 }, power: { A: [] },
    setup(builder) { builder.unit("glow", { cardId: program.canonicalCardId, energy: 0, power: [] }); },
  });
  assert.throws(() => f.activate("glow"), /Unsupported payment kind|disempower/i);
  assert.deepEqual(f.get("glow").location, battlefield);
  assert.equal(f.engine.pipeline.events.filter(event => event.timingPoint === "object-moved").length, 0);
});

test("EG-RECALL keeps the complete original Smoke and Mirrors body fail-closed before a partial swap", () => {
  const ability = smokeAndMirrors.abilities.find(item => item.kind === "play");
  const swap = ability.body[0];
  assert.equal(swap.op, "effect.swap-location");
  assert.deepEqual(swap.args.objects.value, [{ target: "smoke-and-mirrors.unit-a" }, { target: "smoke-and-mirrors.unit-b" }]);
  // Keep the complete printed body and its exclude/locationRelation targets.
  // RIFT-853 normalizes the relation, so this full-body admission reaches the
  // default TargetPlan. That plan still lacks the prior selected-target binding
  // required to evaluate the cross-target relationship and fails closed.
  const program = cardProgram("test:swap-smoke-and-mirrors", ability.body);
  const f = programFixture({
    programs: [program], energy: { A: 5 }, power: { A: [] },
    answers: { "target:smoke-and-mirrors.unit-a": ["one"] },
    setup(builder) {
      builder.hand("spell", { cardId: program.canonicalCardId, types: ["spell"], energy: 0, power: [] });
      builder.unit("one");
      builder.unit("two", { location: second });
      builder.object("destination", { types: ["battlefield"], energy: null, power: null });
    },
  });
  assert.throws(() => f.play("spell"), error =>
    error?.name === "TargetSelectionError" && error.code === "no-legal-targets" &&
    error.message === "The required target count is not available");
  assert.deepEqual(f.asked.map(request => request.id), ["target:smoke-and-mirrors.unit-a"]);
  assert.deepEqual(f.asked[0].options, [f.ref("one"), f.ref("two")]);
  assert.deepEqual(f.get("one").location, battlefield);
  assert.deepEqual(f.get("two").location, second);
  assert.equal(f.kernel.history({ action: "move-location" }), 0);
  assert.equal(f.engine.pipeline.events.filter(event => event.timingPoint === "object-moved").length, 0);
});

