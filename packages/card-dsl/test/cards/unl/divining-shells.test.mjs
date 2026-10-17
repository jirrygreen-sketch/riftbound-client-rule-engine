import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/divining-shells.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { buildCostPlan } from "../../../../engine-core/dist/cost/cost-plan.js";
import { payCostPlan } from "../../../../engine-core/dist/cost/payment.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL_ID =
  "card.hash-936666b1ffbf93681f930f27e502217a077f8c82e423bac72257ce1acaf12420";
const SOURCE_TEXT =
  "[Vision] (When you play this, look at the top card of your Main Deck. You may recycle it.)\n" +
  "[Action][>] Kill this, :rb_exhaust:: Give a unit +2 :rb_might: this turn.";

const [vision, activated] = program.abilities;
const [giveMight] = activated.body;
const [mightTarget] = giveMight.targets;

/** The merged Vision expansion's inspect request id (see engine-core test/effects/keywords/Vision.test.mjs). */
const VISION_SELECT_REQUEST_ID =
  "vision-look/" + encodeURIComponent("effect.inspect:select:A:A:deck");

function visionExpansion() {
  const definition = keywordDefinitionsById.get("Vision");
  assert.ok(definition, "effects/keywords/Vision.ts must be registered");
  return definition.expand({ value: vision.value, host: { canonicalCardId: CANONICAL_ID } });
}

/**
 * Run the merged Vision expansion's Predict body against the reference kernel.
 * This card supplies the card declaration; the expansion itself is the merged
 * keyword implementation (contract 3.7), and the caller supplies the real
 * ordered top-card pick plus the Predict recycle answer.
 */
function runVision(kernel, chosen) {
  const [ability] = visionExpansion();
  const { value: picksId } = ability.body[0].args.picksSpecId;
  kernel.setPicks(picksId, kernel.zoneSlice("A", "deck", "top", 1).map(object => object.ref));
  kernel.setAnswers({ [VISION_SELECT_REQUEST_ID]: chosen });
  return resolveChainBody(ability.body, kernel);
}

test("unl-161-219 Divining Shells: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("unl-161-219 Divining Shells: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  // The reason must name the verified current gap: the Vision expansion's
  // host filter field is rejected by the program binder, the expansion pins
  // player "A", and the expansion's top-card inspect has no ordered source.
  assert.match(program.judgeReason, /817/);
  assert.match(program.judgeReason, /object\.id/);
  assert.match(program.judgeReason, /translateObjectFilter/);
  assert.match(program.judgeReason, /registerProgramTriggers/);
  assert.match(program.judgeReason, /picksSpecId|zoneSlice|有序来源/);
  // The merged-and-verified parts must not be reported as gaps any more.
  assert.doesNotMatch(program.judgeReason, /尚需绑定到本卡/);
});

test("unl-161-219 Divining Shells: [Vision] is declared as a keyword only", () => {
  assert.equal(program.abilities.length, 2);
  assert.deepEqual(vision, { kind: "keyword", keyword: "vision" });
  assert.equal(vision.value, undefined);
});

test("unl-161-219 Divining Shells: [Action][>] activated ability with kill-this plus [E] costs", () => {
  // 806.1.c.2 / 806.1.d / 813.1.d：[Action][>] 修饰后面的启动能力（速度许可）。
  assert.equal(activated.kind, "activated");
  assert.equal(activated.timing, "action");
  // 404.1.a / 415.4 / 415.5 / 355.10.c.1：":" 之前的 Kill this 与 :rb_exhaust: 都是费用。
  // 357.2 / 357.3：两项费用都指向本卡，先 Kill 会让来源离场、横置必然无法支付，因此按
  // 唯一合法顺序声明横置在前（两项费用都在，不改写印刷内容）。
  assert.deepEqual(activated.cost, {
    kind: "activated",
    payments: [
      { kind: "exhaust", object: "self" },
      { kind: "kill", object: "self" }
    ]
  });
});

test("unl-161-219 Divining Shells: the might instruction is a targeted end-of-turn +2 Might modification", () => {
  assert.deepEqual(activated.body.map(instruction => instruction.id), ["divining-shells.give-might"]);
  assert.equal(giveMight.op, "continuous.might");
  assert.deepEqual(giveMight.args.amount, { kind: "constant", value: 2 });
  assert.deepEqual(giveMight.args.duration, { kind: "constant", value: "end-of-turn" });
  // 355.5 / 契约 3.6："Give a unit …" 的对象是本指令自己的 TargetSpec，必须以
  // target 选择符传给原语；continuous.might 缺省作用于 source，Gear 来源没有
  // Might，会静默把 +2 挂到错误对象。
  assert.deepEqual(giveMight.args.objects, {
    kind: "constant",
    value: { kind: "target", id: "divining-shells.unit" }
  });
  assert.equal(giveMight.linkedTo, undefined);
  // 355.5："a unit" 是被选择的对象 → TargetSpec；不限定控制者。
  assert.deepEqual(giveMight.targets, [
    {
      id: "divining-shells.unit",
      filter: { type: "unit", zone: "board" },
      min: 1,
      max: 1,
      selection: "one"
    }
  ]);
  assert.equal(mightTarget.id, "divining-shells.unit");
  assert.equal(giveMight.picks, undefined);
});

test("unl-161-219 Divining Shells: the printed costs are payable through the merged cost plan", () => {
  // 415.4 / 415.5：Gear 启动费用「消灭自身 + 横置自身」由已合入的费用计划支付。
  const kernel = world()
    .unit("divining-shells", {
      types: ["gear"],
      might: null,
      energy: 2,
      power: null,
      zone: "board",
      location: { type: "base", player: "A" }
    })
    .build();
  const context = kernel.clone({ sourceSnapshot: kernel.getObject("divining-shells") });
  const plan = buildCostPlan(context, { id: "divining-shells:activate", cost: activated.cost });
  const receipt = payCostPlan(context, plan);

  assert.equal(receipt.paid, true);
  assert.deepEqual(receipt.actions.map(action => action.action.type), ["pay", "exhaust", "kill"]);
  // 429.1 / 429.2.a：被消灭的 Gear 从其来源区域进入拥有者的 Trash。
  // payCostPlan 只改它收到的 ResolveContext（这里是克隆的 context）。
  assert.equal(context.getObject("divining-shells").zone, "trash");
  assert.equal(context.getObject("divining-shells").exhausted, true);
  assert.deepEqual(context.events.map(event => event.action), ["pay", "exhaust", "kill"]);
  // 探针本身不改动原始局面。
  assert.equal(kernel.getObject("divining-shells").zone, "board");
  assert.equal(kernel.getObject("divining-shells").exhausted, false);

  // 357.3：把 Kill 排在横置之前会确定性地让横置无法支付，费用管线如实拒绝这条非法顺序。
  const illegal = kernel.clone({ sourceSnapshot: kernel.getObject("divining-shells") });
  const illegalPlan = buildCostPlan(illegal, {
    id: "divining-shells:activate-illegal-order",
    cost: {
      kind: "activated",
      payments: [
        { kind: "kill", object: "self" },
        { kind: "exhaust", object: "self" }
      ]
    }
  });
  assert.throws(
    () => payCostPlan(illegal, illegalPlan),
    error =>
      error &&
      error.name === "CostPlanError" &&
      error.reason === "cannot-pay-cost" &&
      /no longer in its selected zone/.test(error.message)
  );
});

test("unl-161-219 Divining Shells: the card never approximates the Might grant with Buff counters", () => {
  // 数据层面的红线守卫（与引擎当前支持到哪一步无关）：+2 Might 是算术图层的临时修正，
  // effect.buff 的文件头明确它不承接临时 Might，因此本卡的程序里不得出现 effect.buff
  // 或任何手改 Might/Buff 的替代写法。
  const ops = program.abilities.flatMap(ability =>
    (ability.body ?? []).map(instruction => instruction.op)
  );
  assert.deepEqual(ops, ["continuous.might"]);
  assert.equal(ops.includes("effect.buff"), false);
  assert.equal(giveMight.args.mode, undefined);
  assert.deepEqual(giveMight.args.amount, { kind: "constant", value: 2 });
  assert.deepEqual(giveMight.args.duration, { kind: "constant", value: "end-of-turn" });
});

test("unl-161-219 Divining Shells golden: the activated body registers the temporary Might effect", () => {
  const kernel = world()
    .unit("divining-shells", { owner: "A", controller: "A", types: ["gear"], might: null })
    .unit("target-unit", { owner: "A", controller: "A", might: 3 })
    .build();
  const context = kernel.clone({ sourceSnapshot: kernel.getObject("divining-shells") });
  context.setTargets(mightTarget.id, [context.ref("target-unit")]);
  const outcome = resolveChainBody(activated.body, context);

  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.results.map(entry => [entry.id, entry.result.status]), [
    ["divining-shells.give-might", "executed"]
  ]);
  assert.equal(context.continuousEffects.length, 1);
  assert.equal(context.continuousEffects[0].effect.effect.kind, "continuous.might");
  assert.equal(context.continuousEffects[0].effect.effect.amount, 2);
  assert.deepEqual(context.continuousEffects[0].duration, { type: "end-of-turn" });
  // 355.5：+2 必须落在本指令选定的单位上，而不是来源 Gear 上（来源没有 Might）。
  assert.deepEqual(context.continuousEffects[0].effect.filter, {
    objectId: "target-unit",
    zone: "board",
    zoneEntryId: context.ref("target-unit").zoneEntryId
  });
});

test("unl-161-219 Divining Shells: [Vision] recycles the seen top card through the merged expansion (817.1.b / 437.1)", () => {
  const kernel = world().deck(["z-top-seen", "a-rest"]).build();
  const top = kernel.zone("A", "deck")[0];
  const outcome = runVision(kernel, [top]);

  assert.equal(outcome.status, "executed");
  assert.deepEqual(kernel.events.map(event => event.action), ["look", "recycle"]);
  assert.deepEqual(kernel.zone("A", "deck").map(ref => ref.id), ["a-rest", "z-top-seen"]);
});

test("unl-161-219 Divining Shells: declining the recycle keeps the top card (817.2.a)", () => {
  const kernel = world().deck(["z-top-seen", "a-rest"]).build();
  const outcome = runVision(kernel, []);

  assert.equal(outcome.status, "executed");
  assert.deepEqual(kernel.events.map(event => event.action), ["look"]);
  assert.deepEqual(kernel.zone("A", "deck").map(ref => ref.id), ["z-top-seen", "a-rest"]);
});

test.todo(
  "Divining Shells: bind the merged Vision expansion to the host object and inject the real controller into its " +
    "object-enters-board trigger and ordered top-card pick (CR 817.1.c / 437.1)"
);
