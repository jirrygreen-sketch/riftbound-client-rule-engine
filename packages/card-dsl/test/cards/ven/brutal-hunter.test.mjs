import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ven/brutal-hunter.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { instructionDefinitionsById } from "../../../../engine-core/dist/effects/instructions/registry.generated.js";
import { createLayerEngine } from "../../../../engine-core/dist/layers/index.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL_ID =
  "card.hash-3f9f5a7cd793affe45d17580dab715f09ada17e0f10121517e9abce676d36e2b";
const SOURCE_TEXT =
  "[Empower] :rb_energy_3: (:rb_energy_3:: Empower me. Use only if not Empowered.)\n" +
  "[Empowered][>] I have +2 :rb_might: and [Ganking]. (I can move from battlefield to battlefield.)";

const [empower, mightBonus, gankingGrant] = program.abilities;

test("ven-070-166 Brutal Hunter: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("ven-070-166 Brutal Hunter: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /Empower/);
  assert.match(program.judgeReason, /827\.1\.c\.1/);
  assert.match(program.judgeReason, /442\.1\.a/);
  assert.match(program.judgeReason, /RIFT-359/);
  assert.ok(!/RIFT-87|RIFT-91/.test(program.judgeReason));
  assert.ok(!/待实现|需要裁定/.test(program.judgeReason));
});

test("ven-070-166 Brutal Hunter: [Empower] is declared as a keyword ability", () => {
  assert.deepEqual(empower, { kind: "keyword", keyword: "empower" });
  assert.equal(empower.value, undefined);
  // 827.1.c.1 的启动费用与 828.1.b.1 的依赖能力都无展开实现，故不写成启动能力。
  assert.equal(program.abilities.filter(ability => ability.kind === "activated").length, 0);
});

test("ven-070-166 Brutal Hunter: 'I have +2 :rb_might:' is a gated arithmetic layer effect", () => {
  assert.equal(mightBonus.kind, "static");
  assert.equal(mightBonus.effect.kind, "continuous.might");
  assert.equal(mightBonus.effect.mode, "add");
  assert.equal(mightBonus.effect.layer, "arithmetic");
  assert.deepEqual(mightBonus.effect.amount, { kind: "constant", value: 2 });
  assert.equal(mightBonus.effect.appliesTo, "self");
  // 442.1.a / 828.1.c：Empowered 门槛（描述性谓词，无已合入求值路径）。
  assert.equal(mightBonus.condition.kind, "compare");
  assert.equal(mightBonus.condition.operator, "gte");
  assert.deepEqual(mightBonus.condition.left, {
    kind: "object-property",
    object: "self",
    property: "empoweredCount"
  });
  assert.deepEqual(mightBonus.condition.right, { kind: "constant", value: 1 });
});

test("ven-070-166 Brutal Hunter: 'and [Ganking]' is a gated ability-layer keyword grant", () => {
  assert.equal(gankingGrant.kind, "static");
  assert.equal(gankingGrant.effect.kind, "continuous.grant-keyword");
  // 810.1.b：被授予的关键词本体由已合入的 keywords/Ganking.ts 展开。
  assert.equal(gankingGrant.effect.keyword, "Ganking");
  assert.equal(gankingGrant.effect.appliesTo, "self");
  assert.deepEqual(gankingGrant.condition, mightBonus.condition);
});

test("ven-070-166 Brutal Hunter: review evidence — both grant primitives are merged, the Empower defs are not", () => {
  assert.equal(instructionDefinitionsById.has("continuous.might"), true);
  assert.equal(instructionDefinitionsById.has("continuous.grant-keyword"), true);
});

test("ven-070-166 Brutal Hunter golden: the two [Empowered] clauses really register +2 Might and Ganking through layers", () => {
  // 828.1.c 的门控仍未实现（见 judgeReason），但两条 continuous 原语是合入的：用本卡
  // 声明的 static effect 形状真实执行一次，断言 arithmetic 层的 Might 修正与 ability
  // 层的 Ganking 授予分别注册并可求值。
  const kernel = world()
    .unit("brutal-hunter", { types: ["unit"], zone: "board", owner: "A", controller: "A", might: 4 })
    .build();
  const context = kernel.clone({ sourceSnapshot: kernel.getObject("brutal-hunter") });

  const mightOutcome = runAbilityBody(
    [
      {
        id: "brutal-hunter.might-bonus",
        op: "continuous.might",
        args: {
          mode: { kind: "constant", value: "add" },
          amount: { kind: "constant", value: mightBonus.effect.amount.value },
          appliesTo: { kind: "constant", value: "self" }
        }
      }
    ],
    context
  );
  assert.equal(mightOutcome.status, "executed");
  assert.equal(context.continuousEffects.length, 1);

  const gankingOutcome = runAbilityBody(
    [
      {
        id: "brutal-hunter.ganking-grant",
        op: "continuous.grant-keyword",
        args: {
          keyword: { kind: "constant", value: gankingGrant.effect.keyword },
          appliesTo: { kind: "constant", value: "self" }
        }
      }
    ],
    context
  );
  assert.equal(gankingOutcome.status, "executed");
  assert.equal(context.continuousEffects.length, 2);

  const registrations = context.continuousEffects.map((entry, index) => ({
    effect: entry.effect,
    duration: entry.duration,
    timestamp: index + 1
  }));
  const layers = createLayerEngine(context.objects, registrations);
  const evaluated = layers.evaluate(context.ref("brutal-hunter"));
  assert.equal(evaluated.might, 6);
  assert.deepEqual(
    evaluated.keywords.map(keyword => [keyword.id, keyword.value]),
    [["Ganking", undefined]]
  );
});

test("ven-070-166 Brutal Hunter: no keyword is declared unconditionally on the card face", () => {
  // [Ganking] 只在 Empowered 后获得；不得写成卡级关键词能力（那会变成始终拥有）。
  assert.equal(program.abilities.filter(ability => ability.kind === "keyword").length, 1);
  assert.deepEqual(program.abilities[0], { kind: "keyword", keyword: "empower" });
});

test.todo(
  "ven-070-166 Brutal Hunter: [Empower] expansion (827.1.c.1: 3 Energy, 'use only if not Empowered') and the " +
    "[Empowered][>] dependent ability (828.1.b.1) need an Empower/Empowered KeywordDef — none is merged"
);
test.todo(
  "ven-070-166 Brutal Hunter: the +2 Might and Ganking grants are merged primitives (golden above), " +
    "but the 828.1.c Empowered gate still needs the status predicate (442.1.a; RIFT-359)"
);
