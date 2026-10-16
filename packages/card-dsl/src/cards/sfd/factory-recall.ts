import type { CardProgram } from "../../ir/index.js";

/**
 * Factory Recall (sfd-135-221) — Spell, 1 energy, no printed power, Chaos.
 *
 * sourceText (packages/card-data/data/deck-catalog.json, sfd-135-221, verbatim):
 *   "[Action] (Play on your turn or in showdowns.)
 *    Return a gear to its owner's hand."
 *
 * Rules evidence (Core Rules v1.5):
 * - "[Action]" (806.1.b/806.1.c, 159.2.a) is declared as a keyword ability; the
 *   Showdown permission is expanded by effects/keywords/Action.ts (contract 3.7)
 *   and enforced by the chain's canAct.
 * - "a gear" names an object on the Board (355.9.a.1) that the spell's
 *   controller chooses specifically, so it is a Target (355.7) with a fixed
 *   count of one (355.13 would be "up to"). No controller restriction is
 *   printed, so both players' gears are legal candidates.
 * - "Return ... to its owner's hand" is the return-to-hand action: 056.1/056.2
 *   route the card to its OWNER's hand, which the merged effect.zone submits for
 *   `to: "hand"` (action layer). 416-free, the zone change is not a Move (448.2),
 *   so no Move restrictions or Move triggers apply.
 * - The spell has no other clause and needs no other primitive.
 *
 * Status (cards/README.md §2): executable — the only printed instruction is one
 * targeted effect.zone return, whose primitive, TargetSpec handling and the
 * owner-routed destination all have merged paths; the golden test executes the
 * instruction through the real primitive, including the owner-hand routing and
 * the stale-target boundary (359.3.e.6-e.8).
 *
 * Two engine-owned obligations remain outside the card (recorded as test.todo):
 * the printed [Action] Showdown admission needs the continuous.timing consumer
 * (RIFT-91) plus a CardProgram -> ChainDraft play adapter (chain/engine.ts
 * describePlay), and a gear leaving the Board must run the 448.2/455 zone-change
 * bookkeeping in the real kernel.
 */
const factoryRecall = {
  canonicalCardId: "card.hash-2e4b5dab6b8ccc7a18ef91f2c2fd8b2ecdad0af08019aec16c521e322a2fac36",
  rulesetVersion: "core-1.5",
  status: "executable",
  abilities: [
    { kind: "keyword", keyword: "action" },
    {
      kind: "play",
      cost: {
        // 印刷 1 Energy、无 Power（356.1.c 由卡牌身份在 Finalize 绑定）。
        kind: "cost.printed",
        energy: { kind: "constant", value: 1 }
      },
      body: [
        {
          id: "factory-recall.return-gear",
          op: "effect.zone",
          args: {
            target: { kind: "constant", value: "factory-recall.gear" },
            to: { kind: "constant", value: "hand" },
            amount: { kind: "constant", value: 1 }
          },
          targets: [
            {
              id: "factory-recall.gear",
              // 原文未限定控制者，双方装备都可被选择（355.7 / 355.9.a.1）。
              filter: { type: "gear", zone: "board" },
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
    "[Action] (Play on your turn or in showdowns.)\n" +
    "Return a gear to its owner's hand."
} satisfies CardProgram;

export default factoryRecall;
