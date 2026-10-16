import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import program from "../../../dist/cards/ogn/hextech-ray.js";
import damage from "../../../../engine-core/dist/effects/instructions/effect.damage.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const [speed, play] = program.abilities;
const damageInstruction = play.body[0];
const targetSpec = damageInstruction.targets[0];

test("Hextech Ray program is valid EffectIR v2 data", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("Hextech Ray identity and status match the printing", () => {
  assert.equal(
    program.canonicalCardId,
    "card.hash-40b28488632a7824775d37e8c9c7c546f5595145c0f115e8367f9ce7f8a9773d"
  );
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "executable");
  assert.equal(program.judgeReason, undefined);
  assert.equal(
    program.sourceText,
    "[Action] (Play on your turn or in showdowns.)\n" +
      "Deal 3 to a unit at a battlefield."
  );
  assert.equal(cardRegistryById.get(program.canonicalCardId), program);
});

test("Hextech Ray is [Action] plus one targeted 3-damage instruction", () => {
  assert.equal(program.abilities.length, 2);
  // [Action] is a speed keyword ability (CR 806); the keyword registry expands
  // the permission and the card only names it.
  assert.deepEqual(speed, { kind: "keyword", keyword: "action" });

  assert.equal(play.kind, "play");
  assert.equal(play.body.length, 1);
  assert.equal(damageInstruction.id, "hextech-ray.deal-3");
  assert.equal(damageInstruction.op, "effect.damage");
  assert.deepEqual(damageInstruction.args.amount, { kind: "constant", value: 3 });
  assert.deepEqual(damageInstruction.args.target, {
    kind: "constant",
    value: "hextech-ray.unit-at-battlefield"
  });
  assert.equal(damageInstruction.linkedTo, undefined);
  assert.equal(damageInstruction.picks, undefined);
  // The printed cost (1 Energy + 1 Fury power) is declared from the catalog;
  // 206 / 204.1 keep the printed values authoritative for cost checks.
  assert.deepEqual(play.cost, {
    kind: "cost.printed",
    energy: { kind: "constant", value: 1 },
    power: { kind: "constant", value: 1 }
  });
});

test("Hextech Ray target: exactly one unit on the board, restricted to a battlefield", () => {
  assert.equal(damageInstruction.targets.length, 1);
  assert.equal(targetSpec.id, "hextech-ray.unit-at-battlefield");
  assert.deepEqual(targetSpec.filter, { type: "unit", zone: "board" });
  assert.deepEqual(targetSpec.location, { type: "battlefield" });
  assert.equal(targetSpec.min, 1);
  assert.equal(targetSpec.max, 1);
  assert.equal(targetSpec.selection, "one");
});

test("Hextech Ray golden execution: the locked unit takes exactly 3", () => {
  const kernel = world()
    .unit("enemy-at-battlefield", { owner: "B", might: 5 })
    .build();
  const run = runInstruction(
    damage,
    { amount: damageInstruction.args.amount, target: targetSpec.id },
    { world: kernel, targets: { [targetSpec.id]: [kernel.ref("enemy-at-battlefield")] } }
  );

  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.dealt, 3);
  assert.equal(run.linked.dealtCount, 1);
  assert.equal(kernel.getObject("enemy-at-battlefield").damage, 3);
  assert.deepEqual(run.events.map(event => event.action), ["damage"]);
});

test("Hextech Ray golden execution: a stale target is ignored, never redirected", () => {
  const kernel = world()
    .unit("leaving", { owner: "B", might: 5 })
    .unit("bystander", { owner: "B", might: 5 })
    .build();
  const stale = kernel.ref("leaving");
  kernel.perform({ type: "move-zone", object: stale, to: "hand" });

  const run = runInstruction(
    damage,
    { amount: damageInstruction.args.amount, target: targetSpec.id },
    { world: kernel, targets: { [targetSpec.id]: [stale] } }
  );

  assert.equal(run.result.status, "ignored");
  assert.equal(run.result.reason, "mistargeted");
  assert.equal(kernel.getObject("bystander").damage, 0);
  assert.equal(kernel.getObject("leaving").damage, 0);
});

test.todo(
  "Hextech Ray full chain play: paying 1 Energy + 1 Fury power and the [Action] " +
    "showdown permission belong to the Finalize cost plan (RIFT-89), the target " +
    "system (RIFT-90, which also owns the battlefield restriction) and the " +
    "keyword registry expansion of Action (RIFT-83)."
);
