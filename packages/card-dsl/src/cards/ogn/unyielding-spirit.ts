import type { CardProgram } from "../../ir/index.js";

/**
 * Unyielding Spirit (ogn-145-298) — Spell, 1 energy + 1 Body power.
 *
 * Printed text:
 *   [Reaction] (Play any time, even before spells and abilities resolve.)
 *   Prevent all spell and ability damage this turn.
 *
 * Modeling notes (Core Rules v1.5):
 * - [Reaction] (813) is declared as a keyword ability; the keyword registry
 *   owns its expansion (contract 3.7).
 * - "Prevent all spell and ability damage this turn" is a delayed replacement
 *   effect: 438.1 / 438.1.b define Prevent as reducing the damage a set of
 *   objects would take, 438.2 says prevented damage is replaced by a reduced
 *   event, and 438.7 classifies Prevent as a Delayed Replacement Effect, which
 *   the events pipeline owns. The card declares that replacement (contract 3.1
 *   replacement ability) and leaves interception to the engine. Re-reviewed
 *   2026-10-17: the replacement registration path and replacement.prevent primitive are merged,
 *   but two production pieces are still missing, so the card is judge-required:
 *   - bindReplacement's ability-level planner only accepts replacement.enter and
 *     replacement.event bodies; it rejects this replacement.prevent body instead of installing
 *     the damage prevention registration;
 *   - the frozen damage GameAction carries only { source, target, amount, combat }, and the
 *     replacement pattern/filter path has no sourceKind discriminator, so "spell and ability
 *     damage" cannot be separated safely from combat or other damage.
 *   The primitive itself already accepts the printed `amount: "all"` and `duration: "this-turn"`
 *   arguments; those are retained in the declaration rather than treated as missing contract fields.
 *   The intended structure and scope are recorded below for review.
 */
const unyieldingSpirit = {
  canonicalCardId: "card.hash-fa0b6342e3ae249c47a5d594fc7d88556a428b685a88b0735f1aae0a62002b5b",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "「Prevent all spell and ability damage this turn」是延迟替代效果（438.1、438.1.b、438.2、438.7），复核 2026-10-17 后仍有两处真实缺口：" +
    "(1) replacement.prevent 原语已经合入，但 bindReplacement 的能力级 planner 只消费 replacement.enter/replacement.event，" +
    "对本卡的 replacement.prevent body 抛 Unsupported replacement opcode，无法安装伤害预防替代；" +
    "(2) 冻结的 damage GameAction 只有 {source, target, amount, combat}，replacement pattern/filter 也没有 sourceKind 判别器，" +
    "无法安全区分“法术与能力伤害”与战斗或其他伤害。原语本身已支持 amount=all 与 duration=this-turn，" +
    "因此不把 duration 继续列为契约缺口。不近似实现；依赖：能力级 replacement.prevent planner/binder 与 damage 来源分类。",
  abilities: [
    { kind: "keyword", keyword: "reaction" },
    {
      kind: "replacement",
      replaces: {
        event: "damage",
        // "spell and ability damage": the current damage action/filter contract has no
        // source-kind discriminator (see judgeReason), so the intended scope is named here
        // for the future source-snapshot classification.
        filter: { sourceKind: ["spell", "ability"] }
      },
      with: [
        {
          id: "unyielding-spirit.prevent-spell-ability-damage",
          // The merged primitive can install this replacement when called directly; the
          // ability-level binder still rejects it (438.2).
          op: "replacement.prevent",
          args: {
            amount: { kind: "constant", value: "all" },
            duration: { kind: "constant", value: "this-turn" },
            appliesTo: { kind: "constant", value: { sourceKind: ["spell", "ability"] } }
          }
        }
      ]
    }
  ],
  sourceText:
    "[Reaction] (Play any time, even before spells and abilities resolve.)\n" +
    "Prevent all spell and ability damage this turn."
} satisfies CardProgram;

export default unyieldingSpirit;

