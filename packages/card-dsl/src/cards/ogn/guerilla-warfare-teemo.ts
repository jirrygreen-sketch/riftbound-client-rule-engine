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
 * Status: judge-required — two dependencies are not merged:
 * - the [Hidden] restriction is not evaluable: no merged filter predicate
 *   tests a keyword characteristic. The layer matcher compares
 *   type/zone/location/controller/owner/states/tags/characteristics and has no
 *   keyword form, the reference kernel matches by value only, and
 *   ObjectSnapshot.keywords is not a filter key anywhere. The key is written
 *   as a descriptive, fail-closed restriction because dropping it would report
 *   "return any two trash cards" as the card effect.
 * - "hide cards ignoring costs this turn" needs the Hide cost/zone machinery
 *   plus a duration-bounded cost waiver: the merged Hidden KeywordDef declares
 *   only a static cost.hidden placeholder and documents that the Hide action,
 *   the facedown zone, the [A] payment and the next-turn Reaction permission
 *   are not implemented (RIFT-84 / RIFT-89). The waiver is authored as an
 *   unmerged cost.modify instruction carrying the printed this-turn duration.
 * The return clause uses only merged structures and is executed by the golden
 * test.
 */
const guerillaWarfare = {
  canonicalCardId: "card.hash-1175fb7ab62c4d777b8ccd63b423982a0b70440ed2d5652d2b61dde6fb07b06f",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "两段依赖未合入：(1)「cards with [Hidden]」是 811.5 的卡牌特征限制，但已合入的过滤体系没有关键词谓词——" +
    "layers/filter.ts 只比较 type/zone/location/controller/owner/states/tags/characteristics，参考内核按值比较，" +
    "ObjectSnapshot.keywords 没有任何过滤器键，因此该目标限制无法求值；写成 { keywords: [\"Hidden\"] } 是描述性的 fail-closed 形态，" +
    "删掉它会把“任意两张垃圾场卡牌”写成事实（禁止近似）。(2)「You can hide cards ignoring costs this turn」改写 Hide 行动的费用" +
    "（811.1.b 的 [A]、422.1/422.2 的 Hide 定义、811.1.c.1 Hide≠Play），需要 hidden 费用/明置区机制与本回合期限的减费许可；" +
    "已合入的 Hidden KeywordDef 只声明 cost.hidden 占位并注明 Hide 行动、明置区、[A] 支付与次回合 Reaction 许可均未实现" +
    "（RIFT-84/RIFT-89）。返回半段（effect.zone → hand，355.7/355.13/417.1.b）已合入，由 golden 执行。",
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
              // the descriptive key no merged filter predicate evaluates yet.
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
          // judgeReason); no merged cost.modify instruction exists.
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

