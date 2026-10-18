import assert from "node:assert/strict";
import test from "node:test";

import { AwaitChoice } from "../../dist/effects/contract.js";
import { MissingInformation } from "../../dist/effects/interpreter/values.js";
import { world } from "../../dist/effects/testing/test-kernel.js";
import { ChainEngine } from "../../dist/chain/engine.js";
import { TurnFlow } from "../../dist/turn/flow.js";
import { bindResolveContext, createActionPipelineHost } from "../../dist/events/action-adapter.js";
import { createProgramBinding } from "../../dist/programs/index.js";
import { createLayerEngine, isDurationActive } from "../../dist/layers/index.js";
import { buildMightSpec } from "../../dist/layers/ops/index.js";
import seraphine from "../../../card-dsl/dist/cards/rad/seraphine-not-alone.js";
import sett from "../../../card-dsl/dist/cards/ogn/sett-kingpin.js";
import renekton from "../../../card-dsl/dist/cards/ven/renekton-brute.js";

const c = value => ({ kind: "constant", value });
const at = id => ({ type: "battlefield", id });
// Admit the unchanged original ability IR only in this test registry. The
// production program and its independent judge-required gates stay intact.
const admitted = program => ({ ...program, status: "executable", judgeReason: undefined });

function runtime(builder, programs = [], withTurn = false) {
  const kernel = builder.build();
  const answers = new Map();
  const choose = request => {
    if (answers.has(request.id)) return answers.get(request.id);
    if (request.type === "select-objects" && request.min === request.max && request.options.length === request.min) return [...request.options];
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
    battlefields: [{ id: "one", controller: null }, { id: "two", controller: null }], describePlay: binding.describePlay }) : undefined;
  const engine = flow?.chain ?? new ChainEngine({ host, turnOrder: ["A", "B"], turnPlayer: "A", phase: "main", describePlay: binding.describePlay,
    cleanup: current => {
      let changed = false;
      current.layers.setObjects(kernel.objects);
      for (const object of current.layers.evaluateAll()) {
        if (object.zone !== "board" || !object.types.includes("unit") || object.might === null ||
          object.might > 0 && object.damage < object.might) continue;
        assert.equal(current.commit({ type: "kill", object: object.ref }).status, "done");
        changed = true;
      }
      return changed;
    } });
  if (programs.length) binding.attachLifecycle(engine, error => { throw error; });
  const enter = id => {
    const location = kernel.getObject(id).location;
    assert.equal(engine.commit({ type: "move-zone", object: kernel.ref(id), to: "chain" }).status, "done");
    assert.equal(engine.commit({ type: "move-zone", object: kernel.ref(id), to: location?.type === "base" ? "base" : "battlefield", location }).status, "done");
    engine.advance();
  };
  const snapshot = id => { engine.layers.setObjects(kernel.objects); return engine.layers.snapshot(kernel.ref(id)); };
  return { kernel, engine, flow, binding, answers, enter, snapshot };
}

function settle(engine) {
  engine.advance();
  for (let attempts = 0; engine.items.length; attempts++) {
    assert.ok(attempts < 30, "resolves using real priority passes");
    engine.pass(engine.priority);
  }
}

test("original Seraphine IR dynamically counts other exhausted friendly units", () => {
  const f = runtime(world().unit("source", { cardId: seraphine.canonicalCardId, might: 1, energy: 5, power: null })
    .unit("one", { exhausted: true }).unit("two").unit("enemy", { owner: "B", exhausted: true }), [seraphine]);
  f.enter("source");
  assert.equal(f.snapshot("source").might, 2);
  assert.equal(f.engine.commit({ type: "exhaust", object: f.kernel.ref("two") }).status, "done");
  assert.equal(f.snapshot("source").might, 3);
  assert.equal(f.engine.commit({ type: "ready", object: f.kernel.ref("one") }).status, "done");
  assert.equal(f.snapshot("source").might, 2);
  assert.equal(f.engine.commit({ type: "take-control", object: f.kernel.ref("two"), player: "B" }).status, "done");
  assert.equal(f.snapshot("source").might, 1);
  assert.equal(f.snapshot("source").power, null);
  assert.equal(f.kernel.getObject("source").might, 1, "only the authoritative layer view derives Might");
  assert.equal(seraphine.status, "judge-required");
});

test("original Sett Kingpin IR follows buff, location and controller dependencies", () => {
  const f = runtime(world().unit("source", { cardId: sett.canonicalCardId, might: 4, location: at("one"), power: null })
    .unit("friend", { location: at("one") }).unit("enemy", { owner: "B", location: at("one") }), [sett]);
  f.enter("source");
  assert.equal(f.snapshot("source").might, 4);
  assert.equal(f.engine.commit({ type: "buff", object: f.kernel.ref("friend"), amount: 1 }).status, "done");
  assert.equal(f.snapshot("source").might, 5);
  assert.equal(f.engine.commit({ type: "buff", object: f.kernel.ref("enemy"), amount: 1 }).status, "done");
  assert.equal(f.snapshot("source").might, 5, "enemy buffs do not contribute");
  assert.equal(f.engine.commit({ type: "move-location", object: f.kernel.ref("friend"), to: at("two") }).status, "done");
  assert.equal(f.snapshot("source").might, 4);
  assert.equal(f.engine.commit({ type: "move-location", object: f.kernel.ref("source"), to: at("two") }).status, "done");
  assert.equal(f.snapshot("source").might, 5, "self location is resolved at evaluation time");
  assert.equal(f.engine.commit({ type: "take-control", object: f.kernel.ref("source"), player: "B" }).status, "done");
  assert.equal(f.snapshot("source").might, 4);
  assert.equal(sett.status, "judge-required", "Tank's independent blocker is preserved");
});

test("a prevented action and an awaited choice roll back the real Seraphine dependency", () => {
  const f = runtime(world().unit("source", { cardId: seraphine.canonicalCardId, might: 1, power: null })
    .unit("other").deck("reward"), [seraphine]);
  f.enter("source");
  f.engine.pipeline.registerReplacement({ id: "deny-exhaust", oncePerTurn: true,
    matches: action => action.type === "exhaust", apply: () => ({ status: "prevent" }) });
  assert.equal(f.engine.commit({ type: "exhaust", object: f.kernel.ref("other") }).status, "prevented");
  assert.equal(f.snapshot("source").might, 1);
  f.engine.execute({ id: "exhaust-and-draw", source: f.kernel.getObject("source"), controller: "A", kind: "activated", speed: "action", body: [
    { id: "exhaust", op: "effect.exhaust", args: { target: c("other-unit") },
      targets: [{ id: "other-unit", filter: { objectId: "other", type: "unit", zone: "board" }, min: 1, max: 1, selection: "one" }] },
    { id: "ask", op: "choice.optional", args: { body: c([{ id: "draw", op: "effect.draw", args: { amount: c(1) } }]) } },
  ] });
  let request;
  assert.throws(() => settle(f.engine), error => { request = error.request; return error instanceof AwaitChoice; });
  assert.equal(f.kernel.getObject("other").exhausted, false);
  assert.equal(f.snapshot("source").might, 1);
  f.answers.set(request.id, true);
  settle(f.engine);
  assert.equal(f.kernel.getObject("other").exhausted, true);
  assert.equal(f.snapshot("source").might, 2);
  assert.equal(f.kernel.getObject("reward").zone, "hand");
});

test("original Renekton activation pays its cost and rejects an unpaid repeat atomically", () => {
  const f = runtime(world().player("A", { energy: 1 }).unit("source", { cardId: renekton.canonicalCardId, might: 4, power: null }), [renekton]);
  f.enter("source");
  f.engine.execute(f.binding.describeActivate(f.kernel.getObject("source"), "A"));
  settle(f.engine);
  assert.equal(f.snapshot("source").might, 5);
  assert.equal(f.kernel.player("A").energy, 0);
  const entries = f.engine.layers.registry.snapshot();
  assert.throws(() => {
    f.engine.execute(f.binding.describeActivate(f.kernel.getObject("source"), "A"));
    settle(f.engine);
  }, /energy|pay|cost/i);
  assert.deepEqual(f.engine.layers.registry.snapshot().map(entry => entry.effect.id), entries.map(entry => entry.effect.id));
  assert.equal(renekton.status, "judge-required");
});

test("original Renekton this-turn effect survives Ending triggers and expires through the complete TurnFlow", () => {
  const f = runtime(world().player("A", { energy: 0, power: [] }).player("B", { energy: 0, power: [] })
    .unit("source", { cardId: renekton.canonicalCardId, might: 4, power: null, location: { type: "base", player: "A" } })
    .deck("a-draw").deck("b-draw", { owner: "B" }), [renekton], true);
  f.enter("source");
  f.flow.start();
  assert.equal(f.flow.phase, "main");
  assert.equal(f.engine.commit({ type: "gain-energy", player: "A", amount: 1 }).status, "done");
  f.flow.execute(f.binding.describeActivate(f.kernel.getObject("source"), "A"));
  while (f.engine.items.length) f.flow.pass(f.engine.priority);
  assert.equal(f.snapshot("source").might, 5);
  f.engine.pipeline.registerTrigger({ id: "observe-ending", source: f.kernel.getObject("source"), controller: "A",
    spec: { at: "turn-end", filter: {} }, body: [{ id: "ending-might", op: "condition.value", args: {
      value: { kind: "object-property", object: "source", property: "might" },
    } }] });
  f.flow.endTurn("A");
  assert.equal(f.snapshot("source").might, 5);
  for (let attempts = 0; f.engine.items.length; attempts++) {
    assert.ok(attempts < 20);
    f.flow.pass(f.engine.priority);
  }
  f.flow.advance();
  assert.equal(f.kernel.linked("ending-might.value"), 5);
  assert.equal(f.flow.turnPlayer, "B");
  assert.equal(f.flow.phase, "main");
  assert.equal(f.snapshot("source").might, 4);
  assert.equal(f.snapshot("source").power, null);
});

const object = (id, values = {}) => world().unit(id, { energy: null, power: null, ...values }).build().getObject(id);
const permanent = effect => ({ effect, duration: { type: "permanent" } });

test("CR 478.2–478.3: later arithmetic unlocks trait, ability, and arithmetic across multiple sequences exactly once", () => {
  const source = object("source", { might: 4 });
  const layers = createLayerEngine([source], [
    permanent({ id: "mighty-tag", layer: "trait", filter: { mightGte: 5 }, effect: { kind: "add-tag", tag: "Yeti" } }),
    permanent({ id: "tag-ability", layer: "ability", filter: { tags: ["Yeti"] }, effect: { kind: "grant-keyword", keyword: "Shield", value: 2 } }),
    permanent({ id: "ability-might", layer: "arithmetic", filter: { hasKeyword: "Shield" }, effect: { kind: "increase", amount: 2 } }),
    permanent({ id: "increase", layer: "arithmetic", filter: {}, effect: { kind: "increase", amount: 1 } }),
  ]);
  const result = layers.snapshot(source.ref);
  assert.equal(result.might, 7);
  assert.deepEqual(result.tags, ["Yeti"]);
  assert.deepEqual(result.keywords, [{ id: "Shield", value: 2 }]);
  layers.removeContinuous("increase");
  assert.equal(layers.snapshot(source.ref).might, 4);
  assert.deepEqual(layers.snapshot(source.ref).keywords, []);
});

test("effective Might conditions read a bounded pre-application snapshot without self recursion", () => {
  const source = object("source", { might: 4 });
  const layers = createLayerEngine([source], [permanent({ id: "conditional", source: source.ref, layer: "arithmetic", filter: {},
    effect: { kind: "increase", amount: { kind: "object-property", object: "self", property: "might" },
      condition: { kind: "compare", left: { kind: "object-property", object: "self", property: "might" }, operator: "gte", right: c(4) } } })]);
  assert.equal(layers.snapshot(source.ref).might, 8);
  assert.equal(layers.snapshot(source.ref).might, 8, "a cached result does not feed back into the next application");
  layers.setObjects([object("source", { might: 3 })]);
  assert.equal(layers.snapshot(source.ref).might, 3);
});

test("a newly enabled trait recalculates an already evaluated count without adding its old value twice", () => {
  const source = object("source", { might: 4 });
  const layers = createLayerEngine([source], [
    permanent({ id: "mighty-tag", source: source.ref, layer: "trait", filter: { mightGte: 5 }, effect: { kind: "add-tag", tag: "Yeti" } }),
    permanent({ id: "tag-count", source: source.ref, layer: "arithmetic", filter: {}, effect: { kind: "increase",
      amount: { kind: "count", subject: "units", filter: { type: "unit", zone: "board", tags: ["Yeti"] } } } }),
    permanent({ id: "independent", layer: "arithmetic", filter: {}, effect: { kind: "increase", amount: 1 } }),
  ]);
  assert.equal(layers.snapshot(source.ref).might, 6);
  assert.equal(layers.snapshot(source.ref).might, 6);
  layers.removeContinuous("independent");
  assert.equal(layers.snapshot(source.ref).might, 4);
  assert.deepEqual(layers.snapshot(source.ref).tags, []);
});

test("CR 481: a passive arithmetic value depending on another increase outranks timestamp", () => {
  const source = object("source", { might: 4 });
  const layers = createLayerEngine([source], [
    permanent({ id: "raise-to-five", layer: "arithmetic", source: source.ref, filter: {}, effect: { kind: "increase", amount: {
      kind: "arithmetic", operator: "max", operands: [c(0), { kind: "arithmetic", operator: "sub", operands: [c(5), { kind: "object-property", object: "self", property: "might" }] }] } } }),
    permanent({ id: "discipline", layer: "arithmetic", filter: {}, effect: { kind: "increase", amount: 2 } }),
  ]);
  assert.equal(layers.snapshot(source.ref).might, 6);
});

test("CR 479.4.b: non-passive set-Might remembers its delta while a trait change alters the base", () => {
  const f = runtime(world().unit("source", { might: 3, energy: null, power: null }));
  f.engine.layers.addContinuous({ id: "base", layer: "trait", filter: {}, effect: { kind: "set-might", value: 4 } }, { type: "permanent" });
  f.engine.layers.addContinuous({ id: "shield", layer: "arithmetic", filter: {}, effect: { kind: "increase", amount: 2 } }, { type: "permanent" });
  assert.equal(f.snapshot("source").might, 6);
  f.engine.advance();
  f.engine.execute({ id: "set-current-might", source: f.kernel.getObject("source"), controller: "A", kind: "activated", speed: "action",
    body: [{ id: "set", op: "continuous.might", args: { mode: c("set"), amount: c(8), duration: c("this-turn"), appliesTo: c("self") } }] });
  settle(f.engine);
  assert.equal(f.snapshot("source").might, 8, "base 4 + Shield 2 + remembered delta 2");
  f.engine.layers.removeContinuous("shield");
  assert.equal(f.snapshot("source").might, 6);
  f.engine.layers.advance({ id: "turn-end" });
  assert.equal(f.snapshot("source").might, 4);
  assert.equal(f.snapshot("source").printed.might, 3);
  assert.equal(f.snapshot("source").energy, null);
  assert.equal(f.snapshot("source").power, null);
});

test("snapshotted minimum reductions never raise a unit already below the minimum", () => {
  const source = object("source", { might: 1 });
  const spec = buildMightSpec("continuous.might", source.ref, { ref: source.ref, snapshot: source, minimum: 3 }, "add", -4, "floor");
  assert.equal(createLayerEngine([source], [spec]).snapshot(source.ref).might, 1);
});

test("a null printed cost stays unavailable to arithmetic instead of becoming a zero modification", () => {
  const source = object("source", { might: 3, energy: null, power: null });
  const layers = createLayerEngine([source], [permanent({ id: "cost-as-might", source: source.ref,
    layer: "arithmetic", filter: {}, effect: { kind: "increase", amount: {
      kind: "object-property", object: "self", property: "energy",
    } } })]);
  assert.throws(() => layers.snapshot(source.ref), MissingInformation);
  assert.equal(source.energy, null);
  assert.equal(source.power, null);
  assert.equal(source.might, 3);
  layers.removeContinuous("cost-as-might");
  assert.equal(layers.snapshot(source.ref).might, 3);
});

test("direct registry changes and rollback restoration invalidate all dependent snapshots", () => {
  const source = object("source", { might: 3 });
  const layers = createLayerEngine([source]);
  const effect = { id: "increase", layer: "arithmetic", filter: {}, effect: { kind: "increase", amount: 2 } };
  assert.equal(layers.snapshot(source.ref).might, 3);
  layers.registry.register(effect, { type: "permanent" });
  assert.equal(layers.snapshot(source.ref).might, 5);
  const saved = layers.registry.snapshot();
  layers.registry.clear();
  assert.equal(layers.snapshot(source.ref).might, 3);
  for (const item of saved) layers.registry.register(item.effect, item.duration, item.timestamp);
  assert.equal(layers.snapshot(source.ref).might, 5);
});

test("CR 478.1.c: mutual Might gates use simultaneous layer snapshots in either object order", () => {
  const first = object("first", { might: 4, controller: "A", location: at("one") });
  const second = object("second", { might: 4, owner: "B", controller: "B", location: at("one") });
  const condition = { kind: "compare", left: { kind: "count", subject: "units", filter: {
    type: "unit", zone: "board", controller: "opponent", sameLocationAs: "self", mightGte: 5,
  } }, operator: "gte", right: c(1) };
  const effects = [first, second].flatMap(source => [
    permanent({ id: `${source.ref.id}-conditional`, source: source.ref, layer: "arithmetic", filter: { objectId: source.ref.id }, effect: { kind: "increase", amount: 5, condition } }),
    permanent({ id: `${source.ref.id}-increase`, layer: "arithmetic", filter: { objectId: source.ref.id }, effect: { kind: "increase", amount: 1 } }),
    permanent({ id: `${source.ref.id}-decrease`, layer: "arithmetic", filter: { objectId: source.ref.id }, effect: { kind: "decrease", amount: 1 } }),
  ]);
  for (const objects of [[first, second], [second, first]]) {
    const layers = createLayerEngine(objects, effects);
    assert.deepEqual([layers.snapshot(first.ref).might, layers.snapshot(second.ref).might], [4, 4]);
  }
});

test("CR 479.1.c: copy loops are simultaneous and a downstream copy excludes subsequent trait/arithmetic layers", () => {
  const first = object("first", { might: 2 });
  const second = object("second", { might: 7 });
  const final = object("final", { might: 1 });
  const effects = [
    permanent({ id: "first-copy", layer: "copy", filter: { objectId: "first" }, effect: { kind: "copy-object", source: second.ref } }),
    permanent({ id: "second-copy", layer: "copy", filter: { objectId: "second" }, effect: { kind: "copy-object", source: first.ref } }),
    permanent({ id: "final-copy", layer: "copy", filter: { objectId: "final" }, effect: { kind: "copy-object", source: first.ref } }),
    permanent({ id: "first-base", layer: "trait", filter: { objectId: "first" }, effect: { kind: "set-might", value: 9 } }),
    permanent({ id: "first-increase", layer: "arithmetic", filter: { objectId: "first" }, effect: { kind: "increase", amount: 3 } }),
  ];
  for (const objects of [[first, second, final], [final, second, first]]) {
    const layers = createLayerEngine(objects, effects);
    assert.equal(layers.snapshot(final.ref).might, 7);
    assert.equal(layers.snapshot(first.ref).might, 12);
    assert.equal(layers.snapshot(second.ref).might, 2);
    assert.equal(layers.snapshot(final.ref).energy, null);
    assert.equal(layers.snapshot(final.ref).power, null);
  }
});

test("source-zone durations verify the complete zone identity and explicit until windows verify the player", () => {
  const source = object("source");
  const duration = { type: "while-source-in-zone", source: source.ref };
  assert.equal(isDurationActive(duration, undefined, () => source), true);
  assert.equal(isDurationActive(duration, undefined, () => ({ ...source, ref: { ...source.ref, zoneEntryId: 2 } })), false);
  const layers = createLayerEngine([source], [{ effect: { id: "window", layer: "arithmetic", filter: {}, effect: { kind: "increase", amount: 2 } },
    duration: { type: "until", at: "turn-end", player: "B" } }]);
  layers.advance({ id: "turn-end", player: "A" });
  assert.equal(layers.snapshot(source.ref).might, 3);
  layers.advance({ id: "turn-end", player: "B" });
  assert.equal(layers.snapshot(source.ref).might, 1);
});
