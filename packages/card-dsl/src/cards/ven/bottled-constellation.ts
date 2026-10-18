import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Bottled Constellation (ven-067-166) — Gear, 10 Energy, 2 Mind Power, Might
 * null (no printed Might), Mind, no tags.
 *
 * sourceText（逐字取自 packages/card-data/data/deck-catalog.json, ven-067-166）：
 *   "At the start of your Main Phase, you may kill 3 other friendly units and/or
 *    gear to score 1 point."
 *
 * 规则依据（CR v1.5）：
 * - 316.1 / 316.4："At the start of your Main Phase" 是 Main 阶段开始时点；"your" 按
 *   190.6.d 的隐含 you 取能力控制者。
 * - 383.3.a："you may" 出现在效果开头时，由控制者决定是否执行该触发能力；契约 3.9
 *   要求把被选择的指令包进 choice.optional 的 body。
 * - 355.10.c / 355.10.c.1 / 740.4.a："kill 3 other friendly units and/or gear to score
 *   1 point" 是 "[do X] to [do Y]" 形式的指令内费用，X 的部分不产生目标，用 PickSpec 表达。
 *   383.3.b 说明它出现在效果开头并紧跟 "you may"，因此被当作该触发能力的基础费用。
 * - 429.1 / 429.6："kill" 是已合入原语 effect.kill。
 * - 194.1.c / 470.1–470.3："score 1 point" 是 Gaining Points，已合入原语 effect.score。
 *
 * status = judge-required（2026-10-18 M2 复核，四处当前缺口，均为实测，不近似实现）：
 * 1. 触发时点的过滤器无法注册：卡牌写成 { event: "main-start", player: "self" }，但实测
 *    events/trigger-spec.ts 的 EVENT_PATTERN_TYPES 只列事件类名，没有 main-start，
 *    EventPipeline.registerTrigger 抛 TriggerSpecValidationError（trigger.filter.event）。
 *    空 filter 也不是替代：实测 matchesTriggerEvent({}, main-start/player B, controller A)
 *    为 true，会连对手的 Main 阶段一起订阅（"your" 的限定丢失）。
 * 2. 383.3.b 的触发前导费用没有载体：冻结的 TriggeredAbility 只有 trigger/optional/body，
 *    没有 cost 字段；实测 triggerRegistrations 产出的注册是 { cost: null, mayAtFinalize: null }，
 *    费用既不能在 Finalize 支付也不能被校验（383.3.b.1）。
 * 3. 383.3.b 要求“恰好 3 个”的边界表达不到结算：实测 effect.kill 只按 ctx.picks 逐个提交，
 *    不重验 PickSpec 的 min/max——只提供 1 个 pick（规格 min 3 / max 3）时仍返回 executed
 *    并只消灭那 1 个；chain/picks/plan.ts 的 finalizeOrderedPickPlans 对该 filter+min/max
 *    规格返回 []，没有锁定或重验通道。
 * 已合入并经 golden 用解释器 + 参考内核真实执行的部分：choice.optional 包裹、effect.kill 的
 * picks 形态（429.1/429.6）与 effect.score 的得点（194.1.c / 470.1-470.3）。
 */
const abilities: Ability[] = [
  {
    kind: "triggered",
    trigger: {
      at: "main-start",
      // 316.1/316.4："your Main Phase" 是能力控制者的 Main 阶段开始（190.6.d）。
      filter: { event: "main-start", player: "self" }
    },
    // 383.3.a 的 "you may" 在效果开头：触发本身保持非可选（由 Finalize 决定是否执行），
    // 选择通过下面的 choice.optional 表达（契约 3.9 的冻结形状）。
    optional: false,
    body: [
      {
        id: "bottled-constellation.may-kill-opt",
        op: "choice.optional",
        args: {
          prompt: {
            kind: "constant",
            value: "Kill 3 other friendly units and/or gear to score 1 point?"
          },
          body: {
            kind: "constant",
            value: [
              {
                // 355.10.c.1 / 740.4.a："[do X] to [do Y]" 的 X 是指令内费用，不产生目标，
                // 因此用 picks（非目标选择）而不是 targets；383.3.b 让它成为该触发能力的
                // 基础费用（在 Finalize 支付，付不清则不进链）。
                id: "bottled-constellation.kill-cost",
                op: "effect.kill",
                args: {
                  picks: { kind: "constant", value: "bottled-constellation.sacrificed" },
                  reason: { kind: "constant", value: "bottled-constellation" }
                },
                picks: [
                  {
                    id: "bottled-constellation.sacrificed",
                    // "3 other friendly units and/or gear"：恰好 3 个，unit 与 gear 两种
                    // 永久物类型的并集（133.4.a.2），排除本卡自身（"other"）、限本卡
                    // 控制者（740.1.a 的 friendly）。
                    options: ["dynamic:other-friendly-units-and-gear"],
                    filter: {
                      type: ["unit", "gear"],
                      controller: "self",
                      zone: "board",
                      other: true
                    },
                    min: 3,
                    max: 3,
                    selection: "any"
                  }
                ]
              },
              {
                // 194.1.c / 470.1–470.3："to score 1 point"——得点效果；link 到 kill 费用上，
                // 使未支付的费用不带来得点（359.3.e.14.a：前序链接指令被忽略时后续也被忽略）。
                id: "bottled-constellation.score",
                op: "effect.score",
                linkedTo: "bottled-constellation.kill-cost",
                args: { amount: { kind: "constant", value: 1 } }
              }
            ]
          }
        }
      }
    ]
  }
];

export default {
  canonicalCardId: "card.hash-497476b6bf664a9e54c9954d3fc830b826e1dac396852919e2a91beb9ae35129",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "四处当前缺口（2026-10-18 复核，均为实测）：(1) 触发过滤器无法注册：卡牌写 { event: \"main-start\", player: \"self\" }，" +
    "但 EVENT_PATTERN_TYPES 只列事件类名、没有 main-start，实测 EventPipeline.registerTrigger 抛 TriggerSpecValidationError；" +
    "空 filter 会连对手的 Main 阶段一起订阅（实测 matchesTriggerEvent({}, main-start/player B, controller A) 为 true），\"your\" 限定丢失。" +
    "(2) 383.3.b 的触发前导费用没有载体：冻结的 TriggeredAbility 只有 trigger/optional/body，没有 cost 字段；" +
    "实测 triggerRegistrations 产出的注册是 { cost: null, mayAtFinalize: null }，费用既不能在 Finalize 支付也无法被校验（383.3.b.1）。" +
    "(3) “恰好 3 个、不足时不能完成” 的边界表达不到结算：实测 effect.kill 只按 ctx.picks 逐个提交、不重验 PickSpec 的 min/max——" +
    "只提供 1 个 pick（规格 min 3 / max 3）时仍返回 executed 并只消灭那 1 个；finalizeOrderedPickPlans 对该 filter+min/max 规格返回 []" +
    "，没有锁定或重验通道。(4) 触发链上的 choice.optional 不是注册 op（实测 instructionDefinitionsById.has('choice.optional') 为 false），" +
    "计划边界只能由解释器内建分支处理。" +
    "已合入并由 golden 真实执行的部分：choice.optional 包裹、355.10.c.1 的非目标 pick、effect.kill 与 effect.score。不近似实现。",
  abilities,
  sourceText:
    "At the start of your Main Phase, you may kill 3 other friendly units and/or gear to score 1 point."
} satisfies CardProgram;
