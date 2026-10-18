import type { CardProgram } from "../../ir/index.js";

/**
 * ogn-256-298 Fox-Fire, Ahri (Spell, Calm/Mind, 3 energy, no printed power,
 * tags Ahri / Signature) — RIFT-143 shard 8.
 *
 * Catalog evidence (deck-catalog.json, dataVersion 2026-10-12-official-gallery):
 * cardType Spell, domains ["Calm", "Mind"], energy 3, power null, might null.
 * `power: null` means no printed Power value; it is never normalized to 0.
 *
 * Printed text:
 *   [Hidden] (Hide now for :rb_rune_rainbow: to react with later for :rb_energy_0:.)
 *   [Action] (Play on your turn or in showdowns.)
 *   Kill any number of units at a battlefield with total Might 4 or less.
 *
 * Status: judge-required. The kill clause is a 355.11 group target:
 * - the affected units are chosen and must collectively sit at ONE battlefield
 *   with a total Might of 4 or less. `TargetSpec.location` now expresses the
 *   battlefield restriction, but the merged target plan still resolves only
 *   min/max plus per-member legality; its `kind: "group"` field has no
 *   group-coherence or total-Might constraint, and no resolution-time re-choice
 *   of a legal subset (355.11.b). The Core Rules use this very card as the
 *   example for that rule (units that were given +1 Might force the controller
 *   to pick a legal subset of the original targets).
 * - "any number ... including zero" is expressed here as min 0 / selection
 *   "any" (355.13), but the group constraint above cannot be enforced, so the card
 *   is not executable.
 * - [Hidden] (811) is declared; the cost side is merged (cost/kinds/hidden.ts:
 *   buildHiddenCostPlan locks the 1 any-domain Power hide plan, the play plan
 *   ignores the printed base while keeping additional fees). What is still
 *   missing is the 811.1.c/811.1.d flow binding: the Hide free action, the
 *   facedown zone handling and the next-turn Reaction play permission/timing,
 *   so the printed Hide line cannot be executed end to end yet.
 * The kill half itself uses the merged effect.kill primitive with non-target board
 * units chosen at Finalize; it is covered by a real execution test.
 */
const foxFire = {
  canonicalCardId: "card.hash-a8491bd5b3202938d1600eec9d2435158dffdf3ceda1be6ceaa50336f2e25393",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "缺分组目标与总 Might 约束：'any number of units at a battlefield with total Might 4 or less' 是 355.11 的分组要求" +
    "（同一战场 + 组内 Might 合计 ≤ 4），TargetSpec.location 已能表达 battlefield，但 target-plan 仍只有 min/max 与单体合法性，" +
    "kind:\"group\" 只是声明字段，target-plan.ts 没有任何执行路径做组内一致性或 Might 合计，" +
    "也没有 355.11.b/355.11.b.1 的结算时合法子集重选（CR 本条示例正是 Fox-Fire）；" +
    "[Hidden]（811）的费用侧已合入（cost.hidden 的 buildHiddenCostPlan：hide 锁 1 点任意域 Power、play 忽略印刷基础费，cost/kinds/hidden.ts 与 cost-plan.ts 有执行证据），" +
    "但仍缺 811.1.c/811.1.d 的流程绑定：Hide 自由行动、facedown 区域处理与下回合 Reaction 打出的许可/时机（keywords/Hidden.ts 仍标记 RIFT-89/RIFT-91 待办，programs/statics.ts 的 layerFor 也还没有 cost.hidden 映射）。" +
    "Kill 原语本身已合入并有执行测试；不近似实现。",
  abilities: [
    { kind: "keyword", keyword: "hidden" },
    { kind: "keyword", keyword: "action" },
    {
      kind: "play",
      body: [
        {
          id: "fox-fire-kill",
          op: "effect.kill",
          args: { target: { kind: "literal", value: "fox-fire-units" } },
          targets: [
            {
              id: "fox-fire-units",
              filter: { type: "unit", zone: "board" },
              location: { type: "battlefield" },
              min: 0,
              max: null,
              selection: "any",
              kind: "group"
            }
          ]
        }
      ]
    }
  ],
  sourceText:
    "[Hidden] (Hide now for :rb_rune_rainbow: to react with later for :rb_energy_0:.)\n" +
    "[Action] (Play on your turn or in showdowns.)\n" +
    "Kill any number of units at a battlefield with total Might 4 or less."
} satisfies CardProgram;

export default foxFire;
