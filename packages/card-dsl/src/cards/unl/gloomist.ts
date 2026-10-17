import type { CardProgram } from "../../ir/index.js";

/**
 * Gloomist (unl-193-219) — Legend, Calm/Chaos, tag Vex.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, unl-193-219，逐字）：
 *   When you or an ally hold, you may exhaust me to draw 1.
 *
 * 规则依据（CR v1.5）：
 * - 383.4.d / 383.4.d.1 / 383.4.d.2.b：「When you or an ally hold」是 Hold Effect；
 *   引用「执行固守的玩家」的能力在控制者完成固守时进链，时点用封闭表的 hold
 *   （events/timing-points.ts，由 scoring/ 在 Beginning 计分步骤发出，refs 315.2.b.2 /
 *   471.2 / 473.2.b）。383.4.d.2.c：固守的点数即使被否定或替代，Hold Effect 照常触发。
 * - 383.3.a / 403.1：「you may」出现在效果最开头，是触发能力自身的 Finalize 决定
 *   （拒绝则从链上移除），由 TriggeredAbility.optional 承载（契约 3.1）；契约 3.9 另要求
 *   「可以……」把被选指令包进 choice.optional 的 body，不使用 choice + linkedTo。
 * - 383.3.b / 204.3：紧跟「you may」的「exhaust me」是触发能力的基础费用
 *   （[do X] to [do Y] 的 cost within instructions），按 415.4 / 415.5 必须能完成才能
 *   把触发放进链；355.10.c.1 明确这类费用不产生目标，所以是引用来源自身的非目标选择。
 * - 414.3 / 414.1.a：「draw 1」是 effect.draw，抽牌者缺省为能力控制者（190.6.d），
 *   牌库顺序与 Burn Out（414.4 / 432）由内核拥有。
 *
 * status = judge-required（缺口不近似实现）：
 * - 「you or an ally hold」里的 ally 需要 2v2 队友模型：CR 491.8 / 491.8.e 定义队友与
 *   friendly 的范围，而合并的 TriggerSpec PlayerSelector 只有 self/opponent/any/
 *   { playerId }（events/trigger-spec.ts），引擎没有任何 teammate/ally 概念，无法表达
 *   「队友固守」；只写 player: "self" 会把触发收窄成「你固守」。本程序保留该收窄形状
 *   作可审查的声明，不宣称已覆盖原文。
 * - 「exhaust me」的基础费用语义没有接线：契约 3.1 的 TriggeredAbility 没有 cost 槽位，
 *   用 effect.exhaust 的状态改变代替费用会漏掉 415.4 / 415.5 的「费用必须能完成」与
 *   415.1.b 的「已横置的对象不能被再次横置」这类 Finalize 检查（与已合入的
 *   unl/piltover-enforcer.ts、rad/exemplar-of-demacia.ts、ogn/the-boss.ts 同一口径）。
 * - 「me」是 Legend Zone 中的传奇（CR 107.4.a / 107.4.c）：契约 ZoneId 没有 legend-zone，
 *   而 cost/payment.ts 的 exhaust 费用只接受 board / rune-zone 的支付对象，传奇自身
 *   无法作为可横置的费用对象（effect.exhaust.ts 文件头记录同一契约缺口）。
 * draw 1、hold 时点与解释器路径已合入，golden 用参考内核真实执行已支持部分。
 *
 * 依赖：2v2 队友模型、TriggeredAbility 基础费用字段与契约补充 legend-zone。
 */
export default {
  canonicalCardId:
    "card.hash-d4c1740a3cac0cbe0b049d4705dd1cf67e9d7b241433c1fcfd3afc3288bd7084",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "三处缺口，均不近似实现：(1)「you or an ally hold」的 ally 需要 2v2 队友模型——CR 491.8 / 491.8.e 定义队友与 friendly 的范围，" +
    "而合并的 TriggerSpec PlayerSelector 只有 self/opponent/any/{playerId}（events/trigger-spec.ts），引擎没有 teammate/ally 概念，" +
    "无法表达「队友固守」这一触发条件；只写 player: \"self\" 会把触发收窄成「你固守」，本程序保留该收窄形状作可审查声明。" +
    "(2)「you may exhaust me」按 CR 383.3.b / 204.3 是触发能力的基础费用（紧跟效果开头的 you may），契约 3.1 的 TriggeredAbility 没有 cost 槽位；" +
    "用 effect.exhaust 的状态改变代替费用会漏掉 415.4 / 415.5「费用必须能完成」与 415.1.b「已横置不能再次横置」的 Finalize 检查。" +
    "(3)「me」是 Legend Zone 中的传奇（CR 107.4.a / 107.4.c），契约 ZoneId 没有 legend-zone，cost/payment.ts 的 exhaust 费用只接受 board / rune-zone，" +
    "传奇自身无法作为可横置的费用对象。hold 时点、effect.draw 与解释器路径已合入并有执行测试。" +
    "依赖：2v2 队友模型、TriggeredAbility 基础费用字段与契约补充 legend-zone。",
  abilities: [
    {
      kind: "triggered",
      trigger: {
        at: "hold",
        // 383.4.d.2.b：「引用执行固守的玩家」的 Hold Effect；ally 部分见 judgeReason。
        filter: { event: "hold", player: "self" }
      },
      // 383.3.a / 403.1：效果开头的「you may」是触发自身的 Finalize 决定。
      optional: true,
      body: [
        {
          // 契约 3.9：把被选指令包进 choice.optional 的 body。
          id: "gloomist.may",
          op: "choice.optional",
          args: {
            prompt: { kind: "constant", value: "Exhaust me to draw 1?" },
            body: {
              kind: "constant",
              value: [
                {
                  // 383.3.b 的基础费用形状：非目标地指向来源自身（355.10.c.1 的费用不产生目标；
                  // 真实费用在 Finalize 支付，见 judgeReason）。
                  id: "gloomist.exhaust-self",
                  op: "effect.exhaust",
                  args: {
                    choose: {
                      kind: "constant",
                      value: { id: "gloomist.exhaust-self", filter: { object: "self" } }
                    }
                  }
                },
                {
                  // 「to draw 1」：只有横置完成后才执行（359.3.e.14 的链接语义）。
                  id: "gloomist.draw",
                  op: "effect.draw",
                  linkedTo: "gloomist.exhaust-self",
                  args: { amount: { kind: "constant", value: 1 } }
                }
              ]
            }
          }
        }
      ]
    }
  ],
  sourceText: "When you or an ally hold, you may exhaust me to draw 1."
} satisfies CardProgram;
