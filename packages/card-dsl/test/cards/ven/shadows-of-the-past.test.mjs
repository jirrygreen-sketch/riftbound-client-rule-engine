import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ven/shadows-of-the-past.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import zone from "../../../../engine-core/dist/effects/instructions/effect.zone.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CARD_ID = "card.hash-66b8b9aff7c3cbf41b72ad3e4354a07d6905da96adb60bde378d1638b8f87b6d";
const SOURCE_TEXT = "Return up to 2 units from trashes to their owners' hands.";

const [play] = program.abilities;
const [returnUnits] = play.body;
const [unitsSpec] = returnUnits.targets;

const returnWithLockedTargets = (kernel, refs) =>
  runInstruction(
    zone,
    {
      target: returnUnits.args.target.value,
      to: returnUnits.args.to,
      amount: returnUnits.args.amount
    },
    { world: kernel, targets: { [unitsSpec.id]: refs } }
  );

test("ven-103-166 Shadows of the Past: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
});

test("ven-103-166 Shadows of the Past: identity, ruleset, status and exact source text", () => {
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CARD_ID), program);
});

test("ven-103-166 Shadows of the Past: judgeReason names the cross-player candidate-set gap", () => {
  assert.match(program.judgeReason, /up to 2/);
  assert.match(program.judgeReason, /355\.9\.a/);
  assert.match(program.judgeReason, /355\.13/);
  assert.match(program.judgeReason, /RIFT-90/);
  assert.match(program.judgeReason, /不近似实现/);
});

test("ven-103-166 Shadows of the Past: printed 3 Energy + 1 Chaos Power cost and one zone instruction", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(play.kind, "play");
  assert.deepEqual(play.cost, {
    kind: "cost.printed",
    energy: { kind: "constant", value: 3 },
    power: { kind: "constant", value: 1 }
  });
  assert.deepEqual(play.body.map(instruction => [instruction.id, instruction.op]), [
    ["shadows-of-the-past.return-units", "effect.zone"]
  ]);

  // 448.2 / 108.1: a zone change whose destination is each card's owner's hand;
  // the action layer routes by owner, so no player argument is written.
  assert.deepEqual(returnUnits.args.target, {
    kind: "constant",
    value: "shadows-of-the-past.units-in-trashes"
  });
  assert.deepEqual(returnUnits.args.to, { kind: "constant", value: "hand" });
  assert.deepEqual(returnUnits.args.amount, { kind: "constant", value: 2 });
  assert.equal(returnUnits.linkedTo, undefined);
  assert.equal(returnUnits.picks, undefined);

  // 355.12 / 355.13: "up to 2" may choose any number including zero, so the
  // TargetSpec is selection "up-to" with min 0 and max 2; 355.9.a / 355.10.a
  // make a unit card in a Public Trash a target (no controller restriction is
  // printed, but the cross-player candidate set has no producer).
  assert.deepEqual(unitsSpec, {
    id: "shadows-of-the-past.units-in-trashes",
    filter: { type: "unit", zone: "trash" },
    min: 0,
    max: 2,
    selection: "up-to"
  });
});

test("ven-103-166 Shadows of the Past golden: both units go to their OWN owners' hands (108.1)", () => {
  const kernel = world()
    .card("friendly-fallen", { owner: "A", zone: "trash", types: ["unit"] })
    .card("enemy-fallen", { owner: "B", zone: "trash", types: ["unit"] })
    .build();
  const run = returnWithLockedTargets(kernel, [
    kernel.ref("friendly-fallen"),
    kernel.ref("enemy-fallen")
  ]);

  assert.equal(run.result.status, "executed");
  // The destination is each card's owner's hand, not the caster's: the enemy
  // card returns to the enemy's hand (108.1 / 123).
  assert.deepEqual(kernel.objectsInZone("A", "hand").map(ref => ref.id), ["friendly-fallen"]);
  assert.deepEqual(kernel.objectsInZone("B", "hand").map(ref => ref.id), ["enemy-fallen"]);
  assert.deepEqual(kernel.zone("A", "trash"), []);
  assert.deepEqual(kernel.zone("B", "trash"), []);
  assert.deepEqual(run.events.map(event => event.action), ["return-to-hand", "return-to-hand"]);
  assert.deepEqual(run.linked.movedIds, ["friendly-fallen", "enemy-fallen"]);
});

test("ven-103-166 Shadows of the Past golden: choosing fewer than two returns only those units (355.13)", () => {
  const kernel = world()
    .card("returned", { owner: "A", zone: "trash", types: ["unit"] })
    .card("left-behind", { owner: "A", zone: "trash", types: ["unit"] })
    .build();
  const run = returnWithLockedTargets(kernel, [kernel.ref("returned")]);

  assert.equal(run.result.status, "executed");
  assert.deepEqual(kernel.objectsInZone("A", "hand").map(ref => ref.id), ["returned"]);
  assert.deepEqual(kernel.objectsInZone("A", "trash").map(ref => ref.id), ["left-behind"]);
});

test("ven-103-166 Shadows of the Past golden: a target that left its zone is ignored (359.3.e.6)", () => {
  const kernel = world()
    .card("recycled", { owner: "A", zone: "trash", types: ["unit"] })
    .build();
  const stale = kernel.ref("recycled");
  // The card changes zones before resolution, so its old zone-bound reference is
  // unusable and the instruction does not execute anything.
  kernel.perform({ type: "recycle", object: stale });
  const run = returnWithLockedTargets(kernel, [stale]);

  assert.deepEqual(run.result, { status: "ignored", reason: "mistargeted" });
  assert.deepEqual(run.events, []);
  assert.equal(kernel.getObject("recycled").zone, "deck");
});

test.todo(
  "ven-103-166 Shadows of the Past: enumerate unit cards across every player's Trash at Finalize and let " +
    "the caster choose any number up to 2 (CR 355.9.a / 355.10.a / 355.13) — needs a cross-player zone " +
    "candidate reader in the target plan; TargetSpec filters only match per-object controller/owner " +
    "selectors and no merged anchor spans \"all players' Trash\" (RIFT-90)"
);
