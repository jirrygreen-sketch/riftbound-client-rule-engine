import assert from "node:assert/strict";
import test from "node:test";

import thermoBeam from "../../../card-dsl/dist/cards/ogn/thermo-beam.js";
import { AwaitChoice } from "../../dist/effects/contract.js";
import { resolveChainBody } from "../../dist/chain/interpreter-adapter.js";
import { ChainEngine } from "../../dist/chain/engine.js";
import { bindResolveContext, createActionPipelineHost } from "../../dist/events/action-adapter.js";
import { runInstruction, world } from "../../dist/effects/testing/index.js";
import { createProgramBinding } from "../../dist/programs/index.js";
import kill from "../../dist/effects/instructions/effect.kill.js";

const constant = value => ({ kind: "constant", value });
const field = id => ({ type: "battlefield", id });
const base = player => ({ type: "base", player });
const admittedThermoBeam = {
  ...thermoBeam,
  status: "executable",
  judgeReason: undefined,
};

function scenario(program, options = {}) {
  const builder = world();
  builder.player("A", { energy: options.energy ?? 0, power: options.power ?? [] });
  builder.player("B");
  builder.deck(["A:deck:1", "A:deck:2"], { owner: "A" });
  builder.deck(["B:deck:1", "B:deck:2"], { owner: "B" });
  options.setup?.(builder);
  const kernel = builder.build();
  const answers = new Map(Object.entries(options.answers ?? {}));
  const asked = [];
  const choose = request => {
    asked.push(request);
    if (answers.has(request.id)) return answers.get(request.id);
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
  const binding = createProgramBinding({ cardPrograms: [program] });
  const engine = new ChainEngine({
    turnOrder: ["A", "B"],
    turnPlayer: "A",
    phase: "main",
    host,
    cleanup: () => false,
    describePlay: binding.describePlay,
  });
  const play = () => engine.execute(binding.describePlay({
    type: "play",
    player: "A",
    object: kernel.ref("spell"),
  }, kernel.getObject("spell")));
  return { kernel, engine, binding, answers, asked, play };
}

function settle(engine) {
  let guard = 0;
  while (engine.items.length > 0) {
    assert.ok(++guard < 20, "the real chain must settle");
    engine.pass(engine.priority);
  }
}

function addSpell(builder, cardId, energy = 0, power = []) {
  builder.hand("spell", { cardId, types: ["spell"], energy, power });
}

test("EG-KILL raw Thermo Beam IR executes a single untargeted gear query without targeting", () => {
  const f = scenario(admittedThermoBeam, {
    energy: 5,
    power: ["Fury", "Fury"],
    setup(builder) {
      addSpell(builder, admittedThermoBeam.canonicalCardId);
      builder.unit("gear", { types: ["gear"], might: null, energy: null, power: null, location: base("A") });
      builder.unit("unit", { location: field("bf") });
    },
  });
  f.play();
  settle(f.engine);

  assert.equal(f.kernel.getObject("gear").zone, "trash");
  assert.equal(f.kernel.getObject("unit").zone, "board");
  assert.equal(f.asked.length, 0, "355.10.d: the characteristic query never asks for a target or choice");
  assert.equal(f.engine.pipeline.events.some(event => event.timingPoint === "became-target"), false);
  const killed = f.engine.pipeline.events.filter(event => event.timingPoint === "object-killed");
  assert.equal(killed.length, 1);
  assert.equal(killed[0].object.ref.id, "gear");
  assert.equal(killed[0].details.responsiblePlayerId, "A");
});

test("EG-KILL raw Thermo Beam IR fails closed when the current query has two gears", () => {
  const f = scenario(admittedThermoBeam, {
    energy: 5,
    power: ["Fury", "Fury"],
    setup(builder) {
      addSpell(builder, admittedThermoBeam.canonicalCardId);
      builder.unit("gear-a", { types: ["gear"], might: null, location: base("A") });
      builder.unit("gear-b", { types: ["gear"], owner: "B", controller: "B", might: null, location: base("B") });
    },
  });
  f.play();
  settle(f.engine);

  assert.equal(f.kernel.getObject("gear-a").zone, "board");
  assert.equal(f.kernel.getObject("gear-b").zone, "board");
  assert.equal(f.engine.pipeline.events.filter(event => event.timingPoint === "object-killed").length, 0);
  assert.equal(f.engine.items.length, 0);
});

test("EG-KILL query selection resolves current candidates and records an empty query as executed", () => {
  const kernel = world().unit("source").unit("unit", { types: ["unit"] }).build();
  const run = runInstruction(kill, {
    objects: constant({ kind: "query", filter: { type: "gear", zone: "board" } }),
  }, { world: kernel });

  assert.equal(run.result.status, "executed");
  assert.deepEqual(run.result.events, []);
  assert.deepEqual(run.linked.killed, []);
  assert.equal(kernel.getObject("unit").zone, "board");
});

test("EG-KILL linked selection preserves the bound identity and never rebinds a stale reference", () => {
  const kernel = world()
    .unit("source")
    .unit("victim", { owner: "B", controller: "B" })
    .build();
  const victim = kernel.ref("victim");
  kernel.link("previous.victim", victim);
  const result = resolveChainBody([{
    id: "kill-linked",
    op: "effect.kill",
    args: { objects: constant({ linked: "previous.victim" }) },
  }], bindResolveContext(kernel, {
    source: kernel.getObject("source"),
    controller: "A",
    timingPoint: "main-start",
    linked: key => kernel.linked(key),
  }));

  assert.equal(result.results[0].result.status, "executed");
  assert.equal(kernel.getObject("victim").zone, "trash");
  assert.deepEqual(result.linkedValues["kill-linked.killed"], [victim]);

  const staleWorld = world().unit("source").unit("victim", { owner: "B", controller: "B" }).build();
  const stale = staleWorld.ref("victim");
  assert.equal(staleWorld.perform({ type: "return-to-hand", object: stale }).status, "done");
  const staleRun = runInstruction(kill, { objects: constant({ linked: "previous.victim" }) }, {
    world: staleWorld,
    linked: { "previous.victim": stale },
  });
  assert.deepEqual(staleRun.result, { status: "ignored", reason: "mistargeted" });
  assert.equal(staleWorld.getObject("victim").zone, "hand");
});

test("EG-KILL accepts the card IR linked key spelling and reads the keyed result", () => {
  const kernel = world().unit("source").unit("victim", { owner: "B", controller: "B" }).build();
  const victim = kernel.ref("victim");
  kernel.link("replacement.object", victim);
  const run = runInstruction(kill, {
    objects: constant({ kind: "linked", key: "replacement.object" }),
  }, { world: kernel });

  assert.equal(run.result.status, "executed");
  assert.equal(kernel.getObject("victim").zone, "trash");
  assert.deepEqual(run.linked.killed, [victim]);
});

test("EG-KILL invalid selectors and mixed sources are rejected before execution", () => {
  assert.throws(() => kill.argsSchema.parse({ objects: constant({ kind: "query", filter: {} }), target: "t" }), /cannot be combined/);
  const kernel = world().unit("source").unit("gear", { types: ["gear"] }).build();
  assert.throws(() => runInstruction(kill, { objects: constant({ kind: "query" }) }, { world: kernel }), /query selection requires/);
  assert.throws(() => runInstruction(kill, { objects: constant({ kind: "linked" }) }, { world: kernel }), /non-empty id/);
});

test("EG-KILL a replacement rejects the original query kill without an object-killed event", () => {
  const kernel = world().unit("source").unit("gear", { types: ["gear"] }).build();
  kernel.addReplacement(action => action.type === "kill" ? "replaced" : null);
  const before = kernel.snapshot();
  const run = runInstruction(kill, {
    objects: constant({ kind: "query", filter: { type: "gear", zone: "board" } }),
  }, { world: kernel });

  assert.deepEqual(run.result, { status: "negated", reason: "replaced", events: run.result.events });
  assert.equal(run.events.some(event => event.action === "kill" && event.outcome === "replaced"), true);
  assert.equal(kernel.getObject("gear").zone, "board");
  assert.notDeepEqual(kernel.snapshot(), before);
});

test("EG-KILL a thrown choice rolls the whole query transaction back", () => {
  const kernel = world()
    .unit("source")
    .unit("gear-a", { types: ["gear"] })
    .unit("gear-b", { types: ["gear"] })
    .build();
  const before = kernel.snapshot();
  const links = kernel.linkedSnapshot();
  const run = runInstruction(kill, {
    objects: constant({ kind: "query", filter: { type: "gear", zone: "board" } }),
    count: constant(1),
  }, { world: kernel });

  assert.equal(run.result, null);
  assert.ok(run.asked instanceof AwaitChoice);
  assert.deepEqual(kernel.snapshot(), before);
  assert.deepEqual(kernel.linkedSnapshot(), links);
  assert.equal(kernel.events.length, 0);
});

test("EG-KILL preserves printed null costs on queried objects", () => {
  const kernel = world()
    .unit("source")
    .unit("gear", { types: ["gear"], location: base("A") })
    .build();
  // WorldBuilder applies its legacy defaults; set the printed-null observation
  // through the kernel's public object constructor, not a post-kill mutation.
  kernel.addObject({
    ...kernel.getObject("gear"),
    ref: kernel.ref("gear"),
    might: null,
    energy: null,
    power: null,
  }, "board");
  const before = kernel.getObject("gear");
  assert.equal(before.energy, null);
  assert.equal(before.power, null);
  const run = runInstruction(kill, {
    objects: constant({ kind: "query", filter: { type: "gear", zone: "board" } }),
  }, { world: kernel });
  assert.equal(run.result.status, "executed");
  const lastKnown = kernel.lastKnown(kernel.ref("gear"));
  assert.equal(lastKnown.energy, null);
  assert.equal(lastKnown.power, null);
});
