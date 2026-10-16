import type { CardProgram } from "../../ir/index.js";

/**
 * Karma, Channeler (ogn-235-298) - Unit, Order, Karma/Ionia/Champion (M2 unit shard 12).
 *
 * sourceText (packages/card-data/data/deck-catalog.json, ogn-235-298):
 *   [Vision] (When you play me, look at the top card of your Main Deck. You may
 *   recycle it.)
 *   When you recycle one or more cards, buff a friendly unit. (If it doesn't have
 *   a buff, it gets a +1 :rb_might: buff. Runes aren't cards.)
 *
 * 规则依据（CR v1.5）：
 * - 817.1 / 817.1.b / 817.1.c：Vision 是触发式能力关键词，功能上等同 "When this is
 *   played, [Predict]"，触发条件是本永久物进入 Board；展开由 keywords/Vision.ts 负责。
 * - 437.1 / 437.3 / 437.3.a：Predict = 看牌库顶一张并选择是否回收它（未写数量按 1）。
 * - 417.1 / 417.1.a / 417.4：Recycle 把牌放回牌库；作为效果时尽可能回收。
 * - 185.1 / 185.2 / 185.3（"(Runes aren't cards.)" 提醒）：符文不是 card，回收符文不满足
 *   "recycle one or more cards"。
 * - 702.2.a / 702.3.a / 427.1.c："buff a friendly unit" 用 effect.buff 的 buff 模式；
 *   已有 buff 的单位不会被再次放置（702.3.a）。
 * - 355.9.a.1 / 355.10："a friendly unit" 是目标（controller 限制），不是集合查询。
 *
 * status: judge-required —— 两处依赖未合入，均不近似实现：
 * 1. [Vision] 的 Predict 步骤不可执行：合并的 effect.inspect 明确阻断非零 top 范围
 *    （其文件头："非零 top 查看须由上游提供有序 picksSpecId；缺少时明确阻断
 *    negated/impossible"），即牌库顺序的有序选择契约尚未提供；
 * 2. "When you recycle one or more cards" 需要回收事件的批次语义与 "(Runes aren't cards.)"
 *    的区域过滤（417.1/417.5、185.1）：现有 card-recycled 载荷按每张牌一次动作发出，且没有
 *    "one or more cards 为一次" 的分组谓词；写成普通 trigger filter 会变成"每回收一张触发一次"，
 *    属近似实现。此外 events/trigger-spec.ts 的封闭 EVENT_PATTERN_TYPES 没有 card-recycled 项，
 *    assertTriggerSpec 会直接拒绝本卡声明的事件名（见 golden 测试），故该触发当前无法注册。
 * "buff a friendly unit" 本身用已合入的 effect.buff，在 golden 测试里真实执行。
 */
const karmaChanneler = {
  canonicalCardId: "card.hash-65e0ab54a0954e391f643dc900a7a0faa2cd298faa850e7c436e13659498922d",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "[Vision] 的 Predict（437.1/437.3）依赖 effect.inspect 的有序 top 查看：合并实现明确要求上游提供有序 " +
    "picksSpecId，否则 negated/impossible（牌库顺序契约缺口），故 Vision 展开当前不可执行；" +
    "「When you recycle one or more cards」需要回收事件的批次语义与「Runes aren't cards」的区域过滤" +
    "（417.1/417.5、185.1）：现有 card-recycled 载荷按每张牌一次动作发出且无「one or more cards 为一次」的谓词，" +
    "写成普通 trigger filter 会变成每张牌触发一次；" +
    "且 events/trigger-spec.ts 的封闭 EVENT_PATTERN_TYPES 无 card-recycled 项，assertTriggerSpec 会拒绝本触发的事件名，" +
    "该触发当前无法注册。" +
    "依赖：effect.inspect 的有序 top/picks 上游（RIFT-64 遗留契约缺口）、回收事件批次语义与事件名枚举（events/）。",
  sourceText:
    "[Vision] (When you play me, look at the top card of your Main Deck. You may recycle it.)\n" +
    "When you recycle one or more cards, buff a friendly unit. (If it doesn't have a buff, it gets a +1 :rb_might: buff. Runes aren't cards.)",
  abilities: [
    { kind: "keyword", keyword: "vision" },
    {
      kind: "triggered",
      trigger: {
        at: "card-recycled",
        filter: { event: "card-recycled", player: "self" }
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
