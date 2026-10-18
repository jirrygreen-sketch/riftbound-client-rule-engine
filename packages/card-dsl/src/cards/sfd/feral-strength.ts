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
 * Status: judge-required（2026-10-18 逐条对源码复核）. The targeted Might effect is
 * executed and expired in the golden tests; no Buff counters substitute for it.
 * Two Repeat links are still missing (neither approximated):
 * - The card-declared optional additional cost never reaches Finalize:
 *   programs/play.ts's translateCost rejects `kind: "additional"` and the
 *   `optional` field with ProgramBindingError("Unsupported play cost field
 *   optional"), and no merged consumer converts a card's Repeat declaration into
 *   CostPlanInput.optionalAdditional. The planner itself does accept such a
 *   component (measured: buildCostPlan with
 *   `{ id, kind: "repeat", cost }` adds a second component and really charges
 *   it), so the missing link is the card-program → Finalize wiring, not the plan.
 * - The paid instance count never reaches resolution: KeywordDef.expand is
 *   called by programs/keywords.ts with only keyword/value/host, so the printed
 *   Repeat cost is dropped (the expanded static always carries
 *   `cost: { energy: 0 }`), and no consumer turns the printed declaration into an
 *   optionalAdditional entry whose `selected` result could drive the
 *   interpreter's repeat node. A paid/declined receipt IS readable through
 *   `condition.predicate` `result: "cost.optional-additional-paid"`, but that
 *   yields a boolean, and the merged repeat node accepts only a non-negative
 *   integer count (measured error: "Repeat count must be a non-negative safe
 *   integer"), so no card-side expression can derive 0/1 repetitions from it.
 */
const feralStrength = {
  canonicalCardId: "card.hash-21fa1dc89f8491be1ad8d778109c30c1266a2ee3c7b7b49e5da837edba0103ee",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "continuous.might 已合入：卡面 +2 Might 经解释器注册 arithmetic 图层，this-turn 映射为 end-of-turn（143.2.a/317.2.c），并有真实增益和到期测试。" +
    "剩余是两段 Repeat 接线（820.1.c.1/820.1.d.1/820.2），均不近似实现：" +
    "(1) 卡面声明的可选附加费用到不了 Finalize：programs/play.ts 的 translateCost 对 kind additional 与 optional 字段实测抛 " +
    "ProgramBindingError(\"Unsupported play cost field optional\")，也没有消费方把卡程序的 Repeat 声明转成 CostPlanInput.optionalAdditional" +
    "（费用计划本身接受该组件：实测 buildCostPlan 传入 { id, kind: \"repeat\", cost } 会追加组件并真实扣费）。" +
    "(2) 已付实例数到不了解算：programs/keywords.ts 调 KeywordDef.expand 时只传 keyword/value/host，印刷 Repeat 费用被丢弃" +
    "（展开出的静态恒为 cost: { energy: 0 }）；付费回执虽可由 condition.predicate 的 " +
    "result: \"cost.optional-additional-paid\" 读出，但那是布尔值，而解释器 repeat 节点只接受非负整数（实测 " +
    "\"Repeat count must be a non-negative safe integer\"），卡侧无法据此表达 0/1 次额外执行。" +
    "依赖：PlayAbility 可选附加费用 → Finalize 的消费者与印刷 Repeat 费用的 keyword 参数入口；" +
    "不能因此把卡面 Repeat 标为可执行。",
  abilities: [
    { kind: "keyword", keyword: "reaction" },
    // Keep the printed keyword identity; its nonnumeric cost remains on the
    // play CostSpec until the keyword parameter contract is connected.
    { kind: "keyword", keyword: "repeat" },
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
