import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Watchful Curator (rad-037-167) — Unit, 3 energy, 1 power (Calm), 4 Might, Calm.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, rad-037-167）：
 *   Your gear have [Deflect]. (Opponents must pay :rb_rune_rainbow: to choose each with a
 *   spell or ability.)
 *
 * 规则依据（CR v1.5）：
 * - 809.1 / 809.1.a：Deflect 是被动能力关键词，通常出现在 Permanents 上；809.1.b.3：印刷省略
 *   数值时按 1；809.1.c：功能文本是“对手用咒语或能力选择我时要多支付 1 点任意域力量”。
 * - 809.2：同一对象上来自多个来源的 Deflect 数值相加（Deflect Value 求和）——本句给每个
 *   友方 gear 授予 1 点，与 gear 自身可能已有的 Deflect 相加。
 * - 809.3：是否拥有 Deflect 是永久物的特征，可被其他游戏效果检查/引用。
 * - “Your gear”：由本卡控制者控制的 gear（190 的控制定义）；授予本身是持续效果（把关键词
 *   附加到对象上），归图层/持续效果（Contract 3.4 的 ability 图层，continuous.grant-keyword）。
 *
 * status = judge-required（见 judgeReason）：给“你的 gear”授予 [Deflect] 需要卡牌 static
 * 能力 → ContinuousEffectSpec → 图层注册的生产方；已合入的 continuous.grant-keyword 指令
 * （RIFT-258）能在结算期把关键词授予匹配对象（golden 用解释器 + 图层引擎真实执行，含 809.2
 * 的数值相加），但没有生产方读取本卡的 static 声明并把它注册进 layers/（RIFT-257 卡牌程序
 * 绑定仍在进行），目标税的任意域 Power 支付也属 RIFT-261。不近似实现。
 */
const abilities: Ability[] = [
  {
    kind: "static",
    effect: {
      // “Your gear have [Deflect].” — 809.1.b.3 的省略数值按 1；授予范围是本控制者的 gear。
      kind: "continuous.grant-keyword",
      layer: "ability",
      keyword: "deflect",
      value: { kind: "constant", value: 1 },
      filter: { type: "gear", controller: "controller", zone: "board" }
    }
  }
];

const program = {
  canonicalCardId:
    "card.hash-dc5774a38ed543aac39bd40a45c96e08acddedf25a91e979a8a3576715ec1a5b",
  rulesetVersion: "core-1.5" as const,
  status: "judge-required" as const,
  judgeReason:
    "缺卡牌 static 能力 → 图层的生产接线：给「你的 gear」授予 [Deflect]（809.1.b.3 省略数值按 1；809.2 与已有的 Deflect 数值相加；809.3 可被引用）" +
    "需要把 CardProgram 的 static 声明注册成 ContinuousEffectSpec 并由 ability 图层施加到匹配对象上；已合入的 continuous.grant-keyword 指令（RIFT-258）能在结算期完成该授予" +
    "（golden 用解释器 + 图层引擎真实执行，含 809.2 求和），但没有生产方把本卡的 static 能力接进 layers/（RIFT-257 卡牌程序绑定仍在进行）。" +
    "目标税的消费方（target/target-plan.ts、chain Finalize 的 taxAdapter）已存在，但没有生产者把授予物化到那张 gear 的关键词特征上；任意域 Power 支付同属 RIFT-261。故不近似实现。" +
    "golden 证明 continuous.grant-keyword 的真实执行与图层施加（可按 809.3 读取），不构成整卡执行证据。",
  abilities,
  sourceText:
    "Your gear have [Deflect]. (Opponents must pay :rb_rune_rainbow: to choose each with a spell or ability.)"
} satisfies CardProgram;

export default program;
