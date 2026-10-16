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
 *   evaluated after targets are locked, so it would return `skipped` instead of
 *   making the spell unplayable at Finalize (355.8/355.17.b: a choice must
 *   satisfy the restrictions, otherwise the card cannot be finalized);
 * - the Power cost is a printed characteristic on the Chain object and the
 *   merged ObjectSnapshot exposes `power` as a Domain list, not a numeric
 *   Power cost. "any amount of Power" / universal Power is also not a number
 *   (163.2.b), so "[C] or more" would need the domain-agnostic accounting that
 *   cost/resources.ts keeps separate.
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
    "缺「Power cost [rainbow][rainbow] or more」的落地：合并的 filter 管线（layers/filter.ts）只做" +
    "标量/数组等值匹配，没有数值阈值比较器；IR 虽有 condition compare(gte) 且解释器能求值，但指令 condition " +
    "是在目标锁定之后求值，只会得到 skipped，无法在 Finalize 阶段阻止 355.8/355.17.b 的非法定案；" +
    "ObjectSnapshot.power 是域列表而非数值 Power 费用（163.2.b 的通用 Power 也不是数字），没有域无关的" +
    "数值口径。effect.counter 已合入并有 golden 执行证据；限制条件仅按 IR 形状记录，不近似实现" +
    "（不去掉限制，也不硬编码单一域）。依赖：目标系统数值限制（RIFT-90 范围）。",
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
