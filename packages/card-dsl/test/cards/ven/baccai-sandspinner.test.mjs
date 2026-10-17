// 场景执行证据与整卡阻塞：../templates/keyword-static-static-649.test.mjs
import assert from "node:assert/strict";
import { expandProgram } from "../../../../engine-core/dist/programs/keywords.js";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ven/baccai-sandspinner.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { instructionDefinitionsById } from "../../../../engine-core/dist/effects/instructions/registry.generated.js";
import { createLayerEngine } from "../../../../engine-core/dist/layers/index.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CARD_ID =
  "card.hash-43ef38def4a837781a4013a179db99f1eb1e312f85de8d9c3053f7168a1652f5";
const SOURCE_TEXT =
  "[Empower] :rb_energy_5:. This ability costs :rb_energy_3: less if you control 4 or fewer runes. " +
  "(Pay the cost: Empower me. Use only if not Empowered.)\n" +
  "[Empowered][>] I have [Deflect] and [Assault 2]. (Opponents must pay :rb_rune_rainbow: to choose me " +
  "with a spell or ability. +2 :rb_might: while I'm an attacker.)";

const [empower, costReduction, grantedKeywords] = program.abilities;

/**
 * 参考内核的 filter 比较是字面值比较，而 IR 里的 "self" / "opponent" 是契约 3.6 的符号
 * 选择符；执行用例把这一处符号绑定到真实玩家 id（与 ven/protective-sands 的既有约定一致），
 * 卡程序本身保持符号写法。
 */
function substitutePlayers(value, playerId, opponentId) {
  if (Array.isArray(value)) return value.map(item => substitutePlayers(item, playerId, opponentId));
  if (value === null || typeof value !== "object") {
    if (value === "self") return playerId;
    if (value === "opponent") return opponentId;
    return value;
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, substitutePlayers(item, playerId, opponentId)])
  );
}

/** 133.5.a.1 / 431.1：被 channel 的符文留在控制者的符文区。 */
function runeZoneWorld(player, runesTotal, channeled) {
  const kernel = world()
    .rune(Array.from({ length: runesTotal }, (_, index) => `${player}-rune-${index + 1}`), { owner: player })
    .build();
  if (channeled > 0) {
    assert.equal(kernel.perform({ type: "channel-rune", player, amount: channeled }).status, "done");
  }
  return kernel;
}

function evaluateCondition(condition, kernel) {
  const body = [
    {
      id: "gate",
      op: "condition.predicate",
      args: { condition: { kind: "constant", value: condition } }
    }
  ];
  const outcome = resolveChainBody(body, kernel);
  assert.equal(outcome.status, "executed");
  return outcome.results[0].result.linkedValues.value;
}

test("ven-001-166 Baccai Sandspinner: program validates and is registered by canonicalCardId", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues, null, 2));
  assert.deepEqual(result.issues, []);
  assert.equal(cardRegistryById.get(CARD_ID), program);
});

test("ven-001-166 Baccai Sandspinner: identity, ruleset, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  // judgeReason 必须点名真正的缺口，而不是泛泛的「未实现」。
  assert.match(program.judgeReason, /Empower/);
  assert.match(program.judgeReason, /827\.1\.c\.1/);
  assert.match(program.judgeReason, /continuous\.cost-modification/);
  assert.match(program.judgeReason, /continuous\.grant-keyword/);
  assert.match(program.judgeReason, /ObjectSnapshot/);
  assert.match(program.judgeReason, /Chain Finalize/);
  assert.ok(!/RIFT-89|RIFT-90|RIFT-91/.test(program.judgeReason));
  assert.ok(!/待实现|需要裁定/.test(program.judgeReason));
  assert.equal(program.sourceText, SOURCE_TEXT);
});

test("ven-001-166: Empower 5 is declared with the printed cost and not expanded", () => {
  assert.deepEqual(empower, { kind: "keyword", keyword: "empower", value: 5 });
  assert.equal(empower.params, undefined);
});

test("ven-001-166: the 'costs 3 less' clause rewrites that Empower activation only under 4-or-fewer runes", () => {
  // 827.1.c.3 / 206.1：该文本改写的是这条 Empower 起动费用，不是独立效果。
  assert.equal(costReduction.kind, "static");
  assert.equal(costReduction.effect.kind, "continuous.cost-modification");
  assert.equal(costReduction.effect.resource, "energy");
  assert.equal(costReduction.effect.appliesTo, "empower-activation-cost");
  assert.deepEqual(costReduction.effect.amount, { kind: "constant", value: -3 });
  // 356.6：Energy 费用不能被减到 0 以下。
  assert.equal(costReduction.effect.minimum, 0);
  // 133.5.a.1 / 431.1：条件是控制者符文区的 rune 数量 <= 4。
  assert.equal(costReduction.condition.kind, "compare");
  assert.equal(costReduction.condition.operator, "lte");
  assert.deepEqual(costReduction.condition.right, { kind: "constant", value: 4 });
  assert.equal(costReduction.condition.left.kind, "count");
  assert.equal(costReduction.condition.left.subject, "runes");
  assert.deepEqual(costReduction.condition.left.filter, {
    type: "rune",
    controller: "self",
    zone: "rune-zone"
  });
});

test("ven-001-166: the Empowered dependent ability grants Deflect 1 and Assault 2 to self", () => {
  // 828.1.b.1：等价于「持有 Empowered 时本牌获得 '[Text]'」。
  assert.equal(grantedKeywords.kind, "static");
  assert.deepEqual(grantedKeywords.effect, {
    kind: "continuous.grant-keyword",
    appliesTo: "self",
    keywords: [
      { id: "deflect", value: 1 },
      { id: "assault", value: 2 }
    ]
  });
  // 809.1.b.3 的省略值按 1、807.1.b 的印刷值 2 各自保留；卡内不重写展开。
  // 828.1.c 的门控使用来源的实时 empowered 计数。
  assert.deepEqual(grantedKeywords.condition, {
    kind: "compare",
    left: { kind: "object-property", object: "self", property: "empowered" },
    operator: "gte",
    right: { kind: "constant", value: 1 }
  });
});

test("ven-001-166 review evidence: the grant primitive is merged", () => {
  assert.equal(instructionDefinitionsById.has("continuous.grant-keyword"), true);
});

test("ven-001-166 golden: the [Empowered] grant shape really registers Deflect 1 and Assault 2 through layers", () => {
  // 本例只测授予原语；来源的 828.1.c 门控在下方独立执行。用本卡声明的 static
  // effect 形状真实执行一次，断言 ability 图层注册与求值结果（grumpy-rockbear 同款 golden）。
  const kernel = world()
    .unit("baccai-sandspinner", { types: ["unit"], zone: "board", owner: "A", controller: "A", might: 6 })
    .build();
  const context = kernel.clone({ sourceSnapshot: kernel.getObject("baccai-sandspinner") });
  const body = [{
    id: "baccai-sandspinner.grant-keywords",
    op: "continuous.grant-keyword",
    args: {
      keywords: { kind: "constant", value: grantedKeywords.effect.keywords },
      appliesTo: { kind: "constant", value: "self" }
    }
  }];
  const outcome = runAbilityBody(body, context);

  assert.equal(outcome.status, "executed");
  // keywords 列表是「一个对象一条注册」：两个关键词走同一条 ability 层注册（与
  // continuous.grant-keyword 的 keywords 分支约定一致）。
  assert.equal(context.continuousEffects.length, 1);
  const registrations = context.continuousEffects.map((entry, index) => ({
    effect: entry.effect,
    duration: entry.duration,
    timestamp: index + 1
  }));
  const layers = createLayerEngine(context.objects, registrations);
  const evaluated = layers.evaluate(context.ref("baccai-sandspinner"));
  assert.deepEqual(
    evaluated.keywords.map(keyword => [keyword.id, keyword.value]),
    [["deflect", 1], ["assault", 2]]
  );
  // 807.1.c：Assault 2 只在「我是攻击者时 +2 [M]」；未指定 combatRole 时不该加 Might。
  assert.equal(evaluated.might, 6);
});

test("ven-001-166 golden: the '4 or fewer runes' condition really evaluates on the rune zone (133.5.a.1)", () => {
  const condition = substitutePlayers(costReduction.condition, "A", "B");

  const four = runeZoneWorld("A", 4, 4);
  assert.equal(evaluateCondition(condition, four), true);
  assert.equal(four.query({ type: "rune", controller: "A", zone: "rune-zone" }).length, 4);

  const five = runeZoneWorld("A", 5, 5);
  assert.equal(evaluateCondition(condition, five), false);
  assert.equal(five.query({ type: "rune", controller: "A", zone: "rune-zone" }).length, 5);

  // 符文仍在符文牌库时不算「控制」：431.1 的 channel 才是进入符文区的动作。
  const unchanneled = runeZoneWorld("A", 4, 0);
  assert.equal(evaluateCondition(condition, unchanneled), true);
  assert.equal(unchanneled.query({ type: "rune", controller: "A", zone: "rune-zone" }).length, 0);
});

test.todo(
  "ven-001-166 Baccai Sandspinner: pass the printed Empower 5 cost and its conditional -3 Energy discount into activation Finalize (827.1.c.1/c.3)"
);
test.todo(
  "ven-001-166 Baccai Sandspinner: integrate the live empowered grant with granted Assault expansion and Deflect Power tax in Chain Finalize (807.1.c / 809.1.c / 828.1.c)"
);

test("baccai-sandspinner: the merged Empower definition expands through the real program adapter", () => {
  const kernel = world().unit("keyword-host", {
    cardId: program.canonicalCardId, energy: null, power: null
  }).build();
  const { expanded } = expandProgram(program, kernel.getObject("keyword-host"));
  assert.equal(expanded.length, 1);
  const [activation] = expanded;
  assert.equal(activation.kind, "activated");
  assert.equal(activation.timing, "action");
  // The missing printed-cost bridge must never turn this into a free activation.
  assert.deepEqual(activation.cost, { kind: "empower" });
  assert.deepEqual(activation.restriction, { kind: "empower", condition: {
    kind: "compare",
    left: { kind: "object-property", object: "self", property: "empowered" },
    operator: "eq", right: { kind: "constant", value: 0 }
  } });
  assert.equal(activation.body[0].id, `empower:${program.canonicalCardId}`);
  assert.equal(activation.body[0].op, "effect.empower");
  assert.deepEqual(activation.body[0].args, { amount: { kind: "constant", value: 1 } });
  assert.deepEqual(activation.body[0].condition, activation.restriction.condition);
  assert.equal(activation.body[0].targets, undefined);
  assert.equal(program.status, "judge-required");
});

test("baccai-sandspinner: the source gate evaluates the actual empowered state", () => {
  const kernel = world().unit("gate-host", { energy: null, power: null }).build();
  const context = kernel.clone({ sourceSnapshot: kernel.getObject("gate-host") });
  const body = [{ id: "gate", op: "condition.predicate", args: {
    condition: { kind: "constant", value: grantedKeywords.condition }
  } }];
  const evaluate = () => {
    const outcome = runAbilityBody(body, context);
    assert.equal(outcome.status, "executed");
    return outcome.results[0].result.linkedValues.value;
  };
  assert.equal(evaluate(), false);
  assert.equal(context.perform({ type: "empower", object: context.ref("gate-host") }).status, "done");
  assert.equal(evaluate(), true);
  assert.equal(context.perform({ type: "disempower", object: context.ref("gate-host") }).status, "done");
  assert.equal(evaluate(), false);
  assert.deepEqual(context.events.map(event => event.action), ["empower", "disempower"]);
});
