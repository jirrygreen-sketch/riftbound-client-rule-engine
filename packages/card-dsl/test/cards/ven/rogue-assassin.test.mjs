import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ven/rogue-assassin.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
// effect.move / effect.ready 的 v1 原语接口要求 Expr 参数：合并解释器的普通分发会先
// 求值再解析，只有生产链适配器（chain/interpreter-adapter.ts，ChainEngine 使用）会把
// 原始 Expr 交给原语的 argsSchema。golden 用该真实生产路径执行。
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL_ID =
  "card.hash-bcd5741a34d7507d78f17972595d0f2b10828af242bd1268e24b552e6bb95ae3";
const SOURCE_TEXT =
  "[Empower] :rb_energy_3::rb_rune_rainbow: (:rb_energy_3::rb_rune_rainbow:: Empower this. " +
  "Use only if not Empowered.)\n" +
  "[Action][>] :rb_exhaust:: If it's your turn, move a friendly unit in a showdown to base " +
  "and if I'm [Empowered], ready it.";

const BATTLEFIELD = { type: "battlefield", id: "battlefield-1" };
const [empower, activated] = program.abilities;

test("ven-139-166 Rogue Assassin: validateCardProgram passes and identity is verbatim", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /Empower/);
  assert.match(program.judgeReason, /your turn/);
  assert.match(program.judgeReason, /Empowered/);
  assert.match(program.judgeReason, /showdown/);
  assert.match(program.judgeReason, /KeywordAbility/);
});

test("ven-139-166: the [Empower] keyword is declared and its merged definition accepts a printed CostSpec", () => {
  // README 第 5 节：关键词只声明身份；展开属于 effects/keywords/<keyword>.ts。
  assert.deepEqual(empower, { kind: "keyword", keyword: "empower" });
  const definition = keywordDefinitionsById.get("Empower");
  assert.ok(definition, "effects/keywords/Empower.ts must be registered");
  const [expanded] = definition.expand({
    host: { canonicalCardId: CANONICAL_ID },
    params: {
      cost: {
        kind: "activated",
        energy: { kind: "constant", value: 3 },
        payments: [{
          kind: "power",
          amount: { kind: "constant", value: 1 },
          allowedDomains: ["Fury", "Calm", "Mind", "Body", "Chaos", "Order"]
        }]
      }
    }
  });
  assert.equal(expanded.kind, "activated");
  assert.deepEqual(expanded.cost.energy, { kind: "constant", value: 3 });
  assert.deepEqual(expanded.cost.payments[0].allowedDomains, ["Fury", "Calm", "Mind", "Body", "Chaos", "Order"]);
});

test("ven-139-166: [Action][>] exhaust ability with the sentence-scoped sequence", () => {
  assert.equal(activated.kind, "activated");
  // 806.1.d：[Action][>] 是能力级许可关键词，契约 3.1 记在 activated.timing。
  assert.equal(activated.timing, "action");
  // 204.1.b / 415.5：「:」前的 :rb_exhaust: 是 Exhaust 此来源的 Base Cost。
  assert.deepEqual(activated.cost, {
    kind: "activated",
    payments: [{ kind: "exhaust", object: "self" }]
  });
  assert.equal(activated.body.length, 1);

  const [sequence] = activated.body;
  assert.equal(sequence.id, "rogue-assassin.your-turn");
  assert.equal(sequence.op, "sequence");
  // 135.2.b.5.b：句首条件作用于同句后续所有指令——谓词尚未合入，形状保留为描述性 expression。
  assert.deepEqual(sequence.condition, {
    kind: "expression",
    value: { kind: "constant", value: "your-turn" }
  });
  assert.equal(sequence.args.body.kind, "constant");
  assert.deepEqual(sequence.args.body.value.map(instruction => instruction.id), [
    "rogue-assassin.move",
    "rogue-assassin.ready"
  ]);
});

test("ven-139-166: 'move a friendly unit … to base' is one targeted effect.move", () => {
  const [move] = activated.body[0].args.body.value;
  assert.equal(move.op, "effect.move");
  assert.deepEqual(move.args.objects, {
    kind: "constant",
    value: { target: "rogue-assassin.unit" }
  });
  // 448.3 / 449.1：Move 的目的地是该单位当前控制者的 Base。
  assert.deepEqual(move.args.to, { kind: "constant", value: "controller-base" });
  assert.deepEqual(move.args.amount, { kind: "constant", value: 1 });
  assert.deepEqual(move.args.linkKey, { kind: "constant", value: "moved" });
  assert.equal(move.linkedTo, undefined);
  assert.equal(move.targets.length, 1);
  const [target] = move.targets;
  assert.equal(target.id, "rogue-assassin.unit");
  assert.deepEqual(target.filter, {
    type: "unit",
    zone: "board",
    controller: "self",
    // Showdown 是回合状态（308.1 / 310.3–310.4），ObjectFilter 没有该字段，
    // 这里只是描述性记录（见 judgeReason 第 4 条）。
    inShowdown: true
  });
  assert.equal(target.min, 1);
  assert.equal(target.max, 1);
  assert.equal(target.selection, "one");
});

test("ven-139-166: 'if I'm [Empowered], ready it' reuses the move receipt", () => {
  const [, ready] = activated.body[0].args.body.value;
  assert.equal(ready.op, "effect.ready");
  // 135.2.b.5.b：第二个条件只作用于紧随其后的指令。
  assert.deepEqual(ready.condition, {
    kind: "compare",
    left: { kind: "object-property", object: "self", property: "empowered" },
    operator: "gte",
    right: { kind: "constant", value: 1 }
  });
  // “it” = 前一条指令移动的那个单位：消费 effect.move 的 moved 回执（{ count, objects }）。
  assert.deepEqual(ready.args.objects, {
    kind: "linked-value",
    instructionId: "rogue-assassin.move",
    key: "moved"
  });
  // 依赖前序指令的结果（“it” = 被移动的单位），因此声明 linkedTo（契约 3.2）。
  assert.equal(ready.linkedTo, "rogue-assassin.move");
  assert.equal(ready.targets, undefined);
});

/**
 * 执行用的 body：只保留两个已合入子效果本身。
 * - 去掉尚未有生产上下文的条件（your-turn / self.empowered）：参考内核快照缺少回合归属
 *   和 empowered 字段时必须失败闭合，因此 golden 只执行已合入的 move/ready 子效果；
 * - 去掉 TargetSpec：过滤器里的 inShowdown 是描述性键，合并目标系统按过滤器重验时
 *   会拒绝该目标（ObjectFilter 没有该字段），因此改由内核锁定目标，原语经
 *   ctx.targets(id) 读取（effect.move 的 target 选择器语义）。
 */
const executableBody = () => {
  const [sequence] = activated.body;
  return sequence.args.body.value.map(({ condition: _condition, targets: _targets, ...instruction }) => instruction);
};

test("ven-139-166 golden: move+ready body moves the unit to base and readies it", () => {
  const kernel = world()
    .unit("rogue-assassin", { types: ["legend"], zone: "board" })
    .unit("friendly-unit", { zone: "board", location: BATTLEFIELD, exhausted: true })
    .build();
  kernel.setTargets("rogue-assassin.unit", [kernel.ref("friendly-unit")]);

  const outcome = resolveChainBody(executableBody(), kernel);

  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.results.map(result => [result.id, result.result.status]), [
    ["rogue-assassin.move", "executed"],
    ["rogue-assassin.ready", "executed"]
  ]);
  const moved = kernel.getObject("friendly-unit");
  assert.deepEqual(moved.location, { type: "base", player: "A" });
  assert.equal(moved.exhausted, false);
  assert.deepEqual(kernel.events.map(event => event.action), ["move-location", "ready"]);
  // 链接值按执行路径限定（解释器把 key 前缀化为 "<instruction path>.<linkKey>"）。
  assert.deepEqual(outcome.linkedValues["rogue-assassin.move.moved"], {
    count: 1,
    objects: [kernel.ref("friendly-unit")],
    movements: [
      {
        object: kernel.ref("friendly-unit"),
        from: BATTLEFIELD,
        to: { type: "base", player: "A" }
      }
    ]
  });
  assert.deepEqual(outcome.linkedValues["rogue-assassin.ready.readied"], {
    count: 1,
    objects: [kernel.ref("friendly-unit")]
  });
});

test("ven-139-166 golden: an already-ready unit still resolves (416.1.b)", () => {
  const kernel = world()
    .unit("rogue-assassin", { types: ["legend"], zone: "board" })
    .unit("friendly-unit", { zone: "board", location: BATTLEFIELD, exhausted: false })
    .build();
  kernel.setTargets("rogue-assassin.unit", [kernel.ref("friendly-unit")]);

  const outcome = resolveChainBody(executableBody(), kernel);

  assert.equal(outcome.status, "executed");
  assert.deepEqual(kernel.events.map(event => event.action), ["move-location"]);
  assert.equal(kernel.getObject("friendly-unit").exhausted, false);
  // 416.1.b：已就绪的对象不再重置——不提交动作、count 为 0。
  assert.deepEqual(outcome.linkedValues["rogue-assassin.ready.readied"], { count: 0, objects: [] });
});

test("ven-139-166 golden: a stale move target makes both instructions ignored (359.3.e.7)", () => {
  const kernel = world()
    .unit("rogue-assassin", { types: ["legend"], zone: "board" })
    .unit("friendly-unit", { zone: "board", location: BATTLEFIELD, exhausted: true })
    .build();
  const stale = kernel.ref("friendly-unit");
  kernel.perform({ type: "kill", object: stale });
  kernel.setTargets("rogue-assassin.unit", [stale]);

  const outcome = resolveChainBody(executableBody(), kernel);

  assert.equal(outcome.status, "partial");
  assert.deepEqual(outcome.results.map(result => [result.id, result.result.status]), [
    ["rogue-assassin.move", "ignored"],
    ["rogue-assassin.ready", "ignored"]
  ]);
  assert.equal(outcome.results[0].result.reason, "mistargeted");
  // 被忽略的链接指令也 ignored，且没有任何动作发生。
  assert.equal(outcome.results[1].result.reason, "linked-ignored");
  assert.deepEqual(kernel.events.map(event => event.action), ["kill"]);
});

test.todo(
  "ven-139-166: pass the printed 3 Energy + 1 [A] Empower cost into the registered KeywordDef " +
    "through KeywordAbility/programs/keywords.ts params.cost; the six-domain [A] payment shape itself is supported"
);

test.todo(
  "ven-139-166: 'If it's your turn' — no active-player / turn-owner predicate exists in " +
    "Condition/Expr/TriggerSpec; the sentence scope (135.2.b.5.b) is preserved as a sequence"
);

test.todo(
  "ven-139-166: \"if I'm [Empowered]\" — the card now uses compare(object-property(self, empowered)), " +
    "but production ObjectSnapshot does not expose the live empowered count"
);

test.todo(
  "ven-139-166: \"in a showdown\" — a Showdown is a turn state (308.1/310.3-4); ObjectFilter has " +
    "no showdown field, so the target layer cannot restrict the unit to a showdown"
);
