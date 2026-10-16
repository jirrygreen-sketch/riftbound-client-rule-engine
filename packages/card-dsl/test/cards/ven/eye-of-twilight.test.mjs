import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ven/eye-of-twilight.js";
import { buildCostPlan } from "../../../../engine-core/dist/cost/cost-plan.js";
import { payCostPlan } from "../../../../engine-core/dist/cost/payment.js";
import { instructionDefinitionsById } from "../../../../engine-core/dist/effects/instructions/registry.generated.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL_ID =
  "card.hash-58b622a816049405488a25adae394668eeed8847e5a9ff884d3f09ce03886a4d";
const SOURCE_TEXT =
  "[Action][>] :rb_exhaust:: Give a friendly unit [Tank] this turn. " +
  "(It must be assigned combat damage first.)";

const [ability] = program.abilities;
const [grantTank] = ability.body;

test("ven-147-166 Eye of Twilight: validateCardProgram passes and identity is verbatim", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /Tank KeywordDef/);
  assert.match(program.judgeReason, /continuous\.grant-keyword/);
  assert.match(program.judgeReason, /combat/);
});

test("ven-147-166: [Action][>] with the printed Exhaust-only cost", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "activated");
  // 806.1.d：[Action][>] 的许可按契约 3.1 记在 activated.timing。
  assert.equal(ability.timing, "action");
  // 204.1.b / 415.5：「:」前的 :rb_exhaust: 是 Exhaust 此来源的 Base Cost。
  assert.deepEqual(ability.cost, {
    kind: "activated",
    payments: [{ kind: "exhaust", object: "self" }]
  });
  // 本卡没有印刷 Energy / Power 费用：这两个字段不出现，绝不写成 0。
  assert.equal("energy" in ability.cost, false);
  assert.equal("power" in ability.cost, false);
});

test("ven-147-166: 'Give a friendly unit [Tank] this turn' is a duration-bounded keyword grant", () => {
  assert.equal(ability.body.length, 1);
  assert.equal(grantTank.id, "eye-of-twilight.grant-tank");
  assert.equal(grantTank.op, "continuous.grant-keyword");
  assert.deepEqual(grantTank.args, {
    keyword: { kind: "constant", value: "Tank" },
    // “this turn” 是 end-of-turn 期限（layers Duration 的 end-of-turn 在 turn-end 到期）。
    duration: { kind: "constant", value: "this-turn" },
    target: { kind: "constant", value: "eye-of-twilight.unit" }
  });
  assert.equal(grantTank.linkedTo, undefined);
  assert.deepEqual(grantTank.targets, [
    {
      id: "eye-of-twilight.unit",
      // “a friendly unit”：单个由你控制的单位（355.9 / 355.10；359.3.e.7）。
      filter: { type: "unit", zone: "board", controller: "self" },
      min: 1,
      max: 1,
      selection: "one"
    }
  ]);
});

test("ven-147-166: the keyword-grant opcode is not registered", () => {
  // README 第 5 节：不手写一套关键词逻辑；授予本身属于缺失的指令原语。
  assert.equal(instructionDefinitionsById.has("continuous.grant-keyword"), false);

  // 未注册的 op 在准备目标之后才分派：印刷过滤器里的 controller: "self" 是能力控制者
  // 占位（参考内核不解析），目标会被判为不可用而使指令 ignored（359.3.e.7）。这里用一个
  // 内核能理解的中性过滤器，让执行走到分派阶段，观察未注册原语抛错。
  const kernel = world()
    .unit("eye-of-twilight", { types: ["legend"], zone: "board" })
    .unit("ally", { zone: "board" })
    .build();
  kernel.setTargets("eye-of-twilight.unit", [kernel.ref("ally")]);
  const neutralBody = ability.body.map(instruction => ({
    ...instruction,
    targets: instruction.targets.map(target => ({
      ...target,
      filter: { zone: "board", type: "unit" }
    }))
  }));
  assert.throws(
    () => runAbilityBody(neutralBody, kernel),
    /Unregistered instruction opcode: continuous.grant-keyword/
  );
});

test("ven-147-166 golden: the printed Exhaust cost pays through the merged cost pipeline", () => {
  const kernel = world()
    .unit("eye-of-twilight", { types: ["legend"], zone: "board" })
    .build();
  const context = kernel.clone({ sourceSnapshot: kernel.getObject("eye-of-twilight") });

  const plan = buildCostPlan(context, { id: "cost", cost: ability.cost });
  const receipt = payCostPlan(context, plan);

  assert.equal(receipt.paid, true);
  // 印刷费用只有一个非标准 Exhaust 动作（357.2）。
  assert.deepEqual(plan.total.actions.map(entry => entry.action), [
    { type: "exhaust", object: context.ref("eye-of-twilight") }
  ]);
  // 合并支付管线先提交标准资源 pay（0 能量），再按顺序执行非标准费用。
  assert.deepEqual(receipt.actions.map(entry => [entry.action.type, entry.status]), [
    ["pay", "done"],
    ["exhaust", "done"]
  ]);
  assert.equal(context.getObject("eye-of-twilight").exhausted, true);
  assert.deepEqual(context.events.map(event => event.action), ["pay", "exhaust"]);
});

test("ven-147-166 golden: an already-exhausted legend cannot pay the Exhaust cost (415.4)", () => {
  const kernel = world()
    .unit("eye-of-twilight", { types: ["legend"], zone: "board", exhausted: true })
    .build();
  const context = kernel.clone({ sourceSnapshot: kernel.getObject("eye-of-twilight") });

  // 415.4：作为费用时 Exhaust 必须能够完成，否则费用未支付；合并费用管线在 Finalize
  // 之前以 cannot-pay-cost 拒绝。
  assert.throws(
    () => payCostPlan(context, buildCostPlan(context, { id: "cost", cost: ability.cost })),
    /cannot repay|An exhaust cost requires a ready controlled object/
  );
});

test.todo(
  "ven-147-166: Tank has no KeywordDef in effects/keywords (the merged RIFT-81~88 batch excludes " +
    "it), so both the keyword identity and its 815.1.b combat assignment meaning are unmerged"
);
test.todo(
  "ven-147-166: continuous.grant-keyword (duration-bounded keyword grant) is not a registered " +
    "instruction opcode — RIFT-91 merged the layer engine only (Gem Jammer / Bubble Bot / " +
    "Matriarch of War share the gap)"
);
test.todo(
  "ven-147-166: [Tank] must be assigned combat damage first (815.1.b / 815.1.c.2) — combat/ only " +
    "proves the narrow path with keywordPriority: \"proven-none\""
);
