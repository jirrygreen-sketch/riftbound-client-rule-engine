import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/ogn/morbid-return.js";
import zone from "../../../../engine-core/dist/effects/instructions/effect.zone.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";

const CARD_ID = "card.hash-6d8e159513836dafac8b110c3107086e5b6f6971b99ba6ddfb0e749be264be76";
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

test("ogn-170-298 Morbid Return: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues, null, 2));
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /continuous\.timing/);
  // Re-sweep: the [Action] expansion is merged; the blocking gaps are the
  // layers/canAct consumer and the CardProgram play binding (RIFT-257).
  assert.match(program.judgeReason, /actionTimings/);
  assert.match(program.judgeReason, /RIFT-257/);
  assert.equal(
    program.sourceText,
    "[Action] (Play on your turn or in showdowns.)\n" +
      "Return a unit from your trash to your hand."
  );
  assert.equal(cardRegistryById.get(CARD_ID), program);
});

test("ogn-170-298 Morbid Return: [Action] keyword plus a unit-card-in-your-trash target", () => {
  assert.equal(program.abilities.length, 2);
  assert.deepEqual(program.abilities[0], { kind: "keyword", keyword: "action" });

  assert.equal(play.kind, "play");
  assert.equal(play.cost, undefined);
  assert.equal(play.body.length, 1);
  assert.equal(returnInstruction.id, "morbid-return.return-unit");
  assert.equal(returnInstruction.op, "effect.zone");
  assert.equal(returnInstruction.linkedTo, undefined);
  assert.deepEqual(returnInstruction.args.to, { kind: "constant", value: "hand" });
  assert.deepEqual(returnInstruction.args.amount, { kind: "constant", value: 1 });

  // "a unit from your trash": a Public zone, so it IS a target (355.10.a and
  // its own example); the filter pins the zone and the controller's ownership.
  assert.deepEqual(targetSpec, {
    id: "morbid-return.unit-in-trash",
    filter: { type: "unit", zone: "trash", owner: "self" },
    min: 1,
    max: 1,
    selection: "one"
  });
  assert.equal(returnInstruction.picks, undefined);
});

test("ogn-170-298 Morbid Return golden: the unit card moves from its owner's trash to that owner's hand", () => {
  const kernel = world()
    .card("fallen-ally", { owner: "A", zone: "trash", types: ["unit"] })
    .build();
  const run = returnWithLockedTarget(kernel, kernel.ref("fallen-ally"));

  assert.equal(run.result.status, "executed");
  assert.deepEqual(run.events.map((event) => event.action), ["return-to-hand"]);
  assert.equal(kernel.getObject("fallen-ally").zone, "hand");
  assert.deepEqual(kernel.objectsInZone("A", "hand").map((ref) => ref.id), ["fallen-ally"]);
  assert.deepEqual(kernel.objectsInZone("A", "trash"), []);
});

test("ogn-170-298 Morbid Return golden: an enemy card in that trash goes to the enemy's hand", () => {
  // The action layer routes by OWNER (108.1); the filter's owner is the
  // ability controller, checked by the target system, not by re-routing here.
  const kernel = world()
    .card("enemy-card", { owner: "B", zone: "trash", types: ["unit"] })
    .build();
  const run = returnWithLockedTarget(kernel, kernel.ref("enemy-card"));

  assert.equal(run.result.status, "executed");
  assert.deepEqual(kernel.objectsInZone("B", "hand").map((ref) => ref.id), ["enemy-card"]);
  assert.deepEqual(kernel.objectsInZone("A", "hand"), []);
});

test("ogn-170-298 Morbid Return golden: a target that left its zone is ignored (359.3.e.6)", () => {
  const kernel = world()
    .card("recycled-card", { owner: "A", zone: "trash", types: ["unit"] })
    .build();
  const stale = kernel.ref("recycled-card");
  kernel.perform({ type: "recycle", object: stale });
  const run = returnWithLockedTarget(kernel, stale);

  assert.deepEqual(run.result, { status: "ignored", reason: "mistargeted" });
  assert.equal(run.events.length, 0);
  assert.equal(kernel.getObject("recycled-card").zone, "deck");
});

test.todo(
  "ogn-170-298 Morbid Return: the printed [Action] play permission (806.1.c / 159.2.a timing " +
    "grant, a Showdown play) and the printed-cost payment need a consumer of the continuous.timing " +
    "grant (chain canAct does not read layers/rules actionTimings) and a CardProgram -> ChainDraft " +
    "play adapter (RIFT-257)"
);
