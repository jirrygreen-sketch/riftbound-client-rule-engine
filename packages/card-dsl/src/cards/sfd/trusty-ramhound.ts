import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Trusty Ramhound (sfd-159-221) — Unit, 2 energy, Might 2, Order,
 * tags Dog / Elite / Demacia.
 *
 * sourceText (packages/card-data/data/deck-catalog.json, sfd-159-221):
 *   While you have another unit here, I have +1 :rb_might:.
 *
 * Rules evidence (Core Rules v1.5):
 * - "While ..." introduces a Continuous Effect that applies as long as its
 *   condition holds (363.2.a / 383.2.b conditional continuous abilities); the
 *   +1 Might is applied in the arithmetic layer (143.2.a, 475–478).
 * - "another unit you control here": "another" excludes the source object
 *   (355.9.c), "you control" is the source's controller, and "here" is the
 *   source's current location; the contract 3.6 anchors are `exclude: "self"`
 *   and `sameLocationAs: "self"` (359.3.f referents).
 * - The Might bonus is a static arithmetic-layer effect, not a Buff counter
 *   (702: a Buff is a counter, each one gives +1 Might, but this card never
 *   places one).
 *
 * Status: executable. The static lifecycle binder registers the arithmetic effect
 * and evaluates the compare/count condition through the interpreter's relative
 * sameLocationAs and exclude anchors. The production layer golden verifies
 * that the source gains +1 only while another friendly unit shares its location.
 */
const abilities: Ability[] = [
  {
    kind: "static",
    effect: {
      kind: "continuous.might",
      mode: "add",
      layer: "arithmetic",
      appliesTo: "self",
      amount: { kind: "constant", value: 1 }
    },
    // "While you have another unit here" — 355.9.c excludes the source and
    // 359.3.f anchors "here" to the source's location. The interpreter evaluates
    // this condition exactly through the production static binder.
    condition: {
      kind: "compare",
      left: {
        kind: "count",
        subject: "other-units-here",
        filter: {
          zone: "board",
          type: "unit",
          controller: "self",
          exclude: "self",
          sameLocationAs: "self"
        }
      },
      operator: "gte",
      right: { kind: "constant", value: 1 }
    }
  }
];

const program = {
  canonicalCardId: "card.hash-88c1812cc994f155d1a08ed94e9690205a48e0ecd3e4d827b49d468bc6f8e69f",
  rulesetVersion: "core-1.5" as const,
  status: "executable" as const,
  abilities,
  sourceText: "While you have another unit here, I have +1 :rb_might:."
} satisfies CardProgram;

export default program;
