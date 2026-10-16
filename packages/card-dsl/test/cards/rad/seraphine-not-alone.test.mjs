import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/rad/seraphine-not-alone.js";
import token from "../../../../engine-core/dist/effects/instructions/effect.token.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import { matchesObjectFilter } from "../../../../engine-core/dist/layers/filter.js";

const CANONICAL = "card.hash-628d472ac3458206c95d893f3af0ac4bc4561ccd533988196a3c1c20ccd7eb20";
const BASE = { type: "base", player: "A" };

const abilities = () => program.abilities;

test("rad-138-167 Seraphine, Not Alone: program validates and has expected identity", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(program.judgeReason.includes("continuous.might"), true);
  assert.equal(program.judgeReason.includes("object-exhausted"), true);
  assert.equal(
    program.sourceText,
    "When you play me or when I become exhausted, play a 1 :rb_might: Recruit unit token to your base.\n" +
      "I have +1 :rb_might: for each other exhausted unit you control."
  );
});

test("rad-138-167 Seraphine, Not Alone: 打出/成为横置两个触发 + 变量 Might 静态能力", () => {
  assert.equal(program.abilities.length, 3);
  const [onPlay, onExhausted, might] = abilities();

  assert.equal(onPlay.kind, "triggered");
  assert.equal(onPlay.trigger.at, "card-played");
  assert.deepEqual(onPlay.trigger.filter, { self: true });
  assert.equal(onPlay.optional, false);

  // 415.1：从 Ready 变为 Exhausted 的时点；415.1.c 对已横置对象再横置不产生事件。
  assert.equal(onExhausted.kind, "triggered");
  assert.equal(onExhausted.trigger.at, "object-exhausted");
  assert.deepEqual(onExhausted.trigger.filter, { self: true });
  assert.equal(onExhausted.optional, false);

  for (const [label, ability, id] of [
    ["play", onPlay, "seraphine-not-alone.play-recruit-on-play"],
    ["exhausted", onExhausted, "seraphine-not-alone.play-recruit-on-exhaust"]
  ]) {
    assert.equal(ability.body.length, 1, label);
    const instruction = ability.body[0];
    assert.equal(instruction.id, id);
    assert.equal(instruction.op, "effect.token");
    // 187.1：1 Might Recruit 单位衍生物（领域无关、能量/力量为 null）。
    assert.deepEqual(instruction.args.token, { kind: "constant", value: "recruit" });
    assert.deepEqual(instruction.args.amount, { kind: "constant", value: 1 });
    // 440.2.c/185.2.a：被打出的衍生物先在链上创建再交付 play。
    assert.deepEqual(instruction.args.mode, { kind: "constant", value: "play" });
    // "to your base"：控制器基地（参考内核按具体玩家结算该位置）。
    assert.deepEqual(instruction.args.locations, {
      kind: "constant",
      value: [{ type: "base", player: "controller" }]
    });
    assert.deepEqual(instruction.args.linkKey, { kind: "constant", value: "recruitToken" });
    assert.equal(instruction.targets, undefined);
    assert.equal(instruction.linkedTo, undefined);
  }

  // "I have +1 Might for each other exhausted unit you control"：持续变量加值。
  assert.equal(might.kind, "static");
  assert.deepEqual(might.effect, {
    kind: "continuous.might",
    mode: "add",
    layer: "arithmetic",
    appliesTo: "self",
    amount: { kind: "constant", value: 1 },
    per: {
      kind: "count",
      subject: "units",
      filter: {
        type: "unit",
        zone: "board",
        controller: "controller",
        states: "exhausted",
        exclude: "self"
      }
    }
  });
  assert.equal(might.condition, undefined);
});

test("rad-138-167 Seraphine, Not Alone: effect.token 按 187.1 把 1 Might Recruit 打到底座", () => {
  const kernel = world().unit("seraphine", {}).build();
  const instruction = abilities()[0].body[0];
  const run = runInstruction(
    token,
    {
      token: instruction.args.token,
      amount: instruction.args.amount,
      mode: instruction.args.mode,
      // 参考内核不解析 "controller" 占位符；静态 IR 里保留占位，执行时给出具体玩家基地。
      locations: { kind: "constant", value: [BASE] },
      choiceId: instruction.args.choiceId,
      linkKey: instruction.args.linkKey
    },
    { world: kernel }
  );
  assert.equal(run.result.status, "executed");
  const created = kernel.query({ zone: "board", type: "unit" }).filter(object => object.isToken);
  assert.equal(created.length, 1);
  assert.equal(created[0].name, "Recruit");
  assert.equal(created[0].might, 1);
  assert.deepEqual(created[0].tags, ["Recruit"]);
  assert.deepEqual(created[0].location, BASE);
  // 185.3：衍生物无印刷费用，不得写成 0。
  assert.equal(created[0].energy, null);
  assert.equal(created[0].power, null);
  assert.equal(created[0].owner, "A");
  assert.equal(created[0].controller, "A");
  // 185.2.a/440.2.c：创建在链上，再由 play 交付（打出事件）。
  assert.deepEqual(run.events.map(event => event.action), ["create-token", "play"]);
  assert.equal(run.events[1].timingPoint, "card-played");
  assert.equal(kernel.pendingItems.length, 0);
  assert.equal(run.linked.recruitToken.amount, 1);
});

test("rad-138-167 Seraphine, Not Alone: 两个触发都按声明形状创建衍生物（一次一个）", () => {
  for (const ability of abilities().slice(0, 2)) {
    const kernel = world().unit("seraphine", {}).build();
    const instruction = ability.body[0];
    const run = runInstruction(
      token,
      {
        token: instruction.args.token,
        amount: instruction.args.amount,
        mode: instruction.args.mode,
        locations: { kind: "constant", value: [BASE] },
        choiceId: instruction.args.choiceId,
        linkKey: instruction.args.linkKey
      },
      { world: kernel }
    );
    assert.equal(run.result.status, "executed");
    assert.equal(kernel.query({ zone: "board", type: "unit" }).filter(object => object.isToken).length, 1);
  }
});

test("rad-138-167 Seraphine, Not Alone: 解释器通路的 effect.token args 形状差异（记录性断言）", () => {
  // 契约 3.6 的符号选择器与 Expr 是静态 IR 值；解释器在 dispatch 前会先对整条指令的
  // args 求值，而 effect.token 的 argsSchema 要求 token/mode 等仍是 Expr（token 原语：
  // "Invalid effect.token argument"）。这个差异与 Assembly Rig 等已合入卡片的现状一致：
  // 本卡用 runInstruction 验证 token 定义与交付流程（上面两个用例），解释器+静态
  // 选择器的整链路执行仍待解释器与令牌原语的参数形状收敛。
  const kernel = world().unit("seraphine", {}).build();
  const scoped = kernel.clone({ sourceSnapshot: kernel.getObject("seraphine") });
  assert.throws(
    () => runAbilityBody(abilities()[0].body, scoped, undefined, { host: kernel.ref("seraphine") }),
    /Invalid effect\.token argument/
  );
  // 声明的静态形状本身是正确的（token/mode 是 constant Expr，位置是占位常量）。
  const instruction = abilities()[0].body[0];
  assert.equal(instruction.args.token.kind, "constant");
  assert.equal(instruction.args.mode.value, "play");
  assert.deepEqual(instruction.args.locations.value, [{ type: "base", player: "controller" }]);
});

test("rad-138-167 Seraphine, Not Alone: per 计数的 \"other exhausted unit\" 集合可被真实查询求值", () => {
  // 参考测试内核的 query 只处理 type/types/tag/tags/controller/owner/zone/location（忽略
  // states），而生产图层过滤器（layers/filter.matchesObjectFilter）实现 states 匹配。
  // 这里组合两者：内核提供真实对象集合与身份，生产过滤器判定"已横置"。
  const declared = abilities()[2].effect.per.filter;
  assert.deepEqual(declared, {
    type: "unit",
    zone: "board",
    controller: "controller",
    states: "exhausted",
    exclude: "self"
  });
  // 生产链解析 "controller" 占位符；参考执行里替换为具体玩家 A。
  const resolved = { ...declared, controller: "A" };
  const kernel = world()
    .unit("seraphine", { exhausted: true })
    .unit("ally-exhausted", { exhausted: true })
    .unit("ally-exhausted-2", { exhausted: true })
    .unit("ally-ready", { exhausted: false })
    .unit("enemy-exhausted", { owner: "B", exhausted: true })
    .build();
  const selfRef = kernel.ref("seraphine");
  const others = kernel
    .query({ type: "unit", zone: "board", controller: "A" })
    .filter(object => !(object.ref.id === selfRef.id && object.ref.zoneEntryId === selfRef.zoneEntryId))
    .filter(object => matchesObjectFilter(resolved, {
      ...object,
      printed: object,
      actionTimings: [],
      availableTimings: [],
      movement: { allowed: true, canMove: true, canGank: false, restrictions: [] },
      text: null,
      effectText: null
    }));

  // 恰好 2 个己方"其他已横置"单位：Seraphine 自己（exclude self）、已就绪的友军
  // （states: exhausted）与敌方单位（controller）都不计入。
  assert.deepEqual(others.map(object => object.name).sort(), ["ally-exhausted", "ally-exhausted-2"]);
});

test.todo(
  "rad-138-167 Seraphine, Not Alone: \"I have +1 Might for each other exhausted unit you control\" 需要" +
    "continuous.might 的图层消费方（RIFT-91）读取 per 计数；当前静态能力只作为 IR 存在"
);

test.todo(
  "rad-138-167 Seraphine, Not Alone: \"when I become exhausted\"（object-exhausted，415.1）与\"when you" +
    " play me\"（card-played，420.4.a）的触发注册需要事件管线接线（批 4）"
);
