import assert from "node:assert/strict";
import test from "node:test";
import { validateCardProgram } from "../../../dist/index.js";
import damage from "../../../../engine-core/dist/effects/instructions/effect.damage.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import program from "../../../dist/cards/ogs/tibbers-annie.js";

const CANONICAL =
  "card.hash-71a433d035b3ceed303ac22a2952e428f4da5dc252f95947d82c3325d1b6f0e1";
const [ability] = program.abilities;
const [instruction] = ability.body;
const BATTLEFIELD = { type: "battlefield", id: "battlefield-1" };

test("ogs-018-024 Tibbers, Annie: program validates and is judge-required", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.deepEqual(result.issues, []);
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, "When you play me, deal 3 to all units at battlefields.");
});

test("ogs-018-024 Tibbers, Annie: judgeReason names the missing non-target set damage path", () => {
  assert.match(program.judgeReason, /355\.10\.d/);
  assert.match(program.judgeReason, /effect\.damage/);
  assert.match(program.judgeReason, /query/);
});

test("ogs-018-024 Tibbers, Annie: card-played self trigger with a non-target set damage instruction", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "triggered");
  assert.equal(ability.trigger.at, "card-played");
  assert.deepEqual(ability.trigger.filter, { self: true });
  assert.equal(ability.optional, false);

  assert.equal(ability.body.length, 1);
  assert.equal(instruction.id, "tibbers-annie.damage-all-at-battlefields");
  assert.equal(instruction.op, "effect.damage");
  assert.deepEqual(instruction.args.amount, { kind: "constant", value: 3 });
  // CR 355.10.d: the set is programmatically selected, so it is NOT a target
  // group; the instruction must not declare instruction.targets (which would
  // turn it into targeting and fire became-target).
  assert.equal(instruction.targets, undefined);
  assert.deepEqual(instruction.args.setFilter, {
    kind: "constant",
    value: { type: "unit", zone: "board", locationType: "battlefield" }
  });
  assert.equal(instruction.linkedTo, undefined);
});

test("ogs-018-024 Tibbers, Annie: effect.damage deals to a pre-resolved set of units at battlefields", () => {
  // The non-target set selector is missing (judgeReason); this locks the damage
  // half by handing the primitive the objects that the set query yields: every
  // unit located at a battlefield, and never a base unit.
  const kernel = world()
    .unit("tibbers", { location: BATTLEFIELD, might: 7 })
    .unit("attacker-here", { location: BATTLEFIELD, might: 3 })
    .unit("other-field", { location: { type: "battlefield", id: "battlefield-2" } })
    .unit("base-unit", { location: { type: "base", player: "A" } })
    .build();

  // The reference kernel compares location filters by exact shape, so the card's
  // battlefield-type shorthand is resolved against the concrete location here.
  const atBattlefields = kernel.objects
    .filter(object => object.zone === "board" && object.location?.type === "battlefield")
    .map(object => object.ref);
  assert.equal(atBattlefields.length, 3, "only the three units on battlefields are in the set");

  const run = runInstruction(
    damage,
    // effect.damage takes Expr arguments (the merged primitive's schema); the
    // card's amount Expr is passed through unchanged and the target id is a
    // plain TargetSpec id string.
    { amount: instruction.args.amount, target: "tibbers-set" },
    { world: kernel, targets: { "tibbers-set": atBattlefields } }
  );
  assert.equal(run.result.status, "executed");
  assert.equal(kernel.getObject("tibbers").damage, 3);
  assert.equal(kernel.getObject("attacker-here").damage, 3);
  assert.equal(kernel.getObject("other-field").damage, 3);
  assert.equal(kernel.getObject("base-unit").damage, 0);
  assert.deepEqual(run.events.map(event => event.action), ["damage", "damage", "damage"]);
});

test("ogs-018-024 Tibbers, Annie: an empty battlefield set leaves the instruction ignored, not redirected", () => {
  const kernel = world()
    .unit("base-unit", { location: { type: "base", player: "A" } })
    .build();
  const run = runInstruction(
    damage,
    { amount: instruction.args.amount, target: "tibbers-set" },
    { world: kernel, targets: { "tibbers-set": [] } }
  );
  // CR 359.3.e.6-e.9: no available object for the set -> mistargeted, and no
  // damage is redirected to a base unit.
  assert.deepEqual(run.result, { status: "ignored", reason: "mistargeted" });
  assert.equal(kernel.getObject("base-unit").damage, 0);
  assert.equal(run.events.length, 0);
});

test.todo(
  "ogs-018-024 Tibbers, Annie: 'deal 3 to all units at battlefields' resolves as a non-target set " +
    "(CR 355.10.d, 418.1.c/418.1.d, 754) — effect.damage has no { kind: 'query', filter } selector " +
    "like effect.ready, so no write of instruction.targets may stand in for it (RIFT-89/90, RIFT-120)"
);
