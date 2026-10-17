import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/temptation.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import move from "../../../../engine-core/dist/effects/instructions/effect.move.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";

const CANONICAL = "card.hash-472f50f62c82089c0d50baa218635f3214bbef1e2eb24fc259ec1761a6a9eb19";
const SOURCE_TEXT =
  "[Repeat] :rb_energy_2: (You may pay the additional cost to repeat this spell's effect.)\n" +
  "Move an enemy unit to a location where there's a unit with the same controller.";

const [play] = program.abilities;
const [moveInstruction] = play.body;
const targetSpec = moveInstruction.targets[0];
const baseOf = (player) => ({ type: "base", player });

test("sfd-129-221 Temptation: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues, null, 2));
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL), program);
});

test("sfd-129-221 Temptation: judgeReason names the destination and [Repeat] gaps", () => {
  assert.match(program.judgeReason, /Finalize/);
  assert.match(program.judgeReason, /effect\.move/);
  assert.match(program.judgeReason, /Location/);
  assert.match(program.judgeReason, /Repeat/);
});

test("sfd-129-221 Temptation: no speed keyword is printed, only the [Repeat] cost is declared", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(
    program.abilities.some((ability) => ability.kind === "keyword"),
    false
  );
  assert.equal(play.kind, "play");
  // Printed base cost (2 energy, no power) comes from the catalog at Finalize
  // (356.1.c); [Repeat] :rb_energy_2: (820.1.c) is declared in the merged
  // sfd/frigid-touch shape and has no collector yet.
  assert.deepEqual(play.cost, {
    kind: "additional-cost",
    keyword: "repeat",
    energy: { kind: "literal", value: 2 }
  });
});

test("sfd-129-221 Temptation: one targeted enemy unit plus the runtime destination choice", () => {
  assert.equal(play.body.length, 1);
  assert.equal(moveInstruction.id, "temptation.move-enemy-unit");
  assert.equal(moveInstruction.op, "effect.move");
  assert.equal(moveInstruction.linkedTo, undefined);
  assert.deepEqual(moveInstruction.args.objects, {
    kind: "constant",
    value: { target: "temptation.enemy-unit" }
  });
  assert.deepEqual(moveInstruction.args.amount, { kind: "constant", value: 1 });

  // "Move an enemy unit": the unit is on the public Board and chosen by the
  // spell's controller, so it is a Target (355.7 / 355.9.a.1 / 355.9.b).
  assert.equal(moveInstruction.picks, undefined);
  assert.deepEqual(targetSpec, {
    id: "temptation.enemy-unit",
    filter: { type: "unit", zone: "board", controller: "opponent" },
    min: 1,
    max: 1,
    selection: "one"
  });

  // The merged LocationTargetSpec/LocationExpr path enumerates occupied
  // runtime Locations. The remaining same-controller occupant relation is
  // recorded in judgeReason.
  assert.deepEqual(moveInstruction.locations, [{
    id: "temptation.destination",
    type: "any",
    hasUnits: true,
    min: 1,
    max: 1,
    selection: "one"
  }]);
  assert.deepEqual(moveInstruction.args.to, {
    kind: "location",
    value: { kind: "target-location", target: "temptation.destination" }
  });
});

test("sfd-129-221 Temptation golden: Finalize chooses an occupied Location and effect.move consumes it", () => {
  // The production caller owns the Finalize destination choice (355.4/355.4.a);
  // the golden run supplies a legal location and executes the card's own
  // objects/target expressions so the Move primitive itself is covered.
  const kernel = world()
    .unit("enemy-unit", { owner: "B", controller: "B", location: baseOf("B") })
    .unit("other-enemy", { owner: "B", controller: "B", location: { type: "battlefield", id: "battlefield-1" } })
    .build();
  kernel.setTargets("temptation.enemy-unit", [kernel.ref("enemy-unit")]);
  kernel.setAnswers({
    "temptation.move-enemy-unit/location%3Atemptation.destination":
      { type: "battlefield", id: "battlefield-1" }
  });
  const runtimeMove = {
    ...moveInstruction,
    targets: [{ ...targetSpec, filter: { type: "unit" } }]
  };
  const before = kernel.getObject("enemy-unit");
  const run = resolveChainBody([runtimeMove], kernel);

  assert.equal(run.status, "executed");
  assert.deepEqual(run.events.map((event) => event.action), ["move-location"]);
  assert.deepEqual(kernel.getObject("enemy-unit"), {
    ...before,
    location: { type: "battlefield", id: "battlefield-1" }
  });
  // 421.1/448.2: a Move changes Locations on the Board but never the zone.
  assert.equal(kernel.getObject("enemy-unit").zone, "board");
  assert.deepEqual(run.results[0].result.linkedValues.moved, {
    count: 1,
    objects: [before.ref],
    movements: [
      { object: before.ref, from: baseOf("B"), to: { type: "battlefield", id: "battlefield-1" } }
    ]
  });
});

test("sfd-129-221 Temptation golden: a stale target is ignored when the unit already left the Board", () => {
  const kernel = world().unit("enemy-unit", { owner: "B", controller: "B", location: baseOf("B") }).build();
  const stale = kernel.ref("enemy-unit");
  kernel.perform({ type: "kill", object: stale });
  const run = runInstruction(
    move,
    {
      objects: moveInstruction.args.objects,
      to: { kind: "constant", value: { type: "battlefield", id: "battlefield-1" } },
      amount: moveInstruction.args.amount
    },
    { world: kernel, targets: { "temptation.enemy-unit": [stale] } }
  );

  assert.deepEqual(run.result, { status: "ignored", reason: "mistargeted" });
  assert.equal(run.events.length, 0);
  assert.equal(kernel.getObject("enemy-unit").zone, "trash");
});

test.todo(
  "sfd-129-221 Temptation: the LocationTargetSpec must filter occupants by the moved unit's controller, " +
    "rather than only requiring an occupied Location"
);

test.todo(
  "sfd-129-221 Temptation: the optional Repeat additional cost must be collected at Finalize and drive one additional " +
    "execution of the move effect when paid"
);
