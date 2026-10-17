import type { CardProgram } from "../../ir/index.js";

/**
 * Packed Amphitheater (rad-164-167) — Battlefield, Colorless.
 *
 * sourceText (packages/card-data/data/deck-catalog.json, rad-164-167):
 *   "Champion units here have +1 :rb_might:."
 *
 * CR v1.5 anchors:
 * - 133.7.a: Champion is a supertype that applies exclusively to units; a
 *   "Champion unit" is a Unit printing carrying the Champion marker (in the
 *   catalog the Unit's tags include "Champion", and the server's trusted
 *   catalog type resolver returns the "Champion" printing kind for it).
 * - 475 / 476 / 479: "have" is a Layer effect that alters a property of the
 *   Game Objects; the arithmetic Might increase is the Arithmetic layer
 *   (479.4 / 479.4.e.1 applies positive increases first).
 * - 478.1 / 190.6.a: the effect is evaluated continuously while the Battlefield
 *   is in use; control of the Battlefield determines control of its abilities.
 * - 053.3: "here" is this Battlefield, so the unit must be at this Battlefield;
 *   740.1.a: this includes attackers (Combat does not remove the unit from the
 *   location).
 *
 * Status (cards/README.md §2): executable (2026-10-17 recheck). The merged
 * program lifecycle binds static card abilities into LayerEngine, resolves the
 * sameLocationAs anchor relative to the source, and board snapshots carry the
 * Champion supertype. The golden exercises the production binding path and
 * verifies same-location and Champion filtering.
 */
export default {
  canonicalCardId: "card.hash-7e95acea2b29696bcdb29e7def854dacdbb55f72f5160fb4bc3e9c872950af6e",
  rulesetVersion: "core-1.5",
  status: "executable" as const,
  sourceText: "Champion units here have +1 :rb_might:.",
  abilities: [
    {
      kind: "static",
      effect: {
        // 479.4 / 479.4.e.1: +1 Might is an arithmetic-layer addition; the
        // merged LayerEngine consumes exactly this shape (the golden test runs
        // it). filter.type "champion" is the 133.7.a supertype predicate, and
        // sameLocationAs "self" carries the 053.3 "here" referent, which the
        // merged filter does not implement (see judgeReason).
        kind: "continuous.might",
        mode: "add",
        layer: "arithmetic",
        amount: { kind: "constant", value: 1 },
        filter: {
          type: "champion",
          zone: "board",
          sameLocationAs: "self"
        }
      }
    }
  ]
} satisfies CardProgram;

