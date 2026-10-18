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
 * status = judge-required（2026-10-18 复核）：
 * - ally 的固守触发缺 2v2 队友关系与 PlayerSelector（491.8/491.8.e）。
 * - 本卡的触发连注册都过不了：filter 写成事件名 "hold"，而封闭 EVENT_PATTERN_TYPES
 *   （events/trigger-spec.ts）只接受 "held"/"conquered"/"scored" 等拼写；实测
 *   registerProgramTriggers 抛 TriggerSpecValidationError（invalid-event-type）。
 *   改成 "held" 后 player:"self" 能按注册来源的 controller 触发（实测 A 的 hold 触发），
 *   但这只覆盖「自己固守」，无法表达 383.4.d.2.b 的「你或一个队友固守」——真实 hold 发射只有
 *   { timingPoint, player }、没有 object，PlayerSelector 也没有队友形态。
 * - programs/triggers.ts 未把前置 may/exhaust 指令转换为 TriggerRegistration 的
 *   cost / mayAtFinalize；链本身已有费用支付能力（cost 计划确实能构造出 exhaust 动作），
 *   但本卡仍在 Resolve 才横置（383.3.a/b）。
 * - game/lifecycle.ts 仅把传奇创建在 chain 并另记 legendZone 报告（实测真实对局里传奇仍是 chain 区 token），
 *   未进入真实传奇区域；触发默认仅在 board 激活，横置费用也只接受 board/rune-zone（107.4.a/c）。
 */
export default {
  canonicalCardId:
    "card.hash-d4c1740a3cac0cbe0b049d4705dd1cf67e9d7b241433c1fcfd3afc3288bd7084",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "四处当前缺口（2026-10-18 复核）：(1) ally 固守的 2v2 队友关系与 PlayerSelector（CR 491.8/491.8.e）。" +
    "(2) 触发注册本身失败：filter 用事件名 \"hold\"，封闭 EVENT_PATTERN_TYPES（events/trigger-spec.ts）只接受 \"held\" 等拼写，" +
    "实测 registerProgramTriggers 抛 TriggerSpecValidationError（invalid-event-type）。改成 \"held\" 后 player:\"self\" 能按注册来源的 controller 触发（实测 A 的 hold 触发），" +
    "但这只覆盖「自己固守」：真实 hold 发射只有 { timingPoint, player }、没有 object（实测），PlayerSelector 也没有队友形态，" +
    "无法表达 383.4.d.2.b 的「你或一个队友固守」。" +
    "(3) 前置费用的程序适配（383.3.a/383.3.b、204.3、415.4/415.5）：programs/triggers.ts 未把前置 you may/exhaust 转为 " +
    "TriggerRegistration.cost / mayAtFinalize，当前 choice.optional + effect.exhaust 在 Resolve 执行，不能代替 Finalize 的费用检查。" +
    "(4) Legend Zone 的生命周期与费用对象接线（107.4.a/107.4.c）：game/lifecycle.ts 把传奇创建在 chain，仅另记 legendZone 报告" +
    "（实测真实对局里传奇仍是 chain 区 token）；触发默认在 board 激活，cost/payment.ts 的 exhaust 也只接受 board/rune-zone。",
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
