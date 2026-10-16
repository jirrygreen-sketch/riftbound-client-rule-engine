import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ven/patched-porobot.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const GEAR_CONDITION = program.abilities[0].trigger.condition;

/**
 * 与程序相同的触发器条件，只把契约层的占位符换成测试内核里真实存在的值：
 * filter 的 "controller": "self" 在契约里由选择管线解析为能力控制者，参考测试
 * 内核按值比较过滤器（见 README 第 3 节与 ogn/pit-rookie 的同类 golden），所以
 * 测试里显式给出 "A"。exclude 锚点保留契约 3.6 的符号选择器 "source"
 * （本文件把内核的 source 指向宿主单位），因此排除逻辑仍然走解释器的真实锚点解析，
 * 不是放宽断言、也不写运行时 ObjectRef。
 */
const conditionForKernel = () => ({
  ...GEAR_CONDITION,
  left: {
    ...GEAR_CONDITION.left,
    filter: {
      ...GEAR_CONDITION.left.filter,
      controller: "A"
    }
  }
});

/** 把内核的 source 指向宿主单位，让 exclude: "source" 解析到被测试的卡牌对象。 */
const asHost = (kernel, id) => {
  Object.defineProperty(kernel, "source", { value: kernel.getObject(id) });
  return kernel;
};

const predicateBody = condition => [
  {
    id: "patched-porobot.count-other-gear",
    op: "condition.predicate",
    args: { condition: { kind: "constant", value: condition } }
  }
];

const gearWorld = (otherGear, extra = () => {}) => {
  const builder = world()
    .base("porobot", { name: "Patched Porobot", might: 2 })
    .deck(["top", "next"]);
  for (let index = 0; index < otherGear; index += 1) {
    builder.unit("gear-" + index, { types: ["gear"], controller: "A", zone: "board" });
  }
  extra(builder);
  return builder.build();
};

test("patched-porobot: passes validateCardProgram and is executable", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.equal(
    program.canonicalCardId,
    "card.hash-37be8a79ae257a86755648f6f57b5c8b689e0187de4789bc0eca92313a847abc"
  );
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "executable");
  assert.equal(program.judgeReason, undefined);
  assert.equal(
    program.sourceText,
    "(I enter exhausted.)\nWhen you play me, if you control 3 or more other gear, draw 1."
  );
});

test("patched-porobot: one mandatory card-played trigger scoped to self", () => {
  assert.equal(program.abilities.length, 1);
  const [ability] = program.abilities;
  assert.equal(ability.kind, "triggered");
  assert.equal(ability.optional, false);
  assert.equal(ability.trigger.at, "card-played");
  assert.deepEqual(ability.trigger.filter, {
    event: "card-played",
    filter: { source: "self" }
  });
  assert.equal(ability.trigger.once, undefined);
});

test("patched-porobot: the extra clause is a trigger condition counting other gear you control", () => {
  const [ability] = program.abilities;
  const condition = ability.trigger.condition;
  // 383.2.a.1：紧跟 Condition 的附加条件从句属于触发条件本身，
  // 不是 body 里某条指令的 condition。
  assert.equal(condition.kind, "compare");
  assert.equal(condition.operator, "gte");
  assert.deepEqual(condition.right, { kind: "constant", value: 3 });
  assert.equal(condition.left.kind, "count");
  assert.equal(condition.left.subject, "gear");
  // "other gear"：exclude 锚点排除来源本身；"you control"：控制器即能力控制者。
  assert.deepEqual(condition.left.filter, {
    type: "gear",
    controller: "self",
    zone: "board",
    exclude: "self"
  });
});

test("patched-porobot: body is one unlinked effect.draw of exactly 1", () => {
  const [ability] = program.abilities;
  assert.equal(ability.body.length, 1);
  const [instruction] = ability.body;
  assert.equal(instruction.id, "patched-porobot.draw");
  assert.equal(instruction.op, "effect.draw");
  assert.deepEqual(instruction.args.amount, { kind: "constant", value: 1 });
  assert.equal(instruction.targets, undefined);
  assert.equal(instruction.picks, undefined);
  assert.equal(instruction.linkedTo, undefined);
});

test("patched-porobot: the gear count condition is true with 3+ other gear and false below", () => {
  for (const [otherGear, expected] of [[3, true], [5, true], [2, false], [0, false]]) {
    const kernel = asHost(gearWorld(otherGear), "porobot");
    const outcome = resolveChainBody(predicateBody(conditionForKernel()), kernel);
    assert.equal(outcome.status, "executed", "other gear = " + otherGear);
    assert.equal(
      outcome.linkedValues["patched-porobot.count-other-gear.value"],
      expected,
      "other gear = " + otherGear
    );
  }
});

test("patched-porobot: the source object itself is excluded from the count", () => {
  // 3 个 gear 中包含来源自身：按 "other gear" 只应数到 2 → 条件为假。
  const kernel = asHost(world()
    .base("porobot", { name: "Patched Porobot", might: 2, types: ["unit", "gear"] })
    .unit("gear-1", { types: ["gear"], controller: "A" })
    .unit("gear-2", { types: ["gear"], controller: "A" })
    .build(), "porobot");
  const outcome = resolveChainBody(predicateBody(conditionForKernel()), kernel);
  assert.equal(outcome.linkedValues["patched-porobot.count-other-gear.value"], false);
  assert.equal(kernel.query({ type: "gear", zone: "board" }).length, 3);
});

test("patched-porobot: gear in other zones or controlled by the opponent is not counted", () => {
  const kernel = asHost(gearWorld(2, builder => {
    // 第三个"我方 gear" 还在手牌：不在 Board 上，不计入。
    builder.hand("held-gear", { types: ["gear"], controller: "A" });
    // 对手控制的 gear：不是 "you control"，不计入。
    builder.unit("enemy-gear", { types: ["gear"], controller: "B" });
  }), "porobot");
  const outcome = resolveChainBody(predicateBody(conditionForKernel()), kernel);
  assert.equal(outcome.linkedValues["patched-porobot.count-other-gear.value"], false);
});

test("patched-porobot: with the condition satisfied the body really draws 1", () => {
  const kernel = gearWorld(3);
  const [ability] = program.abilities;
  const outcome = resolveChainBody(ability.body, kernel);
  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.results.map(entry => [entry.id, entry.result.status]), [
    ["patched-porobot.draw", "executed"]
  ]);
  assert.equal(kernel.player("A").handSize, 1);
  assert.equal(kernel.player("A").deckSize, 1);
  assert.equal(outcome.linkedValues["patched-porobot.draw.drawn"], 1);
});

test.todo(
  "(I enter exhausted.): 143.4 already makes exhausted entry the default for units, so the " +
    "reminder text adds no ability; asserting the entered state needs the board-entry pipeline " +
    "(CardProgram -> trigger/chain adapter, RIFT-120 follow-up) to play the unit for real"
);
test.todo(
  "patched-porobot: end-to-end card-played subscription with the trigger condition checked at " +
    "trigger time (383.2.a.1) through the CardProgram -> trigger pipeline adapter"
);
