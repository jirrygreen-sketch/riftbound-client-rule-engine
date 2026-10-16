import type { CardProgram } from "../../ir/index.js";

/**
 * Improvised Projectile (rad-056-167) — Gear, 3 Energy + 1 Mind Power, no tags.
 *
 * Printed text (deck-catalog.json, rad-056-167, verbatim):
 *   [Action] (Play on your turn or in showdowns.)
 *   Choose a friendly gear. Deal damage equal to its Energy cost to a unit at a
 *   battlefield.
 *
 * Rules evidence (Core Rules v1.5):
 * - 806.1 / 806.1.a / 806.1.d: [Action] is a Permissive keyword that may be
 *   present on Cards; on a Card it is spelled “[Action]” and grants permission
 *   to be played during Showdowns on any player's turn. 159.2.a is the same
 *   intrinsic property for a Spell; here the keyword is declared on the Gear
 *   and its expansion is owned by the keyword registry (contract 3.7).
 *   135.2.d.3: the parenthesised reminder has no game effect of its own.
 * - 355.7 / 355.9.a.1 / 355.9.b: “Choose a friendly gear” picks one specific
 *   Board Game Object that the ability's controller chooses, and no 355.10
 *   exception applies, so it is a Target (locked while the item is finalized,
 *   355.8). “a unit at a battlefield” is a second Target whose battlefield
 *   restriction is a targeting restriction (355.9.b).
 * - 206: an effect that needs a card's cost uses its printed (or copied) cost,
 *   so “its Energy cost” is read from the chosen Gear. The value is read at
 *   resolution through the frozen `object-property` expression on the chosen
 *   target (contract 3.6: value expressions are evaluated when used), which is
 *   the same reading sfd-… / rad-… programs use for “equal to its Energy
 *   cost”; a Gear with no printed Energy keeps `energy: null` and is never
 *   turned into 0 here (contract §3.1; for a token the rules separately treat
 *   the missing cost as 0, 185.3.a.1).
 * - 418.6.a: the damage instruction names no source, so the Gear that carries
 *   the instruction is the source (effect.damage's `self` default).
 * - 359.2.b: a Permanent executes all of its rules text from top to bottom, so
 *   the printed instructions are modelled as this Gear's play ability body.
 *
 * Status: executable — both printed instructions resolve through merged code:
 * the Finalize TargetPlan locks the two targets (target/target-plan.ts), the
 * interpreter resolves them (effects/interpreter.ts), and effect.damage deals
 * the dynamically read Energy amount. The golden test drives the card's own
 * body through the chain interpreter path with finalized targets, exactly as
 * the merged zenith-blade-leona / challenge goldens do.
 *
 * Notes for the production wiring (owned by the coordinating task, not a gap in
 * this card's data): the `[Action]` expansion (continuous.timing) has no layer
 * consumer yet, and the CardProgram -> ChainDraft `describePlay` adapter that
 * would build this play ability's draft is the RIFT-120 follow-up.
 */
const improvisedProjectile = {
  canonicalCardId: "card.hash-415c30a2e32abfc05fc5c11072550f7685facb794af8fa368be192daa3dfd580",
  rulesetVersion: "core-1.5",
  status: "executable",
  abilities: [
    { kind: "keyword", keyword: "action" },
    {
      kind: "play",
      body: [
        {
          // “Choose a friendly gear. Deal damage equal to its Energy cost to a
          // unit at a battlefield.” One Deal action: the chosen Gear supplies
          // the amount (206), the chosen unit receives it (418.1.c).
          id: "improvised-projectile.deal-energy",
          op: "effect.damage",
          args: {
            amount: {
              kind: "object-property",
              object: { target: "improvised-projectile.friendly-gear" },
              property: "energy"
            },
            target: { kind: "constant", value: "improvised-projectile.unit-at-battlefield" }
          },
          targets: [
            {
              // “a friendly gear” — a Gear on the Board (355.9.a.1) that the
              // ability's controller controls (740.1.a “friendly”).
              id: "improvised-projectile.friendly-gear",
              filter: { type: "gear", controller: "self", zone: "board" },
              min: 1,
              max: 1,
              selection: "one"
            },
            {
              // “a unit at a battlefield” — any unit whose Location is a
              // Battlefield (170.5, 198.1). The frozen ObjectFilter spelling
              // for the location-type restriction is `location: "battlefield"`
              // (layers/filter.ts compares it against object.location.type;
              // 355.10.b makes “at a battlefield” a targeting restriction, not
              // an extra target).
              id: "improvised-projectile.unit-at-battlefield",
              filter: { type: "unit", location: "battlefield" },
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
    "[Action] (Play on your turn or in showdowns.)\n" +
    "Choose a friendly gear. Deal damage equal to its Energy cost to a unit at a battlefield."
} satisfies CardProgram;

export default improvisedProjectile;
