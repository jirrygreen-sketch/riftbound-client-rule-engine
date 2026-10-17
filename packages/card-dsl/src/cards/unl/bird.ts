import type { CardProgram } from "../../ir/index.js";

/**
 * Bird — CR v1.5 187.7 (Bird token), 809.1.b.3 (Deflect defaults to 1),
 * 809.1.c.1/809.1.d (mandatory additional Power of any Domain),
 * 809.2 (sum Deflect values). Keyword-only declaration; RIFT-360 owns
 * automatic target tax derivation and conversion to Power payment.
 */
export default {
  canonicalCardId:
    "card.hash-68b515e1903e6d629eeb25b886b6f90bb791121e70c5ea72793220dd7f70e70d",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "当前缺口（CR v1.5 809.1.c/809.1.c.1/809.1.d）：Deflect 已展开为 static target.tax，但 static binder 尚无 target.tax 的 layer 映射，目标流程也未从被选永久物派生每次选择的 Deflect 税；chain/engine.ts 收集显式税后仍把 tax.amount 记为 Energy，而应为任意域 Power。任意域 Power 的成本计划、资源分配与支付动作已存在，但测试内核及 engine-runtime/host.ts 的 pay 消费方尚不扣除 plan.power；仍需「敌方选择 → Deflect 数值/叠加 → 目标税 → Power 费用与实际扣除」接线（进行中 RIFT-360）。",
  abilities: [
    // 809.1.b.3：印刷的 [Deflect] 未写数值，X 按 1 处理，故省略 value。
    { kind: "keyword", keyword: "deflect" }
  ],
  sourceText:
    "[Deflect] (Opponents must pay :rb_rune_rainbow: to choose me with a spell or ability.)"
} satisfies CardProgram;
