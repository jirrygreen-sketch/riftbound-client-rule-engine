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
 *   The upstream ordered pick set is declared through picksSpecId, whose
 *   PickSpec options name the controller's deck-top block; effect.inspect
 *   negates (negated/impossible) when that ordered source is absent rather
 *   than approximating order.
 *   effect.inspect requires an explicit "player" expression, and the card's
 *   controller is what "your Main Deck" means, so the body first binds it with
 *   condition.value (contract 3.9's value binding, key "controller") and the
 *   look instruction reads it back as a linked value. The selector is
 *   "source" (the ability source) so the controller is read even when the
 *   spell has already moved zones.
 * - "Put 1 into your hand" is effect.zone with a non-target PickSpec over the
 *   cards just looked at (the linked "inspected-picked" list).
 * - "and recycle the rest" is effect.recycle over the same looked-at list; the
 *   one card already moved to Hand is no longer a live reference, so the
 *   primitive recycles the remaining cards (CR 417.1.a keeps them on the
 *   bottom of the Main Deck; 417.4 accepts recycling what is available).
 * - The instruction order (look -> put 1 into hand -> recycle the rest)
 *   follows the printed order; "the rest" is not a separate linked action
 *   requiring "if you do" semantics, so the recycle instruction links only to
 *   the look that produced the card set (contract 3.4 isolated conditions).
 *
 * Status: judge-required — the look/put-into-hand/recycle half uses only
 * merged primitives and is executed in the golden test, but the card as a
 * whole is not executable: no merged code produces the ordered deck-top pick
 * set that effect.inspect's "top" scope requires. The interpreter's picks come
 * from ctx.picks(id) (interpreter.ts), i.e. from Finalize-locked answers the
 * production caller must provision; the chain's Finalize surface only
 * finalizes instruction.targets TargetSpecs (chain/engine.ts
 * assertFinalizationSurface) and there is no ordered-zone pick lifecycle. With
 * no such set the primitive looks at nothing at all (it never falls back to a
 * set query for order) and the follow-up instructions act on an empty list, so
 * a production play cannot even look at the top three cards. The golden test
 * supplies the ordered set through the reference kernel, which by itself does
 * not prove the production path. The missing ordered-pick lifecycle is tracked
 * by RIFT-358.
 */
const stackedDeck = {
  canonicalCardId: "card.hash-de0d686bb2019a7d9b9b5212d1e6b414c0f1c1a69c9903fedc7471b860b86045",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "缺「按牌库顶顺序取前 3 张」的生产选择生命周期：effect.inspect 的 top scope 必须由上游提供有序 picksSpecId（其自身文档明确：query 不保证顺序，缺有序来源时 negated/impossible，不用 query 截取近似）；" +
    "已合入的链 Finalize 只锁定 instruction.targets 的 TargetSpec（chain/engine.ts assertFinalizationSurface），没有有序区域 pick 的锁定路径，" +
    "生产打出会因缺有序来源而查看不到任何牌（范围为空、后续取 1 无从选择），无法完成「看牌库顶 3 张」。" +
    "look → 取 1 入手 → recycle 其余三段只用已合入原语，golden 测试借参考内核提供该有序集合执行；" +
    "依赖：RIFT-358（有序区域 picks / Finalize 生命周期）。",
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
            linkedKey: { kind: "constant", value: "viewedCount" },
            pickedKey: { kind: "constant", value: "viewed" }
          },
          picks: [
            {
              id: "stacked-deck.viewed",
              // 牌库顶前 3 张（含顺序），由上游 zoneSlice 顺序提供。
              options: ["top-3-cards-of-your-main-deck-in-zone-order"],
              min: 3,
              max: 3,
              selection: "all",
              filter: { owner: "self", zone: "deck" }
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
              // 取自 look 的结果（已合入示例 ravenbloom-conservatory 的同一写法：
              // options 是 PickSpec 的 Value 列表，指向前序链接值）。
              options: [
                { kind: "linked-value", instructionId: "stacked-deck.look", key: "viewed" }
              ],
              min: 1,
              max: 1,
              selection: "one"
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
