import type { CardProgram } from "../../ir/index.js";

/**
 * Svellsongur (sfd-059-221) — Gear, 3 energy + 1 Calm power, Might 0, 领域 Calm,
 * 标签 Equipment。
 *
 * sourceText（逐字取自 packages/card-data/data/deck-catalog.json sfd-059-221）：
 *   "[Equip] :rb_energy_1::rb_rune_calm: (:rb_energy_1::rb_rune_calm:: Attach this to a
 *    unit you control.)
 *    As this is attached to a unit, copy that unit's text to this Equipment's effect
 *    text for as long as this is attached to it."
 *
 * 规则依据（CR v1.5）：
 * - 818.1 / 818.1.a / 818.1.c / 818.1.c.2：Equipment 上的 [Equip] 是启动式能力关键词，
 *   印刷费用为 1 能量 + 1 个 Calm 符文，功能上等于「[费用]: Attach this to a unit you
 *   control.」。展开由已合入的 effects/keywords/Equip.ts 负责。
 * - 479.1 / 479.1.a / 479.1.d：复制效果在 copy 图层结算；479.1.d 的示例直接点名本卡
 *   （“Svellsongur is an Equipment that reads in part ‘As this is attached to a unit, copy
 *   that unit's text to this Equipment's effect text for as long as this is attached to
 *   it.’ This is a copy effect that is applied in this layer.”）。
 * - 435.1.c / 435.1.e：附着后的 Top-Most Card 获得所附着牌的 Effect Text；装备自身印刷的
 *   Rules Text 在附着期间 Inactive。本卡的复制把被附着单位的文本写入本装备的 effect text，
 *   期限与附着状态同步（“for as long as this is attached to it”）。
 *
 * status = judge-required（两处当前缺口，均不近似实现）：
 * 1. Equip 启动费用仍不可支付：cost/plan-values.ts 的 readCost 对 Equip 展开声明的
 *    `payments: [{ kind: "equip" }]` 调用 blocked。
 * 2. 附着期文本复制没有可执行路径：CR 479.1/479.1.d 要求把被附着单位的文本写入本装备
 *    的 effect text，并在脱离时结束；当前 copy 图层与 effect.copy 的 `mode: "effect"`
 *    没有消费该形态。卡牌程序绑定和 Equip 展开本身已经合入。
 */
export default {
  canonicalCardId: "card.hash-b789f6d844c0da0576802aca0c36d51a7475c3c3c62c21b9ef4092438971fafe",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "两处当前缺口：(1) Equip 启动费用无法支付：cost/plan-values.ts 的 readCost 对 Equip 展开声明的 " +
    "payments: [{ kind: \"equip\" }] 当前调用 blocked；(2) CR 479.1/479.1.d 的附着期文本复制没有可执行消费方，" +
    "copy 图层与 effect.copy 的 mode \"effect\" 尚未把被附着单位的 effect text 写入本装备并在脱离时结束。" +
    "卡牌程序绑定和 Equip 展开已经合入。不把复制近似成新建对象或裸持续字段。",
  abilities: [
    // 818.1.c：印刷费用为 1 能量 + 1 个 Calm 符文；value 记录印刷符号数 2（能量 1 + 符文 1）。
    { kind: "keyword", keyword: "equip", value: 2 }
  ],
  sourceText:
    "[Equip] :rb_energy_1::rb_rune_calm: (:rb_energy_1::rb_rune_calm:: Attach this to a unit you control.)\n" +
    "As this is attached to a unit, copy that unit's text to this Equipment's effect text for as long as this is attached to it."
} satisfies CardProgram;
