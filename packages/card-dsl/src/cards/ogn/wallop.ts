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
 *   declares that optional spend-buff payment, using the merged cost planner's
 *   input vocabulary (RIFT-89 optionalAdditional plus its spend-buff payment
 *   kind).
 * - "If you do, ignore this spell's cost" is a base cost modification applied
 *   at Finalize (356.1.b.1: ignoring the cost sets the base Energy/Power
 *   components to 0; 356.1.b.3: later additional costs would still apply). It
 *   is declared the way the merged corpus declares cost rewrites (a static
 *   continuous.cost-modification ability; see sfd/production-surge.ts), with
 *   the decision it depends on named in its "when" field. Two dependencies are
 *   missing, so the card is judge-required:
 *   - nothing consumes a CardProgram ability's cost: buildCostPlan receives its
 *     discounts/modifications from the caller (baseModifications is a caller
 *     input; the planner's ignore-base modification kind is reachable only that
 *     way), nothing turns the static continuous.cost-modification ability into a
 *     baseModifications entry (no continuous.cost-modification consumer exists in
 *     engine-core), and effects/instructions has no cost.additional / cost.modify
 *     primitive at all (the merged registry has no cost.* entry), so the
 *     "if you do" rewrite is not wired from card data;
 *   - the decision happens at Finalize while the effect resolves later, and
 *     the frozen Condition/Expr vocabulary (contract 3.2/3.6) has no form that
 *     reads "was this optional additional cost paid" from the cost receipt.
 * - "Ready a unit." is ordinary targeting of a unit on the board (355.9.a.1)
 *   and uses the merged effect.ready primitive; the golden test executes it.
 */
const wallop = {
  canonicalCardId: "card.hash-d17776003a48b0ee24115e1938482e85fa10ac7c582b993ca9d4b891b3dd1d48",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "「As you play this, you may spend a buff as an additional cost. If you do, ignore this spell's cost.」" +
    "是 Finalize 阶段的可选追加费用 + 基础费用改写（355.1.a、356.2.b、356.1.b.1、356.1.b.3、356.4.f.1、702.2.b），" +
    "两条依赖未合入：(1) 已合入的 cost/ 只提供 buildCostPlan 输入（optionalAdditional 与 spend-buff 支付种类；" +
    "ignore-base 修改只能由调用方以 baseModifications 传入），没有任何消费者读取卡牌程序 play.cost，" +
    "也没有把静态 continuous.cost-modification 转成 baseModifications（engine-core 没有该 effect kind 的消费方），" +
    "effects/instructions 的注册表里没有任何 cost.* 原语（没有 cost.additional / cost.modify）；(2) 费用决定发生在 Finalize、效果在 Resolve，" +
    "“if you do” 的联动没有可表达的 Condition/Expr 形态（契约 3.2/3.6 没有读取费用回执的表达式）。" +
    "费用声明与 Ready a unit 已按契约数据写出；Ready a unit 半段用已合入的 effect.ready 可执行。" +
    "依赖：RIFT-257（CardProgram 费用绑定）与 RIFT-261（cost.pay / cost.modify）。",
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

