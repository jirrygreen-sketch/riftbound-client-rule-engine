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
 *   附加到对象上），归图层/持续效果（调研表第 3 节的 continuous.keyword 授予族）。
 *
 * status = judge-required（见 judgeReason）：给“你的 gear”授予 [Deflect] 需要图层/持续效果把
 * 关键词附加到匹配对象上；调研表把授予/移除能力或标签归到 continuous.keyword，并记录该族
 * 0/0 已实现（`docs/plans/survey/ability-templates.md` 第 3 节；同 forecaster sfd-065-221、
 * rumble-hotheaded sfd-026-221 的判定），而且没有已合入路径把 CardProgram 的 static 能力注册成
 * ContinuousEffectSpec（RIFT-91）。目标税的消费方 target-plan 已存在（tax/taxAdapter），但没有
 * 生产者把本卡的授予物化到那张 gear 的关键词特征上；golden 因此只证明声明的授予形状与已合入
 * 图层引擎对 grant-keyword 效果的实际施加（施加后可按 809.3 读取），不宣称整卡可执行。
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
    "缺关键词授予的图层消费方：给「你的 gear」授予 [Deflect]（809.1.b.3 省略数值按 1；809.2 与已有的 Deflect 数值相加；809.3 可被引用）" +
    "需要把 CardProgram 的 static 能力注册成 ContinuousEffectSpec 并在 ability 图层施加到匹配对象上；" +
    "effects/instructions 没有 continuous.keyword 一类的授予原语，调研表 ability-templates.md 第 3 节记录该族 0/0 已实现，" +
    "也没有已合入路径把卡牌 static 能力注册进 layers/（RIFT-91；同 forecaster sfd-065-221、rumble-hotheaded sfd-026-221 的判定）。" +
    "目标税的消费方（target-plan 的 tax/taxAdapter）已存在，但没有生产者把本卡的授予物化到那张 gear 的关键词特征上，故不近似实现。" +
    "golden 仅证明声明的授予形状与已合入图层引擎对 grant-keyword 效果的实际施加（可用 809.3 读取），不构成整卡执行证据。",
  abilities,
  sourceText:
    "Your gear have [Deflect]. (Opponents must pay :rb_rune_rainbow: to choose each with a spell or ability.)"
} satisfies CardProgram;

export default program;
