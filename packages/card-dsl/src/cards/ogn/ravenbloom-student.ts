import type { CardProgram } from "../../ir/index.js";

/**
 * Ravenbloom Student (ogn-103-298) — Unit, 2 energy, 2 Might, Mind, Noxus.
 *
 * Printed text: "When you play a spell, give me +1 :rb_might: this turn."
 *
 * Status: judge-required.
 * - "give me +1 [M] this turn" is a temporary Might modification. The closed
 *   GameAction set (contract 3.6) contains no might-modification action, and
 *   effect.buff documents that temporary Might changes "belong to
 *   continuous.might, never to this primitive"; the layers batch (RIFT-91)
 *   owns the end-of-turn expiry under 317.1.a / 478. Not approximated with a
 *   Buff counter (703), which is an object, not a Might change.
 * - The trigger itself is expressible: the card-played timing point (383.4.a)
 *   filtered to a spell played by this ability's controller ("you play a
 *   spell"), with no target — "me" is the ability source. It is kept as data so
 *   downstream tooling can see the shape; the Might grant is judged.
 */
export default {
  canonicalCardId: "card.hash-1e9496baf34c0f775ffe94233c00bca385044ae51ac57ce745999144f3493a9d",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "缺临时 Might 修正原语：契约 3.6 的封闭 GameAction 集合没有 might 修改动作，effect.buff 文档明确临时 Might 改变属于 " +
    "continuous.might（图层系统未合入，依赖 RIFT-91）并需按 317.1.a 在回合结束时到期；" +
    "不得用 Buff 标记或改写印刷数值近似。触发本身（card-played 过滤 spell、player 为控制者、无目标）可用字段表达。不近似实现。",
  abilities: [
    {
      kind: "triggered",
      trigger: {
        at: "card-played",
        filter: {
          event: "card-played",
          object: { type: "spell" },
          player: "self"
        }
      },
      optional: false,
      body: [
        {
          id: "ravenbloom-student.give-plus-1",
          op: "continuous.might",
          args: {
            amount: { kind: "constant", value: 1 },
            duration: { kind: "constant", value: "end-of-turn" },
            objects: { kind: "constant", value: { kind: "source" } }
          }
        }
      ]
    }
  ],
  sourceText: "When you play a spell, give me +1 :rb_might: this turn."
} satisfies CardProgram;
