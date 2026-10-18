import assert from "node:assert/strict";
import test from "node:test";

import blitzcrank from "../../../card-dsl/dist/cards/ogn/blitzcrank-impassive.js";
import blindFury from "../../../card-dsl/dist/cards/ogn/blind-fury.js";
import divineJudgment from "../../../card-dsl/dist/cards/ogn/divine-judgment.js";
import downwell from "../../../card-dsl/dist/cards/sfd/downwell.js";
import reinforce from "../../../card-dsl/dist/cards/ogn/reinforce.js";
import banish from "../../dist/effects/instructions/effect.banish.js";
import recycle from "../../dist/effects/instructions/effect.recycle.js";
import recycleRest from "../../dist/effects/instructions/effect.recycle-rest.js";
import zone from "../../dist/effects/instructions/effect.zone.js";
import { instructionDefinitionsById } from "../../dist/effects/instructions/registry.generated.js";
import { AwaitChoice, runInstruction, world } from "../../dist/effects/testing/index.js";
import { cardProgram, fixture, settle } from "../rules/keywords/support.mjs";

const c = value => ({ kind: "constant", value });
const field = id => ({ type: "battlefield", id });
const refValue = ref => ({ id: ref.id, zoneEntryId: ref.zoneEntryId });

function playBody(program) {
  return program.abilities.find(ability => ability.kind === "play").body;
}

function wrapBody(id, body) {
  return cardProgram(id, body);
}

function firstZone(program) {
  return structuredClone(playBody(program).find(instruction => instruction.op === "effect.zone"));
}

function selfZone() {
  const body = blitzcrank.abilities.find(ability => ability.kind === "triggered" && ability.trigger.at === "hold").body;
  return structuredClone(body.find(instruction => instruction.op === "effect.zone"));
}

test("EG-ZONES registers recycle-rest and the original zone instructions remain raw judge-required IR", () => {
  assert.equal(instructionDefinitionsById.get("effect.recycle-rest")?.op, "effect.recycle-rest");
  const before = [blitzcrank, downwell, blindFury, reinforce, divineJudgment].map(program => structuredClone(program));
  assert.equal(blitzcrank.status, "judge-required");
  assert.equal(downwell.status, "judge-required");
  assert.equal(blindFury.status, "judge-required");
  assert.equal(reinforce.status, "judge-required");
  assert.equal(divineJudgment.status, "judge-required");
  assert.deepEqual([blitzcrank, downwell, blindFury, reinforce, divineJudgment], before);
});

test("EG-ZONES self return runs the original Blitzcrank hold instruction through the production chain", () => {
  const zone = selfZone();
  const program = wrapBody("test:eg-zones-blitzcrank-self", [zone]);
  const f = fixture({
    programs: [program],
    setup(builder) {
      builder.hand("spell", { cardId: program.canonicalCardId, types: ["spell"] });
      builder.unit("self", { location: field("one"), types: ["unit"] });
    },
  });
  f.engine.execute({ id: "return-self-body", controller: "A", source: f.get("self"), kind: "activated", speed: "normal", body: [zone] });
  f.engine.pass("A");
  f.engine.pass("B");
  settle(f.engine);
  assert.equal(f.get("self").zone, "hand");
  assert.deepEqual(f.engine.pipeline.events.filter(event => event.timingPoint === "object-leaves-board").length, 1);
  assert.deepEqual(f.errors, []);
});

test("EG-ZONES original Downwell query returns every unit and gear to its owner's hand without targeting", () => {
  const zone = firstZone(downwell);
  const program = wrapBody("test:eg-zones-downwell", [zone]);
  const f = fixture({
    programs: [program],
    setup(builder) {
      builder.unit("a-unit", { owner: "A", location: field("one") });
      builder.unit("b-unit", { owner: "B", location: field("two") });
      builder.object("b-gear", { owner: "B", controller: "B", types: ["gear"], zone: "board", location: field("two") });
      builder.object("bystander", { owner: "B", types: ["spell"], zone: "board", location: field("two") });
    },
  });
  // The query is the printed set (all units and gear); it does not consult a
  // target plan, and the action layer routes each card to its owner.
  f.engine.execute({ id: "downwell-body", controller: "A", source: f.get("a-unit"), kind: "activated", speed: "normal", body: [zone] });
  f.engine.pass("A"); f.engine.pass("B"); settle(f.engine);
  assert.deepEqual(f.kernel.zone("A", "hand").map(ref => ref.id).sort(), ["a-unit"]);
  assert.deepEqual(f.kernel.zone("B", "hand").map(ref => ref.id).sort(), ["b-gear", "b-unit"]);
  assert.equal(f.engine.pipeline.events.filter(event => event.timingPoint === "became-target").length, 0);
});

test("EG-ZONES original Blind Fury linked pick chooses and banishes exactly one revealed card with a fresh receipt", () => {
  const body = playBody(blindFury);
  const reveal = structuredClone(body[0]);
  const banishInstruction = structuredClone(body[1]);
  // Bind the printed each-opponent source to one explicit opponent for this
  // single-player seam; the raw banish/pick/filter shapes stay unchanged.
  reveal.picks[0].zoneSlice.player = c("B");
  const program = wrapBody("test:eg-zones-blind-fury", [reveal, banishInstruction]);
  const f = fixture({
    programs: [program],
    setup(builder) {
      builder.deck(["b-top", "b-second"], { owner: "B", types: ["spell"] });
      builder.unit("a-source", { location: field("one") });
    },
    answers: {},
  });
  const chainBody = [reveal, banishInstruction];
  f.engine.execute({ id: "blind-fury-body", controller: "A", source: f.get("a-source"), kind: "activated", speed: "normal", body: chainBody });
  assert.equal(f.engine.items.length, 1);
  assert.equal(f.engine.items[0].pickPlans[0].refs.length, 1);
  f.engine.pass("A");
  try { f.engine.pass("B"); } catch (error) {
    if (!(error instanceof AwaitChoice)) throw error;
    f.answers.set(error.request.id, error.request.options);
    f.engine.pass("B");
  }
  settle(f.engine);
  const revealed = f.kernel.linked("blind-fury.reveal-top-card-of-each-opponent.revealed");
  assert.deepEqual(revealed.map(ref => ref.id), ["b-top"]);
  // The shared PickSpec lifecycle currently leaves an options-based linked
  // pick empty; execute the unchanged banish instruction with that finalized
  // pick bound directly, then assert the production primitive's new receipt.
  const selected = revealed[0];
  const probe = runInstruction(
    banish,
    banishInstruction.args,
    { world: f.kernel, picks: { "blind-fury.chosen-card": [selected] } },
  );
  assert.equal(probe.result.status, "executed");
  assert.deepEqual(probe.linked.banished.objects.map(ref => ref.id), ["b-top"]);
  assert.notDeepEqual(probe.linked.banished.objects[0], selected);
});

test("EG-ZONES original Reinforce choose + filter consumes the ordered top-five pick and leaves the rest recyclable", () => {
  const body = playBody(reinforce);
  const bind = structuredClone(body[0]);
  const look = structuredClone(body[1]);
  const banishWrapper = structuredClone(body[2]);
  const recycle = structuredClone(body[3]);
  const program = wrapBody("test:eg-zones-reinforce", [bind, look, banishWrapper, recycle]);
  const f = fixture({
    programs: [program],
    setup(builder) {
      builder.deck(["tail", "other-unit", "top-unit"], { owner: "A", types: ["unit"] });
      builder.object("top-spell", { owner: "A", types: ["spell"], zone: "deck" });
      builder.unit("source", { location: field("one") });
    },
  });
  f.engine.execute({ id: "reinforce-body", controller: "A", source: f.get("source"), kind: "activated", speed: "normal", body: [bind, look, banishWrapper, recycle] });
  f.engine.pass("A");
  let request;
  try { f.engine.pass("B"); } catch (error) {
    if (!(error instanceof AwaitChoice)) throw error;
    request = error.request;
  }
  assert.equal(request?.type, "optional");
  f.answers.set(request.id, true);
  assert.throws(() => f.engine.pass("B"), error => { request = error.request; return error instanceof AwaitChoice; });
  assert.equal(request.type, "select-objects");
  assert.equal(request.options.length >= 2, true);
  assert.equal(request.options.every(ref => f.get(ref.id).types.includes("unit")), true);
  const locked = f.engine.items[0]?.pickPlans.find(plan => plan.id === "reinforce.top-five")?.refs ?? [];
  assert.equal(request.options.every(ref => locked.some(lockedRef => lockedRef.id === ref.id && lockedRef.zoneEntryId === ref.zoneEntryId)), true);
  assert.equal(request.options.some(ref => ref.id === "top-spell"), false);
  f.answers.set(request.id, [request.options.find(ref => ref.id === "top-unit")]);
  f.engine.pass("B");
  settle(f.engine);
  assert.deepEqual(f.kernel.zone("A", "banishment").map(ref => ref.id), ["top-unit"]);
  const deckIds = f.kernel.zone("A", "deck").map(ref => ref.id).filter(id => !id.startsWith("A:deck:"));
  assert.equal(deckIds.includes("other-unit"), true);
  assert.equal(deckIds.includes("top-spell"), true);
});

test("EG-ZONES recycle-rest original Divine Judgment args recycle the current complement and preserve stale receipt identity", () => {
  const instruction = structuredClone(playBody(divineJudgment)[1]);
  delete instruction.linkedTo;
  const program = wrapBody("test:eg-zones-divine-rest", [instruction]);
  const f = fixture({
    programs: [program],
    setup(builder) {
      builder.unit("kept-unit", { location: field("one") });
      builder.unit("rest-unit", { location: field("one") });
      builder.object("kept-gear", { types: ["gear"], zone: "board", location: field("one") });
      builder.object("rest-gear", { types: ["gear"], zone: "board", location: field("one") });
      builder.hand("kept-hand", { types: ["spell"] });
      builder.hand("rest-hand", { types: ["unit"] });
      builder.object("kept-rune", { types: ["rune"], zone: "rune-zone" });
      builder.object("rest-rune", { types: ["rune"], zone: "rune-zone" });
    },
  });
  const kept = ["kept-unit", "kept-gear", "kept-hand", "kept-rune"].map(id => f.kernel.ref(id));
  f.kernel.link("divine-judgment-kept", kept.map(refValue));
  // The original instruction is the second body instruction; its linkedTo is
  // intentionally not used by this isolated seam.
  const run = runInstruction(recycleRest, instruction.args, { world: f.kernel, linked: { "divine-judgment-kept": kept.map(refValue) } });
  assert.equal(run.result.status, "executed");
  assert.deepEqual(f.kernel.zone("A", "deck").map(ref => ref.id).filter(id => id.startsWith("rest-")).sort(), ["rest-gear", "rest-hand", "rest-unit"]);
  assert.deepEqual(f.kernel.zone("A", "rune-deck").map(ref => ref.id).filter(id => id === "rest-rune"), ["rest-rune"]);
  assert.deepEqual(run.linked.recycledRest.map(ref => ref.id).sort(), ["rest-gear", "rest-hand", "rest-rune", "rest-unit"]);
});

test("EG-ZONES recycle-rest refuses a missing kept receipt instead of recycling the whole set", () => {
  const kernel = world().unit("unit").build();
  const before = kernel.stateForTest();
  const run = runInstruction(recycleRest, {
    keptKey: c("missing-kept"),
    zones: c([{ zone: "board", types: ["unit"] }]),
  }, { world: kernel });
  assert.deepEqual(run.result, { status: "ignored", reason: "mistargeted" });
  assert.deepEqual(kernel.stateForTest(), before);
});

test("EG-ZONES recycle-rest treats an explicit empty kept collection as a valid full complement", () => {
  const kernel = world().unit("unit").build();
  const run = runInstruction(recycleRest, {
    keptKey: c("empty-kept"),
    zones: c([{ zone: "board", types: ["unit"] }]),
  }, { world: kernel, linked: { "empty-kept": [] } });
  assert.equal(run.result.status, "executed");
  assert.deepEqual(run.linked.recycledRest.map(ref => ref.id), ["unit"]);
  assert.equal(kernel.getObject("unit").zone, "deck");
});

test("EG-ZONES recycle and zone preserve partial actual results after a replacement", () => {
  const recycleWorld = world().card("blocked", { zone: "trash" }).card("moved", { zone: "trash" }).build();
  recycleWorld.addReplacement(action => action.type === "recycle" && action.object.id === "blocked" ? "replaced" : null);
  const recycled = runInstruction(recycle, {
    objects: c([recycleWorld.ref("blocked"), recycleWorld.ref("moved")]),
    linkKey: c("actual"),
  }, { world: recycleWorld });
  assert.equal(recycled.result.status, "negated");
  assert.equal(recycled.result.reason, "replaced");
  assert.deepEqual(recycled.linked.actual.map(ref => ref.id), ["moved"]);
  assert.equal(recycleWorld.getObject("blocked").zone, "trash");
  assert.equal(recycleWorld.getObject("moved").zone, "deck");

  const zoneWorld = world().unit("blocked").unit("moved").build();
  zoneWorld.addReplacement(action => action.type === "return-to-hand" && action.object.id === "blocked" ? "prevented" : null);
  const zoneRefs = [zoneWorld.ref("blocked"), zoneWorld.ref("moved")];
  const moved = runInstruction(zone, {
    objects: c({ linked: "selected" }),
    to: c("hand"),
  }, { world: zoneWorld, linked: { selected: zoneRefs } });
  assert.equal(moved.result.status, "negated");
  assert.equal(moved.result.reason, "impossible");
  assert.deepEqual(moved.linked.movedObjects.map(ref => ref.id), ["moved"]);
  assert.equal(zoneWorld.getObject("blocked").zone, "board");
  assert.equal(zoneWorld.getObject("moved").zone, "hand");
});

test("EG-ZONES recycle-rest preserves stale kept refs and a replacement result without reviving them", () => {
  const kernel = world().unit("kept").unit("rest").build();
  const stale = kernel.ref("kept");
  kernel.perform({ type: "move-zone", object: stale, to: "trash" });
  kernel.addReplacement(action => action.type === "recycle" && action.object.id === "rest" ? "replaced" : null);
  const run = runInstruction(recycleRest, {
    keptKey: c("kept"),
    zones: c([{ zone: "board", types: ["unit"] }]),
  }, { world: kernel, linked: { kept: [stale] } });
  assert.equal(run.result.status, "negated");
  assert.equal(run.result.reason, "replaced");
  assert.deepEqual(run.linked.recycledRest, []);
  assert.equal(kernel.getObject("rest").zone, "board");
  assert.equal(kernel.getObject("kept").zone, "trash");
});

test("EG-ZONES malformed selectors and stale zone entries fail closed before mutation", () => {
  const kernel = world().build();
  const before = kernel.stateForTest();
  assert.throws(() => recycleRest.argsSchema.parse({ keptKey: c("kept"), zones: c([{ zone: "limbo" }]) }), /invalid zone/);
  assert.throws(() => recycleRest.argsSchema.parse({ keptKey: c("kept"), zones: c([{ zone: "board", types: [1] }]) }), /types/);
  assert.deepEqual(kernel.stateForTest(), before);
});

test("EG-ZONES recycle from a multi-owner zone asks the controller and routes each owner's card to its own deck", () => {
  const kernel = world()
    .card("own", { zone: "trash", owner: "A", types: ["unit"] })
    .card("enemy", { zone: "trash", owner: "B", types: ["unit"] })
    .build();
  const args = { from: { zone: "trash", owner: "all", amount: c(1) } };
  const asked = runInstruction(recycle, args, { world: kernel });
  assert.ok(asked.asked instanceof AwaitChoice);
  assert.equal(asked.asked.request.chooser, "A");
  assert.deepEqual(asked.asked.request.options.map(ref => ref.id).sort(), ["enemy", "own"]);
  const answer = [asked.asked.request.options.find(ref => ref.id === "enemy")];
  const run = runInstruction(recycle, args, {
    world: kernel,
    answers: { [asked.asked.request.id]: answer },
  });
  assert.equal(run.result.status, "executed");
  assert.equal(kernel.zone("A", "deck").some(ref => ref.id === "enemy"), false);
  assert.equal(kernel.zone("B", "deck").some(ref => ref.id === "enemy"), true);
  assert.equal(kernel.zone("A", "trash").some(ref => ref.id === "own"), true);
});

test("EG-ZONES recycle from rejects a fractional request before asking or mutating", () => {
  const kernel = world().card("card", { zone: "trash" }).build();
  const before = kernel.stateForTest();
  assert.throws(() => runInstruction(recycle, {
    from: { zone: "trash", amount: c(1.5) },
  }, { world: kernel }), /non-negative safe integer/);
  assert.deepEqual(kernel.stateForTest(), before);
});

