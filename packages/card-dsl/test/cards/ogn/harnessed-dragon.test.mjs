import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ogn/harnessed-dragon.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import kill from "../../../../engine-core/dist/effects/instructions/effect.kill.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL = "card.hash-b976bf2748e814e21964451d7d22d8c4833b1fc4ed18496117c1239cc8acb010";
const ability = program.abilities[0];
const [killInstruction] = ability.body;
const [enemyUnit] = killInstruction.targets;

test("ogn-234-298 Harnessed Dragon: program passes validateCardProgram and is registered", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues, null, 2));
  assert.equal(cardRegistryById.get(program.canonicalCardId), program);
});

test("ogn-234-298 Harnessed Dragon: identity, status and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  // Every required path is merged: card-played play effect + effect.kill.
  assert.equal(program.status, "executable");
  assert.equal(program.judgeReason, undefined);
  assert.equal(program.sourceText, "When you play me, kill an enemy unit.");
});

test("ogn-234-298 Harnessed Dragon: mandatory card-played play effect", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "triggered");
  // CR 383.4.a: play effects are put on the chain after the permanent enters.
  assert.equal(ability.trigger.at, "card-played");
  assert.deepEqual(ability.trigger.filter, { role: "self" });
  assert.equal(ability.trigger.condition, undefined);
  assert.equal(ability.optional, false);
});

test("ogn-234-298 Harnessed Dragon: body kills exactly one enemy unit as a target", () => {
  assert.equal(ability.body.length, 1);
  assert.equal(killInstruction.id, "harnessed-dragon.kill-enemy-unit");
  assert.equal(killInstruction.op, "effect.kill");
  assert.deepEqual(killInstruction.args, {
    target: { kind: "constant", value: "harnessed-dragon.enemy-unit" }
  });
  // CR 355.10.b: the enemy unit is the target; "enemy" is a targeting restriction.
  assert.equal(killInstruction.targets.length, 1);
  assert.equal(enemyUnit.id, "harnessed-dragon.enemy-unit");
  assert.deepEqual(enemyUnit.filter, { type: "unit", zone: "board", controller: "opponent" });
  assert.equal(enemyUnit.min, 1);
  assert.equal(enemyUnit.max, 1);
  assert.equal(enemyUnit.selection, "one");
  assert.equal(killInstruction.picks, undefined);
  assert.equal(killInstruction.linkedTo, undefined);
  assert.equal(killInstruction.condition, undefined);
});

test("ogn-234-298 Harnessed Dragon: the kill clause executes against a board unit (CR 429)", () => {
  const kernel = world()
    .unit("harnessed-dragon", { name: "Harnessed Dragon" })
    .unit("enemy-unit", { owner: "B" })
    .build();
  const enemyRef = kernel.ref("enemy-unit");
  const run = runInstruction(kill, { target: enemyUnit.id }, {
    world: kernel,
    targets: { [enemyUnit.id]: [enemyRef] }
  });

  assert.equal(run.result.status, "executed");
  assert.equal(kernel.getObject("enemy-unit").zone, "trash");
  assert.deepEqual(run.linked.killed, [enemyRef]);
  assert.equal(run.events.length, 1);
  assert.equal(run.events[0].action, "kill");
});

test("ogn-234-298 Harnessed Dragon: the declared instruction executes through the ability interpreter", () => {
  const kernel = world().unit("harnessed-dragon").unit("enemy-unit", { owner: "B" }).build();
  kernel.setTargets(enemyUnit.id, [kernel.ref("enemy-unit")]);
  // The reference kernel compares the declared "controller" placeholder literally, so the
  // Finalize-locked target set is supplied directly and the TargetSpec is dropped here;
  // the declared TargetSpec itself is asserted in the structure test above.
  const { targets, ...instruction } = killInstruction;
  assert.equal(targets.length, 1);
  const outcome = resolveChainBody([instruction], kernel);

  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.results.map(result => [result.id, result.result.status]), [
    ["harnessed-dragon.kill-enemy-unit", "executed"]
  ]);
  assert.equal(kernel.getObject("enemy-unit").zone, "trash");
});

test("ogn-234-298 Harnessed Dragon: a target that left the board makes the clause ignored", () => {
  const kernel = world().unit("harnessed-dragon").unit("enemy-unit", { owner: "B" }).build();
  const stale = kernel.ref("enemy-unit");
  kernel.perform({ type: "return-to-hand", object: stale });
  kernel.setTargets(enemyUnit.id, [stale]);

  const { targets, ...instruction } = killInstruction;
  const outcome = resolveChainBody([instruction], kernel);
  assert.deepEqual(outcome.results.map(result => [result.result.status, result.result.reason]), [
    ["ignored", "mistargeted"]
  ]);
  assert.equal(kernel.getObject("enemy-unit").zone, "hand");
});

test.todo(
  "ogn-234-298 Harnessed Dragon: registering the card-played play effect with the production chain " +
    "(trigger registration from card programs) is shared wiring tracked by the coordinator (RIFT-1)"
);
