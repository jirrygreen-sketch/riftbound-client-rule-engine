import type { CardProgram } from "../../ir/index.js";

/**
 * Bird — CR v1.5 187.7 (Bird token), 809.1.b.3 (Deflect defaults to 1),
 * 809.1.c.1/809.1.d (mandatory additional Power of any Domain),
 * 809.2 (sum Deflect values). Keyword-only declaration; RIFT-360 merged the tax
 * planning/collection module, but its static-binding and Chain consumers plus
 * the Power deduction are still missing.
 *
 * 复核后的真实缺口（CR v1.5 809.1.c/809.1.c.1/809.1.d）：RIFT-360 已合入
 * target/tax/{adapter,collect}.ts（显式税 + Deflect 求和的成本计划、任意域 Power 需求），
 * 但 Deflect 展开出的 static target.tax 仍没有消费方：programs/statics.ts 的 layerFor
 * 没有 target.tax 映射（实测抛 Static ability kind target.tax has no layer mapping），
 * 因此静态声明进不了绑定的税集合，collectTargetTaxes 的 effects 分支拿不到绑定。
 * chain/engine.ts 的 Finalize 仍自带 appendTargetTax 收集器并把收到的税额写成 energy
 * 分量（cost: { energy: { … tax.amount } }），未改用 RIFT-360 的 per-item 适配器，
 * 而 809.1.c.1 要求任意域 Power。Power 成本计划、分配与支付已存在
 * （cost/payment.ts 的 prepareCostPayment 会产出 power 分配），但测试内核与
 * apps/game-server 的 pay 动作只扣 energy/xp，不消费 plan.power。
 */
export default {
  canonicalCardId:
    "card.hash-68b515e1903e6d629eeb25b886b6f90bb791121e70c5ea72793220dd7f70e70d",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "当前缺口（CR v1.5 809.1.c/809.1.c.1/809.1.d）：Deflect 已展开为 static target.tax，" +
    "RIFT-360 已合入 target/tax/adapter.ts 与 target/tax/collect.ts（显式目标税、Deflect 按实例求和、" +
    "任意域 Power 需求与可付性预检），但两处接线仍缺：" +
    "(1) programs/statics.ts 的 layerFor 没有 target.tax 映射（实测抛 Static ability kind target.tax has no layer mapping），" +
    "静态声明无法注册为已绑定的税，collectTargetTaxes 的 effects 分支因此收不到本卡的 Deflect 绑定；" +
    "(2) chain/engine.ts 的 Finalize 仍用自己的 appendTargetTax 收集器，并把收到的 tax.amount 记成 Energy 分量" +
    "（cost: { energy: { kind: \"constant\", value: tax.amount } }），未改用 RIFT-360 的 per-item 适配器，" +
    "而 809.1.c.1 要求任意域 Power。809.2 的多实例求和由 collectTargetTaxes 覆盖，但缺少上述两条接线时不可达。" +
    "任意域 Power 的成本计划、分配与支付动作已存在（cost/payment.ts 的 prepareCostPayment 产出 power 分配），" +
    "但测试内核与 engine-runtime/host.ts 的 pay 消费方只扣 energy/xp，仍不消费 plan.power；" +
    "因此缺少「敌方选择 → Deflect 数值/叠加 → 目标税 → Power 费用与实际扣除」这条接线，依赖 RIFT-360 的 Chain/静态绑定器管道接线。",
  abilities: [
    // 809.1.b.3：印刷的 [Deflect] 未写数值，X 按 1 处理，故省略 value。
    { kind: "keyword", keyword: "deflect" }
  ],
  sourceText:
    "[Deflect] (Opponents must pay :rb_rune_rainbow: to choose me with a spell or ability.)"
} satisfies CardProgram;
