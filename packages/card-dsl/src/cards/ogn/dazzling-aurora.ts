import type { CardProgram } from "../../ir/index.js";

/**
 * Dazzling Aurora (ogn-160-298) — Gear, 9 Energy + 2 Body Power.
 *
 * "At the end of your turn, reveal cards from the top of your Main Deck until
 *  you reveal a unit. Play it, ignoring its cost, and recycle the rest."
 *
 * CR v1.5 anchors:
 * - "At the end of your turn" subscribes to the turn-end timing point
 *   (317.1.a); "your turn" is the ability controller's turn (190.6.d).
 * - 425.3: "Reveal cards from the top of your Main Deck until …" repeatedly
 *   reveals cards and stops at the first matching card. The merged
 *   effect.reveal primitive only supports a fixed count and does not expose an
 *   ordered reveal-until result; the ordered picks work is RIFT-358.
 * - "Play it, ignoring its cost": 420.3 play action with the 356.1.b.1 base
 *   cost rewrite to zero. The cost planner can build an ignore-all-cost plan,
 *   but effect.play still requires a finalized plan tied to the revealed
 *   object's printed cost.
 * - "recycle the rest": 417 recycles the non-unit cards revealed before the
 *   unit; that set is defined by the reveal-until result the IR cannot
 *   produce or link.
 *
 * The structure below keeps the trigger and the intended body shape with the
 * missing ops named; nothing here pretends to resolve.
 */
const dazzlingAurora = {
  canonicalCardId: "card.hash-ec34157eb04ae011d9a79dacfd64f6303e1d79eb376db6975abef7998e893318",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "「reveal cards from the top of your Main Deck until you reveal a unit」需要按牌库顺序逐张展示、在首个单位处停止并把结果集写入链接值；" +
    "当前 effect.reveal 只有固定张数/整区形态，缺少有序 reveal-until 的 picks 与停止条件（RIFT-358）。" +
    "「Play it, ignoring its cost」还需要把被揭示对象的印刷费用接入 finalized cost plan；effect.play 只接受已定案费用计划，" +
    "现有 cost.modify 没有从 reveal 结果建立该动态计划的卡牌程序形态。" +
    "「recycle the rest」依赖同一 reveal-until 结果集；不近似实现。",
  abilities: [
    {
      kind: "triggered",
      trigger: {
        at: "turn-end",
        filter: { event: "turn-end", player: "self" }
      },
      optional: false,
      body: [
        {
          id: "dazzling-aurora.reveal-until-unit",
          // Missing primitive: ordered reveal until the first matching object.
          op: "effect.reveal-until",
          args: {
            from: { kind: "constant", value: "deck-top" },
            until: { kind: "constant", value: { type: "unit" } },
            linkKey: { kind: "constant", value: "revealed" }
          }
        },
        {
          id: "dazzling-aurora.play-unit",
          // Missing support: derive a finalized zero-cost plan for the revealed object.
          op: "effect.play",
          linkedTo: "dazzling-aurora.reveal-until-unit",
          args: {
            object: {
              kind: "linked-value",
              instructionId: "dazzling-aurora.reveal-until-unit",
              key: "revealedUnit"
            },
            ignoreCost: { kind: "constant", value: "printed" }
          }
        },
        {
          id: "dazzling-aurora.recycle-rest",
          op: "effect.recycle",
          linkedTo: "dazzling-aurora.reveal-until-unit",
          args: {
            objects: {
              kind: "linked-value",
              instructionId: "dazzling-aurora.reveal-until-unit",
              key: "revealedRest"
            }
          }
        }
      ]
    }
  ],
  sourceText:
    "At the end of your turn, reveal cards from the top of your Main Deck until you reveal a unit. Play it, ignoring its cost, and recycle the rest."
} satisfies CardProgram;

export default dazzlingAurora;
