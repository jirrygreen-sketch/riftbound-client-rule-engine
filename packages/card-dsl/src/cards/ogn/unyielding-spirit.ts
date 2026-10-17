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
 *   2026-10-17: the replacement registration path (replacement/bind.ts,
 *   the replacement binding path is merged, but three pieces are still missing, so the card is
 *   judge-required:
 *   - effects/instructions has no replacement.prevent primitive, so the
 *     declared body cannot install a damage prevention replacement;
 *   - the frozen damage GameAction carries only { source, target, amount,
 *     combat }, so "spell and ability damage" cannot be told apart from combat
 *     damage at the action level;
 *   - the contract 3.1 replacement ability form has no duration field, so the
 *     printed "this turn" window cannot be declared.
 *   The intended structure and scope are recorded below for review.
 */
const unyieldingSpirit = {
  canonicalCardId: "card.hash-fa0b6342e3ae249c47a5d594fc7d88556a428b685a88b0735f1aae0a62002b5b",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "「Prevent all spell and ability damage this turn」是延迟替代效果（438.1、438.1.b、438.2、438.7），复核 2026-10-17 后仍有三处缺口：" +
    "(1) 替代注册管线（replacement/bind.ts）已合入，但 effects/instructions 没有 replacement.prevent 原语，" +
    "声明的预防体无法安装成伤害预防替代；(2) 冻结的 damage GameAction 只有 {source, target, amount, combat}，" +
    "无法区分“法术与能力伤害”与战斗伤害；(3) 契约 3.1 的 replacement 能力没有 duration 字段，无法声明“本回合”窗口。" +
    "不近似实现；依赖：replacement.prevent 原语与 damage 的来源分类。",
  abilities: [
    { kind: "keyword", keyword: "reaction" },
    {
      kind: "replacement",
      replaces: {
        event: "damage",
        // "spell and ability damage": the damage action has no such
        // discriminator yet (see judgeReason), so the intended scope is named
        // here for the future source-snapshot classification.
        filter: { sourceKind: ["spell", "ability"] }
      },
      with: [
        {
          id: "unyielding-spirit.prevent-spell-ability-damage",
          // Pending primitive (replacement.prevent): reduce the incoming
          // damage to 0 and replace the damage event (438.2).
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

