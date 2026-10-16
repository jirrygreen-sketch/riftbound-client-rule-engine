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
 *   plan for this card is generated at Finalize (RIFT-89).
 * - "Give a unit +3 :rb_might: this turn" is a temporary Might modification
 *   that expires in the end-of-turn cleanup (317.2.c "3d. All 'this turn'
 *   effects expire simultaneously."; 433.1.a layer modulation). It belongs to
 *   the layers system: effect.buff's own header says temporary Might changes
 *   "belong to continuous.might, never to this primitive" (703 Buffs are
 *   counters), and no registered instruction converts a card instruction into
 *   a duration-bounded ctx.addContinuous call.
 *
 * Status: judge-required. Both the conditional ignore-cost rewrite (the
 * merged cost plan still cannot take a runtime ObjectRef option set from
 * static IR, RIFT-89 follow-up) and the temporary Might instruction (the
 * card-facing continuous.might op is still missing; RIFT-91 merged the layers
 * engine it would feed) are unmerged. Not approximated: no free play, no
 * Buff-as-Might substitution.
 */
const callToGlory = {
  canonicalCardId: "card.hash-9eef9a0508648141992bbe70aa56b64551bbd00d06fd8be401c85dda6f542339",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "两处依赖未合入：(1)「As you play this, you may spend a buff as an additional cost. If you do, ignore " +
    "this spell's cost.」：可选追加费用（356.2.b/356.2.b.1、357.2 支付；702.2.b.1/b.2 限定可消耗的 Buff）和" +
    "「已支付则把本牌 Base Cost 置 0」的费用改写（356.1.b、357.2.a）都属 RIFT-89；且 merged cost plan 的" +
    "非标准费用选项集要求 choice.options 是精确运行时 ObjectRef（cost/plan-values.ts 的 reference），" +
    "静态 IR 按 README §3 禁止写运行时引用，因此该选项集只能由 Finalize 的费用系统在运行时生成。" +
    "(2)「Give a unit +3 Might this turn」是临时 Might 修正（317.2.c 到期 / 433.1.a 图层），属 layers 的" +
    "continuous.might：RIFT-91 已合入层引擎与期限，但 effects/instructions 中仍无卡牌可用的 continuous.might" +
    "指令 op，effect.buff 明确临时 Might 不入 Buff 计数器（703）。不近似实现（不免费打出、不用 Buff 冒充 Might）。",
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
        // 生成费用计划时仍属 RIFT-89；卡牌不结算费用。
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
          // "Give a unit +3 Might this turn" — pending layers instruction
          // (see judgeReason): continuous.might with a this-turn duration.
          id: "call-to-glory.grant-might",
          op: "continuous.might",
          args: {
            amount: { kind: "literal", value: 3 },
            duration: { kind: "literal", value: "this-turn" }
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
