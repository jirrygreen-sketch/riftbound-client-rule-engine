import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/ogn/fight-or-flight.js";
import move from "../../../../engine-core/dist/effects/instructions/effect.move.js";
import { abilitySpeed } from "../../../../engine-core/dist/programs/keywords.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

import { buildHiddenCostPlan, payHiddenCostPlan } from "../../../../engine-core/dist/cost/kinds/hidden.js";
import { fixture, resolveAll } from "../../../../engine-core/test/chain/helpers.mjs";

const CARD_ID = "card.hash-ae89acfc3272efb2e11f1ffd438022efc8a49ff3d3e37cfa6ede1a1b15bffca7";
const play = program.abilities.find((ability) => ability.kind === "play");
const [moveInstruction] = play.body;
const targetSpec = moveInstruction.targets[0];

const moveWithLockedTarget = (kernel, ref) =>
  runInstruction(
    move,
    { objects: moveInstruction.args.objects, to: moveInstruction.args.to },
    { world: kernel, targets: { [targetSpec.id]: [ref] } }
  );

test("ogn-168-298 Fight or Flight: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues, null, 2));
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /cost\.hidden/);
  assert.match(program.judgeReason, /facedown/);
  assert.match(program.judgeReason, /card-hidden/);
  assert.match(program.judgeReason, /Champion Zone/);
  assert.equal(
    program.sourceText,
    "[Hidden] (Hide now for :rb_rune_rainbow: to react with later for :rb_energy_0:.)\n" +
      "[Action] (Play on your turn or in showdowns.)\n" +
      "Move a unit from a battlefield to its base."
  );
});

test("ogn-168-298 Fight or Flight: [Hidden] + [Action] keywords and one battlefield-scoped Move", () => {
  assert.deepEqual(program.abilities.slice(0, 2), [
    { kind: "keyword", keyword: "hidden" },
    { kind: "keyword", keyword: "action" }
  ]);

  assert.equal(play.kind, "play");
  assert.equal(play.body.length, 1);
  assert.equal(moveInstruction.id, "fight-or-flight.move-to-base");
  assert.equal(moveInstruction.op, "effect.move");
  assert.equal(moveInstruction.linkedTo, undefined);
  assert.equal(moveInstruction.condition, undefined);
  assert.deepEqual(moveInstruction.args.to, { kind: "constant", value: "controller-base" });

  // "a unit from a battlefield": one target, restricted to a battlefield
  // Location (355.9.b / 355.10.b — the battlefield is not itself a target).
  assert.equal(moveInstruction.targets.length, 1);
  assert.deepEqual(targetSpec, {
    id: "fight-or-flight.unit",
    filter: { type: "unit", zone: "board", location: "battlefield" },
    min: 1,
    max: 1,
    selection: "one"
  });
});

test("ogn-168-298 Fight or Flight: the merged Action keyword gives the card action speed", () => {
  const source = world().card("fight-or-flight", {
    cardId: CARD_ID,
    types: ["spell"],
    zone: "hand",
    energy: 2,
    power: null
  }).build().getObject("fight-or-flight");
  assert.equal(abilitySpeed(program.abilities, source), "action");
});

test("ogn-168-298 Fight or Flight golden: a unit at a battlefield moves to its base", () => {
  const kernel = world()
    .unit("attacking-unit", { owner: "A", controller: "A", might: 3, location: { type: "battlefield", id: "battlefield-1" } })
    .build();
  const run = moveWithLockedTarget(kernel, kernel.ref("attacking-unit"));

  assert.equal(run.result.status, "executed");
  assert.deepEqual(kernel.getObject("attacking-unit").location, { type: "base", player: "A" });
  assert.deepEqual(run.events.map((event) => event.action), ["move-location"]);
  assert.deepEqual(run.linked.moved, {
    count: 1,
    objects: [{ id: "attacking-unit", zoneEntryId: 1 }],
    movements: [
      {
        object: { id: "attacking-unit", zoneEntryId: 1 },
        from: { type: "battlefield", id: "battlefield-1" },
        to: { type: "base", player: "A" }
      }
    ]
  });
});

test("ogn-168-298 Fight or Flight golden: a move the controller's base cannot take is a no-op", () => {
  // Already at its own base: nothing to move, so the instruction moves nothing.
  const kernel = world()
    .unit("based-unit", { owner: "A", location: { type: "base", player: "A" } })
    .build();
  const run = moveWithLockedTarget(kernel, kernel.ref("based-unit"));

  assert.equal(run.result.status, "executed");
  assert.equal(run.events.length, 0);
  assert.deepEqual(run.linked.moved, { count: 0, objects: [], movements: [] });
});

test("ogn-168-298 Fight or Flight golden: a stale target is ignored (359.3.e)", () => {
  const kernel = world()
    .unit("leaving-unit", { owner: "A", location: { type: "battlefield", id: "battlefield-1" } })
    .build();
  const stale = kernel.ref("leaving-unit");
  kernel.perform({ type: "return-to-hand", object: stale });
  const run = moveWithLockedTarget(kernel, stale);

  assert.deepEqual(run.result, { status: "ignored", reason: "mistargeted" });
  assert.equal(run.events.length, 0);
});

test("Fight or Flight original Move body locks a battlefield target and uses its controller's base", () => {
  const f = fixture({ cards: [
    { id: "controlled-unit", owner: "A", controller: "B", types: ["unit"], might: 3 },
    { id: "gear-at-battlefield", types: ["gear"] }
  ] });
  for (const id of ["controlled-unit", "gear-at-battlefield"]) {
    f.engine.commit({ type: "move-zone", object: f.kernel.ref(id), to: "battlefield", location: { type: "battlefield", id: "battlefield-1" } });
  }
  f.engine.advance();
  f.engine.execute(f.draft("fight-or-flight-move", { body: play.body }));
  assert.deepEqual(f.engine.items[0].targetPlans[0].selected, [f.kernel.ref("controlled-unit")]);
  resolveAll(f.engine);
  assert.equal(f.kernel.getObject("controlled-unit").owner, "A");
  assert.equal(f.kernel.getObject("controlled-unit").controller, "B");
  assert.deepEqual(f.kernel.getObject("controlled-unit").location, { type: "base", player: "B" });
  assert.deepEqual(f.kernel.getObject("gear-at-battlefield").location, { type: "battlefield", id: "battlefield-1" });
  assert.deepEqual(f.engine.pipeline.events.filter(event => event.timingPoint === "became-target").map(event => event.object.ref.id), ["controlled-unit"]);
  assert.deepEqual(f.engine.pipeline.events.filter(event => event.timingPoint === "object-moved").map(event => event.object.ref.id), ["controlled-unit"]);
});

test.todo("Fight or Flight: Hide/facedown lifecycle, next-turn Reaction and Hidden battlefield target restrictions (CR 811.1.b–d)");

test("Hidden cost component: hide pays one any-domain Power; later play waives base but retains additional costs", () => {
  const base = world().player("A", { energy: 3, power: ["Mind"] })
    .hand("hidden-spell", { cardId: CARD_ID, types: ["spell"], energy: 2, power: null }).build();
  const kernel = base.clone({ sourceSnapshot: base.getObject("hidden-spell") });
  const hide = buildHiddenCostPlan(kernel, { id: "hide", mode: "hide" });
  assert.equal(hide.total.energy, 0);
  assert.equal(hide.total.power[0].amount, 1);
  const hiding = payHiddenCostPlan(kernel, hide);
  assert.deepEqual(hiding.actions[0].action.plan.power, ["Mind"]);
  assert.equal(kernel.player("A").energy, 3);
  const play = buildHiddenCostPlan(kernel, {
    id: "hidden-play", mode: "play",
    mandatoryAdditional: [{ id: "additional", cost: { energy: { kind: "constant", value: 1 } } }]
  });
  assert.equal(play.printed.energy, 2);
  assert.equal(play.printed.power, null);
  assert.equal(play.total.energy, 1);
  assert.deepEqual(play.total.power, []);
  const playing = payHiddenCostPlan(kernel, play);
  assert.equal(playing.paid, true);
  assert.equal(kernel.player("A").energy, 2);
});
