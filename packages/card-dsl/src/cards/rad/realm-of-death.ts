import type { CardProgram } from "../../ir/index.js";

/**
 * Realm of Death — rad-144-167 (Spell, Fury/Order, 2 Energy + 1 Power,
 * Mordekaiser / Signature).
 *
 * Printed text (verbatim, deck-catalog rad-144-167):
 *   "Give an enemy unit -2 :rb_might: this turn and a friendly unit +2
 *    :rb_might: this turn. They deal damage equal to their Mights to each other."
 *
 * Modeling notes (Core Rules v1.5):
 * - "Give an enemy unit -2 :rb_might: this turn and a friendly unit +2
 *   :rb_might: this turn" are two temporary Might modifications ("this turn"
 *   expires with the end-of-turn batch, 317.2.c). They belong to the layers
 *   arithmetic pass (continuous.might with an end-of-turn duration), not to Buff
 *   counters: effect.buff's header states that the +1 Might each Buff
 *   contributes is derived by the layers system and that temporary Might
 *   changes never belong to that primitive (702, 703, 427.1).
 * - "They deal damage equal to their Mights to each other" is two Deal actions
 *   (one per unit), each sourced to the unit itself and each reading that
 *   unit's current Might at resolution time. CR 418.6.b.3 uses exactly this
 *   wording as its worked example ("Challenge ... They deal damage equal to
 *   their Mights to each other. The damage ... is dealt by the chosen units"),
 *   and 418.6.b.4 makes each unit's controller responsible for its own Deal
 *   action. The two instructions below carry that source/amount shape through
 *   object-property selectors and the merged effect.damage primitive.
 * - Both units are chosen by one sentence ("an enemy unit ... and a friendly
 *   unit"), so each is a target (355.7 / 355.12) and there is no "up to".
 *
 * Status: judge-required. The Might modifications have no merged instruction:
 * the layers engine can evaluate an arithmetic continuous.might effect
 * (layers/engine.ts) and ResolveContext.addContinuous exists (contract 3.6),
 * but effects/instructions/ registers no op that creates one, so -2/+2 cannot
 * be applied and the damage would be computed from the printed Might instead of
 * the modified Might. The damage half is exercised on its own in the golden
 * test. Not approximated with Buff counters.
 */
export default {
  canonicalCardId: "card.hash-2d0655c3e2e7d9b1f55085edecfe69718e6edf9224340e2b87500e7770483b3d",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "缺临时 Might 修正的卡牌可用指令：layers/engine.ts 已能计算 arithmetic 的 continuous.might，ResolveContext.addContinuous 也已存在（契约 3.6），" +
    "但 effects/instructions/ 未注册任何创建该持续效果的 op，因此「-2 :rb_might: this turn」「+2 :rb_might: this turn」（317.2.c 到期）无法落地；" +
    "若省略这两条，后续伤害会按印刷 Might 而非修正后的 Might 计算，属近似实现，故整卡 judge-required。" +
    "伤害半边按 418.6.b.3（CR 原文即以本类文本为例）用 effect.damage + object-property 表达，并已在 golden 测试中真实执行。" +
    "依赖：RIFT-91（layers-continuous 的卡牌侧入口）/ RIFT-87；不近似实现（不得用 Buff 计数器代替）。",
  abilities: [
    {
      kind: "play",
      body: [
        {
          // "Give an enemy unit -2 Might this turn" — layers arithmetic effect
          // with an end-of-turn duration; no merged op creates it (see
          // judgeReason).
          id: "realm-of-death.debuff-enemy",
          op: "continuous.might",
          args: {
            amount: { kind: "constant", value: -2 },
            duration: { kind: "constant", value: "end-of-turn" },
            target: { kind: "constant", value: "realm-of-death.enemy-unit" }
          },
          targets: [
            {
              id: "realm-of-death.enemy-unit",
              filter: { type: "unit", controller: "opponent" },
              min: 1,
              max: 1,
              selection: "one"
            }
          ]
        },
        {
          // "and a friendly unit +2 Might this turn" — the second layers
          // effect.
          id: "realm-of-death.buff-friendly",
          op: "continuous.might",
          args: {
            amount: { kind: "constant", value: 2 },
            duration: { kind: "constant", value: "end-of-turn" },
            target: { kind: "constant", value: "realm-of-death.friendly-unit" }
          },
          targets: [
            {
              id: "realm-of-death.friendly-unit",
              filter: { type: "unit", controller: "self" },
              min: 1,
              max: 1,
              selection: "one"
            }
          ]
        },
        {
          // "They deal damage equal to their Mights to each other." — first Deal
          // action: the enemy unit deals its own (modified) Might to the
          // friendly unit, with the enemy unit as the source (418.6.b.3).
          // Independent of the Might modifications above (no linkedTo): the
          // modifiers are mandatory, so a failure to apply them must not
          // suppress the Deal action (359.3.e.14).
          id: "realm-of-death.enemy-deals",
          op: "effect.damage",
          args: {
            amount: {
              kind: "object-property",
              object: { target: "realm-of-death.enemy-unit" },
              property: "might"
            },
            source: {
              kind: "object-property",
              object: { target: "realm-of-death.enemy-unit" },
              property: "ref"
            },
            target: { kind: "constant", value: "realm-of-death.friendly-unit" }
          },
          targets: [
            {
              id: "realm-of-death.enemy-unit",
              filter: { type: "unit", controller: "opponent" },
              min: 1,
              max: 1,
              selection: "one"
            },
            {
              id: "realm-of-death.friendly-unit",
              filter: { type: "unit", controller: "self" },
              min: 1,
              max: 1,
              selection: "one"
            }
          ]
        },
        {
          // The mirroring Deal action: the friendly unit deals its own
          // (modified) Might to the enemy unit.
          id: "realm-of-death.friendly-deals",
          op: "effect.damage",
          args: {
            amount: {
              kind: "object-property",
              object: { target: "realm-of-death.friendly-unit" },
              property: "might"
            },
            source: {
              kind: "object-property",
              object: { target: "realm-of-death.friendly-unit" },
              property: "ref"
            },
            target: { kind: "constant", value: "realm-of-death.enemy-unit" }
          },
          targets: [
            {
              id: "realm-of-death.enemy-unit",
              filter: { type: "unit", controller: "opponent" },
              min: 1,
              max: 1,
              selection: "one"
            },
            {
              id: "realm-of-death.friendly-unit",
              filter: { type: "unit", controller: "self" },
              min: 1,
              max: 1,
              selection: "one"
            }
          ]
        }
      ]
    }
  ],
  sourceText:
    "Give an enemy unit -2 :rb_might: this turn and a friendly unit +2 :rb_might: this turn. " +
    "They deal damage equal to their Mights to each other."
} satisfies CardProgram;
