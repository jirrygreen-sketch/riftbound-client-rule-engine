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
 *   effect.reveal primitive only supports a fixed count (picking a subset of
 *   the revealed cards) and never reads deck order; the zoneSlice ordering
 *   API (contract 3.6 / RIFT-66) is not wired into any reveal instruction.
 * - "Play it, ignoring its cost": 420.3 play action with the 356.1.b.1 base
 *   cost rewrite to zero. The cost rewrite is cost.modify / cost-plan work
 *   (RIFT-89); effect.play requires an already-finalized cost plan and does
 *   not derive or ignore printed costs by itself.
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
    "「reveal cards from the top of your Main Deck until you reveal a unit」需要按牌库顺序逐张展示、在首个单位处停止并把结果集写入链接值：" +
    "已合入的 effect.reveal 只支持固定张数或整区展示，且不读牌库顺序（契约 3.6 zoneSlice / RIFT-66 未接入任何展示指令）；" +
    "「Play it, ignoring its cost」需要按 CR 356.1.b.1 把印刷费用改写为 0 并生成 finalized cost plan（cost.modify / RIFT-89），" +
    "effect.play 只接受已定案费用计划；「recycle the rest」依赖同一 reveal-until 结果集。依赖：RIFT-66 展示/排序后续、RIFT-89；不近似实现。",
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
          // Missing support: play with the printed cost ignored (RIFT-89).
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
