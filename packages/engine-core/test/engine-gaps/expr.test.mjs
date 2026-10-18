import assert from "node:assert/strict";
import test from "node:test";
import { AwaitChoice } from "../../dist/effects/contract.js";
import { world } from "../../dist/effects/testing/index.js";
import { runCardScenario } from "../../dist/effects/testing/scenario/index.js";
import { ChainEngine } from "../../dist/chain/engine.js";
import { resolveChainBody } from "../../dist/chain/interpreter-adapter.js";
import { bindResolveContext, createActionPipelineHost } from "../../dist/events/action-adapter.js";
import { createProgramBinding } from "../../dist/programs/index.js";
import { evaluateCondition } from "../../dist/effects/interpreter/condition.js";
import { bindEventHistory } from "../../dist/effects/interpreter/expr-ext/index.js";
import { MissingInformation } from "../../dist/effects/interpreter/values.js";
import { fixture as turnFixture } from "../turn/helpers.mjs";
import daringPoro from "../../../card-dsl/dist/cards/ogn/daring-poro.js";
import stalwartPoro from "../../../card-dsl/dist/cards/ogn/stalwart-poro.js";
import wilyNewtfish from "../../../card-dsl/dist/cards/unl/wily-newtfish.js";
import ragingSoul from "../../../card-dsl/dist/cards/ogn/raging-soul.js";

const c = value => ({ kind: "constant", value });
const read = (id, value) => ({ id, op: "condition.value", args: { value } });
const property = (property, player) => ({ kind: "player-property", property, ...(player === undefined ? {} : { player }) });
const history = (subject, filter = {}) => ({ kind: "count", subject, filter });
const environment = context => ({ context, linked: id => context.linked(id), canLookBack: () => false, isIgnored: () => false });

// Only the test registry's admission metadata changes. Original ability IR,
// source text and the production judge-required programs remain untouched.
const admitted = program => ({ ...program, status: "executable", judgeReason: undefined });

function runtime(builder, programs = []) {
  const kernel = builder.build();
  const answers = new Map();
  const choose = request => {
    if (answers.has(request.id)) return answers.get(request.id);
    if (request.type === "select-objects" && request.options.length === request.min && request.min === request.max) return [...request.options];
    throw new AwaitChoice(request);
  };
  let engine;
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: saved => { kernel.restore(saved.state); kernel.copyLinkedFrom(saved.links); },
    objects: () => kernel.objects,
    perform: action => kernel.perform(action),
    choose,
    context: (source, controller, timingPoint) => bindEventHistory(
      bindResolveContext(kernel, { source, controller, timingPoint, choose }), engine.pipeline),
  });
  const binding = createProgramBinding({ cardPrograms: programs.map(admitted) });
  engine = new ChainEngine({ turnOrder: ["A", "B"], turnPlayer: "A", phase: "main", host, describePlay: binding.describePlay,
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
  const context = (id = "source", controller = "A") => host.context(kernel.getObject(id), controller, "main-start");
  const enter = id => {
    const location = kernel.getObject(id).location;
    assert.equal(engine.commit({ type: "move-zone", object: kernel.ref(id), to: "chain" }).status, "done");
    assert.equal(engine.commit({ type: "move-zone", object: kernel.ref(id), to: "battlefield", location }).status, "done");
  };
  const snapshot = id => { engine.layers.setObjects(kernel.objects); return engine.layers.snapshot(kernel.ref(id)); };
  return { kernel, engine, binding, answers, context, enter, snapshot };
}

function settle(engine) {
  engine.advance();
  for (let count = 0; engine.items.length; count++) {
    assert.ok(count < 50, "chain settles through real priority passes");
    engine.pass(engine.priority);
  }
}

test("main dispatch composes player leaves in primitive arguments and retains the captured ability controller", () => {
  const f = runtime(world().player("A", { score: 2 }).player("B", { score: 7 })
    .unit("source", { energy: null, power: null }).hand("discard"));
  f.engine.layers.addContinuous({ id: "source-might", layer: "arithmetic", source: f.kernel.ref("source"),
    filter: { objectId: "source" }, effect: { kind: "continuous.might", mode: "add", amount: c(2) } }, { type: "permanent" });
  f.engine.pipeline.registerTrigger({ id: "capture", source: f.kernel.getObject("source"), controller: "A",
    spec: { at: "card-discarded", filter: {} }, body: [
      read("controller", property("points")),
      read("current", property("points", { controllerOf: "source" })),
      read("layer", { kind: "object-property", object: "source", property: "might" }),
      read("history", history("cards-discarded-this-turn", { player: "controller" })),
      { id: "xp", op: "effect.xp", args: { amount: { kind: "arithmetic", operator: "add", operands: [property("points"), c(1)] } } },
      read("xp-state", history("controller-xp", { player: "controller" })),
      read("energy", { kind: "object-property", object: "source", property: "energy" }),
      read("power", { kind: "object-attribute", object: "source", attribute: "power" }),
    ] });
  assert.equal(f.engine.commit({ type: "discard", object: f.kernel.ref("discard") }).status, "done");
  assert.equal(f.engine.items[0].controller, "A");
  assert.equal(f.engine.commit({ type: "take-control", object: f.kernel.ref("source"), player: "B" }).status, "done");
  settle(f.engine);
  assert.equal(f.kernel.linked("controller.value"), 2);
  assert.equal(f.kernel.linked("current.value"), 7);
  assert.equal(f.kernel.linked("layer.value"), 3);
  assert.equal(f.kernel.linked("history.value"), 1);
  assert.equal(f.kernel.linked("xp-state.value"), 3);
  assert.equal(f.kernel.getObject("source").might, 1);
  assert.equal(f.kernel.player("A").xp, 3);
  assert.equal(f.kernel.player("B").xp, 0);
  assert.equal(f.kernel.linked("energy.value"), null);
  assert.equal(f.kernel.linked("power.value"), null);
});

for (const [program, role, might] of [[daringPoro, "attacker", 2], [daringPoro, "defender", 1],
  [stalwartPoro, "defender", 2], [stalwartPoro, "attacker", 1], [stalwartPoro, null, 1]]) {
  test(`default lifecycle expands original ${program === daringPoro ? "Daring" : "Stalwart"} Poro IR with ${role} designation`, () => {
    // Declarative initial designation tests the consumer. Combat's role producer
    // is a separate gap; this is not evidence of a complete combat transaction.
    const result = runCardScenario(admitted(program), { objects: [{ id: "poro", program: admitted(program),
      zone: "board", energy: 1, power: null, might: 1, combatRole: role }], expect: { objects: { poro: { might, power: null } } } });
    result.asserts();
    assert.equal(program.status, "judge-required");
  });
}

test("designation aliases preserve separate source/host selectors and stale zone identities", () => {
  const f = runtime(world().unit("source", { combatRole: "attacker" }).unit("host", { combatRole: "defender" }));
  const context = f.context();
  const output = resolveChainBody([
    read("source", { kind: "object-designation", object: "source" }),
    read("host", { kind: "object-attribute", object: "self", attribute: "designation" }),
    read("combat", history("self-in-combat", { object: "self" })),
  ], context, { host: f.kernel.ref("host") });
  assert.equal(output.linkedValues["source.value"], "attacker");
  assert.equal(output.linkedValues["host.value"], "defender");
  assert.equal(output.linkedValues["combat.value"], 1);
  const old = f.kernel.ref("host");
  assert.equal(f.engine.commit({ type: "kill", object: old }).status, "done");
  f.kernel.setTargets("old", [old]);
  const ignored = resolveChainBody([read("old", { kind: "object-designation", object: { target: "old" } })], context);
  assert.equal(ignored.results[0].result.status, "ignored");
  assert.equal(f.engine.commit({ type: "move-zone", object: f.kernel.ref("host"), to: "base", location: { type: "base", player: "A" } }).status, "done");
  assert.equal(resolveChainBody([read("new", { kind: "object-designation", object: { target: "old" } })], context).results[0].result.status, "ignored");
});

test("original Wily Newtfish passive follows real XP events, refusal, rollback, and current source control", () => {
  const f = runtime(world().unit("source", { cardId: wilyNewtfish.canonicalCardId, might: 4, energy: 4, power: null }).deck("reward"), [wilyNewtfish]);
  f.enter("source");
  assert.equal(f.snapshot("source").might, 4);
  // A real pipeline replacement prevents the action and emits no gained event.
  f.engine.pipeline.registerReplacement({ id: "deny-xp", oncePerTurn: true, matches: action => action.type === "gain-xp", apply: () => ({ status: "prevent" }) });
  assert.equal(f.engine.commit({ type: "gain-xp", player: "A", amount: 1 }).status, "prevented");
  assert.equal(f.snapshot("source").might, 4);
  f.engine.advance();
  f.engine.execute({ id: "rollback-xp", source: f.kernel.getObject("source"), controller: "A", kind: "activated", speed: "normal", body: [
    { id: "gain", op: "effect.xp", args: { amount: c(1) } },
    { id: "pause", op: "choice.optional", args: { body: c([{ id: "reward", op: "effect.draw", args: { amount: c(1) } }]) } },
  ] });
  let pending;
  assert.throws(() => settle(f.engine), error => { pending = error.request; return error instanceof AwaitChoice; });
  assert.equal(f.kernel.player("A").xp, 0);
  assert.equal(f.snapshot("source").might, 4);
  f.answers.set(pending.id, true);
  settle(f.engine);
  assert.equal(f.kernel.player("A").xp, 1);
  assert.equal(f.kernel.getObject("reward").zone, "hand");
  assert.equal(f.context().history({ scope: "turn", timingPoint: "xp-gained", player: "A" }), 1);
  assert.equal(f.engine.commit({ type: "gain-xp", player: "A", amount: 1 }).status, "done");
  assert.equal(f.engine.commit({ type: "spend-xp", player: "A", amount: 2 }).status, "done");
  assert.equal(f.kernel.player("A").xp, 0);
  assert.equal(f.snapshot("source").might, 5, "history survives spending the resource");
  assert.ok(f.snapshot("source").keywords.some(keyword => keyword.id.toLowerCase() === "ganking"));
  assert.equal(f.engine.commit({ type: "take-control", object: f.kernel.ref("source"), player: "B" }).status, "done");
  assert.equal(f.snapshot("source").might, 4, "static reads the source's current controller");
  assert.equal(f.engine.commit({ type: "gain-xp", player: "B", amount: 1 }).status, "done");
  assert.equal(f.snapshot("source").might, 5);
  assert.equal(wilyNewtfish.status, "judge-required");
});

test("original Raging Soul gate reads discarded event snapshots after recycling, without counting opponents", () => {
  const f = runtime(world().unit("source", { cardId: ragingSoul.canonicalCardId, might: 2 })
    .hand("own").hand("enemy", { owner: "B" }), [ragingSoul]);
  f.enter("source");
  const keywords = () => f.snapshot("source").keywords.map(keyword => keyword.id.toLowerCase()).sort();
  assert.deepEqual(keywords(), []);
  assert.equal(f.engine.commit({ type: "discard", object: f.kernel.ref("enemy") }).status, "done");
  const enemyDiscard = f.engine.pipeline.events.find(event => event.timingPoint === "card-discarded" && event.object?.ref.id === "enemy");
  assert.equal(enemyDiscard.object.controller, "B", "the discard snapshot identifies the player whose Hand card moved");
  assert.equal(f.context("source", "A").history({ scope: "turn", timingPoint: "card-discarded", player: "A" }), 0);
  assert.equal(f.context("source", "B").history({ scope: "turn", timingPoint: "card-discarded", player: "B" }), 1);
  assert.deepEqual(keywords(), []);
  assert.equal(f.engine.commit({ type: "take-control", object: f.kernel.ref("source"), player: "B" }).status, "done");
  assert.deepEqual(keywords(), ["assault", "ganking"]);
  assert.equal(f.engine.commit({ type: "take-control", object: f.kernel.ref("source"), player: "A" }).status, "done");
  assert.deepEqual(keywords(), []);
  assert.equal(f.engine.commit({ type: "discard", object: f.kernel.ref("own") }).status, "done");
  assert.equal(f.engine.commit({ type: "recycle", object: f.kernel.ref("own") }).status, "done");
  assert.deepEqual(keywords(), ["assault", "ganking"]);
  assert.equal(f.engine.commit({ type: "take-control", object: f.kernel.ref("source"), player: "B" }).status, "done");
  assert.deepEqual(keywords(), ["assault", "ganking"]);
  assert.equal(ragingSoul.status, "judge-required");
});

test("historical death filters keep event identities and captured characteristics after re-entry", () => {
  const f = runtime(world().unit("source").unit("enemy", { owner: "B" }));
  const dead = f.kernel.ref("enemy");
  const context = f.context();
  const count = () => resolveChainBody([read("deaths", history("units-died-this-turn", { type: "unit", controller: "opponent" }))], context).linkedValues["deaths.value"];
  assert.equal(count(), 0);
  assert.equal(f.engine.commit({ type: "kill", object: dead }).status, "done");
  assert.equal(f.engine.commit({ type: "move-zone", object: f.kernel.ref("enemy"), to: "base", location: { type: "base", player: "B" } }).status, "done");
  assert.equal(f.engine.commit({ type: "take-control", object: f.kernel.ref("enemy"), player: "A" }).status, "done");
  assert.equal(count(), 1);
  assert.equal(context.history({ scope: "game", timingPoint: "object-killed", object: dead }), 1);
  assert.equal(context.history({ scope: "game", timingPoint: "object-killed", object: f.kernel.ref("enemy") }), 0);
  f.kernel.setPicks("exclude", [f.kernel.ref("enemy")]);
  assert.equal(context.history({ scope: "game", timingPoint: "object-killed", exclude: { pick: "exclude" } }), 0);
});

test("main turn leaves follow full TurnFlow turns and reset event windows without clearing old history", () => {
  const f = turnFixture();
  const context = bindEventHistory(f.kernel, f.flow.chain.pipeline);
  const counts = () => resolveChainBody([read("global", { kind: "turn-number" }), read("own", { kind: "player-turn-count" }),
    read("other", { kind: "player-turn-count", player: { id: "B" } }), read("drawn", history("cards-drawn-this-turn"))], context).linkedValues;
  assert.equal(counts()["global.value"], 0);
  f.flow.start();
  assert.equal(counts()["global.value"], 1);
  assert.equal(counts()["drawn.value"], 1);
  f.flow.endTurn("A");
  assert.equal(counts()["drawn.value"], 0);
  f.flow.endTurn("B");
  f.flow.endTurn("A");
  f.flow.endTurn("B");
  assert.deepEqual([counts()["global.value"], counts()["own.value"], counts()["other.value"]], [5, 3, 2]);
  assert.equal(counts()["drawn.value"], 1);
  assert.equal(context.history({ scope: "game", timingPoint: "card-drawn", player: "A" }), 3);
});

test("unknown predicates stay unavailable through negation and do not authorize effects", () => {
  const f = runtime(world().unit("source"));
  for (const condition of [{ kind: "unreviewed-official-condition" }, { kind: "not", condition: { kind: "unreviewed-official-condition" } },
    { kind: "not", condition: { kind: "compare", left: history("energy-spent-on-spells-this-turn"), operator: "gte", right: c(1) } }]) {
    assert.throws(() => evaluateCondition(condition, environment(f.context())), MissingInformation);
    const result = resolveChainBody([{ id: "guard", op: "effect.xp", args: { amount: c(1) }, condition }], f.context());
    assert.equal(result.results[0].result.status, "ignored");
    assert.equal(f.kernel.player("A").xp, 0);
  }
});

test("main condition dispatcher uses the merged event-it and relation predicates", () => {
  const f = runtime(world().unit("source").unit("other", { owner: "B" }));
  const condition = { kind: "all", conditions: [{ kind: "event-it", object: "it" },
    { kind: "relation", relation: "different-controller", left: "it", right: "source" }] };
  const result = resolveChainBody([{ id: "xp", op: "effect.xp", args: { amount: c(1) }, condition }], f.context(),
    { event: { source: f.kernel.getObject("source"), it: f.kernel.getObject("other") } });
  assert.equal(result.results[0].result.status, "executed");
  assert.equal(f.kernel.player("A").xp, 1);
});
