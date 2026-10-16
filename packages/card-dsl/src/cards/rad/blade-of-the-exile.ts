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
 *   资源费与非资源费。原印刷费用是**二选一**（“rainbow 或 横置一个友方单位”），属于费用层面的选择；
 *   契约 3.1 的 `KeywordAbility` 只有 `{ keyword, value }`，没有承载费用选项的字段，故按已合入的
 *   sfd Equip 卡（long-sword / bf-sword / dorans-blade / sacred-shears / warmogs-armor）同一做法，用
 *   扩展字段 `costDomain` 记录费用，并把两个选项都在 `costAlternatives` 里写全，保证可审查、不被近似
 *   的单一费用覆盖。这是扩展字段用法而非共享契约改动（本卡任务 owns 之外的文件一行未改）。
 * - 括号内 “Pay the cost: Attach this to a unit you control.” 是提示文本（135.2.d.3 无游戏功能）。
 *
 * 缺口（不近似实现，故 judge-required）：
 * - `Equip` 关键词展开（`effects/keywords/Equip.ts`）当前展开为固定单一费用
 *   `payments: [{ kind: "equip", value: … }]`，无法表达“rainbow Power 或 横置一个友方单位”的二选一
 *   费用，也无法表达 818.1.c.4 / 818.1.c.5 的费用改写；关键词批次 RIFT-87（kw-equip-quick-draw-
 *   weaponmaster）负责 Equip 的 cost.activated / cost.pay 落地；
 * - 非资源费用“exhaust a friendly unit”需要 cost.exhaust（RIFT-9 清单 cost 组的非标准费用），
 *   尚无对应原语文件，且候选单位是费用里的“选择”而非目标（355.10.c / 355.10.c.1）。
 */
const program = {
  canonicalCardId: "card.hash-d127ec787d0c328ab80a9aa29a656cd77a9dda6050627ec1bad17db1942c9853",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "[Equip] 展开无法表达印刷费用的二选一：Equip.ts 只展开单一 payments 费用，而本卡是" +
    "“任意领域 1 Power（135.2.e.5.a）或 横置一个友方单位”，后者属于 cost.exhaust 非标准费用" +
    "（RIFT-9 清单 cost 组，尚无原语文件），且候选单位是费用里的选择而非目标（355.10.c/355.10.c.1）。" +
    "依赖 RIFT-87（kw-equip-quick-draw-weaponmaster 的 cost.activated / cost.pay）与 cost.exhaust " +
    "支持；不近似实现，两个费用选项均以扩展字段记录。",
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
