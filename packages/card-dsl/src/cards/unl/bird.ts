import type { CardProgram } from "../../ir/index.js";

/**
 * Bird — CR v1.5 187.7 (Bird token), 809.1.b.3 (Deflect defaults to 1),
 * 809.1.c.1/809.1.d (mandatory additional Power of any Domain),
 * 809.2 (sum Deflect values). Keyword-only declaration; the automatic target-tax
 * derivation and the Power conversion are still unmerged (RIFT-360).
 *
 * 复核后的真实缺口（CR v1.5 809.1.c/809.1.c.1/809.1.d）：Deflect 已展开为 static
 * target.tax（809.1.b.3 的省略值按 1），但 programs/statics.ts 的 layerFor 没有
 * target.tax 映射（实测抛 judge-required），目标流程也没有从被选永久物派生每次
 * 选择的 Deflect 税；chain/engine.ts 收到税后仍写成 energy 分量
 * （cost: { energy: tax.amount }），而 809.1.c.1 要求任意域 Power。Power 成本计划、
 * 分配与支付已存在（cost/payment.ts 的 prepareCostPayment 会产出 power 分配），
 * 但测试内核与 apps/game-server 的 pay 动作只扣 energy/xp，不消费 plan.power。
 */
export default {
  canonicalCardId:
    "card.hash-68b515e1903e6d629eeb25b886b6f90bb791121e70c5ea72793220dd7f70e70d",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "当前缺口（CR v1.5 809.1.c/809.1.c.1/809.1.d）：Deflect 已展开为 static target.tax，" +
    "但 static binder 尚无 target.tax 的 layer 映射（实测抛 Static ability kind target.tax has no layer mapping），" +
    "目标流程也未从被选永久物派生每次选择的 Deflect 税（809.2 的多实例求和）。" +
    "chain/engine.ts 收到显式税后仍把 tax.amount 记为 Energy 分量，而 809.1.c.1 要求任意域 Power。" +
    "任意域 Power 的成本计划、分配与支付动作已存在（cost/payment.ts 的 prepareCostPayment 产出 power 分配），" +
    "但测试内核与 engine-runtime/host.ts 的 pay 消费方只扣 energy/xp，仍不消费 plan.power；" +
    "因此缺少「敌方选择 → Deflect 数值/叠加 → 目标税 → Power 费用与实际扣除」这条接线（进行中 RIFT-360）。",
  abilities: [
    // 809.1.b.3：印刷的 [Deflect] 未写数值，X 按 1 处理，故省略 value。
    { kind: "keyword", keyword: "deflect" }
  ],
  sourceText:
    "[Deflect] (Opponents must pay :rb_rune_rainbow: to choose me with a spell or ability.)"
} satisfies CardProgram;
