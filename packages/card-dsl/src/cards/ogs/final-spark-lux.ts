import type { CardProgram } from "../../ir/index.js";

/**
 * Final Spark, Lux (ogs-022-024) — Spell, 8 energy (Mind/Order), tags
 * Lux/Signature.
 *
 * Printed text:
 *   [Action] (Play on your turn or in showdowns.)
 *   Deal 8 to a unit.
 *
 * Modeling notes (Core Rules v1.5):
 * - [Action] (806) is declared as a keyword ability; the registry owns the
 *   Showdown timing permission (806.1.b/806.1.c, 159.2.a).
 * - "Deal 8 to a unit" is a targeted Deal (418.1.b): "unit" means an object on
 *   the Board (355.9.a.1) and any one of them may be chosen (355.7), so the
 *   instruction carries one TargetSpec of selection "one". Target legality at
 *   Finalize and revalidation at Resolve belong to the target system (355.8,
 *   359.3.e; RIFT-90).
 * - The damage source is the spell itself (418.6.a), so no `source` argument is
 *   authored.
 *
 * Status: executable — one merged effect.damage instruction and the [Action]
 * keyword cover the whole printed ability; the golden test executes the
 * instruction against the real primitive.
 */
const finalSparkLux = {
  canonicalCardId: "card.hash-eef2050754d1ea5e66dbbe4a0abc9faf47327acb4551170226ebde3e02eccd83",
  rulesetVersion: "core-1.5",
  status: "executable",
  abilities: [
    { kind: "keyword", keyword: "action" },
    {
      kind: "play",
      cost: {
        kind: "cost.printed",
        energy: { kind: "constant", value: 8 }
      },
      body: [
        {
          id: "final-spark-lux.deal-8",
          op: "effect.damage",
          args: {
            amount: { kind: "constant", value: 8 },
            target: { kind: "constant", value: "unit" }
          },
          targets: [
            {
              id: "unit",
              filter: { type: "unit" },
              min: 1,
              max: 1,
              selection: "one"
            }
          ]
        }
      ]
    }
  ],
  sourceText: "[Action] (Play on your turn or in showdowns.)\nDeal 8 to a unit."
} satisfies CardProgram;

export default finalSparkLux;
