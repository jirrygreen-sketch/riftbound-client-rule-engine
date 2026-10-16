import type { CardProgram } from "../../ir/index.js";

/**
 * Gentle Gemdragon (unl-104-219) — Unit, Body, Dragon/Mount Targon;
 * energy 8, Might 8.
 *
 * sourceText (packages/card-data/data/deck-catalog.json, unl-104-219, verbatim):
 *   When you play me or another Dragon, ready up to 2 runes.
 *
 * Rules evidence (Core Rules v1.5):
 * - 383.4.a / 383.4.a.1: "When you play me" is a Play Effect; 383.4.a.4 notes
 *   that "when another object is played" is not itself a Play Effect, but both
 *   halves observe the same closed timing point "card-played"
 *   (events/timing-points.ts), so one TriggerSpec covers the printed union.
 * - 053.1 / 053.4 + 143.1: "me or another Dragon" is exactly "a Dragon unit
 *   you played" — this card is itself a Dragon (deck-catalog tags
 *   ["Dragon", "Mount Targon"]), so the object filter
 *   { type: "unit", tags: ["Dragon"] } with the controller anchor admits the
 *   host printing and every other Dragon without inventing a second branch.
 * - 355.13 / 355.8: "up to 2 runes" is an "up to" choice over Game Objects,
 *   chosen (and re-verified) when the triggered ability is finalized — a
 *   TargetSpec with selection "up-to", min 0, max 2 (not a resolution-time
 *   choose). 107.1 / 108.5: runes sit in the controller's Rune Zone.
 * - 416.1 / 431.1: readying an exhausted rune is the merged effect.ready
 *   primitive; an already-ready rune is not readied again (416.1.b/416.1.c) and
 *   "up to" admits zero runes (355.13).
 *
 * Status: executable — every instruction, keyword-free, timing point and gate
 * this printing needs is merged (card-played trigger, TargetSpec up-to bounds,
 * effect.ready), and the golden test executes the real body through the
 * interpreter and reference kernel. The card-program → TriggerRegistration
 * adapter is still owned by the engine batch 4 / RIFT-120 follow-up, which the
 * golden test records as test.todo instead of claiming the production
 * subscription.
 */
export default {
  canonicalCardId: "card.hash-81788385a3c8b2f3d27d9a7a0b93c5b2d792ca36d504b883b637aa517713a9d5",
  rulesetVersion: "core-1.5",
  status: "executable",
  abilities: [
    {
      kind: "triggered",
      trigger: {
        at: "card-played",
        filter: {
          event: "card-played",
          // “me or another Dragon”：本卡自身是 Dragon，过滤即“你打出的 Dragon 单位”。
          filter: { type: "unit", tags: ["Dragon"], controller: "self" }
        }
      },
      optional: false,
      body: [
        {
          id: "gentle-gemdragon.ready-runes",
          op: "effect.ready",
          args: {
            objects: { kind: "constant", value: { kind: "target", id: "gentle-gemdragon.runes" } }
          },
          targets: [
            {
              id: "gentle-gemdragon.runes",
              // 355.13：“up to 2” → 0..2 个符文，Finalize 锁定后在 Resolve 重验。
              filter: { type: "rune", zone: "rune-zone", controller: "self" },
              min: 0,
              max: 2,
              selection: "up-to"
            }
          ]
        }
      ]
    }
  ],
  sourceText: "When you play me or another Dragon, ready up to 2 runes."
} satisfies CardProgram;
