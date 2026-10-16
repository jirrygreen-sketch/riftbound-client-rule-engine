import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/stare-down.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import move from "../../../../engine-core/dist/effects/instructions/effect.move.js";
import xp from "../../../../engine-core/dist/effects/instructions/effect.xp.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL_ID =
  "card.hash-b01f4d5df7d2f8e495a921ff9e1382d11332309f969c740e6a72d9d73bf8ebd2";
const SOURCE_TEXT =
  "Choose a friendly unit and a battlefield. Move all enemy units at that battlefield with less " +
  "Might than the chosen unit to their base. Gain 1 XP.";

const [play] = program.abilities;
const [moveInstruction, xpInstruction] = play.body;
const [unitSpec, battlefieldSpec] = moveInstruction.targets;

test("unl-107-219 Stare Down: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("unl-107-219 Stare Down: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  // README section 2: name the missing primitive/semantics, the rule entry and
  // the dependency.
  assert.match(program.judgeReason, /355\.10\.d/);
  assert.match(program.judgeReason, /effect\.move/);
  assert.match(program.judgeReason, /RIFT-90/);
  assert.equal(cardRegistryById.get(CANONICAL_ID), program);
});

test("unl-107-219 Stare Down: printed 2 energy and the two-target choose clause", () => {
  assert.equal(play.kind, "play");
  assert.deepEqual(play.cost, {
    kind: "cost.printed",
    energy: { kind: "constant", value: 2 }
  });
  // No [Action]/[Reaction] keyword is printed, so none is declared (159.2.a
  // keeps the default Action timing) and there is no other ability.
  assert.equal(program.abilities.length, 1);
  assert.deepEqual(
    play.body.map((instruction) => [instruction.id, instruction.op]),
    [
      ["stare-down.move-enemy-units", "effect.move"],
      ["stare-down.gain-xp", "effect.xp"]
    ]
  );

  // "Choose a friendly unit and a battlefield": both specific Board objects are
  // targeting choices (355.5 / 355.7 / 355.9.a.1; 170 / 355.10.a.1 for the
  // battlefield) and are locked at Finalize (355.8).
  assert.deepEqual(unitSpec, {
    id: "stare-down.friendly-unit",
    filter: { type: "unit", controller: "controller", zone: "board" },
    min: 1,
    max: 1,
    selection: "one"
  });
  assert.deepEqual(battlefieldSpec, {
    id: "stare-down.battlefield",
    filter: { type: "battlefield" },
    min: 1,
    max: 1,
    selection: "one"
  });
});

test("unl-107-219 Stare Down: the moved set is a programmatic (non-target) selection", () => {
  // 355.10.d: "all enemy units at that battlefield with less Might than the
  // chosen unit" is selected by characteristics, so it must NOT be declared as
  // targets. The descriptive set marker carries the filter that no merged
  // primitive evaluates (see judgeReason).
  assert.deepEqual(moveInstruction.args.objects, {
    kind: "constant",
    value: {
      kind: "set-selector",
      filter: {
        type: "unit",
        controller: "opponent",
        zone: "board",
        sameLocationAs: { target: "stare-down.battlefield" },
        mightLessThan: { target: "stare-down.friendly-unit" }
      }
    }
  });
  // "to their base": each moved unit's own base (107.1 / 152.1).
  assert.deepEqual(moveInstruction.args.to, {
    kind: "constant",
    value: "controller-base"
  });
  assert.deepEqual(moveInstruction.args.linkKey, {
    kind: "constant",
    value: "movedEnemyUnits"
  });
  assert.equal(moveInstruction.targets.length, 2);
});

test("unl-107-219 Stare Down golden: Gain 1 XP runs through the merged primitive (728-730.1)", () => {
  const kernel = world().build();

  const run = runInstruction(xp, { amount: xpInstruction.args.amount }, { world: kernel });

  assert.equal(run.result.status, "executed");
  assert.equal(kernel.player("A").xp, 1);
  assert.equal(kernel.player("B").xp, 0);
  assert.equal(run.linked.gained, 1);
  assert.equal(run.linked.gainedTo, "A");
  assert.deepEqual(run.events.map((event) => event.action), ["gain-xp"]);
});

test("unl-107-219 Stare Down fail-closed: the merged effect.move rejects the descriptive set marker", () => {
  const kernel = world()
    .unit("ally", { owner: "A", controller: "A", might: 5 })
    .unit("enemy", {
      owner: "B",
      controller: "B",
      might: 3,
      location: { type: "battlefield", id: "bf1" }
    })
    .battlefield("bf1", { owner: "A", types: ["battlefield"] })
    .build();

  // The marker is not a source/target/pick/choose selection, so the primitive
  // refuses it instead of moving the wrong units. This is the fail-closed
  // evidence that the unimplemented half cannot silently do something else.
  assert.throws(
    () =>
      runInstruction(
        move,
        {
          objects: moveInstruction.args.objects,
          to: moveInstruction.args.to,
          linkKey: moveInstruction.args.linkKey
        },
        { world: kernel }
      ),
    /effect\.move objects must name source, target, pick, or choose/
  );
  // The enemy unit never left its battlefield.
  assert.deepEqual(kernel.getObject("enemy").location, { type: "battlefield", id: "bf1" });
});

test.todo(
  "Stare Down: \"Move all enemy units at that battlefield with less Might than the chosen unit\" needs a set/query " +
    "object selection for effect.move (355.10.d / 355.10.d.1: no choice is ever possible) plus a Might comparison " +
    "predicate and a location anchor read from another selected object (RIFT-90 target plan / RIFT-9 target.query)"
);

test.todo(
  "Stare Down: Finalize-time locking of the friendly unit and the battlefield plus their became-target events " +
    "(355.8, 754) and the base cost payment belong to the target system, the chain and the cost plan " +
    "(RIFT-89 / RIFT-90 / RIFT-120)"
);
