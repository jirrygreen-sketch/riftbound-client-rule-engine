import type { CardProgram } from "../../ir/index.js";

/**
 * Jinx, Rebel (ogn-202-298), CR v1.5 423.1.b / 416 / 317.2.c.
 * The original ready + continuous.might body executes through the interpreter.
 * programs/ can bind triggered abilities, but discard GameActions emit one
 * card-discarded timing each; no common instruction batch/frequency scope
 * combines "one or more" into one trigger. The EventPattern spelling of this
 * timing also needs a supported filter adapter. Do not use per-turn deduplication:
 * two separate discards in one turn must both trigger.
 */
const jinxRebel = {
  canonicalCardId: "card.hash-059595a3565959bb085347df8707eaf005ac8c9d516ca7e8cb0802a873d37ab6",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "「one or more cards」须按一次弃牌批次触发一次（CR 423.1.b）：action-adapter 对每个 discard GameAction" +
    "分别发出 card-discarded，事件未携带共同批次，TriggerSpec.once 无 per-batch 作用域；不能用 per-turn 替代。" +
    "当前 card-discarded EventPattern 还需事件过滤适配，或使用该 at 时点下等价的玩家过滤。" +
    "缺口是弃牌批次与触发去重；effect.ready、continuous.might 和 programs/ 绑定均已可执行。",
  abilities: [
    {
      kind: "triggered",
      trigger: {
        at: "card-discarded",
        filter: { event: "card-discarded", player: "controller" }
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
