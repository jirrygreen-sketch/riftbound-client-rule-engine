import assert from "node:assert/strict";
import test from "node:test";

import conscription from "../../../card-dsl/dist/cards/unl/conscription.js";
import smokeAndMirrors from "../../../card-dsl/dist/cards/unl/smoke-and-mirrors.js";
import { queryObjects } from "../../dist/effects/interpreter/selectors.js";
import { world } from "../../dist/effects/testing/index.js";
import { ProgramBindingError } from "../../dist/programs/errors.js";
import { translateInstructionTargets, translateObjectFilter } from "../../dist/programs/filters.js";
import { TargetSelectionError } from "../../dist/target/target-plan.js";
import { cardProgram, fixture, settle } from "../rules/keywords/support.mjs";

const field = id => ({ type: "battlefield", id });
const base = player => ({ type: "base", player });
const ids = objects => objects.map(object => object.ref.id);
const environment = (context, host) => ({
  context,
  host,
  linked: id => context.linked(id),
  canLookBack: () => false,
  isIgnored: () => false,
});

test("Smoke and Mirrors locationRelation normalizes to one symbolic selected-unit relation", () => {
  const play = smokeAndMirrors.abilities.find(ability => ability.kind === "play");
  const before = structuredClone(play.body);
  const [translated] = translateInstructionTargets(play.body);
  const filter = translated.targets[1].filter;

  assert.deepEqual(filter.exclude, { target: "smoke-and-mirrors.unit-a" });
  assert.deepEqual(filter.differentLocationFrom, { target: "smoke-and-mirrors.unit-a" });
  assert.deepEqual(filter.relation, {
    relation: "different-location",
    object: { target: "smoke-and-mirrors.unit-a" },
  });
  assert.equal(Object.hasOwn(filter, "locationRelation"), false);
  assert.deepEqual(play.body, before, "the card IR is not mutated");
});

test("the normalized relation follows the selected target's live location and exact incarnation", () => {
  const kernel = world()
    .unit("unit-a", { location: field("one") })
    .unit("unit-b", { location: field("two") })
    .unit("unit-c", { location: field("one") })
    .unit("enemy", { owner: "B", controller: "B", location: field("two") })
    .build();
  const target = kernel.ref("unit-a");
  const context = kernel.clone({ targets: new Map([["selected", [target]]]) });
  const filter = translateObjectFilter({
    type: "unit",
    zone: "board",
    controller: "controller",
    exclude: { target: "selected" },
    locationRelation: "different-from-selected-unit",
  });

  assert.deepEqual(ids(queryObjects(filter, environment(context))), ["unit-b"]);
  assert.equal(context.perform({ type: "move-location", object: target, to: field("two") }).status, "done");
  assert.deepEqual(ids(queryObjects(filter, environment(context))), ["unit-c"]);

  assert.equal(context.perform({ type: "return-to-hand", object: target }).status, "done");
  assert.deepEqual(ids(queryObjects(filter, environment(context))), [], "a stale selected target fails closed");
  assert.equal(context.perform({
    type: "move-zone",
    object: context.ref("unit-a"),
    to: "battlefield",
    location: field("one"),
  }).status, "done");
  assert.notDeepEqual(context.ref("unit-a"), target);
  assert.deepEqual(ids(queryObjects(filter, environment(context))), [], "a new incarnation is not rebound by id");
});

test("locationRelation rejects unknown values, missing references, runtime refs, and conflicts", () => {
  for (const input of [
    { locationRelation: "same-as-selected-unit", exclude: { target: "first" } },
    { locationRelation: "different-from-selected-unit" },
    { locationRelation: "different-from-selected-unit", exclude: { id: "first", zoneEntryId: 1 } },
    {
      locationRelation: "different-from-selected-unit",
      exclude: { target: "first" },
      differentLocationFrom: { target: "second" },
    },
  ]) {
    assert.throws(() => translateObjectFilter(input), error => error instanceof ProgramBindingError);
  }
});

function conscriptionFixture(selected) {
  const play = conscription.abilities.find(ability => ability.kind === "play");
  const program = cardProgram("test:conscription-relation-target", play.body);
  const f = fixture({
    programs: [program],
    energy: { A: 5 },
    power: { A: [] },
    answers: { "target:conscription.enemy-unit": [selected] },
    setup(builder) {
      builder.hand("spell", { cardId: program.canonicalCardId, types: ["spell"], energy: 0, power: [] });
      builder.unit("low", { owner: "B", controller: "B", might: 3, location: field("one") });
      builder.unit("high", { owner: "B", controller: "B", might: 4, location: field("two") });
      builder.unit("own", { owner: "A", controller: "A", might: 2, location: field("one") });
    },
  });
  return { f, program };
}

test("Conscription mightLte reaches real TargetPlan and the default Chain controls and exhausts its legal target", () => {
  const { f, program } = conscriptionFixture("low");
  f.play("spell");

  assert.deepEqual(f.asked.find(request => request.id === "target:conscription.enemy-unit").options, [f.ref("low")]);
  const item = f.engine.items.find(candidate => candidate.source.cardId === program.canonicalCardId);
  assert.ok(item);
  assert.equal(item.targetPlans[0].requirement.filter.mightLte, 3);
  assert.deepEqual(item.targetPlans[0].selected, [f.ref("low")]);
  const originalRef = f.ref("low");

  settle(f.engine);
  assert.deepEqual(f.ref("low"), originalRef);
  assert.equal(f.get("low").controller, "A");
  assert.equal(f.get("low").exhausted, true);
  assert.equal(f.get("low").zone, "board");
  assert.equal(f.get("high").controller, "B");
  assert.deepEqual(f.get("high").location, field("two"));
  assert.equal(f.get("spell").zone, "trash");
});

test("Conscription rejects a printed-Might violation before payment or resolution", () => {
  const { f, program } = conscriptionFixture("high");
  const before = f.kernel.stateForTest();
  assert.throws(
    () => f.play("spell"),
    error => error instanceof TargetSelectionError && error.code === "invalid-target-choice",
  );
  assert.deepEqual(f.asked.find(request => request.id === "target:conscription.enemy-unit").options, [f.ref("low")]);
  assert.deepEqual(f.kernel.stateForTest(), before);
  assert.equal(f.engine.items.length, 0);
  assert.equal(f.engine.pipeline.events.length, 0);
  assert.equal(f.get("spell").zone, "hand");
  assert.equal(f.get("spell").cardId, program.canonicalCardId);
});

test("Smoke and Mirrors does not widen the cross-target relation when TargetPlan has no prior-target binding", () => {
  const ability = smokeAndMirrors.abilities.find(candidate => candidate.kind === "play");
  const program = cardProgram("test:smoke-and-mirrors-relation-target", ability.body);
  const f = fixture({
    programs: [program],
    answers: { "target:smoke-and-mirrors.unit-a": ["unit-a"] },
    setup(builder) {
      builder.hand("spell", { cardId: program.canonicalCardId, types: ["spell"], energy: 0, power: [] });
      builder.unit("unit-a", { location: field("one") });
      builder.unit("unit-b", { location: field("two") });
      builder.unit("unit-c", { location: field("one") });
    },
  });
  const before = f.kernel.stateForTest();

  assert.throws(
    () => f.play("spell"),
    error => error instanceof TargetSelectionError && error.code === "no-legal-targets",
  );
  assert.deepEqual(
    f.asked.find(request => request.id === "target:smoke-and-mirrors.unit-a").options,
    ["unit-a", "unit-b", "unit-c"].map(id => f.ref(id)),
  );
  assert.deepEqual(f.kernel.stateForTest(), before);
  assert.equal(f.engine.items.length, 0);
  assert.equal(f.engine.pipeline.events.length, 0);
  assert.equal(f.get("spell").zone, "hand");
});
