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
 * Status: judge-required (re-verified 2026-10-18; template evidence in
 * test/cards/templates/play-effect-damage-685.test.mjs). The printed set is
 * selected by characteristics and is explicitly not a target (355.10.d), but
 * the merged `effect.damage` primitive reads its affected set from
 * `ctx.targets(TargetSpec id)` only (its argsSchema requires a `target`
 * string and rejects an `objects` selector), so there is still no "damage each
 * current member of a characteristic set" path:
 * - the "in bases" restriction itself is now expressible: the production
 *   filter (layers/filter.ts and layers/rules/query.ts) evaluates the string
 *   spelling `location: "base"` against `object.location.type`, and the filter
 *   below uses that evaluated spelling;
 * - the non-target set is recorded with the same selector descriptor the
 *   merged effect.ready / effect.heal accept, `{ kind: "query", filter }`
 *   (RIFT-685 normalization; "all units" is the complete-set semantics of a
 *   set query, so there is no separate `selection` key);
 * - the sibling merged primitives really do carry that shape: feeding
 *   `{ kind: "query", filter: { type: "unit" } }` to `effect.heal` resolves
 *   (status executed), while the same descriptor handed to `effect.damage`
 *   throws "effect.damage args.target must be a TargetSpec id string"
 *   (measured 2026-10-18);
 * - the card's own play already runs end to end through the real chain: the
 *   printed 5 Energy + 2 Body Power is paid, no TargetSpec is declared so no
 *   object ever becomes a target (355.10.d), and resolving the body is
 *   rejected by the effect.damage args schema — the exact remaining gate;
 * - `count` / `condition.value` produce numbers and booleans only, and
 *   repeat/choice structures cannot produce "each current member of a
 *   characteristic set" without inventing a per-member targeting loop, which
 *   would wrongly add targets (355.10.d).
 * The missing shape is a non-targeting batch set op: the merged target system
 * (RIFT-90, target/target-plan.ts) finalizes TargetSpecs and emits
 * "became-target" for every selected object, which 355.10.d / 355.10.d.1 rule
 * out for a characteristic-selected set, so it cannot be reused and is not
 * worked around with per-clause target loops.
 */
export default {
  canonicalCardId: "card.hash-93ccf4a04222adbd61db565ce07b24bcbe42a6cf03edc5ff3ab1d63feb45bad5",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "仍缺「按特征选中整组对象、且不作为目标」的批量伤害路径（2026-10-18 复核）：" +
    "已合入的 effect.damage（effects/instructions/effect.damage.ts）只经 ctx.targets(TargetSpec id) 读受击集合，" +
    "argsSchema 要求 args.target 为非空字符串，传入 objects 会在 parseArgs 抛 " +
    "“effect.damage args.target must be a TargetSpec id string”（实测）；" +
    "同一 {kind:'query', filter} 描述符交给已合入的 effect.heal 则真实执行成功，说明缺的是伤害原语的非目标集合分支，不是集合描述符本身。" +
    "“all units in bases”按 355.10.d / 355.10.d.1 由特征程序化选出、玩家无从选择，因此不是目标；" +
    "声明 TargetSpec 会经 target/target-plan.ts 给每个被选对象发 became-target（chain/engine.ts 的 onTargeted），违反 355.10.d 与 355.7。" +
    "「in bases」限制本身可表达：layers/filter.ts 对字符串 location 求值 object.location.type，实测基地单位匹配、战场单位不匹配；" +
    "但 layers/filter.ts 对未知键恒真、characteristics 只做字面相等，因此不能用它近似批量子集语义。" +
    "现有 repeat/choice 组合无法逐成员结算而不引入假目标（choice.mode 只选择模式、effect.repeat 的 count 是数字），" +
    "仍缺非目标批量集合伤害原语（同 ogn/flurry-of-blades、ogs/firestorm 的同一缺口）。" +
    "模板 play-effect-damage-685 用本卡自身 body 经真实链实测：5 能量 + 2 Body Power 支付完成、没有任何对象 became-target，" +
    "结算在 parseArgs 阶段被拒绝。不近似实现。",
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
                // Non-target programmatic set (355.10.d) in the merged
                // query-descriptor shape: "all units in bases" is every
                // current match of the query.
                kind: "query",
                // "in bases": the evaluated string spelling (object.location.type).
                filter: { type: "unit", location: "base" }
              }
            }
          }
        }
      ]
    }
  ],
  sourceText: "Deal 3 to all units in bases."
} satisfies CardProgram;
