import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Dune Devourer — rad-125-167 (Unit, Body, 4 Energy, no printed Power, 4 Might).
 *
 * Printed text:
 *   You may kill a friendly unit as an additional cost to play me. If you do,
 *   I cost :rb_energy_2: less.
 *   [Deflect] (Opponents must pay :rb_rune_rainbow: to choose me with a spell or
 *   ability.)
 *
 * 规则依据（CR v1.5）：
 * - 356.2.b / 356.2.b.1："You may kill a friendly unit as an additional cost"
 *   是可选附加费用；355.10.c 明确这类费用中的对象不是目标，因此用 PickSpec
 *   （非目标选择）而不是 TargetSpec。
 * - 356.4.d / 356.4.f.1："If you do, I cost [2] less" 是总费用折扣，且 356.4.f.1
 *   把"已支付"定义为玩家做出了支付决定（与实付多少无关）。
 * - 809.1.c：Deflect 的功能文本是"对手以我为目标时要多支付 1 点任意域 Power"；
 *   按 README 第 5 节只声明关键词，展开归 effects/keywords/Deflect.ts。
 *
 * status = judge-required（2026-10-18 逐条实测）：
 * 1. 卡牌程序→费用计划仍无绑定：programs/play.ts 的 translateCost 对 play 费用实测抛
 *    "Unsupported play cost field optional"，本卡声明到不了 Finalize。
 * 2. 已合入的收集器（cost/discounts/collect.ts）确实能做"Finalize 时的非目标费用选择"
 *    ——它会用 ctx.picks/ctx.choose 解析 PickSpec，golden 实测友方单位在支付后进入 Trash；
 *    但"If you do, I cost [2] less"这一半仍不可表达：appliesTo
 *    "optional-additional-costs-you-pay" 只把折扣作用在该可选组件的费用上（实测该组件为 0
 *   能量时折扣被夹到 0、总价不变），而印刷文本减的是总费用（356.4.d）；不带门槛的总费用折扣
 *    会在玩家拒绝支付时照样生效（实测拒绝后总价仍 4→2），描述性的 when/condition 又被拒绝
 *    （实测 "Descriptive cost predicates require an authoritative condition adapter" /
 *    "Unsupported cost condition undefined"）。"已支付决定"没有可求值的回执谓词。
 * 3. [Deflect]：target.tax 规划器与 TargetTaxCostAdapter 已合入（golden 用真实费用
 *    计划验证任意域 Power），但 programs/statics.ts 的 layerFor 仍无 target.tax 映射
 *    （实测 "Static ability kind target.tax has no layer mapping"），chain/engine.ts 的
 *    Finalize 也仍把税额写成 Energy mandatoryAdditional，[A] 税没有生产入口。
 */
const abilities: Ability[] = [
  { kind: "keyword", keyword: "deflect" },
  {
    kind: "play",
    cost: {
      kind: "additional",
      optional: true,
      // "You may kill a friendly unit": 355.10.c —— 附加费用中的对象不是目标。
      payments: [
        {
          kind: "kill",
          choice: {
            id: "dune-devourer.friendly-unit",
            options: ["friendly-unit-you-control"],
            min: 1,
            max: 1,
            selection: "one",
            filter: { zone: "board", type: "unit", controller: "controller" }
          }
        }
      ]
    },
    body: []
  },
  {
    kind: "static",
    effect: {
      kind: "continuous.cost-modification",
      resource: "energy",
      appliesTo: "self",
      amount: { kind: "constant", value: -2 }
    },
    condition: {
      kind: "expression",
      value: { kind: "constant", value: "optional-additional-cost-paid:kill-a-friendly-unit" }
    }
  }
];

const program = {
  canonicalCardId: "card.hash-f33da6b768e700ee188122bbd6f6aad4f17db64d49c416a3c437ddb6d98ad07b",
  rulesetVersion: "core-1.5" as const,
  status: "judge-required" as const,
  judgeReason:
    "2026-10-18 逐条实测，三处仍缺（均不近似实现）：" +
    "(1) 卡牌程序→费用计划没有绑定：programs/play.ts 的 translateCost 对 play 费用实测抛 " +
    "\"Unsupported play cost field optional\"，本卡声明永远到不了 Finalize。" +
    "(2) 总费用折扣的门槛不可表达：已合入的 cost/discounts/collect.ts 能解析 PickSpec 的非目标选择" +
    "（golden 实测友方单位支付后被消灭），但 appliesTo \"optional-additional-costs-you-pay\" 只减该可选组件" +
    "（实测组件 0 能量时折扣夹到 0、总价不变），而印刷文本减的是总费用（356.4.d）；" +
    "无门槛的总费用折扣在玩家拒绝支付时也照样生效（实测拒绝后仍 4→2），描述性 when/condition 被拒绝" +
    "（实测 \"Descriptive cost predicates require an authoritative condition adapter\"、" +
    "\"Unsupported cost condition undefined\"），356.4.f.1 的\"已支付决定\"没有回执谓词。" +
    "(3) [Deflect]：target.tax 与 TargetTaxCostAdapter 已合入并能在真实费用计划上产出任意域 Power 税" +
    "（golden 有执行证据），但 programs/statics.ts 的 layerFor 仍无 target.tax 映射" +
    "（实测 \"Static ability kind target.tax has no layer mapping\"），chain/engine.ts 的 Finalize " +
    "也仍把税额写成 Energy mandatoryAdditional（实测同一 binder 也拒绝本卡 continuous.cost-modification）。",
  abilities,
  sourceText:
    "You may kill a friendly unit as an additional cost to play me. If you do, I cost :rb_energy_2: less.\n" +
    "[Deflect] (Opponents must pay :rb_rune_rainbow: to choose me with a spell or ability.)"
} satisfies CardProgram;

export default program;
