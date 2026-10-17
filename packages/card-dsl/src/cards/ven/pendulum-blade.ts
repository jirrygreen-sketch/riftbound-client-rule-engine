import type { CardProgram } from "../../ir/index.js";

/**
 * Pendulum Blade (ven-011-166) — Gear, 3 Energy, power null (no printed Power),
 * Might 1, Fury, tag Equipment.
 *
 * sourceText（逐字取自 packages/card-data/data/deck-catalog.json, ven-011-166）：
 *   "[Equip] :rb_rune_fury: (:rb_rune_fury:: Attach this to a unit you control.)"
 *
 * 规则依据（CR v1.5）：
 * - 818.1 / 818.1.a：Equip 是启动式能力关键词，出现在带 Equipment 标签的 Gear 上
 *   （149.1 / 150.1–150.4：Equipment 仍是 Gear，印刷 3 energy 是 Gear 的打出费用）。
 * - 818.1.c / 818.1.c.2：格式为 "Equip [Cost]"，功能上等于「[费用]：把此装备附着到
 *   you control 的一个单位」；818.1.b.1 明确该选择是 Target，818.1.b.2 说明被选单位
 *   成为附着动作的 Top-Most Card。
 * - 135.2.e.4 / 163.2.b：印刷的 :rb_rune_fury: 是 1 点 Fury Power（本卡无能量费用）。
 *
 * status = judge-required：卡牌关键词展开与 describeActivate 接线已存在，effect.attach 可真实执行。
 * 仍缺 KeywordAbility → expand params.cost 的印刷费用传递，以及 Equip.ts 对该费用的消费；
 * 展开仍声明 payments:[{kind:"equip"}]，费用计划没有对应支付语义（818.1.c）。
 * 不把 Gear 的打出费用当成 Equip 费，也不把 Equip 降级成裸 effect.attach。
 */
/**
 * 818.1.c：印刷的 Equip 费用是 1 点 Fury Power；value 记印刷资源符号数，costDomain 记该
 * Power 的领域（同目录 sfd/long-sword、sfd/recurve-bow 的既存写法）。印刷的 3 energy 是
 * Gear 的打出费用（149.1/359.2.d），不是 Equip 费用。costDomain 是契约外的扩展字段，
 * 因此用 as const 声明后再放进 abilities。
 */
const equip = {
  kind: "keyword",
  keyword: "equip",
  value: 1,
  costDomain: "Fury"
} as const;

export default {
  canonicalCardId: "card.hash-cf2885ca18787660c4888723a93f4322d32c6a6fcb218d79e11353307fbbe53c",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "[Equip] 的印刷费用（1 Fury Power，818.1.c / 135.2.e.4）仍缺绑定：KeywordAbility 只有 keyword/value，programs/keywords.ts 未传递 params.cost，Equip.ts 也未读取该参数；描述性的 costDomain 不能产生可支付费用。" +
    "Equip 展开仍给出 payments:[{kind:\"equip\"}]，cost/plan-values.ts 无此支付种类，不能生成 1 Fury Power 的计划。通用 Power 支付、activationAbilities / describeActivate 与 effect.attach 已存在；仅附件 body 的真实执行不证明 Equip 费用可用，也不将 Gear 的 3 Energy 打出费用充作 Equip 费。",
  abilities: [equip],
  sourceText:
    "[Equip] :rb_rune_fury: (:rb_rune_fury:: Attach this to a unit you control.)"
} satisfies CardProgram;
