import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * drakehound-packmaster — Core Rules v1.5; see judgeReason for the current execution gaps.
 */
const abilities: Ability[] = [
  {
    kind: "triggered",
    trigger: { at: "card-played", filter: { self: true } },
    optional: false,
    body: [
      {
        id: "drakehound-packmaster.reveal",
        op: "effect.reveal",
        args: { pick: { kind: "constant", value: "drakehound-packmaster.revealed" } },
        picks: [
          {
            id: "drakehound-packmaster.revealed",
            options: ["each-opponent-main-deck-top"],
            filter: { zone: "deck", controller: "opponent" },
            min: 1,
            max: 1,
            selection: "one"
          }
        ]
      },
      {
        id: "drakehound-packmaster.banish",
        op: "effect.banish",
        linkedTo: "drakehound-packmaster.reveal",
        args: {
          objects: { kind: "constant", value: { pick: "drakehound-packmaster.chosen" } },
          amount: { kind: "constant", value: 1 },
          linkKey: { kind: "constant", value: "drakehoundBanished" }
        },
        picks: [
          {
            id: "drakehound-packmaster.chosen",
            options: [
              {
                kind: "linked-value",
                instructionId: "drakehound-packmaster.reveal",
                key: "revealed"
              }
            ],
            min: 1,
            max: 1,
            selection: "one"
          }
        ]
      },
      {
        id: "drakehound-packmaster.play",
        op: "effect.play",
        linkedTo: "drakehound-packmaster.banish",
        args: {
          object: {
            kind: "linked-value",
            instructionId: "drakehound-packmaster.banish",
            key: "drakehoundBanishedObject"
          },
          // “ignoring its cost” = 356.1.b.1 忽略 Base Energy/Power，由 Finalize 产出
          // 已 Finalize 的零费用计划（当前无卡牌可声明的路径，见 judgeReason）。
          cost: { kind: "constant", value: { finalized: true, energy: 0, power: [], xp: 0 } }
        }
      },
      {
        id: "drakehound-packmaster.recycle",
        op: "effect.recycle",
        linkedTo: "drakehound-packmaster.reveal",
        // “Recycle the rest” = 已展示集合减去被选走的那张。被选牌在 banish 时换了区，其旧引用
        // 在结算时已失效（359.3.e.7-.8），因此这里直接消费 reveal 的 revealed 链接值，
        // 非目标集合（355.10.d）丢旧引用后剩下的就是“余牌”。
        args: {
          objects: {
            kind: "linked-value",
            instructionId: "drakehound-packmaster.reveal",
            key: "revealed"
          }
        }
      }
    ]
  }
];

const program = {
  canonicalCardId: "card.hash-13c973685ac41041e9a4132ebb47d2bd5e03e92ecad00fcf6d08ce9e0b8750f4",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "CR 355.10.c/425.3：zoneSlice 有序来源及 reveal 结果到 linked picks 的桥接已可用；仍缺遍历 each opponent、汇集每位对手牌库顶一张并在结算时从展示集合非目标选择一张的适配，现有 effect.reveal 单个 player 与描述性 options 不能表达该流程。CR 356.1.b.1：缺以刚被放逐的其他牌为来源、保留附加费用与其他调整并衔接 effect.play 的忽略基础费用 Finalize 计划。cost.modify 仍以 ctx.source 建计划，source 参数只有 Weaponmaster 的专用形状；不能用常量 finalized 零计划替代。",
  abilities,
  sourceText:
    "When you play me, reveal the top card of each opponent's Main Deck. Choose one and banish it, then play it, ignoring its cost. Recycle the rest."
} satisfies CardProgram;

export default program;
