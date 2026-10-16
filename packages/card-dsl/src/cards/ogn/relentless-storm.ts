import type { CardProgram } from "../../ir/index.js";

/**
 * Relentless Storm (ogn-249-298) — Legend, Fury/Body, Volibear.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, ogn-249-298，逐字）：
 *   When you play a [Mighty] unit, you may exhaust me to channel 1 rune
 *   exhausted. (A unit is Mighty while it has 5+ :rb_might:.)
 *
 * 规则依据（CR v1.5）：
 * - 383.1 / 383.2.a：“When you play a [Mighty] unit” 是触发条件——时点
 *   card-played（383.4.a 打出触发），filter 取 unit 且控制者为能力控制者；
 *   “[Mighty]” 需要 Mighty 谓词（706–709：Might ≥ 5）。
 * - 383.3.a / 403.1：“you may” 出现在效果最开头，是触发能力本身是否执行的选择——
 *   控制者在 Finalize 决定，拒绝则该触发移出链；由 TriggeredAbility.optional 承载
 *   （与 fiora-worthy / grand-duelist 的既有建模一致；契约 3.9 的 choice.optional
 *   用于效果正文内部的“可以……”指令，不重复包裹整个触发效果）。
 * - 415.4 / 415.5 / 404.1.b.1："exhaust me" 是位于效果开头的 [do X] 费用；
 *   合并 IR 的触发能力没有费用字段，本卡用非目标 choose 锚定来源自身执行 effect.exhaust，
 *   成功后链接 channel（真实的“费用在 Finalize 支付、付不出则移出链”见 judgeReason）。
 * - 431.1 / 431.2："channel 1 rune exhausted" → effect.channel，amount 1、
 *   exhausted true；431.3 符文不足时尽量 channel。
 *
 * status = judge-required：
 * - 合并的解释器/事件管线没有把卡牌 TriggerSpec 里的 [Mighty] 谓词求值接进触发过滤
 *   （706–709 的 Might ≥ 5 既不是 ObjectFilter 的字段，也不是已注册的 condition.history）；
 *   chain 侧注册触发时也没有 testTrigger 适配器，"you play a [Mighty] unit" 无法真实判定。
 * - 触发式 “exhaust me” 的费用语义（415.4 / 404.1.b.1：位于效果开头的 [do X] 按费用在
 *   Finalize 支付，415.1.b/c 下已横置的来源无法支付、触发应移出链）没有接线：
 *   TriggeredAbility 无费用字段，合并管线也没有把卡牌程序里的 [do X] 转成触发费用的路径。
 * 依赖：RIFT-87/90（目标与条件管线）、RIFT-89（费用接线）。effect.channel 部分已可用，
 * golden 用解释器实际执行该子效果。
 */
const relentlessStorm = {
  canonicalCardId:
    "card.hash-8c4ee3cd2f48d5640eebc2d0ba22037c8d5e8d2054d8fa40c4255e7a75b84b36",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "缺 [Mighty] 触发谓词的求值路径：706–709 的 “Might ≥ 5” 既不是 ObjectFilter 的封闭字段，" +
    "也不是已注册的 condition.history；chain 侧注册卡牌触发（TriggerRegistration）时没有 testTrigger 适配器，" +
    "“you play a [Mighty] unit” 无法真实判定。触发效果开头 “exhaust me” 的费用语义（404.1.b.1：" +
    "费用在 Finalize 支付、不能支付则该触发移出链）也没有合并的 CostSpec/费用接线。" +
    "依赖 RIFT-87/90（条件与目标管线）与 RIFT-89（费用接线）；effect.channel 子效果已可用。",
  abilities: [
    {
      kind: "triggered",
      trigger: {
        at: "card-played",
        filter: {
          event: "card-played",
          // “you play a [Mighty] unit”：事件对象是刚打出的单位，由你控制且是 Mighty。
          // 合并内核没有 [Mighty] 谓词字段（706–709 的 Might ≥ 5），characteristics.mighty
          // 是评审用描述性标记，不是可求值语义。
          object: {
            type: "unit",
            controller: "self",
            characteristics: { mighty: true }
          }
        }
      },
      // 效果开头 “you may”：383.3.a / 403.1 使触发能力本身可选（Finalize 时决定；
      // 拒绝则该触发移出链）。TriggeredAbility.optional 承载该语义；
      // 契约 3.9 的 choice.optional 用于 effect 内部的“可以……”指令。
      optional: true,
      body: [
        {
          id: "relentless-storm.exhaust-self",
          op: "effect.exhaust",
          args: {
            // “exhaust me”：来源自身。用非目标 choose 的 filter 锚点 "self"
            // 固定唯一选项，不新增目标（355.7）；415.5 的费用语义见 judgeReason。
            choose: {
              kind: "constant",
              value: {
                id: "relentless-storm.exhaust-self",
                filter: { object: "self" }
              }
            }
          }
        },
        {
          id: "relentless-storm.channel-rune",
          op: "effect.channel",
          linkedTo: "relentless-storm.exhaust-self",
          args: {
            amount: { kind: "constant", value: 1 },
            exhausted: { kind: "constant", value: true }
          }
        }
      ]
    }
  ],
  sourceText:
    "When you play a [Mighty] unit, you may exhaust me to channel 1 rune exhausted. " +
    "(A unit is Mighty while it has 5+ :rb_might:.)"
} satisfies CardProgram;

export default relentlessStorm;
