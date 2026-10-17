import type { CardProgram } from "../../ir/index.js";

/**
 * Wallop (ogn-146-298) — Spell, 2 energy, Body.
 *
 * Printed text:
 *   [Action] (Play on your turn or in showdowns.)
 *   As you play this, you may spend a buff as an additional cost. If you do,
 *   ignore this spell's cost.
 *   Ready a unit.
 *
 * Modeling notes (Core Rules v1.5):
 * - [Action] (806) is declared as a keyword ability; the keyword registry
 *   owns its expansion (contract 3.7).
 * - "As you play this, you may spend a buff as an additional cost" is a
 *   Finalize-time decision on an Optional Additional Cost (355.1.a, 356.2.b);
 *   spending the buff itself is 702.2.b (only buffs on units the spender
 *   controls, 702.2.b.1 / 702.2.b.2), and a chosen optional cost is "paid"
 *   once that decision is made (356.4.f.1). The play ability's CostSpec
 *   declares that optional spend-buff payment.
 * - "If you do, ignore this spell's cost" is a base cost modification applied
 *   at Finalize (356.1.b.1: ignoring the cost sets the base Energy/Power
 *   components to 0; 356.1.b.3: later additional costs would still apply). It
 *   is declared as a static continuous.cost-modification ability. The card
 *   remains judge-required because the play adapter rejects this additional-cost
 *   shape, static cost modifications are not collected into the play CostPlan,
 *   and the condition vocabulary has no receipt lookup for "was this optional
 *   cost paid".
 * - "Ready a unit." is ordinary targeting of a unit on the board (355.9.a.1)
 *   and uses the merged effect.ready primitive; the golden test executes it.
 */
const wallop = {
  canonicalCardId: "card.hash-d17776003a48b0ee24115e1938482e85fa10ac7c582b993ca9d4b891b3dd1d48",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "「As you play this, you may spend a buff as an additional cost. If you do, ignore this spell's cost.」" +
    "是 Finalize 阶段的可选追加费用 + 基础费用改写（355.1.a、356.2.b、356.1.b.1、356.1.b.3、356.4.f.1、702.2.b）。" +
    "当前 play adapter 会拒绝该 additional-cost 形状，静态 continuous.cost-modification 也尚未进入 play 的 CostPlan；" +
    "此外，Finalize 的可选费用回执没有可供 Condition/Expr 读取的表达式，无法可靠驱动“if you do, ignore this spell's cost”。" +
    "费用声明与 Ready a unit 已按契约数据写出；Ready a unit 半段用已合入的 effect.ready 可执行。",
  abilities: [
    { kind: "keyword", keyword: "action" },
    {
      kind: "static",
      effect: {
        kind: "continuous.cost-modification",
        resource: "resources",
        amount: { kind: "constant", value: "ignore-base" },
        appliesTo: "self",
        // 356.1.b.1: ignoring "this spell's cost" zeroes its base Energy and
        // Power; 356.1.b.3 keeps later additional costs. The rewrite is
        // conditional on the optional additional cost actually having been
        // chosen (356.4.f.1), which no Condition/Expr form can read today.
        when: {
          kind: "constant",
          value: { optionalCostPaid: "wallop.buff-payment" }
        }
      }
    },
    {
      kind: "play",
      cost: {
        kind: "additional",
        payments: [
          {
            kind: "spend-buff",
            choice: {
              id: "wallop.buff-payment",
              options: ["buff-on-a-friendly-unit"],
              min: 1,
              max: 1,
              selection: "one"
            }
          }
        ]
      },
      body: [
        {
          id: "wallop.ready-unit",
          op: "effect.ready",
          args: {
            objects: { kind: "constant", value: { kind: "target", id: "wallop.unit" } },
            amount: { kind: "constant", value: 1 }
          },
          targets: [
            {
              id: "wallop.unit",
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
    "[Action] (Play on your turn or in showdowns.)\n" +
    "As you play this, you may spend a buff as an additional cost. If you do, ignore this spell's cost.\n" +
    "Ready a unit."
} satisfies CardProgram;

export default wallop;

