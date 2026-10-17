import type { CardProgram } from "../../ir/index.js";

/**
 * Stacked Deck (ogn-183-298) — Spell, 1 energy, Chaos.
 *
 * Printed text:
 *   [Action] (Play on your turn or in showdowns.)
 *   Look at the top 3 cards of your Main Deck. Put 1 into your hand and
 *   recycle the rest.
 *
 * Structure (contract 3.1 / 3.2 / 3.9, Core Rules v1.5):
 * - "action" keeps the printed [Action] keyword (806; 159.2.a); its
 *   "continuous.timing" expansion and the chain admission are owned by the
 *   keyword registry and chain/ (contract 3.7).
 * - "Look at the top 3 cards of your Main Deck" is the merged effect.inspect
 *   primitive: its "top" scope reads the ordered slice through
 *   ctx.zoneSlice(player, "deck", "top", amount) and submits the private
 *   "look" action (CR 128.3-128.4 look, 108.4.e the Main Deck's order is secret;
 *   reading the deck top in zone order must use zoneSlice, never a set query).
 *   The ordered source is a real Finalize binding: the PickSpec declares
 *   options: [], ordered: true, selection: "all" with a zoneSlice, which
 *   chain/picks/plan.ts locks through finalizeOrderedPickPlans (RIFT-358) and
 *   the interpreter reads back with ctx.picks
 *   (chain/interpreter-adapter.ts). A set query never substitutes for it.
 * - effect.inspect requires an explicit "player" expression, and the card's
 *   controller is what "your Main Deck" means, so the body first binds it with
 *   condition.value (contract 3.9's value binding, key "controller") and the
 *   look instruction reads it back as a linked value. The selector is
 *   "source" (the ability source) so the controller is read even when the
 *   spell has already moved zones.
 * - "Put 1 into your hand" is decided while the cards are being looked at
 *   (355.18: a choice that 355 does not list is made on resolution), so the
 *   look instruction itself offers the private choice through
 *   choose/chooseCount { min: 1, max: 1 } and links the answer as "kept"
 *   (128.6/128.6.a chooser-only). The follow-up effect.zone consumes that
 *   resolution-time answer through a PickSpec linked to the look result.
 * - "and recycle the rest" is effect.recycle over the same looked-at list; the
 *   one card already moved to Hand is no longer a live reference, so the
 *   primitive recycles the remaining cards (CR 417.1.a keeps each card on the
 *   bottom of its owner's Main Deck; 417.4 accepts recycling what is available;
 *   417.5 places simultaneously recycled Main Deck cards on the bottom in
 *   random order, so this program never fixes their mutual order).
 * - The instruction order (look -> put 1 into hand -> recycle the rest)
 *   follows the printed order; "the rest" is not a separate linked action
 *   requiring "if you do" semantics, so the recycle instruction links only to
 *   the look that produced the card set (contract 3.4 isolated conditions).
 *
 * Status: executable. RIFT-358 merged the ordered-zone pick lifecycle, so the
 * production Finalize locks the controller's real deck-top 3 (zone order, not
 * query order) and the golden test drives the card's own program through
 * ProgramRegistry/describePlay and the real ChainEngine: Finalize captures the
 * slice, Resolve asks the chooser privately, one card really moves to Hand and
 * the rest really recycle to the bottom.
 */
const stackedDeck = {
  canonicalCardId: "card.hash-de0d686bb2019a7d9b9b5212d1e6b414c0f1c1a69c9903fedc7471b860b86045",
  rulesetVersion: "core-1.5",
  status: "executable",
  abilities: [
    { kind: "keyword", keyword: "action" },
    {
      kind: "play",
      body: [
        {
          id: "stacked-deck.bind-controller",
          op: "condition.value",
          args: {
            // "your Main Deck" = the caster's deck (190.6.d's implied "you").
            value: { kind: "object-property", object: "source", property: "controller" },
            key: { kind: "constant", value: "controller" }
          }
        },
        {
          id: "stacked-deck.look",
          op: "effect.inspect",
          linkedTo: "stacked-deck.bind-controller",
          args: {
            player: {
              kind: "linked-value",
              instructionId: "stacked-deck.bind-controller",
              key: "controller"
            },
            zone: { kind: "constant", value: "deck" },
            scope: { kind: "constant", value: "top" },
            amount: { kind: "constant", value: 3 },
            picksSpecId: { kind: "constant", value: "stacked-deck.viewed" },
            // "Put 1 into your hand": the private pick is made now (355.18),
            // exactly one card, and only the chooser sees the options.
            choose: { kind: "constant", value: true },
            chooseCount: { kind: "constant", value: { min: 1, max: 1 } },
            choiceId: { kind: "constant", value: "stacked-deck.keep-one" },
            linkedKey: { kind: "constant", value: "viewedCount" },
            pickedKey: { kind: "constant", value: "viewed" },
            choosePicksKey: { kind: "constant", value: "kept" }
          },
          picks: [
            {
              id: "stacked-deck.viewed",
              // 牌库顶前 3 张（含顺序），由 Finalize 的 zoneSlice 顺序提供。
              options: [],
              ordered: true,
              selection: "all",
              zoneSlice: { zone: "deck", from: "top", count: { kind: "constant", value: 3 } }
            }
          ]
        },
        {
          id: "stacked-deck.put-into-hand",
          op: "effect.zone",
          linkedTo: "stacked-deck.look",
          args: {
            pick: { kind: "constant", value: "stacked-deck.kept-card" },
            to: { kind: "constant", value: "hand" },
            amount: { kind: "constant", value: 1 }
          },
          picks: [
            {
              id: "stacked-deck.kept-card",
              // 取自 look 的结算时选择结果（effect.inspect 的 choosePicksKey）。
              options: [],
              ordered: true,
              selection: "all",
              linked: {
                kind: "linked-value",
                instructionId: "stacked-deck.look",
                key: "kept"
              }
            }
          ]
        },
        {
          id: "stacked-deck.recycle-rest",
          op: "effect.recycle",
          linkedTo: "stacked-deck.look",
          args: {
            objects: { kind: "linked-value", instructionId: "stacked-deck.look", key: "viewed" }
          }
        }
      ]
    }
  ],
  sourceText:
    "[Action] (Play on your turn or in showdowns.)\n" +
    "Look at the top 3 cards of your Main Deck. Put 1 into your hand and " +
    "recycle the rest."
} satisfies CardProgram;

export default stackedDeck;

