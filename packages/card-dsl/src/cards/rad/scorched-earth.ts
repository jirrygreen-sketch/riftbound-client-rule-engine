import type { CardProgram } from "../../ir/index.js";

/**
 * Scorched Earth (rad-006-167) — Spell, 4 Energy + 1 Power, domainless.
 *
 * Printed text:
 *   [Action] (Play on your turn or in showdowns.)
 *   Deal 5 damage split among units at a single battlefield.
 *
 * Rules evidence (Core Rules v1.5):
 * - 806 [Action] / 159.2.a default spell timing: declared as the merged
 *   { kind: "keyword", keyword: "action" } (keywords/Action.ts).
 * - 355.14.a: when a card splits an amount of damage among Units, each chosen
 *   Unit is Targeted. 355.14.b: the Targets are chosen when the spell is
 *   finalized. 355.14.c: the number of Targets cannot exceed the damage
 *   available (5). 355.14.e: the per-target division is chosen at resolution.
 *   355.14.g: each target must receive at least 1 damage.
 * - effect.damage's `divide: true` mode (CR 355.14.e) is merged and asks the
 *   controller for each target's amount at resolution; the golden test drives
 *   it against the reference kernel. The authored IR can only spell the flag
 *   as an Expr (`{ kind: "constant", value: true }`); the production chain
 *   adapter decodes only `target`/`combat` for effect.damage
 *   (chain/interpreter-adapter.ts LITERAL_FIELDS), so the primitive's
 *   `divide === true` check rejects the authored spelling before any damage
 *   (measured 2026-10-17).
 *
 * Status: judge-required, re-reviewed 2026-10-17. Two pieces of the printed
 * text are still not covered by merged code, plus one adapter gap:
 * - "at a single battlefield" is a group constraint (all Targets must share
 *   one battlefield). TargetRequirement carries kind/group
 *   (target/target-plan.ts) but no consumer enforces it: legalCandidates() only
 *   filters each candidate individually through matchesRequirement(), so a
 *   player can split the damage across two battlefields. This is the
 *   group-targeting primitive: target/ carries the field but has no
 *   group-consuming execution path.
 * - 355.14.h (controller drops Targets when the available damage at
 *   resolution is smaller than the number of Targets) has no implementation:
 *   effect.damage computes each amount's bound as remaining - (slots left - 1)
 *   and negates on an illegal answer instead of letting the controller reduce
 *   the Target set.
 * - chain/interpreter-adapter.ts does not decode effect.damage's `divide`
 *   literal flag, so the whole instruction list cannot pass the production
 *   chain entry point even though the primitive's divide form is merged.
 * All three are recorded here instead of being approximated.
 */
const scorchedEarth = {
  canonicalCardId: "card.hash-0de7fdfddfced7ff6b7fcdb3da2d93eb7c6f6531565882598b1ff5fa0d827fa0",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "缺「同一战场」分组约束的落地：CR 355.14.a/b 要求把伤害分配目标限定在同一战场（355.14.c 的 5 个上限已写进 IR 的 max: 5），" +
    "但 target/ 只有 TargetRequirement.group 字段而没有组约束的执行路径：target-plan.ts 的 legalCandidates() 只对每个候选单独走 matchesRequirement()，" +
    "当前可把伤害分到两个不同战场；另 CR 355.14.h（结算时可用伤害少于目标数时由控制者裁撤目标）没有实现，" +
    "effect.damage 只会在非法答案时整条否定。第三处是 chain/interpreter-adapter.ts 的 LITERAL_FIELDS 不解码 effect.damage 的 divide" +
    "（只解码 target/combat），IR 只能把该标志写成 Expr 常量，原语的 divide === true 校验因此拒绝本卡自身的指令" +
    "（实测 2026-10-17：“effect.damage args.divide must be true when present”），完整指令列表过不了生产链入口。" +
    "effect.damage 的 divide 分配本身已合入，参数化测试用真实内核执行该半段。不近似实现（不把分组约束去掉，也不把 divide 写成生产链不接受的假字面量）。",
  abilities: [
    { kind: "keyword", keyword: "action" },
    {
      kind: "play",
      body: [
        {
          id: "scorched-earth.deal-5",
          op: "effect.damage",
          args: {
            amount: { kind: "constant", value: 5 },
            target: { kind: "constant", value: "scorched-earth.units" },
            divide: { kind: "constant", value: true }
          },
          targets: [
            {
              id: "scorched-earth.units",
              filter: { type: "unit", zone: "board", location: "battlefield" },
              min: 1,
              max: 5,
              selection: "any",
              // Group marker: every chosen member must share one battlefield
              // (CR 355.14.a). Recorded per the merged TargetRequirement shape;
              // enforcement is the missing piece named in judgeReason.
              group: true
            }
          ]
        }
      ]
    }
  ],
  sourceText:
    "[Action] (Play on your turn or in showdowns.)\n" +
    "Deal 5 damage split among units at a single battlefield."
} satisfies CardProgram;

export default scorchedEarth;
