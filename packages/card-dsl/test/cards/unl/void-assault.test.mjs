import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/void-assault.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import move from "../../../../engine-core/dist/effects/instructions/effect.move.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL_ID =
  "card.hash-0dde19360e49952c6ec4a5b094d28bc2fde4ec115f51db8aa98e331b73edae1e";
const SOURCE_TEXT =
  "Move a friendly unit, then move an enemy unit. " +
  "(If they both move to a battlefield you don't control, you're the attacker.)";

const [play] = program.abilities;
const [moveFriendly, moveEnemy] = play.body;

test("unl-202-219 Void Assault: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("unl-202-219 Void Assault: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL_ID), program);
  // The destination is a Finalize-time Location choice with no merged runtime
  // selector, and the nested-target Finalize surface blocks the shape.
  assert.match(program.judgeReason, /355\.4/);
  assert.match(program.judgeReason, /355\.4\.a/);
  assert.match(program.judgeReason, /451\.1/);
  assert.match(program.judgeReason, /RIFT-357/);
  assert.match(program.judgeReason, /RIFT-358/);
  assert.match(program.judgeReason, /assertFinalizationSurface/);
  // The reminder is the combat procedure, not a third instruction.
  assert.match(program.judgeReason, /466\.2\.c\.1/);
});

test("unl-202-219 Void Assault: two independent effect.move instructions, friendly then enemy", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(play.kind, "play");
  assert.equal(play.cost, undefined);
  // No printed [Action]/[Reaction] line: spells default to Action timing
  // (159.2.a), so no speed keyword is declared.
  assert.equal(program.abilities.some((ability) => ability.kind === "keyword"), false);
  assert.deepEqual(
    play.body.map((instruction) => instruction.id),
    ["void-assault.move-friendly-unit", "void-assault.move-enemy-unit"]
  );

  // "then" only orders the two Moves (055 / 359.3.e.11): no instruction
  // references the other's result, so neither is linked (README section 4).
  assert.equal(moveFriendly.linkedTo, undefined);
  assert.equal(moveEnemy.linkedTo, undefined);
  for (const instruction of [moveFriendly, moveEnemy]) {
    assert.equal(instruction.op, "effect.move");
    assert.deepEqual(instruction.args.amount, { kind: "constant", value: 1 });
    // The printed destination is absent, so the Move's destination is chosen
    // during Finalize (355.4/355.4.a); the marker is descriptive and the
    // interpreter rejects it instead of moving the unit somewhere wrong.
    assert.deepEqual(instruction.args.to, {
      kind: "constant",
      value: { kind: "destination-selector", filter: { type: "location" } }
    });
  }

  // 355.7 / 355.9.a.1 / 355.10: each moved unit is a target with its own
  // controller restriction.
  assert.deepEqual(moveFriendly.targets, [
    {
      id: "void-assault.friendly-unit",
      filter: { type: "unit", controller: "self" },
      min: 1,
      max: 1,
      selection: "one"
    }
  ]);
  assert.deepEqual(moveEnemy.targets, [
    {
      id: "void-assault.enemy-unit",
      filter: { type: "unit", controller: "opponent" },
      min: 1,
      max: 1,
      selection: "one"
    }
  ]);
});

test("unl-202-219 Void Assault golden: both Moves really relocate their units", () => {
  const kernel = world()
    .unit("friendly", { owner: "A", might: 2, location: { type: "battlefield", id: "bf-1" } })
    .unit("enemy", { owner: "B", might: 2, location: { type: "battlefield", id: "bf-1" } })
    .build();
  const friendly = runInstruction(
    move,
    {
      objects: moveFriendly.args.objects,
      to: { kind: "constant", value: { type: "battlefield", id: "bf-2" } },
      amount: moveFriendly.args.amount
    },
    { world: kernel, targets: { "void-assault.friendly-unit": [kernel.ref("friendly")] } }
  );
  assert.equal(friendly.result.status, "executed");
  assert.deepEqual(kernel.getObject("friendly").location, { type: "battlefield", id: "bf-2" });

  const enemy = runInstruction(
    move,
    {
      objects: moveEnemy.args.objects,
      to: { kind: "constant", value: { type: "battlefield", id: "bf-2" } },
      amount: moveEnemy.args.amount
    },
    { world: kernel, targets: { "void-assault.enemy-unit": [kernel.ref("enemy")] } }
  );
  assert.equal(enemy.result.status, "executed");
  assert.deepEqual(kernel.getObject("enemy").location, { type: "battlefield", id: "bf-2" });

  // Both units ended up at the same battlefield; the attacker designation the
  // reminder describes is the combat procedure's outcome (466.2.c.1-c.3), not
  // something the card sets.
  assert.deepEqual(kernel.getObject("friendly").location, kernel.getObject("enemy").location);
  assert.deepEqual(
    [...friendly.events, ...enemy.events].map((event) => event.action),
    ["move-location", "move-location"]
  );
  // Neither Move changed ownership.
  assert.equal(kernel.getObject("friendly").owner, "A");
  assert.equal(kernel.getObject("enemy").owner, "B");
});

test("unl-202-219 Void Assault golden: a Move to the unit's current location moves nothing", () => {
  const kernel = world()
    .unit("enemy", { owner: "B", might: 2, location: { type: "battlefield", id: "bf-1" } })
    .build();
  const run = runInstruction(
    move,
    {
      objects: moveEnemy.args.objects,
      to: { kind: "constant", value: { type: "battlefield", id: "bf-1" } },
      amount: moveEnemy.args.amount
    },
    { world: kernel, targets: { "void-assault.enemy-unit": [kernel.ref("enemy")] } }
  );
  assert.equal(run.result.status, "executed");
  assert.deepEqual(run.linked.moved.count, 0);
  assert.deepEqual(kernel.getObject("enemy").location, { type: "battlefield", id: "bf-1" });
  assert.deepEqual(run.events, []);
});

test("unl-202-219 Void Assault golden: a stale enemy reference is mistargeted instead of moved", () => {
  const kernel = world().unit("enemy", { owner: "B", might: 2 }).build();
  const stale = kernel.ref("enemy");
  assert.equal(kernel.perform({ type: "kill", object: stale }).status, "done");
  const run = runInstruction(
    move,
    {
      objects: moveEnemy.args.objects,
      to: { kind: "constant", value: { type: "battlefield", id: "bf-2" } },
      amount: moveEnemy.args.amount
    },
    { world: kernel, targets: { "void-assault.enemy-unit": [stale] } }
  );
  assert.equal(run.result.status, "ignored");
  assert.equal(run.result.reason, "mistargeted");
  assert.deepEqual(run.events, []);
});

test.todo(
  "unl-202-219 Void Assault: offer each Move's destination as a runtime Location choice other than the moved unit's current location (CR 355.4/355.4.a/451.1; effect.move's to only accepts static LocationRef/controller-base/static option lists and target.location still needs RIFT-357)"
);
test.todo(
  "unl-202-219 Void Assault: finalize the two separate target specs and their destinations through the production chain (chain/engine.ts assertFinalizationSurface blocks nested targets; ordered independent picks still need RIFT-358)"
);
test.todo(
  "unl-202-219 Void Assault: emit the Contested/attacker-defender designations and the ensuing Showdown or Combat for the moves (CR 452-455, 466.2.c.1-c.3; the reminder is the combat procedure, not a card instruction - engine turn/combat batches)"
);
