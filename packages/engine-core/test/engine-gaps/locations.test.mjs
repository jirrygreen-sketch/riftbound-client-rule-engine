import assert from "node:assert/strict";
import test from "node:test";

import { AwaitChoice } from "../../dist/effects/contract.js";
import { world } from "../../dist/effects/testing/index.js";
import { resolveChainBody } from "../../dist/chain/interpreter-adapter.js";
import { chooseLocations, normalizeMoveArguments } from "../../dist/effects/interpreter/locations.js";
import { queryLocationCandidates, queryMoveDestinations, resolveLocationSelector, sameLocation } from "../../dist/target/location/index.js";
import { fixture, resolveAll } from "../chain/helpers.mjs";
import { cardProgram, fixture as programFixture } from "../rules/keywords/support.mjs";
import { translateInstructionTargets as translateBody } from "../../dist/programs/filters.js";
import voidAssault from "../../../card-dsl/dist/cards/unl/void-assault.js";
import shadowDash from "../../../card-dsl/dist/cards/ven/shadow-dash.js";
import satchelCharge from "../../../card-dsl/dist/cards/rad/satchel-charge.js";
import resourceExtractor from "../../../card-dsl/dist/cards/rad/resource-extractor.js";
import isolate from "../../../card-dsl/dist/cards/unl/isolate.js";

const base = player => ({ type: "base", player });
const field = id => ({ type: "battlefield", id });
const c = value => ({ kind: "constant", value });
const playBody = program => program.abilities.find(ability => ability.kind === "play").body;
const voidBody = playBody(voidAssault);
const shadowBody = playBody(shadowDash);
const satchelMove = playBody(satchelCharge)[0];

function locationObject(id, controller = "A", zone = "board") {
  return { types: ["battlefield"], owner: controller, controller, zone, location: null, energy: null, power: null };
}

// These are the shipped ability bodies, passed unchanged to the default
// ChainEngine interpreter/primitive assembly. The official programs remain
// judge-required: this suite exercises the Location seam, not whole-card admission.
function voidFixture() {
  const f = fixture({ cards: [{ id: "destination", ...locationObject("destination") }] });
  f.engine.commit({ type: "move-zone", object: f.kernel.ref("destination"), to: "battlefield", location: field("destination") });
  f.engine.advance();
  f.answers.set("void-assault.move-friendly-unit/location%3Avoid-assault.destination-1", field("destination"));
  f.answers.set("void-assault.move-enemy-unit/location%3Avoid-assault.destination-2", field("destination"));
  f.answers.set("target:void-assault.friendly-unit", [f.kernel.ref("source")]);
  f.answers.set("target:void-assault.enemy-unit", [f.kernel.ref("enemy")]);
  f.engine.execute(f.draft("void", { body: voidBody }));
  return f;
}

test("EG-LOCATIONS enumerates empty Battlefield objects, deduplicates locations and excludes off-board cards", () => {
  const kernel = world()
    .object("empty", locationObject("empty"))
    .object("occupied", locationObject("occupied", "B"))
    .object("unplayed", locationObject("unplayed", "B", "deck"))
    .unit("one", { location: field("occupied") })
    .unit("two", { location: field("occupied") })
    .build();
  const before = kernel.stateForTest();
  assert.deepEqual(queryLocationCandidates(kernel, { type: "battlefield" }), [field("empty"), field("occupied")]);
  assert.deepEqual(queryLocationCandidates(kernel, { type: "battlefield", occupied: false }), [field("empty")]);
  assert.deepEqual(kernel.stateForTest(), before);
  assert.equal(kernel.getObject("empty").energy, null);
  assert.equal(kernel.getObject("empty").power, null);
});

test("EG-LOCATIONS applies open, explicit uncontrolled, exclusion and current-location predicates", () => {
  const kernel = world().unit("moving", { location: field("origin") }).build();
  const locations = [
    { ref: field("open"), controller: null, occupied: false },
    { ref: field("controlled"), controller: "A", occupied: false },
    { ref: field("origin"), controller: null, occupied: true },
  ];
  assert.deepEqual(queryLocationCandidates(kernel, { type: "battlefield", open: true }, { locations }), [field("open")]);
  assert.deepEqual(queryLocationCandidates(kernel, { type: "battlefield", controller: null }, { locations, current: field("origin") }), [field("open")]);
  assert.deepEqual(queryLocationCandidates(kernel, { type: "battlefield" }, { locations, current: field("origin"), exclude: [field("controlled")] }), [field("open")]);
});

test("EG-LOCATIONS unitController checks Units present, independently of Battlefield control", () => {
  const kernel = world()
    .object("hostile", locationObject("hostile", "B"))
    .object("friendly", locationObject("friendly"))
    .unit("ally", { location: field("hostile") })
    .unit("enemy", { owner: "B", location: field("friendly") })
    .build();
  assert.deepEqual(queryLocationCandidates(kernel, { type: "battlefield", unitController: "controller" }), [field("hostile")]);
  assert.deepEqual(queryLocationCandidates(kernel, { type: "battlefield", unitController: "opponent" }), [field("friendly")]);
  assert.deepEqual(queryLocationCandidates(kernel, { type: "battlefield", controller: "controller" }), [field("friendly")]);
  assert.throws(() => queryLocationCandidates(kernel, { type: "battlefield", unsupportedPresenceRule: true }), /Unsupported location filter/);
});

test("EG-LOCATIONS opponent predicates include each opponent without inventing a singular opponent Base", () => {
  const kernel = world().unit("b", { owner: "B" }).hand("c", { owner: "C" }).build();
  assert.deepEqual(queryLocationCandidates(kernel, { type: "base", player: "opponent" }), [base("B"), base("C")]);
  assert.throws(() => resolveLocationSelector("opponent-base", { context: kernel }), /no runtime location/);
  assert.deepEqual(resolveLocationSelector("opponent-base", { context: kernel, opponent: "C" }), base("C"));
});

test("EG-LOCATIONS distinguishes ability controller Base from target controller/owner Bases", () => {
  const initial = world().unit("source", { owner: "B" }).unit("target", { owner: "B", controller: "C" }).build();
  const kernel = initial.clone({ sourceSnapshot: initial.getObject("source"), controller: "A" });
  kernel.setTargets("unit", [kernel.ref("target")]);
  const environment = { context: kernel };
  for (const selector of ["ability-controller-base", { type: "base", player: "controller" }, { type: "base", player: "self" }]) {
    assert.deepEqual(resolveLocationSelector(selector, environment), base("A"));
  }
  assert.deepEqual(resolveLocationSelector({ kind: "target-controller-base", target: "unit" }, environment), base("C"));
  assert.deepEqual(resolveLocationSelector({ kind: "target-owner-base", target: "unit" }, environment), base("B"));
  const original = resourceExtractor.abilities.find(ability => ability.kind === "triggered").body[0];
  assert.deepEqual(resolveChainBody([original], kernel).linkedValues[`${original.id}.value`], base("A"));
});

test("EG-LOCATIONS reads target's current location without rebinding its zone entry", () => {
  const kernel = world().unit("target", { location: field("origin") }).build();
  const original = kernel.ref("target");
  kernel.setTargets("unit", [original]);
  const selector = { kind: "target-location", target: "unit" };
  assert.deepEqual(resolveLocationSelector(selector, { context: kernel }), field("origin"));
  assert.equal(kernel.perform({ type: "move-location", object: original, to: field("next") }).status, "done");
  assert.deepEqual(kernel.ref("target"), original);
  assert.deepEqual(resolveLocationSelector(selector, { context: kernel }), field("next"));
  assert.equal(kernel.perform({ type: "return-to-hand", object: original }).status, "done");
  assert.equal(kernel.perform({ type: "move-zone", object: kernel.ref("target"), to: "base" }).status, "done");
  assert.notDeepEqual(kernel.ref("target"), original);
  assert.throws(() => resolveLocationSelector(selector, { context: kernel }), /no runtime location/);
  const result = resolveChainBody([{ id: "read", op: "condition.value", args: { value: { kind: "location", value: selector } } }], kernel);
  assert.deepEqual(result.results[0].result, { status: "ignored", reason: "mistargeted" });
});

test("EG-LOCATIONS selected Battlefield and source identify the Location itself", () => {
  const initial = world().object("empty", locationObject("empty")).build();
  const kernel = initial.clone({ sourceSnapshot: initial.getObject("empty") });
  kernel.setTargets("battlefield", [kernel.ref("empty")]);
  for (const selector of [{ kind: "target-location", target: "battlefield" }, { kind: "location-of", object: { target: "battlefield" } }, "source-location"]) {
    assert.deepEqual(resolveLocationSelector(selector, { context: kernel }), field("empty"));
  }
  assert.deepEqual(resolveLocationSelector({ kind: "relative", relation: "target-location", target: "destination" }, {
    context: kernel, locationBindings: id => id === "destination" ? [base("B")] : [],
  }), base("B"));
});

test("EG-LOCATIONS preserves the Location id when it differs from a Battlefield card's object identity", () => {
  const kernel = world().object("physical-card", { ...locationObject("physical-card", "B"), location: field("board-location") }).build();
  kernel.setTargets("battlefield", [kernel.ref("physical-card")]);
  assert.deepEqual(queryLocationCandidates(kernel, { type: "battlefield", controller: "opponent" }), [field("board-location")]);
  assert.deepEqual(resolveLocationSelector({ kind: "target-location", target: "battlefield" }, { context: kernel }), field("board-location"));
  assert.deepEqual(kernel.ref("physical-card"), { id: "physical-card", zoneEntryId: 1 });
});

test("EG-LOCATIONS source reads its live location and uses only its own supplied last-known identity", () => {
  const initial = world().unit("source", { location: field("origin") }).build();
  const kernel = initial.clone({ sourceSnapshot: initial.getObject("source") });
  assert.equal(kernel.perform({ type: "move-location", object: kernel.source.ref, to: field("next") }).status, "done");
  assert.deepEqual(resolveLocationSelector("source-location", { context: kernel }), field("next"));
  assert.equal(kernel.perform({ type: "return-to-hand", object: kernel.source.ref }).status, "done");
  assert.deepEqual(resolveLocationSelector("source-location", { context: kernel }), field("origin"));
  assert.throws(() => resolveLocationSelector({ kind: "location-of", object: "self" }, { context: kernel }), /no runtime location/);
});

test("EG-LOCATIONS location choices compare identity, canonicalize answers and reject duplicate identities", () => {
  const kernel = world().object("empty", locationObject("empty")).build();
  kernel.setAnswers({ "location:one": { id: "empty", type: "battlefield" } });
  assert.deepEqual(chooseLocations(kernel, [{ id: "one", type: "battlefield" }]), [{ id: "one", selected: [field("empty")] }]);
  kernel.setAnswers({ "location:many": [{ id: "empty", type: "battlefield" }, field("empty")] });
  assert.throws(() => chooseLocations(kernel, [{ id: "many", type: "battlefield", selection: "any", max: 2 }]), /Invalid location choice/);
  assert.throws(() => chooseLocations(kernel, [{ id: "bad", min: -1 }]), /Invalid location bounds/);
});

test("EG-LOCATIONS Move destination queries exclude origins, foreign Bases and third-player conflicts", () => {
  const kernel = world()
    .unit("moving", { location: field("origin") })
    .unit("b", { owner: "B", location: field("conflict") })
    .unit("c", { owner: "C", location: field("conflict") })
    .object("empty", locationObject("empty"))
    .build();
  assert.deepEqual(queryMoveDestinations(kernel, [kernel.ref("moving")]), [field("empty"), base("A")]);
  assert.deepEqual(queryMoveDestinations(kernel, []), []);
  assert.equal(kernel.perform({ type: "return-to-hand", object: kernel.ref("moving") }).status, "done");
  assert.deepEqual(queryMoveDestinations(kernel, [{ id: "moving", zoneEntryId: 1 }]), []);
});

test("EG-LOCATIONS common Move destinations preserve the selected group and all excluded origins", () => {
  const kernel = world()
    .unit("a", { location: field("one") })
    .unit("b", { location: field("two") })
    .object("empty", locationObject("empty"))
    .build();
  assert.deepEqual(queryMoveDestinations(kernel, [kernel.ref("a"), kernel.ref("b")]), [field("empty"), base("A")]);
});

test("EG-LOCATIONS Satchel Charge's original Move IR discovers an empty Battlefield in the production chain", () => {
  // A synthetic admission wrapper isolates the shipped Move instruction while
  // retaining the real printed payment and program/target/chain assembly. The
  // unsupported Bomb instruction and the official status are untouched.
  const program = cardProgram("test:location-satchel-move", [satchelMove]);
  const f = programFixture({
    programs: [program], energy: { A: 3 }, power: { A: ["Chaos"] },
    answers: { "target:satchel-charge.friendly-unit": ["moving"] },
    setup(builder) {
      builder.hand("spell", { cardId: program.canonicalCardId, types: ["spell"], energy: 3, power: ["Chaos"] });
      builder.unit("moving", { location: base("A") });
      builder.object("destination", locationObject("destination"));
    },
  });
  const moving = f.ref("moving");
  f.play("spell");
  assert.equal(f.kernel.player("A").energy, 0);
  assert.deepEqual(f.kernel.player("A").power, []);
  f.engine.pass("A");
  let request;
  assert.throws(() => f.engine.pass("B"), error => { request = error.request; return error instanceof AwaitChoice; });
  assert.equal(request.chooser, "A");
  assert.equal(request.visibility, "public");
  assert.deepEqual(request.options, [field("destination")]);
  f.answers.set(request.id, { id: "destination", type: "battlefield" });
  f.engine.pass("B");
  assert.deepEqual(f.get("moving").location, field("destination"));
  assert.deepEqual(f.ref("moving"), moving);
  assert.equal(f.get("destination").location, null);
  assert.equal(f.get("spell").zone, "trash");
  assert.deepEqual(f.errors, []);
  assert.equal(f.engine.pipeline.events.filter(event => event.timingPoint === "object-moved").length, 1);
});

test("EG-LOCATIONS Shadow Dash's original full body uses Unit presence rather than Battlefield control", () => {
  const f = fixture({ cards: [
    { id: "ally", types: ["unit"], energy: null, power: null },
    { id: "destination", ...locationObject("destination", "B") },
  ] });
  for (const id of ["ally", "destination"]) f.engine.commit({ type: "move-zone", object: f.kernel.ref(id), to: "battlefield", location: field("destination") });
  f.engine.advance();
  f.answers.set("shadow-dash.move-enemy-unit/location%3Ashadow-dash.battlefield", field("destination"));
  f.engine.execute(f.draft("shadow", { body: shadowBody }));
  resolveAll(f.engine);
  assert.deepEqual(f.kernel.getObject("enemy").location, field("destination"));
  assert.equal(f.kernel.getObject("destination").controller, "B");
  assert.equal(f.kernel.getObject("ally").energy, null);
  assert.equal(f.kernel.getObject("ally").power, null);
});

test("EG-LOCATIONS Void Assault's original full body performs two Moves with unchanged zone-entry identities", () => {
  const f = voidFixture();
  const source = f.kernel.ref("source"), enemy = f.kernel.ref("enemy");
  resolveAll(f.engine);
  assert.deepEqual(f.kernel.getObject("source").location, field("destination"));
  assert.deepEqual(f.kernel.getObject("enemy").location, field("destination"));
  assert.deepEqual(f.kernel.ref("source"), source);
  assert.deepEqual(f.kernel.ref("enemy"), enemy);
  assert.equal(f.engine.pipeline.events.filter(event => event.timingPoint === "object-moved").length, 2);
  assert.equal(voidAssault.status, "judge-required");
});

test("EG-LOCATIONS invalid second destination rolls back the first original Void Assault Move and its receipt", () => {
  const f = voidFixture();
  f.answers.set("void-assault.move-enemy-unit/location%3Avoid-assault.destination-2", base("A"));
  f.engine.pass("A");
  const before = f.kernel.stateForTest(), events = f.engine.pipeline.events, links = f.kernel.linkedSnapshot();
  assert.throws(() => f.engine.pass("B"), /Illegal Move destination/);
  assert.deepEqual(f.kernel.stateForTest(), before);
  assert.deepEqual(f.engine.pipeline.events, events);
  assert.deepEqual(f.kernel.linkedSnapshot(), links);
  assert.equal(f.engine.priority, "B");
  f.answers.set("void-assault.move-enemy-unit/location%3Avoid-assault.destination-2", field("destination"));
  f.engine.pass("B");
  assert.equal(f.engine.pipeline.events.filter(event => event.timingPoint === "object-moved").length, 2);
});

test("EG-LOCATIONS rejects the current location for the original Void Assault Move", () => {
  const f = voidFixture();
  f.answers.set("void-assault.move-friendly-unit/location%3Avoid-assault.destination-1", base("A"));
  f.engine.pass("A");
  const before = f.kernel.stateForTest();
  assert.throws(() => f.engine.pass("B"), /Illegal Move destination/);
  assert.deepEqual(f.kernel.stateForTest(), before);
  assert.equal(f.engine.pipeline.events.filter(event => event.timingPoint === "object-moved").length, 0);
});

test("EG-LOCATIONS original Void Assault IR rejects a Battlefield containing two other players' Units", () => {
  const f = fixture({ turnOrder: ["A", "B", "C"], cards: [
    { id: "b", types: ["unit"], owner: "B" },
    { id: "c", types: ["unit"], owner: "C" },
  ] });
  for (const id of ["b", "c"]) f.engine.commit({ type: "move-zone", object: f.kernel.ref(id), to: "battlefield", location: field("conflict") });
  f.engine.advance();
  f.answers.set("target:void-assault.friendly-unit", [f.kernel.ref("source")]);
  f.answers.set("void-assault.move-friendly-unit/location%3Avoid-assault.destination-1", field("conflict"));
  f.engine.execute(f.draft("conflict", { body: [voidBody[0]] }));
  f.engine.pass("A");
  f.engine.pass("B");
  const before = f.kernel.stateForTest();
  assert.throws(() => f.engine.pass("C"), /Illegal Move destination/);
  assert.deepEqual(f.kernel.stateForTest(), before);
  assert.equal(f.engine.pipeline.events.filter(event => event.timingPoint === "object-moved").length, 0);
});

test("EG-LOCATIONS unanswered location choice rolls back previous original Moves before deterministic retry", () => {
  const f = voidFixture();
  f.answers.delete("void-assault.move-enemy-unit/location%3Avoid-assault.destination-2");
  f.engine.pass("A");
  const before = f.kernel.stateForTest(), links = f.kernel.linkedSnapshot();
  let request;
  assert.throws(() => f.engine.pass("B"), error => { request = error.request; return error instanceof AwaitChoice; });
  assert.deepEqual(f.kernel.stateForTest(), before);
  assert.deepEqual(f.kernel.linkedSnapshot(), links);
  f.answers.set(request.id, field("destination"));
  f.engine.pass("B");
  assert.equal(f.engine.pipeline.events.filter(event => event.timingPoint === "object-moved").length, 2);
});

test("EG-LOCATIONS stale Void Assault target is ignored without rebinding the returned card", () => {
  const f = voidFixture();
  const stale = f.kernel.ref("enemy");
  f.engine.commit({ type: "return-to-hand", object: stale });
  f.engine.commit({ type: "move-zone", object: f.kernel.ref("enemy"), to: "base" });
  const returned = f.kernel.ref("enemy");
  f.engine.advance();
  resolveAll(f.engine);
  assert.notDeepEqual(returned, stale);
  assert.deepEqual(f.kernel.getObject("enemy").location, base("B"));
  assert.equal(f.engine.pipeline.events.filter(event => event.timingPoint === "object-moved").length, 1);
});

test("EG-LOCATIONS permission queries consume restrictions registered by the production primitive", () => {
  const f = fixture({ cards: [{ id: "destination", ...locationObject("destination") }] });
  f.engine.commit({ type: "move-zone", object: f.kernel.ref("destination"), to: "battlefield", location: field("destination") });
  f.engine.advance();
  f.engine.execute(f.draft("restricted", { body: [
    { id: "restrict", op: "continuous.movement", args: { restriction: c("cannot-move"), addsPermission: c(false), appliesTo: c({ objectId: "source" }), duration: c("this-turn") } },
  ] }));
  resolveAll(f.engine);
  assert.equal(f.engine.layers.registry.list().length, 1);
  const before = f.kernel.stateForTest();
  assert.deepEqual(queryMoveDestinations(f.kernel, [f.kernel.ref("source")], {}, { registry: f.engine.layers.registry }), []);
  assert.ok(queryMoveDestinations(f.kernel, [f.kernel.ref("enemy")], {}, { registry: f.engine.layers.registry }).length > 0);
  assert.deepEqual(f.kernel.stateForTest(), before);
});

test("EG-LOCATIONS reads a real Move receipt's destination as a linked Location", () => {
  const kernel = world().unit("moving", { location: field("origin") }).unit("anchor", { location: field("destination") }).build();
  const context = kernel.clone({ sourceSnapshot: kernel.getObject("moving") });
  const outcome = resolveChainBody([
    { id: "move", op: "effect.move", args: { objects: c("source"), to: c(field("destination")) } },
    { id: "read", op: "condition.value", args: { value: { kind: "location", value: { kind: "linked-location", instructionId: "move", key: "moved" } } } },
  ], context);
  assert.deepEqual(outcome.linkedValues["read.value"], field("destination"));
  assert.equal(sameLocation(outcome.linkedValues["read.value"], { id: "destination", type: "battlefield" }), true);
});

test("EG-LOCATIONS interpreted relative Base constants never become the runtime PlayerId self", () => {
  const kernel = world().unit("source", { location: field("origin") }).build();
  const outcome = resolveChainBody([{ id: "move", op: "effect.move", args: { to: c({ type: "base", player: "self" }) } }], kernel);
  assert.equal(outcome.status, "executed");
  assert.deepEqual(kernel.getObject("source").location, base("A"));
  assert.deepEqual(normalizeMoveArguments({ to: c("controller-base") }, kernel).to, c("controller-base"));
});

test("EG-LOCATIONS dynamic destination binding honors the primitive's Move amount", () => {
  const initial = world().unit("source", { location: base("A") }).unit("second", { location: field("destination") }).build();
  const kernel = initial.clone({ sourceSnapshot: initial.getObject("source") });
  kernel.setTargets("group", [kernel.ref("source"), kernel.ref("second")]);
  kernel.setAnswers({ "move/destination": field("destination") });
  const outcome = resolveChainBody([{
    id: "move", op: "effect.move", args: {
      objects: c({ target: "group" }), amount: c(1),
      to: { kind: "location", value: { kind: "choose", id: "destination", filter: { type: "battlefield" } } },
    },
  }], kernel);
  assert.equal(outcome.linkedValues["move.moved"].count, 1);
  assert.deepEqual(kernel.getObject("source").location, field("destination"));
  assert.deepEqual(kernel.getObject("second").location, field("destination"));
  assert.equal(kernel.events.length, 1);
});

test("EG-LOCATIONS zero Move amount submits no action or destination choice", () => {
  const initial = world().unit("source", { location: field("origin") }).build();
  const kernel = initial.clone({ sourceSnapshot: initial.getObject("source") });
  const before = kernel.stateForTest();
  const outcome = resolveChainBody([{
    id: "move", op: "effect.move", args: {
      amount: c(0), to: { kind: "location", value: { kind: "choose", id: "destination", filter: { type: "battlefield" } } },
    },
  }], kernel);
  assert.equal(outcome.linkedValues["move.moved"].count, 0);
  assert.deepEqual(kernel.stateForTest(), before);
});

test("EG-LOCATIONS duplicate bound references do not hide another moving object's origin", () => {
  const initial = world()
    .unit("source", { location: base("A") })
    .unit("second", { location: field("second-origin") })
    .object("empty", locationObject("empty"))
    .build();
  const kernel = initial.clone({ sourceSnapshot: initial.getObject("source") });
  kernel.setTargets("group", [kernel.ref("source"), kernel.ref("source"), kernel.ref("second")]);
  const body = [{
    id: "move", op: "effect.move", args: {
      objects: c({ target: "group" }), amount: c(2),
      to: { kind: "location", value: { kind: "choose", id: "destination", filter: { type: "battlefield" } } },
    },
  }];
  let request;
  assert.throws(() => resolveChainBody(body, kernel), error => { request = error.request; return error instanceof AwaitChoice; });
  assert.deepEqual(request.options, [field("empty")]);
  kernel.setAnswers({ [request.id]: field("empty") });
  assert.equal(resolveChainBody(body, kernel).linkedValues["move.moved"].count, 2);
  assert.deepEqual(kernel.getObject("second").location, field("empty"));
});

test("EG-LOCATIONS Isolate's original controller-base primitive destination remains relative to its enemy target", () => {
  const f = fixture();
  f.engine.commit({ type: "move-location", object: f.kernel.ref("enemy"), to: field("origin") });
  f.engine.advance();
  f.answers.set("target:isolate.enemy-unit-at-battlefield", [f.kernel.ref("enemy")]);
  f.engine.execute(f.draft("isolate", { body: translateBody(playBody(isolate)) }));
  resolveAll(f.engine);
  assert.deepEqual(f.kernel.getObject("enemy").location, base("B"));
  assert.equal(f.kernel.player("A").handSize, 1);
});
