import type { CardProgram } from "../../ir/index.js";

/**
 * Eager Drakehound (sfd-006-221) — Unit.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, sfd-006-221, verbatim）:
 *   "I enter ready."
 *
 * Rules evidence (Core Rules v1.5):
 * - 359.2.c / 369.3: units enter exhausted by default and "I enter ready"
 *   replaces that entry orientation. The effect.ready primitive states it does
 *   not participate in entry replacement, so the ability must be shaped as a
 *   replacement (805.6.a: never a post-entry becomes-ready event).
 * - The replacement binding (packages/engine-core/src/replacement/) is merged:
 *   a self-pointing effect.ready replaces body is recognized as an entry
 *   orientation declaration and rewrites the orientation before the permanent
 *   moves from the Chain zone to the Board. The end-to-end golden test drives
 *   the card program through createProgramBinding -> attachLifecycle ->
 *   play -> advance -> resolveAll and asserts the unit enters ready.
 *
 * Status (cards/README.md §2): executable — the card's single ability is
 * expressible with merged primitives and has a real execution test.
 */
export default {
  canonicalCardId: "card.hash-1497e682bf282da7f38e77af1bfab763e1be0d7a44c62995f1af09d4ba6b6281",
  rulesetVersion: "core-1.5",
  status: "executable",
  abilities: [
    {
      kind: "replacement",
      replaces: { event: "object-enters-board", filter: { source: "self", exhausted: true } },
      with: [
        {
          id: "eager-drakehound.enter-ready",
          op: "effect.ready",
          args: { objects: { kind: "constant", value: { kind: "source" } } }
        }
      ]
    }
  ],
  sourceText: "I enter ready."
} satisfies CardProgram;
