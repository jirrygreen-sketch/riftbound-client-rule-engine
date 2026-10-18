import type { CardProgram } from "../../ir/index.js";

/**
 * Bellows Breath — sfd-080-221 (Spell, 1 energy + 1 Mind power, Mind, tags []).
 *
 * Printed text (packages/card-data/data/deck-catalog.json, sfd-080-221, verbatim):
 *   [Action] (Play on your turn or in showdowns.)
 *   [Repeat] :rb_energy_1::rb_rune_mind: (You may pay the additional cost to repeat this spell's effect.)
 *   Deal 1 to up to three units at the same location.
 *
 * Catalog evidence: energy 1, power 1 (Mind), might null, domains ["Mind"], tags [].
 *
 * Modeling notes (Core Rules v1.5):
 * - [Action] (806) is a Permissive keyword expanded by effects/keywords/Action.ts
 *   (contract 3.7); the card only declares it.
 * - [Repeat] (820) is an Optional Additional Cost keyword on Spells (820.1.a);
 *   the printed cost is 1 Energy plus one Mind power (820.1.c.1), paid once for
 *   one additional execution (820.1.c.3, 820.1.d.1). The additional cost is
 *   declared in the merged CostSpec vocabulary; the expansion belongs to
 *   effects/keywords/Repeat.ts.
 * - "Deal 1 to up to three units": performing a game action on some number of
 *   objects makes every chosen unit a target (355.12), and "up to three"
 *   includes zero (355.13), hence min 0 with selection "up-to". "at the same
 *   location" is a group requirement over the chosen units (all of them must
 *   share one Location), which is the 355.11 style group-targeting requirement;
 *   the TargetSpec carries kind "group" to name that intent, but the merged
 *   target plan only enforces per-member legality and min/max.
 * - The Deal itself is the merged effect.damage (418); each target receives 1
 *   (418.1.c), and a Deal is not split damage (355.14), so no divide argument
 *   is written.
 *
 * Status: judge-required. The damage instruction is merged and is executed by
 * the parameterized template suite (including a partially stale target set),
 * but two dependencies are unmerged and not approximated:
 * - the 355.11 group requirement "same location" (the merged target plan carries
 *   kind/group as data but evaluates no group-level coherence and no
 *   legal-subset re-choice of 355.11.b);
 * - the Finalize collection of the optional [Repeat] additional cost and the
 *   paid-instance to interpreter-repeat wiring (820.1.c.1, 820.1.d.1): the
 *   Repeat keyword, effect.repeat and the cost-plan optionalAdditional input
 *   exist, but no code connects the card-declared additional cost to the
 *   spell-play Finalize or feeds the paid count to the resolution
 *   (programs/play.ts translateCost rejects `kind: "additional"` and the
 *   `optional` field, measured 2026-10-18: "Unsupported play cost field
 *   optional").
 */
const bellowsBreath = {
  canonicalCardId: "card.hash-effd069140ba0a97aec2b49e85dfc04e38ae3517c75aea5b88e3fcb853a4ea2b",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "两处当前真实缺口，均不近似实现：(1)「up to three units at the same location」是 355.11 的分组目标要求" +
    "（组内单位必须位于同一 Location），现有 target-plan 只有 min/max 与单成员合法性，kind: \"group\" 字段无分组一致性实现，" +
    "也没有结算时的合法子集重选（355.11.b）。" +
    "(2)「[Repeat] :rb_energy_1::rb_rune_mind:」的附加费用已按 CostSpec 声明（820.1.c.1），" +
    "Repeat 关键词、effect.repeat 与费用计划的 optionalAdditional 输入都已合入，" +
    "但没有代码把卡程序声明的附加费用接进法术打出的 Finalize 收取，也没有把已付实例数接到结算。" +
    "effect.damage（418；355.13 的 up to 可含 0 个目标）本体已合入并有 golden 执行测试。",
  abilities: [
    { kind: "keyword", keyword: "action" },
    {
      kind: "play",
      // 印刷基础费用（1 energy + 1 Mind power）由 catalog 在 Finalize 绑定；此处 cost
      // 只声明 [Repeat] 的可选附加费用（820.1.c.1）。
      cost: {
        kind: "additional",
        keyword: "repeat",
        optional: true,
        payments: [
          {
            kind: "energy",
            amount: { kind: "constant", value: 1 },
            choice: {
              id: "bellows-breath.repeat-payment",
              options: ["pay", "decline"],
              selection: "one"
            }
          },
          {
            kind: "power",
            amount: { kind: "constant", value: 1 },
            allowedDomains: ["Mind"]
          }
        ]
      },
      body: [
        {
          id: "bellows-breath.deal-1",
          op: "effect.damage",
          args: {
            amount: { kind: "constant", value: 1 },
            target: { kind: "constant", value: "bellows-breath.units" }
          },
          targets: [
            {
              id: "bellows-breath.units",
              filter: { type: "unit", zone: "board" },
              min: 0,
              max: 3,
              selection: "up-to",
              // "at the same location" 的分组意图（355.11；组一致性缺口见 judgeReason）。
              kind: "group"
            }
          ]
        }
      ]
    }
  ],
  sourceText:
    "[Action] (Play on your turn or in showdowns.)\n" +
    "[Repeat] :rb_energy_1::rb_rune_mind: (You may pay the additional cost to repeat this spell's effect.)\n" +
    "Deal 1 to up to three units at the same location."
} satisfies CardProgram;

export default bellowsBreath;
