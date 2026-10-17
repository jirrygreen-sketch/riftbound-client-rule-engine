import type { CardProgram } from "../../ir/index.js";

/**
 * Abandon (unl-131-219) — Spell, 2 energy, no printed power, Chaos.
 *
 * sourceText (packages/card-data/data/deck-catalog.json, unl-131-219, verbatim):
 *   "[Reaction] (Play any time, even before spells and abilities resolve.)
 *    Counter a spell. Return it to its owner's hand instead of putting it in
 *    their trash.
 *    [Predict]. (Look at the top card of your Main Deck. You may recycle it.)"
 *
 * Rules evidence (Core Rules v1.5):
 * - [Reaction] (813) is declared as a keyword ability only; 813.1.b grants the
 *   card every Action permission and 813.1.c adds Closed State play on any
 *   player's turn. The expansion lives in effects/keywords/Reaction.ts
 *   (contract 3.7) and admission is chain-owned (contract 3.5).
 * - "Counter a spell" is the merged effect.counter primitive: 355.9.a.2 keeps
 *   "spell" on the Chain, 355.9.c forbids a spell from targeting itself, and
 *   426.1-426.3 make the countered card do nothing and clear it from the Chain
 *   without refunding costs. Pending chain items are not legal targets
 *   (contract 3.4).
 * - "Return it to its owner's hand instead of putting it in their trash" is the
 *   countered card's destination: 426.1.a.1 puts cards cleared from the Chain in
 *   the trash, and this card replaces that destination with the card owner's
 *   hand. The frozen `counter` GameAction is `{ type: "counter", object }` with
 *   no destination (effects/contract.ts), so the rewrite has no expression. It
 *   is NOT modelled as "counter, then move it from the trash to hand": the card
 *   would then enter the trash first (a wrong zone change for 428/423-style
 *   observations and a new object identity per 124), which is exactly the kind
 *   of approximation the red line forbids (sfd/riposte and ogn/portal-rescue
 *   record the same class of gap for their cost/effect rewrites).
 * - [Predict] (437.1 / 437.3 / 437.3.a: Predicting 1 card, looking at the top
 *   card of the Main Deck and choosing whether to Recycle it) is declared as a
 *   keyword ability per README section 5. There is no `Predict` KeywordDef in
 *   the merged registry; the merged Vision keyword
 *   inlines Predict 1 for its own expansion, which the card cannot reuse. The
 *   survey's keyword table lists Predict as kw-predict backed by
 *   effect.inspect / effect.recycle / effect.order / choice.optional.
 *
 * status = judge-required (README section 2). The counter half is merged and is
 * executed by the golden test against a locked Chain target; the destination
 * rewrite and the Predict expansion are not approximated.
 *
 * Dependencies: a destination-carrying Counter (426.1.a.1 rewrite) and the
 * Predict KeywordDef (kw-predict, no assigned task number; the merged Vision
 * expansion shows the shape).
 */
export default {
  canonicalCardId:
    "card.hash-d09252c46a7b55e632764e08731ef10a6d95a5409873cada88871b4531a6e640",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "两处缺口：(1) 426.1.a.1 的反制落点需要从 Trash 改为拥有者手牌，" +
    "但 GameAction counter 只有 object，没有落点参数；chain 的清理路径没有本次反制专用的落点改写。" +
    "不能先进入 Trash 再回手，那会产生额外换区与 124 的新对象身份。" +
    "(2) Predict 的 inspect/recycle 等原语已存在，但缺可由 keyword: predict 展开的 Predict KeywordDef" +
    "（437.1/437.3/437.3.a）；Vision 的内部展开不能代替本卡声明的关键词。",
  abilities: [
    { kind: "keyword", keyword: "reaction" },
    // 437.3.a：未写数值的 [Predict] 按 1 张处理；展开由关键词注册表负责（当前无 Predict KeywordDef）。
    { kind: "keyword", keyword: "predict" },
    {
      kind: "play",
      cost: {
        kind: "cost.printed",
        energy: { kind: "constant", value: 2 }
      },
      body: [
        {
          id: "abandon.counter-spell",
          op: "effect.counter",
          args: { target: { kind: "constant", value: "abandon.spell" } },
          targets: [
            {
              id: "abandon.spell",
              // 「a spell」= 链上已 Finalize 的对象（355.9.a.2）；355.9.c 禁止法术反制自身，
              // Pending 链项不能作为目标（契约 3.4）——两者都是目标系统的义务。
              filter: { type: "spell", zone: "chain" },
              min: 1,
              max: 1,
              selection: "one"
            }
          ]
        }
      ]
    }
  ],
  sourceText:
    "[Reaction] (Play any time, even before spells and abilities resolve.)\n" +
    "Counter a spell. Return it to its owner's hand instead of putting it in their trash.\n" +
    "[Predict]. (Look at the top card of your Main Deck. You may recycle it.)"
} satisfies CardProgram;
