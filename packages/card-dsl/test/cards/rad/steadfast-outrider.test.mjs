import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/rad/steadfast-outrider.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import { createProgramBinding } from "../../../../engine-core/dist/programs/index.js";
import { fixture, resolveAll } from "../../../../engine-core/test/chain/helpers.mjs";

const CANONICAL = "card.hash-af14696b17098be6286c750ebb3baaf3aeb4e4f188d7857651be5d9e4e97e053";

test("rad-128-167 Steadfast Outrider: program validates and has expected identity", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(program.judgeReason.includes("continuous.might"), true);
  assert.equal(program.judgeReason.includes("Tank"), true);
  assert.match(program.judgeReason, /controller/);
  assert.match(program.judgeReason, /queryObjects\(\)/);
  assert.match(program.judgeReason, /proven-none/);
  assert.equal(
    program.sourceText,
    "[Tank] (I must be assigned combat damage first.)\n" +
      "While there are 2 or more other friendly units and/or gear at my battlefield, I have +2 :rb_might:."
  );
});

test("rad-128-167 Steadfast Outrider: [Tank] + 条件化的 +2 Might 静态能力", () => {
  assert.equal(program.abilities.length, 2);
  const [tank, might] = program.abilities;
  assert.deepEqual(tank, { kind: "keyword", keyword: "tank" });

  assert.equal(might.kind, "static");
  assert.deepEqual(might.effect, {
    kind: "continuous.might",
    mode: "add",
    layer: "arithmetic",
    appliesTo: "self",
    amount: { kind: "constant", value: 2 }
  });

  // "2 or more other friendly units and/or gear at my battlefield"：两个集合并集计数。
  const condition = might.condition;
  assert.equal(condition.kind, "compare");
  assert.equal(condition.operator, "gte");
  assert.deepEqual(condition.right, { kind: "constant", value: 2 });
  assert.equal(condition.left.kind, "arithmetic");
  assert.equal(condition.left.operator, "add");
  assert.equal(condition.left.operands.length, 2);
  const [units, gears] = condition.left.operands;
  assert.equal(units.kind, "count");
  assert.deepEqual(units.filter, {
    type: "unit",
    zone: "board",
    controller: "controller",
    sameLocationAs: "self",
    exclude: "self"
  });
  assert.equal(gears.kind, "count");
  assert.deepEqual(gears.filter, {
    type: "gear",
    zone: "board",
    controller: "controller",
    sameLocationAs: "self",
    exclude: "self"
  });
});

test("rad-128-167 Steadfast Outrider: 条件谓词在参考内核下由真实集合查询求值", () => {
  const build = () => world()
    .unit("outrider", { location: { type: "battlefield", id: "battlefield-1" } })
    .unit("ally", { location: { type: "battlefield", id: "battlefield-1" } })
    .unit("ally-gear", { types: ["gear"], location: { type: "battlefield", id: "battlefield-1" } })
    .unit("faraway", { location: { type: "battlefield", id: "battlefield-2" } })
    .build();

  // 参考内核的 query 按值精确比较 controller（"controller" 是生产链的占位符，由
  // Finalize/Resolve 上下文解析为具体玩家），因此执行前把它替换为具体控制者 "A"。
  const withController = (filter) => ({ ...filter, controller: "A" });
  const condition = program.abilities[1].condition;
  const executableCondition = {
    ...condition,
    left: {
      ...condition.left,
      operands: condition.left.operands.map(operand => ({
        ...operand,
        filter: withController(operand.filter)
      }))
    }
  };

  const body = [
    {
      id: "steadfast-outrider.gate",
      op: "condition.predicate",
      args: { condition: { kind: "constant", value: executableCondition } }
    }
  ];

  // 1 个单位 + 1 个装备在同战场 → 2 ≥ 2，条件成立。
  const satisfied = build();
  const withBoth = satisfied.clone({ sourceSnapshot: satisfied.getObject("outrider") });
  const met = runAbilityBody(body, withBoth, undefined, { host: satisfied.ref("outrider") });
  assert.equal(met.results[0].result.status, "executed");
  assert.equal(met.results[0].result.linkedValues.value, true);

  // 只有 1 个同战场单位（远方的不计）→ 1 < 2，条件不成立。
  const scarce = world()
    .unit("outrider", { location: { type: "battlefield", id: "battlefield-1" } })
    .unit("ally", { location: { type: "battlefield", id: "battlefield-1" } })
    .unit("faraway", { location: { type: "battlefield", id: "battlefield-2" } })
    .build();
  const scoped = scarce.clone({ sourceSnapshot: scarce.getObject("outrider") });
  const unmet = runAbilityBody(body, scoped, undefined, { host: scarce.ref("outrider") });
  assert.equal(unmet.results[0].result.linkedValues.value, false);

  // 远方战场的第二个单位不计入（sameLocationAs 生效）：1 单位 + 1 装备在别处 ≠ 同战场。
  const split = world()
    .unit("outrider", { location: { type: "battlefield", id: "battlefield-1" } })
    .unit("ally", { location: { type: "battlefield", id: "battlefield-1" } })
    .unit("gear-elsewhere", { types: ["gear"], location: { type: "battlefield", id: "battlefield-2" } })
    .build();
  const splitScoped = split.clone({ sourceSnapshot: split.getObject("outrider") });
  const splitRun = runAbilityBody(body, splitScoped, undefined, { host: split.ref("outrider") });
  assert.equal(splitRun.results[0].result.linkedValues.value, false);
});

test("rad-128-167 Steadfast Outrider: 原 IR 的 self static 能力能通过生产绑定注册", () => {
  const executable = {
    canonicalCardId: program.canonicalCardId,
    rulesetVersion: program.rulesetVersion,
    status: "executable",
    abilities: program.abilities,
    sourceText: program.sourceText
  };
  const binding = createProgramBinding({ cardPrograms: [executable] });
  const board = fixture({
    cards: [{ id: "outrider", cardId: program.canonicalCardId, types: ["unit"], energy: 4, power: [], might: 3 }],
    describePlay: binding.describePlay
  });
  const errors = [];
  binding.attachLifecycle(board.engine, error => errors.push(error));
  board.engine.commit({
    type: "play",
    object: board.kernel.ref("outrider"),
    player: "A",
    location: { type: "battlefield", id: "battlefield-1" }
  });
  board.engine.advance();
  resolveAll(board.engine);
  assert.deepEqual(errors, []);
  board.engine.layers.setObjects(board.kernel.objects);
  const registration = board.engine.layers.registry.list().find(entry => entry.effect.effect.kind === "continuous.might");
  assert.ok(registration, "the appliesTo:self static ability is registered");
  assert.equal(registration.effect.filter.objectId, "outrider");
  assert.equal(registration.effect.effect.amount, 2);
});

test.todo(
  "rad-128-167 Steadfast Outrider: \"I have +2 Might\" 的原 IR static 能力可由生产绑定注册；" +
    "sameLocationAs/exclude 已由 queryObjects() 消费，剩余缺口是绑定后的条件查询未解析 controller:controller"
);

test.todo(
  "rad-128-167 Steadfast Outrider: [Tank] 的 KeywordDef 已合入并展开 continuous.combat，但" +
    "combat/base-combat-allocation.ts 的分配消费方仍是 keywordPriority: proven-none（815.1.c）"
);
