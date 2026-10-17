import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ven/apprentice-mage.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import inspect from "../../../../engine-core/dist/effects/instructions/effect.inspect.js";
import { instructionDefinitionsById } from "../../../../engine-core/dist/effects/instructions/registry.generated.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const [empower, triggered, might] = program.abilities;

/**
 * 程序里的 inspect 需要上游提供牌库顶有序 picks（契约 3.6：读牌库顶必须用
 * zoneSlice 语义的保序来源）；参考测试内核用 setPicks 提供该有序范围，
 * 这与 effect.inspect 的 README 约定一致（不用无序 query 近似）。
 * 选择答案的请求 id 是执行路径加原语的 choiceId（解释器 README 的稳定重放 id）。
 */
const PREDICT_CHOICE_ID = "apprentice-mage.predict-look/apprentice-mage.predict";
/** effect.order 的排序请求 id（原语固定形状：effect.order:<destination>:<player>）。 */
const PUT_BACK_ORDER_ID = "apprentice-mage.predict-put-back/effect.order%3Atop%3AA";

const deckWorld = () => {
  const kernel = world()
    .deck(["top", "second", "third"])
    .build();
  kernel.setPicks("apprentice-mage.predict-top-2", [
    kernel.ref("top"),
    kernel.ref("second")
  ]);
  return kernel;
};

/**
 * 程序里的 player 用契约 3.6 的符号选择器取来源控制者；合入的 effect.inspect
 * argsSchema 仍要求 object-property 的 object 是运行时 ObjectRef，无法直接吃
 * 该选择器（见本文件最后的 test.todo）。因此执行用例按 Assembly Rig / Pit Rookie
 * 的既有做法，把契约层的占位换成参考内核里真实的玩家值，只替换这一处，
 * 其余 args 与指令顺序沿用程序原文；程序本身保持符号选择器不变。
 */
const predictBody = () =>
  triggered.body.map(instruction =>
    instruction.id === "apprentice-mage.predict-look"
      ? {
          ...instruction,
          args: {
            ...instruction.args,
            player: { kind: "constant", value: "A" }
          }
        }
      : { ...instruction }
  );

test("apprentice-mage: passes validateCardProgram and is judge-required", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.equal(
    program.canonicalCardId,
    "card.hash-ca70aa40eda9b90185f38679f3d22f38f003f40ea76c2154efad0a8a820c23e4"
  );
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(cardRegistryById.get(program.canonicalCardId), program);
  assert.equal(
    program.sourceText,
    "[Empower] :rb_energy_2: (:rb_energy_2:: Empower me. Use only if not Empowered.)\n" +
      "When I become [Empowered], [Predict 2]. (Look at the top 2 cards of your Main Deck. Recycle any of them and put the rest back in any order.)\n" +
      "[Empowered][>] I have +1 :rb_might:."
  );
});

test("apprentice-mage: judgeReason names every missing dependency", () => {
  assert.match(program.judgeReason, /empower/i);
  assert.match(program.judgeReason, /827\.1\.c\.1/);
  assert.match(program.judgeReason, /828\.1\.c/);
  assert.match(program.judgeReason, /828\.1\.d/);
  assert.match(program.judgeReason, /effect\.inspect/);
  assert.match(program.judgeReason, /continuous\.might/);
  assert.match(program.judgeReason, /442\.1\.a/);
  assert.match(program.judgeReason, /RIFT-258/);
  assert.ok(!/待实现|需要裁定/.test(program.judgeReason));
});

test("apprentice-mage: review evidence — continuous.might is merged, Empower/Empowered are not", () => {
  assert.equal(instructionDefinitionsById.has("continuous.might"), true);
  assert.equal(keywordDefinitionsById.get("Empower"), undefined);
  assert.equal(keywordDefinitionsById.get("Empowered"), undefined);
});

test("apprentice-mage: the merged effect.inspect argsSchema still rejects the symbolic player selector", () => {
  // 契约 3.6 允许符号选择器，但合并原语的 object-property 分支要求运行时 ObjectRef；
  // 这不是“功能不存在”的断言，而是当前真实缺口的可复现证据（judgeReason 第 4 条）。
  const [look] = triggered.body;
  assert.deepEqual(look.args.player, {
    kind: "object-property",
    object: "source",
    property: "controller"
  });
  assert.throws(
    () => instructionDefinitionsById.get("effect.inspect").argsSchema.parse(look.args),
    /effect\.inspect: player must be an Expr/
  );
  assert.throws(
    () => resolveChainBody([look], world().deck(["top"]).build()),
    /effect\.inspect: player must be an Expr/
  );
});

test("apprentice-mage: Empower 2 is declared, and the might bonus is an Empowered-gated static effect", () => {
  assert.deepEqual(empower, { kind: "keyword", keyword: "empower", value: 2 });
  assert.equal(might.kind, "static");
  assert.deepEqual(might.effect, {
    kind: "continuous.might",
    mode: "add",
    layer: "arithmetic",
    appliesTo: "self",
    amount: { kind: "constant", value: 1 }
  });
  assert.deepEqual(might.condition, {
    kind: "expression",
    value: { kind: "constant", value: "empowered" }
  });
});

test("apprentice-mage: 'when I become Empowered' subscribes to empowered-changed scoped to self", () => {
  assert.equal(triggered.kind, "triggered");
  assert.equal(triggered.optional, false);
  assert.equal(triggered.trigger.at, "empowered-changed");
  assert.deepEqual(triggered.trigger.filter, {
    event: "empowered-changed",
    filter: { source: "self" }
  });
  assert.equal(triggered.trigger.once, undefined);
});

test("apprentice-mage: Predict 2 is inspect(2) -> recycle(chosen) -> order(top, 2 - recycled)", () => {
  assert.deepEqual(triggered.body.map(instruction => instruction.id), [
    "apprentice-mage.predict-look",
    "apprentice-mage.predict-recycle",
    "apprentice-mage.predict-put-back"
  ]);

  const [look, recycle, putBack] = triggered.body;
  assert.equal(look.op, "effect.inspect");
  assert.equal(look.args.scope.value, "top");
  assert.deepEqual(look.args.picksSpecId, {
    kind: "constant",
    value: "apprentice-mage.predict-top-2"
  });
  assert.deepEqual(look.args.amount, { kind: "constant", value: 2 });
  assert.deepEqual(look.args.chooseCount.value, { min: 0, max: 2 });
  assert.deepEqual(look.args.choose, { kind: "constant", value: true });
  assert.equal(look.linkedTo, undefined);

  assert.equal(recycle.op, "effect.recycle");
  assert.deepEqual(recycle.args.objects, {
    kind: "linked",
    instructionId: "apprentice-mage.predict-look",
    key: "predict-recycle"
  });
  assert.equal(recycle.linkedTo, "apprentice-mage.predict-look");

  assert.equal(putBack.op, "effect.order");
  assert.deepEqual(putBack.args.destination, { kind: "constant", value: "top" });
  assert.deepEqual(putBack.args.chooseOrder, { kind: "constant", value: true });
  // 437.1.a：放回张数是 2 - 实际回收张数，用 linked-value 计算而不是写死。
  assert.deepEqual(putBack.args.count, {
    kind: "arithmetic",
    operator: "sub",
    operands: [
      { kind: "constant", value: 2 },
      {
        kind: "linked-value",
        instructionId: "apprentice-mage.predict-recycle",
        key: "recycledCount"
      }
    ]
  });
  assert.equal(putBack.linkedTo, "apprentice-mage.predict-recycle");
});

test("apprentice-mage: recycling the chosen top card moves it to the deck bottom and puts the rest back", () => {
  const kernel = deckWorld();
  kernel.setAnswers({
    [PREDICT_CHOICE_ID]: [kernel.ref("top")],
    [PUT_BACK_ORDER_ID]: [kernel.ref("second")]
  });
  const outcome = resolveChainBody(predictBody(), kernel);
  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.results.map(entry => [entry.id, entry.result.status]), [
    ["apprentice-mage.predict-look", "executed"],
    ["apprentice-mage.predict-recycle", "executed"],
    ["apprentice-mage.predict-put-back", "executed"]
  ]);
  // 417.1：回收把被选牌放到对应牌库底部，因此 deck = [remaining top, third, recycled top]。
  assert.deepEqual(
    kernel.objectsInZone("A", "deck").map(ref => ref.id),
    ["second", "third", "top"]
  );
  assert.equal(kernel.getObject("top").zone, "deck");
  assert.deepEqual(outcome.linkedValues["apprentice-mage.predict-recycle.recycledCount"], 1);
  // 437.1.a：放回张数 = 2 - 1 = 1，由 linked-value 决定。
  assert.deepEqual(outcome.linkedValues["apprentice-mage.predict-put-back.ordered"], 1);
  assert.equal(kernel.player("A").handSize, 0);
  assert.equal(kernel.player("A").deckSize, 3);
});

test("apprentice-mage: recycling nothing puts both looked-at cards back in the chosen order", () => {
  const kernel = deckWorld();
  kernel.setAnswers({
    [PREDICT_CHOICE_ID]: [],
    [PUT_BACK_ORDER_ID]: [kernel.ref("second"), kernel.ref("top")]
  });
  const outcome = resolveChainBody(predictBody(), kernel);
  assert.equal(outcome.status, "executed");
  assert.equal(outcome.linkedValues["apprentice-mage.predict-recycle.recycledCount"], 0);
  assert.deepEqual(
    kernel.objectsInZone("A", "deck").map(ref => ref.id),
    ["second", "top", "third"]
  );
  assert.equal(outcome.linkedValues["apprentice-mage.predict-put-back.ordered"], 2);
  assert.equal(kernel.player("A").deckSize, 3);
  assert.equal(kernel.player("A").handSize, 0);
});

test("apprentice-mage: looking at the top 2 is an ordered read, never a set query", () => {
  // 契约 3.6 / 原语 README：非零 top 查看必须有上游有序 picks，否则明确阻断；
  // 参考内核不提供 picks 时应 negated，而不是从 query() 猜顺序。
  const kernel = world().deck(["top", "second"]).build();
  const [look] = predictBody();
  // 去掉 picksSpecId 就等价于"上游没有提供有序范围"：原语此时明确阻断，
  // 而不是退化成无序 query（与 effect.inspect 自带用例一致）。
  const { picksSpecId, ...withoutOrderedRange } = look.args;
  assert.equal(picksSpecId.value, "apprentice-mage.predict-top-2");
  const run = runInstruction(inspect, withoutOrderedRange, { world: kernel });
  assert.equal(run.result.status, "negated");
  assert.equal(run.result.reason, "impossible");
  assert.deepEqual(run.linked, {});
  assert.equal(run.asked, null);
  assert.equal(kernel.player("A").handSize, 0);
  assert.equal(kernel.player("A").deckSize, 2);
});

test.todo(
  "apprentice-mage: [Empower] 2 activation and the 828.1.d empowered-changed trigger (including " +
    "the increase-direction filter from 828.1.c), pending the Empower/Empowered KeywordDefs " +
    "and the increase-direction trigger filter"
);
test.todo(
  "apprentice-mage: '+1 :rb_might:' through the layers engine with the empowered predicate " +
    "(828.1.b.1/828.1.c, CR 442.1.a) — continuous.might is merged (RIFT-258), the 442.1.a " +
    "predicate is not: layers/engine.ts conditionMatches falls back to true for unknown kinds"
);
test.todo(
  "apprentice-mage: effect.inspect accepting the contract 3.6 symbolic selector for " +
    "object-property (player: { object: 'source', property: 'controller' }); the merged " +
    "argsSchema still requires a zone-bound ObjectRef"
);
