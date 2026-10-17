import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/unl/gustwalker.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

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
});

test("unl-075-219 Gustwalker: identity, ruleset, status, judgeReason, sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  // 缺口必须具体：Hunt 展开、Level 的 XP 谓词、依赖能力两半的消费方。
  assert.match(program.judgeReason, /conquer\/hold|conquered|EventPattern/);
  assert.match(program.judgeReason, /824\.1/);
  assert.match(program.judgeReason, /continuous\.might/);
  assert.match(program.judgeReason, /continuous\.grant-keyword/);
  assert.match(program.judgeReason, /RIFT-265/);
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
    assert.deepEqual(ability.condition, {
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

  // 810 的 Ganking 展开文件已合入；缺的是卡牌持续效果注册 / 授予路径。
  assert.equal(keywordDefinitionsById.get("Ganking")?.keyword, "Ganking");
});

test("unl-075-219 Gustwalker golden: the merged Hunt body really gains XP", () => {
  const huntDef = keywordDefinitionsById.get("Hunt");
  const [conquer] = huntDef.expand({ value: 2, host: { canonicalCardId: CANONICAL } });
  const kernel = world().build();
  const outcome = resolveChainBody(conquer.body, kernel);
  assert.equal(outcome.results[0].result.status, "executed");
  assert.equal(kernel.player("A").xp, 2);
});

test.todo(
  "unl-075-219 Gustwalker: [Hunt 2] (CR 823.1.c.1) needs a KeywordDef subscribing at conquer/hold and " +
    "a production event registration that preserves source/controller and aligns conquered/held event spelling; " +
    "the merged expansion and effect.xp execution are covered above"
);
test.todo(
  "unl-075-219 Gustwalker: [Level 3][>] (CR 824.1.b.1/824.1.c) needs an evaluable 'controller has 3+ XP' " +
    "predicate and dynamic deactivation; the merged Condition cannot read PlayerSnapshot.xp"
);
test.todo(
  "unl-075-219 Gustwalker: the dependent ability needs continuous.might plus continuous.grant-keyword with " +
    "a card-program registration path into the layers engine (RIFT-91)"
);
