import type { CardProgram } from "../../ir/index.js";

/**
 * ogn-248-298 Icathian Rain, Kai'Sa (Spell, Fury/Mind, 7 energy + 3 power,
 * tags Kai'Sa / Signature) — RIFT-143 shard 8.
 *
 * Catalog evidence (deck-catalog.json, dataVersion 2026-10-12-official-gallery):
 * cardType Spell, domains ["Fury", "Mind"], energy 7, power 3, might null.
 *
 * Printed text (six separate sentences, verbatim):
 *   Deal 2 to a unit. (x6)
 *
 * Modeling notes (Core Rules v1.5):
 * - The card prints the same sentence six times, so it is six independent
 *   instructions from top to bottom (158.1 "executed from top to bottom"), not
 *   one repeating instruction: each sentence chooses its own unit and each
 *   choice is made when the spell is finalized (355.12: choices for a game
 *   action are targeted and made independently). They are therefore NOT linked
 *   with `linkedTo` (contract README §4: independent statements are not linked
 *   for test convenience).
 * - "a unit" is a targeted choice on the Board (355.7 / 355.9.a.1), one unit
 *   per sentence; no "up to" or "any number" wording, so each spec is exactly
 *   one unit (355.13 does not apply). The six choices are independent, so the
 *   same unit may be chosen more than once (each sentence deals 2 separately).
 * - effect.damage submits one damage GameAction per still-legal target
 *   (418.1.c) with the spell as source (418.6.a); stale targets are dropped at
 *   resolution (359.3.e) without affecting the other five sentences.
 * - No [Action]/[Reaction] keyword is printed; the spell keeps its printed
 *   intrinsic properties only, and no speed keyword is invented for it.
 * - No printed cost is declared (catalog-bound `cost.printed`, contract 3.1).
 */
const icathianRain = {
  canonicalCardId: "card.hash-e103f9d62c928837475ed870767d97957ffd5cf5908be18d0d74fa19fef131ff",
  rulesetVersion: "core-1.5",
  status: "executable",
  abilities: [
    {
      kind: "play",
      body: [
        {
          id: "icathian-rain-1",
          op: "effect.damage",
          args: {
            amount: { kind: "literal", value: 2 },
            target: { kind: "literal", value: "icathian-rain-unit-1" }
          },
          targets: [
            { id: "icathian-rain-unit-1", filter: { type: "unit" }, min: 1, max: 1, selection: "one" }
          ]
        },
        {
          id: "icathian-rain-2",
          op: "effect.damage",
          args: {
            amount: { kind: "literal", value: 2 },
            target: { kind: "literal", value: "icathian-rain-unit-2" }
          },
          targets: [
            { id: "icathian-rain-unit-2", filter: { type: "unit" }, min: 1, max: 1, selection: "one" }
          ]
        },
        {
          id: "icathian-rain-3",
          op: "effect.damage",
          args: {
            amount: { kind: "literal", value: 2 },
            target: { kind: "literal", value: "icathian-rain-unit-3" }
          },
          targets: [
            { id: "icathian-rain-unit-3", filter: { type: "unit" }, min: 1, max: 1, selection: "one" }
          ]
        },
        {
          id: "icathian-rain-4",
          op: "effect.damage",
          args: {
            amount: { kind: "literal", value: 2 },
            target: { kind: "literal", value: "icathian-rain-unit-4" }
          },
          targets: [
            { id: "icathian-rain-unit-4", filter: { type: "unit" }, min: 1, max: 1, selection: "one" }
          ]
        },
        {
          id: "icathian-rain-5",
          op: "effect.damage",
          args: {
            amount: { kind: "literal", value: 2 },
            target: { kind: "literal", value: "icathian-rain-unit-5" }
          },
          targets: [
            { id: "icathian-rain-unit-5", filter: { type: "unit" }, min: 1, max: 1, selection: "one" }
          ]
        },
        {
          id: "icathian-rain-6",
          op: "effect.damage",
          args: {
            amount: { kind: "literal", value: 2 },
            target: { kind: "literal", value: "icathian-rain-unit-6" }
          },
          targets: [
            { id: "icathian-rain-unit-6", filter: { type: "unit" }, min: 1, max: 1, selection: "one" }
          ]
        }
      ]
    }
  ],
  sourceText:
    "Deal 2 to a unit.\n" +
    "Deal 2 to a unit.\n" +
    "Deal 2 to a unit.\n" +
    "Deal 2 to a unit.\n" +
    "Deal 2 to a unit.\n" +
    "Deal 2 to a unit."
} satisfies CardProgram;

export default icathianRain;
