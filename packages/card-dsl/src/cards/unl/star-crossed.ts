import type { CardProgram } from "../../ir/index.js";

/**
 * Star-Crossed (unl-128-219) — Spell, 3 energy + 1 power, Chaos.
 *
 * sourceText (packages/card-data/data/deck-catalog.json, unl-128-219, verbatim):
 *   "[Reaction] (Play any time, even before spells and abilities resolve.)
 *    Return a friendly unit and an enemy unit to their owners' hands."
 *
 * Rules evidence (Core Rules v1.5):
 * - [Reaction] (813) is declared as a keyword ability only; 813.1.b grants the
 *   card every Action permission, 813.1.c adds Closed State play on any
 *   player's turn, and 813.3 records that it is a pure permission. The
 *   expansion lives in effects/keywords/Reaction.ts (contract 3.7) and
 *   admission is chain-owned (contract 3.5).
 * - "a friendly unit and an enemy unit" names two specific Board objects, so
 *   both are targets (355.5 / 355.7 / 355.9.a.1); each is locked while the spell
 *   is finalized (355.8). They are declared on two instructions because
 *   effect.zone consumes exactly one TargetSpec per instruction (the same split
 *   ogn/challenge makes for its two units), and the two clauses are independent:
 *   neither references the other's result, so neither instruction is `linkedTo`
 *   the other (359.3.e.14).
 * - "to their owners' hands": a Return is its own GameAction
 *   (`return-to-hand`), which effect.zone submits for a `to: "hand"`
 *   destination; the action layer routes the card to its *owner's* hand rather
 *   than the mover's (056.1, and the routing note in ogn/gust, which uses the
 *   same destination for "to its owner's hand").
 * - The printed cost is 3 Energy + 1 Chaos power (206 / 204.1).
 *
 * Status: executable. Both Returns use the merged effect.zone primitive and the
 * merged target vocabulary, and the golden test executes the program's own body
 * through the interpreter and reference kernel, including the owner-vs-
 * controller routing, a mistargeted member and an ignored-link boundary.
 */
export default {
  canonicalCardId:
    "card.hash-c237d595f64a88ab3cacf2dfa2935f94ed51b2fff1a6628f33719e23e2161eb1",
  rulesetVersion: "core-1.5",
  status: "executable",
  abilities: [
    { kind: "keyword", keyword: "reaction" },
    {
      kind: "play",
      cost: {
        kind: "cost.printed",
        energy: { kind: "constant", value: 3 },
        power: { kind: "constant", value: 1 }
      },
      body: [
        {
          id: "star-crossed.return-friendly-unit",
          op: "effect.zone",
          args: {
            target: { kind: "constant", value: "star-crossed.friendly-unit" },
            to: { kind: "constant", value: "hand" }
          },
          targets: [
            {
              id: "star-crossed.friendly-unit",
              // 「a friendly unit」：355.9.b 的控制器限制，355.7 的具体选择。
              filter: { type: "unit", controller: "controller", zone: "board" },
              min: 1,
              max: 1,
              selection: "one"
            }
          ]
        },
        {
          id: "star-crossed.return-enemy-unit",
          op: "effect.zone",
          args: {
            target: { kind: "constant", value: "star-crossed.enemy-unit" },
            // 「to their owners' hands」：return-to-hand 由动作层路由到拥有者手牌
            // （056.1；ogn/gust 的同一目的地写法）。
            to: { kind: "constant", value: "hand" }
          },
          targets: [
            {
              id: "star-crossed.enemy-unit",
              filter: { type: "unit", controller: "opponent", zone: "board" },
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
    "[Reaction] (Play any time, even before spells and abilities resolve.)\n" +
    "Return a friendly unit and an enemy unit to their owners' hands."
} satisfies CardProgram;
