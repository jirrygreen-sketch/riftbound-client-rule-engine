// Golden test for Gustwalker (unl-075-219).
//
// Execution evidence (the real printed 3 Energy + 1 Mind Power payment, the
// registered-but-inactive [Level 3] statics, the fail-closed Hunt trigger
// registration and the blocked printed expectations) lives in the RIFT-673
// parameterized template golden:
// test/cards/templates/keyword-static-static-673.test.mjs.
// This file keeps validation, identity, verbatim text, declared status and the
// key structure of the printed abilities.
import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/unl/gustwalker.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";

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
  assert.equal(program.sourceText, SOURCE_TEXT);
  // 缺口必须具体：Hunt 展开、Level 的 XP 谓词、依赖能力两半的消费方。
  assert.match(program.judgeReason, /conquer\/hold|conquered|EventPattern/);
  assert.match(program.judgeReason, /824\.1/);
  assert.match(program.judgeReason, /静态绑定可注册/);
  assert.match(program.judgeReason, /Ganking/);
  assert.doesNotMatch(program.judgeReason, /823\.2.*未接线/);
  assert.doesNotMatch(program.judgeReason, /RIFT-91/);
  assert.doesNotMatch(program.judgeReason, /无卡牌持续效果注册路径/);
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

test.todo(
  "unl-075-219 Gustwalker: [Hunt 2] needs the event spelling/object payload alignment so the " +
    "conquer/hold subscription registers and matches the conquering unit (823.1.c.1)"
);
test.todo(
  "unl-075-219 Gustwalker: [Level 3] needs an evaluable controller XP >= 3 predicate with live " +
    "activation/deactivation (824.1.c / 824.1.c.1 / 824.1.d) and the granted [Ganking] needs a " +
    "movement consumer that reads permission.routes (810.1.c)"
);
