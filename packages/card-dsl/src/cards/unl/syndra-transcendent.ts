import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Syndra, Transcendent (unl-146-219) — Unit, Chaos, tags Ionia/Syndra/Champion.
 * energy 6, power 1, Might 6.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, unl-146-219，逐字）：
 *   While I'm in a showdown, your spells have [Repeat] :rb_energy_2::rb_rune_chaos:.
 *   (You may pay the additional cost to repeat the spell's effect.)
 *
 * 规则依据（CR v1.5）：
 * - 820.1 / 820.1.a / 820.1.b / 820.1.c：Repeat 是出现在 Spells 与 Abilities 上的可选附加费用关键词，
 *   印刷格式 "Repeat [Cost]"。本卡不持有 Repeat 实例，而是把它**授予**“你的咒语”——
 *   这是持续被动能力（364.1/364.2 的陈述句被动能力），在 479.3 的能力层生效。
 * - 820.1.c.1：Repeat 的费用在打出该咒语时支付；被授予的实例必须带上印刷费用 2 Energy + 1 Chaos。
 * - 308 / 310.3 / 310.4：“While I'm in a showdown” 指回合处于 Showdown State（含 Combat Showdown）；
 *   这是授予的适用条件（364.3 条件式被动能力）。
 *
 * status = judge-required（缺口不近似实现）：
 * - “在 showdown 中”没有可求值谓词：回合状态（308/310.3/310.4）不是 ObjectSnapshot 特征，
 *   也没有 condition.predicate 的消费方；卡内以 expression 常量 "in-showdown" 记录该谓词意图。
 * - 向其他对象（你的咒语）授予关键词没有合并路径：continuous.grant-keyword 没有图层消费方
 *   （契约 3.7 的 ability 层，RIFT-91），卡牌程序的 static 能力也没有注册入口。
 * - 被授予的 Repeat 需要携带印刷费用（820.1.c），而契约 3.1 的 KeywordAbility 只有 keyword/value；
 *   契约 3.8.3 的 params.cost 通道（KeywordDef.expand 的 cost 参数）没有卡牌侧承载形式，
 *   repeat.cost 的消费方与 cost.additional / cost.pay（RIFT-89 / RIFT-261）也未接线。
 * 依赖：RIFT-91（layers 的 ability 层与卡牌 static 注册）、RIFT-89/261（Repeat 附加费用）、
 * 以及 showdown 回合状态谓词（引擎批 4/5 的回合状态读取）。
 */
const abilities: Ability[] = [
  {
    kind: "static",
    effect: {
      kind: "continuous.grant-keyword",
      keyword: "repeat",
      // 820.1.c：Repeat 的费用是印刷数据（2 Energy + 1 Chaos）。
      // 承载通道应为 KeywordDef.expand 的 params.cost（契约 3.8.3），卡牌侧尚无冻结拼写；
      // 此处按 CostSpec 兼容形状记录意图，不把它写成 Syndra 自己的 keyword 能力。
      cost: {
        energy: { kind: "constant", value: 2 },
        power: { kind: "constant", value: ["Chaos"] }
      },
      filter: {
        // “your spells”：由本能力控制者控制的咒语对象（479.3 的能力层作用域）。
        type: "spell",
        controller: "controller"
      }
    },
    // “While I'm in a showdown” 的谓词占位（见 judgeReason）。
    condition: { kind: "expression", value: { kind: "constant", value: "in-showdown" } }
  }
];

export default {
  canonicalCardId:
    "card.hash-812a92a6459d7a30a0de5b9264ef8419c9504f128861e5de699812cd91d96ffc",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "「While I'm in a showdown, your spells have [Repeat] :rb_energy_2::rb_rune_chaos:」不可执行，三处缺口：" +
    "(1) 没有「在 showdown 中」的可求值谓词——308/310.3/310.4 的回合状态不是 ObjectSnapshot 特征，" +
    "Condition 也没有读取它的形态（卡内以 expression 常量 \"in-showdown\" 记录意图，不写成恒真条件）；" +
    "(2) 向其他对象（你的咒语）授予关键词没有合并路径：continuous.grant-keyword 没有图层消费方" +
    "（契约 3.7 的 ability 层，RIFT-91），卡牌 static 能力也没有注册入口；" +
    "(3) 被授予的 Repeat 实例要携带印刷费用（820.1.c），而 IR 的 KeywordAbility 只有 keyword/value 两个字段，" +
    "契约 3.8.3 的 params.cost 通道在卡牌侧没有承载形式，repeat.cost 的消费方与 " +
    "cost.additional/cost.pay（RIFT-89/RIFT-261）也未接线。" +
    "依赖：RIFT-91、RIFT-89/261 与 showdown 回合状态谓词；不近似实现（不把授予写成 Syndra 自己的关键词，" +
    "也不把 Showdown 条件省略成无条件授予）。",
  abilities,
  sourceText:
    "While I'm in a showdown, your spells have [Repeat] :rb_energy_2::rb_rune_chaos:. " +
    "(You may pay the additional cost to repeat the spell's effect.)"
} satisfies CardProgram;
