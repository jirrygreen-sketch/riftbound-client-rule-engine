import type { CardProgram } from "../../ir/index.js";

/**
 * Jinx, Rebel (ogn-202-298), CR v1.5 423.1.b / 416 / 317.2.c.
 *
 * 复核（2026-10-17，第三轮 M2 覆盖率复核）：
 * - 触发订阅已可用：RIFT-257 的 programs/ 绑定（registry → 触发器注册 → 生命周期接线）
 *   已合入，`at: "card-discarded"`（events/timing-points.ts，ruleRefs 423.1/423.1.b/423.3/423.4）
 *   是封闭时点 id。
 * - 过滤词表：契约 3.1 的 EventPattern 不能写 card-discarded——EVENT_PATTERN_TYPES
 *   （events/trigger-spec.ts）没有该判别值，`{ event: "card-discarded", player: … }` 会被
 *   assertTriggerSpec 以 invalid-event-type 拒绝，整个程序无法注册。该时点的等价写法是
 *   ObjectFilter 的玩家过滤：弃牌把牌从「执行弃牌的那个玩家的手牌」移入其 Trash
 *   （423.1.a / effect.discard 的 handRefs 只接受 owner === player 的手牌），故手牌控制者
 *   即弃牌者，`{ controller: "self" }` 精确命中本牌控制者弃置的牌；已实测注册成功。
 * - 本体：effect.ready（416.1.b）与 continuous.might（arithmetic 层 + end-of-turn 期限，
 *   317.2.c）均已在解释器真实执行（见 golden）。
 * - 仍缺：「one or more cards」的**弃牌批次**语义。effect.discard 对每张牌提交一次独立
 *   discard GameAction（423.1.b 之后逐个发出 card-discarded），events/action-adapter.ts 也
 *   不填 timing-points.ts 载荷里声明的 batchId（全仓库无 batchId 生产方），TriggerSpec.once
 *   的封闭作用域（TRIGGER_ONCE_SCOPES）没有 per-batch。实测：一条「discard 2」指令发出 2 个
 *   card-discarded 时点、收集到 2 个触发条目（同一次结算内第二条还会因 continuous.might 的
 *   注册 id 重复而抛 “Continuous effect already registered”）。用 per-turn 去重是错的
 *   ——同一回合内两次独立弃牌必须各触发一次。不近似实现。
 */
const jinxRebel = {
  canonicalCardId: "card.hash-059595a3565959bb085347df8707eaf005ac8c9d516ca7e8cb0802a873d37ab6",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "缺口是弃牌批次聚合：（1）effect.discard 按每张牌提交一次 discard GameAction（423.1.b），" +
    "events/action-adapter.ts 对每个动作各发一个 card-discarded 且不填 timing-points.ts 载荷声明的 batchId" +
    "（全仓库无 batchId 生产方），TriggerSpec.once 的封闭作用域没有 per-batch；" +
    "实测一条 discard-2 指令产生 2 个触发条目，同一次结算内第二条还因 continuous.might 注册 id 重复抛错。" +
    "不能用 per-turn 去重替代（同回合两次独立弃牌必须各触发一次）。" +
    "已合入并真实执行：programs/ 触发器绑定（RIFT-257）、effect.ready（416.1.b）、continuous.might" +
    "（RIFT-258，arithmetic 层 + end-of-turn，317.2.c）；触发过滤用该时点的等价 ObjectFilter 写法" +
    "{ controller: \"self\" }（423.1.a：弃牌者即手牌控制者），EventPattern 的 card-discarded 判别值不在" +
    "EVENT_PATTERN_TYPES 内、会被 assertTriggerSpec 拒绝。不近似实现。",
  abilities: [
    {
      kind: "triggered",
      trigger: {
        at: "card-discarded",
        // 423.1.a：弃牌者就是从自己手牌移牌入 Trash 的玩家，故按被弃牌的控制者过滤
        // 等价于「当**你**弃牌」。card-discarded 不在 EVENT_PATTERN_TYPES（events/
        // trigger-spec.ts）里，EventPattern 写法会被 assertTriggerSpec 拒绝。
        filter: { controller: "self" }
      },
      optional: false,
      body: [
        {
          id: "jinx-rebel.ready-me",
          op: "effect.ready",
          args: {}
        },
        {
          // 「give me +1 Might this turn」— me 是能力来源自身（355.10.d：自我引用不是目标），
          // 由 continuous.might 的 appliesTo "self" 表达；end-of-turn 在 317.2.c 到期。
          id: "jinx-rebel.might-this-turn",
          op: "continuous.might",
          args: {
            amount: { kind: "constant", value: 1 },
            duration: { kind: "constant", value: "end-of-turn" },
            appliesTo: { kind: "constant", value: "self" }
          }
        }
      ]
    }
  ],
  sourceText:
    "When you discard one or more cards, ready me and give me +1 :rb_might: this turn."
} satisfies CardProgram;

export default jinxRebel;
