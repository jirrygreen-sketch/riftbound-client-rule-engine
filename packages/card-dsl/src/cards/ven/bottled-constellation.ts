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
 * - 316.1 / 316.4："At the start of your Main Phase" 是 Main 阶段开始、"At the start of
 *   Main Phase game effects take place" 的时点；封闭枚举里的 main-start 由 turn/ 在
 *   Main 阶段开始时发出（events/timing-points.ts 的 ruleRefs 316.1/316.4）。
 *   "your" 按 190.6.d 的隐含 you 取能力控制者。
 * - 383.3.a："you may" 出现在效果开头时，由控制者决定是否执行该触发能力；契约 3.9
 *   要求把被选择的指令包进 choice.optional 的 body。
 * - 355.10.c / 355.10.c.1 / 740.4.a："kill 3 other friendly units and/or gear to score
 *   1 point" 是 "[do X] to [do Y]" 形式的指令内费用（costs within instructions），
 *   X 的部分不产生目标——CR 自己的例子正是 "When I hold, you may kill another friendly
 *   unit here to draw 1" 与 Detonation Amplifier 的同型写法。因此被消灭的永久物用
 *   PickSpec（非目标选择）表达，绝不用 TargetSpec。383.3.b 进一步说明：它出现在效果
 *   开头并紧跟 "you may"，因此被当作该触发能力的基础费用（Finalize 支付，代价未付清
 *   则能力不进链）；本程序按“首条指令 = 前导费用”的先例写出，触发注册由
 *   programs/triggers.ts 的 CardProgram → TriggerRegistration 入口负责。
 * - 429.1 / 429.6："kill" 是消灭动作（永久物从 Board 进入弃牌堆），已合入原语 effect.kill
 *   即该动作（"Kill [one or more permanents]" 的官方格式）。
 * - 194.1.c / 470.1–470.3："score 1 point" 是 Gaining Points，已合入原语 effect.score；
 *   194.1.c 明确由法术/触发/启动能力指示的得点走这条路径，且它不同于 Scoring a Battlefield
 *   （470.1）。Ragnarok/Conquer 类触发与 473.1 的 Final Point 都不适用。
 * - 740.1.a："other friendly" 限本卡控制者控制的永久物，并排除本卡自身；"units and/or gear"
 *   是两种永久物的并集（133.4.a.2 的类型集合写法）。
 *
 * status = judge-required（缺口逐个列出，均不近似实现）：
 * 1. 383.3.b 把"kill 3 other friendly units and/or gear"定义为该触发能力的基础费用，
 *    冻结的 TriggeredAbility 形状没有 cost 字段（契约 3.1 只有 activated 有 cost），
 *    虽然 chain/engine.ts 的 TriggerRegistration 提供 cost 通道，当前卡牌触发形状没有
 *    生产这项费用的路径，因此费用既不能在 Finalize 支付也不能被校验。
 * 2. effect.kill 用 picks 只接受"最终锁定的非目标选择"，而本条要求的"恰好 3 个、不足时不能
 *    完成"的边界由 Finalize 的 PickSpec（min 3 / max 3）表达，PickSpec 的锁定与重验仍未
 *    接入该卡的结算管线；golden 只能以调用方提供已锁定 picks 的方式执行，这不构成整卡证据。
 * 依赖：383.3.b 的触发费用生产/支付与 Finalize 的 PickSpec 锁定/重验。CardProgram →
 * TriggerRegistration 注册通道已合入；choice.optional 包裹、effect.kill 的 picks 形态与
 * effect.score 的得点由 golden 用解释器 + 参考内核真实执行。
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
    "两处缺口，均不近似实现：(1) 383.3.b 把『kill 3 other friendly units and/or gear』定义为" +
    "该触发能力的基础费用，冻结的 TriggeredAbility 形状没有 cost 字段（契约 3.1 只有 activated 有 cost）；" +
    "chain/engine.ts 的 TriggerRegistration 虽提供 cost 通道，当前卡牌触发形状没有生产这项费用的路径，" +
    "因此费用既不能在 Finalize 支付也无法被校验；" +
    "(2) 恰好 3 个的边界由 PickSpec（min 3/max 3）表达，但 PickSpec 的 Finalize 锁定与 Resolve 重验" +
    "尚未接入该卡的结算管线，golden 只能以调用方提供已锁定 picks 的方式执行，不构成整卡证据。" +
    "依赖 383.3.b 的触发费用生产/支付与 Finalize 的 PickSpec 锁定/重验；" +
    "CardProgram → TriggerRegistration 注册通道已合入，355.10.c.1 的非目标 pick、effect.kill、effect.score " +
    "已由 golden 真实执行。",
  abilities,
  sourceText:
    "At the start of your Main Phase, you may kill 3 other friendly units and/or gear to score 1 point."
} satisfies CardProgram;
