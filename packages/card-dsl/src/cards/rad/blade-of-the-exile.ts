/**
 * Blade of the Exile (rad-150-167) — Gear, 3 Energy, 1 Calm/Chaos power,
 * Might 3, tags Equipment / Riven / Signature.
 *
 * Printed text:
 *   [Equip] — :rb_rune_rainbow: or exhaust a friendly unit.
 *   (Pay the cost: Attach this to a unit you control.)
 *
 * 规则依据（CR v1.5）：
 * - `[Equip]`（818.1：Activated Ability keyword；818.1.a Gear 带 Equipment 标签成立；
 *   818.1.b 支付费用后把本卡 Attach 到所选单位；818.1.c 格式为 “Equip [Cost]”；
 *   818.1.c.2 功能等价于 “[Cost]: Attach this gear to a unit you control.”）。
 *   本卡整个能力就是这一条 Equip 行，因此程序只声明关键词身份与参数，不重写展开。
 * - 费用 “:rb_rune_rainbow: or exhaust a friendly unit”：135.2.e.5 / 135.2.e.5.a 规定 rainbow 符号
 *   代表“任意领域的一个 Power”，作为费用时可由任意领域的 Power 支付；818.1.c.3 允许 Equip 费同时含
 *   资源费与非资源费。原印刷费用是**二选一**（“rainbow 或 横置一个友方单位”），属于费用层面的选择。
 * - 括号内 “Pay the cost: Attach this to a unit you control.” 是提示文本（135.2.d.3 无游戏功能）。
 *
 * status = judge-required（不近似实现）。已合入并复核过的部分：
 * - effects/keywords/Equip.ts 已注册（818 的展开：action-speed activated 能力 + 818.1.b 的
 *   effect.attach 到己方单位），它的 body 用已合入的 effect.attach 可真实执行（本卡 golden 已跑通）。
 * - rainbow Power 可由任意域支付：已合入的费用计划接受 allowedDomains 为六域的 power 费用。
 *
 * 仍缺的缺口：
 * 1. 候选单位是**费用里的选择**而不是目标（355.10.c / 355.10.c.1）：已合入的 cost/plan-values.ts
 *    对非标准费用只接受一个精确 ObjectRef（payment.object / payment.objects 会被 reference() 拒绝
 *    非 {id, zoneEntryId} 的候选列表），没有把 PickSpec 候选集展开成可重放选择的能力；
 *    实测 kind: "equip" 会被 readCost 以 judge-required 拒绝（"Unsupported payment kind: equip"）。
 * 2. 因此 Equip.ts 的展开目前只有固定单一 payments 形状，承载不了印刷的“rainbow Power 或横置友方单位”
 *    二选一，也承载不了 818.1.c.4 / 818.1.c.5 的费用改写。
 * 3. 费用管线没有把 Equip 的印刷费用绑定到一个可支付的费用计划；
 *    cost.pay / cost.modify 本身已合入，但 kind: "equip" 仍需权威的 Equip 费用来源。
 * 不近似实现：两个费用选项继续只以扩展字段记录，不把“exhaust a friendly unit”改写成目标或免费效果。
 */
const program = {
  canonicalCardId: "card.hash-d127ec787d0c328ab80a9aa29a656cd77a9dda6050627ec1bad17db1942c9853",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "[Equip] 展开仍无法表达印刷费用的二选一，且费用侧对象选择未合入：(1) 已合入的 Equip.ts 只展开固定单一 " +
    "payments 形状（kind: \"equip\"），而本卡是“任意领域 1 Power（135.2.e.5.a）或 横置一个友方单位”；" +
    "cost/plan-values.ts 的 readCost 对 kind: \"equip\" 直接以 judge-required 拒绝，也没有把 PickSpec 候选集" +
    "展开成费用选择的路径（非标准费用只接受一个精确 ObjectRef）；" +
    "(2) “exhaust a friendly unit”的候选单位是费用里的选择而非目标（355.10.c / 355.10.c.1）。" +
    "(3) Equip 的印刷费用仍没有权威的费用计划绑定；已合入的 cost.pay / cost.modify 不能凭空推断 Equip 的 [A] 或费用侧对象。" +
    "不近似实现：两个费用选项继续以扩展字段记录。",
  abilities: [
    {
      kind: "keyword",
      keyword: "equip",
      value: 1,
      costDomain: "rainbow",
      costAlternatives: [
        { kind: "power", domain: "rainbow", amount: 1 },
        { kind: "exhaust", target: "friendly-unit" }
      ]
    }
  ],
  sourceText:
    "[Equip] — :rb_rune_rainbow: or exhaust a friendly unit. (Pay the cost: Attach this to a unit you control.)"
} as const;

export default program;
