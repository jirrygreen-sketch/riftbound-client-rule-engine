import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Poppy, Defender of the Meek (unl-178-219) — Unit，6 能量 + 1 Order Power、Might 5，
 * 标签 Yordle / Demacia / Poppy / Champion。
 *
 * sourceText（packages/card-data/data/deck-catalog.json，unl-178-219，逐字）：
 *   You may spend 3 XP as an additional cost to play me. If you do, I cost
 *   :rb_energy_3: less.
 *   [Ambush] (You may play me as a [Reaction] to a battlefield where you have
 *   units.)
 *   [Tank] (I must be assigned combat damage first.)
 *
 * 规则依据（CR v1.5）：
 * - 356.2 / 356.2.b / 356.2.b.1："as an additional cost" + "may" 是可选附加费用，在打出
 *   步骤（355.1.a / 356.2）由控制者决定是否支付；356.4.f.1：可选附加费用"已支付"看的是玩家
 *   是否做出支付决定（与实际支付金额无关），因此 "If you do" 的凭证是费用计划的
 *   selectedAdditional，而不是 XP 数值变化。
 * - 730.1 / 730.2：XP 的获得与花费；"spend 3 XP" 是 3 点 XP 的标量费用，已合入的
 *   cost/plan-values.ts readCost 支持 { kind: "xp", amount } 并把它计入 CostPlan.total.xp
 *   （cost/payment.ts 的 spend-xp 支付动作），是最接近的可执行形状。
 * - 356.4 / 356.4.b："I cost [3] less" 是 Finalize 总费用阶段（"3. Determine Total Cost"）的
 *   折扣，减费量为 3 energy；356.4.e：折扣自带的 minimum 只约束该折扣本身（本卡未印 minimum，
 *   因此不写 minimum 字段，也不用 0 下限改写印刷费用）。
 * - 822.1 / 822.1.b / 822.1.c / 822.2：Ambush 是被动能力关键词（可打到你有单位的战场 +
 *   此时具有 Reaction），只声明不重写（契约 3.7）。
 * - 815.1 / 815.1.b / 815.1.c / 815.2：Tank 是被动能力关键词，功能上等于"战斗伤害必须优先
 *   分配给我"；只声明不重写（契约 3.7）。括注 "(I must be assigned combat damage first.)"
 *   是 815.1.b 的提醒文本，不另写指令。
 *
 * 2026-10-17 复核：仍为 judge-required，当前缺口见 judgeReason。
 * 已有原语、关键词定义或通用适配器不代表本卡完整生产路径可执行。
 */
const abilities: Ability[] = [
  // 822.1：印刷的 [Ambush]（提醒文本是 822.1.b 的说明）。
  { kind: "keyword", keyword: "ambush" },
  // 815.1：印刷的 [Tank]（提醒文本是 815.1.b 的说明）。
  { kind: "keyword", keyword: "tank" },
  {
    // 356.2.b / 356.2.b.1：可选附加费用（3 点 XP），组件 id 供下面的减费引用。
    kind: "static",
    effect: {
      kind: "cost.additional",
      id: "poppy-defender-of-the-meek.xp-cost",
      appliesTo: "self",
      optional: true,
      stage: "optional-additional",
      payments: [{ kind: "xp", amount: { kind: "constant", value: 3 } }]
    }
  },
  {
    // 356.4 / 356.4.b：由上面的可选附加费用授予的 3 能量减费。
    // 356.4.f.1：只在该附加费用被选择时授予（grantedBy 记录该闸门）。
    kind: "static",
    effect: {
      kind: "cost.modify",
      appliesTo: "self",
      resource: "energy",
      amount: { kind: "constant", value: 3 },
      stage: "discount",
      grantedBy: "poppy-defender-of-the-meek.xp-cost"
    }
  }
];

export default {
  canonicalCardId:
    "card.hash-c54e80533d4de83be156d119811d549cd348fa8bda54774a52cd58b3c451f3cf",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "缺静态 cost.additional/cost.modify 到 Finalize optionalAdditional/discounts 的翻译（356.2.b.1/356.4），费用计划目前只消费调用方显式提供的组件。" +
    "condition.result 已合入，但本卡 grantedBy 尚无生产方用 selectedAdditional 支付决定启用 3 Energy 减费（356.4.f.1），不能无条件减费。" +
    "缺 Ambush 的 play-location-permission 与手牌来源的条件 Reaction 接线（822.1.b/822.1.c）；chain.canAct 已有 timing 查询，仍不能执行完整许可。" +
    "缺 Tank 的 continuous.combat 到战斗伤害分配器的优先级消费方（815.1.b/815.1.c）。",
  abilities,
  sourceText:
    "You may spend 3 XP as an additional cost to play me. If you do, I cost :rb_energy_3: less.\n" +
    "[Ambush] (You may play me as a [Reaction] to a battlefield where you have units.)\n" +
    "[Tank] (I must be assigned combat damage first.)"
} satisfies CardProgram;
