import type { CardProgram } from "../../ir/index.js";

/**
 * Flash (ogs-011-024) — Spell, 2 energy (Chaos).
 *
 * Printed text:
 *   [Reaction] (Play any time, even before spells and abilities resolve.)
 *   Move up to 2 friendly units to base.
 *
 * Modeling notes (Core Rules v1.5):
 * - [Reaction] (813) is a Permissive keyword declared on the card; the keyword
 *   registry expands the Closed State / Showdown permission (813.1.b/813.1.c,
 *   159.2.b).
 * - "Move up to 2 friendly units to base" performs a game action on some
 *   number of game objects, so every chosen unit is targeted and chosen
 *   independently of the decision to perform the action (355.12); "up to 2"
 *   may choose any number including zero (355.13), which is why the TargetSpec
 *   is selection "up-to" with min 0 and max 2. The units are on the Board
 *   (355.9.a.1) and "friendly" is the controller relationship.
 * - The destination is the units' controllers' Bases: "base" with no further
 *   restriction and 107.1.c makes each unit's Base its controller's Base, which
 *   is exactly effect.move's `to: "controller-base"` destination. A unit
 *   already in its Base has no Move to perform (355.4.a requires a destination
 *   other than the current Location; 448.3.b), so effect.move skips it instead
 *   of substituting another object or another location.
 * - This is an effect Move, not the Standard Move: no exhaust cost and no
 *   Main-Phase gate (144, 451.1); route restriction, contested status and
 *   Combat staging remain with move-location (449.2, 452-454). It is also not a
 *   Recall (457: a Recall is not a Move and is printed as such).
 *
 * Status: executable — the [Reaction] keyword and the single targeted
 * effect.move instruction cover the printed ability, and both have merged
 * paths. The golden test runs the real primitive and the real chain.
 */
const flash = {
  canonicalCardId: "card.hash-f3577cb543db90ce388e8461dd0e5f65b7d5b2f9ae4c4e497b104f4dc72539dd",
  rulesetVersion: "core-1.5",
  status: "executable",
  abilities: [
    { kind: "keyword", keyword: "reaction" },
    {
      kind: "play",
      cost: {
        kind: "cost.printed",
        energy: { kind: "constant", value: 2 }
      },
      body: [
        {
          id: "flash.move",
          op: "effect.move",
          args: {
            objects: { kind: "constant", value: { target: "flash.friendly-units" } },
            to: { kind: "constant", value: "controller-base" },
            amount: { kind: "constant", value: 2 }
          },
          targets: [
            {
              id: "flash.friendly-units",
              filter: { type: "unit", controller: "self" },
              min: 0,
              max: 2,
              selection: "up-to"
            }
          ]
        }
      ]
    }
  ],
  sourceText:
    "[Reaction] (Play any time, even before spells and abilities resolve.)\n" +
    "Move up to 2 friendly units to base."
} satisfies CardProgram;

export default flash;
