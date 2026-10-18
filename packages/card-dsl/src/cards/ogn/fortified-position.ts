import type { CardProgram } from "../../ir/index.js";

/**
 * Fortified Position (ogn-279-298) — Battlefield, domainless.
 *
 * "When you defend here, choose a unit. It gains [Shield 2] this combat.
 *  (+2 :rb_might: while it's a defender.)"
 *
 * CR v1.5 anchors:
 * - 383.4.f / 383.4.f.1 / 383.4.f.2.b: "When you defend here …" is a Defend
 *   Trigger (Defend Triggers of anything that references the player Defending
 *   are put on the chain when the controller of the triggering source has
 *   defended), matching the "defense-declared" timing point emitted by
 *   combat/ (rule refs 323.2 / 383.4.f / 466.2.c).
 * - 355.5 / 355.7: "choose a unit" is a choice of a specific Game Object, so
 *   it is a target and is revalidated at resolution; it is not a pick.
 * - 814.1.b / 814.1.c / 814.1.d / 814.1.d.1: [Shield 2] is functionally "while
 *   I am a defender, I have +2 [M]", and the Defender designation is what
 *   keeps it in effect; the reminder text in the printing restates exactly
 *   that. "this combat" therefore lasts as long as the combat (Shield itself
 *   already expires with the designation per 814.1.d.1).
 * - 190.6.a / 190.6.d: "you" is this battlefield's Controller, which is also
 *   the player who makes the choice and controls the ability.
 *
 * Status rationale (contract §3.1, cards README §2): the one-unit target and
 * bounded continuous.grant-keyword instruction are executable in isolation.
 * The card remains judge-required because the current trigger binder rejects
 * the `here` vocabulary, and Shield's defender-conditioned Might consumer
 * still uses `designation` while the combat layer exposes `combatRole`.
 */
export default {
  canonicalCardId: "card.hash-cba0d858c9e26ac8298f585d8f5060e6fe140167286cfa137e3afdd3aa6acdf8",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "continuous.grant-keyword 已能把 [Shield 2] 注册到所选单位并保留 end-of-combat duration；" +
    "但 programs/filters.ts 的 production trigger translator 仍拒绝 defense-declared 过滤器中的 here 字段，" +
    "且 Shield 展开条件读取 designation；KeywordGrantLayerEngine 的重展开环境虽把它别名到 combatRole，" +
    "生产装配未接入该引擎，生产条件回调也没有接入 expr-ext/evaluate.ts 的映射，" +
    "故 CR 814.1.c/814.1.d.1 的 defender 条件尚未形成可执行消费链。",
  sourceText:
    "When you defend here, choose a unit. It gains [Shield 2] this combat. (+2 :rb_might: while it's a defender.)",
  abilities: [
    {
      kind: "triggered",
      trigger: {
        at: "defense-declared",
        filter: { event: "defense-declared", here: true, player: "controller" },
        // 383.4.e.2.a / 383.4.f.2.a: identity triggers are checked once per
        // combat, so a player defending here can only cause one such trigger.
        once: "per-combat"
      },
      optional: false,
      body: [
        {
          // "choose a unit" (355.5/355.7): one target, revalidated at
          // resolution.
          id: "fortified-position.grant-shield",
          op: "continuous.grant-keyword",
          args: {
            keyword: { kind: "constant", value: "Shield" },
            value: { kind: "constant", value: 2 },
            // The engine's Duration vocabulary spells the combat-bounded form
            // "end-of-combat" (effects/contract.ts, layers/duration.ts); it is
            // the same lifetime the reminder text describes.
            duration: { kind: "constant", value: "end-of-combat" },
            target: { kind: "constant", value: "defended-unit" }
          },
          targets: [
            {
              id: "defended-unit",
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
