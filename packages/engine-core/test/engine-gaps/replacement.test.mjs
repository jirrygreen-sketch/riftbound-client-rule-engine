import assert from "node:assert/strict";
import test from "node:test";

import magmaWurm from "../../../card-dsl/dist/cards/ogn/magma-wurm.js";
import unlicensedArmory from "../../../card-dsl/dist/cards/ogn/unlicensed-armory.js";
import zileanTimeMage from "../../../card-dsl/dist/cards/unl/zilean-time-mage.js";
import lotusTrap from "../../../card-dsl/dist/cards/unl/lotus-trap.js";
import smite from "../../../card-dsl/dist/cards/unl/smite.js";
import vayneHunter from "../../../card-dsl/dist/cards/ogn/vayne-hunter.js";
import { AwaitChoice } from "../../dist/effects/contract.js";
import { instructionDefinitionsById } from "../../dist/effects/instructions/registry.generated.js";
import { runInstruction, world } from "../../dist/effects/testing/index.js";
import { bindResolveContext, createActionPipelineHost } from "../../dist/events/action-adapter.js";
import { ChainEngine } from "../../dist/chain/engine.js";
import { bindReplacement, BlockedReplacementError, planReplacementBody } from "../../dist/replacement/index.js";

const c = value => ({ kind: "constant", value });
const field = id => ({ type: "battlefield", id });

function runtime(builder, choose = undefined) {
  const kernel = builder.build();
  const asked = [];
  const decide = request => {
    asked.push(request);
    const answer = choose?.(request);
    if (answer !== undefined) return answer;
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
    choose: decide,
    context: (source, controller, timingPoint) => bindResolveContext(kernel, {
      source, controller, timingPoint, choose: decide
    })
  });
  const engine = new ChainEngine({
    turnOrder: ["A", "B"], turnPlayer: "A", phase: "main", host, cleanup: () => false
  });
  return { kernel, engine, host, asked };
}

function deps(f) {
  return {
    host: {
      object: ref => f.kernel.object(ref),
      objects: () => f.kernel.objects,
      context: (source, controller) => f.host.context(source, controller, "cleanup-start")
    },
    pipeline: f.engine.pipeline
  };
}

function originalEntryUnit(kernel, id, overrides = {}) {
  return kernel.addObject({
    ref: { id, zoneEntryId: 1 },
    cardId: `card:${id}`,
    name: id,
    types: ["unit"],
    tags: [],
    keywords: [],
    owner: overrides.owner ?? "A",
    controller: overrides.controller ?? "A",
    zone: "chain",
    location: null,
    might: 2,
    energy: 0,
    power: null,
    exhausted: true,
    damage: 0,
    stunned: false,
    buffs: 0,
    attachedTo: null,
    faceDown: false,
    isToken: false,
    ...overrides
  });
}

test("EG-REPLACEMENT registers the new multiplier boundary and keeps copy-plus-play fail-closed", () => {
  assert.equal(instructionDefinitionsById.get("replacement.damage-multiplier")?.op, "replacement.damage-multiplier");
  assert.equal(instructionDefinitionsById.get("replacement.play-with-additional-copy")?.op, "replacement.play-with-additional-copy");

  const kernel = world().player("A").unit("token", { isToken: true }).build();
  kernel.setAnswers({ "optional": true });
  const additional = zileanTimeMage.abilities[0].with[0];
  assert.throws(
    () => runInstruction(
      instructionDefinitionsById.get("replacement.play-with-additional-copy"),
      additional.args,
      { world: kernel, linked: { "replacement.object": kernel.ref("token") } }
    ),
    error => error instanceof BlockedReplacementError && /no original play is executed/.test(error.message)
  );
  assert.equal(kernel.getObject("token").zone, "board");
  assert.equal(kernel.events.some(event => event.action === "play"), false);
});

test("EG-REPLACEMENT original Lotus Trap multiplier executes through the default registry and expires", () => {
  const f = runtime(world().player("A").player("B")
    .unit("source", { cardId: lotusTrap.canonicalCardId, might: 2 })
    .unit("chosen", { owner: "B", controller: "B", might: 8 })
    .unit("other", { owner: "B", controller: "B", might: 8 }));
  f.kernel.setTargets("lotus-trap.unit", [f.kernel.ref("chosen")]);
  const instruction = lotusTrap.abilities.find(ability => ability.kind === "play").body[0];
  const context = bindResolveContext(f.host.context(f.kernel.getObject("source"), "A", "chain-item-resolve"), {
    replacement: deps(f)
  });
  const definition = instructionDefinitionsById.get(instruction.op);
  const run = definition.execute(context, definition.argsSchema.parse(instruction.args));
  assert.equal(run.status, "executed");
  assert.equal(run.linkedValues.multiplier, 2);

  assert.equal(f.engine.commit({
    type: "damage", source: f.kernel.ref("source"), target: f.kernel.ref("other"), amount: 2, combat: false
  }).status, "done");
  assert.equal(f.kernel.getObject("other").damage, 2);
  assert.equal(f.engine.commit({
    type: "damage", source: f.kernel.ref("source"), target: f.kernel.ref("chosen"), amount: 2, combat: false
  }).status, "replaced");
  assert.equal(f.kernel.getObject("chosen").damage, 4);

  // The target left and re-entered: the original incarnation cannot inherit
  // the pending multiplier.
  f.engine.commit({ type: "move-zone", object: f.kernel.ref("chosen"), to: "base", location: { type: "base", player: "B" } });
  assert.notEqual(f.kernel.ref("chosen").zoneEntryId, 1);
  assert.equal(f.engine.commit({
    type: "damage", source: f.kernel.ref("source"), target: f.kernel.ref("chosen"), amount: 2, combat: false
  }).status, "done");
  assert.equal(f.kernel.getObject("chosen").damage, 6);

  f.engine.pipeline.clock.turn += 1;
  assert.equal(f.engine.commit({
    type: "damage", source: f.kernel.ref("source"), target: f.kernel.ref("chosen"), amount: 1, combat: false
  }).status, "done");
  assert.equal(f.kernel.getObject("chosen").damage, 7);
});

test("EG-REPLACEMENT original Smite constant instead banishes a successful death", () => {
  const f = runtime(world().player("A").player("B")
    .unit("smite", { cardId: smite.canonicalCardId, types: ["spell"], might: null })
    .unit("victim", { owner: "B", controller: "B", might: 4 }));
  f.kernel.setTargets("smite.unit", [f.kernel.ref("victim")]);
  const registration = smite.abilities.find(ability => ability.kind === "play").body[1];
  const context = bindResolveContext(f.host.context(f.kernel.getObject("smite"), "A", "chain-item-resolve"), {
    replacement: deps(f)
  });
  const eventDef = instructionDefinitionsById.get("replacement.event");
  const registered = eventDef.execute(context, eventDef.argsSchema.parse(registration.args));
  assert.equal(registered.status, "executed");

  const current = f.kernel.ref("victim");
  assert.equal(f.engine.commit({ type: "kill", object: current }).status, "replaced");
  assert.equal(f.kernel.getObject("victim").zone, "banishment");
});

test("EG-REPLACEMENT original Smite stale target cannot be revived or consume the pending replacement", () => {
  const f = runtime(world().player("A").player("B")
    .unit("smite", { cardId: smite.canonicalCardId, types: ["spell"], might: null })
    .unit("victim", { owner: "B", controller: "B", might: 4 }));
  f.kernel.setTargets("smite.unit", [f.kernel.ref("victim")]);
  const registration = smite.abilities.find(ability => ability.kind === "play").body[1];
  const context = bindResolveContext(f.host.context(f.kernel.getObject("smite"), "A", "chain-item-resolve"), {
    replacement: deps(f)
  });
  const eventDef = instructionDefinitionsById.get("replacement.event");
  eventDef.execute(context, eventDef.argsSchema.parse(registration.args));

  const stale = f.kernel.ref("victim");
  assert.equal(f.engine.commit({ type: "return-to-hand", object: stale }).status, "done");
  const afterMove = f.kernel.stateForTest();
  assert.equal(f.engine.commit({ type: "kill", object: stale }).status, "impossible");
  const afterStale = f.kernel.stateForTest();
  assert.deepEqual(afterStale.objects, afterMove.objects);
  assert.deepEqual(afterStale.players, afterMove.players);
  assert.deepEqual(afterStale.history, afterMove.history);
  assert.equal(afterStale.events.length, afterMove.events.length + 1);
  assert.equal(afterStale.events.at(-1).outcome, "impossible");
  assert.equal(f.kernel.getObject("victim").zone, "hand");

  const reentered = f.kernel.ref("victim");
  assert.equal(f.engine.commit({
    type: "move-zone", object: reentered, to: "battlefield", location: field("bf-1")
  }).status, "done");
  const current = f.kernel.ref("victim");
  assert.equal(f.engine.commit({ type: "kill", object: current }).status, "done");
  assert.equal(f.kernel.getObject("victim").zone, "trash");
});

test("EG-REPLACEMENT original Magma Wurm constant instead readies another friendly entry", () => {
  const f = runtime(world().player("A").player("B")
    .base("wurm", { cardId: magmaWurm.canonicalCardId, controller: "A", owner: "A" }));
  const bound = bindReplacement(magmaWurm.abilities[0], f.kernel.ref("wurm"), deps(f));
  assert.equal(bound.registration.optional, undefined);

  const entering = originalEntryUnit(f.kernel, "ally");
  const outcome = f.engine.commit({ type: "move-zone", object: entering, to: "base", location: { type: "base", player: "A" } });
  assert.equal(outcome.status, "replaced");
  assert.equal(f.kernel.getObject("ally").zone, "board");
  assert.equal(f.kernel.getObject("ally").exhausted, false);
  assert.equal(f.engine.pipeline.events.some(event => event.timingPoint === "object-readied"), false);

  const enemy = originalEntryUnit(f.kernel, "enemy", { owner: "B", controller: "B" });
  assert.equal(f.engine.commit({ type: "move-zone", object: enemy, to: "base", location: { type: "base", player: "B" } }).status, "done");
  assert.equal(f.kernel.getObject("enemy").exhausted, true);
});

test("EG-REPLACEMENT original Vayne replacement.enter is condition-gated on the entering incarnation", () => {
  const f = runtime(world().player("A").player("B").base("vayne", { cardId: vayneHunter.canonicalCardId, controller: "A" }));
  const ability = vayneHunter.abilities.find(candidate => candidate.kind === "replacement");
  const falseCondition = {
    kind: "compare", operator: "eq",
    left: { kind: "constant", value: 1 }, right: { kind: "constant", value: 2 }
  };
  bindReplacement({ ...ability, condition: falseCondition }, f.kernel.ref("vayne"), deps(f));
  const entering = originalEntryUnit(f.kernel, "vayne", { cardId: vayneHunter.canonicalCardId });
  assert.equal(f.engine.commit({ type: "move-zone", object: entering, to: "base", location: { type: "base", player: "A" } }).status, "done");
  assert.equal(f.kernel.getObject("vayne").exhausted, true);
});

test("EG-REPLACEMENT original Unlicensed Armory rejects Recall at bind before any death is replaced", () => {
  const f = runtime(world().player("A", { energy: 2, power: ["Fury"] }).player("B")
    .unit("armory", { cardId: unlicensedArmory.canonicalCardId, types: ["unit"], might: 2 })
    .unit("victim", { owner: "A", controller: "A", might: 3 }));
  f.kernel.setTargets("unlicensed-armory.friendly-unit", [f.kernel.ref("victim")]);
  const trigger = unlicensedArmory.abilities.find(ability => ability.kind === "activated").body[0];
  const context = bindResolveContext(f.host.context(f.kernel.getObject("armory"), "A", "chain-item-resolve"), {
    replacement: deps(f)
  });
  const eventDef = instructionDefinitionsById.get("replacement.event");
  assert.throws(
    () => eventDef.execute(context, eventDef.argsSchema.parse(trigger.args)),
    error => error instanceof BlockedReplacementError && /Recall/.test(error.message)
  );
  assert.equal(f.engine.commit({ type: "kill", object: f.kernel.ref("victim") }).status, "done");
  assert.equal(f.kernel.getObject("victim").zone, "trash");
  assert.equal(f.kernel.player("A").energy, 2);
});

test("EG-REPLACEMENT replacement.event exposes optional and charges only the accepted branch", () => {
  let accept = false;
  const f = runtime(world().player("A", { energy: 2, power: ["Fury"] }).player("B")
    .unit("armory", { types: ["unit"], might: 2 })
    .unit("victim", { owner: "A", controller: "A", might: 3 }), request => {
    if (request.type === "optional") return accept;
    return undefined;
  });
  const context = bindResolveContext(f.host.context(f.kernel.getObject("armory"), "A", "chain-item-resolve"), {
    replacement: deps(f)
  });
  const eventDef = instructionDefinitionsById.get("replacement.event");
  const run = eventDef.execute(context, eventDef.argsSchema.parse({
    event: c({ event: "object-killed", filter: { objectId: "victim" } }),
    window: c("next-time-this-turn"),
    optional: c(true),
    cost: c({ power: 1, domain: "Fury" }),
    instead: c([{ id: "replacement-banish", op: "effect.banish", args: {
      objects: c({ linked: "replacement.object" })
    } }])
  }));
  assert.equal(run.status, "executed");

  assert.equal(f.engine.commit({ type: "kill", object: f.kernel.ref("victim") }).status, "done");
  assert.equal(f.kernel.getObject("victim").zone, "trash");
  assert.equal(f.kernel.player("A").energy, 2);

  accept = true;
  // A separate production world and pipeline keeps each declaration's stable
  // host-incarnation id distinct while exercising the same accepted branch.
  const accepted = runtime(world().player("A", { energy: 2, power: ["Fury"] }).player("B")
    .unit("armory", { types: ["unit"], might: 2 })
    .unit("second", { owner: "A", controller: "A", might: 3 }), request => {
    if (request.type === "optional") return true;
    return undefined;
  });
  const acceptedContext = bindResolveContext(accepted.host.context(accepted.kernel.getObject("armory"), "A", "chain-item-resolve"), {
    replacement: deps(accepted)
  });
  instructionDefinitionsById.get("replacement.event").execute(acceptedContext, instructionDefinitionsById.get("replacement.event").argsSchema.parse({
    event: c({ event: "object-killed", filter: { objectId: "second" } }),
    window: c("next-time-this-turn"),
    optional: c(true),
    cost: c({ power: 1, domain: "Fury" }),
    instead: c([{ id: "replacement-banish-second", op: "effect.banish", args: {
      objects: c({ linked: "replacement.object" })
    } }])
  }));
  assert.equal(accepted.engine.commit({ type: "kill", object: accepted.kernel.ref("second") }).status, "replaced");
  assert.equal(accepted.kernel.getObject("second").zone, "banishment");
  assert.equal(accepted.kernel.player("A").energy, 2);
  assert.equal(accepted.kernel.player("A").power.includes("Fury"), false);
});

test("EG-REPLACEMENT original selectors distinguish target, pick, linked, query, choose, source", () => {
  const f = runtime(world().player("A").player("B")
    .unit("host")
    .unit("target")
    .unit("picked")
    .unit("linked")
    .unit("chosen")
    .unit("enemy", { owner: "B", controller: "B" }), request => {
    if (request.id === "select-one") return [f.kernel.ref("chosen")];
    return undefined;
  });
  f.kernel.setTargets("target-spec", [f.kernel.ref("target")]);
  f.kernel.setPicks("pick-spec", [f.kernel.ref("picked")]);
  f.kernel.link("prior.objects", [{ id: "linked", zoneEntryId: 1 }]);
  const planner = {
    host: deps(f).host,
    controller: "A",
    evaluate: expr => f.kernel.evaluate(expr),
    context: bindResolveContext(f.host.context(f.kernel.getObject("host"), "A", "cleanup-start"), {
      choose: request => f.host.choose(request)
    })
  };
  const plan = selector => planReplacementBody([{
    id: `selector-${selector.kind ?? selector}`, op: "effect.ready", args: { objects: c(selector) }
  }], { hostRef: f.kernel.ref("host"), replacedObject: f.kernel.ref("target"), usedWindow: false }, planner);

  assert.deepEqual(plan({ kind: "source" }).map(action => action.object.id), ["host"]);
  assert.deepEqual(plan({ target: "target-spec" }).map(action => action.object.id), ["target"]);
  assert.deepEqual(plan({ pick: "pick-spec" }).map(action => action.object.id), ["picked"]);
  assert.deepEqual(plan({ linked: "prior.objects" }).map(action => action.object.id), ["linked"]);
  assert.deepEqual(plan({ kind: "linked", key: "prior.objects" }).map(action => action.object.id), ["linked"]);
  assert.deepEqual(plan({ kind: "query", filter: { type: "unit", controller: "opponent" } }).map(action => action.object.id), ["enemy"]);
  assert.deepEqual(plan({ kind: "choose", id: "select-one", filter: { type: "unit", controller: "self" }, min: 1, max: 1 }).map(action => action.object.id), ["chosen"]);
  assert.throws(
    () => plan({ kind: "choose", id: "illegal", filter: { type: "unit" }, min: 1, max: 1 }),
    error => error instanceof AwaitChoice
  );
});

test("EG-REPLACEMENT an empty non-target query yields zero actions without weakening stale references", () => {
  const f = runtime(world().player("A").unit("host"));
  const planner = {
    host: deps(f).host,
    controller: "A",
    evaluate: expr => f.kernel.evaluate(expr),
    context: f.host.context(f.kernel.getObject("host"), "A", "cleanup-start")
  };
  assert.deepEqual(
    planReplacementBody([{
      id: "empty-query", op: "effect.kill",
      args: { objects: c({ kind: "query", filter: { type: "gear", zone: "board" } }) }
    }], { hostRef: f.kernel.ref("host"), replacedObject: null, usedWindow: false }, planner),
    []
  );
});

test("EG-REPLACEMENT Deathknell removal half is kept distinct from pre-execution kill replacement", async () => {
  const { fixture } = await import("../rules/keywords/support.mjs");
  const f = fixture({ programs: [{
    canonicalCardId: "test:deathknell-removal-half",
    rulesetVersion: "core-1.5",
    status: "executable",
    sourceText: "[Deathknell][>] Draw 1.",
    abilities: [{ kind: "play", cost: { kind: "printed" }, body: [] }]
  }], setup: builder => builder.unit("victim", {
    cardId: "test:deathknell-removal-half",
    keywords: [{ id: "Deathknell" }]
  }) });
  f.binding.registerProgramTriggers(f.engine, f.get("victim"));

  assert.equal(f.engine.commit({ type: "kill", object: f.ref("victim") }).status, "done");
  assert.equal(f.engine.items.length, 1);
  assert.equal(f.get("victim").zone, "trash");
  assert.ok(f.engine.trace.some(entry => entry.step === "pending" && entry.item.startsWith("trigger:")));
  assert.equal(f.engine.trace.some(entry => entry.step === "removed" && entry.reason === "death-replaced"), false);
});

test("EG-REPLACEMENT empty set selectors execute as zero actions while target/pick selectors fail closed", () => {
  const f = runtime(world().player("A").unit("host"));
  const planner = {
    host: deps(f).host,
    controller: "A",
    evaluate: expr => f.kernel.evaluate(expr),
    context: f.host.context(f.kernel.getObject("host"), "A", "cleanup-start")
  };
  const emptyQuery = selector => planReplacementBody([{
    id: "empty-query", op: "effect.ready", args: { objects: c(selector) }
  }], { hostRef: f.kernel.ref("host"), replacedObject: null, usedWindow: false }, planner);
  assert.deepEqual(emptyQuery({ kind: "query", filter: { type: "gear", zone: "board" } }), []);
  assert.deepEqual(emptyQuery({ kind: "choose", id: "no-options", filter: { type: "gear" }, min: 0, max: 1 }), []);
  assert.throws(
    () => planReplacementBody([{
      id: "missing-target", op: "effect.ready", args: { objects: c({ target: "missing" }) }
    }], { hostRef: f.kernel.ref("host"), replacedObject: null, usedWindow: false }, planner),
    error => error instanceof BlockedReplacementError && /target has no current object/.test(error.message)
  );
});

test("EG-REPLACEMENT phase-procedure remains fail-closed instead of approximating a draw action", () => {
  const f = runtime(world().player("A").unit("host"));
  const eventDef = instructionDefinitionsById.get("replacement.event");
  assert.throws(
    () => eventDef.execute(f.host.context(f.kernel.getObject("host"), "A", "chain-item-resolve"), {
      event: c({ event: "phase-procedure", procedure: "draw", player: "self" }),
      instead: c([])
    }),
    error => error instanceof BlockedReplacementError && /Unsupported replacement.event event/.test(error.message)
  );
});
