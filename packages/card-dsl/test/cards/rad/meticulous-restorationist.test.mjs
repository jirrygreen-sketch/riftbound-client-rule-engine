import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/rad/meticulous-restorationist.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CARD_ID = "card.hash-c53e9086202d34746759796f864fa5b794a4a294941dad556175a2e226acace5";
const SOURCE_TEXT =
  "When you play a card with Energy cost :rb_energy_7: or more, you may play me from your trash for :rb_rune_order:.";

test("rad-120-167 Meticulous Restorationist: program validates and has expected identity", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  // 缺的是“读触发事件对象基础 Energy 费用”的条件求值，不是“待实现”。
  assert.match(program.judgeReason, /Energy cost/);
  assert.match(program.judgeReason, /condition\.predicate/);
});

test("rad-120-167 Meticulous Restorationist: card-played trigger with an optional play-from-trash body", () => {
  assert.equal(program.abilities.length, 1);
  const [ability] = program.abilities;
  assert.equal(ability.kind, "triggered");
  assert.deepEqual(ability.trigger, {
    at: "card-played",
    filter: { event: "card-played", player: "controller" }
  });
  // “you may play me …”：可选触发 + 契约 3.9 的 choice.optional 包 body。
  assert.equal(ability.optional, true);
  assert.equal(ability.body.length, 1);
  const [choice] = ability.body;
  assert.equal(choice.id, "meticulous-restorationist.play-opt-in");
  assert.equal(choice.op, "choice.optional");
  assert.equal(choice.args.body.kind, "constant");

  const [play] = choice.args.body.value;
  assert.equal(choice.args.body.value.length, 1);
  assert.equal(play.id, "meticulous-restorationist.play-me");
  assert.equal(play.op, "effect.play");
  assert.equal(play.linkedTo, undefined);
  // “me from your trash”：静态 IR 用符号选择器 "source" 读自身 ref（契约 3.6），不写运行时 ObjectRef。
  assert.deepEqual(play.args.object, {
    kind: "object-property",
    object: "source",
    property: "ref"
  });
  // “for :rb_rune_order:”：已 Finalize 的费用计划（一个 Order Power），由打出动作收取。
  assert.deepEqual(play.args.cost, {
    kind: "constant",
    value: { finalized: true, power: ["Order"] }
  });
});

test("rad-120-167 Meticulous Restorationist: declining the option does nothing", () => {
  const kernel = world()
    .object("restorationist", {
      owner: "A",
      controller: "A",
      types: ["gear"],
      tags: ["Device"],
      might: 2,
      zone: "trash"
    })
    .build();
  kernel.setAnswers({ "meticulous-restorationist.play-opt-in/optional": false });
  const outcome = runAbilityBody(program.abilities[0].body, kernel);
  assert.deepEqual(outcome.results.map((result) => result.id), ["meticulous-restorationist.play-opt-in"]);
  assert.equal(outcome.results[0].result.status, "negated");
  assert.equal(outcome.results[0].result.reason, "skipped");
  assert.equal(kernel.getObject("restorationist").zone, "trash");
  assert.deepEqual(kernel.events, []);
});

test("rad-120-167 Meticulous Restorationist: accept path plays the card from trash through effect.play", () => {
  const kernel = world()
    .object("restorationist", {
      owner: "A",
      controller: "A",
      types: ["gear"],
      tags: ["Device"],
      might: 2,
      zone: "trash"
    })
    .build();
  const scoped = kernel.clone({ sourceSnapshot: kernel.getObject("restorationist") });
  const playInstruction = program.abilities[0].body[0].args.body.value[0];
  const outcome = resolveChainBody([playInstruction], scoped);
  assert.equal(outcome.status, "executed", JSON.stringify(outcome.results));
  assert.equal(outcome.results[0].result.status, "executed");
  assert.equal(scoped.getObject("restorationist").zone, "board");
  assert.deepEqual(outcome.events.map((event) => event.action), ["play"]);
  assert.deepEqual(outcome.events.map((event) => event.timingPoint), ["card-played"]);
  // 打出是区域迁移：按 124 取得新的区域身份，旧引用失效（解释器负责，IR 不写运行时时序）。
  assert.notDeepEqual(scoped.getObject("restorationist").ref, scoped.source.ref);
  assert.equal(outcome.linkedValues[`${playInstruction.id}.restored`], 1);
});

test.todo(
  "rad-120-167 Meticulous Restorationist: 触发条件“a card with Energy cost :rb_energy_7: or more”" +
    "需要读取被播下事件对象的印刷（基础）Energy 费用（206.1）；static IR 的 Condition/Expr 只能读 " +
    "self/source 静态选择器，依赖 condition.predicate / condition.value 对事件载荷的支持" +
    "（RIFT-9 condition 组，契约 3.5 事件载荷消费）"
);
test.todo(
  "rad-120-167 Meticulous Restorationist: 打出本卡的 Finalize 费用收取（Order Power 的实际支付与符文" +
    "回收）依赖费用计划 + cost.pay 管线（RIFT-89 费用批次）；本测试只锁定 effect.play 携带的已 Finalize" +
    "费用计划形状与打出动作本身"
);
test.todo(
  "rad-120-167 Meticulous Restorationist: “自己回合外从 trash 打出”的时机许可（card-played 触发进链 + " +
    "chain 的 canAct 判定）依赖触发管线与链（RIFT-120 事件/链批次）"
);
