import type { CardProgram } from "../../ir/index.js";

/**
 * Feral Strength — sfd-034-221 (Spell, 2 energy, power null, Calm, tags []).
 *
 * Printed text (packages/card-data/data/deck-catalog.json, sfd-034-221, verbatim):
 *   [Reaction] (Play any time, even before spells and abilities resolve.)
 *   [Repeat] :rb_energy_2: (You may pay the additional cost to repeat this spell's effect.)
 *   Give a unit +2 :rb_might: this turn.
 *
 * Catalog evidence: energy 2, power null (no printed power value, never
 * rewritten to 0), might null, domains ["Calm"], tags [].
 *
 * Modeling notes (Core Rules v1.5):
 * - [Reaction] (813) is a Permissive keyword: 813.1.b grants every Action
 *   permission, 813.1.c adds Closed State play on any player's turn, and
 *   813.3 records that the keyword changes no instruction's function. The card
 *   only declares { kind: "keyword", keyword: "reaction" }; the expansion into
 *   continuous.timing belongs to effects/keywords/Reaction.ts (contract 3.7)
 *   and admission is the chain's canAct check (contract 3.5).
 * - [Repeat] (820) is an Optional Additional Cost keyword present on Spells
 *   (820.1.a). Its printed cost is 2 Energy (820.1.c, 820.1.c.1), it may be
 *   paid once for one additional execution (820.1.d, 820.1.c.3), and choices
 *   are re-made for the extra execution (820.2). The printed additional cost
 *   is retained as an additional CostSpec with a pay/decline decision. This
 *   declaration is not yet translated to the planner's optionalAdditional
 *   input; keyword expansion is owned by effects/keywords/Repeat.ts.
 * - "Give a unit +2 :rb_might: this turn": the unit is a target (355.7,
 *   355.9.a.1). The clause modifies Effective Might (143.2.a) until the
 *   end-of-turn cleanup expires every "this turn" effect simultaneously
 *   (317.2.c). effect.buff's own header states that temporary Might changes
 *   belong to the layers continuous.might path and never to Buff counters
 *   (702/703 remove/add counters). continuous.might now registers the actual
 *   arithmetic-layer effect with an end-of-turn duration.
 *
 * Status: judge-required only for Repeat integration. programs/play.ts rejects
 * its additional CostSpec instead of populating CostPlanInput.optionalAdditional.
 * The paid Repeat count and re-selection must also reach the interpreter
 * (820.1.c.1/820.1.d.1/820.2). The targeted Might effect is executed and expired
 * in the golden tests; no Buff counters substitute for it.
 */
const feralStrength = {
  canonicalCardId: "card.hash-21fa1dc89f8491be1ad8d778109c30c1266a2ee3c7b7b49e5da837edba0103ee",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "continuous.might 已合入：卡面 +2 Might 经解释器注册 arithmetic 图层，this-turn 映射为 end-of-turn（143.2.a/317.2.c），并有真实增益和到期测试。剩余是 Repeat 接线（820.1.c.1/820.1.d.1/820.2）：programs/play.ts 的 translateCost 拒绝 kind: additional 及 optional/keyword 字段，describePlay 未把本卡可选费用送入已有 CostPlanInput.optionalAdditional，也未把已付实例数接到 repeat 节点并重选目标。费用计划本身支持可选附加费用与付费回执；不能因此把卡面 Repeat 标为可执行。",
  abilities: [
    { kind: "keyword", keyword: "reaction" },
    {
      kind: "play",
      // 印刷基础费用（2 energy、无 power）由 catalog 在 Finalize 绑定；此处 cost
      // 只声明 [Repeat] 的可选附加费用（820.1.c.1）。
      cost: {
        kind: "additional",
        keyword: "repeat",
        optional: true,
        payments: [
          {
            kind: "energy",
            amount: { kind: "constant", value: 2 },
            choice: {
              id: "feral-strength.repeat-payment",
              options: ["pay", "decline"],
              selection: "one"
            }
          }
        ]
      },
      body: [
        {
          // "Give a unit +2 Might this turn" — layers continuous.might 形状；
          // TargetSpec locks the chosen unit; the opcode reads that target.
          id: "feral-strength.give-plus-2-might",
          op: "continuous.might",
          args: {
            objects: { kind: "constant", value: { kind: "target", id: "feral-strength.unit" } },
            amount: { kind: "constant", value: 2 },
            duration: { kind: "constant", value: "this-turn" }
          },
          targets: [
            {
              id: "feral-strength.unit",
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
    "[Repeat] :rb_energy_2: (You may pay the additional cost to repeat this spell's effect.)\n" +
    "Give a unit +2 :rb_might: this turn."
} satisfies CardProgram;

export default feralStrength;
