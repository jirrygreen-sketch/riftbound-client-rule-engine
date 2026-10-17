
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
 * status = judge-required（README 第 2 节；按当前源码复核）：Equip 的印刷 1 Body 符文费用仍不能
 * 定价或支付。effects/keywords/Equip.ts 的 expand 声明 0 个入参，固定产出
 * cost.payments = [{ kind: "equip", value: source }]；本卡声明的 value/costDomain 因此没有通路进入
 * 展开（契约 3.8 第 3 条的 params.cost 没有消费方）。cost/plan-values.ts 的 readCost 对未知支付种类
 * 执行 blocked，实测 buildCostPlan 抛 CostPlanError（reason "judge-required"、message
 * "Unsupported payment kind: equip"），所以印刷的 Body 符文既传不进也付不掉。Equip 的
 * effect.attach 本体与 CardProgram 关键词/激活绑定已经合入；不把 Equip 近似成裸 effect.attach（会绕开
 * 818.1.c.3 / 818.1.c.4 的费用与费用改写语义）。
 */
export default {
  canonicalCardId:
    "card.hash-d2580c0f7a993eb938c0e656fc955d9a10d34e35758dbfed9502de2a75828f9d",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "Equip 的印刷 1 Body Power 费用（CR 818.1.c）仍无法定价或支付：effects/keywords/Equip.ts 的 expand 不声明入参，" +
    "固定产出 payments: [{ kind: \"equip\", value: source }]，本卡的 value 与 costDomain=Body 没有消费方；" +
    "cost/plan-values.ts 的 readCost 对未知支付种类执行 blocked，buildCostPlan 抛 CostPlanError" +
    "（reason \"judge-required\"，message \"Unsupported payment kind: equip\"）。" +
    "effect.attach 本体与关键词/激活绑定已有真实执行证据；不得绕过费用直接 attach。",
  abilities: [
    // 818.1.c：印刷费用为 1 个 Body Power 符号；卡只声明关键词身份、数值与费用域。
    { kind: "keyword", keyword: "equip", value: 1, costDomain: "Body" }
  ],
  sourceText:
    "[Equip] :rb_rune_body: (:rb_rune_body:: Attach this to a unit you control.)"
} as const;
