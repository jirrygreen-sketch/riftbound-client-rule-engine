import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/ogn/gust.js";
import zone from "../../../../engine-core/dist/effects/instructions/effect.zone.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CARD_ID = "card.hash-22baca2d2ee27d8cf7c15a3d1d1f215e8c0a3b8fbbe9b0edcd70d888b29a21d5";
const play = program.abilities.find((ability) => ability.kind === "play");
const [returnInstruction] = play.body;
const targetSpec = returnInstruction.targets[0];

const returnWithLockedTarget = (kernel, ref) =>
  runInstruction(
    zone,
    {
      target: returnInstruction.args.target.value,
      to: returnInstruction.args.to,
      amount: returnInstruction.args.amount
    },
    { world: kernel, targets: { [targetSpec.id]: [ref] } }
  );

test("ogn-169-298 Gust: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues, null, 2));
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /Might/);
  assert.match(program.judgeReason, /mightLte/);
  assert.match(program.judgeReason, /RIFT-90/);
  assert.equal(
    program.sourceText,
    "[Reaction] (Play any time, even before spells and abilities resolve.)\n" +
      "Return a unit at a battlefield with 3 :rb_might: or less to its owner's hand."
  );
});

test("ogn-169-298 Gust: [Reaction] keyword plus one battlefield/owner-zone target", () => {
  assert.equal(program.abilities.length, 2);
  assert.deepEqual(program.abilities[0], { kind: "keyword", keyword: "reaction" });

  assert.equal(play.kind, "play");
  assert.equal(play.body.length, 1);
  assert.equal(returnInstruction.id, "gust.return-unit");
  assert.equal(returnInstruction.op, "effect.zone");
  assert.equal(returnInstruction.linkedTo, undefined);
  assert.deepEqual(returnInstruction.args.to, { kind: "constant", value: "hand" });
  assert.deepEqual(returnInstruction.args.amount, { kind: "constant", value: 1 });

  // "a unit at a battlefield with 3 Might or less": one target with the
  // Location restriction; the Might cap stays descriptive (judgeReason).
  assert.deepEqual(targetSpec, {
    id: "gust.unit-at-battlefield",
    filter: { type: "unit", zone: "board", location: "battlefield", mightLte: 3 },
    min: 1,
    max: 1,
    selection: "one"
  });
});

test("ogn-169-298 Gust golden: the unit goes to its OWNER's hand, not the caster's (108.1)", () => {
  const kernel = world()
    .unit("enemy-unit", { owner: "B", controller: "B", location: { type: "battlefield", id: "battlefield-1" } })
    .build();
  const run = returnWithLockedTarget(kernel, kernel.ref("enemy-unit"));

  assert.equal(run.result.status, "executed");
  assert.equal(run.events[0].action, "return-to-hand");
  assert.deepEqual(run.linked.moved, 1);
  assert.deepEqual(run.linked.movedIds, ["enemy-unit"]);
  assert.deepEqual(run.linked.destination, "hand");
  assert.equal(kernel.getObject("enemy-unit").zone, "hand");
  assert.deepEqual(kernel.objectsInZone("B", "hand").map((ref) => ref.id), ["enemy-unit"]);
  assert.deepEqual(kernel.objectsInZone("A", "hand"), []);
});

test("ogn-169-298 Gust golden: a stale reference is ignored (359.3.e.6-e.8)", () => {
  const kernel = world()
    .unit("gone-unit", { owner: "B", location: { type: "battlefield", id: "battlefield-1" } })
    .build();
  const stale = kernel.ref("gone-unit");
  // The unit changes zones before resolution, so the old zone-bound reference
  // is unusable and the instruction does not execute.
  kernel.perform({ type: "return-to-hand", object: stale });
  const run = returnWithLockedTarget(kernel, stale);

  assert.deepEqual(run.result, { status: "ignored", reason: "mistargeted" });
  assert.equal(run.events.length, 0);
  assert.equal(kernel.getObject("gone-unit").zone, "hand");
});

test.todo(
  "ogn-169-298 Gust: a unit still on the board but no longer at a battlefield must be Mistargeted " +
    "by the 359.3.e.9 Location re-check at resolution, and the 'Might 3 or less' cap must gate " +
    "Finalize targeting — both need the TargetPlan resolve re-check (RIFT-90) plus a Might " +
    "predicate (RIFT-90)"
);
