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
 * Status: judge-required. The merged `effect.damage` primitive reads its
 * affected set from `ctx.targets(TargetSpec id)` only, so a characteristic-
 * selected set that is explicitly not a target cannot be expressed with a
 * registered op:
 * - the reference kernel's own filter matcher (effects/testing/test-kernel.ts
 *   matchesFilter) understands type/types/tag/tags/controller/owner/zone/
 *   location only, and the production layer filter (layers/filter.ts) reads
 *   `location` as a zone-name string comparison, so a nested
 *   `{ location: { type: "base" } }` filter is evaluated by neither;
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
    "缺“按特征选中整组对象、且不作为目标”的伤害路径：已合入的 effect.damage 只经 ctx.targets(TargetSpec id) 读受击集合，" +
    "而“all units in bases”按 355.10.d 不由玩家选择、不是目标，声明 TargetSpec 会错误触发“成为目标”相关触发。" +
    "参考内核 matchesFilter 与 layers/filter.ts 都不求值嵌套的 location 过滤（前者只认 zone/字符串 location，" +
    "后者把 location 当区域名字符串比较），“in bases”无法表达；repeat/choice 组合也无法逐成员结算而不引入假目标。" +
    "依赖目标系统与批量集合原语（target.many / RIFT-90）。不近似实现。",
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
                filter: { type: "unit", location: { type: "base" } },
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
