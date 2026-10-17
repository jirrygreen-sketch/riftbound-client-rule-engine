import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Hextech Gauntlets (unl-188-219) — Gear, 3 energy, Might 3, Fury/Order,
 * tags [Vi, Equipment, Signature]。
 *
 * sourceText（逐字取自 packages/card-data/data/deck-catalog.json, unl-188-219）：
 *   "[Equip] :rb_energy_3::rb_rune_rainbow:. This ability's Energy cost is reduced " +
 *   "by the Might of the unit you choose. (Pay the cost: Attach this to a unit you control.)"
 *
 * 规则依据（CR v1.5）：
 * - 818.1 / 818.1.a / 818.1.b / 818.1.b.1 / 818.1.b.2：Equip 是启动能力关键词，出现在
 *   带 Equipment 标签的 Gear 上（本卡 tags 含 Equipment，符合 818.1.a）；选择的单位是
 *   Target，被选择者成为 Attach 的 Top-Most Card。依契约 3.7 / README 第 5 节，卡牌
 *   程序只声明关键词与印刷参数，展开属 engine-core/src/effects/keywords/Equip.ts。
 * - 印刷的 Equip 费用是 3 Energy + 1 任意域 Power [A]（135.2.e.5 / 135.2.e.5.a：
 *   :rb_rune_rainbow: 表示 "Any Domain"）。
 * - 818.1.c.4："This ability's Energy cost is reduced by the Might of the unit you choose"
 *   是改写该 Equip 费用的文本，必须在确定并支付 Equip 费用时计入（818.1.c.3 / c.5 允许
 *   Equip 带费用与目标改写）。143.2.a / 206：Might 是被选单位当前的**有效** Might
 *   （算术图层求值后）；356.4 的折扣阶段与 356.6 的 0 下限属于费用计划。
 *   该减费既依赖被选目标（Finalize 决策），也依赖图层算出的有效 Might，因此必须在
 *   Finalize 的费用计划里计算——卡牌程序不能自己改价格，也不能写成第二条裸 effect.attach
 *   （那会绕开 818.1.c.3/c.4 的费用语义）。
 *
 * 印刷参数的承载方式（与同批已合入 Equip 卡同规格；见下方 judgeReason 与回复的
 * 「契约变更请求」）：契约 3.1 的 `KeywordAbility` 只有 keyword / value 两个字段，没有
 * 承载"3 Energy + 1 任意域 Power"这种混合费用的参数槽（同关系的 sfd/long-sword、
 * sfd/bf-sword 用 `costDomain` 记录 Power 域，且因此只能写 `as const` 而不能用
 * `satisfies CardProgram`；ven/defender-of-tomorrow 遇到同类缺口时把印刷费用只写在注释与
 * judgeReason 里）。本卡按冻结契约可校验的形状只记 `value: 3`（印刷的 3 个能量符号），
 * 那 1 点任意域 Power [A] 与减费文本写在文件头与 judgeReason 中；不写会被校验器拒绝的
 * 扩展字段，也不把 [A] 近似成某个具体域。
 *
 * status = judge-required：
 * - keywords/Equip.ts 不读取 value，仍生成 kind:equip 的费用，plan-values.ts 不支持此支付种类。
 * - KeywordAbility 仍只有 keyword/value，缺印刷 3 Energy + 1 [A] 与费用改写的参数承载。
 * - 818.1.c.4 的折扣尚未把 Finalize 锁定目标的有效 Might 传入 cost.modify 费用管线。
 * 关键词激活体的 Attach 子效果有执行测试，不据此宣称 Equip 费用可支付。
 */
const abilities: Ability[] = [
  {
    // 818.1.c："[Equip] :rb_energy_3::rb_rune_rainbow:." + 818.1.c.4 的减费文本。
    // value: 3 = 印刷的 3 个能量符号；那 1 点任意域 Power [A] 与减费文本没有契约字段
    // 承载（见文件头），展开归 keywords/Equip.ts，卡牌程序不重写展开（契约 3.7）。
    kind: "keyword",
    keyword: "equip",
    value: 3
  }
];

const program = {
  canonicalCardId:
    "card.hash-955bd858659e4d3eb8edfd20347a7496c51932de05cafd32fc71d86d94f96e47",
  rulesetVersion: "core-1.5" as const,
  status: "judge-required" as const,
  judgeReason:
    "缺 Equip 费用参数与消费：keywords/Equip.ts 不读取声明的 value，生成的 payments:[{kind:\"equip\"}] 不被 cost/plan-values.ts 接受。KeywordAbility 只有 keyword/value，无法承载印刷的 3 Energy + 1 任意域 Power [A]（CR 135.2.e.5.a）。缺 818.1.c.4 的 Equip 费用改写绑定：需在 Finalize 将锁定目标的有效 Might（143.2.a/206）传入 cost.modify / 356.4 折扣阶段并应用 356.6 的零下限；当前展开与费用参数均未连接该目标查询。",
  abilities,
  sourceText:
    "[Equip] :rb_energy_3::rb_rune_rainbow:. This ability's Energy cost is reduced " +
    "by the Might of the unit you choose. (Pay the cost: Attach this to a unit you control.)"
};

export default program satisfies CardProgram;
