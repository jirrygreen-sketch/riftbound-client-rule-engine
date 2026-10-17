import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ven/eye-of-twilight.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { buildCostPlan } from "../../../../engine-core/dist/cost/cost-plan.js";
import { payCostPlan } from "../../../../engine-core/dist/cost/payment.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import { instructionDefinitionsById } from "../../../../engine-core/dist/effects/instructions/registry.generated.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import { matchesObjectFilter } from "../../../../engine-core/dist/layers/filter.js";
import { createLayerEngine } from "../../../../engine-core/dist/layers/index.js";

const CANONICAL_ID =
  "card.hash-58b622a816049405488a25adae394668eeed8847e5a9ff884d3f09ce03886a4d";
const SOURCE_TEXT =
  "[Action][>] :rb_exhaust:: Give a friendly unit [Tank] this turn. " +
  "(It must be assigned combat damage first.)";

const [ability] = program.abilities;
const [grantTank] = ability.body;

/**
 * chain/engine.ts 在调用生产匹配器之前先解析 controller/owner 的相对选择符
 * ('self' → 能力控制者，'opponent' → 排除该玩家)。参考内核对过滤器值做字面比较，
 * 所以 golden 走同一层规范化（与 smoke-screen / siphon-power 的 golden 相同做法）。
 */
const chainContext = (kernel, controller) => new Proxy(kernel, {
  get(target, key) {
    if (key === "query") return (filter) => {
      const normalized = { ...filter };
      for (const name of ["controller", "owner"]) {
        if (normalized[name] === "self") normalized[name] = controller;
      }
      return kernel.query({}).filter((object) => {
        for (const name of ["controller", "owner"]) {
          if (normalized[name] === "opponent" && object[name] === controller) return false;
        }
        return matchesObjectFilter({
          ...normalized,
          ...(normalized.controller === "opponent" ? { controller: "any" } : {}),
          ...(normalized.owner === "opponent" ? { owner: "any" } : {})
        }, object);
      });
    };
    const value = Reflect.get(target, key);
    return typeof value === "function" ? value.bind(target) : value;
  }
});

const registrations = (kernel) => kernel.continuousEffects.map((entry, index) => ({
  effect: entry.effect,
  duration: entry.duration,
  timestamp: index + 1
}));

const eyeWorld = () => {
  const base = world()
    .unit("eye-of-twilight", { types: ["legend"], zone: "board", owner: "A", controller: "A", might: null })
    .unit("ally", { owner: "A", controller: "A" })
    .unit("other-ally", { owner: "A", controller: "A" })
    .unit("enemy", { owner: "B", controller: "B" })
    .build();
  base.setTargets("eye-of-twilight.unit", [base.ref("ally")]);
  return base;
};

test("ven-147-166 Eye of Twilight: validateCardProgram passes and identity is verbatim", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  // 复核后的 judgeReason 只保留仍未解决的缺口：[Tank] 的 KeywordDef（RIFT-264）与
  // continuous.grant-keyword（RIFT-258）都已合入，剩下的只是 815.1.b/815.1.c.2 的
  // 伤害分配消费方。
  assert.match(program.judgeReason, /815\.1\.b/);
  assert.match(program.judgeReason, /continuous\.combat/);
  assert.match(program.judgeReason, /RIFT-258/);
  assert.doesNotMatch(program.judgeReason, /缺 Tank KeywordDef/);
  assert.ok(!/待实现|需要裁定/.test(program.judgeReason));
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
    // 契约 3.6 的符号选择器：continuous.grant-keyword 读 objects 里的 target 选择器。
    objects: { kind: "constant", value: { kind: "target", id: "eye-of-twilight.unit" } }
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

test("ven-147-166: RIFT-264/258 merged the Tank KeywordDef and the grant primitive", () => {
  // 复核证据：两条原缺口依赖当前都已合入。
  assert.equal(instructionDefinitionsById.has("continuous.grant-keyword"), true);
  const tank = keywordDefinitionsById.get("Tank");
  assert.ok(tank, "the merged Tank KeywordDef must be registered");
  assert.equal(tank.valued, false);
  assert.equal(tank.stacking, "single");
  // 但 Tank 展开出的 continuous.combat 仍没有消费方（唯一剩余缺口）。
  const [expanded] = tank.expand({ host: { canonicalCardId: CANONICAL_ID } });
  assert.equal(expanded.kind, "static");
  assert.equal(expanded.effect.kind, "continuous.combat");
  assert.equal(instructionDefinitionsById.has("continuous.combat"), true);
});

test("ven-147-166 golden: the printed ability really grants [Tank] this turn through the production adapter", () => {
  const base = eyeWorld();
  const outcome = resolveChainBody(ability.body, chainContext(base, "A"));

  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.results.map(result => [result.id, result.result.status]), [
    ["eye-of-twilight.grant-tank", "executed"]
  ]);
  assert.deepEqual(outcome.linkedValues["eye-of-twilight.grant-tank.granted.count"], 1);
  assert.deepEqual(outcome.linkedValues["eye-of-twilight.grant-tank.granted.objects"], [base.ref("ally")]);

  // 478 / 478.1.a：授予落在 ability 图层；317.1.a / 468.7.c：“this turn” = end-of-turn。
  assert.equal(base.continuousEffects.length, 1);
  const [registration] = base.continuousEffects;
  assert.equal(registration.effect.layer, "ability");
  assert.equal(registration.effect.effect.kind, "continuous.grant-keyword");
  assert.equal(registration.effect.effect.keyword, "Tank");
  assert.deepEqual(registration.effect.filter.objectId, "ally");
  assert.deepEqual(registration.duration, { type: "end-of-turn" });

  // 真实特征的授予：只有被锁定的友方单位获得 [Tank]（815.3：可引用特征）。
  const layers = createLayerEngine(base.objects, registrations(base));
  assert.deepEqual(layers.evaluate(base.ref("ally")).keywords.map(keyword => keyword.id), ["Tank"]);
  assert.deepEqual(layers.evaluate(base.ref("other-ally")).keywords, []);
  assert.deepEqual(layers.evaluate(base.ref("enemy")).keywords, []);
});

test("ven-147-166 golden: the granted [Tank] expires at end of turn (317.1.a / 468.7.c)", () => {
  const base = eyeWorld();
  resolveChainBody(ability.body, chainContext(base, "A"));
  const layers = createLayerEngine(base.objects, registrations(base));
  assert.deepEqual(layers.evaluate(base.ref("ally")).keywords.map(keyword => keyword.id), ["Tank"]);

  assert.equal(layers.expireAt("turn-end").length, 1);
  assert.deepEqual(layers.evaluate(base.ref("ally")).keywords, []);
});

test("ven-147-166 golden: a friendly unit that already left the Board is ignored (359.3.e.7)", () => {
  const base = eyeWorld();
  const stale = base.ref("ally");
  base.perform({ type: "kill", object: stale });
  base.setTargets("eye-of-twilight.unit", [stale]);

  const outcome = resolveChainBody(ability.body, chainContext(base, "A"));
  assert.equal(outcome.status, "partial");
  assert.deepEqual(outcome.results[0].result, { status: "ignored", reason: "mistargeted" });
  assert.equal(base.continuousEffects.length, 0);
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
  "ven-147-166: [Tank] must be assigned combat damage first (815.1.b / 815.1.c.2) — the Tank " +
    "KeywordDef (RIFT-264) expands to continuous.combat, but layers/engine.ts has no branch for it, " +
    "continuous.combat returns negated/impossible without a consumer, and combat/ only proves the " +
    "narrow path with keywordPriority: \"proven-none\""
);
