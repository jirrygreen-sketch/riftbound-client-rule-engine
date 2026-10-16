import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/rad/bilgewater-tracker.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const BODY_ID = "bilgewater-tracker.deal-1";
const TARGET_ID = "bilgewater-tracker.units";

test("rad-003-167 Bilgewater Tracker: program validates and has expected identity", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.equal(program.status, "executable");
  assert.equal(program.judgeReason, undefined);
  assert.equal(
    program.canonicalCardId,
    "card.hash-2d8ce518b0085e019c06636c36fc6b7b008636df61dbc1370855a448825385ff"
  );
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.sourceText, "When you play me, deal 1 to each of up to 2 units.");
  assert.equal(program.abilities.length, 1);
});

test("rad-003-167: structure is a card-played self trigger with one up-to-2 unit TargetSpec", () => {
  const [ability] = program.abilities;
  assert.equal(ability.kind, "triggered");
  assert.equal(ability.trigger.at, "card-played");
  assert.deepEqual(ability.trigger.filter, { self: true });
  assert.equal(ability.trigger.once, undefined);
  assert.equal(ability.optional, false);
  assert.equal(ability.body.length, 1);

  const [instruction] = ability.body;
  assert.equal(instruction.id, BODY_ID);
  assert.equal(instruction.op, "effect.damage");
  // 固定 1 点各打一个目标，不是分摊伤害（355.14），因此没有 divide。
  assert.equal(instruction.args.divide, undefined);
  assert.deepEqual(instruction.args.amount, { kind: "constant", value: 1 });
  assert.deepEqual(instruction.args.target, { kind: "constant", value: TARGET_ID });
  assert.equal(instruction.targets.length, 1);
  const [spec] = instruction.targets;
  assert.equal(spec.id, TARGET_ID);
  assert.deepEqual(spec.filter, { type: "unit" });
  assert.equal(spec.min, 0);
  assert.equal(spec.max, 2);
  assert.equal(spec.selection, "up-to");
});

test("rad-003-167: two locked units each take exactly 1 damage", () => {
  const kernel = world()
    .unit("ally", { might: 3 })
    .unit("enemy", { owner: "B", might: 3 })
    .build();
  kernel.setTargets(TARGET_ID, [kernel.ref("ally"), kernel.ref("enemy")]);

  const outcome = resolveChainBody(program.abilities[0].body, kernel);
  assert.equal(outcome.status, "executed");
  const [result] = outcome.results;
  assert.equal(result.result.status, "executed");
  assert.equal(kernel.getObject("ally").damage, 1);
  assert.equal(kernel.getObject("enemy").damage, 1);
  assert.deepEqual(
    outcome.events.map(event => event.action),
    ["damage", "damage"]
  );
  assert.equal(outcome.linkedValues[`${BODY_ID}.dealt`], 2);
  assert.equal(outcome.linkedValues[`${BODY_ID}.dealtCount`], 2);
});

test("rad-003-167: 'up to 2' allows choosing a single unit", () => {
  const kernel = world()
    .unit("only", { might: 4 })
    .unit("untouched", { might: 4 })
    .build();
  kernel.setTargets(TARGET_ID, [kernel.ref("only")]);

  const outcome = resolveChainBody(program.abilities[0].body, kernel);
  assert.equal(outcome.status, "executed");
  assert.equal(kernel.getObject("only").damage, 1);
  assert.equal(kernel.getObject("untouched").damage, 0);
  assert.equal(outcome.linkedValues[`${BODY_ID}.dealt`], 1);
});

test("rad-003-167: zero units makes the damage instruction ignored (359.3.e.7)", () => {
  const kernel = world().unit("bystander", { might: 4 }).build();
  kernel.setTargets(TARGET_ID, []);

  const outcome = resolveChainBody(program.abilities[0].body, kernel);
  assert.equal(outcome.status, "partial");
  const [result] = outcome.results;
  assert.equal(result.result.status, "ignored");
  assert.equal(result.result.reason, "mistargeted");
  assert.equal(kernel.getObject("bystander").damage, 0);
});

test("rad-003-167: a target that leaves its zone is dropped before damage (359.3.e.8)", () => {
  const kernel = world()
    .unit("staying", { might: 4 })
    .unit("leaving", { might: 4 })
    .build();
  const stale = kernel.ref("leaving");
  kernel.perform({ type: "move-zone", object: stale, to: "hand" });
  kernel.setTargets(TARGET_ID, [kernel.ref("staying"), stale]);

  const outcome = resolveChainBody(program.abilities[0].body, kernel);
  // 部分目标失效：合法目标照常结算，交互结果整体标 partial（359.3.e.8）。
  assert.equal(outcome.status, "partial");
  const [result] = outcome.results;
  assert.equal(result.result.status, "executed");
  assert.equal(kernel.getObject("staying").damage, 1);
  assert.equal(outcome.linkedValues[`${BODY_ID}.dealt`], 1);
});

test.todo(
  "rad-003-167 Bilgewater Tracker: Finalize 期的目标选择（0..2 上限、became-target 触发、" +
    "Pending 链项排除）属于目标/链系统（RIFT-90）"
);
