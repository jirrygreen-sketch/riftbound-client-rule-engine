// Golden test for Gustwalker (unl-075-219).
//
// Execution evidence (the real printed 3 Energy + 1 Mind Power payment, the
// registered-but-inactive [Level 3] statics, the fail-closed Hunt trigger
// registration and the blocked printed expectations) lives in the RIFT-673
// parameterized template golden:
// test/cards/templates/keyword-static-static-673.test.mjs.
// Original behavior and structure assertions remain in this file; the
// template adds execution evidence without replacing these checks.
import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/unl/gustwalker.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import { expandProgram } from "../../../../engine-core/dist/programs/keywords.js";

const CANONICAL =
  "card.hash-a232dcd643d13b743c5bad3125bacbefc6b2ef53b24aa91708ec80fc13447153";
const SOURCE_TEXT =
  "[Hunt 2] (When I conquer or hold, gain 2 XP.)\n" +
  "[Level 3][>] I have +1 :rb_might: and [Ganking]. (While you have 3+ XP, get the effect. A [Ganking] unit can move from battlefield to battlefield.)";

const [hunt, mightAbility, gankingAbility] = program.abilities;

test("unl-075-219 Gustwalker: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.equal(cardRegistryById.get(CANONICAL), program);
});

test("unl-075-219 Gustwalker: identity, ruleset, status, judgeReason, sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  // 缺口必须具体：Hunt 展开、Level 的 XP 谓词、依赖能力两半的消费方。
  assert.match(program.judgeReason, /conquer\/hold|conquered|EventPattern/);
  assert.match(program.judgeReason, /824\.1/);
  assert.match(program.judgeReason, /静态绑定可注册/);
  assert.match(program.judgeReason, /Ganking/);
  assert.doesNotMatch(program.judgeReason, /823\.2.*未接线/);
  assert.doesNotMatch(program.judgeReason, /RIFT-91/);
  assert.doesNotMatch(program.judgeReason, /无卡牌持续效果注册路径/);
  assert.equal(program.sourceText, SOURCE_TEXT);
});

test("unl-075-219 Gustwalker: [Hunt 2] is declared with its printed value and is not re-expanded", () => {
  // 823.1.c.1：整句能力都落在 Hunt 的关键词定义里，按 README 第 5 节只声明、不重写展开。
  assert.deepEqual(hunt, { kind: "keyword", keyword: "hunt", value: 2 });
  // 展开（订阅 conquer/hold、728 的 gain-xp）属关键词注册表；本卡不再写一份等价触发。
  assert.equal(
    program.abilities.some(
      (ability) => ability.kind === "triggered" && ability.body?.some((entry) => entry.op === "effect.xp")
    ),
    false
  );
});

test("unl-075-219 Gustwalker: the Level 3 dependent ability is gated on controller XP >= 3", () => {
  for (const ability of [mightAbility, gankingAbility]) {
    assert.equal(ability.kind, "static");
    assert.equal(ability.condition.kind, "all");
    assert.deepEqual(ability.condition.conditions[0], { kind: "never" });
    assert.deepEqual(ability.condition.conditions[1], {
      kind: "compare",
      left: { kind: "count", subject: "controller-xp", filter: { player: "controller" } },
      operator: "gte",
      right: { kind: "constant", value: 3 }
    });
  }
});

test("unl-075-219 Gustwalker: the dependent ability's two halves are declared as data", () => {
  assert.deepEqual(mightAbility.effect, {
    kind: "continuous.might",
    mode: "add",
    layer: "arithmetic",
    amount: { kind: "constant", value: 1 },
    appliesTo: "self"
  });
  assert.deepEqual(gankingAbility.effect, {
    kind: "continuous.grant-keyword",
    keyword: "Ganking",
    appliesTo: "self"
  });
});

test("unl-075-219 Gustwalker: merged Hunt, Level, and Ganking definitions are available", () => {
  const huntDef = keywordDefinitionsById.get("Hunt");
  assert.ok(huntDef);
  assert.equal(huntDef.stacking, "sum");
  const huntExpansion = huntDef.expand({ value: 2, host: { canonicalCardId: CANONICAL } });
  assert.deepEqual(huntExpansion.map(ability => ability.trigger.at), ["conquer", "hold"]);
  assert.ok(huntExpansion.every(ability => ability.body[0].op === "effect.xp"));
  assert.ok(huntExpansion.every(ability => ability.body[0].args.amount.value === 2));

  const levelDef = keywordDefinitionsById.get("Level");
  assert.ok(levelDef);
  assert.equal(levelDef.stacking, "separate");
  const [levelExpansion] = levelDef.expand({ value: 3, host: { canonicalCardId: CANONICAL } });
  assert.equal(levelExpansion.effect.kind, "condition.predicate");
  assert.deepEqual(levelExpansion.effect.threshold, { kind: "constant", value: 3 });

  // 810 的 Ganking 展开与静态授予路径已合入；剩余缺口是移动规则消费运行时授予。
  assert.equal(keywordDefinitionsById.get("Ganking")?.keyword, "Ganking");
});

test("unl-075-219 Gustwalker: expandProgram sums declared and printed Hunt values", () => {
  const kernel = world()
    .unit("gustwalker", {
      cardId: CANONICAL,
      keywords: [{ id: "Hunt", value: 3 }]
    })
    .build();
  const expanded = expandProgram(program, kernel.getObject("gustwalker")).expanded
    .filter(ability => ability.kind === "triggered");
  assert.deepEqual(expanded.map(ability => ability.trigger.at), ["conquer", "hold"]);
  assert.deepEqual(
    expanded.map(ability => ability.body[0].args.amount),
    [{ kind: "constant", value: 5 }, { kind: "constant", value: 5 }]
  );
});

test("unl-075-219 Gustwalker golden: the merged Hunt body really gains XP", () => {
  const huntDef = keywordDefinitionsById.get("Hunt");
  const [conquer] = huntDef.expand({ value: 2, host: { canonicalCardId: CANONICAL } });
  const kernel = world().build();
  const outcome = resolveChainBody(conquer.body, kernel);
  assert.equal(outcome.results[0].result.status, "executed");
  assert.equal(kernel.player("A").xp, 2);
});
