import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Rek'Sai, Swarm Queen (sfd-170-221) — Unit, 5 energy + 1 Order power, Might 5,
 * tags Rek'Sai / The Void / Champion.
 *
 * sourceText (packages/card-data/data/deck-catalog.json, sfd-170-221):
 *   When I attack, you may reveal the top 2 cards of your Main Deck. You may
 *   play one. Then recycle the rest. If the played card is a unit, you may play
 *   it here.
 *
 * Rules evidence (Core Rules v1.5):
 * - "When I attack" is an Attack Trigger (383.4.e / 383.4.e.1): the
 *   attack-declared timing point filtered to this unit.
 * - "you may reveal the top 2 cards of your Main Deck" is an optional Reveal of
 *   a Secret zone (425.1, 425.2.a); the cards stay in the Main Deck (425.1.a.2)
 *   and the reveal is limited to the top cards, so the selection must follow the
 *   deck's real order (zoneSlice contract, 108.4.e). The optional wrapper is
 *   choice.optional around the chosen body per contract 3.9.
 * - "You may play one" is a second optional decision (355.1); a game-effect
 *   Play uses the normal play procedure (420.3), so the played card is picked
 *   from the revealed cards without targeting them (355.10).
 * - "Then recycle the rest" recycles the not-played revealed cards to the bottom
 *   of their owner's Main Deck (417.1, 417.1.a, 417.1.c).
 * - "If the played card is a unit, you may play it here" adds an entry-location
 *   choice for the played unit (355.2.b) gated on the played card's type.
 *
 * Status: judge-required — four merged gaps, none approximated:
 * - the deck-top slice cannot be obtained from a card program: effect.reveal
 *   explicitly refuses a subset of a non-hand zone with "a subset of this zone
 *   requires upstream ordered picks; query order is not deck order", and no
 *   merged primitive converts zoneSlice or "top 2 cards" into ordered picks
 *   (RIFT-66 provided zoneSlice; the card-level binding is missing).
 * - "You may play one" needs a card-play cost plan for the chosen revealed
 *   card: effect.play requires an already-finalized plan and never derives
 *   printed costs, so playing a card whose cost must still be computed has no
 *   merged path (RIFT-89).
 * - "If the played card is a unit" is a type-membership test on an object named
 *   by a link value. Condition has no array-contains operator (only
 *   eq/ne/lt/lte/gt/gte/in, where in tests left-in-right), so the played card's
 *   types cannot be tested for unit without inventing semantics — the same gap
 *   already recorded by Ravenbloom Conservatory (sfd-215-221).
 * - consequently "play it here" (the 355.2.b entry-location permission) cannot
 *   be gated or applied and is deliberately not encoded as an unconditional
 *   location override.
 * The golden test executes the merged parts: the reveal primitive on a locked
 * ordered pick, the optional wrapper, and the linked recycle of the rest.
 * Dependencies: RIFT-8x ordered deck-top provisioning, RIFT-89 (cost plan for
 * effect.play), the array-contains contract request for type tests.
 */
const abilities: Ability[] = [
  {
    kind: "triggered",
    trigger: {
      at: "attack-declared",
      filter: { event: "attack-declared", filter: { source: "self" } }
    },
    optional: false,
    body: [
      {
        id: "reksai.may-reveal",
        op: "choice.optional",
        args: {
          prompt: { kind: "constant", value: "Reveal the top 2 cards of your Main Deck?" },
          body: {
            kind: "constant",
            value: [
              {
                id: "reksai.reveal",
                op: "effect.reveal",
                args: {
                  // The top-2 slice arrives as an ordered pick (effect.reveal
                  // refuses to infer deck order from query). Producing that
                  // pick from the deck top is the judged gap.
                  pick: { kind: "constant", value: "reksai.top-two" }
                },
                picks: [
                  {
                    id: "reksai.top-two",
                    // Ordered deck-top options supplied by the engine once the
                    // deck-top provisioning exists; the placeholder marks a
                    // dynamic (non-literal) option set and is not an ObjectRef.
                    options: ["dynamic:main-deck-top-two"],
                    min: 2,
                    max: 2,
                    selection: "any",
                    filter: { zone: "deck", owner: "controller" }
                  }
                ]
              },
              {
                id: "reksai.may-play",
                op: "choice.optional",
                linkedTo: "reksai.reveal",
                args: {
                  prompt: { kind: "constant", value: "Play one of the revealed cards?" },
                  body: {
                    kind: "constant",
                    value: [
                      {
                        id: "reksai.play-one",
                        op: "effect.play",
                        linkedTo: "reksai.reveal",
                        args: {
                          pick: { kind: "constant", value: "reksai.revealed-play" },
                          linkKey: { kind: "constant", value: "played" }
                        },
                        picks: [
                          {
                            id: "reksai.revealed-play",
                            options: [
                              {
                                kind: "linked-value",
                                instructionId: "reksai.reveal",
                                key: "revealed"
                              }
                            ],
                            selection: "one",
                            min: 1,
                            max: 1
                          }
                        ]
                      }
                    ]
                  }
                }
              },
              {
                id: "reksai.recycle-rest",
                op: "effect.recycle",
                linkedTo: "reksai.reveal",
                args: {
                  // 417.1.a/417.1.c: the rest go to the bottom of their owner's
                  // Main Deck; stale references (already played) are dropped.
                  objects: {
                    kind: "linked-value",
                    instructionId: "reksai.reveal",
                    key: "revealed"
                  },
                  linkKey: { kind: "constant", value: "recycled" }
                }
              }
            ]
          }
        }
      }
    ]
  }
];

const program = {
  canonicalCardId: "card.hash-66da1ff0419b3ebf3d4e801af0a225acbd65b392adf96224c9e14101755c0716",
  rulesetVersion: "core-1.5" as const,
  status: "judge-required" as const,
  judgeReason:
    "四处依赖未合入：(1)「reveal the top 2 cards of your Main Deck」需要按牌库真实顺序提供有序 picks——effect.reveal 对非手牌的" +
    "真子集明确拒绝（“a subset of this zone requires upstream ordered picks; query order is not deck order”），把 zoneSlice/牌库顶 2 张" +
    "变成卡牌可用的有序选择尚未接线；(2)「You may play one」需要为所选牌生成费用计划，effect.play 只接受已 finalize 的计划、从不推导印刷费用（RIFT-89）；" +
    "(3)「If the played card is a unit」需要按链接值对象的 types 做数组成员测试，Condition 没有 array-contains（只有 eq/ne/lt/lte/gt/gte/in，in 是" +
    "左侧属于右侧数组），同 Ravenbloom Conservatory（sfd-215-221）记录的缺口；(4) 因此「play it here」的入场地点许可（355.2.b）无法开闸，" +
    "程序中不写成无条件 location，避免对非单位牌近似实现。" +
    "golden 用锁定有序 pick 真实执行 effect.reveal、choice.optional 与链接 recycle。",
  abilities,
  sourceText:
    "When I attack, you may reveal the top 2 cards of your Main Deck. You may play one. Then recycle the rest. If the played card is a unit, you may play it here."
} satisfies CardProgram;

export default program;
