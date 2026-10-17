import type { CardProgram } from "../../ir/index.js";

/**
 * Jinx, Rebel (ogn-202-298), CR v1.5 423.1.b / 416 / 317.2.c.
 * 当前复核：弃牌订阅、ready 与临时 Might 原语可执行；整卡仍缺弃牌批次聚合，
 * 以及同回合多次结算 continuous.might 的独立注册身份。不得用 per-turn 去重。
 */
const jinxRebel = {
  canonicalCardId: "card.hash-059595a3565959bb085347df8707eaf005ac8c9d516ca7e8cb0802a873d37ab6",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "缺弃牌批次与重复结算身份：effect.discard 按牌提交 discard，events/action-adapter.ts 逐个发出 card-discarded，" +
    "没有把同一指令的事件标成同一 batchId，TriggerSpec.once 也无 per-batch 去重（CR 423.1.b）。" +
    "一次弃两张应触发一次，同回合两次独立弃牌应各触发一次；后者还需要 continuous.might 为每次结算生成独立注册 id，" +
    "否则同源同指令再次结算会抛 Continuous effect already registered（317.2.c）。",
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
