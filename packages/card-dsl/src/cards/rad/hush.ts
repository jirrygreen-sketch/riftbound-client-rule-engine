import type { CardProgram } from "../../ir/index.js";

/**
 * Hush (rad-041-167) — Spell, 1 Energy + 2 Power, domainless.
 *
 * Printed text:
 *   [Reaction] (Play any time, even before spells and abilities resolve.)
 *   Counter a spell with Power cost :rb_rune_rainbow::rb_rune_rainbow: or more.
 *
 * Rules evidence (Core Rules v1.5):
 * - 813 [Reaction] is a Permissive keyword (merged keywords/Reaction.ts); the
 *   card only declares it. The Closed-State play window belongs to chain/canAct.
 * - "Counter a spell": 426.1–426.3 — a countered card does nothing, leaves the
 *   Chain, and its costs are not refunded. The merged effect.counter primitive
 *   performs exactly this and keeps the target set restricted to Chain objects
 *   (its own documentation: target legality and Pending-item checks belong to
 *   the target system, 329/359.3.e). "a spell" means a finalized object on the
 *   Chain (355.9.a.2), so the TargetSpec filter is { type: "spell", zone: "chain" }.
 * - "with Power cost [rainbow][rainbow] or more" is a targeting restriction
 *   (355.9.b: "a unit is a valid target ... only if it meets the appropriate
 *   criteria" — the same rule shape applies to a spell's Power cost).

 * Status: judge-required. The counter half is merged and executed for real in
 * the golden test, but the printed Power-cost restriction has no honest
 * expression:
 * - a TargetSpec filter can only carry JSON scalar comparisons
 *   (layers/filter.ts matches scalars/arrays by equality); "Power cost >= 2"
 *   is a numeric threshold over a computed characteristic, and the merged
 *   filter pipeline has no comparator operator;
 * - a Condition (`compare` with operator gte) exists in the IR and the
 *   interpreter evaluates it, but a Condition on the instruction is only
 *   evaluated after targets are locked, so a false comparison would skip instead of
 *   making the spell unplayable at Finalize (355.8/355.17.b: a choice must
 *   satisfy the restrictions, otherwise the card cannot be finalized);
 * - the Power cost is a printed characteristic on the Chain object and the
 *   merged ObjectSnapshot exposes `power` as a Domain list, not a numeric
 *   Power cost. The declared powerCost property therefore also needs a
 *   characteristic reader before the comparison can be evaluated.
 * The target-plan contract still lacks the Finalize-time numeric target
 * restriction.
 * The instruction therefore records the restriction declaratively (filter +
 * condition) but the card is not executable: without the restriction a player
 * could counter a 0/1-Power spell, which the printed text forbids. Not
 * approximated by dropping the restriction or by hard-coding one domain.
 */
const hush = {
  canonicalCardId: "card.hash-9687e50570fa9c4d346613c3c24b7a3647f366f42940e8d43d23361879fe9935",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "仍缺 355.9.b 的 Power cost >= 2 目标限制：(1) target-plan 的 filter 管线只做等值/成员匹配，" +
    "没有 Finalize 阶段的数值阈值谓词；(2) ObjectSnapshot 只有域列表 power，没有可读的数值 powerCost 特征。" +
    "当前 instruction condition 只在结算时检查，无法在锁定前排除 0/1 Power 法术并落实 355.8/355.17.b；" +
    "effect.counter 已有局部执行证据，不省略目标限制。",
  abilities: [
    { kind: "keyword", keyword: "reaction" },
    {
      kind: "play",
      body: [
        {
          id: "hush.counter-spell",
          op: "effect.counter",
          args: {
            target: { kind: "constant", value: "hush.spell" },
            amount: { kind: "constant", value: 1 }
          },
          targets: [
            {
              id: "hush.spell",
              filter: { type: "spell", zone: "chain" },
              min: 1,
              max: 1,
              selection: "one"
            }
          ],
          // " ... with Power cost [rainbow][rainbow] or more": a Finalize-time
          // targeting restriction (355.9.b). Recorded declaratively; see
          // judgeReason for the missing comparator/power-cost accounting.
          condition: {
            kind: "compare",
            left: {
              kind: "object-property",
              object: { target: "hush.spell" },
              property: "powerCost"
            },
            operator: "gte",
            right: { kind: "constant", value: 2 }
          }
        }
      ]
    }
  ],
  sourceText:
    "[Reaction] (Play any time, even before spells and abilities resolve.)\n" +
    "Counter a spell with Power cost :rb_rune_rainbow::rb_rune_rainbow: or more."
} satisfies CardProgram;

export default hush;
