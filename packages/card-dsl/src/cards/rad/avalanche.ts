import type { CardProgram } from "../../ir/index.js";

/**
 * rad-079-167 Avalanche (Spell, 5 energy + 2 power, Body).
 *
 * Catalog evidence (packages/card-data/data/deck-catalog.json,
 * dataVersion 2026-10-12-official-gallery, printing rad-079-167):
 * energy 5, power 2, might null, domains ["Body"], tags [].
 *
 * Printed text (verbatim, sourceText):
 *   "Deal 3 to all units in bases."
 *
 * Rules reading (CR v1.5):
 * - "Deal 3 to all units in bases" is a Deal instruction (418) whose source is
 *   the ability itself (418.6.a) and whose affected set is every unit in a Base
 *   (107.1: each player's Base is a Location; "in bases" is a location
 *   restriction, not "at a battlefield").
 * - The set is selected by characteristics, so it is not a target (355.10.d:
 *   "Kill all units at battlefields" doesn't target anything); no TargetSpec and
 *   no pick is declared, so no "becomes a target" trigger is emitted
 *   (355.6/355.7). Every unit takes 3 (418.1.c) simultaneously (418.1.d).
 *
 * Status: judge-required. The printed set is selected by characteristics and
 * is explicitly not a target (355.10.d), but the merged `effect.damage`
 * primitive reads its affected set from `ctx.targets(TargetSpec id)` only, so
 * there is still no "damage each current member of a characteristic set"
 * path:
 * - the "in bases" restriction itself is now expressible: the production
 *   filter (layers/filter.ts and layers/rules/query.ts) evaluates the string
 *   spelling `location: "base"` against `object.location.type`, and the filter
 *   below uses that evaluated spelling;
 * - `count` / `condition.value` produce numbers and booleans only, and
 *   repeat/choice structures cannot produce "each current member of a
 *   characteristic set" without inventing a per-member targeting loop, which
 *   would wrongly add targets (355.10.d).
 * The batch set op (effect.damage over a set selector) is the missing shape
 * recorded below; it is not worked around with per-clause target loops.
 */
export default {
  canonicalCardId: "card.hash-93ccf4a04222adbd61db565ce07b24bcbe42a6cf03edc5ff3ab1d63feb45bad5",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "缺“按特征选中整组对象、且不作为目标”的批量伤害路径：已合入的 effect.damage 只经 ctx.targets(TargetSpec id) 读受击集合，" +
    "而“all units in bases”按 355.10.d 不由玩家选择、不是目标，声明 TargetSpec 会错误触发“成为目标”相关触发。" +
    "「in bases」的限制本身已可表达（layers/filter.ts 与 layers/rules/query.ts 按 object.location.type 求值字符串 " +
    "location:\"base\"，程序已改用该求值拼写）；仍缺批量集合原语（target.many / RIFT-90）与逐个成员结算的路径，" +
    "repeat/choice 组合也无法逐成员结算而不引入假目标。不近似实现。",
  abilities: [
    {
      kind: "play",
      cost: {
        kind: "cost.printed",
        energy: { kind: "constant", value: 5 },
        power: { kind: "constant", value: 2 }
      },
      body: [
        {
          // "Deal 3 to all units in bases" — one Deal instruction over the set
          // of units in Bases, selected by characteristics and not targeted
          // (judgeReason; the set selector is the unregistered shape here).
          id: "avalanche.deal-3",
          op: "effect.damage",
          args: {
            amount: { kind: "constant", value: 3 },
            objects: {
              kind: "constant",
              value: {
                // "in bases": the evaluated string spelling (object.location.type).
                filter: { type: "unit", location: "base" },
                selection: "all"
              }
            }
          }
        }
      ]
    }
  ],
  sourceText: "Deal 3 to all units in bases."
} satisfies CardProgram;
