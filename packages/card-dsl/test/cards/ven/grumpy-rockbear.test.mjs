// 场景执行证据与整卡阻塞：../templates/keyword-static-static-649.test.mjs
import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ven/grumpy-rockbear.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { instructionDefinitionsById } from "../../../../engine-core/dist/effects/instructions/registry.generated.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import { createLayerEngine } from "../../../../engine-core/dist/layers/index.js";
import { expandProgram, translateCost } from "../../../../engine-core/dist/programs/index.js";
import { fixture } from "../../../../engine-core/test/chain/helpers.mjs";

const [empower, costReduction, grantedKeywords] = program.abilities;

test("grumpy-rockbear: passes validateCardProgram and is judge-required", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.equal(
    program.canonicalCardId,
    "card.hash-1318a3352539e807f9e1630c856d2c196aa0c08582d7d3c992b230a01f6fe243"
  );
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(cardRegistryById.get(program.canonicalCardId), program);
  assert.equal(
    program.sourceText,
    "[Empower] :rb_energy_12:. This ability costs :rb_energy_1: less for each rune you control. (Pay the cost: Empower me. Use only if not Empowered.)\n" +
      "[Empowered][>] I have [Deflect] and [Shield 3]. (Opponents must pay :rb_rune_rainbow: to choose me with a spell or ability.+3 :rb_might: while I'm a defender.)"
  );
});

test("grumpy-rockbear: judgeReason names the keyword, cost and layer gaps with task ids", () => {
  assert.match(program.judgeReason, /Empower/);
  assert.match(program.judgeReason, /Empowered/);
  assert.match(program.judgeReason, /827\.1\.c\.1/);
  assert.match(program.judgeReason, /827\.1\.c\.3/);
  assert.match(program.judgeReason, /827\.1\.c\.5/);
  assert.match(program.judgeReason, /828\.1\.c/);
  assert.match(program.judgeReason, /continuous\.grant-keyword/);
  assert.match(program.judgeReason, /442\.1\.a/);
  assert.match(program.judgeReason, /empower-activation-cost/);
  assert.match(program.judgeReason, /RIFT-359/);
  assert.ok(!/待实现|需要裁定/.test(program.judgeReason));
});

test("grumpy-rockbear: Empower 12 is declared with the printed cost and not expanded", () => {
  assert.deepEqual(empower, { kind: "keyword", keyword: "empower", value: 12 });
  assert.equal(empower.params, undefined);
});

test("grumpy-rockbear: the 'costs 1 less per rune' clause is a cost rewrite of that Empower activation", () => {
  // 827.1.c.3 / 206.1：该文本是 Empower 起动费用的一部分，不是独立效果。
  assert.equal(costReduction.kind, "static");
  const effect = costReduction.effect;
  assert.equal(effect.kind, "continuous.cost-modification");
  assert.equal(effect.resource, "energy");
  assert.equal(effect.appliesTo, "empower-activation-cost");
  assert.equal(effect.per, "rune-you-control");
  assert.equal(effect.minimum, 0);
  assert.deepEqual(effect.amount, {
    kind: "arithmetic",
    operator: "neg",
    operands: [{
      kind: "count",
      subject: "runes",
      filter: { type: "rune", controller: "self", zone: "rune-zone" }
    }]
  });
  // 既不写死具体减免数值，也不自行改写费用。
  assert.equal(costReduction.condition, undefined);
});

test("grumpy-rockbear: the Empowered dependent ability grants Deflect 1 and Shield 3 to self", () => {
  assert.equal(grantedKeywords.kind, "static");
  assert.deepEqual(grantedKeywords.effect, {
    kind: "continuous.grant-keyword",
    appliesTo: "self",
    keywords: [
      { id: "deflect", value: 1 },
      { id: "shield", value: 3 }
    ]
  });
  // 828.1.b/828.1.c：依赖能力只在拥有 Empowered 状态时 Active；
  // 门控读取实时 empowered 状态，不使用恒真的字符串。
  assert.deepEqual(grantedKeywords.condition, {
    kind: "compare",
    left: { kind: "object-property", object: "self", property: "empowered" },
    operator: "gte",
    right: { kind: "constant", value: 1 }
  });
});

test("grumpy-rockbear: review evidence — the grant primitive and Deflect/Shield defs are merged", () => {
  assert.equal(instructionDefinitionsById.has("continuous.grant-keyword"), true);
  assert.ok(keywordDefinitionsById.get("Deflect"), "the merged Deflect KeywordDef must be registered");
  assert.ok(keywordDefinitionsById.get("Shield"), "the merged Shield KeywordDef must be registered");
});

test("grumpy-rockbear golden: the [Empowered] clause really grants Deflect 1 and Shield 3 through layers", () => {
  // 此处仅验证授予原语；真实 828.1.b.1 状态门控证据在模板场景中：
  // 用本卡声明的 static effect 形状真实执行一次，断言 ability 图层注册与求值结果。
  const kernel = world()
    .unit("grumpy-rockbear", { types: ["unit"], zone: "board", owner: "A", controller: "A", might: 6 })
    .build();
  const context = kernel.clone({ sourceSnapshot: kernel.getObject("grumpy-rockbear") });
  const body = [{
    id: "grumpy-rockbear.grant-keywords",
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
  const evaluated = layers.evaluate(context.ref("grumpy-rockbear"));
  assert.deepEqual(
    evaluated.keywords.map(keyword => [keyword.id, keyword.value]),
    [["deflect", 1], ["shield", 3]]
  );
  // 814.1.c：Shield 3 是「我是防守者时 +3 [M]」；未指定 combatRole 时不该加 Might。
  assert.equal(evaluated.might, 6);
});

test("grumpy-rockbear: merged Empower expands, but its printed cost is not carried by KeywordAbility", () => {
  const f = fixture({
    cards: [{ id: "grumpy", cardId: program.canonicalCardId, types: ["unit"], might: 6 }]
  });
  f.engine.commit({ type: "move-zone", object: f.kernel.ref("grumpy"), to: "base" });
  const expanded = expandProgram(program, f.kernel.getObject("grumpy"));
  const [expandedEmpower] = expanded.expanded;
  assert.equal(expandedEmpower.kind, "activated");
  assert.deepEqual(expandedEmpower.cost, { kind: "empower" });
  assert.deepEqual(expandedEmpower.restriction.condition, {
    kind: "compare",
    left: { kind: "object-property", object: "self", property: "empowered" },
    operator: "eq",
    right: { kind: "constant", value: 0 }
  });
  assert.throws(
    () => translateCost(expandedEmpower.cost, "grumpy-rockbear.empower", "activate"),
    /Unsupported cost kind empower/
  );
});

test.todo(
  "grumpy-rockbear: the 827.1.c.3 cost-rewrite static (continuous.cost-modification, appliesTo " +
    "empower-activation-cost) has no staticTarget/layerFor mapping in programs/statics.ts and " +
    "fails closed when bound (Unsupported static appliesTo)"
);
test.todo(
  "grumpy-rockbear: integrate granted Deflect Power tax and Shield defender expansion through Chain Finalize/combat; state-gated grant subset is covered by the template"
);
