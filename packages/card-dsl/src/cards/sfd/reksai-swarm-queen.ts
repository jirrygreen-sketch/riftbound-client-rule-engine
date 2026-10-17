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
 *   and the reveal is limited to the top cards, so the ordered slice must come
 *   from the upstream zone-order query (contract 3.6 zoneSlice, 108.4.e): query
 *   order is not deck order. The optional wrapper is choice.optional around the
 *   chosen body per contract 3.9.
 * - "You may play one" is a second optional decision (355.1); a game-effect
 *   Play uses the normal play procedure (420.3), so the played card is picked
 *   from the revealed cards without targeting them (355.10).
 * - "Then recycle the rest" recycles the not-played revealed cards to the bottom
 *   of their owner's Main Deck (417.1, 417.1.a, 417.1.c).
 * - "If the played card is a unit, you may play it here" adds an entry-location
 *   choice for the played unit (355.2.b).
 *
 * Status: judge-required. RIFT-358 supplies real Finalize/Resolve zoneSlice
 * and linked picks, including effect.reveal.pick Expr decoding. The optional
 * reveal, optional one-card play, printed-cost payment and recycle instructions
 * are exercised unchanged through ChainEngine. Remaining gaps are the combat
 * attack event producer and the unit-only "play it here" entry-location choice:
 * effect.play still links only a played count, not the played object reference.
 * No unconditional location override stands in for that permission.
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
                  // Finalize locks the actual top two in zone order; Resolve
                  // decodes this Expr and reveals those exact incarnations.
                  pick: { kind: "constant", value: "reksai.top-two" }
                },
                picks: [
                  {
                    id: "reksai.top-two",
                    options: [],
                    ordered: true,
                    selection: "all",
                    zoneSlice: { zone: "deck", from: "top", count: { kind: "constant", value: 2 } }
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
                          linkKey: { kind: "constant", value: "played" },
                          amount: { kind: "constant", value: 1 },
                          choice: { kind: "constant", value: { id: "reksai.choose-one", min: 1, max: 1 } }
                        },
                        picks: [
                          {
                            id: "reksai.revealed-play",
                            options: [],
                            ordered: true,
                            selection: "all",
                            linked: { kind: "linked-value", instructionId: "reksai.reveal", key: "revealed" }
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
                  }
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
    "两处缺口仍保持 judge-required：(1) attack-declared 的战斗开始事务产生方尚未合入（RIFT-124）；" +
    "(2)「If the played card is a unit, you may play it here」需要以被打出对象的 types 为闸门，再提供 CR 355.2.b 的入场地点选择，" +
    "effect.play 的 linkKey 目前只写 played 计数，不记录对象引用，不能写成无条件 location。" +
    "有序选择与费用路径已合入：RIFT-358 的 ordered picks / zoneSlice 在 Finalize 锁定真实牌库顶 2 张（RIFT-66 顺序接口），" +
    "effect.reveal.pick 的 Expr 已由 LITERAL_FIELDS 解包，后续 linked pick 读取实际 revealed 列表，effect.play.choice 只选一张。" +
    "真实 ChainEngine 测试执行原始可选正文、展示、选择、印刷费用支付及剩余牌回收；不手动移走已打出的牌。" +
    "依赖：战斗 attack-declared 产生方、effect.play 的对象回执与单位入场地点选择。",
  abilities,
  sourceText:
    "When I attack, you may reveal the top 2 cards of your Main Deck. You may play one. Then recycle the rest. If the played card is a unit, you may play it here."
} satisfies CardProgram;

export default program;

