import type { CardProgram } from "../../ir/index.js";

/**
 * Minotaur Reckoner (sfd-014-221) — Unit.
 *
 * sourceText (packages/card-data/data/deck-catalog.json, verbatim):
 *   "Units can't move to base."
 *
 * CR v1.5 anchors:
 * - 054/054.1: "Can't beats Can" — this is a global prohibition, never a
 *   permission (addsPermission stays false).
 * - 144.4.b: the Standard Move's Battlefield→Base route is removed for every
 *   unit; an effect move to a Base is likewise forbidden (451.1).
 *
 * Status: executable. The prohibition's consumers are merged:
 * - programs/statics.ts maps continuous.movement to the ability layer and
 *   registers a CardProgram static ability as a ContinuousEffectSpec on a live
 *   ChainEngine through attachProgramLifecycle's default binder
 *   (programs/lifecycle.ts, RIFT-257);
 * - zones/movement.ts routeBlocked (RIFT-347) consumes "move-to-base" for the
 *   Battlefield→Base standard move through the movement() rule query
 *   (layers/rules/query.ts), which is the path tested below.
 *
 * The continuous.movement instruction (contract 3.6) spells the restriction in
 * the singular `restriction` argument; the rule query reads the normalized
 * `restrictions` list and layers/engine.ts folds the singular field into it,
 * so both spellings carry the same prohibition.
 */
export default {
  canonicalCardId: "card.hash-4707dc730254c2d3c4ed3484a961094d03925ec45f647f561ff4b106e7e22ebe",
  rulesetVersion: "core-1.5",
  status: "executable",
  abilities: [
    {
      kind: "static",
      effect: {
        kind: "continuous.movement",
        // 054.1: the prohibition only removes the option; it grants nothing.
        restriction: "move-to-base",
        addsPermission: false,
        // 053.2: the text names no host, so every unit on the board is covered.
        filter: { type: "unit", zone: "board" }
      }
    }
  ],
  sourceText: "Units can't move to base."
} satisfies CardProgram;
