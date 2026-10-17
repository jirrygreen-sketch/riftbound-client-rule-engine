import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/ogn/stormbringer-volibear.js";
import damage from "../../../../engine-core/dist/effects/instructions/effect.damage.js";
// The resolution path for a card instruction is the interpreter (production uses
// chain/interpreter-adapter.ts); it maps an unreadable object characteristic to
// `ignored` instead of letting the primitive see a missing amount.
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";

const CARD_ID = "card.hash-0ff7c0201c85564ecdaf790021fc4115874fec7665a462b27901498984988f3c";

const play = program.abilities[0];
const damageInstruction = play.body[0];
const locationInstruction = play.body[1];
const moveInstruction = play.body[2];
const chosenSpec = damageInstruction.targets.find(target => target.id === "stormbringer-unit");
const battlefieldSpec = damageInstruction.targets.find(target => target.id === "stormbringer-battlefield");

test("ogn-250-298 Stormbringer: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(
    program.sourceText,
    "Choose a friendly unit in your base. Deal damage equal to its Might to all enemy " +
      "units at a battlefield, then move your unit there."
  );
  assert.equal(cardRegistryById.get(CARD_ID), program);
});

test("ogn-250-298 Stormbringer judgeReason names the derived-affected-set gap", () => {
  // 355.10.b/355.10.d: the battlefield is the target, the units are not.
  assert.match(program.judgeReason, /355\.10\.b/);
  assert.match(program.judgeReason, /355\.10\.d/);
  assert.match(program.judgeReason, /战场/);
  // RIFT-357 merged the location-target representation; the current gap is the
  // damage primitive's missing non-target query form and the derived set.
  assert.match(program.judgeReason, /ctx\.targets\(id\)/);
  assert.match(program.judgeReason, /地点目标表示本身已合入/);
  assert.match(program.judgeReason, /目标计划后续/);
});

test("ogn-250-298 Stormbringer structure: base unit and battlefield targets, bound location, move", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(play.kind, "play");
  assert.equal(play.cost, undefined);
  assert.deepEqual(play.body.map(instruction => instruction.id), [
    "stormbringer-damage",
    "stormbringer-battlefield-location",
    "stormbringer-move"
  ]);

  // "Deal damage equal to its Might": the amount is an object-property read over
  // the chosen unit's target selector, evaluated at resolution (contract 3.2).
  assert.equal(damageInstruction.op, "effect.damage");
  assert.deepEqual(damageInstruction.args.amount, {
    kind: "object-property",
    object: { target: "stormbringer-unit" },
    property: "might"
  });
  assert.equal(damageInstruction.linkedTo, undefined);

  // The damage source is not printed, so the deal action's source is the spell
  // itself (418.6.a): effect.damage's default.
  assert.equal(damageInstruction.args.source, undefined);

  assert.equal(damageInstruction.targets.length, 2);
  assert.equal(chosenSpec.id, "stormbringer-unit");
  assert.deepEqual(chosenSpec.filter, { type: "unit", controller: "controller", locationType: "base" });
  assert.equal(chosenSpec.min, 1);
  assert.equal(chosenSpec.max, 1);
  assert.equal(chosenSpec.selection, "one");

  // "all enemy units at a battlefield": 355.10.b/355.10.d make the BATTLEFIELD
  // the targeted choice, not the units; the enemies are a derived affected set
  // read from the chosen location (the missing piece).
  assert.equal(battlefieldSpec.id, "stormbringer-battlefield");
  assert.deepEqual(battlefieldSpec.filter, { type: "battlefield" });
  assert.equal(battlefieldSpec.min, 1);
  assert.equal(battlefieldSpec.max, 1);
  assert.equal(battlefieldSpec.selection, "one");
  assert.deepEqual(damageInstruction.args.appliesTo, {
    kind: "literal",
    value: {
      filter: { type: "unit", controller: "opponent" },
      location: { target: "stormbringer-battlefield" }
    }
  });

  // The battlefield's LocationRef is bound once through condition.value so the
  // move can read it back as a linked value (contract 3.9). The target spec is
  // declared once, on the damage instruction, and re-read here (355.5.b).
  const locationInstruction = play.body[1];
  assert.equal(locationInstruction.op, "condition.value");
  assert.deepEqual(locationInstruction.args.value, {
    kind: "object-property",
    object: { target: "stormbringer-battlefield" },
    property: "location"
  });
  assert.deepEqual(locationInstruction.args.key, { kind: "constant", value: "battlefieldLocation" });
  assert.equal(locationInstruction.targets, undefined);
  assert.equal(locationInstruction.linkedTo, undefined);

  // "then move your unit there" — an effect Move to the bound location. It is
  // NOT linkedTo the damage clause: the anaphora refers to the chosen unit and
  // battlefield, not to the damage action (359.3.e.14).
  assert.equal(moveInstruction.id, "stormbringer-move");
  assert.equal(moveInstruction.op, "effect.move");
  assert.equal(moveInstruction.linkedTo, undefined);
  assert.deepEqual(moveInstruction.args.objects, {
    kind: "literal",
    value: { target: "stormbringer-unit" }
  });
  assert.deepEqual(moveInstruction.args.to, {
    kind: "linked-value",
    instructionId: "stormbringer-battlefield-location",
    key: "battlefieldLocation"
  });
  assert.deepEqual(moveInstruction.args.amount, { kind: "literal", value: 1 });
});

test("ogn-250-298 Stormbringer golden: damage equals the chosen unit's Might, dealt to each enemy at the chosen battlefield", () => {
  const kernel = world()
    .base("volibear", { might: 5, owner: "A" })
    .unit("enemy-one", { might: 3, owner: "B", location: { type: "battlefield", id: "battlefield-1" } })
    .unit("enemy-two", { might: 4, owner: "B", location: { type: "battlefield", id: "battlefield-1" } })
    .build();
  const chosen = kernel.ref("volibear");
  const enemies = [kernel.ref("enemy-one"), kernel.ref("enemy-two")];

  const run = runInstruction(
    damage,
    { amount: damageInstruction.args.amount, target: battlefieldSpec.id },
    {
      world: kernel,
      targets: { "stormbringer-unit": [chosen], "stormbringer-battlefield": enemies }
    }
  );

  assert.equal(run.result.status, "executed");
  // The Might read happened at resolution time: 5 damage to each enemy (418.1.c).
  assert.equal(kernel.getObject("enemy-one").damage, 5);
  assert.equal(kernel.getObject("enemy-two").damage, 5);
  assert.equal(run.result.linkedValues.dealt, 10);
  assert.equal(run.result.linkedValues.dealtCount, 2);
});

test("ogn-250-298 Stormbringer boundary: a chosen unit lost at resolution makes the deal ignored", () => {
  const kernel = world()
    .base("volibear", { might: 4, owner: "A" })
    .unit("enemy", { might: 5, owner: "B" })
    .build();
  const stale = kernel.ref("volibear");
  // The chosen unit left the Board before the spell resolved, so the Might read
  // over its target selector has no object (359.3.e; 3.2 object-property reads
  // the resolved selector's first object).
  kernel.perform({ type: "move-zone", object: stale, to: "hand" });
  kernel.setTargets("stormbringer-unit", [stale]);
  kernel.setTargets("stormbringer-battlefield", [kernel.ref("enemy")]);

  const outcome = resolveChainBody([damageInstruction], kernel);

  assert.equal(outcome.status, "partial");
  assert.deepEqual(outcome.results[0].result, { status: "ignored", reason: "mistargeted" });
  assert.equal(kernel.getObject("enemy").damage, 0);
});

test.todo(
  "Stormbringer: a unit whose Might characteristic is null must not be read as 0 damage; the merged " +
    "reference kernel defaults Might (defaultObject may = 1), so the null-characteristic path can only " +
    "be verified once the production layers/context supplies real null Might (RIFT-91)."
);

test("ogn-250-298 Stormbringer golden: an enemy that left the board is dropped from the damage group", () => {
  const kernel = world()
    .base("volibear", { might: 3, owner: "A" })
    .unit("staying-enemy", { might: 5, owner: "B" })
    .unit("leaving-enemy", { might: 5, owner: "B" })
    .build();
  const chosen = kernel.ref("volibear");
  const stale = kernel.ref("leaving-enemy");
  kernel.perform({ type: "move-zone", object: stale, to: "hand" });

  const run = runInstruction(
    damage,
    { amount: damageInstruction.args.amount, target: battlefieldSpec.id },
    {
      world: kernel,
      targets: { "stormbringer-unit": [chosen], "stormbringer-battlefield": [kernel.ref("staying-enemy"), stale] }
    }
  );

  assert.equal(run.result.status, "executed");
  assert.equal(kernel.getObject("staying-enemy").damage, 3);
  assert.equal(run.result.linkedValues.dealtCount, 1);
});

test.todo(
  "Stormbringer: the battlefield target of 355.10.b/355.10.d plus the derived 'all enemy units at " +
    "the chosen battlefield' affected set need the non-target query form on effect.damage and a " +
    "consumer that derives the board objects at the chosen LocationRef (target-plan follow-up)."
);

test("ogn-250-298 Stormbringer golden: 'move your unit there' binds the chosen battlefield location and really moves the unit", () => {
  const kernel = world()
    .base("volibear", { might: 5, owner: "A" })
    .unit("bf", { types: ["battlefield"], owner: "A", location: { type: "battlefield", id: "bf-1" } })
    .build();
  kernel.setTargets("stormbringer-unit", [kernel.ref("volibear")]);
  kernel.setTargets("stormbringer-battlefield", [kernel.ref("bf")]);

  const outcome = resolveChainBody([locationInstruction, moveInstruction], kernel);
  assert.equal(outcome.status, "executed");
  assert.deepEqual(
    outcome.results.map(result => [result.id, result.result.status]),
    [["stormbringer-battlefield-location", "executed"], ["stormbringer-move", "executed"]]
  );
  // The bound value is the battlefield LocationRef, and the real move-location
  // action relocated the chosen unit (421 / 448-455).
  assert.deepEqual(
    outcome.linkedValues["stormbringer-battlefield-location.battlefieldLocation"],
    { type: "battlefield", id: "bf-1" }
  );
  assert.deepEqual(kernel.getObject("volibear").location, { type: "battlefield", id: "bf-1" });
  assert.deepEqual(outcome.events.map(event => event.action).filter(Boolean), ["move-location"]);
});

test("ogn-250-298 Stormbringer golden: a battlefield that left the Board ignores the bound location and the move", () => {
  const kernel = world()
    .base("volibear", { might: 5, owner: "A" })
    .unit("bf", { types: ["battlefield"], owner: "A", location: { type: "battlefield", id: "bf-1" } })
    .build();
  const stale = kernel.ref("bf");
  kernel.perform({ type: "move-zone", object: stale, to: "trash" });
  kernel.setTargets("stormbringer-unit", [kernel.ref("volibear")]);
  kernel.setTargets("stormbringer-battlefield", [stale]);

  const outcome = resolveChainBody([locationInstruction, moveInstruction], kernel);
  assert.equal(outcome.status, "partial");
  assert.deepEqual(
    outcome.results.map(result => [result.id, result.result.status, result.result.reason]),
    [
      ["stormbringer-battlefield-location", "ignored", "mistargeted"],
      ["stormbringer-move", "ignored", "mistargeted"]
    ]
  );
  // The unit stays in Base: no guessed destination was substituted.
  assert.deepEqual(kernel.getObject("volibear").location, { type: "base", player: "A" });
  assert.deepEqual(outcome.events.map(event => event.action).filter(Boolean), []);
});
