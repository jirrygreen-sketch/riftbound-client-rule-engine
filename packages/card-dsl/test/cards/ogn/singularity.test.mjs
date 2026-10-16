import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/ogn/singularity.js";
import damage from "../../../../engine-core/dist/effects/instructions/effect.damage.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";

const play = program.abilities[0];
const damageInstruction = play.body[0];
const targetSpec = damageInstruction.targets[0];

/** Run the card's damage instruction with the given locked target objects. */
function dealWithLockedTargets(kernel, objectIds) {
  const locked = objectIds.map(id => kernel.ref(id));
  return runInstruction(
    damage,
    { amount: damageInstruction.args.amount, target: targetSpec.id },
    { world: kernel, targets: { [targetSpec.id]: locked } }
  );
}

test("Singularity program is valid EffectIR v2 data", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("Singularity identity and status match the printing", () => {
  assert.equal(
    program.canonicalCardId,
    "card.hash-10b7d5be25093a4d318efd8639b6e34583bad10bf38adbf93b4c3733ea54221b"
  );
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "executable");
  assert.equal(program.judgeReason, undefined);
  assert.equal(program.sourceText, "Deal 6 to each of up to two units.");
  assert.equal(cardRegistryById.get(program.canonicalCardId), program);
});

test("Singularity has no keywords and one targeted damage instruction", () => {
  // No speed keyword: spells default to Action timing (CR 159.2.a).
  assert.equal(program.abilities.length, 1);
  assert.equal(play.kind, "play");
  assert.equal(play.body.length, 1);

  assert.equal(damageInstruction.op, "effect.damage");
  assert.deepEqual(damageInstruction.args.amount, { kind: "constant", value: 6 });
  // Fixed 6 to each target: not split damage (CR 355.14), so no divide flag.
  assert.equal(damageInstruction.args.divide, undefined);
  assert.equal(damageInstruction.linkedTo, undefined);
  assert.equal(damageInstruction.picks, undefined);

  // "up to two units": a single TargetSpec, selection up-to, 0..2 units.
  assert.equal(damageInstruction.targets.length, 1);
  assert.equal(targetSpec.id, "damaged-units");
  assert.deepEqual(targetSpec.filter, { types: "unit" });
  assert.equal(targetSpec.selection, "up-to");
  assert.equal(targetSpec.min, 0);
  assert.equal(targetSpec.max, 2);
});

test("Singularity golden execution: two locked units each take 6 (CR 418.1.c)", () => {
  const kernel = world().unit("first-unit").unit("second-unit").build();
  const run = dealWithLockedTargets(kernel, ["first-unit", "second-unit"]);

  assert.equal(run.result.status, "executed");
  assert.equal(kernel.getObject("first-unit").damage, 6);
  assert.equal(kernel.getObject("second-unit").damage, 6);
  assert.deepEqual(run.events.map(event => event.action), ["damage", "damage"]);
  assert.equal(run.result.linkedValues.dealt, 12);
  assert.equal(run.result.linkedValues.dealtCount, 2);
});

test("Singularity golden execution: up-to allows choosing a single unit", () => {
  const kernel = world().unit("only-unit").unit("untouched-unit").build();
  const run = dealWithLockedTargets(kernel, ["only-unit"]);

  assert.equal(run.result.status, "executed");
  assert.equal(kernel.getObject("only-unit").damage, 6);
  assert.equal(kernel.getObject("untouched-unit").damage, 0);
  assert.equal(run.result.linkedValues.dealt, 6);
  assert.equal(run.result.linkedValues.dealtCount, 1);
});

test("Singularity golden execution: only still-legal targets are damaged at resolution", () => {
  const kernel = world().unit("staying").unit("leaving").build();
  const stale = kernel.ref("leaving");
  // The second target leaves its zone before resolution; its reference dies.
  kernel.perform({ type: "move-zone", object: stale, to: "hand" });
  const run = runInstruction(
    damage,
    { amount: damageInstruction.args.amount, target: targetSpec.id },
    { world: kernel, targets: { [targetSpec.id]: [kernel.ref("staying"), stale] } }
  );

  assert.equal(run.result.status, "executed");
  assert.equal(kernel.getObject("staying").damage, 6);
  assert.equal(run.result.linkedValues.dealt, 6);
  assert.equal(run.result.linkedValues.dealtCount, 1);
});

test.todo(
  "Singularity: Finalize-time target selection, the 0..2 cap enforcement, became-target " +
    "triggers, and target legality re-verification belong to the target system (RIFT-90)."
);
