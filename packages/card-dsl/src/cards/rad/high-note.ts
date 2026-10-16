import type { CardProgram } from "../../ir/index.js";

/**
 * rad-048-167 High Note (Spell, 3 energy, Mind).
 *
 * Catalog evidence (packages/card-data/data/deck-catalog.json,
 * dataVersion 2026-10-12-official-gallery, printing rad-048-167):
 * energy 3, power null, might null, domains ["Mind"], tags [].
 * `power: null` means there is no printed power, so the play cost declares
 * energy only and never turns the missing power into 0.
 *
 * Printed text (verbatim, sourceText):
 *   "[Reaction] (Play any time, even before spells and abilities resolve.)
 *    Give a unit –:rb_might: this turn equal to the number of exhausted units
 *    you control."
 *
 * Rules reading (CR v1.5):
 * - [Reaction] (813) is declared as a keyword ability; its timing expansion
 *   (Reaction.ts + chain admission) belongs to the keyword registry and chain.
 * - "Give a unit –:rb_might: this turn" is a temporary Might modification with
 *   an end-of-turn duration, i.e. the layers arithmetic effect
 *   (continuous.might, contract 3.4/3.6). It is not a Buff counter (702).
 * - The amount "equal to the number of exhausted units you control" is read
 *   when the effect resolves (contract 3.6: the value is evaluated at call
 *   time); `states: "exhausted"` is the exhausted condition of 415.2.
 * - "a unit" is a target (355.9.b/355.10: the instruction chooses one unit and
 *   no exception applies), so it is a TargetSpec, not a pick.
 *
 * Status: judge-required. Missing implementation: no merged instruction
 * performs a temporary Might modification. `effect.buff` only adds/removes
 * CR 702 Buff counters and explicitly leaves temporary Might changes to
 * `continuous.might`; the layers consumer is unmerged (RIFT-91), so the
 * instruction below uses the descriptive op `continuous.might`.
 */
export default {
  canonicalCardId: "card.hash-94a6c9fbd1c07987c118b3c37993744abe6442237b9355dfa3faf6771ca2da54",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "缺临时 Might 修正的已合入原语：“Give a unit –:rb_might: this turn”需要带 end-of-turn 期限的 " +
    "continuous.might（图层 arithmetic，契约 3.4/3.6）；effect.buff 只处理 CR 702 的 Buff 计数，不能代替 " +
    "Might 值修正，layers 消费者未合入（依赖 RIFT-91）。数值“你控制的已横置单位数”按 415.2 以结算时 " +
    "count 查询（states: exhausted）取值，但该持续效果当前无法执行。不近似实现。",
  abilities: [
    { kind: "keyword", keyword: "reaction" },
    {
      kind: "play",
      cost: {
        kind: "cost.printed",
        energy: { kind: "constant", value: 3 }
      },
      body: [
        {
          // "Give a unit –Might this turn equal to the number of exhausted
          // units you control": one negative temporary Might modification.
          // The negated count is evaluated at resolution time (contract 3.6).
          id: "high-note.give-minus-might",
          op: "continuous.might",
          args: {
            amount: {
              kind: "arithmetic",
              operator: "neg",
              operands: [
                {
                  kind: "count",
                  subject: "exhausted-units-you-control",
                  filter: { type: "unit", controller: "you", states: "exhausted" }
                }
              ]
            },
            duration: { kind: "constant", value: "this-turn" }
          },
          targets: [
            {
              id: "unit",
              filter: { type: "unit", zone: "board" },
              min: 1,
              max: 1,
              selection: "one"
            }
          ]
        }
      ]
    }
  ],
  sourceText:
    "[Reaction] (Play any time, even before spells and abilities resolve.)\n" +
    "Give a unit –:rb_might: this turn equal to the number of exhausted units you control."
} satisfies CardProgram;
