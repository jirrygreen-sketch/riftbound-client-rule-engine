import assert from "node:assert/strict";
import test from "node:test";

import magmaWurm from "../../../card-dsl/dist/cards/ogn/magma-wurm.js";
import unlicensedArmory from "../../../card-dsl/dist/cards/ogn/unlicensed-armory.js";
import zileanTimeMage from "../../../card-dsl/dist/cards/unl/zilean-time-mage.js";
import lotusTrap from "../../../card-dsl/dist/cards/unl/lotus-trap.js";
import smite from "../../../card-dsl/dist/cards/unl/smite.js";
import vayneHunter from "../../../card-dsl/dist/cards/ogn/vayne-hunter.js";
import theBoss from "../../../card-dsl/dist/cards/ogn/the-boss.js";
import voidHatchling from "../../../card-dsl/dist/cards/sfd/void-hatchling.js";
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

test("EG-REPLACEMENT original Unlicensed Armory blocks mixed cost/Recall before any event is replaced", () => {
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
    error => error instanceof BlockedReplacementError && /atomic replacement-action batch/.test(error.message)
  );
  assert.equal(f.engine.commit({ type: "kill", object: f.kernel.ref("victim") }).status, "done");
  assert.equal(f.kernel.getObject("victim").zone, "trash");
  assert.equal(f.kernel.player("A").energy, 2);
});

test("EG-REPLACEMENT replacement.event exposes optional cost but blocks a non-atomic mixed body", () => {
  const f = runtime(world().player("A", { energy: 2, power: ["Fury"] }).player("B")
    .unit("armory", { types: ["unit"], might: 2 })
    .unit("victim", { owner: "A", controller: "A", might: 3 }));
  const context = bindResolveContext(f.host.context(f.kernel.getObject("armory"), "A", "chain-item-resolve"), {
    replacement: deps(f)
  });
  const eventDef = instructionDefinitionsById.get("replacement.event");
  const before = f.kernel.stateForTest();
  assert.throws(
    () => eventDef.execute(context, eventDef.argsSchema.parse({
      event: c({ event: "object-killed", filter: { objectId: "victim" } }),
      window: c("next-time-this-turn"),
      optional: c(true),
      cost: c({ power: 1, domain: "Fury" }),
      instead: c([{ id: "replacement-banish", op: "effect.banish", args: {
        objects: c({ linked: "replacement.object" })
      } }])
    })),
    error => error instanceof BlockedReplacementError && /atomic replacement-action batch/.test(error.message)
  );
  assert.deepEqual(f.kernel.stateForTest(), before);
  assert.equal(f.kernel.player("A").energy, 2);
  assert.deepEqual(f.kernel.player("A").power, ["Fury"]);
});

test("EG-REPLACEMENT multi-action instead bodies fail closed until the pipeline is atomic", () => {
  const f = runtime(world().player("A").player("B")
    .unit("host")
    .unit("victim", { owner: "B", controller: "B" }));
  const eventDef = instructionDefinitionsById.get("replacement.event");
  const before = f.kernel.stateForTest();
  assert.throws(
    () => eventDef.execute(bindResolveContext(
      f.host.context(f.kernel.getObject("host"), "A", "chain-item-resolve"),
      { replacement: deps(f) }
    ), {
      event: c("object-killed"),
      instead: c([
        { id: "heal-first", op: "effect.heal", args: {
          objects: c({ linked: "replacement.object" }), amount: c(1)
        } },
        { id: "banish-second", op: "effect.banish", args: {
          objects: c({ linked: "replacement.object" })
        } }
      ])
    }),
    error => error instanceof BlockedReplacementError && /atomic replacement-action batch/.test(error.message)
  );
  assert.deepEqual(f.kernel.stateForTest(), before);
  assert.equal(f.engine.pipeline.hasReplacementRegistration("replacement:host:1"), false);
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

test("EG-REPLACEMENT linked selectors expose only ref/array/receipt-objects and keep exact incarnations", () => {
  const f = runtime(world().player("A")
    .unit("host")
    .unit("direct")
    .unit("array")
    .unit("receipt")
    .unit("hidden"));
  const planner = {
    host: deps(f).host,
    controller: "A",
    evaluate: expr => f.kernel.evaluate(expr),
    context: f.host.context(f.kernel.getObject("host"), "A", "cleanup-start")
  };
  f.kernel.link("direct", f.kernel.ref("direct"));
  f.kernel.link("array", [f.kernel.ref("array")]);
  f.kernel.link("receipt", { objects: [f.kernel.ref("receipt")], unrelated: f.kernel.ref("hidden") });
  const plan = key => planReplacementBody([{
    id: `linked-${key}`, op: "effect.ready", args: { objects: c({ linked: key }) }
  }], { hostRef: f.kernel.ref("host"), replacedObject: null, usedWindow: false }, planner)
    .map(action => action.object.id);
  assert.deepEqual(plan("direct"), ["direct"]);
  assert.deepEqual(plan("array"), ["array"]);
  assert.deepEqual(plan("receipt"), ["receipt"]);
  assert.deepEqual(plan("receipt").includes("hidden"), false);

  f.kernel.link("stale", [{ id: "direct", zoneEntryId: 0 }]);
  assert.throws(
    () => plan("stale"),
    error => error instanceof BlockedReplacementError && /no current linked object binding/.test(error.message)
  );
});

test("EG-REPLACEMENT effect.zone mirrors its primitive selector set and keeps multi-action sets fail-closed", () => {
  const f = runtime(world().player("A").player("B")
    .unit("host")
    .unit("linked", { owner: "B", controller: "B" })
    .unit("queried", { owner: "B", controller: "B" })
    .unit("chosen", { owner: "B", controller: "B" }));
  const planner = {
    host: deps(f).host,
    controller: "A",
    evaluate: expr => f.kernel.evaluate(expr),
    context: f.host.context(f.kernel.getObject("host"), "A", "cleanup-start")
  };
  f.kernel.link("prior", [{ id: "linked", zoneEntryId: 1 }]);
  const plan = selector => planReplacementBody([{
    id: "zone-selector", op: "effect.zone",
    args: { objects: c(selector), to: c("hand") }
  }], { hostRef: f.kernel.ref("host"), replacedObject: null, usedWindow: false }, planner);
  assert.deepEqual(plan({ kind: "linked", id: "prior" })
    .map(action => [action.type, action.object.id]), [["return-to-hand", "linked"]]);
  assert.throws(
    () => plan({ kind: "query", filter: { type: "unit", controller: "opponent" } }),
    error => error instanceof BlockedReplacementError && /atomic replacement-action batch/.test(error.message)
  );
  assert.throws(
    () => plan({ kind: "choose", id: "pick-one", filter: { type: "unit" }, min: 1, max: 1 }),
    error => error instanceof BlockedReplacementError && /unsupported selector shape/.test(error.message)
  );
});

test("EG-REPLACEMENT effect.kill consumes picks instead of treating them as targets", () => {
  const f = runtime(world().player("A").player("B")
    .unit("host")
    .unit("picked", { owner: "A", controller: "A" }));
  f.kernel.setPicks("sacrifice", [f.kernel.ref("picked")]);
  const planner = {
    host: deps(f).host,
    controller: "A",
    evaluate: expr => f.kernel.evaluate(expr),
    context: f.host.context(f.kernel.getObject("host"), "A", "cleanup-start")
  };
  const plan = planReplacementBody([{
    id: "kill-picked", op: "effect.kill", args: { picks: c("sacrifice") }
  }], { hostRef: f.kernel.ref("host"), replacedObject: null, usedWindow: false }, planner);
  assert.deepEqual(plan.map(action => [action.type, action.object.id]), [["kill", "picked"]]);
});

test("EG-REPLACEMENT effect.kill mirrors source exclusivity and a bare pick is not a target", () => {
  const f = runtime(world().player("A").player("B")
    .unit("host")
    .unit("picked", { owner: "A", controller: "A" }));
  f.kernel.setTargets("picked", [f.kernel.ref("host")]);
  f.kernel.setPicks("picked", [f.kernel.ref("picked")]);
  const planner = {
    host: deps(f).host,
    controller: "A",
    evaluate: expr => f.kernel.evaluate(expr),
    context: f.host.context(f.kernel.getObject("host"), "A", "cleanup-start")
  };
  const plan = args => planReplacementBody([{
    id: "kill-exclusive", op: "effect.kill", args
  }], { hostRef: f.kernel.ref("host"), replacedObject: null, usedWindow: false }, planner);
  assert.deepEqual(plan({ pick: c("picked") }).map(action => action.object.id), ["picked"]);
  assert.throws(
    () => plan({ target: c("picked"), picks: c("picked") }),
    error => error instanceof BlockedReplacementError && /requires an object selector/.test(error.message)
  );
  assert.throws(
    () => plan({ self: c(true), target: c("picked") }),
    error => error instanceof BlockedReplacementError && /requires an object selector/.test(error.message)
  );
});

test("EG-REPLACEMENT effect.buff mirrors objects, target, pick, query, choose, and source", () => {
  const f = runtime(world().player("A").player("B")
    .unit("host")
    .unit("targeted")
    .unit("picked")
    .unit("queried")
    .unit("chosen")
    .unit("receipt")
    .unit("enemy", { owner: "B", controller: "B" }), request => {
    if (request.id === "buff-choose") return [f.kernel.ref("chosen")];
    return undefined;
  });
  f.kernel.setTargets("buff-target", [f.kernel.ref("targeted")]);
  f.kernel.setPicks("buff-pick", [f.kernel.ref("picked")]);
  f.kernel.link("buff-receipt", { objects: [f.kernel.ref("receipt")] });
  const planner = {
    host: deps(f).host,
    controller: "A",
    evaluate: expr => f.kernel.evaluate(expr),
    context: bindResolveContext(f.host.context(f.kernel.getObject("host"), "A", "cleanup-start"), {
      choose: request => f.host.choose(request)
    })
  };
  const plan = selector => planReplacementBody([{
    id: "buff-selector", op: "effect.buff",
    args: { mode: c("buff"), objects: c(selector) }
  }], { hostRef: f.kernel.ref("host"), replacedObject: null, usedWindow: false }, planner)
    .map(action => [action.type, action.object.id]);

  assert.deepEqual(plan({ kind: "source" }), [["buff", "host"]]);
  assert.deepEqual(plan({ kind: "target", id: "buff-target" }), [["buff", "targeted"]]);
  assert.deepEqual(plan({ kind: "pick", id: "buff-pick" }), [["buff", "picked"]]);
  assert.deepEqual(plan({ kind: "query", filter: { type: "unit", controller: "opponent" } }), [["buff", "enemy"]]);
  assert.deepEqual(plan({ kind: "choose", id: "buff-choose", filter: { type: "unit", controller: "self" }, min: 1, max: 1 }), [["buff", "chosen"]]);
  assert.deepEqual(plan({ linked: "buff-receipt" }), [["buff", "receipt"]]);

  const zeroChoice = planReplacementBody([{
    id: "buff-zero-choice", op: "effect.buff",
    args: { mode: c("buff"), objects: c({ kind: "choose", id: "buff-zero", filter: { type: "gear" } }) }
  }], { hostRef: f.kernel.ref("host"), replacedObject: null, usedWindow: false }, planner);
  assert.deepEqual(zeroChoice, []);
  assert.equal(f.asked.some(request => request.id === "buff-zero"), false);
});

test("EG-REPLACEMENT original The Boss buff/cost body fails closed before partial cost execution", () => {
  const f = runtime(world().player("A", { energy: 0, power: [] }).player("B")
    .base("boss", { cardId: theBoss.canonicalCardId, controller: "A" })
    .unit("victim", { owner: "A", controller: "A", buffs: 1 }));
  const ability = theBoss.abilities.find(candidate => candidate.kind === "replacement");
  const before = f.kernel.stateForTest();
  assert.throws(
    () => bindReplacement(ability, f.kernel.ref("boss"), deps(f)),
    error => error instanceof BlockedReplacementError
  );
  assert.deepEqual(f.kernel.stateForTest(), before);
  assert.equal(f.kernel.getObject("victim").buffs, 1);
});

test("EG-REPLACEMENT original Void Hatchling inspect/optional body stays judge-required", () => {
  const f = runtime(world().player("A").player("B")
    .unit("hatchling", { cardId: voidHatchling.canonicalCardId })
    .deck(["top"], { owner: "A" }));
  const ability = voidHatchling.abilities[0];
  const before = f.kernel.stateForTest();
  assert.throws(
    () => bindReplacement(ability, f.kernel.ref("hatchling"), deps(f)),
    error => error instanceof BlockedReplacementError
  );
  assert.deepEqual(f.kernel.stateForTest(), before);
  assert.equal(f.kernel.zone("A", "deck").length, 1);
});

test("EG-REPLACEMENT replacement filters fail closed on unknown keys and honor host-relative anchors", () => {
  const f = runtime(world().player("A").player("B")
    .unit("host", { location: field("one") })
    .unit("same", { location: field("one") })
    .unit("elsewhere", { location: field("two") }));
  const planner = {
    host: deps(f).host,
    controller: "A",
    evaluate: expr => f.kernel.evaluate(expr),
    context: f.host.context(f.kernel.getObject("host"), "A", "cleanup-start")
  };
  const planBody = selector => planReplacementBody([{
    id: "filtered", op: "effect.ready", args: { objects: c(selector) }
  }], { hostRef: f.kernel.ref("host"), replacedObject: null, usedWindow: false }, planner);
  const plan = selector => planBody(selector).map(action => action.object.id);
  assert.throws(
    () => plan({ kind: "query", filter: {
      type: "unit", controller: "self", sameLocationAs: "self"
    } }),
    error => error instanceof BlockedReplacementError && /atomic replacement-action batch/.test(error.message)
  );
  assert.throws(
    () => plan({ kind: "query", filter: {
      type: "unit", controller: "self", exclude: "self"
    } }),
    error => error instanceof BlockedReplacementError && /atomic replacement-action batch/.test(error.message)
  );
  const query = (filter, id) => planReplacementBody([{
    id, op: "effect.kill", args: { objects: c({ kind: "query", filter }) }
  }], { hostRef: f.kernel.ref("host"), replacedObject: null, usedWindow: false }, {
    ...planner,
    context: bindResolveContext(planner.context, {
      choose: request => request.options[0]
    })
  });
  assert.throws(
    () => query({ type: "unit", controller: "self", sameLocationAs: "self" }, "same-location"),
    error => error instanceof BlockedReplacementError && /atomic Kill batch/.test(error.message)
  );
  assert.throws(
    () => query({ type: "unit", controller: "self", exclude: "self" }, "exclude-self"),
    error => error instanceof BlockedReplacementError && /atomic Kill batch/.test(error.message)
  );
  assert.throws(
    () => plan({ kind: "query", filter: { type: "unit", unsupportedReplacementKey: true } }),
    error => error instanceof BlockedReplacementError && /unsupported filter key/.test(error.message)
  );
});

test("EG-REPLACEMENT bound event filters receive the live host location", () => {
  const f = runtime(world().player("A").player("B")
    .unit("host", { location: field("one") })
    .unit("same", { owner: "B", controller: "B", location: field("one") })
    .unit("elsewhere", { owner: "B", controller: "B", location: field("two") }));
  bindReplacement({
    replaces: { event: "object-killed", filter: { type: "unit", sameLocationAs: "self" } },
    with: [{ id: "banish-same-location", op: "effect.banish", args: {
      objects: c({ linked: "replacement.object" })
    } }]
  }, f.kernel.ref("host"), deps(f));

  assert.equal(f.engine.commit({ type: "kill", object: f.kernel.ref("same") }).status, "replaced");
  assert.equal(f.kernel.getObject("same").zone, "banishment");
  assert.equal(f.engine.commit({ type: "kill", object: f.kernel.ref("elsewhere") }).status, "done");
  assert.equal(f.kernel.getObject("elsewhere").zone, "trash");
});

test("EG-REPLACEMENT effect.token mirrors frozen definitions, exact target location, and null costs", () => {
  const f = runtime(world().player("A").player("B")
    .unit("host")
    .unit("anchor", { owner: "A", controller: "A", location: field("bf-token") }));
  f.kernel.setTargets("token-location", [f.kernel.ref("anchor")]);
  const planner = {
    host: deps(f).host,
    controller: "A",
    evaluate: expr => f.kernel.evaluate(expr),
    context: f.host.context(f.kernel.getObject("host"), "A", "cleanup-start")
  };
  const plan = (token, extra = {}) => planReplacementBody([{
    id: `token-${token}`, op: "effect.token",
    args: { token: c(token), amount: c(1), target: c("token-location"), ...extra }
  }], { hostRef: f.kernel.ref("host"), replacedObject: null, usedWindow: false }, planner);
  const [mech] = plan("mech");
  assert.equal(mech.type, "create-token");
  assert.deepEqual(mech.location, field("bf-token"));
  assert.deepEqual(mech.token, {
    cardId: null, name: "Mech", types: ["unit"], tags: ["Mech"], might: 3, energy: null, power: null
  });
  assert.throws(
    () => plan("gold"),
    error => error instanceof BlockedReplacementError && /judge-required or unsupported/.test(error.message)
  );
  assert.throws(
    () => planReplacementBody([{
      id: "token-opponent-base", op: "effect.token",
      args: { token: c("mech"), amount: c(1), location: c({ type: "base", player: "B" }) }
    }], { hostRef: f.kernel.ref("host"), replacedObject: null, usedWindow: false }, planner),
    error => error instanceof BlockedReplacementError && /Base location/.test(error.message)
  );
});

test("EG-REPLACEMENT a single cost action remains exposed without executing the original event", () => {
  const f = runtime(world().player("A", { energy: 2, power: ["Fury"] }).player("B")
    .unit("host", { might: 2 })
    .unit("victim", { owner: "B", controller: "B", might: 3 }));
  const planner = {
    host: deps(f).host,
    controller: "A",
    evaluate: expr => f.kernel.evaluate(expr),
    context: f.host.context(f.kernel.getObject("host"), "A", "cleanup-start")
  };
  const plan = planReplacementBody([{
    id: "replacement-pay", op: "cost.pay", args: { payments: c({ power: ["Fury"] }) }
  }], { hostRef: f.kernel.ref("host"), replacedObject: f.kernel.ref("victim"), usedWindow: false }, planner);
  assert.equal(plan.length, 1);
  assert.equal(plan[0].type, "pay");
  assert.deepEqual(plan[0].plan, { finalized: true, energy: 0, power: ["Fury"], xp: 0 });
  assert.equal(f.kernel.getObject("victim").zone, "board");
  assert.equal(f.kernel.player("A").energy, 2);
  assert.deepEqual(f.kernel.player("A").power, ["Fury"]);
});

test("EG-REPLACEMENT condition event-object binding is evaluated at match time and does not consume choice", () => {
  const f = runtime(world().player("A").player("B")
    .unit("host", { might: 5 })
    .unit("small", { owner: "B", controller: "B", might: 2 }));
  const condition = {
    kind: "compare", operator: "lt",
    left: { kind: "object-property", object: { event: "it" }, property: "might" },
    right: { kind: "object-property", object: "self", property: "might" }
  };
  const bound = bindReplacement({
    replaces: { event: "object-killed", filter: { type: "unit", controller: "opponent" } },
    condition,
    with: [{ id: "banish", op: "effect.banish", args: { objects: c({ linked: "replacement.object" }) } }]
  }, f.kernel.ref("host"), deps(f));
  assert.equal(bound.registration.matches({ type: "kill", object: f.kernel.ref("small") }, { type: "kill", object: f.kernel.ref("small") }), true);
  const before = f.kernel.stateForTest();
  assert.equal(f.engine.commit({ type: "kill", object: f.kernel.ref("small") }).status, "replaced");
  assert.equal(f.kernel.getObject("small").zone, "banishment");
  assert.equal(f.asked.some(request => request.type === "select-objects"), false);
  assert.notDeepEqual(f.kernel.stateForTest(), before);
});
