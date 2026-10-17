import type { CardProgram } from "../../ir/index.js";

/**
 * Guerilla Warfare, Teemo (ogn-264-298) — Spell, 2 energy + 1 Mind power
 * (Mind/Chaos, Teemo Signature).
 *
 * Printed text:
 *   Return up to two cards with [Hidden] from your trash to your hand.
 *   You can hide cards ignoring costs this turn.
 *
 * Modeling notes (Core Rules v1.5):
 * - "Return up to two cards ... from your trash to your hand" is a
 *   non-mandatory selection of cards in a public zone: "up to" selects zero to
 *   two (355.13), those cards are targeted (355.7 / 355.9.a prints "Return a
 *   unit from your trash to your hand" as its example), and the move itself is
 *   the merged effect.zone primitive with destination "hand" (417.1.b keeps
 *   owner-zone routing). The golden test executes this clause with
 *   Finalize-locked trash cards.
 * - "with [Hidden]" is a characteristic of the card (811.5) and is therefore a
 *   targeting restriction.
 * - "You can hide cards ignoring costs this turn" modifies the Hide
 *   Discretionary Action for the rest of the turn: 811.1.b has the Hidden
 *   keyword pay [A] to Hide the card facedown, 422.1 / 422.2 define the Hide
 *   action itself, and 811.1.c.1 keeps Hide distinct from Play, so ignoring the
 *   cost removes neither the facedown-zone, control and slot requirements nor
 *   the next-turn Reaction permission.
 *
 * Status: judge-required — keyword membership cannot yet be bound as a target
 * restriction, and Hide/facedown/timing plus the turn-scoped cost waiver lack
 * production consumers. Hidden cost planning itself has merged: [A] to hide,
 * ignored base resources to play from Hidden, and total cost rewrites are
 * available. None of those planners grants a Hide action or a lasting waiver.
 * The return clause has primitive execution evidence below.
 */
const guerillaWarfare = {
  canonicalCardId: "card.hash-1175fb7ab62c4d777b8ccd63b423982a0b70440ed2d5652d2b61dde6fb07b06f",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "CR 811.5 的「cards with [Hidden]」目标限制仍缺关键词成员谓词：programs/filters.ts 不接受 keywords，layers/filter.ts " +
    "不检查该字段，目标候选与 Resolve 重验均未连接。还缺 Hide 行动、facedown 区域、次回合 Reaction 许可（811.1.b / 422.1 / 422.2），以及本回合 Hide " +
    "免全部费用的持续注册与到期消费者；811.1.c.1 的 Hide 不是 Play。单次费用计划的 ignoreAllCosts 不能代替跨行动的本回合 Hide 免付费规则。",
  sourceText:
    "Return up to two cards with [Hidden] from your trash to your hand. " +
    "You can hide cards ignoring costs this turn.",
  abilities: [
    {
      kind: "play",
      body: [
        {
          id: "return-hidden-cards",
          op: "effect.zone",
          args: {
            target: { kind: "constant", value: "hidden-cards-in-trash" },
            amount: { kind: "constant", value: 2 },
            to: { kind: "constant", value: "hand" }
          },
          targets: [
            {
              id: "hidden-cards-in-trash",
              // "up to two cards with [Hidden] from your trash": 0..2 cards in
              // the controller's trash (355.13). The [Hidden] restriction is
              // a descriptive key the production target binder cannot consume.
              filter: { zone: "trash", owner: "self", keywords: ["Hidden"] },
              min: 0,
              max: 2,
              selection: "up-to"
            }
          ]
        },
        {
          // "You can hide cards ignoring costs this turn" — an unmerged Hide
          // cost waiver with the printed end-of-turn duration (see
          // judgeReason); Hide still needs its action and permission consumer.
          id: "hide-ignoring-costs",
          op: "cost.modify",
          args: {
            scope: { kind: "constant", value: "hide" },
            ignoreCosts: { kind: "constant", value: true },
            duration: { kind: "constant", value: "this-turn" }
          }
        }
      ]
    }
  ]
} satisfies CardProgram;

export default guerillaWarfare;

