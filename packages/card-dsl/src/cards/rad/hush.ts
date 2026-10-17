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

 * Status: judge-required (2026-10-17 recheck). The counter half is merged and
 * executed for real in the golden test, but the printed Power-cost restriction
 * still has no honest enforcement:
 * - the target-plan requirement surface carries only
 *   filter/min/max/selection/kind/location (target/target-plan.ts), and
 *   layers/filter.ts compares scalars and array membership by equality. There
 *   is no numeric comparator, so queryTargetCandidates/finalizeTargetPlan admit
 *   a 1-Power Chain spell (observed) although 355.9.b forbids it;
 * - RIFT-359's merged `printed-characteristic` predicate
 *   (effects/interpreter/predicates/printed.ts) does read a numeric printed
 *   Power from an event payload, but it is only a condition/predicate: a
 *   trigger or instruction can test it, while the Finalize legality path
 *   rejects it — programs/play.ts `translateRequirements`/`translateRestriction`
 *   throw "needs a rules adapter" for that kind. 355.8/355.17.b need the check
 *   before targets lock;
 * - ObjectSnapshot (`power`) is a Domain list with no numeric `powerCost`, so
 *   the authored `compare` on { object-property: powerCost } throws
 *   "Unavailable characteristic: powerCost"; an instruction condition is also
 *   evaluated only after targets lock.
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
    "仍缺 355.9.b 的 Power cost >= 2 目标限制，且无法在 Finalize 阶段落实 355.8/355.17.b：" +
    "(1) target-plan 的 TargetRequirement 只有 filter/min/max/selection/kind/location，" +
    "layers/filter.ts 只做等值/成员匹配，没有数值阈值谓词——实测 finalizeTargetPlan 会把 1 Power 的链上法术当成合法目标；" +
    "(2) RIFT-359 已合入的 printed-characteristic 条件能从事件负载读取 printedPower，" +
    "但它只作为触发/指令条件求值，programs/play.ts 的 translateRequirements/translateRestriction 对该种类抛“needs a rules adapter”，" +
    "不能在锁定目标前排除 0/1 Power 法术；" +
    "(3) ObjectSnapshot 的 power 是域列表、没有数值 powerCost，指令 condition 读 powerCost 会抛 " +
    "Unavailable characteristic，且 instruction.condition 只在 Resolve 求值。effect.counter 已有局部执行证据，不省略目标限制。",
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
