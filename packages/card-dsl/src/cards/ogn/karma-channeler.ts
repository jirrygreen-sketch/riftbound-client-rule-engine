import type { CardProgram } from "../../ir/index.js";

/**
 * Karma, Channeler (ogn-235-298), CR v1.5 817 / 417 / 052 / 161.1 / 702.
 *
 * 复核（2026-10-17，第三轮 M2 覆盖率复核）：
 * - 已合入并实测：RIFT-257 的触发绑定（programs/）、RIFT-258 的 continuous.might、
 *   effect.inspect / effect.recycle 原语本体、Deathknell 无关的 buff 原语（effect.buff，
 *   702.2.a/702.3.a）与 Vision 的 Predict 子效果（用显式有序的牌库顶切片执行）。
 * - 触发过滤词表：card-recycled **不在** EVENT_PATTERN_TYPES（events/trigger-spec.ts）里，
 *   原来的 `{ event: "card-recycled", player: "self" }` 会被 assertTriggerSpec 以
 *   invalid-event-type 拒绝，整卡无法注册；该时点的等价写法是 ObjectFilter 的
 *   `{ controller: "self" }`——合并管线里 recycle 动作的 player 由被回收牌的控制者导出
 *   （events/action-adapter.ts），因此它匹配「本牌控制者的牌被回收」，已实测注册成功。
 * - 仍缺（缺口一）：「When you recycle one or more cards」的**回收批次**语义（CR 417.1）。
 *   effect.recycle 对每张牌提交一次独立 recycle GameAction，action-adapter 逐个发出
 *   card-recycled 且不填 timing-points.ts 载荷声明的 batchId（全仓库无 batchId 生产方），
 *   TriggerSpec.once 的封闭作用域没有 per-batch。已实测：一条「回收 2 张」指令发出 2 个时点。
 *   排除符文的语义由 effect.recycle 的 zone 决定（417.1.b 的 Rune 走 rune-zone/rune-deck），
 *   052/161.1 的「Runes aren't cards」不影响本卡的自由区域回收。
 * - 仍缺（缺口二）：Vision 的关键词展开（engine-core/src/effects/keywords/Vision.ts，不在本任务
 *   write scope）把入场过滤写成 `{ objectId: "self", "object.id": "self" }`，而
 *   programs/filters.ts 的 translateObjectFilter 会以 Unsupported filter field object.id 抛错，
 *   导致**整个程序**（含已可绑定的 recycle 触发）无法注册；该展开还需把 effect.inspect 的
 *   player 占位常量 "A" 换成真实控制者，并在结算期注入有序的 vision-top picks
 *   （inspect 明确要求上游提供有序 picksSpecId，RIFT-358 分支 b27d30f 未合入 HEAD）。
 */
const karmaChanneler = {
  canonicalCardId: "card.hash-65e0ab54a0954e391f643dc900a7a0faa2cd298faa850e7c436e13659498922d",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "「When you recycle one or more cards」需同一回收批次（batch）只触发一次，并排除符文（CR 417.1、052、161.1）；" +
    "effect.recycle 按每张牌提交一次 recycle GameAction，events/action-adapter.ts 各发一个 card-recycled 且不填" +
    "timing-points.ts 载荷声明的 batchId（无 batchId 生产方），TriggerSpec.once 无 per-batch 作用域；" +
    "实测一条「回收 2 张」指令发出 2 个时点。" +
    "[Vision] 的关键词展开（effects/keywords/Vision.ts）仍写 object.id=self 入场过滤，programs/filters.ts 会以" +
    "Unsupported filter field object.id 拒绝，整卡（含已可绑定的 recycle 触发）无法注册；该展开还需把" +
    "effect.inspect 的 player 常量 A 换成真实控制者，并按 817.1.c/437.1 注入结算期有序 vision-top picks" +
    "（RIFT-358 分支 b27d30f 未合入 HEAD）。" +
    "触发过滤已改用该时点的等价 ObjectFilter 写法（423.1/417.1 的 controller：self）；不近似实现。",
  sourceText:
    "[Vision] (When you play me, look at the top card of your Main Deck. You may recycle it.)\n" +
    "When you recycle one or more cards, buff a friendly unit. (If it doesn't have a buff, it gets a +1 :rb_might: buff. Runes aren't cards.)",
  abilities: [
    { kind: "keyword", keyword: "vision" },
    {
      kind: "triggered",
      trigger: {
        at: "card-recycled",
        // 417.1.a/c：回收把牌移入其**所有者**的牌库；合并管线里 recycle 动作的 player
        // 由被回收牌的控制者导出，故 controller 过滤等价于「本牌控制者回收」。
        // card-recycled 不在 EVENT_PATTERN_TYPES 里，EventPattern 写法会被拒绝。
        filter: { controller: "self" }
      },
      optional: false,
      body: [
        {
          id: "karma-channeler.buff-friendly-unit",
          op: "effect.buff",
          args: {
            mode: { kind: "constant", value: "buff" },
            target: { kind: "constant", value: "karma-channeler.friendly-unit" }
          },
          targets: [
            {
              id: "karma-channeler.friendly-unit",
              filter: { type: "unit", zone: "board", controller: "controller" },
              min: 1,
              max: 1,
              selection: "one"
            }
          ]
        }
      ]
    }
  ]
} satisfies CardProgram;

export default karmaChanneler;
