import assert from "node:assert/strict";
import test from "node:test";

import mirrorImage from "../../../card-dsl/dist/cards/unl/mirror-image.js";
import temporalBreach from "../../../card-dsl/dist/cards/ven/temporal-breach.js";
import { ChainEngine } from "../../dist/chain/engine.js";
import { resolveChainBody } from "../../dist/chain/interpreter-adapter.js";
import { instructionDefinitionsById } from "../../dist/effects/instructions/registry.generated.js";
import { world } from "../../dist/effects/testing/index.js";
import { bindResolveContext, createActionPipelineHost } from "../../dist/events/action-adapter.js";
import { createContractActionCapability } from "../../dist/events/contract-actions/bridge.js";
import { createLayerEngine } from "../../dist/layers/index.js";
import { createProgramBinding } from "../../dist/programs/index.js";

const constant = value => ({ kind: "constant", value });
const battlefield = id => ({ type: "battlefield", id });

function copyEffects(kernel) {
  return kernel.continuousEffects.filter(entry => entry.effect.layer === "copy");
}

function layered(kernel) {
  return createLayerEngine(kernel.objects, kernel.continuousEffects);
}

test("effect.copy effect mode registers copyable traits without changing recipient identity or state", () => {
  const kernel = world()
    .unit("source", {
      name: "Source", cardId: "source-card", types: ["gear"], tags: ["SourceTag"],
      keywords: [{ id: "Ganking", value: 1 }], might: 5, energy: 4, power: ["Mind"],
      controller: "B", location: battlefield("one"),
    })
    .unit("recipient", {
      name: "Recipient", cardId: "recipient-card", types: ["gear"], tags: ["RecipientTag"], might: 1,
      energy: null, power: null, controller: "A", exhausted: true, damage: 2,
      stunned: true, buffs: 2, location: battlefield("one"), attachedTo: { id: "host", zoneEntryId: 1 },
    })
    .build();
  const before = kernel.getObject("recipient");
  const source = kernel.getObject("source");
  kernel.setPicks("sources", [source.ref]);
  kernel.setPicks("recipients", [before.ref]);
  const run = instructionDefinitionsById.get("effect.copy").execute(
    bindResolveContext(kernel, { source: before, controller: "A" }),
    {
      source: constant({ pick: "sources" }),
      mode: constant("effect"),
      onto: constant({ pick: "recipients" }),
      duration: constant("permanent"),
      linkKey: constant("becameCopy"),
    },
  );

  assert.equal(run.status, "executed");
  assert.equal(copyEffects(kernel).length, 1);
  const registration = copyEffects(kernel)[0].effect;
  assert.equal(registration.layer, "copy");
  assert.deepEqual(registration.filter, {
    objectId: "recipient", zoneEntryId: before.ref.zoneEntryId, zone: "board",
  });
  const snapshot = layered(kernel).evaluate(before.ref);
  for (const key of ["cardId", "name", "types", "tags", "keywords", "might", "energy", "power"]) {
    assert.deepEqual(snapshot[key], source[key], key);
  }
  assert.deepEqual(snapshot.ref, before.ref);
  assert.equal(snapshot.owner, before.owner);
  assert.equal(snapshot.controller, "A");
  assert.equal(snapshot.zone, "board");
  assert.deepEqual(snapshot.location, before.location);
  assert.equal(snapshot.exhausted, true);
  assert.equal(snapshot.damage, 2);
  assert.equal(snapshot.stunned, true);
  assert.equal(snapshot.buffs, 2);
  assert.deepEqual(snapshot.attachedTo, before.attachedTo);
  assert.equal(kernel.query({ zone: "board" }).length, 2, "no substitute object was created");
  assert.equal(run.linkedValues.becameCopy.amount, 1);
});

test("copy-layer values read printed/copied traits before arithmetic and stop at the registered duration", () => {
  const kernel = world()
    .unit("source", { might: 3, power: ["Fury"], location: battlefield("one") })
    .unit("recipient", { might: 1, power: ["Chaos"], location: battlefield("one") })
    .build();
  kernel.addContinuous({ id: "source-buff", layer: "arithmetic", source: kernel.ref("source"),
    filter: { objectId: "source" }, effect: { kind: "increase", amount: 4 } }, { type: "permanent" });
  const context = bindResolveContext(kernel, { source: kernel.getObject("recipient"), controller: "A" });
  kernel.setPicks("source", [kernel.ref("source")]);
  kernel.setPicks("recipient", [kernel.ref("recipient")]);
  const result = instructionDefinitionsById.get("effect.copy").execute(context, {
    source: constant({ pick: "source" }),
    mode: constant("effect"),
    onto: constant({ pick: "recipient" }),
    duration: constant("this-turn"),
  });
  assert.equal(result.status, "executed");

  const layers = layered(kernel);
  assert.equal(layers.evaluate(kernel.ref("recipient")).might, 3, "copy reads before the +4 arithmetic layer");
  assert.deepEqual(layers.evaluate(kernel.ref("recipient")).power, ["Fury"]);
  const id = copyEffects(kernel)[0].effect.id;
  assert.deepEqual(layers.advance({ id: "turn-end", player: "A" }), [id]);
  assert.equal(layers.evaluate(kernel.ref("recipient")).might, 1);
  assert.deepEqual(layers.evaluate(kernel.ref("recipient")).power, ["Chaos"]);
});

test("copy-layer source and recipient identities are strict across zone changes", () => {
  const kernel = world()
    .unit("source", { might: 4, location: battlefield("one") })
    .unit("recipient", { might: 1, location: battlefield("one") })
    .build();
  const context = bindResolveContext(kernel, { source: kernel.getObject("recipient"), controller: "A" });
  const oldRecipient = kernel.ref("recipient");
  kernel.setPicks("source", [kernel.ref("source")]);
  kernel.setPicks("recipient", [oldRecipient]);
  instructionDefinitionsById.get("effect.copy").execute(context, {
    source: constant({ pick: "source" }),
    mode: constant("effect"),
    onto: constant({ pick: "recipient" }),
    duration: constant("while-source-in-zone"),
  });
  assert.equal(layered(kernel).evaluate(oldRecipient).might, 4);

  assert.equal(kernel.perform({ type: "return-to-hand", object: oldRecipient }).status, "done");
  const returned = kernel.ref("recipient");
  assert.notDeepEqual(returned, oldRecipient);
  const layers = layered(kernel);
  layers.setObjects(kernel.objects);
  assert.equal(layers.evaluate(returned).might, 1, "the old copy effect does not follow a new recipient incarnation");
  assert.deepEqual(layers.advance({ id: "turn-start", player: "A" }), [copyEffects(kernel)[0].effect.id]);

  const second = world().unit("source", { might: 4 }).unit("recipient", { might: 1 }).build();
  second.setPicks("source", [second.ref("source")]);
  second.setPicks("recipient", [second.ref("recipient")]);
  instructionDefinitionsById.get("effect.copy").execute(
    bindResolveContext(second, { source: second.getObject("recipient"), controller: "A" }),
    { source: constant({ pick: "source" }), mode: constant("effect"), onto: constant({ pick: "recipient" }) },
  );
  const permanentLayers = layered(second);
  assert.equal(permanentLayers.evaluate(second.ref("recipient")).might, 4);
  assert.equal(second.perform({ type: "return-to-hand", object: second.ref("source") }).status, "done");
  permanentLayers.setObjects(second.objects);
  assert.equal(permanentLayers.evaluate(second.ref("recipient")).might, 1, "a stale source identity supplies no copyable traits");
});

test("effect.copy effect mode rejects unsupported lifetimes, source=recipient, and missing receipt transactionally", () => {
  for (const [duration, reason] of [
    ["while-attached", /attachment-duration/],
    ["forever", /attachment-duration/],
  ]) {
    const kernel = world().unit("source").unit("recipient").build();
    const before = kernel.stateForTest();
    const result = instructionDefinitionsById.get("effect.copy").execute(
      bindResolveContext(kernel, { source: kernel.getObject("source"), controller: "A" }),
      { source: constant({ pick: "source" }), mode: constant("effect"), onto: constant({ pick: "recipient" }), duration: constant(duration) },
    );
    assert.equal(result.status, "negated");
    assert.match(result.reason === "impossible" ? "impossible" : "", /impossible/);
    assert.match(kernel.linked("copied").blockedReason, reason);
    assert.deepEqual(copyEffects(kernel), []);
    assert.deepEqual(kernel.stateForTest(), before);
  }

  const same = world().unit("same").build();
  const sameResult = instructionDefinitionsById.get("effect.copy").execute(
    bindResolveContext(same, { source: same.getObject("same"), controller: "A" }),
    { source: constant({ pick: "same" }), mode: constant("effect"), onto: constant({ pick: "same" }) },
  );
  assert.equal(sameResult.status, "negated");
  assert.equal(copyEffects(same).length, 0);

  const missing = world().unit("recipient").build();
  const missingResult = instructionDefinitionsById.get("effect.copy").execute(
    bindResolveContext(missing, { source: missing.getObject("recipient"), controller: "A" }),
    { source: constant({ linked: "missing-token-receipt" }), mode: constant("effect"), onto: constant({ pick: "recipient" }) },
  );
  assert.equal(missingResult.status, "negated");
  assert.equal(copyEffects(missing).length, 0);
});

test("copy-layer effect mode rejects ambiguous many-to-many pairing before registration", () => {
  const kernel = world().unit("s1").unit("s2").unit("r1").unit("r2").build();
  kernel.setPicks("sources", [kernel.ref("s1"), kernel.ref("s2")]);
  kernel.setPicks("recipients", [kernel.ref("r1"), kernel.ref("r2"), kernel.ref("s1")]);
  const result = instructionDefinitionsById.get("effect.copy").execute(
    bindResolveContext(kernel, { source: kernel.getObject("s1"), controller: "A" }),
    { source: constant({ pick: "sources" }), mode: constant("effect"), onto: constant({ pick: "recipients" }) },
  );
  assert.equal(result.status, "negated");
  assert.match(kernel.linked("copied").blockedReason, /source-recipient-pairs/);
  assert.equal(copyEffects(kernel).length, 0);
});

function production(builder, programs) {
  const kernel = builder.build();
  const answers = new Map();
  const choose = request => {
    if (answers.has(request.id)) return answers.get(request.id);
    if (request.type === "select-objects" && request.min === request.max && request.options.length === request.min) return [...request.options];
    if (request.type === "select-objects" && request.min === 0) return [];
    throw new Error(`Unanswered production choice ${request.id}`);
  };
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: saved => { kernel.restore(saved.state); kernel.copyLinkedFrom(saved.links); },
    objects: () => kernel.objects,
    perform: action => kernel.perform(action),
    choose,
    context: (source, controller, timingPoint) => bindResolveContext(kernel, { source, controller, timingPoint, choose }),
  });
  const binding = createProgramBinding({ cardPrograms: programs.map(program => ({ ...program, status: "executable", judgeReason: undefined })) });
  const engine = new ChainEngine({ host, turnOrder: ["A", "B"], turnPlayer: "A", phase: "main", describePlay: binding.describePlay, cleanup: () => false });
  return { kernel, engine, binding, answers };
}

test("Mirror Image original IR resolves token creation, copy-layer transformation and linked order through production assembly", () => {
  const target = { name: "Honest Broker", cardId: "card:broker", types: ["unit"], tags: ["Mech"],
    keywords: [{ id: "Shield", value: 2 }], might: 4, energy: 3, power: ["Mind"], location: battlefield("one") };
  const f = production(world().player("A").player("B").unit("broker", { ...target, owner: "B", controller: "B" }), [mirrorImage]);
  f.kernel.setTargets("mirror-image.unit", [f.kernel.ref("broker")]);
  const play = mirrorImage.abilities.find(ability => ability.kind === "play").body;
  const tokenOnly = [{ ...play[0], args: { ...play[0].args, location: constant({ type: "base", player: "A" }) } }];
  const outcome = resolveChainBody([...tokenOnly, play[1]], bindResolveContext(f.kernel, {
    source: f.kernel.getObject("broker"), controller: "A", timingPoint: "chain-item-resolve",
    targets: id => f.kernel.targets(id), choose: request => {
      if (request.type === "select-objects" && request.min === request.max && request.options.length === request.min) return [...request.options];
      throw new Error(`Unanswered IR choice ${request.id}`);
    },
  }));
  assert.deepEqual(outcome.results.map(entry => [entry.id, entry.result.status]), [
    ["mirror-image.play-reflection", "executed"],
    ["mirror-image.copy-unit", "executed"],
  ]);
  const token = f.kernel.query({ zone: "board", type: "unit" }).find(object => object.isToken);
  assert.ok(token);
  assert.deepEqual(token.ref, f.kernel.query({ zone: "board", type: "unit" }).find(object => object.isToken).ref);
  assert.equal(token.name, "Reflection", "raw token state remains untouched by layer projection");
  const effective = layered(f.kernel).evaluate(token.ref);
  assert.equal(effective.name, "Honest Broker");
  assert.equal(effective.might, 4);
  assert.deepEqual(effective.tags, ["Mech"]);
  assert.deepEqual(effective.keywords, [{ id: "Shield", value: 2 }]);
  assert.equal(effective.controller, "A");
  assert.equal(effective.owner, "A");
  assert.equal(copyEffects(f.kernel).length, 1);
  assert.equal(f.kernel.history({ action: "play" }), 1, "Copy does not perform another Play");
});

function playBackContext(kernel, overrides = {}) {
  return bindResolveContext(kernel, {
    source: kernel.getObject(kernel.objects[0].ref.id),
    controller: "A",
    timingPoint: "chain-item-resolve",
    contractActions: createContractActionCapability(action => kernel.performContract(action)),
    ...overrides,
  });
}

test("effect.play-back plays each banished owner's object through one atomic production batch", () => {
  const kernel = world().player("A").player("B")
    .unit("a-unit", { owner: "A", controller: "A", location: battlefield("one") })
    .unit("b-unit", { owner: "B", controller: "B", location: battlefield("one") })
    .build();
  assert.equal(kernel.perform({ type: "banish", object: kernel.ref("a-unit") }).status, "done");
  assert.equal(kernel.perform({ type: "banish", object: kernel.ref("b-unit") }).status, "done");
  const a = kernel.ref("a-unit");
  const b = kernel.ref("b-unit");
  const requested = [b, a];
  const result = instructionDefinitionsById.get("effect.play-back").execute(
    playBackContext(kernel, { choose: request => request.type === "order" ? [a, b] : request.options[0] }),
    {
      objects: constant(requested),
      chooser: constant("owner"),
      destinations: constant(["owner-base"]),
      orderChooser: constant("controller"),
      orderChoiceId: constant("play-back-order"),
      ignoreCost: constant(true),
    },
  );
  assert.equal(result.status, "executed");
  assert.deepEqual(kernel.getObject("a-unit").location, { type: "base", player: "A" });
  assert.deepEqual(kernel.getObject("b-unit").location, { type: "base", player: "B" });
  assert.equal(kernel.getObject("a-unit").owner, "A");
  assert.equal(kernel.getObject("b-unit").owner, "B");
  assert.equal(kernel.player("A").energy, 0, "ignoreCost uses the finalized 0/0 base plan");
  assert.equal(result.events.length, 0, "the production bridge reports success through the atomic batch receipt");
  assert.deepEqual(result.linkedValues.playedBack.objects.map(ref => ref.id), ["a-unit", "b-unit"]);
});

test("effect.play-back rejects same-location, stale objects, and a replaced leaf without partial state", () => {
  const same = world().unit("unit", { location: battlefield("one") }).build();
  assert.equal(same.perform({ type: "banish", object: same.ref("unit") }).status, "done");
  const sameResult = instructionDefinitionsById.get("effect.play-back").execute(playBackContext(same), {
    objects: constant([same.ref("unit")]), destination: constant("same-location"), ignoreCost: constant(true),
  });
  assert.equal(sameResult.status, "negated");
  assert.match(same.linked("playedBack").blockedReason, /pre-banish-location/);
  assert.equal(same.getObject("unit").zone, "banishment");

  const stale = world().unit("unit", { location: battlefield("one") }).build();
  const old = stale.ref("unit");
  assert.equal(stale.perform({ type: "banish", object: old }).status, "done");
  const staleResult = instructionDefinitionsById.get("effect.play-back").execute(playBackContext(stale), {
    objects: constant([old]), ignoreCost: constant(true),
  });
  assert.equal(staleResult.status, "negated");
  assert.match(stale.linked("playedBack").blockedReason, /not-currently-in-banishment/);
  assert.equal(stale.getObject("unit").zone, "banishment");

  const atomic = world().unit("one", { location: battlefield("one") }).unit("two", { location: battlefield("one") }).build();
  assert.equal(atomic.perform({ type: "banish", object: atomic.ref("one") }).status, "done");
  assert.equal(atomic.perform({ type: "banish", object: atomic.ref("two") }).status, "done");
  atomic.addReplacement(action => action.type === "play" && action.object.id === "two" ? "prevented" : null);
  const before = atomic.stateForTest();
  const atomicResult = instructionDefinitionsById.get("effect.play-back").execute(playBackContext(atomic), {
    objects: constant([atomic.ref("one"), atomic.ref("two")]), ignoreCost: constant(true),
  });
  assert.equal(atomicResult.status, "negated");
  assert.equal(atomic.getObject("one").zone, "banishment");
  assert.equal(atomic.getObject("two").zone, "banishment");
  assert.deepEqual(atomic.stateForTest(), before, "the batch rolled back the first successful Play");
});

test("effect.play-back chooses owner-base independently for each owner through the original Chronobreak IR shape", () => {
  const f = production(world().player("A").player("B")
    .unit("owned-a", { owner: "A", controller: "A", location: battlefield("one") })
    .unit("owned-b", { owner: "B", controller: "B", location: battlefield("one") }), []);
  assert.equal(f.kernel.perform({ type: "banish", object: f.kernel.ref("owned-a") }).status, "done");
  assert.equal(f.kernel.perform({ type: "banish", object: f.kernel.ref("owned-b") }).status, "done");
  const answers = new Map([
    ["effect-play-back:owned-a:2:owned-a:2:destination", "owner-base"],
    ["effect-play-back:owned-a:2:owned-b:2:destination", "owner-base"],
  ]);
  const asked = [];
  const context = bindResolveContext(f.kernel, {
    source: f.kernel.getObject("owned-a"), controller: "A", timingPoint: "chain-item-resolve",
    contractActions: createContractActionCapability(action => f.kernel.performContract(action)),
    choose: request => {
      asked.push(request);
      const answer = answers.get(request.id);
      if (answer === undefined) throw new Error(`Unanswered ${request.id}`);
      return answer;
    },
  });
  const objects = [f.kernel.ref("owned-a"), f.kernel.ref("owned-b")];
  const result = instructionDefinitionsById.get("effect.play-back").execute(context, {
    objects: constant(objects),
    chooser: constant("owner"),
    destinations: constant(["same-location", "owner-base"]),
    ignoreCost: constant(true),
  });
  assert.equal(result.status, "executed");
  assert.deepEqual(asked.map(request => request.chooser), ["A", "B"]);
  assert.deepEqual(f.kernel.getObject("owned-a").location, { type: "base", player: "A" });
  assert.deepEqual(f.kernel.getObject("owned-b").location, { type: "base", player: "B" });
});

test("effect.replace validates both printed modes and reports the missing identity link without mutation", () => {
  for (const [args, reason] of [
    [{ battlefield: constant({ type: "battlefield", id: "one" }), withToken: constant("brush") }, /same-game-object/],
    [{ mode: constant("swap-back"), object: constant("self"), with: constant("the-battlefield-this-replaced") }, /predecessor-identity/],
  ]) {
    const kernel = world().unit("source").build();
    const before = kernel.stateForTest();
    const result = instructionDefinitionsById.get("effect.replace").execute(
      bindResolveContext(kernel, { source: kernel.getObject("source"), controller: "A" }), args,
    );
    assert.equal(result.status, "negated");
    assert.equal(result.reason, "impossible");
    assert.match(kernel.linked("replaced").blockedReason, reason);
    assert.deepEqual(kernel.stateForTest(), before);
  }
});

test("choice.remake-chain-item-choices exposes a capability boundary and requires all relevant choices", () => {
  const kernel = world().unit("spell", { types: ["spell"], zone: "chain" }).build();
  const item = kernel.ref("spell");
  const result = instructionDefinitionsById.get("choice.remake-chain-item-choices").execute(
    bindResolveContext(kernel, { source: kernel.getObject("spell"), controller: "A" }),
    { item: constant(item), choices: constant(["location", "mode", "destination", "target"]), remakeAll: constant(true) },
  );
  assert.equal(result.status, "negated");
  assert.match(kernel.linked("remadeChoices").blockedReason, /capability-unavailable/);
  assert.equal(kernel.getObject("spell").zone, "chain");

  assert.throws(() => instructionDefinitionsById.get("choice.remake-chain-item-choices").execute(
    bindResolveContext(kernel, { source: kernel.getObject("spell"), controller: "A" }),
    { item: constant(item), choices: constant(["target", "cost"]), remakeAll: constant(true) },
  ), /choices/);
});

test("repeat control re-executes one effect with fresh target choices and no additional Play identity", () => {
  const kernel = world().player("A").unit("one", { owner: "B", might: 5 }).unit("two", { owner: "B", might: 5 }).build();
  let calls = 0;
  kernel.setAnswers({ "repeat-target-choice": [kernel.ref("one")] });
  const body = [{
    id: "repeat-effect",
    op: "repeat",
    args: {
      count: constant(2),
      body: constant([{
        id: "damage-target",
        op: "effect.damage",
        args: { amount: constant(1), target: constant("repeat-target") },
        targets: [{ id: "repeat-target", filter: { type: "unit", zone: "board" }, min: 1, max: 1, selection: "one" }],
      }]),
    },
  }];
  const context = bindResolveContext(kernel, {
    source: kernel.getObject("one"), controller: "A", timingPoint: "chain-item-resolve",
    choose: request => {
      if (request.type !== "select-objects") throw new Error("unexpected choice");
      calls++;
      return [kernel.ref(calls === 1 ? "one" : "two")];
    },
  });
  const outcome = resolveChainBody(body, context);
  assert.equal(outcome.status, "executed");
  assert.equal(calls, 2, "choices are made for both executions");
  assert.equal(kernel.getObject("one").damage, 1);
  assert.equal(kernel.getObject("two").damage, 1);
  assert.equal(kernel.history({ action: "play" }), 0, "Repeat is not another Play or Copy");
  assert.equal(kernel.continuousEffects.length, 0, "Repeat creates no copy-layer identity");
});

test("Temporal Breach original IR banishes, then fails same-location play-back without reviving the old identity", () => {
  const f = production(world().player("A").player("B").unit("victim", {
    owner: "B", controller: "B", location: battlefield("one"),
  }), [temporalBreach]);
  const old = f.kernel.ref("victim");
  f.kernel.setTargets("temporal-breach.unit", [old]);
  const body = temporalBreach.abilities.find(ability => ability.kind === "play").body;
  const outcome = resolveChainBody(body, bindResolveContext(f.kernel, {
    source: f.kernel.getObject("victim"), controller: "A", timingPoint: "chain-item-resolve",
    contractActions: createContractActionCapability(action => f.kernel.performContract(action)),
    targets: id => f.kernel.targets(id),
  }));
  assert.deepEqual(outcome.results.map(result => [result.id, result.result.status]), [
    ["temporal-breach.banish", "executed"],
    ["temporal-breach.play-back", "negated"],
  ]);
  assert.equal(f.kernel.getObject("victim").zone, "banishment");
  assert.notDeepEqual(f.kernel.ref("victim"), old);
  assert.match(outcome.linkedValues["temporal-breach.play-back.playedBack"].blockedReason, /pre-banish-location/);
  assert.equal(f.kernel.history({ action: "play" }), 0, "a stale same-location reference is not used for Play");
});
