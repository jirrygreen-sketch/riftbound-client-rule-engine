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
 * 复核（2026-10-17，M2 覆盖率复核）：逐项对照当前源码实测，两处缺口仍成立。
 *
 * status = judge-required（缺口逐个列出，均不近似实现）：
 * 1. 383.3.b 把"kill 3 other friendly units and/or gear"定义为该触发能力的基础费用，
 *    而冻结的 TriggeredAbility 形状（card-dsl/src/ir/types.ts）只有 trigger / optional / body，
 *    没有 cost 字段（契约 3.1 只有 activated 有 cost）。chain/engine.ts 的 ChainDraft /
 *    TriggerRegistration 确实带 cost 通道，但 programs/triggers.ts 的 triggerRegistrations
 *    构造注册时不会解析前导费用，也不设置 mayAtFinalize：实测该触发的注册结果为
 *    { cost: null, mayAtFinalize: null }，因此这笔费用既不能在 Finalize 支付也不能被校验
 *    （383.3.b.1）。
 * 2. 计划的"恰好 3 个、不足时不能完成"边界表达不到结算：已注册 op 表里没有 choice.optional
 *    （实测 instructionDefinitionsById.has('choice.optional') === false），该节点由解释器的
 *    内建分支处理；更关键的是 effect.kill 只按 ctx.picks 取已锁定引用并逐个提交 kill，
 *    不重验 PickSpec 的 min/max——实测只提供 1 个 pick（规格为 min 3 / max 3）时指令仍返回
 *    executed 并只消灭那 1 个，故缺 2 个也不会失败。chain/picks/plan.ts 的 Finalize 锁定只覆盖
 *    显式 zoneSlice / linked 来源，普通 filter+min/max 的 picks 没有该重验路径。
 * 依赖：383.3.b 的触发前导费用生产/支付，以及带边界重验的结算期 PickSpec 锁定。
 * 已合入并经 golden 用解释器 + 参考内核真实执行的部分：choice.optional 包裹、
 * effect.kill 的 picks 形态（429.1/429.6）与 effect.score 的得点（194.1.c / 470.1-470.3）。
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
    "两处当前缺口，均不近似实现：(1) 383.3.b 把『kill 3 other friendly units and/or gear』定义为该触发能力的" +
    "基础费用，冻结的 TriggeredAbility 形状只有 trigger / optional / body、没有 cost 字段（契约 3.1 只有 activated 有 cost）；" +
    "chain/engine.ts 的 ChainDraft / TriggerRegistration 虽提供 cost 通道，programs/triggers.ts 的" +
    "triggerRegistrations 不解析前导费用也不设置 mayAtFinalize——实测该触发的注册结果为 { cost: null, " +
    "mayAtFinalize: null }，因此费用既不能在 Finalize 支付也无法被校验（383.3.b.1）。" +
    "(2)『恰好 3 个、不足时不能完成』的边界表达不到结算：实测效果里没有 choice.optional 的注册 op" +
    "（该节点由解释器内建分支处理），而 effect.kill 只按 ctx.picks 逐个提交 kill、不重验 PickSpec 的 min/max：" +
    "只提供 1 个 pick（规格 min 3 / max 3）时仍返回 executed 并只消灭那 1 个。chain/picks/plan.ts 的" +
    "Finalize 锁定只覆盖显式 zoneSlice / linked 来源，普通 filter+min/max 的 picks 没有该重验路径。" +
    "依赖 383.3.b 的触发前导费用生产/支付与带边界重验的结算期 PickSpec 锁定；choice.optional 包裹、" +
    "355.10.c.1 的非目标 pick、effect.kill 与 effect.score 已由 golden 真实执行。",
  abilities,
  sourceText:
    "At the start of your Main Phase, you may kill 3 other friendly units and/or gear to score 1 point."
} satisfies CardProgram;
