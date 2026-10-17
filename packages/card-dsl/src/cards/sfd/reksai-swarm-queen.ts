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
 * Status: judge-required — two merged-dependency gaps, none approximated:
 * - The top-2 slice still has to be produced by the caller: effect.reveal
 *   explicitly refuses a subset of a non-hand zone ("a subset of this zone
 *   requires upstream ordered picks; query order is not deck order"), and the
 *   chain's Finalize only locks instruction.targets TargetSpecs — it owns no
 *   lifecycle for an ordered zone pick (RIFT-66 added ctx.zoneSlice, but the
 *   card-level binding that would turn "top 2" into locked picks is missing).
 *   The same gap is recorded by sfd/called-shot.
 * - "If the played card is a unit" cannot be gated: although the merged
 *   compare/in condition can test "unit" membership in an object's types array
 *   (see sfd/ravenbloom-conservatory), the gate must read the *played* card's
 *   types from the effect.play receipt, and effect.play's link receipt only
 *   carries the played count (linkKey → number). It captures no object list, so
 *   there is no linked object whose types could be tested. Consequently "play it
 *   here" (the 355.2.b entry-location permission) is deliberately not encoded as
 *   an unconditional location override.
 * The golden executes the merged parts: the optional wrapper, the linked
 * recycle of the rest, the real deck-top slice read through zoneSlice, the
 * merged effect.play cost path, and an additional direct chain execution that
 * plays a deck card without a cost override so the chain Finalize prints and
 * pays the printed cost.
 * Dependencies: an ordered deck-top pick lifecycle in the chain Finalize/Resolve
 * (RIFT-257 follow-up) and an effect.play link receipt that records the played
 * object references (the current receipt only records the played count).
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
    "两处依赖未合入，均不近似实现：(1)「reveal the top 2 cards of your Main Deck」需要按牌库真实顺序提供有序 picks——effect.reveal 对非手牌的" +
    "真子集明确拒绝（“a subset of this zone requires upstream ordered picks; query order is not deck order”），链的 Finalize 只锁定 " +
    "instruction.targets 的 TargetSpec、没有有序区域 pick 的生命周期；RIFT-66 只加了 ctx.zoneSlice，把「牌库顶 2 张」变成卡牌可用的有序选择仍未接线" +
    "（同 sfd/called-shot 记录的缺口）。费用路径已合入：effect.play 不带 cost override 时，链 Finalize 会对单位/装备/法术打出生成并支付印刷费用，" +
    "已有真实执行证据（3 费单位从牌库打出，能量 20→17）。(2)「If the played card is a unit」" +
    "的闸门无法开：已合入的 compare/in 能测 types 数组成员（见 sfd/ravenbloom-conservatory 的真实执行证据），但被检查的对象必须来自 effect.play 的链接回执，" +
    "而该回执的 linkKey 只写 played 计数（number），不记录被播放的对象引用，因此没有可读 types 的链接对象；相应地「play it here」的入场地点许可（355.2.b）" +
    "不写成无条件 location（避免对非单位牌近似实现）。golden 用锁定有序 pick 真实执行 effect.reveal、choice.optional 与链接 recycle，用 zoneSlice 读出真实牌库顶，" +
    "并用无 cost override 的链上 effect.play 验证印刷费用会被生成和支付。依赖：链 Finalize/Resolve 的有序区域 pick 生命周期（RIFT-257 后续）、" +
    "以及记录被播放对象引用的 effect.play 链接回执（当前只写 played 计数）。",
  abilities,
  sourceText:
    "When I attack, you may reveal the top 2 cards of your Main Deck. You may play one. Then recycle the rest. If the played card is a unit, you may play it here."
} satisfies CardProgram;

export default program;

