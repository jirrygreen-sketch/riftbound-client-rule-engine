import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/unl/diana-lunari.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { instructionDefinitionsById } from "../../../../engine-core/dist/effects/instructions/registry.generated.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import { prepareBody, testRegistry } from "./support/primitive-harness.mjs";

const CANONICAL =
  "card.hash-f83cd99eea8e6b934368e1c00b331e03a1c952b11ab89154b7e930740ea0552f";
const SOURCE_TEXT =
  "When a showdown begins here, you may pay :rb_energy_1:. If you do, [Predict], then reveal the " +
  "top card of your Main Deck. If it's a spell, draw it. (To Predict, look at the top card of your " +
  "Main Deck. You may recycle it.)";

const [ability] = program.abilities;
const [optional] = ability.body;
const [bind, predictLook, predictRecycle, reveal, spellBranch] = optional.args.body.value;
const [predictPick] = predictLook.picks;
const [revealedPick] = reveal.picks;
const [drawRevealed] = spellBranch.args.body.value;

const registry = testRegistry();

/** The reference kernel's default controller is "A"; bind it like the production pipeline would. */
const dianaWorld = () => {
  const kernel = world().deck(["top-card", "second-card", "third-card"]).unit("diana").build();
  return kernel.clone({ sourceSnapshot: kernel.getObject("diana") });
};

/** A world whose deck top is a spell / a unit, for the "If it's a spell" branch. */
const typedTopWorld = (topType) => {
  const kernel = world()
    .deck(["second-card", "third-card"])
    .card("top-card", { types: [topType], zone: "deck" })
    .unit("diana")
    .build();
  return kernel.clone({ sourceSnapshot: kernel.getObject("diana") });
};

test("unl-079-219 Diana, Lunari: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
});

test("unl-079-219 Diana, Lunari: identity, ruleset, status, judgeReason, sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /Predict/);
  assert.match(program.judgeReason, /RIFT-89/);
  assert.match(program.judgeReason, /RIFT-64/);
  assert.match(program.judgeReason, /RIFT-120/);
  // effect.reveal 的适配器缺口必须写在 judgeReason 里。
  assert.match(program.judgeReason, /LITERAL_FIELDS|pick/);
  assert.equal(program.sourceText, SOURCE_TEXT);
});

test("unl-079-219 Diana, Lunari: a showdown-open trigger here, wrapping the may-pay in choice.optional", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "triggered");
  assert.equal(ability.trigger.at, "showdown-open");
  assert.deepEqual(ability.trigger.filter, {
    event: "showdown-open",
    filter: { type: "unit", sameLocationAs: "source" }
  });
  assert.equal(ability.optional, false);

  // 契约 3.9："you may … If you do" 用 choice.optional 把被选指令包进 body。
  assert.equal(optional.id, "diana-lunari.may-pay-and-predict");
  assert.equal(optional.op, "choice.optional");
  assert.equal(optional.linkedTo, undefined);
  assert.deepEqual(
    optional.args.body.value.map((entry) => entry.id),
    [
      "diana-lunari.bind-controller",
      "diana-lunari.predict-look",
      "diana-lunari.predict-recycle",
      "diana-lunari.reveal-top",
      "diana-lunari.draw-if-spell"
    ]
  );
});

test("unl-079-219 Diana, Lunari: [Predict] looks at the top card and may recycle it (437.1/437.3.a)", () => {
  assert.equal(predictLook.op, "effect.inspect");
  assert.deepEqual(predictLook.args.player, {
    kind: "linked-value",
    instructionId: "diana-lunari.bind-controller",
    key: "controller"
  });
  assert.deepEqual(bind.args.value, {
    kind: "object-property",
    object: "source",
    property: "controller"
  });
  assert.deepEqual(predictLook.args.scope, { kind: "constant", value: "top" });
  assert.deepEqual(predictLook.args.amount, { kind: "constant", value: 1 });
  // 437.1：可以回收，也可以不回收（chooseCount 0..1）。
  assert.deepEqual(predictLook.args.chooseCount, { kind: "constant", value: { min: 0, max: 1 } });
  assert.deepEqual(predictPick, {
    id: "diana-lunari.predicted",
    options: ["top-card-of-your-main-deck-in-zone-order"],
    min: 1,
    max: 1,
    selection: "all",
    filter: { owner: "self", zone: "deck" }
  });
  assert.equal(predictRecycle.op, "effect.recycle");
  assert.equal(predictRecycle.linkedTo, "diana-lunari.predict-look");
  assert.deepEqual(predictRecycle.args.objects, {
    kind: "linked",
    instructionId: "diana-lunari.predict-look",
    key: "recycled"
  });
});

test("unl-079-219 Diana, Lunari: reveal-the-top then draw it when it is a spell", () => {
  assert.equal(reveal.op, "effect.reveal");
  assert.deepEqual(reveal.args.pick, {
    kind: "constant",
    value: "diana-lunari.revealed-top"
  });
  assert.equal(revealedPick.id, "diana-lunari.revealed-top");
  assert.equal(revealedPick.selection, "one");

  assert.equal(spellBranch.op, "sequence");
  // "If it's a spell"：types 数组的成员判定用 "in"（左值 ∈ 右数组，契约 3.5 的 Condition 形状）。
  assert.deepEqual(spellBranch.condition, {
    kind: "compare",
    left: { kind: "constant", value: "spell" },
    operator: "in",
    right: {
      kind: "object-property",
      object: { linked: "diana-lunari.reveal-top" },
      property: "types"
    }
  });
  assert.equal(drawRevealed.op, "effect.zone");
  assert.deepEqual(drawRevealed.args.to, { kind: "constant", value: "hand" });
  assert.equal(drawRevealed.linkedTo, "diana-lunari.reveal-top");
});

test("unl-079-219 Diana, Lunari golden: Predict looks at the top card and can decline the recycle", () => {
  const kernel = dianaWorld();
  kernel.setPicks(
    predictPick.id,
    kernel.zoneSlice("A", "deck", "top", 1).map((object) => object.ref)
  );
  // 437.1："You may recycle it" → 选择 0 张（拒绝回收）。
  kernel.setAnswers({
    "diana-lunari.may-pay-and-predict/optional": true,
    "diana-lunari.predict-look/effect.inspect%3Aselect%3AA%3AA%3Adeck": []
  });

  // ① 只执行可选块的前两步：绑定控制者 + Predict 查看（Decline 回收）。
  const outcome = runAbilityBody(prepareBody([bind, predictLook]), kernel, registry);
  assert.deepEqual(
    outcome.results.map((entry) => [entry.id, entry.result.status]),
    [
      ["diana-lunari.bind-controller", "executed"],
      ["diana-lunari.predict-look", "executed"]
    ]
  );
  assert.equal(outcome.linkedValues["diana-lunari.predict-look.predicted"].length, 1);
  assert.deepEqual(outcome.linkedValues["diana-lunari.predict-look.recycled"], []);
  // 未选择回收：牌库保持原样。
  assert.deepEqual(
    kernel.zone("A", "deck").map((ref) => ref.id),
    ["top-card", "second-card", "third-card"]
  );
});

test("unl-079-219 Diana, Lunari golden: choosing the recycle sends the predicted card to the bottom (417.1.a)", () => {
  const kernel = dianaWorld();
  const seen = kernel.zoneSlice("A", "deck", "top", 1);
  kernel.setPicks(
    predictPick.id,
    seen.map((object) => object.ref)
  );
  kernel.setAnswers({
    "diana-lunari.may-pay-and-predict/optional": true,
    "diana-lunari.predict-look/effect.inspect%3Aselect%3AA%3AA%3Adeck": [seen[0].ref]
  });
  const outcome = runAbilityBody(prepareBody([bind, predictLook, predictRecycle]), kernel, registry);

  assert.deepEqual(
    outcome.results.map((entry) => [entry.id, entry.result.status]),
    [
      ["diana-lunari.bind-controller", "executed"],
      ["diana-lunari.predict-look", "executed"],
      ["diana-lunari.predict-recycle", "executed"]
    ]
  );
  assert.deepEqual(
    kernel.zone("A", "deck").map((ref) => ref.id),
    ["second-card", "third-card", "top-card"]
  );
  assert.equal(outcome.linkedValues["diana-lunari.predict-recycle.recycledCount"], 1);
});

test("unl-079-219 Diana, Lunari golden: revealing the top card and drawing it when it is a spell", () => {
  const kernel = typedTopWorld("spell");
  const topCard = kernel.zoneSlice("A", "deck", "top", 1);
  assert.equal(topCard[0].ref.id, "top-card");
  kernel.setPicks(revealedPick.id, topCard.map((object) => object.ref));

  // ② "reveal the top card … If it's a spell, draw it."
  //    展示步骤需要测试专用 registry 补上适配器缺的 effect.reveal.pick 解码（见 judgeReason）。
  // 单独执行展示 + 分支两步：predict-recycle 的 linkedTo 依赖不在这两段里，
  // 解释器要求 linkedTo 指向同一作用域内的前序指令，因此这里去掉该字段的引用
  // （生产上这两条指令同属一个 body；本用例只验证展示与类型分支）。
  const revealOnly = { ...reveal, linkedTo: undefined };
  const drawBranch = { ...spellBranch, linkedTo: "diana-lunari.reveal-top" };
  const outcome = runAbilityBody(prepareBody([revealOnly, drawBranch]), kernel, registry);
  assert.deepEqual(
    outcome.results.map((entry) => [entry.id, entry.result.status]),
    [
      ["diana-lunari.reveal-top", "executed"],
      ["diana-lunari.draw-revealed", "executed"],
      ["diana-lunari.draw-if-spell", "executed"]
    ]
  );
  assert.deepEqual(kernel.zone("A", "hand").map((ref) => ref.id), ["top-card"]);
  assert.deepEqual(
    kernel.zone("A", "deck").map((ref) => ref.id),
    ["second-card", "third-card"]
  );
  assert.deepEqual(outcome.linkedValues["diana-lunari.reveal-top.revealed"].map((r) => r.id), [
    "top-card"
  ]);
});

test("unl-079-219 Diana, Lunari golden: a revealed non-spell is not drawn", () => {
  const kernel = typedTopWorld("unit");
  const topCard = kernel.zoneSlice("A", "deck", "top", 1);
  assert.equal(topCard[0].types[0], "unit");
  kernel.setPicks(revealedPick.id, topCard.map((object) => object.ref));

  const revealOnly = { ...reveal, linkedTo: undefined };
  const drawBranch = { ...spellBranch, linkedTo: "diana-lunari.reveal-top" };
  const outcome = runAbilityBody(prepareBody([revealOnly, drawBranch]), kernel, registry);
  assert.deepEqual(
    outcome.results.map((entry) => [entry.id, entry.result.status]),
    [
      ["diana-lunari.reveal-top", "executed"],
      ["diana-lunari.draw-if-spell", "negated"]
    ]
  );
  // 条件为 false：sequence 被 negated(skipped)，牌留在牌库顶。
  const branchResult = outcome.results.find((entry) => entry.id === "diana-lunari.draw-if-spell");
  assert.equal(branchResult.result.status, "negated");
  assert.equal(branchResult.result.reason, "skipped");
  assert.deepEqual(kernel.zone("A", "hand"), []);
  assert.deepEqual(
    kernel.zone("A", "deck").map((ref) => ref.id),
    ["top-card", "second-card", "third-card"]
  );
});

test("unl-079-219 Diana, Lunari: the declared pieces include unmerged dependencies", () => {
  // 前导 1 能量费用需要 Finalize 费用计划（RIFT-89）；Predict 展开属关键词工作流；
  // showdown-open 由 chain/engine.ts 的 openShowdown 发射，但卡牌触发的注册路径未合入。
  assert.equal(instructionDefinitionsById.has("cost.pay"), false);
  assert.equal(optional.args.prompt.value.includes("Pay 1 energy"), true);
});

test.todo(
  "unl-079-219 Diana, Lunari: the leading optional 1-energy cost (CR 383.3.b) needs the cost plan / " +
    "cost.pay entry at finalize (RIFT-89); the frozen triggered ability has no cost field"
);
test.todo(
  "unl-079-219 Diana, Lunari: [Predict] needs its keyword expansion (effects/keywords/Predict.ts) wiring " +
    "the top-card look plus the optional recycle through effect.inspect / effect.recycle (437.1)"
);
test.todo(
  "unl-079-219 Diana, Lunari: effect.reveal's pick argument is not decoded by chain/interpreter-adapter.ts " +
    "LITERAL_FIELDS (dispatch rejects it with 'pick must be a non-empty id'); the golden test supplies " +
    "test-only decode wiring (contract change request filed)"
);
test.todo(
  "unl-079-219 Diana, Lunari: 'If it's a spell' needs an array-contains condition operator; the merged " +
    "Condition only has eq/ne/lt/lte/gt/gte/in (in tests left-in-right), so the membership test as authored " +
    "is not the production rule"
);
test.todo(
  "unl-079-219 Diana, Lunari: the ordered 'top card of your Main Deck' source, the showdown-open emitter " +
    "subscription, and registering the triggered ability from card programs are shared wiring (RIFT-64, " +
    "RIFT-90, RIFT-120)"
);
