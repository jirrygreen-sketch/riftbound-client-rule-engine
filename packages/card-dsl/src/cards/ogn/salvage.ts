import type { CardProgram } from "../../ir/index.js";

/**
 * ogn-224-298 Salvage (Spell, Order, 2 energy + 1 Order power) — RIFT-143 shard 8.
 *
 * Catalog evidence (deck-catalog.json, dataVersion 2026-10-12-official-gallery):
 * cardType Spell, domains ["Order"], energy 2, power 1, might null.
 *
 * Printed text:
 *   [Action] (Play on your turn or in showdowns.)
 *   You may kill a gear. Draw 1.
 *
 * Modeling notes (Core Rules v1.5):
 * - [Action] (806) is an intrinsic property of the spell, declared as a keyword
 *   ability and expanded by the keyword registry (contract 3.7).
 * - "You may kill a gear" is an optional instruction; per contract 3.9 the may
 *   wraps the chosen instruction inside `choice.optional.body` (no bare choice
 *   followed by a linkedTo instruction).
 * - "a gear" is chosen, sits on the Board (355.9.a.1: gear means objects on the
 *   Board unless stated otherwise) and is not covered by any 355.10 exception,
 *   so it is a target (355.7). Per 355.12 all choices for a may-action are
 *   targeted and made independently of the decision to perform the action, so
 *   the TargetSpec is declared on the choice node and finalized with the spell
 *   (355.8): Salvage can only be played while a legal gear exists.
 * - "Draw 1." is a separate sentence, not linked to the kill (359.3.e.14: an
 *   independent instruction still resolves when the kill is negated or
 *   ignored).
 * - No printed cost is declared: a spell's printed base cost is bound from the
 *   catalog at Finalize (`cost.printed` binding, contract 3.1 / CR 356.1.c), and
 *   the frozen `cost.printed` CostSpec shape rejects extra payment components.
 */
const salvage = {
  canonicalCardId: "card.hash-75f34b26c92bf9cba4a9ba616b2a7988ef08395e860ed8c5269f15ea0ac6a850",
  rulesetVersion: "core-1.5",
  status: "executable",
  abilities: [
    { kind: "keyword", keyword: "action" },
    {
      kind: "play",
      body: [
        {
          // "You may kill a gear." The TargetSpec sits on the may-instruction so
          // the gear is locked at Finalize (355.12) even when the player
          // declines the kill.
          id: "salvage-kill-opt",
          op: "choice.optional",
          args: {
            prompt: { kind: "literal", value: "Kill a gear?" },
            body: {
              kind: "literal",
              value: [
                {
                  id: "salvage-kill",
                  op: "effect.kill",
                  args: { target: { kind: "literal", value: "salvage-gear" } }
                }
              ]
            }
          },
          targets: [
            {
              id: "salvage-gear",
              filter: { type: "gear" },
              min: 1,
              max: 1,
              selection: "one"
            }
          ]
        },
        {
          // "Draw 1." — independent sentence, so it is not linked to the kill.
          id: "salvage-draw",
          op: "effect.draw",
          args: { amount: { kind: "literal", value: 1 } }
        }
      ]
    }
  ],
  sourceText: "[Action] (Play on your turn or in showdowns.)\nYou may kill a gear. Draw 1."
} satisfies CardProgram;

export default salvage;
