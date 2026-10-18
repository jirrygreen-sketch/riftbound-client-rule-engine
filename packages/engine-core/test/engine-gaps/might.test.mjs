import assert from "node:assert/strict";
import test from "node:test";

import { AwaitChoice } from "../../dist/effects/contract.js";
import { world } from "../../dist/effects/testing/test-kernel.js";
import { ChainEngine } from "../../dist/chain/engine.js";
import { TurnFlow } from "../../dist/turn/flow.js";
import { bindResolveContext, createActionPipelineHost } from "../../dist/events/action-adapter.js";
import { createProgramBinding, translateInstructionTargets } from "../../dist/programs/index.js";
import { instructionDefinitionsById } from "../../dist/effects/instructions/registry.generated.js";
import herald from "../../../card-dsl/dist/cards/rad/herald-of-the-emperor.js";
import switcheroo from "../../../card-dsl/dist/cards/sfd/switcheroo.js";
import dragonForm from "../../../card-dsl/dist/cards/ven/dragon-form.js";

const c = value => ({ kind: "constant", value });
const at = id => ({ type: "battlefield", id });
// Test-only admission changes metadata, never the original ability/target IR.
// Independent whole-card judge gates remain on the checked-in card programs.
const admitted = program => ({ ...program, status: "executable", judgeReason: undefined });

function runtime(builder, programs = [], withTurn = false) {
  const kernel = builder.build();
  const answers = new Map();
  const requests = [];
  const choose = request => {
    requests.push(request);
    if (answers.has(request.id)) {
      const answer = answers.get(request.id);
      return Array.isArray(answer) ? answer.map(id => typeof id === "string" ? kernel.ref(id) : id) : answer;
    }
    if (request.type === "select-objects" && request.min === request.max && request.options.length === request.min) {
      return [...request.options];
    }
    throw new AwaitChoice(request);
  };
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: saved => { kernel.restore(saved.state); kernel.copyLinkedFrom(saved.links); },
    objects: () => kernel.objects,
    perform: action => kernel.perform(action),
    choose,
    context: (source, controller, timingPoint) => bindResolveContext(kernel, { source, controller, timingPoint, choose }),
  });
  const binding = createProgramBinding({ cardPrograms: programs.map(admitted) });
  const flow = withTurn ? new TurnFlow({ host, player: id => kernel.player(id), turnOrder: ["A", "B"],
    battlefields: [{ id: "one", controller: "A" }, { id: "two", controller: "A" }], describePlay: binding.describePlay }) : undefined;
  const engine = flow?.chain ?? new ChainEngine({ host, turnOrder: ["A", "B"], turnPlayer: "A", phase: "main", describePlay: binding.describePlay,
    cleanup: current => {
      current.layers.setObjects(kernel.objects);
      let changed = false;
      for (const object of current.layers.evaluateAll()) {
        if (object.zone !== "board" || !object.types.includes("unit") || object.might === null ||
            object.might > 0 && object.damage < object.might) continue;
        assert.equal(current.commit({ type: "kill", object: object.ref }).status, "done");
        changed = true;
      }
      return changed;
    } });
  binding.attachLifecycle(engine, error => {
    // Unregistered setup objects have no authored abilities. Known programs
    // must bind through the default production lifecycle without a stub binder.
    if (error.code !== "unknown-program") throw error;
  });
  const snapshot = id => { engine.layers.setObjects(kernel.objects); return engine.layers.snapshot(kernel.ref(id)); };
  const play = id => engine.execute(binding.describePlay({ type: "play", object: kernel.ref(id), player: "A" }, kernel.getObject(id)));
  return { kernel, engine, flow, binding, answers, requests, snapshot, play };
}

function settle(engine) {
  engine.advance();
  for (let attempts = 0; engine.items.length; attempts++) {
    assert.ok(attempts < 30, "resolves through actual priority passes");
    engine.pass(engine.priority);
  }
}

function activate(f, id, body, source = "caster") {
  f.engine.advance();
  f.engine.execute({ id, source: f.kernel.getObject(source), controller: "A", kind: "activated", speed: "action", body });
  settle(f.engine);
}

function change(id, target, amount, extra = {}, op = "continuous.might") {
  return { id, op, args: { amount: c(amount), duration: c("this-turn"),
    objects: c({ kind: "query", filter: { objectId: target, zone: "board" } }), ...extra } };
}

function heraldRuntime() {
  const f = runtime(world().player("A", { energy: 5, power: [] })
    .unit("caster", { might: 2, energy: null, power: null })
    .unit("friend", { might: 3, energy: null, power: null })
    .unit("enemy", { owner: "B", might: 4 })
    .hand("herald", { cardId: herald.canonicalCardId, types: ["unit"], might: 3, energy: 5, power: null }), [herald]);
  f.answers.set("target:herald.friendly-unit", ["friend"]);
  return f;
}

function swapRuntime(left = 3, right = 7, withTurn = false) {
  const f = runtime(world().player("A", { energy: withTurn ? 0 : 2, power: withTurn ? [] : ["Chaos", "Chaos"] }).player("B")
    .unit("caster", { might: 2, energy: null, power: null, location: { type: "base", player: "A" } })
    .unit("left", { might: left, location: at("one"), energy: null, power: null })
    .unit("right", { owner: withTurn ? "A" : "B", might: right, location: at("one"), energy: null, power: null })
    .unit("alternative", { might: 4, location: at("one") })
    .unit("elsewhere", { might: 5, location: at("two") })
    .hand("swap", { cardId: switcheroo.canonicalCardId, types: ["spell"], energy: 2, power: ["Chaos"] })
    .deck(["a-draw-1", "a-draw-2"]).deck(["b-draw-1", "b-draw-2"], { owner: "B" }), [switcheroo], withTurn);
  f.answers.set("target:switcheroo.first-unit", ["left"]);
  f.answers.set("target:switcheroo.second-unit", ["right"]);
  return f;
}

test("Base Might registers in the default registry and accepts both existing numeric spellings", () => {
  const definition = instructionDefinitionsById.get("continuous.base-might");
  assert.equal(definition.op, "continuous.base-might");
  for (const args of [{ amount: 0 }, { value: c(5) }, { amount: c(-1), duration: c("this-turn") }]) {
    assert.equal(definition.argsSchema.safeParse(args).success, true);
  }
  for (const args of [{ amount: null }, { value: 1.5 }, { amount: 2, value: 3 }]) {
    assert.equal(definition.argsSchema.safeParse(args).success, false);
  }
});

test("original Herald play pays five Energy and sets Base Might before an earlier arithmetic grant", () => {
  const f = heraldRuntime();
  activate(f, "earlier-grant", [change("plus-two", "friend", 2)]);
  assert.equal(f.snapshot("friend").might, 5);
  f.play("herald");
  settle(f.engine);
  const snapshot = f.snapshot("friend");
  assert.equal(snapshot.might, 7, "trait 5, then arithmetic +2, irrespective of timestamp");
  assert.equal(snapshot.printed.might, 3);
  assert.equal(snapshot.energy, null);
  assert.equal(snapshot.power, null);
  assert.equal(f.kernel.getObject("friend").might, 3);
  assert.equal(f.kernel.player("A").energy, 0);
  assert.equal(f.kernel.getObject("herald").zone, "board");
  const entry = f.engine.layers.registry.snapshot().find(entry => entry.effect.layer === "trait");
  assert.equal(entry.effect.effect.kind, "continuous.base-might");
  assert.deepEqual(entry.duration, { type: "end-of-turn" });
  assert.equal(f.kernel.linked("herald.set-base-might.affected.count"), 1);
  assert.equal(f.engine.pipeline.events.filter(event => event.timingPoint === "became-target").length, 1);
  assert.equal(herald.status, "judge-required");
});

test("original Herald rejects an enemy target and rolls back the play and payment", () => {
  const f = heraldRuntime();
  f.answers.set("target:herald.friendly-unit", ["enemy"]);
  const before = f.kernel.snapshot();
  assert.throws(() => f.play("herald"), /selection|candidate|target/i);
  assert.deepEqual(f.kernel.snapshot(), before);
  assert.equal(f.engine.layers.registry.snapshot().length, 0);
  assert.equal(f.engine.items.length, 0);
});

test("original Herald's finalized target can leave before resolution without a Base Might effect", () => {
  const f = heraldRuntime();
  f.play("herald");
  assert.equal(f.engine.items.length, 1);
  assert.equal(f.engine.commit({ type: "kill", object: f.kernel.ref("friend") }).status, "done");
  settle(f.engine);
  assert.equal(f.kernel.getObject("friend").zone, "trash");
  assert.equal(f.engine.layers.registry.snapshot().length, 0);
  assert.equal(f.snapshot("herald").might, 3);
});

test("a Base Might registration cannot follow a unit into its next zone incarnation", () => {
  const f = heraldRuntime();
  f.play("herald");
  settle(f.engine);
  const oldRef = f.kernel.ref("friend");
  assert.equal(f.snapshot("friend").might, 5);
  assert.equal(f.engine.commit({ type: "return-to-hand", object: oldRef }).status, "done");
  assert.equal(f.engine.commit({ type: "move-zone", object: f.kernel.ref("friend"), to: "base", location: { type: "base", player: "A" } }).status, "done");
  assert.notDeepEqual(f.kernel.ref("friend"), oldRef);
  assert.equal(f.snapshot("friend").might, 3);
});

test("Dragon Form's original value expression supplies a Base Might number without replacing printed null costs", () => {
  const f = runtime(world().unit("caster").unit("friend", { might: 2, energy: null, power: null }));
  // Exercise the original value Expr; explicit selection belongs to this
  // primitive scenario, since this card's original instruction omits its target arg.
  const value = dragonForm.abilities.find(ability => ability.kind === "play").body[0].args.value;
  activate(f, "value-alias", [{ id: "base", op: "continuous.base-might", args: {
    value, target: c("unit"), duration: c("this-turn") },
    targets: [{ id: "unit", filter: { type: "unit", objectId: "friend", zone: "board" }, min: 1, max: 1, selection: "one" }] }]);
  assert.equal(f.snapshot("friend").might, 5);
  assert.equal(f.snapshot("friend").energy, null);
  assert.equal(f.snapshot("friend").power, null);
});

test("original Switcheroo swaps both current Mights through play, Finalize, payment and default dispatch", () => {
  const f = swapRuntime();
  f.play("swap");
  settle(f.engine);
  assert.equal(f.snapshot("left").might, 7);
  assert.equal(f.snapshot("right").might, 3);
  assert.equal(f.kernel.getObject("swap").zone, "trash");
  assert.equal(f.kernel.player("A").energy, 0);
  assert.deepEqual(f.kernel.player("A").power, []);
  const entries = f.engine.layers.registry.snapshot();
  assert.deepEqual(entries.map(entry => entry.effect.layer), ["arithmetic", "arithmetic"]);
  assert.deepEqual(entries.map(entry => entry.effect.effect.amount), [4, -4]);
  assert.equal(f.kernel.linked("switcheroo.swap-might.affected.count"), 2);
  assert.equal(f.engine.pipeline.events.filter(event => event.timingPoint === "became-target").length, 2);
  activate(f, "later-base", [change("new-base", "left", 5, {}, "continuous.base-might")]);
  activate(f, "later-increase", [change("plus-two", "right", 2)]);
  assert.equal(f.snapshot("left").might, 9, "base 5 plus the remembered +4");
  assert.equal(f.snapshot("right").might, 5, "base 7 plus 2 minus the remembered 4");
  assert.equal(f.snapshot("left").printed.might, 3);
  assert.equal(f.snapshot("right").printed.might, 7);
  assert.equal(f.snapshot("left").power, null);
  assert.equal(switcheroo.status, "judge-required");
});

test("Swap snapshots both operands with existing modifications and works in either target order", () => {
  for (const reversed of [false, true]) {
    const f = swapRuntime();
    activate(f, "before-swap", [change("plus-two", "left", 2)]);
    if (reversed) {
      f.answers.set("target:switcheroo.first-unit", ["right"]);
      f.answers.set("target:switcheroo.second-unit", ["left"]);
    }
    f.play("swap");
    settle(f.engine);
    assert.equal(f.snapshot("left").might, 7);
    assert.equal(f.snapshot("right").might, 5);
    for (let read = 0; read < 3; read++) {
      assert.equal(f.snapshot("right").might, 5);
      assert.equal(f.snapshot("left").might, 7);
    }
  }
});

test("original Switcheroo with equal Mights skips both registrations (434.1.c)", () => {
  const f = swapRuntime(4, 4);
  f.play("swap");
  settle(f.engine);
  assert.equal(f.snapshot("left").might, 4);
  assert.equal(f.snapshot("right").might, 4);
  assert.equal(f.engine.layers.registry.snapshot().length, 0);
  assert.equal(f.kernel.linked("switcheroo.swap-might.affected.count"), 0);
});

test("the default Swap schema rejects malformed or incomplete operand pairs", () => {
  const definition = instructionDefinitionsById.get("effect.swap-might");
  assert.equal(definition.op, "effect.swap-might");
  for (const targets of [[], [{ target: "left" }], [{ target: "left" }, { target: "" }],
    [{ target: "left" }, { target: "right", amount: 2 }]]) {
    assert.equal(definition.argsSchema.safeParse({ targets: c(targets) }).success, false);
  }
  assert.equal(definition.argsSchema.safeParse({ targets: c([{ target: "left" }, { target: "right" }]), duration: c("this-turn") }).success, true);
});

test("Swap refuses a repeated runtime object without registering either half", () => {
  const f = runtime(world().unit("caster").unit("friend", { might: 3 }));
  activate(f, "duplicate-operands", [{ id: "swap", op: "effect.swap-might", args: {
    targets: c([{ target: "left" }, { target: "right" }]), duration: c("this-turn") },
    targets: ["left", "right"].map(id => ({ id, filter: { type: "unit", objectId: "friend", zone: "board" }, min: 1, max: 1, selection: "one" })) }]);
  assert.equal(f.snapshot("friend").might, 3);
  assert.equal(f.engine.layers.registry.snapshot().length, 0);
  assert.equal(f.kernel.linked("swap.affected.count"), 0);
});

test("original Switcheroo does not perform half a swap after one finalized target leaves", () => {
  const f = swapRuntime();
  f.play("swap");
  assert.equal(f.engine.commit({ type: "kill", object: f.kernel.ref("left") }).status, "done");
  settle(f.engine);
  assert.equal(f.snapshot("right").might, 7);
  assert.equal(f.engine.layers.registry.snapshot().length, 0);
  assert.equal(f.kernel.getObject("swap").zone, "trash");
});

test("original Switcheroo rechecks its same-battlefield restriction at resolution", () => {
  const f = swapRuntime();
  f.play("swap");
  assert.equal(f.engine.commit({ type: "move-location", object: f.kernel.ref("right"), to: at("two") }).status, "done");
  settle(f.engine);
  assert.equal(f.snapshot("left").might, 3);
  assert.equal(f.snapshot("right").might, 7);
  assert.equal(f.engine.layers.registry.snapshot().length, 0);
});

test("a prevented post-resolution action rolls back both original Switcheroo effects and permits a clean retry", () => {
  const f = swapRuntime();
  f.play("swap");
  assert.equal(f.engine.commit({ type: "exhaust", object: f.kernel.ref("caster") }).status, "done");
  f.engine.advance();
  f.engine.pipeline.registerReplacement({ id: "prevent-spell-exit", matches: action =>
    f.kernel.getObject("caster").exhausted && action.type === "move-zone" && action.to === "trash" && action.object.id === "swap",
    apply: () => ({ status: "prevent" }) });
  f.engine.pass(f.engine.priority);
  const before = f.kernel.snapshot();
  const events = [...f.engine.pipeline.events];
  assert.throws(() => f.engine.pass(f.engine.priority), /Resolved spell could not leave Chain/);
  assert.deepEqual(f.kernel.snapshot(), before);
  assert.deepEqual(f.engine.pipeline.events, events);
  assert.equal(f.engine.layers.registry.snapshot().length, 0);
  assert.equal(f.kernel.linked("switcheroo.swap-might.affected.count"), undefined);
  assert.equal(f.snapshot("left").might, 3);
  assert.equal(f.snapshot("right").might, 7);
  assert.equal(f.engine.commit({ type: "ready", object: f.kernel.ref("caster") }).status, "done");
  settle(f.engine);
  assert.equal(f.engine.layers.registry.snapshot().length, 2);
  assert.equal(f.snapshot("left").might, 7);
  assert.equal(f.snapshot("right").might, 3);
});

test("an awaited real choice rolls back a Base Might registration and replays it exactly once", () => {
  const f = runtime(world().unit("caster").unit("friend", { might: 2 }).deck("reward"));
  f.answers.set("target:herald.friendly-unit", ["friend"]);
  const originalInstruction = herald.abilities[0].body[0];
  f.engine.execute({ id: "base-and-choice", source: f.kernel.getObject("caster"), controller: "A", kind: "activated", speed: "action", body: translateInstructionTargets([
    originalInstruction,
    { id: "optional-draw", op: "choice.optional", args: { body: c([{ id: "draw", op: "effect.draw", args: { amount: c(1) } }]) } },
  ]) });
  let request;
  assert.throws(() => settle(f.engine), error => { request = error.request; return error instanceof AwaitChoice; });
  assert.equal(f.engine.layers.registry.snapshot().length, 0);
  assert.equal(f.snapshot("friend").might, 2);
  assert.equal(f.kernel.getObject("reward").zone, "deck");
  f.answers.set(request.id, true);
  settle(f.engine);
  assert.equal(f.snapshot("friend").might, 5);
  assert.equal(f.engine.layers.registry.snapshot().length, 1);
  assert.equal(f.kernel.getObject("reward").zone, "hand");
});

test("minimum reductions snapshot each actual delta and never reapply their floor on later increases", () => {
  const f = runtime(world().unit("caster").unit("friend", { might: 6 }));
  activate(f, "limited-reductions", [change("minus-four", "friend", -4, { minimum: c(1) }),
    change("minus-another-four", "friend", -4, { minimum: c(1) }),
    { id: "at-floor", op: "condition.value", args: { value: { kind: "object-property", object: "self", property: "might" } } },
    change("plus-three", "friend", 3)], "friend");
  assert.equal(f.kernel.linked("at-floor.value"), 1);
  assert.deepEqual(f.engine.layers.registry.snapshot().map(entry => entry.effect.effect.amount), [-4, -1, 3]);
  assert.equal(f.snapshot("friend").might, 4);
});

test("minimum reductions cannot increase a unit that already lies below their floor", () => {
  const f = runtime(world().unit("caster").unit("friend", { might: 1 }));
  activate(f, "already-below-floor", [change("limited-decrease", "friend", -8, { minimum: c(3) })]);
  assert.equal(f.snapshot("friend").might, 1);
});

test("arithmetic set snapshots its delta while subsequent Base Might changes remain in the trait layer", () => {
  const f = runtime(world().unit("caster").unit("friend", { might: 3 }));
  activate(f, "set-current", [change("set-eight", "friend", 8, { mode: c("set") })]);
  assert.equal(f.snapshot("friend").might, 8);
  activate(f, "change-base", [change("base-five", "friend", 5, {}, "continuous.base-might")]);
  assert.equal(f.snapshot("friend").might, 10, "base 5 + remembered delta 5");
  assert.equal(f.snapshot("friend").printed.might, 3);
});

test("Base Might zero is a real trait change and causes production unit cleanup", () => {
  const f = runtime(world().unit("caster").unit("friend", { might: 3 }));
  activate(f, "zero-base", [change("base-zero", "friend", 0, {}, "continuous.base-might")]);
  assert.equal(f.kernel.getObject("friend").zone, "trash");
  assert.equal(f.kernel.getObject("friend").might, 3);
  assert.equal(f.engine.layers.registry.snapshot().length, 1);
  assert.equal(f.engine.pipeline.events.filter(event => event.timingPoint === "object-killed" && event.object?.ref.id === "friend").length, 1);
});

test("Might operands reuse the interpreter's arithmetic expressions at resolution", () => {
  const f = runtime(world().unit("caster").unit("friend", { might: 3 }));
  activate(f, "expression-operands", [change("calculated-base", "friend", 0, {
    amount: { kind: "arithmetic", operator: "mul", operands: [c(2), c(3)] }
  }, "continuous.base-might"), change("calculated-increase", "friend", 0, {
    amount: { kind: "arithmetic", operator: "sub", operands: [c(4), c(2)] }
  })]);
  assert.equal(f.snapshot("friend").might, 8);
  assert.equal(f.snapshot("friend").printed.might, 3);
});

test("a null Energy expression rejects Base Might resolution without inventing a zero or retaining earlier effects", () => {
  const f = runtime(world().unit("caster").unit("friend", { might: 3, energy: null, power: null }));
  const before = f.kernel.snapshot();
  assert.throws(() => activate(f, "null-cost", [change("earlier-plus", "friend", 2), {
    id: "base-from-cost", op: "continuous.base-might", args: {
      amount: { kind: "object-property", object: { target: "unit" }, property: "energy" }, target: c("unit") },
    targets: [{ id: "unit", filter: { objectId: "friend", type: "unit", zone: "board" }, min: 1, max: 1, selection: "one" }] }]), /amount|safe integer/);
  assert.deepEqual(f.kernel.snapshot(), before);
  assert.equal(f.engine.layers.registry.snapshot().length, 0);
  assert.equal(f.snapshot("friend").might, 3);
  assert.equal(f.snapshot("friend").energy, null);
  assert.equal(f.snapshot("friend").power, null);
});

test("original Switcheroo and Base Might effects expire through the complete production turn flow", () => {
  const f = swapRuntime(3, 7, true);
  f.flow.start();
  assert.equal(f.flow.phase, "main");
  assert.equal(f.engine.commit({ type: "gain-energy", player: "A", amount: 2 }).status, "done");
  assert.equal(f.engine.commit({ type: "gain-power", player: "A", power: ["Chaos", "Chaos"] }).status, "done");
  f.engine.advance();
  f.play("swap");
  settle(f.engine);
  activate(f, "base-for-turn", [change("base-five", "left", 5, {}, "continuous.base-might")]);
  assert.equal(f.snapshot("left").might, 9);
  assert.equal(f.snapshot("right").might, 3);
  f.flow.endTurn("A");
  while (f.engine.items.length) f.flow.pass(f.engine.priority);
  f.flow.advance();
  assert.equal(f.flow.turnPlayer, "B");
  assert.equal(f.flow.phase, "main");
  assert.equal(f.snapshot("left").might, 3);
  assert.equal(f.snapshot("right").might, 7);
  assert.equal(f.engine.layers.registry.snapshot().length, 0);
});
