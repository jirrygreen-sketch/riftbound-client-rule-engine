import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/rad/party-crasher.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";

const CANONICAL = "card.hash-51a7a5074ce15f7be681afd13ce27fd042c4566c3987a18a4e7dafdf0faadc53";

test("rad-122-167 Party Crasher: program validates and has expected identity", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(program.judgeReason.includes("Tank"), true);
  assert.equal(program.judgeReason.includes("continuous.cost-modification"), true);
  assert.equal(program.sourceText, "I cost :rb_energy_1: less for each exhausted unit you control.\n[Tank] (I must be assigned combat damage first.)");
  // The generated card registry indexes this program by canonicalCardId.
  assert.equal(cardRegistryById.get(CANONICAL), program);
});

test("rad-122-167 Party Crasher: [Tank] keyword plus the per-exhausted-unit energy discount", () => {
  assert.equal(program.abilities.length, 2);
  const [tank, discount] = program.abilities;

  // [Tank] 只声明关键词（815.1.b 的伤害分配要求由关键词展开负责）。
  assert.deepEqual(tank, { kind: "keyword", keyword: "tank" });

  // "I cost 1 less for each exhausted unit you control"：静态费用改写（356.4/356.4.g）。
  assert.equal(discount.kind, "static");
  assert.equal(discount.effect.kind, "continuous.cost-modification");
  assert.equal(discount.effect.resource, "energy");
  assert.equal(discount.effect.appliesTo, "self");
  assert.deepEqual(discount.effect.amount, { kind: "constant", value: -1 });

  const per = discount.effect.per;
  assert.equal(per.kind, "count");
  assert.deepEqual(per.filter, { type: "unit", controller: "controller", states: "exhausted" });

  // condition：至少 1 个可减单位（计数为 0 时无减免）。
  assert.equal(discount.condition.kind, "compare");
  assert.equal(discount.condition.operator, "gte");
  assert.deepEqual(discount.condition.right, { kind: "constant", value: 1 });
  assert.deepEqual(discount.condition.left, per);
});

test.todo(
  "rad-122-167 Party Crasher: Tank 展开（815.1.b/c 的战斗伤害分配要求：Tank 单位必须先被分配" +
    "致命伤害）依赖 effects/keywords/Tank.ts 与 combat 的分配优先级绑定，当前" +
    "base-combat-allocation.ts 显式未绑定任何 Tank/Backline 要求"
);

test.todo(
  "rad-122-167 Party Crasher: 356.4 的 \"cost 1 less for each exhausted unit you control\" 需要费用系统" +
    "在 Finalize 消费卡牌程序的 continuous.cost-modification，并按 356.4.g 在折扣步骤把 per 计数换算为" +
    "-1 × N（依赖 RIFT-89 费用计划与 RIFT-91 图层），当前没有任何指令/管线读取该静态费用改写"
);
