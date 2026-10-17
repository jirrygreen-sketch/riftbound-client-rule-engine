import type { CardProgram } from "../../ir/index.js";

/**
 * Call to Glory — ogn-207-298 (Spell, Order, 3 Energy, no Power).
 *
 * Printed text (packages/card-data/data/deck-catalog.json, ogn-207-298):
 *   [Reaction] (Play any time, even before spells and abilities resolve.)
 *   As you play this, you may spend a buff as an additional cost. If you do,
 *   ignore this spell's cost.
 *   Give a unit +3 :rb_might: this turn.
 *
 * Modeling notes (Core Rules v1.5):
 * - "[Reaction]" (813) is declared as a keyword ability; the permission is
 *   expanded by the keyword registry (effects/keywords/Reaction.ts).
 * - "As you play this, you may spend a buff as an additional cost" is an
 *   Optional Additional Cost decided while playing (356.2.b / 356.2.b.1) and
 *   paid in step 4 (357.2). It is a cost, not an instruction, so it is
 *   declared on the play ability's CostSpec with an explicit pay/decline
 *   choice (the merged cost-plan shape, 356.2.b) — the same structure Frigid
 *   Touch uses for its optional [Repeat] payment. 702.2.b removes one Buff
 *   counter; 702.2.b.1 forbids spending from a unit without a buff and
 *   702.2.b.2 restricts spending to units the paying player controls. The
 *   buff's unit is not targeted (355.10.c.1, 742.1; 355.10.c's own example is
 *   "you may spend a buff to move a friendly unit"), so the payment carries a
 *   non-target pick rather than a TargetSpec.
 * - "If you do, ignore this spell's cost" is base-cost handling in step 3:
 *   356.1.b sets the appropriate Base Cost to zero, and 357.2.a records that
 *   the additional cost still counts as paid. The merged cost plan already
 *   models `ignore-base` rewrites (cost/plan-types.ts BaseCostModification)
 *   but nothing in the merged instruction set lets a card declare "pay the
 *   optional additional cost, then ignore the base cost if it was paid"; the
 *   plan for this card still needs an optional-payment/ignore-base adapter.
 * - "Give a unit +3 :rb_might: this turn" is a temporary Might modification
 *   that expires in the end-of-turn cleanup (317.2.c "3d. All 'this turn'
 *   effects expire simultaneously."; 433.1.a layer modulation). It belongs to
 *   the layers system and now uses the merged continuous.might instruction
 *   (RIFT-258: signed amount, this-turn duration, end-of-turn expiry).
 *
 * Status: judge-required. The Might half is merged and executed by the golden
 * test; what remains missing is the conditional ignore-cost rewrite: the
 * merged cost plan cannot take a runtime ObjectRef option set from static IR,
 * and no CardProgram-to-Finalize adapter generates the required plan.
 * Not approximated: no free play, no Buff-as-Might substitution.
 */
const callToGlory = {
  canonicalCardId: "card.hash-9eef9a0508648141992bbe70aa56b64551bbd00d06fd8be401c85dda6f542339",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "缺 Finalize 时可选 spend-buff 追加费用与条件 ignore-base 的联合适配（CR 356.2.b/356.2.b.1、356.1.b、357.2.a）：" +
    "translateCost 已能传递 CostSpec，但本卡的 pay/decline 字符串不能提供费用管线所需的运行时友方 Buff 对象选择" +
    "（702.2.b.1/b.2），也未将接受该追加费用映射为仅忽略基础费用、保留后续加费的费用计划。",
  abilities: [
    { kind: "keyword", keyword: "reaction" },
    {
      kind: "play",
      cost: {
        // 印刷基础费用（3 Energy、无 Power）+ 356.2.b 的可选追加费用「支付 1 个 Buff」
        // （702.2.b），追加费用带显式 pay/decline 选择，与 Frigid Touch 的 [Repeat]
        // 支付同一形状。kind 取 merged cost-plan 的 "explicit"
        // （cost/plan-values.ts 的 readCost 只接受 printed / activated / explicit）。
        // 注意：merged cost plan 的 nonstandard 支付要求 choice.options 是精确运行时
        // ObjectRef，静态 IR 按 README §3 禁止写运行时引用，因此该选项集在 Finalize
        // 生成费用计划时需要 CardProgram 到 Finalize 的运行时费用适配；卡牌不在
        // 这里自行结算费用。
        kind: "explicit",
        energy: { kind: "constant", value: 3 },
        payments: [
          {
            kind: "spend-buff",
            amount: { kind: "constant", value: 1 },
            choice: {
              id: "call-to-glory.spend-buff-payment",
              options: ["pay", "decline"],
              selection: "one"
            }
          }
        ]
      },
      body: [
        {
          // "Give a unit +3 Might this turn" — supported arithmetic-layer
          // instruction; the remaining gap is the optional cost above.
          id: "call-to-glory.grant-might",
          op: "continuous.might",
          args: {
            amount: { kind: "literal", value: 3 },
            duration: { kind: "literal", value: "this-turn" },
            objects: {
              kind: "constant",
              value: { kind: "target", id: "call-to-glory.unit" }
            }
          },
          targets: [
            {
              id: "call-to-glory.unit",
              filter: { types: "unit" },
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
    "As you play this, you may spend a buff as an additional cost. If you do, ignore this spell's cost.\n" +
    "Give a unit +3 :rb_might: this turn."
} satisfies CardProgram;

export default callToGlory;
