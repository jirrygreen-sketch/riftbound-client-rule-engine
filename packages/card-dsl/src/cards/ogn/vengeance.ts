import type { CardProgram } from "../../ir/index.js";

/**
 * ogn-229-298 Vengeance (Spell, Order) — "Kill a unit."
 *
 * Catalog evidence (deck-catalog.json, dataVersion 2026-10-12-official-gallery):
 * energy 4, power 2 (Order). No Action/Reaction keyword: spells default to
 * Action timing (CR v1.5 308.1.a).
 *
 * Structure (contract 3.1 / 3.2):
 * - One play ability whose body is a single `effect.kill` instruction.
 * - "a unit" is a target (355.7 / 429.6 "Kill [one or more permanents]"), so it
 *   is a TargetSpec on the instruction — not a pick. Target legality (still on
 *   the battlefield, not pending on the chain) is rechecked by the interpreter
 *   per 359.3.e; a stale target makes the instruction `ignored` (3.4).
 * - Kill attribution (429.5) and the death timing point (`object-killed`) are
 *   owned by the engine; the card only declares the instruction.
 */
export default {
  canonicalCardId: "card.hash-f67321dac096b3ad1e49b55231663e26f3f9d96efafe79d75719a6eb72fc5caa",
  rulesetVersion: "core-1.5",
  status: "executable",
  abilities: [
    {
      kind: "play",
      cost: {
        kind: "cost.printed",
        energy: { kind: "constant", value: 4 },
        power: { kind: "constant", value: 2 }
      },
      body: [
        {
          id: "kill-chosen-unit",
          op: "effect.kill",
          args: { target: { kind: "constant", value: "chosen-unit" } },
          targets: [
            {
              id: "chosen-unit",
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
  sourceText: "Kill a unit."

} satisfies CardProgram;
