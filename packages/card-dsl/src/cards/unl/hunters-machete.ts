
/**
 * Hunter's Machete (unl-096-219) — Gear, Body, tag Equipment。
 * energy 3、power null（无印刷 Power）、might 2（150.2 Equipment 的 Might bonus）。
 *
 * sourceText（packages/card-data/data/deck-catalog.json, unl-096-219，逐字）：
 *   [Equip] :rb_rune_body: (:rb_rune_body:: Attach this to a unit you control.)
 *
 * 规则依据（CR v1.5）：
 * - 150 / 150.1 / 150.3 / 818.1.a：Equip 出现在带 Equipment 标签的 Gear 上（本地目录该
 *   印刷 tags = ["Equipment"]，与规则一致）；818.1 / 818.1.b / 818.1.c.2 定义它是
 *   「[费用]: Attach this gear to a unit you control.」的启动能力关键词，818.1.b.1 规定
 *   所选单位是 Target。
 * - 818.1.c：Equip 的印刷格式是 Equip [Cost]；本源印刷费用是 1 个 Body 符文符号，按契约 3.7
 *   与 README 第 5 节卡只声明关键词与印刷数值，费用的 Power 域由 costDomain 记录。
 * - 展开（启动能力、单位目标、attach 本体）属于 effects/keywords/Equip.ts。
 *
 * status = judge-required（README 第 2 节；按当前源码复核）：Equip 的激活费用仍不能在费用管线里
 * 支付——effects/keywords/Equip.ts 展开的 cost.payments 是 { kind: "equip", value: ... }，而
 * cost/plan-values.ts 的 readCost 对该专用支付种类仍 fail closed，buildCostPlan 会抛
 * CostPlanError（reason "judge-required"、message "Unsupported payment kind: equip"）。Equip
 * 的 attach 本体与 CardProgram 关键词/激活绑定已经合入；不把 Equip 近似成裸 effect.attach（会绕开
 * 818.1.c.3 / 818.1.c.4 的费用与费用改写语义）。
 */
export default {
  canonicalCardId:
    "card.hash-d2580c0f7a993eb938c0e656fc955d9a10d34e35758dbfed9502de2a75828f9d",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "Equip（818.1.c 的印刷费用）的启动费用尚不能在 EffectIR 费用管线里支付：已合入的 Equip 展开（effects/keywords/Equip.ts）声明 " +
    "payments: [{ kind: \"equip\", value: { kind: \"source\" } }]，而 cost/plan-values.ts 的 readCost 对该专用支付种类直接 fail closed，" +
    "实测 buildCostPlan 抛 CostPlanError（reason \"judge-required\"、message \"Unsupported payment kind: equip\"）。" +
    "Equip 的关键词展开、attach 本体与程序绑定已经合入；" +
    "依赖：Equip 专用费用种类的费用计划消费方。不近似实现（不把 Equip 改成裸 effect.attach 绕开费用）。",
  abilities: [
    // 818.1.c：印刷费用为 1 个 Body Power 符号；卡只声明关键词身份、数值与费用域。
    { kind: "keyword", keyword: "equip", value: 1, costDomain: "Body" }
  ],
  sourceText:
    "[Equip] :rb_rune_body: (:rb_rune_body:: Attach this to a unit you control.)"
} as const;
