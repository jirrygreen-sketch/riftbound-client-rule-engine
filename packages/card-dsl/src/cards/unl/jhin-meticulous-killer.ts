import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Jhin, Meticulous Killer (unl-089-219) — Unit, 4 energy，无印刷力量，Might 4，Mind，
 * 标签 Jhin/Ionia/Champion。
 *
 * sourceText（packages/card-data/data/deck-catalog.json, unl-089-219，逐字）：
 *   [Vision] (When you play me, look at the top card of your Main Deck. You may
 *   recycle it.)
 *   If you've spent :rb_energy_4: or more to play a spell this turn, you may play
 *   me for :rb_rune_mind:.
 *
 * 规则依据（CR v1.5）：
 * - [Vision]（817.1.b/817.1.c）：触发能力关键词，功能等价于“When this is played, [Predict].”；
 *   卡内只声明 keyword（契约 3.1/3.7、README 第 5 节），展开归 effects/keywords/Vision.ts。
 * - “If you've spent :rb_energy_4: or more to play a spell this turn”：355.1/356.1 的
 *   替代/许可条件，位于打出许可里，读取本回合为打出一张法术实际支付的 Energy 总量
 *   （383.2.a.1 的 “if you've spent” 类条件）。
 * - “you may play me for :rb_rune_mind:”：356.1.a 规定 “play … for [Cost]” 用给定费用替换
 *   印刷费用；355.1 的许可在 Finalize 前做出选择。契约 3.1 的 play 能力没有“替代费用”字段，
 *   按 ogn/nocturne-horrifying 的先例以许可静态能力（play-for-alternate-cost）保留形状。
 *
 * status = judge-required（缺口均不近似实现）：
 * - 条件「本回合为打出法术实际支付了多少 Energy」仍无可求值路径：链侧已经把 finalized payment
 *   receipt 暴露给结算条件，但合并 IR 没有按本回合、按法术累计实际支付 Energy 的谓词或表达式；
 *   保留的 count 形状只数对象，不读取金额。
 * - 「play me for :rb_rune_mind:」的静态替代费用形状尚没有 CardProgram → CostPlan 的消费方；
 *   [Vision] 的展开已合入，但其 Predict 仍需要调用方注入有序顶牌 picks，且展开中的 player
 *   占位值必须绑定到实际控制者。
 * 依赖：费用回执/替代费用消费方、有序 picks 注入与 Vision 控制者绑定。
 */
const abilities: Ability[] = [
  // 817.1：印刷的 [Vision] 声明（展开归 keywords/Vision.ts）。
  { kind: "keyword", keyword: "vision" },
  {
    // “If you've spent [4] or more to play a spell this turn, you may play me for
    // [C].”：打出许可与替代费用（355.1 / 356.1.a）。契约 3.1 的 play 能力没有替代费用字段，
    // 用静态许可形状保留（同 ogn/nocturne-horrifying 的 cost.modify + 许可声明）；
    // 条件与费用计划的消费方均未合入（见 judgeReason）。
    kind: "static",
    effect: {
      kind: "play-for-alternate-cost",
      appliesTo: "self",
      optional: true,
      // 356.1.a：“for :rb_rune_mind:” = 1 点 Mind Power 替换印刷费用。
      cost: {
        kind: "alternate-cost",
        power: { kind: "constant", value: ["Mind"] }
      },
    },
    // 383.2.a.1 类条件：“本回合为打出法术实际支付 ≥ 4 Energy”。
    // count 表达式是保留形状（同 unl/virtuoso 的 energy-spent-on-the-played-spell），
    // 合并 IR 没有“实际支付金额”维度（见 judgeReason）。
    condition: {
      kind: "compare",
      left: {
        kind: "count",
        subject: "energy-spent-on-spells-this-turn",
        filter: { player: "controller" }
      },
      operator: "gte",
      right: { kind: "constant", value: 4 }
    }
  }
];

const program = {
  canonicalCardId:
    "card.hash-2648cb6e37ecc2bc72c247e17fe7af8e3dc29a5758f7e6f972111de8c47ee473",
  rulesetVersion: "core-1.5" as const,
  status: "judge-required" as const,
  judgeReason:
    "两处缺口，均不近似实现：(1)「If you've spent :rb_energy_4: or more to play a spell this turn」仍无可求值路径：" +
    "链侧已把 finalized payment receipt 暴露给结算条件，但合并 IR 没有按本回合、按法术累计实际支付 Energy 的谓词或表达式；" +
    "保留的 count 形状只数对象、不读取金额，因此“为打出法术实际支付了多少 Energy”仍无法求值。" +
    "(2)「you may play me for :rb_rune_mind:」的静态替代费用形状仍没有 CardProgram → CostPlan 的消费方；" +
    "本卡的静态许可（play-for-alternate-cost，1 Mind Power）只保留形状。" +
    "另外 [Vision]（817）虽已声明且 KeywordDef 已合入，但其 Predict 仍要求调用方注入有序顶牌 picks，" +
    "并把展开中的 player 占位值绑定为实际控制者。依赖：费用回执/替代费用消费方、有序 picks 注入与 Vision 控制者绑定。",
  abilities,
  sourceText:
    "[Vision] (When you play me, look at the top card of your Main Deck. You may recycle it.)\n" +
    "If you've spent :rb_energy_4: or more to play a spell this turn, you may play me for :rb_rune_mind:."
} satisfies CardProgram;

export default program;
