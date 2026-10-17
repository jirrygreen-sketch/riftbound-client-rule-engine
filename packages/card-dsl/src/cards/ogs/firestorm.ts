import type { CardProgram } from "../../ir/index.js";

/**
 * Firestorm (ogs-002-024) — Spell, 6 energy + 1 Fury power (Fury).
 *
 * Printed text:
 *   Deal 3 to all enemy units at a battlefield.
 *
 * Modeling notes (Core Rules v1.5):
 * - There is no [Action]/[Reaction] keyword: spells default to Action timing
 *   (159.2.a), so the program declares no speed keyword.
 * - "all enemy units at a battlefield" is a programmatic set, not a target
 *   group: 355.10.d says an object selected by its characteristics is not
 *   Targeted ("Kill all units at a battlefields" doesn't target anything) and
 *   355.10.d.1 limits that exception to objects for which no choice is ever
 *   possible. The chosen *battlefield*, in contrast, is a targeting choice:
 *   355.10.d's example states that "Kill all units at a battlefield" targets a
 *   battlefield but not the units. The instruction therefore declares one
 *   TargetSpec for the battlefield and names the enemy-unit set with the
 *   resolve-time query descriptor shape merged primitives use.
 * - The source of the damage is the spell itself (418.6.a).
 *
 * Status: judge-required (re-checked 2026-10-17) — the non-target set form of
 * effect.damage is still missing: the merged effect.damage only
 * consumes a Finalize-locked TargetSpec (`ctx.targets(specId)`) and rejects an
 * `objects` argument with "effect.damage args.target must be a TargetSpec id
 * string", while effect.ready / effect.heal already accept
 * `{ kind: "query", filter }`. Writing the enemy units as a TargetSpec would
 * wrongly make every one of them a target and fire "becomes a target" (355.7,
 * 754), so the set stays a descriptor and the card cannot be marked executable.
 * The battlefield choice itself is routable today (355.10.d's example "Kill
 * all units at a battlefield" targets the battlefield; the golden drives the
 * card's own target declaration through the merged interpreter and the locked
 * battlefield really is resolved). The missing half is only the damage set
 * that rides on it. Tracked as RIFT-9's non-target damage set; the same gap
 * keeps ogn-133-298 Flurry of Blades judge-required.
 */
const firestorm = {
  canonicalCardId: "card.hash-4f827e86263468c7ee54c70750f747df55cb193818954ea93bd73791d1bf837a",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "缺 effect.damage 的非目标集合形态：CR 355.10.d 规定按特征程序化选出、玩家无从选择的单位不是目标" +
    "（“Kill all units at a battlefield” 不把任何单位选为目标；355.10.d.1 把该例外限定于从不做选择的集合），" +
    "被选中的战场本身才是目标。已合入的 effect.damage 仍然只读取 Finalize 锁定的 TargetSpec（ctx.targets(id)），" +
    "传入 objects 集合会直接抛 “args.target must be a TargetSpec id string”；effect.ready / effect.heal 的" +
    "{kind:'query', filter} 非目标分支没有扩展到伤害原语。" +
    "golden 用本卡的自身 body 经链解释器实测：锁定的战场目标会正常解析，" +
    "但同一指令的 objects 集合没有消费方——effect.damage 在 parseArgs 阶段就拒绝，" +
    "本卡不会近似实现，也不会把“该战场的所有敌方单位”写成 TargetSpec 去错误触发成为目标（355.7、754）。" +
    "依赖：effect.damage 增加非目标集合形态（RIFT-9 target.query；与 ogn-133-298 Flurry of Blades 同一缺口）。",
  abilities: [
    {
      kind: "play",
      cost: {
        kind: "cost.printed",
        energy: { kind: "constant", value: 6 },
        power: { kind: "constant", value: 1 }
      },
      body: [
        {
          id: "firestorm.deal-3-to-enemy-units",
          op: "effect.damage",
          args: {
            amount: { kind: "constant", value: 3 },
            // Non-target programmatic set (355.10.d): every enemy unit at the
            // chosen battlefield, described with the same query descriptor
            // shape the merged effect.ready / effect.heal accept.
            objects: {
              kind: "constant",
              value: {
                kind: "query",
                filter: {
                  type: "unit",
                  controller: "opponent",
                  sameLocationAs: { target: "firestorm.battlefield" }
                }
              }
            }
          },
          targets: [
            {
              // "at a battlefield": the battlefield is the target choice
              // (355.10.d), the units at it are not.
              id: "firestorm.battlefield",
              filter: { type: "battlefield" },
              min: 1,
              max: 1,
              selection: "one"
            }
          ]
        }
      ]
    }
  ],
  sourceText: "Deal 3 to all enemy units at a battlefield."
} satisfies CardProgram;

export default firestorm;
