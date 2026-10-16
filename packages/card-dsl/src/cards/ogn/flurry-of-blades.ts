import type { CardProgram } from "../../ir/index.js";

/**
 * Flurry of Blades (ogn-133-298) — Spell, 1 energy, Body.
 *
 * Printed text:
 *   [Reaction] (Play any time, even before spells and abilities resolve.)
 *   Deal 1 to all units at battlefields.
 *
 * Modeling notes (Core Rules v1.5):
 * - [Reaction] (813) is declared as a keyword ability and expanded by the
 *   keyword registry (contract 3.7); the card only names it.
 * - "Deal 1 to all units at battlefields" is NOT a targeting effect. 355.10.d
 *   makes an object programmatically selected by its characteristics a
 *   non-target ("Kill all units at battlefields" doesn't target anything), and
 *   355.10.d.1 limits that exception to objects for which no choice is ever
 *   possible. "At battlefields" only restricts which units the set contains
 *   (355.10.b), so no "becomes a target" trigger (754) may fire for them.
 * - The merged effect.damage primitive only consumes a Finalize-locked
 *   TargetSpec id (ctx.targets(specId), see effect.damage.ts), and the DSL has
 *   no non-target set form for damage. effect.ready and effect.heal already
 *   accept the resolve-time { kind: "query", filter } descriptor for such
 *   sets; effect.damage does not. Declaring a TargetSpec here would wrongly
 *   make every unit at a battlefield a target, so the instruction carries the
 *   intended set in that query descriptor shape and the card stays
 *   judge-required instead of approximating.
 */
const flurryOfBlades = {
  canonicalCardId: "card.hash-14e2d9254f7779335e58a4346dc54ef0c51478cb00d0785b533c821957b9b044",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "缺非目标集合的伤害形态：CR 355.10.d 规定按特征程序化选出、玩家无从选择的单位不是目标" +
    "（Kill all units at battlefields 不选目标），355.10.d.1 把该例外限定为从不做选择的集合。" +
    "已合入的 effect.damage 只读取 Finalize 锁定的 TargetSpec（ctx.targets(id)），没有 effect.ready / " +
    "effect.heal 那样的 {kind:'query', filter} 非目标集合分支；把“所有战场单位”写成 TargetSpec 会错误触发" +
    "成为目标（355.7、754），因此不近似实现。依赖：effect.damage 增加非目标集合形态。",
  abilities: [
    { kind: "keyword", keyword: "reaction" },
    {
      kind: "play",
      body: [
        {
          id: "flurry-of-blades.deal-1-to-units-at-battlefields",
          op: "effect.damage",
          args: {
            amount: { kind: "constant", value: 1 },
            // Non-target programmatic set (355.10.d), described with the same
            // descriptor shape the merged effect.ready / effect.heal use.
            objects: {
              kind: "constant",
              value: {
                kind: "query",
                // The layer engine's filter matcher reads a location-type
                // string here (layers/filter.ts: "location: battlefield").
                filter: { type: "unit", zone: "board", location: "battlefield" }
              }
            }
          }
        }
      ]
    }
  ],
  sourceText:
    "[Reaction] (Play any time, even before spells and abilities resolve.)\n" +
    "Deal 1 to all units at battlefields."
} satisfies CardProgram;

export default flurryOfBlades;

