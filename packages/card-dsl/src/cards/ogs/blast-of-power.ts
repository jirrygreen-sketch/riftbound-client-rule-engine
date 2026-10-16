import type { CardProgram } from "../../ir/index.js";

/**
 * Blast of Power (ogs-012-024) — Spell, 6 energy + 1 Order power (Order).
 *
 * Printed text:
 *   [Action] (Play on your turn or in showdowns.)
 *   Kill a unit at a battlefield.
 *
 * Modeling notes (Core Rules v1.5):
 * - [Action] (806) is declared as a keyword ability; the registry owns the
 *   Showdown timing permission (806.1.b/806.1.c, 159.2.a).
 * - "Kill a unit at a battlefield" is an Active Kill (429.1.a.1.a). The unit is
 *   the target and "at a battlefield" is only a targeting restriction
 *   (355.9.a.1, 355.10.b: "Kill a unit at a battlefield" targets a unit, not a
 *   battlefield). The location restriction uses the layers matcher's
 *   location-type vocabulary (`location: "battlefield"`), the spelling the
 *   merged layers/filter.ts evaluates.
 * - effect.kill only submits the kill action (429.3); attribution (429.5) and
 *   the death timing point stay with the engine. Target legality at Finalize
 *   and revalidation at Resolve are the target system's obligation (355.8,
 *   359.3.e; RIFT-90), and a stale-only target set makes the instruction
 *   ignored (contract 3.4).
 *
 * Status: executable — the [Action] keyword, the targeted effect.kill
 * instruction, and the location restriction all have merged paths, and the
 * golden test executes the instruction against the real primitive.
 */
const blastOfPower = {
  canonicalCardId: "card.hash-4e761253721b822594d16215714c20c98ba8e0ef48a65272bcea3a3f02252ac7",
  rulesetVersion: "core-1.5",
  status: "executable",
  abilities: [
    { kind: "keyword", keyword: "action" },
    {
      kind: "play",
      cost: {
        kind: "cost.printed",
        energy: { kind: "constant", value: 6 },
        power: { kind: "constant", value: 1 }
      },
      body: [
        {
          id: "blast-of-power.kill",
          op: "effect.kill",
          args: { target: { kind: "constant", value: "battlefield-unit" } },
          targets: [
            {
              id: "battlefield-unit",
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
  sourceText: "[Action] (Play on your turn or in showdowns.)\nKill a unit at a battlefield."
} satisfies CardProgram;

export default blastOfPower;
