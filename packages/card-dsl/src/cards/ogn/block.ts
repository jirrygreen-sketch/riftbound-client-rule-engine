import type { CardProgram } from "../../ir/index.js";

/**
 * Block (ogn-057-298) — Spell, 2 energy (Calm).
 *
 * Printed text:
 *   [Hidden] (Hide now for :rb_rune_rainbow: to react with later for :rb_energy_0:.)
 *   [Action] (Play on your turn or in showdowns.)
 *   Give a unit [Shield 3] and [Tank] this turn. (+3 :rb_might: while it's a
 *   defender. It must be assigned combat damage first.)
 *
 * Modeling notes (Core Rules v1.5):
 * - [Hidden] (811) and [Action] (806) are keyword abilities expanded by the
 *   keyword registry (contract 3.7); the card only names them. Hidden's
 *   facedown play permission still needs its cost and zone consumers.
 * - "Give a unit ... this turn" is a duration-bounded keyword grant. A keyword
 *   is not an instruction: keywords reach an object through the layers system
 *   as a static/continuous grant (contract 3.4 layer order copy -> trait ->
 *   ability -> arithmetic), and "a unit" is this ability's target (355.7). The
 *   grant is declared as the continuous.grant-keyword shape merged SFD
 *   programs use for the same mechanic.
 *
 * Status: judge-required — the two keyword halves and the timed grant are
 * merged (Tank's KeywordDef at RIFT-264, Shield's at the earlier keyword batch,
 * continuous.grant-keyword at RIFT-258), but the whole card still cannot run:
 * - Action timing is consumed by the play adapter; Hidden still lacks its
 *   Hide/facedown action and zone integration;
 * - [Tank]'s expansion is a continuous.combat effect and the combat damage
 *   assignment path has no consumer for it (base-combat-allocation.ts records
 *   "No Tank/Backline/other assignment-priority requirement is bound here"),
 *   so the printed assignment order is not enforced;
 * - dynamically granted Shield/Tank are not re-expanded; Shield's expansion
 *   reads designation while ObjectSnapshot exposes combatRole (814.1.d).
 * Not approximated: the [Tank] half is not dropped, and the Shield
 * value is not baked into a Might change (814.1.c: Shield is +X Might only
 * while the unit is a defender).
 */
const block = {
  canonicalCardId: "card.hash-211d0bb8cf4f5b5202c2a9b7996e483898644aa24714b1e10edd80a54ba4b560",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "缺 Hidden 的 Hide/Facedown Zone 行动、控制权与下回合解锁接线；cost.hidden 费用规划不提供这些许可（CR 811.1.b/c），" +
    "以及 811.1.d.2 的背面法术本战场目标限制。continuous.grant-keyword 动态授予 Shield/Tank 后尚未重展开；" +
    "Shield 读取 designation 而 ObjectSnapshot 暴露 combatRole，仍需把合并后的 Shield 值接到 Defender 条件（814.1.c/d、814.2）。" +
    "Tank 的 continuous.combat 致死优先指派也无战斗消费者（815.1.b/c.2）。",
  sourceText:
    "[Hidden] (Hide now for :rb_rune_rainbow: to react with later for :rb_energy_0:.)\n" +
    "[Action] (Play on your turn or in showdowns.)\n" +
    "Give a unit [Shield 3] and [Tank] this turn. (+3 :rb_might: while it's a defender. " +
    "It must be assigned combat damage first.)",
  abilities: [
    { kind: "keyword", keyword: "hidden" },
    { kind: "keyword", keyword: "action" },
    {
      kind: "play",
      body: [
        {
          // "Give a unit [Shield 3] and [Tank] this turn" — one duration-bound
          // keyword grant over the ability's target (355.7). Both keyword
          // halves stay visible; the grant runs through the merged
          // continuous.grant-keyword primitive; keyword re-expansion and combat
          // consumption remain open (see judgeReason).
          id: "grant-shield-3-and-tank",
          op: "continuous.grant-keyword",
          args: {
            objects: { kind: "constant", value: { kind: "target", id: "granted-unit" } },
            // 814.1.b.2: Shield carries its Shield Value (3); Tank is unvalued
            // (815.1). The object-array form is the one that keeps the value:
            // continuous.grant-keyword ignores `value` when `keywords` is given.
            keywords: { kind: "constant", value: [{ id: "Shield", value: 3 }, { id: "Tank" }] },
            duration: { kind: "constant", value: "this-turn" }
          },
          targets: [
            {
              id: "granted-unit",
              filter: { type: "unit", zone: "board" },
              min: 1,
              max: 1,
              selection: "one"
            }
          ]
        }
      ]
    }
  ]
} satisfies CardProgram;

export default block;
