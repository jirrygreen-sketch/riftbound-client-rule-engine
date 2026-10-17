import type { CardProgram } from "../../ir/index.js";

/**
 * World Atlas — sfd-086-221 (CR v1.5 818.1.b/c).
 * Re-verified 2026-10-17 against the merged engine: printed Equip costs one
 * Mind Power, the expansion and attach body execute, and the printed ability
 * cost is still missing at the production payment boundary.
 */
// Printed "Equip [Mind]": one Mind Power rune and no Energy symbol. value counts
// the printed resource symbols and costDomain records the Power rune (the same
// extension-field convention the sibling Equipment cards use); contract 3.1's
// KeywordAbility still has no field for the printed cost, so nothing consumes it
// yet (see judgeReason).
const equip = {
  kind: "keyword",
  keyword: "equip",
  value: 1,
  costDomain: "Mind"
} as const;

export default {
  canonicalCardId: "card.hash-2d067a6d3e2dbc9738ed7868ad7bea2727fdc69a8074c639e913e6360798d27c",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "三处当前缺口（复核 2026-10-17），均不近似实现：" +
    "(1) 印刷 Equip 费用（818.1.c：一个 Mind Power 符文、无 Energy）没有从卡面传到关键词展开：KeywordDef.expand 已有可选的 params.cost 入口（3.8 第 3 条），" +
    "但 programs/keywords.ts 只传 value/host，Equip.ts 的 expand() 也不读取 params.cost，因此卡内的 value:1 与 costDomain:\"Mind\" 仍是描述性占位，不是权威 CostSpec。" +
    "(2) Equip 展开仍声明 payments: [{ kind: \"equip\", value: { kind: \"source\" } }]；cost/plan-values.ts 的 kind 分发不含 equip，" +
    "在生产 activate 草稿上实测 buildCostPlan 抛 CostPlanError reason \"judge-required\"、message \"Unsupported payment kind: equip\"，" +
    "印刷的 Mind Power 启动费用无法进入 Finalize 费用计划与支付。" +
    "(3) 818.2/818.2.a 的 Attach 事件本体已合入：effect.attach 经 chain/interpreter-adapter 对 Finalize 锁定的「你控制的单位」真实执行，equip-target 的 TargetSpec 与 attach 事件都有执行测试；" +
    "缺少的只是与印刷费用相连的那一段，不能把它当作整卡可执行。",
  abilities: [equip],
  sourceText: "[Equip] :rb_rune_mind: (:rb_rune_mind:: Attach this to a unit you control.)"
} satisfies CardProgram;
