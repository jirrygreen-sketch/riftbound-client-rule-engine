import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/temptation.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import move from "../../../../engine-core/dist/effects/instructions/effect.move.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

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
  assert.match(program.judgeReason, /355\.4/);
  assert.match(program.judgeReason, /effect\.move/);
  assert.match(program.judgeReason, /target\.location/);
  assert.match(program.judgeReason, /RIFT-90/);
  assert.match(program.judgeReason, /RIFT-257/);
  assert.match(program.judgeReason, /RIFT-261/);
  assert.ok(!/待实现|需要裁定/.test(program.judgeReason));
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

test("sfd-129-221 Temptation: one targeted enemy unit plus the descriptive destination", () => {
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

  // The printed destination (355.4/355.4.a) cannot be enumerated by the frozen
  // IR; the file keeps a descriptive marker instead of a guessed location.
  assert.deepEqual(moveInstruction.args.to, {
    kind: "constant",
    value: {
      kind: "destination-selector",
      filter: {
        anyUnitControlledByTheMovedUnitsController: true,
        exclude: { target: "temptation.enemy-unit" }
      }
    }
  });
});

test("sfd-129-221 Temptation golden: the merged effect.move rejects the descriptive destination", () => {
  // fail-closed evidence: the card's own `to` value is not a LocationRef,
  // "controller-base", or a static LocationRef option list, so the merged
  // primitive throws instead of moving the unit to an invented destination.
  const kernel = world()
    .unit("enemy-unit", { owner: "B", controller: "B", location: baseOf("B") })
    .unit("other-enemy", { owner: "B", controller: "B", location: { type: "battlefield", id: "battlefield-1" } })
    .build();
  kernel.setTargets("temptation.enemy-unit", [kernel.ref("enemy-unit")]);

  assert.throws(
    () => runInstruction(move, moveInstruction.args, { world: kernel }),
    /effect\.move to must be a location, controller-base, or location choice/
  );
  // Nothing moved and nothing was marked.
  assert.deepEqual(kernel.getObject("enemy-unit").location, baseOf("B"));
  assert.equal(kernel.events.length, 0);
});

test("sfd-129-221 Temptation golden: with a Finalize-chosen Location the enemy unit really moves", () => {
  // The production caller owns the Finalize destination choice (355.4/355.4.a);
  // the golden run supplies a legal location and executes the card's own
  // objects/target expressions so the Move primitive itself is covered.
  const kernel = world()
    .unit("enemy-unit", { owner: "B", controller: "B", location: baseOf("B") })
    .unit("other-enemy", { owner: "B", controller: "B", location: { type: "battlefield", id: "battlefield-1" } })
    .build();
  const before = kernel.getObject("enemy-unit");
  const run = runInstruction(
    move,
    {
      objects: moveInstruction.args.objects,
      to: { kind: "constant", value: { type: "battlefield", id: "battlefield-1" } },
      amount: moveInstruction.args.amount
    },
    { world: kernel, targets: { "temptation.enemy-unit": [kernel.ref("enemy-unit")] } }
  );

  assert.equal(run.result.status, "executed");
  assert.deepEqual(run.events.map((event) => event.action), ["move-location"]);
  assert.deepEqual(kernel.getObject("enemy-unit"), {
    ...before,
    location: { type: "battlefield", id: "battlefield-1" }
  });
  // 421.1/448.2: a Move changes Locations on the Board but never the zone.
  assert.equal(kernel.getObject("enemy-unit").zone, "board");
  assert.deepEqual(run.linked.moved, {
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
  "sfd-129-221 Temptation: 'to a location where there's a unit with the same controller' — enumerating the " +
    "runtime-legal Move Destinations at Finalize (355.4/355.4.a) and testing each Location for an occupant " +
    "controlled by the moved unit's controller needs the target.location primitive and a per-Location " +
    "occupant query — RIFT-90 (unchanged gap also recorded by ogn/charm and rad/sirens-song)"
);

test.todo(
  "sfd-129-221 Temptation: [Repeat] :rb_energy_2: — collecting the optional additional cost at Finalize " +
    "and executing the effect one extra time per paid instance (820.1.b/820.1.d/820.2.a) needs the card-program " +
    "to cost-plan optionalAdditional producer (RIFT-261)"
);
