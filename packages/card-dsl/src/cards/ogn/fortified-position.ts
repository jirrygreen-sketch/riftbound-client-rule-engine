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
 * Status rationale (contract §3.1, cards README §2): the defend trigger and
 * the one-unit target are expressible, and the keyword is declared the way
 * contract §3.7 requires (the expanded value lives in keywords/Shield.ts, not
 * in this file), but the grant itself is a temporary keyword grant: the target
 * gains a keyword it may not have printed, for this combat. The merged surface
 * has no primitive or instruction for granting a keyword with a duration
 * (continuous.grant-keyword / continuous.keyword in the primitive inventory,
 * no instruction file, not consumed by the layers engine), and the Shield
 * expansion the layers engine would consume is not wired either, so the card
 * stays judge-required with the grant written as an instruction with the
 * target and duration it needs.
 */
export default {
  canonicalCardId: "card.hash-cba0d858c9e26ac8298f585d8f5060e6fe140167286cfa137e3afdd3aa6acdf8",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "The grant 'It gains [Shield 2] this combat' has no merged execution path: continuous.grant-keyword is in the RIFT-9 primitive inventory but has no instruction file and no layer consumer, so a keyword cannot be granted to another object for a bounded duration, and the Shield expansion produced by keywords/Shield.ts (continuous.might gated on the defender designation, CR 814.1.c/814.1.d.1) is not consumed by the merged layers engine yet. Declaring the keyword here would describe this battlefield instead of the chosen unit, which is not done. Dependencies: the keyword-grant/continuous effect workstream and the defense-declared trigger pipeline (RIFT-33 scenarios-triggers, RIFT-90 target system for the one-unit choice).",
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
            appliesTo: { kind: "constant", value: { target: "defended-unit" } }
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
