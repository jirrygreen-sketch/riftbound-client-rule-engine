import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/rad/sirens-song.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import move from "../../../../engine-core/dist/effects/instructions/effect.move.js";
import { matchesObjectFilter } from "../../../../engine-core/dist/layers/filter.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL = "card.hash-4192b981ea612f380ed34cb8529363e9618f8f512b964c7c2d22a1323d4ef7e9";
const SOURCE_TEXT =
  "[Reaction] (Play any time, even before spells and abilities resolve.)\n" +
  "Move an enemy unit that moved this turn.";

const [keyword, play] = program.abilities;
const [moveInstruction] = play.body;

test("Siren's Song program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("Siren's Song identity, ruleset, status and printed text", () => {
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /355\.4/);
  assert.match(program.judgeReason, /moved-this-turn/);
  assert.match(program.judgeReason, /RIFT-90/);
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(program.canonicalCardId), program);
});

test("Siren's Song structure: [Reaction], printed cost, one targeted Move", () => {
  assert.deepEqual(keyword, { kind: "keyword", keyword: "reaction" });
  assert.equal(keyword.value, undefined);
  assert.equal(play.kind, "play");
  // Catalog printing: 2 energy, no printed power.
  assert.deepEqual(play.cost, {
    kind: "cost.printed",
    energy: { kind: "constant", value: 2 }
  });
  assert.equal(play.body.length, 1);
  assert.equal(moveInstruction.id, "sirens-song.move-unit");
  assert.equal(moveInstruction.op, "effect.move");
  assert.deepEqual(moveInstruction.args.objects, {
    kind: "constant",
    value: { target: "sirens-song.moved-enemy-unit" }
  });
  assert.deepEqual(moveInstruction.args.amount, { kind: "constant", value: 1 });
  // The destination is a runtime location choice with no merged selector.
  assert.equal(moveInstruction.args.to.value.kind, "destination-selector");
  assert.equal(moveInstruction.targets.length, 1);
  assert.equal(moveInstruction.targets[0].id, "sirens-song.moved-enemy-unit");
  assert.deepEqual(moveInstruction.targets[0].filter, {
    type: "unit",
    controller: "opponent",
    movedThisTurn: true
  });
  assert.equal(moveInstruction.targets[0].selection, "one");
});

test("Siren's Song fail-closed: the descriptive destination is rejected, never turned into a move", () => {
  const kernel = world().unit("enemy", { owner: "B", might: 3 }).build();
  const before = kernel.snapshot();
  // effect.move's destination() only accepts a static LocationRef, controller-base
  // or a location choice; the descriptive marker throws instead of moving the
  // enemy unit to a made-up location.
  assert.throws(
    () => runInstruction(
      move,
      {
        objects: { kind: "constant", value: { target: "sirens-song.moved-enemy-unit" } },
        to: moveInstruction.args.to,
        amount: moveInstruction.args.amount
      },
      { world: kernel, targets: { "sirens-song.moved-enemy-unit": [kernel.ref("enemy")] } }
    ),
    /effect\.move to must be a location/
  );
  assert.deepEqual(kernel.snapshot(), before);
});

test("Siren's Song fail-closed: no merged consumer enforces 'moved this turn'", () => {
  const kernel = world().unit("never-moved", { owner: "B", might: 3 }).build();
  const object = kernel.getObject("never-moved");
  const layered = {
    ...object,
    printed: object,
    actionTimings: [],
    availableTimings: [],
    movement: { allowed: true, canMove: true, canGank: false, restrictions: [] },
    text: null,
    effectText: null
  };
  // No merged consumer tracks a per-turn Move history on an object, and the
  // layer filter ignores unknown keys: a unit that never moved satisfies
  // { type: "unit", movedThisTurn: true }, so the printed predicate cannot be
  // enforced at Finalize. The card stays judge-required instead of silently
  // moving any enemy unit (355.9.b / 449).
  assert.equal(matchesObjectFilter({ type: "unit", movedThisTurn: true }, layered), true);
  // The contract-layer controller anchor is not resolved by that consumer
  // either (it compares "opponent" verbatim), which is the Finalize target
  // system's job (RIFT-90).
  assert.equal(matchesObjectFilter({ type: "unit", controller: "opponent" }, layered), false);
  assert.equal(kernel.history({ action: "move-location", object: kernel.ref("never-moved") }), 0);
});

test.todo(
  "Siren's Song: the destination of 'Move an enemy unit' is a runtime location choice " +
    "(CR 355.4 / 355.4.a / 451.1) that needs the runtime Location selector — RIFT-90 / RIFT-91"
);

test.todo(
  "Siren's Song: 'an enemy unit that moved this turn' needs a moved-this-turn target predicate " +
    "(CR 449 / 355.9.b); condition.history cannot restrict target legality — RIFT-90"
);
