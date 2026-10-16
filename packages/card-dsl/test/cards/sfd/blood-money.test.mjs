import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/blood-money.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import kill from "../../../../engine-core/dist/effects/instructions/effect.kill.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const [, play] = program.abilities;
const killInstruction = play.body[0];
const enemyToken = play.body[1];
const friendlyToken = play.body[2];

test("Blood Money program is valid EffectIR v2 data and judge-required", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(
    program.canonicalCardId,
    "card.hash-7551ce962903e76a505471142dd69fbb43e0d921a67fd4e02d1f0cc264eaec6b"
  );
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /187\.5/);
  assert.match(program.judgeReason, /143\.4/);
  assert.equal(
    program.sourceText,
    "[Action] (Play on your turn or in showdowns.)\n" +
      "Kill a unit at a battlefield with 2 :rb_might: or less. If it was an enemy unit, play a Gold gear token exhausted. If it was a friendly unit, play two Gold gear tokens exhausted."
  );
  assert.equal(cardRegistryById.get(program.canonicalCardId), program);
});

test("Blood Money structure: Action keyword, battlefield Might<=2 target, linked token branches", () => {
  assert.equal(program.abilities.length, 2);
  assert.deepEqual(program.abilities[0], { kind: "keyword", keyword: "action" });

  assert.deepEqual(
    play.body.map((instruction) => instruction.id),
    ["blood-money.kill", "blood-money.enemy-token", "blood-money.friendly-tokens"]
  );

  // "Kill a unit at a battlefield with 2 [M] or less": the unit is the target
  // (355.10 / 355.10.b); the location and Might cap are target restrictions
  // (355.9.b) and stay declared as filter data.
  assert.equal(killInstruction.op, "effect.kill");
  assert.deepEqual(killInstruction.args.target, { kind: "constant", value: "blood-money.unit" });
  assert.equal(killInstruction.targets.length, 1);
  const [target] = killInstruction.targets;
  assert.equal(target.id, "blood-money.unit");
  assert.equal(target.selection, "one");
  assert.equal(target.min, 1);
  assert.equal(target.max, 1);
  assert.deepEqual(target.filter, {
    type: "unit",
    locationType: "battlefield",
    mightAtMost: 2
  });

  // The two token branches are linked to the kill (359.3.e.14) and each
  // carries its own "if it was an enemy/friendly unit" condition (contract
  // 3.4: a condition applies to exactly the instruction that owns it).
  assert.equal(enemyToken.op, "effect.play-gold-token-exhausted");
  assert.equal(enemyToken.linkedTo, "blood-money.kill");
  assert.deepEqual(enemyToken.args.amount, { kind: "constant", value: 1 });
  assert.equal(enemyToken.condition.operator, "ne");
  assert.deepEqual(enemyToken.condition.left, {
    kind: "object-property",
    object: { linked: "blood-money.kill" },
    property: "controller"
  });

  assert.equal(friendlyToken.op, "effect.play-gold-token-exhausted");
  assert.equal(friendlyToken.linkedTo, "blood-money.kill");
  assert.deepEqual(friendlyToken.args.amount, { kind: "constant", value: 2 });
  assert.equal(friendlyToken.condition.operator, "eq");
  assert.deepEqual(friendlyToken.condition.right, {
    kind: "object-property",
    object: "source",
    property: "controller"
  });
});

test("Blood Money golden: the kill half kills the locked battlefield unit", () => {
  const kernel = world()
    .unit("victim", { owner: "B", might: 2, location: { type: "battlefield", id: "battlefield-1" } })
    .build();
  const locked = kernel.ref("victim");
  const run = runInstruction(kill, { target: "blood-money.unit" }, {
    world: kernel,
    targets: { "blood-money.unit": [locked] }
  });
  assert.equal(run.result.status, "executed");
  assert.deepEqual(run.linked.killed, [locked]);
  assert.equal(kernel.getObject("victim").zone, "trash");
  assert.deepEqual(run.events.map((event) => event.action), ["kill"]);
});

test("Blood Money golden: a stale target is ignored instead of being redirected", () => {
  const kernel = world()
    .unit("victim", { owner: "B", might: 2, location: { type: "battlefield", id: "battlefield-1" } })
    .build();
  const stale = kernel.ref("victim");
  kernel.perform({ type: "return-to-hand", object: stale });
  const run = runInstruction(kill, { target: "blood-money.unit" }, {
    world: kernel,
    targets: { "blood-money.unit": [stale] }
  });
  assert.deepEqual(run.result, { status: "ignored", reason: "mistargeted" });
  assert.equal(run.events.length, 0);
});

test("Blood Money golden: the enemy/friendly branch reads the killed unit's controller", () => {
  // The condition is evaluated against the linked kill result; 359.3.e.13
  // allows the look-back at the controller the unit had before dying.
  for (const [owner, expected] of [["B", true], ["A", false]]) {
    const kernel = world()
      .hand("spell", { owner: "A", types: ["spell"] })
      .unit("victim", { owner, might: 2, location: { type: "battlefield", id: "battlefield-1" } })
      .build();
    kernel.setTargets("blood-money.unit", [kernel.ref("victim")]);
    const outcome = runAbilityBody([
      killInstruction,
      {
        id: "branch-probe",
        op: "condition.predicate",
        args: { condition: { kind: "constant", value: enemyToken.condition } }
      }
    ], kernel);
    assert.equal(outcome.results[0].result.status, "executed");
    assert.equal(outcome.results[1].result.linkedValues.value, expected);
  }
});

test.todo(
  "Blood Money token branches: the Gold gear token (CR 187.5, with its own activated " +
    "ability) is played exhausted (143.4 / 185.2.d entry override) through chain creation plus " +
    "the play handoff (440.2.c / 185.2.a); 依赖 Gold token 定义、入场替代与链上 token 管线"
);

test.todo(
  "Blood Money target legality: Finalize must restrict the kill target to units at a " +
    "battlefield with Might 2 or less (355.9.b) and exclude Pending chain items (355.9 / 3.4); " +
    "依赖目标系统（target.filter 的数值谓词）"
);
