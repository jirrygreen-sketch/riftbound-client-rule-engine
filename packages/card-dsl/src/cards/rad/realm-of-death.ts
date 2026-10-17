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
 * Status: executable. RIFT-258 merged the card-facing `continuous.might`
 * instruction (effects/instructions/continuous.might.ts) and the chain's
 * ResolveContext adapter wires `addContinuous` into the layers engine
 * (chain/engine.ts), so both temporary Might changes register arithmetic-layer
 * effects with an end-of-turn duration and the two Deal actions read the
 * modified Effective Might at resolution (143.2.a, 478). The golden test drives
 * the card's own body through the real ChainEngine and asserts the layered
 * Mights, the resulting damage, and the end-of-turn expiry. The instructions use
 * the merged op's `objects` selection descriptor (`{ kind: "target", id }`) so
 * the chain's interpreter adapter resolves the Finalize-locked TargetSpec; no
 * Might value is approximated with a Buff counter.
 */
export default {
  canonicalCardId: "card.hash-2d0655c3e2e7d9b1f55085edecfe69718e6edf9224340e2b87500e7770483b3d",
  rulesetVersion: "core-1.5",
  status: "executable",
  abilities: [
    {
      kind: "play",
      body: [
        {
          // "Give an enemy unit -2 Might this turn" — merged arithmetic-layer
          // continuous.might op (RIFT-258) with an end-of-turn duration
          // (317.2.c). `objects` carries the Finalize-locked TargetSpec through
          // the chain interpreter adapter.
          id: "realm-of-death.debuff-enemy",
          op: "continuous.might",
          args: {
            mode: { kind: "constant", value: "add" },
            amount: { kind: "constant", value: -2 },
            duration: { kind: "constant", value: "end-of-turn" },
            objects: {
              kind: "constant",
              value: { kind: "target", id: "realm-of-death.enemy-unit" }
            }
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
          // "and a friendly unit +2 Might this turn" — the second
          // arithmetic-layer effect.
          id: "realm-of-death.buff-friendly",
          op: "continuous.might",
          args: {
            mode: { kind: "constant", value: "add" },
            amount: { kind: "constant", value: 2 },
            duration: { kind: "constant", value: "end-of-turn" },
            objects: {
              kind: "constant",
              value: { kind: "target", id: "realm-of-death.friendly-unit" }
            }
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
